/* Multitrack session: tracks, clips, mixing graph, rendering view. */
(function (root) {
  'use strict';
  const AS = (root.AS = root.AS || {});
  const D = AS.dsp;
  const TH = 96, RULER_H = 26, TITLE_H = 12;
  const COLORS = ['#3b8eea', '#35b58a', '#d6a02b', '#c25ad6', '#e0605a', '#4fc1d8', '#8bc34a', '#ff8a50'];
  const BUS_COLORS = ['#9b8cff', '#7fa8c9', '#c9a27f', '#8fc98a'];
  const CURVES = [['linear', 'Linear'], ['cosine', 'Cosine (S-curve)'], ['log', 'Logarithmic'], ['exp', 'Exponential']];
  const ENV = AS.env, ENV_KINDS = ['volume', 'pan'];

  /* a source = immutable audio snapshot {name, sr, ch} */
  function makeSource(name, sr, ch) { return { name, sr, ch, dur: ch[0].length / sr }; }
  function srcPeaks(src) { return src._pk || (src._pk = new AS.Peaks(src.ch)); }
  function srcBuffer(src) { return src._ab || (src._ab = AS.engine.toBuffer(src.ch, src.sr)); }
  const zcmp = (a, b) => (a.z || 0) - (b.z || 0) || a.id - b.id; // clip stacking order: back → front
  const jclone = (o) => (o === undefined ? undefined : JSON.parse(JSON.stringify(o)));

  /* ---- fades ---- */
  const SHAPES = { cosine: (u) => 0.5 - 0.5 * Math.cos(Math.PI * u), log: (u) => Math.log10(1 + 9 * u), exp: (u) => u * u * u, linear: (u) => u };
  function fadeShape(type) { return SHAPES[type] || SHAPES.linear; }
  /* the fades that actually apply: an automatic crossfade (c.xfi / c.xfo, set by Session.applyCrossfades while two
     clips overlap) overrides the user's fade on that side; the user's own fade (c.fi / c.fo) comes back when the
     overlap goes away */
  const fadeIn = (c) => (c.xfi > 0 ? { len: c.xfi, curve: c.xfiCurve } : { len: c.fi || 0, curve: c.fiCurve });
  const fadeOut = (c) => (c.xfo > 0 ? { len: c.xfo, curve: c.xfoCurve } : { len: c.fo || 0, curve: c.foCurve });
  /* gain (0..1) contributed by the fades at clip-relative time t */
  function fadeGainAt(c, t) {
    let g = 1; const fi = fadeIn(c), fo = fadeOut(c);
    if (fi.len > 0 && t < fi.len) g *= fadeShape(fi.curve)(Math.max(0, t / fi.len));
    if (fo.len > 0 && t > c.dur - fo.len) g *= fadeShape(fo.curve)(Math.max(0, (c.dur - t) / fo.len));
    return g;
  }
  /* schedule clip gain incl. fades with the chosen curves, starting at clip-relative time rel0 */
  function scheduleFades(param, c, rel0, when, base) {
    const val = (t) => base * fadeGainAt(c, t), fi = fadeIn(c).len, fo = fadeOut(c).len;
    param.value = val(rel0);
    let cursor = rel0;
    const curve = (from, to) => { const n = Math.max(2, Math.min(256, Math.round((to - from) * 200))), a = new Float32Array(n); for (let i = 0; i < n; i++) a[i] = val(from + ((to - from) * i) / (n - 1)); return a; };
    if (fi > rel0 + 0.001) { param.setValueCurveAtTime(curve(rel0, fi), when, fi - rel0); cursor = fi; }
    if (fo > 0) {
      const tf = Math.max(c.dur - fo, cursor);
      if (c.dur - tf > 0.002) param.setValueCurveAtTime(curve(tf, c.dur), when + (tf - rel0), c.dur - tf);
    }
  }
  /* clip stacking: silence the clip over the clip-relative ranges a clip in front of it covers (3 ms ramps inside
     each range, so the edges do not click) */
  const HIDE_RAMP = 0.003;
  function scheduleHidden(param, ranges, rel0, when) {
    const at = (r) => when + (r - rel0), inside = ranges.some(([a, b]) => rel0 >= a && rel0 < b);
    param.value = inside ? 0 : 1; param.setValueAtTime(param.value, when);
    for (const [a, b] of ranges) {
      if (b <= rel0) continue;
      const rr = Math.min(HIDE_RAMP, (b - a) / 2);
      if (a >= rel0) { param.setValueAtTime(1, at(a)); param.linearRampToValueAtTime(0, at(a + rr)); }
      param.setValueAtTime(0, at(Math.max(rel0, b - rr))); param.linearRampToValueAtTime(1, at(b));
    }
  }
  /* crossfade curves: asymmetric pairs the fade-in curve with its opposite on the fade-out */
  const OPPOSITE = { log: 'exp', exp: 'log', linear: 'linear', cosine: 'cosine' };
  const defaultSettings = () => ({ xfade: true, xfCurve: 'cosine', xfShape: 'symmetric', overlap: 'overlap', stack: true, tempo: AS.tempo.DEFAULT(), snapGrid: 'off', channels: 2 }); // channels: master 2 (stereo) or 6 (5.1); stack: the front clip hides the ones behind it
  /* a track's surround position (5.1 sessions): x −1 left … +1 right, y −1 rear … +1 front, spread 0…1 = how far
     apart its left / right channels sit (1: front L / R), lfe = LFE send in dB (−60 or below = none) */
  const surOf = (t) => ({ x: 0, y: 1, spread: 1, lfe: -60, ...(t.sur || {}) });
  /* stereo track output → 6 channels: each input channel panned with dsp.surroundGains (±30°·spread around the
     point), plus the LFE send (mono sum, low-passed at 120 Hz) */
  function surroundPanner(ctx, input, t, out) {
    const s = surOf(t), sp = ctx.createChannelSplitter(2), mg = ctx.createChannelMerger(6), nodes = [sp, mg];
    input.connect(sp);
    [-30 * s.spread, 30 * s.spread].forEach((off, k) => {
      const g6 = D.surroundGains(s.x, s.y, off);
      g6.forEach((v, c) => { if (c === 3 || v < 1e-6) return; const g = ctx.createGain(); g.gain.value = v; sp.connect(g, k); g.connect(mg, 0, c); nodes.push(g); });
    });
    if (s.lfe > -60) {
      const sum = ctx.createGain(); sum.channelCount = 1; sum.channelCountMode = 'explicit'; sum.channelInterpretation = 'speakers'; sum.gain.value = D.fromDb(s.lfe);
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 120; lp.Q.value = 0.707;
      input.connect(sum); sum.connect(lp); lp.connect(mg, 0, 3); nodes.push(sum, lp);
    }
    mg.connect(out); return nodes;
  }

  /* ---- clip envelopes: data / interpolation / scheduling are in envelope.js (AS.env) ---- */
  const envOf = (c) => ENV.of(c);
  /* copy of the editable per-clip properties so duplicated / split clips never share arrays */
  const cloneClipProps = (c) => ({ fx: jclone(c.fx || []), rackCfg: jclone(c.rackCfg || null), env: jclone(envOf(c)), ...(c.takes ? { takes: c.takes.slice(), comp: jclone(c.comp) } : {}) });
  /* comped clip: render its comp (take ranges, crossfaded seams) into the clip's playable source */
  function applyComp(c) {
    if (!c.takes || !c.takes.length) return;
    const sr = c.takes[0].src.sr, len = Math.min(...c.takes.map((tk) => tk.src.dur));
    c.comp = AS.rec.normComp(c.comp, len, c.takes.length);
    c.src = makeSource(c.src ? c.src.name : 'Comp', sr, AS.rec.flatten(c.takes.map((tk) => tk.src.ch), c.comp, sr, 0.01));
  }

  class Session {
    constructor() { this.tracks = []; this.master = { vol: 0, fx: [] }; this.sr = 44100; this.settings = defaultSettings(); this.undoStack = []; this.redoStack = []; this.sel = null; this.nextClip = 1; this.addTrack(); this.addTrack(); this.undoStack = []; this.dirty = false; this.filePath = ''; this.fileName = ''; }
    get opts() { return (this.settings = { ...defaultSettings(), ...(this.settings || {}) }); }

    /* ---- crossfades ----
       Two clips on one track overlap when b starts inside a and ends after a ends. The overlap becomes a crossfade:
       b fades in over it, a fades out over it (stored as xfi / xfo so the user's own fades stay untouched). */
    crossfades(t) {
      if (this.opts.overlap === 'overwrite') return []; // overwrite: the front clip covers, nothing is blended
      const cs = t.clips.slice().sort((x, y) => x.start - y.start || x.id - y.id), out = [];
      for (let i = 0; i < cs.length; i++) for (let j = i + 1; j < cs.length; j++) {
        const a = cs[i], b = cs[j], aEnd = a.start + a.dur, bEnd = b.start + b.dur;
        if (b.start >= aEnd - 1e-6) break; // sorted: no later clip can overlap a either… only for this j chain
        if (bEnd > aEnd + 1e-6 && b.start > a.start + 1e-6) out.push({ a, b, start: b.start, end: aEnd, len: aEnd - b.start });
      }
      return out;
    }
    applyCrossfades(t) {
      if (!t || !t.clips) return [];
      const o = this.opts; for (const c of t.clips) { c.xfi = 0; c.xfo = 0; }
      if (!o.xfade) return [];
      const xs = this.crossfades(t);
      for (const x of xs) {
        if (x.len > x.b.xfi) { x.b.xfi = Math.min(x.len, x.b.dur); x.b.xfiCurve = o.xfCurve; }
        if (x.len > x.a.xfo) { x.a.xfo = Math.min(x.len, x.a.dur); x.a.xfoCurve = o.xfShape === 'asymmetric' ? OPPOSITE[o.xfCurve] || o.xfCurve : o.xfCurve; }
      }
      return xs;
    }
    applyAllCrossfades() { for (const t of this.tracks) this.applyCrossfades(t); }
    /* change a crossfade's length by trimming a's end and b's start around the crossfade centre; the audio of both
       clips stays where it is on the timeline. Limited by the source material and a minimum clip length. */
    setCrossfadeLength(a, b, len) {
      const centre = (b.start + a.start + a.dur) / 2;
      let half = Math.max(0.001, len / 2);
      half = Math.min(half, AS.cstretch.srcDur(a) - a.off - (centre - a.start), b.off + (centre - b.start), (centre - a.start) - 0.01, (b.start + b.dur - centre) - 0.01);
      if (!(half > 0)) return false;
      a.dur = centre + half - a.start;
      const newStart = centre - half, delta = newStart - b.start;
      b.env = { volume: ENV.shift(envOf(b).volume, delta, b.dur - delta, ENV.KINDS.volume.dflt), pan: ENV.shift(envOf(b).pan, delta, b.dur - delta, ENV.KINDS.pan.dflt) };
      b.start = newStart; b.off += delta; b.dur -= delta;
      return true;
    }
    /* clip c has just been put on track t (dropped, moved, pasted, recorded…): apply the overlap policy, then crossfades
         overlap    keep both, crossfade the overlapping part
         overwrite  c goes in front of whatever is under it on this track and is what is heard there; the clips
                    behind keep their audio (it comes back when c moves away or is sent to the back)
         ripple     everything on the track at or after c's start moves right by c's length (a clip under the
                    insertion point is split first) */
    place(t, c) {
      const pol = this.opts.overlap, cs = c.start, ce = c.start + c.dur;
      if (pol === 'overwrite') { c.z = this.topZ() + 1; this.opts.stack = true; } // covers what is under it; the covered audio is kept (Send to Back / move it away)
      else if (pol === 'ripple') {
        for (const o of t.clips.slice()) if (o !== c && o.start < cs - 1e-6 && o.start + o.dur > cs + 1e-6) this.split(o.id, cs);
        for (const o of t.clips) if (o !== c && o.start >= cs - 1e-6) o.start += c.dur;
      }
      this.applyCrossfades(t);
    }
    /* destructive overwrite (punch-in recording): whatever was under c on this track is trimmed / split / removed */
    cutUnder(t, c) {
      const cs = c.start, ce = c.start + c.dur;
      for (const o of t.clips.slice()) {
        if (o === c) continue; const os = o.start, oe = o.start + o.dur;
        if (oe <= cs + 1e-6 || os >= ce - 1e-6) continue;
        if (os >= cs - 1e-6 && oe <= ce + 1e-6) t.clips.splice(t.clips.indexOf(o), 1); // fully covered
        else if (os < cs && oe > ce) { const id = this.split(o.id, ce); this.trimEnd(o, cs - os); void id; } // covers c: keep both sides
        else if (os < cs) this.trimEnd(o, cs - os); // overlaps c's start
        else this.trimStart(o, ce - os); // overlaps c's end
      }
      this.applyCrossfades(t);
    }
    /* ---- clip stacking (Bring Clip to Front / Send Clip to Back) ----
       c.z: higher = in front. Where clips on one track overlap, only the front one is heard — except across an
       automatic crossfade (Overlap policy), where the two are blended. Old sessions (no z) stack in array order
       and keep stacking off (opts.stack false: overlapping clips summed, as before) until stacking is used. */
    topZ() { let m = 0; for (const t of this.tracks) for (const c of t.clips) m = Math.max(m, c.z || 0); return m; }
    bottomZ() { let m = Infinity; for (const t of this.tracks) for (const c of t.clips) m = Math.min(m, c.z || 0); return m === Infinity ? 0 : m; }
    stackFront(ids) { const set = new Set(ids); let z = this.topZ(); for (const { t, c } of this.allClips().sort((a, b) => zcmp(a.c, b.c))) if (set.has(c.id)) { c.z = ++z; this.applyCrossfades(t); } this.opts.stack = true; }
    stackBack(ids) { const set = new Set(ids), ls = this.allClips().filter(({ c }) => set.has(c.id)).sort((a, b) => zcmp(a.c, b.c)); let z = this.bottomZ() - ls.length; for (const { t, c } of ls) { c.z = z++; this.applyCrossfades(t); } this.opts.stack = true; }
    /* clip-relative [a, b) ranges of c that a clip in front of it covers on track t (silent there) */
    hiddenRanges(t, c) {
      if (this.opts.stack === false) return [];
      const xf = new Set(this.opts.xfade ? this.crossfades(t).filter((x) => x.a === c || x.b === c).map((x) => (x.a === c ? x.b : x.a)) : []), out = [];
      for (const o of t.clips) {
        if (o === c || xf.has(o) || zcmp(o, c) < 0) continue;
        const a = Math.max(o.start, c.start) - c.start, b = Math.min(o.start + o.dur, c.start + c.dur) - c.start;
        if (b - a > 1e-6) out.push([a, b]);
      }
      out.sort((x, y) => x[0] - y[0]); const m = [];
      for (const r of out) { const l = m[m.length - 1]; if (l && r[0] <= l[1] + 1e-9) l[1] = Math.max(l[1], r[1]); else m.push(r.slice()); }
      return m;
    }
    /* ---- track order (drag a track header, Multitrack > Move Track…) ----
       Everything refers to tracks by id (routing, sends, sidechain keys, automation), so only the array order changes. */
    moveTracks(ids, to) {
      const set = new Set(ids), moving = this.tracks.filter((t) => set.has(t.id)); if (!moving.length) return false;
      const before = this.tracks.slice(0, Math.max(0, to)).filter((t) => !set.has(t.id)).length, rest = this.tracks.filter((t) => !set.has(t.id));
      const next = [...rest.slice(0, before), ...moving, ...rest.slice(before)];
      if (next.every((t, i) => t === this.tracks[i])) return false;
      this.tracks = next; return true;
    }
    /* dir: 'up' | 'down' | 'top' | 'bottom'; the moved tracks keep their order among themselves */
    shiftTracks(ids, dir) {
      const set = new Set(ids), idx = this.tracks.map((t, i) => (set.has(t.id) ? i : -1)).filter((i) => i >= 0); if (!idx.length) return false;
      if (dir === 'top') return this.moveTracks(ids, 0);
      if (dir === 'bottom') return this.moveTracks(ids, this.tracks.length);
      const tr = this.tracks.slice(), up = dir === 'up';
      if (up ? idx[0] === 0 : idx[idx.length - 1] === tr.length - 1) return false;
      for (const i of up ? idx : idx.slice().reverse()) { const j = up ? i - 1 : i + 1; [tr[i], tr[j]] = [tr[j], tr[i]]; }
      this.tracks = tr; return true;
    }
    trimEnd(c, newDur) { c.dur = Math.max(0.01, newDur); c.fo = Math.min(c.fo || 0, c.dur); c.fi = Math.min(c.fi || 0, Math.max(0, c.dur - c.fo)); }
    trimStart(c, delta) {
      delta = Math.min(delta, c.dur - 0.01); const e = envOf(c);
      c.env = { volume: ENV.shift(e.volume, delta, c.dur - delta, ENV.KINDS.volume.dflt), pan: ENV.shift(e.pan, delta, c.dur - delta, ENV.KINDS.pan.dflt) };
      c.start += delta; c.off += delta; c.dur -= delta; c.fi = Math.min(c.fi || 0, c.dur); c.fo = Math.min(c.fo || 0, Math.max(0, c.dur - c.fi));
    }
    snapshot() {
      return {
        tracks: this.tracks.map((t) => ({ ...t, fx: jclone(t.fx || []), auto: jclone(t.auto), rackCfg: jclone(t.rackCfg || null), sends: jclone(t.sends || []), ...(t.video ? { video: { ...t.video } } : {}), clips: t.clips.map((c) => ({ ...c, ...cloneClipProps(c) })) })),
        master: jclone(this.master), sel: this.sel, settings: jclone(this.opts),
      };
    }
    apply(s) { this.tracks = s.tracks; this.master = s.master; this.sel = s.sel; if (s.settings) this.settings = s.settings; }
    /* every undoable change starts with push(), so it also marks the session as changed since the last save (dirty) */
    push() { this.undoStack.push(this.snapshot()); if (this.undoStack.length > 60) this.undoStack.shift(); this.redoStack = []; this.dirty = true; this.rev = (this.rev || 0) + 1; }
    undo() { const s = this.undoStack.pop(); if (!s) return false; this.redoStack.push(this.snapshot()); this.apply(s); this.dirty = true; this.rev = (this.rev || 0) + 1; return true; }
    redo() { const s = this.redoStack.pop(); if (!s) return false; this.undoStack.push(this.snapshot()); this.apply(s); this.dirty = true; this.rev = (this.rev || 0) + 1; return true; }
    addTrack(name) {
      const n = this.tracks.length;
      const t = { id: Date.now() + '' + n + Math.random().toString(16).slice(2, 5), type: 'audio', name: name || 'Track ' + (n + 1), vol: AS.newTrackDefaults ? AS.newTrackDefaults().vol : 0, pan: 0, mute: false, solo: false, arm: false, color: COLORS[n % COLORS.length], clips: [], fx: [], auto: { vol: [], pan: [] }, out: 'master', sends: [] };
      this.tracks.push(t); return t;
    }
    /* a bus: no clips, fed by other tracks' outputs / sends; has rack, volume, pan, mute/solo and automation */
    addBus(name) {
      const nb = this.tracks.filter((t) => t.type === 'bus').length, t = this.addTrack(name || 'Bus ' + String.fromCharCode(65 + (nb % 26)));
      t.type = 'bus'; t.color = BUS_COLORS[nb % BUS_COLORS.length]; return t;
    }
    /* the audio track a clip may go to: the requested one, or the next audio track below it (a new one if needed) */
    audioTrackAt(i) {
      for (let k = Math.max(0, i); k < this.tracks.length; k++) if (this.tracks[k].type === 'audio' && !this.tracks[k].frozen) return this.tracks[k];
      return this.addTrack();
    }
    /* ---- several clips at once: groups, ripple delete, moving together ---- */
    allClips() { const out = []; for (const t of this.tracks) for (const c of t.clips) out.push({ t, c }); return out; }
    /* the ids plus every clip grouped with one of them */
    expandGroups(ids) {
      const set = new Set(ids), groups = new Set();
      for (const { c } of this.allClips()) if (set.has(c.id) && c.group) groups.add(c.group);
      for (const { c } of this.allClips()) if (c.group && groups.has(c.group)) set.add(c.id);
      return set;
    }
    group(ids) { const g = 'g' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5); for (const { c } of this.allClips()) if (ids.has ? ids.has(c.id) : ids.includes(c.id)) c.group = g; return g; }
    ungroup(ids) { for (const { c } of this.allClips()) if (this.expandGroups(ids).has(c.id)) delete c.group; }
    /* delete clips; ripple: on each track, later clips move left to close the gaps */
    deleteClips(ids, ripple) {
      const set = ids instanceof Set ? ids : new Set(ids);
      for (const t of this.tracks) {
        const gone = t.clips.filter((c) => set.has(c.id)); if (!gone.length) continue;
        t.clips = t.clips.filter((c) => !set.has(c.id));
        if (ripple) for (const o of t.clips) { let shift = 0; for (const g of gone) if (g.start + g.dur <= o.start + 1e-9) shift += g.dur; o.start = Math.max(0, o.start - shift); }
        this.applyCrossfades(t);
      }
      if (set.has(this.sel)) this.sel = null;
    }
    /* move clips (from their original starts / tracks in `items`) by dt seconds and dTrack lanes.
       Locked clips do not move in time; a lane move happens only if every clip lands on an audio track. */
    moveClips(items, dt, dTrack) {
      if (items.some((it) => it.c.locked)) dt = 0;
      dt = Math.max(dt, -Math.min(...items.map((it) => it.start0)));
      const okLane = items.every((it) => { const t = this.tracks[it.ti0 + dTrack]; return t && t.type === 'audio' && !t.frozen; });
      for (const it of items) {
        it.c.start = it.start0 + dt;
        const nt = this.tracks[it.ti0 + (okLane ? dTrack : 0)], cur = this.tracks.find((t) => t.clips.includes(it.c));
        if (nt && cur && nt !== cur) { cur.clips.splice(cur.clips.indexOf(it.c), 1); nt.clips.push(it.c); }
      }
      return okLane;
    }
    /* clip loop: the clip's current content [off, off+dur) becomes the repeating unit; the right edge can then be
       dragged out as far as wanted. Turning it off cuts the clip back to the material it has. */
    setLoop(c, on) {
      if (on) { c.loop = true; c.loopOff = c.off; c.loopLen = c.dur; }
      else { c.loop = false; c.dur = Math.min(c.dur, AS.cstretch.srcDur(c) - c.off); delete c.loopOff; delete c.loopLen; }
    }
    removeTrack(t) { const i = this.tracks.indexOf(t); if (i < 0) return; this.tracks.splice(i, 1); AS.routing.removeRefs(this, t.id); }
    findClip(id) { for (const t of this.tracks) { const c = t.clips.find((c) => c.id === id); if (c) return { t, c }; } return null; }
    addClip(track, src, start, extra) {
      const c = { id: this.nextClip++, src, start, off: 0, dur: src.dur, gain: 0, fi: 0, fo: 0, fiCurve: 'linear', foCurve: 'linear', name: src.name, fx: [], env: ENV.empty(), z: this.topZ() + 1, ...extra };
      track.clips.push(c); return c;
    }
    get duration() { let m = 0; for (const t of this.tracks) { for (const c of t.clips) m = Math.max(m, c.start + c.dur); if (t.video) m = Math.max(m, t.video.start + (t.video.dur || 0)); } return m; }
    split(clipId, time) {
      const f = this.findClip(clipId); if (!f) return false;
      const { t, c } = f, rel = time - c.start;
      if (rel <= 0.001 || rel >= c.dur - 0.001) return false;
      const right = { ...c, ...cloneClipProps(c), id: this.nextClip++, start: time, off: c.off + rel, dur: c.dur - rel, fi: 0 };
      const ev = envOf(c), rEnv = envOf(right);
      for (const k of ENV_KINDS) [ev[k], rEnv[k]] = ENV.split(ev[k], rel, ENV.KINDS[k].dflt);
      c.dur = rel; c.fo = 0; t.clips.push(right); return right.id;
    }
  }

  /* Build the playback graph. Shared by live playback and offline render (so the mixdown sounds like playback).
     Per track (Audition order):  clips / bus inputs → input sum → track rack → fader (volume) → pan → output
       output: Master, or the input of a bus      pre-fader sends tap after the rack, post-fader sends after the fader
       sidechain: an effect keyed by track K gets K's post-fader (pre-pan) signal through ex.key(K)
     Routing comes from AS.routing.plan(): loops are dropped, mute / solo decide what is heard. A track that is not
     heard but keys another track's effect is still built (key only) so ducking keeps working while soloing. */
  /* toT (optional): play only up to this timeline time (loop passes). input (optional, live only): the audio input,
     fed into every armed track with input monitoring on, through that track's rack / fader / pan / routing. */
  /* opts.tap = { id, point: 'pre' | 'out', dest }: also send that track's signal (after its effects / after its pan)
     to dest — freezing and bouncing render through the normal graph this way; the track is built even if muted. */
  function buildGraph(ctx, dest, session, fromT, t0, toT, input, opts) {
    const R = AS.rack, RT = AS.routing, live = typeof AudioContext !== 'undefined' && ctx instanceof AudioContext;
    const sources = [], plan = RT.plan(session), keys = {}, nodes = {}, tap = opts && opts.tap;
    if (tap) plan.audible.add(tap.id);
    const ex = { nodes: sources, t0, regs: [], meters: live ? (AS.engine.meters = {}) : null, owner: 'master' };
    ex.key = (id) => { if (!plan.keyOk(id, ex.owner)) return null; return keys[id] || (keys[id] = ctx.createGain()); };
    const envNodes = live ? (AS.engine.envNodes = {}) : null; // clip id -> envelope params, for edits while playing
    const master = session.master || (session.master = { vol: 0, fx: [] }), surround = (session.opts || session.settings || {}).channels === 6;
    const masterIn = ctx.createGain(); masterIn.gain.value = D.fromDb(master.vol);
    if (surround) { // 5.1 master: six discrete channels; the master rack (stereo effects) is bypassed
      masterIn.channelCount = 6; masterIn.channelCountMode = 'explicit'; masterIn.channelInterpretation = 'discrete'; masterIn.connect(dest);
    } else R.applyRack(ctx, master, masterIn, ex, 'master').connect(dest);
    sources.push(masterIn);
    const sched = (param, pts, value, conv) => { if (pts && pts.length) R.schedule(param, pts, fromT, t0, conv, value); else param.value = conv(value); };
    const lin = (v) => v;
    for (const t of session.tracks) {
      if (t.type === 'video') continue; // the video track carries no audio
      if (!plan.audible.has(t.id) && !plan.keySources.has(t.id)) continue;
      ex.owner = t.id;
      const tin = ctx.createGain(), au = t.auto || { vol: [], pan: [] }, frozen = t.frozen && t.frozen.src;
      const pre = frozen ? tin : R.applyRack(ctx, t, tin, ex, 't:' + t.id);   // track effects (already in a frozen render)
      const fader = ctx.createGain(); sched(fader.gain, au.vol, t.vol, D.fromDb); pre.connect(fader);
      const pan = ctx.createStereoPanner(); sched(pan.pan, au.pan, t.pan, lin); fader.connect(pan);
      if (ex.meters) R.meterTap(ctx, pan, ex.meters, 'm:' + t.id);            // post-fader level for the Mixer panel
      nodes[t.id] = { tin, pre, post: fader, out: pan };
      sources.push(tin, fader);
      if (t.type === 'bus') continue;
      if (frozen) { // frozen track: one buffer (clips + clip & track effects, rendered by Freeze) instead of its clips
        const fs = t.frozen.src, end = toT != null ? Math.min(toT, fs.dur) : fs.dur;
        if (end > fromT + 0.0005) { const bs = ctx.createBufferSource(); bs.buffer = srcBuffer(fs); bs.connect(tin); bs.start(t0, fromT, end - fromT); sources.push(bs); }
        continue;
      }
      if (input && live && t.arm && t.monitor) { // input monitoring (stop() also has to cut the input -> monitor edge)
        const mg = ctx.createGain(); input.connect(mg); mg.connect(tin); sources.push(mg, { disconnect: () => { try { input.disconnect(mg); } catch (e) { /* */ } } });
      }
      for (const c of t.clips) {
        if (c.start + c.dur <= fromT || (toT != null && c.start >= toT)) continue;
        const rel0 = Math.max(0, fromT - c.start), when = t0 + Math.max(0, c.start - fromT);
        const dur = Math.min(c.dur - rel0, toT != null ? toT - Math.max(fromT, c.start) : Infinity);
        if (dur <= 0.0005) continue;
        const ps = AS.cstretch.play(c); if (!ps) continue; // time-stretched audio still rendering (the app waits for it)
        const bs = ctx.createBufferSource(); bs.buffer = srcBuffer(ps);
        const g = ctx.createGain(); scheduleFades(g.gain, c, rel0, when, D.fromDb(c.gain));
        bs.connect(g);
        const hid = session.hiddenRanges ? session.hiddenRanges(t, c) : [];
        let gin = g;
        if (hid.length) { gin = ctx.createGain(); g.connect(gin); scheduleHidden(gin.gain, hid, rel0, when); sources.push(gin); } // covered by a clip in front
        const node = ENV.build(ctx, c, gin, rel0, when, envNodes); // clip volume + pan envelopes
        R.applyRack(ctx, c, node, ex, 'c:' + c.id).connect(tin);
        if (c.loop && c.loopLen > 0) { // looped clip: the unit [loopOff, loopOff + loopLen) repeats seamlessly
          bs.loop = true; bs.loopStart = c.loopOff; bs.loopEnd = c.loopOff + c.loopLen;
          bs.start(when, c.loopOff + ((((c.off - c.loopOff + rel0) % c.loopLen) + c.loopLen) % c.loopLen), dur);
        } else bs.start(when, c.off + rel0, dur);
        sources.push(bs);
      }
    }
    /* wire outputs and sends now that every track's nodes exist */
    for (const t of session.tracks) {
      const n = nodes[t.id]; if (!n || !plan.audible.has(t.id)) continue; // key-only tracks feed nothing
      const out = plan.outOf(t);
      if (out === 'master') { if (surround) sources.push(...surroundPanner(ctx, n.out, t, masterIn)); else n.out.connect(masterIn); }
      else if (nodes[out] && plan.audible.has(out)) n.out.connect(nodes[out].tin);
      for (const x of t.sends) {
        if (x.mute || !plan.sendOk(t, x) || !nodes[x.to] || !plan.audible.has(x.to)) continue;
        const g = ctx.createGain(), sp = ctx.createStereoPanner(), au = x.auto || {};
        sched(g.gain, au.db, x.db, D.fromDb); sched(sp.pan, au.pan, x.pan, lin);
        (x.pre ? n.pre : n.post).connect(g); g.connect(sp); sp.connect(nodes[x.to].tin);
        sources.push(g);
      }
    }
    /* sidechain keys: post-fader (pre-pan) signal of the key track */
    for (const [id, k] of Object.entries(keys)) if (nodes[id]) nodes[id].post.connect(k);
    if (tap && nodes[tap.id]) nodes[tap.id][tap.point === 'pre' ? 'pre' : 'out'].connect(tap.dest);
    R.applyFxAuto(ex, fromT, t0);
    if (live) AS.engine.regs = ex.regs; // lets the effect windows change parameters while playing
    return sources;
  }

  /* offline render of [from, to) (+ effect tails). tap: { id, point: 'pre' | 'out' } renders only that track's
     signal (Freeze = after its effects, Bounce Track = after its pan) — the rest of the graph is built as usual. */
  async function renderRange(session, sr, from, to, tap, tail) {
    const R = AS.rack, anyTail = session.tracks.some((t) => R.hasTail(t.fx) || t.clips.some((c) => R.hasTail(c.fx))) || R.hasTail((session.master || {}).fx);
    const len = Math.max(1, Math.ceil((to - from + (tail != null ? tail : anyTail ? 3 : 0.05)) * sr));
    await AS.cstretch.ensureAll(session); // time-stretched clips must be rendered first
    const nch = !tap && (session.opts || session.settings || {}).channels === 6 ? 6 : 2; // a 5.1 session mixes down to 6 channels
    const oc = new OfflineAudioContext(nch, len, sr);
    await R.loadWorklets(oc);
    if (tap) buildGraph(oc, oc.createGain(), session, from, 0, to, null, { tap: { ...tap, dest: oc.destination } });
    else { if (nch === 6) { oc.destination.channelCount = 6; oc.destination.channelInterpretation = 'discrete'; } buildGraph(oc, oc.destination, session, from, 0, to); }
    const out = await oc.startRendering();
    return { sr, ch: Array.from({ length: nch }, (_, c) => out.getChannelData(c).slice()) };
  }
  async function renderMix(session, sr) {
    const total = session.duration;
    if (total <= 0) throw new Error('The session is empty.');
    return renderRange(session, sr, 0, total);
  }

  /* ---------------- View ---------------- */
  class MultiView {
    constructor(el, app) {
      this.app = app; this.el = el; this.s = app.session; this.t0 = 0; this.pps = 60; this.drag = null; this.snap = true; this.dpr = window.devicePixelRatio || 1;
      this.autoMode = ''; this.envMode = 'both'; // clip envelopes shown: '' | 'both' | 'volume' | 'pan'
      this.envHover = null; this.envActive = null; // {id: clip id, kind, i: keyframe index or -1} — highlighted envelope
      this.selIds = new Set(); // selected clips (Ctrl+click, Ctrl+drag marquee, groups); session.sel stays the "primary" clip
      el.innerHTML = '<div class="mt-top"><div class="mt-corner"><button class="sm" id="mtAdd">+ Track</button><button class="sm" id="mtAddBus" title="Add a bus track (route tracks to it with Output or Sends)">+ Bus</button><button class="sm" id="mtMaster" title="Master bus effects">Master</button></div><div class="mt-ruler"><canvas></canvas></div></div><div class="mt-body"><div class="mt-heads"></div><div class="mt-canvaswrap"><canvas></canvas></div></div>';
      // multitrack-only toolbar controls (envelopes / automation display)
      const tools = document.getElementById('mtTools');
      if (tools) tools.innerHTML = '<label class="tl">Clip envelopes</label><select id="mtEnv" class="sm" title="Clip volume (yellow) / pan (blue) envelopes — double-click a line to add a keyframe, drag a keyframe to move it, right-click a keyframe to delete it. Where the lines overlap, the yellow Volume line is picked; hold Alt to pick the blue Pan line."><option value="">Off</option><option value="both" selected>Volume + Pan</option><option value="volume">Volume</option><option value="pan">Pan</option></select><label class="tl">Track automation</label><select id="mtAuto" class="sm" title="Show / edit track automation envelopes"><option value="">Off</option><option value="vol">Volume</option><option value="pan">Pan</option></select>';
      this.rulerC = el.querySelector('.mt-ruler canvas'); this.mainC = el.querySelector('.mt-canvaswrap canvas'); this.heads = el.querySelector('.mt-heads');
      this.body = el.querySelector('.mt-body'); this.wrap = el.querySelector('.mt-canvaswrap');
      // static layer (everything but the playhead), re-rendered only when the view changes
      this.baseM = document.createElement('canvas'); this.baseR = document.createElement('canvas'); this.baseKey = null;
      el.querySelector('#mtAdd').onclick = () => { this.s.push(); this.s.addTrack(); this.rebuildHeads(); this.resize(); };
      el.querySelector('#mtAddBus').onclick = () => { this.s.push(); const b = this.s.addBus(); this.app.selTrack = b.id; this.rebuildHeads(); this.resize(); AS.panels && AS.panels.refreshAll(); };
      el.querySelector('#mtMaster').onclick = () => app.openRack(null);
      document.getElementById('mtAuto').onchange = (e) => { this.autoMode = e.target.value; if (this.autoMode) this.setEnvMode(''); this.draw(); };
      document.getElementById('mtEnv').onchange = (e) => { this.setEnvMode(e.target.value); if (this.envMode) { this.autoMode = ''; document.getElementById('mtAuto').value = ''; } this.draw(); };
      this.mainC.addEventListener('contextmenu', (e) => this.onContext(e));
      this.mainC.addEventListener('mousedown', (e) => this.onDown(e));
      this.mainC.addEventListener('dblclick', (e) => this.onDbl(e));
      this.mainC.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });
      this.rulerC.addEventListener('mousedown', (e) => { this.drag = { type: 'ruler' }; this.seekFromEvent(e); });
      window.addEventListener('mousemove', (e) => this.onMove(e));
      window.addEventListener('mouseup', () => this.onUp());
      window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && this.compId) { this.compId = null; this.draw(); } });
      new ResizeObserver(() => this.resize()).observe(this.wrap);
      this.rebuildHeads();
    }
    setEnvMode(m) { this.envMode = m; const s = document.getElementById('mtEnv'); if (s) s.value = m; }
    /* ---- clip selection (several clips; groups select together) ---- */
    isSel(c) { return this.selIds.has(c.id) || this.s.sel === c.id; }
    selectedIds() { const ids = new Set(this.selIds); if (this.s.sel != null && this.s.findClip(this.s.sel)) ids.add(this.s.sel); for (const id of [...ids]) if (!this.s.findClip(id)) ids.delete(id); return this.s.expandGroups(ids); }
    selectClips(ids) { this.selIds = new Set(ids); this.s.sel = this.selIds.size ? [...this.selIds][0] : null; this.draw(); }
    /* the multitrack time selection (punch-in range, loop range, Ctrl+A): drawn as an overlay, not part of undo */
    setRange(a, b, quiet) {
      this.range = a == null || !(b - a > 0.001) ? null : { a: Math.max(0, a), b };
      if (!quiet) this.frame();
      if (this.app.rangeChanged) this.app.rangeChanged();
    }
    resize() {
      this.W = this.wrap.clientWidth; this.dpr = window.devicePixelRatio || 1;
      const H = Math.max(this.body.clientHeight, this.s.tracks.length * TH + 40); this.H = H;
      this.mainC.width = this.W * this.dpr; this.mainC.height = H * this.dpr; this.mainC.style.width = this.W + 'px'; this.mainC.style.height = H + 'px';
      this.rulerC.width = this.W * this.dpr; this.rulerC.height = RULER_H * this.dpr; this.rulerC.style.width = this.W + 'px'; this.rulerC.style.height = RULER_H + 'px';
      this.baseM.width = this.mainC.width; this.baseM.height = this.mainC.height; this.baseR.width = this.rulerC.width; this.baseR.height = this.rulerC.height;
      this.draw();
    }
    rebuildHeads() {
      this.heads.innerHTML = '';
      this.s.tracks.forEach((t) => {
        AS.routing.normTrack(t);
        const bus = t.type === 'bus', esc = AS.ui.esc;
        if (t.type === 'video') { // the video row: name, length, remove
          const hv = document.createElement('div'); hv.className = 'mt-head video'; hv.style.height = TH + 'px'; hv.style.borderLeftColor = t.color;
          hv.innerHTML = `<div class="row"><span class="busTag" style="background:#5a6472">VIDEO</span><span class="vname" title="${esc(t.video.path || t.name)}">${esc(t.name)}</span><button class="sm danger" data-a="del" title="Remove the video track (the extracted audio clips stay)">×</button></div><div class="row note">${t.video.dur ? AS.fmtTime(t.video.dur) : ''} · drag the lane to move it in time</div><div class="row note">File &gt; Export Video with Mixdown…</div>`;
          hv.querySelector('[data-a=del]').onclick = () => { this.s.push(); this.s.tracks.splice(this.s.tracks.indexOf(t), 1); this.rebuildHeads(); this.resize(); this.app.videoChanged && this.app.videoChanged(); };
          if (this.trackSel().includes(t.id)) hv.classList.add('sel');
          this.headEvents(hv, t); this.heads.appendChild(hv); return;
        }
        const h = document.createElement('div'); h.className = 'mt-head' + (bus ? ' bus' : '') + (this.trackSel().includes(t.id) ? ' sel' : ''); h.style.height = TH + 'px'; h.style.borderLeftColor = t.color;
        const outs = AS.routing.outputOptions(this.s, t).map(([v, n]) => `<option value="${esc(v)}" ${v === t.out ? 'selected' : ''}>→ ${esc(n)}</option>`).join('');
        h.innerHTML = `<div class="row"><span class="tcolor" title="Track color" style="background:${t.color}"></span>${t.frozen ? '<span class="busTag" style="background:#4fc1d8" title="Frozen: plays a render of the clips + track effects (Multitrack > Unfreeze Track to edit)">❄</span>' : ''}${bus ? '<span class="busTag" title="Bus track: no clips — other tracks reach it through their Output or Sends">BUS</span>' : ''}<input class="tname" value="${t.name.replace(/"/g, '&quot;')}"><button class="sm danger" data-a="del" title="Delete track">×</button></div>
          <div class="row btns"><button class="sm tb ${t.mute ? 'on m' : ''}" data-a="mute" title="Mute">M</button><button class="sm tb ${t.solo ? 'on s' : ''}" data-a="solo" title="Solo">S</button>${bus ? '' : `<button class="sm tb ${t.arm ? 'on r' : ''} ${t.arm && this.app.recording && this.app.recording.clipped ? 'clipwarn' : ''}" data-a="arm" title="Record arm${t.arm && this.app.recording && this.app.recording.clipped ? ' — the input clipped!' : ''}">R</button><button class="sm tb ${t.monitor ? 'on i' : ''}" data-a="mon" title="Input monitoring: hear the input through this track while it is armed (use headphones)">I</button>`}<button class="sm tb fxb ${AS.rack.activeFx(t.fx).length && AS.rack.cfgOf(t).power ? 'on' : ''}" data-a="fx" title="Open the Effects Rack for this track">FX</button><select class="sm tout" title="Output: Master or a bus (buses that would create a feedback loop are not offered)">${outs}</select></div>
          <div class="row"><span class="lbl">Vol</span><input type="range" min="-60" max="12" step="0.5" value="${t.vol}" data-a="vol"><span class="val">${t.vol.toFixed(1)}</span></div>
          <div class="row"><span class="lbl">Pan</span><input type="range" min="-1" max="1" step="0.01" value="${t.pan}" data-a="pan"><span class="val">${t.pan === 0 ? 'C' : (t.pan < 0 ? 'L' : 'R') + Math.round(Math.abs(t.pan) * 100)}</span></div>`;
        this.headEvents(h, t);
        h.querySelector('.tname').addEventListener('change', (e) => { this.s.push(); t.name = e.target.value; this.rebuildHeads(); AS.panels && AS.panels.refreshAll(); });
        h.querySelector('.tcolor').addEventListener('click', (e) => this.trackColorMenu(e, t));
        h.querySelector('.tout').addEventListener('change', (e) => { this.s.push(); t.out = e.target.value; this.rebuildHeads(); this.app.multiChanged(true); AS.panels && AS.panels.refreshAll(); });
        h.querySelectorAll('[data-a]').forEach((b) => {
          const a = b.dataset.a;
          if (b.tagName === 'BUTTON') b.onclick = () => {
            if (a === 'fx') { this.app.selTrack = t.id; this.app.rackTarget = null; this.app.openRack(t); return; }
            this.s.push();
            if (a === 'del') { this.s.removeTrack(t); } else { const k = { mute: 'mute', solo: 'solo', arm: 'arm', mon: 'monitor' }[a]; t[k] = !t[k]; }
            this.rebuildHeads(); this.resize(); this.app.multiChanged();
            if ((a === 'arm' || a === 'mon' || a === 'del') && this.app.updateMonitoring) this.app.updateMonitoring();
          };
          else {
            b.addEventListener('pointerdown', () => this.s.push());
            b.addEventListener('input', () => { t[a] = +b.value; b.nextElementSibling.textContent = a === 'vol' ? t.vol.toFixed(1) : t.pan === 0 ? 'C' : (t.pan < 0 ? 'L' : 'R') + Math.round(Math.abs(t.pan) * 100); this.app.multiChanged(); });
            b.addEventListener('dblclick', () => { t[a] = 0; b.value = 0; b.dispatchEvent(new Event('input')); });
          }
        });
        this.heads.appendChild(h);
      });
      this.refreshAutoOptions();
    }
    /* ---- track selection (click / Ctrl+click / Shift+click a header) and reordering (drag a header) ---- */
    /* the selected track ids in track order (app.selTracks; else the one app.selTrack) */
    trackSel() {
      const m = this.app.selTracks, set = m && m.size && m.has(this.app.selTrack) ? m : new Set(this.app.selTrack != null ? [this.app.selTrack] : []); // (code that sets app.selTrack alone selects just that track)
      return this.s.tracks.filter((t) => set.has(t.id)).map((t) => t.id);
    }
    selectTracks(ids, primary) {
      this.app.selTracks = new Set(ids); this.app.selTrack = primary !== undefined ? primary : ids.length ? ids[ids.length - 1] : null; this.app.rackTarget = null;
      const sel = new Set(this.trackSel()); [...this.heads.children].forEach((h, i) => { const t = this.s.tracks[i]; h.classList.toggle('sel', !!t && sel.has(t.id)); });
    }
    headEvents(h, t) {
      h.addEventListener('mousedown', (e) => this.headDown(e, t));
      h.addEventListener('contextmenu', (e) => { if (e.target.closest('input,select,textarea')) return; e.preventDefault(); if (!this.trackSel().includes(t.id)) this.selectTracks([t.id]); this.trackMenu(e); });
    }
    headDown(e, t) {
      if (e.button !== 0) return;
      const ctl = e.target.closest('input,select,textarea,button,.tcolor'), cur = this.trackSel();
      if (e.ctrlKey || e.metaKey) { const s = new Set(cur); if (s.has(t.id) && s.size > 1) s.delete(t.id); else s.add(t.id); this.selectTracks([...s], s.has(t.id) ? t.id : [...s][0]); return; }
      if (e.shiftKey && this.app.selTrack != null) {
        const ids = this.s.tracks.map((x) => x.id), a = ids.indexOf(this.app.selTrack), b = ids.indexOf(t.id);
        if (a >= 0 && b >= 0) { this.selectTracks(ids.slice(Math.min(a, b), Math.max(a, b) + 1), this.app.selTrack); return; }
      }
      const inSel = cur.includes(t.id) && cur.length > 1;
      if (!inSel) this.selectTracks([t.id]); else this.app.selTrack = t.id;
      if (ctl) return; // the name box, buttons, sliders… work as usual
      const d = { ids: inSel ? cur : [t.id], y0: e.clientY, lastY: e.clientY, moved: false, to: -1, line: null, timer: 0 };
      const show = () => {
        d.to = D.clamp(Math.round((d.lastY - this.body.getBoundingClientRect().top + this.body.scrollTop) / TH), 0, this.s.tracks.length);
        if (!d.line) { d.line = document.createElement('div'); d.line.className = 'mt-dropline'; this.body.appendChild(d.line); document.body.classList.add('mt-dragging'); }
        d.line.style.top = (d.to * TH - 1) + 'px';
      };
      const move = (ev) => {
        d.lastY = ev.clientY; if (!d.moved && Math.abs(ev.clientY - d.y0) < 4) return;
        d.moved = true; show();
        const r = this.body.getBoundingClientRect(), edge = ev.clientY < r.top + 24 ? -1 : ev.clientY > r.bottom - 24 ? 1 : 0; // auto-scroll at the edges
        clearInterval(d.timer); if (edge) d.timer = setInterval(() => { this.body.scrollTop += edge * 12; show(); }, 30);
      };
      const up = () => {
        window.removeEventListener('mousemove', move, true); window.removeEventListener('mouseup', up, true); clearInterval(d.timer);
        if (d.line) d.line.remove(); document.body.classList.remove('mt-dragging');
        if (!d.moved) { if (inSel) this.selectTracks([t.id]); return; } // a plain click on a multi-selection selects just that track
        this.reorderTracks(d.ids, d.to);
      };
      window.addEventListener('mousemove', move, true); window.addEventListener('mouseup', up, true);
    }
    /* each move is one undo step; the headers, lanes and the Mixer follow the new order */
    reorderTracks(ids, to) { return this.trackMove(() => this.s.moveTracks(ids, to)); }
    shiftSel(dir) { const ids = this.trackSel(); return ids.length ? this.trackMove(() => this.s.shiftTracks(ids, dir)) : null; }
    trackMove(fn) {
      const snap = this.s.snapshot(); if (!fn()) return false;
      this.s.undoStack.push(snap); if (this.s.undoStack.length > 60) this.s.undoStack.shift(); this.s.redoStack = [];
      this.rebuildHeads(); this.resize(); this.app.multiChanged(true); if (AS.panels) AS.panels.refreshAll(); return true;
    }
    /* right-click a track header */
    trackMenu(e) {
      document.querySelectorAll('.curve-pop').forEach((n) => n.remove());
      const n = this.trackSel().length, esc = AS.ui.esc, A = (id) => () => AS.actions[id](), many = n > 1 ? n + ' Tracks' : 'Track';
      const items = [{ label: `Move ${many} Up`, fn: A('mt.trackup') }, { label: `Move ${many} Down`, fn: A('mt.trackdown') }, { label: `Move ${many} to Top`, fn: A('mt.tracktop') }, { label: `Move ${many} to Bottom`, fn: A('mt.trackbottom') }];
      const pop = document.createElement('div'); pop.className = 'menu curve-pop mt-trackmenu';
      pop.innerHTML = items.map((it, i) => `<div class="mi" data-i="${i}"><span class="mc"></span><span class="ml">${esc(it.label)}</span></div>`).join('');
      pop.style.left = Math.min(e.clientX, innerWidth - 260) + 'px'; document.body.appendChild(pop); pop.style.top = Math.max(4, Math.min(e.clientY, innerHeight - pop.offsetHeight - 8)) + 'px';
      pop.addEventListener('click', (ev) => { const it = ev.target.closest('[data-i]'); if (!it) return; pop.remove(); items[+it.dataset.i].fn(); });
      const away = (ev) => { if (!pop.contains(ev.target)) { pop.remove(); document.removeEventListener('mousedown', away, true); } };
      setTimeout(() => document.addEventListener('mousedown', away, true), 0);
    }
    /* ---- geometry ---- */
    t2x(t) { return (t - this.t0) * this.pps; }
    x2t(x) { return this.t0 + x / this.pps; }
    trackAt(y) { return Math.floor(y / TH); }
    zoomBy(f, ax) {
      ax = ax === undefined ? this.W / 2 : ax;
      const at = this.x2t(ax); this.pps = D.clamp(this.pps * f, 0.5, 20000); this.t0 = Math.max(0, at - ax / this.pps); this.draw();
    }
    zoomAll() { const d = Math.max(this.s.duration, 5); this.pps = (this.W - 20) / d; this.t0 = 0; this.draw(); }
    onWheel(e) {
      e.preventDefault();
      if (e.ctrlKey) this.zoomBy(e.deltaY > 0 ? 0.8 : 1.25, e.offsetX);
      else if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) { this.t0 = Math.max(0, this.t0 + (e.deltaY || e.deltaX) / this.pps); this.draw(); }
      else this.body.scrollTop += e.deltaY;
    }
    /* click / drag in the ruler: move the playhead; while stopped, scrub (grains of the session mix) */
    seekFromEvent(e) {
      const r = this.rulerC.getBoundingClientRect(), t = Math.max(0, this.x2t(e.clientX - r.left)), playing = AS.engine.playing;
      this.app.seekMulti(t);
      if (!playing && this.app.scrub) this.app.scrub(t, 'multi');
    }
    /* geometry of a clip on screen */
    box(c, ti) { const x0 = this.t2x(c.start), x1 = this.t2x(c.start + c.dur), top = ti * TH + 3, h = TH - 6; return { x0, x1, top, h, ey0: top + TITLE_H + 3, ey1: top + h - 4 }; }
    /* manual fade handles; a side that currently has an automatic crossfade has none (the X is used instead) */
    fadeHandles(c, ti) { const b = this.box(c, ti); return { l: c.xfi > 0 ? null : { x: b.x0 + c.fi * this.pps, y: b.top + TITLE_H + 2 }, r: c.xfo > 0 ? null : { x: b.x1 - c.fo * this.pps, y: b.top + TITLE_H + 2 } }; }
    /* the crossfade X under (x, y): its centre handle, or anywhere inside the X when it is narrow */
    xfadeHit(x, y) {
      const ti = this.trackAt(y), t = this.s.tracks[ti]; if (!t || !this.s.opts.xfade) return null;
      for (const xf of this.s.crossfades(t)) {
        const x0 = this.t2x(xf.start), x1 = this.t2x(xf.end), top = ti * TH + 3 + TITLE_H, bot = ti * TH + TH - 3, cx = (x0 + x1) / 2, cy = (top + bot) / 2;
        if ((Math.abs(x - cx) < 8 && Math.abs(y - cy) < 8) || (x1 - x0 < 16 && x >= x0 - 4 && x <= x1 + 4 && y >= top && y <= bot)) return { ...xf, t, ti };
      }
      return null;
    }
    hit(x, y) {
      const ti = this.trackAt(y), t = this.s.tracks[ti]; if (!t) return null;
      const cs = t.clips.slice().sort(zcmp); // front clip first
      for (let i = cs.length - 1; i >= 0; i--) {
        const c = cs[i], b = this.box(c, ti);
        if (x >= b.x0 - 6 && x <= b.x1 + 6 && y >= b.top && y <= b.top + b.h) {
          const fh = this.fadeHandles(c, ti), wide = b.x1 - b.x0 > 28;
          let handle = null;
          if (wide && Math.abs(y - b.top - TITLE_H - 2) < 9) { if (fh.l && Math.abs(x - fh.l.x) < 9) handle = 'fi'; else if (fh.r && Math.abs(x - fh.r.x) < 9) handle = 'fo'; }
          if (handle || (x >= b.x0 && x <= b.x1)) return { t, c, ti, handle, edge: !handle && x - b.x0 < 7 ? 'l' : !handle && b.x1 - x < 7 ? 'r' : null, title: y < b.top + TITLE_H + 1, box: b };
        }
      }
      return { t, c: null, ti };
    }
    local(e) { const r = this.mainC.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; }
    /* where a file dropped on the multitrack lands: the track under the pointer (a new one below the last track),
       at the pointer time (snapped) — or at the playhead when dropped on the track headers / ruler */
    dropAt(e) {
      const [x, y] = this.local(e), sel = this.s.tracks.findIndex((t) => t.id === this.app.selTrack);
      const ti = y >= 0 ? Math.min(this.trackAt(y), this.s.tracks.length) : Math.max(0, sel);
      const t = x >= 0 && x <= this.W && y >= 0 ? Math.max(0, this.snapT(this.x2t(x))) : this.app.multiCursor;
      return { ti, t };
    }
    /* ---- clip envelopes ---- */
    /* which envelopes are visible / editable right now */
    envKinds() { return this.autoMode || !this.envMode ? [] : this.envMode === 'both' ? ENV_KINDS : [this.envMode]; }
    /* value <-> y inside the clip body. Volume 0 … 2 bottom → top (1.0 = 0 dB in the middle);
       pan -1 … +1 bottom → top (left at the bottom, right at the top, centre in the middle — same as track pan automation) */
    envY(box, kind, v) { const k = ENV.KINDS[kind]; return box.ey1 - ((v - k.min) / (k.max - k.min)) * (box.ey1 - box.ey0); }
    envV(box, kind, y) { const k = ENV.KINDS[kind], u = (box.ey1 - y) / (box.ey1 - box.ey0); return ENV.snapValue(kind, k.min + u * (k.max - k.min)); }
    /* what envelope element is under (x, y) on clip c: {kind, i} (i = keyframe index, or -1 = on the line) or null.
       keyframes win over lines; the highlighted envelope wins when both lines overlap */
    /* hit-test / stacking order of the visible envelopes, top-most first. Both lines sit in the middle of the clip by
       default, so they overlap: Volume (yellow) is on top and wins, unless the user picked the Pan line on this clip */
    envOrder(c) {
      const kinds = this.envKinds(), act = this.envActive && this.envActive.id === c.id ? this.envActive.kind : null;
      return act && kinds.includes(act) ? [act, ...kinds.filter((k) => k !== act)] : kinds.slice(); // a copy: callers may reverse it
    }
    envHit(c, ti, x, y, alt) {
      const order = this.envOrder(c); if (!order.length) return null;
      if (alt) order.reverse(); // Alt: reach the line underneath (e.g. Pan while it still overlaps Volume)
      const b = this.box(c, ti), e = envOf(c);
      for (const k of order) { const pts = e[k]; for (let i = 0; i < pts.length; i++) if (Math.hypot(this.t2x(c.start + pts[i].t) - x, this.envY(b, k, pts[i].v) - y) < 7) return { kind: k, i }; }
      if (x < b.x0 || x > b.x1) return null;
      const rel = this.x2t(x) - c.start;
      for (const k of order) if (Math.abs(this.envY(b, k, ENV.valueAt(e[k], rel, ENV.KINDS[k].dflt)) - y) < 5) return { kind: k, i: -1 };
      return null;
    }
    /* push an envelope edit to the running playback; restart only if the graph needs a new node */
    envCommit(c) { if (ENV.liveUpdate(c) === 'rebuild') this.app.multiChanged(true); else this.app.multiChanged(false); }
    /* ---- track automation envelopes ---- */
    /* what the current "Auto:" mode edits for track t (null = not applicable to this track) */
    modeInfo(t) {
      const m = this.autoMode;
      if (!t) return null;
      if (m === 'vol') return { range: [-60, 12], pts: t.auto.vol, dflt: t.vol, label: 'Track volume automation' };
      if (m === 'pan') return { range: [-1, 1], pts: t.auto.pan, dflt: t.pan, label: 'Track pan automation (top = right, bottom = left)' };
      if (m.startsWith('send:')) { // send level (dB) / pan automation
        const [, tid, idx, what] = m.split(':'); if (t.id !== tid) return null;
        const x = (t.sends || [])[+idx]; if (!x) return null; x.auto = x.auto || {}; x.auto[what] = x.auto[what] || [];
        const to = this.s.tracks.find((b) => b.id === x.to);
        return what === 'db' ? { range: [-60, 12], pts: x.auto.db, dflt: x.db, label: `Send ${+idx + 1} → ${to ? to.name : '?'} — level (dB)` } : { range: [-1, 1], pts: x.auto.pan, dflt: x.pan, label: `Send ${+idx + 1} → ${to ? to.name : '?'} — pan (top = right)` };
      }
      if (m.startsWith('fx:')) {
        const [, tid, idx, pid] = m.split(':'); if (t.id !== tid) return null;
        const f = t.fx[+idx]; if (!f) return null;
        const def = AS.rack.RACK[f.type].params.find((p) => p.id === pid); if (!def) return null;
        f.auto = f.auto || {}; f.auto[pid] = f.auto[pid] || [];
        return { range: [def.min, def.max], pts: f.auto[pid], dflt: f.p[pid] !== undefined ? f.p[pid] : def.value, label: AS.rack.RACK[f.type].name + ' — ' + def.label + (def.unit ? ' (' + def.unit + ')' : '') };
      }
      return null;
    }
    autoY(ti, v) { const [lo, hi] = this.modeInfo(this.s.tracks[ti]).range; return ti * TH + 8 + (1 - (v - lo) / (hi - lo)) * (TH - 16); }
    autoV(ti, y) { const [lo, hi] = this.modeInfo(this.s.tracks[ti]).range; const u = 1 - (y - ti * TH - 8) / (TH - 16); return Math.min(hi, Math.max(lo, lo + u * (hi - lo))); }
    autoHit(x, y) {
      const ti = this.trackAt(y), t = this.s.tracks[ti], mi = this.modeInfo(t); if (!mi) return null;
      const pts = mi.pts;
      for (let i = 0; i < pts.length; i++) if (Math.hypot(this.t2x(pts[i].t) - x, this.autoY(ti, pts[i].v) - y) < 8) return { t, ti, pts, i };
      return { t, ti, pts, i: -1 };
    }
    /* fill the "Auto" dropdown with volume, pan and every automatable rack parameter of each track */
    refreshAutoOptions() {
      const sel = document.getElementById('mtAuto'); if (!sel) return;
      let html = '<option value="">Off</option><option value="vol">Volume</option><option value="pan">Pan</option>';
      this.s.tracks.forEach((t) => (t.fx || []).forEach((f, i) => { const def = f && AS.rack.RACK[f.type]; if (def) for (const p of def.params) if (p.auto) html += `<option value="fx:${t.id}:${i}:${p.id}">${t.name}: ${def.name} ${p.label}</option>`; }));
      this.s.tracks.forEach((t) => (t.sends || []).forEach((x, i) => { const to = this.s.tracks.find((b) => b.id === x.to); if (to) for (const [w, l] of [['db', 'level'], ['pan', 'pan']]) html += `<option value="send:${t.id}:${i}:${w}">${t.name}: Send ${i + 1} → ${to.name} ${l}</option>`; }));
      sel.innerHTML = html;
      if ([...sel.options].some((o) => o.value === this.autoMode)) sel.value = this.autoMode; else { this.autoMode = ''; sel.value = ''; }
    }
    autoDown(e) {
      const [x, y] = this.local(e), h = this.autoHit(x, y); if (!h) return;
      this.app.selTrack = h.t.id; this.s.push();
      let i = h.i;
      if (i < 0) {
        const pt = { t: Math.max(0, this.x2t(x)), v: this.autoV(h.ti, y) };
        if (this.autoMode === 'pan' && Math.abs(pt.v) < 0.04) pt.v = 0;
        h.pts.push(pt); h.pts.sort((a, b) => a.t - b.t); i = h.pts.indexOf(pt);
      }
      this.drag = { type: 'auto', pts: h.pts, pt: h.pts[i], ti: h.ti };
      this.draw();
    }
    autoRemove(e) {
      const [x, y] = this.local(e), h = this.autoHit(x, y); if (!h || h.i < 0) return;
      this.s.push(); h.pts.splice(h.i, 1); this.draw(); this.app.multiChanged(true);
    }
    /* ---- fade curve popup ---- */
    curveMenu(e, c, which) {
      document.querySelectorAll('.curve-pop').forEach((n) => n.remove());
      const pop = document.createElement('div'); pop.className = 'menu curve-pop';
      const cur = which === 'fi' ? c.fiCurve || 'linear' : c.foCurve || 'linear';
      pop.innerHTML = `<div class="mi dis" style="font-size:11px">${which === 'fi' ? 'Fade-in' : 'Fade-out'} curve</div>` + CURVES.map(([k, n]) => `<div class="mi" data-k="${k}"><span class="mc">${k === cur ? '✓' : ''}</span><span class="ml">${n}</span></div>`).join('');
      pop.style.left = Math.min(e.clientX, innerWidth - 190) + 'px'; pop.style.top = Math.min(e.clientY, innerHeight - 150) + 'px';
      document.body.appendChild(pop);
      pop.addEventListener('click', (ev) => { const it = ev.target.closest('[data-k]'); if (!it) return; this.s.push(); c[which === 'fi' ? 'fiCurve' : 'foCurve'] = it.dataset.k; pop.remove(); this.draw(); this.app.multiChanged(true); });
      const away = (ev) => { if (!pop.contains(ev.target)) { pop.remove(); document.removeEventListener('mousedown', away, true); } };
      setTimeout(() => document.addEventListener('mousedown', away, true), 0);
    }
    onContext(e) {
      e.preventDefault();
      if (this.autoMode) { this.autoRemove(e); return; }
      const [x, y] = this.local(e), h = this.hit(x, y);
      if (!h || !h.c) return;
      if (h.handle) { this.s.sel = h.c.id; this.curveMenu(e, h.c, h.handle); return; }
      /* right-click a keyframe: delete it */
      const eh = this.envHit(h.c, h.ti, x, y, e.altKey);
      if (eh && eh.i >= 0) { this.s.push(); ENV.removePoint(envOf(h.c)[eh.kind], eh.i); this.envHover = null; this.envActive = { id: h.c.id, kind: eh.kind, i: -1 }; this.draw(); this.envCommit(h.c); }
      else { if (!this.isSel(h.c)) this.selectClips(this.s.expandGroups([h.c.id])); this.s.sel = h.c.id; this.clipMenu(e, h.c); }
    }
    /* right-click on a clip: everything you can do to the selected clip(s) */
    clipMenu(e, c) {
      document.querySelectorAll('.curve-pop').forEach((n) => n.remove());
      const A = (id) => () => AS.actions[id](), n = this.selectedIds().size, esc = AS.ui.esc;
      const items = [];
      if (c.takes && c.takes.length > 1) {
        const one = c.comp && c.comp.length === 1 ? c.comp[0].take : -1;
        items.push({ head: 'Takes' }, ...c.takes.map((tk, i) => ({ label: tk.name || 'Take ' + (i + 1), checked: i === one, fn: () => { this.s.push(); c.comp = [{ from: 0, to: Infinity, take: i }]; applyComp(c); this.draw(); this.app.multiChanged(true); } })),
          { label: 'Comp Takes (swipe across the take lanes)', checked: this.compId === c.id, fn: () => { this.compId = this.compId === c.id ? null : c.id; this.draw(); } },
          { label: 'Keep Comp, Delete Other Takes', fn: () => { this.s.push(); delete c.takes; delete c.comp; c.name = c.name.replace(/ \(\d+ takes\)$/, ''); if (this.compId === c.id) this.compId = null; this.draw(); this.app.multiChanged(true); } }, '-');
      }
      items.push({ label: 'Split at Playhead', fn: A('mt.split') }, { label: 'Duplicate', fn: A('mt.dup') }, { label: n > 1 ? `Delete ${n} Clips` : 'Delete', fn: A('edit.delete') }, { label: 'Ripple Delete', fn: A('edit.ripple') }, '-',
        n > 1 ? { label: 'Group Clips', fn: A('mt.group') } : null, c.group ? { label: 'Ungroup', fn: A('mt.ungroup') } : null,
        { label: 'Lock in Time', checked: !!c.locked, fn: A('mt.lock') }, { label: 'Loop (drag the right edge to repeat)', checked: !!c.loop, fn: A('mt.loop') }, '-',
        { label: 'Bring Clip to Front', fn: A('mt.front') }, { label: 'Send Clip to Back', fn: A('mt.back') },
        { swatches: true }, '-', { label: n > 1 ? `Bounce ${n} Clips to New Track` : 'Bounce Clip to New Track', fn: A('mt.bounceclips') }, { label: 'Clip Properties…', fn: A('mt.props') });
      const pop = document.createElement('div'); pop.className = 'menu curve-pop';
      pop.innerHTML = items.filter(Boolean).map((it, i) => it === '-' ? '<div class="msep"></div>' : it.head ? `<div class="mi dis" style="font-size:11px">${esc(it.head)}</div>` : it.swatches
        ? `<div class="mi swrow"><span class="mc"></span><span class="ml">Clip Color</span><span class="sws">${['', ...COLORS].map((cc) => `<span class="sw" data-color="${cc}" title="${cc ? cc : 'Track colour'}" style="background:${cc || 'transparent'}">${cc ? '' : '∅'}</span>`).join('')}</span></div>`
        : `<div class="mi" data-i="${i}"><span class="mc">${it.checked ? '✓' : ''}</span><span class="ml">${esc(it.label)}</span></div>`).join('');
      const list = items.filter(Boolean);
      pop.style.left = Math.min(e.clientX, innerWidth - 300) + 'px'; document.body.appendChild(pop); pop.style.top = Math.max(4, Math.min(e.clientY, innerHeight - pop.offsetHeight - 8)) + 'px';
      pop.addEventListener('click', (ev) => {
        const sw = ev.target.closest('[data-color]');
        if (sw) { this.app.setClipColor(sw.dataset.color || null); pop.remove(); return; }
        const it = ev.target.closest('[data-i]'); if (!it) return; pop.remove(); const f = list[+it.dataset.i]; if (f && f.fn) f.fn();
      });
      const away = (ev) => { if (!pop.contains(ev.target)) { pop.remove(); document.removeEventListener('mousedown', away, true); } };
      setTimeout(() => document.addEventListener('mousedown', away, true), 0);
    }
    /* track colour: a swatch popup next to the header's colour chip */
    trackColorMenu(e, t) {
      document.querySelectorAll('.curve-pop').forEach((n) => n.remove());
      const pop = document.createElement('div'); pop.className = 'menu curve-pop';
      pop.innerHTML = `<div class="mi swrow"><span class="mc"></span><span class="ml">Track Color</span><span class="sws">${[...COLORS, ...BUS_COLORS].map((cc) => `<span class="sw" data-color="${cc}" style="background:${cc}"></span>`).join('')}</span></div><div class="mi"><span class="mc"></span><span class="ml">Custom… <input type="color" value="${t.color}"></span></div>`;
      pop.style.left = e.clientX + 'px'; pop.style.top = e.clientY + 'px'; document.body.appendChild(pop);
      const set = (cc) => { this.s.push(); t.color = cc; this.rebuildHeads(); this.draw(); AS.panels && AS.panels.refreshAll(); };
      pop.addEventListener('click', (ev) => { const sw = ev.target.closest('[data-color]'); if (sw) { set(sw.dataset.color); pop.remove(); } });
      pop.querySelector('input').addEventListener('change', (ev) => { set(ev.target.value); pop.remove(); });
      const away = (ev) => { if (!pop.contains(ev.target)) { pop.remove(); document.removeEventListener('mousedown', away, true); } };
      setTimeout(() => document.addEventListener('mousedown', away, true), 0);
    }
    /* lane geometry of a comped clip in comp mode */
    takeLanes(c, b) { const n = c.takes.length, top = b.top + TITLE_H, h = (b.h - TITLE_H) / n; return { n, top, h, at: (y) => Math.max(0, Math.min(n - 1, Math.floor((y - top) / h))) }; }
    onDown(e) {
      if (e.button !== 0) return;
      if (this.autoMode) { this.autoDown(e); return; }
      const [x, y] = this.local(e), xf = this.xfadeHit(x, y);
      if (xf) { this.s.push(); this.drag = { type: 'xfade', a: xf.a, b: xf.b, t: xf.t, centre: (xf.start + xf.end) / 2 }; this.draw(); return; } // drag the X: crossfade length
      const h = this.hit(x, y);
      if (h) { this.app.selTrack = h.t.id; this.app.rackTarget = null; this.heads.querySelectorAll('.mt-head').forEach((el, i) => el.classList.toggle('sel', i === h.ti)); }
      const eh = h && h.c && !h.handle && !h.title ? this.envHit(h.c, h.ti, x, y, e.altKey) : null;
      this.envActive = eh ? { id: h.c.id, kind: eh.kind, i: eh.i } : null;
      if (h && h.c && h.t.frozen) { this.s.sel = h.c.id; this.selIds = new Set([h.c.id]); this.app.status && this.app.status('This track is frozen — Multitrack > Unfreeze Track to edit its clips.'); this.draw(); return; }
      if (this.compId && (!h || !h.c || h.c.id !== this.compId)) this.compId = null; // clicking elsewhere leaves comp mode
      if (h && h.c && this.compId === h.c.id && !h.title && !h.handle && !h.edge) { // comp: swipe a range on a take lane
        const L = this.takeLanes(h.c, h.box); this.s.push();
        this.drag = { type: 'comp', c: h.c, take: L.at(y), x0: x, a: (this.x2t(x) - h.c.start + h.c.off) / AS.cstretch.scale(h.c) }; this.drag.b = this.drag.a; this.draw(); return; // in take time
      }
      if (h && h.c) {
        this.s.sel = h.c.id;
        if (h.handle) { this.s.push(); this.drag = { type: h.handle === 'fi' ? 'fadeIn' : 'fadeOut', c: h.c, box: h.box }; }
        else if (eh && eh.i >= 0) { this.s.push(); this.drag = { type: 'env', c: h.c, kind: eh.kind, i: eh.i, box: h.box }; } // click + drag a keyframe
        else if (eh && !h.edge) { /* click on a line: just highlight it (double-click adds a keyframe) */ }
        else if (h.edge && e.altKey) { this.s.push(); this.drag = { type: h.edge === 'l' ? 'stretchL' : 'stretchR', c: h.c, x0: x, orig: { ...h.c, env: jclone(envOf(h.c)) } }; } // Alt + edge: time-stretch
        else if (h.edge) { this.s.push(); this.drag = { type: h.edge === 'l' ? 'trimL' : 'trimR', c: h.c, x0: x, orig: { ...h.c }, origEnv: jclone(envOf(h.c)) }; }
        else if (e.ctrlKey) { // Ctrl+click: add / remove the clip (and its group) from the selection
          const ids = this.s.expandGroups([h.c.id]), on = this.selIds.has(h.c.id);
          for (const id of ids) on ? this.selIds.delete(id) : this.selIds.add(id);
          this.s.sel = on ? (this.selIds.size ? [...this.selIds][0] : null) : h.c.id;
        } else {
          if (!this.selIds.has(h.c.id)) this.selIds = new Set([h.c.id]);
          this.selIds = this.s.expandGroups(this.selIds); this.s.push();
          if (this.selIds.size > 1) { // move every selected clip together
            const items = this.s.allClips().filter(({ c }) => this.selIds.has(c.id)).map(({ t, c }) => ({ c, start0: c.start, ti0: this.s.tracks.indexOf(t), t0: t }));
            this.drag = { type: 'moveMany', items, x0: x, ti0: h.ti, lead: h.c };
          } else this.drag = { type: 'move', c: h.c, t: h.t, from: h.t, x0: x, y0: y, orig: { ...h.c } };
        }
      } else if (h && h.t.type === 'video' && h.t.video) { // drag the video lane = move the video in time
        this.s.push(); this.drag = { type: 'video', v: h.t.video, x0: x, start0: h.t.video.start };
      } else if (e.ctrlKey) { // Ctrl+drag on empty space: marquee-select clips
        this.compId = null; this.drag = { type: 'marquee', x0: x, y0: y, x1: x, y1: y, base: new Set(this.selIds) };
      } else { // empty space: click = move the playhead (and clear the time selection), drag = select a time range
        this.s.sel = null; this.selIds.clear(); this.compId = null; this.drag = { type: 'seek', x0: x, t: Math.max(0, this.snapT(this.x2t(x))) };
        this.app.seekMulti(Math.max(0, this.x2t(x))); this.setRange(null, null, true);
      }
      this.draw();
    }
    /* snapping: clip edges + playhead (Snap to Clips & Playhead) and/or the tempo grid (Snap to Grid) within 8 px */
    snapT(t, skipClip) {
      const grid = this.s.opts.snapGrid && this.s.opts.snapGrid !== 'off' ? this.s.opts.snapGrid : null;
      if (!this.snap && !grid) return t;
      const th = 8 / this.pps, pts = [];
      if (this.snap) { pts.push(this.app.multiPos()); for (const tr of this.s.tracks) for (const c of tr.clips) if (c !== skipClip) { pts.push(c.start, c.start + c.dur); } }
      if (grid) pts.push(AS.tempo.snap(t, AS.tempo.norm(this.s.opts.tempo), grid));
      for (const p of pts) if (Math.abs(p - t) < th) return p;
      return t;
    }
    onMove(e) {
      const d = this.drag;
      if (!d) {
        if (e.target === this.mainC) {
          const [x, y] = this.local(e), h = this.hit(x, y);
          const eh = h && h.c && !h.handle && !h.title ? this.envHit(h.c, h.ti, x, y, e.altKey) : null;
          this.mainC.style.cursor = this.autoMode ? 'crosshair' : this.xfadeHit(x, y) ? 'ew-resize' : eh ? (eh.i >= 0 ? 'move' : 'pointer') : h && h.c ? (h.handle ? 'col-resize' : h.edge ? (e.altKey ? 'col-resize' : 'ew-resize') : 'grab') : 'default';
          if (h && h.c && h.edge && !this.edgeTipShown) { this.edgeTipShown = true; this.app.status && this.app.status('Drag a clip edge to trim it — hold Alt while dragging to time-stretch it instead (Clip Properties: stretch %, pitch, mode).'); }
          this.setEnvHover(eh ? { id: h.c.id, kind: eh.kind, i: eh.i } : null);
        } else this.setEnvHover(null);
        return;
      }
      if (d.type === 'ruler') { this.seekFromEvent(e); return; }
      const [x, y] = this.local(e), dt = (x - (d.x0 || 0)) / this.pps;
      if (d.type === 'auto') {
        d.pt.t = Math.max(0, this.x2t(x)); d.pt.v = this.autoV(d.ti, y);
        if (this.autoMode === 'pan' && Math.abs(d.pt.v) < 0.04) d.pt.v = 0;
        d.pts.sort((a, b) => a.t - b.t); this.draw(); return;
      }
      if (d.type === 'env') { // time clamped between the neighbouring keyframes and inside the clip, value to its range
        ENV.movePoint(envOf(d.c)[d.kind], d.i, this.x2t(x) - d.c.start, this.envV(d.box, d.kind, y), d.c.dur, d.kind);
        ENV.liveUpdate(d.c); this.redrawClips([d.c]); return; // repaint only this clip (waveform rescales with the envelope)
      }
      if (d.type === 'fadeIn') { d.c.fi = D.clamp((this.x2t(x) - d.c.start), 0, Math.max(0, d.c.dur - d.c.fo)); this.draw(); return; }
      if (d.type === 'fadeOut') { d.c.fo = D.clamp((d.c.start + d.c.dur - this.x2t(x)), 0, Math.max(0, d.c.dur - d.c.fi)); this.draw(); return; }
      if (d.type === 'seek') {
        if (!d.range && Math.abs(x - d.x0) < 4) return;
        d.range = true; const t = Math.max(0, this.snapT(this.x2t(x))); this.setRange(Math.min(d.t, t), Math.max(d.t, t), true); this.frame(); return;
      }
      if (d.type === 'comp') { const sc = AS.cstretch.scale(d.c); d.b = D.clamp(this.x2t(x) - d.c.start + d.c.off, d.c.off, d.c.off + d.c.dur) / sc; d.moved = d.moved || Math.abs(x - d.x0) > 3; this.redrawClips([d.c]); return; }
      if (d.type === 'video') { d.v.start = Math.max(0, this.snapT(d.start0 + (x - d.x0) / this.pps)); d.moved = true; this.draw(); return; }
      if (d.type === 'marquee') { // every clip the rectangle touches is selected (plus what was selected before)
        d.x1 = x; d.y1 = y; const ta = this.x2t(Math.min(d.x0, x)), tb = this.x2t(Math.max(d.x0, x)), r0 = this.trackAt(Math.min(d.y0, y)), r1 = this.trackAt(Math.max(d.y0, y));
        const ids = new Set(d.base); this.s.tracks.forEach((t, ti) => { if (ti < r0 || ti > r1) return; for (const c of t.clips) if (c.start < tb && c.start + c.dur > ta) ids.add(c.id); });
        this.selIds = this.s.expandGroups(ids); this.s.sel = this.selIds.size ? [...this.selIds][0] : null; this.draw(); return;
      }
      if (d.type === 'moveMany') {
        let dt = (x - d.x0) / this.pps; const lead = d.items.find((it) => it.c === d.lead) || d.items[0], ns = this.snapT(lead.start0 + dt, lead.c); dt = ns - lead.start0;
        this.s.moveClips(d.items, dt, D.clamp(this.trackAt(y), 0, this.s.tracks.length - 1) - d.ti0); d.moved = d.moved || Math.abs(x - d.x0) > 2 || this.trackAt(y) !== d.ti0;
        this.app.multiChanged(); this.draw(); return;
      }
      if (d.type === 'xfade') { // crossfade length = 2 × distance from the crossfade centre
        if (this.s.setCrossfadeLength(d.a, d.b, 2 * Math.abs(this.x2t(x) - d.centre))) this.s.applyCrossfades(d.t);
        this.app.multiChanged(); this.draw(); return;
      }
      const c = d.c, o = d.orig;
      if (d.type === 'move') {
        let ns = Math.max(0, o.start + dt);
        const a = this.snapT(ns, c), b = this.snapT(ns + c.dur, c);
        ns = a !== ns ? a : b !== ns + c.dur ? b - c.dur : ns;
        if (!c.locked) c.start = Math.max(0, ns); // Lock in Time: the clip keeps its time (it may still change lane)
        const ti = D.clamp(this.trackAt(y), 0, this.s.tracks.length - 1), nt = this.s.tracks[ti];
        if (nt !== d.t && nt.type === 'audio' && !nt.frozen) { d.t.clips.splice(d.t.clips.indexOf(c), 1); nt.clips.push(c); d.t = nt; } // clips never go onto a bus lane
      } else if (d.type === 'trimL') {
        let n = this.snapT(o.start + dt, c); let delta = n - o.start;
        delta = D.clamp(delta, -o.off, o.dur - 0.01);
        c.start = o.start + delta; c.off = o.off + delta; c.dur = o.dur - delta;
        c.env = { volume: ENV.shift(d.origEnv.volume, delta, c.dur, ENV.KINDS.volume.dflt), pan: ENV.shift(d.origEnv.pan, delta, c.dur, ENV.KINDS.pan.dflt) };
        c.fi = Math.min(o.fi, c.dur); c.fo = Math.min(o.fo, Math.max(0, c.dur - c.fi));
      } else if (d.type === 'stretchR' || d.type === 'stretchL') { // the dragged edge sets the new length; the other edge stays
        const end0 = o.start + o.dur, newDur = d.type === 'stretchR' ? Math.max(0.05, this.snapT(end0 + dt, c) - o.start) : Math.max(0.05, end0 - this.snapT(o.start + dt, c));
        AS.cstretch.setStretch(c, AS.cstretch.scale(o) * newDur / o.dur, o);
        c.start = d.type === 'stretchR' ? o.start : end0 - c.dur;
      } else if (d.type === 'trimR') {
        let n = this.snapT(o.start + o.dur + dt, c); c.dur = D.clamp(n - o.start, 0.01, c.loop ? 24 * 3600 : AS.cstretch.srcDur(c) - o.off); // a looped clip extends freely
        c.fo = Math.min(o.fo, c.dur); c.fi = Math.min(o.fi, Math.max(0, c.dur - c.fo));
      }
      this.app.multiChanged(); this.draw();
    }
    onUp() {
      const d = this.drag; this.drag = null;
      if (!d || d.type === 'seek' || d.type === 'ruler') return;
      if (d.type === 'env') { this.envCommit(d.c); return; } // already applied live — no playback restart
      if (d.type === 'comp') { // swipe = that range from this take; click = the whole comp segment under the pointer
        const c = d.c, len = Math.min(...c.takes.map((tk) => tk.src.dur)), comp = AS.rec.normComp(c.comp, len, c.takes.length);
        let a = Math.min(d.a, d.b), b = Math.max(d.a, d.b);
        if (!d.moved) { const seg = comp.find((sg) => d.a >= sg.from && d.a < sg.to) || comp[comp.length - 1]; a = seg.from; b = seg.to; }
        c.comp = AS.rec.assign(comp, a, b, d.take, len, c.takes.length); applyComp(c);
        this.draw(); this.app.multiChanged(true); return;
      }
      if (d.type === 'marquee') { this.draw(); return; }
      if (d.type === 'video') { if (!d.moved) this.s.undoStack.pop(); this.draw(); return; }
      if (d.type === 'moveMany') {
        if (!d.moved) { this.s.undoStack.pop(); this.draw(); return; }
        for (const it of d.items.slice().sort((a, b) => a.c.start - b.c.start)) { const f = this.s.findClip(it.c.id); if (f) this.s.place(f.t, it.c); }
        for (const it of d.items) this.s.applyCrossfades(it.t0);
        this.draw(); this.app.multiChanged(true); return;
      }
      if (d.type === 'move') { // overlap policy + crossfades — only when the clip really moved (a click just selects)
        if (d.from === d.t && Math.abs(d.c.start - d.orig.start) < 1e-9) { this.s.undoStack.pop(); this.draw(); return; }
        this.s.place(d.t, d.c); if (d.from !== d.t) this.s.applyCrossfades(d.from);
      }
      else if (d.type === 'trimL' || d.type === 'trimR') { const f = this.s.findClip(d.c.id); if (f) this.s.applyCrossfades(f.t); }
      else if (d.type === 'stretchL' || d.type === 'stretchR') { const f = this.s.findClip(d.c.id); if (f) this.s.applyCrossfades(f.t); this.app.stretchChanged(d.c); }
      this.draw(); this.app.multiChanged(true);
    }
    onDbl(e) {
      if (this.autoMode) { this.autoRemove(e); return; }
      const [x, y] = this.local(e), h = this.hit(x, y); if (!h || !h.c) return;
      if (h.handle) { this.curveMenu(e, h.c, h.handle); return; }
      const eh = !h.title ? this.envHit(h.c, h.ti, x, y, e.altKey) : null;
      if (eh) {
        /* double-click on a line: new keyframe at that time, on the line's current value (the shape does not change) */
        if (eh.i < 0) {
          const c = h.c, pts = envOf(c)[eh.kind], rel = D.clamp(this.x2t(x) - c.start, 0, c.dur);
          this.s.push(); const i = ENV.addPoint(pts, rel, ENV.valueAt(pts, rel, ENV.KINDS[eh.kind].dflt), c.dur, eh.kind);
          this.envActive = this.envHover = { id: c.id, kind: eh.kind, i }; this.draw(); this.envCommit(c);
        }
        return;
      }
      this.app.clipProperties(h.c.id);
    }
    setEnvHover(v) {
      const a = this.envHover;
      if ((a && a.id) !== (v && v.id) || (a && a.kind) !== (v && v.kind) || (a && a.i) !== (v && v.i)) {
        this.envHover = v; const f = (s) => s && this.s.findClip(s.id);
        this.redrawClips([...new Set([f(a), f(v)].filter(Boolean).map((x) => x.c))]); // only the clips whose highlight changed
      }
    }
    /* ---- drawing ---- */
    /* full redraw (call after anything visible changed) */
    draw() { this.baseKey = null; this.frame(); }
    /* per-frame entry used during playback: re-renders the static layer only when the view moved, then overlays the playhead */
    frame() {
      if (!this.W) return;
      const key = this.viewKey();
      if (key !== this.baseKey) { this.renderBase(); this.baseKey = key; }
      const g = this.mainC.getContext('2d'), rg = this.rulerC.getContext('2d'), dpr = this.dpr;
      g.setTransform(1, 0, 0, 1, 0, 0); rg.setTransform(1, 0, 0, 1, 0, 0);
      g.clearRect(0, 0, this.mainC.width, this.mainC.height); g.drawImage(this.baseM, 0, 0);
      rg.clearRect(0, 0, this.rulerC.width, this.rulerC.height); rg.drawImage(this.baseR, 0, 0);
      g.setTransform(dpr, 0, 0, dpr, 0, 0); rg.setTransform(dpr, 0, 0, dpr, 0, 0);
      const mq = this.drag && this.drag.type === 'marquee' ? this.drag : null;
      if (mq) { g.strokeStyle = '#fff'; g.setLineDash([4, 3]); g.strokeRect(Math.min(mq.x0, mq.x1) + 0.5, Math.min(mq.y0, mq.y1) + 0.5, Math.abs(mq.x1 - mq.x0), Math.abs(mq.y1 - mq.y0)); g.setLineDash([]); g.fillStyle = 'rgba(255,255,255,0.06)'; g.fillRect(Math.min(mq.x0, mq.x1), Math.min(mq.y0, mq.y1), Math.abs(mq.x1 - mq.x0), Math.abs(mq.y1 - mq.y0)); }
      if (this.range) { // time selection overlay (red tint while Punch In/Out is armed)
        const xa = Math.max(0, this.t2x(this.range.a)), xb = Math.min(this.W, this.t2x(this.range.b));
        if (xb > xa) { const punch = this.app.punch; g.fillStyle = punch ? 'rgba(232,80,58,0.13)' : 'rgba(80,150,255,0.13)'; g.fillRect(xa, 0, xb - xa, this.H); rg.fillStyle = punch ? 'rgba(232,80,58,0.6)' : 'rgba(80,150,255,0.6)'; rg.fillRect(xa, RULER_H - 5, xb - xa, 5); }
      }
      const px = this.t2x(this.app.multiPos());
      if (px >= 0 && px <= this.W) {
        g.strokeStyle = this.cursorCol; g.lineWidth = 1.5; g.beginPath(); g.moveTo(Math.round(px) + 0.5, 0); g.lineTo(Math.round(px) + 0.5, this.H); g.stroke(); g.lineWidth = 1;
        rg.fillStyle = this.cursorCol; rg.beginPath(); rg.moveTo(px - 5, RULER_H - 9); rg.lineTo(px + 5, RULER_H - 9); rg.lineTo(px, RULER_H); rg.fill();
      }
    }
    viewKey() { return [this.t0, this.pps, this.W, this.H, this.dpr, this.app.timeFormat ? this.app.timeFormat() : '', JSON.stringify(this.s.opts.tempo)].join('|'); }
    gridStep() { const m = 90 / this.pps; for (let e = -3; e < 5; e++) for (const b of [1, 2, 5]) { const v = b * Math.pow(10, e); if (v >= m) return v; } return 3600; }
    /* ruler / grid marks for the visible range: [{ x, level: 'major' | 'beat' | 'sub', label }]. In the Bars:Beats time
       format they follow the session tempo (bars, beats, subdivisions), otherwise round time steps. */
    gridMarks() {
      const t1 = this.t0 + this.W / this.pps, out = [];
      if (this.app.timeFormat && this.app.timeFormat() === 'bars') {
        for (const g of AS.tempo.gridLines(this.t0, t1, AS.tempo.norm(this.s.opts.tempo), this.pps)) out.push({ x: Math.round(this.t2x(g.time)) + 0.5, level: g.level === 'bar' ? 'major' : g.level, label: g.label });
        return out;
      }
      const step = this.gridStep();
      for (let t = Math.floor(this.t0 / step) * step; t < t1 + step; t += step) out.push({ x: Math.round(this.t2x(t)) + 0.5, level: 'major', label: AS.fmtTime(t, step) });
      return out;
    }
    renderBase() {
      const g = this.baseM.getContext('2d'), rg = this.baseR.getContext('2d'), dpr = this.dpr, css = getComputedStyle(document.documentElement), col = (n) => css.getPropertyValue(n).trim();
      this.cursorCol = col('--cursor'); this.pal = { bg: col('--wave-bg'), grid: col('--grid'), border: col('--border') };
      g.setTransform(dpr, 0, 0, dpr, 0, 0); rg.setTransform(dpr, 0, 0, dpr, 0, 0);
      rg.fillStyle = col('--panel2'); rg.fillRect(0, 0, this.W, RULER_H);
      rg.fillStyle = col('--dim'); rg.font = '10px Segoe UI, sans-serif'; rg.strokeStyle = col('--border');
      this.marks = this.gridMarks();
      for (const m of this.marks) {
        const len = m.level === 'major' ? 9 : m.level === 'beat' ? 5 : 3;
        rg.beginPath(); rg.moveTo(m.x, RULER_H - len); rg.lineTo(m.x, RULER_H); rg.stroke(); if (m.label) rg.fillText(m.label, m.x + 3, 12);
      }
      this.paintMain(g, null);
    }
    /* background, grid, track rows and clips into the static layer.
       r = {ti, x0, x1}: repaint only that part of one track row (clipped), used for keyframe drags / hover */
    paintMain(g, r) {
      const P = this.pal, marks = this.marks || this.gridMarks();
      if (r) { // clip to whole device pixels so the repainted patch has no seams
        const d = this.dpr, X0 = Math.floor(r.x0 * d) / d, X1 = Math.ceil(r.x1 * d) / d, Y0 = Math.floor(r.ti * TH * d) / d, Y1 = Math.ceil((r.ti + 1) * TH * d) / d;
        g.save(); g.beginPath(); g.rect(X0, Y0, X1 - X0, Y1 - Y0); g.clip();
      }
      g.fillStyle = P.bg; g.fillRect(0, 0, this.W, this.H);
      g.strokeStyle = P.grid;
      for (const m of marks) {
        if (r && (m.x < r.x0 - 1 || m.x > r.x1 + 1)) continue;
        g.globalAlpha = m.level === 'major' ? 1 : m.level === 'beat' ? 0.55 : 0.3; // bars strongest, then beats, then subdivisions
        g.beginPath(); g.moveTo(m.x, 0); g.lineTo(m.x, this.H); g.stroke();
      }
      g.globalAlpha = 1;
      this.s.tracks.forEach((t, ti) => {
        if (r && ti !== r.ti) return;
        const y0 = ti * TH;
        g.fillStyle = ti % 2 ? 'rgba(255,255,255,0.015)' : 'rgba(0,0,0,0)'; g.fillRect(0, y0, this.W, TH);
        if (t.type === 'video') AS.vtrack.drawLane(g, { W: this.W, pps: this.pps, t2x: (tt) => this.t2x(tt), redraw: () => { clearTimeout(this._vt); this._vt = setTimeout(() => this.draw(), 60); } }, t, y0, TH);
        if (t.type === 'bus') { // bus lane: no clips, tinted with the bus colour and labelled
          g.fillStyle = t.color + '14'; g.fillRect(0, y0, this.W, TH);
          g.fillStyle = t.color; g.font = '11px Segoe UI, sans-serif';
          const feeders = this.s.tracks.filter((x) => x.out === t.id || (x.sends || []).some((sd) => sd.to === t.id)).map((x) => x.name);
          g.fillText(`Bus — ${feeders.length ? 'fed by ' + feeders.join(', ') : 'route tracks here with Output or Sends'}`, 8, y0 + TH / 2 + 4);
        }
        g.strokeStyle = P.border; g.beginPath(); g.moveTo(0, y0 + TH - 0.5); g.lineTo(this.W, y0 + TH - 0.5); g.stroke();
        for (const c of t.clips.slice().sort(zcmp)) this.drawClip(g, c, t, ti, this.isSel(c)); // back to front
        this.drawCrossfades(g, t, ti);
        if (this.autoMode) this.drawAuto(g, t, ti);
      });
      if (r) g.restore();
    }
    /* repaint only the given clips' area of the static layer and present it (smooth keyframe dragging).
       Falls back to a full redraw when the static layer is out of date. */
    redrawClips(clips) {
      if (!this.W) return;
      if (this.baseKey !== this.viewKey()) { this.draw(); return; }
      const g = this.baseM.getContext('2d'); g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      for (const c of clips) {
        const ti = c ? this.s.tracks.findIndex((t) => t.clips.includes(c)) : -1; if (ti < 0) continue;
        const b = this.box(c, ti), x0 = Math.max(0, Math.floor(b.x0) - 2), x1 = Math.min(this.W, Math.ceil(b.x1) + 2);
        if (x1 > x0) this.paintMain(g, { ti, x0, x1 });
      }
      this.frame();
    }
    /* each automatic crossfade: the two fade curves crossing over the overlap (an X) and a centre handle to drag */
    drawCrossfades(g, t, ti) {
      if (!this.s.opts.xfade) return;
      const top = ti * TH + 3 + TITLE_H, bot = ti * TH + TH - 5, hh = bot - top;
      for (const xf of this.s.crossfades(t)) {
        const x0 = this.t2x(xf.start), x1 = this.t2x(xf.end); if (x1 < 0 || x0 > this.W) continue;
        g.fillStyle = 'rgba(255,255,255,0.07)'; g.fillRect(x0, top, x1 - x0, hh);
        const fin = fadeShape(xf.b.xfiCurve), fout = fadeShape(xf.a.xfoCurve);
        g.lineWidth = 1.5;
        g.strokeStyle = '#ffffffe0'; g.beginPath(); for (let i = 0; i <= 32; i++) { const u = i / 32, x = x0 + (x1 - x0) * u, y = bot - fin(u) * hh; i ? g.lineTo(x, y) : g.moveTo(x, y); } g.stroke();
        g.strokeStyle = '#ffd27ae0'; g.beginPath(); for (let i = 0; i <= 32; i++) { const u = i / 32, x = x0 + (x1 - x0) * u, y = bot - fout(1 - u) * hh; i ? g.lineTo(x, y) : g.moveTo(x, y); } g.stroke();
        g.lineWidth = 1;
        const cx = (x0 + x1) / 2, cy = top + hh / 2; g.fillStyle = '#fff'; g.strokeStyle = '#000';
        g.beginPath(); g.moveTo(cx, cy - 6); g.lineTo(cx + 6, cy); g.lineTo(cx, cy + 6); g.lineTo(cx - 6, cy); g.closePath(); g.fill(); g.stroke();
      }
    }
    drawAuto(g, t, ti) {
      const mi = this.modeInfo(t), y0 = ti * TH;
      if (!mi) { g.fillStyle = 'rgba(0,0,0,.25)'; g.fillRect(0, y0, this.W, TH - 1); return; }
      const pts = mi.pts, dflt = mi.dflt;
      g.fillStyle = 'rgba(0,0,0,.35)'; g.fillRect(0, y0, this.W, TH - 1);
      g.strokeStyle = '#ffd23f'; g.lineWidth = 2; g.beginPath();
      if (!pts.length) { const y = this.autoY(ti, dflt); g.setLineDash([5, 4]); g.moveTo(0, y); g.lineTo(this.W, y); g.stroke(); g.setLineDash([]); }
      else {
        g.moveTo(0, this.autoY(ti, pts[0].v));
        for (const p of pts) g.lineTo(this.t2x(p.t), this.autoY(ti, p.v));
        g.lineTo(this.W, this.autoY(ti, pts[pts.length - 1].v)); g.stroke();
        g.fillStyle = '#ffd23f';
        for (const p of pts) { g.beginPath(); g.arc(this.t2x(p.t), this.autoY(ti, p.v), 4, 0, 7); g.fill(); }
      }
      g.lineWidth = 1; g.fillStyle = '#ffd23f'; g.font = '10px Segoe UI, sans-serif';
      g.fillText(mi.label + ' — click to add, drag to move, double-click / right-click to delete', 6, y0 + 12);
    }
    drawClip(g, c, t, ti, selected) {
      const b = this.box(c, ti), { x0, x1, top, h } = b;
      if (x1 < 0 || x0 > this.W) return;
      const color = c.color || t.color; // clip colour, else the track's
      if (t.frozen) g.globalAlpha = 0.45; // frozen track: clips shown dimmed (they play from the frozen render)
      if (t.clips.some((o) => o !== c && zcmp(o, c) < 0 && this.s.hiddenRanges(t, o).some(([a, b]) => o.start + a < c.start + c.dur && o.start + b > c.start))) { // in front of another clip: the part behind shows faded
        const a = g.globalAlpha; g.globalAlpha = a * 0.78; g.fillStyle = this.pal.bg; g.fillRect(x0, top, x1 - x0, h); g.globalAlpha = a;
      }
      g.fillStyle = color + '33'; g.fillRect(x0, top, x1 - x0, h);
      g.strokeStyle = selected ? '#ffffff' : color; g.lineWidth = selected ? 2 : 1; g.strokeRect(x0 + 0.5, top + 0.5, x1 - x0 - 1, h - 1); g.lineWidth = 1;
      /* waveform at its playback loudness: peaks × volume envelope × fades × clip gain (wavescale.js, visual only) */
      const WS = AS.wavescale, view = { t0: this.t0, pps: this.pps }, xa = Math.floor(Math.max(0, x0)), xb = Math.ceil(Math.min(this.W, x1));
      const ps = AS.cstretch.play(c), dsrc = ps || c.src; // stretched audio once rendered; until then the original, scaled
      const cols = WS.columns(c, srcPeaks(dsrc), xa, xb, view, dsrc, ps ? 1 : AS.cstretch.scale(c)), mult = WS.clipMultipliers(c, xa, cols.n, view, fadeGainAt, D.fromDb(c.gain));
      const yc = top + TITLE_H + (h - TITLE_H) / 2, amp = (h - TITLE_H) / 2 - 2;
      g.fillStyle = color; WS.drawColumns(g, cols, mult, yc, amp, top + TITLE_H + 1, top + h - 1);
      if (c.loop && c.loopLen > 0) { // loop repeats: a notch + dashed line where each repeat starts
        g.strokeStyle = '#ffffff70'; g.setLineDash([2, 3]);
        for (let k = 1, tt = c.start + (c.loopLen - (((c.off - c.loopOff) % c.loopLen) + c.loopLen) % c.loopLen); tt < c.start + c.dur - 1e-6 && k < 2000; k++, tt += c.loopLen) { const x = Math.round(this.t2x(tt)) + 0.5; if (x > 0 && x < this.W) { g.beginPath(); g.moveTo(x, top + TITLE_H); g.lineTo(x, top + h); g.stroke(); } }
        g.setLineDash([]);
      }
      g.fillStyle = color; g.fillRect(x0, top, x1 - x0, TITLE_H);
      g.save(); g.beginPath(); g.rect(Math.max(x0, 0), top, x1 - Math.max(x0, 0), TITLE_H); g.clip();
      const fxOn = AS.rack.activeFx(c.fx).length > 0 && AS.rack.cfgOf(c).power;
      g.fillStyle = '#000'; g.font = '10px Segoe UI, sans-serif'; g.fillText((c.locked ? '🔒 ' : '') + (c.group ? '⛓ ' : '') + (c.loop ? '↻ ' : '') + (fxOn ? 'fx ' : '') + c.name + (c.takes ? (this.compId === c.id ? '  — COMP: swipe a take lane (Esc to finish)' : '  — right-click: takes') : '') + (AS.cstretch.isOn(c) ? `  ⟷${Math.round(AS.cstretch.scale(c) * 1000) / 10}%${c.pitch && c.stretchMode !== 'varispeed' ? ` ${c.pitch > 0 ? '+' : ''}${+(+c.pitch).toFixed(2)}st` : ''}${AS.cstretch.play(c) ? '' : ' (rendering…)'}` : '') + (c.gain ? `  ${c.gain > 0 ? '+' : ''}${c.gain.toFixed(1)}dB` : ''), Math.max(x0, 0) + 4, top + 9); g.restore();
      /* fade curves + handles */
      if (x1 - x0 > 28) {
        g.strokeStyle = '#ffffffcc'; g.lineWidth = 1;
        const fcurve = (from, to, fn, mirror) => { g.beginPath(); for (let i = 0; i <= 24; i++) { const u = i / 24, x = from + (to - from) * u, v = fn(mirror ? 1 - u : u); const y = top + h - 2 - v * (h - TITLE_H - 6); if (i === 0) g.moveTo(x, y); else g.lineTo(x, y); } g.stroke(); };
        // manual fades only — a crossfaded side is drawn as the X by drawCrossfades()
        if (!(c.xfi > 0) && c.fi > 0) fcurve(x0, x0 + c.fi * this.pps, fadeShape(c.fiCurve), false);
        if (!(c.xfo > 0) && c.fo > 0) fcurve(x1 - c.fo * this.pps, x1, fadeShape(c.foCurve), true);
        const fh = this.fadeHandles(c, ti);
        for (const hd of [fh.l, fh.r]) { if (!hd) continue; g.fillStyle = '#fff'; g.strokeStyle = '#000'; g.fillRect(hd.x - 4, hd.y - 4, 8, 8); g.strokeRect(hd.x - 3.5, hd.y - 3.5, 7, 7); }
      }
      g.globalAlpha = 1;
      if (c.takes && this.compId === c.id) { this.drawTakeLanes(g, c, b, t); return; } // comp mode replaces the envelopes
      for (const kind of this.envOrder(c).reverse()) this.drawClipEnv(g, c, b, kind); // bottom first: what is on top is what a click grabs
    }
    /* comp mode: one lane per take, its waveform, the ranges the comp uses from it highlighted, the swipe in progress */
    drawTakeLanes(g, c, b, t) {
      const L = this.takeLanes(c, b), x0 = Math.max(0, b.x0), x1 = Math.min(this.W, b.x1), d = this.drag && this.drag.type === 'comp' && this.drag.c === c ? this.drag : null;
      g.save(); g.beginPath(); g.rect(x0, L.top, x1 - x0, b.h - TITLE_H); g.clip();
      g.fillStyle = 'rgba(0,0,0,0.55)'; g.fillRect(x0, L.top, x1 - x0, b.h - TITLE_H);
      const sc = AS.cstretch.scale(c), tx = (tt) => this.t2x(c.start + (tt * sc - c.off)); // take time -> screen
      c.takes.forEach((tk, k) => {
        const y = L.top + k * L.h, yc = y + L.h / 2, pk = srcPeaks(tk.src), sr = tk.src.sr;
        for (const sg of c.comp || []) if (sg.take === k) { g.fillStyle = t.color + '55'; g.fillRect(tx(sg.from), y, tx(sg.to) - tx(sg.from), L.h); }
        g.fillStyle = '#ffffffb0'; g.beginPath();
        for (let x = Math.floor(x0); x < x1; x++) {
          const tt = (c.off + (this.x2t(x) - c.start)) / sc; let lo = 1, hi = -1;
          for (let ch = 0; ch < pk.chs.length; ch++) { const r = pk.range(ch, tt * sr, (tt + 1 / this.pps) * sr); if (r) { lo = Math.min(lo, r[0]); hi = Math.max(hi, r[1]); } }
          if (hi >= lo) { const a = (L.h / 2 - 1) * Math.min(1, hi), bb = (L.h / 2 - 1) * Math.min(1, -lo); g.rect(x, yc - a, 1, Math.max(1, a + bb)); }
        }
        g.fill();
        g.strokeStyle = 'rgba(255,255,255,0.2)'; g.beginPath(); g.moveTo(x0, y + L.h - 0.5); g.lineTo(x1, y + L.h - 0.5); g.stroke();
        g.fillStyle = '#fff'; g.font = '9px Segoe UI, sans-serif'; g.fillText(tk.name || 'Take ' + (k + 1), x0 + 3, y + 9);
      });
      if (d) { const xa = tx(Math.min(d.a, d.b)), xb = tx(Math.max(d.a, d.b)); g.fillStyle = 'rgba(255,255,255,0.35)'; g.fillRect(xa, L.top + d.take * L.h, Math.max(2, xb - xa), L.h); }
      g.restore();
    }
    /* one envelope line across the clip body + its keyframe nodes.
       Normal: thin line, small nodes. Hovered / clicked: thicker line, larger outlined nodes, value readout. */
    drawClipEnv(g, c, b, kind) {
      const K = ENV.KINDS[kind], pts = envOf(c)[kind], on = (s) => s && s.id === c.id && s.kind === kind;
      const dragging = this.drag && this.drag.type === 'env' && this.drag.c === c && this.drag.kind === kind;
      const hl = dragging || on(this.envHover) || on(this.envActive);
      const hot = dragging ? this.drag.i : on(this.envHover) ? this.envHover.i : on(this.envActive) ? this.envActive.i : -1;
      g.save(); g.beginPath(); g.rect(Math.max(0, b.x0), b.top + TITLE_H, Math.min(this.W, b.x1) - Math.max(0, b.x0), b.h - TITLE_H); g.clip();
      g.strokeStyle = K.color; g.lineWidth = hl ? 2.5 : 1.5; g.globalAlpha = hl ? 1 : 0.85; g.beginPath();
      if (!pts.length) { const y = this.envY(b, kind, K.dflt); g.moveTo(b.x0, y); g.lineTo(b.x1, y); }
      else { g.moveTo(b.x0, this.envY(b, kind, pts[0].v)); for (const p of pts) g.lineTo(this.t2x(c.start + p.t), this.envY(b, kind, p.v)); g.lineTo(b.x1, this.envY(b, kind, pts[pts.length - 1].v)); }
      g.stroke(); g.globalAlpha = 1;
      pts.forEach((p, i) => {
        const x = this.t2x(c.start + p.t), y = this.envY(b, kind, p.v), r = i === hot ? 6 : hl ? 4.5 : 3;
        g.beginPath(); g.arc(x, y, r, 0, 2 * Math.PI); g.fillStyle = K.color; g.fill();
        if (hl) { g.lineWidth = i === hot ? 2 : 1.25; g.strokeStyle = '#fff'; g.stroke(); }
      });
      if (hot >= 0 && pts[hot]) { // value readout next to the active keyframe
        const p = pts[hot], x = this.t2x(c.start + p.t), y = this.envY(b, kind, p.v), txt = K.label + ' ' + ENV.format(kind, p.v);
        g.font = '10px Segoe UI, sans-serif'; const w = g.measureText(txt).width + 8, tx = Math.min(x + 9, b.x1 - w - 2), ty = y < b.ey0 + 16 ? y + 8 : y - 22;
        g.fillStyle = 'rgba(0,0,0,.75)'; g.fillRect(tx, ty, w, 15); g.fillStyle = K.color; g.fillText(txt, tx + 4, ty + 11);
      }
      g.lineWidth = 1; g.restore();
    }
  }

  AS.applyComp = applyComp; AS.renderRange = renderRange;
  AS.Session = Session; AS.MultiView = MultiView; AS.makeSource = makeSource; AS.renderMix = renderMix; AS.buildGraph = buildGraph; AS.fadeGainAt = fadeGainAt; AS.CURVES = CURVES; AS.cloneClipProps = cloneClipProps;
})(window);

// Run: node tests/clips.test.js — groups, ripple delete, moving several clips, Lock in Time, clip loop, freeze in the graph,
// track order (Move Track / drag a header) and clip stacking (Bring Clip to Front / Send Clip to Back)
const assert = require('assert');
const { load, CORE, ok, done } = require('./_sandbox');
const sb = load(CORE), AS = sb.AS;
const near = (a, b, e, m) => assert(Math.abs(a - b) <= (e || 1e-9), (m ? m + ': ' : '') + a + ' != ' + b);
const J = (x) => JSON.parse(JSON.stringify(x));
const sr = 1000, src = (secs) => AS.makeSource('s', sr, [new Float32Array(Math.round(secs * sr)).fill(0.5)]);
function mk() { const s = new AS.Session(); s.tracks = []; const a = s.addTrack('A'), b = s.addTrack('B'), bus = s.addBus('Bus'); return { s, a, b, bus }; }
const starts = (t) => J(t.clips.slice().sort((x, y) => x.start - y.start).map((c) => +c.start.toFixed(6)));

ok('groups: selecting one clip of a group selects the whole group; ungroup', () => {
  const { s, a, b } = mk(), c1 = s.addClip(a, src(1), 0), c2 = s.addClip(b, src(1), 2), c3 = s.addClip(a, src(1), 5);
  s.group([c1.id, c2.id]); assert.deepStrictEqual(J([...s.expandGroups([c1.id])].sort()), [c1.id, c2.id].sort());
  assert.deepStrictEqual(J([...s.expandGroups([c3.id])]), [c3.id]);
  s.ungroup([c2.id]); assert(!c1.group && !c2.group);
});
ok('ripple delete closes the gap on that track only; plain delete leaves it', () => {
  const { s, a, b } = mk(), x = s.addClip(a, src(1), 0), y = s.addClip(a, src(2), 1), z = s.addClip(a, src(1), 4), w = s.addClip(b, src(1), 4);
  s.deleteClips([y.id], true); assert.deepStrictEqual(starts(a), [0, 2]); assert.deepStrictEqual(starts(b), [4], 'other track untouched');
  const { s: s2, a: a2 } = mk(); s2.addClip(a2, src(1), 0); const y2 = s2.addClip(a2, src(2), 1); s2.addClip(a2, src(1), 4); s2.deleteClips([y2.id], false); assert.deepStrictEqual(starts(a2), [0, 4]);
  void x; void z; void w;
});
ok('moving several clips: same time offset, lane change only when every clip lands on an audio track', () => {
  const { s, a, b } = mk(), c1 = s.addClip(a, src(1), 1), c2 = s.addClip(b, src(1), 3);
  const items = [c1, c2].map((c) => ({ c, start0: c.start, ti0: s.tracks.findIndex((t) => t.clips.includes(c)) }));
  s.moveClips(items, 0.5, 0); near(c1.start, 1.5); near(c2.start, 3.5);
  assert.strictEqual(s.moveClips(items, 0, 1), false, 'B -> Bus is not allowed: no lane change'); assert(a.clips.includes(c1) && b.clips.includes(c2));
  s.moveClips(items, -5, 0); near(c1.start, 0, 1e-9, 'never before 0'); near(c2.start, 2);
});
ok('Lock in Time: a locked clip (or a selection containing one) does not move in time', () => {
  const { s, a } = mk(), c1 = s.addClip(a, src(1), 1), c2 = s.addClip(a, src(1), 3); c1.locked = true;
  s.moveClips([c1, c2].map((c) => ({ c, start0: c.start, ti0: 0 })), 2, 0); near(c1.start, 1); near(c2.start, 3);
});
ok('clip loop: the content becomes the unit; turning it off cuts back to the material', () => {
  const { s, a } = mk(), c = s.addClip(a, src(4), 0, { off: 1, dur: 1.5 });
  s.setLoop(c, true); near(c.loopOff, 1); near(c.loopLen, 1.5); c.dur = 10;
  s.setLoop(c, false); near(c.dur, 3, 1e-9, '4 s source - 1 s offset'); assert(!c.loop && c.loopLen === undefined);
});
/* fake Web Audio recording buffer-source settings */
function fakeCtx() {
  const all = [], P = (v) => ({ value: v, setValueAtTime() {}, linearRampToValueAtTime() {}, setValueCurveAtTime() {} });
  const n = (type, x) => { const o = { type, out: [], connect(d) { this.out.push(d); return d; }, disconnect() {}, ...x }; all.push(o); return o; };
  return Object.assign(Object.create(sb.AudioContext.prototype), { all, currentTime: 0, sampleRate: sr, createGain: () => n('gain', { gain: P(1) }), createStereoPanner: () => n('pan', { pan: P(0) }), createBufferSource: () => n('src', { start(...a) { this.args = a; } }), createChannelSplitter: () => n('split'), createAnalyser: () => n('an', { getFloatTimeDomainData() {} }) });
}
ok('graph: a looped clip uses the buffer loop points, starting at the right phase', () => {
  const { s, a } = mk(), c = s.addClip(a, src(4), 2, { off: 1, dur: 1.5 }); s.setLoop(c, true); c.dur = 6;
  const ctx = fakeCtx(); AS.buildGraph(ctx, { connect() {} }, s, 4.25, 10); const bs = ctx.all.find((x) => x.type === 'src');
  assert(bs.loop); near(bs.loopStart, 1); near(bs.loopEnd, 2.5);
  near(bs.args[0], 10); near(bs.args[1], 1 + ((4.25 - 2) % 1.5)); near(bs.args[2], 6 - 2.25);
});
ok('graph: a frozen track plays its one render (no clip sources, no track effects)', () => {
  const { s, a } = mk(); s.addClip(a, src(2), 0); s.addClip(a, src(2), 3); a.fx = [AS.rack.newFx('gain', { db: -6 })];
  a.frozen = { src: src(6) }; const ctx = fakeCtx(); AS.buildGraph(ctx, { connect() {} }, s, 1, 0);
  const srcs = ctx.all.filter((x) => x.type === 'src'); assert.strictEqual(srcs.length, 1); near(srcs[0].args[1], 1, 1e-9, 'offset = play position'); near(srcs[0].args[2], 5);
  assert(!ctx.all.some((x) => x.type === 'gain' && Math.abs(x.gain.value - AS.dsp.fromDb(-6)) < 1e-6), 'track rack bypassed');
});
ok('frozen tracks never receive new clips; save / open keeps freeze, loop, lock, group, colour', () => {
  const { s, a, b } = mk(); a.frozen = { src: src(1) }; assert.strictEqual(s.audioTrackAt(0), b);
  const c = s.addClip(b, src(3), 0.5); s.setLoop(c, true); c.locked = true; c.color = '#ff8a50'; s.group([c.id]);
  const s2 = AS.sessionIO.deserialize(J(AS.sessionIO.serialize(s))), a2 = s2.tracks[0], c2 = s2.tracks[1].clips[0];
  assert(a2.frozen && a2.frozen.src.ch[0].length === sr, 'frozen render'); assert(c2.loop && c2.locked && c2.color === '#ff8a50' && c2.group);
});
/* ---------- roadmap-missing 11: track order and clip stacking ----------
   A tiny offline renderer for the graph buildGraph makes (gain / stereo panner / buffer source with automation):
   enough to compare mixdowns sample by sample in Node. live = true builds it the way live playback does. */
class SimParam {
  constructor(v) { this.value = v; this.ev = []; }
  add(e) { this.ev.push(e); this.ev.sort((a, b) => a.t - b.t); return this; }
  setValueAtTime(v, t) { return this.add({ k: 'set', v, t }); }
  linearRampToValueAtTime(v, t) { return this.add({ k: 'ramp', v, t }); }
  setValueCurveAtTime(arr, t, d) { this.add({ k: 'curve', arr: Array.from(arr), t, d }); return this.add({ k: 'set', v: arr[arr.length - 1], t: t + d, tail: true }); }
  at(t) {
    let prev = { v: this.value, t: 0 };
    for (const e of this.ev) {
      if (e.k === 'curve') { if (t >= e.t && t < e.t + e.d) { const u = ((t - e.t) / e.d) * (e.arr.length - 1), i = Math.floor(u); return e.arr[i] + (e.arr[Math.min(i + 1, e.arr.length - 1)] - e.arr[i]) * (u - i); } continue; }
      if (e.t <= t) { prev = e; continue; }
      return e.k === 'ramp' ? prev.v + (e.v - prev.v) * ((t - prev.t) / (e.t - prev.t)) : prev.v;
    }
    return prev.v;
  }
}
function simCtx(live) {
  const node = (type, x) => ({ type, ins: [], connect(d) { if (d && d.ins) d.ins.push(this); return d; }, disconnect() {}, ...x });
  const base = { currentTime: 0, sampleRate: sr, createGain: () => node('gain', { gain: new SimParam(1) }), createStereoPanner: () => node('pan', { pan: new SimParam(0) }), createBufferSource: () => node('src', { start(when, off, dur) { this.when = when; this.off = off; this.dur = dur; } }), createChannelSplitter: () => node('split'), createChannelMerger: () => node('merge'), createAnalyser: () => node('an', { getFloatTimeDomainData() {} }), createBiquadFilter: () => node('bq', { frequency: new SimParam(0), Q: new SimParam(0) }) };
  return live ? Object.assign(Object.create(sb.AudioContext.prototype), base) : base;
}
/* signal of a node at time t: [L, R] (a mono source is simply copied to both sides — a simplification; the tests compare mixes) */
function sig(n, t) {
  if (n.type === 'src') {
    if (t < n.when || t >= n.when + n.dur) return [0, 0];
    const b = n.buffer, i = Math.floor((t - n.when + n.off) * b.sampleRate + 1e-6), v = (c) => b.getChannelData(Math.min(c, b.numberOfChannels - 1))[i] || 0; return [v(0), v(1)];
  }
  if (n.type === 'split' || n.type === 'an') return [0, 0];
  let L = 0, R = 0; for (const x of n.ins) { const [a, b] = sig(x, t); L += a; R += b; }
  if (n.type === 'gain') { const g = n.gain.at(t); return [L * g, R * g]; }
  if (n.type === 'pan') { const p = n.pan.at(t); if (p <= 0) { const x = (p + 1) * Math.PI / 2; return [L + R * Math.cos(x), R * Math.sin(x)]; } const x = p * Math.PI / 2; return [L * Math.cos(x), R + L * Math.sin(x)]; }
  return [L, R];
}
function simMix(s, live, from, to) {
  const ctx = simCtx(live), dest = { type: 'dest', ins: [] }; AS.buildGraph(ctx, dest, s, 0, 0);
  const out = []; for (let t = from || 0; t < (to || s.duration) - 1e-9; t += 1 / sr) out.push(sig(dest, t).map((v) => +v.toFixed(9)));
  return out;
}
const val = (x) => AS.makeSource('v' + x, sr, [new Float32Array(sr * 20).fill(x)]);
/* A (clips, panned, routed to the bus) · B (clips, send to the bus) · Bus (gain) · C (clips) */
function rich() {
  const s = new AS.Session(); s.tracks = [];
  const a = s.addTrack('A'), b = s.addTrack('B'), bus = s.addBus('Bus'), c = s.addTrack('C');
  a.pan = -0.4; a.vol = -3; a.out = bus.id; a.color = '#123456'; a.auto.vol = [{ t: 0, v: -3 }, { t: 2, v: -9 }];
  b.pan = 0.5; AS.routing.addSend(s, b, bus.id).db = -6; bus.vol = -2;
  c.vol = -1; c.mute = false; s.addClip(a, val(0.3), 0, { dur: 2 }); s.addClip(b, val(0.2), 0.5, { dur: 2 }); s.addClip(c, val(0.1), 1, { dur: 1.5, gain: -2 });
  return { s, a, b, bus, c };
}
const ids = (s) => s.tracks.map((t) => t.name).join(',');
ok('Move Track: moveTracks / shiftTracks (up, down, top, bottom; several tracks keep their order)', () => {
  const { s, a, b, bus, c } = rich();
  assert(s.moveTracks([c.id], 0)); assert.strictEqual(ids(s), 'C,A,B,Bus');
  assert(s.moveTracks([c.id], 4)); assert.strictEqual(ids(s), 'A,B,Bus,C');
  assert(!s.moveTracks([c.id], 4), 'no change → false (no undo step)');
  assert(s.moveTracks([a.id, bus.id], 4)); assert.strictEqual(ids(s), 'B,C,A,Bus', 'two tracks, order kept');
  assert(s.shiftTracks([a.id, bus.id], 'up')); assert.strictEqual(ids(s), 'B,A,Bus,C');
  assert(!s.shiftTracks([b.id], 'up'), 'already at the top'); assert(s.shiftTracks([b.id, bus.id], 'down')); assert.strictEqual(ids(s), 'A,B,C,Bus');
  assert(s.shiftTracks([c.id], 'top')); assert.strictEqual(ids(s), 'C,A,B,Bus'); assert(s.shiftTracks([c.id, a.id], 'bottom')); assert.strictEqual(ids(s), 'B,Bus,C,A');
});
ok('moving tracks keeps routing, sends, sidechain keys, automation, colour, freeze; the mixdown is identical (offline and live)', () => {
  const { s, a, b, bus, c } = rich(); c.fx = [AS.rack.newFx('gain', { db: 0 })]; c.fx[0].p.sc = b.id; // a sidechain key reference
  const before = simMix(s, false), beforeLive = simMix(s, true);
  assert.deepStrictEqual(beforeLive, before, 'live graph = offline graph');
  assert(before.some(([l, r]) => Math.abs(l - r) > 0.01) && before.some(([l]) => l > 0.1), 'the test mix is not trivial');
  s.moveTracks([bus.id], 0); s.moveTracks([a.id], 4); assert.strictEqual(ids(s), 'Bus,B,C,A');
  assert(a.out === bus.id && b.sends[0].to === bus.id && b.sends[0].db === -6 && c.fx[0].p.sc === b.id && a.color === '#123456' && a.auto.vol.length === 2);
  assert.deepStrictEqual(simMix(s, false), before, 'mixdown unchanged'); assert.deepStrictEqual(simMix(s, true), before, 'live unchanged');
  a.frozen = { src: val(0.25) }; const fz = simMix(s, false); s.shiftTracks([a.id], 'top'); assert(a.frozen); assert.deepStrictEqual(simMix(s, false), fz, 'frozen track moved');
});
ok('Undo / Redo of a track move; .asession keeps the new order', () => {
  const { s, c } = rich(); s.push(); s.moveTracks([c.id], 0); assert.strictEqual(ids(s), 'C,A,B,Bus');
  s.undo(); assert.strictEqual(ids(s), 'A,B,Bus,C'); s.redo(); assert.strictEqual(ids(s), 'C,A,B,Bus');
  const s2 = AS.sessionIO.deserialize(J(AS.sessionIO.serialize(s))); assert.strictEqual(ids(s2), 'C,A,B,Bus'); assert.strictEqual(s2.tracks[2].sends[0].to, s2.tracks[3].id);
});
/* one track: a long clip X (0.5) and a short clip Y (0.2) on top of its middle */
function stack(settings) {
  const s = new AS.Session(); s.tracks = []; const t = s.addTrack('T'); Object.assign(s.opts, settings || {});
  const x = s.addClip(t, val(0.5), 0, { dur: 4 }), y = s.addClip(t, val(0.2), 1, { dur: 1 }); s.place(t, y);
  return { s, t, x, y };
}
const at = (mix, t) => mix[Math.round(t * sr)][0];
ok('stacking: the front clip is what is heard where clips overlap; Bring to Front / Send to Back change it', () => {
  const { s, t, x, y } = stack(); assert(y.z > x.z, 'a new clip goes in front');
  let m = simMix(s); near(at(m, 0.5), 0.5, 1e-6, 'X alone'); near(at(m, 1.5), 0.2, 1e-6, 'Y in front: only Y'); near(at(m, 3), 0.5, 1e-6);
  assert.deepStrictEqual(J(s.hiddenRanges(t, x)), [[1, 2]]); assert.deepStrictEqual(J(s.hiddenRanges(t, y)), []);
  s.stackBack([y.id]); m = simMix(s); near(at(m, 1.5), 0.5, 1e-6, 'Y sent to the back: X covers it');
  s.stackFront([y.id]); m = simMix(s); near(at(m, 1.5), 0.2, 1e-6, 'Y brought to the front');
  const ramp = at(m, 1.001); assert(ramp > 0.2 && ramp < 0.7, 'short ramp at the edge, no click: ' + ramp);
  assert.deepStrictEqual(simMix(s, true), m, 'live = offline');
  const g = simMix(s, false, 1.2, 1.4); assert(g.every(([l]) => Math.abs(l - 0.2) < 1e-6), 'playback started inside the covered part');
});
ok('stacking + Overlap policy: a partial overlap stays an automatic crossfade (both blended), the stacking order decides only the covered rest', () => {
  const s = new AS.Session(); s.tracks = []; const t = s.addTrack('T'), a = s.addClip(t, val(0.5), 0, { dur: 4 }), b = s.addClip(t, val(0.5), 3, { dur: 4 }); s.place(t, b);
  assert.deepStrictEqual(J(s.hiddenRanges(t, a)), [], 'crossfade partner not muted'); const m = simMix(s);
  for (const tt of [3.1, 3.5, 3.9]) near(at(m, tt), 0.5, 1e-3, 'constant level through the crossfade at ' + tt);
  s.opts.xfade = false; s.applyCrossfades(t); assert.deepStrictEqual(J(s.hiddenRanges(t, a)), [[3, 4]], 'crossfades off: the front clip covers');
});
ok('stacking + Overwrite policy: nothing is cut any more — the covered audio comes back when the front clip moves or is sent back', () => {
  const { s, t, x, y } = stack({ overlap: 'overwrite' }); assert.strictEqual(t.clips.length, 2); near(x.dur, 4); near(x.off, 0);
  assert.strictEqual(s.crossfades(t).length, 0, 'no crossfades in Overwrite');
  near(at(simMix(s), 1.5), 0.2, 1e-6); y.start = 6; s.place(t, y); near(at(simMix(s, false, 0, 4), 1.5), 0.5, 1e-6, 'moved away: X plays again');
  y.start = 1; s.place(t, y); s.stackBack([y.id]); near(at(simMix(s), 1.5), 0.5, 1e-6, 'sent to the back: X heard');
  const z = s.addClip(t, val(0.1), 0.5, { dur: 1 }); s.place(t, z); assert(z.z === s.topZ(), 'a placed clip goes in front');
});
ok('stacking: undo / redo; z saved in .asession; sessions from before open with the old sound (overlapping clips summed)', () => {
  const { s, x, y } = stack(); s.push(); s.stackBack([y.id]); assert(y.z < x.z); s.undo(); assert(s.findClip(y.id).c.z > s.findClip(x.id).c.z); s.redo(); assert(s.findClip(y.id).c.z < s.findClip(x.id).c.z);
  const j = J(AS.sessionIO.serialize(s)); assert(j.settings.stack === true && j.tracks[0].clips.every((c) => typeof c.z === 'number'));
  const s2 = AS.sessionIO.deserialize(j); near(at(simMix(s2), 1.5), 0.5, 1e-6, 'order kept after save / open');
  const old = J(j); delete old.settings.stack; for (const c of old.tracks[0].clips) delete c.z;
  const so = AS.sessionIO.deserialize(old); assert.strictEqual(so.opts.stack, false); assert.deepStrictEqual(J(so.tracks[0].clips.map((c) => c.z)), [1, 2], 'z from the clip order');
  near(at(simMix(so), 1.5), 0.7, 1e-6, 'old session: X + Y summed, as before');
  so.stackFront([so.tracks[0].clips[0].id]); assert.strictEqual(so.opts.stack, true); near(at(simMix(so), 1.5), 0.5, 1e-6, 'using stacking turns it on');
});
ok('punch-in recording still replaces what was under it (cutUnder)', () => {
  const s = new AS.Session(); s.tracks = []; const t = s.addTrack('T'); s.addClip(t, val(0.5), 0, { dur: 10 }); const c = s.addClip(t, val(0.2), 4, { dur: 2 }); s.cutUnder(t, c);
  assert.deepStrictEqual(starts(t), [0, 4, 6]); near(at(simMix(s), 5), 0.2, 1e-6);
});
done();

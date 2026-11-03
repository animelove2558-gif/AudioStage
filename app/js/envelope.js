/* Clip Volume & Pan envelopes (Audition-style "rubber bands" drawn across multitrack clips).
   This module holds the data model, the interpolation and the Web Audio scheduling;
   drawing and mouse handling live in multitrack.js (MultiView), the audio graph in buildGraph().

   Example (what multitrack.js / buildGraph do):
     const E = AS.env, env = E.of(clip);                 // { volume: [{t, v}], pan: [{t, v}] }
     E.addPoint(env.volume, 2.0, 0.5, clip.dur);         // -6 dB at 2 s into the clip
     E.addPoint(env.pan, 4.0, -1, clip.dur);             // hard left at 4 s
     E.valueAt(env.volume, 1.0, E.KINDS.volume.dflt);    // -> 0.75 (linear between 1.0 @ start and 0.5 @ 2 s)
     // playback: one GainNode + one StereoPannerNode per clip
     const out = E.build(ctx, clip, clipGainNode, rel0, when, AS.engine.envNodes); // -> GainNode (+ StereoPannerNode)
     // after an edit while playing: re-plan from the playhead without restarting playback
     if (E.liveUpdate(clip) === 'rebuild') app.multiChanged(true);
*/
(function (root) {
  'use strict';
  const AS = (root.AS = root.AS || {});
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

  /* ---------- 1. data model ----------
     clip.env = { volume: [{t, v}, ...], pan: [{t, v}, ...] }
       t — seconds from the clip's start (0 … clip.dur)
       v — volume: linear gain 0.0 … 2.0 (1.0 = 0 dB, 2.0 ≈ +6 dB) · pan: -1.0 (left) … +1.0 (right), 0 = centre
     An empty list means "flat at the default value". Lists are always kept sorted by t. */
  const KINDS = {
    volume: { min: 0, max: 2, dflt: 1, snap: 0.02, color: '#FFD700', label: 'Volume' },
    pan: { min: -1, max: 1, dflt: 0, snap: 0.03, color: '#00E5FF', label: 'Pan' },
  };
  const empty = () => ({ volume: [], pan: [] });

  /* the clip's envelope, created / normalised in place.
     Sessions saved by older builds stored volume in dB as env.vol (-60 … +12); convert those to linear gain. */
  function of(c) {
    let e = c.env;
    if (!e) e = c.env = empty();
    if (e.vol) {
      if (!e.volume) e.volume = e.vol.map((p) => ({ t: p.t, v: clamp(Math.pow(10, p.v / 20), 0, 2) }));
      delete e.vol;
    }
    if (!e.volume) e.volume = [];
    if (!e.pan) e.pan = [];
    return e;
  }

  /* ---------- 2. interpolation ----------
     linear between neighbouring keyframes, held flat before the first and after the last one */
  function valueAt(pts, t, dflt) {
    if (!pts || !pts.length) return dflt;
    if (t <= pts[0].t) return pts[0].v;
    for (let i = 1; i < pts.length; i++) {
      if (t <= pts[i].t) { const a = pts[i - 1], b = pts[i], u = (t - a.t) / Math.max(1e-9, b.t - a.t); return a.v + (b.v - a.v) * u; }
    }
    return pts[pts.length - 1].v;
  }

  /* ---------- 3. editing (all clamp to the clip length and the value range) ---------- */
  function snapValue(kind, v) { const k = KINDS[kind]; v = clamp(v, k.min, k.max); return Math.abs(v - k.dflt) < k.snap ? k.dflt : v; }
  /* insert a keyframe, returns its index */
  function addPoint(pts, t, v, dur, kind) {
    const p = { t: clamp(t, 0, dur), v: kind ? snapValue(kind, v) : v };
    let i = pts.findIndex((q) => q.t > p.t); if (i < 0) i = pts.length;
    pts.splice(i, 0, p); return i;
  }
  /* move keyframe i; time stays between its neighbours (so the order never changes) and inside the clip */
  function movePoint(pts, i, t, v, dur, kind) {
    const lo = i > 0 ? pts[i - 1].t : 0, hi = i < pts.length - 1 ? pts[i + 1].t : dur;
    pts[i].t = clamp(t, lo, Math.max(lo, hi)); pts[i].v = snapValue(kind, v);
  }
  function removePoint(pts, i) { if (i >= 0 && i < pts.length) pts.splice(i, 1); }
  /* split at clip-relative time rel: [left part, right part re-referenced to the new clip start] */
  function split(pts, rel, dflt) {
    if (!pts || !pts.length) return [[], []];
    const v = valueAt(pts, rel, dflt);
    return [[...pts.filter((p) => p.t < rel), { t: rel, v }], [{ t: 0, v }, ...pts.filter((p) => p.t > rel).map((p) => ({ t: p.t - rel, v: p.v }))]];
  }
  /* clip start moved by +delta (left trim): re-reference the points and keep the value at the new boundary */
  function shift(pts, delta, newDur, dflt) {
    if (!pts || !pts.length) return [];
    const v0 = valueAt(pts, delta, dflt), out = pts.filter((p) => p.t - delta > 0.0005 && p.t - delta < newDur + 1e-6).map((p) => ({ t: p.t - delta, v: p.v }));
    if (delta > 0) out.unshift({ t: 0, v: v0 });
    return out;
  }
  /* human-readable value for the on-canvas readout */
  function format(kind, v) {
    if (kind === 'pan') return Math.abs(v) < 0.005 ? 'C' : (v < 0 ? 'L' : 'R') + Math.round(Math.abs(v) * 100);
    return v <= 0.0001 ? '-∞ dB' : (v >= 1 ? '+' : '') + (20 * Math.log10(v)).toFixed(1) + ' dB';
  }

  /* ---------- 4. audio engine ----------
     The values are planned ahead on the AudioParam timeline (sample-accurate linear ramps run on the audio thread),
     so the playback stays smooth even if the UI thread is busy. */
  /* plan the whole envelope: clip-relative time rel0 plays at context time `when` */
  function schedule(param, pts, rel0, when, dflt) {
    param.setValueAtTime(valueAt(pts, rel0, dflt), when);
    for (const p of pts || []) if (p.t > rel0) param.linearRampToValueAtTime(p.v, when + (p.t - rel0));
  }
  const GLIDE = 0.02; // s — short ramp from the value currently sounding to the edited curve (no zipper / clicks)
  /* re-plan a param that is already playing after the envelope was edited: computes the value at the playhead
     (ctx.currentTime), glides there and continues with the remaining keyframes */
  function reschedule(param, pts, rel0, when, dflt, ctx) {
    const now = ctx.currentTime;
    if (now < when) { param.cancelScheduledValues(now); schedule(param, pts, rel0, when, dflt); return; } // clip not reached yet
    const rel = rel0 + (now - when), ta = now + GLIDE;
    if (param.cancelAndHoldAtTime) param.cancelAndHoldAtTime(now);
    else { const cur = param.value; param.cancelScheduledValues(now); param.setValueAtTime(cur, now); }
    param.linearRampToValueAtTime(valueAt(pts, rel + GLIDE, dflt), ta);
    for (const p of pts || []) if (p.t > rel + GLIDE) param.linearRampToValueAtTime(p.v, when + (p.t - rel0));
  }
  /* create the envelope nodes for a clip: input -> volume GainNode -> [StereoPannerNode] -> returned node.
     The gain node is always there (gain 1 is neutral). The panner is only added when the clip has pan keyframes,
     because a centred StereoPanner is not neutral for mono clips (it would change how they are up-mixed).
     store (live playback only) remembers the params so edits can be applied while playing. */
  function build(ctx, c, input, rel0, when, store) {
    const e = of(c), vg = ctx.createGain(); let out = vg, pan = null;
    schedule(vg.gain, e.volume, rel0, when, KINDS.volume.dflt); input.connect(vg);
    if (e.pan.length) { const pn = ctx.createStereoPanner(); schedule(pn.pan, e.pan, rel0, when, KINDS.pan.dflt); vg.connect(pn); out = pn; pan = pn.pan; }
    if (store) store[c.id] = { volume: vg.gain, pan, rel0, when };
    return out;
  }
  /* apply an edited envelope to the running playback without restarting it.
     Returns 'ok' when applied, 'idle' when the clip is not playing (nothing to do),
     'rebuild' when the graph lacks a node it now needs (first pan keyframe added) — the caller restarts playback. */
  function liveUpdate(c) {
    const eng = AS.engine;
    if (!eng || !eng.playing || !eng.envNodes) return 'idle';
    const n = eng.envNodes[c.id]; if (!n) return 'idle';
    const e = of(c);
    if (!n.pan && e.pan.length) return 'rebuild';
    reschedule(n.volume, e.volume, n.rel0, n.when, KINDS.volume.dflt, eng.ctx);
    if (n.pan) reschedule(n.pan, e.pan, n.rel0, n.when, KINDS.pan.dflt, eng.ctx);
    return 'ok';
  }

  AS.env = { KINDS, empty, of, valueAt, snapValue, addPoint, movePoint, removePoint, split, shift, format, schedule, reschedule, build, liveUpdate };
})(window);

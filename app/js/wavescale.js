/* Dynamic Waveform Scaling — multitrack clip waveforms drawn at the loudness they will actually play at:
   source peaks × volume envelope × fades × clip gain. Purely visual: the audio buffers and the Peaks data are
   only read, never modified; the multiplier is applied to the y coordinates while drawing.

   Pipeline per clip (MultiView.drawClip):
     1. columns()          raw min/max of the source under each screen column   — cached, envelope-independent
     2. clipMultipliers()  gain per column: envelope (linear interpolation) × fade × clip gain
     3. drawColumns()      one rect per column, height scaled by the multiplier, clamped to the clip box

   Example — what MultiView.drawClip does:
     const W = AS.wavescale, view = { t0: this.t0, pps: this.pps };
     const xa = Math.floor(Math.max(0, x0)), xb = Math.ceil(Math.min(this.W, x1));
     const cols = W.columns(c, srcPeaks(c.src), xa, xb, view);
     const mult = W.clipMultipliers(c, xa, xb - xa, view, AS.fadeGainAt, D.fromDb(c.gain));
     g.fillStyle = track.color; W.drawColumns(g, cols, mult, yc, amp, yTop, yBot);
   Dragging a volume keyframe only changes step 2, so MultiView.redrawClip() repaints that one clip with cached columns.
*/
(function (root) {
  'use strict';
  const AS = (root.AS = root.AS || {});

  /* ---------- 1. raw peak columns (cached per clip) ----------
     min / max of the source audio (all channels) under each screen column x in [xa, xb).
     They depend on the clip placement and the zoom only — not on the envelope — so they survive keyframe drags.
     WeakMap: nothing is added to the clip object (sessions / undo snapshots stay clean). */
  const cache = new WeakMap(); // clip -> { src, key, x0, n, lo, hi }
  /* src (default c.src) = the audio whose peaks `pk` are; scale = timeline seconds per second of that audio (a
     time-stretched clip drawn from its original audio while the stretched version is still rendering) */
  function columns(c, pk, xa, xb, view, src, scale) {
    src = src || c.src; scale = scale || 1;
    const lp = c.loop && c.loopLen > 0 ? c.loopLen : 0, lo0 = lp ? c.loopOff : 0; // looped clip: the unit repeats
    const n = Math.max(0, xb - xa), key = [c.off, c.dur, c.start, view.t0, view.pps, xa, n, scale, lp, lo0].join('|');
    let e = cache.get(c);
    if (e && e.src === src && e.key === key) return e;
    const lo = new Float32Array(n), hi = new Float32Array(n), sr = src.sr / scale, step = 1 / view.pps;
    for (let i = 0; i < n; i++) {
      let tt = c.off + (view.t0 + (xa + i) / view.pps - c.start);
      if (lp) tt = lo0 + ((((tt - lo0) % lp) + lp) % lp);
      const s0 = tt * sr, s1 = (tt + step) * sr;
      let l = 1, h = -1;
      for (let ch = 0; ch < pk.chs.length; ch++) { const r = pk.range(ch, s0, s1); if (!r) continue; if (r[0] < l) l = r[0]; if (r[1] > h) h = r[1]; }
      lo[i] = l; hi[i] = h; // h < l = no audio under this column
    }
    e = { src, key, x0: xa, n, lo, hi }; cache.set(c, e);
    return e;
  }

  /* ---------- 2. amplitude multipliers ----------
     Volume envelope sampled at n evenly spaced clip-relative times rel0, rel0 + step, …
     Linear interpolation between keyframes (held flat before the first / after the last one), same curve as
     AS.env.valueAt — but one forward walk over the keyframes instead of a search per column: O(n + keyframes). */
  function envelopeMultipliers(pts, dflt, rel0, step, n, out) {
    if (!out || out.length < n) out = new Float32Array(n);
    if (!pts || !pts.length) { out.fill(dflt, 0, n); return out; }
    const last = pts.length - 1; let j = 0;
    for (let i = 0; i < n; i++) {
      const t = rel0 + i * step;
      if (t <= pts[0].t) { out[i] = pts[0].v; continue; }
      if (t >= pts[last].t) { out[i] = pts[last].v; continue; }
      while (j < last - 1 && pts[j + 1].t < t) j++; // times only increase, so j only moves forward
      const a = pts[j], b = pts[j + 1], u = (t - a.t) / Math.max(1e-9, b.t - a.t);
      out[i] = a.v + (b.v - a.v) * u;
    }
    return out;
  }
  let scratch = new Float32Array(4096); // reused between draws (the result is consumed immediately)
  /* full per-column multiplier for a clip: volume envelope × fade gain × clip gain (linear) */
  function clipMultipliers(c, xa, n, view, fadeAt, gainLin) {
    if (scratch.length < n) scratch = new Float32Array(n * 2);
    const rel0 = view.t0 + xa / view.pps - c.start, step = 1 / view.pps;
    const m = envelopeMultipliers(AS.env.of(c).volume, AS.env.KINDS.volume.dflt, rel0, step, n, scratch);
    for (let i = 0; i < n; i++) m[i] *= fadeAt(c, rel0 + i * step) * gainLin;
    return m.subarray(0, n); // exactly n values (the scratch buffer behind it is reused by the next call)
  }

  /* ---------- 3. drawing ----------
     One 1-px rect per column around the centre line yc; half-height = amp × multiplier.
     gain > 1 → taller, gain < 1 → flatter, gain 0 → 1-px flat line. Clamped to [yTop, yBot] so a boosted clip
     never paints over its neighbours. The caller sets fillStyle. */
  function drawColumns(g, cols, mult, yc, amp, yTop, yBot) {
    const { lo, hi, n, x0 } = cols;
    g.beginPath();
    for (let i = 0; i < n; i++) {
      if (hi[i] < lo[i]) continue;
      const k = amp * mult[i];
      let a = yc - hi[i] * k, b = yc - lo[i] * k;
      if (b - a < 1) { a -= 0.5; b += 0.5; } // keep silence / gain 0 visible as a flat line
      a = Math.min(Math.max(a, yTop), yBot - 1); b = Math.min(Math.max(b, a + 1), yBot);
      g.rect(x0 + i, a, 1, b - a);
    }
    g.fill();
  }

  AS.wavescale = { columns, envelopeMultipliers, clipMultipliers, drawColumns };
})(window);

/* Playback extras: Skip Selection / Preview Edit / marker playlists (segments played back to back), Shuttle (J/K/L)
   and Scrub. Pure position logic here (tested in Node); the Web Audio parts take a context. */
(function (root) {
  'use strict';
  const AS = (root.AS = root.AS || {});

  /* segments [[a, b), …] in samples, played back to back: total length and the source position after el seconds */
  function segMap(segs, sr) {
    const list = segs.filter(([a, b]) => b > a), total = list.reduce((s, [a, b]) => s + b - a, 0);
    return {
      segs: list, total: total / sr,
      at(el) {
        let n = Math.max(0, el * sr);
        for (let i = 0; i < list.length; i++) { const [a, b] = list[i], len = b - a; if (n < len || i === list.length - 1) return (a + Math.min(n, len)) / sr; n -= len; }
        return 0;
      },
    };
  }
  /* Skip Selection: play from `from` to the end without the selected range (from inside the selection = from its end) */
  function skipSegments(len, sel, from) {
    const f = Math.max(0, Math.min(len, from));
    if (!(sel && sel.b > sel.a) || f >= sel.b) return [[f, len]].filter(([a, b]) => b > a);
    return [[f, sel.a], [Math.max(f, sel.b), len]].filter(([a, b]) => b > a);
  }
  /* Preview Edit: the pre-roll before the selection, then straight into the post-roll after it — how the cut will sound */
  function previewSegments(len, sel, preSamples, postSamples) {
    return [[Math.max(0, sel.a - preSamples), sel.a], [sel.b, Math.min(len, sel.b + postSamples)]].filter(([a, b]) => b > a);
  }
  /* playlist entries [{a, b, loops}] → segments */
  function playlistSegments(entries) {
    const out = []; for (const e of entries) for (let k = 0; k < Math.max(1, e.loops | 0); k++) out.push([e.a, e.b]); return out;
  }

  /* Shuttle: L forward, J reverse, K stop. Pressing the same direction again doubles the speed (1, 2, 4, 8×);
     with K held, J / L play at half speed. Returns the new rate (negative = reverse, 0 = stopped). */
  function shuttleNext(cur, key, kHeld) {
    if (key === 'k') return 0;
    const dir = key === 'l' ? 1 : -1;
    if (kHeld) return dir * 0.5;
    if (Math.sign(cur) !== dir || Math.abs(cur) < 1) return dir;
    return dir * Math.min(8, Math.abs(cur) * 2);
  }
  /* Scrub: the playback rate of a grain from how fast the playhead was dragged (source samples moved in dt seconds) */
  function scrubRate(dSamples, dt, sr) {
    if (!(dt > 0) || !dSamples) return 0;
    const r = dSamples / sr / dt, a = Math.min(4, Math.max(0.25, Math.abs(r)));
    return r < 0 ? -a : a;
  }

  /* ---- Web Audio helpers ---- */
  const revCache = new WeakMap();
  /* the buffer played backwards (cached per buffer) */
  function reversed(buf) {
    let r = revCache.get(buf); if (r) return r;
    r = new AudioBuffer({ numberOfChannels: buf.numberOfChannels, length: buf.length, sampleRate: buf.sampleRate });
    for (let c = 0; c < buf.numberOfChannels; c++) { const x = buf.getChannelData(c), y = r.getChannelData(c), L = x.length; for (let i = 0; i < L; i++) y[i] = x[L - 1 - i]; }
    revCache.set(buf, r); return r;
  }
  /* play buf at `rate` (negative = backwards) from position pos (seconds), starting at context time t0 */
  function playRate(ctx, dest, buf, rate, pos, t0) {
    const s = ctx.createBufferSource(), back = rate < 0;
    s.buffer = back ? reversed(buf) : buf; s.playbackRate.value = Math.abs(rate); s.connect(dest);
    s.start(t0, Math.max(0, Math.min(buf.duration, back ? buf.duration - pos : pos)));
    return s;
  }
  /* segments of buf back to back, sample-exact on the context clock; returns the sources */
  function playSegments(ctx, dest, buf, segs, t0) {
    const sr = buf.sampleRate, out = []; let t = t0;
    for (const [a, b] of segs) { if (b <= a) continue; const s = ctx.createBufferSource(); s.buffer = buf; s.connect(dest); s.start(t, a / sr, (b - a) / sr); out.push(s); t += (b - a) / sr; }
    return out;
  }
  /* one scrub grain: `dur` seconds of buf at pos (seconds) and rate, with short fades */
  function grain(ctx, dest, buf, pos, rate, dur) {
    const d = dur || 0.08, t = ctx.currentTime + 0.005, g = ctx.createGain(), s = playRate(ctx, g, buf, rate || 1, pos, t);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(1, t + 0.008); g.gain.setValueAtTime(1, t + d - 0.012); g.gain.linearRampToValueAtTime(0, t + d);
    g.connect(dest); s.stop(t + d + 0.01); s.onended = () => { try { g.disconnect(); } catch (e) { /* */ } };
    return s;
  }

  AS.playx = { segMap, skipSegments, previewSegments, playlistSegments, shuttleNext, scrubRate, reversed, playRate, playSegments, grain };
})(typeof window !== 'undefined' ? window : globalThis);

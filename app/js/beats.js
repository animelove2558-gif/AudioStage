/* Transient detection for "Separate at Transients" and "Conform to Grid": energy rise per short frame against the recent average.
   Pure functions, tested in Node. */
(function (root) {
  'use strict';
  const AS = (root.AS = root.AS || {});
  /* chs: Float32Array[] (or subarrays), sr → onset times in seconds, in order.
     o: { sensitivity 0..1 (default 0.5), minGap seconds (default 0.06) } */
  function onsets(chs, sr, o) {
    const oo = o || {}, sens = oo.sensitivity === undefined ? 0.5 : oo.sensitivity, gap = oo.minGap === undefined ? 0.06 : oo.minGap;
    const hop = Math.max(32, Math.round(sr * 0.005)), n = chs[0].length, frames = Math.floor(n / hop); if (frames < 4) return [];
    const e = new Float32Array(frames);
    for (let f = 0; f < frames; f++) { let s = 0; const a = f * hop; for (const c of chs) for (let i = a; i < a + hop; i++) s += c[i] * c[i]; e[f] = Math.sqrt(s / (hop * chs.length)); }
    const ratio = 1.5 + (1 - sens) * 4, floor = 0.002 + (1 - sens) * 0.02, back = Math.round(0.05 / (hop / sr)), out = []; let last = -Infinity;
    for (let f = 1; f < frames; f++) {
      let m = 0, k = 0; for (let j = Math.max(0, f - back); j < f; j++) { m += e[j]; k++; } m = k ? m / k : 0;
      if (e[f] < floor || e[f] < m * ratio) continue;
      const t = (f * hop) / sr; if (t - last < gap) continue;
      if (f < 3 && m === 0 && e[f] === e[0]) continue;
      out.push(t); last = t;
    }
    return out;
  }
  /* clip start positions moved to the nearest grid line. items: [{ start }], snap(t) → grid time. Returns new starts; order and overlap are left to the caller. */
  const conform = (items, snap) => items.map((c) => Math.max(0, snap(c.start)));
  AS.beats = { onsets, conform };
})(typeof window !== 'undefined' ? window : globalThis);

/* Spectral Frequency Display settings (FFT size, window, dB range, colour map, pitch overlay) and drawing of
   spectral selections (marquee, lasso, brush, harmonics) on the waveform view. */
(function (root) {
  'use strict';
  const AS = (root.AS = root.AS || {});
  const KEY = 'as-spectral';
  const FFTS = [256, 512, 1024, 2048, 4096, 8192, 16384];
  const COLORMAPS = {
    audition: ['Audition', [[0, 0, 0, 0], [0.18, 40, 0, 90], [0.4, 150, 0, 120], [0.6, 235, 60, 30], [0.8, 255, 190, 40], [1, 255, 255, 220]]],
    gray: ['Grayscale', [[0, 0, 0, 0], [1, 255, 255, 255]]],
    viridis: ['Viridis', [[0, 68, 1, 84], [0.25, 59, 82, 139], [0.5, 33, 145, 140], [0.75, 94, 201, 98], [1, 253, 231, 37]]],
    inferno: ['Inferno', [[0, 0, 0, 4], [0.25, 87, 16, 110], [0.5, 188, 55, 84], [0.75, 249, 142, 9], [1, 252, 255, 164]]],
    rainbow: ['Rainbow', [[0, 0, 0, 0], [0.15, 0, 0, 160], [0.35, 0, 160, 255], [0.55, 0, 220, 60], [0.75, 255, 230, 0], [0.9, 255, 60, 0], [1, 255, 255, 255]]],
  };
  const DEFAULTS = { fft: 2048, win: 'hann', dbMin: -100, dbMax: -20, cmap: 'audition', pitch: false };
  let S = { ...DEFAULTS };
  try { S = { ...DEFAULTS, ...(JSON.parse(root.localStorage.getItem(KEY)) || {}) }; } catch (e) { /* defaults */ }
  const luts = {};
  function lut(name) {
    const stops = (COLORMAPS[name] || COLORMAPS.audition)[1];
    if (luts[name]) return luts[name];
    const l = new Uint8ClampedArray(256 * 3);
    for (let i = 0; i < 256; i++) {
      const t = i / 255; let k = 0;
      while (k < stops.length - 2 && t > stops[k + 1][0]) k++;
      const a = stops[k], b = stops[k + 1], u = Math.min(1, Math.max(0, (t - a[0]) / (b[0] - a[0])));
      for (let c = 0; c < 3; c++) l[i * 3 + c] = Math.round(a[c + 1] + (b[c + 1] - a[c + 1]) * u);
    }
    return (luts[name] = l);
  }
  const level = (db, s) => Math.min(1, Math.max(0, (db - s.dbMin) / (s.dbMax - s.dbMin)));
  function set(o) {
    const n = { ...S, ...o };
    if (!FFTS.includes(+n.fft)) n.fft = S.fft; else n.fft = +n.fft;
    if (!(n.win in AS.dsp.WINDOWS)) n.win = S.win;
    if (!(n.cmap in COLORMAPS)) n.cmap = S.cmap;
    n.dbMin = +n.dbMin; n.dbMax = +n.dbMax; if (!(n.dbMax - n.dbMin >= 10)) { n.dbMin = S.dbMin; n.dbMax = S.dbMax; }
    n.pitch = !!n.pitch; S = n;
    try { root.localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { /* */ }
    return S;
  }
  const sig = () => [S.fft, S.win, S.dbMin, S.dbMax, S.cmap].join(',');

  /* draw a spectral selection on lane `lane` of view v (WaveView: s2x, f2y); `fill` and `stroke` styles */
  function drawShape(g, v, sh, lane, fill, stroke) {
    const D = AS.dsp;
    g.save(); g.fillStyle = fill; g.strokeStyle = stroke; g.setLineDash([4, 3]);
    if (!sh.kind || sh.kind === 'rect') {
      const xa = v.s2x(sh.a), xb = v.s2x(sh.b), ya = v.f2y(sh.f1, lane), yb = v.f2y(sh.f0, lane);
      g.fillRect(xa, ya, xb - xa, yb - ya); g.strokeRect(xa + 0.5, ya + 0.5, xb - xa, yb - ya);
    } else if (sh.kind === 'lasso') {
      g.beginPath(); sh.pts.forEach(([s, f], i) => (i ? g.lineTo(v.s2x(s), v.f2y(f, lane)) : g.moveTo(v.s2x(s), v.f2y(f, lane)))); g.closePath(); g.fill(); g.stroke();
    } else if (sh.kind === 'brush') {
      // the dabs as one path so overlapping ones do not darken; radius in pixels from rs (samples) / ro (octaves)
      const rx = sh.rs / v.doc.vs.spp, ry = Math.abs(v.f2y(1000, lane) - v.f2y(1000 * Math.pow(2, sh.ro), lane));
      g.beginPath(); for (const [s, f] of sh.pts) { const x = v.s2x(s), y = v.f2y(f, lane); g.moveTo(x + rx, y); g.ellipse(x, y, Math.max(1, rx), Math.max(1, ry), 0, 0, Math.PI * 2); }
      g.fill(); g.setLineDash([]); g.globalAlpha = 0.6; g.stroke();
    } else if (sh.kind === 'harm') {
      const T = sh.track.filter((p) => p[1] > 0), k = Math.pow(2, sh.bw / 12), nyq = v.doc.sr / 2;
      for (let h = 1; h <= sh.n; h++) {
        if (T.length && T[0][1] * h / k > nyq) break;
        g.beginPath(); T.forEach(([s, f], i) => { const x = v.s2x(s), y = v.f2y(Math.min(nyq, f * h * k), lane); i ? g.lineTo(x, y) : g.moveTo(x, y); });
        for (let i = T.length - 1; i >= 0; i--) g.lineTo(v.s2x(T[i][0]), v.f2y(Math.min(nyq, T[i][1] * h / k), lane));
        g.closePath(); g.fill(); if (h === 1 || sh.n < 12) g.stroke();
      }
    }
    g.restore();
    void D;
  }
  /* a short description of a selection for the status bar */
  function describe(sh, sr) {
    const D = AS.dsp, b = D.shapeBounds(sh), t = (s) => AS.fmtTime ? AS.fmtTime(s / sr) : (s / sr).toFixed(3);
    const k = !sh.kind || sh.kind === 'rect' ? 'Marquee' : sh.kind === 'lasso' ? 'Lasso' : sh.kind === 'brush' ? 'Brush' : 'Harmonics';
    if (sh.kind === 'harm') return `${k}: ${t(b.a)} – ${t(b.b)}, pitch ${Math.round(sh.f0)} Hz` + (sh.n > 1 ? `, ${sh.n} harmonics` : ' (single partial)');
    return `${k}: ${t(b.a)} – ${t(b.b)},  ${Math.round(b.f0)} – ${Math.round(b.f1)} Hz`;
  }

  AS.spectral = { FFTS, COLORMAPS, DEFAULTS, lut, level, set, settings: () => ({ ...S }), sig, drawShape, describe };
})(typeof window !== 'undefined' ? window : globalThis);

// Run: node tests/spectral.test.js — spectral selections (lasso, brush, harmonics), Spot Healing, YIN pitch,
// spectral display settings (FFT size / window / dB range / colour map)
const assert = require('assert');
const { load, ok, done } = require('./_sandbox');
const sb = load(['dsp.js', 'spectral.js']), AS = sb.AS, D = AS.dsp;
const sr = 44100, J = (x) => JSON.parse(JSON.stringify(x));
const tone = (f, a, s0, s1, L) => { const x = new Float32Array(L); for (let i = s0; i < s1; i++) x[i] = a * Math.sin(2 * Math.PI * f * i / sr); return x; };
const add = (...xs) => { const y = new Float32Array(xs[0].length); for (const x of xs) for (let i = 0; i < y.length; i++) y[i] += x[i]; return y; };
/* level (dB) of frequency f around sample c (Goertzel on a Hann window) */
function level(x, f, c, n) {
  n = n || 4096; c = Math.round(c); let re = 0, im = 0;
  for (let i = 0; i < n; i++) { const j = c - n / 2 + i, w = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / n), v = (x[j] || 0) * w; re += v * Math.cos(2 * Math.PI * f * j / sr); im -= v * Math.sin(2 * Math.PI * f * j / sr); }
  return 20 * Math.log10(Math.hypot(re, im) / (n / 4) + 1e-12);
}

ok('shape masks: rect, lasso (polygon in time × log-frequency), brush (soft ellipses), harmonics', () => {
  const r = D.shapeMask({ a: 100, b: 200, f0: 500, f1: 1000 }); assert(r(150, 700) === 1 && r(250, 700) === 0 && r(150, 1100) === 0);
  const tri = { kind: 'lasso', pts: [[0, 100], [1000, 100], [500, 6400]] }, m = D.shapeMask(tri);
  assert(m(500, 400) === 1, 'inside'); assert(m(100, 3000) === 0, 'outside (left of the slanted edge)'); assert(m(500, 50) === 0, 'below');
  const br = D.shapeMask({ kind: 'brush', pts: [[1000, 1000], [2000, 1000]], rs: 300, ro: 0.5 });
  assert(br(1500, 1000) === 0, 'between two dabs that do not overlap'); assert(br(1000, 1000) === 1 && br(2100, 1100) === 1, 'core');
  const edge = br(1000, 1000 * Math.pow(2, 0.45)); assert(edge > 0 && edge < 1, 'soft edge ' + edge); assert(br(1000, 1000 * Math.pow(2, 0.6)) === 0);
  const h = D.shapeMask({ kind: 'harm', track: [[0, 200], [1000, 220]], n: 4, bw: 0.5, hop: 1000 });
  assert(h(0, 400) === 1 && h(0, 800) === 1 && h(1000, 660) === 1, 'harmonics'); assert(h(0, 1000) === 0, 'above n'); assert(h(0, 300) === 0, 'between harmonics');
  assert(h(500, 2 * 210) === 1, 'interpolated pitch'); assert(h(5000, 200) === 0, 'outside the track');
  const b = D.shapeBounds(tri); assert(b.a === 0 && b.b === 1000 && b.f0 === 100 && b.f1 === 6400);
});
ok('Delete with a lasso removes only the region inside it (a box would take more)', () => {
  const L = sr * 2, lo = tone(400, 0.3, 0, L, L), hi = tone(3000, 0.3, 0, L, L), x = add(lo, hi);
  // a parallelogram: 3 kHz is inside around 0.5 s, but the slant leaves it outside around 1.4 s
  const shape = { kind: 'lasso', pts: [[0.2 * sr, 2000], [0.9 * sr, 2000], [1.3 * sr, 4500], [0.6 * sr, 4500]] };
  const y = D.spectralEdit([x], sr, { shape, mode: 'atten', gainDb: -120 })[0];
  assert(level(y, 3000, 0.55 * sr) < level(x, 3000, 0.55 * sr) - 30, 'inside removed');
  assert(Math.abs(level(y, 3000, 1.6 * sr) - level(x, 3000, 1.6 * sr)) < 0.5, 'outside kept');
  assert(Math.abs(level(y, 400, 0.55 * sr) - level(x, 400, 0.55 * sr)) < 0.5, 'other frequency kept');
});
ok('Brush attenuation and Amplify follow the painted stroke', () => {
  const L = sr, x = tone(1000, 0.2, 0, L, L), shape = { kind: 'brush', pts: [[0.4 * sr, 1000], [0.45 * sr, 1000], [0.5 * sr, 1000]], rs: 0.06 * sr, ro: 0.3 };
  const y = D.spectralEdit([x], sr, { shape, mode: 'atten', gainDb: -20 })[0];
  const d = level(y, 1000, 0.45 * sr) - level(x, 1000, 0.45 * sr); assert(d < -15 && d > -25, 'about −20 dB: ' + d.toFixed(1));
  assert(Math.abs(level(y, 1000, 0.85 * sr) - level(x, 1000, 0.85 * sr)) < 0.3, 'after the stroke');
  const z = D.spectralEdit([x], sr, { shape, mode: 'atten', gainDb: 6 })[0]; const u = level(z, 1000, 0.45 * sr) - level(x, 1000, 0.45 * sr); assert(u > 4 && u < 7, 'amplify +6: ' + u.toFixed(1));
});
ok('Spot Healing Brush: a click painted over is filled with the surrounding sound', () => {
  const L = sr, x = tone(500, 0.3, 0, L, L), c = Math.round(0.5 * sr); for (let i = 0; i < 40; i++) x[c + i] += (i % 2 ? -0.8 : 0.8); // a click
  const shape = { kind: 'brush', pts: [[c + 20, 2000], [c + 20, 4000], [c + 20, 8000], [c + 20, 14000]], rs: 0.02 * sr, ro: 0.8 };
  const y = D.spectralEdit([x], sr, { shape, mode: 'heal' })[0], ref = tone(500, 0.3, 0, L, L);
  assert(level(x, 9000, c + 20, 1024) - level(ref, 9000, c + 20, 1024) > 40, 'the click is there');
  assert(level(y, 9000, c + 20, 1024) < level(x, 9000, c + 20, 1024) - 25, 'click energy healed');
  assert(Math.abs(level(y, 500, c + 20) - level(ref, 500, c + 20)) < 1, 'the tone underneath is kept');
});
ok('YIN pitch: sine, harmonic tone and a glide are tracked within 1 %; silence / noise unvoiced', () => {
  const L = sr; const harm = new Float32Array(L); for (let h = 1; h <= 6; h++) for (let i = 0; i < L; i++) harm[i] += (0.4 / h) * Math.sin(2 * Math.PI * 147 * h * i / sr);
  for (const [x, f] of [[tone(220, 0.5, 0, L, L), 220], [harm, 147]]) { const r = D.pitchTrack([x], sr, 4000, L - 4000, 2000); for (const p of r) assert(Math.abs(p.f / f - 1) < 0.01, `${f}: ${p.f}`); }
  const g = new Float32Array(L); let ph = 0; for (let i = 0; i < L; i++) { ph += (200 + 200 * i / L) / sr; g[i] = 0.5 * Math.sin(2 * Math.PI * ph); }
  for (const p of D.pitchTrack([g], sr, 4000, L - 4000, 4000)) { const want = 200 + 200 * p.s / L; assert(Math.abs(p.f / want - 1) < 0.01, `glide ${p.f} vs ${want}`); }
  assert(D.pitchTrack([new Float32Array(L)], sr, 4000, L - 4000, 4000).every((p) => p.f === 0), 'silence');
  let s = 1; const n = new Float32Array(L).map(() => { s = (s * 16807) % 2147483647; return (s / 2147483647 - 0.5) * 0.6; });
  const nv = D.pitchTrack([n], sr, 4000, L - 4000, 2000).filter((p) => p.f > 0).length; assert(nv <= 2, 'noise voiced frames: ' + nv);
});
ok('Auto-select harmonics: clicking the 3rd harmonic selects the whole note (time + all harmonics); Delete removes it', () => {
  const L = sr * 2, a = Math.round(0.5 * sr), b = Math.round(1.5 * sr), note = new Float32Array(L);
  for (let h = 1; h <= 5; h++) for (let i = a; i < b; i++) note[i] += (0.3 / h) * Math.sin(2 * Math.PI * 220 * h * i / sr);
  const other = tone(1000, 0.1, 0, L, L), x = add(note, other);
  const sh = D.harmonicSelect([x], sr, sr, 660);
  assert(sh.kind === 'harm' && Math.abs(sh.f0 / 220 - 1) < 0.01 && sh.h === 3, 'pitch ' + sh.f0 + ' h=' + sh.h);
  const bd = D.shapeBounds(sh); assert(Math.abs(bd.a - a) < 0.05 * sr && Math.abs(bd.b - b) < 0.05 * sr, `extent ${bd.a / sr}–${bd.b / sr}`); assert(sh.n >= 5);
  const y = D.spectralEdit([x], sr, { shape: sh, mode: 'atten', gainDb: -120 })[0];
  for (const f of [220, 440, 660, 880]) assert(level(y, f, sr) < level(x, f, sr) - 30, 'harmonic ' + f + ' removed');
  assert(Math.abs(level(y, 1000, sr) - level(x, 1000, sr)) < 1, '1 kHz (not a harmonic) kept');
  // an inharmonic (bell-like) partial is not a harmonic of the detected pitch: just that partial is followed
  const bell = add(tone(1000, 0.3, 0, L, L), tone(2760, 0.2, 0, L, L), tone(5400, 0.1, 0, L, L));
  const p = D.harmonicSelect([bell], sr, sr, 2760); assert(p.n === 1 && Math.abs(p.f0 - 2760) < 5, 'inharmonic partial → one partial tracked: ' + p.f0 + ' n=' + p.n);
  const yb = D.spectralEdit([bell], sr, { shape: p, mode: 'atten', gainDb: -120 })[0];
  assert(level(yb, 2760, sr) < level(bell, 2760, sr) - 30 && Math.abs(level(yb, 1000, sr) - level(bell, 1000, sr)) < 1, 'only that partial removed');
});
ok('shapes move with their slice (shapeShift) and old marquees (no kind) still work', () => {
  assert.deepStrictEqual(J(D.shapeShift({ kind: 'brush', pts: [[100, 50]], rs: 1, ro: 1 }, -40).pts), [[60, 50]]);
  const L = sr, x = tone(1000, 0.3, 0, L, L), y = D.spectralEdit([x], sr, { t0: 0.3 * sr, t1: 0.6 * sr, f0: 800, f1: 1200, mode: 'atten', gainDb: -120 })[0];
  assert(level(y, 1000, 0.45 * sr) < level(x, 1000, 0.45 * sr) - 30);
});
ok('display settings: FFT sizes, window functions, dB range and colour maps', () => {
  const S = AS.spectral;
  for (const w of Object.keys(D.WINDOWS)) { const v = D.windowFn(w, 1024); assert(v.length === 1024 && Math.max(...v) <= 1.0001 && v[512] > 0.99, w); }
  assert(D.windowFn('blackmanHarris', 64)[0] < 1e-4 && D.windowFn('rect', 64)[0] === 1);
  for (const k of Object.keys(S.COLORMAPS)) { const lut = S.lut(k); assert(lut.length === 768, k); }
  assert(S.lut('gray')[0] === 0 && S.lut('gray')[765] === 255, 'grayscale');
  assert(S.level(-100, { dbMin: -100, dbMax: -20 }) === 0 && S.level(-20, { dbMin: -100, dbMax: -20 }) === 1 && S.level(-60, { dbMin: -100, dbMax: -20 }) === 0.5);
  const s0 = S.settings(); S.set({ fft: 4096, win: 'blackman', dbMin: -90, dbMax: 0, cmap: 'viridis', pitch: true });
  const s1 = S.settings(); assert(s1.fft === 4096 && s1.win === 'blackman' && s1.cmap === 'viridis' && s1.pitch === true);
  assert(JSON.parse(sb.localStorage.getItem('as-spectral')).fft === 4096, 'saved');
  S.set({ fft: 3000 }); assert(S.settings().fft === 4096, 'invalid FFT size ignored'); S.set(s0);
});
done();

// Run: node tests/metering.test.js — true peak (4×), loudness set (M / S / I / LRA / PLR, EBU Tech 3341/3342 style
// signals), true-peak limiter, correlation, and the Diagnostics detectors (clicks, clipping, silence)
const assert = require('assert');
const { load, ok, done } = require('./_sandbox');
const sb = load(['dsp.js', 'effects.js']), AS = sb.AS, D = AS.dsp, E = AS.effects;
const near = (a, b, e, m) => assert(Math.abs(a - b) <= e, (m ? m + ': ' : '') + a + ' != ' + b + ' ±' + e);
const sine = (sr, f, amp, secs, ph) => { const x = new Float32Array(Math.round(sr * secs)); for (let i = 0; i < x.length; i++) x[i] = amp * Math.sin(2 * Math.PI * f * i / sr + (ph || 0)); return x; };

const fadeIn = (x, n) => { for (let i = 0; i < n; i++) { x[i] *= i / n; x[x.length - 1 - i] *= i / n; } return x; }; // (an abrupt start really overshoots — a true-peak meter must see that)
ok('K-weighting = the published BS.1770 48 kHz coefficients', () => {
  const [s, h] = D.kWeightCoefs(48000), want = [[1.53512485958697, -2.69169618940638, 1.19839281085285, -1.69065929318241, 0.73248077421585], [1, -2, 1, -1.99004745483398, 0.99007225036621]];
  [s, h].forEach((c, k) => c.forEach((v, i) => near(v, want[k][i], 1e-8, `coef ${k}.${i}`)));
});
ok('true peak: a sine at fs/4 sampled 45° off its peaks reads 0 dBTP while its samples peak at −3 dB', () => {
  const x = fadeIn(sine(48000, 12000, 1, 0.5, Math.PI / 4), 4800);
  near(D.toDb(D.peakOf([x])), -3.01, 0.02, 'sample peak'); near(D.toDb(D.truePeak([x]).peak), 0, 0.1, 'true peak');
  const y = sine(48000, 997, 0.5, 0.5); near(D.toDb(D.truePeak([y]).peak), D.toDb(0.5), 0.05, 'a low sine: true peak = sample peak');
  const env = D.tpEnvelope(x); assert(env.every((v, i) => v >= Math.abs(x[i])), 'envelope ≥ |sample|');
});
ok('loudness: stereo 1 kHz at −23 dBFS reads −23 LUFS (M, S, I); 20 s / 20 s at −20 / −30 dBFS → LRA 10 LU', () => {
  const sr = 48000, a = D.fromDb(-23), x = sine(sr, 1000, a, 10), r = D.loudnessFull([x, x], sr);
  near(r.I, -23, 0.1, 'I'); near(r.M, -23, 0.1, 'M'); near(r.S, -23, 0.1, 'S'); near(r.TP, -23, 0.05, 'TP'); near(r.PLR, 0, 0.1, 'PLR'); near(r.LRA, 0, 0.1, 'steady tone: LRA 0');
  const s2 = 16000, lo = sine(s2, 1000, D.fromDb(-30), 20), hi = sine(s2, 1000, D.fromDb(-20), 20), z = new Float32Array(lo.length * 2); z.set(hi); z.set(lo, hi.length);
  near(D.loudnessFull([z, z], s2).LRA, 10, 1, 'LRA');
});
ok('the meter in chunks = all at once; integrated matches the existing LUFS function', () => {
  const sr = 44100; let s = 7; const x = new Float32Array(sr * 6).map((_, i) => { s = (s * 16807) % 2147483647; return 0.3 * Math.sin(i / 30) * (s / 2147483647 - 0.5) + 0.2 * Math.sin(2 * Math.PI * 220 * i / sr); }), y = x.map((v, i) => v * 0.7 + 0.05 * Math.sin(i / 7));
  const one = D.loudnessFull([x, y], sr), m = new D.LoudnessMeter(sr, 2);
  for (let i = 0; i < x.length; i += 3333) m.push([x.subarray(i, i + 3333), y.subarray(i, i + 3333)]);
  const r = m.readings(); for (const k of ['I', 'M', 'S', 'LRA', 'TP', 'Mmax', 'Smax']) near(r[k], one[k], 1e-6, k);
  near(one.I, D.loudness([x, y], sr), 0.02, 'same integrated loudness as before');
});
ok('5.1: LFE ignored, surrounds weighted 1.41 (+1.5 dB)', () => {
  const sr = 48000, t = sine(sr, 1000, 0.1, 5), z = new Float32Array(t.length);
  const front = D.loudnessFull([t, z, z, z, z, z], sr).I, lfe = D.loudnessFull([z, z, z, t, z, z], sr).I, sur = D.loudnessFull([z, z, z, z, t, z], sr).I;
  assert(!isFinite(lfe), 'LFE alone: no loudness'); near(sur - front, 10 * Math.log10(1.41), 0.05, 'surround weight');
});
ok('True-Peak limiter keeps inter-sample peaks under the ceiling (a sample-peak limiter does not)', () => {
  const x = fadeIn(sine(48000, 12000, 1.2, 1, Math.PI / 4), 4800), y = fadeIn(sine(48000, 11000, 1.2, 1, 0.3), 4800);
  // x: samples at 0.85 (−1.4 dB, under the −1 dB ceiling) but true peak +1.6 dBTP
  const sp = D.limiter([x], 48000, -1, 5, 100), tp = D.limiterTP([x, y], 48000, -1, 5, 100);
  assert(D.toDb(D.truePeak(sp).peak) > 1, 'sample-peak limiter: true peak still over'); assert(D.toDb(D.truePeak(tp).peak) <= -0.98, 'true peak ' + D.toDb(D.truePeak(tp).peak));
  near(D.toDb(D.peakOf(tp)), -1, 3.5, 'not over-limited');
  const fx = E.byId('limiter'); assert(fx.params.some((p) => p.id === 'tp'), 'Hard Limiter has a True Peak option');
  const viaFx = fx.process([x], 48000, { ...E.defaults(fx), ceil: -1, tp: true }); assert(D.toDb(D.truePeak(viaFx).peak) <= -0.98, 'effect in True Peak mode');
  const ln = E.byId('loudnorm'), o = ln.process([x, y], 48000, { target: -5, ceil: -1 }); assert(D.toDb(D.truePeak(o).peak) <= -0.98, 'Loudness Normalize: true-peak ceiling');
});
ok('correlation: same +1, inverted −1, unrelated ≈ 0, silence 0', () => {
  const a = sine(8000, 300, 0.5, 1), b = sine(8000, 517, 0.5, 1);
  near(D.correlation(a, a), 1, 1e-9); near(D.correlation(a, a.map((v) => -v)), -1, 1e-9); near(D.correlation(a, b), 0, 0.02); assert.strictEqual(D.correlation(new Float32Array(10), a.subarray(0, 10)), 0);
});
ok('Diagnostics detectors: clicks, clipped runs, silences — and the repairs fix exactly those spots', () => {
  const sr = 44100, x = sine(sr, 440, 0.3, 1);
  for (const at of [10000, 25000, 40000]) for (let i = 0; i < 4; i++) x[at + i] += i % 2 ? -0.6 : 0.6;
  const clicks = D.detectClicks([x], 10, 40); assert.strictEqual(clicks.length, 3, 'clicks ' + JSON.stringify(clicks.map((c) => c.s)));
  for (const [k, at] of [10000, 25000, 40000].entries()) assert(clicks[k].s <= at && clicks[k].e >= at + 3, 'covers click ' + at);
  const fixed = D.clickRemove([x], 10, 40)[0]; assert.strictEqual(D.detectClicks([fixed], 10, 40).length, 0, 'repaired');
  let same = true; for (let i = 0; i < 9000; i++) if (fixed[i] !== x[i]) same = false; assert(same, 'clean audio untouched');
  const c = sine(sr, 220, 1.5, 0.2).map((v) => Math.max(-1, Math.min(1, v))), runs = D.detectClipping([c], 99, 3); assert(runs.length >= 70, 'clipped runs ' + runs.length);
  const dc = D.declip([c], 99, 3)[0]; assert(D.peakOf([dc]) > 1.1, 'declipped peaks restored above 1');
  const sp = new Float32Array(sr * 3); sp.set(sine(sr, 300, 0.3, 0.5), sr * 0.5); sp.set(sine(sr, 300, 0.3, 0.5), sr * 2);
  const sil = D.detectSilence([sp], sr, -50, 300); assert.deepStrictEqual(JSON.parse(JSON.stringify(sil.map((r) => [Math.round(r.s / sr * 10) / 10, Math.round(r.e / sr * 10) / 10]))), [[0, 0.5], [1, 2], [2.5, 3]]);
});
done();

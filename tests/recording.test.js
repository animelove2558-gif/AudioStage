// Run: node tests/recording.test.js — capture → timeline (latency, punch), loop passes → takes, comping, latency measurement
const assert = require('assert');
const { load, CORE, ok, done } = require('./_sandbox');
const AS = load(CORE).AS, R = AS.rec;
const near = (a, b, e, m) => assert(Math.abs(a - b) <= (e || 1e-9), (m ? m + ': ' : '') + a + ' != ' + b);
const sr = 1000;
/* a capture whose value at sample i is the ctx time it was heard (so windows can be checked exactly) */
const capture = (startTime, secs) => { const x = new Float32Array(Math.round(secs * sr)); for (let i = 0; i < x.length; i++) x[i] = startTime + i / sr; return [x]; };

ok('window: latency compensation picks the capture that came back `lat` later', () => {
  const ch = capture(10, 5), w = R.window(ch, sr, 10, 11, 12, 0.25)[0];
  assert.strictEqual(w.length, 1000); near(w[0], 11.25, 1e-4); near(w[999], 12.249, 1e-4);
});
ok('timelineRange: transport map (t0 plays `from`), punch range [a, b)', () => {
  const ch = capture(100, 10), map = { t0: 101, from: 30 }; // ctx 101 = timeline 30
  const w = R.timelineRange(ch, sr, 100, map, 32, 34, 0.1)[0]; // timeline 32..34 = ctx 103..105 (+0.1 latency)
  near(w[0], 103.1, 1e-4, 'float32 sample value'); assert.strictEqual(w.length, 2000);
});
ok('window past the end of the capture is padded with silence; open-ended window runs to the end', () => {
  const ch = capture(0, 2); const w = R.window(ch, sr, 0, 1.5, 3, 0)[0]; assert.strictEqual(w.length, 1500); near(w[499], 1.999, 1e-6); assert.strictEqual(w[500], 0);
  assert.strictEqual(R.window(ch, sr, 0, 0.5, Infinity, 0)[0].length, 1500);
});
ok('loop passes: one take per complete pass (+ a last pass only if mostly recorded), each aligned to the loop', () => {
  const ch = capture(50, 7.4), takes = R.passes(ch, sr, 50, 50.2, 2, 0.05); // passes at ctx 50.2, 52.2, 54.2, 56.2(partial 1.15/2 s)
  assert.strictEqual(takes.length, 4); near(takes[1][0][0], 52.25, 1e-4); near(takes[3][0][0], 56.25, 1e-4); assert.strictEqual(takes[3][0][1999], 0, 'partial pass padded');
  assert.strictEqual(R.passes(capture(50, 6.6), sr, 50, 50.2, 2, 0.05).length, 3, 'a 0.35 s tail is dropped');
});
ok('comp: normalise covers [0, len] without gaps and merges neighbours', () => {
  const c = R.normComp([{ from: 1, to: 2, take: 1 }, { from: 2, to: 3, take: 1 }], 4, 3);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(c)), [{ from: 0, to: 3, take: 1 }, { from: 3, to: 4, take: 1 }].reduce((a, s) => { const l = a[a.length - 1]; if (l && l.take === s.take) l.to = s.to; else a.push(s); return a; }, []));
});
ok('comp: swiping a range onto another take splits the existing segment', () => {
  let c = R.normComp([{ from: 0, to: 4, take: 2 }], 4, 3);
  c = R.assign(c, 1, 2.5, 0, 4, 3); assert.deepStrictEqual(JSON.parse(JSON.stringify(c)), [{ from: 0, to: 1, take: 2 }, { from: 1, to: 2.5, take: 0 }, { from: 2.5, to: 4, take: 2 }]);
  c = R.assign(c, 2, 3, 1, 4, 3); assert.deepStrictEqual(JSON.parse(JSON.stringify(c)), [{ from: 0, to: 1, take: 2 }, { from: 1, to: 2, take: 0 }, { from: 2, to: 3, take: 1 }, { from: 3, to: 4, take: 2 }]);
});
ok('flatten: each segment comes from its take; equal-power crossfade at seams; no click inside a take', () => {
  const L = 4000, mk = (v) => [new Float32Array(L).fill(v)];
  const takes = [mk(0.1), mk(0.2), mk(0.3)], comp = [{ from: 0, to: 1, take: 0 }, { from: 1, to: 3, take: 2 }, { from: 3, to: 4, take: 2 }];
  const out = R.flatten(takes, comp, sr, 0.01)[0];
  near(out[500], 0.1, 1e-6); near(out[2000], 0.3, 1e-6); near(out[3500], 0.3, 1e-6, 'same take on both sides: no fade at 3 s');
  // across the 1 s seam: power-complementary gains, no gap
  for (let i = 990; i < 1010; i++) { const g0 = out[i]; assert(g0 > 0.09 && g0 < 0.3 * 1.42, 'sample ' + i + ' = ' + g0); }
});
ok('measureLatency: median delay between test clicks and their echoes', () => {
  const x = new Float32Array(sr * 3), st = 5.0, clicks = [5.5, 6.0, 6.5, 7.0], lat = 0.137;
  for (const c of clicks) { const i = Math.round((c + lat - st) * sr); for (let k = 0; k < 5; k++) x[i + k] = 0.8 - k * 0.1; }
  const r = R.measureLatency(x, sr, st, clicks); near(r.latency, lat, 1.5 / sr); assert.strictEqual(r.found, 4); assert.strictEqual(r.error, null);
  assert.strictEqual(R.measureLatency(new Float32Array(sr * 3), sr, st, clicks).latency, null, 'silence -> error');
});
done();

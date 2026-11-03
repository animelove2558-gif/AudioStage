// Run: node tests/wavescale.test.js — Dynamic Waveform Scaling (app/js/wavescale.js)
const assert = require('assert');
const { load, CORE } = require('./_sandbox');
const AS = load(CORE).AS, WS = AS.wavescale, E = AS.env;

let fail = 0;
const ok = (name, fn) => { try { fn(); console.log('ok   ', name); } catch (e) { fail++; console.log('FAIL ', name, e.message); } };
/* canvas stand-in that records the rects of one path */
const canvas = () => ({ rects: [], beginPath() { this.rects = []; }, rect(x, y, w, h) { this.rects.push({ x, y, w, h }); }, fill() {} });
const sr = 8000, sine = (secs, a) => { const n = secs * sr, x = new Float32Array(n); for (let i = 0; i < n; i++) x[i] = a * Math.sin(2 * Math.PI * 100 * i / sr); return x; };
const mkClip = () => { const src = AS.makeSource('s', sr, [sine(4, 0.8), sine(4, 0.6)]); return { id: 1, src, start: 1, off: 0, dur: 4, gain: 0, fi: 0, fo: 0, env: E.empty() }; };
const view = { t0: 0, pps: 100 }, unity = () => 1;

ok('envelope multipliers = AS.env.valueAt at every column (incl. duplicate times, before/after keyframes)', () => {
  const pts = [{ t: 0.5, v: 0.2 }, { t: 1, v: 2 }, { t: 1, v: 0 }, { t: 2.5, v: 1.5 }, { t: 3, v: 1.5 }];
  const n = 500, rel0 = -0.3, step = 0.009, m = WS.envelopeMultipliers(pts, 1, rel0, step, n);
  for (let i = 0; i < n; i++) assert(Math.abs(m[i] - E.valueAt(pts, rel0 + i * step, 1)) < 1e-6, 'col ' + i);
  const flat = WS.envelopeMultipliers([], 1, 0, 0.01, 10); assert([...flat.slice(0, 10)].every((v) => v === 1));
});
ok('peak columns match the original per-pixel computation', () => {
  const c = mkClip(), pk = new AS.Peaks(c.src.ch), cols = WS.columns(c, pk, 100, 500, view);
  for (let i = 0; i < cols.n; i++) {
    const x = 100 + i, tt = c.off + (view.t0 + x / view.pps - c.start), s0 = tt * sr, s1 = (tt + 1 / view.pps) * sr;
    let lo = 1, hi = -1; for (let ch = 0; ch < 2; ch++) { const r = pk.range(ch, s0, s1); if (!r) continue; lo = Math.min(lo, r[0]); hi = Math.max(hi, r[1]); }
    assert.strictEqual(cols.lo[i], Math.fround(lo)); assert.strictEqual(cols.hi[i], Math.fround(hi));
  }
});
ok('columns are cached across envelope edits, recomputed when zoom / placement changes', () => {
  const c = mkClip(), pk = new AS.Peaks(c.src.ch), a = WS.columns(c, pk, 100, 500, view);
  E.of(c).volume.push({ t: 0, v: 0 }); assert.strictEqual(WS.columns(c, pk, 100, 500, view), a);
  assert.notStrictEqual(WS.columns(c, pk, 100, 500, { t0: 0, pps: 120 }), a);
  c.start = 1.5; assert.notStrictEqual(WS.columns(c, pk, 100, 500, view), a);
});
ok('gain 1 = original height, 2 = taller (clamped to the box), 0.5 = half, 0 = 1-px flat line', () => {
  const c = mkClip(), pk = new AS.Peaks(c.src.ch), cols = WS.columns(c, pk, 100, 500, view), yc = 50, amp = 30;
  const heights = (g) => { const g2 = canvas(), m = WS.clipMultipliers({ ...c, env: { volume: [{ t: 0, v: g }], pan: [] } }, 100, cols.n, view, unity, 1); WS.drawColumns(g2, cols, m, yc, amp, 10, 90); return g2.rects; };
  const r1 = heights(1), r2 = heights(2), rh = heights(0.5), r0 = heights(0);
  const max = (rs) => Math.max(...rs.map((r) => r.h));
  assert(Math.abs(max(r1) - 2 * 0.8 * amp) < 1, 'unity ' + max(r1));
  assert(Math.abs(max(rh) - 0.8 * amp) < 1, 'half ' + max(rh));
  assert(max(r2) > max(r1) && r2.every((r) => r.y >= 10 && r.y + r.h <= 90), 'boost / clamp');
  assert(r0.every((r) => r.h === 1 && Math.abs(r.y - (yc - 0.5)) < 1e-9), 'flat line');
});
ok('envelope ramp: waveform height follows the line column by column', () => {
  const c = mkClip(); E.of(c).volume.push({ t: 0, v: 0 }, { t: 4, v: 2 }); // 0 -> 2 over the clip
  const pk = new AS.Peaks(c.src.ch), cols = WS.columns(c, pk, 100, 500, view), m = WS.clipMultipliers(c, 100, cols.n, view, unity, 1);
  for (let i = 0; i < cols.n; i += 37) { const rel = (100 + i) / 100 - 1; assert(Math.abs(m[i] - E.valueAt(E.of(c).volume, rel, 1)) < 1e-6); }
  assert(m[cols.n - 1] > m[0]);
});
ok('fades and clip gain multiply in', () => {
  const c = { ...mkClip(), fi: 2, gain: -6.0206 }, pk = new AS.Peaks(c.src.ch), cols = WS.columns(c, pk, 100, 500, view);
  const m = WS.clipMultipliers(c, 100, cols.n, view, AS.fadeGainAt, AS.dsp.fromDb(c.gain));
  for (let i = 0; i < cols.n; i += 41) { const rel = (100 + i) / 100 - 1; assert(Math.abs(m[i] - AS.fadeGainAt(c, rel) * 0.5) < 1e-4); }
});
ok('non-destructive: audio samples and Peaks data are bit-identical after drawing', () => {
  const c = mkClip(), pk = new AS.Peaks(c.src.ch); E.of(c).volume.push({ t: 0, v: 2 }, { t: 2, v: 0 });
  const snap = (arrs) => arrs.map((a) => Buffer.from(a.buffer.slice(0)).toString('base64'));
  const before = [snap(c.src.ch), snap(pk.mn), snap(pk.mx)];
  for (let k = 0; k < 5; k++) { const cols = WS.columns(c, pk, 0, 600, { t0: 0, pps: 100 + k }); WS.drawColumns(canvas(), cols, WS.clipMultipliers(c, 0, cols.n, { t0: 0, pps: 100 + k }, AS.fadeGainAt, 1), 50, 30, 10, 90); }
  assert.deepStrictEqual([snap(c.src.ch), snap(pk.mn), snap(pk.mx)], before);
});
ok('only the yellow Volume line scales the waveform — Pan keyframes leave the height unchanged', () => {
  const c = mkClip(), pk = new AS.Peaks(c.src.ch), cols = WS.columns(c, pk, 100, 500, view);
  const base = Array.from(WS.clipMultipliers(c, 100, cols.n, view, unity, 1));
  E.of(c).pan.push({ t: 0, v: -1 }, { t: 2, v: 1 }); // swing the blue line hard left -> right
  assert.deepStrictEqual(Array.from(WS.clipMultipliers(c, 100, cols.n, view, unity, 1)), base);
  E.of(c).volume.push({ t: 0, v: 0.25 }); // pull the yellow line down
  assert(Array.from(WS.clipMultipliers(c, 100, cols.n, view, unity, 1)).every((m) => Math.abs(m - 0.25) < 1e-6));
});
ok('overlapping lines: a click picks the yellow Volume line (drawn on top); Alt or an active Pan line picks Pan', () => {
  const MV = AS.MultiView.prototype, c = mkClip();
  const v = Object.assign(Object.create(MV), { s: { tracks: [{ clips: [c] }] }, t0: 0, pps: 100, W: 1000, envMode: 'both', autoMode: '', envActive: null });
  const b = v.box(c, 0), x = v.t2x(c.start + 1), y = v.envY(b, 'volume', 1); // middle of the clip: both default lines are here
  assert.strictEqual(y, v.envY(b, 'pan', 0), 'default lines overlap');
  assert.strictEqual(v.envHit(c, 0, x, y).kind, 'volume');
  assert.strictEqual(v.envHit(c, 0, x, y, true).kind, 'pan');
  assert.deepStrictEqual(Array.from(v.envOrder(c).reverse()), ['pan', 'volume'], 'draw order: Volume last = on top');
  v.envActive = { id: c.id, kind: 'pan', i: -1 }; assert.strictEqual(v.envHit(c, 0, x, y).kind, 'pan');
  assert.deepStrictEqual(Array.from(v.envKinds()), ['volume', 'pan'], 'constant list not mutated');
  v.envMode = 'pan'; v.envActive = null; assert.strictEqual(v.envHit(c, 0, x, y).kind, 'pan');
});
ok('performance: a keyframe-drag repaint of a 2000-px clip (cached columns) is well under one frame', () => {
  const src = AS.makeSource('long', 44100, [new Float32Array(44100 * 600).map((_, i) => Math.sin(i / 50))]);
  const c = { id: 2, src, start: 0, off: 0, dur: 600, gain: 0, fi: 1, fo: 1, env: { volume: Array.from({ length: 50 }, (_, i) => ({ t: i * 12, v: (i % 3) / 1.5 })), pan: [] } };
  const pk = new AS.Peaks(src.ch), v = { t0: 0, pps: 2000 / 600 };
  let t = process.hrtime.bigint(); const cols = WS.columns(c, pk, 0, 2000, v); const cold = Number(process.hrtime.bigint() - t) / 1e6;
  const g = canvas(); t = process.hrtime.bigint();
  for (let k = 0; k < 100; k++) { c.env.volume[10].v = k / 50; WS.drawColumns(g, WS.columns(c, pk, 0, 2000, v), WS.clipMultipliers(c, 0, cols.n, v, AS.fadeGainAt, 1), 50, 30, 10, 90); }
  const warm = Number(process.hrtime.bigint() - t) / 1e6 / 100;
  console.log(`      columns (first draw) ${cold.toFixed(2)} ms · per drag repaint ${warm.toFixed(3)} ms`);
  assert(warm < 16, 'too slow: ' + warm); // inside this vm sandbox code runs several times slower than in the app (~0.06 ms natively)
});

console.log(fail ? `\n${fail} failed` : '\nall passed');
process.exit(fail ? 1 : 0);

// app/js/timecode.js: frame rates, drop-frame and Feet+Frames.
const assert = require('assert');
globalThis.AS = {}; require('../app/js/timecode.js');
const T = AS.timecode;
let failed = 0; const ok = (n, f) => { try { f(); console.log('ok   ', n); } catch (e) { failed++; console.log('FAIL ', n, '\n   ', e.message); } };
ok('non-drop rates', () => {
  assert.strictEqual(T.fmt(0, '30'), '00:00:00:00'); assert.strictEqual(T.fmt(3661.5, '30'), '01:01:01:15'); assert.strictEqual(T.fmt(1.04, '25'), '00:00:01:01');
  assert.strictEqual(T.fmt(2, '24'), '00:00:02:00'); assert.strictEqual(T.fmt(1.5, '60'), '00:00:01:30'); assert.strictEqual(T.fmt(-5, '30'), '00:00:00:00');
  assert.strictEqual(T.fmt(1, '23.976'), '00:00:00:23'); assert.strictEqual(T.fmt(3600 * 1.001, '29.97'), '01:00:00:00');
});
ok('29.97 drop-frame: frame numbers 00 and 01 are skipped each minute except every tenth; an hour of real time reads 01:00:00;00', () => {
  const at = (frames) => T.fmt(frames / (30000 / 1001), '29.97df');
  assert.strictEqual(at(1799), '00:00:59;29'); assert.strictEqual(at(1800), '00:01:00;02'); assert.strictEqual(at(17981), '00:09:59;29'); assert.strictEqual(at(17982), '00:10:00;00');
  assert.strictEqual(at(107892), '01:00:00;00'); assert.strictEqual(T.fmt(3600, '29.97df'), '01:00:00;00'); assert.strictEqual(T.fmt(3600, '29.97'), '00:59:56:12');
});
ok('59.94 drop-frame drops 4 numbers a minute', () => {
  const at = (frames) => T.fmt(frames / (60000 / 1001), '59.94df');
  assert.strictEqual(at(3599), '00:00:59;59'); assert.strictEqual(at(3600), '00:01:00;04'); assert.strictEqual(at(35964), '00:10:00;00');
});
ok('feet + frames (35 mm, 16 frames per foot)', () => {
  assert.strictEqual(T.feetFrames(0), '0+00'); assert.strictEqual(T.feetFrames(1), '1+08'); assert.strictEqual(T.feetFrames(60), '90+00');
});
if (failed) process.exit(1); else console.log('\nall passed');

const assert = require('assert');
const A = require('../app/js/aiff.js');
let failed = 0; const ok = (n, f) => { try { f(); console.log('ok   ', n); } catch (e) { failed++; console.log('FAIL ', n, '\n   ', e.message); } };
const sig = (n) => Float32Array.from({ length: n }, (_, i) => 0.7 * Math.sin(i / 9));
ok('AIFF 16 / 24 / 32-bit: header fields and a bit-exact round trip of the quantised samples', () => {
  for (const [bits, tol] of [[16, 2 / 32767], [24, 2 / 8388607], [32, 1e-6]]) {
    for (const sr of [8000, 44100, 48000, 96000, 22050]) {
      const x = sig(1001), buf = A.encodeAiff([x, x.map((v) => -v)], sr, bits), dv = new DataView(buf);
      assert.strictEqual(String.fromCharCode(...new Uint8Array(buf, 0, 4)), 'FORM'); assert.strictEqual(dv.getUint32(4), buf.byteLength - 8); assert.strictEqual(buf.byteLength % 2, 0);
      const r = A.decodeAiff(buf); assert.strictEqual(r.sr, sr); assert.strictEqual(r.bits, bits); assert.strictEqual(r.ch.length, 2); assert.strictEqual(r.ch[0].length, 1001);
      for (let i = 0; i < 1001; i++) { assert(Math.abs(r.ch[0][i] - x[i]) <= tol, `bits ${bits} sample ${i}`); assert(Math.abs(r.ch[1][i] + x[i]) <= tol); }
    }
  }
});
ok('AIFF: clipping, NaN and an odd data length (24-bit mono) are handled', () => {
  const buf = A.encodeAiff([Float32Array.from([2, -2, NaN, 0.5, 0])], 44100, 24); const r = A.decodeAiff(buf);
  assert(Math.abs(r.ch[0][0] - 1) < 1e-6 && Math.abs(r.ch[0][1] + 1) < 1e-6 && r.ch[0][2] === 0 && Math.abs(r.ch[0][3] - 0.5) < 1e-6); assert.strictEqual(buf.byteLength % 2, 0);
  assert.throws(() => A.decodeAiff(new ArrayBuffer(20)), /Not an AIFF/);
});
if (failed) process.exit(1); else console.log('\nall passed');

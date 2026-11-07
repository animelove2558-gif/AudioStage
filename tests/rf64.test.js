// WAV above 4 GB is written as RF64 (wav.js stream): the header carries the real sizes in ds64.
const assert = require('assert');
globalThis.AS = {}; require('../app/js/wav.js');
const W = AS.wav;
const h = W.stream(2, 48000, 24, 2 * 1024 * 1024 * 1024, false).head(), dv = new DataView(h.buffer, h.byteOffset, h.byteLength), tag = (o) => String.fromCharCode(...h.subarray(o, o + 4));
const u64 = (o) => dv.getUint32(o, true) + dv.getUint32(o + 4, true) * 4294967296;
const dataLen = 2 * 1024 * 1024 * 1024 * 2 * 3; // > 4 GB
assert.strictEqual(tag(0), 'RF64'); assert.strictEqual(dv.getUint32(4, true), 0xffffffff); assert.strictEqual(tag(12), 'ds64');
assert.strictEqual(u64(28), dataLen); assert.strictEqual(u64(36), 2 * 1024 * 1024 * 1024); assert.strictEqual(tag(48), 'fmt ');
const small = W.stream(2, 48000, 16, 1000, false).head(); assert.strictEqual(String.fromCharCode(...small.subarray(0, 4)), 'RIFF');
console.log('ok    RF64 header for data over 4 GB, plain RIFF below'); console.log('\nall passed');

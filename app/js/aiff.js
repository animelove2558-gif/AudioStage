/* AIFF (big-endian PCM, 16 / 24 / 32-bit integer) writer and reader. The sample rate is stored as an 80-bit IEEE extended
   number. Plain script (also loaded in the encode worker). */
(function (root) {
  'use strict';
  const ext80 = (dv, o, v) => { // 80-bit extended, big-endian, v > 0 finite
    let e = Math.floor(Math.log2(v)), m = v / Math.pow(2, e); // m in [1, 2)
    if (m >= 2) { m /= 2; e++; } if (m < 1) { m *= 2; e--; }
    dv.setUint16(o, 0x3fff + e);
    const mant = m * Math.pow(2, 63); // exact for integer rates
    const high = Math.floor(mant / 4294967296), low = mant - high * 4294967296;
    dv.setUint32(o + 2, high >>> 0); dv.setUint32(o + 6, Math.floor(low) >>> 0);
  };
  const readExt80 = (dv, o) => { const e = dv.getUint16(o) & 0x7fff, hi = dv.getUint32(o + 2), lo = dv.getUint32(o + 6); return (hi * 4294967296 + lo) * Math.pow(2, e - 16383 - 63); };

  function encodeAiff(chs, sr, bits, dither) {
    bits = bits === 32 ? 32 : bits === 24 ? 24 : 16;
    const nch = chs.length, L = chs[0].length, bps = bits / 8, dataLen = L * nch * bps, ssnd = 8 + dataLen, pad = ssnd & 1;
    const total = 12 + 8 + 18 + 8 + ssnd + pad, buf = new ArrayBuffer(total), dv = new DataView(buf);
    const w = (o, s) => { for (let i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i)); };
    w(0, 'FORM'); dv.setUint32(4, total - 8); w(8, 'AIFF');
    w(12, 'COMM'); dv.setUint32(16, 18); dv.setUint16(20, nch); dv.setUint32(22, L); dv.setUint16(26, bits); ext80(dv, 28, sr);
    w(38, 'SSND'); dv.setUint32(42, ssnd); dv.setUint32(46, 0); dv.setUint32(50, 0);
    let o = 54;
    const max = bits === 16 ? 32767 : bits === 24 ? 8388607 : 2147483647;
    for (let i = 0; i < L; i++) for (let c = 0; c < nch; c++) {
      let v = chs[c][i]; v = v > 1 ? 1 : v < -1 ? -1 : (v === v ? v : 0);
      let s = v * max; if (dither && bits === 16) s += Math.random() - Math.random();
      s = Math.max(-max - 1, Math.min(max, Math.round(s)));
      if (bits === 16) { dv.setInt16(o, s); o += 2; } else if (bits === 24) { if (s < 0) s += 0x1000000; dv.setUint8(o, (s >> 16) & 255); dv.setUint8(o + 1, (s >> 8) & 255); dv.setUint8(o + 2, s & 255); o += 3; } else { dv.setInt32(o, s); o += 4; }
    }
    return buf;
  }
  /* ArrayBuffer -> { sr, ch: Float32Array[], bits } (throws on anything but AIFF PCM) */
  function decodeAiff(buf) {
    const dv = new DataView(buf), tag = (o) => String.fromCharCode(dv.getUint8(o), dv.getUint8(o + 1), dv.getUint8(o + 2), dv.getUint8(o + 3));
    if (buf.byteLength < 12 || tag(0) !== 'FORM' || tag(8) !== 'AIFF') throw new Error('Not an AIFF file.');
    let nch = 0, frames = 0, bits = 0, sr = 0, data = -1;
    for (let o = 12; o + 8 <= buf.byteLength;) {
      const id = tag(o), len = dv.getUint32(o + 4), b = o + 8;
      if (id === 'COMM') { nch = dv.getUint16(b); frames = dv.getUint32(b + 2); bits = dv.getUint16(b + 6); sr = readExt80(dv, b + 8); }
      else if (id === 'SSND') data = b + 8 + dv.getUint32(b);
      o = b + len + (len & 1);
    }
    if (!nch || data < 0 || ![16, 24, 32].includes(bits) || !(sr > 0)) throw new Error('Unsupported AIFF file.');
    const bps = bits / 8; frames = Math.min(frames, Math.floor((buf.byteLength - data) / (bps * nch)));
    const ch = Array.from({ length: nch }, () => new Float32Array(frames)); let o = data;
    for (let i = 0; i < frames; i++) for (let c = 0; c < nch; c++) {
      if (bits === 16) { ch[c][i] = dv.getInt16(o) / 32768; o += 2; }
      else if (bits === 24) { let n = (dv.getUint8(o) << 16) | (dv.getUint8(o + 1) << 8) | dv.getUint8(o + 2); if (n & 0x800000) n -= 0x1000000; ch[c][i] = n / 8388608; o += 3; }
      else { ch[c][i] = dv.getInt32(o) / 2147483648; o += 4; }
    }
    return { sr: Math.round(sr), ch, bits };
  }
  root.AS = root.AS || {};
  root.AS.aiff = { encodeAiff, decodeAiff };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.AS.aiff;
})(typeof window !== 'undefined' ? window : (typeof self !== 'undefined' ? self : globalThis));

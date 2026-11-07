/* Minimal FLAC encoder: fixed predictors (order 0-4) + Rice coding, 16/24-bit, up to 8 channels. */
(function (root) {
  'use strict';
  const crc8t = new Uint8Array(256), crc16t = new Uint16Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i; for (let k = 0; k < 8; k++) c = c & 0x80 ? ((c << 1) ^ 0x07) & 0xff : (c << 1) & 0xff; crc8t[i] = c;
    let d = i << 8; for (let k = 0; k < 8; k++) d = d & 0x8000 ? ((d << 1) ^ 0x8005) & 0xffff : (d << 1) & 0xffff; crc16t[i] = d;
  }
  class BitWriter {
    constructor() { this.buf = new Uint8Array(1 << 16); this.pos = 0; this.acc = 0; this.nb = 0; }
    ensure(n) { if (this.pos + n >= this.buf.length) { const b = new Uint8Array(this.buf.length * 2 + n); b.set(this.buf); this.buf = b; } }
    bits(v, n) { // n <= 32, v non-negative or masked
      while (n > 0) {
        const take = Math.min(n, 8 - this.nb), shift = n - take;
        const part = Math.floor(v / Math.pow(2, shift)) & ((1 << take) - 1);
        this.acc = (this.acc << take) | part; this.nb += take; n -= take;
        v = v % Math.pow(2, shift);
        if (this.nb === 8) { this.ensure(1); this.buf[this.pos++] = this.acc & 255; this.acc = 0; this.nb = 0; }
      }
    }
    unary(q) { while (q >= 8 && this.nb === 0) { this.ensure(1); this.buf[this.pos++] = 0; q -= 8; } while (q-- > 0) this.bits(0, 1); this.bits(1, 1); }
    align() { if (this.nb) this.bits(0, 8 - this.nb); }
    bytes() { return this.buf.subarray(0, this.pos); }
  }
  const crc8 = (u) => { let c = 0; for (let i = 0; i < u.length; i++) c = crc8t[c ^ u[i]]; return c; };
  const crc16 = (u) => { let c = 0; for (let i = 0; i < u.length; i++) c = ((c << 8) & 0xffff) ^ crc16t[(c >> 8) ^ u[i]]; return c; };
  const zz = (v) => (v >= 0 ? v * 2 : -v * 2 - 1);

  function residual(x, order) {
    const n = x.length, r = new Array(n - order);
    for (let i = order; i < n; i++) {
      let p = 0;
      if (order === 1) p = x[i - 1];
      else if (order === 2) p = 2 * x[i - 1] - x[i - 2];
      else if (order === 3) p = 3 * x[i - 1] - 3 * x[i - 2] + x[i - 3];
      else if (order === 4) p = 4 * x[i - 1] - 6 * x[i - 2] + 4 * x[i - 3] - x[i - 4];
      r[i - order] = x[i] - p;
    }
    return r;
  }
  function riceCost(r) {
    let sum = 0; for (let i = 0; i < r.length; i++) sum += zz(r[i]);
    const mean = sum / Math.max(1, r.length); let best = Infinity, bk = 0;
    const k0 = Math.max(0, Math.floor(Math.log2(Math.max(1, mean))) - 1);
    for (let k = k0; k <= Math.min(30, k0 + 3); k++) {
      let bits = 0; for (let i = 0; i < r.length; i++) bits += (zz(r[i]) >> k) + 1 + k;
      if (bits < best) { best = bits; bk = k; }
    }
    return { bits: best, k: bk };
  }

  function encodeFrame(chs, start, n, bps, frameNo, sr) {
    const w = new BitWriter(), hdr = new BitWriter();
    hdr.bits(0xfff8, 16); // sync + fixed blocksize
    const bsCode = n === 4096 ? 12 : n < 256 ? 6 : 7; // 6: 8-bit(n-1), 7: 16-bit(n-1)
    hdr.bits(bsCode, 4); hdr.bits(0, 4); // sample rate from streaminfo
    hdr.bits(chs.length - 1, 4); hdr.bits(bps === 16 ? 4 : 6, 3); hdr.bits(0, 1);
    // UTF-8 style frame number
    if (frameNo < 0x80) hdr.bits(frameNo, 8);
    else if (frameNo < 0x800) { hdr.bits(0xc0 | (frameNo >> 6), 8); hdr.bits(0x80 | (frameNo & 63), 8); }
    else if (frameNo < 0x10000) { hdr.bits(0xe0 | (frameNo >> 12), 8); hdr.bits(0x80 | ((frameNo >> 6) & 63), 8); hdr.bits(0x80 | (frameNo & 63), 8); }
    else if (frameNo < 0x200000) { hdr.bits(0xf0 | (frameNo >> 18), 8); hdr.bits(0x80 | ((frameNo >> 12) & 63), 8); hdr.bits(0x80 | ((frameNo >> 6) & 63), 8); hdr.bits(0x80 | (frameNo & 63), 8); }
    else { hdr.bits(0xf8 | (frameNo >> 24), 8); for (let s = 18; s >= 0; s -= 6) hdr.bits(0x80 | ((frameNo >> s) & 63), 8); }
    if (bsCode === 6) hdr.bits(n - 1, 8); else if (bsCode === 7) hdr.bits(n - 1, 16);
    const hb = hdr.bytes(); const hc = crc8(hb);
    const out = [hb, Uint8Array.of(hc)];
    for (const ch of chs) {
      const x = ch.subarray(start, start + n);
      let bestOrder = 0, bestCost = null;
      for (let o = 0; o <= Math.min(4, n - 1); o++) {
        const r = residual(x, o), c = riceCost(r);
        if (!bestCost || c.bits < bestCost.bits) { bestCost = { ...c, r }; bestOrder = o; }
      }
      w.bits(0, 1); w.bits(8 + bestOrder, 6); w.bits(0, 1);
      for (let i = 0; i < bestOrder; i++) w.bits(x[i] < 0 ? x[i] + Math.pow(2, bps) : x[i], bps);
      w.bits(1, 2); w.bits(0, 4); w.bits(bestCost.k, 5);
      const k = bestCost.k;
      for (const v of bestCost.r) { const u = zz(v); w.unary(Math.floor(u / Math.pow(2, k))); if (k) w.bits(u % Math.pow(2, k), k); }
    }
    w.align();
    const body = w.bytes(), all = new Uint8Array(hb.length + 1 + body.length);
    all.set(hb, 0); all[hb.length] = hc; all.set(body, hb.length + 1);
    const c16 = crc16(all), res = new Uint8Array(all.length + 2);
    res.set(all); res[all.length] = c16 >> 8; res[all.length + 1] = c16 & 255;
    return res;
  }

  /* chs: Float32Array[], sr, bps 16|24 -> ArrayBuffer */
  function encodeFlac(chs, sr, bps) {
    const nch = chs.length, L = chs[0].length, maxv = Math.pow(2, bps - 1) - 1;
    const ints = chs.map((c) => { const o = new Int32Array(c.length); for (let i = 0; i < o.length; i++) { const v = c[i] > 1 ? 1 : c[i] < -1 ? -1 : c[i]; o[i] = Math.round(v * maxv); } return o; });
    const BS = 4096, frames = [];
    for (let s = 0, f = 0; s < L || (L === 0 && f === 0); s += BS, f++) { frames.push(encodeFrame(ints, s, Math.min(BS, L - s), bps, f, sr)); if (L === 0) break; }
    const si = new BitWriter();
    si.bits(BS, 16); si.bits(BS, 16); si.bits(0, 24); si.bits(0, 24);
    si.bits(sr, 20); si.bits(nch - 1, 3); si.bits(bps - 1, 5); si.bits(Math.floor(L / 4294967296), 4); si.bits(L % 4294967296, 32);
    for (let i = 0; i < 16; i++) si.bits(0, 8); // MD5 unset
    const sib = si.bytes();
    let total = 4 + 4 + sib.length; for (const f of frames) total += f.length;
    const out = new Uint8Array(total); let p = 0;
    out.set([0x66, 0x4c, 0x61, 0x43], p); p += 4;
    out.set([0x80, 0, 0, 34], p); p += 4; // last metadata block, STREAMINFO, len 34
    out.set(sib, p); p += sib.length;
    for (const f of frames) { out.set(f, p); p += f.length; }
    return out.buffer;
  }

  /* FLAC written to disk while it is rendered: head(), then await encode(block) → bytes for each block, finish() → the rest */
  function flacStream(nch, sr, bps, total) {
    const maxv = Math.pow(2, bps - 1) - 1, BS = 4096; let hold = Array.from({ length: nch }, () => new Int32Array(0)), f = 0;
    const toInts = (c) => { const o = new Int32Array(c.length); for (let i = 0; i < o.length; i++) { const v = c[i] > 1 ? 1 : c[i] < -1 ? -1 : c[i]; o[i] = Math.round(v * maxv); } return o; };
    const join = (parts) => { let n = 0; for (const p of parts) n += p.length; const o = new Uint8Array(n); let a = 0; for (const p of parts) { o.set(p, a); a += p.length; } return o; };
    return {
      head() {
        const si = new BitWriter(); si.bits(BS, 16); si.bits(BS, 16); si.bits(0, 24); si.bits(0, 24);
        si.bits(sr, 20); si.bits(nch - 1, 3); si.bits(bps - 1, 5); si.bits(Math.floor(total / 4294967296), 4); si.bits(total % 4294967296, 32);
        for (let i = 0; i < 16; i++) si.bits(0, 8);
        const b = si.bytes(), o = new Uint8Array(8 + b.length); o.set([0x66, 0x4c, 0x61, 0x43, 0x80, 0, 0, 34]); o.set(b, 8); return o;
      },
      async encode(chs) {
        const ints = chs.map((c, k) => { const x = toInts(c), j = new Int32Array(hold[k].length + x.length); j.set(hold[k]); j.set(x, hold[k].length); return j; });
        const whole = Math.floor(ints[0].length / BS), parts = [];
        for (let i = 0; i < whole; i++) { parts.push(encodeFrame(ints, i * BS, BS, bps, f++, sr)); if (i % 256 === 255) await new Promise((r) => setTimeout(r, 0)); }
        hold = ints.map((x) => x.slice(whole * BS));
        return join(parts);
      },
      finish() { return hold[0].length ? encodeFrame(hold, 0, hold[0].length, bps, f++, sr) : new Uint8Array(0); },
    };
  }

  /* MP3 via lamejs (global `lamejs` must be loaded). kbps CBR. */
  function encodeMp3(chs, sr, kbps, convertRate) {
    if (typeof lamejs === 'undefined') throw new Error('MP3 encoder not loaded');
    const ok = [8000, 11025, 12000, 16000, 22050, 24000, 32000, 44100, 48000];
    if (!ok.includes(sr)) { const t = sr > 48000 ? (sr % 44100 === 0 ? 44100 : 48000) : 44100; chs = convertRate(chs, sr, t); sr = t; }
    if (chs.length > 2) chs = [chs[0], chs[1]];
    const nch = chs.length, enc = new lamejs.Mp3Encoder(nch, sr, kbps), L = chs[0].length, parts = [];
    const cv = (c, s, e) => { const o = new Int16Array(e - s); for (let i = s; i < e; i++) { const v = c[i] > 1 ? 1 : c[i] < -1 ? -1 : c[i]; o[i - s] = v < 0 ? v * 32768 : v * 32767; } return o; };
    for (let s = 0; s < L; s += 1152 * 16) {
      const e = Math.min(L, s + 1152 * 16);
      const b = nch === 1 ? enc.encodeBuffer(cv(chs[0], s, e)) : enc.encodeBuffer(cv(chs[0], s, e), cv(chs[1], s, e));
      if (b.length) parts.push(new Uint8Array(b));
    }
    const f = enc.flush(); if (f.length) parts.push(new Uint8Array(f));
    let n = 0; for (const p of parts) n += p.length;
    const out = new Uint8Array(n); let p = 0; for (const x of parts) { out.set(x, p); p += x.length; }
    return out.buffer;
  }

  const api = { encodeFlac, flacStream, encodeMp3 };
  root.AS = root.AS || {}; root.AS.codec = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);

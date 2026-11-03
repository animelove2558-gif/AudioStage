/* WAV reader / writer (PCM 8/16/24/32, float 32/64). */
(function (root) {
  'use strict';

  function decodeWav(buf) {
    const dv = new DataView(buf);
    const tag = (o) => String.fromCharCode(dv.getUint8(o), dv.getUint8(o + 1), dv.getUint8(o + 2), dv.getUint8(o + 3));
    if (buf.byteLength < 44 || tag(0) !== 'RIFF' || tag(8) !== 'WAVE') return null;
    let pos = 12, fmt = null, dataOff = 0, dataLen = 0;
    const cues = [], labels = {}, lengths = {}; let bext = null, cart = null;
    const str = (o, n) => { let s = ''; for (let i = 0; i < n; i++) { const c = dv.getUint8(o + i); if (!c) break; s += String.fromCharCode(c); } return s; };
    while (pos + 8 <= buf.byteLength) {
      const id = tag(pos);
      let size = dv.getUint32(pos + 4, true);
      if (id === 'fmt ') {
        fmt = { format: dv.getUint16(pos + 8, true), ch: dv.getUint16(pos + 10, true), sr: dv.getUint32(pos + 12, true), bits: dv.getUint16(pos + 22, true) };
        if (fmt.format === 0xfffe && size >= 40) { fmt.mask = dv.getUint32(pos + 28, true); fmt.format = dv.getUint16(pos + 32, true); }
        else if (fmt.format === 0xfffe && size >= 26) fmt.format = dv.getUint16(pos + 32, true);
      } else if (id === 'data') {
        dataOff = pos + 8;
        if (dataOff + size > buf.byteLength) size = buf.byteLength - dataOff;
        dataLen = size;
      } else if (id === 'cue ' && size >= 4) {
        const n = dv.getUint32(pos + 8, true);
        for (let i = 0; i < n && pos + 12 + i * 24 + 24 <= buf.byteLength; i++) { const o = pos + 12 + i * 24; cues.push({ id: dv.getUint32(o, true), pos: dv.getUint32(o + 20, true) }); }
      } else if (id === 'LIST' && size >= 4 && tag(pos + 8) === 'adtl') {
        let p = pos + 12; const end = Math.min(buf.byteLength, pos + 8 + size);
        while (p + 8 <= end) {
          const sid = tag(p), ss = dv.getUint32(p + 4, true);
          if (sid === 'labl' || sid === 'note') labels[dv.getUint32(p + 8, true)] = str(p + 12, ss - 4);
          else if (sid === 'ltxt' && ss >= 8) lengths[dv.getUint32(p + 8, true)] = dv.getUint32(p + 12, true); // range (region) length
          p += 8 + ss + (ss & 1);
        }
      } else if (id === 'cart' && size >= 2048) {
        cart = { title: str(pos + 8 + 4, 64), artist: str(pos + 8 + 68, 64) };
      } else if (id === 'bext' && size >= 602) {
        bext = { description: str(pos + 8, 256), originator: str(pos + 8 + 256, 32), date: str(pos + 8 + 320, 10) };
      }
      pos += 8 + size + (size & 1);
    }
    if (!fmt || !dataOff) return null;
    const { format, ch, sr, bits } = fmt, bps = bits / 8, frames = Math.floor(dataLen / (bps * ch));
    if (format !== 1 && format !== 3) return null;
    const out = Array.from({ length: ch }, () => new Float32Array(frames));
    for (let i = 0; i < frames; i++) {
      for (let c = 0; c < ch; c++) {
        const o = dataOff + (i * ch + c) * bps;
        let v;
        if (format === 3) v = bits === 64 ? dv.getFloat64(o, true) : dv.getFloat32(o, true);
        else if (bits === 8) v = (dv.getUint8(o) - 128) / 128;
        else if (bits === 16) v = dv.getInt16(o, true) / 32768;
        else if (bits === 24) { let n = dv.getUint8(o) | (dv.getUint8(o + 1) << 8) | (dv.getUint8(o + 2) << 16); if (n & 0x800000) n -= 0x1000000; v = n / 8388608; }
        else if (bits === 32) v = dv.getInt32(o, true) / 2147483648;
        else return null;
        out[c][i] = v;
      }
    }
    const markers = cues.map((c) => ({ t: c.pos, name: labels[c.id] || 'Marker ' + c.id, ...(lengths[c.id] > 0 ? { d: lengths[c.id] } : {}) }));
    return { sr, ch: out, bits: fmt.bits, markers, bext, cart, ...(fmt.mask ? { channelMask: fmt.mask } : {}) };
  }

  /* extra chunks (cue points + labels, BWF bext) appended after the data chunk */
  function buildExtras(o) {
    const parts = [];
    const chunk = (id, bytes) => { const pad = bytes.length & 1, b = new Uint8Array(8 + bytes.length + pad), dv = new DataView(b.buffer); for (let i = 0; i < 4; i++) b[i] = id.charCodeAt(i); dv.setUint32(4, bytes.length, true); b.set(bytes, 8); return b; };
    const enc = (s, n) => { const b = new Uint8Array(n); for (let i = 0; i < Math.min(n, s.length); i++) b[i] = s.charCodeAt(i) & 127; return b; };
    if (o.bext) {
      const b = new Uint8Array(602), d = new Date().toISOString();
      b.set(enc(o.bext.description || '', 256), 0); b.set(enc(o.bext.originator || 'AudioStage', 32), 256);
      b.set(enc(d.slice(0, 10).replace(/-/g, '-'), 10), 320); b.set(enc(d.slice(11, 19), 8), 330); b[346] = 1;
      parts.push(chunk('bext', b));
    }
    if (o.cart) { // CART (broadcast traffic) chunk, 2048-byte fixed header
      const b = new Uint8Array(2048), d = new Date().toISOString(), c = o.cart;
      b.set(enc('0101', 4), 0); b.set(enc(c.title || '', 64), 4); b.set(enc(c.artist || '', 64), 68);
      b.set(enc(d.slice(0, 10), 10), 452); b.set(enc(d.slice(11, 19), 8), 462); b.set(enc('2099-12-31', 10), 470); b.set(enc('23:59:59', 8), 480);
      b.set(enc('AudioStage', 64), 488); b.set(enc('1.0', 64), 552);
      parts.push(chunk('cart', b));
    }
    if (o.markers && o.markers.length) {
      const m = o.markers, cue = new Uint8Array(4 + m.length * 24), dv = new DataView(cue.buffer);
      dv.setUint32(0, m.length, true);
      m.forEach((mk, i) => { const p = 4 + i * 24; dv.setUint32(p, i + 1, true); dv.setUint32(p + 4, mk.t, true); cue.set([100, 97, 116, 97], p + 8); dv.setUint32(p + 20, mk.t, true); });
      parts.push(chunk('cue ', cue));
      const labls = m.map((mk, i) => { const t = enc(mk.name, mk.name.length), b = new Uint8Array(4 + t.length + 1); new DataView(b.buffer).setUint32(0, i + 1, true); b.set(t, 4); return chunk('labl', b); });
      // range markers: an 'ltxt' (region) entry with the length in samples, purpose 'rgn '
      m.forEach((mk, i) => { if (!(mk.d > 0)) return; const b = new Uint8Array(20), v = new DataView(b.buffer); v.setUint32(0, i + 1, true); v.setUint32(4, Math.round(mk.d), true); b.set([114, 103, 110, 32], 8); labls.push(chunk('ltxt', b)); });
      const total = 4 + labls.reduce((a, b) => a + b.length, 0), list = new Uint8Array(total); list.set([97, 100, 116, 108], 0);
      let p = 4; for (const l of labls) { list.set(l, p); p += l.length; }
      parts.push(chunk('LIST', list));
    }
    const n = parts.reduce((a, b) => a + b.length, 0), out = new Uint8Array(n); let p = 0; for (const x of parts) { out.set(x, p); p += x.length; }
    return out;
  }

  /* speaker positions of the channels (WAVE_FORMAT_EXTENSIBLE dwChannelMask): 5.1 = L R C LFE Ls Rs */
  const CHANNEL_MASKS = { 3: 0x7, 4: 0x33, 5: 0x37, 6: 0x3f, 8: 0x63f };
  function encodeWav(chs, sr, bits, dither, opts) {
    const nch = chs.length, L = chs[0].length, fmt = bits === 32 ? 3 : 1, bps = bits / 8;
    const ext = nch > 2, H = ext ? 68 : 44; // more than 2 channels: WAVE_FORMAT_EXTENSIBLE (40-byte fmt) with the speaker mask
    const extras = opts && (opts.markers || opts.bext || opts.cart) ? buildExtras(opts) : new Uint8Array(0);
    const dataLen = L * nch * bps, pad = dataLen & 1, buf = new ArrayBuffer(H + dataLen + pad + extras.length), dv = new DataView(buf);
    new Uint8Array(buf).set(extras, H + dataLen + pad);
    const w = (o, s) => { for (let i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i)); };
    w(0, 'RIFF'); dv.setUint32(4, H - 8 + dataLen + pad + extras.length, true); w(8, 'WAVE'); w(12, 'fmt ');
    dv.setUint32(16, ext ? 40 : 16, true); dv.setUint16(20, ext ? 0xfffe : fmt, true); dv.setUint16(22, nch, true); dv.setUint32(24, sr, true);
    dv.setUint32(28, sr * nch * bps, true); dv.setUint16(32, nch * bps, true); dv.setUint16(34, bits, true);
    if (ext) {
      dv.setUint16(36, 22, true); dv.setUint16(38, bits, true); dv.setUint32(40, CHANNEL_MASKS[nch] || 0, true);
      // sub-format GUID {0000000X-0000-0010-8000-00AA00389B71}: X = 1 PCM, 3 float
      dv.setUint32(44, fmt, true); dv.setUint16(48, 0, true); dv.setUint16(50, 0x10, true); [0x80, 0x00, 0x00, 0xaa, 0x00, 0x38, 0x9b, 0x71].forEach((b, i) => dv.setUint8(52 + i, b));
    }
    w(H - 8, 'data'); dv.setUint32(H - 4, dataLen, true);
    let o = H;
    for (let i = 0; i < L; i++) {
      for (let c = 0; c < nch; c++) {
        let v = chs[c][i];
        if (bits === 32) { dv.setFloat32(o, v, true); o += 4; continue; }
        v = v > 1 ? 1 : v < -1 ? -1 : v;
        if (bits === 16) {
          let s = v * 32767;
          if (dither) s += Math.random() - Math.random();
          dv.setInt16(o, Math.max(-32768, Math.min(32767, Math.round(s))), true); o += 2;
        } else if (bits === 24) {
          let n = Math.round(v * 8388607);
          if (n < 0) n += 0x1000000;
          dv.setUint8(o, n & 255); dv.setUint8(o + 1, (n >> 8) & 255); dv.setUint8(o + 2, (n >> 16) & 255); o += 3;
        } else { dv.setUint8(o, Math.round(v * 127 + 128)); o += 1; }
      }
    }
    return buf;
  }

  root.AS = root.AS || {};
  root.AS.wav = { decodeWav, encodeWav, CHANNEL_MASKS };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.AS.wav;
})(typeof window !== 'undefined' ? window : globalThis);

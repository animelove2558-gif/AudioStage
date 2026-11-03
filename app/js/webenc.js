/* Opus (Ogg) and AAC (ADTS) export using the browser's WebCodecs AudioEncoder. */
(function (root) {
  'use strict';
  const AS = (root.AS = root.AS || {});
  const avail = { opus: false, aac: false };

  async function detect() {
    if (typeof AudioEncoder === 'undefined') return avail;
    try { avail.opus = (await AudioEncoder.isConfigSupported({ codec: 'opus', sampleRate: 48000, numberOfChannels: 2, bitrate: 128000 })).supported; } catch (e) { /* */ }
    try { avail.aac = (await AudioEncoder.isConfigSupported({ codec: 'mp4a.40.2', sampleRate: 44100, numberOfChannels: 2, bitrate: 128000 })).supported; } catch (e) { /* */ }
    return avail;
  }

  async function runEncoder(chs, sr, config) {
    const nch = chs.length, L = chs[0].length, out = [];
    let meta = null, err = null;
    const enc = new AudioEncoder({
      output: (chunk, m) => { const b = new Uint8Array(chunk.byteLength); chunk.copyTo(b); out.push({ data: b, ts: chunk.timestamp, dur: chunk.duration || 0 }); if (m && m.decoderConfig && !meta) meta = m.decoderConfig; },
      error: (e) => { err = e; },
    });
    enc.configure({ ...config, sampleRate: sr, numberOfChannels: nch });
    const BLK = 4800;
    for (let s = 0; s < L && !err; s += BLK) {
      const n = Math.min(BLK, L - s), buf = new Float32Array(n * nch);
      for (let c = 0; c < nch; c++) buf.set(chs[c].subarray(s, s + n), c * n);
      const ad = new AudioData({ format: 'f32-planar', sampleRate: sr, numberOfFrames: n, numberOfChannels: nch, timestamp: Math.round((s / sr) * 1e6), data: buf });
      enc.encode(ad); ad.close();
      while (enc.encodeQueueSize > 12) await new Promise((r) => setTimeout(r, 5));
    }
    await enc.flush(); enc.close();
    if (err) throw err;
    return { chunks: out, meta };
  }

  /* ---------- Ogg muxing ---------- */
  const crcT = new Uint32Array(256);
  for (let i = 0; i < 256; i++) { let r = i << 24; for (let k = 0; k < 8; k++) r = r & 0x80000000 ? (r << 1) ^ 0x04c11db7 : r << 1; crcT[i] = r >>> 0; }
  function oggPage(serial, seq, granule, flags, packets, continued) {
    const segs = [];
    for (const p of packets) { let n = p.length; while (n >= 255) { segs.push(255); n -= 255; } segs.push(n); }
    let size = 27 + segs.length; for (const p of packets) size += p.length;
    const b = new Uint8Array(size), dv = new DataView(b.buffer);
    b.set([0x4f, 0x67, 0x67, 0x53, 0, flags | (continued ? 1 : 0)], 0);
    dv.setUint32(6, Number(BigInt.asUintN(32, granule)), true); dv.setUint32(10, Number(BigInt.asUintN(64, granule) >> 32n), true);
    dv.setUint32(14, serial, true); dv.setUint32(18, seq, true); b[26] = segs.length; b.set(segs, 27);
    let p = 27 + segs.length; for (const pk of packets) { b.set(pk, p); p += pk.length; }
    let crc = 0; for (let i = 0; i < b.length; i++) crc = ((crc << 8) ^ crcT[((crc >>> 24) ^ b[i]) & 255]) >>> 0;
    dv.setUint32(22, crc, true);
    return b;
  }
  function concat(parts) { let n = 0; for (const p of parts) n += p.length; const o = new Uint8Array(n); let q = 0; for (const p of parts) { o.set(p, q); q += p.length; } return o; }

  async function encodeOpus(chs, sr, kbps) {
    if (!avail.opus) throw new Error('Opus encoding is not supported on this system.');
    if (chs.length > 2) chs = chs.slice(0, 2);
    const D = AS.dsp;
    if (sr !== 48000) { chs = D.convertRate(chs, sr, 48000); sr = 48000; }
    const { chunks, meta } = await runEncoder(chs, sr, { codec: 'opus', bitrate: kbps * 1000 });
    const nch = chs.length, serial = (Math.random() * 0xffffffff) >>> 0, enc = new TextEncoder();
    let head = meta && meta.description ? new Uint8Array(meta.description.buffer ? new Uint8Array(meta.description.buffer, meta.description.byteOffset, meta.description.byteLength) : meta.description) : null;
    if (!head || String.fromCharCode(...head.slice(0, 8)) !== 'OpusHead') {
      head = new Uint8Array(19); head.set(enc.encode('OpusHead')); head[8] = 1; head[9] = nch; new DataView(head.buffer).setUint16(10, 312, true); new DataView(head.buffer).setUint32(12, 48000, true);
    }
    const preskip = new DataView(head.buffer, head.byteOffset).getUint16(10, true);
    const vendor = enc.encode('AudioStage'), tags = new Uint8Array(8 + 4 + vendor.length + 4);
    tags.set(enc.encode('OpusTags')); new DataView(tags.buffer).setUint32(8, vendor.length, true); tags.set(vendor, 12);
    const pages = [oggPage(serial, 0, 0n, 0x02, [head]), oggPage(serial, 1, 0n, 0, [tags])];
    let seq = 2, i = 0; const totalSamples = chs[0].length;
    while (i < chunks.length) {
      const group = []; let segCount = 0, j = i;
      while (j < chunks.length && group.length < 40) { const n = Math.floor(chunks[j].data.length / 255) + 1; if (segCount + n > 250) break; group.push(chunks[j].data); segCount += n; j++; }
      const last = chunks[j - 1], end = Math.min(totalSamples, Math.round(((last.ts + last.dur) / 1e6) * 48000)) + preskip;
      const eos = j >= chunks.length;
      pages.push(oggPage(serial, seq++, BigInt(eos ? totalSamples + preskip : end), eos ? 0x04 : 0, group));
      i = j;
    }
    return concat(pages).buffer;
  }

  async function encodeAac(chs, sr, kbps) {
    if (!avail.aac) throw new Error('AAC encoding is not supported on this system.');
    if (chs.length > 2) chs = chs.slice(0, 2);
    const D = AS.dsp;
    if (![44100, 48000].includes(sr)) { chs = D.convertRate(chs, sr, 44100); sr = 44100; }
    const { chunks, meta } = await runEncoder(chs, sr, { codec: 'mp4a.40.2', bitrate: kbps * 1000 });
    const rates = [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000], idx = rates.indexOf(sr), nch = chs.length;
    let obj = 2; if (meta && meta.description) { const d = new Uint8Array(meta.description.buffer ? meta.description.buffer : meta.description); obj = d[0] >> 3 || 2; }
    const out = [];
    for (const c of chunks) {
      const len = c.data.length + 7, h = new Uint8Array(7);
      h[0] = 0xff; h[1] = 0xf1; h[2] = ((obj - 1) << 6) | (idx << 2) | (nch >> 2); h[3] = ((nch & 3) << 6) | (len >> 11); h[4] = (len >> 3) & 255; h[5] = ((len & 7) << 5) | 0x1f; h[6] = 0xfc;
      out.push(h, c.data);
    }
    return concat(out).buffer;
  }

  /* ---------- M4A (AAC-LC in an MP4 container) ---------- */
  const be32 = (n) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255], be16 = (n) => [(n >> 8) & 255, n & 255];
  const str4 = (s) => [...s].map((c) => c.charCodeAt(0));
  function box(type, ...parts) {
    const flat = []; let n = 0;
    for (const p of parts) { const u = p instanceof Uint8Array ? p : Uint8Array.from(p); flat.push(u); n += u.length; }
    const out = new Uint8Array(8 + n); out.set(be32(8 + n), 0); out.set(str4(type), 4);
    let q = 8; for (const u of flat) { out.set(u, q); q += u.length; }
    return out;
  }
  async function encodeM4a(chs, sr, kbps) {
    if (!avail.aac) throw new Error('AAC encoding is not supported on this system.');
    if (chs.length > 2) chs = chs.slice(0, 2);
    if (![44100, 48000].includes(sr)) { chs = AS.dsp.convertRate(chs, sr, 44100); sr = 44100; }
    const { chunks, meta } = await runEncoder(chs, sr, { codec: 'mp4a.40.2', bitrate: kbps * 1000 }), nch = chs.length, n = chunks.length;
    const rates = [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000], idx = rates.indexOf(sr);
    let asc = null;
    if (meta && meta.description) { const d = meta.description; asc = new Uint8Array(d.buffer ? new Uint8Array(d.buffer, d.byteOffset || 0, d.byteLength) : d); }
    if (!asc || asc.length < 2) { const v = (2 << 11) | (idx << 7) | (nch << 3); asc = Uint8Array.of(v >> 8, v & 255); }
    const mdatLen = chunks.reduce((a, c) => a + c.data.length, 0), dur = n * 1024, ident = [0, 0, 0, 0];
    const matrix = [...be32(0x10000), 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, ...be32(0x10000), 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, ...be32(0x40000000)];
    const esds = box('esds', ident, [0x03, 23 + asc.length, 0, 0, 0], [0x04, 15 + asc.length, 0x40, 0x15, 0, 0, 0, ...be32(kbps * 1000), ...be32(kbps * 1000), 0x05, asc.length], asc, [0x06, 0x01, 0x02]);
    const mp4a = box('mp4a', [0, 0, 0, 0, 0, 0, 0, 1], [0, 0, 0, 0, 0, 0, 0, 0], be16(nch), be16(16), [0, 0, 0, 0], be16(sr), [0, 0], esds);
    const sizes = new Uint8Array(4 * n); chunks.forEach((c, i) => sizes.set(be32(c.data.length), i * 4));
    const build = (offset) => box('moov',
      box('mvhd', ident, ident, ident, be32(sr), be32(dur), be32(0x10000), be16(0x100), [0, 0], [0, 0, 0, 0, 0, 0, 0, 0], matrix, new Uint8Array(24), be32(2)),
      box('trak',
        box('tkhd', [0, 0, 0, 7], ident, ident, be32(1), ident, be32(dur), [0, 0, 0, 0, 0, 0, 0, 0], [0, 0], [0, 0], be16(0x100), [0, 0], matrix, ident, ident),
        box('mdia',
          box('mdhd', ident, ident, ident, be32(sr), be32(dur), be16(0x55c4), [0, 0]),
          box('hdlr', ident, ident, str4('soun'), new Uint8Array(12), [...str4('SoundHandler'), 0]),
          box('minf', box('smhd', ident, [0, 0, 0, 0]), box('dinf', box('dref', ident, be32(1), box('url ', [0, 0, 0, 1]))),
            box('stbl', box('stsd', ident, be32(1), mp4a), box('stts', ident, be32(1), be32(n), be32(1024)), box('stsc', ident, be32(1), be32(1), be32(n), be32(1)),
              box('stsz', ident, ident, be32(n), sizes), box('stco', ident, be32(1), be32(offset)))))));
    const ftyp = box('ftyp', str4('M4A '), ident, str4('M4A '), str4('mp42'), str4('isom'));
    const moov0 = build(0), offset = ftyp.length + moov0.length + 8, moov = build(offset);
    const mdat = new Uint8Array(8 + mdatLen); mdat.set(be32(8 + mdatLen), 0); mdat.set(str4('mdat'), 4);
    let q = 8; for (const c of chunks) { mdat.set(c.data, q); q += c.data.length; }
    return concat([ftyp, moov, mdat]).buffer;
  }

  AS.webenc = { detect, avail, encodeOpus, encodeAac, encodeM4a };
})(window);

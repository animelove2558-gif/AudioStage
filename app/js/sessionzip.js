/* .asession format 4: a ZIP file (stored, no compression) holding
     session.json          the session (format 4) with every audio source listed once: {name, sr, channels, frames, file}
     audio/<n>.wav         one 32-bit float WAV per source (interleaved), referred to by "file"
   Written and read in pieces: the audio never has to fit into one string or one IPC message, so sessions of any
   length save and open (format 1–3 kept all audio as base64 inside one JSON string, which V8 caps at ~512 MB ≈ 17 min
   of stereo 48 kHz). ZIP64 is used where sizes / offsets pass 4 GB. The ZIP is written strictly front to back (local
   header, data, data descriptor), so the sink only needs write(); reading needs read(offset, length) and size.
   sink:   { write(Uint8Array) → Promise }                       (desktop: chunks to the main process, which writes
                                                                    a temporary file and renames it when complete)
   source: { size, read(offset, length) → Promise<Uint8Array> }   (desktop: a file read in pieces; browser: a File) */
(function (root) {
  'use strict';
  const AS = (root.AS = root.AS || {});
  const FORMAT = 4, CHUNK_FRAMES = 1 << 20; // ≤ 8 MB per stereo chunk
  const U32 = 0xffffffff;

  /* ---------- CRC-32 (IEEE) ---------- */
  const TABLE = (() => { const t = new Int32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c; } return t; })();
  function crc32(u8, prev) {
    let c = (prev === undefined ? 0 : prev) ^ -1;
    for (let i = 0, n = u8.length; i < n; i++) c = TABLE[(c ^ u8[i]) & 0xff] ^ (c >>> 8);
    return (c ^ -1) >>> 0;
  }

  /* little-endian helpers (64-bit values as Numbers: exact up to 2^53) */
  const w16 = (v, o, x) => v.setUint16(o, x, true), w32 = (v, o, x) => v.setUint32(o, x >>> 0, true);
  const w64 = (v, o, x) => { v.setUint32(o, x % 0x100000000, true); v.setUint32(o + 4, Math.floor(x / 0x100000000), true); };
  const r64 = (v, o) => v.getUint32(o, true) + v.getUint32(o + 4, true) * 0x100000000;
  const utf8 = (s) => new TextEncoder().encode(s);
  const dosTime = (d) => ((d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1)) & 0xffff;
  const dosDate = (d) => (((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()) & 0xffff;

  /* ---------- writer ---------- */
  class ZipWriter {
    constructor(sink) { this.sink = sink; this.offset = 0; this.entries = []; this.cur = null; const now = new Date(); this.time = dosTime(now); this.date = dosDate(now); }
    async put(u8) { if (!u8.length) return; await this.sink.write(u8); this.offset += u8.length; }
    /* start an entry; big = it may pass 4 GB (ZIP64 sizes) */
    async begin(name, big) {
      if (this.cur) throw new Error('ZIP entry still open');
      const nm = utf8(name), z64 = !!big || this.offset >= U32, h = new Uint8Array(30 + nm.length + (z64 ? 20 : 0)), v = new DataView(h.buffer);
      w32(v, 0, 0x04034b50); w16(v, 4, z64 ? 45 : 20); w16(v, 6, 0x0808); w16(v, 8, 0); w16(v, 10, this.time); w16(v, 12, this.date);
      w32(v, 14, 0); w32(v, 18, z64 ? U32 : 0); w32(v, 22, z64 ? U32 : 0); w16(v, 26, nm.length); w16(v, 28, z64 ? 20 : 0); h.set(nm, 30);
      if (z64) { const e = 30 + nm.length; w16(v, e, 1); w16(v, e + 2, 16); } // sizes 0 here: they follow in the data descriptor
      this.cur = { name: nm, z64, at: this.offset, crc: 0, size: 0 };
      await this.put(h);
    }
    async data(u8) { const c = this.cur; c.crc = crc32(u8, c.crc); c.size += u8.length; await this.put(u8); }
    async end() {
      const c = this.cur; this.cur = null;
      if (!c.z64 && c.size >= U32) throw new Error('ZIP entry too large');
      const d = new Uint8Array(c.z64 ? 24 : 16), v = new DataView(d.buffer);
      w32(v, 0, 0x08074b50); w32(v, 4, c.crc);
      if (c.z64) { w64(v, 8, c.size); w64(v, 16, c.size); } else { w32(v, 8, c.size); w32(v, 12, c.size); }
      await this.put(d); this.entries.push(c);
    }
    async file(name, u8) { await this.begin(name, u8.length >= U32); await this.data(u8); await this.end(); }
    async finish() {
      const cdAt = this.offset, parts = [];
      for (const c of this.entries) {
        const z64 = c.z64 || c.size >= U32 || c.at >= U32, h = new Uint8Array(46 + c.name.length + (z64 ? 28 : 0)), v = new DataView(h.buffer);
        w32(v, 0, 0x02014b50); w16(v, 4, 45); w16(v, 6, z64 ? 45 : 20); w16(v, 8, 0x0808); w16(v, 10, 0); w16(v, 12, this.time); w16(v, 14, this.date);
        w32(v, 16, c.crc); w32(v, 20, z64 ? U32 : c.size); w32(v, 24, z64 ? U32 : c.size); w16(v, 28, c.name.length); w16(v, 30, z64 ? 28 : 0);
        w16(v, 32, 0); w16(v, 34, 0); w16(v, 36, 0); w32(v, 38, 0); w32(v, 42, z64 ? U32 : c.at); h.set(c.name, 46);
        if (z64) { const e = 46 + c.name.length; w16(v, e, 1); w16(v, e + 2, 24); w64(v, e + 4, c.size); w64(v, e + 12, c.size); w64(v, e + 20, c.at); }
        parts.push(h);
      }
      const cdSize = parts.reduce((a, p) => a + p.length, 0), n = this.entries.length, z64 = cdAt + cdSize >= U32 || n >= 0xffff;
      const tail = new Uint8Array((z64 ? 56 + 20 : 0) + 22), v = new DataView(tail.buffer); let o = 0;
      if (z64) {
        const recAt = cdAt + cdSize;
        w32(v, 0, 0x06064b50); w64(v, 4, 44); w16(v, 12, 45); w16(v, 14, 45); w32(v, 16, 0); w32(v, 20, 0); w64(v, 24, n); w64(v, 32, n); w64(v, 40, cdSize); w64(v, 48, cdAt);
        w32(v, 56, 0x07064b50); w32(v, 60, 0); w64(v, 64, recAt); w32(v, 72, 1); o = 76;
      }
      w32(v, o, 0x06054b50); w16(v, o + 4, 0); w16(v, o + 6, 0); w16(v, o + 8, z64 ? 0xffff : n); w16(v, o + 10, z64 ? 0xffff : n);
      w32(v, o + 12, z64 ? U32 : cdSize); w32(v, o + 16, z64 ? U32 : cdAt); w16(v, o + 20, 0);
      for (const p of parts) await this.put(p);
      await this.put(tail);
      return this.offset;
    }
  }

  /* ---------- reader ---------- */
  const isZip = (head) => head.length >= 4 && head[0] === 0x50 && head[1] === 0x4b && head[2] === 3 && head[3] === 4;
  /* → Map name → { at (data offset), size, crc, method } */
  async function listZip(src) {
    const tailLen = Math.min(src.size, 22 + 65535 + 20 + 56), base = src.size - tailLen, tail = await src.read(base, tailLen), tv = new DataView(tail.buffer, tail.byteOffset, tail.byteLength);
    let e = -1; for (let i = tail.length - 22; i >= 0; i--) if (tv.getUint32(i, true) === 0x06054b50) { e = i; break; }
    if (e < 0) throw new Error('Not an AudioStage session (no ZIP directory).');
    let n = tv.getUint16(e + 10, true), cdSize = tv.getUint32(e + 12, true), cdAt = tv.getUint32(e + 16, true);
    if (n === 0xffff || cdSize === U32 || cdAt === U32) {
      const l = e - 20; if (l < 0 || tv.getUint32(l, true) !== 0x07064b50) throw new Error('Damaged session file (ZIP64 locator missing).');
      const recAt = r64(tv, l + 8), rec = await src.read(recAt, 56), rv = new DataView(rec.buffer, rec.byteOffset, 56);
      if (rv.getUint32(0, true) !== 0x06064b50) throw new Error('Damaged session file (ZIP64 record missing).');
      n = r64(rv, 32); cdSize = r64(rv, 40); cdAt = r64(rv, 48);
    }
    if (cdAt + cdSize > src.size) throw new Error('Damaged or incomplete session file.');
    const cd = await src.read(cdAt, cdSize), v = new DataView(cd.buffer, cd.byteOffset, cd.byteLength), out = new Map(), dec = new TextDecoder();
    let p = 0;
    for (let k = 0; k < n; k++) {
      if (v.getUint32(p, true) !== 0x02014b50) throw new Error('Damaged session file (ZIP directory).');
      const method = v.getUint16(p + 10, true), crc = v.getUint32(p + 16, true), nl = v.getUint16(p + 28, true), xl = v.getUint16(p + 30, true), cl = v.getUint16(p + 32, true);
      let csize = v.getUint32(p + 20, true), size = v.getUint32(p + 24, true), at = v.getUint32(p + 42, true);
      const name = dec.decode(cd.subarray(p + 46, p + 46 + nl));
      for (let x = p + 46 + nl, xe = x + xl; x + 4 <= xe;) {
        const tag = v.getUint16(x, true), len = v.getUint16(x + 2, true);
        if (tag === 1) { let q = x + 4; if (size === U32) { size = r64(v, q); q += 8; } if (csize === U32) { csize = r64(v, q); q += 8; } if (at === U32) { at = r64(v, q); q += 8; } }
        x += 4 + len;
      }
      const lh = await src.read(at, 30), lv = new DataView(lh.buffer, lh.byteOffset, 30);
      if (lv.getUint32(0, true) !== 0x04034b50) throw new Error('Damaged session file (entry header).');
      out.set(name, { at: at + 30 + lv.getUint16(26, true) + lv.getUint16(28, true), size, csize, crc, method });
      p += 46 + nl + xl + cl;
    }
    return out;
  }
  /* read a stored entry in pieces: onPiece(u8, offsetInEntry); the CRC is checked at the end */
  async function readEntry(src, ent, onPiece, pieceBytes) {
    if (ent.method !== 0) throw new Error('Compressed entries are not supported in .asession files.');
    let crc = 0; const step = pieceBytes || 8 * 1024 * 1024;
    for (let o = 0; o < ent.size; o += step) { const u = await src.read(ent.at + o, Math.min(step, ent.size - o)); crc = crc32(u, crc); await onPiece(u, o); }
    if (crc !== ent.crc) throw new Error('The session file is damaged (checksum mismatch).');
  }
  async function readSmall(src, ent) { const parts = []; await readEntry(src, ent, (u) => { parts.push(u.slice()); }); const o = new Uint8Array(ent.size); let p = 0; for (const u of parts) { o.set(u, p); p += u.length; } return o; }

  /* ---------- 32-bit float WAV header (44 bytes; sizes clamped at 4 GB — the reader trusts the ZIP entry size) ---------- */
  function wavHeader(nch, sr, frames) {
    const h = new Uint8Array(44), v = new DataView(h.buffer), bytes = frames * nch * 4, s = (o, t) => { for (let i = 0; i < 4; i++) h[o + i] = t.charCodeAt(i); };
    s(0, 'RIFF'); w32(v, 4, Math.min(U32, 36 + bytes)); s(8, 'WAVE'); s(12, 'fmt '); w32(v, 16, 16); w16(v, 20, 3); w16(v, 22, nch); w32(v, 24, sr); w32(v, 28, sr * nch * 4); w16(v, 32, nch * 4); w16(v, 34, 32);
    s(36, 'data'); w32(v, 40, Math.min(U32, bytes));
    return h;
  }
  function parseWavHeader(u8) {
    const v = new DataView(u8.buffer, u8.byteOffset, u8.byteLength), tag = (o) => String.fromCharCode(u8[o], u8[o + 1], u8[o + 2], u8[o + 3]);
    if (u8.length < 12 || tag(0) !== 'RIFF' || tag(8) !== 'WAVE') throw new Error('Bad audio in the session file.');
    let p = 12, fmt = null;
    while (p + 8 <= u8.length) {
      const id = tag(p), len = v.getUint32(p + 4, true);
      if (id === 'fmt ') fmt = { format: v.getUint16(p + 8, true), nch: v.getUint16(p + 10, true), sr: v.getUint32(p + 12, true), bits: v.getUint16(p + 22, true) };
      if (id === 'data') { if (!fmt || fmt.bits !== 32 || (fmt.format !== 3 && fmt.format !== 0xfffe)) throw new Error('Unexpected audio format in the session file.'); return { ...fmt, dataAt: p + 8 }; }
      p += 8 + len + (len & 1);
    }
    throw new Error('Bad audio in the session file.');
  }

  /* ---------- the session ---------- */
  const tick = () => new Promise((r) => setTimeout(r, 0));
  /* bytes the session will take (audio of every source once + headers) — for progress and the free-space check */
  function sourcesOf(session) { const list = []; AS.sessionIO.serialize(session, { ref: (s) => { if (!list.includes(s)) list.push(s); return list.indexOf(s); } }); return list; }
  const sourceBytes = (s) => 44 + s.ch[0].length * s.ch.length * 4;
  function estimate(session) { return sourcesOf(session).reduce((a, s) => a + sourceBytes(s) + 200, 4096); }

  /* o: { onProgress(done, total), signal: { aborted } } */
  async function write(session, sink, o) {
    const oo = o || {}, list = [], z = new ZipWriter(sink);
    const json = AS.sessionIO.serialize(session, { ref: (s) => { let i = list.indexOf(s); if (i < 0) { list.push(s); i = list.length - 1; } return i; } });
    const total = list.reduce((a, s) => a + sourceBytes(s), 0); let done = 0;
    json.sources = list.map((s, i) => ({ name: s.name, sr: s.sr, channels: s.ch.length, frames: s.ch[0].length, file: `audio/${i + 1}.wav`, ...(s.tempo ? { tempo: s.tempo } : {}) }));
    json.container = 'zip';
    for (let i = 0; i < list.length; i++) {
      const s = list[i], nch = s.ch.length, L = s.ch[0].length;
      await z.begin(json.sources[i].file, sourceBytes(s) >= U32 - 1024);
      await z.data(wavHeader(nch, s.sr, L));
      for (let a = 0; a < L; a += CHUNK_FRAMES) {
        if (oo.signal && oo.signal.aborted) throw Object.assign(new Error('Cancelled'), { cancelled: true });
        const n = Math.min(CHUNK_FRAMES, L - a), buf = new Float32Array(n * nch);
        if (nch === 1) buf.set(s.ch[0].subarray(a, a + n)); else for (let c = 0; c < nch; c++) { const x = s.ch[c]; for (let k = 0, j = c; k < n; k++, j += nch) buf[j] = x[a + k]; }
        await z.data(new Uint8Array(buf.buffer)); done += buf.byteLength;
        if (oo.onProgress) oo.onProgress(done, total);
      }
      await z.end();
    }
    await z.file('session.json', utf8(JSON.stringify(json)));
    return z.finish();
  }

  /* source → Session (format 4). o: { onProgress(done, total), signal } */
  async function read(src, o) {
    const oo = o || {}, ents = await listZip(src), je = ents.get('session.json');
    if (!je) throw new Error('Not an AudioStage session (session.json missing).');
    const j = JSON.parse(new TextDecoder().decode(await readSmall(src, je)));
    const total = (j.sources || []).reduce((a, s) => a + ((ents.get(s.file) || {}).size || 0), 0); let done = 0;
    const sources = [];
    for (const s of j.sources || []) {
      const ent = ents.get(s.file); if (!ent) throw new Error('Audio missing from the session file: ' + s.file);
      let fmt = null, ch = null, nch = 0, frame = 0, carry = new Uint8Array(0);
      await readEntry(src, ent, async (u, off) => {
        if (oo.signal && oo.signal.aborted) throw Object.assign(new Error('Cancelled'), { cancelled: true });
        let piece = u;
        if (!fmt) { // the header is in the first piece (pieces are MBs)
          fmt = parseWavHeader(u); nch = fmt.nch; const frames = Math.floor((ent.size - fmt.dataAt) / (4 * nch));
          ch = Array.from({ length: nch }, () => new Float32Array(frames)); piece = u.subarray(fmt.dataAt);
        }
        if (carry.length) { const m = new Uint8Array(carry.length + piece.length); m.set(carry); m.set(piece, carry.length); piece = m; }
        const fb = 4 * nch, whole = Math.min(Math.floor(piece.length / fb), ch[0].length - frame), al = new Float32Array(piece.slice(0, whole * fb).buffer);
        if (nch === 1) ch[0].set(al, frame); else for (let c = 0; c < nch; c++) { const x = ch[c]; for (let k = 0, i = c; k < whole; k++, i += nch) x[frame + k] = al[i]; }
        frame += whole; carry = piece.slice(whole * fb);
        done += u.length; if (oo.onProgress) oo.onProgress(done, total);
        await tick();
      });
      if (!ch) throw new Error('Bad audio in the session file: ' + s.file);
      sources.push(Object.assign(AS.makeSource(s.name, fmt.sr || s.sr, ch), s.tempo ? { tempo: s.tempo } : {}));
    }
    delete j.container; j.sources = [];
    return AS.sessionIO.deserialize(j, { sources });
  }

  /* desktop: a sink that streams to the main process (AS.disk) · tests: any { write } */
  AS.sessionZip = { FORMAT, crc32, ZipWriter, listZip, readEntry, isZip, wavHeader, parseWavHeader, write, read, estimate, sourcesOf };
})(typeof window !== 'undefined' ? window : globalThis);

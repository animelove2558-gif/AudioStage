/* File metadata (tags), written and read by AudioStage itself — no GPL tag library:
     MP3 / ADTS AAC  ID3v2.4 at the start (reads ID3v2.2 / 2.3 / 2.4 and ID3v1)
     FLAC            VORBIS_COMMENT + PICTURE metadata blocks
     Ogg Opus        OpusTags comment header (cover as METADATA_BLOCK_PICTURE); reads Ogg Vorbis too
     M4A (MP4)       moov/udta/meta/ilst atoms (©nam ©ART ©alb ©day ©gen ©cmt trkn covr); chunk offsets are fixed up
     WAV             LIST/INFO (UTF-8) + an "id3 " chunk (cover); BWF / CART stay in wav.js
   meta = { title, artist, album, year, genre, track, comment, cover: { mime, b64 } | null } — all text is UTF-8 (Thai works).
   write(bytes, format, meta) → Uint8Array · read(bytes) → meta | null. Tested in tests/tags.test.js (write → read back). */
(function (root) {
  'use strict';
  const AS = (root.AS = root.AS || {});
  const te = new TextEncoder(), utf8 = new TextDecoder('utf-8'), latin1 = new TextDecoder('latin1'), u16le = new TextDecoder('utf-16le'), u16be = new TextDecoder('utf-16be');
  const FIELDS = ['title', 'artist', 'album', 'year', 'genre', 'track', 'comment'];

  /* ---------- small helpers ---------- */
  const concat = (parts) => { let n = 0; for (const p of parts) n += p.length; const o = new Uint8Array(n); let q = 0; for (const p of parts) { o.set(p, q); q += p.length; } return o; };
  const u8 = (a) => (a instanceof Uint8Array ? a : Uint8Array.from(a));
  const be32 = (n) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255], le32 = (n) => [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255];
  const rbe32 = (b, o) => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0, rle32 = (b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
  const ascii = (b, o, n) => String.fromCharCode(...b.subarray(o, o + n));
  const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/', B64I = new Int16Array(256).fill(-1); for (let i = 0; i < 64; i++) B64I[B64.charCodeAt(i)] = i;
  function toB64(b) { let s = ''; for (let i = 0; i < b.length; i += 3) { const n = (b[i] << 16) | ((b[i + 1] || 0) << 8) | (b[i + 2] || 0); s += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + (i + 1 < b.length ? B64[(n >> 6) & 63] : '=') + (i + 2 < b.length ? B64[n & 63] : '='); } return s; }
  function fromB64(s) { s = String(s).replace(/[^A-Za-z0-9+/]/g, ''); const o = new Uint8Array(Math.floor((s.length * 3) / 4)); let q = 0, acc = 0, bits = 0; for (let i = 0; i < s.length; i++) { acc = (acc << 6) | B64I[s.charCodeAt(i)]; bits += 6; if (bits >= 8) { bits -= 8; o[q++] = (acc >> bits) & 255; } } return o.subarray(0, q); }
  const sniffMime = (d) => (d[0] === 0x89 && d[1] === 0x50 ? 'image/png' : d[0] === 0xff && d[1] === 0xd8 ? 'image/jpeg' : d[0] === 0x47 && d[1] === 0x49 ? 'image/gif' : 'image/jpeg');
  const coverOf = (data, mime) => (data && data.length ? { mime: /^image\//.test(mime || '') ? mime : sniffMime(data), b64: toB64(data) } : null);
  /* a tidy copy: strings trimmed, cover {mime, b64} (also accepts {mime, data}) */
  function clean(m) {
    const o = {}; m = m || {};
    for (const k of FIELDS) o[k] = m[k] === undefined || m[k] === null ? '' : String(m[k]).replace(/\0/g, '').trim();
    const c = m.cover; o.cover = c && (c.b64 || (c.data && c.data.length)) ? { mime: c.mime || sniffMime(c.data || fromB64(c.b64).subarray(0, 4)), b64: c.b64 || toB64(u8(c.data)) } : null;
    return o;
  }
  const isEmpty = (m) => { const c = clean(m); return !c.cover && FIELDS.every((k) => !c[k]); };
  const coverBytes = (m) => (m.cover ? fromB64(m.cover.b64) : null);
  const trackParts = (t) => { const x = /^\s*(\d+)\s*(?:\/\s*(\d+))?/.exec(t || ''); return x ? [+x[1], x[2] ? +x[2] : 0] : [0, 0]; };

  /* ---------- ID3v2 ---------- */
  const GENRES = 'Blues,Classic Rock,Country,Dance,Disco,Funk,Grunge,Hip-Hop,Jazz,Metal,New Age,Oldies,Other,Pop,R&B,Rap,Reggae,Rock,Techno,Industrial,Alternative,Ska,Death Metal,Pranks,Soundtrack,Euro-Techno,Ambient,Trip-Hop,Vocal,Jazz+Funk,Fusion,Trance,Classical,Instrumental,Acid,House,Game,Sound Clip,Gospel,Noise,AlternRock,Bass,Soul,Punk,Space,Meditative,Instrumental Pop,Instrumental Rock,Ethnic,Gothic,Darkwave,Techno-Industrial,Electronic,Pop-Folk,Eurodance,Dream,Southern Rock,Comedy,Cult,Gangsta,Top 40,Christian Rap,Pop/Funk,Jungle,Native American,Cabaret,New Wave,Psychadelic,Rave,Showtunes,Trailer,Lo-Fi,Tribal,Acid Punk,Acid Jazz,Polka,Retro,Musical,Rock & Roll,Hard Rock'.split(',');
  const genreText = (g) => { const s = String(g || '').trim(), m = /^\((\d+)\)(.*)$/.exec(s); if (m) return m[2].trim() || GENRES[+m[1]] || ''; return /^\d+$/.test(s) && GENRES[+s] ? GENRES[+s] : s; };
  const synch = (n) => [(n >>> 21) & 127, (n >>> 14) & 127, (n >>> 7) & 127, n & 127], rsynch = (b, o) => ((b[o] & 127) << 21) | ((b[o + 1] & 127) << 14) | ((b[o + 2] & 127) << 7) | (b[o + 3] & 127);
  const frame = (id, body) => concat([te.encode(id), u8(synch(body.length)), u8([0, 0]), body]);
  /* ID3v2.4 tag, all text UTF-8 (encoding byte 3) */
  function id3(meta) {
    const m = clean(meta), f = [], txt = (id, v) => { if (v) f.push(frame(id, concat([u8([3]), te.encode(v)]))); };
    txt('TIT2', m.title); txt('TPE1', m.artist); txt('TALB', m.album); txt('TDRC', m.year); txt('TCON', m.genre); txt('TRCK', m.track);
    if (m.comment) f.push(frame('COMM', concat([u8([3]), te.encode('und'), u8([0]), te.encode(m.comment)])));
    const c = coverBytes(m); if (c) f.push(frame('APIC', concat([u8([3]), te.encode(m.cover.mime), u8([0, 3, 0]), c]))); // front cover, no description
    const body = concat(f); return concat([te.encode('ID3'), u8([4, 0, 0]), u8(synch(body.length)), body]);
  }
  const id3Size = (b, o) => (b.length >= o + 10 && b[o] === 0x49 && b[o + 1] === 0x44 && b[o + 2] === 0x33 && b[o + 3] < 5 ? 10 + rsynch(b, o + 6) + (b[o + 5] & 0x10 ? 10 : 0) : 0);
  const unsync = (b) => { const o = []; for (let i = 0; i < b.length; i++) { o.push(b[i]); if (b[i] === 0xff && b[i + 1] === 0) i++; } return Uint8Array.from(o); };
  /* text in one of the four ID3 encodings; terminators removed */
  function id3Text(enc, b) {
    if (enc === 1 || enc === 2) { let s = b; let be = enc === 2; if (enc === 1 && s.length >= 2) { if (s[0] === 0xfe && s[1] === 0xff) { be = true; s = s.subarray(2); } else if (s[0] === 0xff && s[1] === 0xfe) s = s.subarray(2); } return (be ? u16be : u16le).decode(s.subarray(0, s.length & ~1)).replace(/\0+$/, '').split('\0')[0]; }
    return (enc === 3 ? utf8 : latin1).decode(b).replace(/\0+$/, '').split('\0')[0];
  }
  /* index just after a terminated string starting at i in encoding enc */
  const skipStr = (b, i, enc) => { if (enc === 1 || enc === 2) { while (i + 1 < b.length && (b[i] || b[i + 1])) i += 2; return i + 2; } while (i < b.length && b[i]) i++; return i + 1; };
  function readId3(b, o) {
    const size = id3Size(b, o); if (!size) return null;
    const ver = b[o + 3], flags = b[o + 5]; let body = b.subarray(o + 10, Math.min(b.length, o + 10 + rsynch(b, o + 6)));
    if (ver < 4 && flags & 0x80) body = unsync(body);
    let p = 0; if (flags & 0x40) p = ver === 4 ? rsynch(body, 0) : 4 + rbe32(body, 0);
    const out = {}, idLen = ver === 2 ? 3 : 4, hdr = ver === 2 ? 6 : 10;
    const MAP = { TIT2: 'title', TT2: 'title', TPE1: 'artist', TP1: 'artist', TALB: 'album', TAL: 'album', TDRC: 'year', TYER: 'year', TYE: 'year', TCON: 'genre', TCO: 'genre', TRCK: 'track', TRK: 'track' };
    while (p + hdr <= body.length) {
      const id = ascii(body, p, idLen); if (!/^[A-Z0-9]{3,4}$/.test(id)) break;
      let n = ver === 2 ? (body[p + 3] << 16) | (body[p + 4] << 8) | body[p + 5] : ver === 4 ? rsynch(body, p + 4) : rbe32(body, p + 4);
      if (ver === 4 && p + hdr + n < body.length && !/^[A-Z0-9]{4}$|^\0{4}$/.test(ascii(body, p + hdr + n, 4)) && /^[A-Z0-9]{4}$|^\0{4}$/.test(ascii(body, p + hdr + rbe32(body, p + 4), 4))) n = rbe32(body, p + 4); // some writers put plain sizes in v2.4
      let f = body.subarray(p + hdr, p + hdr + n); const ff = ver === 4 ? body[p + 9] : 0;
      if (ff & 0x01) f = f.subarray(4); if (ff & 0x02) f = unsync(f);
      p += hdr + n; if (!f.length) continue;
      if (MAP[id]) { const v = id3Text(f[0], f.subarray(1)); if (v && !out[MAP[id]]) out[MAP[id]] = MAP[id] === 'genre' ? genreText(v) : v; }
      else if ((id === 'COMM' || id === 'COM') && f.length > 4 && !out.comment) { const enc = f[0], s = skipStr(f, 4, enc); out.comment = id3Text(enc, f.subarray(s)); }
      else if (id === 'APIC' && !out.cover) { const enc = f[0], me = skipStr(f, 1, 0), mime = latin1.decode(f.subarray(1, me - 1)), ds = skipStr(f, me + 1, enc); out.cover = coverOf(f.subarray(ds), /\//.test(mime) ? mime : 'image/' + mime.toLowerCase()); }
      else if (id === 'PIC' && !out.cover) { const enc = f[0], fmt = ascii(f, 1, 3), ds = skipStr(f, 5, enc); out.cover = coverOf(f.subarray(ds), fmt === 'PNG' ? 'image/png' : 'image/jpeg'); }
    }
    return { meta: out, size };
  }
  function readId3v1(b) {
    const o = b.length - 128; if (o < 0 || ascii(b, o, 3) !== 'TAG') return null;
    const s = (a, n) => latin1.decode(b.subarray(o + a, o + a + n)).replace(/\0[\s\S]*$/, '').trim(), out = { title: s(3, 30), artist: s(33, 30), album: s(63, 30), year: s(93, 4), comment: s(97, b[o + 125] === 0 && b[o + 126] ? 28 : 30) };
    if (b[o + 125] === 0 && b[o + 126]) out.track = String(b[o + 126]); if (GENRES[b[o + 127]]) out.genre = GENRES[b[o + 127]];
    return out;
  }
  /* MP3 / ADTS: the old ID3v2 tag(s) at the start are replaced */
  function writeId3File(b, meta) { let o = 0, s; while ((s = id3Size(b, o))) o += s; return concat([id3(meta), b.subarray(o)]); }

  /* ---------- Vorbis comments + FLAC picture ---------- */
  function pictureBlock(mime, data) { const mt = te.encode(mime); return concat([u8(be32(3)), u8(be32(mt.length)), mt, u8(be32(0)), u8(be32(0)), u8(be32(0)), u8(be32(0)), u8(be32(0)), u8(be32(data.length)), data]); }
  function readPicture(b) { let p = 4; const ml = rbe32(b, p); p += 4; const mime = latin1.decode(b.subarray(p, p + ml)); p += ml; const dl = rbe32(b, p); p += 4 + dl + 16; const n = rbe32(b, p); p += 4; return coverOf(b.subarray(p, p + n), mime); }
  function vorbisComment(meta, vendor, withPicture) {
    const m = clean(meta), list = [], add = (k, v) => { if (v) list.push(te.encode(k + '=' + v)); }, [tn, tt] = trackParts(m.track);
    add('TITLE', m.title); add('ARTIST', m.artist); add('ALBUM', m.album); add('DATE', m.year); add('GENRE', m.genre); if (tn) add('TRACKNUMBER', String(tn)); if (tt) add('TRACKTOTAL', String(tt)); add('COMMENT', m.comment);
    if (withPicture && m.cover) add('METADATA_BLOCK_PICTURE', toB64(pictureBlock(m.cover.mime, coverBytes(m))));
    const v = te.encode(vendor || 'AudioStage'); return concat([u8(le32(v.length)), v, u8(le32(list.length)), ...list.flatMap((c) => [u8(le32(c.length)), c])]);
  }
  function readVorbisComment(b, o) {
    let p = o + 4 + rle32(b, o); const n = rle32(b, p), out = {}, K = { TITLE: 'title', ARTIST: 'artist', ALBUM: 'album', DATE: 'year', YEAR: 'year', GENRE: 'genre', COMMENT: 'comment', DESCRIPTION: 'comment' }; p += 4; let tn = '', tt = '';
    for (let i = 0; i < n && p + 4 <= b.length; i++) {
      const len = rle32(b, p), s = b.subarray(p + 4, p + 4 + len); p += 4 + len; const eq = s.indexOf(0x3d); if (eq < 0) continue;
      const k = latin1.decode(s.subarray(0, eq)).toUpperCase(), v = s.subarray(eq + 1);
      if (K[k]) { if (!out[K[k]]) out[K[k]] = utf8.decode(v); } else if (k === 'TRACKNUMBER') tn = utf8.decode(v); else if (k === 'TRACKTOTAL' || k === 'TOTALTRACKS') tt = utf8.decode(v);
      else if (k === 'METADATA_BLOCK_PICTURE' && !out.cover) { try { out.cover = readPicture(fromB64(latin1.decode(v))); } catch (e) { /* bad picture */ } }
    }
    if (tn) out.track = tt && !/\//.test(tn) ? tn + '/' + tt : tn;
    return out;
  }
  function flacBlocks(b) { const list = []; let p = 4; for (;;) { if (p + 4 > b.length) throw new Error('Damaged FLAC file.'); const last = b[p] & 0x80, type = b[p] & 0x7f, n = (b[p + 1] << 16) | (b[p + 2] << 8) | b[p + 3]; list.push({ type, data: b.subarray(p + 4, p + 4 + n) }); p += 4 + n; if (last) break; } return { list, audio: p }; }
  function writeFlac(b, meta) {
    if (ascii(b, 0, 4) !== 'fLaC') throw new Error('Not a FLAC file.');
    const { list, audio } = flacBlocks(b), m = clean(meta), keep = list.filter((x) => x.type !== 4 && x.type !== 6 && x.type !== 1);
    const vendor = (() => { const v = list.find((x) => x.type === 4); return v ? utf8.decode(v.data.subarray(4, 4 + rle32(v.data, 0))) : 'AudioStage'; })();
    keep.push({ type: 4, data: vorbisComment(m, vendor, false) }); if (m.cover) { const c = coverBytes(m); if (c.length > 0xffffff - 64) throw new Error('The cover image is too large for FLAC (16 MB at most).'); keep.push({ type: 6, data: pictureBlock(m.cover.mime, c) }); }
    return concat([b.subarray(0, 4), ...keep.flatMap((x, i) => [u8([(i === keep.length - 1 ? 0x80 : 0) | x.type, (x.data.length >> 16) & 255, (x.data.length >> 8) & 255, x.data.length & 255]), x.data]), b.subarray(audio)]);
  }
  function readFlac(b) { const { list } = flacBlocks(b); let out = {}; for (const x of list) { if (x.type === 4) out = { ...readVorbisComment(x.data, 0), ...out }; if (x.type === 6 && !out.cover) out.cover = readPicture(x.data); } return out; }

  /* ---------- Ogg (Opus) ---------- */
  const CRC = new Uint32Array(256); for (let i = 0; i < 256; i++) { let r = i << 24; for (let k = 0; k < 8; k++) r = r & 0x80000000 ? (r << 1) ^ 0x04c11db7 : r << 1; CRC[i] = r >>> 0; }
  function oggPages(b) {
    const pages = []; let p = 0;
    while (p + 27 <= b.length && ascii(b, p, 4) === 'OggS') { const ns = b[p + 26], segs = b.subarray(p + 27, p + 27 + ns); let len = 0; for (const s of segs) len += s; const hl = 27 + ns; pages.push({ off: p, hl, flags: b[p + 5], segs, body: b.subarray(p + hl, p + hl + len), raw: b.subarray(p, p + hl + len) }); p += hl + len; }
    return pages;
  }
  function crcPage(pg) { pg[22] = pg[23] = pg[24] = pg[25] = 0; let c = 0; for (let i = 0; i < pg.length; i++) c = ((c << 8) ^ CRC[((c >>> 24) ^ pg[i]) & 255]) >>> 0; pg[22] = c & 255; pg[23] = (c >>> 8) & 255; pg[24] = (c >>> 16) & 255; pg[25] = (c >>> 24) & 255; return pg; }
  /* the first n packets → { packets, nextPage }: the page after the one the n-th packet ends on (that page must hold nothing more) */
  function oggHeaderPackets(pages, n) {
    const packets = []; let cur = [];
    for (let i = 0; i < pages.length; i++) {
      let q = 0; const segs = pages[i].segs;
      for (let k = 0; k < segs.length; k++) {
        cur.push(pages[i].body.subarray(q, q + segs[k])); q += segs[k];
        if (segs[k] < 255) { packets.push(concat(cur)); cur = []; if (packets.length === n) { if (k !== segs.length - 1) throw new Error('Unusual Ogg header layout.'); return { packets, nextPage: i + 1 }; } }
      }
    }
    return { packets, nextPage: pages.length };
  }
  /* one packet on pages of its own (at most 255 lacing values a page), granule 0 */
  function packetPages(pkt, serial, seq) {
    const lace = []; let left = pkt.length; while (left >= 255) { lace.push(255); left -= 255; } lace.push(left); // the last value < 255 ends the packet
    const out = [];
    for (let i = 0, q = 0; i < lace.length; i += 255) {
      const l = lace.slice(i, i + 255), take = l.reduce((x, y) => x + y, 0), pg = new Uint8Array(27 + l.length + take);
      pg.set(latin1Bytes('OggS'), 0); pg[5] = i > 0 ? 1 : 0; pg.set(serial, 14); pg.set(le32(seq + out.length), 18); pg[26] = l.length; pg.set(l, 27); pg.set(pkt.subarray(q, q + take), 27 + l.length);
      out.push(crcPage(pg)); q += take;
    }
    return out;
  }
  function writeOgg(b, meta) {
    const pages = oggPages(b); if (!pages.length) throw new Error('Not an Ogg file.');
    const { packets, nextPage } = oggHeaderPackets(pages, 2); if (packets.length < 2 || ascii(packets[0], 0, 8) !== 'OpusHead' || ascii(packets[1], 0, 8) !== 'OpusTags') throw new Error('Only Ogg Opus files can be tagged here.');
    const vend = utf8.decode(packets[1].subarray(12, 12 + rle32(packets[1], 8))), tags = concat([latin1Bytes('OpusTags'), vorbisComment(meta, vend, true)]);
    const out = [pages[0].raw, ...packetPages(tags, pages[0].raw.subarray(14, 18), 1)]; let seq = out.length; // OpusHead stays page 0
    for (let i = nextPage; i < pages.length; i++) { const pg = pages[i].raw.slice(); pg.set(le32(seq++), 18); out.push(crcPage(pg)); }
    return concat(out);
  }
  function readOgg(b) {
    const { packets } = oggHeaderPackets(oggPages(b), 2); if (packets.length < 2) return null; const t = packets[1];
    if (ascii(t, 0, 8) === 'OpusTags') return readVorbisComment(t, 8);
    if (t[0] === 3 && ascii(t, 1, 6) === 'vorbis') return readVorbisComment(t, 7);
    return null;
  }

  /* ---------- MP4 / M4A ---------- */
  function boxes(b, s, e) { const list = []; let p = s; while (p + 8 <= e) { let size = rbe32(b, p), hl = 8; const type = latin1.decode(b.subarray(p + 4, p + 8)); if (size === 1) { size = rbe32(b, p + 8) * 4294967296 + rbe32(b, p + 12); hl = 16; } else if (size === 0) size = e - p; if (size < hl || p + size > e) break; list.push({ type, start: p, end: p + size, body: p + hl }); p += size; } return list; }
  const box = (type, ...parts) => { const body = concat(parts.map(u8)), t = latin1Bytes(type); return concat([u8(be32(8 + body.length)), t, body]); };
  const latin1Bytes = (s) => Uint8Array.from(s, (c) => c.charCodeAt(0) & 255);
  const dataAtom = (type, flag, payload) => box(type, box('data', [0, 0, 0, flag], [0, 0, 0, 0], payload));
  function ilst(meta) {
    const m = clean(meta), items = [], t = (k, v) => { if (v) items.push(dataAtom(k, 1, te.encode(v))); }, [tn, tt] = trackParts(m.track);
    t('\xa9nam', m.title); t('\xa9ART', m.artist); t('\xa9alb', m.album); t('\xa9day', m.year); t('\xa9gen', m.genre); t('\xa9cmt', m.comment);
    if (tn) items.push(dataAtom('trkn', 0, [0, 0, tn >> 8, tn & 255, tt >> 8, tt & 255, 0, 0]));
    if (m.cover) items.push(dataAtom('covr', m.cover.mime === 'image/png' ? 14 : 13, coverBytes(m)));
    return box('udta', box('meta', [0, 0, 0, 0], box('hdlr', [0, 0, 0, 0], [0, 0, 0, 0], latin1Bytes('mdir'), latin1Bytes('appl'), new Uint8Array(9)), box('ilst', ...items)));
  }
  /* chunk offsets inside a moov (stco / co64) shifted by delta, in place */
  function shiftOffsets(b, s, e, delta) {
    for (const x of boxes(b, s, e)) {
      if (['trak', 'mdia', 'minf', 'stbl'].includes(x.type)) shiftOffsets(b, x.body, x.end, delta);
      else if (x.type === 'stco') { const n = rbe32(b, x.body + 4); for (let i = 0; i < n; i++) { const o = x.body + 8 + i * 4; b.set(be32(rbe32(b, o) + delta), o); } }
      else if (x.type === 'co64') { const n = rbe32(b, x.body + 4); for (let i = 0; i < n; i++) { const o = x.body + 8 + i * 8, v = rbe32(b, o) * 4294967296 + rbe32(b, o + 4) + delta; b.set(be32(Math.floor(v / 4294967296)), o); b.set(be32(v >>> 0), o + 4); } }
    }
  }
  function writeMp4(b, meta) {
    const top = boxes(b, 0, b.length), moov = top.find((x) => x.type === 'moov'), mdat = top.find((x) => x.type === 'mdat'); if (!moov) throw new Error('Not an MP4 / M4A file (no moov atom).');
    const kids = boxes(b, moov.body, moov.end).filter((x) => x.type !== 'udta').map((x) => b.subarray(x.start, x.end)), nm = box('moov', ...kids, ilst(meta)), delta = nm.length - (moov.end - moov.start);
    if (mdat && moov.start < mdat.start && delta) shiftOffsets(nm, 8, nm.length, delta);
    return concat([b.subarray(0, moov.start), nm, b.subarray(moov.end)]);
  }
  function readMp4(b) {
    const moov = boxes(b, 0, b.length).find((x) => x.type === 'moov'); if (!moov) return null;
    const udta = boxes(b, moov.body, moov.end).find((x) => x.type === 'udta'), metaB = udta && boxes(b, udta.body, udta.end).find((x) => x.type === 'meta'); if (!metaB) return {};
    const il = boxes(b, metaB.body + 4, metaB.end).find((x) => x.type === 'ilst'); if (!il) return {};
    const K = { '\xa9nam': 'title', '\xa9ART': 'artist', '\xa9alb': 'album', '\xa9day': 'year', '\xa9gen': 'genre', '\xa9cmt': 'comment' }, out = {};
    for (const it of boxes(b, il.body, il.end)) {
      const d = boxes(b, it.body, it.end).find((x) => x.type === 'data'); if (!d) continue; const flag = b[d.body + 3], v = b.subarray(d.body + 8, d.end);
      if (K[it.type]) out[K[it.type]] = utf8.decode(v);
      else if (it.type === 'trkn' && v.length >= 6) { const n = (v[2] << 8) | v[3], t = (v[4] << 8) | v[5]; if (n) out.track = t ? n + '/' + t : String(n); }
      else if (it.type === 'gnre' && v.length >= 2) out.genre = GENRES[((v[0] << 8) | v[1]) - 1] || '';
      else if (it.type === 'covr' && !out.cover) out.cover = coverOf(v, flag === 14 ? 'image/png' : flag === 13 ? 'image/jpeg' : '');
    }
    return out;
  }

  /* ---------- WAV: LIST/INFO + "id3 " chunk ---------- */
  const INFO = { title: 'INAM', artist: 'IART', album: 'IPRD', year: 'ICRD', genre: 'IGNR', track: 'ITRK', comment: 'ICMT' };
  const rchunk = (id, body) => concat([latin1Bytes(id), u8(le32(body.length)), body, body.length & 1 ? u8([0]) : new Uint8Array(0)]);
  function riffChunks(b) { const list = []; let p = 12; while (p + 8 <= b.length) { const id = ascii(b, p, 4), n = rle32(b, p + 4), end = Math.min(b.length, p + 8 + n + (n & 1)); list.push({ id, start: p, end, body: b.subarray(p + 8, Math.min(b.length, p + 8 + n)) }); p = end; } return list; }
  function writeWav(b, meta) {
    if (ascii(b, 0, 4) !== 'RIFF' || ascii(b, 8, 4) !== 'WAVE') throw new Error('Not a WAV file.');
    const m = clean(meta), keep = riffChunks(b).filter((c) => !(c.id === 'LIST' && ascii(c.body, 0, 4) === 'INFO') && c.id !== 'id3 ' && c.id !== 'ID3 ');
    const subs = Object.entries(INFO).filter(([k]) => m[k]).map(([k, id]) => rchunk(id, concat([te.encode(m[k]), u8([0])])));
    const add = isEmpty(m) ? [] : [rchunk('LIST', concat([latin1Bytes('INFO'), ...subs])), rchunk('id3 ', id3(m))];
    const body = concat([latin1Bytes('WAVE'), ...keep.map((c) => b.subarray(c.start, c.end)), ...add]);
    return concat([latin1Bytes('RIFF'), u8(le32(body.length)), body]);
  }
  function readWav(b) {
    const out = {}, cs = riffChunks(b), id = cs.find((c) => c.id === 'id3 ' || c.id === 'ID3 ');
    if (id) { const r = readId3(id.body, 0); if (r) Object.assign(out, r.meta); }
    const info = cs.find((c) => c.id === 'LIST' && ascii(c.body, 0, 4) === 'INFO');
    if (info) { let p = 4; const rev = Object.fromEntries(Object.entries(INFO).map(([k, v]) => [v, k])); while (p + 8 <= info.body.length) { const sid = ascii(info.body, p, 4), n = rle32(info.body, p + 4); if (rev[sid] && !out[rev[sid]]) out[rev[sid]] = utf8.decode(info.body.subarray(p + 8, p + 8 + n)).replace(/\0[\s\S]*$/, ''); p += 8 + n + (n & 1); } }
    return out;
  }

  /* ---------- the API ---------- */
  /* by content: 'wav' | 'flac' | 'ogg' | 'mp4' | 'mp3' (ID3 or an MPEG / ADTS frame sync) | '' */
  function detect(b) {
    if (b.length < 12) return '';
    if (ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 4) === 'WAVE') return 'wav'; if (ascii(b, 0, 4) === 'fLaC') return 'flac'; if (ascii(b, 0, 4) === 'OggS') return 'ogg'; if (ascii(b, 4, 4) === 'ftyp') return 'mp4';
    let o = 0, s; while ((s = id3Size(b, o))) o += s; if (o && ascii(b, o, 4) === 'fLaC') return 'flac';
    return o || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0) ? 'mp3' : '';
  }
  /* format: an export format ('mp3' 'aac' 'flac' 'opus' 'm4a' 'wav') or a detected one */
  function write(bytes, format, meta) {
    const b = u8(bytes), f = { aac: 'mp3', opus: 'ogg', m4a: 'mp4' }[format] || format;
    if (f === 'mp3') return writeId3File(b, meta); if (f === 'flac') return writeFlac(b, meta); if (f === 'ogg') return writeOgg(b, meta); if (f === 'mp4') return writeMp4(b, meta); if (f === 'wav') return writeWav(b, meta);
    throw new Error('Tags cannot be written to this format: ' + format);
  }
  /* → clean meta (empty fields '') or null when the file has no tags / is not a known format */
  function read(bytes) {
    const b = u8(bytes); let out = null;
    try {
      const f = detect(b);
      if (f === 'mp3') { const r = readId3(b, 0); out = r ? r.meta : readId3v1(b); } else if (f === 'flac') { const r = readId3(b, 0); let o = 0, s; while ((s = id3Size(b, o))) o += s; out = { ...readFlac(o ? b.subarray(o) : b), ...(r ? r.meta : {}) }; }
      else if (f === 'ogg') out = readOgg(b); else if (f === 'mp4') out = readMp4(b); else if (f === 'wav') out = readWav(b);
    } catch (e) { out = null; }
    return out && !isEmpty(out) ? clean(out) : null;
  }
  /* Batch Process names: {title} {artist} {album} {year} {genre} {track} — the file name when a tag is empty for title */
  function fillTemplate(template, meta, fallbackName) { const m = clean(meta); return String(template || '').replace(/\{(title|artist|album|year|genre|track)\}/g, (x, k) => (k === 'title' ? m.title || fallbackName || '' : m[k] || '').replace(/\//g, '-')); }

  AS.tags = { FIELDS, clean, isEmpty, write, read, detect, fillTemplate, toB64, fromB64, sniffMime, id3, readId3, vorbisComment, readVorbisComment };
  if (typeof module !== 'undefined' && module.exports) module.exports = AS.tags;
})(typeof window !== 'undefined' ? window : globalThis);

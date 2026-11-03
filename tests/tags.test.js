// Run: node tests/tags.test.js — File Info / Metadata tags written by AudioStage (app/js/tags.js) and read back:
// ID3v2.4 (MP3, ADTS), Vorbis comments + PICTURE (FLAC), OpusTags (Ogg Opus), MP4 ilst (M4A), LIST/INFO + id3 (WAV).
// Every field — Thai text and a cover image included — must come back exactly; the audio must stay untouched.
const assert = require('assert'), fs = require('fs'), path = require('path'), vm = require('vm');
const D = require('../app/js/dsp.js'), W = require('../app/js/wav.js'), C = require('../app/js/flac.js'), T = require('../app/js/tags.js');
let fail = 0;
const ok = (name, fn) => { try { fn(); console.log('ok   ', name); } catch (e) { fail++; console.log('FAIL ', name, e.message); } };

const sr = 44100, tone = D.genTone(sr, 1, 440, 440, 'sine', -6, 2);
const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...Array.from({ length: 3000 }, (_, i) => (i * 37) & 255)]);
const META = { title: 'เพลงทดสอบ — Test Song', artist: 'นักร้อง ไทย & Friends', album: 'อัลบั้มแรก', year: '2026', genre: 'ลูกทุ่ง', track: '3/12', comment: 'บันทึกเสียงที่กรุงเทพฯ\nline 2 ✓', cover: { mime: 'image/png', b64: T.toB64(png) } };
const same = (got, want, what) => { for (const k of T.FIELDS) assert.strictEqual(got[k], want[k], `${what}: ${k} = ${JSON.stringify(got[k])}`); assert(got.cover && got.cover.mime === want.cover.mime && got.cover.b64 === want.cover.b64, what + ': cover'); };
const u8 = (b) => new Uint8Array(b);

ok('base64 helpers round-trip any bytes', () => { for (const n of [0, 1, 2, 3, 100, 257]) { const b = Uint8Array.from({ length: n }, (_, i) => (i * 91 + 7) & 255); assert.deepStrictEqual(T.fromB64(T.toB64(b)), b); } assert.strictEqual(T.toB64(new TextEncoder().encode('ไทย')), Buffer.from('ไทย').toString('base64')); });

ok('MP3: ID3v2.4 (UTF-8 frames, APIC) → read back; the MPEG frames are untouched; tagging twice keeps one tag', () => {
  const ctx = { console }; vm.createContext(ctx); vm.runInContext(fs.readFileSync(path.join(__dirname, '../app/vendor/lame.min.js'), 'utf8') + ';this.lamejs=lamejs;', ctx); global.lamejs = ctx.lamejs;
  const mp3 = u8(C.encodeMp3(tone, sr, 128, D.convertRate)), tagged = T.write(mp3, 'mp3', META);
  assert.strictEqual(T.detect(tagged), 'mp3'); assert.strictEqual(String.fromCharCode(...tagged.subarray(0, 4)), 'ID3\x04', 'ID3v2.4 header');
  same(T.read(tagged), META, 'mp3'); assert.deepStrictEqual(tagged.subarray(tagged.length - mp3.length), mp3, 'audio bytes');
  const again = T.write(tagged, 'mp3', { ...META, title: 'Second' }); assert.strictEqual(again.length - mp3.length, T.id3({ ...META, title: 'Second' }).length, 'old tag replaced, not stacked'); assert.strictEqual(T.read(again).title, 'Second');
  assert.strictEqual(T.read(mp3), null, 'no tags → null');
});
ok('ID3 reader: v2.3 UTF-16 frames, numeric genres and an ID3v1 tag (files from other programs)', () => {
  const u16 = (s) => Buffer.concat([Buffer.from([1, 0xff, 0xfe]), Buffer.from(s, 'utf16le')]), fr = (id, body) => Buffer.concat([Buffer.from(id), Buffer.from([0, 0, body.length >> 8, body.length & 255, 0, 0]), body]);
  const body = Buffer.concat([fr('TIT2', u16('ชื่อเพลง')), fr('TPE1', Buffer.concat([Buffer.from([0]), Buffer.from('Latin Artist')])), fr('TCON', Buffer.from('\x00(17)')), fr('TYER', Buffer.from('\x001999'))]);
  const tag = Buffer.concat([Buffer.from('ID3\x03\x00\x00'), Buffer.from([0, 0, body.length >> 7, body.length & 127]), body, Buffer.from([0xff, 0xfb, 0x90, 0x00])]);
  const r = T.read(tag); assert.strictEqual(r.title, 'ชื่อเพลง'); assert.strictEqual(r.artist, 'Latin Artist'); assert.strictEqual(r.genre, 'Rock'); assert.strictEqual(r.year, '1999');
  const v1 = Buffer.alloc(128); v1.write('TAG'); v1.write('Old Title', 3); v1.write('Old Artist', 33); v1[126] = 7; v1[127] = 8;
  const r1 = T.read(Buffer.concat([Buffer.from([0xff, 0xfb, 0x90, 0x00]), Buffer.alloc(400), v1])); assert(r1.title === 'Old Title' && r1.artist === 'Old Artist' && r1.track === '7' && r1.genre === 'Jazz', JSON.stringify(r1));
});
ok('FLAC: VORBIS_COMMENT + PICTURE blocks → read back; STREAMINFO first, audio frames untouched; retag replaces', () => {
  const flac = u8(C.encodeFlac(tone, sr, 16)), tagged = T.write(flac, 'flac', META); same(T.read(tagged), META, 'flac');
  assert.strictEqual(tagged[4] & 0x7f, 0, 'STREAMINFO is the first block'); assert.deepStrictEqual(tagged.subarray(tagged.length - (flac.length - 42)), flac.subarray(42), 'frames');
  const re = T.write(tagged, 'flac', { title: 'Only a title' }), r = T.read(re); assert(r.title === 'Only a title' && !r.artist && !r.cover, 'old comments / picture replaced');
  let p = 4, blocks = 0, last = 0; while (!last) { last = re[p] & 0x80; p += 4 + ((re[p + 1] << 16) | (re[p + 2] << 8) | re[p + 3]); blocks++; } assert.strictEqual(blocks, 2, 'STREAMINFO + VORBIS_COMMENT, last flag set once');
});

/* a minimal Ogg Opus stream: OpusHead, OpusTags, then audio pages (the packet bytes do not matter to the tagger) */
const CRC = new Uint32Array(256); for (let i = 0; i < 256; i++) { let r = i << 24; for (let k = 0; k < 8; k++) r = r & 0x80000000 ? (r << 1) ^ 0x04c11db7 : r << 1; CRC[i] = r >>> 0; }
const crcOf = (pg) => { const b = Buffer.from(pg); b.fill(0, 22, 26); let c = 0; for (const v of b) c = ((c << 8) ^ CRC[((c >>> 24) ^ v) & 255]) >>> 0; return c; };
function page(seq, flags, granule, packets) {
  const lace = []; for (const p of packets) { let n = p.length; while (n >= 255) { lace.push(255); n -= 255; } lace.push(n); }
  const b = Buffer.alloc(27 + lace.length + packets.reduce((a, p) => a + p.length, 0)); b.write('OggS'); b[5] = flags; b.writeBigUInt64LE(BigInt(granule), 6); b.writeUInt32LE(0x1234, 14); b.writeUInt32LE(seq, 18); b[26] = lace.length; Buffer.from(lace).copy(b, 27); Buffer.concat(packets).copy(b, 27 + lace.length);
  b.writeUInt32LE(crcOf(b), 22); return b;
}
function pages(b) { const out = []; let p = 0; while (p < b.length) { assert.strictEqual(b.toString('latin1', p, p + 4), 'OggS'); const ns = b[p + 26]; let len = 0; for (let i = 0; i < ns; i++) len += b[p + 27 + i]; out.push(b.subarray(p, p + 27 + ns + len)); p += 27 + ns + len; } return out; }
ok('Ogg Opus: OpusTags with METADATA_BLOCK_PICTURE → read back; pages renumbered, CRCs valid, audio pages unchanged', () => {
  const head = Buffer.concat([Buffer.from('OpusHead'), Buffer.from([1, 2, 0x38, 1, 0x80, 0xbb, 0, 0, 0, 0, 0])]), vend = Buffer.from('AudioStage (WebCodecs)'), tags0 = Buffer.concat([Buffer.from('OpusTags'), Buffer.from([vend.length, 0, 0, 0]), vend, Buffer.alloc(4)]);
  const audio = [page(2, 0, 960, [Buffer.alloc(300, 7), Buffer.alloc(200, 8)]), page(3, 4, 1920, [Buffer.alloc(120, 9)])], ogg = Buffer.concat([page(0, 2, 0, [head]), page(1, 0, 0, [tags0]), ...audio]);
  const big = { ...META, cover: { mime: 'image/png', b64: T.toB64(Uint8Array.from({ length: 90000 }, (_, i) => (i * 13) & 255)) } }; // spans two pages
  const out = Buffer.from(T.write(ogg, 'opus', big)), ps = pages(out);
  ps.forEach((pg, i) => { assert.strictEqual(pg.readUInt32LE(18), i, 'sequence ' + i); assert.strictEqual(pg.readUInt32LE(22), crcOf(pg), 'CRC page ' + i); });
  assert(ps.length === 5 && ps[1][5] === 0 && ps[2][5] === 1, 'the comment header spans pages 1–2 (continued flag): ' + ps.length); assert.deepStrictEqual(ps[3].subarray(27), audio[0].subarray(27)); assert.strictEqual(ps[4].readBigUInt64LE(6), 1920n);
  same(T.read(out), big, 'opus'); assert(/AudioStage \(WebCodecs\)/.test(out.toString('latin1', 0, 1000)), 'vendor string kept');
  assert.throws(() => T.write(Buffer.concat([page(0, 2, 0, [Buffer.from('\x01vorbis' + 'x'.repeat(23))]), page(1, 0, 0, [Buffer.from('\x03vorbis')])]), 'opus', META), /Only Ogg Opus/);
});
/* a minimal M4A: ftyp, moov (one track whose stco points into mdat), mdat */
const box = (type, ...parts) => { const body = Buffer.concat(parts.map((p) => Buffer.from(p))); const h = Buffer.alloc(8); h.writeUInt32BE(8 + body.length); h.write(type, 4, 'latin1'); return Buffer.concat([h, body]); };
function m4a(withUdta) {
  const ftyp = box('ftyp', 'M4A \0\0\0\0M4A mp42isom'), payload = Buffer.from('AUDIO-CHUNK-0123456789');
  const mk = (off) => box('moov', box('mvhd', Buffer.alloc(100)), box('trak', box('mdia', box('minf', box('stbl', box('stco', Buffer.from([0, 0, 0, 0, 0, 0, 0, 1, off >>> 24, (off >>> 16) & 255, (off >>> 8) & 255, off & 255])))))), ...(withUdta ? [box('udta', box('meta', Buffer.alloc(4), box('ilst', box('\xa9nam', box('data', Buffer.from([0, 0, 0, 1, 0, 0, 0, 0]), 'old')))))] : []));
  const moovLen = mk(0).length; return Buffer.concat([ftyp, mk(ftyp.length + moovLen + 8), box('mdat', payload)]);
}
const stcoTarget = (b) => { const i = b.indexOf('stco'), off = b.readUInt32BE(i + 12); return b.toString('latin1', off, off + 11); };
ok('M4A: moov/udta/meta/ilst atoms → read back; the chunk offsets (stco) still point at the audio', () => {
  for (const old of [false, true]) {
    const src = m4a(old); assert.strictEqual(stcoTarget(src), 'AUDIO-CHUNK'); const out = Buffer.from(T.write(src, 'm4a', META));
    assert.strictEqual(stcoTarget(out), 'AUDIO-CHUNK', 'stco shifted'); same(T.read(out), META, 'm4a'); assert.strictEqual(out.toString('latin1').split('udta').length, 2, 'one udta');
  }
  const r = T.read(T.write(m4a(false), 'm4a', { title: 'x', track: '5' })); assert.strictEqual(r.track, '5'); assert.strictEqual(r.cover, null);
});
ok('WAV: LIST/INFO + id3 chunk next to BWF / CART / markers → read back; RIFF size right; the samples decode the same', () => {
  const wav = u8(W.encodeWav(tone, sr, 16, false, { markers: [{ t: 100, name: 'm1' }], bext: { description: 'desc', originator: 'AudioStage' }, cart: { title: 'Cart title', artist: 'Cart artist' } }));
  const out = T.write(wav, 'wav', META), dv = new DataView(out.buffer, out.byteOffset); assert.strictEqual(dv.getUint32(4, true), out.length - 8, 'RIFF size');
  same(T.read(out), META, 'wav'); const a = W.decodeWav(wav.buffer.slice(0)), b = W.decodeWav(out.slice().buffer);
  assert(b.ch[0].every((v, i) => v === a.ch[0][i]) && b.markers.length === 1 && b.cart.title === 'Cart title' && b.bext.description === 'desc', 'audio, markers, BWF, CART kept');
  assert.strictEqual(T.read(T.write(out, 'wav', {})), null, 'empty meta removes the tags');
});
ok('ADTS AAC gets an ID3v2 tag at the front (as players expect)', () => { const adts = Uint8Array.from([0xff, 0xf1, 0x50, 0x80, 0x02, 0x1f, 0xfc, 0x21, 0, 0]); const o = T.write(adts, 'aac', META); same(T.read(o), META, 'aac'); assert.deepStrictEqual(o.subarray(o.length - adts.length), adts); });
ok('Batch Process names: {title} {artist} {album} {year} {track}, title falls back to the file name', () => {
  assert.strictEqual(T.fillTemplate('{track} {artist} - {title} ({year})', META, 'x'), '3-12 นักร้อง ไทย & Friends - เพลงทดสอบ — Test Song (2026)');
  assert.strictEqual(T.fillTemplate('{title}_{album}', {}, 'take 1'), 'take 1_');
});
ok('clean / isEmpty: trims, accepts a cover as bytes, sniffs PNG / JPEG', () => {
  const c = T.clean({ title: '  a  ', cover: { data: png } }); assert(c.title === 'a' && c.cover.mime === 'image/png' && T.fromB64(c.cover.b64).length === png.length);
  assert.strictEqual(T.sniffMime(Uint8Array.from([0xff, 0xd8, 0xff])), 'image/jpeg'); assert(T.isEmpty({ title: ' ' }) && !T.isEmpty({ year: '1' }));
});
console.log(fail ? `\n${fail} FAILED` : '\nall passed');
process.exit(fail ? 1 : 0);

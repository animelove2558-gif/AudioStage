// node tools/make-ico.js [in.png] [out.ico] — the icon of .asession files (build/asession.ico) from the AudioStage logo
// (build/icon.png, 8-bit RGBA). No dependencies: decodes the PNG, scales it down (area average, premultiplied alpha)
// to 16…256 px and stores each size as a PNG inside the .ico (Windows Vista and later). Tested in tests/assoc.test.js.
const fs = require('fs'), path = require('path'), zlib = require('zlib');

function crc32(buf) { let c, crc = 0xffffffff; for (let n = 0; n < buf.length; n++) { c = (crc ^ buf[n]) & 0xff; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crc = (crc >>> 8) ^ c; } return (crc ^ 0xffffffff) >>> 0; }
/* PNG (8-bit RGBA or RGB, not interlaced) → { w, h, px: Uint8Array RGBA } */
function decodePng(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('Not a PNG file.');
  let p = 8, w = 0, h = 0, depth = 0, type = 0, inter = 0; const idat = [];
  while (p < buf.length) {
    const len = buf.readUInt32BE(p), t = buf.toString('ascii', p + 4, p + 8), d = buf.subarray(p + 8, p + 8 + len);
    if (t === 'IHDR') { w = d.readUInt32BE(0); h = d.readUInt32BE(4); depth = d[8]; type = d[9]; inter = d[12]; }
    else if (t === 'IDAT') idat.push(d); else if (t === 'IEND') break;
    p += 12 + len;
  }
  if (depth !== 8 || (type !== 6 && type !== 2) || inter) throw new Error('Only 8-bit RGB / RGBA, non-interlaced PNGs are supported.');
  const bpp = type === 6 ? 4 : 3, raw = zlib.inflateSync(Buffer.concat(idat)), stride = w * bpp, out = new Uint8Array(w * h * 4), line = new Uint8Array(stride), prev = new Uint8Array(stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], src = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? line[i - bpp] : 0, b = prev[i], c = i >= bpp ? prev[i - bpp] : 0;
      let v = src[i];
      if (f === 1) v += a; else if (f === 2) v += b; else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const pp = a + b - c, pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      line[i] = v & 0xff;
    }
    for (let x = 0; x < w; x++) { out.set(line.subarray(x * bpp, x * bpp + 3), (y * w + x) * 4); out[(y * w + x) * 4 + 3] = bpp === 4 ? line[x * 4 + 3] : 255; }
    prev.set(line);
  }
  return { w, h, px: out };
}
function encodePng(w, h, px) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 4 + 1)] = 0; Buffer.from(px.buffer, px.byteOffset + y * w * 4, w * 4).copy(raw, y * (w * 4 + 1) + 1); }
  const chunk = (t, d) => { const b = Buffer.alloc(12 + d.length); b.writeUInt32BE(d.length, 0); b.write(t, 4, 'ascii'); d.copy(b, 8); b.writeUInt32BE(crc32(b.subarray(4, 8 + d.length)), 8 + d.length); return b; };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}
/* area-average downscale (premultiplied, so transparent edges do not turn dark) */
function scale(img, n) {
  const { w, h, px } = img, out = new Uint8Array(n * n * 4), sx = w / n, sy = h / n;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    let r = 0, g = 0, b = 0, a = 0, cnt = 0;
    for (let yy = Math.floor(y * sy); yy < Math.ceil((y + 1) * sy); yy++) for (let xx = Math.floor(x * sx); xx < Math.ceil((x + 1) * sx); xx++) { const i = (yy * w + xx) * 4, al = px[i + 3] / 255; r += px[i] * al; g += px[i + 1] * al; b += px[i + 2] * al; a += al; cnt++; }
    const o = (y * n + x) * 4; out[o + 3] = Math.round((a / cnt) * 255); if (a > 0) { out[o] = Math.round(r / a); out[o + 1] = Math.round(g / a); out[o + 2] = Math.round(b / a); }
  }
  return out;
}
const SIZES = [16, 24, 32, 48, 64, 128, 256];
function makeIco(png, sizes) {
  const img = decodePng(png), imgs = (sizes || SIZES).map((n) => ({ n, data: n === img.w && n === img.h ? encodePng(n, n, img.px) : encodePng(n, n, scale(img, n)) }));
  const head = Buffer.alloc(6 + 16 * imgs.length); head.writeUInt16LE(0, 0); head.writeUInt16LE(1, 2); head.writeUInt16LE(imgs.length, 4);
  let off = head.length;
  imgs.forEach((m, i) => { const e = 6 + 16 * i; head[e] = m.n >= 256 ? 0 : m.n; head[e + 1] = m.n >= 256 ? 0 : m.n; head.writeUInt16LE(1, e + 4); head.writeUInt16LE(32, e + 6); head.writeUInt32LE(m.data.length, e + 8); head.writeUInt32LE(off, e + 12); off += m.data.length; });
  return Buffer.concat([head, ...imgs.map((m) => m.data)]);
}
/* .ico → [{ size, png: Buffer }] (tests) */
function readIco(buf) { const n = buf.readUInt16LE(4), out = []; for (let i = 0; i < n; i++) { const e = 6 + 16 * i; out.push({ size: buf[e] || 256, png: buf.subarray(buf.readUInt32LE(e + 12), buf.readUInt32LE(e + 12) + buf.readUInt32LE(e + 8)) }); } return out; }

module.exports = { decodePng, encodePng, scale, makeIco, readIco, SIZES };
if (require.main === module) {
  const root = path.join(__dirname, '..'), inp = process.argv[2] || path.join(root, 'build', 'icon.png'), out = process.argv[3] || path.join(root, 'build', 'asession.ico');
  fs.writeFileSync(out, makeIco(fs.readFileSync(inp))); console.log('wrote', out);
}

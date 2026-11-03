// node tools/make-icons.js — the Linux icons from the AudioStage logo (build/icon.png, 256 px): build/icons/<n>x<n>.png
// for n = 16…512 (electron-builder installs them into /usr/share/icons/hicolor/<n>x<n>/apps for the .deb and into the
// AppImage). Smaller sizes are area averaged (make-ico.js), 512 px is scaled up bilinearly (premultiplied alpha).
// The .asession file icon (hicolor/<n>x<n>/mimetypes) uses the same pictures. Tested in tests/assoc.test.js.
const fs = require('fs'), path = require('path');
const { decodePng, encodePng, scale } = require('./make-ico');

const SIZES = [16, 24, 32, 48, 64, 128, 256, 512];
function upscale(img, n) {
  const { w, h, px } = img, out = new Uint8Array(n * n * 4);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const fx = Math.max(0, Math.min(w - 1, ((x + 0.5) * w) / n - 0.5)), fy = Math.max(0, Math.min(h - 1, ((y + 0.5) * h) / n - 0.5));
    const x0 = Math.floor(fx), y0 = Math.floor(fy), x1 = Math.min(w - 1, x0 + 1), y1 = Math.min(h - 1, y0 + 1), tx = fx - x0, ty = fy - y0;
    let r = 0, g = 0, b = 0, a = 0;
    for (const [xx, yy, wt] of [[x0, y0, (1 - tx) * (1 - ty)], [x1, y0, tx * (1 - ty)], [x0, y1, (1 - tx) * ty], [x1, y1, tx * ty]]) { const i = (yy * w + xx) * 4, al = (px[i + 3] / 255) * wt; r += px[i] * al; g += px[i + 1] * al; b += px[i + 2] * al; a += al; }
    const o = (y * n + x) * 4; out[o + 3] = Math.round(a * 255); if (a > 0) { out[o] = Math.round(r / a); out[o + 1] = Math.round(g / a); out[o + 2] = Math.round(b / a); }
  }
  return out;
}
/* logo PNG → { n: PNG Buffer } */
function makeIcons(png, sizes) {
  const img = decodePng(png), out = {};
  for (const n of sizes || SIZES) out[n] = encodePng(n, n, n === img.w && n === img.h ? img.px : n > img.w ? upscale(img, n) : scale(img, n));
  return out;
}
module.exports = { makeIcons, upscale, SIZES };
if (require.main === module) {
  const root = path.join(__dirname, '..'), dir = path.join(root, 'build', 'icons');
  fs.mkdirSync(dir, { recursive: true });
  for (const [n, b] of Object.entries(makeIcons(fs.readFileSync(path.join(root, 'build', 'icon.png'))))) fs.writeFileSync(path.join(dir, `${n}x${n}.png`), b);
  console.log('wrote', dir);
}

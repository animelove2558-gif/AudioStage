// Run: node tests/linux.test.js — Linux support (ROADMAP-LINUX): the AppImage / .deb configuration, the .desktop entry
// electron-builder writes from it, the .asession MIME type and icons, and the Linux code paths that can be checked on any
// system (they take the platform as an argument). On Linux the real-system checks run too (folders, python3, ffmpeg).
const assert = require('assert'), fs = require('fs'), os = require('os'), path = require('path');
const { ok, okAsync, done } = require('./_sandbox');
const ROOT = path.join(__dirname, '..'), PKG = require('../package.json'), B = PKG.build;
const ICONS = require('../tools/make-icons'), ICO = require('../tools/make-ico');
const { filesFromArgv } = require('../electron/openfiles');
const LINUX = process.platform === 'linux';

/* ---------- 1. installers ---------- */
ok('build.linux: AppImage + deb (x64), category, icons folder, maintainer / synopsis / description; Windows build unchanged', () => {
  const L = B.linux;
  assert.deepStrictEqual(L.target.map((t) => [t.target, t.arch.join()]), [['AppImage', 'x64'], ['deb', 'x64']]);
  assert.strictEqual(L.category, 'AudioVideo;Audio;AudioVideoEditing');
  assert.strictEqual(L.icon, 'build/icons'); assert(/^.+ <[^@\s]+@[^@\s]+>$/.test(L.maintainer), 'Debian needs "Name <email>"');
  assert(L.synopsis && L.synopsis.length <= 80 && L.description.length > 40);
  assert.strictEqual(L.executableName, 'audiostage');
  assert.strictEqual(PKG.scripts.dist, 'electron-builder --win --publish never', 'npm run dist (Windows) stays as it was');
  assert(/--linux/.test(PKG.scripts['dist:linux']) && /--win --linux/.test(PKG.scripts['dist:all']));
  assert.deepStrictEqual(B.win.target, [{ target: 'nsis', arch: ['x64'] }]); assert.strictEqual(B.win.icon, 'build/icon.png'); assert.strictEqual(B.nsis.include, 'build/installer.nsh');
  assert(B.deb.recommends.includes('ffmpeg') && B.deb.recommends.includes('python3-venv') && B.deb.recommends.includes('espeak-ng'));
  assert(B.deb.depends.some((d) => /libasound2t64/.test(d)) && B.deb.depends.some((d) => /libgtk-3-0t64/.test(d)), 'Ubuntu 24.04 package names (t64) accepted too');
});
ok('build/icons: 16…512 px PNGs made from the logo (npm run icons), 256 px is the logo itself', () => {
  const logo = fs.readFileSync(path.join(ROOT, 'build/icon.png')), want = ICONS.makeIcons(logo);
  for (const n of ICONS.SIZES) {
    const f = path.join(ROOT, 'build/icons', `${n}x${n}.png`); assert(fs.existsSync(f), f);
    const b = fs.readFileSync(f), d = ICO.decodePng(b); assert(d.w === n && d.h === n, f);
    assert(b.equals(want[n]), `${n}x${n}.png is up to date with the logo (npm run icons)`);
  }
  assert(Buffer.from(ICO.decodePng(fs.readFileSync(path.join(ROOT, 'build/icons/256x256.png'))).px).equals(Buffer.from(ICO.decodePng(logo).px)));
  const big = ICO.decodePng(want[512]).px; let lit = 0; for (let i = 0; i < big.length; i += 4) if (big[i + 3] > 200) lit++;
  assert(lit > 512 * 512 * 0.3, 'the 512 px icon is not empty');
});
okAsync('.desktop entry written by electron-builder from build.linux: Name, Icon, Categories, Exec … %U, MimeType', async () => {
  const { LinuxTargetHelper } = require('app-builder-lib/out/targets/LinuxTargetHelper');
  const packager = { appInfo: { productName: 'AudioStage', sanitizedProductName: 'AudioStage', description: PKG.description }, executableName: B.linux.executableName, fileAssociations: B.fileAssociations, config: B, platformSpecificBuildOptions: B.linux };
  const d = await new LinuxTargetHelper(packager).computeDesktopEntry(B.linux);
  const kv = Object.fromEntries(d.split('\n').filter((l) => l.includes('=')).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
  assert(d.startsWith('[Desktop Entry]'));
  assert.strictEqual(kv.Name, 'AudioStage'); assert.strictEqual(kv.Icon, 'audiostage'); assert.strictEqual(kv.Type, 'Application');
  assert.strictEqual(kv.Exec, '/opt/AudioStage/audiostage %U'); assert.strictEqual(kv.Categories, 'AudioVideo;Audio;AudioVideoEditing;');
  const mt = kv.MimeType.split(';').filter(Boolean);
  for (const t of ['application/x-audiostage-session', 'audio/wav', 'audio/x-wav', 'audio/mpeg', 'audio/flac', 'audio/ogg', 'audio/x-vorbis+ogg', 'audio/opus', 'audio/mp4', 'audio/x-m4a', 'audio/aac', 'audio/x-aiff']) assert(mt.includes(t), t);
  assert(kv['GenericName[th]'] && kv['Comment[th]'] && /audio;/.test(kv.Keywords));
});
ok('.asession MIME type (shared-mime-info XML) + its icon are installed by the .deb', () => {
  const xml = fs.readFileSync(path.join(ROOT, 'build/linux/audiostage-session.xml'), 'utf8');
  assert(/<mime-type type="application\/x-audiostage-session">/.test(xml) && /<glob pattern="\*\.asession"/.test(xml) && /<icon name="application-x-audiostage-session"\/>/.test(xml));
  assert(/sub-class-of type="application\/json"/.test(xml), '.asession files are JSON');
  assert(/value="\{&quot;app&quot;:&quot;AudioStage&quot;"/.test(xml), 'magic = how every saved session starts');
  const map = Object.fromEntries(B.deb.fpm.map((a) => a.split('=')));
  assert.strictEqual(map['build/linux/audiostage-session.xml'], '/usr/share/mime/packages/audiostage-session.xml');
  for (const n of ICONS.SIZES) assert.strictEqual(map[`build/icons/${n}x${n}.png`], `/usr/share/icons/hicolor/${n}x${n}/mimetypes/application-x-audiostage-session.png`);
  for (const src of Object.keys(map)) assert(fs.existsSync(path.join(ROOT, src)), src);
  // the session JSON really starts the way the magic rule says
  const sb = require('./_sandbox').load(['sessionio.js']);
  const j = JSON.stringify(sb.AS.sessionIO.serialize({ sr: 48000, master: { vol: 0, fx: [] }, opts: {}, tracks: [] }));
  assert(j.startsWith('{"app":"AudioStage"'), j.slice(0, 40));
});
ok('double-click / Open With on Linux: file:// URIs from %U and plain paths, other URLs ignored', () => {
  if (!LINUX) { // file URIs are platform paths: on Windows check only that URLs are never taken for files
    assert.deepStrictEqual(filesFromArgv(['x', 'https://example.com/x.wav'], { exists: () => true }), []);
    return;
  }
  const have = new Set(['/home/ann/เพลง/Song one.asession', '/home/ann/take.wav']), exists = (p) => have.has(p);
  const argv = ['/opt/AudioStage/audiostage', '--no-sandbox', 'file:///home/ann/%E0%B9%80%E0%B8%9E%E0%B8%A5%E0%B8%87/Song%20one.asession', 'https://example.com/x.wav', 'take.wav'];
  assert.deepStrictEqual(filesFromArgv(argv, { exists, cwd: '/home/ann' }), [{ path: '/home/ann/เพลง/Song one.asession', kind: 'session' }, { path: '/home/ann/take.wav', kind: 'audio' }]);
});
done();

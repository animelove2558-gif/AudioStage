// Run: node tests/assoc.test.js — double-click / "Open with" (ROADMAP-MISSING 4): which command-line arguments are files
// to open (electron/openfiles.js), the installer configuration, and the .asession icon made from the logo.
const assert = require('assert'), fs = require('fs'), path = require('path');
const { ok, done } = require('./_sandbox');
const { filesFromArgv } = require('../electron/openfiles');
const ICO = require('../tools/make-ico');
const ROOT = path.join(__dirname, '..');

ok('argv → files to open: .asession = session, audio = Waveform; flags, folders, other files and the program skipped', () => {
  const have = new Set(['C:\\w\\Song.asession', 'C:\\w\\take.WAV', 'C:\\w\\voice.mp3', 'C:\\w\\notes.txt', 'C:\\w\\more.flac']);
  const exists = (p) => have.has(p);
  const got = filesFromArgv(['C:\\Program Files\\AudioStage\\AudioStage.exe', '--allow-file-access-from-files', 'C:\\w\\Song.asession', 'take.WAV', 'C:\\w\\notes.txt', 'C:\\w\\missing.wav', '.', 'C:\\w\\voice.mp3', 'C:\\w\\voice.mp3', '--editorstage-edit=C:\\w\\more.flac'], { exists, cwd: 'C:\\w' });
  if (process.platform === 'win32') assert.deepStrictEqual(got, [{ path: 'C:\\w\\Song.asession', kind: 'session' }, { path: 'C:\\w\\take.WAV', kind: 'audio' }, { path: 'C:\\w\\voice.mp3', kind: 'audio' }]);
  else assert.deepStrictEqual(got.map((f) => f.kind), ['session', 'audio', 'audio'].slice(0, got.length));
  assert.deepStrictEqual(filesFromArgv(['electron.exe', ROOT]), [], '`electron .` passes the app folder: nothing to open');
  assert.deepStrictEqual(filesFromArgv([]), []); assert.deepStrictEqual(filesFromArgv(undefined), []);
  // a real file on disk (default exists check)
  const f = path.join(ROOT, 'tests', 'tmp-assoc-test.asession'); fs.writeFileSync(f, '{}');
  try { assert.deepStrictEqual(filesFromArgv(['x.exe', f]), [{ path: f, kind: 'session' }]); } finally { fs.unlinkSync(f); }
});
ok('installer: .asession associated (role Editor, own icon); audio only offered in “Open with”, never made the default', () => {
  const b = require('../package.json').build, fa = b.fileAssociations;
  assert(Array.isArray(fa) && fa.length === 1 && fa[0].ext === 'asession' && fa[0].role === 'Editor' && fs.existsSync(path.join(ROOT, fa[0].icon)), JSON.stringify(fa));
  assert.strictEqual(b.nsis.include, 'build/installer.nsh');
  const nsh = fs.readFileSync(path.join(ROOT, 'build/installer.nsh'), 'utf8');
  for (const ext of ['wav', 'mp3', 'flac', 'ogg', 'opus', 'm4a', 'aac', 'aif', 'aiff']) assert(nsh.includes(`AS_AUDIO_EXT "${ext}"`) && nsh.includes(`AS_AUDIO_EXT_REMOVE "${ext}"`), ext);
  assert(/OpenWithProgids/.test(nsh) && /customUnInstall/.test(nsh));
  assert(!/Software\\Classes\\\.\$\{EXT\}" ""/.test(nsh) && !/Software\\Classes\\\.(wav|mp3)" ""/.test(nsh), 'never writes the default program of an audio extension');
});
ok('build/asession.ico: made from build/icon.png, 16…256 px PNG entries that decode to the right sizes', () => {
  const ico = fs.readFileSync(path.join(ROOT, 'build/asession.ico'));
  assert.strictEqual(ico.readUInt16LE(2), 1, 'icon type');
  const e = ICO.readIco(ico); assert.deepStrictEqual(e.map((x) => x.size), ICO.SIZES);
  for (const x of e) { const d = ICO.decodePng(x.png); assert(d.w === x.size && d.h === x.size); }
  assert(ico.equals(ICO.makeIco(fs.readFileSync(path.join(ROOT, 'build/icon.png')))), 'up to date with the logo (node tools/make-ico.js)');
  // the 256 px entry is the logo itself; the small ones are its average (not empty / not black)
  const logo = ICO.decodePng(fs.readFileSync(path.join(ROOT, 'build/icon.png'))), big = ICO.decodePng(e[e.length - 1].png);
  assert(Buffer.from(big.px).equals(Buffer.from(logo.px)));
  const s = ICO.decodePng(e[0].png).px; let lit = 0; for (let i = 0; i < s.length; i += 4) if (s[i + 3] > 200 && s[i] + s[i + 1] + s[i + 2] > 60) lit++;
  assert(lit > 40, 'visible at 16 px: ' + lit);
});
done();

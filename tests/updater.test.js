// Run: node tests/updater.test.js — Help > Check for Updates… (electron/updater.js) with a fake electron-updater:
// off quietly without an update source, asks before download and install, progress, cancel, readable errors;
// and the build config (package.json build.publish / dist script) that keeps `npm run dist` working without a repo.
const assert = require('assert'), fs = require('fs'), os = require('os'), path = require('path'), { EventEmitter } = require('events');
const { okAsync, ok, done } = require('./_sandbox');
const U = require('../electron/updater');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'as-upd-'));
const yml = (dir, text) => { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, 'app-update.yml'), text); return dir; };

ok('no app-update.yml (no GitHub owner in build.publish) → off, reason "not-configured"; `npm start` → "dev"', () => {
  const s = new U.Updater({ packaged: true, resourcesPath: path.join(tmp, 'none'), version: '1.1.0' }).status(); assert(!s.enabled && s.reason === 'not-configured' && !s.auto, JSON.stringify(s));
  assert.strictEqual(new U.Updater({ packaged: false, resourcesPath: tmp, version: '1.1.0' }).status().reason, 'dev');
  const res = yml(path.join(tmp, 'gh'), 'owner: bys-allstages\nrepo: AudioStage\nprovider: github\nreleaseType: release\nupdaterCacheDirName: audiostage-updater\n');
  const on = new U.Updater({ packaged: true, resourcesPath: res, version: '1.1.0' }).status(); assert(on.enabled && on.feed === 'bys-allstages/AudioStage' && on.auto, JSON.stringify(on));
  assert.strictEqual(new U.Updater({ packaged: true, resourcesPath: res, startupCheck: false }).status().auto, false);
  assert.strictEqual(U.readFeed(path.join(yml(path.join(tmp, 'half'), 'provider: github\nrepo: AudioStage\n'), 'app-update.yml')), null, 'no owner → not configured');
});
okAsync('not configured: check() answers "off" without touching electron-updater or the network', async () => {
  const u = new U.Updater({ packaged: true, resourcesPath: path.join(tmp, 'none'), version: '1.1.0' }); let loaded = false; u.updater = () => { loaded = true; };
  assert.deepStrictEqual(await u.check(), { enabled: false, reason: 'not-configured' }); assert(!loaded);
});
const make = (o) => { const au = U.mockUpdater(o || {}), sent = [], u = new U.Updater({ version: '1.1.0', autoUpdater: au, feed: { provider: 'github', owner: 'x', repo: 'AudioStage' }, send: (c, d) => sent.push([c, d]), log: () => {} }); return { au, u, sent }; };
okAsync('update available: nothing is downloaded until asked; progress is sent; install only after download', async () => {
  const { au, u, sent } = make(); assert.strictEqual(au.autoDownload, undefined);
  const r = await u.check(); assert(r.available && r.version === '9.9.9' && r.current === '1.1.0' && r.notes === 'Test release', JSON.stringify(r));
  assert(au.autoDownload === false && au.autoInstallOnAppQuit === false, 'never downloads / installs by itself');
  assert.strictEqual(u.install(), false, 'cannot install before the download'); assert.strictEqual(au.installed, 0);
  const d = await u.download(); assert(d.downloaded && d.version === '9.9.9'); assert.deepStrictEqual(sent.map((s) => s[1].percent), [10, 45, 80, 100]); assert(sent.every((s) => s[0] === 'upd:progress'));
  assert.strictEqual(u.install(), true); assert.strictEqual(au.installed, 1);
});
okAsync('the same or an older version → up to date; v-prefixed / longer versions compare right', async () => {
  for (const v of ['1.1.0', '1.0.9', 'v1.1.0']) { const r = await make({ version: v }).u.check(); assert(r.enabled && r.available === false, v + ' ' + JSON.stringify(r)); }
  assert(U.newer('1.10.0', '1.9.9') && U.newer('v2.0.0', '1.99.99') && !U.newer('1.1.0', '1.1.0') && U.newer('1.1.1-beta', '1.1.0'));
});
okAsync('cancel during the download → "cancelled", and it can be downloaded again', async () => {
  const { u } = make(); await u.check(); const p = u.download(); setTimeout(() => u.cancel(), 150);
  const r = await p; assert(/cancelled/.test(r.error), JSON.stringify(r)); assert.strictEqual(u.status().state, 'available'); assert((await u.download()).downloaded);
});
okAsync('offline / no release / rate limit → messages people can act on (and the check can be tried again)', async () => {
  const r = await make({ offline: true }).u.check(); assert(/internet connection/.test(r.error), r.error);
  assert(/No AudioStage release/.test(U.friendly(new Error('HttpError: 404 Not Found "method: GET url: https://github.com/x/AudioStage/releases.atom"'))));
  assert(/limiting/.test(U.friendly(new Error('HttpError: 403 rate limit exceeded')))); assert(/checksum/.test(U.friendly(new Error('sha512 checksum mismatch'))));
  const { u, au } = make(); au.checkForUpdates = async () => { throw new Error('getaddrinfo ENOTFOUND github.com'); }; assert(/internet/.test((await u.check()).error)); assert.strictEqual(u.status().state, 'idle');
});
ok('build config: no publish target (updates come through the BYS All Stages Launcher, so no app-update.yml and Check for Updates is hidden), dist never publishes; electron-updater is MIT', () => {
  const pj = JSON.parse(fs.readFileSync(path.join(__dirname, '../package.json'), 'utf8'));
  assert(!pj.build.publish, JSON.stringify(pj.build.publish)); assert(/--publish never/.test(pj.scripts.dist)); assert(!pj.homepage, 'no placeholder homepage');
  assert.strictEqual(pj.license, 'UNLICENSED'); assert.strictEqual(pj.author, 'BYS & RB'); assert.strictEqual(pj.build.copyright, 'Copyright (c) BYS & RB. All rights reserved by BYS & RB');
  assert(!pj.dependencies.lamejs, 'lamejs is the vendored app/vendor/lame.min.js, not a packaged dependency'); assert(fs.existsSync(path.join(__dirname, '../app/vendor/lame.LICENSE.txt')), 'its LGPL notice ships with it');
  const pre = fs.readFileSync(path.join(__dirname, '../electron/preload.js'), 'utf8'); assert(/if \(updatesOn\) contextBridge\.exposeInMainWorld\('audioStageUpdate'/.test(pre), 'the update API (and menu item) only with a usable update source');
  const u0 = new U.Updater({ packaged: true, resourcesPath: tmp, version: '2.1.0' }); assert.strictEqual(u0.status().enabled, false, 'no app-update.yml → off');
  assert(pj.dependencies['electron-updater']); assert.strictEqual(require('electron-updater/package.json').license, 'MIT');
  assert(pj.build.files.includes('electron/**/*'), 'electron/updater.js is packaged');
});
done().finally(() => fs.rmSync(tmp, { recursive: true, force: true }));

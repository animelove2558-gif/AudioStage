// Help > Check for Updates… and the check when the app opens (installed app only): electron-updater (MIT). AudioStage normally
// gets its updates through the BYS All Stages Launcher, so package.json has no build.publish: then no app-update.yml is
// built, this stays off and the menu item is not shown (preload.js). The rest is kept for a copy that has an update source:
// GitHub
// Releases (free). The repository is build.publish in package.json; electron-builder turns it into
// resources/app-update.yml. While no GitHub owner is set there, no app-update.yml is built and updates stay off quietly
// (no error, no network). Nothing is downloaded or installed without asking: autoDownload / autoInstallOnAppQuit are off.
// Plain Node with an injectable autoUpdater: tested in tests/updater.test.js.
const fs = require('fs'), path = require('path');

/* owner / repo from app-update.yml (tiny "key: value" YAML written by electron-builder) */
function readFeed(file) {
  try {
    const y = fs.readFileSync(file, 'utf8'), v = (k) => { const m = new RegExp('^' + k + ':\\s*(.+?)\\s*$', 'm').exec(y); return m ? m[1].replace(/^['"]|['"]$/g, '') : ''; };
    const provider = v('provider'), owner = v('owner'), repo = v('repo');
    return provider === 'github' && owner && repo ? { provider, owner, repo } : provider && provider !== 'github' ? { provider, url: v('url') } : null;
  } catch (e) { return null; }
}
/* a message people can act on, from what electron-updater / the network says */
function friendly(e) {
  const s = String((e && (e.message || e)) || '');
  if (/ERR_INTERNET_DISCONNECTED|ENOTFOUND|EAI_AGAIN|ERR_NAME_NOT_RESOLVED|ENETUNREACH|ERR_NETWORK_CHANGED|ECONNREFUSED|ETIMEDOUT|ERR_CONNECTION/i.test(s)) return 'Could not reach GitHub to check for updates — check the internet connection and try again.';
  if (/\b404\b|Cannot find latest\.yml|No published versions|latest\.yml.*not found/i.test(s)) return 'No AudioStage release was found on the update server yet.';
  if (/\b(403|429)\b|rate limit/i.test(s)) return 'GitHub is limiting requests right now — try again in a while.';
  if (/sha512 checksum mismatch|checksum/i.test(s)) return 'The downloaded update was damaged (checksum mismatch) and was not installed. Try again.';
  if (/cancel/i.test(s)) return 'The download was cancelled.';
  return 'The update check failed: ' + s.split('\n')[0].slice(0, 300);
}
class SimpleToken { cancel() { this.cancelled = true; } } // with an injected autoUpdater (tests)
const newer = (a, b) => { const p = (v) => String(v).replace(/^v/, '').split(/[.+-]/).slice(0, 3).map((x) => parseInt(x, 10) || 0); const x = p(a), y = p(b); for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i]; return false; };

class Updater {
  /* o = { packaged, resourcesPath, version, log(level, msg), send(channel, data), autoUpdater (tests / app tests), feed (with a mock), startupCheck (false: no check at start) } */
  constructor(o) { this.o = o || {}; this.state = 'idle'; this.info = null; this.token = null; this.au = null; }
  feed() { if (this.o.feed !== undefined) return this.o.feed; return this.o.resourcesPath ? readFeed(path.join(this.o.resourcesPath, 'app-update.yml')) : null; }
  /* { enabled, reason: 'dev' | 'not-configured', feed, current, state, version, auto (the startup check may run) } */
  status() {
    const feed = this.feed(), enabled = !!(this.o.packaged || this.o.autoUpdater) && !!feed;
    return { enabled, reason: enabled ? '' : !this.o.packaged && !this.o.autoUpdater ? 'dev' : 'not-configured', feed: feed ? (feed.owner ? feed.owner + '/' + feed.repo : feed.url || feed.provider) : '', current: this.o.version || '', state: this.state, version: this.info ? this.info.version : '', auto: enabled && this.o.startupCheck !== false };
  }
  updater() {
    if (this.au) return this.au;
    const au = this.o.autoUpdater || require('electron-updater').autoUpdater; // loaded only when updates are set up
    au.autoDownload = false; au.autoInstallOnAppQuit = false; au.allowPrerelease = false;
    if (this.o.log) au.logger = { info: (m) => this.o.log('info', 'updater: ' + m), warn: (m) => this.o.log('warn', 'updater: ' + m), error: (m) => this.o.log('error', 'updater: ' + m), debug: () => {} };
    au.on('download-progress', (p) => this.o.send && this.o.send('upd:progress', { percent: Math.round(p.percent || 0), transferred: p.transferred || 0, total: p.total || 0, bytesPerSecond: p.bytesPerSecond || 0 }));
    au.on('error', (e) => this.o.log && this.o.log('warn', 'updater: ' + (e && e.message)));
    return (this.au = au);
  }
  /* → { enabled:false, reason } | { available:false, current } | { available:true, version, current, notes, date } | { error } */
  async check() {
    const st = this.status(); if (!st.enabled) return { enabled: false, reason: st.reason };
    if (this.state === 'checking' || this.state === 'downloading') return { busy: true, state: this.state };
    this.state = 'checking';
    try {
      const r = await this.updater().checkForUpdates(), ui = r && r.updateInfo;
      if (!ui || !newer(ui.version, st.current)) { this.state = 'idle'; return { enabled: true, available: false, current: st.current }; }
      this.info = ui; this.state = 'available';
      const notes = Array.isArray(ui.releaseNotes) ? ui.releaseNotes.map((n) => n.note || '').join('\n') : ui.releaseNotes || '';
      return { enabled: true, available: true, version: ui.version, current: st.current, notes: String(notes).replace(/<[^>]+>/g, '').trim().slice(0, 4000), date: ui.releaseDate || '' };
    } catch (e) { this.state = 'idle'; return { error: friendly(e) }; }
  }
  /* after the person said yes: download (progress → send('upd:progress')); → { downloaded: true, version } | { error } */
  async download() {
    if (this.state !== 'available') return { error: 'Check for updates first.' };
    this.state = 'downloading';
    try {
      const Token = this.o.autoUpdater ? SimpleToken : require('builder-util-runtime').CancellationToken;
      this.token = new Token(); await this.updater().downloadUpdate(this.token);
      if (this.token && this.token.cancelled) throw new Error('cancelled');
      this.state = 'downloaded'; this.token = null; return { downloaded: true, version: this.info.version };
    } catch (e) { this.state = 'available'; this.token = null; return { error: friendly(e) }; }
  }
  cancel() { if (this.token) { this.token.cancel(); return true; } return false; }
  /* after the person said yes again: quit, install, start the new version */
  install() { if (this.state !== 'downloaded') return false; this.updater().quitAndInstall(false, true); return true; }
}

/* the app tests' update server: version 9.9.9 is available, downloads in a few steps, install is only recorded */
function mockUpdater(o) {
  const { EventEmitter } = require('events'), au = new EventEmitter(); au.installed = 0;
  au.checkForUpdates = async () => (o && o.offline ? Promise.reject(new Error('net::ERR_INTERNET_DISCONNECTED')) : { updateInfo: { version: (o && o.version) || '9.9.9', releaseNotes: '<p>Test release</p>', releaseDate: '2026-10-27' } });
  au.downloadUpdate = async (token) => { for (const p of [10, 45, 80, 100]) { if (token && token.cancelled) throw new Error('cancelled'); await new Promise((r) => setTimeout(r, 120)); au.emit('download-progress', { percent: p, transferred: p * 1000, total: 100000, bytesPerSecond: 50000 }); } return ['AudioStage-Setup.exe']; };
  au.quitAndInstall = () => { au.installed++; };
  return au;
}

module.exports = { Updater, readFeed, friendly, newer, mockUpdater };

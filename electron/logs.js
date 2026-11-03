// Log files for Help > Show Log Files / Report a Problem: <userData>/logs/audiostage.log (the previous one is kept as
// audiostage.old.log when it grows past 2 MB). Only what happens inside AudioStage on this computer — nothing is sent
// anywhere. Plain Node, tested in tests/help.test.js.
const fs = require('fs'), path = require('path'), os = require('os');

class Log {
  constructor(dir, o = {}) { this.dir = dir; this.file = path.join(dir, 'audiostage.log'); this.max = o.max || 2 * 1024 * 1024; }
  write(level, msg) {
    try {
      fs.mkdirSync(this.dir, { recursive: true });
      try { if (fs.statSync(this.file).size > this.max) fs.renameSync(this.file, path.join(this.dir, 'audiostage.old.log')); } catch (e) { /* new file */ }
      const text = String(msg && msg.stack ? msg.stack : msg).replace(/\r?\n/g, '\n    ');
      fs.appendFileSync(this.file, `${new Date().toISOString()} ${String(level).toUpperCase().padEnd(5)} ${text}\n`);
    } catch (e) { /* logging must never break the app */ }
  }
  /* the last n lines (Report a Problem) */
  tail(n) { try { return fs.readFileSync(this.file, 'utf8').split('\n').filter(Boolean).slice(-(n || 40)); } catch (e) { return []; } }
}
/* what helps to understand a problem: versions and the system (no personal data, no file contents) */
function systemInfo(o) {
  return { app: o.version, electron: process.versions.electron || '', chrome: process.versions.chrome || '', node: process.versions.node, os: `${os.type()} ${os.release()} (${process.platform} ${process.arch})`, memory: Math.round(os.totalmem() / 1073741824) + ' GB', cpus: os.cpus().length + '× ' + ((os.cpus()[0] || {}).model || '').trim(), packaged: !!o.packaged };
}
module.exports = { Log, systemInfo };

// Log files for Help > Show Log Files / Report a Problem: <userData>/logs/audiostage.log. Every start rotates the
// files (audiostage.log -> audiostage.1.log -> audiostage.2.log, three runs are kept), so the log of a run that crashed
// is never overwritten by the next one. Inside a run a repeated message is written once and counted ("last message
// repeated N times"), and the file stops growing at 16 MiB, so the first error of an error storm always stays. A
// marker file (running.lock) exists while the app runs; if it is still there at the next start the previous run did not
// end cleanly (Log.previousRunEndedBadly). Only what happens inside AudioStage on this computer — nothing is sent
// anywhere. Plain Node, tested in tests/help.test.js.
const fs = require('fs'), path = require('path'), os = require('os');

const KEEP = 3;
class Log {
  /* o: { max: size limit of one file in bytes, rotate: false = do not rotate at construction (tests) } */
  constructor(dir, o = {}) {
    this.dir = dir; this.file = path.join(dir, 'audiostage.log'); this.max = o.max || 16 * 1024 * 1024;
    this.marker = path.join(dir, 'running.lock'); this.last = null; this.repeats = 0; this.full = false; this.size = 0; this.previousRunEndedBadly = false;
    if (o.rotate !== false) this.startRun();
  }
  /* rotate the previous run's files and set the "running" marker */
  startRun() {
    try {
      fs.mkdirSync(this.dir, { recursive: true });
      this.previousRunEndedBadly = fs.existsSync(this.marker);
      const nth = (i) => (i === 0 ? this.file : path.join(this.dir, `audiostage.${i}.log`));
      let had = false; try { had = fs.statSync(this.file).size > 0; } catch (e) { /* first start */ }
      if (had) {
        try { fs.rmSync(nth(KEEP - 1), { force: true }); } catch (e) { /* */ }
        for (let i = KEEP - 2; i >= 0; i--) { try { if (fs.existsSync(nth(i))) fs.renameSync(nth(i), nth(i + 1)); } catch (e) { /* */ } }
      }
      try { fs.rmSync(path.join(this.dir, 'audiostage.old.log'), { force: true }); } catch (e) { /* the pre-2.2 name */ }
      fs.writeFileSync(this.marker, String(process.pid));
    } catch (e) { /* logging must never break the app */ }
  }
  /* the app is closing normally: write the pending repeat count and remove the marker */
  close() { this.flush(); try { fs.rmSync(this.marker, { force: true }); } catch (e) { /* */ } }
  line(level, text) { return `${new Date().toISOString()} ${String(level).toUpperCase().padEnd(5)} ${text}\n`; }
  raw(s) {
    if (this.full) return;
    try {
      fs.mkdirSync(this.dir, { recursive: true });
      if (!this.size) { try { this.size = fs.statSync(this.file).size; } catch (e) { /* new file */ } }
      if (this.size + s.length > this.max) { this.full = true; s = this.line('warn', `Log size limit reached (${Math.round(this.max / 1048576)} MiB): later messages are not written.`); }
      fs.appendFileSync(this.file, s); this.size += s.length;
    } catch (e) { /* logging must never break the app */ }
  }
  /* write "last message repeated N times" if a message was repeated */
  flush() {
    if (this.repeats > 0 && this.last) { const n = this.repeats; this.repeats = 0; this.raw(this.line(this.last.level, `(last message repeated ${n} time${n === 1 ? '' : 's'})`)); }
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
  }
  write(level, msg) {
    try {
      const text = String(msg && msg.stack ? msg.stack : msg).replace(/\r?\n/g, '\n    ');
      if (this.last && this.last.level === level && this.last.text === text) {
        this.repeats++;
        if (!this.timer) { this.timer = setTimeout(() => { this.timer = null; this.flush(); }, 2000); if (this.timer.unref) this.timer.unref(); }
        return;
      }
      this.flush();
      this.last = { level, text };
      this.raw(this.line(level, text));
    } catch (e) { /* logging must never break the app */ }
  }
  /* the last n lines (Report a Problem) */
  tail(n) { this.flush(); try { return fs.readFileSync(this.file, 'utf8').split('\n').filter(Boolean).slice(-(n || 40)); } catch (e) { return []; } }
}
/* what helps to understand a problem: versions and the system (no personal data, no file contents) */
function systemInfo(o) {
  return { app: o.version, electron: process.versions.electron || '', chrome: process.versions.chrome || '', node: process.versions.node, os: `${os.type()} ${os.release()} (${process.platform} ${process.arch})`, memory: Math.round(os.totalmem() / 1073741824) + ' GB', cpus: os.cpus().length + '× ' + ((os.cpus()[0] || {}).model || '').trim(), packaged: !!o.packaged };
}
module.exports = { Log, systemInfo };

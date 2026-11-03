// Safe file writing for Save / Save As / Save Session / exports / save-back to EditorStage.
// A file is written in pieces to "<name>.<random>.tmp" next to the target, flushed to disk (fsync) and only then
// renamed over the target, so a crash, a full disk or a cancelled save never leaves a half-written file behind.
// The renderer sends large files in chunks (append), so no single IPC message has to hold a whole session.
const fs = require('fs'), path = require('path'), crypto = require('crypto');

const sleepSync = (ms) => { try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); } catch (e) { /* */ } };
/* rename tmp over target; Windows may refuse for a moment (virus scanner, another program reading the file):
   retry, and as a last resort copy the finished temporary file over the target (still never half-written data
   from this app: the copy only starts once the whole file is on disk) */
function replaceFile(tmp, target) {
  let err = null;
  for (let i = 0; i < 6; i++) {
    try { fs.renameSync(tmp, target); return; } catch (e) { err = e; if (!['EPERM', 'EBUSY', 'EACCES'].includes(e.code)) break; sleepSync(60 * (i + 1)); }
  }
  if (err && ['EPERM', 'EBUSY', 'EACCES'].includes(err.code)) { fs.copyFileSync(tmp, target); try { fs.unlinkSync(tmp); } catch (e) { /* */ } return; }
  throw err;
}
const toBuf = (data) => (typeof data === 'string' ? Buffer.from(data, 'utf8') : data instanceof ArrayBuffer ? Buffer.from(new Uint8Array(data)) : ArrayBuffer.isView(data) ? Buffer.from(data.buffer, data.byteOffset, data.byteLength) : null);

/* one-shot atomic write (small files) */
function writeFileAtomic(target, data) {
  const buf = toBuf(data); if (!buf) throw new Error('Bad data.');
  const w = new AtomicWriter(); const id = w.begin(target); try { w.append(id, buf); return w.commit(id); } catch (e) { w.abort(id); throw e; }
}

class AtomicWriter {
  constructor() { this.open = new Map(); }
  begin(target) {
    const p = path.resolve(target); fs.mkdirSync(path.dirname(p), { recursive: true });
    const tmp = p + '.' + crypto.randomBytes(4).toString('hex') + '.tmp';
    const fd = fs.openSync(tmp, 'w'), id = crypto.randomBytes(8).toString('hex');
    this.open.set(id, { fd, tmp, target: p, bytes: 0 });
    return id;
  }
  get(id) { const h = this.open.get(id); if (!h) throw new Error('This save was already finished or cancelled.'); return h; }
  append(id, data) {
    const h = this.get(id), buf = toBuf(data); if (!buf) throw new Error('Bad data.');
    let off = 0; while (off < buf.length) off += fs.writeSync(h.fd, buf, off, buf.length - off);
    h.bytes += buf.length; return h.bytes;
  }
  commit(id) {
    const h = this.get(id); this.open.delete(id);
    try { fs.fsyncSync(h.fd); fs.closeSync(h.fd); replaceFile(h.tmp, h.target); }
    catch (e) { try { fs.closeSync(h.fd); } catch (er) { /* closed */ } try { fs.unlinkSync(h.tmp); } catch (er) { /* */ } throw e; }
    return { path: h.target, bytes: h.bytes };
  }
  abort(id) {
    const h = this.open.get(id); if (!h) return false; this.open.delete(id);
    try { fs.closeSync(h.fd); } catch (e) { /* */ } try { fs.unlinkSync(h.tmp); } catch (e) { /* */ }
    return true;
  }
  abortAll() { for (const id of [...this.open.keys()]) this.abort(id); }
}

/* "Take 1.wav" in dir → "Take 1 (2).wav", "Take 1 (3).wav", … the first name that is free (also among `taken`) */
function freeName(dir, name, taken) {
  const t = taken || new Set(), m = /^(.*?)(\.[^.]*)?$/.exec(name), base = m[1], ext = m[2] || '';
  const busy = (n) => t.has(n.toLowerCase()) || fs.existsSync(path.join(dir, n));
  if (!busy(name)) return name;
  for (let i = 2; i < 10000; i++) { const n = `${base} (${i})${ext}`; if (!busy(n)) return n; }
  throw new Error('No free file name for ' + name);
}

module.exports = { AtomicWriter, writeFileAtomic, replaceFile, freeName, toBuf };

// File > Open Recent / Open Recent Session: the two lists (10 each, newest first) in <userData>/recent.json.
// Plain Node, tested in tests/recent.test.js. main.js adds each entry to the Windows Jump List too.
const fs = require('fs'), path = require('path');
const KINDS = ['files', 'sessions'], MAX = 10;
const same = (a, b) => (process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b);

class RecentStore {
  constructor(file, o = {}) { this.file = file; this.max = o.max || MAX; }
  get() {
    let j = {}; try { j = JSON.parse(fs.readFileSync(this.file, 'utf8')) || {}; } catch (e) { /* none yet / damaged: start empty */ }
    const out = {}; for (const k of KINDS) out[k] = (Array.isArray(j[k]) ? j[k] : []).filter((e) => e && typeof e.path === 'string').slice(0, this.max);
    return out;
  }
  save(l) { fs.mkdirSync(path.dirname(this.file), { recursive: true }); fs.writeFileSync(this.file + '.tmp', JSON.stringify(l, null, 1)); fs.renameSync(this.file + '.tmp', this.file); return l; }
  kind(k) { if (!KINDS.includes(k)) throw new Error('Unknown recent list.'); return k; }
  /* to the top (moved there if it was in the list already) */
  add(k, p) {
    if (typeof p !== 'string' || !p) throw new Error('Bad path.');
    const l = this.get(), full = path.resolve(p);
    l[this.kind(k)] = [{ path: full, name: path.basename(full), at: Date.now() }, ...l[k].filter((e) => !same(e.path, full))].slice(0, this.max);
    return this.save(l);
  }
  remove(k, p) { const l = this.get(); l[this.kind(k)] = l[k].filter((e) => !same(e.path, String(p))); return this.save(l); }
  clear(k) { const l = this.get(); if (k) l[this.kind(k)] = []; else for (const x of KINDS) l[x] = []; return this.save(l); }
  has(p) { const l = this.get(); return KINDS.some((k) => l[k].some((e) => same(e.path, path.resolve(String(p))))); }
}
module.exports = { RecentStore, KINDS, MAX };

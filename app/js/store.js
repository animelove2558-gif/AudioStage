/* Local key → bytes store for autosave, crash recovery and project versions.
   Desktop app: files in <userData>/store (via the preload bridge). Browser build: IndexedDB. Tests: memory.
   API (all async): put(key, Uint8Array | string), get(key) → Uint8Array | null, getText(key), del(key), list(prefix). */
(function (root) {
  'use strict';
  const AS = (root.AS = root.AS || {});
  const enc = (s) => new TextEncoder().encode(s), dec = (u) => new TextDecoder().decode(u);

  function electronBackend(api) {
    const chk = (r) => { if (!r || !r.ok) throw new Error((r && r.error) || 'Store error'); return r; };
    return {
      kind: 'disk',
      put: async (k, v) => { chk(await api.put(k, typeof v === 'string' ? v : v)); },
      get: async (k) => chk(await api.get(k)).data || null,
      del: async (k) => { chk(await api.del(k)); },
      list: async (p) => chk(await api.list(p || '')).keys,
      // large values in pieces (temporary file renamed when complete), and read back in pieces
      sink: api.begin ? (k) => { let id = null; const open = async () => id || (id = chk(await api.begin(k)).id); return { write: async (u8) => { const h = await open(); for (let o = 0; o < u8.length; o += 16 << 20) chk(await api.append(h, u8.subarray(o, Math.min(u8.length, o + (16 << 20))))); }, commit: async () => { chk(await api.commit(await open())); }, abort: async () => { if (id) await api.abort(id); } }; } : null,
      source: api.stat ? async (k) => { const st = chk(await api.stat(k)); return st.size == null ? null : { size: st.size, read: async (o, n) => chk(await api.read(k, o, n)).data }; } : null,
    };
  }
  function idbBackend() {
    let dbp = null;
    const db = () => dbp || (dbp = new Promise((res, rej) => { const r = indexedDB.open('audiostage-store', 1); r.onupgradeneeded = () => r.result.createObjectStore('kv'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }));
    const tx = async (mode, fn) => { const d = await db(); return new Promise((res, rej) => { const t = d.transaction('kv', mode), st = t.objectStore('kv'), r = fn(st); t.oncomplete = () => res(r && r.result); t.onerror = () => rej(t.error); }); };
    return {
      kind: 'indexeddb',
      put: (k, v) => tx('readwrite', (s) => s.put(typeof v === 'string' ? enc(v) : v, k)),
      get: async (k) => (await tx('readonly', (s) => s.get(k))) || null,
      del: (k) => tx('readwrite', (s) => s.delete(k)),
      list: async (p) => ((await tx('readonly', (s) => s.getAllKeys())) || []).filter((k) => !p || k.startsWith(p)),
    };
  }
  function memoryBackend() {
    const m = new Map();
    return { kind: 'memory', map: m, put: async (k, v) => { m.set(k, typeof v === 'string' ? enc(v) : new Uint8Array(v)); }, get: async (k) => m.get(k) || null, del: async (k) => { m.delete(k); }, list: async (p) => [...m.keys()].filter((k) => !p || k.startsWith(p)) };
  }
  function create(backend) {
    const b = backend;
    /* sink(key) → { write(u8), commit(), abort() } · source(key) → { size, read(offset, length) } | null — streaming
       where the backend can (desktop), otherwise collected in memory */
    const sink = (k) => (b.sink ? b.sink(k) : (() => { const parts = []; return { write: async (u) => { parts.push(u.slice()); }, commit: async () => { const n = parts.reduce((a, p) => a + p.length, 0), o = new Uint8Array(n); let q = 0; for (const p of parts) { o.set(p, q); q += p.length; } await b.put(k, o); }, abort: async () => {} }; })());
    const source = async (k) => { if (b.source) return b.source(k); const u = await b.get(k); return u ? { size: u.length, read: async (o, n) => u.subarray(o, o + n) } : null; };
    return { kind: b.kind, put: b.put, get: b.get, del: b.del, list: b.list, sink, source, getText: async (k) => { const u = await b.get(k); return u ? dec(u) : null; }, getJSON: async (k) => { const u = await b.get(k); return u ? JSON.parse(dec(u)) : null; } };
  }
  const pick = () => (root.audioStageStore ? electronBackend(root.audioStageStore) : typeof indexedDB !== 'undefined' ? idbBackend() : memoryBackend());
  AS.store = Object.assign(create(pick()), { create, memoryBackend });
})(typeof window !== 'undefined' ? window : globalThis);

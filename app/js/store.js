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
    return { kind: b.kind, put: b.put, get: b.get, del: b.del, list: b.list, getText: async (k) => { const u = await b.get(k); return u ? dec(u) : null; }, getJSON: async (k) => { const u = await b.get(k); return u ? JSON.parse(dec(u)) : null; } };
  }
  const pick = () => (root.audioStageStore ? electronBackend(root.audioStageStore) : typeof indexedDB !== 'undefined' ? idbBackend() : memoryBackend());
  AS.store = Object.assign(create(pick()), { create, memoryBackend });
})(typeof window !== 'undefined' ? window : globalThis);

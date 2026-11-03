/* Autosave, crash recovery and project versions (snapshots).
   Store layout (AS.store: <userData>/store in the desktop app, IndexedDB in the browser):
     audio/<id>.wav       one 32-bit float WAV per audio source / per version of an unsaved file. Sources are
                          immutable, so each is written once and every later autosave only writes JSON.
     autosave.json        the latest autosave: session (audio by reference) + unsaved Waveform files
     versions/<id>.json   named project versions (session snapshots, audio by reference)
   Audio files no manifest refers to any more are deleted after every save (gc).
   Crash detection: a flag in localStorage is set while the app runs and cleared when the page is closed
   normally (pagehide). Found at start-up = the last run did not end normally → offer recovery. */
(function (root) {
  'use strict';
  const AS = (root.AS = root.AS || {});
  let seq = 0;
  const uid = (p) => p + Date.now().toString(36) + (seq++).toString(36) + Math.random().toString(36).slice(2, 6);
  const sidOf = (src) => src.sid || (src.sid = uid('s'));
  const docUid = (d) => d.uid || (d.uid = uid('d'));
  const wavOf = (ch, sr) => new Uint8Array(AS.wav.encodeWav(ch, sr, 32, false));
  const unwav = (u8) => AS.wav.decodeWav(u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength));

  /* the session as JSON with its audio written (once) to audio/<id>.wav. Returns { json, srcMeta } */
  async function packSession(store, session, known) {
    const used = new Map();
    const json = AS.sessionIO.serialize(session, { ref: (src) => { const id = sidOf(src); used.set(id, src); return id; } });
    const srcMeta = {};
    for (const [id, src] of used) {
      srcMeta[id] = { name: src.name, ...(src.tempo ? { tempo: src.tempo } : {}) };
      const key = 'audio/' + id + '.wav';
      if (!known.has(key)) { await store.put(key, wavOf(src.ch, src.sr)); known.add(key); }
    }
    return { json, srcMeta };
  }
  async function unpackSession(store, pack) {
    const cache = {};
    for (const id of Object.keys(pack.srcMeta || {})) { const u = await store.get('audio/' + id + '.wav'); if (!u) throw new Error('Missing audio for ' + (pack.srcMeta[id].name || id)); const w = unwav(u), s = AS.makeSource(pack.srcMeta[id].name, w.sr, w.ch); s.sid = id; if (pack.srcMeta[id].tempo) s.tempo = pack.srcMeta[id].tempo; cache[id] = s; }
    return AS.sessionIO.deserialize(pack.json, { source: (id) => cache[id] });
  }
  const knownKeys = async (store) => new Set(await store.list('audio/'));

  /* ---------- autosave ----------
     state: { session, docs: [Doc…], mode } — only Waveform files with unsaved changes are kept */
  async function saveNow(store, state) {
    const known = await knownKeys(store), pack = await packSession(store, state.session, known), docs = [];
    for (const d of state.docs || []) {
      if (!d.dirty) continue;
      const key = 'audio/' + docUid(d) + '-v' + d.version + '.wav';
      if (!known.has(key)) { await store.put(key, wavOf(d.ch, d.sr)); known.add(key); }
      docs.push({ key, name: d.name, sel: d.sel, markers: d.markers, playlist: d.playlist || [], tempo: d.tempo || null, meta: d.meta || null, uid: docUid(d) });
    }
    const manifest = { app: 'AudioStage', kind: 'autosave', time: Date.now(), mode: state.mode || 'wave', session: pack, docs, tracks: state.session.tracks.length, clips: state.session.tracks.reduce((a, t) => a + t.clips.length, 0) };
    await store.put('autosave.json', JSON.stringify(manifest));
    await gc(store);
    return manifest;
  }
  const readAutosave = (store) => store.getJSON('autosave.json');
  async function restore(store, manifest) {
    const session = await unpackSession(store, manifest.session), docs = [];
    for (const m of manifest.docs || []) { const u = await store.get(m.key); if (!u) continue; const w = unwav(u); docs.push({ ...m, sr: w.sr, ch: w.ch }); }
    return { session, docs, mode: manifest.mode };
  }
  const discard = async (store) => { await store.del('autosave.json'); await gc(store); };

  /* ---------- project versions ---------- */
  async function saveVersion(store, name, session) {
    const id = uid('v'), pack = await packSession(store, session, await knownKeys(store));
    const v = { app: 'AudioStage', kind: 'version', id, name: name || 'Version', time: Date.now(), session: pack, tracks: session.tracks.length, clips: session.tracks.reduce((a, t) => a + t.clips.length, 0) };
    await store.put('versions/' + id + '.json', JSON.stringify(v));
    return v;
  }
  async function listVersions(store) {
    const out = [];
    for (const k of await store.list('versions/')) { const v = await store.getJSON(k); if (v) out.push({ id: v.id, name: v.name, time: v.time, tracks: v.tracks, clips: v.clips }); }
    return out.sort((a, b) => b.time - a.time);
  }
  async function loadVersion(store, id) { const v = await store.getJSON('versions/' + id + '.json'); if (!v) throw new Error('Version not found.'); return unpackSession(store, v.session); }
  async function deleteVersion(store, id) { await store.del('versions/' + id + '.json'); await gc(store); }

  /* delete audio files that neither the autosave nor any version refers to */
  async function gc(store) {
    const keep = new Set(), add = (m) => { if (!m) return; for (const id of Object.keys((m.session && m.session.srcMeta) || {})) keep.add('audio/' + id + '.wav'); for (const d of m.docs || []) keep.add(d.key); };
    add(await store.getJSON('autosave.json'));
    for (const k of await store.list('versions/')) add(await store.getJSON(k));
    let n = 0; for (const k of await store.list('audio/')) if (!keep.has(k)) { await store.del(k); n++; }
    return n;
  }

  /* ---------- crash marker ---------- */
  const MARK = 'as-running';
  function boot(ls) {
    const l = ls || root.localStorage; let crashed = false;
    try { crashed = !!l.getItem(MARK); l.setItem(MARK, String(Date.now())); } catch (e) { /* storage blocked: no recovery */ }
    if (root.addEventListener) root.addEventListener('pagehide', () => { try { l.removeItem(MARK); } catch (e) { /* */ } });
    return crashed;
  }

  AS.autosave = { saveNow, readAutosave, restore, discard, saveVersion, listVersions, loadVersion, deleteVersion, gc, boot, packSession, unpackSession, sidOf };
})(typeof window !== 'undefined' ? window : globalThis);

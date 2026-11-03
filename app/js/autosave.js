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
  /* audio files: 32-bit float WAV, written and read in pieces (an hour of stereo audio is never one 1.4 GB buffer
     or one IPC message) */
  const PIECE = 1 << 20; // frames per piece
  async function putWav(store, key, ch, sr) {
    const nch = ch.length, L = ch[0].length, bytes = L * nch * 4, h = new Uint8Array(44), v = new DataView(h.buffer), s = (o, t) => { for (let i = 0; i < 4; i++) h[o + i] = t.charCodeAt(i); };
    s(0, 'RIFF'); v.setUint32(4, Math.min(0xffffffff, 36 + bytes), true); s(8, 'WAVE'); s(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 3, true); v.setUint16(22, nch, true); v.setUint32(24, sr, true); v.setUint32(28, sr * nch * 4, true); v.setUint16(32, nch * 4, true); v.setUint16(34, 32, true); s(36, 'data'); v.setUint32(40, Math.min(0xffffffff, bytes), true);
    const sk = store.sink(key);
    try {
      await sk.write(h);
      for (let a = 0; a < L; a += PIECE) { const n = Math.min(PIECE, L - a), buf = new Float32Array(n * nch); for (let c = 0; c < nch; c++) { const x = ch[c]; for (let k = 0, j = c; k < n; k++, j += nch) buf[j] = x[a + k]; } await sk.write(new Uint8Array(buf.buffer)); }
      await sk.commit();
    } catch (e) { await sk.abort(); throw e; }
  }
  async function getWav(store, key) {
    const src = await store.source(key); if (!src) return null;
    const head = await src.read(0, Math.min(src.size, 4096)), hv = new DataView(head.buffer, head.byteOffset, head.byteLength), tag = (o) => String.fromCharCode(head[o], head[o + 1], head[o + 2], head[o + 3]);
    let p = 12, fmt = null, at = -1;
    while (p + 8 <= head.length) { const id = tag(p), len = hv.getUint32(p + 4, true); if (id === 'fmt ') fmt = { format: hv.getUint16(p + 8, true), nch: hv.getUint16(p + 10, true), sr: hv.getUint32(p + 12, true), bits: hv.getUint16(p + 22, true) }; if (id === 'data') { at = p + 8; break; } p += 8 + len + (len & 1); }
    if (!fmt || at < 0 || fmt.bits !== 32 || fmt.format !== 3) { const all = await src.read(0, src.size); return AS.wav.decodeWav(all.buffer.slice(all.byteOffset, all.byteOffset + all.byteLength)); } // (anything else: the plain decoder)
    const nch = fmt.nch, frames = Math.floor((src.size - at) / (4 * nch)), ch = Array.from({ length: nch }, () => new Float32Array(frames));
    for (let f = 0; f < frames; f += PIECE) {
      const n = Math.min(PIECE, frames - f), u = await src.read(at + f * nch * 4, n * nch * 4), x = new Float32Array(u.buffer.slice(u.byteOffset, u.byteOffset + n * nch * 4));
      for (let c = 0; c < nch; c++) { const y = ch[c]; for (let k = 0, j = c; k < n; k++, j += nch) y[f + k] = x[j]; }
    }
    return { sr: fmt.sr, ch };
  }

  /* the session as JSON with its audio written (once) to audio/<id>.wav. Returns { json, srcMeta } */
  async function packSession(store, session, known) {
    const used = new Map();
    const json = AS.sessionIO.serialize(session, { ref: (src) => { const id = sidOf(src); used.set(id, src); return id; } });
    const srcMeta = {};
    for (const [id, src] of used) {
      srcMeta[id] = { name: src.name, ...(src.tempo ? { tempo: src.tempo } : {}) };
      const key = 'audio/' + id + '.wav';
      if (!known.has(key)) { await putWav(store, key, src.ch, src.sr); known.add(key); }
    }
    return { json, srcMeta };
  }
  async function unpackSession(store, pack) {
    const cache = {};
    for (const id of Object.keys(pack.srcMeta || {})) { const w = await getWav(store, 'audio/' + id + '.wav'); if (!w) throw new Error('Missing audio for ' + (pack.srcMeta[id].name || id)); const s = AS.makeSource(pack.srcMeta[id].name, w.sr, w.ch); s.sid = id; if (pack.srcMeta[id].tempo) s.tempo = pack.srcMeta[id].tempo; cache[id] = s; }
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
      if (!known.has(key)) { await putWav(store, key, d.ch, d.sr); known.add(key); }
      docs.push({ key, name: d.name, sel: d.sel, markers: d.markers, playlist: d.playlist || [], tempo: d.tempo || null, meta: d.meta || null, uid: docUid(d), path: d.path || '' });
    }
    const sf = state.session.filePath || state.session.fileName ? { name: state.session.fileName || '', path: state.session.filePath || '' } : null;
    const manifest = { app: 'AudioStage', kind: 'autosave', time: Date.now(), mode: state.mode || 'wave', session: pack, ...(sf ? { sessionFile: sf } : {}), docs, tracks: state.session.tracks.length, clips: state.session.tracks.reduce((a, t) => a + t.clips.length, 0) };
    await store.put('autosave.json', JSON.stringify(manifest));
    await gc(store);
    return manifest;
  }
  const readAutosave = (store) => store.getJSON('autosave.json');
  async function restore(store, manifest) {
    const session = await unpackSession(store, manifest.session), docs = [];
    for (const m of manifest.docs || []) { const w = await getWav(store, m.key); if (!w) continue; docs.push({ ...m, sr: w.sr, ch: w.ch }); }
    return { session, docs, mode: manifest.mode, sessionFile: manifest.sessionFile || null };
  }
  const discard = async (store) => { await store.del('autosave.json'); await gc(store); };
  /* after a normal exit the autosave is not thrown away at once: it becomes "the last session" (last.json), which
     File > Recover Last Session… restores until the next normal exit replaces it (G8: a "Close Without Saving" by
     mistake can still be undone). Its audio is kept by gc like the autosave's. */
  async function keepAsLast(store) {
    const u = await store.get('autosave.json'); if (!u) return false;
    await store.put('last.json', u); await store.del('autosave.json'); await gc(store); return true;
  }
  const readLast = (store) => store.getJSON('last.json');

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
    add(await store.getJSON('autosave.json')); add(await store.getJSON('last.json'));
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

  AS.autosave = { saveNow, readAutosave, restore, discard, keepAsLast, readLast, saveVersion, listVersions, loadVersion, deleteVersion, gc, boot, packSession, unpackSession, sidOf };
})(typeof window !== 'undefined' ? window : globalThis);

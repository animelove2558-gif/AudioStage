/* Files on disk in the desktop app (window.audioStageFiles, main.js): the Save dialog, chunked atomic writes
   (temporary file → renamed over the target when complete), files read in pieces. Nothing here exists in the
   browser build (AS.disk.available = false): there saving falls back to downloads and opening to <input type=file>.
     chooseSave({ title, name, path, filters }) → path | null (cancelled)
     writeBytes(path, ArrayBuffer | Uint8Array | string, { onProgress, signal }) → path
     sink(path) → { write(u8), commit() → path, abort() }  (streaming, used by .asession format 4)
     source(path) → { name, path, size, read(offset, length) }       fileSource(File) → the same for a File
     readAll(source, { onProgress, signal }) → ArrayBuffer           lazyFile(source) → File-like for openFiles */
(function (root) {
  'use strict';
  const AS = (root.AS = root.AS || {});
  const api = root.audioStageFiles && root.audioStageFiles.begin ? root.audioStageFiles : null;
  const CHUNK = 16 * 1024 * 1024; // bytes per IPC message
  const chk = (r) => { if (!r || !r.ok) throw new Error((r && r.error) || 'File error'); return r; };
  const cancelled = () => Object.assign(new Error('Cancelled'), { cancelled: true });
  const baseName = (p) => String(p).split(/[\\/]/).pop();

  async function chooseSave(o) { return chk(await api.chooseSave(o || {})).path || null; }
  function sink(p) {
    let id = null, failed = false;
    const open = async () => { if (!id) id = chk(await api.begin(p)).id; return id; };
    return {
      async write(u8) {
        const h = await open();
        for (let o = 0; o < u8.length; o += CHUNK) { try { chk(await api.append(h, u8.subarray(o, Math.min(u8.length, o + CHUNK)))); } catch (e) { failed = true; throw e; } }
      },
      async commit() { if (failed) throw new Error('Write failed'); const h = await open(); return chk(await api.commit(h)).path; },
      async abort() { if (id) { try { await api.abort(id); } catch (e) { /* */ } id = null; } },
    };
  }
  async function writeBytes(p, data, o) {
    const oo = o || {}, u8 = typeof data === 'string' ? new TextEncoder().encode(data) : data instanceof ArrayBuffer ? new Uint8Array(data) : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    const s = sink(p);
    try {
      for (let a = 0; a < u8.length || a === 0; a += CHUNK) {
        if (oo.signal && oo.signal.aborted) throw cancelled();
        await s.write(u8.subarray(a, Math.min(u8.length, a + CHUNK))); if (oo.onProgress) oo.onProgress(Math.min(u8.length, a + CHUNK), u8.length);
        if (!u8.length) break;
      }
      return await s.commit();
    } catch (e) { await s.abort(); throw e; }
  }
  /* a file on disk the user opened → source, or null when it is no longer there */
  const fromInfo = (p, name, size) => ({ name: name || baseName(p), path: p, size, read: async (off, len) => chk(await api.read(p, off, len)).data });
  async function source(p) {
    const st = chk(await api.stat(p)); if (st.missing) return null;
    return fromInfo(p, st.name, st.size);
  }
  function fileSource(f) { return { name: f.name, path: '', size: f.size, read: async (off, len) => new Uint8Array(await f.slice(off, off + len).arrayBuffer()) }; }
  async function readAll(src, o) {
    const oo = o || {}, out = new Uint8Array(src.size);
    for (let a = 0; a < src.size; a += CHUNK) {
      if (oo.signal && oo.signal.aborted) throw cancelled();
      out.set(await src.read(a, Math.min(CHUNK, src.size - a)), a); if (oo.onProgress) oo.onProgress(Math.min(src.size, a + CHUNK), src.size);
    }
    return out.buffer;
  }
  /* what openFiles needs from a File (name, type, size, arrayBuffer) for a file that is read only when it is opened */
  function lazyFile(src, o) {
    const ext = (/\.(\w+)$/.exec(src.name) || [])[1] || '', type = /^(mp4|mov|mkv|m4v|webm)$/i.test(ext) ? 'video/' + ext.toLowerCase() : '';
    return { name: src.name, size: src.size, type, asPath: src.path, lazy: true, arrayBuffer: (o2) => readAll(src, o2 || o) };
  }
  const dirOf = (p) => { const i = Math.max(String(p).lastIndexOf('\\'), String(p).lastIndexOf('/')); return i > 0 ? String(p).slice(0, i) : ''; };
  const join = (dir, name) => (dir ? dir.replace(/[\\/]+$/, '') + (dir.includes('/') && !dir.includes('\\') ? '/' : '\\') + name : name);
  async function freeSpace(dir) { if (!api || !api.freeSpace) return null; const r = await api.freeSpace(dir); return r && r.ok ? r.free : null; }

  AS.disk = { available: !!api, chooseSave, sink, writeBytes, source, fromInfo, fileSource, readAll, lazyFile, baseName, dirOf, join, freeSpace, CHUNK };
})(typeof window !== 'undefined' ? window : globalThis);

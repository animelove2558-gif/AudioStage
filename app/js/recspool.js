/* Recording safety net: while recording, the captured audio is also written to the local store every few seconds
   (rec/<id>/meta.json + rec/<id>/<n>.f32, interleaved 32-bit float), so a crash or a power cut during a long take
   loses at most the last few seconds. A normal Stop deletes it; anything found at the next start is offered as
   "Recover interrupted recording" (a new unsaved Waveform file).
     start(store, { sr, nch, name }) → { push(channels), stop() → Promise, seconds() }
     list(store) → [{ id, sr, nch, name, time, frames }]      recover(store, id) → { name, sr, ch }      discard(store, id) */
(function (root) {
  'use strict';
  const AS = (root.AS = root.AS || {});
  const SEG_SECONDS = 5;
  let seq = 0;

  function start(store, o) {
    const id = 'r' + Date.now().toString(36) + (seq++).toString(36), sr = o.sr, nch = o.nch || 2, base = 'rec/' + id + '/';
    let pending = [], pendingFrames = 0, n = 0, frames = 0, queue = store.put(base + 'meta.json', JSON.stringify({ app: 'AudioStage', kind: 'recording', id, sr, nch, name: o.name || 'Recording', time: Date.now() })), failed = false, stopped = false;
    const flush = () => {
      if (!pendingFrames) return queue;
      const L = pendingFrames, buf = new Float32Array(L * nch); let p = 0;
      for (const chs of pending) { const m = chs[0].length; for (let k = 0; k < m; k++) for (let c = 0; c < nch; c++) buf[(p + k) * nch + c] = (chs[c] || chs[0])[k]; p += m; }
      pending = []; pendingFrames = 0; const key = base + String(n++).padStart(6, '0') + '.f32';
      queue = queue.then(() => store.put(key, new Uint8Array(buf.buffer))).catch((e) => { if (!failed) { failed = true; console.warn('Recording backup failed:', e); } });
      return queue;
    };
    return {
      id,
      push(chs) { if (stopped || !chs || !chs[0]) return; pending.push(chs); pendingFrames += chs[0].length; frames += chs[0].length; if (pendingFrames >= sr * SEG_SECONDS) flush(); },
      seconds: () => frames / sr,
      flush,
      /* normal end: the take is in the app now, the backup goes */
      async stop() { stopped = true; pending = []; pendingFrames = 0; try { await queue; } catch (e) { /* */ } await discard(store, id); },
    };
  }
  async function list(store) {
    const keys = await store.list('rec/'), ids = [...new Set(keys.map((k) => k.split('/')[1]).filter(Boolean))], out = [];
    for (const id of ids) {
      let m = null; try { m = await store.getJSON('rec/' + id + '/meta.json'); } catch (e) { /* damaged */ }
      const segs = keys.filter((k) => k.startsWith('rec/' + id + '/') && k.endsWith('.f32'));
      if (!m) { await discard(store, id); continue; }
      out.push({ id, sr: m.sr, nch: m.nch, name: m.name, time: m.time, segments: segs.length });
    }
    return out.filter((r) => r.segments > 0);
  }
  async function recover(store, id) {
    const m = await store.getJSON('rec/' + id + '/meta.json'); if (!m) throw new Error('Recording backup not found.');
    const segs = (await store.list('rec/' + id + '/')).filter((k) => k.endsWith('.f32')).sort(), parts = [];
    for (const k of segs) { const u = await store.get(k); if (u && u.length >= 4) parts.push(new Float32Array(u.buffer.slice(u.byteOffset, u.byteOffset + (u.length - (u.length % (4 * m.nch)))))); }
    const L = parts.reduce((a, p) => a + p.length / m.nch, 0), ch = Array.from({ length: m.nch }, () => new Float32Array(L));
    let f = 0; for (const p of parts) { const n = p.length / m.nch; for (let k = 0; k < n; k++) for (let c = 0; c < m.nch; c++) ch[c][f + k] = p[k * m.nch + c]; f += n; }
    return { name: m.name, sr: m.sr, ch, time: m.time };
  }
  async function discard(store, id) { for (const k of await store.list('rec/' + id + '/')) await store.del(k); }

  AS.recSpool = { start, list, recover, discard, SEG_SECONDS };
})(typeof window !== 'undefined' ? window : globalThis);

/* .asession files: serialize / deserialize with a format version and migration, so every older session still opens.
   Format history:
     1  (no version field)  tracks + clips + base64 sources
     2  "v": 2              + clip envelopes (dB "vol"), rack fx / rackCfg, track automation
     3  "version": 3        + bus tracks (type), output routing (out), sends, sidechain keys (fx.p.sc),
                            clip volume envelope stored as linear gain ("volume"; older dB "vol" is converted),
                            "settings" (crossfades, overlap policy, tempo…; missing = older file: crossfades off),
                            clip stacking order (clip "z", settings.stack; missing = older file: z from the clip order,
                            stacking off so overlapping clips still sum as before)
     4  "version": 4        the file is a ZIP (sessionzip.js): session.json + one 32-bit float WAV per source; sources
                            list {name, sr, channels, frames, file} instead of base64 audio. Older JSON files still open. */
(function (root) {
  'use strict';
  const AS = (root.AS = root.AS || {});
  const VERSION = 4;

  const b64 = (u8) => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); };
  const unb64 = (s) => { const bin = atob(s), u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u; };
  const encCh = (c) => b64(new Uint8Array(c.buffer, c.byteOffset, c.byteLength));
  const decCh = (s) => { const u = unb64(String(s)); return new Float32Array(u.buffer, 0, u.length >> 2); }; // (a damaged length that is not a multiple of 4 loses the last bytes instead of throwing)

  /* Session -> plain JSON object (sources stored once, clips refer to them by index).
     opts.ref(src) -> string: keep the audio out of the JSON and refer to each source by that id instead
     (autosave / versions store every source once as its own file); deserialize then needs opts.source(id). */
  function serialize(session, opts) {
    const srcs = [], idx = opts && opts.ref ? opts.ref : (s) => { let i = srcs.indexOf(s); if (i < 0) { srcs.push(s); i = srcs.length - 1; } return i; };
    const tracks = session.tracks.map((t) => ({ ...t, ...(t.frozen ? { frozen: { src: idx(t.frozen.src) } } : {}), clips: t.clips.map((c) => ({ ...c, src: idx(c.src), ...(c.takes ? { takes: c.takes.map((tk) => ({ name: tk.name, src: idx(tk.src) })) } : {}) })) }));
    return { app: 'AudioStage', version: VERSION, sr: session.sr, bits: session.bits || 24, master: session.master, settings: session.opts, tracks, sources: srcs.map((s) => ({ name: s.name, sr: s.sr, ch: s.ch.map(encCh), ...(s.tempo ? { tempo: s.tempo } : {}) })), ...(session.extra ? { extra: session.extra } : {}) };
  }

  /* bring any older file up to the current format (pure: returns a new object, input untouched) */
  function migrate(j0) {
    // deep copy of everything but the (possibly huge) base64 audio strings, which are never changed
    const { sources, ...rest } = j0 || {}, j = JSON.parse(JSON.stringify(rest));
    j.sources = Array.isArray(sources) ? sources.slice() : [];
    const from = +(j.version || j.v || 1);
    if (from > VERSION) throw new Error(`This session was saved by a newer AudioStage (format ${from}). Please update the app.`);
    if (!j.master || typeof j.master !== 'object') j.master = { vol: 0, fx: [] };
    if (!j.settings || typeof j.settings !== 'object') delete j.settings;
    j.tracks = (Array.isArray(j.tracks) ? j.tracks : []).filter((t) => t && typeof t === 'object' && !Array.isArray(t)).map((t) => {
      const n = { fx: [], auto: { vol: [], pan: [] }, ...t };
      if (!Array.isArray(n.fx)) n.fx = []; if (!n.auto || typeof n.auto !== 'object') n.auto = { vol: [], pan: [] };
      if (from < 3) { n.type = 'audio'; n.out = 'master'; n.sends = []; }
      if (!n.auto.vol) n.auto.vol = []; if (!n.auto.pan) n.auto.pan = [];
      n.clips = (Array.isArray(n.clips) ? n.clips : []).filter((c) => c && typeof c === 'object').map((c) => ({ fx: [], fi: 0, fo: 0, fiCurve: 'linear', foCurve: 'linear', gain: 0, off: 0, ...c }));
      return n;
    });
    // files without settings predate automatic crossfades: keep them off so the session sounds exactly as before
    if (!j.settings) j.settings = { xfade: false };
    // files from before clip stacking: back-to-front = the clip order on each track; overlapping clips keep summing
    if (j.settings.stack === undefined) { j.settings.stack = false; for (const t of j.tracks) t.clips.forEach((c, i) => { if (c.z == null) c.z = i + 1; }); }
    j.version = VERSION; delete j.v;
    return j;
  }

  /* ---- validation of a loaded session (a damaged or hand-edited file must open cleanly or say what was removed) ----
     Clips whose audio is missing or unusable are removed; numbers that are not finite / out of range are replaced by
     safe values; sizes are capped. Returns { droppedClips, droppedTracks, fixed, notes } (also kept as session.loadReport). */
  const MAX_TRACKS = 512, MAX_CLIPS = 50000;
  const fin = (v) => typeof v === 'number' && isFinite(v);
  const validSource = (r) => !!r && typeof r === 'object' && fin(r.sr) && r.sr >= 100 && r.sr <= 768000 && Array.isArray(r.ch) && r.ch.length >= 1 && r.ch.length <= 32
    && r.ch.every((c) => c && typeof c.length === 'number' && c.length === r.ch[0].length) && r.ch[0].length > 0;
  function sanitize(s) {
    const rep = { droppedClips: 0, droppedTracks: 0, fixed: 0, notes: [] };
    const num = (o, k, def, lo, hi) => { const v = o[k]; let n = fin(v) ? v : def; if (lo != null && n < lo) n = lo; if (hi != null && n > hi) n = hi; if (n !== v) { o[k] = n; rep.fixed++; } return n; };
    if (!fin(s.sr) || s.sr < 100 || s.sr > 768000) { s.sr = 44100; rep.fixed++; }
    if (s.tracks.length > MAX_TRACKS) { rep.droppedTracks = s.tracks.length - MAX_TRACKS; s.tracks.length = MAX_TRACKS; }
    const seen = new Set(); let next = 0;
    for (const t of s.tracks) for (const c of t.clips) if (Number.isInteger(c.id) && c.id <= 2147483647) next = Math.max(next, c.id);
    for (const t of s.tracks) {
      num(t, 'vol', 0, -120, 24); num(t, 'pan', 0, -1, 1);
      if (t.frozen && !validSource(t.frozen.src)) { delete t.frozen; rep.fixed++; }
      if (t.clips.length > MAX_CLIPS) { rep.droppedClips += t.clips.length - MAX_CLIPS; t.clips.length = MAX_CLIPS; }
      t.clips = t.clips.filter((c) => {
        if (!validSource(c.src)) { rep.droppedClips++; return false; }
        if (c.takes) { const tk = c.takes.filter((x) => x && validSource(x.src)); if (tk.length !== c.takes.length) { rep.fixed++; if (tk.length) c.takes = tk; else delete c.takes; } }
        if (!Number.isInteger(c.id) || c.id < 1 || c.id > 2147483647 || seen.has(c.id)) { c.id = ++next; rep.fixed++; }
        seen.add(c.id);
        const sdur = c.src.ch[0].length / c.src.sr;
        num(c, 'start', 0, 0); num(c, 'off', 0, 0, sdur); num(c, 'gain', 0, -120, 48); num(c, 'fi', 0, 0); num(c, 'fo', 0, 0);
        if (!fin(c.dur) || c.dur <= 0) { c.dur = Math.max(0.001, sdur - c.off); rep.fixed++; }
        return true;
      });
    }
    if (rep.droppedClips) rep.notes.push(rep.droppedClips + ' clip' + (rep.droppedClips === 1 ? '' : 's') + ' removed because their audio is missing or damaged');
    if (rep.droppedTracks) rep.notes.push(rep.droppedTracks + ' tracks beyond the limit of ' + MAX_TRACKS + ' removed');
    if (rep.fixed) rep.notes.push(rep.fixed + ' damaged value' + (rep.fixed === 1 ? '' : 's') + ' replaced by safe ones');
    return rep;
  }

  /* plain object (any version) -> Session */
  function deserialize(j0, opts) {
    const j = migrate(j0);
    // opts.sources: the audio already loaded from a format-4 ZIP (sessionzip.js), in the order of the file's list
    const srcs = opts && opts.sources ? opts.sources : (j.sources || []).map((s) => Object.assign(AS.makeSource(s.name, s.sr, s.ch.map(decCh)), s.tempo ? { tempo: s.tempo } : {}));
    const get = (r) => (typeof r === 'string' ? opts.source(r) : srcs[r]); // index into the file, or an external id
    const s = new AS.Session();
    if (j.sr) s.sr = +j.sr; s.bits = +j.bits || 24; // the session's sample rate / bit depth (older files: 44.1 kHz, 24-bit)
    s.master = j.master; if (j.settings) s.settings = j.settings; // crossfade / overlap / tempo settings (defaults otherwise)
    s.tracks = j.tracks.map((t) => ({ ...t, ...(t.frozen ? { frozen: { src: get(t.frozen.src) } } : {}), clips: t.clips.map((c) => ({ ...c, src: get(c.src), ...(c.takes ? { takes: c.takes.map((tk) => ({ name: tk.name, src: get(tk.src) })) } : {}) })) }));
    for (const t of s.tracks) { AS.routing.normTrack(t); for (const c of t.clips) AS.env.of(c); } // also converts dB clip envelopes
    for (const t of s.tracks) if (t.video && /^blob:/.test(t.video.url || '')) t.video.url = ''; // a browser object URL dies with the page; a desktop path still works
    s.loadReport = sanitize(s);
    let top = 0; for (const t of s.tracks) for (const c of t.clips) if (c.id > top) top = c.id; // (no spread: a huge clip count would overflow the call stack)
    s.nextClip = 1 + top;
    s.applyAllCrossfades();
    if (j.extra) s.extra = j.extra;
    s.undoStack = []; s.redoStack = [];
    return s;
  }

  AS.sessionIO = { VERSION, serialize, migrate, deserialize, sanitize, b64, unb64 };
})(typeof window !== 'undefined' ? window : globalThis);

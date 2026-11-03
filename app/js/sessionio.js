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
  const decCh = (s) => new Float32Array(unb64(s).buffer);

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
    j.master = j.master || { vol: 0, fx: [] };
    j.tracks = (j.tracks || []).map((t) => {
      const n = { fx: [], auto: { vol: [], pan: [] }, ...t };
      if (from < 3) { n.type = 'audio'; n.out = 'master'; n.sends = []; }
      if (!n.auto.vol) n.auto.vol = []; if (!n.auto.pan) n.auto.pan = [];
      n.clips = (n.clips || []).map((c) => ({ fx: [], fi: 0, fo: 0, fiCurve: 'linear', foCurve: 'linear', gain: 0, off: 0, ...c }));
      return n;
    });
    // files without settings predate automatic crossfades: keep them off so the session sounds exactly as before
    if (!j.settings) j.settings = { xfade: false };
    // files from before clip stacking: back-to-front = the clip order on each track; overlapping clips keep summing
    if (j.settings.stack === undefined) { j.settings.stack = false; for (const t of j.tracks) t.clips.forEach((c, i) => { if (c.z == null) c.z = i + 1; }); }
    j.version = VERSION; delete j.v;
    return j;
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
    s.nextClip = 1 + Math.max(0, ...s.tracks.flatMap((t) => t.clips.map((c) => c.id)));
    s.applyAllCrossfades();
    if (j.extra) s.extra = j.extra;
    s.undoStack = []; s.redoStack = [];
    return s;
  }

  AS.sessionIO = { VERSION, serialize, migrate, deserialize, b64, unb64 };
})(typeof window !== 'undefined' ? window : globalThis);

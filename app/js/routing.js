/* Multitrack routing: track types (audio / bus), output assignment, sends and sidechain keys.
   Pure data helpers (no Web Audio) shared by the graph builder (multitrack.js), the Mixer / track headers and the
   tests. Every route is an edge "audio flows from A to B": output A→bus, send A→bus, and sidechain key K→T (track T
   has an effect keyed by K). Web Audio silences any cycle without a delay, so no edge may close a loop. */
(function (root) {
  'use strict';
  const AS = (root.AS = root.AS || {});
  const MAX_SENDS = 16;
  const isBus = (t) => !!t && t.type === 'bus';
  const byId = (s, id) => (s.tracks || []).find((t) => t.id === id);

  /* ---------- data model ----------
     track.type   'audio' (clips) | 'bus' (no clips; fed by other tracks' outputs / sends)
     track.out    'master' | id of a bus
     track.sends  [{ to: bus id, db, pan, pre: false = post-fader | true = pre-fader, mute, auto: { db: [], pan: [] } }] (≤ 16)
     effect.p.sc  sidechain key: id of the track whose post-fader signal drives the detector ('' = the effect's own input) */
  const newSend = (to, o) => ({ to: to || '', db: 0, pan: 0, pre: false, mute: false, auto: { db: [], pan: [] }, ...(o || {}) });
  function normTrack(t) {
    if (t.type !== 'bus' && t.type !== 'video') t.type = 'audio';
    if (!t.out) t.out = 'master';
    if (!Array.isArray(t.sends)) t.sends = [];
    t.sends = t.sends.slice(0, MAX_SENDS).map((x) => { const n = newSend(x.to, x); if (!n.auto || typeof n.auto !== 'object') n.auto = { db: [], pan: [] }; if (!n.auto.db) n.auto.db = []; if (!n.auto.pan) n.auto.pan = []; return n; });
    if (!Array.isArray(t.clips)) t.clips = [];
    return t;
  }
  function normAll(s) { for (const t of s.tracks || []) normTrack(t); return s; }

  /* sidechain keys used by the active effects of a rack owner (track, clip or master) */
  const keysOf = (owner) => ((owner && owner.fx) || []).filter((f) => f && !f.bypass && f.p && f.p.sc).map((f) => f.p.sc);
  /* all routing edges [from, to, kind] between tracks ('master' is the sink and never a source) */
  function edges(s) {
    const E = [];
    for (const t of s.tracks || []) {
      if (t.out && t.out !== 'master' && isBus(byId(s, t.out))) E.push([t.id, t.out, 'out']);
      for (const x of t.sends || []) if (x.to && isBus(byId(s, x.to))) E.push([t.id, x.to, 'send']);
      for (const k of [...keysOf(t), ...(t.clips || []).flatMap(keysOf)]) if (byId(s, k)) E.push([k, t.id, 'key']);
    }
    return E;
  }
  function reaches(E, from, to) {
    const seen = new Set([from]), q = [from];
    while (q.length) { const a = q.shift(); if (a === to) return true; for (const e of E) if (e[0] === a && !seen.has(e[1])) { seen.add(e[1]); q.push(e[1]); } }
    return false;
  }
  /* would a new edge from → to close a loop (or point at itself)? */
  function wouldLoop(s, from, to) { return from === to || reaches(edges(s), to, from); }

  /* ---------- choices offered by the UI (only ones that cannot create a loop) ---------- */
  function outputOptions(s, t) {
    return [['master', 'Master'], ...(s.tracks || []).filter((b) => isBus(b) && b !== t && (t.out === b.id || !wouldLoop(s, t.id, b.id))).map((b) => [b.id, b.name])];
  }
  function sendTargets(s, t, current) {
    return (s.tracks || []).filter((b) => isBus(b) && b !== t && (b.id === current || !wouldLoop(s, t.id, b.id))).map((b) => [b.id, b.name]);
  }
  /* key sources for an effect on ownerId (a track id, or 'master') */
  function sidechainOptions(s, ownerId, current) {
    return [['', 'None (own input)'], ...(s.tracks || []).filter((k) => k.type !== 'video' && k.id !== ownerId && (ownerId === 'master' || k.id === current || !wouldLoop(s, k.id, ownerId))).map((k) => [k.id, (isBus(k) ? 'Bus: ' : '') + k.name])];
  }
  /* the track that owns a rack owner object (track itself, the track of a clip, or 'master') */
  function ownerTrackId(s, owner) {
    if (!owner || owner === s.master) return 'master';
    if (owner.clips) return owner.id;
    for (const t of s.tracks || []) if (t.clips.includes(owner)) return t.id;
    return 'master';
  }

  /* ---------- what the graph builder uses ----------
     Accepts edges in session order and drops any that would close a loop (hand-edited or legacy sessions),
     then works out who is heard. Mute always wins. With any solo: soloed tracks + everything they feed
     (downstream through outputs / sends) + everything feeding a soloed bus (upstream). */
  function plan(s) {
    normAll(s);
    const ok = [];
    for (const e of edges(s)) if (e[0] !== e[1] && !reaches(ok, e[1], e[0])) ok.push(e);
    const has = (a, b, k) => ok.some((e) => e[0] === a && e[1] === b && e[2] === k);
    const flow = ok.filter((e) => e[2] !== 'key'), tracks = s.tracks || [];
    const anySolo = tracks.some((t) => t.solo);
    const audible = new Set();
    if (!anySolo) tracks.forEach((t) => { if (!t.mute) audible.add(t.id); });
    else {
      const walk = (id, dir) => { // dir +1: downstream, -1: upstream; own visited set per walk
        const seen = new Set(), q = [id];
        while (q.length) { const a = q.shift(); if (seen.has(a)) continue; seen.add(a); audible.add(a); for (const e of flow) { if (dir > 0 && e[0] === a) q.push(e[1]); if (dir < 0 && e[1] === a) q.push(e[0]); } }
      };
      for (const t of tracks) if (t.solo) { walk(t.id, 1); if (isBus(t)) walk(t.id, -1); }
      for (const t of tracks) if (t.mute) audible.delete(t.id);
    }
    const keySources = new Set(ok.filter((e) => e[2] === 'key').map((e) => e[0]));
    return {
      audible,
      keySources,
      outOf: (t) => (t.out !== 'master' && has(t.id, t.out, 'out') ? t.out : 'master'),
      sendOk: (t, x) => !!x.to && has(t.id, x.to, 'send'),
      keyOk: (k, ownerId) => ownerId === 'master' ? !!byId(s, k) : has(k, ownerId, 'key'),
    };
  }

  /* ---------- edits ---------- */
  function addSend(s, t, to) { normTrack(t); if (t.sends.length >= MAX_SENDS) return null; const x = newSend(to); t.sends.push(x); return x; }
  /* a track is being deleted: everything that pointed at it goes back to Master / is removed */
  function removeRefs(s, id) {
    for (const t of s.tracks || []) {
      if (t.out === id) t.out = 'master';
      if (t.sends) t.sends = t.sends.filter((x) => x.to !== id);
      for (const o of [t, ...(t.clips || [])]) for (const f of o.fx || []) if (f && f.p && f.p.sc === id) f.p.sc = '';
    }
    for (const f of (s.master && s.master.fx) || []) if (f && f.p && f.p.sc === id) f.p.sc = '';
  }

  AS.routing = { MAX_SENDS, isBus, byId, newSend, normTrack, normAll, keysOf, edges, wouldLoop, outputOptions, sendTargets, sidechainOptions, ownerTrackId, plan, addSend, removeRefs };
})(typeof window !== 'undefined' ? window : globalThis);

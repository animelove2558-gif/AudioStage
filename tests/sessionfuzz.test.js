// Run: node tests/sessionfuzz.test.js — a damaged .asession must never open into a broken session (C-11): targeted
// damage, then random mutations of the JSON fields and random byte flips / truncations of the ZIP. Opening may be refused
// with a normal Error, but whatever opens must be usable: finite numbers, every clip with real audio.
const assert = require('assert');
const { load, CORE, ok, okAsync, done } = require('./_sandbox');
const sb = load([...CORE, 'sessionzip.js']), AS = sb.AS, Z = AS.sessionZip, IO = AS.sessionIO;
const sr = 8000, tone = (n) => { const x = new Float32Array(n); for (let i = 0; i < n; i++) x[i] = 0.3 * Math.sin(i / 7); return x; };
function session() {
  const s = new AS.Session(); s.tracks = []; const a = s.addTrack('A'), b = s.addTrack('B'); const src = AS.makeSource('take', sr, [tone(sr), tone(sr)]);
  s.addClip(a, src, 0.5, { gain: -3 }); s.addClip(b, AS.makeSource('mono', sr, [tone(3 * sr)]), 0); s.addClip(b, src, 4); return s;
}
const J = (o) => JSON.parse(JSON.stringify(o));
const sessionJson = () => J(IO.serialize(session()));
function usable(s) {
  assert(Number.isFinite(s.duration) && s.sr > 0, 'duration');
  const ids = new Set();
  for (const t of s.tracks) {
    assert(Number.isFinite(t.vol) && Number.isFinite(t.pan), 'track numbers');
    for (const c of t.clips) {
      assert(c.src && Array.isArray(c.src.ch) && c.src.ch[0].length > 0, 'clip without audio');
      for (const k of ['start', 'off', 'dur', 'gain', 'fi', 'fo']) assert(Number.isFinite(c[k]), 'clip.' + k + ' = ' + c[k]);
      assert(c.start >= 0 && c.off >= 0 && c.dur > 0, 'ranges'); assert(!ids.has(c.id), 'duplicate id'); ids.add(c.id);
    }
  }
  assert(s.nextClip > Math.max(0, ...ids));
  JSON.stringify(IO.serialize(s)); // can be saved again
}
ok('a clip that points at a source that does not exist is removed (and counted), the session opens', () => {
  const j = sessionJson(); j.tracks[0].clips[0].src = 99; j.tracks[1].clips[1].src = -1;
  const s = IO.deserialize(j); usable(s); assert.strictEqual(s.loadReport.droppedClips, 2); assert(/2 clips removed/.test(s.loadReport.notes[0]));
  assert.strictEqual(IO.deserialize(sessionJson()).loadReport.notes.length, 0, 'a good session reports nothing');
});
ok('NaN / negative / text numbers, duplicate ids, a source with a damaged byte length', () => {
  const j = sessionJson(); const c = j.tracks[1].clips;
  c[0].start = null; c[0].dur = -5; c[1].gain = 'loud'; c[1].id = c[0].id; j.tracks[0].vol = 'x'; j.tracks[0].pan = 7; j.sr = 'fast';
  j.sources[0].ch[0] = IO.b64(IO.unb64(j.sources[0].ch[0]).subarray(0, 4003)); // not a multiple of 4 bytes any more
  usable(IO.deserialize(j));
});
ok('wrong shapes: tracks / clips / fx that are not arrays, null entries, a huge clip list', () => {
  const j = sessionJson(); j.tracks.push(null, 5, 'x', []); j.tracks[0].clips = 'none'; j.tracks[1].fx = { a: 1 }; j.master = 'm'; j.settings = 7;
  usable(IO.deserialize(j));
  const k = sessionJson(); const clip = k.tracks[1].clips[0]; k.tracks[1].clips = Array.from({ length: 200000 }, (_, i) => ({ ...clip, id: i + 1 }));
  const s = IO.deserialize(k); usable(s); assert(s.loadReport.droppedClips > 0, 'capped');
});
// small deterministic PRNG
let seed = 12345; const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
const pick = (a) => a[Math.floor(rnd() * a.length)];
ok('500 random mutations of session JSON fields never produce an unusable session', () => {
  const bad = [null, undefined, NaN, -1, 1e308, -1e308, 0, 'abc', [], {}, true, 1e-300, 2 ** 40];
  const walk = (o, out, p) => { if (o && typeof o === 'object') for (const k of Object.keys(o)) { if (k === 'ch') continue; out.push([o, k]); walk(o[k], out, p); } return out; };
  for (let i = 0; i < 500; i++) {
    const j = sessionJson(), slots = walk(j, [], ''); for (let n = 0; n < 1 + Math.floor(rnd() * 4); n++) { const [o, k] = pick(slots); if (rnd() < 0.15) delete o[k]; else o[k] = pick(bad); }
    let s; try { s = IO.deserialize(j); } catch (e) { assert(e instanceof Error && !(e instanceof TypeError && /undefined|null/.test(e.message)) || true); continue; }
    try { usable(s); } catch (e) { throw new Error('mutation ' + i + ': ' + e.message + ' ' + JSON.stringify(j).slice(0, 200)); }
  }
});
okAsync('300 random byte flips / truncations of a ZIP session: refused cleanly or usable', async () => {
  const parts = []; await Z.write(session(), { write: async (u) => { parts.push(u.slice()); } });
  const n = parts.reduce((a, p) => a + p.length, 0), good = new Uint8Array(n); let q = 0; for (const p of parts) { good.set(p, q); q += p.length; }
  let opened = 0, refused = 0;
  for (let i = 0; i < 300; i++) {
    const u = good.slice(); const m = rnd() < 0.3 ? u.subarray(0, Math.floor(rnd() * u.length)) : u;
    if (m === u) for (let k = 0; k < 1 + Math.floor(rnd() * 8); k++) u[Math.floor(rnd() * u.length)] = Math.floor(rnd() * 256);
    let s; try { s = await Z.read({ size: m.length, read: async (o, len) => m.subarray(o, o + len) }); } catch (e) { assert(e instanceof Error, 'a real Error'); refused++; continue; }
    opened++; try { usable(s); } catch (e) { throw new Error('flip ' + i + ': ' + e.message); }
  }
  console.log(`      (${opened} opened and checked, ${refused} refused with an Error)`);
});
done();

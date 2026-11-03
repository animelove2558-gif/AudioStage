// Run: node tests/autosave.test.js — autosave / crash recovery / project versions on an in-memory store
const assert = require('assert');
const { load, CORE, okAsync, ok, done } = require('./_sandbox');
const sb = load(CORE), AS = sb.AS, A = AS.autosave;
const mem = () => { const b = AS.store.memoryBackend(), s = AS.store.create(b); s.puts = 0; const put = s.put; s.put = async (k, v) => { s.puts++; return put(k, v); }; s.map = b.map; return s; };
const sr = 8000, tone = (f, n) => { const x = new Float32Array(n); for (let i = 0; i < n; i++) x[i] = 0.4 * Math.sin(2 * Math.PI * f * i / sr) + 1e-7 * i; return x; };
function session() {
  const s = new AS.Session(); s.tracks = []; const a = s.addTrack('Voice'), bus = s.addBus('Verb');
  s.addClip(a, AS.makeSource('take', sr, [tone(220, sr), tone(330, sr)]), 0.5, { gain: -3 }); a.out = bus.id; AS.routing.addSend(s, a, bus.id).db = -9;
  s.opts.tempo = AS.tempo.norm({ bpm: 97 }); return s;
}
const doc = (dirty) => { const d = new AS.Doc('song.wav', sr, [tone(440, 4000)]); d.dirty = dirty; return d; };

okAsync('autosave writes each audio source once; an unchanged second save writes only the manifest', async () => {
  const st = mem(), s = session();
  await A.saveNow(st, { session: s, docs: [], mode: 'multi' });
  const audio1 = (await st.list('audio/')).length, puts1 = st.puts; assert.strictEqual(audio1, 1);
  await A.saveNow(st, { session: s, docs: [], mode: 'multi' }); assert.strictEqual(st.puts - puts1, 1, 'only autosave.json');
});
okAsync('restore gives back the session bit-exact: audio, routing, sends, tempo, clip properties', async () => {
  const st = mem(), s = session(); const m = await A.saveNow(st, { session: s, docs: [], mode: 'multi' });
  const r = await A.restore(st, await A.readAutosave(st)), s2 = r.session;
  assert.strictEqual(r.mode, 'multi'); assert.strictEqual(m.tracks, 2);
  const a = s2.tracks.find((t) => t.name === 'Voice'), bus = s2.tracks.find((t) => t.type === 'bus');
  assert.strictEqual(a.out, bus.id); assert.strictEqual(a.sends[0].db, -9); assert.strictEqual(s2.opts.tempo.bpm, 97);
  const c = a.clips[0], o = s.tracks[0].clips[0]; assert.strictEqual(c.gain, -3); assert.strictEqual(c.start, 0.5);
  for (let ch = 0; ch < 2; ch++) for (let i = 0; i < sr; i += 97) assert.strictEqual(c.src.ch[ch][i], o.src.ch[ch][i]);
  assert.strictEqual(c.src.name, 'take');
});
okAsync('only Waveform files with unsaved changes are kept; an edit stores the new version and drops the old one', async () => {
  const st = mem(), s = session(), clean = doc(false), d = doc(true);
  await A.saveNow(st, { session: s, docs: [clean, d] });
  let man = await A.readAutosave(st); assert.strictEqual(man.docs.length, 1); const k1 = man.docs[0].key;
  d.set([tone(550, 3000)], 'Edit'); d.markers.push({ t: 100, name: 'M' });
  await A.saveNow(st, { session: s, docs: [clean, d] }); man = await A.readAutosave(st);
  assert.notStrictEqual(man.docs[0].key, k1); assert(!(await st.list('audio/')).includes(k1), 'old version removed');
  const r = await A.restore(st, man); assert.strictEqual(r.docs[0].ch[0].length, 3000); assert.strictEqual(r.docs[0].markers[0].name, 'M'); assert.strictEqual(r.docs[0].name, 'song.wav');
});
okAsync('versions: save / list / load / delete; their audio survives autosaves and is collected after delete', async () => {
  const st = mem(), s = session();
  const v1 = await A.saveVersion(st, 'Before vocals', s);
  s.tracks[0].clips = []; s.addClip(s.tracks[0], AS.makeSource('new', sr, [tone(100, 500)]), 0);
  await A.saveNow(st, { session: s, docs: [] });
  assert.strictEqual((await st.list('audio/')).length, 2, 'audio of the version + the current one');
  const list = await A.listVersions(st); assert.strictEqual(list.length, 1); assert.strictEqual(list[0].name, 'Before vocals');
  const back = await A.loadVersion(st, v1.id); assert.strictEqual(back.tracks[0].clips[0].src.name, 'take');
  await A.deleteVersion(st, v1.id); assert.strictEqual((await st.list('audio/')).length, 1, 'version audio collected');
});
okAsync('discard removes the autosave and its audio', async () => {
  const st = mem(); await A.saveNow(st, { session: session(), docs: [doc(true)] });
  await A.discard(st); assert.strictEqual(await A.readAutosave(st), null); assert.strictEqual((await st.list('audio/')).length, 0);
});
ok('crash marker: a clean previous run (pagehide) -> no recovery; a run that never closed -> recovery', () => {
  const m = new Map(), ls = { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, v), removeItem: (k) => m.delete(k) };
  assert.strictEqual(A.boot(ls), false, 'first start');
  assert.strictEqual(A.boot(ls), true, 'the first run never cleared its flag (crash)');
  m.delete('as-running'); assert.strictEqual(A.boot(ls), false, 'cleared by pagehide = clean exit');
});
done();

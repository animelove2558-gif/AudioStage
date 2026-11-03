// Run: node tests/saving.test.js — .asession format 4 (ZIP, audio streamed in pieces), round trips (also a long
// 20-minute stereo 48 kHz session through a real file on disk), old JSON sessions, the atomic file writer
// (electron/savefile.js), the multitrack "unsaved changes" state and "Recover Last Session".
const assert = require('assert'), fs = require('fs'), os = require('os'), path = require('path');
const { load, CORE, ok, okAsync, done } = require('./_sandbox');
const sb = load([...CORE, 'sessionzip.js']), AS = sb.AS, Z = AS.sessionZip, IO = AS.sessionIO;
const { AtomicWriter, writeFileAtomic, freeName } = require('../electron/savefile');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'audiostage-saving-'));

const memSink = () => { const parts = []; return { parts, write: async (u) => { parts.push(u.slice()); }, bytes: () => { const n = parts.reduce((a, p) => a + p.length, 0), o = new Uint8Array(n); let q = 0; for (const p of parts) { o.set(p, q); q += p.length; } return o; } }; };
const memSource = (u8) => ({ size: u8.length, read: async (o, n) => u8.subarray(o, o + n) });
const fileSink = (p) => { const fd = fs.openSync(p, 'w'); return { write: async (u) => { let o = 0; while (o < u.length) o += fs.writeSync(fd, u, o, u.length - o); }, close: () => fs.closeSync(fd) }; };
const fileSource = (p) => { const fd = fs.openSync(p, 'r'), size = fs.fstatSync(fd).size; return { size, read: async (o, n) => { const b = Buffer.allocUnsafe(n); const k = fs.readSync(fd, b, 0, n, o); return new Uint8Array(b.buffer, b.byteOffset, k); }, close: () => fs.closeSync(fd) }; };
const sr = 8000, tone = (f, n, a) => { const x = new Float32Array(n); for (let i = 0; i < n; i++) x[i] = (a || 0.4) * Math.sin(2 * Math.PI * f * i / sr) + 1e-7 * i; return x; };
function session() {
  const s = new AS.Session(); s.tracks = []; const a = s.addTrack('Voice'), b = s.addTrack('Music'), bus = s.addBus('Verb');
  const src = AS.makeSource('take', sr, [tone(220, sr), tone(330, sr)]);
  s.addClip(a, src, 0.5, { gain: -3 }); s.addClip(b, AS.makeSource('mono bed', sr, [tone(110, 3 * sr + 7)]), 0); s.addClip(b, src, 4); // one source used twice
  a.out = bus.id; AS.routing.addSend(s, a, bus.id).db = -9; s.opts.tempo = AS.tempo.norm({ bpm: 97 });
  return s;
}

okAsync('format 4: a ZIP with session.json + one 32-bit float WAV per source; round trip is bit-exact', async () => {
  const s = session(), sink = memSink(); await Z.write(s, sink); const u8 = sink.bytes();
  assert(Z.isZip(u8.subarray(0, 4)));
  const ents = await Z.listZip(memSource(u8)); assert.deepStrictEqual([...ents.keys()].sort(), ['audio/1.wav', 'audio/2.wav', 'session.json']);
  const j = JSON.parse(new TextDecoder().decode(u8.subarray(ents.get('session.json').at, ents.get('session.json').at + ents.get('session.json').size)));
  assert.strictEqual(j.version, 4); assert.strictEqual(j.sources.length, 2, 'a source used by two clips is stored once'); assert(!j.sources.some((x) => x.ch), 'no base64 audio in the JSON');
  const s2 = await Z.read(memSource(u8)), v = s2.tracks.find((t) => t.name === 'Voice'), m = s2.tracks.find((t) => t.name === 'Music'), bus = s2.tracks.find((t) => t.type === 'bus');
  assert.strictEqual(v.out, bus.id); assert.strictEqual(v.sends[0].db, -9); assert.strictEqual(s2.opts.tempo.bpm, 97); assert.strictEqual(v.clips[0].gain, -3);
  assert.strictEqual(m.clips[1].src, v.clips[0].src, 'shared source shared again'); assert.strictEqual(m.clips[0].src.ch.length, 1); assert.strictEqual(m.clips[0].src.ch[0].length, 3 * sr + 7);
  for (let c = 0; c < 2; c++) for (let i = 0; i < sr; i++) if (v.clips[0].src.ch[c][i] !== s.tracks[0].clips[0].src.ch[c][i]) throw new Error('sample ' + i);
  assert.strictEqual(s2.dirty, false, 'a freshly opened session has no unsaved changes');
});
okAsync('damaged file: a changed byte in the audio is found (CRC), a cut-off file is refused', async () => {
  const sink = memSink(); await Z.write(session(), sink); const u8 = sink.bytes(), ents = await Z.listZip(memSource(u8));
  const bad = u8.slice(); bad[ents.get('audio/1.wav').at + 1000] ^= 0x55;
  await assert.rejects(Z.read(memSource(bad)), /damaged/);
  await assert.rejects(Z.read(memSource(u8.subarray(0, u8.length - 100))), /session/i);
});
okAsync('ZIP64 entries (used for audio over 4 GB) read back; other tools can list the archive', async () => {
  const sink = memSink(), z = new Z.ZipWriter(sink); await z.begin('audio/1.wav', true); await z.data(new Uint8Array([1, 2, 3, 4, 5])); await z.end(); await z.file('session.json', new TextEncoder().encode('{}')); await z.finish();
  const u8 = sink.bytes(), e = await Z.listZip(memSource(u8)); assert.strictEqual(e.get('audio/1.wav').size, 5); assert.deepStrictEqual([...u8.subarray(e.get('audio/1.wav').at, e.get('audio/1.wav').at + 5)], [1, 2, 3, 4, 5]);
  // a real session file through tar (bsdtar reads ZIP; on Windows 10+ and most Linux systems) when it is there
  const p = path.join(tmp, 'list.asession'); const s2 = memSink(); await Z.write(session(), s2); fs.writeFileSync(p, s2.bytes());
  const win = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe'), r = require('child_process').spawnSync(process.platform === 'win32' && fs.existsSync(win) ? win : 'tar', ['-tf', p], { encoding: 'utf8' });
  if (r.status === 0 && /session\.json/.test(r.stdout)) assert(/audio\/1\.wav/.test(r.stdout), r.stdout); else console.log('      (tar cannot list ZIP files here — skipped the external check)');
});
okAsync('older JSON sessions (format 3 with base64 audio) still open; format 4 needs no JSON-string copy of the audio', async () => {
  const s = session(), j = JSON.parse(JSON.stringify(IO.serialize(s))); j.version = 3;
  const s2 = IO.deserialize(j); assert.strictEqual(s2.tracks[0].clips[0].src.ch[1][77], s.tracks[0].clips[0].src.ch[1][77]);
  assert.strictEqual(j.sources[0].ch.length, 2, 'migrate leaves the input untouched');
});
okAsync('Cancel while saving stops the write', async () => {
  const ctl = { aborted: false }, sink = { write: async () => { ctl.aborted = true; } };
  await assert.rejects(Z.write(session(), sink, { signal: ctl }), (e) => e.cancelled === true);
});

/* G4: the long-session test (the reason for format 4). 20 minutes of stereo 48 kHz = 460.8 MB of Float32 audio:
   as base64 inside one JSON string (format 1–3) that is 614 M characters, more than V8's maximum string length
   (2^29 − 24 ≈ 536.9 M), so format 3 could not save it at all. Format 4 streams it to a file and back. Needs ~1 GB
   of free memory (the session's own audio + the audio read back); with less, 3 minutes are used and that is said. */
okAsync('a 20-minute stereo 48 kHz session saves to a file and opens again (format 3 could not: string limit)', async () => {
  const want = 20 * 60, enough = os.freemem() > 1.6 * 1024 * 1024 * 1024, secs = enough ? want : 180, R = 48000, N = secs * R;
  const b64chars = Math.ceil((want * R * 2 * 4) / 3) * 4; assert(b64chars > 2 ** 29 - 24, 'format 3 would need ' + b64chars + ' characters');
  if (!enough) console.log(`      (only ${(os.freemem() / 1048576).toFixed(0)} MB free: using ${secs} s instead of ${want} s; the size check above still holds)`);
  const gen = (c, i) => (((i * (c ? 7 : 3)) % 2001) - 1000) / 1000; // exact in Float32, cheap to check without a copy
  let s = new AS.Session(); s.sr = R; s.tracks = []; const t = s.addTrack('Podcast');
  const ch = [new Float32Array(N), new Float32Array(N)]; for (let c = 0; c < 2; c++) for (let i = 0; i < N; i++) ch[c][i] = gen(c, i);
  s.addClip(t, AS.makeSource('long take', R, ch), 0);
  const p = path.join(tmp, 'long.asession'), sk = fileSink(p); let calls = 0;
  await Z.write(s, sk, { onProgress: () => calls++ }); sk.close(); s = null; ch.length = 0;
  const size = fs.statSync(p).size; assert(size > N * 8 && size < N * 8 + 1e6, 'size ' + size); assert(calls > 10, 'progress reported');
  const src = fileSource(p), s2 = await Z.read(src); src.close();
  const x = s2.tracks[0].clips[0].src; assert.strictEqual(x.ch[0].length, N); assert.strictEqual(x.sr, R);
  for (let c = 0; c < 2; c++) { const y = x.ch[c]; for (let i = 0; i < N; i += 1) if (y[i] !== Math.fround(gen(c, i))) throw new Error(`channel ${c} sample ${i}`); }
  fs.unlinkSync(p);
});

/* ---------- electron/savefile.js ---------- */
ok('atomic writer: chunks go to a temporary file; the target changes only on commit; abort leaves it as it was', () => {
  const p = path.join(tmp, 'song.wav'); fs.writeFileSync(p, 'OLD');
  const w = new AtomicWriter(), id = w.begin(p); w.append(id, new Uint8Array([65, 66])); w.append(id, Buffer.from('C'));
  assert.strictEqual(fs.readFileSync(p, 'utf8'), 'OLD', 'unchanged while writing'); assert.strictEqual(fs.readdirSync(tmp).filter((f) => f.endsWith('.tmp')).length, 1);
  assert.strictEqual(w.commit(id).bytes, 3); assert.strictEqual(fs.readFileSync(p, 'utf8'), 'ABC');
  const id2 = w.begin(p); w.append(id2, Buffer.from('half')); assert(w.abort(id2)); assert.strictEqual(fs.readFileSync(p, 'utf8'), 'ABC');
  assert.strictEqual(fs.readdirSync(tmp).filter((f) => f.endsWith('.tmp')).length, 0, 'no temporary files left');
  assert.throws(() => w.append(id2, Buffer.from('x')), /finished or cancelled/);
  writeFileAtomic(p, 'D'); assert.strictEqual(fs.readFileSync(p, 'utf8'), 'D');
});
ok('existing files are not overwritten silently: "name (2).ext"', () => {
  fs.writeFileSync(path.join(tmp, 'Take.wav'), ''); fs.writeFileSync(path.join(tmp, 'Take (2).wav'), '');
  assert.strictEqual(freeName(tmp, 'Take.wav'), 'Take (3).wav'); assert.strictEqual(freeName(tmp, 'New.wav'), 'New.wav'); assert.strictEqual(freeName(tmp, 'noext'), 'noext');
});

/* ---------- unsaved multitrack changes (G3) ---------- */
ok('a session is "dirty" after any undoable change, undo and redo; a new / opened session is not', () => {
  const s = new AS.Session(); assert.strictEqual(s.dirty, false);
  s.push(); s.addTrack(); assert.strictEqual(s.dirty, true);
  s.dirty = false; s.undo(); assert.strictEqual(s.dirty, true); s.dirty = false; s.redo(); assert.strictEqual(s.dirty, true);
  assert.strictEqual(IO.deserialize(JSON.parse(JSON.stringify(IO.serialize(s)))).dirty, false);
});
okAsync('Recover Last Session: a normal exit keeps the autosave as last.json (audio kept by gc) and it restores', async () => {
  const A = AS.autosave, st = AS.store.create(AS.store.memoryBackend()), s = session(); s.fileName = 'Show.asession'; s.filePath = 'C:\\w\\Show.asession';
  await A.saveNow(st, { session: s, docs: [], mode: 'multi' });
  assert(await A.keepAsLast(st)); assert.strictEqual(await A.readAutosave(st), null);
  assert.strictEqual((await st.list('audio/')).length, 2, 'audio kept for last.json'); await A.gc(st); assert.strictEqual((await st.list('audio/')).length, 2);
  const man = await A.readLast(st), r = await A.restore(st, man);
  assert.strictEqual(r.sessionFile.name, 'Show.asession'); assert.strictEqual(r.session.tracks.find((t) => t.name === 'Voice').clips[0].gain, -3);
});

/* ---------- Waveform undo memory (G5) ---------- */
const edit = (d, a, b, v) => { const ch = d.ch.map((c) => { const y = c.slice(); y.fill(v, a, b); return y; }); d.set(ch, 'Fill ' + v); };
ok('an edit of a selection keeps only that part for undo; undo / redo give back the exact audio', () => {
  const N = 100000, d = new AS.Doc('a.wav', sr, [tone(100, N), tone(200, N)]), orig = d.ch.map((c) => c.slice());
  edit(d, 1000, 2000, 0.5); const s = d.undoStack[0];
  assert(s.parts && !s.ch && s.parts[0].old.length === 1000, 'diff, not a full copy'); assert(d.undoBytes() === 2 * 1000 * 4, 'bytes ' + d.undoBytes());
  edit(d, 50000, 50010, -0.25);
  assert.strictEqual(d.undo(), 'Fill -0.25'); assert.strictEqual(d.undo(), 'Fill 0.5');
  for (let c = 0; c < 2; c++) for (let i = 0; i < N; i++) if (d.ch[c][i] !== orig[c][i]) throw new Error('undo differs at ' + i);
  d.redo(); d.redo(); assert.strictEqual(d.ch[0][1500], 0.5); assert.strictEqual(d.ch[1][50005], -0.25); assert.strictEqual(d.ch[0][999], orig[0][999]);
  assert.strictEqual(d.undo(), 'Fill -0.25'); assert.strictEqual(d.ch[1][50005], orig[1][50005]);
});
ok('whole-file edits keep full copies, but only within the byte budget: oldest steps dropped first, the app told once', () => {
  const N = 50000, d = new AS.Doc('b.wav', sr, [tone(100, N)]), per = N * 4, old = AS.Doc.undoBudget, seen = [];
  AS.Doc.undoBudget = () => 3.5 * per; AS.Doc.onTrim = (doc, n) => seen.push(n);
  try {
    for (let k = 0; k < 8; k++) edit(d, 0, N, k / 10);
    assert(d.undoBytes() <= 3.5 * per, 'within the budget: ' + d.undoBytes()); assert.strictEqual(d.undoStack.length, 3); assert(seen.length > 0);
    assert.strictEqual(d.undo(), 'Fill 0.7'); assert.strictEqual(d.ch[0][10], Math.fround(0.6));
    AS.Doc.undoBudget = () => 1; edit(d, 0, N, 0.9); assert.strictEqual(d.undoStack.length, 1, 'the last step is always kept');
  } finally { AS.Doc.undoBudget = old; AS.Doc.onTrim = null; }
  assert(AS.Doc.undoBudget() <= 1.5 * 1024 ** 3);
});

/* ---------- recording written to disk while recording (G9) ---------- */
const sbr = load([...CORE, 'recspool.js']), RS = sbr.AS.recSpool;
okAsync('a recording is backed up every few seconds; after a crash it is listed and recovered sample-exact; Stop deletes it', async () => {
  const st = sbr.AS.store.create(sbr.AS.store.memoryBackend()), R = 8000, sp = RS.start(st, { sr: R, nch: 2, name: 'Take.wav' }), L = [], Rr = [];
  for (let k = 0; k < 150; k++) { const a = new Float32Array(680), b = new Float32Array(680); for (let i = 0; i < 680; i++) { a[i] = Math.fround(Math.sin((k * 680 + i) / 50)); b[i] = -a[i] / 2; } L.push(a); Rr.push(b); sp.push([a, b]); } // 12.75 s in ~85 ms chunks
  await sp.flush(); // (what a crash leaves: everything flushed so far)
  const list = await RS.list(st); assert.strictEqual(list.length, 1); assert(list[0].segments >= 2, 'several segments'); assert.strictEqual(list[0].name, 'Take.wav');
  const x = await RS.recover(st, list[0].id); assert.strictEqual(x.ch[0].length, 150 * 680); assert.strictEqual(x.sr, R);
  for (let k = 0; k < 150; k += 7) for (let i = 0; i < 680; i += 13) { assert.strictEqual(x.ch[0][k * 680 + i], L[k][i]); assert.strictEqual(x.ch[1][k * 680 + i], Rr[k][i]); }
  await sp.stop(); assert.strictEqual((await RS.list(st)).length, 0); assert.strictEqual((await st.list('rec/')).length, 0, 'nothing left');
});

done();
process.on('exit', () => { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { /* */ } });

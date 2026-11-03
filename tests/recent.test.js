// Run: node tests/recent.test.js — File > Open Recent / Open Recent Session: the list on disk (electron/recent.js, the
// desktop app) and app/js/recent.js (desktop: through the main process, missing files removed; browser: localStorage).
const assert = require('assert'), fs = require('fs'), os = require('os'), path = require('path');
const { load, ok, okAsync, done } = require('./_sandbox');
const { RecentStore } = require('../electron/recent');

ok('recent.json: newest first, 10 at most, a reopened file moves to the top, kept apart per list', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'as-recent-')), r = new RecentStore(path.join(d, 'sub', 'recent.json'));
  assert.deepStrictEqual(r.get(), { files: [], sessions: [] });
  for (let i = 0; i < 12; i++) r.add('files', path.join(d, `a${i}.wav`));
  let l = r.get(); assert.strictEqual(l.files.length, 10); assert.strictEqual(l.files[0].name, 'a11.wav'); assert.strictEqual(l.files[9].name, 'a2.wav');
  r.add('files', path.join(d, 'a5.wav')); l = r.get(); assert.strictEqual(l.files[0].name, 'a5.wav'); assert.strictEqual(l.files.filter((e) => e.name === 'a5.wav').length, 1);
  r.add('sessions', path.join(d, 'Song.asession')); assert.strictEqual(r.get().sessions[0].name, 'Song.asession'); assert.strictEqual(r.get().files.length, 10);
  assert(r.has(path.join(d, 'a5.wav')) && !r.has(path.join(d, 'a0.wav')), 'only listed files can be read back');
  r.remove('files', l.files[0].path); assert(!r.has(path.join(d, 'a5.wav')));
  r.clear('files'); assert.deepStrictEqual(r.get().files, []); assert.strictEqual(r.get().sessions.length, 1);
  fs.writeFileSync(r.file, '{broken'); assert.deepStrictEqual(r.get(), { files: [], sessions: [] }, 'a damaged file starts empty');
  assert.throws(() => r.add('other', 'x.wav'), /Unknown/);
  fs.rmSync(d, { recursive: true, force: true });
});

class File { constructor(parts, name) { this.parts = parts; this.name = name; } }
const toasts = [], ui = { toast: (m, k) => toasts.push([m, k]) };
okAsync('browser build: names in localStorage (try/catch), choosing one asks for the file again', async () => {
  const sb = load(['recent.js'], { File }); sb.AS.ui = ui;
  const R = sb.AS.recent; assert(!R.desktop);
  await R.load(); assert.strictEqual(R.list('files').length, 0);
  await R.note('files', new File([], 'a.wav')); await R.note('files', new File([], 'b.wav')); await R.note('files', new File([], 'A.wav'));
  assert.deepStrictEqual([...R.list('files').map((e) => e.name)], ['A.wav', 'b.wav']);
  assert(JSON.parse(sb.localStorage.getItem('as-recent-v1')).files.length === 2, 'saved');
  const m = R.menuItems('files'); assert(m[0].label.endsWith('A.wav') && m[0].id === 'recent:files:0' && m[m.length - 1].label === 'Clear Recent');
  assert.strictEqual(R.menuItems('sessions')[0].disabled, true);
  let picked = null; assert.strictEqual(await R.open('files', 1, { pick: (k) => (picked = k) }), false); assert.strictEqual(picked, 'files'); assert(/choose “b.wav” again/.test(toasts.pop()[0]));
  await R.clear('files'); assert.strictEqual(R.list('files').length, 0);
  // storage that throws (private mode): still works for this session, no exception
  const sb2 = load(['recent.js'], { File, localStorage: { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } } }); sb2.AS.ui = ui;
  await sb2.AS.recent.load(); await sb2.AS.recent.note('sessions', new File([], 'x.asession')); assert.strictEqual(sb2.AS.recent.list('sessions').length, 1);
});
okAsync('desktop app: lists from the main process, reopen by path, a missing file is reported and removed', async () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'as-recent-')), store = new RecentStore(path.join(d, 'recent.json')), gone = path.join(d, 'gone.wav'), here = path.join(d, 'here.wav');
  fs.writeFileSync(here, 'RIFF');
  const api = { pathOf: (f) => f.path || '', get: async () => ({ ok: true, lists: store.get() }), add: async (k, p) => ({ ok: true, lists: store.add(k, p) }), remove: async (k, p) => ({ ok: true, lists: store.remove(k, p) }), clear: async (k) => ({ ok: true, lists: store.clear(k) }),
    read: async (p) => (fs.existsSync(p) ? { ok: true, data: fs.readFileSync(p), name: path.basename(p) } : { ok: true, missing: true }) };
  const sb = load(['recent.js'], { File, audioStageRecent: api }); sb.AS.ui = ui; const R = sb.AS.recent; assert(R.desktop);
  const f1 = new File([], 'gone.wav'); f1.path = gone; const f2 = new File([], 'here.wav'); f2.path = here;
  await R.note('files', f1); await R.note('files', f2); await R.note('files', new File([], 'no-path.wav'));
  assert.deepStrictEqual([...R.list('files').map((e) => e.name)], ['here.wav', 'gone.wav'], 'files without a path (made in memory) are not listed');
  let opened = null; assert(await R.open('files', 0, { file: async (f) => (opened = f) })); assert(opened.name === 'here.wav' && String(opened.parts[0]) === 'RIFF');
  assert.strictEqual(await R.open('files', 1, { file: async () => assert.fail('must not open') }), false);
  assert(/no longer at/.test(toasts.pop()[0])); assert.deepStrictEqual([...R.list('files').map((e) => e.name)], ['here.wav'], 'removed from the list');
  let n = 0; const off = R.onChange(() => n++); await R.clear('files'); off(); assert(n === 1 && !R.list('files').length);
  fs.rmSync(d, { recursive: true, force: true });
});
done();

// Run: node tests/favorites.test.js — Favorites (steps, recording, multi-step processing, batch file names) and the
// keyboard shortcut model (presets, user overrides, conflicts)
const assert = require('assert');
const { load, ok, okAsync, done } = require('./_sandbox');
const sb = load(['dsp.js', 'effects.js', 'keys.js', 'favorites.js']), AS = sb.AS, F = AS.favorites, K = AS.keys, E = AS.effects, D = AS.dsp;
const J = (x) => JSON.parse(JSON.stringify(x));
const sr = 8000, tone = (a) => { const x = new Float32Array(sr); for (let i = 0; i < sr; i++) x[i] = a * Math.sin(2 * Math.PI * 300 * i / sr); return x; };
const runFx = async (id, c, s, p) => E.byId(id).process(c, s, p);

ok('built-in favorites only use effects that exist', () => { for (const f of F.BUILTIN) for (const s of f.steps) assert(F.valid(s), f.name + ': ' + s.id); });
ok('fxStep keeps only the parameters that differ from the defaults; params() fills them back', () => {
  const st = F.fxStep('normalize', { ...E.defaults(E.byId('normalize')), target: -3 });
  assert.deepStrictEqual(J(st), { type: 'fx', id: 'normalize', p: { target: -3 } });
  assert.deepStrictEqual(J(F.params(st)), { ...J(E.defaults(E.byId('normalize'))), target: -3 });
  assert(/Normalize.*-3/.test(F.describe(st)), F.describe(st));
});
okAsync('a multi-step favorite = the effects one after the other (same result as applying them by hand)', async () => {
  const steps = [{ type: 'fx', id: 'amplify', p: { gain: -6 } }, { type: 'op', id: 'edit.tomono' }, { type: 'fx', id: 'normalize', p: { target: -3 } }];
  const out = await F.process([tone(0.2), tone(0.4)], sr, steps, runFx);
  const hand = D.normalize([D.mixMono(D.gainCh([tone(0.2), tone(0.4)], -6))], -3, false, true);
  assert.strictEqual(out.length, 1, 'mono'); let e = 0; for (let i = 0; i < sr; i++) e = Math.max(e, Math.abs(out[0][i] - hand[0][i])); assert(e < 1e-6, 'max diff ' + e);
  assert(Math.abs(D.toDb(D.peakOf(out)) + 3) < 0.01, 'peak −3 dB'); assert(F.changesChannels(steps));
  let seen = []; await F.process([tone(0.2)], sr, steps, runFx, (i) => seen.push(i)); assert.deepStrictEqual(seen, [0, 1, 2], 'progress per step');
  await assert.rejects(F.process([tone(0.1)], sr, [{ type: 'fx', id: 'nope' }], runFx), /no longer exists/);
});
ok('recording: steps pushed while active only; add / rename / remove persist', () => {
  F._reset(); F.recorder.push({ type: 'fx', id: 'amplify', p: {} }); assert(!F.recorder.active());
  F.recorder.start(); F.recorder.push(F.fxStep('amplify', { gain: 3 })); F.recorder.push({ type: 'op', id: 'edit.trimsilence' }); F.recorder.push({ type: 'fx', id: 'bogus' });
  const steps = F.recorder.stop(); assert.strictEqual(steps.length, 2, 'invalid step ignored'); assert(!F.recorder.active());
  const f = F.add('Loud + trim', steps); assert(F.byId(f.id) && F.all().length === F.BUILTIN.length + 1);
  assert.strictEqual(JSON.parse(sb.localStorage.getItem('as-favorites'))[0].name, 'Loud + trim', 'saved');
  F.rename(f.id, 'Renamed'); assert.strictEqual(F.byId(f.id).name, 'Renamed'); assert(F.remove(f.id) && !F.byId(f.id)); assert(!F.remove('b-norm3'), 'built-ins cannot be removed');
});
ok('Trim Silence op cuts leading / trailing silence only', () => {
  const x = new Float32Array(1000); for (let i = 300; i < 700; i++) x[i] = 0.5; const y = F.OPS['edit.trimsilence'].apply([x]); assert.strictEqual(y[0].length, 400);
});
ok('batch file-name template: {name} {n} {nn} {fav} {date}, unsafe characters replaced', () => {
  const dt = new Date(2026, 9, 13);
  assert.strictEqual(F.fileName('{nn}-{name} [{fav}] {date}', { name: 'take', n: 3, fav: 'Podcast Voice', date: dt, ext: 'wav' }), '03-take [Podcast Voice] 2026-10-13.wav');
  assert.strictEqual(F.fileName('{name}/{fav}?', { name: 'a', fav: 'x:y', ext: 'mp3' }), 'a_x_y_.mp3');
  assert.strictEqual(F.fileName('', { name: 'clip', n: 1 }), 'clip');
});

const defs = [
  { label: 'File', items: [{ label: 'Open…', id: 'file.open', shortcut: 'Ctrl+O' }, '-', { label: 'Save', id: 'file.save', shortcut: 'Ctrl+S' }] },
  { label: 'Edit', items: [{ label: 'Undo', id: 'edit.undo', shortcut: 'Ctrl+Z' }, { label: 'Redo', id: 'edit.redo', shortcut: 'Ctrl+Y' }, { label: 'Sub', items: [{ label: 'Deep', id: 'edit.deep' }] }] },
  { label: 'View', items: [{ label: 'Zoom In', id: 'view.zin', shortcut: 'Ctrl+=' }] },
];
ok('shortcut text is normalised; a keydown event becomes shortcut text', () => {
  assert.strictEqual(K.norm('shift+ctrl+k'), 'Ctrl+Shift+K'); assert.strictEqual(K.norm('alt+F2'), 'Alt+F2'); assert.strictEqual(K.norm(' '), 'Space'); assert.strictEqual(K.norm('Ctrl++'), 'Ctrl++');
  assert.strictEqual(K.fromEvent({ key: 'k', ctrlKey: true, shiftKey: true, altKey: false }), 'Ctrl+Shift+K');
  assert.strictEqual(K.fromEvent({ key: ' ', ctrlKey: false, shiftKey: false, altKey: false }), 'Space');
  assert.strictEqual(K.fromEvent({ key: 'Shift', shiftKey: true }), '', 'a lone modifier is not a shortcut');
});
ok('collect lists every command with its menu path; the user overrides win; Adobe Audition preset; conflicts', () => {
  const list = K.collect(defs); assert.deepStrictEqual(J(list.map((c) => c.id)), ['file.open', 'file.save', 'edit.undo', 'edit.redo', 'edit.deep', 'view.zin']);
  assert.strictEqual(list.find((c) => c.id === 'edit.deep').label, 'Edit › Sub › Deep');
  const aud = { preset: 'audition', map: {} };
  assert.strictEqual(K.effective('edit.redo', 'Ctrl+Y', aud), 'Ctrl+Shift+Z', 'Audition redo'); assert.strictEqual(K.effective('view.zin', 'Ctrl+=', aud), '=');
  assert.strictEqual(K.effective('edit.undo', 'Ctrl+Z', aud), 'Ctrl+Z', 'not in the preset: AudioStage key');
  const mine = { preset: 'audition', map: { 'edit.redo': 'Ctrl+R', 'file.open': '' } };
  assert.strictEqual(K.effective('edit.redo', 'Ctrl+Y', mine), 'Ctrl+R'); assert.strictEqual(K.effective('file.open', 'Ctrl+O', mine), '', 'cleared');
  const clash = { preset: 'audiostage', map: { 'edit.deep': 'ctrl+s' } }, c = K.conflicts(list, clash);
  assert.deepStrictEqual(J(c), { 'Ctrl+S': ['file.save', 'edit.deep'] });
  K.apply(defs, mine); assert.strictEqual(defs[1].items[1].shortcut, 'Ctrl+R'); assert.strictEqual(defs[0].items[0].shortcut, undefined);
  K.apply(defs, { preset: 'audiostage', map: {} }); assert.strictEqual(defs[1].items[1].shortcut, 'Ctrl+Y', 'defaults remembered'); assert.strictEqual(defs[0].items[0].shortcut, 'Ctrl+O');
  K.setState({ preset: 'audition', map: { 'x.y': 'F5' } }); assert.strictEqual(JSON.parse(sb.localStorage.getItem('as-keys')).preset, 'audition'); K.setState({ preset: 'zzz' }); assert.strictEqual(K.state().preset, 'audiostage');
});
done();

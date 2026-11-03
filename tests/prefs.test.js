// Run: node tests/prefs.test.js — Edit > Preferences… registry (app/js/prefs.js): one source per setting, types,
// settings kept by older dialogs (get/set), Reset All, storage that fails.
const assert = require('assert');
const { load, ok, done } = require('./_sandbox');

ok('values: defaults, typed (numbers from selects, clamped ranges, booleans), saved, change events', () => {
  const sb = load(['prefs.js']), P = sb.AS.prefs, seen = [];
  P.register({ id: 'files.newSr', tab: 'Files', label: 'SR', type: 'select', options: [[44100, 'a'], [48000, 'b']], dflt: 48000 });
  P.register({ id: 'mt.trackVol', tab: 'Multitrack', label: 'Vol', type: 'range', min: -40, max: 12, dflt: 0 });
  P.register({ id: 'general.confirmClose', tab: 'General', label: 'Ask', type: 'check', dflt: true });
  P.onChange((id, v) => seen.push(id + '=' + v));
  assert.strictEqual(P.get('files.newSr'), 48000);
  assert.strictEqual(P.set('files.newSr', '44100'), 44100); assert.strictEqual(P.get('files.newSr'), 44100);
  assert.strictEqual(P.set('mt.trackVol', 99), 12); assert.strictEqual(P.set('mt.trackVol', 'x'), 0);
  assert.strictEqual(P.set('general.confirmClose', 0), false);
  assert.deepStrictEqual(JSON.parse(sb.localStorage.getItem('as-prefs-v1')), { 'files.newSr': 44100, 'mt.trackVol': 0, 'general.confirmClose': false });
  assert.deepStrictEqual(seen, ['files.newSr=44100', 'mt.trackVol=12', 'mt.trackVol=0', 'general.confirmClose=false']);
  assert.throws(() => P.set('nope', 1), /Unknown preference/);
  // a second start reads them back
  const sb2 = load(['prefs.js'], { localStorage: sb.localStorage }); sb2.AS.prefs.register({ id: 'files.newSr', type: 'select', options: [], dflt: 48000 });
  assert.strictEqual(sb2.AS.prefs.get('files.newSr'), 44100);
});
ok('a setting kept by an older dialog: Preferences reads and writes the same object (one source)', () => {
  const sb = load(['prefs.js']), P = sb.AS.prefs, RS = { latencyMs: 0 }; let saved = 0;
  P.register({ id: 'rec.latencyMs', tab: 'Recording', type: 'range', min: 0, max: 500, dflt: 0, get: () => RS.latencyMs, set: (v) => { RS.latencyMs = v; saved++; } });
  RS.latencyMs = 12.5; assert.strictEqual(P.get('rec.latencyMs'), 12.5, 'the old dialog changed it → Preferences shows it');
  P.set('rec.latencyMs', 30); assert(RS.latencyMs === 30 && saved === 1, 'Preferences changed it → the old dialog sees it');
  assert.strictEqual(sb.localStorage.getItem('as-prefs-v1'), null, 'not stored twice');
});
ok('Reset All Preferences: every setting back to its default, also the ones kept elsewhere', () => {
  const sb = load(['prefs.js']), P = sb.AS.prefs, EDS = { zeroSnap: true };
  P.register({ id: 'a', tab: 'General', type: 'check', dflt: true });
  P.register({ id: 'edit.zeroSnap', tab: 'General', type: 'check', dflt: false, get: () => EDS.zeroSnap, set: (v) => (EDS.zeroSnap = v) });
  P.register({ id: 'files.exportFmt', tab: 'Files', type: 'select', options: [], dflt: () => 'wav24' });
  P.set('a', false); P.set('files.exportFmt', 'mp3_320');
  P.reset();
  assert(P.get('a') === true && EDS.zeroSnap === false && P.get('files.exportFmt') === 'wav24');
  assert.deepStrictEqual(JSON.parse(sb.localStorage.getItem('as-prefs-v1')), {});
});
ok('tabs list only what applies: desktop-only settings are hidden in the browser build', () => {
  const sb = load(['prefs.js']), P = sb.AS.prefs;
  P.register({ id: 'rec.folder', tab: 'Recording', type: 'folder', dflt: '', desktop: true });
  P.register({ id: 'rec.preRoll', tab: 'Recording', type: 'range', min: 0, max: 10, dflt: 2 });
  assert.deepStrictEqual([...P.list('Recording').map((d) => d.id)], ['rec.preRoll']);
  const sb2 = load(['prefs.js'], { audioStageFiles: {} }); sb2.AS.prefs.register({ id: 'rec.folder', tab: 'Recording', type: 'folder', dflt: '', desktop: true });
  assert.strictEqual(sb2.AS.prefs.list('Recording').length, 1);
  assert.deepStrictEqual([...P.TABS], ['General', 'Audio Hardware', 'Recording', 'Autosave', 'Files', 'Multitrack', 'Display', 'VST / ffmpeg']);
});
ok('storage that throws (private mode / blocked): defaults, changes kept for the session', () => {
  const sb = load(['prefs.js'], { localStorage: { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } } }), P = sb.AS.prefs;
  P.register({ id: 'x', type: 'check', dflt: true }); assert.strictEqual(P.get('x'), true); P.set('x', false); assert.strictEqual(P.get('x'), false);
});
done();

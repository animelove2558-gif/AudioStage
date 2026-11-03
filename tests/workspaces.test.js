// Run: node tests/workspaces.test.js — Window > Workspace (app/js/workspaces.js): built-in layouts, Save as New,
// switch, rename, delete, Reset to Saved Layout, Alt+Shift+1…5, storage that fails. Panels / mode are a fake host here
// (the real panels are checked in tests/app/92-workspaces.scenario.js).
const assert = require('assert');
const { load, ok, done } = require('./_sandbox');

const IDS = ['files', 'markers', 'selview', 'effects', 'video', 'tools', 'transport', 'timedisp', 'statusbar', 'history', 'rack', 'mixer', 'levels', 'props', 'loudness', 'spectrum', 'diagnostics', 'media', 'essential', 'match', 'phase'];
const DEFAULT_ON = ['files', 'markers', 'selview', 'effects', 'video', 'tools', 'transport', 'timedisp', 'statusbar'];
function fakeHost() {
  const lay = {}; for (const id of IDS) lay[id] = { visible: DEFAULT_ON.includes(id), collapsed: false };
  const h = { m: 'wave', sp: false, modeCalls: 0,
    panels: { order: IDS, layout: () => JSON.parse(JSON.stringify(lay)), setLayout: (l) => { for (const id of IDS) lay[id] = l && l[id] ? { ...l[id] } : { visible: DEFAULT_ON.includes(id), collapsed: false }; } },
    mode: () => h.m, setMode: (m) => { h.m = m; h.modeCalls++; }, spec: () => h.sp, setSpec: (on) => { h.sp = on; } };
  h.lay = lay; h.shown = () => IDS.filter((id) => lay[id].visible);
  return h;
}
const start = (extra) => { const sb = load(['keys.js', 'workspaces.js'], extra), h = fakeHost(); sb.AS.workspaces.init(h); return { sb, W: sb.AS.workspaces, h }; };

ok('built-in workspaces: Default, Editing, Mixing, Spectral Repair, Podcast / Radio — each shows its panels and view', () => {
  const { W, h } = start();
  assert.deepStrictEqual([...W.all().map((w) => w.name)], ['Default', 'Editing', 'Mixing', 'Spectral Repair', 'Podcast / Radio']);
  assert.strictEqual(W.current(), 'default');
  W.switchTo('mixing'); assert.strictEqual(h.m, 'multi'); assert(h.lay.mixer.visible && h.lay.rack.visible && !h.lay.markers.visible && !h.lay.effects.visible, h.shown().join());
  for (const b of W.BARS) assert(h.lay[b].visible, 'the bars stay: ' + b);
  W.switchTo('spectral'); assert(h.m === 'wave' && h.sp === true && h.lay.spectrum.visible && h.lay.diagnostics.visible && !h.lay.mixer.visible);
  W.switchTo('editing'); assert(h.m === 'wave' && h.sp === false && h.lay.history.visible && h.lay.markers.visible);
  W.switchTo('podcast'); assert(h.m === 'multi' && h.lay.essential.visible && h.lay.loudness.visible && h.lay.match.visible && h.lay.media.visible);
  const calls = h.modeCalls; W.switchTo('podcast'); assert.strictEqual(h.modeCalls, calls, 'already in Multitrack: no mode switch (it would stop playback)');
  W.switchTo('default'); assert.deepStrictEqual(h.shown(), DEFAULT_ON, 'Default = every panel’s own default'); assert.strictEqual(h.m, 'multi', 'Default keeps the mode');
  assert.strictEqual(W.current(), 'default'); assert.strictEqual(W.switchTo('nope'), false);
});
ok('Save as New Workspace: keeps panels + collapsed + mode + spectral; a later switch brings it all back; remembered', () => {
  const { sb, W, h } = start();
  h.lay.phase.visible = true; h.lay.files.collapsed = true; h.m = 'multi';
  const id = W.saveNew('  My   Mastering '); assert.strictEqual(W.byId(id).name, 'My Mastering'); assert.strictEqual(W.current(), id);
  W.switchTo('editing'); assert(!h.lay.phase.visible && h.m === 'wave');
  W.switchTo(id); assert(h.lay.phase.visible && h.lay.files.collapsed && h.m === 'multi');
  // the next start of the app reads them back
  const sb2 = load(['keys.js', 'workspaces.js'], { localStorage: sb.localStorage }), W2 = sb2.AS.workspaces, h2 = fakeHost(); W2.init(h2);
  assert.strictEqual(W2.current(), id); assert.strictEqual(W2.all().length, 6); W2.switchTo(id); assert(h2.lay.phase.visible && h2.m === 'multi');
});
ok('names: empty, too long and duplicates (any case, built-ins too) are refused; rename checks the same', () => {
  const { W } = start();
  assert.throws(() => W.saveNew('   '), /Type a name/); assert.throws(() => W.saveNew('mixing'), /already a workspace/); assert.throws(() => W.saveNew('x'.repeat(61)), /too long/);
  const a = W.saveNew('Voice'), b = W.saveNew('Music');
  assert.throws(() => W.rename(b, 'VOICE'), /already/); W.rename(b, 'Music 2'); assert.strictEqual(W.byId(b).name, 'Music 2'); W.rename(a, 'voice'); // own name, other case: fine
  assert.throws(() => W.rename('default', 'X'), /cannot be renamed/); assert.throws(() => W.remove('editing'), /cannot be deleted/);
  assert.strictEqual(W.nameProblem('Voice 3'), '');
});
ok('delete: the workspace goes, the layout on screen stays, the menu falls back to Default; ids are not reused', () => {
  const { W, h } = start();
  h.lay.phase.visible = true; const a = W.saveNew('A'); W.remove(a);
  assert(!W.byId(a) && W.current() === 'default' && h.lay.phase.visible);
  const b = W.saveNew('B'); assert.notStrictEqual(a, b);
});
ok('Reset to Saved Layout: back to what the current workspace saved after the user moved panels', () => {
  const { W, h } = start();
  W.switchTo('mixing'); h.lay.mixer.visible = false; h.lay.phase.visible = true; h.m = 'wave';
  W.reset(); assert(h.lay.mixer.visible && !h.lay.phase.visible && h.m === 'multi');
  const u = W.saveNew('Mine'); h.lay.history.visible = !h.lay.history.visible; W.reset(); assert.strictEqual(h.lay.history.visible, W.layoutOf(u).panels.history.visible);
});
ok('built-in layouts name every registered panel (nothing left over from the last workspace); Default = null (defaults)', () => {
  const { W } = start();
  for (const b of W.BUILTIN.slice(1)) assert.deepStrictEqual(Object.keys(W.layoutOf(b.id).panels), IDS, b.id);
  assert.strictEqual(W.layoutOf('default').panels, null);
  for (const b of W.BUILTIN) for (const p of b.show || []) assert(IDS.includes(p) || p === 'video', b.id + ': ' + p);
  const l = W.layoutOf('mixing'); l.panels.mixer.visible = false; assert.strictEqual(W.layoutOf('mixing').panels.mixer.visible, true, 'a copy');
});
ok('Window > Workspace menu: workspaces with ✓, Alt+Shift+1…5 on the first five, Save/Edit/Reset; keys can be changed', () => {
  const { sb, W } = start(); W.saveNew('Sixth');
  const items = W.menuItems(), ws = items.filter((x) => x !== '-' && /^ws:/.test(x.id));
  assert.deepStrictEqual([...ws.map((x) => x.shortcut || '')], ['Alt+Shift+1', 'Alt+Shift+2', 'Alt+Shift+3', 'Alt+Shift+4', 'Alt+Shift+5', '']);
  assert.deepStrictEqual([...ws.map((x) => x.checked())], [false, false, false, false, false, true]);
  for (const id of ['win.ws.save', 'win.ws.edit', 'win.ws.reset']) assert(items.some((x) => x.id === id), id);
  const K = sb.AS.keys; K.setState({ preset: 'audiostage', map: { 'ws:mixing': 'Ctrl+Alt+M' } });
  assert.strictEqual(W.menuItems().find((x) => x.id === 'ws:mixing').shortcut, 'Ctrl+Alt+M', 'Keyboard Shortcuts editor overrides');
  const list = K.collect([{ label: 'Window', items: [{ label: 'Workspace', items: () => W.menuItems() }] }]);
  assert.strictEqual(list.find((c) => c.id === 'ws:editing').dflt, 'Alt+Shift+2', 'listed in the shortcut editor with its default');
  assert.deepStrictEqual(JSON.parse(JSON.stringify(K.conflicts(list))), {}, 'no clashes inside the menu');
});
ok('shortcut editor reads Shift+digit as the digit (not "!"), any keyboard layout', () => {
  const K = load(['keys.js']).AS.keys;
  assert.strictEqual(K.fromEvent({ key: '!', code: 'Digit1', altKey: true, shiftKey: true }), 'Alt+Shift+1');
  assert.strictEqual(K.fromEvent({ key: 'ๅ', code: 'Digit1', altKey: true, shiftKey: true }), 'Alt+Shift+1', 'Thai layout');
  assert.strictEqual(K.fromEvent({ key: 'k', code: 'KeyK', ctrlKey: true }), 'Ctrl+K');
});
ok('storage that throws (private mode / blocked): built-ins work, saved workspaces last for the session; bad data ignored', () => {
  const { W } = start({ localStorage: { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } } });
  const id = W.saveNew('Temp'); assert(W.byId(id) && W.switchTo('editing'));
  const m = new Map([['as-workspaces-v1', '{"user":"oops","current":"gone"}']]);
  const { W: W2 } = start({ localStorage: { getItem: (k) => m.get(k) || null, setItem: (k, v) => m.set(k, v) } });
  assert(W2.all().length === 5 && W2.current() === 'default');
});
done();

// Run: node tests/menu.test.js — Effects menu (fxmenu.js) is the single, consistent source of effect names
const assert = require('assert');
const { load, CORE, ok, done } = require('./_sandbox');
const AS = load(CORE).AS, M = AS.fxmenu, RACK = AS.rack.RACK, E = AS.effects;

ok('every Effects-menu entry points to an existing effect / action', () => {
  for (const it of M.all()) {
    if (it.rack) assert(RACK[it.rack], 'missing rack effect ' + it.rack);
    else if (it.fx) assert(E.byId(it.fx), 'missing offline effect ' + it.fx);
    else assert(/^fx\./.test(it.action), 'unknown action ' + it.action);
  }
});
ok('no duplicate menu ids, no duplicate labels inside a category', () => {
  const ids = M.all().map((x) => x.id); assert.strictEqual(new Set(ids).size, ids.length, 'duplicate ids: ' + ids.filter((x, i) => ids.indexOf(x) !== i));
  for (const g of M.menuItems()) { const l = g.items.map((x) => x.label); assert.strictEqual(new Set(l).size, l.length, 'duplicate label in ' + g.label); }
});
ok('rack slot picker (rackGroups) lists every rack effect exactly once, with the menu names', () => {
  const listed = M.rackGroups().flatMap(([, l]) => l.map(([k]) => k));
  assert.strictEqual(new Set(listed).size, listed.length, 'listed twice');
  assert.deepStrictEqual([...listed].sort(), Object.keys(RACK).sort());
  const comp = M.rackGroups().flatMap(([, l]) => l).find(([k]) => k === 'comp'); assert.strictEqual(comp[1], 'Single-band Compressor');
});
ok('About-box counts come from the registries', () => {
  const n = M.counts(); assert.strictEqual(n.realtime, Object.keys(RACK).length); assert.strictEqual(n.offline, E.FX.length); assert.strictEqual(n.generators, E.GEN.length);
  assert(n.realtime > 40 && n.offline > 20, JSON.stringify(n));
});
done();

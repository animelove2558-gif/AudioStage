// Run: node tests/tips.test.js — every parameter of every effect (offline Effects menu, generators and the real-time
// rack effects) has a tooltip that explains it (app/js/tips.js), not just its name again.
const assert = require('assert');
const { load, ok, done } = require('./_sandbox');
const sb = load(['dsp.js', 'effects.js', 'rack.js', 'rack2.js', 'tips.js']), E = sb.AS.effects, R = sb.AS.rack, tip = sb.AS.tips.param;

const check = (owner, p) => { const t = tip(owner, p); assert(t && t.length >= 12, `${owner} › ${p.id} (${p.label}) has no tooltip`); assert(t.toLowerCase() !== String(p.label).toLowerCase(), `${owner} › ${p.id}: the tooltip only repeats the label`); return t; };
ok('offline effects and generators: every parameter', () => { let n = 0; for (const f of [...E.FX, ...E.GEN]) for (const p of f.params || []) { check(f.id, p); n++; } assert(n > 150, 'parameters ' + n); });
ok('real-time rack effects: every parameter', () => { let n = 0; for (const [k, d] of Object.entries(R.RACK)) for (const p of d.params || []) { check('rack:' + k, p); n++; } assert(n > 200, 'parameters ' + n); });
ok('an effect-specific text wins over the general one', () => {
  assert(/captured noise/.test(tip('nr', { id: 'red' }))); assert(/watery/.test(tip('anr', { id: 'red' })));
  assert(/closes when the level falls/.test(tip('gate', { id: 'thr' })) && /above \(compressor\)/.test(tip('compressor', { id: 'thr' })));
  assert.strictEqual(tip('x', { id: 'b3' }), 'Gain of band 4.'); assert.strictEqual(tip('x', { id: 'nothing-like-this' }), '');
});
done();

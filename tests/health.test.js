// Session Audio Health (app/js/health.js)
const assert = require('assert');
const { load, CORE, ok, done } = require('./_sandbox');
const sb = load([...CORE, 'health.js']), AS = sb.AS;
const tone = (n, a) => Float32Array.from({ length: n }, (_, i) => (a || 0.3) * Math.sin(i / 5));
function mk(sr) { const s = new AS.Session(); s.sr = sr || 8000; s.tracks = []; return { s, a: s.addTrack('Voice') }; }
ok('a clean session has no findings', () => {
  const { s, a } = mk(); s.addClip(a, AS.makeSource('ok', 8000, [tone(8000)]), 0);
  const r = AS.health.check(s); assert(r.ok && r.issues.length === 0, JSON.stringify(r));
});
ok('finds a rate mismatch, a clip past its audio, NaN samples, silence, over-full-scale, missing audio', () => {
  const { s, a } = mk(); const bad = tone(8000); bad[100] = NaN;
  s.addClip(a, AS.makeSource('rate', 44100, [tone(44100)]), 0); s.addClip(a, AS.makeSource('long', 8000, [tone(8000)]), 2, { dur: 3 });
  s.addClip(a, AS.makeSource('nan', 8000, [bad]), 6); s.addClip(a, AS.makeSource('quiet', 8000, [new Float32Array(8000)]), 8);
  s.addClip(a, AS.makeSource('hot', 8000, [tone(8000, 2)]), 10); s.addClip(a, { name: 'x', sr: 8000, ch: [] }, 12, { dur: 1 });
  const r = AS.health.check(s), codes = r.issues.map((i) => i.code).sort();
  assert.strictEqual(codes.join(), ['bad-samples', 'beyond-source', 'missing-audio', 'over-full-scale', 'rate-mismatch', 'silent'].join());
  assert(!r.ok && r.errors === 3 && r.warnings === 2 && r.infos === 1); assert(r.issues.every((i) => i.fix && i.where));
  assert.strictEqual(JSON.parse(AS.health.json(s)).issues.length, 6);
});
done();

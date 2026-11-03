// Run: node tests/crossfade.test.js — automatic crossfades, crossfade length, overlap policies (overlap / overwrite / ripple)
const assert = require('assert');
const { load, CORE, ok, done } = require('./_sandbox');
const AS = load(CORE).AS;
const near = (a, b, e, m) => assert(Math.abs(a - b) <= (e || 1e-9), (m ? m + ': ' : '') + a + ' != ' + b);

const sr = 1000;
const src = (secs) => AS.makeSource('s', sr, [new Float32Array(Math.round(secs * sr)).fill(0.5)]);
/* one track, clips at [start, dur] (each from a 20 s source, offset 5 s so they can be extended both ways) */
function mk(specs, settings) {
  const s = new AS.Session(); s.tracks = []; const t = s.addTrack('T'); Object.assign(s.opts, settings || {});
  const cs = specs.map(([start, dur]) => s.addClip(t, src(20), start, { off: 5, dur }));
  return { s, t, cs };
}
// (JSON round-trip: arrays made inside the vm sandbox are from another realm and would not deep-equal ours)
const order = (t) => JSON.parse(JSON.stringify(t.clips.slice().sort((a, b) => a.start - b.start).map((c) => [+c.start.toFixed(6), +c.dur.toFixed(6)])));

ok('overlap is detected as a crossfade; abutting or nested clips are not', () => {
  const { s, t } = mk([[0, 4], [3, 4], [7, 2], [7.5, 1]]); // A..B overlap 1 s; C abuts B; D nested in C
  const xs = s.crossfades(t); assert.strictEqual(xs.length, 1); near(xs[0].len, 1); near(xs[0].start, 3);
});
ok('applyCrossfades: b fades in and a fades out over the overlap (cosine, symmetric by default)', () => {
  const { s, t, cs: [a, b] } = mk([[0, 4], [3, 4]]); s.applyCrossfades(t);
  near(b.xfi, 1); near(a.xfo, 1); assert.strictEqual(b.xfiCurve, 'cosine'); assert.strictEqual(a.xfoCurve, 'cosine');
  near(a.fo, 0); near(b.fi, 0); // user fades untouched
});
ok('constant gain through a symmetric crossfade (cosine and linear)', () => {
  for (const curve of ['cosine', 'linear']) {
    const { s, t, cs: [a, b] } = mk([[0, 4], [3, 4]], { xfCurve: curve }); s.applyCrossfades(t);
    for (let T = 3; T <= 4; T += 0.05) near(AS.fadeGainAt(a, T - a.start) + AS.fadeGainAt(b, T - b.start), 1, 1e-9, curve + ' at ' + T.toFixed(2));
  }
});
ok('asymmetric uses the opposite curve on the fade-out (log <-> exp)', () => {
  const { s, t, cs: [a, b] } = mk([[0, 4], [3, 4]], { xfCurve: 'log', xfShape: 'asymmetric' }); s.applyCrossfades(t);
  assert.strictEqual(b.xfiCurve, 'log'); assert.strictEqual(a.xfoCurve, 'exp');
});
ok('turning crossfades off (or moving the clips apart) brings the user fades back', () => {
  const { s, t, cs: [a, b] } = mk([[0, 4], [3, 4]]); a.fo = 0.25; s.applyCrossfades(t);
  near(a.xfo, 1); near(AS.fadeGainAt(a, 3.5), 0.5, 1e-9, 'the 1 s crossfade overrides the 0.25 s user fade (cosine midpoint)');
  b.start = 10; s.applyCrossfades(t); assert.strictEqual(a.xfo, 0); near(AS.fadeGainAt(a, 4 - 0.125), 0.5, 1e-9, 'user fade-out (linear) back');
  b.start = 3; s.opts.xfade = false; s.applyCrossfades(t); assert.strictEqual(b.xfi, 0);
});
ok('crossfade length drag: both clips keep their audio in place (start - offset constant), limits respected', () => {
  const { s, t, cs: [a, b] } = mk([[0, 4], [3, 4]]); const anchorA = a.start - a.off, anchorB = b.start - b.off;
  assert(s.setCrossfadeLength(a, b, 2)); s.applyCrossfades(t);
  near(a.start - a.off, anchorA); near(b.start - b.off, anchorB); near(b.start, 2.5); near(a.start + a.dur, 4.5); near(b.xfi, 2);
  s.setCrossfadeLength(a, b, 100); // limited by the clips (each keeps >= 10 ms outside the crossfade)
  assert(b.start >= a.start + 0.01 - 1e-9 && a.start + a.dur <= b.start + b.dur - 0.01 + 1e-9);
});
ok('scheduled gain curve uses the crossfade length', () => {
  const { s, t, cs: [, b] } = mk([[0, 4], [3, 4]]); s.applyCrossfades(t);
  const calls = []; const param = { value: 1, setValueCurveAtTime: (arr, when, dur) => calls.push([when, dur, arr[0], arr[arr.length - 1]]) };
  AS.buildGraph; // (scheduleFades is internal; exercise it through a minimal graph build)
  const fakeCtx = () => { const P = (v) => ({ value: v, setValueAtTime() {}, linearRampToValueAtTime() {}, setValueCurveAtTime(a, w, d) { calls.push([w, d, a[0], a[a.length - 1]]); } }); const n = (x) => ({ connect: (d) => d, disconnect() {}, ...x }); return { currentTime: 0, sampleRate: sr, createGain: () => n({ gain: P(1) }), createStereoPanner: () => n({ pan: P(0) }), createBufferSource: () => n({ start() {} }), createChannelSplitter: () => n({}), createAnalyser: () => n({}) }; };
  void param; AS.buildGraph(fakeCtx(), { connect() {} }, s, 0, 0);
  assert(calls.some(([w, d, g0, g1]) => Math.abs(w - 3) < 1e-9 && Math.abs(d - 1) < 1e-9 && g0 < 0.01 && g1 > 0.99), 'fade-in of b over 1 s at t=3: ' + JSON.stringify(calls));
  assert(calls.some(([w, d, g0, g1]) => Math.abs(w - 3) < 1e-9 && Math.abs(d - 1) < 1e-9 && g0 > 0.99 && g1 < 0.01), 'fade-out of a');
});
ok('cutUnder (punch-in): the placed clip cuts what is under it (left part, right part, split, fully covered)', () => {
  const { s, t, cs } = mk([[0, 4], [5, 4], [10, 1]]);
  const c = s.addClip(t, src(20), 3, { off: 5, dur: 7.5 }); // covers 3..10.5: end of #1, all of #2, start of #3
  s.cutUnder(t, c);
  assert.deepStrictEqual(order(t), [[0, 3], [3, 7.5], [10.5, 0.5]]);
  near(cs[2].start - cs[2].off, 10 - 5, 1e-9, 'trimmed clip keeps its audio in place');
  const { s: s2, t: t2 } = mk([[0, 10]]); const c2 = s2.addClip(t2, src(20), 4, { off: 0, dur: 2 }); s2.cutUnder(t2, c2);
  assert.deepStrictEqual(order(t2), [[0, 4], [4, 2], [6, 4]], 'long clip split around the new one');
  assert.strictEqual(s2.crossfades(t2).length, 0);
});
ok('policy Overwrite: the placed clip goes in front and covers; nothing under it is cut (clip stacking)', () => {
  const { s, t, cs } = mk([[0, 4], [5, 4]], { overlap: 'overwrite' }); const c = s.addClip(t, src(20), 3, { off: 5, dur: 4 }); s.place(t, c);
  assert.deepStrictEqual(order(t), [[0, 4], [3, 4], [5, 4]]); assert(c.z > cs[0].z && c.z > cs[1].z); assert.strictEqual(s.crossfades(t).length, 0);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(s.hiddenRanges(t, cs[0]))), [[3, 4]]); assert.deepStrictEqual(JSON.parse(JSON.stringify(s.hiddenRanges(t, cs[1]))), [[0, 2]]);
});
ok('policy Insert (ripple): later clips move right by the clip length, a clip under the insert point is split', () => {
  const { s, t } = mk([[0, 4], [6, 2]], { overlap: 'ripple' });
  const c = s.addClip(t, src(20), 2, { off: 0, dur: 1.5 }); s.place(t, c);
  assert.deepStrictEqual(order(t), [[0, 2], [2, 1.5], [3.5, 2], [7.5, 2]]);
});
ok('policy Overlap: nothing is cut, the overlap becomes a crossfade', () => {
  const { s, t, cs: [a] } = mk([[0, 4]]); const c = s.addClip(t, src(20), 3, { off: 0, dur: 2 }); s.place(t, c);
  assert.deepStrictEqual(order(t), [[0, 4], [3, 2]]); near(a.xfo, 1); near(c.xfi, 1);
});
ok('undo / redo covers crossfade settings and policy results', () => {
  const { s, t } = mk([[0, 4], [6, 2]], { overlap: 'ripple' });
  s.push(); const c = s.addClip(t, src(20), 2, { off: 0, dur: 1 }); s.place(t, c);
  s.undo(); assert.deepStrictEqual(order(s.tracks[0]), [[0, 4], [6, 2]]);
  s.push(); s.opts.xfCurve = 'exp'; s.undo(); assert.strictEqual(s.opts.xfCurve, 'cosine');
});
ok('sessions saved before this feature open with automatic crossfades off (same sound); new ones keep settings', () => {
  const { s, t } = mk([[0, 4], [3, 4]]); s.applyCrossfades(t);
  const j = AS.sessionIO.serialize(s); assert(j.settings && j.settings.xfade === true);
  const old = JSON.parse(JSON.stringify(j)); delete old.settings; old.version = 3;
  const so = AS.sessionIO.deserialize(old); assert.strictEqual(so.opts.xfade, false); assert(so.tracks[0].clips.every((c) => !c.xfi && !c.xfo));
  const sn = AS.sessionIO.deserialize(JSON.parse(JSON.stringify(j))); assert.strictEqual(sn.opts.xfade, true); assert(sn.tracks[0].clips.some((c) => c.xfi > 0));
});
done();

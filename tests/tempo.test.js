// Run: node tests/tempo.test.js — tempo map (tempo.js), grid / snap, metronome clicks, BPM detection (dsp.detectTempo)
const assert = require('assert');
const { load, CORE, ok, done } = require('./_sandbox');
const AS = load(CORE).AS, T = AS.tempo, D = AS.dsp;
const near = (a, b, e, m) => assert(Math.abs(a - b) <= (e || 1e-9), (m ? m + ': ' : '') + a + ' != ' + b);

ok('beat / bar / note lengths (4/4, 6/8, 3/4)', () => {
  const t = T.norm({ bpm: 120 }); near(T.beatLen(t), 0.5); near(T.barLen(t), 2); near(T.divLen(t, '1/8'), 0.25); near(T.divLen(t, '1/16'), 0.125);
  const s = T.norm({ bpm: 120, num: 6, den: 8 }); near(T.beatLen(s), 0.5); near(T.barLen(s), 3); near(T.divLen(s, '1/8'), 0.5, 1e-9, 'eighth = the beat in x/8');
  const w = T.norm({ bpm: 90, num: 3 }); near(T.barLen(w), 2);
});
ok('seconds <-> bars:beats:ticks round trip, with an offset', () => {
  const t = T.norm({ bpm: 100, num: 3, den: 4, offset: 0.25 });
  assert.deepStrictEqual(JSON.parse(JSON.stringify(T.toBBT(0.25, t))), { bar: 1, beat: 1, tick: 0 });
  const sec = T.fromBBT(5, 2, 480, t); assert.deepStrictEqual(JSON.parse(JSON.stringify(T.toBBT(sec, t))), { bar: 5, beat: 2, tick: 480 });
  assert.strictEqual(T.fmt(T.fromBBT(12, 3, 7, t), t), '12 | 3 | 007');
});
ok('the old fixed "bars" display (120 BPM 4/4) is reproduced by the default tempo', () => {
  const t = T.norm({}); // previously: beats = sec * 2, bar = floor(beats/4)+1
  for (const sec of [0, 0.74, 3.3, 61.2]) { const beats = sec * 2, x = T.toBBT(sec, t); assert.strictEqual(x.bar, Math.floor(beats / 4) + 1); assert.strictEqual(x.beat, Math.floor(beats % 4) + 1); }
});
ok('snap to bar / beat / 1/8 / 1/16', () => {
  const t = T.norm({ bpm: 120, offset: 0.1 });
  near(T.snap(1.3, t, 'beat'), 1.1); near(T.snap(1.3, t, 'bar'), 2.1); near(T.snap(1.3, t, '1/8'), 1.35); near(T.snap(1.3, t, '1/16'), 1.35); near(T.snap(1.24, t, '1/16'), 1.225);
});
ok('grid lines: bars labelled, beats appear when zoomed in, subdivisions when zoomed further', () => {
  const t = T.norm({ bpm: 120 });
  const far = T.gridLines(0, 60, t, 10); assert(far.every((g) => g.level === 'bar'), 'only bars when zoomed out');
  const mid = T.gridLines(0, 8, t, 60); assert(mid.some((g) => g.level === 'beat') && !mid.some((g) => g.level === 'sub'));
  const close = T.gridLines(0, 2, t, 400); assert(close.some((g) => g.level === 'sub'));
  assert(mid.find((g) => Math.abs(g.time - 2) < 1e-9).label === '2', 'bar 2 starts at 2 s');
});
ok('metronome clicks: one per beat, accent on beat 1, starting mid-bar', () => {
  const c = T.clicks(1.2, 4.0, T.norm({ bpm: 120, num: 3 }));
  assert.deepStrictEqual(JSON.parse(JSON.stringify(c.map((x) => [x.time, x.accent]))), [[1.5, true], [2, false], [2.5, false], [3, true], [3.5, false]]);
});

/* ---------- BPM detection ---------- */
const sr = 22050;
function track(bpm, secs, offset, opts) {
  const o = opts || {}, x = new Float32Array(Math.round(secs * sr)), beat = 60 / bpm; let seed = 7;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff) * 2 - 1;
  const hit = (t, amp, f, dec) => { const i0 = Math.round(t * sr); for (let i = 0; i < sr * 0.15 && i0 + i < x.length; i++) { if (i0 + i < 0) continue; const e = Math.exp(-i / (sr * dec)); x[i0 + i] += amp * e * (f ? Math.sin(2 * Math.PI * f * i / sr) : rnd()); } };
  for (let k = 0, t = offset; t < secs; k++, t = offset + k * beat) {
    if (o.drums) { if (k % 2 === 0) hit(t, 0.8, 60, 0.05); else hit(t, 0.5, 0, 0.03); hit(t + beat / 2, 0.15, 0, 0.01); } // kick / snare / hats
    else hit(t, k % 4 === 0 ? 0.9 : 0.6, 1000, 0.01);
  }
  if (o.noise) for (let i = 0; i < x.length; i++) x[i] += o.noise * rnd();
  return x;
}
for (const [bpm, opts, label] of [[120, {}, 'click 120'], [90, {}, 'click 90'], [128, { drums: true }, 'drums 128'], [174, { drums: true }, 'drums 174 (fast)'], [72, { drums: true }, 'drums 72 (slow)'], [100, { noise: 0.05 }, 'clicks + noise 100'], [133.3, {}, 'fractional 133.3']]) {
  ok('detectTempo: ' + label, () => {
    const r = D.detectTempo([track(bpm, 30, 0.37, opts)], sr), hit = (b) => Math.abs(b / bpm - 1) < 0.01;
    // the main estimate is exact for click tracks; drum patterns may come out at half / double tempo, which is
    // musically ambiguous — then the true tempo must be among the offered candidates
    if (opts.drums) assert(r.candidates.some(hit), `true ${bpm} not among ${JSON.stringify(r.candidates)}`);
    else assert(hit(r.bpm), `detected ${r.bpm} for ${bpm} (conf ${r.confidence.toFixed(2)})`);
    assert(r.candidates.some(hit) && r.confidence > 0.2, 'confidence ' + r.confidence);
  });
}
ok('detectTempo: offset lands on the beat grid', () => {
  const bpm = 120, r = D.detectTempo([track(bpm, 30, 0.37)], sr), period = 60 / bpm;
  const d = Math.abs(((r.offset - 0.37) % period + period + period / 2) % period - period / 2); assert(d < 0.03, 'offset ' + r.offset);
});
ok('detectTempo: silence / very short input -> no tempo', () => {
  assert.strictEqual(D.detectTempo([new Float32Array(sr * 10)], sr).bpm, 0);
  assert.strictEqual(D.detectTempo([new Float32Array(sr)], sr).bpm, 0);
});
done();

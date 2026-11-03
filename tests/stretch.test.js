// Run: node tests/stretch.test.js — multitrack clip time-stretch / pitch (dsp.clipStretch, clipstretch.js)
const assert = require('assert');
const { load, CORE, ok, okAsync, done } = require('./_sandbox');
const sb = load(CORE), AS = sb.AS, D = AS.dsp, CS = AS.cstretch;
const near = (a, b, e, m) => assert(Math.abs(a - b) <= (e || 1e-9), (m ? m + ': ' : '') + a + ' != ' + b);
const sr = 22050, tone = (f, secs) => { const x = new Float32Array(Math.round(secs * sr)); for (let i = 0; i < x.length; i++) x[i] = 0.5 * Math.sin(2 * Math.PI * f * i / sr); return x; };
/* frequency from upward zero crossings in the middle half */
const freq = (x) => { let n = 0, first = -1, last = -1; for (let i = (x.length >> 2) + 1; i < (x.length * 3) >> 2; i++) if (x[i - 1] < 0 && x[i] >= 0) { if (first < 0) first = i; last = i; n++; } return ((n - 1) * sr) / (last - first); };

for (const mode of ['polyphonic', 'monophonic']) ok(`${mode}: 150 % length, same pitch`, () => {
  const out = D.clipStretch([tone(440, 2)], sr, 1.5, 0, mode)[0];
  near(out.length, Math.round(2 * sr * 1.5), 1, 'length'); near(freq(out), 440, 4, 'pitch');
});
ok('varispeed: 150 % length lowers the pitch like tape (pitch shift ignored)', () => {
  const out = D.clipStretch([tone(440, 2)], sr, 1.5, 7, 'varispeed')[0];
  near(out.length, Math.round(2 * sr * 1.5), 1); near(freq(out), 440 / 1.5, 3);
});
ok('pitch shift +12 st keeps the length and doubles the frequency', () => {
  const out = D.clipStretch([tone(300, 2)], sr, 1, 12, 'polyphonic')[0];
  assert.strictEqual(out.length, 2 * sr); near(freq(out), 600, 6);
});
ok('setStretch rescales offset, length, fades and envelope times; the start stays', () => {
  const s = new AS.Session(), c = s.addClip(s.tracks[0], AS.makeSource('a', sr, [tone(440, 4)]), 3, { off: 1, dur: 2, fi: 0.2, fo: 0.4 });
  AS.env.of(c).volume.push({ t: 1, v: 0.5 });
  CS.setStretch(c, 2); near(c.off, 2); near(c.dur, 4); near(c.fi, 0.4); near(c.fo, 0.8); near(c.env.volume[0].t, 2); near(c.start, 3);
  near(CS.srcDur(c), 8); CS.setStretch(c, 9); near(c.stretch, 4, 0, 'clamped to 400 %');
});
ok('Match to session tempo: 100 BPM material in a 120 BPM session plays at 100/120 of its length', () => {
  const src = AS.makeSource('loop', sr, [tone(440, 2)]); src.tempo = { bpm: 100 }; const s = new AS.Session(), c = s.addClip(s.tracks[0], src, 0);
  assert(CS.matchTempo(c, 120)); near(c.stretch, 100 / 120, 1e-9); near(c.dur, 2 * 100 / 120, 1e-9);
});
ok('cache: play() is null until rendered, then the processed source; original when not stretched', () => {
  const s = new AS.Session(), c = s.addClip(s.tracks[0], AS.makeSource('a', sr, [tone(440, 1)]), 0);
  assert.strictEqual(CS.play(c), c.src); c.stretch = 1.25; assert.strictEqual(CS.play(c), null); assert.strictEqual(CS.missing(s).length, 1);
});
ok('graph: a clip whose stretched audio is not ready is skipped (no wrong-speed playback)', () => {
  const s = new AS.Session(), c = s.addClip(s.tracks[0], AS.makeSource('a', sr, [tone(440, 1)]), 0); c.stretch = 1.37;
  const srcs = []; const P = (v) => ({ value: v, setValueAtTime() {}, linearRampToValueAtTime() {}, setValueCurveAtTime() {} }), n = (x) => ({ connect: (d) => d, disconnect() {}, ...x });
  const ctx = { currentTime: 0, sampleRate: sr, createGain: () => n({ gain: P(1) }), createStereoPanner: () => n({ pan: P(0) }), createBufferSource: () => { const b = n({ start() {} }); srcs.push(b); return b; }, createChannelSplitter: () => n({}), createAnalyser: () => n({}) };
  AS.buildGraph(ctx, { connect() {} }, s, 0, 0); assert.strictEqual(srcs.length, 0);
});
okAsync('ensure renders (main-thread fallback in Node), caches per settings, survives save / open', async () => {
  const s = new AS.Session(), c = s.addClip(s.tracks[0], AS.makeSource('a', sr, [tone(440, 1)]), 0); CS.setStretch(c, 1.5);
  await CS.ensureAll(s); const ps = CS.play(c); assert(ps && ps !== c.src); near(ps.dur, 1.5, 0.001);
  c.pitch = 2; assert.strictEqual(CS.play(c), null, 'new key'); c.pitch = 0; assert.strictEqual(CS.play(c), ps, 'cached');
  const j = JSON.parse(JSON.stringify(AS.sessionIO.serialize(s))); j.sources[0].tempo = { bpm: 90 };
  const back = AS.sessionIO.deserialize(j).tracks[0].clips[0]; near(back.stretch, 1.5); near(back.dur, 1.5, 1e-9); assert.strictEqual(back.src.tempo.bpm, 90);
});
done();

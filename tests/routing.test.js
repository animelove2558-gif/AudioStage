// Run: node tests/routing.test.js — bus tracks, outputs, sends, sidechain: loop prevention, solo logic, graph wiring,
// .asession versioning / migration, and the sidechain dynamics DSP (dsp.createDynamics)
const assert = require('assert');
const { load, CORE, ok, done } = require('./_sandbox');
const sb = load(CORE), AS = sb.AS, RT = AS.routing, D = AS.dsp;

const mkSession = () => {
  const s = new AS.Session(); s.tracks = []; // start empty
  const a = s.addTrack('Voice'), b = s.addTrack('Music'), busA = s.addBus('Bus A'), busB = s.addBus('Bus B');
  const sr = 8000, x = new Float32Array(sr); x.fill(0.5);
  s.addClip(a, AS.makeSource('v', sr, [x]), 0); s.addClip(b, AS.makeSource('m', sr, [x]), 0);
  return { s, a, b, busA, busB };
};

/* ---------- data model ---------- */
ok('new tracks / buses carry routing defaults; old tracks are normalised', () => {
  const { a, busA } = mkSession();
  assert.strictEqual(a.type, 'audio'); assert.strictEqual(a.out, 'master'); assert.deepStrictEqual(Array.from(a.sends), []);
  assert.strictEqual(busA.type, 'bus'); assert.strictEqual(busA.clips.length, 0);
  const old = RT.normTrack({ id: 'x', name: 'old', clips: [] }); assert.strictEqual(old.type, 'audio'); assert.strictEqual(old.out, 'master');
});
ok('audioTrackAt never returns a bus (adds an audio track when needed)', () => {
  const { s, busA } = mkSession(); const i = s.tracks.indexOf(busA), t = s.audioTrackAt(i);
  assert.strictEqual(t.type, 'audio'); assert(s.tracks.indexOf(t) > i);
});

/* ---------- loop prevention ---------- */
ok('output / send / sidechain choices never offer a loop', () => {
  const { s, a, busA, busB } = mkSession();
  busA.out = busB.id; // A -> B
  assert(!RT.outputOptions(s, busB).some(([v]) => v === busA.id), 'B -> A would loop');
  assert(RT.outputOptions(s, a).some(([v]) => v === busB.id), 'track -> B is fine');
  assert(!RT.sendTargets(s, busB).some(([v]) => v === busA.id), 'send B -> A would loop');
  assert(!RT.outputOptions(s, busA).some(([v]) => v === busA.id), 'never itself');
  a.out = busA.id; // Voice -> A -> B
  // an effect on Voice keyed by Bus B: B depends on Voice -> loop
  assert(!RT.sidechainOptions(s, a.id).some(([v]) => v === busB.id), 'sidechain loop offered');
  assert(RT.sidechainOptions(s, 'master').some(([v]) => v === busB.id), 'master may be keyed by anything');
});
ok('plan() drops edges of a hand-edited looping session instead of wiring a cycle', () => {
  const { s, busA, busB } = mkSession(); busA.out = busB.id; busB.out = busA.id; // loop!
  const p = RT.plan(s), outs = [p.outOf(busA), p.outOf(busB)];
  assert(outs.includes('master'), 'one side falls back to Master: ' + outs);
  assert(!(outs[0] === busB.id && outs[1] === busA.id));
});
ok('sidechain keys count as routes for loop detection', () => {
  const { s, a, b } = mkSession(); a.out = 'master';
  a.fx = [AS.rack.newFx('comp', { sc: b.id })]; // Music keys a compressor on Voice
  assert(RT.edges(s).some((e) => e[0] === b.id && e[1] === a.id && e[2] === 'key'), 'key edge Music -> Voice');
  assert.strictEqual(RT.wouldLoop(s, a.id, b.id), true, 'Voice -> Music would now loop');
  assert(!RT.sidechainOptions(s, b.id).some(([v]) => v === a.id), 'Voice may not key Music now (loop)');
});

/* ---------- solo / mute ---------- */
ok('solo: soloed track + its bus chain are heard; soloing a bus keeps its inputs; mute wins', () => {
  const { s, a, b, busA, busB } = mkSession(); a.out = busA.id; busA.out = busB.id;
  a.solo = true; let p = RT.plan(s);
  assert(p.audible.has(a.id) && p.audible.has(busA.id) && p.audible.has(busB.id) && !p.audible.has(b.id));
  a.solo = false; busA.solo = true; p = RT.plan(s);
  assert(p.audible.has(busA.id) && p.audible.has(a.id) && p.audible.has(busB.id) && !p.audible.has(b.id), 'bus solo keeps inputs');
  busA.mute = true; p = RT.plan(s); assert(!p.audible.has(busA.id));
});
ok('deleting a bus sends its inputs back to Master and clears sends / sidechain refs', () => {
  const { s, a, b, busA } = mkSession(); a.out = busA.id; RT.addSend(s, b, busA.id); b.fx = [AS.rack.newFx('gate', { sc: busA.id })];
  s.removeTrack(busA);
  assert.strictEqual(a.out, 'master'); assert.strictEqual(b.sends.length, 0); assert.strictEqual(b.fx[0].p.sc, '');
});
ok('at most 16 sends per track', () => {
  const { s, a, busA } = mkSession(); for (let i = 0; i < 20; i++) RT.addSend(s, a, busA.id);
  assert.strictEqual(a.sends.length, 16);
});
ok('undo restores routing and sends (deep copy)', () => {
  const { s, a, busA } = mkSession(); s.push(); a.out = busA.id; RT.addSend(s, a, busA.id).db = -6;
  s.undo(); const a2 = s.tracks.find((t) => t.id === a.id);
  assert.strictEqual(a2.out, 'master'); assert.strictEqual(a2.sends.length, 0);
  s.redo(); const a3 = s.tracks.find((t) => t.id === a.id); assert.strictEqual(a3.out, busA.id); assert.strictEqual(a3.sends[0].db, -6);
});

/* ---------- graph wiring (fake Web Audio that records connections) ---------- */
function fakeCtx() {
  const all = [];
  const P = (v) => ({ value: v, ev: [], setValueAtTime(x, t) { this.ev.push(['set', x, t]); }, linearRampToValueAtTime(x, t) { this.ev.push(['ramp', x, t]); }, setValueCurveAtTime() {}, cancelScheduledValues() {} });
  const node = (type, extra) => { const n = { type, out: [], connect(d, o, i) { this.out.push({ d, i: i || 0 }); return d; }, disconnect() {}, ...extra }; all.push(n); return n; };
  const ctx = Object.assign(Object.create(sb.AudioContext.prototype), {
    all, currentTime: 0, sampleRate: 44100, _wl: true,
    createGain: () => node('gain', { gain: P(1) }), createStereoPanner: () => node('pan', { pan: P(0) }),
    createBufferSource: () => node('src', { start() {}, stop() {} }), createChannelSplitter: () => node('split'), createChannelMerger: () => node('merge'),
    createAnalyser: () => node('an', { getFloatTimeDomainData() {} }), createDynamicsCompressor: () => node('comp', { threshold: P(0), knee: P(0), ratio: P(1), attack: P(0), release: P(0) }),
  });
  sb.AudioWorkletNode = function (c, name, o) { const params = new Map(); return Object.assign(node('worklet:' + name, { numberOfInputs: o.numberOfInputs }), { parameters: { get: (k) => params.get(k) || (params.set(k, P(0)), params.get(k)) }, port: { postMessage() {} } }); };
  return ctx;
}
const reachable = (from, to) => { const seen = new Set(), q = [from]; while (q.length) { const n = q.shift(); if (n === to) return true; if (seen.has(n)) continue; seen.add(n); for (const o of n.out) q.push(o.d); } return false; };
ok('graph: track -> bus -> master, post- and pre-fader sends, key into a sidechain compressor', () => {
  const { s, a, b, busA, busB } = mkSession(); const dest = { out: [], connect() {} };
  a.out = busA.id; const post = RT.addSend(s, b, busB.id); const pre = RT.addSend(s, b, busA.id); pre.pre = true; pre.db = -6;
  b.fx = [AS.rack.newFx('comp', { sc: a.id })];
  const ctx = fakeCtx(); AS.buildGraph(ctx, dest, s, 0, 0);
  const srcs = ctx.all.filter((n) => n.type === 'src'); assert.strictEqual(srcs.length, 2);
  const master = ctx.all.find((n) => n.type === 'gain' && n.out.some((o) => o.d === dest) ) || ctx.all[0];
  // every source reaches the destination through the graph
  const toDest = (n) => { const seen = new Set(), q = [n]; while (q.length) { const x = q.shift(); if (x === dest) return true; if (seen.has(x)) continue; seen.add(x); for (const o of x.out) q.push(o.d); } return false; };
  for (const src of srcs) assert(toDest(src), 'source does not reach the output');
  // the sidechain compressor is the AudioWorklet version and its 2nd input is fed
  const dyn = ctx.all.find((n) => n.type === 'worklet:as-dyn'); assert(dyn, 'no sidechain worklet');
  assert(ctx.all.some((n) => n.out.some((o) => o.d === dyn && o.i === 1)), 'key not connected to input 2');
  // send gains are scheduled at their dB level
  const preGain = ctx.all.find((n) => n.type === 'gain' && Math.abs(n.gain.value - D.fromDb(-6)) < 1e-9);
  assert(preGain, 'send level -6 dB'); const busAin = ctx.all.find((n) => n.type === 'pan' && preGain.out.some((o) => o.d === n));
  assert(busAin, 'send gain feeds a send panner'); assert(reachable(busAin, dest), 'the send reaches the output through the bus');
  void master;
});
ok('graph: without a sidechain the native compressor is used (sound unchanged)', () => {
  const { s, a } = mkSession(); a.fx = [AS.rack.newFx('comp')];
  const ctx = fakeCtx(); AS.buildGraph(ctx, { connect() {} }, s, 0, 0);
  assert(ctx.all.some((n) => n.type === 'comp')); assert(!ctx.all.some((n) => n.type === 'worklet:as-dyn'));
});
ok('graph: a muted key track is still built (key only) so ducking keeps working while soloing', () => {
  const { s, a, b } = mkSession(); b.fx = [AS.rack.newFx('autoduck', { sc: a.id })]; b.solo = true;
  const ctx = fakeCtx(); AS.buildGraph(ctx, { connect() {} }, s, 0, 0);
  assert.strictEqual(ctx.all.filter((n) => n.type === 'src').length, 2, 'voice source must exist as the key');
});

/* ---------- .asession format ---------- */
ok('save / open round-trip keeps buses, outputs, sends, sidechain and audio', () => {
  const { s, a, b, busA } = mkSession(); a.out = busA.id; const x = RT.addSend(s, b, busA.id); x.db = -9; x.pre = true; b.fx = [AS.rack.newFx('autoduck', { sc: a.id })];
  const j = JSON.parse(JSON.stringify(AS.sessionIO.serialize(s)));
  assert.strictEqual(j.version, AS.sessionIO.VERSION);
  const s2 = AS.sessionIO.deserialize(j), a2 = s2.tracks.find((t) => t.id === a.id), b2 = s2.tracks.find((t) => t.id === b.id);
  assert.strictEqual(a2.out, busA.id); assert.strictEqual(b2.sends[0].db, -9); assert.strictEqual(b2.sends[0].pre, true); assert.strictEqual(b2.fx[0].p.sc, a.id);
  assert.strictEqual(s2.tracks.find((t) => t.id === busA.id).type, 'bus');
  assert.strictEqual(a2.clips[0].src.ch[0][100], 0.5);
});
ok('a version-2 session (and a version-less one) opens: defaults added, dB clip envelope converted', () => {
  const x = new Float32Array([0.25, -0.25, 0.5]);
  const src = { name: 's', sr: 8000, ch: [AS.sessionIO.b64(new Uint8Array(x.buffer))] };
  const v2 = { v: 2, master: { vol: -3, fx: [] }, sources: [src], tracks: [{ id: 't1', name: 'Old', vol: -2, pan: 0, mute: false, solo: false, arm: false, color: '#fff', fx: [], auto: { vol: [], pan: [] }, clips: [{ id: 4, src: 0, start: 1, off: 0, dur: 0.0003, gain: 0, fi: 0, fo: 0, name: 'c', env: { vol: [{ t: 0, v: -6.0206 }], pan: [] } }] }] };
  const s = AS.sessionIO.deserialize(v2), t = s.tracks[0];
  assert.strictEqual(t.type, 'audio'); assert.strictEqual(t.out, 'master'); assert.strictEqual(t.sends.length, 0); assert.strictEqual(s.master.vol, -3);
  assert(Math.abs(t.clips[0].env.volume[0].v - 0.5) < 1e-4, 'dB envelope converted'); assert(!t.clips[0].env.vol);
  assert.strictEqual(s.nextClip, 5); assert.strictEqual(t.clips[0].src.ch[0][2], 0.5);
  const v1 = { ...v2 }; delete v1.v; assert.strictEqual(AS.sessionIO.deserialize(v1).tracks[0].name, 'Old');
  assert.throws(() => AS.sessionIO.migrate({ version: 99, tracks: [] }), /newer/);
});

/* ---------- sidechain dynamics DSP ---------- */
const sr = 48000, N = sr / 2;
const tone = (amp) => { const x = new Float32Array(N); for (let i = 0; i < N; i++) x[i] = amp * Math.sin(2 * Math.PI * 220 * i / sr); return x; };
const rms = (x, a, b) => { let s = 0; for (let i = a; i < b; i++) s += x[i] * x[i]; return Math.sqrt(s / (b - a)); };
const run = (mode, main, key, p) => { const d = D.createDynamics(mode, sr), out = [new Float32Array(N)]; for (let i = 0; i < N; i += 128) { const n = Math.min(128, N - i); d.process([main.subarray(i, i + n)], key ? [key.subarray(i, i + n)] : null, [out[0].subarray(i, i + n)], n, p); } return out[0]; };
ok('sidechain compressor: a loud key compresses the main signal, a silent key leaves it alone', () => {
  const main = tone(0.3), p = { thr: -30, ratio: 8, knee: 0, att: 1, rel: 50, makeup: 0 };
  const loud = run('comp', main, tone(0.9), p), quiet = run('comp', main, new Float32Array(N), p);
  assert(rms(loud, N / 2, N) < 0.3 * rms(main, N / 2, N), 'not compressed by the key');
  assert(Math.abs(rms(quiet, N / 2, N) - rms(main, N / 2, N)) < 1e-3, 'changed without key');
});
ok('self-keyed compressor matches the expected static curve (ratio 4, -20 dB thr)', () => {
  const main = tone(0.5), out = run('comp', main, null, { thr: -20, ratio: 4, knee: 0, att: 0, rel: 0, makeup: 0 });
  const peakDb = D.toDb(0.5), expect = -20 + (peakDb + 20) / 4; let pk = 0; for (let i = N / 2; i < N; i++) pk = Math.max(pk, Math.abs(out[i]));
  assert(Math.abs(D.toDb(pk) - expect) < 0.5, D.toDb(pk) + ' vs ' + expect);
});
ok('sidechain gate: opens only while the key is present', () => {
  const main = tone(0.5), key = new Float32Array(N); key.fill(0.5, N / 2);
  const out = run('gate', main, key, { thr: -30, floor: -80, att: 1, hold: 0, rel: 5 });
  assert(rms(out, 1000, N / 2 - 1000) < 0.001, 'gate open without key'); assert(rms(out, N / 2 + 2000, N) > 0.3, 'gate closed with key');
});
ok('ducker: lowers by the duck amount while the key is active', () => {
  const main = tone(0.5), key = new Float32Array(N); key.fill(0.5, N / 2);
  const out = run('duck', main, key, { thr: -30, amount: 12, att: 1, hold: 0, rel: 20 });
  const before = rms(out, 2000, N / 2 - 2000), during = rms(out, N / 2 + 4000, N);
  assert(Math.abs(D.toDb(during / before) + 12) < 0.5, 'duck depth ' + D.toDb(during / before));
});
done();

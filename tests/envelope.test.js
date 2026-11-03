// Run: node tests/envelope.test.js — clip Volume & Pan envelopes (app/js/envelope.js) + their use in buildGraph
const assert = require('assert');
const { load, CORE } = require('./_sandbox'); // browser-ish sandbox: the app scripts attach themselves to window.AS
const sb = load(CORE), AS = sb.AS, E = AS.env;

let fail = 0;
const ok = (name, fn) => { try { fn(); console.log('ok   ', name); } catch (e) { fail++; console.log('FAIL ', name, e.message); } };
const near = (a, b, eps = 1e-9) => assert(Math.abs(a - b) <= eps, `${a} != ${b}`);

/* AudioParam stand-in that records the automation timeline and can evaluate it */
class Param {
  constructor(v) { this.value = v; this.ev = []; }
  add(e) { this.ev.push(e); this.ev.sort((a, b) => a.t - b.t); return this; }
  setValueAtTime(v, t) { return this.add({ k: 'set', v, t }); }
  linearRampToValueAtTime(v, t) { return this.add({ k: 'ramp', v, t }); }
  cancelScheduledValues(t) { this.ev = this.ev.filter((e) => e.t < t); return this; }
  cancelAndHoldAtTime(t) { const v = this.at(t); this.cancelScheduledValues(t); return this.setValueAtTime(v, t); }
  at(t) {
    let prev = { v: this.value, t: 0 };
    for (const e of this.ev) {
      if (e.t <= t) { prev = e; continue; }
      return e.k === 'ramp' ? prev.v + (e.v - prev.v) * ((t - prev.t) / (e.t - prev.t)) : prev.v;
    }
    return prev.v;
  }
}
let nodes = [];
const fakeCtx = (now) => {
  const node = (extra) => { const n = { conn: [], connect(d) { this.conn.push(d); return d; }, disconnect() {}, ...extra }; nodes.push(n); return n; };
  return Object.assign(Object.create(sb.AudioContext.prototype), { // instanceof AudioContext -> treated as live playback
    currentTime: now, sampleRate: 44100,
    createGain: () => node({ type: 'gain', gain: new Param(1) }),
    createStereoPanner: () => node({ type: 'pan', pan: new Param(0) }),
    createBufferSource: () => node({ type: 'src', start() {}, stop() {} }),
    createChannelSplitter: () => node({ type: 'split' }), createChannelMerger: () => node({ type: 'merge' }),
    createAnalyser: () => node({ type: 'an', getFloatTimeDomainData() {} }),
  });
};

/* ---------- data model ---------- */
ok('defaults: volume 1.0 (0 dB), pan 0.0 (centre), empty lists', () => {
  const c = {}; const e = E.of(c);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(e)), { volume: [], pan: [] });
  near(E.valueAt(e.volume, 3, E.KINDS.volume.dflt), 1); near(E.valueAt(e.pan, 3, E.KINDS.pan.dflt), 0);
});
ok('old sessions: dB "vol" list converted to linear gain, clamped to 0 … 2', () => {
  const c = { env: { vol: [{ t: 0, v: 0 }, { t: 1, v: -6.0206 }, { t: 2, v: 12 }], pan: [{ t: 0, v: 0.5 }] } };
  const e = E.of(c);
  assert(!('vol' in e)); near(e.volume[0].v, 1, 1e-6); near(e.volume[1].v, 0.5, 1e-4); near(e.volume[2].v, 2); near(e.pan[0].v, 0.5);
});

/* ---------- interpolation ---------- */
ok('linear interpolation between keyframes, held outside them', () => {
  const pts = [{ t: 1, v: 1 }, { t: 3, v: 0 }];
  near(E.valueAt(pts, 0, 1), 1); near(E.valueAt(pts, 2, 1), 0.5); near(E.valueAt(pts, 2.5, 1), 0.25); near(E.valueAt(pts, 9, 1), 0);
});

/* ---------- editing + clamping ---------- */
ok('addPoint keeps order and clamps time to the clip and value to the range', () => {
  const pts = [];
  E.addPoint(pts, 5, 0.5, 4, 'volume'); E.addPoint(pts, 1, 3, 4, 'volume'); E.addPoint(pts, -2, -1, 4, 'volume');
  assert.deepStrictEqual(pts.map((p) => p.t), [0, 1, 4]); assert.deepStrictEqual(pts.map((p) => p.v), [0, 2, 0.5]);
});
ok('movePoint stays between its neighbours, inside the clip, in range; snaps to the default', () => {
  const pts = [{ t: 1, v: 1 }, { t: 2, v: 1 }, { t: 3, v: 1 }];
  E.movePoint(pts, 1, 10, 5, 4, 'volume'); near(pts[1].t, 3); near(pts[1].v, 2);
  E.movePoint(pts, 1, -10, -5, 4, 'volume'); near(pts[1].t, 1); near(pts[1].v, 0);
  E.movePoint(pts, 2, 99, 0, 4, 'pan'); near(pts[2].t, 4);
  E.movePoint(pts, 0, -1, 0.99, 4, 'volume'); near(pts[0].t, 0); near(pts[0].v, 1);
  E.movePoint(pts, 0, 0, 0.02, 4, 'pan'); near(pts[0].v, 0);
});
ok('removePoint', () => { const pts = [{ t: 1, v: 1 }, { t: 2, v: 0 }]; E.removePoint(pts, 0); assert.deepStrictEqual(pts, [{ t: 2, v: 0 }]); E.removePoint(pts, 7); assert.strictEqual(pts.length, 1); });
ok('split / shift keep the audible curve', () => {
  const pts = [{ t: 0, v: 0 }, { t: 4, v: 2 }], [l, r] = E.split(pts, 1, 1);
  near(E.valueAt(l, 1, 1), 0.5); near(E.valueAt(r, 0, 1), 0.5); near(E.valueAt(r, 3, 1), 2);
  const s = E.shift(pts, 2, 2, 1); near(E.valueAt(s, 0, 1), 1); near(E.valueAt(s, 2, 1), 2);
});
ok('format', () => { assert.strictEqual(E.format('volume', 1), '+0.0 dB'); assert.strictEqual(E.format('volume', 0.5), '-6.0 dB'); assert.strictEqual(E.format('volume', 0), '-∞ dB'); assert.strictEqual(E.format('pan', -0.4), 'L40'); assert.strictEqual(E.format('pan', 0), 'C'); assert.strictEqual(E.format('pan', 1), 'R100'); });

/* ---------- audio scheduling ---------- */
ok('schedule plans the envelope on the AudioParam timeline', () => {
  const p = new Param(1), pts = [{ t: 1, v: 1 }, { t: 3, v: 0 }];
  E.schedule(p.gain || p, pts, 0, 10, 1); // clip starts at ctx time 10
  near(p.at(10), 1); near(p.at(11), 1); near(p.at(12), 0.5); near(p.at(13), 0); near(p.at(20), 0);
});
ok('schedule from the middle of a clip (playback started inside it)', () => {
  const p = new Param(1); E.schedule(p, [{ t: 1, v: 1 }, { t: 3, v: 0 }], 2, 10, 1);
  near(p.at(10), 0.5); near(p.at(10.5), 0.25); near(p.at(11), 0);
});
ok('reschedule after an edit: glides from the sounding value, then follows the new curve', () => {
  const p = new Param(1), pts = [{ t: 0, v: 1 }, { t: 10, v: 1 }];
  E.schedule(p, pts, 0, 0, 1);
  pts[1].v = 0; // user drags the last keyframe down while the playhead is at 5 s
  E.reschedule(p, pts, 0, 0, 1, { currentTime: 5 });
  near(p.at(5), 1); near(p.at(5.02), E.valueAt(pts, 5.02, 1), 1e-9); near(p.at(7.5), 0.25, 1e-9); near(p.at(10), 0);
});

/* ---------- integration with the multitrack graph ---------- */
const session = () => { const s = new AS.Session(), src = AS.makeSource('a', 44100, [new Float32Array(44100 * 4)]); const c = s.addClip(s.tracks[0], src, 1); return { s, c }; };
ok('buildGraph: clip -> gain -> volume GainNode, pan only when it has keyframes; values scheduled', () => {
  const { s, c } = session(); E.of(c).volume.push({ t: 0, v: 1 }, { t: 2, v: 0.5 });
  nodes = []; const ctx = fakeCtx(0); AS.buildGraph(ctx, { connect() {} }, s, 0, 100);
  assert.strictEqual(nodes.filter((n) => n.type === 'pan').length, s.tracks.length, 'only the track panners'); // no clip pan keyframes -> no clip panner
  const st = AS.engine.envNodes[c.id]; assert(st && st.volume && st.pan === null);
  near(st.volume.at(101), 1); near(st.volume.at(102), 0.75); near(st.volume.at(103), 0.5);
  E.of(c).pan.push({ t: 0, v: -1 }); nodes = []; AS.buildGraph(fakeCtx(0), { connect() {} }, s, 0, 100);
  const st2 = AS.engine.envNodes[c.id]; assert(st2.pan); near(st2.pan.at(101), -1);
});
ok('liveUpdate: ok while playing, idle when stopped, rebuild when a panner is needed', () => {
  const { s, c } = session(); const eng = AS.engine;
  eng.ctx = fakeCtx(102); AS.buildGraph(eng.ctx, { connect() {} }, s, 0, 100); eng.playing = true;
  E.of(c).volume.push({ t: 0, v: 1 }, { t: 3, v: 0 });
  assert.strictEqual(E.liveUpdate(c), 'ok');
  near(AS.engine.envNodes[c.id].volume.at(103.5), 1 - 2.5 / 3, 1e-9); // clip starts at 1 s -> 2.5 s into the clip
  E.of(c).pan.push({ t: 1, v: 1 }); assert.strictEqual(E.liveUpdate(c), 'rebuild');
  eng.playing = false; assert.strictEqual(E.liveUpdate(c), 'idle');
});
ok('split clip carries both envelopes', () => {
  const { s, c } = session(); E.of(c).volume.push({ t: 0, v: 0 }, { t: 4, v: 2 }); E.of(c).pan.push({ t: 0, v: -1 }, { t: 4, v: 1 });
  const id = s.split(c.id, 3), r = s.findClip(id).c;
  near(E.valueAt(E.of(r).volume, 0, 1), 1); near(E.valueAt(E.of(r).pan, 0, 0), 0); near(E.valueAt(E.of(c).volume, 2, 1), 1);
});

console.log(fail ? `\n${fail} failed` : '\nall passed');
process.exit(fail ? 1 : 0);

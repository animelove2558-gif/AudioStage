// Run: node tests/playx.test.js — zero crossings, Skip Selection / Preview Edit / playlist segments, Shuttle speeds,
// Scrub rates, range markers (undo, WAV ltxt round trip)
const assert = require('assert');
const { load, CORE, ok, done } = require('./_sandbox');
const sb = load([...CORE, 'playx.js']), AS = sb.AS, D = AS.dsp, P = AS.playx;
const J = (x) => JSON.parse(JSON.stringify(x));

ok('zeroCross: nearest / left / right sign change of the summed channels; limits', () => {
  const x = new Float32Array(100); for (let i = 0; i < 100; i++) x[i] = Math.sin(2 * Math.PI * (i + 0.5) / 20); // crossings at 10, 20, 30 …
  assert.strictEqual(D.zeroCross([x], 23, 0), 20); assert.strictEqual(D.zeroCross([x], 27, 0), 30);
  assert.strictEqual(D.zeroCross([x], 23, 1), 30); assert.strictEqual(D.zeroCross([x], 27, -1), 20);
  assert.strictEqual(D.zeroCross([x], 25, 0, 2), 25, 'none within 2 samples → unchanged');
  const y = x.map((v) => -v); assert.strictEqual(D.zeroCross([x, y], 23, 0), 23, 'channels that cancel: everything is 0 → the sample itself');
  for (const i of [20, 30]) assert(Math.sign(x[i - 1]) !== Math.sign(x[i]), 'a real sign change at ' + i);
});
ok('Skip Selection and Preview Edit segments', () => {
  assert.deepStrictEqual(J(P.skipSegments(1000, { a: 300, b: 500 }, 100)), [[100, 300], [500, 1000]]);
  assert.deepStrictEqual(J(P.skipSegments(1000, { a: 300, b: 500 }, 400)), [[500, 1000]], 'from inside the selection');
  assert.deepStrictEqual(J(P.skipSegments(1000, { a: 300, b: 500 }, 700)), [[700, 1000]]);
  assert.deepStrictEqual(J(P.skipSegments(1000, { a: 0, b: 0 }, 50)), [[50, 1000]], 'no selection');
  assert.deepStrictEqual(J(P.previewSegments(1000, { a: 300, b: 500 }, 200, 100)), [[100, 300], [500, 600]]);
  assert.deepStrictEqual(J(P.previewSegments(1000, { a: 50, b: 950 }, 200, 100)), [[0, 50], [950, 1000]], 'clamped to the file');
  assert.deepStrictEqual(J(P.playlistSegments([{ a: 10, b: 20, loops: 2 }, { a: 0, b: 5, loops: 1 }])), [[10, 20], [10, 20], [0, 5]]);
});
ok('segMap: the playhead jumps over the gaps', () => {
  const m = P.segMap([[100, 300], [500, 600]], 100); assert.strictEqual(m.total, 3);
  assert.strictEqual(m.at(0), 1); assert.strictEqual(m.at(1.5), 2.5); assert.strictEqual(m.at(2), 5); assert.strictEqual(m.at(2.5), 5.5); assert.strictEqual(m.at(9), 6, 'stays at the end');
});
ok('Shuttle: L / J double up to 8×, opposite key reverses at 1×, K stops, K held = half speed', () => {
  let r = 0; const seq = []; for (const k of ['l', 'l', 'l', 'l', 'l', 'j', 'j', 'k']) { r = P.shuttleNext(r, k, false); seq.push(r); }
  assert.deepStrictEqual(seq, [1, 2, 4, 8, 8, -1, -2, 0]);
  assert.strictEqual(P.shuttleNext(0, 'l', true), 0.5); assert.strictEqual(P.shuttleNext(4, 'j', true), -0.5);
});
ok('Scrub rate follows the drag speed and direction (clamped 0.25–4×)', () => {
  assert.strictEqual(P.scrubRate(44100, 1, 44100), 1); assert.strictEqual(P.scrubRate(-22050, 1, 44100), -0.5);
  assert.strictEqual(P.scrubRate(44100 * 10, 1, 44100), 4); assert.strictEqual(P.scrubRate(100, 1, 44100), 0.25); assert.strictEqual(P.scrubRate(0, 1, 44100), 0);
});
ok('range markers: Doc.ranges, ids, undo of marker and playlist edits', () => {
  const d = new AS.Doc('x.wav', 1000, [new Float32Array(5000)]);
  d.setMeta('Add Range Marker', (x) => { x.markers.push({ t: 1000, d: 500, name: 'B' }, { t: 200, name: 'point' }, { t: 100, d: 300, name: 'A' }); x.markerIds(); });
  const R = d.ranges(); assert.deepStrictEqual(J(R.map((r) => [r.name, r.a, r.b])), [['A', 100, 400], ['B', 1000, 1500]]); assert(R.every((r) => r.id));
  d.setMeta('Add to Playlist', (x) => { x.playlist.push({ id: R[1].id, loops: 2 }, { id: R[0].id, loops: 1 }); });
  assert.strictEqual(d.playlist.length, 2); d.undo(); assert.strictEqual(d.playlist.length, 0, 'playlist undo'); d.redo(); assert.strictEqual(d.playlist.length, 2, 'redo');
  d.undo(); d.undo(); assert.strictEqual(d.markers.length, 0, 'marker undo'); assert(d.dirty);
});
ok('WAV: range markers survive export / import (cue + ltxt), point markers stay points', () => {
  const ch = [new Float32Array(4000)], bytes = AS.wav.encodeWav(ch, 8000, 16, false, { markers: [{ t: 100, name: 'Intro', d: 900 }, { t: 2000, name: 'Hit' }] });
  const r = AS.wav.decodeWav(bytes); assert.deepStrictEqual(J(r.markers), [{ t: 100, name: 'Intro', d: 900 }, { t: 2000, name: 'Hit' }]);
});
done();

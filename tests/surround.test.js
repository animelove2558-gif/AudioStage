// Run: node tests/surround.test.js — 5.1 panning law, 6-channel WAV (WAVE_FORMAT_EXTENSIBLE + mask), CD Layout
// (frame-aligned tracks, gaps, CUE sheet) and FCP7 XML export / import of a session
const assert = require('assert');
const { load, CORE, ok, done } = require('./_sandbox');
const sb = load([...CORE, 'cdlayout.js', 'interchange.js']), AS = sb.AS, D = AS.dsp;
const near = (a, b, e, m) => assert(Math.abs(a - b) <= e, (m ? m + ': ' : '') + a + ' != ' + b + ' ±' + e);
const J = (x) => JSON.parse(JSON.stringify(x));
const pw = (g) => g.reduce((s, v) => s + v * v, 0);

ok('surround panning: speakers hit exactly, constant power, centre of the room = all five, LFE never', () => {
  const at = (x, y, o) => D.surroundGains(x, y, o);
  const L = 0, R = 1, C = 2, LFE = 3, Ls = 4, Rs = 5;
  near(at(0, 1)[C], 1, 1e-9, 'front centre'); near(at(0, 1, -30)[L], 1, 1e-9, 'L at −30°'); near(at(0, 1, 30)[R], 1, 1e-9, 'R at +30°');
  const rl = at(-Math.sin(110 * Math.PI / 180), Math.cos(110 * Math.PI / 180)); near(rl[Ls], 1, 1e-9, 'Ls at −110°');
  const back = at(0, -1); near(back[Ls], back[Rs], 1e-9, 'rear centre between Ls and Rs'); assert(back[C] === 0 && back[L] === 0);
  for (const [x, y] of [[0.3, 0.2], [-0.9, -0.1], [0.7, -0.7], [0, 0], [1, 0]]) { near(pw(at(x, y)), 1, 1e-9, 'power'); assert.strictEqual(at(x, y)[LFE], 0); }
  const mid = at(0, 0); for (const c of [L, R, C, Ls, Rs]) near(mid[c], 1 / Math.sqrt(5), 1e-9, 'diffuse');
});
ok('6-channel WAV: WAVE_FORMAT_EXTENSIBLE, 5.1 mask 0x3F, PCM and float round trip', () => {
  const chs = Array.from({ length: 6 }, (_, c) => Float32Array.from({ length: 100 }, (_, i) => ((c + 1) / 10) * Math.sin(i / 7)));
  for (const bits of [16, 24, 32]) {
    const buf = AS.wav.encodeWav(chs, 48000, bits, false), dv = new DataView(buf);
    assert.strictEqual(dv.getUint16(20, true), 0xfffe, 'extensible'); assert.strictEqual(dv.getUint32(40, true), 0x3f, 'mask');
    const r = AS.wav.decodeWav(buf); assert.strictEqual(r.ch.length, 6); assert.strictEqual(r.channelMask, 0x3f);
    for (let c = 0; c < 6; c++) for (let i = 0; i < 100; i++) near(r.ch[c][i], chs[c][i], bits === 16 ? 1e-4 : 1e-6);
  }
  const st = AS.wav.encodeWav([new Float32Array(10), new Float32Array(10)], 44100, 16, false); assert.strictEqual(new DataView(st).getUint16(20, true), 1, 'stereo stays plain PCM (44-byte header)'); assert.strictEqual(st.byteLength, 44 + 40);
});
ok('CD Layout: tracks start on CD frames, gaps become INDEX 00 → 01, everything 44.1 kHz stereo', () => {
  const tone = (sr, secs, nch) => Array.from({ length: nch }, () => new Float32Array(Math.round(sr * secs)).fill(0.1));
  const r = AS.cd.build([{ name: 'One', ch: tone(48000, 5.01, 1), sr: 48000, gap: 0 }, { name: 'Two "live"', performer: 'Band', ch: tone(44100, 4.5, 2), sr: 44100, gap: 2 }, { name: 'Three', ch: tone(22050, 6, 2), sr: 22050, gap: 1.5 }], { title: 'Album', performer: 'Band', file: 'Album.wav' });
  assert.strictEqual(r.sr, 44100); assert.strictEqual(r.ch.length, 2);
  for (const t of r.tracks) { assert.strictEqual(t.index1 % 588, 0, 'frame aligned'); assert.strictEqual(t.index0 % 588, 0); }
  assert.strictEqual(r.tracks[1].index1 - r.tracks[1].index0, 150 * 588, '2 s gap = 150 frames'); assert.strictEqual(r.ch[0].length, r.tracks[2].end);
  near(r.tracks[1].index0 / 44100, Math.ceil(5.01 * 44100 / 588) * 588 / 44100, 1e-9, 'track 1 padded to a frame');
  const cue = AS.cd.parseCue(r.cue); assert.deepStrictEqual(J(cue.map((t) => [t.n, t.index0, t.index1])), J(r.tracks.map((t) => [t.n, t.index1 > t.index0 ? t.index0 / 588 : undefined, t.index1 / 588])));
  assert(/FILE "Album.wav" WAVE/.test(r.cue) && /TITLE "Two 'live'"/.test(r.cue) && /PERFORMER "Band"/.test(r.cue), r.cue);
  assert.strictEqual(AS.cd.msf(75 * 61 + 3), '01:01:03');
  assert(r.warnings.some((w) => /shorter than 4 seconds/.test(w)) === false && AS.cd.build([{ name: 'x', ch: tone(44100, 1, 2), sr: 44100 }]).warnings.length === 1, 'short track warning');
});
ok('FCP7 XML: export → import keeps tracks, positions, source in-points, gain, pan and fades', () => {
  const s = new AS.Session(); s.tracks = []; const sr = 48000;
  const a = AS.makeSource('Voice', sr, [new Float32Array(sr * 10)]), b = AS.makeSource('Music & FX', sr, [new Float32Array(sr * 20), new Float32Array(sr * 20)]);
  const t1 = s.addTrack('Dialog <A>'), t2 = s.addTrack('Music'); t2.vol = -6; t2.pan = 0.25;
  s.addClip(t1, a, 1, { off: 2, dur: 3, gain: -3, fi: 0.5, fo: 1 }); s.addClip(t1, a, 6, { off: 0, dur: 2 }); s.addClip(t2, b, 0, { off: 4, dur: 12, fi: 2 });
  const files = new Map(), media = (c) => { if (!files.has(c.src)) files.set(c.src, { id: 'file-' + (files.size + 1), name: c.src.name + '.wav', url: AS.interchange.toUrl('C:\\Media Files\\' + c.src.name + '.wav'), sr, nch: c.src.ch.length, frames: c.src.ch[0].length }); return files.get(c.src); };
  const xml = AS.interchange.toFCP7(s, media, { name: 'Show #1', timebase: 30 });
  assert(/<xmeml version="5">/.test(xml) && /file:\/\/localhost\/C:\/Media%20Files\/Music%20&amp;%20FX.wav/.test(xml), 'pathurl');
  assert.strictEqual((xml.match(/<file id="file-1">/g) || []).length, 1, 'each file described once'); assert(/<file id="file-1"\/>/.test(xml), 'then referenced');
  const j = AS.interchange.fromFCP7(xml);
  assert.strictEqual(j.name, 'Show #1'); assert.deepStrictEqual(J(j.tracks.map((t) => t.name)), ['Dialog <A>', 'Music']);
  assert.strictEqual(j.files['file-2'].path, 'C:/Media Files/Music & FX.wav');
  const c0 = j.tracks[0].clips[0]; near(c0.start, 1, 1e-9); near(c0.dur, 3, 1e-9); near(c0.off, 2, 1e-9); near(c0.gainDb, -3, 0.01); near(c0.fi, 0.5, 1e-9); near(c0.fo, 1, 1e-9);
  const m = j.tracks[1].clips[0]; near(m.gainDb, -6, 0.01, 'track volume folded into the clip level'); near(j.tracks[1].pan, 0.25, 1e-9); near(m.fi, 2, 1e-9); near(m.off, 4, 1e-9);
  const x = AS.interchange.parseXml('<a x="1 &amp; 2"><b>t&lt;</b><c/><!-- n --><d><![CDATA[<raw>]]></d></a>').children[0];
  assert.strictEqual(x.attrs.x, '1 & 2'); assert.strictEqual(x.children[0].text, 't<'); assert.strictEqual(x.children[2].text, '<raw>');
});
ok('FCP7 XML from another editor: clipitems with transitions between them ("center") become fades', () => {
  const xml = `<?xml version="1.0"?><!DOCTYPE xmeml><xmeml version="4"><sequence><name>Edit</name><rate><timebase>25</timebase></rate><media><audio><track>
    <clipitem id="c1"><name>A</name><rate><timebase>25</timebase></rate><start>0</start><end>-1</end><in>0</in><out>100</out><file id="f1"><name>a.wav</name><pathurl>file://localhost/Users/me/a.wav</pathurl></file></clipitem>
    <transitionitem><start>90</start><end>110</end><alignment>center</alignment></transitionitem>
    <clipitem id="c2"><name>B</name><start>-1</start><end>200</end><in>10</in><out>110</out><file id="f1"/></clipitem></track></audio></media></sequence></xmeml>`;
  const j = AS.interchange.fromFCP7(xml), [a, b] = j.tracks[0].clips;
  near(a.start, 0, 1e-9); near(a.dur, 4, 1e-9); near(b.start, 4, 1e-9); near(b.dur, 4, 1e-9); near(b.off, 0.4, 1e-9); assert.strictEqual(j.files.f1.path, '/Users/me/a.wav');
  assert(a.fo > 0 && b.fi > 0, 'crossfade: ' + a.fo + ' / ' + b.fi);
});
done();

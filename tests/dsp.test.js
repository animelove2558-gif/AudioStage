// Run: node tests/dsp.test.js
const path = require('path');
const D = require(path.join(__dirname, '../app/js/dsp.js'));
const E = require(path.join(__dirname, '../app/js/effects.js'));
const W = require(path.join(__dirname, '../app/js/wav.js'));
const assert = require('assert');

const sr = 44100;
const mk = (secs) => {
  const L = Math.round(secs * sr), a = new Float32Array(L), b = new Float32Array(L);
  for (let i = 0; i < L; i++) { a[i] = 0.5 * Math.sin(2 * Math.PI * 440 * i / sr); b[i] = 0.3 * Math.sin(2 * Math.PI * 660 * i / sr); }
  return [a, b];
};
let fail = 0;
const ok = (name, fn) => { try { fn(); console.log('ok   ', name); } catch (e) { fail++; console.log('FAIL ', name, e.message); } };

const src = mk(2);
const env = { noiseProfile: Object.assign(D.noiseProfile(D.genNoise(sr, 1, 'white', -30, 1), 2048), { audio: D.genNoise(sr, 1, 'white', -30, 1)[0], sr }) };
for (const fx of E.FX) {
  ok('fx:' + fx.id, () => {
    const t0 = Date.now();
    const out = fx.process(src.map((c) => c.slice()), sr, E.defaults(fx), env);
    assert.strictEqual(out.length, 2);
    for (const c of out) {
      assert(c instanceof Float32Array);
      for (let i = 0; i < c.length; i += 97) assert(Number.isFinite(c[i]), 'NaN/Inf at ' + i);
    }
    if (!['stretch', 'pitch', 'speed', 'remix', 'delsilence', 'stretchpitch'].includes(fx.id)) assert.strictEqual(out[0].length, src[0].length, 'length changed');
    if (Date.now() - t0 > 15000) throw new Error('too slow ' + (Date.now() - t0));
  });
}
for (const g of E.GEN) ok('gen:' + g.id, () => { const o = g.gen(sr, 2, E.defaults(g)); assert(o[0].length > 0); });

ok('limiter respects ceiling', () => {
  const loud = D.gainCh(mk(1), 12);
  const out = D.limiter(loud, sr, -1, 5, 100);
  assert(D.peakOf(out) <= D.fromDb(-1) + 1e-4, 'peak ' + D.peakOf(out));
});
ok('normalize hits target', () => { const o = D.normalize(mk(1), -3, false, false); assert(Math.abs(D.toDb(D.peakOf(o)) + 3) < 0.01); });
ok('stretch length', () => { const o = D.timeStretch(mk(2), sr, 1.5); assert(Math.abs(o[0].length / src[0].length - 1.5) < 0.01); });
ok('pitch keeps length + shifts frequency', () => {
  const o = D.pitchShift([src[0]], sr, 12)[0];
  assert.strictEqual(o.length, src[0].length);
  const s = D.spectrum([o.subarray(20000, 60000)], sr, 4096);
  let m = 0, mi = 0; s.db.forEach((v, i) => { if (v > m || i === 0) { m = v; mi = i; } });
  const f = mi * sr / s.N; assert(Math.abs(f - 880) < 30, 'peak at ' + f);
});
ok('spectrum peak', () => { const s = D.spectrum([src[0]], sr, 4096); let mi = 0; s.db.forEach((v, i) => { if (v > s.db[mi]) mi = i; }); assert(Math.abs(mi * sr / s.N - 440) < 15); });
ok('loudness of -20dBFS 1k sine ~ -23 LUFS', () => { const t = D.genTone(sr, 5, 1000, 1000, 'sine', -20, 1); const l = D.loudness(t, sr); assert(Math.abs(l + 23) < 1, 'got ' + l); });
ok('loudnorm hits target', () => { const fx = E.byId('loudnorm'); const o = fx.process(D.genTone(sr, 5, 1000, 1000, 'sine', -30, 1), sr, { target: -16, ceil: -1 }); assert(Math.abs(D.loudness(o, sr) + 16) < 0.5); });
ok('noise reduction lowers noise', () => {
  const noise = D.genNoise(sr, 2, 'white', -30, 1), tone = D.genTone(sr, 2, 1000, 1000, 'sine', -12, 1);
  const mix = [noise[0].map((v, i) => v + tone[0][i])];
  const prof = D.noiseProfile([noise[0].subarray(0, 20000)]);
  const out = D.noiseReduce(mix, prof, 30, 2, 0.5);
  const rms = (x) => Math.sqrt(x.reduce((a, v) => a + v * v, 0) / x.length);
  const resid = out[0].map((v, i) => v - tone[0][i]);
  assert(rms(resid.subarray(10000, 70000)) < rms(noise[0].subarray(10000, 70000)) * 0.6, 'noise not reduced');
});
ok('splice', () => { const c = [Float32Array.from([1, 2, 3, 4, 5])]; const o = D.spliceCh(c, 1, 3, [Float32Array.from([9, 9, 9])]); assert.deepStrictEqual(Array.from(o[0]), [1, 9, 9, 9, 4, 5]); });
ok('convertRate', () => { const o = D.convertRate(mk(1), 44100, 22050); assert.strictEqual(o[0].length, 22050); });
ok('wav roundtrip 16/24/32f', () => {
  for (const bits of [16, 24, 32]) {
    const buf = W.encodeWav(src, sr, bits); const d = W.decodeWav(buf);
    assert.strictEqual(d.sr, sr); assert.strictEqual(d.ch.length, 2); assert.strictEqual(d.ch[0].length, src[0].length);
    let e = 0; for (let i = 0; i < d.ch[0].length; i += 31) e = Math.max(e, Math.abs(d.ch[0][i] - src[0][i]));
    assert(e < (bits === 16 ? 1e-4 : 1e-6), bits + ' err ' + e);
  }
});
ok('stats', () => { const s = D.stats(src, sr); assert(Math.abs(s.peak - 0.5) < 1e-3); assert.strictEqual(s.channels, 2); });




// ---- v2 additions ----
const C = require(path.join(__dirname, '../app/js/flac.js'));
ok('adaptive NR / leveler / spectral edit run', () => {
  const o1 = D.adaptiveNR(src.map((c) => c.slice()), 14, 1.5, 0.7, 0.4); assert.strictEqual(o1[0].length, src[0].length);
  const o2 = D.speechLeveler(src.map((c) => c.slice()), sr, -20, 15, 12, -50); assert(Number.isFinite(o2[0][5000]));
  const tone = D.genTone(sr, 2, 1000, 1000, 'sine', -10, 1);
  const o3 = D.spectralEdit(tone, sr, { t0: 20000, t1: 60000, f0: 800, f1: 1200, mode: 'atten', gainDb: -80 });
  const rms = (x, a, b) => Math.sqrt(x.slice(a, b).reduce((s, v) => s + v * v, 0) / (b - a));
  assert(rms(o3[0], 30000, 50000) < rms(tone[0], 30000, 50000) * 0.05, 'region not attenuated');
  assert(Math.abs(rms(o3[0], 70000, 85000) - rms(tone[0], 70000, 85000)) < 0.005, 'outside region altered');
});
ok('spectral heal fills toward neighbours', () => {
  const tone = D.genTone(sr, 2, 1000, 1000, 'sine', -10, 1), o = D.spectralEdit(tone, sr, { t0: 30000, t1: 50000, f0: 900, f1: 1100, mode: 'heal' });
  assert(D.peakOf(o) > 0.2, 'healed region collapsed');
});
ok('flac encodes with valid header', () => {
  const buf = new Uint8Array(C.encodeFlac(src, sr, 16));
  assert.strictEqual(String.fromCharCode(...buf.slice(0, 4)), 'fLaC'); assert(buf.length < 2 * src[0].length * 2, 'no compression');
  const b24 = new Uint8Array(C.encodeFlac(src, sr, 24)); assert(b24.length > buf.length);
});
ok('mp3 encodes', () => {
  const vm = require('vm'), fs = require('fs'); const ctx = { console }; vm.createContext(ctx); vm.runInContext(fs.readFileSync(path.join(__dirname, '../app/vendor/lame.min.js'), 'utf8') + ';this.lamejs=lamejs;', ctx);
  global.lamejs = ctx.lamejs; const mp3 = new Uint8Array(C.encodeMp3(src, sr, 128, D.convertRate));
  assert(mp3.length > 10000 && (mp3[0] === 0xff || mp3[0] === 0x49), 'bad mp3 ' + mp3.length);
});

ok('music remix shortens/lengthens near target and stays finite', () => {
  // synthetic "song": 8 repetitions of a 3 s motif (distinct notes per beat) with a unique intro and outro
  const motif = (() => { const parts = []; [262, 330, 392, 330, 294, 370, 440, 370, 262, 330, 392, 523].forEach((f) => parts.push(D.genTone(sr, 0.25, f, f, 'saw', -14, 1)[0])); const o = new Float32Array(parts.reduce((a, p) => a + p.length, 0)); let q = 0; parts.forEach((p) => { o.set(p, q); q += p.length; }); return o; })();
  const intro = D.genNoise(sr, 2, 'pink', -20, 1)[0], outro = D.genTone(sr, 3, 100, 100, 'sine', -12, 1)[0];
  const song = new Float32Array(intro.length + motif.length * 8 + outro.length); song.set(intro); for (let k = 0; k < 8; k++) song.set(motif, intro.length + k * motif.length); song.set(outro, intro.length + motif.length * 8);
  for (const f of [0.7, 1.3]) {
    const o = D.musicRemix([song], sr, f, 4, true)[0];
    assert(Math.abs(o.length / (song.length * f) - 1) < 0.02, 'factor ' + f + ' got ' + (o.length / song.length).toFixed(3));
    for (let i = 0; i < o.length; i += 211) assert(Number.isFinite(o[i]));
  }
});

const bandAmp = (x, f, a, b) => { let re = 0, im = 0; for (let i = a; i < b; i++) { const w = 2 * Math.PI * f * i / sr; re += x[i] * Math.cos(w); im += x[i] * Math.sin(w); } return Math.hypot(re, im) / (b - a) * 2; };
ok('NMF sound remover removes learned beeper, keeps the rest', () => {
  const n = sr * 4, keep = new Float32Array(n), beep = new Float32Array(n);
  for (let i = 0; i < n; i++) { keep[i] = 0.3 * Math.sin(2 * Math.PI * 440 * i / sr) * (0.7 + 0.3 * Math.sin(2 * Math.PI * 3 * i / sr)); beep[i] = (Math.floor(i / (sr * 0.2)) % 2 ? 0 : 0.25) * Math.sin(2 * Math.PI * 2000 * i / sr); }
  const mix = [keep.map((v, i) => v + beep[i])];
  const print = beep.slice(0, sr * 2).map((v, i) => v + 0.0 * i); // the unwanted sound alone
  const out = D.soundRemoveNMF(mix, sr, print, sr, 4, 8, 20, 40)[0];
  const before2k = bandAmp(mix[0], 2000, 20000, 120000), after2k = bandAmp(out, 2000, 20000, 120000);
  const before440 = bandAmp(mix[0], 440, 20000, 120000), after440 = bandAmp(out, 440, 20000, 120000);
  assert(after2k < before2k * 0.25, 'beeper only reduced to ' + (after2k / before2k).toFixed(2));
  assert(after440 > before440 * 0.8, 'wanted tone damaged: ' + (after440 / before440).toFixed(2));
});
ok('sound classifier separates speech-like, music, ambience, sfx', () => {
  const secs = 24, n = sr * secs, speech = new Float32Array(n), music = new Float32Array(n), sfx = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / sr, gap = (t % 3.2) > 2.6, syl = Math.pow(0.5 + 0.5 * Math.sin(2 * Math.PI * 4.2 * t), 2);
    speech[i] = gap ? 0 : 0.3 * syl * (Math.sin(2 * Math.PI * 140 * t) + 0.5 * Math.sin(2 * Math.PI * 280 * t) + 0.3 * Math.sin(2 * Math.PI * 700 * t)) * (0.6 + 0.4 * Math.sin(2 * Math.PI * 0.3 * t));
    const chord = [261.6, 329.6, 392][Math.floor(t / 2) % 3]; music[i] = 0.2 * (Math.sin(2 * Math.PI * chord * t) + Math.sin(2 * Math.PI * chord * 1.5 * t) + 0.5 * Math.sin(2 * Math.PI * chord * 2 * t));
  }
  for (let k = 0; k < 6; k++) { const at = Math.floor(sr * (2 + k * 3.7)); for (let i = 0; i < 4000; i++) sfx[at + i] = (Math.random() * 2 - 1) * Math.exp(-i / 800) * 0.8; }
  const amb = D.genNoise(sr, secs, 'pink', -20, 1)[0], cls = (x) => D.classifySound([x], sr);
  const r = { speech: cls(speech), music: cls(music), ambience: cls(amb), sfx: cls(sfx) };
  assert.strictEqual(r.speech.type, 'Dialogue', JSON.stringify(r.speech));
  assert.strictEqual(r.music.type, 'Music', JSON.stringify(r.music));
  assert.strictEqual(r.ambience.type, 'Ambience', JSON.stringify(r.ambience));
  assert.strictEqual(r.sfx.type, 'Sound effects', JSON.stringify(r.sfx));
});

/* ---------------- v3: IRs, filter design, offline process effects ---------------- */
const dbOf = (x) => 20 * Math.log10(Math.max(1e-12, x));
const respOfIR = (h, f, sr0) => { let re = 0, im = 0; for (let i = 0; i < h.length; i++) { const w = 2 * Math.PI * f * i / sr0; re += h[i] * Math.cos(w); im += h[i] * -Math.sin(w); } return { mag: Math.hypot(re, im), ph: Math.atan2(im, re) }; };
ok('reverbIR: deterministic, decays, mono when width=0', () => {
  const o = { decay: 1.2, pre: 10, er: -8, diffusion: 70, density: 80, damp: 50, lowcut: 100, width: 100, size: 50 };
  const a = D.reverbIR(sr, o), b = D.reverbIR(sr, o);
  assert(a[0].length > sr * 1.2 && a[0].every((v, i) => v === b[0][i]), 'repeatable');
  const en = (x, s, e) => x.slice(s, e).reduce((t, v) => t + v * v, 0);
  assert(en(a[0], 0, sr * 0.4) > en(a[0], sr * 0.8, sr * 1.2) * 20, 'energy falls with time');
  const m = D.reverbIR(sr, { ...o, width: 0 }); assert(m[0].every((v, i) => Math.abs(v - m[1][i]) < 1e-6), 'width 0 -> identical channels');
  assert(Math.max(...a[0].slice(0, Math.round(0.009 * sr)).map(Math.abs)) < 1e-9, 'pre-delay is silent');
});
ok('curveIR: FFT-filter FIR follows the drawn curve', () => {
  const h = D.curveIR(sr, [{ f: 20, g: 0 }, { f: 700, g: 0 }, { f: 1000, g: 12 }, { f: 1400, g: 0 }, { f: 20000, g: 0 }], 4096);
  const g1k = dbOf(respOfIR(h, 1000, sr).mag), g100 = dbOf(respOfIR(h, 100, sr).mag), g8k = dbOf(respOfIR(h, 8000, sr).mag);
  assert(Math.abs(g1k - 12) < 1.5 && Math.abs(g100) < 1 && Math.abs(g8k) < 1, `1k ${g1k.toFixed(1)} 100 ${g100.toFixed(1)} 8k ${g8k.toFixed(1)}`);
});
ok('phaseIR: flat magnitude, L/R phase difference equals the drawn phase', () => {
  const [L, R] = D.phaseIR(sr, Array(10).fill(90), 4096), a = respOfIR(L, 1000, sr), b = respOfIR(R, 1000, sr);
  let d = (a.ph - b.ph) * 180 / Math.PI; while (d < -180) d += 360; while (d > 180) d -= 360;
  assert(Math.abs(dbOf(a.mag)) < 1 && Math.abs(Math.abs(d) - 90) < 6, `mag ${dbOf(a.mag).toFixed(2)} dB, diff ${d.toFixed(1)}`);
});
ok('sciFilter: Butterworth / Chebyshev / Bessel responses match theory', () => {
  const g = (s, f) => dbOf(D.sectionsResponse(s, sr, f));
  const bw = D.sciFilter(sr, 'butterworth', 'lowpass', 4, 1000); assert(Math.abs(g(bw, 1000) + 3.01) < 0.4 && Math.abs(g(bw, 4000) + 48) < 4 && Math.abs(g(bw, 50)) < 0.1, `bw ${g(bw, 1000).toFixed(2)} ${g(bw, 4000).toFixed(1)}`);
  const bh = D.sciFilter(sr, 'butterworth', 'highpass', 4, 1000); assert(Math.abs(g(bh, 1000) + 3.01) < 0.4 && g(bh, 250) < -40 && Math.abs(g(bh, 15000)) < 0.3, `hp ${g(bh, 250).toFixed(1)}`);
  const c1 = D.sciFilter(sr, 'cheby1', 'lowpass', 4, 1000, 1, 40); let lo = 0, hi = -99; for (let f = 50; f < 950; f += 25) { const v = g(c1, f); lo = Math.min(lo, v); hi = Math.max(hi, v); } assert(lo > -1.25 && hi < 0.25 && g(c1, 3000) < -40, `c1 ripple ${lo.toFixed(2)}..${hi.toFixed(2)} stop ${g(c1, 3000).toFixed(1)}`);
  const c2 = D.sciFilter(sr, 'cheby2', 'lowpass', 5, 1000, 1, 40); assert(Math.abs(g(c2, 100)) < 0.5 && g(c2, 3000) < -38, `c2 ${g(c2, 100).toFixed(2)} ${g(c2, 3000).toFixed(1)}`);
  const be = D.sciFilter(sr, 'bessel', 'lowpass', 4, 1000); assert(Math.abs(g(be, 1000) + 3) < 1.2 && Math.abs(g(be, 60)) < 0.2 && g(be, 5000) < -30, `bessel ${g(be, 1000).toFixed(2)}`);
});
const bandDb = (x, a, b, f0, f1) => { const s = D.spectrum([x.slice(a, b)], sr, 8192); let e = 1e-20; s.db.forEach((v, i) => { const f = (i * sr) / s.N; if (f >= f0 && f < f1) e += Math.pow(10, v / 10); }); return 10 * Math.log10(e); };
ok('granularShift: +12 st moves the energy up an octave, -12 st down, ratio 1 is transparent', () => {
  const tone = D.genTone(sr, 2, 440, 440, 'sine', -10, 1)[0], run = (r) => D.granularShift([tone], sr, () => r, 40, 1, 3, true)[0];
  const up = run(2), dn = run(0.5), id = run(1);
  assert(bandDb(up, 20000, 70000, 800, 960) > bandDb(up, 20000, 70000, 400, 480) + 12, 'up: energy near 880 must dominate 440');
  assert(bandDb(dn, 20000, 70000, 190, 250) > bandDb(dn, 20000, 70000, 400, 480) + 12, 'down: energy near 220 must dominate 440');
  let e = 0, s = 0; for (let i = 20000; i < 60000; i++) { e += (id[i] - tone[i]) ** 2; s += tone[i] ** 2; } assert(e / s < 0.02, 'ratio 1 error ' + (e / s).toFixed(4));
});
ok('pitchBend follows the drawn semitone curve', () => {
  const tone = D.genTone(sr, 3, 440, 440, 'sine', -10, 1)[0], o = D.pitchBend([tone], sr, [{ x: 0, y: 0 }, { x: 0.5, y: 0 }, { x: 0.6, y: 12 }, { x: 1, y: 12 }], 'high')[0];
  assert(o.length === tone.length, 'length');
  assert(bandDb(o, 20000, 50000, 400, 480) > bandDb(o, 20000, 50000, 800, 960) + 15, 'first half stays at 440');
  assert(bandDb(o, 100000, 130000, 800, 960) > bandDb(o, 100000, 130000, 400, 480) + 12, 'last half is an octave up');
});
ok('adaptive NR really reduces stationary noise, even when it starts after digital silence', () => {
  const lead = new Float32Array(Math.round(sr * 0.6)), noise = D.genNoise(sr, 3, 'white', -22, 1)[0], x = new Float32Array(lead.length + noise.length); x.set(noise, lead.length);
  const out = D.adaptiveNR([x], 24, 2, 0.6, 0.4)[0], rms = (v, a, b) => Math.sqrt(v.slice(a, b).reduce((t, q) => t + q * q, 0) / (b - a));
  const a = Math.round(sr * 2), b = Math.round(sr * 3.4); assert(rms(out, a, b) < rms(x, a, b) * 0.5, `rms ${rms(x, a, b).toFixed(4)} -> ${rms(out, a, b).toFixed(4)}`);
});ok('gainEnvelope, channelMix', () => {
  const x = [new Float32Array(1000).fill(0.5)], y = D.gainEnvelope(x, [{ x: 0, y: -60 }, { x: 1, y: 0 }], 'linear')[0]; assert(y[0] < 0.001 && Math.abs(y[999] - 0.5) < 1e-3 && Math.abs(y[500] - 0.5 * D.fromDb(-30)) < 0.01, 'envelope');
  const [l, r] = D.channelMix([new Float32Array([1, 1]), new Float32Array([0, 0])], { ll: 0, lr: 1, rl: 1, rr: 0 }); assert(l[0] === 0 && r[0] === 1, 'swap');
});
ok('declip repairs clipped peaks', () => {
  const n = sr, orig = new Float32Array(n), clipped = new Float32Array(n); for (let i = 0; i < n; i++) { orig[i] = 1.5 * Math.sin(2 * Math.PI * 200 * i / sr); clipped[i] = Math.max(-1, Math.min(1, orig[i])); }
  const fixed = D.declip([clipped], 97, 3, true)[0], err = (a) => { let e = 0; for (let i = 100; i < n - 100; i++) e += (a[i] - orig[i]) ** 2; return e; };
  assert(err(fixed) < err(clipped) * 0.5, `error ${err(clipped).toFixed(2)} -> ${err(fixed).toFixed(2)}`);
});
ok('detectAudio + deleteSilence', () => {
  const tone = D.genTone(sr, 0.5, 440, 440, 'sine', -10, 1)[0], gap = new Float32Array(sr), sig = new Float32Array(tone.length * 2 + gap.length); sig.set(tone); sig.set(tone, tone.length + gap.length);
  const regs = D.detectAudio([sig], sr, -50, 200, 50); assert(regs.length === 2 && Math.abs(regs[0][1] - tone.length) < sr * 0.03, 'regions ' + JSON.stringify(regs));
  const out = D.deleteSilence([sig], sr, -50, 200, 50)[0]; assert(Math.abs(out.length / sr - 1.1) < 0.05, 'length ' + (out.length / sr).toFixed(3));
});
ok('hissReduce lowers HF noise only', () => {
  const tone = D.genTone(sr, 2, 500, 500, 'sine', -12, 1)[0], noise = D.genNoise(sr, 2, 'white', -30, 1)[0], mix = tone.map((v, i) => v + noise[i]), out = D.hissReduce([mix], sr, 4000, 24, 2, 0.6)[0];
  const band = (x, f0, f1) => { const s = D.spectrum([x.slice(20000, 80000)], sr, 4096); let e = 0; s.db.forEach((v, i) => { const f = (i * sr) / s.N; if (f >= f0 && f < f1) e += Math.pow(10, v / 10); }); return 10 * Math.log10(e); };
  assert(band(out, 5000, 15000) < band(mix, 5000, 15000) - 8 && Math.abs(band(out, 400, 600) - band(mix, 400, 600)) < 1.5, `hf ${band(mix, 5000, 15000).toFixed(1)} -> ${band(out, 5000, 15000).toFixed(1)}`);
});
ok('doppler: pitch falls as the source passes', () => {
  const tone = D.genTone(sr, 3, 1000, 1000, 'sine', -10, 1)[0], o = D.doppler([tone], sr, 150, 4, true)[0], zc = (a, b) => { let c = 0; for (let i = a + 1; i < b; i++) if (o[i - 1] < 0 && o[i] >= 0) c++; return c / ((b - a) / sr); };
  assert(zc(Math.round(sr * 0.2), Math.round(sr * 0.7)) > zc(Math.round(sr * 2.3), Math.round(sr * 2.8)) + 40, `approach ${zc(Math.round(sr * 0.2), Math.round(sr * 0.7)).toFixed(0)} Hz, recede ${zc(Math.round(sr * 2.3), Math.round(sr * 2.8)).toFixed(0)} Hz`);
});
/* ---- DeReverb: a dry, speech-like signal (syllables with pauses) through a synthetic convolution reverb ---- */
const drSr = 22050;
function drDry() {
  const L = drSr * 3, x = new Float32Array(L); let seed = 1; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
  for (let b = 0; b < 7; b++) { const s = Math.round((0.1 + b * 0.4) * drSr), n = Math.round(0.15 * drSr), f = 200 + 60 * b; for (let i = 0; i < n; i++) { const e = Math.sin((Math.PI * i) / n); x[s + i] = e * (0.4 * Math.sin((2 * Math.PI * f * i) / drSr) + 0.2 * Math.sin((2 * Math.PI * 2.5 * f * i) / drSr) + 0.1 * rnd()); } }
  return x;
}
function drWet(dry, decay) { // direct sound + a reverb tail of equal energy (direct-to-reverb ratio 0 dB)
  const ir = D.reverbIR(drSr, { decay, pre: 0, er: -6 })[0]; let e = 0; for (const v of ir) e += v * v; for (let i = 0; i < ir.length; i++) ir[i] /= Math.sqrt(e); ir[0] += 1;
  let N = 1; while (N < dry.length + ir.length) N <<= 1; const ar = new Float64Array(N), ai = new Float64Array(N), br = new Float64Array(N), bi = new Float64Array(N); ar.set(dry); br.set(ir);
  D.fft(ar, ai, false); D.fft(br, bi, false); for (let k = 0; k < N; k++) { const r = ar[k] * br[k] - ai[k] * bi[k], i = ar[k] * bi[k] + ai[k] * br[k]; ar[k] = r; ai[k] = i; } D.fft(ar, ai, true);
  return Float32Array.from(ar.subarray(0, dry.length));
}
/* mean distance (dB) between the 10 ms energy envelopes, both level-matched, floored 50 dB under the dry peak: the tails in the pauses count */
function drDist(dry, y) {
  const rms = (x) => Math.sqrt(x.reduce((s, v) => s + v * v, 0) / x.length), g = rms(dry) / rms(y), hop = Math.round(drSr * 0.01), n = Math.floor(dry.length / hop), ea = [], eb = [];
  for (let i = 0; i < n; i++) { let a = 0, b = 0; for (let j = i * hop; j < (i + 1) * hop; j++) { a += dry[j] * dry[j]; b += (y[j] * g) ** 2; } ea.push(10 * Math.log10(a / hop + 1e-12)); eb.push(10 * Math.log10(b / hop + 1e-12)); }
  const top = Math.max(...ea); let d = 0; for (let i = 0; i < n; i++) d += Math.abs(Math.max(ea[i], top - 50) - Math.max(eb[i], top - 50)); return d / n;
}
ok('dereverb: reverberant speech comes out closer to the dry signal', () => {
  const dry = drDry();
  for (const decay of [0.4, 0.8]) {
    const wet = drWet(dry, decay), before = drDist(dry, wet), known = D.dereverb([wet], drSr, 100, 'all', 0, decay)[0], est = D.dereverb([wet], drSr, 100, 'all', 0, 0);
    const a = drDist(dry, known), b = drDist(dry, est[0]);
    assert(a < before * 0.85 && b < before * 0.9, `T60 ${decay}: wet ${before.toFixed(1)} dB → known T60 ${a.toFixed(1)}, estimated (${est.t60.toFixed(2)} s) ${b.toFixed(1)}`);
  }
});
ok('dereverb: more Amount removes more, 0 % leaves the audio as it was', () => {
  const dry = drDry(), wet = drWet(dry, 0.8), d = (amt) => drDist(dry, D.dereverb([wet], drSr, amt, 'all', 0, 0.8)[0]);
  assert(d(100) < d(50) && d(50) < d(0), `100% ${d(100).toFixed(1)} · 50% ${d(50).toFixed(1)} · 0% ${d(0).toFixed(1)}`);
  const o = D.dereverb([wet], drSr, 0, 'all', 0, 0.8)[0]; let err = 0; for (let i = 0; i < o.length; i++) err = Math.max(err, Math.abs(o[i] - wet[i])); assert(err < 1e-4, 'amount 0 changed the audio by ' + err);
});
ok('dereverb: T60 is estimated from the decays in the file', () => {
  const dry = drDry();
  for (const decay of [0.4, 0.8]) { const t = D.estimateT60([drWet(dry, decay)], drSr); assert(t > decay * 0.6 && t < decay * 1.3, `room ${decay} s → estimated ${t.toFixed(2)} s`); }
  assert.strictEqual(D.estimateT60([new Float32Array(drSr)], drSr), 0, 'silence has no decay');
});
ok('dereverb: Processing Focus = Low reduces the highs less than All', () => {
  const half = 1025, wl = D.dereverbOpts(drSr, 2048, 512, 80, 'low', 0.8).w, wa = D.dereverbOpts(drSr, 2048, 512, 80, 'all', 0.8).w, k8k = Math.round((8000 * 2048) / drSr), k200 = Math.round((200 * 2048) / drSr);
  assert(wl.length === half && wl[k200] === 1 && wl[k8k] < 0.5 && wa[k8k] === 1, `low focus: 200 Hz ${wl[k200]}, 8 kHz ${wl[k8k]}`);
});
ok('dereverb: the gain compensation (dB) is applied to the output', () => {
  const wet = drWet(drDry(), 0.8), a = D.dereverb([wet], drSr, 60, 'mid', 0, 0.8)[0], b = D.dereverb([wet], drSr, 60, 'mid', 6, 0.8)[0];
  assert(Math.abs(D.toDb(D.peakOf([b]) / D.peakOf([a])) - 6) < 0.01);
});
ok('dereverb: the real-time worklet (as-dereverb) renders the same as the offline effect', () => {
  const vm = require('vm'), fs = require('fs'), procs = {};
  const sb = { Math, Float32Array, Float64Array, Array, Object, globalThis: null, sampleRate: drSr, AudioWorkletProcessor: class { constructor() { this.port = { postMessage() {} }; } }, registerProcessor: (n, c) => (procs[n] = c) };
  sb.globalThis = sb; vm.createContext(sb);
  for (const f of ['dsp.js', 'worklet.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, '../app/js', f), 'utf8'), sb, { filename: f });
  const wet = drWet(drDry(), 0.8), proc = new procs['as-dereverb'](), LAT = 3072, live = new Float32Array(wet.length + LAT);
  const params = { amount: [70], focus: [2], t60: [0.8] };
  for (let s = 0; s < live.length; s += 128) {
    const inp = new Float32Array(128); inp.set(wet.subarray(s, s + 128)); const out = [new Float32Array(128), new Float32Array(128)];
    proc.process([[inp, inp]], [out], params); live.set(out[0].subarray(0, Math.min(128, live.length - s)), s);
  }
  const off = D.dereverb([wet], drSr, 70, 'mid', 0, 0.8)[0]; let err = 0, pk = 0;
  for (let i = 0; i < wet.length - 2048; i++) { err = Math.max(err, Math.abs(live[i + LAT] - off[i])); pk = Math.max(pk, Math.abs(off[i])); }
  assert(err < 1e-5 * Math.max(1, pk), 'live vs offline max difference ' + err);
  // the delay the rack declares for latency compensation is the real one (STFT effects: 2 × (N − hop))
  const sb2 = { Math, Float32Array, Float64Array, Array, Object, sampleRate: drSr, AudioWorkletProcessor: class { constructor() { this.port = { postMessage() {} }; } }, registerProcessor: (n, c) => (procs[n] = c) };
  sb2.globalThis = sb2; vm.createContext(sb2); vm.runInContext(fs.readFileSync(path.join(__dirname, '../app/js/worklet.js'), 'utf8'), sb2);
  const dn = new procs['as-denoise'](), imp = new Float32Array(8192); imp[100] = 1; let at = -1;
  for (let s = 0; s < imp.length; s += 128) { const o = [new Float32Array(128), new Float32Array(128)]; dn.process([[imp.subarray(s, s + 128), imp.subarray(s, s + 128)]], [o], { reduce: [0], sens: [1.5], smooth: [0.7], track: [0.4] }); o[0].forEach((v, i) => { if (Math.abs(v - 1) < 1e-4) at = s + i; }); }
  const rs = require('fs').readFileSync(path.join(__dirname, '../app/js/rack2.js'), 'utf8');
  const declared = (id) => { const i = rs.indexOf(`def('${id}', {`), m = /latency: (\d+)/.exec(rs.slice(i, i + 300)); return m ? +m[1] : NaN; };
  assert(at > 100, 'the impulse never came out'); for (const id of ['denoise', 'anr', 'dereverb']) assert.strictEqual(declared(id), at - 100, id + ' declared latency');
});
console.log(fail ? `\n${fail} FAILED` : '\nall passed');
process.exit(fail ? 1 : 0);




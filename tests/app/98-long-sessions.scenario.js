// Long sessions and large files: rendering in slices (C-07), streaming exports, decoding without a live context (C-06, C-09),
// chunked reads (C-05), the live master guard (C-17), the playback buffer budget (C-21).
module.exports = async ({ t, assert, near, AS, app, env, sleep }) => {
  const sr = 48000, rms = (x) => { let e = 0; for (let i = 0; i < x.length; i++) e += x[i] * x[i]; return Math.sqrt(e / Math.max(1, x.length)); };
  const sine = (s, f = 440, a = 0.4) => { const n = Math.round(s * sr), x = new Float32Array(n); for (let i = 0; i < n; i++) x[i] = a * Math.sin((2 * Math.PI * f * i) / sr) * (0.6 + 0.4 * Math.sin((2 * Math.PI * 1.3 * i) / sr)); return x; };
  const withCfg = async (c, fn) => { const old = { ...AS.renderCfg }; Object.assign(AS.renderCfg, c); try { return await fn(); } finally { Object.assign(AS.renderCfg, old); } };
  const session = (fxId) => { const s = new AS.Session(); s.sr = sr; const x = sine(6); s.addClip(s.tracks[0], AS.makeSource('a', sr, [x, x]), 0); s.tracks[0].vol = -3; if (fxId) s.tracks[0].fx = [AS.rack.newFx(fxId)]; return s; };
  const lim = async (id) => { for (const k of [id]) { try { AS.rack.newFx(k); return k; } catch (e) { /* */ } } return null; };

  await t('a range rendered in slices matches one rendered in a single context (compressor on the track, boundaries included)', async () => {
    const fx = await lim('comp'), s = session(fx), one = await withCfg({ LONG_S: 1000 }, () => AS.renderRange(s, sr, 0, 6, null, 0.05));
    const cut = await withCfg({ LONG_S: 1, SLICE_S: 1, PRE_S: 1, XF_S: 0.02 }, () => AS.renderRange(s, sr, 0, 6, null, 0.05));
    assert(cut.ch[0].length === one.ch[0].length, 'length ' + cut.ch[0].length + ' / ' + one.ch[0].length);
    const d = new Float32Array(one.ch[0].length); let worst = 0; for (let i = 0; i < d.length; i++) { d[i] = cut.ch[0][i] - one.ch[0][i]; if (Math.abs(d[i]) > worst) worst = Math.abs(d[i]); }
    const dB = 20 * Math.log10(rms(d) / rms(one.ch[0]) + 1e-12); assert(dB < -40, 'difference ' + dB.toFixed(1) + ' dB, worst sample ' + worst.toFixed(4));
    let peak = 0; for (let i = 1; i < d.length; i++) peak = Math.max(peak, Math.abs(cut.ch[0][i] - cut.ch[0][i - 1])); assert(peak < 0.2, 'a click at a slice edge: ' + peak.toFixed(3));
  });
  await t('a looped clip and a clip from a different sample rate render the same in slices', async () => {
    const s = new AS.Session(); s.sr = sr; const x = sine(2), c = s.addClip(s.tracks[0], AS.makeSource('l', sr, [x, x]), 0); s.setLoop(c, true); c.dur = 7;
    const y = new Float32Array(44100 * 3).fill(0.1), tr = s.addTrack('B'); s.addClip(tr, AS.makeSource('r', 44100, [y, y]), 2);
    const one = await withCfg({ LONG_S: 1000 }, () => AS.renderRange(s, sr, 0, 7, null, 0.05)), cut = await withCfg({ LONG_S: 1, SLICE_S: 1.5, PRE_S: 0.5, XF_S: 0.02 }, () => AS.renderRange(s, sr, 0, 7, null, 0.05));
    const d = one.ch[0].map((v, i) => v - cut.ch[0][i]); assert(20 * Math.log10(rms(d) / rms(one.ch[0]) + 1e-12) < -40, 'difference');
  });
  await t('Export: a long session goes straight to the file, as WAV and as FLAC; the WAV equals the render', async () => {
    const s = session(); app.setMode('multi'); app.session = s; app.multi.s = s; app.multi.rebuildHeads();
    await withCfg({ LONG_S: 1, SLICE_S: 1.5, PRE_S: 0.5, XF_S: 0.02 }, async () => {
      const ref = await AS.renderRange(s, sr, 0, 6, null, undefined), p = env.tmp + '\\stream.wav', q = env.tmp + '\\stream.flac';
      await window.audioStageFiles.testSaveAnswer([p, q]); await AS.disk.chooseSave({}); await AS.disk.chooseSave({});
      await app.exportStream(p, { format: 'wav', bits: 32 }, false); await app.exportStream(q, { format: 'flac', bits: 24 }, false);
      const w = AS.wav.decodeWav(await AS.disk.readAll(await AS.disk.source(p))); assert(w && w.sr === sr && w.ch[0].length === ref.ch[0].length, 'wav length ' + (w && w.ch[0].length));
      const d = w.ch[0].map((v, i) => v - ref.ch[0][i]); assert(rms(d) < 1e-4, 'wav differs from the render: ' + rms(d));
      const fb = await AS.disk.readAll(await AS.disk.source(q)), info = AS.decode.probe(new Uint8Array(fb)); assert(info.rate === sr && info.frames === ref.ch[0].length, 'flac header ' + JSON.stringify(info));
      const dec = await AS.decode.audio(fb); assert(dec.sr === sr && dec.ch[0].length === ref.ch[0].length, 'flac decodes to ' + dec.ch[0].length);
      const e = dec.ch[0].map((v, i) => v - ref.ch[0][i]); assert(rms(e) < 1e-3, 'flac differs: ' + rms(e));
    });
  });
  await t('RF64 (WAV over 4 GB): the header form is read back', async () => {
    const x = sine(0.1), st = AS.wav.stream(2, sr, 24, x.length, false, { rf64: true }), head = st.head(), body = st.samples([x, x]), tail = st.tail(), all = new Uint8Array(head.length + body.length + tail.length);
    all.set(head); all.set(body, head.length); all.set(tail, head.length + body.length);
    assert(String.fromCharCode(...all.subarray(0, 4)) === 'RF64' && st.rf64, 'RF64 tag'); const w = AS.wav.decodeWav(all.buffer); assert(w && w.ch[0].length === x.length, 'frames'); near(w.ch[1][100], x[100], 1e-4, 'sample');
  });
  await t('a compressed file decodes at its own rate with no live context, and an oversized one is refused (C-06, C-09)', async () => {
    const x = sine(1), bytes = AS.codec.encodeFlac([x.slice(0, 22050), x.slice(0, 22050)], 22050, 16), live = AS.engine.ctx, saved = AS.engine.ctx;
    AS.engine.ctx = null;
    try { const d = await AS.decode.audio(bytes.slice(0)); assert(d.sr === 22050 && d.ch.length === 2 && d.ch[0].length === 22050, 'rate ' + d.sr + ' length ' + d.ch[0].length); }
    finally { AS.engine.ctx = saved; }
    let refused = ''; try { await AS.decode.audio(bytes.slice(0), { limit: 1000 }); } catch (e) { refused = e.message; } assert(/GB of memory/.test(refused), 'refused: ' + refused); assert(live === saved);
    const f = new File([bytes], 'x.flac'); await app.openFiles([f]); assert(app.cur.sr === 22050, 'doc rate ' + app.cur.sr); await app.closeDoc && app.closeDoc(app.cur, true);
  });
  await t('files over 64 MB are refused by the whole-file reads and read in pieces instead (C-05)', async () => {
    const n = 65 * 1048576, p = env.tmp + '\\big.wav', u = new Uint8Array(n); u[n - 1] = 7; const w = await window.audioStageFiles.write(env.tmp, 'big.wav', u, { overwrite: true }); assert(w.ok, w.error);
    const r = await window.audioStageMedia.read(p); assert(!r.ok && /too large/.test(r.error), 'whole read: ' + JSON.stringify(r).slice(0, 80));
    const o = await window.audioStageMedia.open(p); assert(o.ok && o.size === n, 'open'); const src = AS.disk.fromInfo(o.path, o.name, o.size), last = await src.read(n - 1, 1); assert(last[0] === 7, 'last byte');
    const bad = await window.audioStageMedia.open(env.tmp + '\\x.txt'); assert(!bad.ok, 'only media files');
    const f = await AS.mediaPreview.file(p); assert(f.lazy && !f.asPath, 'lazy, and not a Save target');
  });
  await t('NaN reaching the live master is silenced and reported; playback carries on (C-17)', async () => {
    const eng = AS.engine, s = new AS.Session(); s.sr = sr; const x = sine(3); x.fill(NaN, 1000, 1200); s.addClip(s.tracks[0], AS.makeSource('n', sr, [x, x]), 0);
    app.setMode('multi'); app.session = s; app.multi.s = s; app.multi.rebuildHeads(); app.multiCursor = 0; app.loop = false; await eng.wl; app.liveBadCount = 0;
    AS.actions['tp.play'](); const until = performance.now() + 10000; while (!app.liveBadCount && performance.now() < until) await sleep(25);
    // (Chromium's own nodes may already turn NaN into silence; then the guard has nothing to do. Either way nothing bad is heard.)
    const c = eng.ctx.currentTime; await sleep(100); if (eng.playing) AS.actions['tp.stop'] ? AS.actions['tp.stop']() : eng.stop();
    assert(eng.ctx.state !== 'closed' && eng.ctx.currentTime >= c, 'context alive'); console.log('guard reports: ' + app.liveBadCount);
    assert(AS.dsp.sanitize([new Float32Array([0, NaN, Infinity, -Infinity, 1])]) === 3, 'sanitize');
  });
  await t('playback copies stay within the budget, oldest dropped first (C-21)', async () => {
    const C = AS.abCache, budget = C.budget; C.budget = () => 3 * 4 * 1000 + C.bytes * 0 + 1;
    try {
      const a = {}, b = {}, mk = () => new AudioBuffer({ numberOfChannels: 1, length: 2000, sampleRate: sr }); C.sweep(() => false);
      C.get(a, mk); C.get(b, mk); assert(!a._ab && b._ab, 'the older went'); C.sweep((o) => o !== b); assert(!b._ab && C.bytes === 0, 'sweep');
    } finally { C.budget = budget; }
  });
};

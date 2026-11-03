// Roadmap 2.2 — selection & playback in the real app: Snap to Zero Crossings / Adjust selection, Skip Selection and
// Preview Edit (the real output recorded on the audio thread), Shuttle J/K/L, Scrub, range markers + Playlist,
// Export Ranges (files written by the desktop app).
module.exports = async ({ t, AS, app, assert, near, sleep, env }) => {
  const sr = 44100, eng = AS.engine, w = app.wave;
  // 0–1 s: 200 Hz · 1–2 s: 400 Hz · 2–3 s: 800 Hz (each section tells where playback was)
  const x = new Float32Array(sr * 3); for (let i = 0; i < x.length; i++) { const f = i < sr ? 200 : i < 2 * sr ? 400 : 800; x[i] = 0.4 * Math.sin(2 * Math.PI * f * i / sr + 0.3); }
  /* the captured output is at the device rate (often 48 kHz), not the file's: R = ctx.sampleRate */
  let R = 48000;
  const amp = (y, f, c, n) => { n = n || 2048; c = Math.round(c); let re = 0, im = 0, ws = 0; for (let i = 0; i < n; i++) { const j = c - n / 2 + i, wv = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / n); ws += wv; re += (y[j] || 0) * wv * Math.cos(2 * Math.PI * f * j / R); im += (y[j] || 0) * wv * Math.sin(2 * Math.PI * f * j / R); } return 2 * Math.hypot(re, im) / ws; };
  /* what the speakers get while fn() plays: the master output recorded on the audio thread */
  async function capture(fn, secs) {
    eng.init(); await eng.wl; await eng.ctx.resume(); R = eng.ctx.sampleRate; const rec = eng.recorder(1); eng.master.connect(rec.node); await sleep(60);
    await fn(); await sleep(secs * 1000); const y = (await rec.stop())[0]; try { eng.master.disconnect(rec.node); } catch (e) { /* */ }
    let s0 = 0; while (s0 < y.length && Math.abs(y[s0]) < 0.01) s0++; return y.subarray(s0); // from the first sound
  }
  const dominant = (y, sec) => [200, 400, 800].map((f) => [f, amp(y, f, sec * R)]).sort((a, b) => b[1] - a[1])[0][0];
  const halt = () => { if (eng.playing) AS.actions['tp.stop'](); };

  await t('setup: a 3-section test file', async () => {
    app.setMode('wave'); await app.openFiles([new File([AS.wav.encodeWav([x], sr, 32, false)], 'playback-test.wav')]);
    assert(app.cur && app.cur.name === 'playback-test.wav'); w.zoomAll();
  });
  await t('Snap to Zero Crossings: a dragged selection starts and ends on zero crossings; Adjust Inward / Outward', async () => {
    const d = app.cur, r = w.mainC.getBoundingClientRect(), ev = (s) => ({ button: 0, clientX: r.left + w.s2x(s), clientY: r.top + 30, shiftKey: false });
    AS.actions['edit.zerosnap'](); assert(app.editSettings.zeroSnap);
    w.onDown(ev(12345)); w.onMove(ev(30000)); w.onUp();
    const isZ = (k) => Math.sign(x[k - 1]) !== Math.sign(x[k]); assert(isZ(d.sel.a) && isZ(d.sel.b), `edges ${d.sel.a} ${d.sel.b}`);
    AS.actions['edit.zerosnap'](); assert(!app.editSettings.zeroSnap);
    d.sel = { a: 12345, b: 30000 }; AS.actions['edit.z.in'](); assert(isZ(d.sel.a) && isZ(d.sel.b) && d.sel.a >= 12345 && d.sel.b <= 30000, 'inward');
    d.sel = { a: 12345, b: 30000 }; AS.actions['edit.z.out'](); assert(isZ(d.sel.a) && isZ(d.sel.b) && d.sel.a <= 12345 && d.sel.b >= 30000, 'outward');
    d.sel = { a: 12345, b: 30000 }; AS.actions['edit.z.rr'](); assert(d.sel.a === 12345 && isZ(d.sel.b) && d.sel.b >= 30000, 'right side to right');
  });
  await t('Skip Selection: playback jumps over the selection (recorded output: 200 Hz then 800 Hz, never 400 Hz)', async () => {
    halt(); const d = app.cur; d.sel = { a: sr, b: 2 * sr }; app.editSettings.preRoll = 0.5; AS.actions['tp.skipsel'](); assert(app.skipSel);
    const y = await capture(() => AS.actions['tp.play'](), 1.2); halt();
    assert(dominant(y, 0.25) === 200, 'pre-roll part'); assert(dominant(y, 0.8) === 800, 'after the jump: ' + dominant(y, 0.8));
    for (let c = 2048; c < 1.0 * R; c += 2048) assert(amp(y, 400, c) < 0.02, '400 Hz (the selection) heard at ' + (c / R).toFixed(2) + ' s');
    AS.actions['tp.skipsel'](); assert(!app.skipSel);
  });
  await t('Preview Edit: pre-roll + post-roll, as the cut will sound, then stops by itself', async () => {
    halt(); const d = app.cur; d.sel = { a: sr, b: 2 * sr }; app.editSettings.preRoll = 0.4; app.editSettings.postRoll = 0.4;
    const y = await capture(() => AS.actions['tp.preview'](), 1.3);
    assert(!eng.playing, 'stopped by itself'); assert(dominant(y, 0.2) === 200 && dominant(y, 0.6) === 800, 'pre → post');
    let last = y.length - 1; while (last > 0 && Math.abs(y[last]) < 0.01) last--; near(last / R, 0.8, 0.03, 'length = pre-roll + post-roll');
    assert(d.sel.a === sr && d.sel.b === 2 * sr, 'the selection is kept');
  });
  await t('Shuttle: L = 1×, L again = 2× (an octave up), J = reverse, K = stop', async () => {
    halt(); const d = app.cur; d.sel = { a: 0, b: 0 };
    try {
      await AS.actions['tp.shuttle.l'](); assert(eng.playing && eng.rate === 1, 'rate ' + eng.rate);
      let y = await capture(() => {}, 0.3); assert(dominant(y, 0.1) === 200, '1×');
      await AS.actions['tp.shuttle.l'](); assert(eng.rate === 2);
      y = await capture(() => {}, 0.3); near(amp(y, 400, 0.1 * R), 0.4, 0.05, '2×: 200 Hz content heard at 400 Hz');
      const p0 = eng.pos(); await AS.actions['tp.shuttle.j'](); assert(eng.rate === -1, 'reverse'); await sleep(300); assert(eng.pos() < p0, `moves backwards ${eng.pos()} < ${p0}`);
      await AS.actions['tp.shuttle.k'](); assert(!eng.playing, 'K stops'); assert(d.sel.a > 0 && d.sel.a < 2 * sr, 'the cursor stays where shuttle stopped');
    } finally { halt(); }
  });
  await t('Scrub: dragging in the ruler plays grains that follow the drag direction (Waveform and Multitrack)', async () => {
    halt();
    const real = AS.playx.grain, got = []; AS.playx.grain = (ctx, dest, buf, pos, rate, dur) => { got.push({ pos, rate, n: buf.numberOfChannels }); return real(ctx, dest, buf, pos, rate, dur); };
    try {
      const r = w.rulerC.getBoundingClientRect(), ev = (s) => ({ button: 0, clientX: r.left + w.s2x(s), clientY: r.top + 5 });
      w.rulerC.dispatchEvent(new MouseEvent('mousedown', ev(sr))); await sleep(60);
      for (let k = 1; k <= 6; k++) { w.onMove(ev(sr + k * 2000)); await sleep(50); }
      for (let k = 1; k <= 6; k++) { w.onMove(ev(sr + 12000 - k * 2000)); await sleep(50); } w.onUp();
      assert(got.length >= 6, 'grains: ' + got.length); assert(got.some((g) => g.rate > 0) && got.some((g) => g.rate < 0), 'forward and backward grains');
      // Multitrack: grains come from the cached session mix
      app.setMode('multi'); const s = new AS.Session(); s.tracks = []; const tr = s.addTrack('A'); s.addClip(tr, AS.makeSource('a', sr, [x]), 0); app.session = s; app.multi.s = s; app.multi.rebuildHeads(); app.multi.resize();
      await app.mixBuffer(); got.length = 0;
      const m = app.multi, mr = m.rulerC.getBoundingClientRect(), mev = (tt) => ({ button: 0, clientX: mr.left + m.t2x(tt), clientY: mr.top + 5 });
      m.rulerC.dispatchEvent(new MouseEvent('mousedown', mev(0.5))); await sleep(60); for (let k = 1; k <= 4; k++) { m.onMove(mev(0.5 + k * 0.05)); await sleep(50); } m.onUp();
      assert(got.length >= 2, 'multitrack grains ' + got.length); assert(!eng.playing); near(app.multiCursor, 0.7, 0.02, 'playhead follows');
      app.setMode('wave');
    } finally { AS.playx.grain = real; }
  });
  await t('Range markers (M over a selection) → Playlist (order + loops) plays them in order; undo', async () => {
    halt(); const d = app.cur; d.sel = { a: 2 * sr, b: Math.round(2.3 * sr) }; AS.actions['edit.marker']();
    d.sel = { a: Math.round(0.2 * sr), b: Math.round(0.5 * sr) }; AS.actions['edit.marker']();
    const R = d.ranges(); assert(R.length === 2 && R[0].a === Math.round(0.2 * sr), 'two ranges'); assert(document.querySelector('#markerList .mk.range'), 'listed as ranges');
    AS.panels.show('playlist'); const pb = AS.panels.defs.playlist.body;
    pb.querySelector('.pl-sel').value = R[1].id; pb.querySelector('[data-a="add"]').click(); pb.querySelector('.pl-sel').value = R[0].id; pb.querySelector('[data-a="add"]').click();
    assert(d.playlist.length === 2 && d.playlist[0].id === R[1].id, 'order');
    const loops = pb.querySelectorAll('.pl-loops')[0]; loops.value = 2; loops.dispatchEvent(new Event('change', { bubbles: true })); assert(d.playlist[0].loops === 2);
    const y = await capture(() => pb.querySelector('[data-a="play"]').click(), 1.1);
    // 800 Hz range twice (0.6 s), then the 200 Hz range (0.3 s)
    assert(dominant(y, 0.15) === 800 && dominant(y, 0.45) === 800 && dominant(y, 0.75) === 200, 'playlist order / loops');
    assert(!eng.playing, 'stopped at the end');
    AS.actions['edit.undo'](); assert(d.playlist[0].loops === 1, 'loops undo'); AS.actions['edit.undo'](); AS.actions['edit.undo'](); assert(!d.playlist.length, 'playlist undo');
    AS.panels.hide('playlist');
  });
  await t('Export Ranges: one file per range marker, named from the template (desktop: written to the folder)', async () => {
    const d = app.cur, dir = env.tmp + '\\ranges';
    const r = await app.exportRanges({ fmt: 'wav16', template: '{n} {marker} ({file})', dir });
    assert(r && r.names.length === 2, JSON.stringify(r)); assert(r.names[0] === '01 Range 2 (playback-test).wav', r.names[0]);
    for (const [i, n] of r.names.entries()) {
      const f = await window.audioStageMedia.read(dir + '\\' + n); assert(f.ok, n);
      const w2 = AS.wav.decodeWav(f.data.buffer.slice(f.data.byteOffset, f.data.byteOffset + f.data.byteLength)); const R = d.ranges()[i];
      assert(w2.ch[0].length === R.b - R.a, `${n}: ${w2.ch[0].length} samples`);
    }
    d.dirty = false; AS.actions['file.close']();
  });
};

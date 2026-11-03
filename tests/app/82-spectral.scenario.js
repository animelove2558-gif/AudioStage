// Roadmap 2.1 — spectral editing in the real Waveform editor: Lasso / Brush selections (+ Delete, undo), Spot Healing
// Brush, Auto-select Harmonics, Spectral Pitch Display and the display settings.
module.exports = async ({ t, AS, app, assert, near, sleep }) => {
  const sr = 44100, L = sr * 2, D = AS.dsp, w = app.wave;
  const x = new Float32Array(L);
  for (let h = 1; h <= 5; h++) for (let i = Math.round(0.5 * sr); i < 1.5 * sr; i++) x[i] += (0.3 / h) * Math.sin(2 * Math.PI * 220 * h * i / sr);
  for (let i = 0; i < L; i++) x[i] += 0.1 * Math.sin(2 * Math.PI * 3000 * i / sr);
  const click = Math.round(1.75 * sr); for (let i = 0; i < 30; i++) x[click + i] += i % 2 ? -0.7 : 0.7;
  const energy = (ch, a, b) => { let e = 0; for (let i = a; i < b; i++) e += ch[i] * ch[i]; return e; };
  /* amplitude of a sine at f around sample c (Hann-windowed DTFT) */
  const amp = (y, f, c, n) => { n = n || 4096; c = Math.round(c); let re = 0, im = 0, ws = 0; for (let i = 0; i < n; i++) { const j = c - n / 2 + i, wv = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / n); ws += wv; re += y[j] * wv * Math.cos(2 * Math.PI * f * j / sr); im += y[j] * wv * Math.sin(2 * Math.PI * f * j / sr); } return 2 * Math.hypot(re, im) / ws; };
  const ev = (s, f, o) => { const r = w.mainC.getBoundingClientRect(); return { button: 0, clientX: r.left + w.s2x(s), clientY: r.top + w.f2y(f, 0), shiftKey: false, ...(o || {}) }; };
  const stroke = (pts, o) => { w.onDown(ev(pts[0][0], pts[0][1], o)); for (const p of pts.slice(1)) w.onMove(ev(p[0], p[1], o)); w.onUp(); };

  await t('setup: a file in the Spectral Frequency Display', async () => {
    app.setMode('wave'); await app.openFiles([new File([AS.wav.encodeWav([x], sr, 32, false)], 'spectral-test.wav')]);
    assert(app.cur && app.cur.name === 'spectral-test.wav'); AS.actions['view.spec'](); assert(w.mode === 'spec'); w.zoomAll();
  });
  await t('Lasso: free-form region → Delete removes 3 kHz inside it only; undo', async () => {
    const d = app.cur; app.setTool('lasso'); assert(document.querySelector('#specTools [data-tool="lasso"]').classList.contains('on'));
    stroke([[0.2 * sr, 2200], [0.8 * sr, 2200], [0.8 * sr, 4000], [0.2 * sr, 4000], [0.2 * sr, 2300]]);
    assert(d.spec && d.spec.kind === 'lasso' && d.spec.pts.length >= 4, 'lasso ' + JSON.stringify(d.spec && d.spec.kind));
    const before = d.ch[0].slice(); await AS.actions['sp.delete']();
    assert(d.undoStack[d.undoStack.length - 1].label === 'Spectral Delete', 'undo step');
    assert(amp(d.ch[0], 3000, 0.5 * sr) < 0.003, '3 kHz inside the lasso removed: ' + amp(d.ch[0], 3000, 0.5 * sr)); near(amp(before, 3000, 0.5 * sr), 0.1, 0.01);
    near(amp(d.ch[0], 3000, 1.2 * sr), 0.1, 0.005, '3 kHz after the lasso kept'); near(amp(d.ch[0], 220, 0.7 * sr), amp(before, 220, 0.7 * sr), 0.005, 'the note (below the lasso) kept');
    near(energy(d.ch[0], Math.round(1.6 * sr), Math.round(1.7 * sr)), energy(before, Math.round(1.6 * sr), Math.round(1.7 * sr)), energy(before, Math.round(1.6 * sr), Math.round(1.7 * sr)) * 0.01, 'outside untouched');
    AS.actions['edit.undo'](); assert(app.cur.ch[0].every((v, i) => v === before[i]), 'undo restores the audio');
  });
  await t('Brush: painted stroke, Shift adds to it, brush size [ / ]', async () => {
    const d = app.cur; app.setTool('brush'); assert(!document.querySelector('#brushSize').hidden, 'brush size control');
    stroke([[0.3 * sr, 3000], [0.35 * sr, 3000], [0.4 * sr, 3000]]); const n1 = d.spec.pts.length; assert(d.spec.kind === 'brush' && n1 >= 2);
    stroke([[0.9 * sr, 3000], [1.0 * sr, 3000]], { shiftKey: true }); assert(d.spec.pts.length > n1, 'Shift adds');
    stroke([[0.9 * sr, 3000], [1.0 * sr, 3000]]); assert(d.spec.pts.length < n1 + 3, 'without Shift: a new selection');
    AS.actions['sp.brushbig'](); assert(w.brushPx > 14); AS.actions['sp.brushsmall']();
  });
  await t('Spot Healing Brush: painting over the click heals it at once (one undo step)', async () => {
    const d = app.cur, n = d.undoStack.length, hf = (ch) => { let e = 0; for (let i = click; i < click + 30; i++) e += (ch[i] - ch[i - 1]) ** 2; return e; };
    const before = hf(d.ch[0]); app.setTool('heal'); w.brushPx = 18;
    stroke([[click + 15, 20000], [click + 15, 1000]]); // one fast vertical stroke over the click (the gap is filled in)
    for (let i = 0; i < 100 && d.undoStack.length === n; i++) await sleep(50);
    assert(d.undoStack.length === n + 1 && d.undoStack[n].label === 'Spot Healing Brush', 'healed: ' + (d.undoStack[n] || {}).label);
    assert(hf(d.ch[0]) < before * 0.1, 'click energy ' + hf(d.ch[0]) + ' vs ' + before); assert(!d.spec, 'the stroke is gone after healing');
  });
  await t('Auto-select Harmonics: click the 3rd harmonic → the note with its harmonics; Delete removes it', async () => {
    const d = app.cur; app.setTool('harm'); w.onDown(ev(sr, 660)); for (let i = 0; i < 60 && !(d.spec && d.spec.kind === 'harm'); i++) await sleep(50);
    assert(d.spec && d.spec.kind === 'harm', 'harm selection'); near(d.spec.f0, 220, 3, 'pitch'); assert(d.spec.n >= 5);
    const b = D.shapeBounds(d.spec); near(b.a / sr, 0.5, 0.06, 'start'); near(b.b / sr, 1.5, 0.06, 'end');
    assert(/Harmonics/.test(document.querySelector('#statusMsg').textContent), 'status describes it');
    await AS.actions['sp.delete'](); const y = d.ch[0], seg = (f) => amp(y, f, sr);
    assert(seg(220) < 0.005 && seg(440) < 0.005 && seg(660) < 0.005, 'harmonics removed: ' + seg(220).toFixed(4)); assert(seg(3000) > 0.07, '3 kHz (not a harmonic) mostly kept: ' + seg(3000).toFixed(4));
    AS.actions['edit.undo']();
  });
  await t('Spectral Pitch Display: pitch line over the spectrogram follows the 220 Hz note', async () => {
    AS.actions['sp.pitch'](); assert(AS.spectral.settings().pitch); w.draw();
    const pts = w.pitchCache[0].pts.filter((p) => p[0] > 0.6 * sr && p[0] < 1.4 * sr && p[1]);
    assert(pts.length > 10, 'voiced frames ' + pts.length); const bad = pts.filter((p) => Math.abs(p[1] - 220) >= 3);
    assert(!bad.length, 'pitch ≈ 220 Hz: ' + bad.slice(0, 5).map((p) => (p[0] / sr).toFixed(3) + 's:' + p[1].toFixed(1)).join(' '));
    AS.actions['sp.pitch'](); assert(!AS.spectral.settings().pitch);
  });
  await t('Spectral Display Settings: FFT size, window, dB range and colour map change the picture', async () => {
    const S = AS.spectral, st = S.settings(); w.draw(); const k0 = w.specCache[0].key;
    const p = AS.actions['sp.settings'](); await sleep(50); const dlg = [...document.querySelectorAll('.modal')].pop();
    const set = (id, v) => { const el = dlg.querySelector(`[data-id="${id}"]`); el.value = v; el.dispatchEvent(new Event('input')); };
    set('fft', '8192'); set('win', 'blackmanHarris'); set('cmap', 'viridis'); set('dbMin', '-120');
    dlg.querySelector('[data-act="ok"]').click(); await p;
    const s1 = S.settings(); assert(s1.fft === 8192 && s1.win === 'blackmanHarris' && s1.cmap === 'viridis' && s1.dbMin === -120, JSON.stringify(s1));
    w.draw(); assert(w.specCache[0].key !== k0, 'spectrogram re-rendered'); S.set(st); w.specCache = null; w.draw();
    app.setTool('time'); AS.actions['view.wave']();
    app.cur.dirty = false; AS.actions['file.close'](); // leave no unsaved file behind (the autosave scenario counts them)
  });
};

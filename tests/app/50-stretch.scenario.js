// Roadmap 1.5 — clip time-stretch in the real app: Alt + drag an edge, worker rendering, mixdown length / pitch,
// Match to session tempo, undo.
module.exports = async ({ t, AS, app, assert, near, sleep }) => {
  const sr = 44100, tone = (f, secs) => { const x = new Float32Array(Math.round(secs * sr)); for (let i = 0; i < x.length; i++) x[i] = 0.5 * Math.sin(2 * Math.PI * f * i / sr); return x; };
  const freq = (x, a, b) => { let n = 0, first = -1, last = -1; for (let i = a + 1; i < b; i++) if (x[i - 1] < 0 && x[i] >= 0) { if (first < 0) first = i; last = i; n++; } return ((n - 1) * sr) / (last - first); };
  const lastLoud = (x) => { for (let i = x.length - 1; i >= 0; i--) if (Math.abs(x[i]) > 0.05) return i; return -1; };
  const setup = () => { app.setMode('multi'); const s = new AS.Session(); s.tracks = []; const tr = s.addTrack('T'), c = s.addClip(tr, AS.makeSource('tone', sr, [tone(440, 2), tone(440, 2)]), 0); app.session = s; app.multi.s = s; app.multi.rebuildHeads(); app.multi.resize(); app.multi.t0 = 0; app.multi.pps = 200; app.multi.draw(); return { s, tr, c }; };

  await t('Alt + drag the right edge stretches the clip (no pitch change); the mixdown is longer at the same pitch', async () => {
    const { s, c } = setup(), v = app.multi, r = v.mainC.getBoundingClientRect(), y = 3 + 50;
    const ev = (x, alt) => ({ button: 0, clientX: r.left + x, clientY: r.top + y, altKey: alt, target: v.mainC, preventDefault() {} });
    const xEnd = v.t2x(2) - 2;
    v.onDown(ev(xEnd, true)); v.onMove(ev(v.t2x(3) - 2, true)); v.onUp();
    near(c.stretch, 1.5, 0.01, 'stretch'); near(c.dur, 3, 0.02, 'length');
    for (let i = 0; i < 100 && !AS.cstretch.play(c); i++) await sleep(50); assert(AS.cstretch.play(c), 'worker did not render the stretch');
    const m = await AS.renderMix(s, sr); near(lastLoud(m.ch[0]) / sr, 3, 0.03, 'mixdown length'); near(freq(m.ch[0], sr, 2 * sr), 440, 3, 'pitch kept');
  });
  await t('plain drag of the edge still trims (no stretch)', async () => {
    const { c } = setup(), v = app.multi, r = v.mainC.getBoundingClientRect();
    const ev = (x) => ({ button: 0, clientX: r.left + x, clientY: r.top + 53, altKey: false, target: v.mainC, preventDefault() {} });
    v.onDown(ev(v.t2x(2) - 2)); v.onMove(ev(v.t2x(1.5) - 2)); v.onUp();
    assert(!AS.cstretch.isOn(c), 'stretched'); near(c.dur, 1.5, 0.02);
  });
  await t('Match Clip to Session Tempo (100 BPM clip, 125 BPM session) and undo', async () => {
    const { s, c } = setup(); c.src.tempo = { bpm: 100 }; s.opts.tempo = AS.tempo.norm({ bpm: 125 }); s.sel = c.id;
    await AS.actions['mt.matchtempo'](); near(c.stretch, 0.8, 1e-9); near(c.dur, 1.6, 1e-9);
    for (let i = 0; i < 100 && !AS.cstretch.play(c); i++) await sleep(50);
    const m = await AS.renderMix(s, sr); near(lastLoud(m.ch[0]) / sr, 1.6, 0.03, 'shorter mixdown');
    AS.actions['edit.undo'](); const c2 = app.session.tracks[0].clips[0]; assert(!AS.cstretch.isOn(c2), 'undo'); near(c2.dur, 2, 1e-9);
  });
  await t('Clip Properties dialog: Stretch % / Pitch / Mode fields apply to the clip', async () => {
    const { s, c } = setup(); s.sel = c.id; const pending = AS.actions['mt.props'](); await sleep(50);
    const dlg = [...document.querySelectorAll('.modal')].pop(), set = (id, v) => { const el = dlg.querySelector(`[data-id="${id}"]`); el.value = v; el.dispatchEvent(new Event('input')); };
    set('stretch', 200); set('pitch', 3); const mode = dlg.querySelector('[data-id="mode"]'); mode.value = 'monophonic'; mode.dispatchEvent(new Event('input'));
    dlg.querySelector('[data-act="ok"]').click(); await pending;
    near(c.stretch, 2, 1e-9); near(c.pitch, 3, 1e-9); assert(c.stretchMode === 'monophonic'); near(c.dur, 4, 1e-9);
    for (let i = 0; i < 160 && !AS.cstretch.play(c); i++) await sleep(50);
    const m = await AS.renderMix(s, sr); near(freq(m.ch[0], sr, 3 * sr), 440 * Math.pow(2, 3 / 12), 5, 'pitched up 3 st');
  });
  await t('Varispeed mode changes speed and pitch together (mixdown)', async () => {
    const { s, c } = setup(); c.stretchMode = 'varispeed'; AS.cstretch.setStretch(c, 2); await AS.cstretch.ensureAll(s);
    const m = await AS.renderMix(s, sr); near(freq(m.ch[0], sr, 3 * sr), 220, 2, 'an octave down'); near(lastLoud(m.ch[0]) / sr, 4, 0.03);
  });
};

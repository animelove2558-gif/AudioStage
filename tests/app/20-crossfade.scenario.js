// Roadmap 1.2 — automatic crossfades in real Web Audio + the X handle in the real view.
module.exports = async ({ t, AS, app, assert, near }) => {
  const sr = 48000;
  const sine = (secs) => { const n = Math.round(secs * sr), x = new Float32Array(n); for (let i = 0; i < n; i++) x[i] = 0.5 * Math.sin(2 * Math.PI * 375 * i / sr); return x; };
  const rms = (x, a, b) => { let s = 0; for (let i = Math.round(a); i < Math.round(b); i++) s += x[i] * x[i]; return Math.sqrt(s / (Math.round(b) - Math.round(a))); };
  // two clips of the same continuous sine, overlapping by 0.5 s and sample-aligned (b.start - b.off = a.start - a.off)
  const mk = (opts) => {
    const s = new AS.Session(); s.tracks = []; Object.assign(s.opts, opts); const tr = s.addTrack('T'), src = AS.makeSource('sine', sr, [sine(4), sine(4)]);
    const a = s.addClip(tr, src, 0, { off: 0, dur: 2 }), b = s.addClip(tr, src, 1.5, { off: 1.5, dur: 2 }); s.applyCrossfades(tr); return { s, tr, a, b };
  };
  await t('cosine crossfade of identical audio keeps a constant level through the overlap (offline mixdown)', async () => {
    const { s } = mk({ xfade: true, xfCurve: 'cosine' }), m = await AS.renderMix(s, sr), ch = m.ch[0];
    const outside = rms(ch, 0.5 * sr, 1.4 * sr);
    for (const [a, b] of [[1.5, 1.625], [1.625, 1.75], [1.75, 1.875], [1.875, 2.0]]) near(rms(ch, a * sr, b * sr), outside, outside * 0.01, `level ${a}-${b}s`);
  });
  await t('with automatic crossfades off the clip in front covers the overlap (same level); an old session (stacking off) sums', async () => {
    const { s } = mk({ xfade: false }), m = await AS.renderMix(s, sr), ch = m.ch[0];
    near(rms(ch, 1.55 * sr, 1.95 * sr) / rms(ch, 0.5 * sr, 1.4 * sr), 1, 0.02);
    const { s: so } = mk({ xfade: false, stack: false }), mo = await AS.renderMix(so, sr), co = mo.ch[0];
    near(rms(co, 1.55 * sr, 1.95 * sr) / rms(co, 0.5 * sr, 1.4 * sr), 2, 0.02);
  });
  await t('view: the X is drawn, dragging it changes the crossfade length, undo restores it', async () => {
    const { s, a, b } = mk({ xfade: true }); app.setMode('multi'); app.session = s; app.multi.s = s; app.multi.rebuildHeads(); app.multi.resize();
    const v = app.multi; v.t0 = 0; v.pps = 200; v.draw();
    const r = v.mainC.getBoundingClientRect(), ev = (x, y) => ({ button: 0, clientX: r.left + x, clientY: r.top + y, altKey: false, target: v.mainC, preventDefault() {} });
    const cx = v.t2x(1.75), cy = 3 + 12 + (96 - 8 - 12) / 2; // centre of the X on track 0
    assert(v.xfadeHit(cx, cy), 'X handle not found at its centre');
    v.onDown(ev(cx, cy)); v.onMove(ev(v.t2x(1.75 + 0.5), cy)); v.onUp();
    near(b.xfi, 1, 0.01, 'crossfade dragged to 1 s'); near(b.start, 1.25, 0.01); near(a.start + a.dur, 2.25, 0.01);
    AS.actions['edit.undo'](); const s2 = app.session.tracks[0].clips.find((c) => c.id === b.id); near(s2.xfi, 0.5, 0.01, 'undo');
  });
  await t('Multitrack menu: crossfade and overlap-policy items change the session settings', async () => {
    const before = app.session.opts.overlap; AS.actions['mt.ov.overwrite'](); assert(app.session.opts.overlap === 'overwrite');
    AS.actions['mt.xf.curve.linear'](); assert(app.session.opts.xfCurve === 'linear'); AS.actions['mt.xf.toggle'](); assert(app.session.opts.xfade === false);
    AS.actions['edit.undo'](); AS.actions['edit.undo'](); AS.actions['edit.undo'](); assert(app.session.opts.overlap === before && app.session.opts.xfade === true);
  });
};

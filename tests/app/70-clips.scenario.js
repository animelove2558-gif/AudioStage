// Roadmap 1.7 — clip / track management in the real app: loop, freeze, bounce, marquee multi-select + move,
// right-click menu (lock, colour, ripple delete), groups.
module.exports = async ({ t, AS, app, assert, near, sleep }) => {
  const sr = 44100, ramp = (secs, f) => { const x = new Float32Array(Math.round(secs * sr)); for (let i = 0; i < x.length; i++) x[i] = 0.4 * Math.sin(2 * Math.PI * (f || 300) * i / sr) * (0.3 + 0.7 * i / x.length); return x; };
  const resid = (a, b, i0, n) => { let e = 0, s = 0; for (let i = i0; i < i0 + n; i++) { e += (a[i] - b[i]) ** 2; s += b[i] * b[i]; } return 10 * Math.log10(e / s); };
  // snapping off: drag distances are measured exactly (earlier scenarios leave the playhead where it would snap)
  const fresh = () => { app.setMode('multi'); const s = new AS.Session(); s.tracks = []; app.session = s; app.multi.s = s; app.multi.selIds.clear(); app.multi.setRange(null); app.multi.snap = false; app.multiCursor = 0; return s; };
  const show = () => { app.multi.rebuildHeads(); app.multi.resize(); app.multi.t0 = 0; app.multi.pps = 100; app.multi.draw(); };
  const v = app.multi;
  const ev = (x, y, o) => { const r = v.mainC.getBoundingClientRect(); return { button: 0, clientX: r.left + x, clientY: r.top + y, altKey: false, ctrlKey: false, target: v.mainC, preventDefault() {}, ...(o || {}) }; };

  await t('clip loop: the mixdown repeats the unit seamlessly (sample-exact)', async () => {
    const s = fresh(), tr = s.addTrack('Loop'), c = s.addClip(tr, AS.makeSource('unit', sr, [ramp(0.5)]), 0); s.setLoop(c, true); c.dur = 2;
    const m = await AS.renderMix(s, sr), x = m.ch[0], L = sr / 2;
    for (const i of [100, 5000, 20000]) for (const k of [1, 2, 3]) near(x[i + k * L], x[i], 1e-6, `repeat ${k} at ${i}`);
  });
  await t('Freeze: the frozen track sounds the same as live processing; Unfreeze restores the clips', async () => {
    const s = fresh(), tr = s.addTrack('FX'), other = s.addTrack('Dry'); s.addClip(tr, AS.makeSource('a', sr, [ramp(1.5, 220), ramp(1.5, 330)]), 0.2); s.addClip(other, AS.makeSource('b', sr, [ramp(1.5, 500)]), 0);
    tr.fx = [AS.rack.newFx('eq', { lowG: 6, midF: 1200, midG: -4, midQ: 1, highG: 3 }), AS.rack.newFx('distortion', { drive: 4, mix: 0.6, out: -6 })]; tr.vol = -3; tr.pan = 0.3;
    show(); app.selTrack = tr.id;
    const live = await AS.renderMix(s, sr); await AS.actions['mt.freeze'](); assert(tr.frozen, 'not frozen');
    const frozen = await AS.renderMix(s, sr), r = resid(frozen.ch[0], live.ch[0], 0, Math.round(1.7 * sr));
    assert(r < -60, 'frozen differs: ' + r.toFixed(1) + ' dB');
    AS.actions['mt.unfreeze'](); assert(!tr.frozen && tr.clips.length === 1);
  });
  await t('Bounce Track to New Track = that track’s output (after fader + pan); Bounce Mix = the mixdown', async () => {
    const s = fresh(), a = s.addTrack('A'), b = s.addTrack('B'); s.addClip(a, AS.makeSource('a', sr, [ramp(1, 300)]), 0); s.addClip(b, AS.makeSource('b', sr, [ramp(1, 700)]), 0);
    a.vol = -6; a.pan = -0.5; show(); app.selTrack = a.id;
    await AS.actions['mt.bouncetrack'](); const nt = s.tracks[s.tracks.length - 1]; assert(nt.name === 'A (bounced)', nt.name);
    a.solo = true; const solo = await AS.renderMix({ tracks: [a], master: { vol: 0, fx: [] }, duration: 1 }, sr); a.solo = false;
    const bc = nt.clips[0].src.ch; assert(resid(bc[0], solo.ch[0], 0, sr) < -60 && resid(bc[1], solo.ch[1], 0, sr) < -60, 'bounce != track output');
  });
  await t('Ctrl + drag marquee selects clips on two tracks; dragging one moves both; Delete removes both; undo', async () => {
    const s = fresh(), a = s.addTrack('A'), b = s.addTrack('B'), c1 = s.addClip(a, AS.makeSource('1', sr, [ramp(1)]), 1), c2 = s.addClip(b, AS.makeSource('2', sr, [ramp(1)]), 1.5), c3 = s.addClip(a, AS.makeSource('3', sr, [ramp(0.5)]), 4); show();
    v.onDown(ev(v.t2x(0.5), 20, { ctrlKey: true })); v.onMove(ev(v.t2x(2), 150, { ctrlKey: true })); v.onUp();
    assert(v.selIds.has(c1.id) && v.selIds.has(c2.id) && !v.selIds.has(c3.id), 'marquee: ' + [...v.selIds]);
    v.onDown(ev(v.t2x(1.3), 28)); v.onMove(ev(v.t2x(1.3) + 50, 28)); v.onUp();
    near(c1.start, 1.5, 0.01); near(c2.start, 2, 0.01); near(c3.start, 4, 1e-9, 'unselected clip stays');
    AS.actions['edit.delete'](); assert(!a.clips.includes(c1) && !b.clips.includes(c2) && a.clips.includes(c3));
    AS.actions['edit.undo'](); assert(app.session.tracks[0].clips.length === 2 && app.session.tracks[1].clips.length === 1, 'undo');
  });
  await t('right-click menu: Lock in Time, clip colour, Ripple Delete; Group moves grouped clips together', async () => {
    const s = fresh(), a = s.addTrack('A'), c1 = s.addClip(a, AS.makeSource('1', sr, [ramp(1)]), 0), c2 = s.addClip(a, AS.makeSource('2', sr, [ramp(1)]), 2), c3 = s.addClip(a, AS.makeSource('3', sr, [ramp(1)]), 4); show();
    const menu = (c) => { const r = v.mainC.getBoundingClientRect(); v.onContext({ ...ev(v.t2x(c.start + 0.5), 50), preventDefault() {} }); return document.querySelector('.curve-pop'); };
    let pop = menu(c2); assert(pop && /Lock in Time/.test(pop.textContent), 'menu');
    [...pop.querySelectorAll('.mi')].find((m) => /Lock in Time/.test(m.textContent)).click(); assert(c2.locked, 'locked');
    pop = menu(c2); pop.querySelector('[data-color="#e0605a"]').click(); assert(c2.color === '#e0605a', 'colour');
    v.onDown(ev(v.t2x(2.5), 28)); v.onMove(ev(v.t2x(2.5) + 80, 28)); v.onUp(); near(c2.start, 2, 1e-9, 'locked clip did not move');
    pop = menu(c2); [...pop.querySelectorAll('.mi')].find((m) => /Ripple Delete/.test(m.textContent)).click();
    near(c3.start, 3, 1e-9, 'ripple: next clip moved left by 1 s'); assert(!a.clips.includes(c2));
    v.selectClips([c1.id, c3.id]); AS.actions['mt.group'](); v.selectClips([c1.id]);
    v.onDown(ev(v.t2x(0.5), 28)); v.onMove(ev(v.t2x(0.5) + 50, 28)); v.onUp(); near(c1.start, 0.5, 0.01); near(c3.start, 3.5, 0.01, 'grouped clip moved too');
  });
  app.multi.snap = true;
  await t('track colour from the header chip', async () => {
    const s = fresh(), a = s.addTrack('A'); show(); document.querySelector('.mt-head .tcolor').click();
    const sw = document.querySelector('.curve-pop [data-color="#8bc34a"]'); assert(sw, 'swatches'); sw.click(); assert(a.color === '#8bc34a');
  });
};

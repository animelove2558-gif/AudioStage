// Roadmap 1.3 — tempo / Bars:Beats / grid snap / metronome (real clicks recorded on the audio thread) / BPM detection.
module.exports = async ({ t, AS, app, assert, near, sleep }) => {
  const toBars = () => { for (let i = 0; i < 4 && app.timeFormat() !== 'bars'; i++) AS.actions['view.timefmt'](); };
  const toTime = () => { for (let i = 0; i < 4 && app.timeFormat() !== 'time'; i++) AS.actions['view.timefmt'](); };

  await t('session tempo drives the Bars:Beats time display and the multitrack ruler', async () => {
    app.setMode('multi'); const s = new AS.Session(); app.session = s; app.multi.s = s; app.multi.rebuildHeads(); app.multi.resize();
    s.opts.tempo = AS.tempo.norm({ bpm: 90, num: 3, den: 4, offset: 0 }); toBars();
    // 90 BPM 3/4: a bar is 2 s -> 4 s = bar 3 beat 1 (the display text; the hidden test window does not animate)
    assert(app.formatTime(4) === '3 | 1 | 000', 'display: ' + app.formatTime(4)); assert(app.formatTime(4 + 2 / 3) === '3 | 2 | 000');
    app.multi.t0 = 0; app.multi.pps = 50; app.multi.draw();
    const marks = app.multi.gridMarks(); assert(marks.some((m) => m.level === 'major' && m.label === '2' && Math.abs(m.x - 0.5 - 100) < 1), 'bar 2 at 2 s');
    toTime(); assert(app.multi.gridMarks().every((m) => m.level === 'major'), 'back to time ruler');
  });
  await t('Snap to Grid (beat) snaps a dragged clip to the beat; Off does not', async () => {
    const s = app.session; s.opts.tempo = AS.tempo.norm({ bpm: 120 }); app.multi.pps = 100; app.multi.snap = false;
    AS.actions['mt.grid.beat'](); assert(s.opts.snapGrid === 'beat');
    near(app.multi.snapT(1.53), 1.5, 1e-9, 'snapped'); near(app.multi.snapT(1.7), 1.7, 1e-9, 'too far (20 px) -> free');
    AS.actions['mt.grid.off'](); near(app.multi.snapT(1.53), 1.53, 1e-9, 'off'); app.multi.snap = true;
  });
  await t('tempo change is undoable (session) and per file in the Waveform editor', async () => {
    const s = app.session; s.push(); s.opts.tempo = AS.tempo.norm({ bpm: 140 }); AS.actions['edit.undo'](); assert(app.session.opts.tempo.bpm === 120, 'session undo');
    const d = new AS.Doc('x.wav', 44100, [new Float32Array(44100)]); d.setMeta('Tempo', (x) => { x.tempo = AS.tempo.norm({ bpm: 77 }); });
    assert(d.tempo.bpm === 77); d.undo(); assert(!d.tempo, 'doc undo');
  });
  await t('metronome: clicks land on the beat grid (count-in before the start, accents on bar 1)', async () => {
    const eng = AS.engine; eng.init(); await eng.wl; await eng.ctx.resume(); const ctx = eng.ctx, sr = ctx.sampleRate;
    const rec = eng.recorder(1); await sleep(50);
    // as in the app, the transport start is pushed back by at least the count-in (1 bar = 2 s here)
    const t0 = ctx.currentTime + 2.2, m = AS.metronome.start(ctx, rec.node, { bpm: 120, num: 4, den: 4, offset: 0 }, { t0, from: 0.75 }, { countIn: 1, sound: 'click', db: -6 });
    await sleep(3600); m.stop(); await sleep(150); const x = (await rec.stop())[0], st = rec.startTime;
    const onsets = []; for (let i = 1; i < x.length; i++) if (Math.abs(x[i]) > 0.05 && (!onsets.length || i - onsets[onsets.length - 1].i > sr * 0.1)) { let pk = 0; for (let k = i; k < i + sr * 0.01 && k < x.length; k++) pk = Math.max(pk, Math.abs(x[k])); onsets.push({ i, pk }); }
    const times = onsets.map((o) => st + o.i / sr - t0);
    // count-in: timeline -1.0, -0.5, 0.0, 0.5 -> -1.75, -1.25, -0.75, -0.25 ; then 1.0, 1.5 -> +0.25, +0.75 …
    const expect = [-1.75, -1.25, -0.75, -0.25, 0.25, 0.75, 1.25];
    for (const e of expect) assert(times.some((tt) => Math.abs(tt - e) < 0.003), `no click at ${e} s (got ${times.map((v) => v.toFixed(3)).join(', ')})`);
    const at = (e) => onsets[times.findIndex((tt) => Math.abs(tt - e) < 0.003)].pk;
    assert(at(-0.75) > at(-0.25) * 1.2, 'bar 1 (timeline 0) is accented'); assert(at(1.25) > at(0.75) * 1.2, 'bar 2 (timeline 2) is accented');
  });
  await t('Detect from audio finds the tempo of a 128 BPM file (dialog code path)', async () => {
    const sr = 44100, secs = 20, x = new Float32Array(sr * secs), beat = 60 / 128;
    for (let k = 0; k * beat + 0.2 < secs; k++) { const i0 = Math.round((k * beat + 0.2) * sr); for (let i = 0; i < 3000 && i0 + i < x.length; i++) x[i0 + i] += 0.8 * Math.exp(-i / 400) * Math.sin(i * 0.3); }
    const r = AS.dsp.detectTempo([x], sr); near(r.bpm, 128, 1, 'bpm');
    // the real dialog: select a clip with this audio, open Edit > Tempo…, press Detect, read the BPM field
    app.setMode('multi'); const s = app.session, tr = s.audioTrackAt(0), c = s.addClip(tr, AS.makeSource('beat', sr, [x]), 3); s.sel = c.id;
    const pending = AS.actions['edit.tempo'](); await sleep(50);
    const dlg = [...document.querySelectorAll('.modal')].pop(); dlg.querySelector('[data-detect]').click();
    for (let i = 0; i < 60 && !/BPM/.test(dlg.querySelector('.tdres').textContent); i++) await sleep(50);
    near(+dlg.querySelector('[data-id="bpm"]').value, 128, 1, 'dialog BPM field'); assert(/clip/.test(dlg.querySelector('.tdres').textContent), 'source = clip');
    dlg.querySelector('[data-act="ok"]').click(); await pending;
    near(app.session.opts.tempo.bpm, 128, 1, 'applied to the session');
    const bl = 60 / app.session.opts.tempo.bpm, ph = ((3 + 0.2 - app.session.opts.tempo.offset) / bl) % 1; assert(Math.min(ph, 1 - ph) < 0.05, 'offset puts beats on the clip hits: ' + ph);
  });
};

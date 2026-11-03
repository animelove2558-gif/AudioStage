// Roadmap 1.4 — recording with synthetic inputs (an AudioNode instead of the microphone) and a DelayNode as the
// interface's round-trip latency: latency compensation, punch-in/out, loop takes + comping, latency measurement,
// input monitoring and the clip warning — all through the real transport and the audio-thread recorder.
module.exports = async ({ t, AS, app, assert, near, sleep }) => {
  const eng = AS.engine; eng.init(); await eng.wl; await eng.ctx.resume();
  const ctx = eng.ctx, rate = ctx.sampleRate;
  const fresh = (secs) => { // a session with one audio track (armed) holding a quiet reference clip
    app.setMode('multi'); const s = new AS.Session(); s.tracks = []; const tr = s.addTrack('Vox'); tr.arm = true;
    if (secs) s.addClip(tr, AS.makeSource('ref', rate, [new Float32Array(Math.round(secs * rate)).fill(0.1)]), 0);
    app.session = s; app.multi.s = s; app.multi.setRange(null); app.multi.rebuildHeads(); app.multi.resize(); app.loop = false; app.punch = false; app.multiCursor = 0;
    return { s, tr };
  };
  const delayed = (sec) => { const d = ctx.createDelay(2); d.delayTime.value = sec; return d; };
  const waitStop = async (ms) => { for (let i = 0; i < ms / 50 && app.recording; i++) await sleep(50); };
  const firstAbove = (x, thr) => { for (let i = 0; i < x.length; i++) if (Math.abs(x[i]) > thr) return i; return -1; };
  const RS = app.recSettings, saved = { ...RS };

  await t('overdub: latency compensation puts a performed hit on the beat it was played to', async () => {
    const { s, tr } = fresh(3); RS.latencyMs = 80; const lat = delayed(0.08);
    await app.toggleRecord({ input: lat }); const map = app.recording.map;
    const pulse = ctx.createBufferSource(), b = ctx.createBuffer(1, 200, rate); b.getChannelData(0).fill(0.9); pulse.buffer = b; pulse.connect(lat);
    pulse.start(map.t0 + (1.25 - map.from)); // the performer hits exactly when the transport is at 1.25 s
    await sleep(2200); await app.toggleRecord(); await app.recDone;
    const c = tr.clips.find((x) => x.name === 'Recording'); assert(c, 'no recording clip');
    const i = firstAbove(c.src.ch[0], 0.5); near(c.start + i / rate, 1.25, 0.002, 'hit position on the timeline');
  });
  await t('punch in/out: only the time selection is recorded (pre-roll before, auto-stop after post-roll), the old audio is replaced there', async () => {
    const { tr } = fresh(3); RS.latencyMs = 0; RS.preRoll = 0.5; RS.postRoll = 0.3;
    app.multi.setRange(1.0, 1.8); app.punch = true;
    const osc = ctx.createOscillator(), g = ctx.createGain(); g.gain.value = 0.5; osc.connect(g); osc.start();
    await app.toggleRecord({ input: g }); await waitStop(4000); await app.recDone; osc.stop();
    assert(!app.recording, 'did not stop by itself after the post-roll');
    const spans = tr.clips.slice().sort((a, b) => a.start - b.start).map((c) => [c.name, +c.start.toFixed(3), +(c.start + c.dur).toFixed(3)]);
    assert(JSON.stringify(spans) === JSON.stringify([['ref', 0, 1], ['Punch-in', 1, 1.8], ['ref', 1.8, 3]]), JSON.stringify(spans));
    near(app.multiCursor, 1.8 + 0.3, 0.15, 'stopped after the post-roll');
  });
  await t('loop recording: every pass of the selection becomes a take; comping takes ranges from different takes', async () => {
    const { tr } = fresh(0); RS.latencyMs = 0; app.multi.setRange(0, 0.8); app.loop = true;
    const osc = ctx.createOscillator(), g = ctx.createGain(); g.gain.value = 0; osc.connect(g); osc.start();
    await app.toggleRecord({ input: g }); const lp = app.recording.loop; assert(lp && Math.abs(lp.L - 0.8) < 1e-9, 'not a loop recording');
    for (let k = 0; k < 4; k++) g.gain.setValueAtTime(0.1 * (k + 1), lp.t0 + k * lp.L); // pass k = level 0.1·(k+1)
    await sleep(Math.round((lp.t0 - ctx.currentTime + 3 * lp.L + 0.3) * 1000)); await app.toggleRecord(); await app.recDone; osc.stop(); app.loop = false;
    const c = tr.clips[0]; assert(c && c.takes && c.takes.length === 3, 'takes: ' + (c && c.takes && c.takes.length));
    const rms = (x, a, b) => { let q = 0; for (let i = a; i < b; i++) q += x[i] * x[i]; return Math.sqrt(q / (b - a)); };
    c.takes.forEach((tk, k) => near(rms(tk.src.ch[0], 0.1 * rate, 0.7 * rate), 0.1 * (k + 1) * Math.SQRT1_2, 0.01, 'take ' + (k + 1) + ' level'));
    near(rms(c.src.ch[0], 0.1 * rate, 0.7 * rate), 0.3 * Math.SQRT1_2, 0.01, 'plays the last take');
    // comp: 0.2–0.4 s from take 1 (swipe on lane 0 through the real view)
    const v = app.multi; v.t0 = 0; v.pps = 500; v.draw(); v.compId = c.id; v.draw();
    const r = v.mainC.getBoundingClientRect(), ev = (x, y) => ({ button: 0, clientX: r.left + x, clientY: r.top + y, target: v.mainC, altKey: false, preventDefault() {} });
    const b = v.box(c, 0), L = v.takeLanes(c, b), y = L.top + L.h / 2;
    v.onDown(ev(v.t2x(0.2), y)); v.onMove(ev(v.t2x(0.4), y)); v.onUp();
    near(rms(c.src.ch[0], 0.25 * rate, 0.35 * rate), 0.1 * Math.SQRT1_2, 0.01, 'comped range = take 1');
    near(rms(c.src.ch[0], 0.5 * rate, 0.7 * rate), 0.3 * Math.SQRT1_2, 0.01, 'rest = take 3');
    let jump = 0; for (let i = Math.round(0.19 * rate); i < 0.21 * rate; i++) jump = Math.max(jump, Math.abs(c.src.ch[0][i] - c.src.ch[0][i - 1]));
    assert(jump < 0.05, 'seam is crossfaded (no click): max step ' + jump.toFixed(3));
    AS.actions['edit.undo'](); const c2 = app.session.tracks[0].clips[0]; near(rms(c2.src.ch[0], 0.25 * rate, 0.35 * rate), 0.3 * Math.SQRT1_2, 0.01, 'undo the comp');
    const j = JSON.parse(JSON.stringify(AS.sessionIO.serialize(app.session))), back = AS.sessionIO.deserialize(j).tracks[0].clips[0];
    assert(back.takes.length === 3 && back.comp.length >= 1, 'takes survive save / open');
  });
  await t('Measure… finds the round-trip latency of a loopback (simulated: 83 ms)', async () => {
    const out = ctx.createGain(), lat = delayed(0.083); out.connect(lat);
    const m = await app.measureLatency({ input: lat, output: out }); near(m.latency, 0.083, 0.0015, 'latency'); assert(m.found === 5);
  });
  await t('input monitoring: an armed track with monitoring on plays the input through its chain', async () => {
    const { s, tr } = fresh(1); tr.monitor = true; tr.vol = -6.0206;
    const osc = ctx.createOscillator(), g = ctx.createGain(); g.gain.value = 0.4; osc.connect(g); osc.start();
    const rec = eng.recorder(1), nodes = AS.buildGraph(ctx, rec.node, s, 1e9, ctx.currentTime, 1e9, g);
    await sleep(500); const x = (await rec.stop())[0]; osc.stop(); for (const n of nodes) { try { n.disconnect(); } catch (e) { /* */ } }
    let pk = 0; for (let i = x.length >> 1; i < x.length; i++) pk = Math.max(pk, Math.abs(x[i]));
    near(pk, 0.4 * 0.5 * Math.SQRT1_2, 0.01, 'monitored level (track fader -6 dB, mono -> stereo pan)');
    tr.monitor = false; const n2 = AS.buildGraph(ctx, ctx.createGain(), s, 1e9, ctx.currentTime, 1e9, g); assert(!n2.some((n) => n.disconnect && !n.connect), 'no monitor tap when off');
  });
  await t('a clipping input is flagged on the armed track while recording', async () => {
    const { tr } = fresh(2); const osc = ctx.createOscillator(), g = ctx.createGain(); g.gain.value = 1.3; osc.connect(g); osc.start();
    await app.toggleRecord({ input: g }); await sleep(500);
    assert(app.recording.clipped, 'clip not detected'); assert(document.querySelector('.mt-head .tb.clipwarn'), 'no warning on the header');
    await app.toggleRecord(); await app.recDone; osc.stop();
  });
  Object.assign(RS, saved);
};

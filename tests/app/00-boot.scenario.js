// The app boots, the main objects exist and a session renders offline.
module.exports = async ({ t, AS, app, assert, near, sleep }) => {
  await t('app boots: AS / app / views exist', async () => {
    assert(AS && app && app.multi && app.wave, 'globals'); assert(AS.engine && AS.buildGraph && AS.renderMix, 'engine');
  });
  await t('About box: the real version (package.json via the main process) and the BYS & RB copyright line', async () => {
    const v = await window.audioStageHelp.version(); assert(/^\d+\.\d+\.\d+/.test(v), v); await sleep(50);
    AS.actions['help.about'](); const m = document.querySelector('.modal-back .modal'), txt = m.textContent;
    assert(txt.includes('AudioStage ' + v), 'version ' + v + ' in ' + txt.slice(0, 80)); assert(!/AudioStage 1\.0\b/.test(txt) || v.startsWith('1.0'), 'stale version');
    assert(txt.includes('Copyright (c) BYS & RB. All rights reserved by BYS & RB'), 'copyright');
    m.querySelector('[data-act="cancel"]').click();
  });
  await t('About box lists registry counts and every export format', async () => {
    AS.actions['help.about']();
    const txt = document.querySelector('.dlg, .dialog, [role=dialog]') ? document.querySelector('.dlg, .dialog, [role=dialog]').textContent : document.body.textContent;
    const n = AS.fxmenu.counts();
    assert(txt.includes(n.realtime + ' real-time rack effects'), 'rack count'); assert(txt.includes(n.offline + ' offline processes'), 'offline count');
    for (const f of ['WAV', 'FLAC', 'MP3', 'Opus', 'M4A', 'AAC']) assert(txt.includes(f), 'format ' + f);
    assert(!txt.includes('40+'), 'stale text');
    document.querySelectorAll('.modal-back [data-act="cancel"]').forEach((b) => b.click()); // close it properly (removing the element would leave the app thinking a dialog is open)
    assert(!AS.ui.dialogOpen(), 'dialog closed');
  });
  await t('Effects Rack slot picker uses the menu names', async () => {
    const g = AS.fxmenu.rackGroups(); assert(g.length > 5 && g.flatMap((x) => x[1]).some(([k, n]) => k === 'comp' && n === 'Single-band Compressor'));
  });
  await t('multitrack playback stops by itself at the end of the session (timer, works without animation frames)', async () => {
    app.setMode('multi'); const s = new AS.Session(), sr = 44100; s.addClip(s.tracks[0], AS.makeSource('short', sr, [new Float32Array(sr / 2)]), 0);
    app.session = s; app.multi.s = s; app.multi.rebuildHeads(); app.multiCursor = 0; app.loop = false;
    AS.actions['tp.play'](); assert(AS.engine.playing, 'not playing');
    // wait on the audio clock, not on the wall clock: a loaded machine can take well over a second to start a context
    const ctx = AS.engine.ctx, began = ctx.currentTime, until = performance.now() + 20000;
    while (AS.engine.playing && ctx.currentTime < began + 1.2 && performance.now() < until) await new Promise((r) => setTimeout(r, 20));
    assert(ctx.currentTime >= began + 0.5 || !AS.engine.playing, 'the audio clock did not advance');
    if (AS.engine.playing) await new Promise((r) => setTimeout(r, 200));
    assert(!AS.engine.playing, 'still playing after the end (audio clock advanced ' + (ctx.currentTime - began).toFixed(2) + ' s)');
  });
  await t('a context clock that stops does not leave the transport "playing" for ever (C-08, C-10)', async () => {
    const eng = AS.engine, ctx = eng.ctx, frozen = ctx.currentTime, stall = AS.engine.constructor.STALL_S, wasResume = ctx.resume;
    const s = app.session; s.tracks[0].clips[0].dur = 30; s.tracks[0].clips[0].src.dur = 30;
    AS.engine.constructor.STALL_S = 0.5; Object.defineProperty(ctx, 'currentTime', { configurable: true, get: () => frozen }); ctx.resume = () => Promise.resolve();
    try {
      AS.actions['tp.play'](); assert(eng.playing, 'not playing');
      const until = performance.now() + 4000; while (eng.playing && performance.now() < until) await new Promise((r) => setTimeout(r, 25));
      assert(!eng.playing, 'still "playing" on a stopped clock');
    } finally { delete ctx.currentTime; delete ctx.resume; AS.engine.constructor.STALL_S = stall; assert(ctx.resume === wasResume, 'stub removed'); }
  });
  await t('a closed audio context is replaced on the next init (C-08)', async () => {
    const eng = AS.engine, old = eng.ctx; await old.close(); await new Promise((r) => setTimeout(r, 50));
    eng.init(); assert(eng.ctx && eng.ctx !== old && eng.ctx.state !== 'closed', 'no new context'); assert(eng.master.context === eng.ctx, 'master is on the new context');
    await eng.wl; await eng.ctx.resume();
  });
  await t('multitrack session renders offline (sine clip, -6 dB track)', async () => {
    const s = new AS.Session(), sr = 44100, n = sr, x = new Float32Array(n); for (let i = 0; i < n; i++) x[i] = 0.5 * Math.sin(2 * Math.PI * 440 * i / sr);
    s.addClip(s.tracks[0], AS.makeSource('sine', sr, [x, x]), 0); s.tracks[0].vol = -6.0206;
    const m = await AS.renderMix(s, sr); let pk = 0; for (let i = 0; i < n; i++) pk = Math.max(pk, Math.abs(m.ch[0][i]));
    near(pk, 0.25, 0.01, 'peak');
  });
};

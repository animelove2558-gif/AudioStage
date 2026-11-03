// The app boots, the main objects exist and a session renders offline.
module.exports = async ({ t, AS, app, assert, near }) => {
  await t('app boots: AS / app / views exist', async () => {
    assert(AS && app && app.multi && app.wave, 'globals'); assert(AS.engine && AS.buildGraph && AS.renderMix, 'engine');
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
    AS.actions['tp.play'](); assert(AS.engine.playing, 'not playing'); await new Promise((r) => setTimeout(r, 1200));
    assert(!AS.engine.playing, 'still playing after the end');
  });
  await t('multitrack session renders offline (sine clip, -6 dB track)', async () => {
    const s = new AS.Session(), sr = 44100, n = sr, x = new Float32Array(n); for (let i = 0; i < n; i++) x[i] = 0.5 * Math.sin(2 * Math.PI * 440 * i / sr);
    s.addClip(s.tracks[0], AS.makeSource('sine', sr, [x, x]), 0); s.tracks[0].vol = -6.0206;
    const m = await AS.renderMix(s, sr); let pk = 0; for (let i = 0; i < n; i++) pk = Math.max(pk, Math.abs(m.ch[0][i]));
    near(pk, 0.25, 0.01, 'peak');
  });
};

// Roadmap 1.6 (first run) — autosave to the data folder, project versions through the real dialog.
// Leaves a known autosave behind; this run then ends with app.exit() (= a crash for the app), and
// 60-autosave.after-restart.scenario.js checks the recovery at the next start.
module.exports = async ({ t, AS, app, assert, near, sleep }) => {
  const sr = 44100, tone = (f, n) => { const x = new Float32Array(n); for (let i = 0; i < n; i++) x[i] = 0.3 * Math.sin(2 * Math.PI * f * i / sr); return x; };
  await t('autosave writes the session and unsaved files to the app data folder (disk store)', async () => {
    assert(AS.store.kind === 'disk', 'store backend: ' + AS.store.kind);
    app.setMode('multi'); const s = new AS.Session(); s.tracks = []; const a = s.addTrack('Recovered Vocal'), b = s.addBus('Recovered Bus');
    s.addClip(a, AS.makeSource('vocal take', sr, [tone(330, sr)]), 1.25); a.out = b.id; s.opts.tempo = AS.tempo.norm({ bpm: 111 });
    app.session = s; app.multi.s = s; app.multi.rebuildHeads(); app.multi.resize();
    const d = new AS.Doc('unsaved edit.wav', sr, [tone(440, sr / 2)]); d.dirty = true; app.docs.push(d);
    const m = await app.autosaveNow(true); assert(m && m.docs.length === 1 && m.clips === 1, 'manifest');
    const keys = await AS.store.list(''); assert(keys.includes('autosave.json') && keys.filter((k) => k.startsWith('audio/')).length === 2, keys.join(', '));
  });
  await t('Save Version / Versions… dialog restores an earlier session (and keeps the current one as a version)', async () => {
    const s = app.session; await AS.autosave.saveVersion(AS.store, 'Two tracks', s);
    s.tracks.splice(0, 1); app.multi.rebuildHeads(); assert(app.session.tracks.length === 1);
    const pending = AS.actions['file.versions'](); for (let i = 0; i < 40 && !document.querySelector('.vers'); i++) await sleep(50);
    const row = [...document.querySelectorAll('.vers tr')].find((r) => r.textContent.includes('Two tracks')); assert(row, 'version row');
    row.querySelector('[data-a="restore"]').click(); await pending;
    for (let i = 0; i < 40 && app.session.tracks.length !== 2; i++) await sleep(50);
    assert(app.session.tracks.length === 2 && app.session.tracks[0].clips[0].src.name === 'vocal take', 'restored');
    const list = await AS.autosave.listVersions(AS.store); assert(list.some((v) => v.name.startsWith('Auto: before restoring')), 'safety version');
    await app.autosaveNow(true); app.autosaveOpts.on = false; // keep exactly this autosave for the restart test
  });
};

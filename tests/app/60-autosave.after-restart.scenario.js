// Roadmap 1.6 (second start on the same data folder) — the first run ended without a normal close, so the app
// must offer "Recover unsaved work" and bring back the session and the unsaved file.
module.exports = async ({ t, AS, app, assert, near, sleep }) => {
  await t('after a crash the app offers to recover, and Recover restores session + unsaved file', async () => {
    let dlg = null; for (let i = 0; i < 60 && !dlg; i++) { dlg = [...document.querySelectorAll('.modal')].find((m) => /Recover unsaved work/.test(m.textContent)); if (!dlg) await sleep(50); }
    assert(dlg, 'no recovery dialog'); assert(/Recovered Vocal|2 track/.test(dlg.textContent) && /unsaved edit\.wav/.test(dlg.textContent), dlg.textContent);
    dlg.querySelector('[data-act="ok"]').click(); await app.recoveryChecked;
    const s = app.session, v = s.tracks.find((x) => x.name === 'Recovered Vocal'), bus = s.tracks.find((x) => x.type === 'bus');
    assert(v && bus && v.out === bus.id, 'session routing'); near(v.clips[0].start, 1.25, 1e-9); near(s.opts.tempo.bpm, 111, 1e-9);
    const d = app.docs.find((x) => x.name === 'unsaved edit.wav'); assert(d && d.dirty && d.ch[0].length === 22050, 'unsaved file');
    near(d.ch[0][100], 0.3 * Math.sin(2 * Math.PI * 440 * 100 / 44100), 1e-6, 'audio bit-exact (32-bit float)');
  });
};

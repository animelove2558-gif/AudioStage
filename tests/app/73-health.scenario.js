// File > Session Audio Health…: lists what is wrong with the audio of the session.
module.exports = async ({ t, AS, app, assert, sleep }) => {
  await t('Session Audio Health: a clean session says so, a damaged one lists findings with a fix hint', async () => {
    app.setMode('multi'); const s = new AS.Session(), sr = 44100, x = new Float32Array(sr).fill(0.2); x[5] = NaN;
    s.addClip(s.tracks[0], AS.makeSource('good', sr, [new Float32Array(sr).fill(0.1)]), 0); app.session = s; app.multi.s = s;
    AS.actions['file.health'](); await sleep(80);
    let m = document.querySelector('.modal-back .modal'); assert(m && /No problems found/.test(m.textContent), 'clean: ' + (m && m.textContent.slice(0, 120)));
    m.querySelector('[data-act="cancel"], [data-act="ok"]').click(); await sleep(50);
    s.addClip(s.tracks[0], AS.makeSource('nan', sr, [x]), 2); AS.actions['file.health'](); await sleep(80);
    m = document.querySelector('.modal-back .modal'); assert(m && /1 error/.test(m.textContent) && /not numbers/.test(m.textContent) && /Re-record/.test(m.textContent), m && m.textContent.slice(0, 200));
    document.querySelectorAll('.modal-back [data-act="cancel"]').forEach((b) => b.click()); await sleep(50);
    assert(!AS.ui.dialogOpen(), 'dialog closed');
  });
};

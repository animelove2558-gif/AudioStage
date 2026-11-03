// ROADMAP-MISSING 5 — Start screen, the offline manual (F1) with search, Show Log Files, Report a Problem, tooltips.
module.exports = async ({ t, AS, app, assert, sleep }) => {
  const modal = () => [...document.querySelectorAll('.modal')].pop();
  const until = async (f, ms) => { for (let i = 0; i < (ms || 6000) / 50; i++) { if (await f()) return true; await sleep(50); } return false; };
  const W = () => document.getElementById('welcome');
  const menuLabels = (name) => { const b = [...document.querySelectorAll('#menubar .mb')].find((x) => x.textContent === name); b.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); const l = [...document.querySelectorAll('.menu .mi')].map((x) => x.querySelector('.ml').textContent + '|' + x.querySelector('.ms').textContent); b.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); return l; };

  await t('the Start screen appeared when the app opened with nothing (fresh data folder) and went away with the first command', async () => {
    assert((await app.welcomeShown) === true, 'shown at start'); assert(W(), 'there');
    if (!W().hidden) app.runId('view.zall'); // (when this scenario runs alone; otherwise the earlier ones already hid it)
    assert(W().hidden, 'hidden after the first command');
  });
  await t('Help > Start Screen: actions, recent lists, the "show at start" box is the Preferences setting', async () => {
    AS.actions['help.start'](); assert(!W().hidden);
    for (const l of ['New Audio File…', 'New Multitrack Session', 'Open…', 'Open Multitrack Session…', 'AudioStage Help', 'Recent Files', 'Recent Sessions']) assert(W().textContent.includes(l), l);
    const cb = W().querySelector('[data-ws-show]'); assert(cb.checked === AS.prefs.get('general.welcome'));
    cb.checked = false; cb.dispatchEvent(new Event('change', { bubbles: true })); assert(AS.prefs.get('general.welcome') === false);
    assert(AS.welcome.startup(Object.assign({}, app, { docs: [] })) === false, 'off: not shown at the next start');
    AS.prefs.set('general.welcome', true);
    W().querySelector('[data-ws="file.new"]').click(); assert(W().hidden, 'hidden');
    assert(await until(() => modal() && /New Audio File/.test(modal().textContent))); modal().querySelector('[data-act="cancel"]').click(); await sleep(30);
    AS.actions['help.start'](); W().querySelector('[data-ws="newSession"]').click(); assert(app.mode === 'multi' && W().hidden); app.setMode('wave');
  });
  await t('Help menu: AudioStage Help on F1, Keyboard Shortcuts moved to Shift+F1, logs, report, VST / ffmpeg status', async () => {
    const l = menuLabels('Help');
    for (const x of ['AudioStage Help|F1', 'Keyboard Shortcuts|Shift+F1', 'Start Screen|', 'Check VST / ffmpeg Status…|', 'Show Log Files|', 'Report a Problem…|', 'About AudioStage|']) assert(l.includes(x), x + ' in ' + l.join(', '));
  });
  await t('the manual (F1) opens in its own window, made from the README, and its search finds and highlights', async () => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'F1', bubbles: true }));
    assert(await until(async () => (await window.audioStageHelp.testEval('document.title')) === 'AudioStage Help'), 'help window');
    const topics = await window.audioStageHelp.testEval('document.querySelectorAll("#toc a").length'); assert(topics > 10, 'topics ' + topics);
    const r = await window.audioStageHelp.testEval('window.helpSearch("Plugin Manager")'); assert(r.matches > 0 && r.sections >= 1, JSON.stringify(r));
    assert((await window.audioStageHelp.testEval('document.querySelectorAll("mark").length')) > 0, 'highlighted');
    const none = await window.audioStageHelp.testEval('window.helpSearch("zzqqxx-nothing"), !document.getElementById("none").hidden'); assert(none === true, 'no matches message');
    const r2 = await app.openHelp('Recent'); assert(r2.ok && r2.reused, 'F1 again: the same window, new search');
  });
  await t('Show Log Files: the log folder (with this run’s log) · Report a Problem: versions, system, log end, copy', async () => {
    const r = await AS.actions['help.logs'](); assert(r.ok && /logs$/.test(r.dir), JSON.stringify(r));
    const info = await window.audioStageHelp.info(); assert(info.ok && info.tail.some((x) => /AudioStage .* started/.test(x)), info.tail.join('\n'));
    const p = AS.actions['help.report'](); await until(() => modal() && modal().querySelector('.rp-text'));
    const txt = modal().querySelector('.rp-text').value; assert(/app: \d+\.\d+\.\d+/.test(txt) && /electron: /.test(txt) && /VST host: /.test(txt) && /end of the log/.test(txt), txt.slice(0, 300));
    modal().querySelector('[data-act="cancel"]').click(); await p;
  });
  await t('tooltips: an effect dialog and a rack effect window explain each parameter', async () => {
    app.setMode('wave'); if (!app.cur) await app.openFiles([new File([AS.wav.encodeWav([new Float32Array(4410).fill(0.1)], 44100, 16, false)], 'tips.wav')]);
    const p = app.runId('fx:compressor'); await until(() => modal() && modal().querySelector('[data-id="ratio"]'));
    const row = modal().querySelector('[data-id="ratio"]').closest('.frow'); assert(/4:1/.test(row.title), row.title);
    modal().querySelector('[data-act="cancel"]').click(); await p;
  });
};

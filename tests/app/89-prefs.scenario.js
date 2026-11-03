// ROADMAP-MISSING 3 — Edit > Preferences… (Ctrl+K) in the real app: the tabs, values changed in the window are really
// used (new file / new session / export format / time display / autosave / recording folder), the older dialogs and
// menus read and write the same values, Reset All Preferences.
module.exports = async ({ t, AS, app, assert, sleep, env }) => {
  const P = AS.prefs, modal = () => [...document.querySelectorAll('.modal')].pop();
  const until = async (f, ms) => { for (let i = 0; i < (ms || 5000) / 50; i++) { if (f()) return true; await sleep(50); } return false; };
  const openPrefs = async (tab) => { const p = P.open(tab); await until(() => modal() && modal().querySelector('.pf')); return { m: modal(), p }; };
  const setIn = (m, id, v) => { const el = m.querySelector(`[data-p="${id}"]`); if (el.type === 'checkbox') el.checked = v; else el.value = v; el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })); };

  await t('Edit > Preferences… (Ctrl+K): all tabs present, desktop-only rows and the VST / ffmpeg pane shown', async () => {
    const { m, p } = await openPrefs();
    const tabs = [...m.querySelectorAll('.pf-tab')].map((b) => b.textContent);
    for (const n of P.TABS) assert(tabs.includes(n), 'tab ' + n + ': ' + tabs.join('|'));
    assert(m.querySelector('[data-p="rec.folder"]') && m.querySelector('[data-p="files.openDir"]'), 'folder rows in the desktop app');
    m.querySelector('[data-tab="VST / ffmpeg"]').click(); assert(await until(() => /VST3 plugins/.test(m.querySelector('[data-page="VST / ffmpeg"]').textContent)));
    m.querySelector('[data-act="cancel"]').click(); assert((await p) === false);
    const key = new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true }); document.dispatchEvent(key); // the default preset's Ctrl+K
    assert(await until(() => modal() && modal().querySelector('.pf')), 'Ctrl+K opens Preferences'); modal().querySelector('[data-act="cancel"]').click(); await sleep(30);
  });
  await t('Files: new audio file defaults (96 kHz mono 16-bit) used by File > New Audio File and its Save As format', async () => {
    const { m, p } = await openPrefs('Files'); setIn(m, 'files.newSr', 96000); setIn(m, 'files.newCh', 1); setIn(m, 'files.newBits', 16); m.querySelector('[data-act="ok"]').click(); assert(await p);
    assert(P.get('files.newSr') === 96000 && P.get('files.newCh') === 1 && P.get('files.newBits') === 16);
    const n = app.docs.length, d0 = AS.actions['file.new'](); await until(() => modal() && modal().querySelector('[data-id="sr"]'));
    assert(modal().querySelector('[data-id="sr"]').value === '96000' && modal().querySelector('[data-id="ch"]').value === '1', 'dialog defaults');
    modal().querySelector('[data-act="ok"]').click(); await d0;
    assert(app.docs.length === n + 1 && app.cur.sr === 96000 && app.cur.ch.length === 1 && app.cur.bits === 16, `${app.cur.sr} ${app.cur.ch.length} ${app.cur.bits}`);
    const s0 = AS.actions['file.saveAs'](); await until(() => modal() && modal().querySelector('[data-id="fmt"]'));
    assert(modal().querySelector('[data-id="fmt"]').value === 'wav16', 'Save As starts with the file’s bit depth: ' + modal().querySelector('[data-id="fmt"]').value);
    modal().querySelector('[data-act="cancel"]').click(); await s0;
  });
  await t('Files: default export format for opened files; new session 48 kHz / 32-bit → mixdown rate + export format', async () => {
    P.set('files.exportFmt', 'flac24'); app.cur.bits = undefined;
    const s0 = AS.actions['file.saveAs'](); await until(() => modal() && modal().querySelector('[data-id="fmt"]'));
    assert(modal().querySelector('[data-id="fmt"]').value === 'flac24'); modal().querySelector('[data-act="cancel"]').click(); await s0;
    P.set('files.sessSr', 48000); P.set('files.sessBits', 32); P.set('mt.xfade', false); P.set('mt.overlap', 'overwrite'); P.set('mt.trackVol', -6);
    app.session.dirty = false; const q = AS.actions['mt.new'](); await until(() => modal()); modal().querySelector('[data-act="ok"]').click(); await q; await sleep(30);
    const s = app.session;
    assert(s.sr === 48000 && s.bits === 32 && s.opts.xfade === false && s.opts.overlap === 'overwrite', JSON.stringify({ sr: s.sr, bits: s.bits, o: s.opts }));
    assert(s.tracks.every((tr) => tr.vol === -6) && s.addTrack().vol === -6, 'new tracks: -6 dB');
    const j = AS.sessionIO.serialize(s); assert(j.sr === 48000 && j.bits === 32, 'saved in the .asession'); const back = AS.sessionIO.deserialize(JSON.parse(JSON.stringify(j))); assert(back.sr === 48000 && back.bits === 32);
    const e0 = AS.actions['file.exportMix'](); await until(() => modal() && modal().querySelector('[data-id="fmt"]'));
    assert(modal().querySelector('[data-id="fmt"]').value === 'wav32'); modal().querySelector('[data-act="cancel"]').click(); await e0;
    s.place(s.tracks[0], s.addClip(s.tracks[0], AS.makeSource('tone', 44100, [new Float32Array(4410).fill(0.1)]), 0));
    const m = await AS.renderMix(s, s.sr); assert(m.sr === 48000, 'mixdown rendered at the session rate');
  });
  await t('one source: the Recording / Pre-roll / Autosave / Spectral dialogs and the menus show what Preferences set (and back)', async () => {
    P.set('rec.latencyMs', 12.5); assert(app.recSettings.latencyMs === 12.5);
    const r0 = AS.actions['tp.recset'](); await until(() => modal() && modal().querySelector('[data-id="latencyMs"]'));
    assert(+modal().querySelector('[data-id="latencyMs"]').value === 12.5); modal().querySelector('[data-act="cancel"]').click(); await r0;
    P.set('autosave.minutes', 7); assert(app.autosaveOpts.minutes === 7);
    AS.actions['edit.zerosnap'](); assert(P.get('edit.zeroSnap') === true, 'menu toggle → Preferences'); AS.actions['edit.zerosnap']();
    P.set('display.specFft', 4096); assert(AS.spectral.settings().fft === 4096);
    P.set('display.timeFmt', 'samples'); assert(AS.app.timeFormat() === 'samples');
    AS.actions['view.timefmt'](); assert(P.get('display.timeFmt') === 'smpte' && AS.app.timeFormat() === 'smpte', 'View > Cycle Time Display Format writes the same value');
    const th = P.get('general.theme'); AS.actions['view.theme'](); assert(P.get('general.theme') !== th && document.documentElement.dataset.theme === P.get('general.theme')); AS.actions['view.theme']();
  });
  await t('Recording > Also save recordings to: the folder (remembered) gets each recording as a WAV', async () => {
    P.set('rec.folder', env.tmp); app.setMode('wave');
    const osc = new OscillatorNode(AS.engine.ctx || (AS.engine.init(), AS.engine.ctx), { frequency: 440 }); osc.start();
    await app.toggleRecord({ input: osc }); await sleep(600); await app.toggleRecord(); osc.stop();
    assert(await until(() => app.lastKeptRecording, 4000), 'written'); assert(/Recording \d+ .*\.wav$/.test(app.lastKeptRecording), app.lastKeptRecording);
    P.set('rec.folder', '');
  });
  await t('Reset All Preferences (button in the window): defaults everywhere', async () => {
    const { m, p } = await openPrefs('General');
    m.querySelector('[data-act2="reset"]').click(); await until(() => modal() && modal() !== m); modal().querySelector('[data-act="ok"]').click(); await p;
    assert(P.get('files.newSr') === 48000 && P.get('files.exportFmt') === 'wav24' && P.get('mt.trackVol') === 0 && P.get('display.timeFmt') === 'time');
    assert(app.recSettings.latencyMs === 0 && app.autosaveOpts.minutes === 2 && AS.spectral.settings().fft === 2048 && P.get('rec.folder') === '');
    app.session.dirty = false; const q = AS.actions['mt.new'](); await until(() => modal()); modal().querySelector('[data-act="ok"]').click(); await q;
    assert(app.session.sr === 44100 && app.session.opts.xfade === true && app.session.tracks[0].vol === 0, 'a new session uses the defaults again');
  });
};

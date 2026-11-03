// Audit 2026-11-02 G2 / G3 / G4 / H1 — real Save / Save As in the desktop app: the Save dialog runs in the main
// process (answered by the test), Cancel keeps the file unsaved, Save overwrites the file it came from, the multitrack
// session has an unsaved state and is saved as format 4 (ZIP) through the chunked writer, and reopens the same.
module.exports = async ({ t, AS, app, assert, sleep, env }) => {
  const F = window.audioStageFiles, sr = 44100;
  const modal = () => document.querySelector('.modal-back .modal');
  const until = async (f, ms) => { const t0 = Date.now(); while (!f()) { if (Date.now() - t0 > (ms || 8000)) return false; await sleep(20); } return true; };
  const sine = (f, n, a) => { const x = new Float32Array(n); for (let i = 0; i < n; i++) x[i] = a * Math.sin((2 * Math.PI * f * i) / sr); return x; };
  const readBack = async (p) => { const st = await F.stat(p); assert(st.ok && st.size > 0, 'written: ' + p); const r = await F.read(p, 0, st.size); return r.data; };
  const saveAsOk = async () => { const p = AS.actions['file.saveAs'](); assert(await until(() => modal() && modal().querySelector('[data-id="fmt"]')), 'options dialog'); modal().querySelector('[data-id="fmt"]').value = 'wav24'; modal().querySelector('[data-id="fmt"]').dispatchEvent(new Event('input')); modal().querySelector('[data-act="ok"]').click(); return p; };
  let d;
  await t('Save As → Cancel in the Save dialog: the file stays unsaved (G2)', async () => {
    app.setMode('wave');
    await app.openFiles([new File([AS.wav.encodeWav([sine(440, sr / 2, 0.5)], sr, 16, false)], 'g2 source.wav')]);
    d = app.cur; d.set([sine(550, sr / 2, 0.5)], 'Edit'); assert(d.dirty);
    await F.testSaveAnswer([null]);
    assert((await saveAsOk()) === false, 'not saved'); assert(d.dirty === true, 'still unsaved after Cancel');
    assert(/\*/.test(document.title), 'title shows the unsaved mark: ' + document.title);
  });
  await t('Save As writes the file and clears the mark; File > Save (Ctrl+S) then overwrites the same file without asking (H1)', async () => {
    const target = env.tmp + '\\g2 saved.wav'; await F.testSaveAnswer([target]);
    assert((await saveAsOk()) === true); assert(d.dirty === false && d.path === target && d.name === 'g2 saved.wav', d.path);
    let w = AS.wav.decodeWav((await readBack(target)).slice().buffer); assert(w.ch[0].length === sr / 2 && Math.abs(w.ch[0][100] - d.ch[0][100]) < 1e-4, 'content');
    d.set([sine(660, sr / 4, 0.25)], 'Edit 2'); assert(d.dirty);
    await F.testSaveAnswer(['C:\\must-not-be-asked.wav']);
    assert((await AS.actions['file.save']()) === true && !modal(), 'saved without a dialog'); assert(d.dirty === false);
    w = AS.wav.decodeWav((await readBack(target)).slice().buffer); assert(w.ch[0].length === sr / 4, 'overwritten with the new audio: ' + w.ch[0].length);
    assert(w.bits === 24, 'kept the format chosen in Save As');
    await F.testSaveAnswer([]);
  });
  let sessPath;
  await t('multitrack: an edit marks the session unsaved (closing asks); Save Session writes a format-4 ZIP and clears it (G3, G4)', async () => {
    app.session.dirty = false; await app.startNewSession(); const s = app.session; assert(!s.dirty);
    s.push(); s.place(s.tracks[0], s.addClip(s.tracks[0], AS.makeSource('tone', sr, [sine(330, sr, 0.3), sine(331, sr, 0.3)]), 0.25));
    assert(s.dirty && app.hasUnsaved(), 'unsaved');
    const ev = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(ev); assert(ev.defaultPrevented, 'closing the window asks');
    sessPath = env.tmp + '\\g3 show.asession'; await F.testSaveAnswer([sessPath]);
    assert((await app.saveSession(false)) === true); assert(!s.dirty && s.filePath === sessPath && s.fileName === 'g3 show.asession');
    const head = (await F.read(sessPath, 0, 4)).data; assert(head[0] === 0x50 && head[1] === 0x4b, 'a ZIP');
    assert(/g3 show\.asession/.test(document.title), document.title);
    const ev2 = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(ev2); assert(!ev2.defaultPrevented || app.docs.some((x) => x.dirty), 'saved: no question');
  });
  await t('the saved session opens again with the same audio; opening another one over unsaved changes asks first', async () => {
    const before = app.session, x0 = before.tracks[0].clips[0].src.ch[1][1234];
    before.push(); before.tracks[0].name = 'renamed'; assert(before.dirty);
    const src = await AS.disk.source(sessPath), p = app.loadSession(AS.disk.lazyFile(src));
    assert(await until(() => modal() && /unsaved changes/.test(modal().textContent)), 'asks'); modal().querySelector('[data-act="cancel"]').click();
    assert((await p) === false && app.session === before, 'Cancel keeps the current session');
    before.dirty = false;
    assert((await app.loadSession(AS.disk.lazyFile(await AS.disk.source(sessPath)))) === true);
    const s2 = app.session; assert(s2 !== before && !s2.dirty && s2.filePath === sessPath, 'opened, not dirty');
    assert(s2.tracks[0].clips[0].src.ch[1][1234] === x0 && s2.tracks[0].clips[0].start === 0.25, 'same audio and place');
    assert(AS.recent.list('sessions')[0].name === 'g3 show.asession', 'in Open Recent Session');
  });
  await t('Export Mixdown: the Save dialog first — Cancel renders nothing; OK writes the file', async () => {
    await F.testSaveAnswer([null]);
    let p = AS.actions['file.exportMix'](); assert(await until(() => modal() && modal().querySelector('[data-id="fmt"]'))); modal().querySelector('[data-act="ok"]').click(); assert((await p) === null);
    const out = env.tmp + '\\g2 mix.wav'; await F.testSaveAnswer([out]);
    p = AS.actions['file.exportMix'](); assert(await until(() => modal() && modal().querySelector('[data-id="fmt"]'))); modal().querySelector('[data-id="fmt"]').value = 'wav16'; modal().querySelector('[data-id="fmt"]').dispatchEvent(new Event('input')); modal().querySelector('[data-act="ok"]').click();
    assert((await p) === out, 'written'); const w = AS.wav.decodeWav((await readBack(out)).slice().buffer); assert(w.ch.length === 2 && w.ch[0].length > sr, 'a stereo mixdown');
  });
  await t('folder exports never overwrite silently: an existing name gets " (2)"', async () => {
    const a = await F.write(env.tmp, 'g6 same.wav', new Uint8Array([1])), b = await F.write(env.tmp, 'g6 same.wav', new Uint8Array([2]));
    assert(a.ok && b.ok && a.name === 'g6 same.wav' && b.name === 'g6 same (2).wav', JSON.stringify([a, b]));
    const e = await F.exists(env.tmp, ['g6 same.wav', 'g6 other.wav']); assert(e.existing.length === 1 && e.existing[0] === 'g6 same.wav');
  });
  await t('clean up', async () => { for (const x of app.docs) x.dirty = false; app.session.dirty = false; AS.actions['file.closeall'](); await sleep(50); app.setMode('wave'); });
};

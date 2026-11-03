// Roadmap 2.3 — Favorites (record through the real effect dialog, apply as one undo step, panel), Batch Process with a
// multi-step favorite + file-name template (files written by the desktop app), Keyboard Shortcuts editor (preset,
// recording a key, conflicts) — all in the real app.
module.exports = async ({ t, AS, app, assert, near, sleep, env }) => {
  const sr = 44100, D = AS.dsp, F = AS.favorites, K = AS.keys;
  const tone = (a, secs) => { const x = new Float32Array(Math.round(sr * secs)); for (let i = 0; i < x.length; i++) x[i] = a * Math.sin(2 * Math.PI * 330 * i / sr); return x; };
  const open = async (name, chs) => { await app.openFiles([new File([AS.wav.encodeWav(chs, sr, 32, false)], name)]); return app.cur; };
  const modal = () => [...document.querySelectorAll('.modal')].pop();
  const setField = (dlg, id, v) => { const el = dlg.querySelector(`[data-id="${id}"]`); if (el.type === 'checkbox') el.checked = v; else el.value = v; el.dispatchEvent(new Event('input')); };
  let fav = null;

  await t('record a favorite: an effect from its real dialog + Convert to Mono, saved with a name', async () => {
    app.setMode('wave'); F._reset(); const d = await open('fav-a.wav', [tone(0.2, 1), tone(0.1, 1)]);
    AS.actions['fav.record'](); assert(F.recorder.active());
    const p = app.runId('fx:amplify'); await sleep(50); setField(modal(), 'gain', 4.5); modal().querySelector('[data-act="ok"]').click(); await p;
    for (let i = 0; i < 60 && d.undoStack.length < 1; i++) await sleep(50);
    app.runId('edit.tomono'); assert(d.ch.length === 1, 'mono');
    assert(F.recorder.steps().length === 2, 'steps while recording: ' + JSON.stringify(F.recorder.steps()));
    const s = AS.actions['fav.stop'](); await sleep(50); setField(modal(), 'name', 'Louder mono'); modal().querySelector('[data-act="ok"]').click(); fav = await s;
    assert(fav && fav.name === 'Louder mono', 'saved'); assert(JSON.stringify(fav.steps) === JSON.stringify([{ type: 'fx', id: 'amplify', p: { gain: 4.5 } }, { type: 'op', id: 'edit.tomono' }]), JSON.stringify(fav.steps));
    assert(!F.recorder.active());
  });
  await t('apply the favorite from the Favorites menu: same result as by hand, one undo step', async () => {
    const d = await open('fav-b.wav', [tone(0.1, 1), tone(0.05, 1)]), n = d.undoStack.length;
    await app.runId('fav:' + fav.id);
    assert(d.ch.length === 1, 'mono'); near(D.peakOf(d.ch), D.fromDb(4.5) * 0.075, 0.002, 'amplified mix');
    assert(d.undoStack.length === n + 1 && /Louder mono/.test(d.undoStack[n].label), 'one undo step: ' + d.undoStack.map((u) => u.label));
    AS.actions['edit.undo'](); assert(app.cur.ch.length === 2, 'undo restores stereo');
    await AS.actions['fx.repeat'](); assert(app.cur.ch.length === 1, 'Repeat Last Effect repeats the favorite');
  });
  await t('Favorites panel lists built-ins and the new favorite; ▶ applies it', async () => {
    AS.panels.show('favorites'); const b = AS.panels.defs.favorites.body; await sleep(50);
    const rows = [...b.querySelectorAll('.fitem.fv')]; assert(rows.length === F.BUILTIN.length + 1, 'rows ' + rows.length);
    const row = rows.find((r) => /Louder mono/.test(r.textContent)); assert(row && /Amplify/.test(row.textContent));
    const d = await open('fav-c.wav', [tone(0.1, 0.5)]); row.querySelector('[data-a="apply"]').click();
    for (let i = 0; i < 60 && !d.undoStack.length; i++) await sleep(50); near(D.peakOf(d.ch), D.fromDb(4.5) * 0.1, 0.002);
    AS.panels.hide('favorites');
  });
  await t('Batch Process with a multi-step favorite + name template: every open file processed and exported', async () => {
    for (const d of app.docs) d.dirty = false; while (app.docs.length) AS.actions['file.close']();
    const a = await open('one.wav', [tone(0.05, 0.6), tone(0.05, 0.6)]), b = await open('two.wav', [tone(0.3, 0.4), tone(0.3, 0.4)]);
    const steps = [{ type: 'op', id: 'edit.tomono' }, { type: 'fx', id: 'normalize', p: { target: -3 } }], dir = env.tmp + '\\batch';
    const r = await app.batchRun({ steps, label: 'Mono −3', fmt: 'wav16', template: '{nn}_{name}_{fav}', dir });
    assert(r && r.n === 2 && r.written.length === 2, JSON.stringify(r)); assert(r.written.join('|') === '01_one_Mono −3.wav|02_two_Mono −3.wav', r.written.join('|'));
    for (const d of [a, b]) { assert(d.ch.length === 1, 'mono in place'); near(D.toDb(D.peakOf(d.ch)), -3, 0.05); assert(/Batch: Mono/.test(d.undoStack[d.undoStack.length - 1].label)); }
    const f = await window.audioStageMedia.read(dir + '\\' + r.written[1]); assert(f.ok, 'file written');
    const w = AS.wav.decodeWav(f.data.buffer.slice(f.data.byteOffset, f.data.byteOffset + f.data.byteLength)); assert(w.ch.length === 1 && w.ch[0].length === b.len, 'exported mono, same length');
    near(D.toDb(D.peakOf(w.ch)), -3, 0.1, 'exported level');
  });
  await t('Keyboard Shortcuts: Adobe Audition preset, record a new key, conflict warning, the key works after Save', async () => {
    const before = K.state(); try {
      const p = AS.actions['edit.keys'](); await sleep(50); const dlg = modal();
      const pre = dlg.querySelector('.ks-preset'); pre.value = 'audition'; pre.dispatchEvent(new Event('change'));
      const row = (id) => dlg.querySelector(`tr[data-id="${id}"]`);
      assert(row('edit.redo').querySelector('.ks-key').textContent === 'Ctrl+Shift+Z', 'Audition redo: ' + row('edit.redo').querySelector('.ks-key').textContent);
      row('edit.marker').querySelector('.ks-key').click(); window.dispatchEvent(new KeyboardEvent('keydown', { key: 'F7', bubbles: true, cancelable: true }));
      assert(row('edit.marker').querySelector('.ks-key').textContent === 'F7', 'recorded F7');
      row('edit.crop').querySelector('.ks-key').click(); window.dispatchEvent(new KeyboardEvent('keydown', { key: 'F7', bubbles: true, cancelable: true }));
      assert(/F7/.test(dlg.querySelector('.ks-conf').textContent) && row('edit.crop').querySelector('.ks-key').classList.contains('danger'), 'conflict shown');
      row('edit.crop').querySelector('[data-a="def"]').click(); assert(!/F7/.test(dlg.querySelector('.ks-conf').textContent), 'conflict gone after ↺');
      dlg.querySelector('[data-act="ok"]').click(); assert(await p, 'saved');
      assert(K.state().preset === 'audition' && K.state().map['edit.marker'] === 'F7');
      const d = app.cur, n = d.markers.length; d.sel = { a: 1000, b: 1000 };
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'F7', bubbles: true, cancelable: true })); assert(d.markers.length === n + 1, 'F7 adds a marker (dialogOpen=' + AS.ui.dialogOpen() + ', modals=' + document.querySelectorAll('.modal').length + ', mode=' + app.mode + ', cur=' + (app.cur && app.cur.name) + ', active=' + (document.activeElement && document.activeElement.tagName + '.' + document.activeElement.className) + ')');
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'm', bubbles: true, cancelable: true })); assert(d.markers.length === n + 1, 'M no longer does');
    } finally { K.setState(before); app.refreshKeys(); }
    for (const d of app.docs.slice()) d.dirty = false; while (app.docs.length) AS.actions['file.close'](); F._reset();
  });
};

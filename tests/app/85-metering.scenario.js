// Roadmap 2.4 — metering in the real app: live Loudness Meter (M / S / I / TP from what is played), Amplitude
// Statistics with true peak + LRA / PLR, Hard Limiter in True-Peak mode through its dialog, Match Loudness with a
// true-peak ceiling, Phase Meter correlation + vectorscope, Diagnostics scan → repair one / all → undo.
module.exports = async ({ t, AS, app, assert, near, sleep }) => {
  const sr = 44100, D = AS.dsp, eng = AS.engine;
  const sine = (f, amp, secs, ph) => { const x = new Float32Array(Math.round(sr * secs)); for (let i = 0; i < x.length; i++) x[i] = amp * Math.sin(2 * Math.PI * f * i / sr + (ph || 0)); return x; };
  const open = async (name, chs) => { await app.openFiles([new File([AS.wav.encodeWav(chs, sr, 32, false)], name)]); return app.cur; };
  const modal = () => [...document.querySelectorAll('.modal')].pop();
  const closeAll = () => { if (eng.playing) AS.actions['tp.stop'](); for (const d of app.docs) d.dirty = false; while (app.docs.length) AS.actions['file.close'](); };

  await t('Loudness Meter (live): a −23 dBFS stereo 1 kHz tone reads −23 LUFS momentary / short-term / integrated', async () => {
    app.setMode('wave'); eng.init(); const x = sine(1000, D.fromDb(-23), 8); await open('lufs.wav', [x, x]);
    AS.panels.show('loudness'); await sleep(300); assert(AS.loudnessPanel.untap, 'tap running');
    AS.actions['tp.play'](); await sleep(4300); AS.actions['tp.stop']();
    const r = AS.loudnessPanel.meter.readings(); near(r.S, -23, 0.5, 'short-term'); near(r.I, -23, 0.5, 'integrated'); near(r.Mmax, -23, 0.5, 'momentary max'); near(r.TP, -23, 0.3, 'true peak');
    const txt = AS.panels.defs.loudness.body.textContent; assert(/Integrated/.test(txt) && /dBTP/.test(txt), 'panel shows the readings');
    AS.panels.hide('loudness'); assert(!AS.loudnessPanel.untap, 'tap removed when hidden');
  });
  await t('Amplitude Statistics: true peak (dBTP), LRA, max momentary / short-term and PLR', async () => {
    const x = sine(sr / 4, 1, 2, Math.PI / 4); // fs/4, sampled 45° off its peaks for (let i = 0; i < 4410; i++) { x[i] *= i / 4410; x[x.length - 1 - i] *= i / 4410; }
    await open('tp.wav', [x]); const p = AS.actions['an.stats'](); await sleep(150);
    const s = app.lastStats; near(D.toDb(s.peak), -3, 0.1, 'sample peak'); near(D.toDb(s.tp.peak), 0, 0.15, 'true peak'); assert(isFinite(s.lf.I) && isFinite(s.lf.PLR));
    const txt = modal().textContent; assert(/dBTP/.test(txt) && /LRA/.test(txt) && /PLR/.test(txt), 'dialog rows'); modal().querySelector('[data-act="cancel"]').click(); await p;
  });
  await t('Hard Limiter → True Peak limiting (through its dialog) keeps inter-sample peaks under −1 dBTP', async () => {
    const d = app.cur; assert(D.toDb(D.truePeak(d.ch).peak) > -0.2);
    const p = app.runId('fx:limiter'); await sleep(80); const dlg = modal();
    const tp = dlg.querySelector('[data-id="tp"]'); tp.checked = true; tp.dispatchEvent(new Event('input'));
    const c = dlg.querySelector('[data-id="ceil"]'); c.value = -1; c.dispatchEvent(new Event('input'));
    dlg.querySelector('[data-act="ok"]').click(); await p; for (let i = 0; i < 100 && !d.undoStack.length; i++) await sleep(50);
    assert(D.toDb(D.truePeak(d.ch).peak) <= -0.97, 'true peak after: ' + D.toDb(D.truePeak(d.ch).peak));
  });
  await t('Match Loudness: shows LUFS and dBTP; matching uses the true-peak ceiling', async () => {
    closeAll(); await open('loud.wav', [sine(3000, 0.9, 3, 0.4), sine(3000, 0.9, 3, 1.1)]); AS.panels.show('match'); const b = AS.panels.defs.match.body;
    b.querySelector('.ml-scan').click(); await sleep(400); assert(/dBTP/.test(b.textContent), 'TP column');
    b.querySelector('.ml-t').value = '-9'; b.querySelector('.ml-t').insertAdjacentHTML('beforeend', '<option value="-9">−9 (test)</option>'); b.querySelector('.ml-t').value = '-9'; b.querySelector('.ml-c').value = '-2';
    b.querySelector('.ml-go').click(); const d = app.cur; for (let i = 0; i < 100 && !d.undoStack.length; i++) await sleep(50); await sleep(300);
    assert(D.toDb(D.truePeak(d.ch).peak) <= -1.97, 'true peak ≤ −2 dBTP: ' + D.toDb(D.truePeak(d.ch).peak)); AS.panels.hide('match');
  });
  await t('Phase Meter: in-phase stereo reads +1, inverted −1; the vectorscope draws', async () => {
    closeAll(); const x = sine(500, 0.4, 3); await open('ph.wav', [x, x.map((v) => -v)]);
    AS.panels.show('phase'); await sleep(200); AS.actions['tp.play'](); await sleep(1200);
    near(AS.phaseMeter.v, -1, 0.05, 'out of phase'); near(AS.phaseMeter.bands[1], -1, 0.1, 'mid band');
    const vs = AS.panels.defs.phase.body.querySelector('.vsc'), px = vs.getContext('2d').getImageData(0, 0, vs.width, vs.height).data; let lit = 0; for (let i = 1; i < px.length; i += 4) if (px[i] > 150) lit++; assert(lit > 20, 'vectorscope points drawn: ' + lit);
    AS.actions['tp.stop'](); closeAll(); await open('ph2.wav', [x, x]); AS.actions['tp.play'](); await sleep(1200); AS.actions['tp.stop']();
    near(AS.phaseMeter.v, 1, 0.05, 'in phase'); AS.panels.hide('phase');
  });
  await t('Diagnostics: DeClicker scan lists the clicks; Repair one, Repair All, undo; Delete Silence and Mark Audio', async () => {
    closeAll(); const x = sine(440, 0.3, 2); for (const at of [20000, 45000, 70000]) for (let i = 0; i < 4; i++) x[at + i] += i % 2 ? -0.6 : 0.6;
    const d = await open('clicks.wav', [x]); AS.panels.show('diagnostics'); const b = AS.panels.defs.diagnostics.body, dg = AS.diagPanel;
    b.querySelector('[data-a="scan"]').click(); assert(dg.items.length === 3, 'found ' + dg.items.length); assert(b.querySelectorAll('.dg-it').length === 3);
    b.querySelector('.dg-it').click(); assert(d.sel.a === dg.items[0].s, 'click selects the item');
    b.querySelector('.dg-it [data-a="fix"]').click(); assert(dg.items.length === 2, 'one repaired, re-scanned'); assert(/DeClicker repair/.test(d.undoStack[d.undoStack.length - 1].label));
    b.querySelector('[data-a="all"]').click(); assert(dg.items.length === 0, 'all repaired'); assert(D.detectClicks(d.ch, 10, 40).length === 0);
    AS.actions['edit.undo'](); AS.actions['edit.undo'](); assert(D.detectClicks(app.cur.ch, 10, 40).length === 3, 'undo brings the clicks back');
    closeAll(); const sp = new Float32Array(sr * 3); sp.set(sine(300, 0.3, 0.5), sr * 0.5); sp.set(sine(300, 0.3, 0.5), sr * 2); const d2 = await open('sil.wav', [sp]);
    const kind = b.querySelector('.dg-kind'); kind.value = 'delsilence'; kind.dispatchEvent(new Event('change')); b.querySelector('[data-a="scan"]').click();
    assert(dg.items.length === 3, 'silences ' + dg.items.length); b.querySelector('[data-a="all"]').click();
    near(d2.len / sr, 1 + 2 * 0.1 + 0.2, 0.05, 'silences deleted (100 ms kept next to the audio)');
    AS.actions['edit.undo'](); near(d2.len / sr, 3, 1e-9, 'undo restores the silences'); // (after the cut the 0.2 s gap is shorter than Mark Audio’s 0.3 s minimum)
    kind.value = 'markaudio'; kind.dispatchEvent(new Event('change')); b.querySelector('[data-a="scan"]').click(); assert(dg.items.length === 2, 'audio regions ' + dg.items.length);
    b.querySelector('[data-a="all"]').click(); assert(d2.ranges().length === 2, 'range markers for the audio');
    AS.panels.hide('diagnostics'); closeAll();
  });
};

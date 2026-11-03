// Roadmap-missing 7 — DeReverb in the real app: Effects > Noise Reduction / Restoration > DeReverb (process)… through its
// dialog (preview, apply, undo) and the real-time DeReverb rack effect (AudioWorklet render = the offline effect).
module.exports = async ({ t, AS, app, assert, near, sleep }) => {
  const sr = 44100, D = AS.dsp, eng = AS.engine, modal = () => [...document.querySelectorAll('.modal')].pop();
  /* dry syllables with pauses, through a 0.6 s synthetic room (direct-to-reverb ratio 0 dB) */
  const dry = new Float32Array(sr * 3);
  for (let b = 0; b < 7; b++) { const s = Math.round((0.1 + b * 0.4) * sr), n = Math.round(0.15 * sr); for (let i = 0; i < n; i++) dry[s + i] = Math.sin((Math.PI * i) / n) * 0.4 * Math.sin((2 * Math.PI * (200 + 60 * b) * i) / sr); }
  const ir = D.reverbIR(sr, { decay: 0.6 })[0]; let e = 0; for (const v of ir) e += v * v; for (let i = 0; i < ir.length; i++) ir[i] /= Math.sqrt(e); ir[0] += 1;
  const wet = new Float32Array(dry.length); for (let i = 0; i < dry.length; i++) if (dry[i]) for (let k = 0; k < ir.length && i + k < wet.length; k++) wet[i + k] += dry[i] * ir[k];
  /* energy in the pauses (where the dry signal is silent: only reverb tail there) relative to the whole */
  const tailShare = (y) => { let p = 0, all = 0; for (let b = 0; b < 7; b++) { const s = Math.round((0.1 + b * 0.4 + 0.2) * sr); for (let i = s; i < s + Math.round(0.18 * sr) && i < y.length; i++) p += y[i] * y[i]; } for (const v of y) all += v * v; return p / all; };

  await t('DeReverb is in the Effects menu (real-time and process) and in the rack effect list', async () => {
    const nr = AS.fxmenu.CATS.find((c) => c.name === 'Noise Reduction / Restoration').items;
    assert(nr.some((it) => it.rack === 'dereverb') && nr.some((it) => it.fx === 'dereverb'), 'menu items');
    assert(AS.fxmenu.rackGroups().some(([, list]) => list.some(([k]) => k === 'dereverb')), 'rack slot picker');
  });
  await t('DeReverb (process)…: dialog with Amount / Processing Focus / Gain + Preview → Apply lowers the reverb tail; undo', async () => {
    app.setMode('wave'); eng.init(); await app.openFiles([new File([AS.wav.encodeWav([wet], sr, 32, false)], 'reverb-room.wav')]);
    const d = app.cur, before = tailShare(d.ch[0]);
    const p = app.runId('fx:dereverb'); for (let i = 0; i < 40 && !(modal() && modal().querySelector('[data-id="amount"]')); i++) await sleep(50);
    const m = modal(); assert(m.querySelector('[data-id="focus"]') && m.querySelector('[data-id="gain"]') && m.querySelector('[data-id="auto"]'), 'parameters');
    assert(/reverberation/.test(m.querySelector('[data-id="amount"]').closest('.frow').title), 'tooltip on Amount');
    const pv = m.querySelector('[data-act="preview"]'); assert(pv, 'Preview button'); pv.click(); await sleep(400); assert(eng.playing, 'preview plays'); pv.click(); await sleep(50);
    const a = m.querySelector('[data-id="amount"]'); a.value = 90; a.dispatchEvent(new Event('input', { bubbles: true }));
    m.querySelector('[data-act="ok"]').click(); await p; for (let i = 0; i < 200 && !d.undoStack.length; i++) await sleep(50);
    assert(d.undoStack.length && /DeReverb/.test(d.undoStack[d.undoStack.length - 1].label), 'undo step');
    const after = tailShare(d.ch[0]); assert(after < before * 0.6, `reverb in the pauses ${(100 * before).toFixed(1)} % → ${(100 * after).toFixed(1)} %`);
    AS.actions['edit.undo'](); assert(d.ch[0].every((v, i) => v === wet[i]), 'undo restores the audio');
  });
  await t('DeReverb rack effect: the AudioWorklet render matches the offline algorithm (latency compensated)', async () => {
    const fx = AS.rack.newFx('dereverb', { amount: 80, focus: 'mid', t60: 0.6, gain: 3 });
    const live = (await AS.rack.renderFx(fx, [wet, wet], sr, 0))[0], off = D.dereverb([wet], sr, 80, 'mid', 3, 0.6)[0];
    let err = 0, pk = 0; for (let i = 0; i < off.length - 4096; i++) { err = Math.max(err, Math.abs(live[i] - off[i])); pk = Math.max(pk, Math.abs(off[i])); }
    assert(err < pk * 1e-3, `max difference ${err} (peak ${pk})`); assert(tailShare(live) < tailShare(wet) * 0.7, 'the live effect lowers the tail too');
  });
  await t('DeReverb rack window (Waveform): live preview and Apply', async () => {
    const d = app.cur, n = d.undoStack.length; app.runId('rfx:dereverb'); await sleep(150);
    const w = [...document.querySelectorAll('.fxwin')].pop(); assert(w && /DeReverb/.test(w.textContent), 'window');
    w.querySelector('[data-a=preview]').click(); await sleep(500); assert(eng.playing, 'preview plays');
    w.querySelector('[data-a=apply]').click(); for (let i = 0; i < 200 && d.undoStack.length === n; i++) await sleep(50);
    assert(d.undoStack.length === n + 1 && /DeReverb/.test(d.undoStack[n].label), 'applied: ' + (d.undoStack[n] || {}).label); assert(tailShare(d.ch[0]) < tailShare(wet) * 0.8);
    AS.actions['edit.undo'](); d.dirty = false; AS.actions['file.close']();
  });
};

// Roadmap-missing 8 — Generate > Speech… in the real app (the app tests give main.js a fake voice engine,
// AUDIOSTAGE_TTS_MOCK: Thai + English voices, a 300 Hz tone 80 ms per character): the dialog, replace the selection /
// insert at the playhead, speed and pitch, undo, a new file when none is open, a language without a voice.
module.exports = async ({ t, AS, app, assert, near, sleep }) => {
  const sr = 44100, modal = () => [...document.querySelectorAll('.modal')].pop(), until = async (f) => { for (let i = 0; i < 200 && !f(); i++) await sleep(25); assert(f(), 'timed out'); };
  const menuLabels = (name) => { const b = [...document.querySelectorAll('#menubar .mb')].find((x) => x.textContent === name); b.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); const l = [...document.querySelectorAll('.menu .ml')].map((x) => x.textContent); b.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); return l; };
  const set = (m, id, v) => { const el = m.querySelector(`[data-id="${id}"]`); el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); };
  const speak = async (vals) => {
    const p = app.runId('gen.speech'); await until(() => modal() && modal().querySelector('[data-id="text"]')); const m = modal();
    for (const [k, v] of Object.entries(vals)) set(m, k, v);
    m.querySelector('[data-act="ok"]').click(); await p; return m;
  };
  const closeAll = () => { for (const d of app.docs) d.dirty = false; while (app.docs.length) AS.actions['file.close'](); };

  await t('Generate > Speech… is there (desktop app); the dialog lists the Windows voices, Thai first', async () => {
    assert(menuLabels('Generate').includes('Speech...'), 'menu item');
    app.setMode('wave'); closeAll(); const p = app.runId('gen.speech'); await until(() => modal() && modal().querySelector('[data-id="voice"]'));
    const m = modal(), opts = [...m.querySelectorAll('[data-id="voice"] option')].map((o) => o.textContent);
    assert(/^Thai \(ภาษาไทย\) — Microsoft Pattara/.test(opts[0]) && opts.some((o) => /English.*Zira/.test(o)), opts.join('|'));
    assert(m.querySelector('textarea[data-id="text"]') && m.querySelector('[data-id="speed"]') && m.querySelector('[data-id="pitch"]'), 'fields');
    assert(/new audio file/.test(m.textContent), 'no file open → a new file'); assert(/What the voice says/.test(m.querySelector('[data-id="text"]').closest('.frow').title), 'tooltip');
    set(m, 'voice', 'missing:ko-KR'); assert(/No Korean voice is installed.*Add a language > Korean/.test(m.querySelector('.sp-missing').textContent), 'how to add a voice: ' + m.querySelector('.sp-missing').textContent);
    m.querySelector('[data-act="cancel"]').click(); await p;
  });
  await t('no file open: the Thai speech becomes a new file at the Files preferences’ rate', async () => {
    await speak({ text: 'สวัสดีครับ', voice: 'winrt|MOCK_thTH' }); await until(() => app.cur);
    const d = app.cur; assert(/^Speech/.test(d.name), d.name); assert(d.sr === +AS.prefs.get('files.newSr'), String(d.sr));
    near(d.ch[0].length / d.sr, 10 * 0.08, 0.01, 'length follows the text (10 characters)'); near(AS.dsp.toDb(AS.dsp.peakOf(d.ch)), -3, 0.05, 'normalized to the Level');
  });
  await t('selection → replaced by the speech (speed 200 %, pitch +12 st); Insert keeps the selection; undo', async () => {
    closeAll(); const x = new Float32Array(sr * 3).fill(0.05); await app.openFiles([new File([AS.wav.encodeWav([x, x], sr, 32, false)], 'speech-host.wav')]);
    const d = app.cur; d.sel = { a: sr, b: 2 * sr };
    await speak({ text: 'Hello world', voice: 'sapi|MOCK enUS', speed: 200, pitch: 12, place: 'replace' }); await until(() => d.undoStack.length === 1);
    const n = Math.round(11 * 0.08 * sr / 2); assert(d.undoStack[0].label === 'Generate Speech', String(d.undoStack[0].label)); assert(d.ch.length === 2, 'stereo kept');
    near(d.ch[0].length, sr * 2 + n, sr * 0.01, 'the 1 s selection is replaced by the 0.44 s speech'); near(d.sel.b - d.sel.a, n, sr * 0.01, 'new selection = the speech');
    const mid = d.sel.a + (n >> 1); let zc = 0; for (let i = mid - 4410; i < mid + 4410; i++) if (d.ch[0][i - 1] < 0 && d.ch[0][i] >= 0) zc++; near(zc / 0.2, 600, 20, 'pitch +12 st → 600 Hz');
    AS.actions['edit.undo'](); assert(d.ch[0].length === 3 * sr && d.ch[0].every((v) => v === x[0]), 'undo restores the audio');
    d.sel = { a: sr, b: 2 * sr }; await speak({ text: 'abcd', voice: 'sapi|MOCK enUS', speed: 100, pitch: 0, place: 'insert' }); await until(() => d.undoStack.length === 1);
    near(d.ch[0].length, 3 * sr + 4 * 0.08 * sr, 20, 'inserted, nothing removed'); assert(d.ch[0][d.sel.b + 10] === x[0], 'the old selection follows the speech');
    AS.actions['edit.undo']();
  });
  await t('no selection: inserted at the playhead', async () => {
    const d = app.cur; d.sel = { a: Math.round(0.5 * sr), b: Math.round(0.5 * sr) };
    await speak({ text: 'ab', voice: 'sapi|MOCK enUS' }); await until(() => d.undoStack.length === 1);
    near(d.ch[0].length, 3 * sr + 0.16 * sr, 20); assert(d.sel.a === Math.round(0.5 * sr), String(d.sel.a)); AS.actions['edit.undo'](); closeAll();
  });
};

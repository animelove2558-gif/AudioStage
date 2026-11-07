// Edit > Insert Silence… and Repeat Selection…
module.exports = async ({ t, AS, app, assert, near, sleep }) => {
  const pressOk = async () => { await sleep(60); document.querySelector('.modal-back [data-act="ok"]').click(); await sleep(80); };
  await t('Insert Silence adds the length at the selection start; Repeat Selection copies the selection after itself; both undo', async () => {
    app.setMode('wave'); const sr = 8000, x = Float32Array.from({ length: 8000 }, (_, i) => (i < 4000 ? 0.5 : -0.5));
    await app.openFiles([new File([AS.wav.encodeWav([x], sr, 16, false)], 't-edit.wav')]); const doc = app.cur; assert(doc && doc.len === 8000, 'doc ' + (doc ? doc.name + ' ' + doc.len : 'none'));
    doc.sel.a = 4000; doc.sel.b = 4000; const p = AS.actions['edit.insertsilence'](); await pressOk(); await p;
    assert(doc.len === 16000, 'len ' + doc.len); near(doc.ch[0][3999], 0.5, 1e-3); assert(doc.ch[0][4000] === 0 && doc.ch[0][11999] === 0, 'silence'); near(doc.ch[0][12000], -0.5, 1e-3);
    doc.undo(); assert(doc.len === 8000, 'undo');
    doc.sel.a = 0; doc.sel.b = 100; const q = AS.actions['edit.repeatsel'](); await pressOk(); await q;
    assert(doc.len === 8100, 'repeat len ' + doc.len); near(doc.ch[0][150], 0.5, 1e-3); near(doc.ch[0][4099], 0.5, 1e-3); near(doc.ch[0][4100], -0.5, 1e-3);
  });
};

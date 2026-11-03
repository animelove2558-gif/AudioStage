// ROADMAP-MISSING 6 — Window > Workspace in the real app: the five built-in workspaces on Alt+Shift+1…5 (the key types
// "#" etc. — the digit counts), Save as New Workspace…, Edit Workspaces… (rename / delete), Reset to Saved Layout.
module.exports = async ({ t, AS, app, assert, sleep }) => {
  const W = AS.workspaces, P = AS.panels, modal = () => [...document.querySelectorAll('.modal')].pop();
  const until = async (f, ms) => { for (let i = 0; i < (ms || 5000) / 50; i++) { if (f()) return true; await sleep(50); } return false; };
  const shown = (id) => P.isVisible(id) && !P.defs[id].el.hidden;
  const press = (digit, key) => document.dispatchEvent(new KeyboardEvent('keydown', { key, code: 'Digit' + digit, altKey: true, shiftKey: true, bubbles: true }));
  const openWindowMenu = () => { const b = [...document.querySelectorAll('#menubar .mb')].find((x) => x.textContent === 'Window'); b.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); return b; };

  await t('Window > Workspace submenu: the five built-ins with Alt+Shift+1…5, Save / Edit / Reset', async () => {
    const b = openWindowMenu(), row = [...document.querySelectorAll('.menu .mi')].find((x) => x.querySelector('.ml').textContent === 'Workspace');
    assert(row, 'Workspace row'); row.click(); await sleep(30);
    const sub = [...document.querySelectorAll('.menu.sub .mi')].map((x) => x.querySelector('.ml').textContent + '|' + x.querySelector('.ms').textContent);
    for (const x of ['Default|Alt+Shift+1', 'Editing|Alt+Shift+2', 'Mixing|Alt+Shift+3', 'Spectral Repair|Alt+Shift+4', 'Podcast / Radio|Alt+Shift+5', 'Save as New Workspace…|', 'Edit Workspaces…|', 'Reset to Saved Layout|']) assert(sub.includes(x), x + ' in ' + sub.join(', '));
    b.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
  });
  await t('Alt+Shift+3 → Mixing (Multitrack + Mixer + Effects Rack), Alt+Shift+4 → Spectral Repair, Alt+Shift+2 → Editing', async () => {
    press(3, '#'); await sleep(50);
    assert(app.mode === 'multi' && W.current() === 'mixing', app.mode + ' ' + W.current());
    assert(shown('mixer') && shown('rack') && !shown('markers') && !shown('effects') && shown('transport'), 'mixing panels');
    press(4, '$'); await sleep(50);
    assert(app.mode === 'wave' && app.specMode && shown('spectrum') && shown('diagnostics') && !shown('mixer'), 'spectral repair');
    press(2, '@'); await sleep(50);
    assert(app.mode === 'wave' && !app.specMode && shown('history') && shown('markers') && !shown('spectrum'), 'editing');
    press(5, '%'); await sleep(50); assert(app.mode === 'multi' && shown('essential') && shown('loudness') && shown('match'), 'podcast');
  });
  await t('Save as New Workspace… (dialog) keeps the layout; switching away and back restores it; Reset to Saved Layout', async () => {
    P.show('phase'); P.hide('mixer');
    const p = W.saveDialog(); await until(() => modal() && modal().querySelector('[data-id="name"]'));
    const inp = modal().querySelector('[data-id="name"]'); inp.value = 'Mixing'; inp.dispatchEvent(new Event('input', { bubbles: true })); modal().querySelector('[data-act="ok"]').click();
    await until(() => modal() && modal().querySelector('[data-id="name"]') && modal().querySelector('[data-id="name"]').value === 'Mixing'); // refused (taken): asked again
    const inp2 = modal().querySelector('[data-id="name"]'); inp2.value = 'My Show'; inp2.dispatchEvent(new Event('input', { bubbles: true })); modal().querySelector('[data-act="ok"]').click();
    const id = await p; assert(id && W.byId(id).name === 'My Show' && W.current() === id);
    AS.app.runId('ws:default'); assert(!shown('phase') && shown('markers') && shown('files'), 'Default: the panels’ defaults');
    AS.app.runId('ws:' + id); assert(shown('phase') && !shown('mixer') && app.mode === 'multi', 'back');
    P.show('mixer'); P.hide('phase'); AS.app.runId('win.ws.reset'); assert(shown('phase') && !shown('mixer'), 'reset to saved');
    assert(JSON.parse(localStorage.getItem('as-workspaces-v1')).user.some((u) => u.name === 'My Show'), 'stored');
  });
  await t('Edit Workspaces…: rename, then delete (the layout stays, Default ticked); built-ins have no delete button', async () => {
    const id = W.all().find((w) => w.name === 'My Show').id;
    const p = W.editDialog(); await until(() => modal() && modal().querySelector('.ws-list'));
    const ed = modal(); assert(!ed.querySelector('[data-w="mixing"] [data-a="del"]'), 'built-in: no delete');
    ed.querySelector(`[data-w="${id}"] [data-a="ren"]`).click(); await until(() => modal() !== ed);
    const n = modal().querySelector('[data-id="name"]'); n.value = 'Interview'; n.dispatchEvent(new Event('input', { bubbles: true })); modal().querySelector('[data-act="ok"]').click();
    await until(() => /Interview/.test(ed.textContent)); assert(W.byId(id).name === 'Interview');
    ed.querySelector(`[data-w="${id}"] [data-a="del"]`).click(); await until(() => modal() !== ed); modal().querySelector('[data-act="ok"]').click();
    await until(() => !ed.querySelector(`[data-w="${id}"]`)); assert(!W.byId(id) && W.current() === 'default' && shown('phase'), 'deleted, layout kept');
    ed.querySelector('[data-act="cancel"]').click(); await p;
  });
  await t('back to Default (Alt+Shift+1) for the scenarios after this one', async () => {
    app.setMode('wave'); press(1, '!'); await sleep(50);
    assert(W.current() === 'default' && shown('files') && shown('effects') && !shown('phase') && !shown('mixer'));
  });
};

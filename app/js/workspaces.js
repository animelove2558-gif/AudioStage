/* Window > Workspace: named panel layouts like Audition's — which panels are shown / collapsed, plus Waveform or
   Multitrack and the Spectral view. Five built in (Alt+Shift+1…5) and the user's own (localStorage 'as-workspaces-v1').
   Changes made after switching are the live layout (as-panels-v1, kept by panels.js); Reset to Saved Layout goes back.
   host: { panels: AS.panels, mode(), setMode(m), spec(), setSpec(on) } */
(function (root) {
  'use strict';
  const AS = (root.AS = root.AS || {});
  const KEY = 'as-workspaces-v1';
  const BARS = ['tools', 'transport', 'timedisp', 'statusbar'];
  /* show: the panels that are visible (every other panel hidden); no show = each panel's registered default */
  const BUILTIN = [
    { id: 'default', name: 'Default' },
    { id: 'editing', name: 'Editing', mode: 'wave', spec: false, show: ['files', 'markers', 'history', 'selview', 'effects', 'props', 'video'] },
    { id: 'mixing', name: 'Mixing', mode: 'multi', show: ['files', 'rack', 'mixer', 'levels', 'props', 'loudness'] },
    { id: 'spectral', name: 'Spectral Repair', mode: 'wave', spec: true, show: ['files', 'history', 'selview', 'effects', 'spectrum', 'diagnostics'] },
    { id: 'podcast', name: 'Podcast / Radio', mode: 'multi', show: ['files', 'markers', 'media', 'essential', 'loudness', 'match', 'mixer'] },
  ];
  let st = { current: 'default', user: [], seq: 0 }, host = null;
  try { st = { ...st, ...(JSON.parse(root.localStorage.getItem(KEY)) || {}) }; } catch (e) { /* defaults */ }
  if (!Array.isArray(st.user)) st.user = [];
  const save = () => { try { root.localStorage.setItem(KEY, JSON.stringify(st)); } catch (e) { /* private mode: kept for this session only */ } };

  const all = () => [...BUILTIN.map((b) => ({ id: b.id, name: b.name, builtin: true })), ...st.user.map((u) => ({ id: u.id, name: u.name, builtin: false }))];
  const byId = (id) => all().find((w) => w.id === id) || null;
  const current = () => (byId(st.current) ? st.current : 'default');
  const clean = (name) => String(name || '').replace(/\s+/g, ' ').trim();
  /* '' when the name can be used, else why not */
  function nameProblem(name, exceptId) {
    const n = clean(name);
    if (!n) return 'Type a name for the workspace.';
    if (n.length > 60) return 'The name is too long (60 characters at most).';
    if (all().some((w) => w.id !== exceptId && w.name.toLowerCase() === n.toLowerCase())) return `There is already a workspace called “${n}”.`;
    return '';
  }
  /* the layout a workspace stands for: {panels: {id: {visible, collapsed}} | null (= defaults), mode?, spec?} */
  function layoutOf(id) {
    const b = BUILTIN.find((x) => x.id === id);
    if (b) {
      if (!b.show) return { panels: null };
      const panels = {}; for (const p of host.panels.order) panels[p] = { visible: b.show.includes(p) || BARS.includes(p), collapsed: false };
      return { panels, mode: b.mode, spec: b.spec };
    }
    const u = st.user.find((x) => x.id === id); return u ? JSON.parse(JSON.stringify(u.layout)) : null;
  }
  /* the layout on screen now */
  const capture = () => ({ panels: host.panels.layout(), mode: host.mode(), spec: !!host.spec() });
  function applyLayout(l) {
    host.panels.setLayout(l.panels);
    if (l.mode && l.mode !== host.mode()) host.setMode(l.mode);
    if (typeof l.spec === 'boolean' && l.spec !== !!host.spec()) host.setSpec(l.spec);
  }
  function switchTo(id) {
    const l = layoutOf(id); if (!l) return false;
    applyLayout(l); st.current = id; save(); return true;
  }
  const reset = () => switchTo(current());
  function saveNew(name) {
    const why = nameProblem(name); if (why) throw new Error(why);
    const id = 'u' + ++st.seq; st.user.push({ id, name: clean(name), layout: capture() }); st.current = id; save(); return id;
  }
  function rename(id, name) {
    const u = st.user.find((x) => x.id === id); if (!u) throw new Error('Built-in workspaces cannot be renamed.');
    const why = nameProblem(name, id); if (why) throw new Error(why);
    u.name = clean(name); save();
  }
  /* deleting the workspace in use leaves the layout on screen as it is; the menu then ticks Default */
  function remove(id) {
    const i = st.user.findIndex((x) => x.id === id); if (i < 0) throw new Error('Built-in workspaces cannot be deleted.');
    st.user.splice(i, 1); if (st.current === id) st.current = 'default'; save();
  }

  /* ---------- Window > Workspace ---------- */
  const SHORTCUT_COUNT = 5; // Alt+Shift+1…5: the first five in the list (as in Audition)
  function menuItems() {
    const key = (id, d) => (AS.keys ? AS.keys.effective(id, d) || undefined : d || undefined);
    return [
      ...all().map((w, i) => { const id = 'ws:' + w.id, d = i < SHORTCUT_COUNT ? 'Alt+Shift+' + (i + 1) : ''; return { label: w.name, id, dflt: d, shortcut: key(id, d), checked: () => current() === w.id }; }), '-',
      { label: 'Save as New Workspace…', id: 'win.ws.save' }, { label: 'Edit Workspaces…', id: 'win.ws.edit' }, { label: 'Reset to Saved Layout', id: 'win.ws.reset' },
    ];
  }
  async function saveDialog() {
    const UI = AS.ui;
    for (let name = ''; ;) {
      const r = await UI.dialog({ title: 'Save as New Workspace', okLabel: 'Save', fields: [{ id: 'name', label: 'Name', type: 'text', value: name }, { id: 'n', type: 'note', label: 'Saves the panels on screen now, Waveform or Multitrack, and the Spectral view.' }] });
      if (!r) return null;
      name = r.name; const why = nameProblem(name); if (why) { UI.toast(why, 'error'); continue; }
      const id = saveNew(name); UI.toast(`Workspace “${clean(name)}” saved.`); return id;
    }
  }
  async function editDialog() {
    const UI = AS.ui, esc = UI.esc;
    const rows = () => all().map((w) => `<div class="fitem ws-it" data-w="${esc(w.id)}"><div class="fn">${current() === w.id ? '✓ ' : ''}${esc(w.name)}${w.builtin ? ' <span class="dim">(built in)</span>' : ''}</div>
      <span class="fv-btns"><button class="sm" data-a="use" title="Switch to this workspace">Use</button>${w.builtin ? '' : '<button class="sm" data-a="ren" title="Rename">✎</button><button class="sm x" data-a="del" title="Delete">×</button>'}</span></div>`).join('');
    await UI.dialog({ title: 'Edit Workspaces', noOk: true, cancelLabel: 'Close', width: 420,
      html: `<div class="plist ws-list">${rows()}</div><div class="note">Built-in workspaces can be used and reset but not renamed or deleted.</div>`,
      onReady(el) {
        const list = el.querySelector('.ws-list'), redraw = () => { list.innerHTML = rows(); };
        list.addEventListener('click', async (e) => {
          const a = e.target.closest('[data-a]'); if (!a) return; const id = a.closest('[data-w]').dataset.w, w = byId(id);
          if (a.dataset.a === 'use') switchTo(id);
          else if (a.dataset.a === 'ren') { const r = await UI.dialog({ title: 'Rename Workspace', fields: [{ id: 'name', label: 'Name', type: 'text', value: w.name }] }); if (r) { try { rename(id, r.name); } catch (err) { UI.toast(err.message, 'error'); } } }
          else if (a.dataset.a === 'del' && await UI.dialog({ title: 'Delete Workspace', okLabel: 'Delete', html: `<p>Delete the workspace “${esc(w.name)}”? The panels on screen stay as they are.</p>` })) remove(id);
          redraw(); if (AS.app && AS.app.refreshKeys) AS.app.refreshKeys();
        });
      } });
  }
  function init(h) { host = h; }

  AS.workspaces = { BUILTIN, BARS, init, all, byId, current, layoutOf, capture, switchTo, reset, saveNew, rename, remove, nameProblem, menuItems, saveDialog, editDialog, state: () => JSON.parse(JSON.stringify(st)) };
})(typeof window !== 'undefined' ? window : globalThis);

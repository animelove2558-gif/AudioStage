/* Dockable panel registry: show / hide / focus, persisted layout, and the Window menu model. */
(function (root) {
  'use strict';
  const AS = (root.AS = root.AS || {});
  const KEY = 'as-panels-v1';
  const defs = {}, order = [];
  let st = {}, menuModel = [];
  try { st = JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) { st = {}; }
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(st)); } catch (e) { /* */ } };
  const dockEl = { left: 'leftPanel', right: 'rightPanel', bottom: 'dockBottom' };
  const state = (id) => st[id] || (st[id] = {});

  function decorate(def) {
    const h3 = def.el.querySelector(':scope > h3');
    if (!h3 || h3.querySelector('.px')) return;
    const title = h3.textContent; h3.innerHTML = `<span class="pt"></span><button class="px" title="Close panel">×</button>`;
    h3.querySelector('.pt').textContent = title;
    h3.addEventListener('click', (e) => { if (e.target.closest('.px')) { hide(def.id); return; } toggleCollapse(def.id); });
  }
  /* def: {id, title, dock, visible, grow, el?, build(body), refresh(), tick(), gate(), bare, onShow()} */
  function register(def) {
    defs[def.id] = def; order.push(def.id);
    if (!def.el) {
      const el = document.createElement('div');
      el.className = 'panel' + (def.grow ? ' grow' : ''); el.id = 'pnl-' + def.id; el.dataset.panel = def.id;
      el.innerHTML = '<h3></h3><div class="pbody"></div>'; el.querySelector('h3').textContent = def.title;
      document.getElementById(dockEl[def.dock]).appendChild(el);
      def.el = el; def.body = el.querySelector('.pbody');
    }
    if (!def.bare) decorate(def);
    const saved = state(def.id);
    apply(def, 'visible' in saved ? saved.visible : !!def.visible);
    if (saved.collapsed) def.el.classList.add('collapsed');
  }
  function apply(def, vis) {
    const was = !!state(def.id).visible;
    state(def.id).visible = vis;
    def.el.hidden = !(vis && (!def.gate || def.gate()));
    if (vis && def.build && !def.built) { def.built = true; def.build(def.body); }
    if (vis && def.refresh) def.refresh();
    if (vis && def.onShow) def.onShow();
    if (!vis && was && def.onHide) def.onHide(); // e.g. stop a live audio tap
  }
  const isVisible = (id) => !!(defs[id] && state(id).visible);
  function show(id, opts) {
    const def = defs[id]; if (!def) return;
    apply(def, true); def.el.classList.remove('collapsed'); state(id).collapsed = false; save();
    if (opts && opts.focus) focus(id);
  }
  function hide(id) { const def = defs[id]; if (!def) return; apply(def, false); save(); }
  function toggle(id) { if (isVisible(id)) hide(id); else show(id, { focus: true }); }
  function toggleCollapse(id) { const def = defs[id]; const c = def.el.classList.toggle('collapsed'); state(id).collapsed = c; save(); }
  /* bring a panel to the user's attention: make sure it is visible, scroll it into view and flash it */
  function focus(id) {
    const def = defs[id]; if (!def) return;
    if (!isVisible(id)) show(id);
    def.el.classList.remove('collapsed'); def.el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    def.el.classList.remove('flash'); void def.el.offsetWidth; def.el.classList.add('flash');
    setTimeout(() => def.el.classList.remove('flash'), 1100);
  }
  function resetLayout() { st = {}; save(); for (const id of order) { const d = defs[id]; d.el.classList.remove('collapsed'); apply(d, !!d.visible); } }
  /* the layout on screen: {id: {visible, collapsed}} (Window > Workspace saves it) */
  function layout() { const o = {}; for (const id of order) o[id] = { visible: isVisible(id), collapsed: defs[id].el.classList.contains('collapsed') }; return o; }
  /* show a saved layout; panels it does not name (newer than the layout, or l = null) get their default */
  function setLayout(l) {
    for (const id of order) {
      const d = defs[id], s = l && l[id], c = !!(s && s.collapsed);
      apply(d, s ? !!s.visible : !!d.visible); d.el.classList.toggle('collapsed', c); state(id).collapsed = c;
    }
    save();
  }
  function refreshAll() { for (const id of order) { const d = defs[id]; if (isVisible(id) && d.refresh) d.refresh(); } }
  function tick() {
    for (const id of order) {
      const d = defs[id]; if (!state(id).visible) continue;
      if (d.gate) { const show = !!d.gate(); if (d.el.hidden === show) d.el.hidden = !show; }
      if (d.tick && !d.el.hidden) d.tick();
    }
  }
  /* Window menu: model entries are {panel:id, label?} | {label, id (menu action id)} | {label, items} | '-' */
  function setMenu(model) { menuModel = model; }
  function menuItems() {
    const key = (id) => (AS.keys ? AS.keys.effective(id, '') || undefined : undefined); // user-assigned shortcuts (Keyboard Shortcuts…)
    return menuModel.map((m) => {
      if (m === '-') return '-';
      if (m.items) return m; // a submenu (Workspace)
      if (m.panel) { const d = defs[m.panel]; return { label: m.label || (d && d.title) || m.panel, id: 'win:' + m.panel, dflt: '', shortcut: key('win:' + m.panel), checked: () => isVisible(m.panel) && !(defs[m.panel].el.hidden && !!defs[m.panel].gate) }; }
      return { label: m.label, id: m.id, dflt: '', shortcut: key(m.id), checked: m.checked };
    });
  }
  AS.panels = { register, show, hide, toggle, focus, isVisible, refreshAll, tick, resetLayout, layout, setLayout, setMenu, menuItems, defs, order };
})(window);

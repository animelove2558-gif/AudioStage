/* Edit > Preferences… (Ctrl+K): one registry of every setting, shown in tabs like Audition's Preferences.
   Each preference has ONE place where its value lives: settings that already had a home (recording, autosave,
   spectral display, theme, audio devices…) register get/set that read and write that same place — so the old menus
   and this window always agree; new settings live in this module's store (localStorage 'as-prefs-v1').
   def: { id, tab, label, type: check|select|range|text|folder, options (array or () => array / Promise), min, max,
          step, unit, dflt, get(), set(v), desktop (desktop app only), note, tip } */
(function (root) {
  'use strict';
  const AS = (root.AS = root.AS || {});
  const KEY = 'as-prefs-v1';
  const TABS = ['General', 'Audio Hardware', 'Recording', 'Autosave', 'Files', 'Multitrack', 'Display', 'VST / ffmpeg'];
  let data = {};
  try { data = JSON.parse(root.localStorage.getItem(KEY)) || {}; } catch (e) { /* defaults */ }
  const save = () => { try { root.localStorage.setItem(KEY, JSON.stringify(data)); } catch (e) { /* private mode: kept for this session only */ } };
  const defs = new Map(), subs = [], panes = [];
  const desktop = () => !!root.audioStageFiles;
  const dflt = (d) => (typeof d.dflt === 'function' ? d.dflt() : d.dflt);

  function register(def) { defs.set(def.id, def); return def; }
  /* a value of the right type (numbers from <select>, booleans from checkboxes, ranges clamped) */
  function coerce(d, v) {
    if (d.type === 'check') return !!v;
    if (d.type === 'range') { let n = +v; if (!isFinite(n)) n = dflt(d); return Math.min(d.max, Math.max(d.min, n)); }
    if (d.type === 'select' && typeof dflt(d) === 'number') { const n = +v; return isFinite(n) ? n : dflt(d); }
    return v === undefined || v === null ? dflt(d) : String(v);
  }
  function get(id) { const d = defs.get(id); if (!d) return undefined; if (d.get) return d.get(); return id in data ? data[id] : dflt(d); }
  function set(id, v) {
    const d = defs.get(id); if (!d) throw new Error('Unknown preference: ' + id);
    v = coerce(d, v);
    if (d.set) d.set(v); else { data[id] = v; save(); }
    for (const f of subs) { try { f(id, v); } catch (e) { console.warn(e); } }
    return v;
  }
  /* Reset all preferences: every setting back to its default (including the ones kept by the older menus) */
  function reset() { for (const d of defs.values()) if (!d.noReset) set(d.id, dflt(d)); data = {}; save(); }
  const list = (tab) => [...defs.values()].filter((d) => (!tab || d.tab === tab) && (!d.desktop || desktop()));
  const onChange = (f) => { subs.push(f); return () => { const i = subs.indexOf(f); if (i >= 0) subs.splice(i, 1); }; };
  /* extra content of a tab (html + wiring), e.g. the VST / ffmpeg status */
  const pane = (tab, render) => panes.push({ tab, render });

  /* ---------- the window ---------- */
  async function open(tab) {
    const ui = AS.ui, esc = ui.esc;
    const tabs = TABS.filter((t) => list(t).length || panes.some((p) => p.tab === t && (!p.when || p.when())));
    const opts = {};
    for (const d of list()) if (d.options) opts[d.id] = typeof d.options === 'function' ? await d.options() : d.options;
    const vals = {}; for (const d of list()) vals[d.id] = get(d.id);
    const row = (d) => {
      const v = vals[d.id], tip = d.tip ? ` title="${esc(d.tip)}"` : '';
      let inp;
      if (d.type === 'check') return `<div class="frow"${tip}><label class="chk"><input type="checkbox" data-p="${d.id}" ${v ? 'checked' : ''}> ${esc(d.label)}</label></div>`;
      if (d.type === 'select') inp = `<select data-p="${d.id}">${opts[d.id].map((o) => `<option value="${esc(o[0])}" ${String(o[0]) === String(v) ? 'selected' : ''}>${esc(o[1])}</option>`).join('')}</select>`;
      else if (d.type === 'range') inp = `<input type="range" data-p="${d.id}" min="${d.min}" max="${d.max}" step="${d.step || 1}" value="${v}"><input type="number" class="num" data-pn="${d.id}" min="${d.min}" max="${d.max}" step="${d.step || 1}" value="${v}"><span class="unit">${esc(d.unit || '')}</span>`;
      else if (d.type === 'folder') inp = `<input type="text" class="txt" data-p="${d.id}" value="${esc(v)}" placeholder="(not set)" readonly><button class="btn sm" data-pick="${d.id}">Choose…</button><button class="btn sm" data-clear="${d.id}" title="Not set">×</button>`;
      else inp = `<input type="text" class="txt" data-p="${d.id}" value="${esc(v)}">`;
      return `<div class="frow"${tip}><label>${esc(d.label)}</label>${inp}</div>`;
    };
    const body = (t) => list(t).map((d) => row(d) + (d.note ? `<div class="note">${d.note}</div>` : '')).join('') + panes.filter((p) => p.tab === t && (!p.when || p.when())).map((p, i) => `<div class="pf-pane" data-pane="${t}:${i}"></div>`).join('');
    const want = tabs.includes(tab) ? tab : tabs[0];
    const r = await ui.dialog({ title: 'Preferences', okLabel: 'OK', width: 720,
      html: `<div class="pf"><div class="pf-tabs">${tabs.map((t) => `<button class="pf-tab ${t === want ? 'on' : ''}" data-tab="${esc(t)}">${esc(t)}</button>`).join('')}</div>
        <div class="pf-body">${tabs.map((t) => `<div class="pf-page" data-page="${esc(t)}" ${t === want ? '' : 'hidden'}>${body(t)}</div>`).join('')}</div></div>
        <div class="rk-bar"><button class="btn" data-act2="reset" title="Every preference back to its default (shortcuts and workspaces are kept)">Reset All Preferences…</button></div>`,
      onReady(el, close) {
        el.addEventListener('click', async (e) => {
          const tb = e.target.closest('[data-tab]'), pk = e.target.closest('[data-pick]'), cl = e.target.closest('[data-clear]'), rs = e.target.closest('[data-act2="reset"]');
          if (tb) { el.querySelectorAll('.pf-tab').forEach((b) => b.classList.toggle('on', b === tb)); el.querySelectorAll('.pf-page').forEach((p) => (p.hidden = p.dataset.page !== tb.dataset.tab)); }
          else if (pk) { const r0 = await root.audioStageFiles.pickFolder(defs.get(pk.dataset.pick).label, true); if (r0.ok && r0.dir) { vals[pk.dataset.pick] = r0.dir; el.querySelector(`[data-p="${pk.dataset.pick}"]`).value = r0.dir; } }
          else if (cl) { vals[cl.dataset.clear] = ''; el.querySelector(`[data-p="${cl.dataset.clear}"]`).value = ''; }
          else if (rs && await ui.dialog({ title: 'Reset All Preferences', okLabel: 'Reset', html: '<p>Set every preference back to its default? (Keyboard shortcuts, favorites and workspaces are not changed.)</p>' })) { reset(); close(null); ui.toast('Preferences reset to the defaults.'); }
        });
        el.addEventListener('input', (e) => {
          const p = e.target.dataset.p, pn = e.target.dataset.pn;
          if (p && defs.get(p).type !== 'folder') { vals[p] = e.target.type === 'checkbox' ? e.target.checked : e.target.value; const n = el.querySelector(`[data-pn="${p}"]`); if (n) n.value = e.target.value; }
          if (pn && e.target.value !== '' && isFinite(+e.target.value)) { vals[pn] = +e.target.value; el.querySelector(`[data-p="${pn}"]`).value = e.target.value; }
        });
        el.addEventListener('change', (e) => { const p = e.target.dataset.p; if (p && e.target.tagName === 'SELECT') vals[p] = e.target.value; });
        for (const t of tabs) panes.filter((p) => p.tab === t && (!p.when || p.when())).forEach((p, i) => p.render(el.querySelector(`[data-pane="${t}:${i}"]`), close));
      } });
    if (!r) return false;
    for (const d of list()) if (String(coerce(d, vals[d.id])) !== String(get(d.id))) set(d.id, vals[d.id]);
    return true;
  }

  AS.prefs = { TABS, register, get, set, reset, list, onChange, pane, open, coerce, _data: () => data };
})(window);

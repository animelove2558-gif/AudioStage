/* Keyboard shortcuts: the menu definitions carry the default keys; the user's changes (and the "Adobe Audition"
   preset) are overrides by command id, saved per user. Conflicts = one key on several commands. */
(function (root) {
  'use strict';
  const AS = (root.AS = root.AS || {});
  const KEY = 'as-keys';
  /* Adobe Audition (Windows) default keys for the commands AudioStage has — where Audition differs from AudioStage's
     own defaults. Commands not listed keep the AudioStage key. */
  const AUDITION = {
    'edit.redo': 'Ctrl+Shift+Z', 'file.save': 'Ctrl+Shift+S', 'file.new': 'Ctrl+Shift+N', 'mt.new': 'Ctrl+N',
    'view.zin': '=', 'view.zout': '-', 'view.zall': '\\', 'mt.split': 'Ctrl+K', 'mt.snap': 'S',
    'view.spec': 'Shift+D', 'tp.metro': 'Shift+C', 'an.freq': 'Alt+Z',
    'edit.prefs': '', // Ctrl+K is Split in this preset; Preferences stays in the Edit menu
  };
  const PRESETS = { audiostage: ['AudioStage (default)', {}], audition: ['Adobe Audition', AUDITION] };
  let st = { preset: 'audiostage', map: {} };
  try { st = { preset: 'audiostage', map: {}, ...(JSON.parse(root.localStorage.getItem(KEY)) || {}) }; } catch (e) { /* defaults */ }
  const save = () => { try { root.localStorage.setItem(KEY, JSON.stringify(st)); } catch (e) { /* */ } };

  /* "ctrl+shift+k" → "Ctrl+Shift+K" (one spelling, so equal keys compare equal) */
  function norm(s) {
    if (!s) return '';
    const parts = String(s).split('+'); let key = parts.pop(); if (key === '' && parts.length) { parts.pop(); key = '+'; }
    const mods = new Set(parts.map((p) => p.trim().toLowerCase()));
    const k = key.length === 1 ? key.toUpperCase() : key[0].toUpperCase() + key.slice(1).toLowerCase();
    return [mods.has('ctrl') && 'Ctrl', mods.has('alt') && 'Alt', mods.has('shift') && 'Shift', k === ' ' ? 'Space' : k].filter(Boolean).join('+');
  }
  /* a keydown event → shortcut text ('' for a lone modifier) */
  function fromEvent(e) {
    if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) return '';
    let k = /^Digit\d$/.test(e.code || '') ? e.code.slice(5) : e.key === ' ' ? 'Space' : e.key; if (k.length === 1) k = k.toUpperCase(); // Shift+1 → "1", not "!"
    if (k === 'Esc') k = 'Escape';
    k = k.replace(/^Arrow/, ''); // ArrowUp → Up (as the menus write it)
    return norm([(e.ctrlKey || e.metaKey) && 'Ctrl', e.altKey && 'Alt', e.shiftKey && 'Shift', k].filter(Boolean).join('+'));
  }
  /* every command in the menus: [{id, label (menu path), dflt}] */
  function collect(defs) {
    const out = [];
    const walk = (items, path) => { for (const it of typeof items === 'function' ? items() : items) { if (it === '-' || !it) continue; if (it.items) walk(it.items, path + ' › ' + it.label); else if (it.id && !it.noKey && !out.some((o) => o.id === it.id)) out.push({ id: it.id, label: path + ' › ' + it.label, dflt: norm(it.dflt !== undefined ? it.dflt : it.shortcut || '') }); } };
    for (const m of defs) walk(m.items, m.label);
    return out;
  }
  /* the key of a command: the user's own setting, else the preset's, else the menu default */
  function effective(id, dflt, s) {
    const x = s || st, p = (PRESETS[x.preset] || PRESETS.audiostage)[1];
    if (x.map && Object.prototype.hasOwnProperty.call(x.map, id)) return norm(x.map[id]);
    if (Object.prototype.hasOwnProperty.call(p, id)) return norm(p[id]);
    return norm(dflt);
  }
  /* write the effective keys into the menu definitions (remembering each default once) */
  function apply(defs, s) {
    const walk = (items) => { if (typeof items === 'function') return; for (const it of items) { if (it === '-' || !it) continue; if (it.items) walk(it.items); else if (it.id) { if (it.dflt === undefined) it.dflt = it.shortcut || ''; it.shortcut = effective(it.id, it.dflt, s) || undefined; } } };
    for (const m of defs) walk(m.items);
  }
  /* keys used by more than one command: {key: [ids]} */
  function conflicts(list, s) {
    const by = {}; for (const c of list) { const k = effective(c.id, c.dflt, s); if (k) (by[k] = by[k] || []).push(c.id); }
    return Object.fromEntries(Object.entries(by).filter(([, ids]) => ids.length > 1));
  }
  function setState(s) { st = { preset: s.preset in PRESETS ? s.preset : 'audiostage', map: { ...(s.map || {}) } }; save(); }

  AS.keys = { PRESETS, AUDITION, norm, fromEvent, collect, effective, apply, conflicts, state: () => JSON.parse(JSON.stringify(st)), setState };
})(typeof window !== 'undefined' ? window : globalThis);

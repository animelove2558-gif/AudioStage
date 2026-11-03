/* File > Open Recent / Open Recent Session: 10 each, newest first, + Clear Recent.
   Desktop app: kept by the main process in <userData>/recent.json (and the Windows Jump List), reopened by path; a file
   that is gone is reported and taken off the list. Browser build: names only in localStorage — a browser cannot open a
   file by itself, so choosing one asks for it again with the Open dialog. */
(function (root) {
  'use strict';
  const AS = (root.AS = root.AS || {});
  const api = root.audioStageRecent;
  const KEY = 'as-recent-v1', MAX = 10, KINDS = ['files', 'sessions'];
  let lists = { files: [], sessions: [] };
  const subs = [];
  const norm = (l) => { const o = {}; for (const k of KINDS) o[k] = (l && Array.isArray(l[k]) ? l[k] : []).filter((e) => e && typeof e.name === 'string').slice(0, MAX); return o; };
  const lsGet = () => { try { return JSON.parse(localStorage.getItem(KEY)); } catch (e) { return null; } };
  const lsSet = () => { try { localStorage.setItem(KEY, JSON.stringify(lists)); } catch (e) { /* private mode / full: the list just isn't kept */ } };
  const notify = () => { for (const f of subs) { try { f(lists); } catch (e) { /* */ } } };
  const key = (e) => (e.path || e.name).toLowerCase();
  /* to the top of the list (once), at most max */
  const push = (list, e, max) => [e, ...list.filter((x) => key(x) !== key(e))].slice(0, max || MAX);
  const take = (r) => { if (r && r.ok && r.lists) lists = norm(r.lists); return lists; };

  async function load() { if (api) take(await api.get()); else lists = norm(lsGet()); notify(); return lists; }
  const list = (kind) => lists[kind] || [];
  /* a file was opened: a File (its path is asked from the desktop app) or a path */
  async function note(kind, f) {
    if (!KINDS.includes(kind) || !f) return;
    if (api) { const p = typeof f === 'string' ? f : f.asPath || api.pathOf(f); if (!p) return; take(await api.add(kind, p)); }
    else { if (typeof f === 'string') return; lists[kind] = push(lists[kind], { name: f.name, path: '', at: Date.now() }); lsSet(); }
    notify();
  }
  async function remove(kind, e) { if (api) take(await api.remove(kind, e.path)); else { lists[kind] = lists[kind].filter((x) => key(x) !== key(e)); lsSet(); } notify(); }
  async function clear(kind) { if (api) take(await api.clear(kind)); else { if (kind) lists[kind] = []; else lists = norm(null); lsSet(); } notify(); }
  /* reopen entry i of a list. on: { file(File), session(File), pick(kind) } → true when it was opened */
  async function open(kind, i, on) {
    const ui = AS.ui, e = list(kind)[i]; if (!e) return false;
    if (!api) { ui.toast(`Browsers cannot reopen a file by themselves — choose “${e.name}” again.`); on.pick(kind); return false; }
    let file;
    if (AS.disk && AS.disk.available) { // read in pieces when opened (sessions of any size)
      let src = null; try { src = await AS.disk.source(e.path); } catch (er) { ui.toast(`Cannot open “${e.name}”: ${er.message}`, 'error'); return false; }
      if (!src) { await remove(kind, e); ui.toast(`“${e.name}” is no longer at ${e.path} — it was removed from the recent list.`, 'error'); return false; }
      file = AS.disk.lazyFile(src);
    } else {
      const r = await api.read(e.path);
      if (!r.ok) { ui.toast(`Cannot open “${e.name}”: ${r.error}`, 'error'); return false; }
      if (r.missing) { await remove(kind, e); ui.toast(`“${e.name}” is no longer at ${e.path} — it was removed from the recent list.`, 'error'); return false; }
      file = Object.assign(new File([r.data], r.name || e.name), { asPath: e.path });
    }
    const opened = await (kind === 'sessions' ? on.session(file) : on.file(file));
    if (opened === false) return false; // (cancelled)
    await note(kind, e.path); // to the top again
    return true;
  }
  /* the menu rows of one list (File > Open Recent / Open Recent Session) */
  function menuItems(kind) {
    const l = list(kind);
    if (!l.length) return [{ label: kind === 'sessions' ? '(No recent sessions)' : '(No recent files)', id: 'recent:none', disabled: true, noKey: true }];
    return [...l.map((e, i) => ({ label: `${i + 1 < 10 ? i + 1 : 0}  ${e.name}`, id: `recent:${kind}:${i}`, noKey: true })), '-', { label: 'Clear Recent', id: 'recent:clear:' + kind, noKey: true }];
  }
  const onChange = (f) => { subs.push(f); return () => { const i = subs.indexOf(f); if (i >= 0) subs.splice(i, 1); }; };

  AS.recent = { MAX, KINDS, desktop: !!api, load, list, note, remove, clear, open, menuItems, onChange, push };
})(window);

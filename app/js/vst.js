/* Offline VST3 / AU effect plugin host UI. Talks to the Electron main process (window.audioStageVst). */
(function (root) {
  'use strict';
  const AS = (root.AS = root.AS || {});
  const api = root.audioStageVst;
  const UI = () => AS.ui, esc = (s) => AS.ui.esc(s);
  const ls = (k, d) => { try { const v = JSON.parse(localStorage.getItem(k)); return v === null ? d : v; } catch (e) { return d; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* */ } };

  let loaded = null; // { path, name, params }
  let previewToken = 0;

  async function open() {
    const ui = UI(), app = root.app;
    if (!api) { ui.toast('Plugin hosting is available in the desktop app, not in the browser build.', 'error'); return; }
    if (app.mode === 'wave' && !app.cur) { ui.toast('Open an audio file first.'); return; }
    if (!(await ensureHost())) return;
    let dirs = ls('as-vst-dirs', []), plugins = [];
    const preview = app.mode === 'wave' ? {
      start() { runPreview(); },
      stop() { previewToken++; root.AS.engine.stop(); },
    } : null;

    const r = await ui.dialog({
      title: 'VST3 / AU Plugin (offline)', width: 640, okLabel: 'Apply', preview,
      html: `<div class="note">Processes the ${app.mode === 'multi' ? 'selected clip' : 'selection (or the whole file)'} through the plugin, then is undoable like any edit. The plugin runs in a separate process, so a crashing plugin cannot take AudioStage down.</div>
        <div class="rk-bar"><select id="vstSel"></select><button class="btn" id="vstLoad">Load</button></div>
        <div class="rk-bar"><button class="btn" id="vstBrowse">Browse…</button><button class="btn" id="vstDir">Add folder…</button><button class="btn" id="vstRescan">Rescan</button><button class="btn" id="vstMgr" title="Test-load every plugin, see which fail and why">Plugin Manager…</button></div>
        <div id="vstInfo" class="note">No plugin loaded.</div>
        <div class="rk-bar" id="vstTools" hidden><select id="vstPre"><option value="">Presets…</option></select><button class="btn" id="vstSave">Save preset</button><button class="btn" id="vstDel">Delete</button><button class="btn" id="vstEditor">Open plugin window</button><button class="btn" id="vstFav" title="Save this plugin with its current settings as a Favorite (usable in Batch Process)">Save as Favorite…</button></div>
        <div id="vstParams" style="max-height:290px;overflow:auto"></div>`,
      fields: [{ id: 'tail', label: 'Tail to keep (reverb / delay)', type: 'range', min: 0, max: 15, step: 0.5, value: ls('as-vst-tail', 0), unit: 's' }],
      onReady(box) { wire(box, () => dirs, (d) => { dirs = d; lsSet('as-vst-dirs', d); }, async () => { plugins = (await api.scan(dirs)).plugins || []; return plugins; }); },
    });
    previewToken++; root.AS.engine.stop();
    if (!r) return;
    lsSet('as-vst-tail', r.tail);
    if (!loaded) { UI().toast('No plugin was loaded.', 'error'); return; }
    const name = loaded.name;
    await app.runCustom('VST: ' + name, async (slice, sr) => {
      const res = await api.process(slice, sr, r.tail);
      if (!res.ok) { loaded = null; throw new Error(res.error); }
      const bad = AS.dsp.sanitize(res.channels); if (bad && AS.onBadSamples) AS.onBadSamples(bad);
      return res.channels;
    });
    try { const s0 = loaded && await api.call('getState'); if (s0 && s0.ok && AS.favorites) AS.favorites.recorder.push({ type: 'vst', path: loaded.path, name, state: s0.state, tail: r.tail }); } catch (e) { /* recording a favorite is optional */ }
  }
  /* is the plugin host ready? If not: explain, offer Install VST Support… (Windows) or Retry. */
  async function ensureHost() {
    const ui = UI(), rt = AS.runtimes;
    for (;;) {
      const st = await api.status(); if (st.available) return true;
      const canInstall = !!(st.canInstall && rt && rt.available);
      const go = await ui.dialog({ title: 'VST support is not installed yet', okLabel: canInstall ? 'Install VST Support…' : 'Retry', cancelLabel: 'Close', width: 520, html: `<p>${esc(st.error || 'Python or pedalboard is missing.')}</p><p class="note">${esc(st.hint || '')}</p>` });
      if (!go) return false;
      if (canInstall && !(await rt.manage('vst', { auto: true }))) return false;
    }
  }
  /* a VST step of a Favorite / Batch Process: {path, name, state (hex), tail} on chs → processed channels */
  async function runStep(st, chs, sr) {
    if (!api) throw new Error('VST plugins need the desktop app.');
    const ok = (r) => { if (!r.ok) throw new Error(r.error); return r; };
    const h = await api.status(); if (!h.available) throw new Error('VST support is not installed (Effects > Install VST Support…).');
    if (!loaded || loaded.path !== st.path) { const r = ok(await api.call('load', { path: st.path })); loaded = { path: st.path, name: r.name, params: r.params }; }
    if (st.state) ok(await api.call('setState', { state: st.state }));
    const res = await api.process(chs, sr, st.tail || 0); if (!res.ok) { loaded = null; throw new Error(res.error); }
    const bad = AS.dsp.sanitize(res.channels); if (bad && AS.onBadSamples) AS.onBadSamples(bad);
    return res.channels;
  }

  /* ---- Plugin Manager: folders (standard + your own, remembered), every plugin test-loaded in a separate helper,
     failures with the reason, crashed plugins skipped until Retry ---- */
  const STATUS = { ok: ['pm-ok', '✓ OK'], failed: ['pm-failed', '✗ Cannot load'], crashed: ['pm-crashed', '✖ Crashed — skipped'] };
  async function manager() {
    const ui = UI(); if (!api) return null;
    let std = [], list = [];
    try { std = (await api.dirs()).dirs || []; } catch (e) { /* */ }
    await ui.dialog({ title: 'Plugin Manager', noOk: true, cancelLabel: 'Close', width: 740, dismissable: true,
      html: `<div class="note">Folders searched for plugins (sub-folders included):</div><div class="pm-dirs"></div>
        <div class="rk-bar"><button class="btn" data-a="add">Add folder…</button><button class="btn primary" data-a="scan" title="Test-load the plugins that are new or changed since the last scan">Scan</button><button class="btn" data-a="full" title="Test-load every plugin again (crashed ones stay skipped)">Rescan All</button><span class="pm-prog note" style="margin:0 0 0 8px"></span></div>
        <div class="pm-wrap"><table class="stats pm-list"></table></div>
        <div class="note">Each plugin is loaded once in a separate helper process, so a plugin that crashes cannot take AudioStage down: it is marked <b>Crashed</b> and skipped by later scans (and in the plugin list) until you click Retry.</div>`,
      onReady(el) {
        const $ = (q) => el.querySelector(q), prog = $('.pm-prog');
        const paintDirs = () => { $('.pm-dirs').innerHTML = std.map((d) => `<div><span title="${esc(d)}">${esc(d)}</span> <i class="note">standard</i></div>`).join('') + ls('as-vst-dirs', []).map((d) => `<div><span title="${esc(d)}">${esc(d)}</span> <button class="btn sm" data-del="${esc(d)}" title="Stop searching this folder">Remove</button></div>`).join(''); };
        const paint = () => {
          $('.pm-list').innerHTML = '<tr><th>Plugin</th><th>Type</th><th>Status</th><th></th></tr>' + (list.length ? list.map((p) => { const S = STATUS[p.status]; return `<tr><td><b>${esc(p.name)}</b>${p.vendor ? ' — ' + esc(p.vendor) : ''}<div class="pm-reason" title="${esc(p.path)}">${esc(p.path)}</div></td><td>${esc(p.kind || '')}</td><td>${S ? `<span class="${S[0]}">${S[1]}</span>` : '<span class="note">not scanned yet</span>'}${p.reason ? `<div class="pm-reason">${esc(p.reason)}</div>` : ''}</td><td>${p.status === 'crashed' || p.status === 'failed' ? `<button class="btn sm" data-retry="${esc(p.path)}">Retry</button>` : ''}</td></tr>`; }).join('') : '<tr><td colspan="4" class="note">No plugins found in these folders.</td></tr>');
          const n = (k) => list.filter((p) => p.status === k).length, un = list.filter((p) => !p.status).length;
          prog.textContent = list.length ? `${list.length} plugin(s): ${n('ok')} OK, ${n('failed')} cannot load, ${n('crashed')} crashed${un ? ', ' + un + ' not scanned yet' : ''}.` : '';
        };
        const files = async () => { const r = await api.scan(ls('as-vst-dirs', [])); list = r.plugins || []; paint(); };
        const busy = (b) => el.querySelectorAll('[data-a],[data-retry]').forEach((x) => (x.disabled = b));
        const verify = async (o) => {
          if (!(await ensureHost())) return;
          busy(true); prog.textContent = 'Scanning…';
          const off = api.onScanProgress((p) => { if (p.name) prog.textContent = `Loading ${p.i + 1} / ${p.n}: ${p.name}…`; });
          const r = await api.verify(ls('as-vst-dirs', []), o); off(); busy(false);
          if (!r.ok) { prog.textContent = ''; ui.toast('Scan failed: ' + r.error, 'error'); return; }
          list = r.plugins || []; paint();
        };
        el.addEventListener('click', async (e) => {
          const a = e.target.closest('[data-a]'), del = e.target.closest('[data-del]'), re = e.target.closest('[data-retry]');
          if (del) { lsSet('as-vst-dirs', ls('as-vst-dirs', []).filter((d) => d !== del.dataset.del)); paintDirs(); files(); }
          else if (re) verify({ retry: [re.dataset.retry] });
          else if (a && a.dataset.a === 'add') { const r = await api.browse('folder'); if (r.ok && r.path) { lsSet('as-vst-dirs', [...new Set([...ls('as-vst-dirs', []), r.path])]); paintDirs(); files(); } }
          else if (a && a.dataset.a === 'scan') verify({});
          else if (a && a.dataset.a === 'full') verify({ force: true });
        });
        paintDirs(); files();
      } });
    return list;
  }

  async function runPreview() {
    const app = root.app, d = app.cur, eng = root.AS.engine, token = ++previewToken, ui = UI();
    if (!loaded || !d) { ui.toast('Load a plugin first.'); return; }
    const [a, b] = d.range(), end = Math.min(b, a + d.sr * 8);
    const res = await api.process(d.ch.map((c) => c.slice(a, end)), d.sr, 1);
    if (token !== previewToken) return;
    if (!res.ok) { ui.toast(res.error, 'error'); return; }
    const t0 = eng.prepare(), s = eng.ctx.createBufferSource();
    s.buffer = eng.toBuffer(res.channels, d.sr); s.connect(eng.master); s.start(t0);
    eng.begin([s], t0, 0, res.channels[0].length / d.sr, 0); app.playDoc = null;
  }

  function wire(box, getDirs, setDirs, rescan) {
    const $ = (s) => box.querySelector(s), ui = UI();
    const sel = $('#vstSel'), info = $('#vstInfo'), host = $('#vstParams'), tools = $('#vstTools'), pre = $('#vstPre');
    let plugins = [];
    const fillList = (list) => {
      plugins = list;
      const last = ls('as-vst-last', '');
      const usable = list.filter((p) => p.status !== 'crashed'), skipped = list.length - usable.length; // crashed in a Plugin Manager scan: skipped
      sel.innerHTML = (usable.length ? usable.map((p) => `<option value="${esc(p.path)}" ${p.path === last ? 'selected' : ''}>${esc(p.name)} (${p.kind})${p.status === 'failed' ? ' — cannot load' : ''}</option>`).join('') : '<option value="">No plugins found — use Browse… or Add folder…</option>') + (skipped ? `<option value="" disabled>(${skipped} crashed plugin(s) skipped — see Plugin Manager…)</option>` : '');
      if (last && !list.some((p) => p.path === last)) sel.insertAdjacentHTML('afterbegin', `<option value="${esc(last)}" selected>${esc(last.split(/[\\/]/).pop())} (previous)</option>`);
    };
    const presetsKey = () => 'as-vst-presets:' + loaded.path, paramsKey = () => 'as-vst-params:' + loaded.path;
    const fillPresets = () => {
      const p = ls(presetsKey(), {});
      pre.innerHTML = '<option value="">Presets…</option>' + Object.keys(p).map((n) => `<option>${esc(n)}</option>`).join('');
    };
    const fail = (e) => { info.textContent = 'Error: ' + (e.message || e); info.style.color = 'var(--danger)'; };
    const ok = (r) => { if (!r.ok) throw new Error(r.error); return r; };

    function renderParams(list) {
      host.innerHTML = '';
      if (!list.length) { host.innerHTML = '<div class="empty">This plugin exposes no automatable parameters. Use “Open plugin window”.</div>'; return; }
      const persist = () => { const saved = {}; for (const p of loaded.params) saved[p.key] = p.raw; lsSet(paramsKey(), saved); };
      for (const p of list) {
        const row = document.createElement('div'); row.className = 'frow';
        const step = p.steps && p.steps > 1 && p.steps <= 64 ? 1 / (p.steps - 1) : 0.001;
        row.innerHTML = `<label title="${esc(p.key)}">${esc(p.name)}</label>` + (p.boolean ? `<input type="checkbox" ${p.raw > 0.5 ? 'checked' : ''}><span class="unit"></span>` : `<input type="range" min="0" max="1" step="${step}" value="${p.raw}"><span class="unit" style="width:110px">${esc(p.text)} ${esc(p.label)}</span>`);
        const inp = row.querySelector('input'), txt = row.querySelector('.unit');
        let timer = null; // one debounce per control, so moving two sliders quickly never drops an update
        const send = () => {
          const raw = p.boolean ? (inp.checked ? 1 : 0) : +inp.value; p.raw = raw;
          clearTimeout(timer);
          timer = setTimeout(async () => { try { const r = ok(await api.call('setParam', { key: p.key, raw })); if (!p.boolean) txt.textContent = r.param.text + ' ' + r.param.label; persist(); } catch (e) { fail(e); } }, 40);
        };
        inp.addEventListener('input', send);
        inp.addEventListener('dblclick', () => { /* no default value is exposed by the host API */ });
        host.appendChild(row);
      }
    }
    async function loadPlugin(path) {
      info.style.color = ''; info.textContent = 'Loading…';
      try {
        const r = ok(await api.call('load', { path }));
        loaded = { path, name: r.name, params: r.params };
        lsSet('as-vst-last', path);
        const saved = ls(paramsKey(), null);
        if (saved) { for (const p of r.params) if (saved[p.key] !== undefined && Math.abs(saved[p.key] - p.raw) > 1e-6) { try { await api.call('setParam', { key: p.key, raw: saved[p.key] }); } catch (e) { /* ignore stale keys */ } } loaded.params = ok(await api.call('params')).params; }
        info.textContent = `${r.name}${r.manufacturer ? ' — ' + r.manufacturer : ''}${r.version ? ' v' + r.version : ''} · ${loaded.params.length} parameters${r.latency ? ' · latency ' + r.latency + ' samples (compensated)' : ''}`;
        tools.hidden = false; fillPresets(); renderParams(loaded.params);
      } catch (e) { loaded = null; tools.hidden = true; host.innerHTML = ''; fail(e); }
    }

    // reopen: always reload the previous plugin (this dialog's DOM is new and the helper may have restarted)
    rescan().then(fillList).then(() => {
      const want = loaded ? loaded.path : ls('as-vst-last', '');
      if (want && [...sel.options].some((o) => o.value === want)) { sel.value = want; loadPlugin(want); }
    });
    $('#vstLoad').onclick = () => sel.value && loadPlugin(sel.value);
    $('#vstRescan').onclick = async () => fillList(await rescan());
    $('#vstMgr').onclick = async () => { await manager(); fillList(await rescan()); };
    $('#vstFav').onclick = async () => {
      try {
        const s0 = ok(await api.call('getState')), tail = +((box.querySelector('[data-id="tail"]') || {}).value) || 0;
        const r = await ui.dialog({ title: 'Save Plugin as Favorite', okLabel: 'Save', fields: [{ id: 'name', label: 'Name', type: 'text', value: 'VST: ' + loaded.name }] });
        if (!r) return; const fav = AS.favorites.add(r.name, [{ type: 'vst', path: loaded.path, name: loaded.name, state: s0.state, tail }]); if (AS.panels && AS.panels.refreshAll) AS.panels.refreshAll(); ui.toast(`Favorite “${fav.name}” saved — apply it from the Favorites panel or File > Batch Process.`);
      } catch (e) { fail(e); }
    };
    $('#vstBrowse').onclick = async () => { const r = await api.browse('plugin'); if (r.ok && r.path) { if (!plugins.some((p) => p.path === r.path)) sel.insertAdjacentHTML('afterbegin', `<option value="${esc(r.path)}">${esc(r.path.split(/[\\/]/).pop())}</option>`); sel.value = r.path; loadPlugin(r.path); } };
    $('#vstDir').onclick = async () => { const r = await api.browse('folder'); if (r.ok && r.path) { setDirs([...new Set([...getDirs(), r.path])]); fillList(await rescan()); ui.toast('Folder added.'); } };
    $('#vstSave').onclick = async () => {
      try { const r = ok(await api.call('getState')), p = ls(presetsKey(), {}); let n = 1; while (p['Preset ' + n]) n++; p['Preset ' + n] = r.state; lsSet(presetsKey(), p); fillPresets(); pre.value = 'Preset ' + n; ui.toast('Saved “Preset ' + n + '”.'); } catch (e) { fail(e); }
    };
    pre.onchange = async () => {
      if (!pre.value) return;
      try { const r = ok(await api.call('setState', { state: ls(presetsKey(), {})[pre.value] })); loaded.params = r.params; renderParams(r.params); } catch (e) { fail(e); }
    };
    $('#vstDel').onclick = () => { if (!pre.value) return; const p = ls(presetsKey(), {}); delete p[pre.value]; lsSet(presetsKey(), p); fillPresets(); };
    $('#vstEditor').onclick = async (ev) => {
      const b = ev.target; b.disabled = true; b.textContent = 'Plugin window open…';
      try { const r = ok(await api.call('editor')); loaded.params = r.params; renderParams(r.params); const saved = {}; for (const p of r.params) saved[p.key] = p.raw; lsSet(paramsKey(), saved); } catch (e) { fail(e); }
      b.disabled = false; b.textContent = 'Open plugin window';
    };
  }

  AS.vst = { open, manager, ensureHost, runStep, available: !!api };
  if (AS.favorites && api) AS.favorites.vstRun = runStep; // VST steps of Favorites / Batch Process
})(window);

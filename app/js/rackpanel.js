/* Effects Rack panel: Clip Effects / Track Effects tabs, presets, 16 ordered slots, gain staging, VU and dry/wet. */
(function (root) {
  'use strict';
  const AS = (root.AS = root.AS || {}), R = AS.rack, esc = (s) => AS.ui.esc(s);
  const app = () => root.app;
  const ICON = {
    save: '<svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"><path d="M2.5 2.5h9l2 2v9h-11z"/><path d="M5 2.5v3.5h5V2.5M5 13.5V9h6v4.5"/></svg>',
    trash: '<svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 4h11M6 4V2.5h4V4M4 4l.8 9.5h6.4L12 4M6.8 6.5v5M9.2 6.5v5"/></svg>',
    power: '<svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M8 2v5.5M4.6 4.4a5 5 0 1 0 6.8 0"/></svg>',
  };
  const LS_KEY = 'as-rack-presets';
  const userPresets = () => { try { return JSON.parse(localStorage.getItem(LS_KEY)) || {}; } catch (e) { return {}; } };
  const saveUserPresets = (p) => { try { localStorage.setItem(LS_KEY, JSON.stringify(p)); } catch (e) { /* */ } };
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const dbText = (v) => (v > 0 ? '+' : v < 0 ? '−' : '+') + Math.abs(v).toFixed(1).replace(/\.0$/, '') + ' dB';
  const typeOptions = () => // names and grouping come from fxmenu.js (same as the Effects menu)
    '<option value="">— Empty —</option>' + AS.fxmenu.rackGroups().map(([g, list]) => `<optgroup label="${esc(g)}">${list.map(([k, n]) => `<option value="${k}">${esc(n)}</option>`).join('')}</optgroup>`).join('');

  const P = { tab: 'clip', open: -1, preset: {}, sig: '', body: null, peak: [0, 0], holdT: [0, 0] };

  /* what the panel is currently editing */
  function target() {
    const a = app(), s = a.session;
    if (P.tab === 'clip') { const f = s.sel && s.findClip(s.sel); return f ? { kind: 'clip', id: 'c' + f.c.id, obj: f.c, key: 'c:' + f.c.id, label: 'Clip — ' + f.c.name, color: f.t.color } : null; }
    if (a.rackTarget === 'master') return { kind: 'master', id: 'master', obj: s.master, key: 'master', label: 'Master Bus', color: '#9aa4b2' };
    const t = s.tracks.find((x) => x.id === a.selTrack); return t ? { kind: 'track', id: 't' + t.id, obj: t, key: 't:' + t.id, label: 'Track — ' + t.name, color: t.color } : null;
  }
  const commit = () => { const a = app(); a.multiChanged(); };
  const structural = () => { const a = app(); a.multi.rebuildHeads(); a.multiChanged(); };
  const push = () => app().session.push();

  function build(body) {
    P.body = body;
    body.innerHTML = `
      <div class="rk-tabs"><button data-tab="clip">Clip Effects</button><button data-tab="track">Track Effects</button><span class="spacer"></span><button class="rk-power" title="Rack power: turn the whole rack on / off">${ICON.power}</button></div>
      <div class="rk-target"></div>
      <div class="rk-presetbar"><select class="rk-pre" title="Presets"></select><button class="ico" data-a="save" title="Save preset">${ICON.save}</button><button class="ico" data-a="del" title="Delete preset">${ICON.trash}</button></div>
      <div class="rk-slots"></div>
      <div class="rk-bottom">
        <div class="rk-gainrow"><label>Input</label><input type="range" class="rk-in" min="-24" max="24" step="0.5"><span class="rk-inv">+0 dB</span></div>
        <div class="rk-gainrow"><label>Output</label><input type="range" class="rk-out" min="-24" max="24" step="0.5"><span class="rk-outv">+0 dB</span></div>
        <div class="rk-vurow"><canvas class="rk-vu" width="240" height="34"></canvas></div>
        <div class="rk-gainrow"><label>Dry / Wet</label><input type="range" class="rk-mix" min="0" max="100" step="1"><span class="rk-mixv">100%</span></div>
      </div>`;
    body.querySelectorAll('.rk-tabs [data-tab]').forEach((b) => (b.onclick = () => { P.tab = b.dataset.tab; if (P.tab === 'track' && app().rackTarget !== 'master') app().rackTarget = null; P.open = -1; render(); }));
    body.querySelector('.rk-power').onclick = () => { const t = target(); if (!t) return; push(); const c = R.cfgOf(t.obj); c.power = !c.power; render(); structural(); };
    const pre = body.querySelector('.rk-pre');
    pre.onchange = () => { if (pre.value) applyPreset(pre.value); };
    body.querySelector('[data-a="save"]').onclick = savePreset; body.querySelector('[data-a="del"]').onclick = deletePreset;
    const sliders = [['.rk-in', '.rk-inv', 'in', dbText, 0], ['.rk-out', '.rk-outv', 'out', dbText, 0], ['.rk-mix', '.rk-mixv', 'mix', (v) => Math.round(v) + '%', 100]];
    for (const [sel, lab, key, fmt, dflt] of sliders) {
      const inp = body.querySelector(sel), out = body.querySelector(lab);
      inp.addEventListener('pointerdown', push);
      inp.addEventListener('input', () => { const t = target(); if (!t) return; const c = R.cfgOf(t.obj); c[key] = +inp.value; out.textContent = fmt(+inp.value); commit(); });
      inp.addEventListener('dblclick', () => { push(); inp.value = dflt; inp.dispatchEvent(new Event('input')); });
    }
    render();
  }

  function render() {
    const body = P.body; if (!body) return;
    const t = target(), a = app();
    body.querySelectorAll('.rk-tabs [data-tab]').forEach((b) => b.classList.toggle('on', b.dataset.tab === P.tab));
    const tgt = body.querySelector('.rk-target'), slots = body.querySelector('.rk-slots'), bottom = body.querySelector('.rk-bottom'), pbar = body.querySelector('.rk-presetbar');
    P.sig = sigOf(t);
    if (!t) {
      tgt.innerHTML = ''; slots.innerHTML = `<div class="empty">${a.mode === 'multi' ? (P.tab === 'clip' ? 'Select a clip in the Multitrack to edit its effects.' : 'Select a track (click its header, or press its FX button).') : 'The Effects Rack processes Multitrack clips and tracks.<br>Switch to Multitrack, then select a clip or track.'}</div>`;
      bottom.style.opacity = pbar.style.opacity = 0.35; bottom.style.pointerEvents = pbar.style.pointerEvents = 'none'; body.querySelector('.rk-power').classList.remove('on');
      fillPresets(); return;
    }
    bottom.style.opacity = pbar.style.opacity = 1; bottom.style.pointerEvents = pbar.style.pointerEvents = '';
    const cfg = R.cfgOf(t.obj), fx = R.slots(t.obj); while (fx.length < R.SLOTS) fx.push(null);
    tgt.innerHTML = `<span class="dot" style="background:${t.color}"></span><b>${esc(t.label)}</b>`;
    body.querySelector('.rk-power').classList.toggle('on', cfg.power !== false);
    slots.classList.toggle('off', cfg.power === false);
    fillPresets();
    slots.innerHTML = '';
    for (let i = 0; i < R.SLOTS; i++) slots.appendChild(slotRow(t, fx, i));
    const set = (sel, lab, v, fmt) => { body.querySelector(sel).value = v; body.querySelector(lab).textContent = fmt(v); };
    set('.rk-in', '.rk-inv', cfg.in || 0, dbText); set('.rk-out', '.rk-outv', cfg.out || 0, dbText); set('.rk-mix', '.rk-mixv', cfg.mix == null ? 100 : cfg.mix, (v) => Math.round(v) + '%');
  }
  const sigOf = (t) => app().mode + '|' + P.tab + '|' + (t ? t.id : '-');

  function slotRow(t, fx, i) {
    const f = fx[i], def = f && R.RACK[f.type], row = document.createElement('div');
    row.className = 'rk-slot2' + (def ? '' : ' empty') + (P.open === i && def ? ' open' : '');
    row.draggable = true; row.dataset.i = i;
    const head = document.createElement('div'); head.className = 'rk-row';
    head.innerHTML = `<span class="num" title="Drag to reorder">${i + 1}</span><button class="led ${def && !f.bypass ? 'on' : ''}" title="${def ? (f.bypass ? 'Turn effect on' : 'Turn effect off') : 'Empty slot'}"></button><select class="rk-type" title="Effect type">${typeOptions()}</select><button class="wbtn" ${def ? '' : 'disabled'} title="Open the effect window">⧉</button><button class="exp" ${def ? '' : 'disabled'} title="Show parameters">${P.open === i && def ? '▾' : '▸'}</button>`;
    const sel = head.querySelector('select'); sel.value = def ? f.type : '';
    head.querySelector('.led').onclick = () => { if (!def) return; push(); f.bypass = !f.bypass; render(); structural(); };
    sel.onchange = () => { push(); fx[i] = sel.value ? { type: sel.value, bypass: false, p: { ...R.RACK[sel.value].defaults } } : null; if (sel.value) P.open = i; else if (P.open === i) P.open = -1; render(); structural(); };
    head.querySelector('.exp').onclick = () => { P.open = P.open === i ? -1 : i; render(); };
    head.querySelector('.wbtn').onclick = () => { if (def) AS.fxmodal.openSlot(t.obj, i, t.label); };
    row.appendChild(head);
    if (def && P.open === i) row.appendChild(paramBlock(t, f, def));
    // drag & drop reordering
    row.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/plain', String(i)); e.dataTransfer.effectAllowed = 'move'; row.classList.add('dragging'); });
    row.addEventListener('dragend', () => row.classList.remove('dragging'));
    row.addEventListener('dragover', (e) => { e.preventDefault(); row.classList.add('over'); });
    row.addEventListener('dragleave', () => row.classList.remove('over'));
    row.addEventListener('drop', (e) => {
      e.preventDefault(); row.classList.remove('over');
      const from = +e.dataTransfer.getData('text/plain'); if (isNaN(from) || from === i) return;
      push(); const [m] = fx.splice(from, 1); fx.splice(i, 0, m); P.open = P.open === from ? i : P.open; render(); structural();
    });
    return row;
  }
  function paramBlock(t, f, def) {
    const box = document.createElement('div'); box.className = 'rk-params';
    for (const p of def.params) {
      const row = document.createElement('div'); row.className = 'rk-prow'; row.title = AS.tips.param('rack:' + f.type, p.id); const val = f.p[p.id] !== undefined ? f.p[p.id] : p.value;
      if (p.type === 'curve') continue; // edited in the effect window
      if (p.type === 'check') { row.innerHTML = `<label class="chk" style="width:auto"><input type="checkbox" ${val ? 'checked' : ''}> ${esc(p.label)}</label>`; row.querySelector('input').onchange = (e) => { push(); f.p[p.id] = e.target.checked; commit(); render(); }; box.appendChild(row); continue; }
      if (p.type === 'select') {
        const cx = { ownerId: AS.routing.ownerTrackId(app().session, t.obj), current: val }; // sidechain sources depend on the owner
        row.innerHTML = `<label>${esc(p.label)}</label><select>${R.optionsOf(p, cx).map((o) => `<option value="${esc(o[0])}" ${String(o[0]) === String(val) ? 'selected' : ''}>${esc(o[1])}</option>`).join('')}</select>`;
        row.querySelector('select').onchange = (e) => { push(); f.p[p.id] = e.target.value; commit(); };
      } else {
        const fmt = (v) => (+v).toFixed(p.step < 0.1 ? 2 : p.step < 1 ? 1 : 0) + (p.unit ? ' ' + p.unit : '');
        row.innerHTML = `<label>${esc(p.label)}</label><input type="range" min="${p.min}" max="${p.max}" step="${p.step}" value="${val}"><span class="pv">${esc(fmt(val))}</span>`;
        const inp = row.querySelector('input'), pv = row.querySelector('.pv');
        inp.addEventListener('pointerdown', push);
        inp.addEventListener('input', () => { f.p[p.id] = +inp.value; pv.textContent = fmt(inp.value); commit(); });
        inp.addEventListener('dblclick', () => { push(); inp.value = p.value; inp.dispatchEvent(new Event('input')); });
      }
      box.appendChild(row);
    }
    return box;
  }

  /* ---- presets ---- */
  function fillPresets() {
    const pre = P.body.querySelector('.rk-pre'), t = target(), cur = t ? P.preset[t.id] || '' : '', user = userPresets();
    pre.innerHTML = `<option value="">Presets…</option><optgroup label="Default">${R.BUILTIN.map((b) => `<option value="b:${esc(b.name)}">${esc(b.name)}</option>`).join('')}</optgroup>` +
      (Object.keys(user).length ? `<optgroup label="User">${Object.keys(user).map((n) => `<option value="u:${esc(n)}">${esc(n)}</option>`).join('')}</optgroup>` : '');
    pre.value = cur;
    if (pre.value !== cur) pre.value = '';
  }
  function applyPreset(val) {
    const t = target(); if (!t) return;
    const kind = val[0], name = val.slice(2); let data = null;
    if (kind === 'b') data = R.builtin(name); else { const u = userPresets()[name]; if (u) data = { fx: u.fx, cfg: u.cfg }; }
    if (!data) return;
    push(); t.obj.fx = clone(data.fx); t.obj.rackCfg = { ...R.defaultCfg(), ...clone(data.cfg || {}) };
    P.preset[t.id] = val; P.open = -1; render(); structural();
    const bad = R.activeFx(t.obj.fx).some((f) => f.type === 'gate') && !(AS.engine.ctx && AS.engine.ctx._wl);
    if (bad) AS.ui.toast('The Noise Gate needs AudioWorklet support, which is not available here — that slot passes audio through.', 'error');
  }
  async function savePreset() {
    const t = target(); if (!t) return;
    const cur = (P.preset[t.id] || '').startsWith('u:') ? P.preset[t.id].slice(2) : 'My Preset';
    const r = await AS.ui.dialog({ title: 'Save Rack Preset', okLabel: 'Save', fields: [{ id: 'name', label: 'Preset name', type: 'text', value: cur }] });
    if (!r || !r.name.trim()) return;
    const name = r.name.trim(), all = userPresets();
    all[name] = { fx: clone(R.slots(t.obj)).slice(0, R.SLOTS), cfg: clone(R.cfgOf(t.obj)) }; saveUserPresets(all);
    P.preset[t.id] = 'u:' + name; fillPresets(); AS.ui.toast(`Preset “${name}” saved.`);
  }
  async function deletePreset() {
    const t = target(); if (!t) return; const v = P.preset[t.id] || P.body.querySelector('.rk-pre').value;
    if (!v) { AS.ui.toast('Choose a preset to delete.'); return; }
    if (v[0] === 'b') { AS.ui.toast('Default presets are built in and cannot be deleted.'); return; }
    const name = v.slice(2), r = await AS.ui.dialog({ title: 'Delete Preset', okLabel: 'Delete', html: `<p>Delete the preset “${esc(name)}”?</p>` });
    if (!r) return; const all = userPresets(); delete all[name]; saveUserPresets(all); P.preset[t.id] = ''; fillPresets();
  }

  /* ---- VU meter + live refresh ---- */
  function tick() {
    if (!P.body) return;
    const t = target(), s = sigOf(t);
    if (s !== P.sig) render();
    const cv = P.body.querySelector('.rk-vu'); if (!cv) return;
    const g = cv.getContext('2d'), w = cv.width, h = cv.height, css = getComputedStyle(document.documentElement);
    g.fillStyle = css.getPropertyValue('--wave-bg'); g.fillRect(0, 0, w, h);
    const lv = t && AS.engine.playing ? AS.engine.meterLevels(t.key) : [0, 0], now = performance.now(), x0 = 14, bw = w - x0 - 4, lo = -60, bh = 11;
    const pos = (db) => Math.max(0, Math.min(1, (db - lo) / -lo)) * bw;
    for (let c = 0; c < 2; c++) {
      const db = AS.dsp.toDb(lv[c]), y = 3 + c * (bh + 2);
      if (lv[c] > P.peak[c]) { P.peak[c] = lv[c]; P.holdT[c] = now; } else if (now - P.holdT[c] > 900) P.peak[c] *= 0.95;
      g.fillStyle = css.getPropertyValue('--dim'); g.font = '9px Segoe UI'; g.fillText(c ? 'R' : 'L', 3, y + 9);
      const gr = g.createLinearGradient(x0, 0, x0 + bw, 0); gr.addColorStop(0, '#2fb67c'); gr.addColorStop(0.72, '#d9c24a'); gr.addColorStop(0.93, '#e8503a');
      g.fillStyle = gr; g.fillRect(x0, y, pos(db), bh); g.fillStyle = '#fff'; g.fillRect(x0 + pos(AS.dsp.toDb(P.peak[c])) - 1, y, 2, bh);
    }
    g.fillStyle = css.getPropertyValue('--dim'); g.font = '8px Segoe UI'; for (const db of [-48, -24, -12, -6, 0]) g.fillText(db, x0 + pos(db) - 6, h - 1);
  }

  /* open / focus the rack on a track (object), the master (null) or a clip ({clip: id}) */
  function open(tg) {
    const a = app();
    if (tg && tg.clip !== undefined) { P.tab = 'clip'; a.session.sel = tg.clip; }
    else { P.tab = 'track'; if (tg) { a.selTrack = tg.id; a.rackTarget = null; } else a.rackTarget = 'master'; }
    P.open = -1; AS.panels.show('rack', { focus: true }); render();
  }

  AS.rackpanel = { open, render, target, P };
  AS.panels.register({ id: 'rack', title: 'Effects Rack', dock: 'left', visible: false, build, refresh: render, tick });
})(window);

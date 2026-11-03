/* Generic UI helpers: dialogs, menus, toasts, busy overlay. */
(function (root) {
  'use strict';
  const AS = (root.AS = root.AS || {});
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  let openCount = 0;

  function dialog(opts) {
    // opts: {title, fields[], okLabel, preview:{start(values),stop()}, body(html or el), width, onReady(el), canClose()}
    return new Promise((resolve) => {
      const rootEl = document.getElementById('modalRoot'), back = document.createElement('div');
      back.className = 'modal-back';
      const values = {};
      const box = document.createElement('div'); box.className = 'modal'; if (opts.width) box.style.width = opts.width + 'px';
      let html = `<div class="modal-title">${esc(opts.title)}</div><div class="modal-body">`;
      if (opts.html) html += opts.html;
      for (const f of opts.fields || []) {
        values[f.id] = f.type === 'curve' ? JSON.parse(JSON.stringify(f.value)) : f.value;
        if (f.type === 'range') html += `<div class="frow"><label>${esc(f.label)}</label><input type="range" data-id="${f.id}" min="${f.min}" max="${f.max}" step="${f.step}" value="${f.value}"><input type="number" class="num" data-num="${f.id}" min="${f.min}" max="${f.max}" step="${f.step}" value="${f.value}"><span class="unit">${esc(f.unit || '')}</span></div>`;
        else if (f.type === 'select') html += `<div class="frow"><label>${esc(f.label)}</label><select data-id="${f.id}">${f.options.map((o) => `<option value="${esc(o[0])}" ${String(o[0]) === String(f.value) ? 'selected' : ''}>${esc(o[1])}</option>`).join('')}</select></div>`;
        else if (f.type === 'check') html += `<div class="frow"><label class="chk"><input type="checkbox" data-id="${f.id}" ${f.value ? 'checked' : ''}> ${esc(f.label)}</label></div>`;
        else if (f.type === 'text') html += `<div class="frow"><label>${esc(f.label)}</label><input type="text" data-id="${f.id}" value="${esc(f.value)}" class="txt"></div>`;
        else if (f.type === 'textarea') html += `<div class="frow area"><label>${esc(f.label)}</label><textarea data-id="${f.id}" class="txt" rows="${f.rows || 5}" spellcheck="false"${f.maxLength ? ` maxlength="${f.maxLength}"` : ''}>${esc(f.value)}</textarea></div>`;
        else if (f.type === 'curve') html += `<div class="frow curve" data-curve="${f.id}"><label>${esc(f.label)}</label></div>`;
        else if (f.type === 'note') html += `<div class="note">${f.label}</div>`;
      }
      html += '</div><div class="modal-foot">';
      if (opts.preview) html += '<button class="btn" data-act="preview">▶ Preview</button>';
      html += `<span class="spacer"></span><button class="btn" data-act="cancel">${opts.cancelLabel || 'Cancel'}</button>${opts.noOk ? '' : `<button class="btn primary" data-act="ok">${esc(opts.okLabel || 'OK')}</button>`}</div>`;
      box.innerHTML = html; back.appendChild(box); rootEl.appendChild(back); openCount++;
      for (const f of opts.fields || []) if (f.tip) { const el = box.querySelector(`[data-id="${f.id}"],[data-curve="${f.id}"]`), row = el && el.closest('.frow'); if (row) row.title = f.tip; } // what the setting does
      for (const f of opts.fields || []) if (f.type === 'curve') { // drawn curves (envelopes, pitch bend, ...)
        const host = box.querySelector(`[data-curve="${f.id}"]`), ed = curveEditor({ ...f.opts, pts: values[f.id], onChange: (pts) => { values[f.id] = pts; changed(); } }); host.appendChild(ed.el);
      }
      let previewing = false, timer = null;
      const readVal = (el) => (el.type === 'checkbox' ? el.checked : el.type === 'range' || el.type === 'number' ? +el.value : el.value);
      const startPrev = () => { if (opts.preview) { opts.preview.start({ ...values }); previewing = true; pb.textContent = '■ Stop'; } };
      const stopPrev = () => { if (previewing && opts.preview) { opts.preview.stop(); } previewing = false; if (pb) pb.textContent = '▶ Preview'; };
      const pb = box.querySelector('[data-act="preview"]');
      const changed = () => { if (previewing) { clearTimeout(timer); timer = setTimeout(() => { opts.preview.stop(); opts.preview.start({ ...values }); }, 300); } if (opts.onChange) opts.onChange({ ...values }, box); };
      box.querySelectorAll('[data-id]').forEach((el) => {
        const id = el.dataset.id;
        el.addEventListener('input', () => {
          values[id] = readVal(el);
          const n = box.querySelector(`[data-num="${id}"]`); if (n && n !== el) n.value = el.value;
          changed();
        });
      });
      box.querySelectorAll('[data-num]').forEach((el) => el.addEventListener('input', () => {
        const id = el.dataset.num, r = box.querySelector(`[data-id="${id}"]`);
        if (el.value === '' || isNaN(+el.value)) return;
        values[id] = +el.value; r.value = el.value; changed();
      }));
      const close = (res) => { stopPrev(); clearTimeout(timer); back.remove(); openCount--; document.removeEventListener('keydown', onKey, true); resolve(res); };
      const onKey = (e) => {
        if (e.key === 'Escape') { e.stopPropagation(); if (!opts.canClose || opts.canClose()) close(null); } // canClose(): e.g. not while installing
        else if (e.key === 'Enter' && e.target.tagName !== 'BUTTON' && e.target.tagName !== 'TEXTAREA') { e.stopPropagation(); e.preventDefault(); close({ ...values }); }
      };
      document.addEventListener('keydown', onKey, true);
      box.addEventListener('click', (e) => {
        const a = e.target.dataset && e.target.dataset.act;
        if (a === 'ok') close({ ...values }); else if (a === 'cancel') close(null);
        else if (a === 'preview') { previewing ? stopPrev() : startPrev(); }
        if (opts.onClick) opts.onClick(e, box);
      });
      back.addEventListener('mousedown', (e) => { if (e.target === back && opts.dismissable) close(null); });
      if (opts.onReady) opts.onReady(box, close);
      const first = box.querySelector('input[type=text],input.num'); if (first) first.focus(); else box.querySelector('[data-act="ok"],[data-act="cancel"]').focus();
    });
  }
  const dialogOpen = () => openCount > 0;

  /* -------- toast / busy -------- */
  function toast(msg, kind) {
    const el = document.createElement('div'); el.className = 'toast ' + (kind || ''); el.textContent = msg;
    document.getElementById('toasts').appendChild(el);
    setTimeout(() => el.classList.add('hide'), kind === 'error' ? 6000 : 2600); setTimeout(() => el.remove(), kind === 'error' ? 6500 : 3000);
  }
  async function busy(msg, fn, onCancel) {
    const el = document.getElementById('busy'), btn = el.querySelector('button');
    el.querySelector('span').textContent = msg; el.hidden = false;
    btn.hidden = !onCancel; btn.onclick = () => { if (onCancel) onCancel(); };
    await new Promise((r) => setTimeout(r, 40));
    try { return await fn(); } finally { el.hidden = true; btn.onclick = null; }
  }

  /* -------- curve editor: draggable points on a canvas --------
     opts: {W,H, pts, kx:'x', ky:'y', xMin,xMax, yMin,yMax, xLog, xTicks:[[v,label]], yTicks:[[v,label]], fixedEnds, minPts, onChange}  */
  function curveEditor(o) {
    const kx = o.kx || 'x', ky = o.ky || 'y', W = o.W || 560, H = o.H || 180, pad = { l: 40, r: 10, t: 8, b: 20 };
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H; cv.className = 'curve-ed'; cv.style.cssText = 'width:100%;max-width:' + W + 'px;border-radius:4px;background:var(--wave-bg);border:1px solid var(--border);cursor:crosshair;touch-action:none';
    let pts = JSON.parse(JSON.stringify(o.pts || [])), drag = -1, hover = null;
    const lx = (v) => (o.xLog ? Math.log(v) : v), px = (v) => pad.l + ((lx(v) - lx(o.xMin)) / (lx(o.xMax) - lx(o.xMin))) * (W - pad.l - pad.r), py = (v) => pad.t + (1 - (v - o.yMin) / (o.yMax - o.yMin)) * (H - pad.t - pad.b);
    const vx = (x) => { const u = Math.min(1, Math.max(0, (x - pad.l) / (W - pad.l - pad.r))), a = lx(o.xMin), b = lx(o.xMax), r = a + u * (b - a); return o.xLog ? Math.exp(r) : r; };
    const vy = (y) => Math.min(o.yMax, Math.max(o.yMin, o.yMin + (1 - (y - pad.t) / (H - pad.t - pad.b)) * (o.yMax - o.yMin)));
    const sortPts = () => pts.sort((a, b) => a[kx] - b[kx]);
    const draw = () => {
      const g = cv.getContext('2d'), css = getComputedStyle(document.documentElement); g.clearRect(0, 0, W, H); g.fillStyle = css.getPropertyValue('--wave-bg'); g.fillRect(0, 0, W, H);
      g.font = '10px Segoe UI, sans-serif'; g.strokeStyle = css.getPropertyValue('--grid'); g.fillStyle = css.getPropertyValue('--dim');
      for (const [v, l] of o.xTicks || []) { const x = px(v); g.beginPath(); g.moveTo(x, pad.t); g.lineTo(x, H - pad.b); g.stroke(); g.fillText(l, x - 8, H - 6); }
      for (const [v, l] of o.yTicks || []) { const y = py(v); g.beginPath(); g.moveTo(pad.l, y); g.lineTo(W - pad.r, y); g.stroke(); g.fillText(l, 4, y + 3); }
      g.strokeStyle = '#4fd1a5'; g.lineWidth = 2; g.beginPath(); pts.forEach((p, i) => { const x = px(p[kx]), y = py(p[ky]); i ? g.lineTo(x, y) : g.moveTo(x, y); }); g.stroke(); g.lineWidth = 1;
      pts.forEach((p, i) => { g.fillStyle = i === drag ? '#fff' : '#4fd1a5'; g.beginPath(); g.arc(px(p[kx]), py(p[ky]), 5, 0, 7); g.fill(); g.strokeStyle = '#000'; g.stroke(); });
      if (hover) { g.fillStyle = css.getPropertyValue('--text'); g.fillText(hover, W - pad.r - g.measureText(hover).width - 4, pad.t + 10); }
    };
    const pos = (e) => { const r = cv.getBoundingClientRect(); return [((e.clientX - r.left) * W) / r.width, ((e.clientY - r.top) * H) / r.height]; };
    const hit = (x, y) => pts.findIndex((p) => Math.hypot(px(p[kx]) - x, py(p[ky]) - y) < 9);
    const fire = () => o.onChange && o.onChange(JSON.parse(JSON.stringify(pts)));
    cv.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return; const [x, y] = pos(e); let i = hit(x, y);
      if (i < 0) { pts.push({ [kx]: vx(x), [ky]: vy(y) }); sortPts(); i = hit(x, y); if (i < 0) i = pts.length - 1; fire(); }
      drag = i; try { cv.setPointerCapture(e.pointerId); } catch (er) { /* synthetic pointer */ } draw();
    });
    cv.addEventListener('pointermove', (e) => {
      const [x, y] = pos(e);
      if (drag >= 0) { const p = pts[drag], first = drag === 0, last = drag === pts.length - 1; if (!(o.fixedEnds && (first || last))) p[kx] = vx(x); p[ky] = vy(y); if (!o.fixedEnds || (!first && !last)) { const prev = pts[drag - 1], next = pts[drag + 1]; if (prev && p[kx] < prev[kx]) p[kx] = prev[kx]; if (next && p[kx] > next[kx]) p[kx] = next[kx]; } fire(); }
      const i = hit(x, y), p = i >= 0 ? pts[i] : { [kx]: vx(x), [ky]: vy(y) }; hover = (o.xFmt ? o.xFmt(p[kx]) : p[kx].toFixed(2)) + '   ' + (o.yFmt ? o.yFmt(p[ky]) : p[ky].toFixed(1)); draw();
    });
    cv.addEventListener('pointerup', () => { drag = -1; draw(); });
    cv.addEventListener('pointerleave', () => { hover = null; draw(); });
    const remove = (e) => { e.preventDefault(); const [x, y] = pos(e), i = hit(x, y); if (i < 0 || pts.length <= (o.minPts || 2) || (o.fixedEnds && (i === 0 || i === pts.length - 1))) return; pts.splice(i, 1); fire(); draw(); };
    cv.addEventListener('contextmenu', remove); cv.addEventListener('dblclick', remove);
    const wrap = document.createElement('div'); wrap.style.cssText = 'flex:1;min-width:0'; wrap.appendChild(cv);
    const hint = document.createElement('div'); hint.className = 'note'; hint.textContent = o.hint || 'Click to add a point · drag to move · double-click or right-click a point to remove it'; wrap.appendChild(hint); draw();
    return { el: wrap, setPoints(p) { pts = JSON.parse(JSON.stringify(p)); draw(); }, getPoints: () => JSON.parse(JSON.stringify(pts)), draw };
  }

  /* -------- menus -------- */
  function parseShortcut(s) {
    const parts = s.split('+'), key = parts.pop() || '+'; // handles "Ctrl++"? use '=' instead
    return { ctrl: parts.includes('Ctrl'), shift: parts.includes('Shift'), alt: parts.includes('Alt'), key: key.toLowerCase() };
  }
  /* Place a fixed-position menu next to `anchor` (a DOMRect) and keep it inside the viewport:
     - top-level dropdown: below the bar item (or above if there is clearly more room), scrolls when taller than the space
     - submenu: to the right of its row, flipped to the left near the right edge, shifted up near the bottom edge */
  function placeMenu(menu, anchor, sub) {
    const pad = 6, vw = innerWidth, vh = innerHeight;
    menu.style.visibility = 'hidden'; menu.style.maxHeight = ''; menu.style.left = '0px'; menu.style.top = '0px';
    document.body.appendChild(menu);
    const w = menu.offsetWidth, h = menu.offsetHeight;
    let left, top, maxH = '';
    if (!sub) {
      left = Math.min(anchor.left, vw - pad - w); top = anchor.bottom;
      const below = vh - top - pad, above = anchor.top - pad;
      if (h > below) {
        if (above > below) { top = Math.max(pad, anchor.top - Math.min(h, above)); if (h > above) maxH = above + 'px'; }
        else maxH = below + 'px';
      }
    } else {
      left = anchor.right - 3; top = anchor.top - 4;
      if (left + w > vw - pad) left = anchor.left - w + 3;
      if (left < pad) left = pad;
      if (top + h > vh - pad) top = Math.max(pad, vh - pad - h);
      if (h > vh - 2 * pad) { top = pad; maxH = vh - 2 * pad + 'px'; }
    }
    menu.style.left = Math.max(pad, left) + 'px'; menu.style.top = Math.max(0, top) + 'px'; if (maxH) menu.style.maxHeight = maxH;
    menu.style.visibility = '';
  }
  function buildMenus(bar, defs, onAction) {
    bar.innerHTML = '';
    const keymap = [];
    let stack = []; // open menu elements: stack[0] = dropdown, stack[1..] = submenus
    let hoverTimer = null; // single pending hover-intent timer (cancelled whenever menus close, so no orphan submenu can appear)
    const closeFrom = (level) => { clearTimeout(hoverTimer); while (stack.length > level) stack.pop().remove(); };
    const closeAll = () => { closeFrom(0); bar.querySelectorAll('.mb.open').forEach((x) => x.classList.remove('open')); };
    function render(items, level) {
      const menu = document.createElement('div'); menu.className = 'menu' + (level ? ' sub' : '');
      for (const it of items) {
        if (it === '-') { const s = document.createElement('div'); s.className = 'msep'; menu.appendChild(s); continue; }
        const row = document.createElement('div'); row.className = 'mi';
        const dis = typeof it.disabled === 'function' ? it.disabled() : it.disabled;
        if (dis) row.classList.add('dis');
        const chk = typeof it.checked === 'function' ? it.checked() : it.checked;
        row.innerHTML = `<span class="mc">${chk ? '✓' : ''}</span><span class="ml">${esc(it.label)}</span><span class="ms">${it.shortcut ? esc(it.shortcut) : it.items ? '▸' : ''}</span>`;
        const openSub = () => { if (!row.isConnected) return; closeFrom(level + 1); const sm = render(typeof it.items === 'function' ? it.items() : it.items, level + 1); placeMenu(sm, row.getBoundingClientRect(), true); stack.push(sm); row.classList.add('sub-open'); };
        row.addEventListener('mouseenter', () => {
          menu.querySelectorAll('.sub-open').forEach((x) => { if (x !== row) x.classList.remove('sub-open'); });
          clearTimeout(hoverTimer);
          // small delay lets the pointer cross neighbouring rows on its way into a submenu
          hoverTimer = setTimeout(() => { if (!row.isConnected) return; if (it.items) openSub(); else closeFrom(level + 1); }, it.items ? 110 : 60);
        });
        row.addEventListener('mouseleave', () => clearTimeout(hoverTimer));
        row.addEventListener('click', (e) => {
          e.stopPropagation();
          if (it.items) { clearTimeout(hoverTimer); openSub(); return; }
          if (dis) return; closeAll(); onAction(it);
        });
        menu.appendChild(row);
      }
      return menu;
    }
    defs.forEach((m) => {
      const b = document.createElement('div'); b.className = 'mb'; b.textContent = m.label;
      const show = () => {
        closeAll(); b.classList.add('open');
        const menu = render(typeof m.items === 'function' ? m.items() : m.items, 0);
        placeMenu(menu, b.getBoundingClientRect(), false); stack.push(menu);
      };
      b.addEventListener('mousedown', (e) => { e.preventDefault(); if (b.classList.contains('open')) closeAll(); else show(); });
      b.addEventListener('mouseenter', () => { if (stack.length) show(); });
      bar.appendChild(b);
    });
    /* shortcut table from the definitions (again after the user changes shortcuts) */
    const rebuildKeys = () => {
      keymap.length = 0;
      const walk = (items) => { for (const it of typeof items === 'function' ? items() : items) { if (it === '-') continue; if (it.items) walk(it.items); else if (it.shortcut) keymap.push({ ...parseShortcut(it.shortcut), it }); } };
      for (const m of defs) walk(m.items);
    };
    rebuildKeys();
    document.addEventListener('mousedown', (e) => { if (stack.length && !stack.some((m) => m.contains(e.target)) && !bar.contains(e.target)) closeAll(); });
    window.addEventListener('resize', closeAll); window.addEventListener('blur', closeAll);
    return {
      handleKey(e) {
        const dg = /^Digit\d$/.test(e.code || '') ? e.code.slice(5) : '', k = dg || e.key.toLowerCase().replace(/^arrow/, ''), key = k === ' ' ? 'space' : k; // Shift+1 types "!": match the digit
        for (const m of keymap) {
          if (m.key === key && m.ctrl === (e.ctrlKey || e.metaKey) && m.shift === e.shiftKey && m.alt === e.altKey) { e.preventDefault(); onAction(m.it); return true; }
        }
        return false;
      },
      close: closeAll, refreshKeys: rebuildKeys,
    };
  }  AS.ui = { dialog, dialogOpen, toast, busy, buildMenus, esc, curveEditor };
})(window);

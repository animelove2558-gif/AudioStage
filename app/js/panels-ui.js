/* Panel definitions (everything listed in the Window menu) + the Window menu model. Loaded after app.js. */
(function (root) {
  'use strict';
  const AS = (root.AS = root.AS || {}), P = AS.panels, UI = AS.ui, D = AS.dsp, eng = AS.engine, esc = UI.esc;
  const app = root.app, $ = (s, r) => (r || document).querySelector(s);
  const byId = (id) => document.getElementById(id);
  const css = (n) => getComputedStyle(document.documentElement).getPropertyValue(n);
  const fmt = (s) => AS.fmtTime(s);
  const row = (k, v) => `<tr><td>${esc(k)}</td><td>${v}</td></tr>`;
  const dbStr = (v) => (v <= 0.00001 ? '−∞' : D.toDb(v).toFixed(1));

  /* ---------- existing panels (already in index.html) ---------- */
  P.register({ id: 'files', title: 'Files', el: byId('pnlFiles'), dock: 'left', visible: true });
  P.register({ id: 'markers', title: 'Markers', el: byId('pnlMarkers'), dock: 'left', visible: true });
  P.register({ id: 'selview', title: 'Selection/View', el: byId('pnlSelView'), dock: 'right', visible: true });
  P.register({ id: 'effects', title: 'Effects', el: byId('pnlEffects'), dock: 'right', visible: true });
  P.register({ id: 'video', title: 'Video', el: byId('videoPanel'), dock: 'right', visible: true, gate: () => !!(app.cur && app.cur.videoUrl) && app.mode === 'wave' });
  P.register({ id: 'tools', title: 'Tools', el: byId('toolbar'), bare: true, visible: true });
  P.register({ id: 'transport', title: 'Transport', el: byId('transport'), bare: true, visible: true });
  P.register({ id: 'timedisp', title: 'Time Display', el: byId('timeDisp'), bare: true, visible: true });
  P.register({ id: 'statusbar', title: 'Status Bar', el: byId('statusbar'), bare: true, visible: true });

  /* ---------- Essential Sound ---------- */
  P.register({
    id: 'essential', title: 'Essential Sound', dock: 'right', visible: false,
    build(b) {
      b.innerHTML = `<div class="np-note">Tell AudioStage what the selected track contains and it applies a tuned effect chain in the Effects Rack — or let it listen and decide.</div>
        <div class="es-types">${['Dialogue', 'Music', 'Sound effects', 'Ambience'].map((n) => `<button class="btn" data-t="${n}">${n}</button>`).join('')}</div>
        <button class="btn primary es-auto">Auto-detect selected track</button><div class="es-out np-note"></div>`;
      const out = $('.es-out', b);
      const track = () => { const t = app.session.tracks.find((x) => x.id === app.selTrack); if (!t) UI.toast('Select a track in the Multitrack first.'); return t; };
      b.querySelectorAll('[data-t]').forEach((x) => (x.onclick = () => { const t = track(); if (!t) return; app.session.push(); app.applyEssential(t, x.dataset.t); app.multi.rebuildHeads(); app.multiChanged(true); P.refreshAll(); out.textContent = `${t.name}: “${x.dataset.t}” chain applied.`; }));
      $('.es-auto', b).onclick = async () => {
        const t = track(); if (!t) return; if (!t.clips.length) { UI.toast('This track has no clips to analyze.'); return; }
        out.textContent = 'Listening…';
        try { const c = await app.classifyTrack(t); app.session.push(); app.applyEssential(t, c.type); app.multi.rebuildHeads(); app.multiChanged(true); P.refreshAll(); out.textContent = `${t.name}: detected ${c.type} (pause ${(c.features.pauseFrac * 100).toFixed(0)}%, syllable modulation ${c.features.modRatio}). Chain applied.`; }
        catch (e) { out.textContent = 'Error: ' + e.message; }
      };
    },
  });

  /* ---------- Level Meters ---------- */
  const lvl = { peak: [0, 0], hold: [0, 0], clip: [false, false] };
  P.register({
    id: 'levels', title: 'Level Meters', dock: 'right', visible: false,
    build(b) { b.innerHTML = '<canvas class="lv" width="270" height="104" title="Click to reset peak / clip indicators"></canvas>'; $('.lv', b).onclick = () => { lvl.peak = [0, 0]; lvl.clip = [false, false]; }; },
    tick() {
      const cv = $('.lv', this.body); if (!cv) return;
      const g = cv.getContext('2d'), w = cv.width, h = cv.height, lv = eng.levels(), now = performance.now(), x0 = 22, bw = w - x0 - 58, lo = -60;
      g.fillStyle = css('--wave-bg'); g.fillRect(0, 0, w, h);
      const pos = (db) => Math.max(0, Math.min(1, (db - lo) / -lo)) * bw;
      for (let c = 0; c < 2; c++) {
        const db = D.toDb(lv[c]), y = 8 + c * 34;
        if (lv[c] > lvl.peak[c]) { lvl.peak[c] = lv[c]; lvl.hold[c] = now; } else if (now - lvl.hold[c] > 1500) lvl.peak[c] *= 0.96;
        if (lv[c] >= 0.999) lvl.clip[c] = true;
        g.fillStyle = css('--dim'); g.font = '11px Segoe UI'; g.fillText(c ? 'R' : 'L', 6, y + 15);
        const gr = g.createLinearGradient(x0, 0, x0 + bw, 0); gr.addColorStop(0, '#2fb67c'); gr.addColorStop(0.72, '#d9c24a'); gr.addColorStop(0.93, '#e8503a');
        g.fillStyle = gr; g.fillRect(x0, y, pos(db), 22); g.fillStyle = '#fff'; g.fillRect(x0 + pos(D.toDb(lvl.peak[c])) - 1, y, 2, 22);
        g.fillStyle = lvl.clip[c] ? '#ff3b30' : '#3a3f47'; g.fillRect(w - 52, y, 10, 22);
        g.fillStyle = css('--text'); g.font = '11px Consolas, monospace'; g.fillText(dbStr(lvl.peak[c]), w - 38, y + 15);
      }
      g.fillStyle = css('--dim'); g.font = '9px Segoe UI'; for (const db of [-48, -36, -24, -12, -6, 0]) g.fillText(db, x0 + pos(db) - 6, h - 6);
    },
  });

  /* ---------- History ---------- */
  const hist = { sig: '' };
  function historyModel() {
    if (app.mode === 'multi') { const s = app.session; return { id: 'm', undo: s.undoStack.map((_, i) => 'Multitrack edit ' + (i + 1)), redo: s.redoStack.map((_, i) => 'Multitrack edit ' + (s.undoStack.length + s.redoStack.length - i)) }; }
    const d = app.cur; if (!d) return { id: '-', undo: [], redo: [] };
    return { id: 'd' + d.id, undo: d.undoStack.map((u) => u.label || 'Edit'), redo: d.redoStack.map((u) => u.label || 'Edit').reverse() };
  }
  P.register({
    id: 'history', title: 'History', dock: 'left', visible: false,
    build(b) {
      b.innerHTML = '<div class="plist hist"></div>';
      b.addEventListener('click', (e) => {
        const it = e.target.closest('[data-u],[data-r]'); if (!it) return;
        const m = historyModel();
        if (it.dataset.u !== undefined) { const n = m.undo.length - 1 - +it.dataset.u; for (let i = 0; i < n; i++) AS.actions['edit.undo'](); }
        else { const n = +it.dataset.r + 1; for (let i = 0; i < n; i++) AS.actions['edit.redo'](); }
        hist.sig = ''; this.refresh();
      });
    },
    refresh() {
      const el = $('.hist', this.body); if (!el) return; const m = historyModel(); hist.sig = m.id + '|' + m.undo.length + '|' + m.redo.length;
      el.innerHTML = '<div class="hrow base">Open</div>' + m.undo.map((l, i) => `<div class="hrow ${i === m.undo.length - 1 ? 'cur' : ''}" data-u="${i}">${esc(l)}</div>`).join('') + m.redo.map((l, i) => `<div class="hrow redo" data-r="${i}">${esc(l)}</div>`).join('');
      if (!m.undo.length) $('.base', el).classList.add('cur');
      const cur = $('.cur', el); if (cur) cur.scrollIntoView({ block: 'nearest' });
    },
    tick() { const m = historyModel(); if (m.id + '|' + m.undo.length + '|' + m.redo.length !== hist.sig) this.refresh(); },
  });

  /* ---------- Properties ---------- */
  P.register({
    id: 'props', title: 'Properties', dock: 'right', visible: false,
    build(b) { b.innerHTML = '<div class="pr-body"></div>'; },
    refresh() {
      const el = $('.pr-body', this.body); if (!el) return; let html = '';
      if (app.mode === 'multi') {
        const f = app.session.sel && app.session.findClip(app.session.sel);
        if (f) { const c = f.c; html = `<table class="info kv">${row('Clip', esc(c.name))}${row('Track', esc(f.t.name))}${row('Start', fmt(c.start))}${row('Duration', fmt(c.dur))}${row('Source offset', fmt(c.off))}${row('Gain', c.gain.toFixed(1) + ' dB')}${row('Fade in', c.fi.toFixed(2) + ' s · ' + (c.fiCurve || 'linear'))}${row('Fade out', c.fo.toFixed(2) + ' s · ' + (c.foCurve || 'linear'))}${row('Effects', AS.rack.activeFx(c.fx).length + ' active')}${row('Source', c.src.sr + ' Hz · ' + c.src.ch.length + ' ch')}</table><button class="btn sm" data-a="clip">Clip properties…</button> <button class="btn sm" data-a="rack">Clip effects…</button>`; }
        else { const s = app.session; html = `<table class="info kv">${row('Session', s.tracks.length + ' tracks')}${row('Length', fmt(s.duration))}${row('Sample rate', s.sr + ' Hz')}</table><div class="np-note">Select a clip to see its properties.</div>`; }
      } else if (app.cur) {
        const d = app.cur; html = `<table class="info kv">${row('File', esc(d.name))}${row('Sample rate', d.sr + ' Hz')}${row('Channels', d.ch.length === 1 ? 'Mono' : d.ch.length === 2 ? 'Stereo' : d.ch.length)}${row('Bit depth', '32-bit float (working)')}${row('Length', fmt(d.dur) + ' · ' + d.len + ' samples')}${row('Markers', d.markers.length)}${row('Edits', d.undoStack.length + (d.dirty ? ' (unsaved)' : ''))}</table>`;
      } else html = '<div class="np-note">No file open.</div>';
      el.innerHTML = html;
      el.querySelectorAll('[data-a]').forEach((x) => (x.onclick = () => { if (x.dataset.a === 'clip') app.clipProperties(app.session.sel); else AS.rackpanel.open({ clip: app.session.sel }); }));
    },
    tick() { const sig = app.mode + '|' + app.session.sel + '|' + (app.cur ? app.cur.id + ':' + app.cur.version : '') + '|' + app.session.tracks.reduce((a, t) => a + t.clips.length, 0) + '|' + (app.session.sel ? JSON.stringify((app.session.findClip(app.session.sel) || { c: {} }).c, (k, v) => (k === 'src' || k === 'fx' || k === 'env' ? undefined : v)) : ''); if (sig !== this._sig) { this._sig = sig; this.refresh(); } },
  });

  /* ---------- Metadata ---------- */
  P.register({
    id: 'metadata', title: 'Metadata', dock: 'right', visible: false,
    build(b) {
      b.innerHTML = `<div class="np-note">Stored in WAV exports as BWF (<i>bext</i>) and CART chunks, and prefilled in the Save dialog.</div>
        <div class="md-form"><label>Title</label><input data-k="title"><label>Artist</label><input data-k="artist"><label>Comment</label><textarea data-k="comment" rows="3"></textarea></div><div class="md-info np-note"></div>`;
      b.addEventListener('input', (e) => { const k = e.target.dataset.k, d = app.cur; if (!k || !d) return; d.meta = d.meta || {}; d.meta[k] = e.target.value; });
    },
    refresh() {
      const d = app.cur, b = this.body; if (!b) return;
      b.querySelectorAll('[data-k]').forEach((i) => { i.disabled = !d; i.value = d && d.meta ? d.meta[i.dataset.k] || '' : ''; });
      $('.md-info', b).textContent = d ? `${d.name} · ${d.markers.length} marker(s) are written as cue points.` : 'No file open.';
    },
    tick() { const id = app.cur ? app.cur.id : 0; if (id !== this._id) { this._id = id; this.refresh(); } },
  });

  /* ---------- Match Loudness ---------- */
  const ml = { lufs: {} };
  P.register({
    id: 'match', title: 'Match Loudness', dock: 'right', visible: false,
    build(b) {
      b.innerHTML = `<div class="np-note">Measures integrated loudness (ITU-R BS.1770) and true peak (4× oversampled) of the open files and matches them to one target, limiting true peaks to the ceiling.</div>
        <div class="ml-ctl"><select class="ml-t"><option value="-23">EBU R128 (−23 LUFS)</option><option value="-16" selected>Podcast / streaming (−16 LUFS)</option><option value="-14">Music streaming (−14 LUFS)</option><option value="-18">Broadcast (−18 LUFS)</option></select><select class="ml-c" title="True-peak ceiling"><option value="-1" selected>−1 dBTP</option><option value="-2">−2 dBTP</option><option value="-3">−3 dBTP</option></select><button class="btn sm ml-scan">Scan</button><button class="btn sm primary ml-go">Match all</button></div><div class="ml-list"></div>`;
      $('.ml-scan', b).onclick = () => this.scan(); $('.ml-go', b).onclick = () => this.matchAll();
    },
    refresh() {
      const el = $('.ml-list', this.body); if (!el) return;
      const val = (d) => { const m = ml.lufs[d.id + ':' + d.version]; if (!m) return '?'; return (isFinite(m.I) ? m.I.toFixed(1) + ' LUFS' : '—') + ' · ' + (isFinite(m.TP) ? m.TP.toFixed(1) + ' dBTP' : '—'); };
      el.innerHTML = app.docs.length ? '<table class="info">' + app.docs.map((d) => `<tr><td title="${esc(d.name)}">${esc(d.name.length > 22 ? d.name.slice(0, 20) + '…' : d.name)}</td><td>${val(d)}</td></tr>`).join('') + '</table>' : '<div class="empty">No files open.</div>';
    },
    async scan() { await UI.busy('Measuring loudness…', async () => { for (const d of app.docs) { ml.lufs[d.id + ':' + d.version] = { I: D.loudness(d.ch, d.sr), TP: D.toDb(D.truePeak(d.ch).peak) }; await new Promise((r) => setTimeout(r)); } }); this.refresh(); },
    async matchAll() {
      if (!app.docs.length) { UI.toast('Open some files first.'); return; }
      const target = +$('.ml-t', this.body).value, ceil = +$('.ml-c', this.body).value;
      try {
        for (const d of app.docs.slice()) {
          let job; const out = await UI.busy(`Matching ${d.name}…`, async () => { job = AS.jobs.fx('loudnorm', d.ch.map((c) => c.slice()), d.sr, { target, ceil }); return job; }, () => job && job.cancel());
          if (app.playDoc === d) app.stopPlayback();
          d.set(out, 'Match Loudness ' + target + ' LUFS', { a: 0, b: 0 }); delete ml.lufs[d.id + ':' + (d.version - 1)];
        }
        app.wave.specCache = null; app.wave.draw(); app.refreshFiles(); await this.scan(); UI.toast('Loudness matched to ' + target + ' LUFS.');
      } catch (e) { UI.toast(e.message === 'Cancelled' ? 'Cancelled.' : e.message, e.message === 'Cancelled' ? '' : 'error'); }
    },
    tick() { const sig = app.docs.map((d) => d.id + ':' + d.version).join(','); if (sig !== this._sig) { this._sig = sig; this.refresh(); } },
  });

  /* ---------- Media Browser (desktop app): browse, preview (auto-play / loop), double-click to open, drag into the
     Waveform editor or onto a multitrack lane ---------- */
  const media = root.audioStageMedia, AUDIO_EXT = /\.(wav|wave|mp3|ogg|flac|m4a|aac|opus|aif|aiff|webm|mp4|mov|mkv|m4v)$/i;
  const MB_KEY = 'as-mediabrowser', mbs = (() => { try { return { auto: true, loop: false, ...(JSON.parse(localStorage.getItem(MB_KEY)) || {}) }; } catch (e) { return { auto: true, loop: false }; } })();
  const prev = { src: null, path: '', cache: new Map() }; // preview: one BufferSource straight to the speakers (not part of any mix)
  const nameOf = (p) => p.split(/[\\/]/).pop();
  async function mediaFile(p) { const r = await media.read(p); if (!r.ok) throw new Error(r.error); return new File([r.data], nameOf(p)); }
  function stopPreview() { if (prev.src) { try { prev.src.onended = null; prev.src.stop(); prev.src.disconnect(); } catch (e) { /* */ } prev.src = null; } prev.path = ''; const b = P.defs.media && P.defs.media.body; if (b) b.querySelectorAll('.mbi.playing').forEach((x) => x.classList.remove('playing')); }
  async function preview(p) {
    stopPreview(); if (!AUDIO_EXT.test(p)) return null; eng.init();
    let buf = prev.cache.get(p);
    if (!buf) { const f = await mediaFile(p); buf = await eng.ctx.decodeAudioData(await f.arrayBuffer()); prev.cache.set(p, buf); if (prev.cache.size > 8) prev.cache.delete(prev.cache.keys().next().value); }
    const s = eng.ctx.createBufferSource(); s.buffer = buf; s.loop = !!mbs.loop; s.connect(eng.ctx.destination); s.start();
    s.onended = () => { if (prev.src === s) stopPreview(); };
    prev.src = s; prev.path = p;
    for (const el of P.defs.media.body.querySelectorAll('.mbi')) if (el.dataset.p === p) el.classList.add('playing');
    return s;
  }
  AS.mediaPreview = { state: prev, settings: mbs, preview, stop: stopPreview, file: mediaFile };
  P.register({
    id: 'media', title: 'Media Browser', dock: 'left', visible: false,
    build(b) {
      if (!media) { b.innerHTML = '<div class="np-note">The Media Browser lists folders on this computer and is available in the desktop app (<code>npm start</code>). Use File &gt; Open… in the browser build.</div><button class="btn sm" data-a="open">Open files…</button>'; $('[data-a=open]', b).onclick = () => AS.actions['file.open'](); return; }
      b.innerHTML = `<div class="mb-bar"><select class="mb-roots" title="Locations"></select><button class="btn sm" data-a="up" title="Parent folder">↑ Up</button></div><div class="mb-path"></div>
        <div class="mb-prev"><button class="btn sm" data-a="play" title="Preview the selected file">▶</button><button class="btn sm" data-a="stop" title="Stop the preview">■</button><label class="chk"><input type="checkbox" data-o="auto" ${mbs.auto ? 'checked' : ''}> Auto-play</label><label class="chk"><input type="checkbox" data-o="loop" ${mbs.loop ? 'checked' : ''}> Loop</label></div>
        <div class="plist mb-list"></div><div class="np-note">Click: select (and preview with Auto-play) · double-click: open · drag onto the waveform or a multitrack lane.</div>`;
      const list = $('.mb-list', b), path = $('.mb-path', b), roots = $('.mb-roots', b); let sel = '';
      const go = this.go = async (dir) => {
        const req = (this._req = (this._req || 0) + 1), r = await media.list(dir); if (req !== this._req) return false; // a newer listing won
        if (!r.ok) { UI.toast(r.error, 'error'); return false; }
        path.textContent = r.dir; path.title = r.dir; sel = '';
        list.innerHTML = r.entries.map((e) => `<div class="fitem mbi ${e.dir ? 'dir' : AUDIO_EXT.test(e.name) ? 'aud' : 'oth'}" data-p="${esc(e.path)}" data-d="${e.dir ? 1 : 0}" title="${esc(e.name)}" ${!e.dir && AUDIO_EXT.test(e.name) ? 'draggable="true"' : ''}><div class="fn">${e.dir ? '📁 ' : '♪ '}${esc(e.name)}</div>${e.dir ? '' : `<div class="fm">${(e.size / 1048576).toFixed(1)} MB</div>`}</div>`).join('') || '<div class="empty">Empty folder</div>';
        $('[data-a=up]', b).dataset.dir = r.parent || ''; return true;
      };
      media.roots().then((r) => { roots.innerHTML = (r.roots || []).map((x) => `<option value="${esc(x.path)}">${esc(x.name)}</option>`).join(''); if (r.roots && r.roots.length && !this._req) go(r.roots[0].path); });
      roots.onchange = () => go(roots.value);
      $('[data-a=up]', b).onclick = (e) => { if (e.target.dataset.dir) go(e.target.dataset.dir); };
      b.querySelectorAll('[data-o]').forEach((i) => (i.onchange = () => { mbs[i.dataset.o] = i.checked; try { localStorage.setItem(MB_KEY, JSON.stringify(mbs)); } catch (e) { /* */ } if (i.dataset.o === 'loop' && prev.src) prev.src.loop = i.checked; }));
      $('[data-a=play]', b).onclick = () => { if (sel) preview(sel).catch((e) => UI.toast(e.message, 'error')); };
      $('[data-a=stop]', b).onclick = stopPreview;
      list.addEventListener('click', (e) => {
        const it = e.target.closest('.mbi'); if (!it || it.dataset.d === '1') return;
        list.querySelectorAll('.mbi.cur').forEach((x) => x.classList.remove('cur')); it.classList.add('cur'); sel = it.dataset.p;
        if (mbs.auto && AUDIO_EXT.test(sel)) preview(sel).catch((er) => UI.toast('Cannot preview: ' + er.message, 'error'));
      });
      list.addEventListener('dblclick', async (e) => {
        const it = e.target.closest('.mbi'); if (!it) return;
        if (it.dataset.d === '1') { go(it.dataset.p); return; }
        if (!AUDIO_EXT.test(it.dataset.p)) { UI.toast('That file type cannot be opened.'); return; }
        stopPreview(); try { app.openFiles([await mediaFile(it.dataset.p)]); } catch (er) { UI.toast(er.message, 'error'); }
      });
      list.addEventListener('dragstart', (e) => { const it = e.target.closest('.mbi'); if (!it) return; e.dataTransfer.setData('application/x-audiostage-path', it.dataset.p); e.dataTransfer.setData('text/plain', nameOf(it.dataset.p)); e.dataTransfer.effectAllowed = 'copy'; });
    },
    onHide() { stopPreview(); },
  });

  /* ---------- Mixer (bottom dock) ---------- */
  const mx = { sig: '', meters: {} };
  // the strips are rebuilt when anything structural changes (tracks, names, mute/solo, routing, sends).
  // (defined before register(): a Mixer left open last time is refreshed while it registers)
  const sigOf = (s) => s.tracks.map((t) => [t.id, t.name, t.mute, t.solo, t.type, t.out, (t.sends || []).map((x) => x.to + x.pre).join('/')].join(':')).join(',') + '|' + s.tracks.length + '|' + s.opts.channels;
  /* 5.1: a small surround pad on each strip that goes to the master (drag the dot; double-click = front centre) */
  function surroundPad(t, s) {
    const cv = document.createElement('canvas'); cv.className = 'mx-sur'; cv.width = 56; cv.height = 56; cv.title = 'Surround position (5.1): drag the dot · double-click: front centre · Multitrack > Track Surround Panner… for spread and LFE';
    const draw = () => {
      const g = cv.getContext('2d'), p = { x: 0, y: 1, ...(t.sur || {}) }; g.fillStyle = css('--wave-bg'); g.fillRect(0, 0, 56, 56);
      g.strokeStyle = css('--grid'); g.beginPath(); g.arc(28, 28, 24, 0, 7); g.stroke();
      g.fillStyle = css('--dim'); for (const a of [0, 30, 110, 250, 330]) { const r = (a * Math.PI) / 180; g.fillRect(28 + Math.sin(r) * 24 - 1.5, 28 - Math.cos(r) * 24 - 1.5, 3, 3); }
      g.fillStyle = '#4fd1a5'; g.beginPath(); g.arc(28 + p.x * 24, 28 - p.y * 24, 4, 0, 7); g.fill();
    };
    const at = (e) => { const r = cv.getBoundingClientRect(); let x = ((e.clientX - r.left) / r.width) * 2 - 1, y = 1 - ((e.clientY - r.top) / r.height) * 2; const m = Math.hypot(x, y); if (m > 1) { x /= m; y /= m; } return { x: +x.toFixed(3), y: +y.toFixed(3) }; };
    let drag = false;
    cv.addEventListener('pointerdown', (e) => { s.push(); drag = true; try { cv.setPointerCapture(e.pointerId); } catch (er) { /* */ } t.sur = { ...(t.sur || {}), ...at(e) }; draw(); app.multiChanged(); });
    cv.addEventListener('pointermove', (e) => { if (!drag) return; t.sur = { ...(t.sur || {}), ...at(e) }; draw(); app.multiChanged(); });
    cv.addEventListener('pointerup', () => { drag = false; app.multiChanged(true); });
    cv.addEventListener('dblclick', () => { s.push(); t.sur = { ...(t.sur || {}), x: 0, y: 1 }; draw(); app.multiChanged(true); });
    draw(); return cv;
  }
  /* drag a strip by its name to move the track (same as dragging its header in the multitrack view) */
  function mixerDrag(e, wrap) {
    const nm = e.target.closest('.mx-name'), el = nm && nm.closest('.mx-strip[data-tid]'); if (!el || e.button !== 0) return;
    e.preventDefault(); const x0 = e.clientX; let to = null, moved = false;
    const strips = () => [...wrap.querySelectorAll('.mx-strip[data-tid]')];
    const clear = () => strips().forEach((x) => x.classList.remove('mx-drop-l', 'mx-drop-r'));
    const move = (ev) => {
      if (!moved && Math.abs(ev.clientX - x0) < 4) return; moved = true; el.classList.add('mx-dragging'); document.body.classList.add('mt-dragging'); clear();
      const ss = strips(); let i = ss.findIndex((x) => { const r = x.getBoundingClientRect(); return ev.clientX < r.left + r.width / 2; }); if (i < 0) i = ss.length;
      to = i < ss.length ? ss[i].dataset.tid : ''; // drop before that track ('' = after the last)
      if (i < ss.length) ss[i].classList.add('mx-drop-l'); else if (ss.length) ss[ss.length - 1].classList.add('mx-drop-r');
    };
    const up = () => {
      window.removeEventListener('pointermove', move, true); window.removeEventListener('pointerup', up, true);
      el.classList.remove('mx-dragging'); document.body.classList.remove('mt-dragging'); clear(); if (!moved || to === null) return;
      const s = app.session, at = to ? s.tracks.findIndex((t) => t.id === to) : s.tracks.length;
      app.multi.reorderTracks([el.dataset.tid], at < 0 ? s.tracks.length : at);
    };
    window.addEventListener('pointermove', move, true); window.addEventListener('pointerup', up, true);
  }
  P.register({
    id: 'mixer', title: 'Mixer', dock: 'bottom', visible: false,
    build(b) { b.innerHTML = '<div class="mx-strips"></div>'; },
    refresh() {
      const wrap = $('.mx-strips', this.body); if (!wrap) return; const s = app.session; mx.sig = sigOf(s); wrap.innerHTML = '';
      const RT = AS.routing;
      const strip = (name, color, getVol, setVol, pan, mute, solo, key, fxOpen, t) => {
        const el = document.createElement('div'); el.className = 'mx-strip' + (t && t.type === 'bus' ? ' bus' : ''); el.style.borderTopColor = color;
        el.innerHTML = `<div class="mx-name" title="${esc(name)}">${t && t.type === 'bus' ? '<span class="busTag">BUS</span> ' : ''}${esc(name)}</div>
          ${t ? `<select class="mx-out" title="Output: Master or a bus">${RT.outputOptions(s, t).map(([v, n]) => `<option value="${esc(v)}" ${v === t.out ? 'selected' : ''}>→ ${esc(n)}</option>`).join('')}</select><div class="mx-sends"></div>` : '<div class="mx-out-ph">Output: hardware</div>'}
          <input type="range" class="mx-pan" min="-1" max="1" step="0.01" title="Pan (double-click to center)" ${pan ? '' : 'disabled style="visibility:hidden"'}>
          <div class="mx-mid"><canvas class="mx-vu" width="24" height="120"></canvas><input type="range" class="mx-fader" min="-60" max="12" step="0.5" orient="vertical" title="Volume (double-click: 0 dB)"></div>
          <div class="mx-db"></div>
          <div class="mx-btns"><button class="sm tb m ${mute && mute.get() ? 'on m' : ''}" ${mute ? '' : 'hidden'}>M</button><button class="sm tb s ${solo && solo.get() ? 'on s' : ''}" ${solo ? '' : 'hidden'}>S</button><button class="sm tb fxb on">FX</button></div>`;
        const f = $('.mx-fader', el), db = $('.mx-db', el); f.value = getVol(); db.textContent = (+f.value).toFixed(1) + ' dB';
        f.addEventListener('pointerdown', () => s.push());
        f.addEventListener('input', () => { setVol(+f.value); db.textContent = (+f.value).toFixed(1) + ' dB'; app.multiChanged(); });
        f.addEventListener('dblclick', () => { s.push(); f.value = 0; f.dispatchEvent(new Event('input')); });
        if (pan) { const p = $('.mx-pan', el); p.value = pan.get(); p.addEventListener('pointerdown', () => s.push()); p.addEventListener('input', () => { pan.set(+p.value); app.multiChanged(); }); p.addEventListener('dblclick', () => { s.push(); p.value = 0; p.dispatchEvent(new Event('input')); }); }
        const bm = $('.tb.m', el), bs = $('.tb.s', el);
        if (mute) bm.onclick = () => { s.push(); mute.set(!mute.get()); bm.classList.toggle('on', mute.get()); app.multi.rebuildHeads(); app.multiChanged(); };
        if (solo) bs.onclick = () => { s.push(); solo.set(!solo.get()); bs.classList.toggle('on', solo.get()); app.multi.rebuildHeads(); app.multiChanged(); };
        $('.fxb', el).onclick = fxOpen;
        if (t) { $('.mx-out', el).onchange = (e) => { s.push(); t.out = e.target.value; app.multi.rebuildHeads(); app.multi.draw(); app.multiChanged(true); this.refresh(); }; sendsUI(t, $('.mx-sends', el)); }
        if (t && s.opts.channels === 6 && t.out === 'master') $('.mx-sends', el).after(surroundPad(t, s));
        if (!t && s.opts.channels === 6) $('.mx-out-ph', el).textContent = 'Output: 5.1 (6 ch)';
        if (t) { el.dataset.tid = t.id; $('.mx-name', el).title = name + ' — drag to move the track'; }
        el._key = key; el._fader = f; el._pan = pan && $('.mx-pan', el); el._getVol = getVol; el._panGet = pan && pan.get; el._db = db; el._vu = $('.mx-vu', el);
        wrap.appendChild(el);
      };
      /* sends of one track: destination bus, level knob, pre/post-fader, remove; "+ Send" while < 16 */
      const sendsUI = (t, box) => {
        const changed = (structural) => { if (structural) { app.multi.refreshAutoOptions(); app.multi.draw(); this.refresh(); } app.multiChanged(structural ? true : undefined); };
        (t.sends || []).forEach((x, i) => {
          const row = document.createElement('div'); row.className = 'mx-send';
          const opts = RT.sendTargets(s, t, x.to);
          row.innerHTML = `<select title="Send ${i + 1} destination">${opts.map(([v, n]) => `<option value="${esc(v)}" ${v === x.to ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select>
            <input type="range" min="-60" max="12" step="0.5" value="${x.db}" title="Send ${i + 1} level: ${x.db.toFixed(1)} dB (double-click: 0 dB)">
            <button class="sm tb ${x.pre ? 'on' : ''}" data-a="pre" title="${x.pre ? 'Pre-fader (click for post-fader)' : 'Post-fader (click for pre-fader)'}">${x.pre ? 'PRE' : 'POST'}</button><button class="sm danger" data-a="del" title="Remove send">×</button>
            <input type="range" class="mx-span" min="-1" max="1" step="0.01" value="${x.pan}" title="Send ${i + 1} pan (double-click: center)">`;
          const sel = $('select', row), knob = $('input', row), span = $('.mx-span', row);
          span.addEventListener('pointerdown', () => s.push());
          span.addEventListener('input', () => { x.pan = +span.value; changed(); });
          span.addEventListener('dblclick', () => { s.push(); span.value = 0; span.dispatchEvent(new Event('input')); });
          sel.onchange = () => { s.push(); x.to = sel.value; changed(true); };
          knob.addEventListener('pointerdown', () => s.push());
          knob.addEventListener('input', () => { x.db = +knob.value; knob.title = `Send ${i + 1} level: ${x.db.toFixed(1)} dB (double-click: 0 dB)`; changed(); });
          knob.addEventListener('dblclick', () => { s.push(); knob.value = 0; knob.dispatchEvent(new Event('input')); });
          $('[data-a=pre]', row).onclick = () => { s.push(); x.pre = !x.pre; changed(true); };
          $('[data-a=del]', row).onclick = () => { s.push(); t.sends.splice(i, 1); changed(true); };
          box.appendChild(row);
        });
        const targets = RT.sendTargets(s, t);
        if ((t.sends || []).length < RT.MAX_SENDS && targets.length) {
          const add = document.createElement('button'); add.className = 'sm mx-addsend'; add.textContent = '+ Send'; add.title = 'Send this track to a bus (up to 16 sends)';
          add.onclick = () => { s.push(); RT.addSend(s, t, targets[0][0]); changed(true); };
          box.appendChild(add);
        }
      };
      s.tracks.forEach((t) => { if (t.type === 'video') return; RT.normTrack(t); strip(t.name, t.color, () => t.vol, (v) => (t.vol = v), { get: () => t.pan, set: (v) => (t.pan = v) }, { get: () => t.mute, set: (v) => (t.mute = v) }, { get: () => t.solo, set: (v) => (t.solo = v) }, 'm:' + t.id, () => { app.selTrack = t.id; app.rackTarget = null; app.openRack(t); }, t); });
      strip('Master', '#9aa4b2', () => s.master.vol, (v) => (s.master.vol = v), null, null, null, 'master', () => app.openRack(null));
      wrap.onpointerdown = (e) => mixerDrag(e, wrap);
    },
    tick() {
      const s = app.session, wrap = $('.mx-strips', this.body); if (!wrap) return;
      if (sigOf(s) !== mx.sig) { this.refresh(); return; }
      wrap.querySelectorAll('.mx-strip').forEach((el) => {
        if (document.activeElement !== el._fader && +el._fader.value !== el._getVol()) { el._fader.value = el._getVol(); el._db.textContent = el._getVol().toFixed(1) + ' dB'; }
        if (el._pan && document.activeElement !== el._pan && +el._pan.value !== el._panGet()) el._pan.value = el._panGet();
        const g = el._vu.getContext('2d'), h = el._vu.height, lv = eng.playing ? eng.meterLevels(el._key) : [0, 0];
        g.fillStyle = css('--wave-bg'); g.fillRect(0, 0, 24, h);
        lv.forEach((v, c) => { const db = D.toDb(v), y = Math.max(0, Math.min(1, (db + 60) / 60)) * h; const gr = g.createLinearGradient(0, h, 0, 0); gr.addColorStop(0, '#2fb67c'); gr.addColorStop(0.72, '#d9c24a'); gr.addColorStop(0.93, '#e8503a'); g.fillStyle = gr; g.fillRect(2 + c * 11, h - y, 9, y); });
      });
    },
  });

  /* ---------- Spectrum Analyzer ---------- */
  const spec = { smooth: null };
  P.register({
    id: 'spectrum', title: 'Spectrum Analyzer', dock: 'right', visible: false,
    build(b) { b.innerHTML = '<canvas class="sp" width="270" height="120"></canvas>'; },
    tick() {
      const cv = $('.sp', this.body); if (!cv || !eng.spec) return;
      const g = cv.getContext('2d'), w = cv.width, h = cv.height, an = eng.spec, n = an.frequencyBinCount, data = new Float32Array(n), sr = eng.ctx.sampleRate;
      an.getFloatFrequencyData(data); if (!spec.smooth) spec.smooth = new Float32Array(n).fill(-120);
      g.fillStyle = css('--wave-bg'); g.fillRect(0, 0, w, h); g.strokeStyle = css('--grid'); g.fillStyle = css('--dim'); g.font = '9px Segoe UI';
      const fx = (f) => (Math.log10(f / 20) / Math.log10(sr / 2 / 20)) * (w - 4) + 2;
      for (const f of [100, 1000, 10000]) { const x = fx(f); g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h - 12); g.stroke(); g.fillText(f >= 1000 ? f / 1000 + 'k' : f, x + 2, h - 2); }
      g.strokeStyle = '#4fd1a5'; g.beginPath();
      for (let k = 1; k < n; k++) { spec.smooth[k] = Math.max(data[k], spec.smooth[k] - 1.2); const f = (k * sr) / an.fftSize; if (f < 20) continue; const x = fx(f), y = (h - 12) * (1 - Math.max(0, Math.min(1, (spec.smooth[k] + 100) / 100))); if (k === 1 || f < 21) g.moveTo(x, y); else g.lineTo(x, y); }
      g.stroke();
    },
  });

  /* ---------- Phase Meter: correlation (whole band + low / mid / high) and vectorscope (goniometer) ----------
     Fed by a continuous tap of the master output (no gaps), so the band filters keep their state. */
  const ph = { v: 0, bands: [0, 0, 0], pts: null, untap: null, flt: null, sr: 0 };
  const bandFilters = (sr) => [['lowpass', 250], ['bandpass', 1000], ['highpass', 4000]].map(([t, f]) => [0, 1].map(() => ({ c: D.biquadCoefs(t, sr, f, t === 'bandpass' ? 0.5 : 0.707), z: [0, 0, 0, 0] })));
  const runBq = (st, x) => { const c = st.c, z = st.z, y = new Float32Array(x.length); for (let i = 0; i < x.length; i++) { const v = x[i], o = c[0] * v + c[1] * z[0] + c[2] * z[1] - c[3] * z[2] - c[4] * z[3]; z[1] = z[0]; z[0] = v; z[3] = z[2]; z[2] = o; y[i] = o; } return y; };
  function phaseChunk(chs) {
    const L = chs[0], R = chs[1] || chs[0], k = 0.35;
    ph.v += (D.correlation(L, R) - ph.v) * k;
    ph.flt.forEach((f, i) => { ph.bands[i] += (D.correlation(runBq(f[0], L), runBq(f[1], R)) - ph.bands[i]) * k; });
    ph.pts = [L, R];
  }
  P.register({
    id: 'phase', title: 'Phase Meter', dock: 'right', visible: false,
    build(b) { b.innerHTML = '<canvas class="phm" width="270" height="96"></canvas><canvas class="vsc" width="270" height="200" title="Vectorscope (goniometer): vertical = mid (mono), horizontal = side (stereo width)"></canvas><div class="np-note">Correlation: +1 = mono-compatible · 0 = wide stereo · −1 = out of phase (cancels in mono). Vectorscope: a vertical line is mono, a horizontal one is out of phase.</div>'; },
    onShow() { if (!ph.untap && eng.ctx) { ph.untap = eng.tapMaster((chs) => { if (!ph.flt || ph.sr !== eng.ctx.sampleRate) { ph.sr = eng.ctx.sampleRate; ph.flt = bandFilters(ph.sr); } phaseChunk(chs); }); } },
    onHide() { if (ph.untap) { ph.untap(); ph.untap = null; } },
    tick() {
      const cv = $('.phm', this.body), vs = $('.vsc', this.body); if (!cv || !eng.ctx) return; if (!ph.untap) this.onShow();
      const g = cv.getContext('2d'), w = cv.width, h = cv.height; g.fillStyle = css('--wave-bg'); g.fillRect(0, 0, w, h);
      const x = (v) => ((v + 1) / 2) * (w - 60) + 50, bar = (y, v, label, big) => {
        const grd = g.createLinearGradient(x(-1), 0, x(1), 0); grd.addColorStop(0, '#e8503a'); grd.addColorStop(0.5, '#d9c24a'); grd.addColorStop(1, '#2fb67c');
        g.fillStyle = grd; g.globalAlpha = big ? 1 : 0.7; g.fillRect(x(-1), y, x(1) - x(-1), big ? 12 : 7); g.globalAlpha = 1; g.fillStyle = '#fff'; g.fillRect(x(v) - 2, y - 3, 4, (big ? 12 : 7) + 6);
        g.fillStyle = css('--dim'); g.font = '10px Segoe UI'; g.fillText(label, 4, y + (big ? 10 : 7));
      };
      bar(8, ph.v, 'All', true); bar(36, ph.bands[0], '< 250 Hz'); bar(54, ph.bands[1], 'Mid'); bar(72, ph.bands[2], '> 4 kHz');
      g.fillStyle = css('--dim'); g.font = '9px Segoe UI'; g.fillText('−1', x(-1) - 4, h - 1); g.fillText('0', x(0) - 3, h - 1); g.fillText('+1', x(1) - 10, h - 1);
      const vg = vs.getContext('2d'), W = vs.width, H = vs.height, cx = W / 2, cy = H / 2, r = Math.min(W, H) / 2 - 8;
      vg.fillStyle = css('--wave-bg'); vg.fillRect(0, 0, W, H); vg.strokeStyle = css('--grid'); vg.beginPath(); vg.moveTo(cx, cy - r); vg.lineTo(cx, cy + r); vg.moveTo(cx - r, cy); vg.lineTo(cx + r, cy);
      vg.moveTo(cx - r * 0.7, cy - r * 0.7); vg.lineTo(cx + r * 0.7, cy + r * 0.7); vg.moveTo(cx + r * 0.7, cy - r * 0.7); vg.lineTo(cx - r * 0.7, cy + r * 0.7); vg.stroke();
      vg.fillStyle = css('--dim'); vg.font = '9px Segoe UI'; vg.fillText('M', cx + 3, 10); vg.fillText('L', cx - r * 0.7 - 8, cy - r * 0.7); vg.fillText('R', cx + r * 0.7 + 3, cy - r * 0.7); vg.fillText('S', W - 10, cy - 3);
      if (ph.pts && eng.playing) {
        const [L, R] = ph.pts, n = L.length, step = Math.max(1, Math.floor(n / 1500)); vg.fillStyle = 'rgba(79,209,165,0.55)';
        for (let i = 0; i < n; i += step) { const m = (L[i] + R[i]) * Math.SQRT1_2, s = (R[i] - L[i]) * Math.SQRT1_2; vg.fillRect(cx + s * r, cy - m * r, 1.5, 1.5); }
      }
    },
  });
  AS.phaseMeter = ph; // (tests)

  /* ---------- Loudness Meter (live, ITU-R BS.1770-4 / EBU R128) ---------- */
  const lm = { meter: null, untap: null };
  P.register({
    id: 'loudness', title: 'Loudness Meter', dock: 'right', visible: false,
    build(b) {
      b.innerHTML = `<div class="lm-top"><select class="lm-t" title="Target"><option value="-23">EBU R128 (−23 LUFS)</option><option value="-24">ATSC A/85 (−24 LUFS)</option><option value="-16">Podcast (−16 LUFS)</option><option value="-14">Streaming (−14 LUFS)</option></select><button class="btn sm" data-a="reset" title="Start the measurement again">Reset</button></div>
        <canvas class="lm-bars" width="270" height="70"></canvas><table class="info kv lm-tab"></table><div class="np-note">What you hear (the master output), measured as ITU-R BS.1770-4 / EBU R128: Momentary 400 ms, Short-term 3 s, Integrated (gated), Loudness Range, True Peak (4× oversampled) and PLR.</div>`;
      $('[data-a="reset"]', b).onclick = () => { if (lm.meter) lm.meter.reset(); };
    },
    onShow() { if (!lm.untap && eng.ctx) lm.untap = eng.tapMaster((chs) => { if (!lm.meter || lm.meter.sr !== eng.ctx.sampleRate) lm.meter = new D.LoudnessMeter(eng.ctx.sampleRate, 2); lm.meter.push(chs.length > 1 ? chs : [chs[0], chs[0]]); }); },
    onHide() { if (lm.untap) { lm.untap(); lm.untap = null; } },
    tick() {
      const tab = $('.lm-tab', this.body); if (!tab) return; if (!lm.untap) this.onShow();
      const r = lm.meter ? lm.meter.readings() : null, tgt = +$('.lm-t', this.body).value, f = (v, u) => (isFinite(v) ? v.toFixed(1) + ' ' + u : '—');
      const sig = r ? [r.M, r.S, r.I, r.LRA, r.TP].map((v) => (isFinite(v) ? v.toFixed(1) : '-')).join('|') : '';
      if (sig !== this._sig) {
        this._sig = sig; const off = r && isFinite(r.I) ? r.I - tgt : NaN;
        tab.innerHTML = r ? `${row('Momentary', f(r.M, 'LUFS'))}${row('Short-term', f(r.S, 'LUFS'))}${row('Integrated', `<b style="color:${!isFinite(off) ? 'inherit' : Math.abs(off) <= 1 ? '#2fb67c' : '#e8a33a'}">${f(r.I, 'LUFS')}</b>${isFinite(off) ? ` (${off > 0 ? '+' : ''}${off.toFixed(1)} LU)` : ''}`)}${row('Loudness range', f(r.LRA, 'LU'))}${row('True peak (max)', `<span style="color:${r.TP > -1 ? '#e8503a' : 'inherit'}">${f(r.TP, 'dBTP')}</span>`)}${row('PLR', f(r.PLR, 'LU'))}${row('Max momentary / short-term', f(r.Mmax, '') + ' / ' + f(r.Smax, 'LUFS'))}${row('Measured', r.seconds.toFixed(1) + ' s')}` : row('Waiting', 'Play something…');
      }
      const cv = $('.lm-bars', this.body), g = cv.getContext('2d'), w = cv.width, h = cv.height, lo = -60, hi = 0, x = (v) => Math.max(0, Math.min(1, (v - lo) / (hi - lo))) * (w - 40);
      g.fillStyle = css('--wave-bg'); g.fillRect(0, 0, w, h);
      [['M', r && r.M], ['S', r && r.S], ['I', r && r.I]].forEach(([l, v], i) => { const y = 6 + i * 18; g.fillStyle = css('--dim'); g.font = '10px Segoe UI'; g.fillText(l, 4, y + 10); g.fillStyle = l === 'I' ? '#4fd1a5' : '#2d8ceb'; if (isFinite(v)) g.fillRect(16, y, x(v), 12); });
      g.fillStyle = '#e8a33a'; g.fillRect(16 + x(tgt) - 1, 2, 2, h - 14); g.fillStyle = css('--dim'); g.font = '9px Segoe UI'; for (const v of [-50, -40, -30, -20, -10, 0]) g.fillText(v, 16 + x(v) - 6, h - 2);
    },
  });
  AS.loudnessPanel = lm; // (tests)

  /* ---------- Diagnostics (scan → list → repair one / all) ---------- */
  const dg = { kind: 'declicker', items: [], scanned: false };
  P.register({
    id: 'diagnostics', title: 'Diagnostics', dock: 'right', visible: false,
    build(b) {
      b.innerHTML = `<div class="dg-top"><select class="dg-kind">${Object.entries(app.diag.KINDS).map(([k, v]) => `<option value="${k}">${esc(v.label)}</option>`).join('')}</select><button class="btn sm" data-a="set" title="Detection settings">Settings…</button><button class="btn sm primary" data-a="scan" title="Scan the selection (or the whole file)">Scan</button></div>
        <div class="dg-sum np-note"></div><div class="plist dg-list"></div><div class="dg-bot"><button class="btn sm" data-a="all"></button><button class="btn sm" data-a="clear">Clear</button></div>`;
      $('.dg-kind', b).onchange = (e) => { dg.kind = e.target.value; dg.items = []; dg.scanned = false; dg.range = null; this.refresh(); };
      b.addEventListener('click', async (e) => {
        const a = e.target.closest('[data-a]'), it = e.target.closest('[data-i]'), d = app.cur;
        if (!a && it && d) { const x = dg.items[+it.dataset.i]; d.sel = { a: x.s, b: Math.max(x.e, x.s + 1) }; const pad = Math.max(x.e - x.s, d.sr * 0.05); app.wave.ensureVisible(x.s); if (app.wave.visibleSamples() > (x.e - x.s + 2 * pad) * 20) { d.vs.spp = Math.max(1 / 16, (x.e - x.s + 2 * pad) / app.wave.W); d.vs.start = Math.max(0, x.s - pad); } app.selectionChanged(); return; }
        if (!a) return; if (!d) { UI.toast('Open a file first.'); return; }
        if (a.dataset.a === 'set') { if (await app.diag.settings(dg.kind)) this.scan(); return; }
        if (a.dataset.a === 'scan') { this.scan(true); return; }
        if (a.dataset.a === 'clear') { dg.items = []; dg.scanned = false; this.refresh(); return; }
        if (a.dataset.a === 'fix') { const i = +a.closest('[data-i]').dataset.i, it = dg.items[i]; if (app.diag.fix(dg.kind, [it])) { if (dg.kind === 'delsilence' && Array.isArray(dg.range)) dg.range[1] -= Math.max(0, it.e - it.s); this.scan(); } return; }
        if (a.dataset.a === 'all' && dg.items.length) { const n = dg.items.reduce((s, x) => s + x.e - x.s, 0); if (app.diag.fix(dg.kind, dg.items)) { if (dg.kind === 'delsilence' && Array.isArray(dg.range)) dg.range[1] -= n; this.scan(); } }
      });
    },
    /* fresh: a new scan of the selection / whole file; otherwise the same range again (clicking an item selects it) */
    scan(fresh) {
      const d = app.cur; if (!d) return;
      if (fresh || !dg.range) dg.range = d.hasSel() ? [d.sel.a, d.sel.b] : 'all';
      dg.items = app.diag.scan(dg.kind, null, dg.range === 'all' ? [0, d.len] : dg.range); dg.scanned = true; dg.doc = d.id + ':' + d.version; this.refresh();
    },
    refresh() {
      const list = $('.dg-list', this.body); if (!list) return; const d = app.cur, K = app.diag.KINDS[dg.kind];
      $('.dg-kind', this.body).value = dg.kind; const all = $('[data-a="all"]', this.body); all.textContent = K.act + ' All'; all.disabled = !dg.items.length;
      $('.dg-sum', this.body).textContent = !d ? 'No file open.' : !dg.scanned ? `Scan the ${d.hasSel() ? 'selection' : 'whole file'} for ${K.label === 'Mark Audio' ? 'audio regions' : K.label === 'Delete Silence' ? 'silences' : K.label === 'DeClipper' ? 'clipped peaks' : 'clicks and pops'}.` : `${dg.items.length} found.`;
      const chName = (c) => (c < 0 ? '' : d.ch.length === 2 ? (c ? ' · R' : ' · L') : ' · ch ' + (c + 1));
      list.innerHTML = d ? dg.items.slice(0, 500).map((x, i) => `<div class="fitem dg-it" data-i="${i}"><div class="fn">${i + 1}. ${fmt(x.s / d.sr)}${chName(x.ch)}</div><div class="fm">${fmt((x.e - x.s) / d.sr)}${x.info ? ' · ' + esc(x.info) : ''}</div><button class="sm" data-a="fix" title="${K.act} this one">${K.act}</button></div>`).join('') + (dg.items.length > 500 ? `<div class="empty">… ${dg.items.length - 500} more (Repair All handles them all)</div>` : '') : '';
    },
    tick() { const d = app.cur, sig = d ? d.id + ':' + d.version : ''; if (dg.scanned && dg.doc && sig !== dg.doc) { dg.items = []; dg.scanned = false; dg.doc = null; dg.range = null; this.refresh(); } },
  });
  AS.diagPanel = dg; // (tests)

  /* ---------- Playlist (range markers played in a chosen order) ---------- */
  P.register({
    id: 'playlist', title: 'Playlist', dock: 'left', visible: false,
    build(b) {
      b.innerHTML = `<div class="np-note">Range markers of the open file, played in this order (each as many times as Loops). Make a range marker: select, then press M.</div>
        <div class="pl-add"><select class="pl-sel"></select><button class="btn sm" data-a="add">Add</button><button class="btn sm" data-a="all" title="Add every range marker">Add all</button></div>
        <div class="plist pl-list"></div><div class="pl-play"><button class="btn sm primary" data-a="play">▶ Play playlist</button><button class="btn sm" data-a="stop">■ Stop</button></div>`;
      b.addEventListener('click', (e) => {
        const a = e.target.closest('[data-a]'); if (!a) return; const d = app.cur; if (!d) { UI.toast('Open a file first.'); return; }
        const i = +(a.closest('[data-i]') || { dataset: { i: -1 } }).dataset.i;
        if (a.dataset.a === 'add') { const id = $('.pl-sel', b).value; if (id) app.playlistEdit('Add to Playlist', (pl) => pl.push({ id, loops: 1 })); }
        else if (a.dataset.a === 'all') app.playlistEdit('Add to Playlist', (pl) => { for (const r of d.ranges()) pl.push({ id: r.id, loops: 1 }); });
        else if (a.dataset.a === 'up' && i > 0) app.playlistEdit('Reorder Playlist', (pl) => pl.splice(i - 1, 0, pl.splice(i, 1)[0]));
        else if (a.dataset.a === 'down') app.playlistEdit('Reorder Playlist', (pl) => { if (i < pl.length - 1) pl.splice(i + 1, 0, pl.splice(i, 1)[0]); });
        else if (a.dataset.a === 'del') app.playlistEdit('Remove from Playlist', (pl) => pl.splice(i, 1));
        else if (a.dataset.a === 'play') app.playPlaylist();
        else if (a.dataset.a === 'stop') AS.actions['tp.stop']();
      });
      b.addEventListener('change', (e) => { const l = e.target.closest('.pl-loops'); if (!l) return; const i = +l.closest('[data-i]').dataset.i, v = Math.max(1, Math.min(99, Math.round(+l.value) || 1)); app.playlistEdit('Playlist Loops', (pl) => { if (pl[i]) pl[i].loops = v; }); });
    },
    refresh() {
      const list = $('.pl-list', this.body), sel = $('.pl-sel', this.body); if (!list) return; const d = app.cur;
      if (!d) { list.innerHTML = '<div class="empty">No file open.</div>'; sel.innerHTML = ''; return; }
      const R = d.ranges(); sel.innerHTML = R.length ? R.map((r) => `<option value="${esc(r.id)}">${esc(r.name)}</option>`).join('') : '<option value="">(no range markers)</option>';
      const items = (d.playlist || []).map((p, i) => { const r = R.find((x) => x.id === p.id); return r ? `<div class="fitem pl-it" data-i="${i}"><div class="fn">${i + 1}. ${esc(r.name)}</div><div class="fm">${fmt((r.b - r.a) / d.sr)} · loops <input class="pl-loops" type="number" min="1" max="99" value="${p.loops || 1}"></div><span class="pl-btns"><button class="sm" data-a="up" title="Move up">↑</button><button class="sm" data-a="down" title="Move down">↓</button><button class="sm x" data-a="del" title="Remove">×</button></span></div>` : ''; }).join('');
      list.innerHTML = items || '<div class="empty">The playlist is empty.</div>';
      this._sig = d.id + ':' + JSON.stringify(d.playlist) + JSON.stringify(R);
    },
    tick() { const d = app.cur, sig = d ? d.id + ':' + JSON.stringify(d.playlist) + JSON.stringify(d.ranges()) : ''; if (sig !== this._sig) this.refresh(); },
  });

  /* ---------- Favorites ---------- */
  P.register({
    id: 'favorites', title: 'Favorites', dock: 'right', visible: false,
    build(b) {
      b.innerHTML = `<div class="fv-bar"><button class="btn sm" data-a="rec"></button><button class="btn sm" data-a="last" title="Save the last applied effect with its settings">Save last effect</button></div><div class="plist fv-list"></div>
        <div class="np-note">Click ▶ to apply a favorite to the selection (or the whole file / the selected clip). Favorites can also run in File &gt; Batch Process and get keys in Edit &gt; Keyboard Shortcuts.</div>`;
      b.addEventListener('click', async (e) => {
        const a = e.target.closest('[data-a]'); if (!a) return; const id = (a.closest('[data-f]') || { dataset: {} }).dataset.f, F = AS.favorites;
        if (a.dataset.a === 'rec') { if (F.recorder.active()) await app.favStop(); else app.favRecord(); }
        else if (a.dataset.a === 'last') await AS.actions['fav.fromLast']();
        else if (a.dataset.a === 'apply') await app.applyFavorite(id);
        else if (a.dataset.a === 'del') { const f = F.byId(id); const ok = await UI.dialog({ title: 'Delete Favorite', html: `<p>Delete “${esc(f.name)}”?</p>`, okLabel: 'Delete' }); if (ok) F.remove(id); }
        else if (a.dataset.a === 'ren') { const f = F.byId(id); const r = await UI.dialog({ title: 'Rename Favorite', fields: [{ id: 'name', label: 'Name', type: 'text', value: f.name }] }); if (r) F.rename(id, r.name.trim()); }
        this.refresh();
      });
    },
    refresh() {
      const el = $('.fv-list', this.body); if (!el) return; const F = AS.favorites, rec = F.recorder.active();
      const rb = $('[data-a="rec"]', this.body); rb.textContent = rec ? `■ Stop recording (${F.recorder.steps().length})` : '● Record'; rb.classList.toggle('danger', rec);
      el.innerHTML = F.all().map((f) => `<div class="fitem fv" data-f="${esc(f.id)}" title="${esc(f.steps.map((s, i) => i + 1 + '. ' + F.describe(s)).join('\n'))}"><div class="fn">${f.builtin ? '☆' : '★'} ${esc(f.name)}</div><div class="fm">${f.steps.length} step(s): ${esc(f.steps.map((s) => F.describe(s).replace(/ \(.*$/, '')).join(' → '))}</div>
        <span class="fv-btns"><button class="sm" data-a="apply" title="Apply">▶</button>${f.builtin ? '' : '<button class="sm" data-a="ren" title="Rename">✎</button><button class="sm x" data-a="del" title="Delete">×</button>'}</span></div>`).join('');
      this._sig = JSON.stringify(F.all()) + rec + F.recorder.steps().length; if (app.refreshKeys) app.refreshKeys();
    },
    tick() { const F = AS.favorites, sig = JSON.stringify(F.all()) + F.recorder.active() + F.recorder.steps().length; if (sig !== this._sig) this.refresh(); },
  });

  /* ---------- CD Layout (songs in order + gaps → CUE + WAV) ---------- */
  const cd = { title: 'My CD', performer: '', items: [], undo: [], redo: [] };
  const cdSnap = () => JSON.stringify({ title: cd.title, performer: cd.performer, items: cd.items.map((it) => ({ ...it, ch: undefined })) });
  const cdRefs = new Map(); // item key → {ch, sr} (audio is not copied into the undo history)
  function cdEdit(fn) { cd.undo.push({ s: cdSnap(), refs: new Map(cdRefs) }); if (cd.undo.length > 50) cd.undo.shift(); cd.redo = []; fn(); }
  function cdRestore(from, to) { const st = from.pop(); if (!st) return; to.push({ s: cdSnap(), refs: new Map(cdRefs) }); const j = JSON.parse(st.s); cd.title = j.title; cd.performer = j.performer; cdRefs.clear(); st.refs.forEach((v, k) => cdRefs.set(k, v)); cd.items = j.items.map((it) => ({ ...it, ...cdRefs.get(it.key) })); }
  let cdKey = 0;
  function cdAdd(d) { const key = 'k' + ++cdKey; cdRefs.set(key, { ch: d.ch, sr: d.sr }); cd.items.push({ key, docId: d.id, name: d.name.replace(/\.\w+$/, ''), title: d.name.replace(/\.\w+$/, ''), performer: '', gap: cd.items.length ? 2 : 0, ch: d.ch, sr: d.sr }); }
  const cdLen = (it) => { const d = app.docs.find((x) => x.id === it.docId); return d ? d.len / d.sr : it.ch[0].length / it.sr; };
  AS.cdLayout = { state: cd, add: (d) => cdEdit(() => cdAdd(d)), undo: () => cdRestore(cd.undo, cd.redo), redo: () => cdRestore(cd.redo, cd.undo) };
  P.register({
    id: 'cd', title: 'CD Layout', dock: 'left', visible: false,
    build(b) {
      b.innerHTML = `<div class="cd-meta"><input class="cd-title txt" placeholder="Album title"><input class="cd-perf txt" placeholder="Album performer"></div>
        <div class="cd-bar"><button class="btn sm" data-a="add" title="Add the current file">+ Current file</button><button class="btn sm" data-a="addall" title="Add every open file">+ All open</button><button class="btn sm" data-a="undo" title="Undo">↶</button><button class="btn sm" data-a="redo" title="Redo">↷</button></div>
        <div class="plist cd-list"></div><div class="cd-sum np-note"></div><div class="cd-bar"><button class="btn sm primary" data-a="export">Export CUE + WAV…</button></div>`;
      const meta = (k, el) => { el.addEventListener('focus', () => { el._before = el.value; }); el.addEventListener('change', () => { const v = el.value; el.value = el._before; cdEdit(() => { cd[k] = v; }); this.refresh(); }); };
      meta('title', $('.cd-title', b)); meta('performer', $('.cd-perf', b));
      b.addEventListener('click', async (e) => {
        const a = e.target.closest('[data-a]'); if (!a) return; const i = +((a.closest('[data-i]') || { dataset: { i: -1 } }).dataset.i);
        if (a.dataset.a === 'add') { if (!app.cur) { UI.toast('Open a file first.'); return; } cdEdit(() => cdAdd(app.cur)); }
        else if (a.dataset.a === 'addall') { if (!app.docs.length) { UI.toast('Open some files first.'); return; } cdEdit(() => app.docs.forEach(cdAdd)); }
        else if (a.dataset.a === 'up' && i > 0) cdEdit(() => cd.items.splice(i - 1, 0, cd.items.splice(i, 1)[0]));
        else if (a.dataset.a === 'down' && i < cd.items.length - 1) cdEdit(() => cd.items.splice(i + 1, 0, cd.items.splice(i, 1)[0]));
        else if (a.dataset.a === 'del') cdEdit(() => cd.items.splice(i, 1));
        else if (a.dataset.a === 'undo') AS.cdLayout.undo(); else if (a.dataset.a === 'redo') AS.cdLayout.redo();
        else if (a.dataset.a === 'export') { if (!cd.items.length) { UI.toast('Add songs to the CD layout first.'); return; } await app.exportCD(cd); }
        this.refresh();
      });
      b.addEventListener('change', (e) => { const f = e.target.closest('[data-f]'); if (!f) return; const i = +f.closest('[data-i]').dataset.i, k = f.dataset.f, v = k === 'gap' ? Math.max(0, Math.min(30, +f.value || 0)) : f.value; cdEdit(() => { cd.items[i][k] = v; }); this.refresh(); });
    },
    refresh() {
      const list = $('.cd-list', this.body); if (!list) return; $('.cd-title', this.body).value = cd.title; $('.cd-perf', this.body).value = cd.performer;
      let t = 0;
      list.innerHTML = cd.items.map((it, i) => { t += (+it.gap || 0); const start = t; t += cdLen(it); return `<div class="fitem cd-it" data-i="${i}"><div class="fn">${String(i + 1).padStart(2, '0')}. <input class="txt cd-t" data-f="title" value="${esc(it.title)}" title="Track title (CD-Text)"></div>
        <div class="fm">${fmt(start)} · ${fmt(cdLen(it))} · gap <input class="cd-gap" data-f="gap" type="number" min="0" max="30" step="0.5" value="${it.gap}"> s <input class="txt cd-p" data-f="performer" placeholder="performer" value="${esc(it.performer)}"></div>
        <span class="cd-btns"><button class="sm" data-a="up" title="Move up">↑</button><button class="sm" data-a="down" title="Move down">↓</button><button class="sm x" data-a="del" title="Remove">×</button></span></div>`; }).join('') || '<div class="empty">Add songs from the open files.</div>';
      $('.cd-sum', this.body).textContent = cd.items.length ? `${cd.items.length} track(s), ${fmt(t)} of ${fmt(AS.cd.MAX_SECONDS)}${t > AS.cd.MAX_SECONDS ? ' — too long for an 80-minute CD!' : ''}. Exported as 16-bit / 44.1 kHz stereo WAV + CUE sheet (burn with any program that reads CUE).` : '';
      $('[data-a="undo"]', this.body).disabled = !cd.undo.length; $('[data-a="redo"]', this.body).disabled = !cd.redo.length;
    },
  });

  /* ---------- Window menu ---------- */
  const winActions = {
    'win.editor': () => app.setMode('wave'),
    'win.multi': () => app.setMode('multi'),
    'win.reset': () => { P.resetLayout(); UI.toast('Panel layout reset.'); },
    'win.ws.save': () => WS.saveDialog(), 'win.ws.edit': () => WS.editDialog(),
    'win.ws.reset': () => { WS.reset(); UI.toast(`Workspace “${WS.byId(WS.current()).name}” reset to its saved layout.`); },
  };
  /* Window > Workspace (workspaces.js): ws:<id> switches */
  const WS = AS.workspaces;
  WS.init({ panels: P, mode: () => app.mode, setMode: app.setMode, spec: () => app.specMode, setSpec: app.setSpec });
  AS.winActions = winActions;
  P.setMenu([
    { label: 'Workspace', items: () => WS.menuItems() }, '-',
    { label: 'Editor', id: 'win.editor', checked: () => app.mode === 'wave' }, { label: 'Multitrack', id: 'win.multi', checked: () => app.mode === 'multi' }, '-',
    { panel: 'cd' }, { panel: 'diagnostics' }, { panel: 'effects' }, { panel: 'rack' }, { panel: 'essential' }, { panel: 'favorites' }, { panel: 'files' }, { panel: 'history' }, { panel: 'levels' }, { panel: 'loudness' }, { panel: 'markers' }, { panel: 'match' }, { panel: 'media' },
    { panel: 'metadata' }, { panel: 'mixer' }, { panel: 'phase' }, { panel: 'playlist' }, { panel: 'props' }, { panel: 'selview' }, { panel: 'spectrum' }, { panel: 'video' }, '-',
    { panel: 'statusbar' }, { panel: 'timedisp' }, { panel: 'tools' }, { panel: 'transport' }, '-',
    { label: 'Amplitude Statistics…', id: 'an.stats' }, { label: 'Frequency Analysis…', id: 'an.freq' }, '-',
    { label: 'Reset to Default Layout', id: 'win.reset' },
  ]);
  P.refreshAll();
  if (app.refreshKeys) app.refreshKeys(); // shortcuts the user gave to Window menu items
})(window);

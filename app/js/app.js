/* AudioStage application controller. */
(function () {
  'use strict';
  const AS = window.AS, D = AS.dsp, E = AS.effects, UI = AS.ui, eng = AS.engine, fmtTime = AS.fmtTime;
  const $ = (s) => document.querySelector(s);
  const TF = ['time', 'samples', 'smpte', 'bars']; let tfi = 0; // time display formats (declared first: the views use them while drawing)

  const app = {
    docs: [], cur: null, mode: 'wave', specMode: false, session: new AS.Session(), selTrack: null, loop: false,
    clipboard: null, clipClip: null, noiseProfile: null, lastFx: null, multiCursor: 0, playDoc: null, playOrigin: 0, recording: null, peakHold: [0, 0], holdT: [0, 0],
    playSample(d) { if (eng.playing && this.mode === 'wave' && this.playDoc === d) return D.clamp(Math.round(eng.pos() * d.sr), 0, d.len); return d.sel.a; },
    multiPos() { return eng.playing && this.mode === 'multi' ? eng.pos() : this.multiCursor; },
    /* tempo of what is being edited: the session in Multitrack, the file in the Waveform editor */
    tempo() { return AS.tempo.norm(this.mode === 'multi' ? this.session.opts.tempo : (this.cur && this.cur.tempo) || null); },
    timeFormat() { return TF[tfi]; },
    formatTime(sec) { return fmtDisp(sec); }, // the transport time display text for a position
    selectionChanged() { updateInfo(); wave.draw(); },
    cursorMoved(user) {
      updateInfo(); wave.draw();
      if (user && eng.playing && this.mode === 'wave' && this.cur === this.playDoc) playWave();
    },
    hover(s, y, v) {
      const d = v.doc, lane = Math.min(d.ch.length - 1, Math.floor(y / (v.H / d.ch.length))), val = d.ch[lane][Math.min(d.len - 1, Math.floor(s))] || 0;
      if (v.mode === 'spec') { status(`${fmtTime(s / d.sr)}   ${Math.round(v.y2f(y))} Hz` + (d.spec ? '   ·   ' + AS.spectral.describe(d.spec, d.sr) : '')); return; }
      status(`${fmtTime(s / d.sr)}   sample ${Math.floor(s)}   level ${val === 0 ? '-∞' : D.toDb(Math.abs(val)).toFixed(1)} dB`);
    },
    seekMulti(t) { if (this.recording) return; this.multiCursor = t; if (eng.playing && this.mode === 'multi') playMulti(t); else multi.draw(); },
    multiChanged(commit) {
      updateInfo(); multi.baseKey = null; // static layer is stale; the next frame re-renders it
      // (never while recording: a rebuild would put a gap into what the performer hears; changes apply after)
      if (this.mode === 'multi' && eng.playing && !this.recording && (commit === true || (commit === undefined && !multi.drag))) {
        clearTimeout(this._mt); this._mt = setTimeout(() => { if (eng.playing && this.mode === 'multi') playMulti(eng.pos()); }, 120);
      }
    },
    clipProperties,
    specChanged() { status(this.cur && this.cur.spec ? AS.spectral.describe(this.cur.spec, this.cur.sr) : 'Ready'); },
    harmonicsAt(s, f) { return harmonicsAt(s, f); }, spotHeal() { return spotHeal(); },
    openRack(target) { return openRack(target); },
  };
  window.app = app;
  app.rackTarget = null;
  /* sidechain "key input" choices for an effect owned by cx.ownerId (only routes that cannot loop) */
  AS.rack.sidechainOptions = (cx) => (cx && cx.ownerId ? AS.routing.sidechainOptions(app.session, cx.ownerId, cx.current) : [['', 'None (own input)']]);
  const wave = new AS.WaveView($('#waveMode'), app);
  const multi = new AS.MultiView($('#multiMode'), app);
  app.wave = wave; app.multi = multi;
  const status = (m) => { $('#statusMsg').textContent = m; };

  /* ================= Documents ================= */
  // undo memory limit (engine.js Doc.undoBudget): say once per file when old steps had to go
  AS.Doc.onTrim = (d) => { if (d.trimNoted) return; d.trimNoted = true; UI.toast(`Older undo steps of “${d.name}” were removed to keep memory use within the undo limit.`); };
  function addDoc(name, sr, ch) {
    const d = new AS.Doc(name, sr, ch); AS.welcome.hide();
    app.docs.push(d); setCurrent(d); return d;
  }
  function setCurrent(d) {
    if (eng.playing) stop(false);
    app.cur = d; wave.setDoc(d); updateFiles(); updateInfo(); updateVideo();
  }
  async function closeDoc(d, force) {
    if (!d) return;
    if (d.dirty && !force) {
      const r = await UI.dialog({ title: 'Close File', html: `<p>“${UI.esc(d.name)}” has unsaved changes. Close anyway?</p>`, okLabel: 'Close without saving' });
      if (!r) return;
    }
    if (app.playDoc === d) stop(false);
    const i = app.docs.indexOf(d); app.docs.splice(i, 1);
    setCurrent(app.docs[Math.max(0, i - 1)] || null);
  }
  /* File -> {sr, ch, markers?, cart?, bext?} (own WAV reader first, then the system decoder) */
  async function decodeFile(f, pre) {
    const buf = pre || (await f.arrayBuffer());
    let res = null;
    if (/\.(wav|wave)$/i.test(f.name)) { try { res = AS.wav.decodeWav(buf); } catch (e) { res = null; } }
    try { res && (res.tags = AS.tags.read(new Uint8Array(buf))); } catch (e) { /* no tags */ }
    if (!res) {
      eng.init();
      const ab = await eng.ctx.decodeAudioData(buf.slice(0));
      res = { sr: ab.sampleRate, ch: Array.from({ length: ab.numberOfChannels }, (_, i) => ab.getChannelData(i).slice()), tags: AS.tags.read(new Uint8Array(buf)) };
    }
    if (pre) res.buf = buf; // (a file read from disk in pieces: kept for the video preview)
    return res;
  }
  /* files: File objects, or files read from disk only now, one at a time (AS.disk.lazyFile: File > Open, recent
     files, files from Windows) — so opening many large files never holds them all in memory at once */
  async function openFiles(files) {
    let stopAll = false;
    for (const f of files) {
      if (stopAll) break;
      const ctl = { aborted: false };
      try {
        await UI.busy('Opening ' + f.name + '…', async () => {
          const pre = f.lazy ? await f.arrayBuffer({ signal: ctl, onProgress: (a, n) => UI.busyMsg(`Reading ${f.name}… ${Math.round((100 * a) / Math.max(1, n))} %`) }) : null;
          const res = await decodeFile(f, pre);
          const nd = addDoc(f.name, res.sr, res.ch);
          if (res.bits) nd.bits = res.bits;
          nd.path = f.asPath || (window.audioStageRecent ? window.audioStageRecent.pathOf(f) : '') || ''; nd.savable = !!f.asPath; // Save writes back there (files opened through the app)
          if (/^video\//.test(f.type) || /\.(mp4|mov|mkv|webm|m4v)$/i.test(f.name)) { nd.videoUrl = URL.createObjectURL(f.lazy ? new Blob([res.buf]) : f); updateVideo(); }
          res.buf = null;
          if (res.markers && res.markers.length) { nd.markers = res.markers; updateMarkers(); }
          nd.meta = AS.tags.clean({ title: (res.cart && res.cart.title) || (res.bext && res.bext.description) || '', artist: (res.cart && res.cart.artist) || '', ...(res.tags || {}) }); // kept, so saving again keeps the tags
        }, f.lazy ? () => { ctl.aborted = true; stopAll = true; } : undefined);
        AS.recent.note('files', f); // File > Open Recent
      } catch (e) { if (e && e.cancelled) { UI.toast('Opening cancelled.'); stopAll = true; } else UI.toast(`Cannot open “${f.name}”: ${e.message || 'unsupported format'}`, 'error'); }
    }
    if (app.mode === 'multi') setMode('wave');
  }
  function updateFiles() {
    const el = $('#fileList');
    if (!app.docs.length) { el.innerHTML = '<div class="empty">No files open.<br>File &gt; Open… or drop audio here.</div>'; }
    else el.innerHTML = app.docs.map((d) => `<div class="fitem ${d === app.cur ? 'cur' : ''}" data-id="${d.id}" title="Double-click: insert into multitrack"><div class="fn">${UI.esc(d.name)}${d.dirty ? ' *' : ''}</div><div class="fm">${fmtTime(d.dur)} · ${d.sr / 1000} kHz · ${d.ch.length === 1 ? 'Mono' : d.ch.length === 2 ? 'Stereo' : d.ch.length + ' ch'}</div><button class="sm x" data-x="${d.id}" title="Close">×</button><button class="sm ins" data-i="${d.id}" title="Insert into multitrack">⊕</button></div>`).join('');
    updateMarkers();
  }
  $('#fileList').addEventListener('click', (e) => {
    const x = e.target.closest('[data-x]'), ins = e.target.closest('[data-i]'), it = e.target.closest('.fitem');
    if (x) return closeDoc(app.docs.find((d) => d.id == x.dataset.x));
    if (ins) return insertDocIntoMulti(app.docs.find((d) => d.id == ins.dataset.i));
    if (it) { setCurrent(app.docs.find((d) => d.id == it.dataset.id)); if (app.mode === 'multi') setMode('wave'); }
  });
  $('#fileList').addEventListener('dblclick', (e) => { const it = e.target.closest('.fitem'); if (it) insertDocIntoMulti(app.docs.find((d) => d.id == it.dataset.id)); });
  /* Markers panel: point markers and range markers (M with a selection), click = go there / select the range,
     double-click = rename, × = delete (all undoable) */
  function updateMarkers() {
    const el = $('#markerList'), d = app.cur;
    if (!d || !d.markers.length) { el.innerHTML = '<div class="empty">No markers.<br>Press M to add one (with a selection: a range marker).</div>'; return; }
    el.innerHTML = d.markerIds().slice().sort((a, b) => a.t - b.t).map((m) => `<div class="fitem mk ${m.d > 0 ? 'range' : ''}" data-id="${m.id}"><div class="fn">${m.d > 0 ? '▭ ' : ''}${UI.esc(m.name)}</div><div class="fm">${fmtTime(m.t / d.sr)}${m.d > 0 ? ' · ' + fmtTime(m.d / d.sr) : ''}</div><button class="sm x" data-del="${m.id}" title="Delete marker">×</button></div>`).join('')
      + (d.ranges().length ? '<div class="mk-tools"><button class="sm" data-a="exportRanges" title="Save every range marker as its own file">Export Ranges…</button> <button class="sm" data-a="playlist" title="Play range markers in an order you choose">Playlist…</button></div>' : '');
  }
  const markerById = (d, id) => d.markerIds().find((m) => m.id === id);
  $('#markerList').addEventListener('click', (e) => {
    const d = app.cur; if (!d) return;
    const del = e.target.closest('[data-del]'), it = e.target.closest('.mk'), tool = e.target.closest('[data-a]');
    if (tool) { if (tool.dataset.a === 'exportRanges') exportRangesDlg(); else AS.panels.show('playlist', { focus: true }); return; }
    if (del) { d.setMeta('Delete Marker', (x) => { x.markers = x.markers.filter((m) => m.id !== del.dataset.del); x.playlist = (x.playlist || []).filter((p) => p.id !== del.dataset.del); }); updateMarkers(); wave.draw(); return; }
    if (it) { const m = markerById(d, it.dataset.id); if (!m) return; d.sel = { a: m.t, b: m.d > 0 ? Math.min(d.len, m.t + m.d) : m.t }; wave.ensureVisible(d.sel.a); app.cursorMoved(); }
  });
  $('#markerList').addEventListener('dblclick', async (e) => {
    const it = e.target.closest('.mk'), d = app.cur; if (!it) return;
    const m = markerById(d, it.dataset.id); if (!m) return;
    const r = await UI.dialog({ title: 'Rename Marker', fields: [{ id: 'name', label: 'Name', type: 'text', value: m.name }] });
    if (r) { d.setMeta('Rename Marker', (x) => { const mm = x.markers.find((q) => q.id === m.id); if (mm) mm.name = r.name; }); updateMarkers(); wave.draw(); }
  });

  /* ================= Info panels ================= */
  function updateInfo() {
    const d = app.cur;
    const set = (id, v) => { $(id).textContent = v; };
    if (app.mode === 'multi') {
      set('#iSelB', '—'); set('#iSelE', '—'); set('#iSelL', '—'); set('#iVwB', fmtTime(multi.t0)); set('#iVwE', fmtTime(multi.t0 + multi.W / multi.pps)); set('#iVwL', fmtTime(multi.W / multi.pps));
      $('#fmtInfo').textContent = `Session · ${app.session.tracks.length} tracks · ${fmtTime(app.session.duration)}`;
      return;
    }
    if (!d) { for (const i of ['#iSelB', '#iSelE', '#iSelL', '#iVwB', '#iVwE', '#iVwL']) set(i, '—'); $('#fmtInfo').textContent = ''; return; }
    const sa = d.sel.a / d.sr, sb = d.sel.b / d.sr;
    set('#iSelB', fmtDisp(sa)); set('#iSelE', d.hasSel() ? fmtDisp(sb) : '—'); set('#iSelL', d.hasSel() ? fmtDisp(sb - sa) : '—');
    const vs = d.vs.start / d.sr, vl = (wave.W * d.vs.spp) / d.sr;
    set('#iVwB', fmtDisp(vs)); set('#iVwE', fmtDisp(Math.min(d.dur, vs + vl))); set('#iVwL', fmtDisp(Math.min(d.dur, vl)));
    $('#fmtInfo').textContent = `${d.sr} Hz · ${d.ch.length === 1 ? 'Mono' : d.ch.length === 2 ? 'Stereo' : d.ch.length + ' ch'} · 32-bit float · ${fmtTime(d.dur)}`;
  }

  /* ================= Mode ================= */
  function setMode(m) {
    if (eng.playing) stop(false);
    app.mode = m;
    $('#waveMode').hidden = m !== 'wave'; $('#multiMode').hidden = m !== 'multi'; $('#mtTools').hidden = m !== 'multi';
    document.querySelectorAll('#modeSwitch button').forEach((b) => b.classList.toggle('on', b.dataset.mode === m));
    $('#specToggle').style.display = m === 'wave' ? '' : 'none';
    if (m === 'wave') wave.resize(); else { multi.rebuildHeads(); multi.resize(); }
    updateInfo(); updateVideo();
  }
  document.querySelectorAll('#modeSwitch button').forEach((b) => b.onclick = () => setMode(b.dataset.mode));
  document.querySelectorAll('#viewSwitch button').forEach((b) => b.onclick = () => setSpec(b.dataset.v === 'spec'));
  function setSpec(on) {
    app.specMode = on; wave.setMode(on ? 'spec' : 'wave');
    $('#specTools').classList.toggle('show', on);
    document.querySelectorAll('#viewSwitch button').forEach((b) => b.classList.toggle('on', (b.dataset.v === 'spec') === on));
  }

  /* ================= Playback ================= */
  function playWave() {
    const d = app.cur; if (!d || !d.len) return;
    if (app.skipSel && d.hasSel() && !app.loop) { // Skip Selection: from the pre-roll before the selection to the end, jumping over it
      playSegs(d, AS.playx.skipSegments(d.len, d.sel, Math.max(0, d.sel.a - Math.round(EDS.preRoll * d.sr))), 'Skip Selection: playback jumps over the selection.'); return;
    }
    let a, b;
    if (d.hasSel()) { a = d.sel.a; b = d.sel.b; } else { a = d.sel.a >= d.len ? 0 : d.sel.a; b = d.len; }
    const t0 = eng.prepare(), src = eng.ctx.createBufferSource(); setOutChannels();
    src.buffer = d.audioBuffer(); src.connect(eng.master);
    const sr = d.sr;
    if (app.loop) { src.loop = true; src.loopStart = (d.hasSel() ? a : 0) / sr; src.loopEnd = (d.hasSel() ? b : d.len) / sr; src.start(t0, a / sr); }
    else src.start(t0, a / sr, (b - a) / sr);
    src.onended = () => { if (eng.sources[0] === src) stop(true); };
    const loopLen = app.loop ? ((d.hasSel() ? b : d.len) - (d.hasSel() ? a : 0)) / sr : 0;
    eng.begin([src], t0, a / sr, b / sr, loopLen);
    eng.loopStartSec = app.loop ? (d.hasSel() ? a : 0) / sr : 0;
    app.playDoc = d; app.playOrigin = d.sel.a; updatePlayBtn(); startMetro();
  }
  /* multitrack transport. delay: seconds before the start (metronome count-in). With Loop on and a time selection the
     selection loops (playMultiLoop). While recording the transport runs even in an empty session. */
  const monitorInput = () => (eng.input && app.session.tracks.some((t) => t.arm && t.monitor) ? eng.input.src : null);
  function playMulti(from, delay, countIn) {
    if (from === undefined) from = app.multiCursor;
    const s = app.session, end = s.duration, rg = multi.range;
    if (app.loop && rg && rg.b - rg.a > 0.05 && !(app.recording && app.recording.punch)) return playMultiLoop(rg.a, rg.b, delay, countIn);
    if (end <= 0 && !app.recording) { UI.toast('Nothing to play — insert a file into the multitrack session first.'); return; }
    if (from >= end && !app.recording) from = 0;
    stopIdleMonitor();
    const t0 = eng.prepare() + (delay || 0); setOutChannels();
    const sources = AS.buildGraph(eng.ctx, eng.master, s, from, t0, null, monitorInput());
    eng.begin(sources, t0, from, Math.max(end, from), 0); app.multiEnd = app.recording ? Infinity : end; app.loopPass = null; updatePlayBtn(); startMetro(countIn);
    // end of the session: stop (or start over with Loop on) — on a timer, so it also works while the window is minimised
    const timer = setInterval(() => { const p = eng.pos(); if (!eng.playing) { clearInterval(timer); return; } if (p > app.multiEnd - 0.01 && !app.recording) { clearInterval(timer); if (app.loop) playMulti(app.multiOrigin || 0); else stop(true); } }, 25);
    eng.onStop = () => { clearInterval(timer); eng.onStop = null; };
  }
  /* loop the time selection [a, b): pass k plays at t0 + k·L; each pass's graph is built ~0.5 s before it starts
     (effect tails ring into the next pass). Old passes are released; pass 0 keeps the input monitoring. */
  function playMultiLoop(a, b, delay, countIn) {
    stopIdleMonitor();
    const L = b - a, t0 = eng.prepare() + (delay || 0), passes = []; setOutChannels();
    const build = (k) => {
      passes.push(AS.buildGraph(eng.ctx, eng.master, app.session, a, t0 + k * L, b, k === 0 ? monitorInput() : null));
      while (passes.length > 4) { for (const n of passes.splice(1, 1)[0]) { try { if (n.stop) n.stop(); } catch (e) { /* */ } try { n.disconnect(); } catch (e) { /* */ } } }
      eng.sources = passes.flat();
    };
    build(0); let k = 0;
    eng.begin(passes.flat(), t0, a, b, L); eng.loopStartSec = a;
    const timer = setInterval(() => { if (!eng.playing) { clearInterval(timer); return; } if (eng.ctx.currentTime > t0 + (k + 1) * L - 0.5) build(++k); }, 100);
    eng.onStop = () => { clearInterval(timer); eng.onStop = null; };
    app.multiEnd = Infinity; app.loopPass = { a, L, t0 }; updatePlayBtn(); startMetro(countIn);
  }
  /* input monitoring while the transport is stopped: a clip-less graph that only carries the monitored input */
  let idleMon = null;
  function stopIdleMonitor() { if (!idleMon) return; for (const n of idleMon) { try { n.disconnect(); } catch (e) { /* */ } } idleMon = null; }
  function startIdleMonitor() {
    stopIdleMonitor(); const inp = monitorInput(); if (!inp || eng.playing || app.mode !== 'multi') return;
    idleMon = AS.buildGraph(eng.ctx, eng.master, app.session, 1e9, eng.ctx.currentTime, 1e9, inp);
  }
  app.updateMonitoring = async () => { // a track's input-monitor / arm button changed
    if (app.session.tracks.some((t) => t.arm && t.monitor)) { try { await eng.openInput(); } catch (e) { UI.toast('Cannot open the audio input: ' + (e.message || e), 'error'); return; } }
    else if (!eng.rec) { stopIdleMonitor(); eng.closeInput(); }
    if (eng.playing) { if (!app.recording) playMulti(eng.pos()); } else startIdleMonitor();
  };
  async function play() {
    eng.init(); if (app.mode === 'wave') { playWave(); return; }
    if (AS.cstretch.missing(app.session).length) { try { await UI.busy('Rendering time-stretched clips…', () => AS.cstretch.ensureAll(app.session)); } catch (e) { reportErr(e); return; } multi.draw(); }
    app.multiOrigin = app.multiCursor; playMulti(app.multiCursor);
  }
  /* a clip's stretch / pitch changed: render the new audio in the background, then redraw and rebuild playback */
  app.stretchChanged = (c) => {
    multi.draw(); if (!AS.cstretch.isOn(c) || AS.cstretch.play(c)) { app.multiChanged(true); return Promise.resolve(); }
    status('Rendering time-stretch…');
    return AS.cstretch.ensure(c).then(() => { status('Time-stretch ready.'); multi.draw(); app.multiChanged(true); }, (e) => reportErr(e));
  };
  app.status = (m) => status(m);
  function stop(toOrigin) {
    const was = eng.playing; const p = eng.pos();
    eng.stop(); stopMetro(); app.loopPass = null; shuttleRate = 0;
    if (app.recording) app.recDone = finishRecording();
    if (app.mode === 'multi') startIdleMonitor();
    if (was) {
      if (app.mode === 'multi') app.multiCursor = toOrigin ? app.multiOrigin || 0 : p === null ? app.multiCursor : p;
      else if (app.playDoc && app.playDoc === app.cur && !toOrigin && p !== null && !app.playDoc.hasSel()) app.playDoc.sel = { a: D.clamp(Math.round(p * app.playDoc.sr), 0, app.playDoc.len), b: D.clamp(Math.round(p * app.playDoc.sr), 0, app.playDoc.len) };
    }
    updatePlayBtn(); wave.draw(); multi.draw(); updateInfo();
  }
  function togglePlay() { if (eng.playing) stop(true); else play(); }
  function pause() { if (eng.playing) stop(false); }
  function updatePlayBtn() { $('#bPlay').classList.toggle('on', eng.playing); $('#bLoop').classList.toggle('on', app.loop); $('#bRec').classList.toggle('on', !!app.recording); }

  /* ---- recording ----
     The capture's context times are exact (audio-thread recorder), so the audio is placed from the transport map
     (ctx time t0 plays timeline `from`) minus the round-trip latency setting:
       normal     from the record position to the end
       punch      Transport > Punch In/Out + a time selection: transport starts pre-roll before the selection, only
                  [a, b) is kept (overwriting what was there), and it stops by itself post-roll after b
       loop       Loop on + a time selection: every pass becomes a take of one clip (comp them afterwards)
     Count-in: the transport (and the kept audio) starts that many bars later. opts.input: record a node (tests). */
  const RS_KEY = 'as-recording', RS = (() => { try { return { preRoll: 2, postRoll: 1, latencyMs: 0, ...(JSON.parse(localStorage.getItem(RS_KEY)) || {}) }; } catch (e) { return { preRoll: 2, postRoll: 1, latencyMs: 0 }; } })();
  const saveRS = () => { try { localStorage.setItem(RS_KEY, JSON.stringify(RS)); } catch (e) { /* */ } };
  app.recSettings = RS;
  async function toggleRecord(opts) {
    if (app.recording) { stop(app.mode === 'wave'); return; }
    const multiMode = app.mode === 'multi', rg = multi.range, hasRange = multiMode && rg && rg.b - rg.a > 0.05;
    const punch = hasRange && app.punch ? { a: rg.a, b: rg.b } : null, looped = hasRange && !punch && app.loop;
    try {
      const bars = MS.on ? MS.countIn : 0, countIn = bars * AS.tempo.barLen(app.tempo());
      const recStart = multiMode ? (punch ? punch.a : looped ? rg.a : app.multiCursor) : 0;
      app.recording = { mode: app.mode, start: recStart, punch, trackId: app.selTrack, clipped: false, t0: performance.now() + countIn * 1000 };
      eng.init(); const rec0 = app.recording;
      rec0.spool = AS.recSpool.start(ST, { sr: eng.ctx.sampleRate, nch: 2, name: multiMode ? 'Recording.wav' : 'Recording ' + (app.docs.length + 1) + '.wav' }); // written to disk while recording (G9)
      await eng.startRecord({ input: opts && opts.input, onChunk: (d) => { if (d.ch) rec0.spool.push(d.ch); if (d.peak >= 0.999 && app.recording && !app.recording.clipped) { app.recording.clipped = true; status('⚠ Input is clipping — lower the input level.'); multi.rebuildHeads(); } } });
      if (multiMode) {
        app.multiOrigin = app.multiCursor;
        const from = punch ? Math.max(0, punch.a - RS.preRoll) : recStart;
        playMulti(from, countIn, bars);
        app.recording.map = { t0: eng.t0, from };
        if (app.loopPass) app.recording.loop = { ...app.loopPass };
        if (punch) { // auto-stop after the post-roll — on a timer, not the animation loop (that pauses when minimised)
          const rec = app.recording; rec.stopAt = punch.b + RS.postRoll;
          rec.timer = setInterval(() => { if (app.recording !== rec) { clearInterval(rec.timer); return; } const p = eng.pos(); if (p !== null && p >= rec.stopAt) { clearInterval(rec.timer); stop(false); } }, 20);
        }
      } else {
        const t0 = eng.ctx.currentTime + 0.05 + countIn; app.recording.map = { t0, from: 0 };
        if (MS.on) { stopMetro(); metro = AS.metronome.start(eng.ctx, eng.ctx.destination, app.tempo(), { t0, from: 0 }, { countIn: bars }); }
      }
      updatePlayBtn(); multi.rebuildHeads();
      status((bars ? `Count-in ${bars} bar(s)… ` : '') + (punch ? `Punch recording ${fmtTime(punch.a)}–${fmtTime(punch.b)}` : app.recording.loop ? 'Loop recording: every pass becomes a take' : 'Recording…') + ' — press Stop to finish.');
    } catch (e) { if (app.recording && app.recording.spool) app.recording.spool.stop(); app.recording = null; UI.toast('Cannot record: ' + (e.message || e), 'error'); }
  }
  /* finished takes: their disk backup is deleted once an autosave has the take too (or at the next normal start) */
  const doneSpools = [];
  async function finishRecording() {
    const r = app.recording; app.recording = null; stopMetro();
    const data = await eng.stopRecord(app.session.tracks.some((t) => t.arm && t.monitor));
    if (r.spool) { if (data && data.ch[0].length) { r.spool.flush(); doneSpools.push(r.spool); } else r.spool.stop(); }
    multi.rebuildHeads();
    if (!data || !data.ch[0].length) return;
    const lat = (RS.latencyMs || 0) / 1000, sr = data.sr, R = AS.rec;
    const warn = r.clipped ? ' ⚠ The input clipped during this recording.' : '';
    if (r.mode === 'wave') {
      const ch = R.window(data.ch, sr, data.startTime, r.map.t0, Infinity, lat);
      if (ch[0].length) { const nd = addDoc('Recording ' + (app.docs.length + 1) + '.wav', sr, ch); keepRecording(nd.name, ch, sr); }
      status('Recording finished.' + warn); return;
    }
    const ss = app.session, tr = ss.tracks.find((t) => t.arm && t.type !== 'bus') || ss.tracks.find((t) => t.id === r.trackId && t.type !== 'bus') || ss.audioTrackAt(0);
    ss.push();
    if (r.loop) {
      const takes = R.passes(data.ch, sr, data.startTime, r.loop.t0, r.loop.L, lat);
      if (!takes.length) { ss.undoStack.pop(); UI.toast('The loop was not recorded long enough for a take.'); return; }
      const c = ss.addClip(tr, AS.makeSource('Recording', sr, takes[takes.length - 1]), r.loop.a, { name: takes.length > 1 ? `Recording (${takes.length} takes)` : 'Recording' });
      if (takes.length > 1) { c.takes = takes.map((ch, i) => ({ name: 'Take ' + (i + 1), src: AS.makeSource('Take ' + (i + 1), sr, ch) })); c.comp = [{ from: 0, to: r.loop.L, take: takes.length - 1 }]; }
      ss.place(tr, c);
    } else if (r.punch) {
      const ch = R.timelineRange(data.ch, sr, data.startTime, r.map, r.punch.a, r.punch.b, lat);
      const c = ss.addClip(tr, AS.makeSource('Punch-in', sr, ch), r.punch.a);
      ss.cutUnder(tr, c); // a punch replaces what was there
    } else {
      const ch = R.timelineRange(data.ch, sr, data.startTime, r.map, r.start, Infinity, lat);
      if (!ch[0].length) { ss.undoStack.pop(); return; }
      ss.place(tr, ss.addClip(tr, AS.makeSource('Recording', sr, ch), r.start)); keepRecording('Recording', ch, sr);
    }
    multi.rebuildHeads(); multi.resize(); updateInfo();
    status('Recording finished' + (r.loop ? ` (${(tr.clips[tr.clips.length - 1].takes || [1]).length} take(s) — right-click the clip to choose or comp takes)` : '.') + warn);
  }
  app.toggleRecord = toggleRecord;
  /* Preferences > Recording > Save recordings to: each recording is also written there as a 32-bit float WAV (desktop) */
  async function keepRecording(name, ch, sr) {
    const dir = AS.prefs.get('rec.folder'); if (!dir || !window.audioStageFiles) return;
    const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19), file = `${name.replace(/\.wav$/i, '')} ${stamp}.wav`;
    const r = await window.audioStageFiles.write(dir, file, new Uint8Array(AS.wav.encodeWav(ch, sr, 32, true)));
    if (!r.ok) UI.toast('The recording could not be saved to ' + dir + ': ' + r.error, 'error'); else app.lastKeptRecording = r.path;
  }
  /* round-trip latency: play test clicks through `output` and record `input` (default: speakers / audio input) */
  async function measureLatency(o) {
    const oo = o || {}; eng.init(); await eng.wl; await eng.ctx.resume();
    const ctx = eng.ctx, input = oo.input || (await eng.openInput()), output = oo.output || ctx.destination, rec = eng.recorder(1);
    input.connect(rec.node); await new Promise((r) => setTimeout(r, 300));
    const t = ctx.currentTime + 0.3, clicks = [0, 0.6, 1.2, 1.8, 2.4].map((k) => t + k);
    for (const c of clicks) AS.metronome.click(ctx, output, c, true, 'click', 0.7);
    await new Promise((r) => setTimeout(r, 3300));
    const x = (await rec.stop())[0]; try { input.disconnect(rec.node); } catch (e) { /* */ }
    if (!oo.input && !app.session.tracks.some((tt) => tt.arm && tt.monitor)) eng.closeInput();
    return AS.rec.measureLatency(x, ctx.sampleRate, rec.startTime, clicks);
  }
  app.measureLatency = measureLatency;
  async function recordingSettings() {
    const r = await UI.dialog({ title: 'Recording Settings', okLabel: 'OK', width: 480,
      html: '<div class="note">Latency compensation moves recordings earlier by the round-trip time of your interface, so overdubs line up with what you heard. Use <b>Measure</b> with the output connected to the input (loopback cable, or the microphone held to the speaker).</div><div class="frow"><label>Round-trip latency</label><button class="btn" data-measure>Measure…</button><span class="lmres note" style="margin:0 0 0 8px"></span></div>',
      fields: [
        { id: 'latencyMs', label: 'Latency compensation', type: 'range', min: 0, max: 500, step: 0.1, value: RS.latencyMs, unit: 'ms' },
        { id: 'preRoll', label: 'Punch pre-roll', type: 'range', min: 0, max: 10, step: 0.1, value: RS.preRoll, unit: 's' },
        { id: 'postRoll', label: 'Punch post-roll', type: 'range', min: 0, max: 10, step: 0.1, value: RS.postRoll, unit: 's' },
        { id: 'n', type: 'note', label: 'Punch In/Out (Transport menu) records only the multitrack time selection. Loop recording: turn Loop on, select a time range and record — every pass becomes a take.' }],
      onReady(el) {
        const res = el.querySelector('.lmres'), inp = el.querySelector('[data-id="latencyMs"]');
        el.querySelector('[data-measure]').onclick = async () => {
          res.textContent = 'Listening for 5 test clicks…';
          try { const m = await measureLatency(); if (m.latency == null) { res.textContent = m.error; return; } inp.value = (m.latency * 1000).toFixed(1); inp.dispatchEvent(new Event('input')); res.textContent = `${(m.latency * 1000).toFixed(1)} ms (${m.found}/5 clicks)` + (m.error ? ' — ' + m.error : ''); }
          catch (e) { res.textContent = e.message || String(e); }
        };
      } });
    if (!r) return;
    Object.assign(RS, { latencyMs: r.latencyMs, preRoll: r.preRoll, postRoll: r.postRoll }); saveRS();
  }

  /* ================= External edit (EditorStage "Edit in AudioStage") ================= */
  // The file was rendered by EditorStage; Save (Ctrl+S) writes it back in place (WAV 24-bit, same rate) and EditorStage
  // reloads the clip on its timeline. "Save As" still exports a copy.
  async function openExternal({ path: p, name }) {
    try {
      const r = await window.audioStageExt.read(p); if (!r.ok) throw new Error(r.error);
      await openFiles([new File([r.data], name, { type: 'audio/wav' })]);
      const d = app.cur; if (d && d.name === name) { d.extPath = p; d.dirty = false; updateFiles(); UI.toast(`Editing “${name}” for EditorStage — Ctrl+S saves it back to the timeline.`); }
    } catch (e) { UI.toast(`Cannot open “${name}” from EditorStage: ${e.message || e}`, 'error'); }
  }
  async function saveBackToEditorStage(d) {
    try {
      const bytes = await UI.busy('Saving back to EditorStage…', async () => AS.wav.encodeWav(d.ch, d.sr, 24, false, d.markers.length ? { markers: d.markers } : null));
      const r = await window.audioStageExt.save(d.extPath, new Uint8Array(bytes)); if (!r.ok) throw new Error(r.error);
      d.dirty = false; updateFiles(); status('Saved back to EditorStage: ' + d.name); return true;
    } catch (e) { reportErr(e); return false; }
  }
  /* files Windows opened with AudioStage: a .asession opens the multitrack, audio files open in Waveform */
  async function openShellFiles(list) {
    for (const f of list) {
      let src = null;
      try { src = await AS.disk.source(f.path); } catch (e) { UI.toast(`Cannot open “${f.path}”: ${e.message}`, 'error'); continue; }
      if (!src) { UI.toast(`“${f.path}” was not found.`, 'error'); continue; }
      const file = AS.disk.lazyFile(src); // read only now, in pieces
      if (f.kind === 'session') await loadSession(file); else await openFiles([file]);
    }
  }
  app.openShellFiles = openShellFiles;
  if (window.audioStageOpen) window.audioStageOpen.onFiles(openShellFiles);
  const shellOpened = window.audioStageOpen ? window.audioStageOpen.pending().then(openShellFiles) : Promise.resolve();
  if (window.audioStageExt) {
    window.audioStageExt.onOpen(openExternal);
    window.audioStageExt.pending().then((list) => list.forEach(openExternal));
  }

  /* ================= Edit operations ================= */
  const needDoc = () => { if (!app.cur) { UI.toast('Open or create an audio file first.'); return false; } return true; };
  function commit(d, ch, label, sel) { if (app.playDoc === d) stop(false); d.set(ch, label, sel); wave.specCache = null; wave.draw(); updateInfo(); updateFiles(); }
  function copyRange() {
    const d = app.cur; if (!d.hasSel()) { UI.toast('Select a range first.'); return false; }
    app.clipboard = { sr: d.sr, ch: D.sliceCh(d.ch, d.sel.a, d.sel.b) }; return true;
  }
  const actions = {
    'file.new': newFile, 'file.open': () => openDialog('files'), 'file.close': () => closeDoc(app.cur), 'file.closeall': async () => { for (const d of app.docs.slice()) await closeDoc(d); },
    'file.save': () => (app.mode === 'multi' ? saveSession(false) : saveDoc('save')), 'file.saveAs': () => saveDoc('as'), 'file.saveSel': () => saveDoc('sel'), 'file.info': fileInfo, 'file.exportMix': exportMix, 'file.saveSession': () => saveSession(false), 'file.saveSessionAs': () => saveSession(true), 'file.recoverLast': recoverLast, 'file.openSession': () => openDialog('sessions'), 'file.exit': () => window.close(),
    'edit.undo': () => { if (app.mode === 'multi') { if (app.session.undo()) { multi.rebuildHeads(); multi.resize(); AS.panels.refreshAll(); } return; } if (!needDoc()) return; if (eng.playing) stop(false); const l = app.cur.undo(); if (l) { status('Undo ' + l); wave.specCache = null; wave.draw(); updateInfo(); updateFiles(); } },
    'edit.redo': () => { if (app.mode === 'multi') { if (app.session.redo()) { multi.rebuildHeads(); multi.resize(); AS.panels.refreshAll(); } return; } if (!needDoc()) return; if (eng.playing) stop(false); const l = app.cur.redo(); if (l) { status('Redo ' + l); wave.specCache = null; wave.draw(); updateInfo(); updateFiles(); } },
    'edit.cut': () => { if (app.mode === 'multi') { if (app.session.sel) { app.clipClip = { ...app.session.findClip(app.session.sel).c }; deleteClip(); } return; } if (!needDoc() || !copyRange()) return; const d = app.cur; commit(d, D.spliceCh(d.ch, d.sel.a, d.sel.b, null), 'Cut', { a: d.sel.a, b: d.sel.a }); },
    'edit.copy': () => { if (app.mode === 'multi') { const f = app.session.sel && app.session.findClip(app.session.sel); if (f) { app.clipClip = { ...f.c }; status('Clip copied'); } return; } if (needDoc() && copyRange()) status('Copied'); },
    'edit.paste': () => {
      if (app.mode === 'multi') { pasteClip(); return; }
      if (!needDoc()) return; if (!app.clipboard) { UI.toast('Clipboard is empty.'); return; }
      const d = app.cur, cb = app.clipboard, ins = D.matchChannels(D.convertRate(cb.ch, cb.sr, d.sr), d.ch.length), a = d.sel.a, b = d.sel.b;
      commit(d, D.spliceCh(d.ch, a, b, ins), 'Paste', { a, b: a + ins[0].length });
    },
    'edit.mixpaste': () => {
      if (!needDoc()) return; if (!app.clipboard) { UI.toast('Clipboard is empty.'); return; }
      const d = app.cur, cb = app.clipboard, ins = D.matchChannels(D.convertRate(cb.ch, cb.sr, d.sr), d.ch.length), a = d.sel.a, n = ins[0].length, newLen = Math.max(d.len, a + n);
      const out = d.ch.map((c, i) => { const y = new Float32Array(newLen); y.set(c); for (let k = 0; k < n; k++) y[a + k] += ins[i][k]; return y; });
      commit(d, out, 'Mix Paste', { a, b: a + n });
    },
    'edit.copynew': () => { if (needDoc() && copyRange()) addDoc(app.cur.name.replace(/\.\w+$/, '') + ' (copy).wav', app.clipboard.sr, D.cloneCh(app.clipboard.ch)); },
    'edit.pastenew': () => { if (!app.clipboard) { UI.toast('Clipboard is empty.'); return; } addDoc('Pasted.wav', app.clipboard.sr, D.cloneCh(app.clipboard.ch)); },
    'edit.delete': () => { if (app.mode === 'multi') { deleteClip(); return; } if (!needDoc()) return; const d = app.cur; if (app.specMode && d.spec) { spectralApply('atten', -120, 'Spectral Delete'); return; } if (!d.hasSel()) { UI.toast('Select a range to delete.'); return; } commit(d, D.spliceCh(d.ch, d.sel.a, d.sel.b, null), 'Delete', { a: d.sel.a, b: d.sel.a }); },
    'edit.crop': () => { if (!needDoc()) return; const d = app.cur; if (!d.hasSel()) { UI.toast('Select a range to keep.'); return; } commit(d, D.sliceCh(d.ch, d.sel.a, d.sel.b), 'Crop', { a: 0, b: 0 }); wave.zoomAll(); },
    'edit.selall': () => { if (app.mode === 'multi') { multi.setRange(0, app.session.duration); return; } if (needDoc()) { app.cur.sel = { a: 0, b: app.cur.len }; app.selectionChanged(); } },
    'edit.selnone': () => { if (app.mode === 'multi') { multi.setRange(null); return; } if (needDoc()) { app.cur.sel = { a: app.cur.sel.a, b: app.cur.sel.a }; app.selectionChanged(); } },
    'edit.selview': () => needDoc() && wave.selectView(),
    'edit.convertsr': convertSampleRate,
    'edit.tomono': () => { if (!needDoc()) return; const d = app.cur; if (d.ch.length === 1) return; commit(d, [D.mixMono(d.ch).slice()], 'Convert to Mono', d.sel); },
    'edit.tostereo': () => { if (!needDoc()) return; const d = app.cur; if (d.ch.length === 2) return; const m = d.ch.length === 1 ? [d.ch[0].slice(), d.ch[0].slice()] : [d.ch[0].slice(), d.ch[1].slice()]; commit(d, m, 'Convert to Stereo', d.sel); },
    // M: a marker at the playhead — or, with a time selection (and not playing), a range marker over it (as in Audition)
    'edit.marker': () => {
      if (!needDoc()) return; const d = app.cur, range = d.hasSel() && !(eng.playing && app.playDoc === d), n = d.markers.length + 1;
      const m = range ? { t: d.sel.a, d: d.sel.b - d.sel.a, name: 'Range ' + n } : { t: app.playSample(d), name: 'Marker ' + n };
      d.setMeta(range ? 'Add Range Marker' : 'Add Marker', (x) => { x.markers.push(m); x.markerIds(); }); updateMarkers(); wave.draw(); updateFiles();
    },
    'edit.clearmarkers': () => { if (needDoc() && app.cur.markers.length) { app.cur.setMeta('Clear Markers', (x) => { x.markers = []; x.playlist = []; }); updateMarkers(); wave.draw(); } },
    'edit.trimsilence': trimSilence,
    'view.wave': () => setSpec(false), 'view.spec': () => setSpec(true),
    'view.zin': () => (app.mode === 'wave' ? wave.doc && wave.zoomBy(0.5) : multi.zoomBy(2)), 'view.zout': () => (app.mode === 'wave' ? wave.doc && wave.zoomBy(2) : multi.zoomBy(0.5)),
    'view.zsel': () => wave.zoomSel(), 'view.zall': () => (app.mode === 'wave' ? wave.zoomAll() : multi.zoomAll()),
    'view.theme': toggleTheme,
    'fx.repeat': () => { if (!app.lastFx) { UI.toast('No effect to repeat yet.'); return; } if (app.lastFx.fav) return applyFavorite(app.lastFx.fav); if (app.lastFx.custom) runCustom(app.lastFx.custom.label, app.lastFx.custom.produce); else runFx(app.lastFx.fx, app.lastFx.p); },
    'fx.vst': () => AS.vst.open(), 'fx.vstInstall': () => AS.runtimes.manage('vst'), 'fx.vstManager': () => AS.vst.manager(), 'help.status': () => AS.runtimes.overview(),
    'fx.noiseprint': () => captureNoise(false), 'fx.learnmodel': () => captureNoise(true),
    'an.freq': freqAnalysis, 'an.stats': ampStats,
    'tp.play': togglePlay, 'tp.pause': pause, 'tp.stop': () => stop(true), 'tp.rec': toggleRecord, 'tp.loop': () => { app.loop = !app.loop; updatePlayBtn(); if (eng.playing && app.mode === 'wave') playWave(); },
    'tp.start': () => goto(0), 'tp.end': () => goto(Infinity),
    'mt.insert': () => needDoc() && insertDocIntoMulti(app.cur), 'mt.addtrack': () => { app.session.push(); app.session.addTrack(); multi.rebuildHeads(); multi.resize(); },
    'mt.split': splitAtPlayhead, 'mt.dup': dupClip, 'mt.props': () => app.session.sel && clipProperties(app.session.sel), 'mt.snap': () => { multi.snap = !multi.snap; },
    'mt.mixnew': mixToNew, 'mt.new': async () => {
      const s = app.session;
      if (s.dirty && (s.tracks.some((t) => t.clips.length) || s.filePath)) { if (!(await confirmSessionClose('New Multitrack Session'))) return; }
      else if (!(await UI.dialog({ title: 'New Multitrack Session', html: '<p>Discard the current session?</p>', okLabel: 'New Session' }))) return;
      if (eng.playing) stop(false); app.session = newSession(); multi.s = app.session; multi.rebuildHeads(); multi.resize(); setMode('multi'); updateTitle();
    },
    'sp.atten': () => spectralGain(-1), 'sp.amp': () => spectralGain(1), 'sp.delete': () => spectralApply('atten', -120, 'Spectral Delete'), 'sp.heal': () => spectralApply('heal', 0, 'Spectral Spot Heal'), 'sp.clear': () => { if (app.cur) { app.cur.spec = null; wave.draw(); app.specChanged(); } },
    // (single-key shortcuts: only in the Waveform editor)
    'sp.tool.time': () => { if (app.mode === 'wave') setTool('time'); }, 'sp.tool.marquee': () => app.mode === 'wave' && setTool('marquee'), 'sp.tool.lasso': () => app.mode === 'wave' && setTool('lasso'),
    'sp.tool.brush': () => app.mode === 'wave' && setTool('brush'), 'sp.tool.heal': () => app.mode === 'wave' && setTool('heal'), 'sp.tool.harm': () => app.mode === 'wave' && setTool('harm'),
    'sp.settings': () => spectralSettings(), 'sp.pitch': () => { const on = !AS.spectral.settings().pitch; AS.spectral.set({ pitch: on }); if (on) setSpec(true); wave.draw(); status('Spectral Pitch Display ' + (on ? 'on' : 'off')); },
    'sp.brushbig': () => { wave.brushPx = Math.min(80, Math.round(wave.brushPx * 1.25)); $('#brushSize').value = wave.brushPx; wave.frame(); }, 'sp.brushsmall': () => { wave.brushPx = Math.max(3, Math.round(wave.brushPx / 1.25)); $('#brushSize').value = wave.brushPx; wave.frame(); },
    'file.batch': batchProcess, 'file.audio': () => AS.prefs.open('Audio Hardware'), 'mt.duck': autoDuck, 'mt.essential': autoEssential, 'mt.master': () => openRack(null), 'mt.trackfx': () => { const t = app.session.tracks.find((t) => t.id === app.selTrack); if (t) openRack(t); else UI.toast('Select a track first.'); }, 'view.timefmt': () => { AS.prefs.set('display.timeFmt', TF[(tfi + 1) % TF.length]); status('Time format: ' + TF[tfi] + (TF[tfi] === 'bars' ? ' (rulers show bars:beats — Edit > Tempo and Time Signature…)' : '')); },
    'gen.speech': openSpeech, 'help.keys': showKeys, 'help.about': showAbout, 'help.manual': () => openHelp(), 'help.start': () => AS.welcome.show(), 'help.updates': () => AS.updates.check(), 'help.logs': showLogs, 'help.report': reportProblem,
  };
  /* crossfade / overlap settings (per session, saved in .asession, undoable) */
  function setMultiOpt(k, v) {
    const s = app.session; s.push(); s.opts[k] = v; s.applyAllCrossfades(); multi.draw(); app.multiChanged(true);
    status(k === 'overlap' ? 'Overlapping clips: ' + { overlap: 'Overlap (crossfade)', overwrite: 'Overwrite', ripple: 'Insert (ripple)' }[v] : k === 'channels' ? '' : 'Crossfades updated');
  }
  actions['mt.xf.toggle'] = () => setMultiOpt('xfade', !app.session.opts.xfade);
  for (const [k] of AS.CURVES) actions['mt.xf.curve.' + k] = () => setMultiOpt('xfCurve', k);
  actions['mt.xf.symmetric'] = () => setMultiOpt('xfShape', 'symmetric'); actions['mt.xf.asymmetric'] = () => setMultiOpt('xfShape', 'asymmetric');
  for (const k of ['overlap', 'overwrite', 'ripple']) actions['mt.ov.' + k] = () => setMultiOpt('overlap', k);
  Object.assign(actions, {
    'edit.ripple': () => { if (app.mode === 'multi') deleteClip(true); else actions['edit.delete'](); },
    'mt.group': () => { const fs = selClips(); if (fs.length < 2) { UI.toast('Select two or more clips to group (Ctrl+click).'); return; } app.session.push(); app.session.group(fs.map((f) => f.c.id)); multi.draw(); status(`${fs.length} clips grouped — they now select and move together.`); },
    'mt.ungroup': () => { const fs = selClips(); if (!fs.length) return; app.session.push(); app.session.ungroup(fs.map((f) => f.c.id)); multi.draw(); status('Ungrouped.'); },
    'mt.lock': () => clipToggle('locked', 'Lock in Time'), 'mt.loop': () => clipToggle('loop', 'Clip loop'),
    'mt.front': () => clipStack(true), 'mt.back': () => clipStack(false),
    'mt.trackup': () => moveTrack('up'), 'mt.trackdown': () => moveTrack('down'), 'mt.tracktop': () => moveTrack('top'), 'mt.trackbottom': () => moveTrack('bottom'),
    'mt.freeze': freezeTrack, 'mt.unfreeze': unfreezeTrack,
    'mt.video': () => { const i = document.createElement('input'); i.type = 'file'; i.accept = 'video/*,.mp4,.mov,.mkv,.m4v,.webm'; i.onchange = () => { if (i.files[0]) insertVideo(i.files[0], app.multiCursor); }; i.click(); },
    'file.exportVideo': () => exportVideo(),
    'mt.bouncetrack': () => bounce('track'), 'mt.bouncemix': () => bounce('mix'), 'mt.bounceclips': () => bounce('clips'),
  });
  actions['tp.punch'] = () => { app.punch = !app.punch; status(app.punch ? 'Punch In/Out on: recording keeps only the time selection.' : 'Punch In/Out off.'); multi.draw(); };
  actions['tp.recset'] = recordingSettings;
  function goto(s) {
    if (app.mode === 'multi') { app.seekMulti(s === Infinity ? app.session.duration : s); return; }
    const d = app.cur; if (!d) return;
    d.sel = { a: s === Infinity ? d.len : s, b: s === Infinity ? d.len : s }; wave.ensureVisible(d.sel.a); app.cursorMoved(true);
  }
  /* ================= Selection & playback extras (zero crossings, scrub, shuttle, skip / preview, playlist) ================= */
  const ED_KEY = 'as-edit', EDS = (() => { const def = { zeroSnap: false, preRoll: 2, postRoll: 2 }; try { return { ...def, ...(JSON.parse(localStorage.getItem(ED_KEY)) || {}) }; } catch (e) { return def; } })();
  const saveEDS = () => { try { localStorage.setItem(ED_KEY, JSON.stringify(EDS)); } catch (e) { /* */ } };
  app.editSettings = EDS;
  /* Snap to Zero Crossings: selection edges made with the mouse land on the nearest zero crossing (within 20 ms) */
  app.snapS = (s) => { const d = app.cur; if (!EDS.zeroSnap || !d) return s; return D.zeroCross(d.enabled().map((i) => d.ch[i]), s, 0, Math.round(d.sr * 0.02)); };
  /* Edit > Zero Crossings: move the selection edges to zero crossings (inward / outward / one side) */
  function adjustZero(kind) {
    if (!needDoc()) return; const d = app.cur; if (!d.hasSel()) { UI.toast('Make a selection first.'); return; }
    const chs = d.enabled().map((i) => d.ch[i]), lim = d.sr, z = (s, dir) => D.zeroCross(chs, s, dir, lim);
    let { a, b } = d.sel;
    if (kind === 'in') { a = z(a, 1); b = z(b, -1); } else if (kind === 'out') { a = z(a, -1); b = z(b, 1); }
    else if (kind === 'll') a = z(a, -1); else if (kind === 'lr') a = z(a, 1); else if (kind === 'rl') b = z(b, -1); else if (kind === 'rr') b = z(b, 1);
    if (b < a) { UI.toast('No zero crossings inside the selection.'); return; }
    d.sel = { a, b }; app.selectionChanged(); status('Selection adjusted to zero crossings.');
  }
  /* audio for scrubbing / shuttling: the file (Waveform) or a cached mixdown of the session (Multitrack), rendered
     again only when the session changed */
  const mixCache = { sig: '', buf: null, pending: null, pendingSig: '' };
  const mixSig = () => JSON.stringify([app.session.tracks, app.session.master], (k, v) => (k === 'src' && v ? v.name + ':' + v.dur + ':' + (v.id || '') : k === 'ch' || k === 'takes' ? undefined : v));
  function mixBuffer() {
    const s = app.session, sig = mixSig();
    if (mixCache.buf && mixCache.sig === sig) return Promise.resolve(mixCache.buf);
    if (s.duration <= 0) return Promise.resolve(null);
    if (!mixCache.pending || mixCache.pendingSig !== sig) {
      eng.init(); status('Preparing the session audio for scrubbing / shuttle…'); mixCache.pendingSig = sig;
      mixCache.pending = AS.renderMix(s, eng.ctx.sampleRate).then((m) => { if (mixCache.pendingSig === sig) { mixCache.sig = sig; mixCache.buf = eng.toBuffer(m.ch, m.sr); } mixCache.pending = null; return mixCache.buf; }, (e) => { mixCache.pending = null; reportErr(e); return null; });
    }
    return mixCache.pending;
  }
  app.mixBuffer = mixBuffer;
  /* Scrub: dragging the playhead in the ruler plays short grains at the speed (and direction) of the drag */
  const scrubSt = { last: null, gt: 0 };
  async function scrub(pos, mode) {
    if (eng.playing || app.recording) return; eng.init();
    const buf = mode === 'multi' ? (mixCache.buf && mixCache.sig === mixSig() ? mixCache.buf : (mixBuffer(), null)) : app.cur && app.cur.audioBuffer();
    if (!buf) return;
    const now = performance.now() / 1000, L = scrubSt.last; scrubSt.last = { pos, t: now };
    if (!L || now - L.t > 0.25) { scrubSt.gt = now; return AS.playx.grain(eng.ctx, eng.master, buf, pos, 1, 0.08); } // a click: one grain
    if (now - scrubSt.gt < 0.04) return; // ~25 grains a second
    const rate = AS.playx.scrubRate((pos - L.pos) * buf.sampleRate, now - L.t, buf.sampleRate); if (!rate) return;
    scrubSt.gt = now; return AS.playx.grain(eng.ctx, eng.master, buf, pos, rate, 0.08);
  }
  app.scrub = scrub;
  /* Shuttle J / K / L: reverse / stop / forward; again = faster (1, 2, 4, 8×); hold K for half speed */
  let shuttleRate = 0, kHeld = false;
  document.addEventListener('keydown', (e) => { if (e.key === 'k' || e.key === 'K') kHeld = true; });
  document.addEventListener('keyup', (e) => { if (e.key === 'k' || e.key === 'K') kHeld = false; });
  window.addEventListener('blur', () => { kHeld = false; });
  async function shuttle(key, held) {
    const rate = AS.playx.shuttleNext(shuttleRate, key, held === undefined ? kHeld && key !== 'k' : held);
    if (!rate) { if (eng.playing) stop(false); shuttleRate = 0; return 0; }
    eng.init(); const multiMode = app.mode === 'multi', d = app.cur;
    if (!multiMode && !needDoc()) return 0;
    const pos = eng.playing ? eng.pos() : multiMode ? app.multiCursor : app.playSample(d) / d.sr;
    const buf = multiMode ? await mixBuffer() : d.audioBuffer(); if (!buf) { UI.toast('Nothing to play.'); return 0; }
    if (app.recording) return 0;
    const t0 = eng.prepare(), src = AS.playx.playRate(eng.ctx, eng.master, buf, rate, Math.max(0, Math.min(buf.duration, pos)), t0);
    src.onended = () => { if (eng.sources[0] === src) stop(false); };
    eng.begin([src], t0, pos, rate > 0 ? buf.duration : 0, 0, { rate });
    if (!multiMode) { app.playDoc = d; app.playOrigin = d.sel.a; if (d.hasSel()) d.sel = { a: d.sel.a, b: d.sel.a }; }
    shuttleRate = rate; updatePlayBtn(); status(`Shuttle ${rate < 0 ? '◀ ' : '▶ '}${Math.abs(rate)}×   (J reverse · K stop · L forward)`);
    return rate;
  }
  app.shuttle = shuttle;
  /* play [a, b) segments of the open file back to back (Skip Selection, Preview Edit, playlists) */
  function playSegs(d, segs, what) {
    if (!segs.length) { UI.toast('Nothing to play.'); return; }
    eng.init(); const t0 = eng.prepare(), srcs = AS.playx.playSegments(eng.ctx, eng.master, d.audioBuffer(), segs, t0), m = AS.playx.segMap(segs, d.sr);
    const last = srcs[srcs.length - 1]; last.onended = () => { if (eng.sources.includes(last)) stop(true); };
    eng.begin(srcs, t0, segs[0][0] / d.sr, segs[segs.length - 1][1] / d.sr, 0, { map: m.at });
    app.playDoc = d; app.playOrigin = d.sel.a; updatePlayBtn(); if (what) status(what);
  }
  app.playSegs = playSegs;
  function previewEdit() {
    if (!needDoc()) return; const d = app.cur; if (!d.hasSel()) { UI.toast('Select the part you want to cut first.'); return; }
    if (eng.playing) stop(false);
    playSegs(d, AS.playx.previewSegments(d.len, d.sel, Math.round(EDS.preRoll * d.sr), Math.round(EDS.postRoll * d.sr)), `Preview Edit: ${EDS.preRoll} s before the selection, then ${EDS.postRoll} s after it — as it will sound once deleted.`);
  }
  /* playlist of range markers (Playlist panel): entries {id, loops} → segments */
  function playlistSegs(d) { const R = d.ranges(); return AS.playx.playlistSegments((d.playlist || []).map((p) => { const r = R.find((x) => x.id === p.id); return r && { ...r, loops: p.loops }; }).filter(Boolean)); }
  app.playPlaylist = () => { if (!needDoc()) return; const d = app.cur, segs = playlistSegs(d); if (!segs.length) { UI.toast('The playlist is empty — add range markers to it first.'); return; } if (eng.playing) stop(false); playSegs(d, segs, `Playing the playlist (${d.playlist.length} item(s)).`); };
  app.playlistEdit = (label, fn) => { const d = app.cur; if (!d) return; d.setMeta(label, (x) => { x.playlist = x.playlist || []; fn(x.playlist, x); }); const p = AS.panels.defs.playlist; if (p && p.refresh) p.refresh(); };
  /* Export Ranges: every range marker (or the chosen ones) as its own file. o: {fmt, template, ids, dir} (dir: desktop
     folder, chosen with a dialog when missing). Names: {file} {marker} {n} in the template. */
  const safeName = (s) => String(s).replace(/[\\/:*?"<>|\x00-\x1f]+/g, '_').replace(/^\.+/, '').trim().slice(0, 150) || 'untitled';
  /* before writing several files into a folder: some names exist already → ask. → { overwrite } | null (cancel).
     linked = the files refer to each other by name (CUE + WAV, XML + media): only Replace or Cancel */
  async function askOverwrite(dir, names, linked) {
    const api = window.audioStageFiles; if (!api || !api.exists) return { overwrite: false };
    const r = await api.exists(dir, names); if (!r.ok || !r.existing.length) return { overwrite: false };
    const list = r.existing.slice(0, 8).map((n) => '<li>' + UI.esc(n) + '</li>').join('') + (r.existing.length > 8 ? `<li>… and ${r.existing.length - 8} more</li>` : '');
    const a = await UI.dialog({ title: 'Files already exist', width: 480, okLabel: 'Replace', extraButtons: linked ? [] : [{ id: 'keep', label: 'Keep Both' }],
      html: `<p>${r.existing.length} file(s) with these names are already in ${UI.esc(dir)}:</p><ul>${list}</ul><div class="note">${linked ? 'Replace them, or Cancel and choose another folder.' : 'Keep Both adds “ (2)” to the new files’ names.'}</div>` });
    if (a === 'keep') return { overwrite: false };
    return a ? { overwrite: true } : null;
  }
  async function exportRanges(o) {
    const d = app.cur; if (!d) return null;
    const R = d.ranges().filter((r) => !o.ids || o.ids.includes(r.id)); if (!R.length) { UI.toast('There are no range markers (select a range and press M).'); return null; }
    const f = FORMATS[o.fmt || 'wav24'], base = d.name.replace(/\.\w+$/, ''), files = window.audioStageFiles;
    let dir = o.dir || null;
    if (files && !dir) { const r = await files.pickFolder('Export ranges to folder'); if (!r.ok || !r.dir) return null; dir = r.dir; }
    const names = [], used = new Set(), planned = R.map((r, i) => { let name = safeName((o.template || '{file} - {marker}').replace(/\{file\}/g, base).replace(/\{marker\}/g, r.name).replace(/\{n\}/g, String(i + 1).padStart(2, '0'))); while (used.has(name.toLowerCase())) name += '_'; used.add(name.toLowerCase()); return name + '.' + f.ext; });
    const ow = files ? await askOverwrite(dir, planned, false) : { overwrite: false }; if (!ow) return null;
    for (let i = 0; i < R.length; i++) {
      const r = R[i], file = planned[i];
      const buf = await encodeBytes(D.sliceCh(d.ch, r.a, r.b), d.sr, o.fmt || 'wav24', true, `Exporting ${i + 1}/${R.length}: ${r.name}`);
      if (files) { const w = await files.write(dir, file, new Uint8Array(buf), ow); if (!w.ok) throw new Error(w.error); names.push(w.name || file); } else { download(buf, file, f.mime); names.push(file); }
    }
    status(`Exported ${names.length} range(s)${dir ? ' to ' + dir : ''}.`); return { dir, names };
  }
  app.exportRanges = exportRanges;
  /* several files at once: desktop → into one folder (asked once, or o.dir), browser → downloads. files: [{name, data, mime}] */
  async function saveFiles(files, o) {
    const api = window.audioStageFiles; let dir = (o && o.dir) || null;
    if (api && !dir) { const r = await api.pickFolder((o && o.title) || 'Choose a folder'); if (!r.ok || !r.dir) return null; dir = r.dir; }
    const ow = api ? await askOverwrite(dir, files.map((f) => f.name), files.length > 1) : { overwrite: false }; if (!ow) return null; // (several files refer to each other by name)
    if (api && files.length > 1) ow.overwrite = true;
    for (const f of files) { if (api) { const w = await api.write(dir, f.name, typeof f.data === 'string' ? f.data : new Uint8Array(f.data), ow); if (!w.ok) throw new Error(w.error); } else download(f.data, f.name, f.mime); }
    return { dir, names: files.map((f) => f.name) };
  }
  app.saveFiles = saveFiles;
  /* CD Layout → one 16-bit / 44.1 kHz stereo WAV + CUE sheet. layout: {title, performer, items: [{docId, name, title,
     performer, gap, ch, sr}]} — an item whose file is still open uses that file's current audio */
  async function exportCD(layout, o) {
    try {
      const items = layout.items.map((it) => { const d = app.docs.find((x) => x.id === it.docId); return { ...it, ch: d ? d.ch : it.ch, sr: d ? d.sr : it.sr }; });
      const base = safeName(layout.title || 'CD'), r = await UI.busy('Building the CD image…', async () => AS.cd.build(items, { title: layout.title, performer: layout.performer, file: base + '.wav' }));
      const wav = await encodeBytes(r.ch, r.sr, 'wav16', true, 'Writing the CD image (16-bit / 44.1 kHz)…');
      const saved = await saveFiles([{ name: base + '.wav', data: wav, mime: 'audio/wav' }, { name: base + '.cue', data: r.cue, mime: 'application/x-cue' }], { dir: o && o.dir, title: 'Export CD image (CUE + WAV) to folder' });
      if (!saved) return null;
      status(`CD image written: ${r.tracks.length} track(s), ${fmtTime(r.seconds)}${saved.dir ? ' → ' + saved.dir : ''}.`); if (r.warnings.length) UI.toast(r.warnings.join(' '), 'error');
      return { ...saved, build: r };
    } catch (e) { reportErr(e); return null; }
  }
  app.exportCD = exportCD;

  /* ---- FCP7 XML interchange (Premiere Pro, DaVinci Resolve, Audition): the session's audio clips as WAV files + XML ---- */
  async function exportFCP7(o) {
    const s = app.session, oo = o || {}; if (!s.tracks.some((t) => t.type !== 'video' && t.clips.length)) { UI.toast('The multitrack session has no clips to export.'); return null; }
    try {
      await UI.busy('Preparing clips…', () => AS.cstretch.ensureAll(s));
      const api = window.audioStageFiles; let dir = oo.dir || null;
      if (api && !dir) { const r = await api.pickFolder('Export session as FCP XML (+ media) to folder'); if (!r.ok || !r.dir) return null; dir = r.dir; }
      const name = safeName(oo.name || 'AudioStage Session'), table = new Map(), used = new Set([name.toLowerCase() + '.xml']), files = [];
      const unroll = (c) => { // a looped clip becomes its own file (the loop written out)
        const sr = c.src.sr, n = Math.round(c.dur * sr), L0 = Math.round(c.loopOff * sr), LL = Math.max(1, Math.round(c.loopLen * sr)), ph = Math.round((c.off - c.loopOff) * sr);
        return AS.makeSource(c.name + ' (loop)', sr, c.src.ch.map((x) => { const y = new Float32Array(n); for (let i = 0; i < n; i++) y[i] = x[L0 + ((((ph + i) % LL) + LL) % LL)] || 0; return y; }));
      };
      const media = (c) => {
        const looped = c.loop && c.loopLen > 0, src = looped ? unroll(c) : AS.cstretch.play(c) || c.src;
        if (!table.has(src)) {
          let fn = safeName(src.name) + '.wav'; while (used.has(fn.toLowerCase())) fn = fn.replace(/(\.wav)$/i, '_$1'); used.add(fn.toLowerCase());
          table.set(src, { id: 'file-' + (table.size + 1), name: fn, url: dir ? AS.interchange.toUrl(dir.replace(/[\\/]$/, '') + '/' + fn) : fn, sr: src.sr, nch: src.ch.length, frames: src.ch[0].length });
          files.push({ src, name: fn });
        }
        return { ...table.get(src), ...(looped ? { off: 0 } : {}) };
      };
      const xml = AS.interchange.toFCP7(s, media, { name, timebase: oo.timebase || 30 }), out = [];
      for (const [i, f] of files.entries()) out.push({ name: f.name, data: await encodeBytes(f.src.ch, f.src.sr, 'wav24', false, `Writing media ${i + 1}/${files.length}: ${f.name}`), mime: 'audio/wav' });
      out.push({ name: name + '.xml', data: xml, mime: 'application/xml' });
      const saved = await saveFiles(out, { dir }); if (!saved) return null;
      status(`Session exported as FCP XML with ${files.length} media file(s)${saved.dir ? ' → ' + saved.dir : ''}.`); return { ...saved, xml };
    } catch (e) { reportErr(e); return null; }
  }
  app.exportFCP7 = exportFCP7;
  /* FCP7 XML → a new multitrack session. Media: the paths in the XML, else next to the XML file (desktop), else the
     files the user picks (o.files, or a file dialog). */
  async function importFCP7(file, o) {
    const oo = o || {};
    try {
      const j = AS.interchange.fromFCP7(await file.text());
      if (!oo.force && app.session.tracks.some((t) => t.clips.length)) { const ok = await UI.dialog({ title: 'Import FCP XML', html: '<p>Replace the current multitrack session with the imported one?</p>', okLabel: 'Replace' }); if (!ok) return null; }
      const xmlPath = window.audioStageVideo ? window.audioStageVideo.pathOf(file) : '', xmlDir = xmlPath.replace(/[\\/][^\\/]*$/, ''), base = (p) => String(p).split(/[\\/]/).pop();
      const srcs = {}, missing = [];
      await UI.busy('Loading media…', async () => {
        for (const f of Object.values(j.files)) {
          const tries = [f.path, xmlDir && xmlDir + '/' + base(f.path || f.name), xmlDir && xmlDir + '/' + f.name].filter(Boolean);
          let got = null;
          if (window.audioStageMedia) for (const p of tries) { const r = await window.audioStageMedia.read(p); if (r.ok) { got = new File([r.data], base(p)); break; } }
          if (!got && oo.files) got = oo.files.find((x) => x.name.toLowerCase() === base(f.path || f.name).toLowerCase() || x.name.toLowerCase() === f.name.toLowerCase()) || null;
          if (!got) { missing.push(f); continue; }
          const res = await decodeFile(got); srcs[f.id] = AS.makeSource(got.name.replace(/\.\w+$/, ''), res.sr, res.ch);
        }
      });
      if (missing.length && !oo.files && !oo.noAsk) { // let the user point at the media
        const picked = await new Promise((res) => { const i = document.createElement('input'); i.type = 'file'; i.multiple = true; i.accept = 'audio/*,video/*'; i.onchange = () => res([...i.files]); i.click(); });
        for (const f of missing.slice()) { const g = picked.find((x) => x.name.toLowerCase() === base(f.path || f.name).toLowerCase()); if (g) { const res = await decodeFile(g); srcs[f.id] = AS.makeSource(g.name.replace(/\.\w+$/, ''), res.sr, res.ch); missing.splice(missing.indexOf(f), 1); } }
      }
      const s = new AS.Session(); s.tracks = []; let n = 0, skipped = 0;
      for (const t of j.tracks) {
        const tr = s.addTrack(t.name); tr.pan = t.pan || 0;
        for (const c of t.clips) { const src = srcs[c.file]; if (!src) { skipped++; continue; } const dur = Math.max(0.001, Math.min(c.dur, src.dur - c.off)); s.addClip(tr, src, c.start, { off: c.off, dur, gain: +c.gainDb.toFixed(2), fi: Math.min(c.fi, dur / 2), fo: Math.min(c.fo, dur / 2), name: c.name || src.name }); n++; }
      }
      if (!s.tracks.length) s.addTrack();
      useSession(s); status(`Imported “${j.name}”: ${s.tracks.length} track(s), ${n} clip(s)` + (skipped ? ` — ${skipped} clip(s) skipped (media not found: ${missing.map((m) => m.name).join(', ')})` : '.'));
      return { session: s, clips: n, skipped, missing: missing.map((m) => m.name) };
    } catch (e) { reportErr(e); return null; }
  }
  app.importFCP7 = importFCP7;
  async function exportRangesDlg() {
    if (!needDoc()) return; const d = app.cur, R = d.ranges(); if (!R.length) { UI.toast('There are no range markers yet — select a range and press M.'); return; }
    const r = await UI.dialog({ title: 'Export Range Markers', okLabel: 'Export', fields: [
      { id: 'fmt', label: 'Format', type: 'select', options: fmtOptions(), value: 'wav24' },
      { id: 'template', label: 'File names', type: 'text', value: '{file} - {marker}' },
      { id: 'n', type: 'note', label: `${R.length} range(s): ${R.map((x) => UI.esc(x.name)).join(', ')}.<br>In the name, {file} = this file’s name, {marker} = the marker name, {n} = 01, 02, … ${window.audioStageFiles ? 'You choose the folder next.' : 'Each file is downloaded.'}` }] });
    if (!r) return; try { await exportRanges(r); } catch (e) { reportErr(e); }
  }
  async function previewSettings() {
    const r = await UI.dialog({ title: 'Preview Edit / Skip Selection', fields: [
      { id: 'preRoll', label: 'Pre-roll', type: 'range', min: 0, max: 10, step: 0.1, value: EDS.preRoll, unit: 's' }, { id: 'postRoll', label: 'Post-roll', type: 'range', min: 0, max: 10, step: 0.1, value: EDS.postRoll, unit: 's' },
      { id: 'n', type: 'note', label: 'Preview Edit plays the pre-roll before the selection and then the post-roll after it, so you hear the cut before making it. Skip Selection makes Play start the pre-roll before the selection and jump over it.' }] });
    if (r) { EDS.preRoll = r.preRoll; EDS.postRoll = r.postRoll; saveEDS(); }
  }
  Object.assign(actions, {
    'edit.zerosnap': () => { EDS.zeroSnap = !EDS.zeroSnap; saveEDS(); status('Snap to Zero Crossings ' + (EDS.zeroSnap ? 'on' : 'off')); },
    'edit.z.in': () => adjustZero('in'), 'edit.z.out': () => adjustZero('out'), 'edit.z.ll': () => adjustZero('ll'), 'edit.z.lr': () => adjustZero('lr'), 'edit.z.rl': () => adjustZero('rl'), 'edit.z.rr': () => adjustZero('rr'),
    'tp.shuttle.j': () => shuttle('j'), 'tp.shuttle.k': () => shuttle('k'), 'tp.shuttle.l': () => shuttle('l'),
    'tp.skipsel': () => { app.skipSel = !app.skipSel; status('Skip Selection ' + (app.skipSel ? 'on: playback jumps over the selection.' : 'off.')); if (eng.playing && app.mode === 'wave') playWave(); },
    'tp.preview': previewEdit, 'tp.prevset': previewSettings, 'tp.playlist': () => app.playPlaylist(),
    'edit.exportRanges': exportRangesDlg,
  });

  function trimSilence() {
    if (!needDoc()) return; const d = app.cur, thr = D.fromDb(-50);
    let a = 0, b = d.len;
    const peak = (i) => { let m = 0; for (const c of d.ch) m = Math.max(m, Math.abs(c[i])); return m; };
    while (a < b && peak(a) < thr) a++;
    while (b > a && peak(b - 1) < thr) b--;
    if (a === 0 && b === d.len) { UI.toast('No leading/trailing silence found.'); return; }
    commit(d, D.sliceCh(d.ch, a, b), 'Trim Silence', { a: 0, b: 0 }); wave.zoomAll();
  }
  async function newFile() {
    const r = await UI.dialog({ title: 'New Audio File', fields: [
      { id: 'name', label: 'File name', type: 'text', value: 'Untitled ' + (app.docs.length + 1) },
      { id: 'sr', label: 'Sample rate', type: 'select', options: SR_OPTS, value: AS.prefs.get('files.newSr') },
      { id: 'ch', label: 'Channels', type: 'select', options: [[1, 'Mono'], [2, 'Stereo']], value: AS.prefs.get('files.newCh') },
      { id: 'bits', label: 'Bit depth (when saved)', type: 'select', options: BITS_OPTS, value: AS.prefs.get('files.newBits') },
      { id: 'dur', label: 'Initial silence', type: 'range', min: 0, max: 600, step: 0.5, value: 5, unit: 's' }], okLabel: 'Create' });
    if (!r) return;
    addDoc(r.name + '.wav', +r.sr, Array.from({ length: +r.ch }, () => new Float32Array(Math.round(r.dur * r.sr)))).bits = +r.bits;
    if (app.mode === 'multi') setMode('wave');
  }
  async function convertSampleRate() {
    if (!needDoc()) return; const d = app.cur;
    const r = await UI.dialog({ title: 'Convert Sample Rate', fields: [{ id: 'sr', label: 'New sample rate', type: 'select', options: [8000, 11025, 16000, 22050, 32000, 44100, 48000, 88200, 96000, 192000].map((v) => [v, v + ' Hz']), value: d.sr }] });
    if (!r || +r.sr === d.sr) return;
    await UI.busy('Converting…', () => {
      const ratio = +r.sr / d.sr, nc = D.convertRate(d.ch, d.sr, +r.sr);
      if (app.playDoc === d) stop(false);
      d.set(nc, 'Convert Sample Rate', { a: Math.round(d.sel.a * ratio), b: Math.round(d.sel.b * ratio) }, +r.sr); d.vs.spp = 0; d.markers.forEach((m) => (m.t = Math.round(m.t * ratio)));
      wave.zoomAll();
    });
    updateInfo(); updateFiles();
  }

  /* ================= Effects ================= */
  /* run a background job behind the busy overlay (cancellable) */
  function withJob(msg, make) {
    let job;
    return UI.busy(msg, async () => { job = make(); return job; }, () => job && job.cancel());
  }
  const reportErr = (e) => { if (e && e.message === 'Cancelled') UI.toast('Cancelled.'); else UI.toast((e && e.message) || String(e), 'error'); };
  /* write processed channels (for enabled channel indices) back over [a,b) */
  function mergeResult(d, chIdx, a, b, out) {
    if (chIdx.length === d.ch.length) return D.spliceCh(d.ch, a, b, out);
    if (out[0].length !== b - a) throw new Error('Effects that change the length apply to all channels. Enable every channel (click the L/R boxes) first.');
    return d.ch.map((c, i) => { const k = chIdx.indexOf(i); if (k < 0) return c.slice(); const r = c.slice(); r.set(out[k], a); return r; });
  }
  async function runFx(fx, params) {
    const d = app.cur; if (!d) { UI.toast('Open an audio file first.'); return; }
    try {
      if (app.playDoc === d) stop(false);
      const [a, b] = d.range(), had = d.hasSel(), chIdx = fx.cat === 'Stereo Imagery' || fx.id === 'stretch' || fx.id === 'speed' || fx.id === 'remix' ? d.ch.map((_, i) => i) : d.enabled();
      const slice = chIdx.map((i) => d.ch[i].slice(a, b));
      const out = await withJob(`Applying ${fx.name.replace('...', '')}…`, () => AS.jobs.fx(fx.id, slice, d.sr, params, app.noiseProfile));
      d.set(mergeResult(d, chIdx, a, b, out), fx.name.replace('...', ''), had ? { a, b: a + out[0].length } : { a: d.sel.a, b: d.sel.a });
      wave.specCache = null; app.lastFx = { fx, p: params }; AS.favorites.recorder.push(AS.favorites.fxStep(fx.id, params));
      wave.draw(); updateInfo(); updateFiles();
    } catch (e) { reportErr(e); }
  }
  async function runFxOnClip(fx, params) {
    const f = app.session.sel && app.session.findClip(app.session.sel);
    if (!f) { UI.toast('Select a clip in the multitrack first.'); return; }
    const { c } = f;
    try {
      const ps = await AS.cstretch.ensure(c) || c.src; // what the clip plays (time-stretched audio included)
      const s0 = Math.round(c.off * ps.sr), s1 = Math.round((c.off + c.dur) * ps.sr);
      const out = await withJob('Applying…', () => AS.jobs.fx(fx.id, D.sliceCh(ps.ch, s0, s1), ps.sr, params, app.noiseProfile));
      app.session.push(); c.src = AS.makeSource(c.src.name, c.src.sr, out); c.off = 0; c.dur = c.src.dur; c.stretch = 1; c.pitch = 0;
      AS.favorites.recorder.push(AS.favorites.fxStep(fx.id, params));
      multi.draw(); updateInfo();
    } catch (e) { reportErr(e); }
  }
  /* apply any async processor (e.g. an external plugin) to the selection / selected clip with normal undo handling.
     produce(slice: Float32Array[], sr) -> Promise<Float32Array[]> */
  async function runCustom(label, produce) {
    try {
      if (app.mode === 'multi') {
        const f = app.session.sel && app.session.findClip(app.session.sel);
        if (!f) { UI.toast('Select a clip in the multitrack first.'); return; }
        const c = f.c, ps = await AS.cstretch.ensure(c) || c.src, s0 = Math.round(c.off * ps.sr), s1 = Math.round((c.off + c.dur) * ps.sr);
        const out = await UI.busy('Processing: ' + label + '…', () => produce(D.sliceCh(ps.ch, s0, s1), ps.sr));
        app.session.push(); c.src = AS.makeSource(c.src.name, c.src.sr, out); c.off = 0; c.dur = c.src.dur; c.stretch = 1; c.pitch = 0; multi.draw(); updateInfo();
      } else {
        const d = app.cur; if (!d) { UI.toast('Open an audio file first.'); return; }
        if (app.playDoc === d) stop(false);
        const [a, b] = d.range(), had = d.hasSel(), chIdx = d.enabled(), slice = chIdx.map((i) => d.ch[i].slice(a, b));
        const out = await UI.busy('Processing: ' + label + '…', () => produce(slice, d.sr));
        d.set(mergeResult(d, chIdx, a, b, out), label, had ? { a, b: a + out[0].length } : { a: d.sel.a, b: d.sel.a });
        wave.specCache = null; wave.draw(); updateInfo(); updateFiles();
      }
      app.lastFx = { custom: { label, produce } };
    } catch (e) { reportErr(e); }
  }
  app.runCustom = runCustom;
  function paramFields(fx, last) {
    return fx.params.map((p) => ({ ...p, tip: AS.tips.param(fx.id, p), value: last && last[p.id] !== undefined ? last[p.id] : p.value }));
  }
  const lastParams = {};
  async function openFx(fx) {
    if (app.mode === 'wave' && !needDoc()) return;
    if (fx.needsProfile && !app.noiseProfile) { UI.toast('First select a noise-only region and choose Effects > Noise Reduction / Restoration > Capture Noise Print (or Learn Sound Model).', 'error'); return; }
    const isMulti = app.mode === 'multi';
    if (fx.direct && !fx.params.length || (fx.direct && fx.id.startsWith('fade'))) {
      const p = E.defaults(fx); return isMulti ? runFxOnClip(fx, p) : runFx(fx, p);
    }
    const d = app.cur;
    if (fx.marks && isMulti) { UI.toast('Mark Audio works on a file in the Waveform editor.'); return; }
    const preview = isMulti || fx.marks ? null : {
      start(vals) {
        try {
          const [a, b] = d.range(), end = Math.min(b, a + d.sr * 8);
          const out = fx.process(D.sliceCh(d.ch, a, end), d.sr, vals, { noiseProfile: app.noiseProfile });
          const t0 = eng.prepare(), s = eng.ctx.createBufferSource(); s.buffer = eng.toBuffer(out, d.sr); s.connect(eng.master); s.start(t0);
          eng.begin([s], t0, 0, out[0].length / d.sr, 0); app.playDoc = null;
        } catch (e) { UI.toast(e.message, 'error'); }
      },
      stop() { eng.stop(); },
    };
    const r = await UI.dialog({ title: fx.name.replace('...', ''), fields: paramFields(fx, lastParams[fx.id]), preview, okLabel: 'Apply', width: fx.params.length > 8 ? 560 : 460,
      html: !isMulti && !d.hasSel() ? '<div class="note">No selection — the effect will be applied to the entire file.</div>' : isMulti ? '<div class="note">Applies to the selected clip.</div>' : '' });
    eng.stop();
    if (!r) return;
    lastParams[fx.id] = r;
    if (fx.marks) return markAudio(r);
    isMulti ? runFxOnClip(fx, r) : runFx(fx, r);
  }
  /* Mark Audio: detect the non-silent regions of the selection and drop a start / end marker on each */
  function markAudio(r) {
    const d = app.cur; if (!d) return; const [a, b] = d.range(), regs = D.detectAudio(D.sliceCh(d.ch, a, b), d.sr, r.thr, r.minSil, r.minAud);
    if (!regs.length) { UI.toast('No audio regions were found with these settings.'); return; }
    d.set(d.ch.slice(), 'Mark Audio', { ...d.sel }); // records an undo step so the markers can be undone
    regs.forEach((g, i) => d.markers.push({ t: a + g[0], name: 'Audio ' + (i + 1) }, { t: a + g[1], name: 'Audio ' + (i + 1) + ' end' }));
    updateMarkers(); wave.draw(); UI.toast(`${regs.length} audio region(s) marked.`);
  }
  /* Effects > Generate > Speech… (desktop app): a Windows voice speaks the text offline. Like the other generators it
     replaces the selection or is inserted at the playhead; with no file open (or in Multitrack) it becomes a new file. */
  async function openSpeech() {
    const tts = window.audioStageTts, S = AS.speech; if (!tts) return;
    const v = await UI.busy('Looking for the voices installed in Windows…', () => tts.voices());
    if (!v.ok) { UI.toast(v.error, 'error'); return; }
    const helpOf = (tag) => (v.langs.find((l) => l.tag === tag) || { help: '' }).help;
    if (!v.voices.length) { await UI.dialog({ title: 'Generate Speech', html: `<p>${UI.esc(helpOf('th-TH'))}</p>`, noOk: true, cancelLabel: 'Close' }); return; }
    const d = app.mode === 'wave' ? app.cur : null, hasSel = !!(d && d.hasSel()), last = lastParams.speech || {}, opts = S.voiceOptions(v.voices, v.langs);
    const missingNote = (val) => { const p = S.parseVoice(val); return p && p.missing ? UI.esc(helpOf(p.missing)) : ''; };
    const fields = [
      { id: 'text', label: 'Text', type: 'textarea', rows: 6, maxLength: 20000, value: last.text || '', tip: 'What the voice says. Thai, English or any language you have a Windows voice for.' },
      { id: 'voice', label: 'Voice / language', type: 'select', options: opts, value: S.defaultVoice(v.voices, last.voice, last.text), tip: 'The voices installed in Windows (offline). A language without a voice shows how to add one.' },
      { id: 'speed', label: 'Speed', type: 'range', min: 50, max: 300, step: 5, value: last.speed || 100, unit: '%', tip: 'How fast the voice speaks (100 % = normal).' },
      { id: 'pitch', label: 'Pitch', type: 'range', min: -12, max: 12, step: 0.5, value: last.pitch || 0, unit: 'st', tip: 'Higher (+) or lower (−) voice, in semitones; the speed stays the same.' },
      { id: 'level', label: 'Level', type: 'range', min: -40, max: 0, step: 0.5, value: last.level === undefined ? -3 : last.level, unit: 'dB peak', tip: 'The speech is normalized to this peak level.' },
      ...(hasSel ? [{ id: 'place', label: 'Place', type: 'select', options: [['replace', 'Replace the selection'], ['insert', 'Insert at the start of the selection']], value: last.place || 'replace', tip: 'Replace the selected audio with the speech, or insert it and keep the selection.' }] : []),
      { id: 'n', type: 'note', label: d ? (hasSel ? '' : 'The speech is inserted at the playhead.') : 'The speech becomes a new audio file.' },
      { id: 'n2', type: 'note', label: `<span class="sp-missing">${missingNote(S.defaultVoice(v.voices, last.voice, last.text))}</span>` }];
    const r = await UI.dialog({ title: 'Generate Speech', fields, okLabel: 'Generate', width: 560, onChange: (vals, box) => { const el = box.querySelector('.sp-missing'); if (el) el.innerHTML = missingNote(vals.voice); } });
    if (!r) return; lastParams.speech = r;
    const vo = S.parseVoice(r.voice);
    if (!vo || vo.missing) { await UI.dialog({ title: 'Generate Speech', html: `<p>${UI.esc(helpOf(vo && vo.missing))}</p>`, noOk: true, cancelLabel: 'Close' }); return; }
    if (!String(r.text).trim()) { UI.toast('Type the text to speak first.', 'error'); return; }
    try {
      const res = await UI.busy('Speaking…', () => tts.speak({ text: r.text, voice: vo.id, engine: vo.engine, rate: r.speed / 100 }));
      if (!res.ok) throw new Error(res.error);
      const doc = d && app.cur === d ? d : null, sr = doc ? doc.sr : +AS.prefs.get('files.newSr'), nch = doc ? doc.ch.length : +AS.prefs.get('files.newCh');
      const out = D.normalize(S.render(res.data, sr, nch, r.pitch), r.level, false, false);
      if (!doc) { addDoc('Speech ' + (app.docs.length + 1) + '.wav', sr, out); if (app.mode === 'multi') setMode('wave'); return; }
      const a = doc.sel.a, b = hasSel && r.place !== 'insert' ? doc.sel.b : a;
      commit(doc, D.spliceCh(doc.ch, a, b, out), 'Generate Speech', { a, b: a + out[0].length });
    } catch (e) { reportErr(e); }
  }
  async function openGen(g) {
    if (!needDoc()) { if (!app.docs.length) await newFile(); if (!app.cur) return; }
    const d = app.cur;
    const r = await UI.dialog({ title: 'Generate ' + g.name.replace('...', ''), fields: paramFields(g, lastParams[g.id]), okLabel: 'Generate' });
    if (!r) return; lastParams[g.id] = r;
    try {
      const out = await withJob('Generating…', () => AS.jobs.gen(g.id, d.sr, d.ch.length, r)), a = d.sel.a, b = d.sel.b;
      commit(d, D.spliceCh(d.ch, a, b, out), 'Generate ' + g.name.replace('...', ''), { a, b: a + out[0].length });
    } catch (e) { reportErr(e); }
  }
  function captureNoise(learn) {
    if (!needDoc()) return; const d = app.cur;
    if (!d.hasSel() || d.sel.b - d.sel.a < 4096) { UI.toast('Select at least ~0.1 s of noise-only audio first.', 'error'); return; }
    if (learn && d.sel.b - d.sel.a < d.sr * 0.3) { UI.toast('Select at least 0.3 s of the sound you want the model to learn.', 'error'); return; }
    const part = D.sliceCh(d.ch, d.sel.a, d.sel.b);
    app.noiseProfile = D.noiseProfile(part, 2048);
    app.noiseProfile.audio = D.mixMono(part).slice(); app.noiseProfile.sr = d.sr; // raw print, used by Sound Remover
    UI.toast(learn ? 'Sound model learned. Now select the audio to clean and run Effects > Noise Reduction / Restoration > Sound Remover.' : 'Print captured. Now select the audio to clean and run Noise Reduction or Sound Remover.');
  }

  /* ================= Analysis ================= */
  async function freqAnalysis() {
    if (!needDoc()) return; const d = app.cur, [a, b] = d.range();
    const sp = D.spectrum(D.sliceCh(d.ch, a, b), d.sr, 4096), W = 640, H = 300, nyq = d.sr / 2;
    const fx = (f) => ((Math.log10(f) - Math.log10(20)) / (Math.log10(nyq) - Math.log10(20))) * (W - 50) + 40;
    const dbRange = [-120, 0], dy = (db) => 10 + (1 - (db - dbRange[0]) / (dbRange[1] - dbRange[0])) * (H - 30);
    await UI.dialog({ title: 'Frequency Analysis', width: 720, noOk: true, cancelLabel: 'Close', dismissable: true,
      html: '<canvas id="faC" width="640" height="300" style="width:100%;background:#0e1013;border-radius:4px"></canvas><div id="faRead" class="note">Hover the graph to read frequency and level.</div>',
      onReady(el) {
        const cv = el.querySelector('#faC'), g = cv.getContext('2d');
        const draw = (hx) => {
          g.clearRect(0, 0, W, H); g.fillStyle = '#0e1013'; g.fillRect(0, 0, W, H);
          g.font = '10px Segoe UI'; g.strokeStyle = '#2a2f36'; g.fillStyle = '#7d8590';
          for (const f of [20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000]) { if (f > nyq) continue; const x = fx(f); g.beginPath(); g.moveTo(x, 10); g.lineTo(x, H - 20); g.stroke(); g.fillText(f >= 1000 ? f / 1000 + 'k' : f, x - 8, H - 6); }
          for (let db = -120; db <= 0; db += 20) { const y = dy(db); g.beginPath(); g.moveTo(40, y); g.lineTo(W - 10, y); g.stroke(); g.fillText(db, 8, y + 3); }
          g.strokeStyle = '#4fd1a5'; g.lineWidth = 1.5; g.beginPath();
          let first = true;
          for (let k = 1; k < sp.db.length; k++) { const f = (k * d.sr) / sp.N; if (f < 20) continue; const x = fx(f), y = dy(Math.max(dbRange[0], sp.db[k])); if (first) { g.moveTo(x, y); first = false; } else g.lineTo(x, y); }
          g.stroke(); g.lineWidth = 1;
          if (hx !== undefined) { g.strokeStyle = '#fff6'; g.beginPath(); g.moveTo(hx, 10); g.lineTo(hx, H - 20); g.stroke(); }
        };
        draw();
        let pk = 1; for (let k = 2; k < sp.db.length; k++) if (sp.db[k] > sp.db[pk]) pk = k;
        el.querySelector('#faRead').textContent = `Peak: ${Math.round((pk * d.sr) / sp.N)} Hz at ${sp.db[pk].toFixed(1)} dB`;
        cv.addEventListener('mousemove', (e) => {
          const r = cv.getBoundingClientRect(), x = ((e.clientX - r.left) / r.width) * W;
          const f = Math.pow(10, ((x - 40) / (W - 50)) * (Math.log10(nyq) - Math.log10(20)) + Math.log10(20)), k = Math.round((f * sp.N) / d.sr);
          draw(x); if (k > 0 && k < sp.db.length) el.querySelector('#faRead').textContent = `${Math.round(f)} Hz   ${sp.db[k].toFixed(1)} dB`;
        });
      } });
  }
  async function ampStats() {
    if (!needDoc()) return; const d = app.cur, [a, b] = d.range();
    const slice = D.sliceCh(d.ch, a, b);
    const s = await UI.busy('Analyzing…', () => ({ ...D.stats(slice, d.sr), tp: D.truePeak(slice), lf: D.loudnessFull(slice, d.sr) }));
    app.lastStats = s; // (tests)
    const db = (v) => (v <= 0 ? '-∞' : D.toDb(v).toFixed(2) + ' dB'), lu = (v, u) => (isFinite(v) ? v.toFixed(1) + ' ' + u : '—');
    const rows = (k, f) => s.per.map((p, i) => `<td>${f(p, i)}</td>`).join('');
    await UI.dialog({ title: 'Amplitude Statistics', noOk: true, cancelLabel: 'Close', width: 540, html: `<table class="stats"><tr><th></th>${s.per.map((_, i) => `<th>${s.per.length === 2 ? (i ? 'Right' : 'Left') : 'Ch ' + (i + 1)}</th>`).join('')}</tr>
      <tr><td>Min sample</td>${rows('', (p) => p.min.toFixed(5))}</tr><tr><td>Max sample</td>${rows('', (p) => p.max.toFixed(5))}</tr>
      <tr><td>Peak amplitude</td>${rows('', (p) => db(p.peak))}</tr><tr><td>True peak (4×)</td>${rows('', (p, i) => (s.tp.per[i] <= 0 ? '-∞' : D.toDb(s.tp.per[i]).toFixed(2) + ' dBTP'))}</tr><tr><td>RMS amplitude</td>${rows('', (p) => db(p.rms))}</tr>
      <tr><td>DC offset</td>${rows('', (p) => p.dc.toFixed(6))}</tr><tr><td>Clipped samples</td>${rows('', (p) => p.clipped)}</tr></table>
      <table class="stats"><tr><td>Overall peak</td><td>${db(s.peak)}</td></tr><tr><td>Overall true peak</td><td>${s.tp.peak <= 0 ? '-∞' : D.toDb(s.tp.peak).toFixed(2) + ' dBTP'}</td></tr><tr><td>Overall RMS</td><td>${db(s.rms)}</td></tr>
      <tr><td>Integrated loudness</td><td>${lu(s.lf.I, 'LUFS')}</td></tr><tr><td>Loudness range (LRA)</td><td>${lu(s.lf.LRA, 'LU')}</td></tr><tr><td>Max momentary / short-term</td><td>${lu(s.lf.Mmax, 'LUFS')} / ${lu(s.lf.Smax, 'LUFS')}</td></tr><tr><td>Peak to loudness ratio (PLR)</td><td>${lu(s.lf.PLR, 'LU')}</td></tr>
      <tr><td>Length</td><td>${fmtTime(s.length / s.sr)} (${s.length} samples)</td></tr><tr><td>Sample rate</td><td>${s.sr} Hz</td></tr></table>` });
  }

  /* ================= Diagnostics (Audition's Diagnostics panel) =================
     Scan the selection / file for clicks, clipping, silences or audio regions, list them, and repair (or delete /
     mark) them one at a time or all at once — each an undo step. Items: {s, e, ch} (file samples, e exclusive; ch -1 = all). */
  const DIAG = {
    declicker: { label: 'DeClicker', act: 'Repair', scan: (c, sr, p) => D.detectClicks(c, p.sens, p.len).map((x) => ({ s: x.s, e: x.e, ch: x.ch, info: 'strength ' + Math.round(x.score) })) },
    declip: { label: 'DeClipper', act: 'Repair', scan: (c, sr, p) => D.detectClipping(c, p.thr, p.run).map((x) => ({ s: x.s, e: x.e + 1, ch: x.ch, info: x.e - x.s + 1 + ' samples' })) },
    delsilence: { label: 'Delete Silence', act: 'Delete', scan: (c, sr, p) => D.detectSilence(c, sr, p.thr, p.min).map((x) => ({ s: x.s, e: x.e, ch: -1 })) },
    markaudio: { label: 'Mark Audio', act: 'Mark', scan: (c, sr, p) => D.detectAudio(c, sr, p.thr, p.minSil, p.minAud).map(([s, e]) => ({ s, e, ch: -1 })) },
  };
  const diagParams = (kind, p) => ({ ...E.defaults(E.byId(kind)), ...(lastParams[kind] || {}), ...(p || {}) });
  /* range: [a, b) to scan (default: the selection, else the whole file) */
  function diagScan(kind, p, range) {
    const d = app.cur; if (!d) return [];
    const [a, b] = range ? [Math.max(0, range[0]), Math.min(d.len, range[1])] : d.range(), chIdx = d.enabled(), pp = diagParams(kind, p);
    return DIAG[kind].scan(chIdx.map((i) => d.ch[i].slice(a, b)), d.sr, pp).map((it) => ({ ...it, s: it.s + a, e: it.e + a, ch: it.ch < 0 ? -1 : chIdx[it.ch] }));
  }
  function diagFix(kind, items, p) {
    const d = app.cur; if (!d || !items.length) return false; if (app.playDoc === d) stop(false);
    const pp = diagParams(kind, p), one = items.length === 1;
    if (kind === 'markaudio') {
      d.setMeta(one ? 'Mark Audio' : `Mark Audio (${items.length})`, (x) => { items.forEach((it, i) => x.markers.push({ t: it.s, d: it.e - it.s, name: 'Audio ' + (x.markers.length + 1) })); x.markerIds(); });
      updateMarkers(); wave.draw(); return true;
    }
    let ch;
    if (kind === 'delsilence') { // delete each silence but keep `keep` ms next to the audio (none at the file's ends), from the end backwards
      const keep = Math.round((pp.keep * d.sr) / 1000); ch = d.ch;
      for (const it of items.slice().sort((x, y) => y.s - x.s)) { const s = it.s === 0 ? 0 : it.s + keep, e = it.e >= d.len ? d.len : it.e - keep; if (e > s) ch = D.spliceCh(ch, s, e, null); }
    } else {
      ch = d.ch.map((c) => c.slice()); const orig = d.ch;
      for (const it of items) { if (kind === 'declicker') D.repairClick(ch[it.ch], it.s, it.e); else D.repairClip(ch[it.ch], orig[it.ch], it.s, it.e - 1); }
    }
    commit(d, ch, (DIAG[kind].act === 'Delete' ? 'Delete Silence' : DIAG[kind].label + ' repair') + (one ? '' : ` (${items.length})`), kind === 'delsilence' ? { a: d.sel.a, b: d.sel.a } : d.sel);
    return true;
  }
  app.diag = { KINDS: DIAG, scan: diagScan, fix: diagFix, params: diagParams, settings: async (kind) => { const fx = E.byId(kind), r = await UI.dialog({ title: DIAG[kind].label + ' Settings', fields: paramFields(fx, lastParams[kind]) }); if (r) lastParams[kind] = r; return r; } };

  /* ================= Export ================= */
  function download(buf, name, type) {
    const url = URL.createObjectURL(new Blob([buf], { type: type || 'audio/wav' })), a = document.createElement('a');
    a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 5000);
  }
  const FORMATS = {
    wav16: { label: 'WAV 16-bit PCM', format: 'wav', bits: 16, ext: 'wav', mime: 'audio/wav' }, wav24: { label: 'WAV 24-bit PCM', format: 'wav', bits: 24, ext: 'wav', mime: 'audio/wav' },
    wav32: { label: 'WAV 32-bit float', format: 'wav', bits: 32, ext: 'wav', mime: 'audio/wav' },
    flac16: { label: 'FLAC 16-bit (lossless)', format: 'flac', bits: 16, ext: 'flac', mime: 'audio/flac' }, flac24: { label: 'FLAC 24-bit (lossless)', format: 'flac', bits: 24, ext: 'flac', mime: 'audio/flac' },
    mp3_128: { label: 'MP3 128 kbps', format: 'mp3', kbps: 128, ext: 'mp3', mime: 'audio/mpeg' }, mp3_192: { label: 'MP3 192 kbps', format: 'mp3', kbps: 192, ext: 'mp3', mime: 'audio/mpeg' },
    mp3_256: { label: 'MP3 256 kbps', format: 'mp3', kbps: 256, ext: 'mp3', mime: 'audio/mpeg' }, mp3_320: { label: 'MP3 320 kbps', format: 'mp3', kbps: 320, ext: 'mp3', mime: 'audio/mpeg' },
    opus_96: { label: 'OGG Opus 96 kbps', format: 'opus', kbps: 96, ext: 'opus', mime: 'audio/ogg', web: 'opus' }, opus_128: { label: 'OGG Opus 128 kbps', format: 'opus', kbps: 128, ext: 'opus', mime: 'audio/ogg', web: 'opus' }, opus_192: { label: 'OGG Opus 192 kbps', format: 'opus', kbps: 192, ext: 'opus', mime: 'audio/ogg', web: 'opus' },
    m4a_128: { label: 'M4A (AAC) 128 kbps', format: 'aac', container: 'm4a', kbps: 128, ext: 'm4a', mime: 'audio/mp4', web: 'aac' }, m4a_192: { label: 'M4A (AAC) 192 kbps', format: 'aac', container: 'm4a', kbps: 192, ext: 'm4a', mime: 'audio/mp4', web: 'aac' }, m4a_256: { label: 'M4A (AAC) 256 kbps', format: 'aac', container: 'm4a', kbps: 256, ext: 'm4a', mime: 'audio/mp4', web: 'aac' },
    aac_128: { label: 'AAC 128 kbps (ADTS)', format: 'aac', kbps: 128, ext: 'aac', mime: 'audio/aac', web: 'aac' }, aac_192: { label: 'AAC 192 kbps (ADTS)', format: 'aac', kbps: 192, ext: 'aac', mime: 'audio/aac', web: 'aac' }, aac_256: { label: 'AAC 256 kbps (ADTS)', format: 'aac', kbps: 256, ext: 'aac', mime: 'audio/aac', web: 'aac' },
  };
  /* "WAV", "FLAC", "MP3", "Opus", "M4A", "AAC" — from the export table, so the About box never goes stale */
  const exportFormatNames = () => [...new Set(Object.values(FORMATS).map((f) => (f.container || f.format) === 'opus' ? 'Opus' : (f.container || f.format).toUpperCase()))];
  const fmtOptions = () => Object.entries(FORMATS).filter(([, v]) => !v.web || AS.webenc.avail[v.web]).map(([k, v]) => [k, v.label]);
  /* the format a Save dialog starts with: the file's / session's own bit depth (new files), else Preferences > Files */
  const defaultFmt = (bits) => { const k = bits ? 'wav' + bits : AS.prefs.get('files.exportFmt'); return fmtOptions().some((o) => o[0] === k) ? k : 'wav24'; };
  async function exportOptions(title, hasSel, bits) {
    return UI.dialog({ title, okLabel: 'Save', fields: [
      { id: 'fmt', label: 'Format', type: 'select', options: fmtOptions(), value: defaultFmt(bits) },
      { id: 'dither', label: 'Apply TPDF dither (16-bit WAV)', type: 'check', value: true },
      { id: 'meta', label: 'Include metadata: tags (ID3 / Vorbis / MP4 / INFO), WAV markers, BWF and CART', type: 'check', value: true },
      { id: 'title', label: 'Title', type: 'text', value: (app.cur && app.cur.meta && app.cur.meta.title) || '' }, { id: 'artist', label: 'Artist', type: 'text', value: (app.cur && app.cur.meta && app.cur.meta.artist) || '' },
      { id: 'mn', type: 'note', label: 'Album, year, genre, track, comment and the cover image: File > File Info / Metadata…' },
      ...(hasSel ? [{ id: 'sel', label: 'Selection only', type: 'check', value: true }] : [])] });
  }
  /* encode channels in an export format → ArrayBuffer */
  async function encodeBytes(ch, sr, fmtKey, dither, msg, extra) {
    const f = FORMATS[fmtKey], m = msg || 'Encoding ' + f.label + '…', tags = extra && extra.tags;
    if (tags && !AS.tags.isEmpty(tags)) { const t = AS.tags.write(new Uint8Array(await encodeBytes(ch, sr, fmtKey, dither, msg, { ...extra, tags: null })), f.container || f.format, tags); return t.buffer.slice(t.byteOffset, t.byteOffset + t.byteLength); }
    return f.web
      ? UI.busy(m, () => (f.format === 'opus' ? AS.webenc.encodeOpus(ch, sr, f.kbps) : f.container === 'm4a' ? AS.webenc.encodeM4a(ch, sr, f.kbps) : AS.webenc.encodeAac(ch, sr, f.kbps)))
      : withJob(m, () => AS.jobs.encode(ch.map((c) => c.slice()), sr, { format: f.format, bits: f.bits, kbps: f.kbps, dither, ...(extra || {}) }));
  }
  app.encodeBytes = encodeBytes;
  async function encodeDownload(ch, sr, baseName, fmtKey, dither, extra) {
    const f = FORMATS[fmtKey], buf = await encodeBytes(ch, sr, fmtKey, dither, null, extra);
    download(buf, baseName + '.' + f.ext, f.mime);
  }
  /* the format File > Save keeps for a file opened from disk without asking: lossless ones only (WAV at the file's
     own bit depth, FLAC); a lossy file (MP3, …) asks once with the Save As options, then Save repeats those */
  function fmtForPath(p, d) {
    const ext = ((/\.(\w+)$/.exec(p || '') || [])[1] || '').toLowerCase();
    if (ext === 'wav' || ext === 'wave') return 'wav' + ([16, 24, 32].includes(d.bits) ? d.bits : 24);
    if (ext === 'flac') return d.bits === 16 ? 'flac16' : 'flac24';
    return null;
  }
  const docSig = (d) => d.version + ':' + d.undoStack.length + ':' + d.redoStack.length;
  /* mode: 'save' (File > Save, Ctrl+S: the file it came from / was last saved to), 'as' (Save As…), 'sel' (Save
     Selection As…). The file counts as saved (dirty cleared) only after the whole file was written; Cancel in the
     Save dialog or a failed write keeps it unsaved. Returns true when written. */
  async function saveDoc(mode, dd) {
    if (!dd && !needDoc()) return false; const d = dd || app.cur;
    if (mode === 'save' && d.extPath) return saveBackToEditorStage(d);
    const disk = AS.disk.available;
    let o = null, target = null, useSel = false;
    if (mode === 'save' && disk && d.path && d.savable) { const k = d.saveOpts ? d.saveOpts.fmt : fmtForPath(d.path, d); if (k && FORMATS[k]) { o = d.saveOpts || { fmt: k, dither: true, meta: true }; target = d.path; } }
    if (!o) {
      const r = await exportOptions(mode === 'sel' ? 'Save Selection As' : 'Save As', d.hasSel() && mode !== 'sel', d.bits);
      if (!r) return false;
      useSel = mode === 'sel' ? d.hasSel() : !!r.sel;
      d.meta = AS.tags.clean({ ...d.meta, title: r.title, artist: r.artist }); // one set of metadata: the dialog and File Info share it
      o = { fmt: r.fmt, dither: r.dither, meta: r.meta };
    }
    const f = FORMATS[o.fmt], base = d.name.replace(/\.\w+$/, ''), [a, b] = useSel && d.hasSel() ? [d.sel.a, d.sel.b] : [0, d.len];
    const extra = o.meta ? { markers: d.markers.filter((m) => m.t >= a && m.t <= b).map((m) => ({ t: m.t - a, name: m.name, ...(m.d > 0 ? { d: Math.min(m.d, b - m.t) } : {}) })), bext: { description: (d.meta && d.meta.title) || d.name, originator: 'AudioStage' }, cart: { title: (d.meta && d.meta.title) || d.name, artist: (d.meta && d.meta.artist) || '' }, tags: d.meta } : null;
    const sig = docSig(d);
    try {
      if (!disk) { await encodeDownload(D.sliceCh(d.ch, a, b), d.sr, base, o.fmt, o.dither, extra); if (!useSel) { d.dirty = false; updateFiles(); } return true; } // browser: a download
      if (!target) {
        const nm = base + (useSel ? ' (selection)' : '') + '.' + f.ext;
        target = await AS.disk.chooseSave({ title: mode === 'sel' ? 'Save Selection As' : 'Save As', name: nm, path: d.path ? AS.disk.join(AS.disk.dirOf(d.path), nm) : '', filters: [{ name: f.label, extensions: [f.ext] }] });
        if (!target) { status('Not saved.'); return false; }
      }
      const buf = await encodeBytes(D.sliceCh(d.ch, a, b), d.sr, o.fmt, o.dither, null, extra);
      await UI.busy('Writing ' + AS.disk.baseName(target) + '…', () => AS.disk.writeBytes(target, buf, { onProgress: (x, n) => UI.busyMsg(`Writing ${AS.disk.baseName(target)}… ${Math.round((100 * x) / Math.max(1, n))} %`) }));
    } catch (e) { reportErr(e); return false; }
    if (!useSel) {
      d.path = target; d.savable = true; d.saveOpts = o; d.name = AS.disk.baseName(target);
      if (docSig(d) === sig) d.dirty = false; // (changed while it was being written: still unsaved)
      AS.recent.note('files', target);
    }
    updateFiles(); status('Saved ' + target); return true;
  }
  app.saveDoc = saveDoc;
  /* File > File Info / Metadata…: title, artist, album, year, genre, track, comment and a cover image for the open file —
     written when it is saved (ID3v2.4 / Vorbis comments / MP4 atoms / WAV INFO; Title + Artist also go into BWF / CART) */
  async function fileInfo() {
    if (!needDoc()) return; const d = app.cur, m = AS.tags.clean(d.meta); let cover = m.cover;
    const T = (id, label, tip) => ({ id, label, type: 'text', value: m[id], tip });
    const coverHtml = () => (cover ? `<img class="fi-img" src="data:${cover.mime};base64,${cover.b64}" alt="Cover"><span class="fi-sz">${UI.esc(cover.mime)} · ${Math.round((cover.b64.length * 0.75) / 1024)} KB</span>` : '<span class="fi-none">No cover image</span>');
    const r = await UI.dialog({ title: 'File Info / Metadata — ' + d.name, okLabel: 'OK', width: 560, fields: [
      T('title', 'Title', 'Song / programme title. Also written to BWF (description) and CART when saving WAV.'), T('artist', 'Artist', 'Performer or author. Also written to CART when saving WAV.'), T('album', 'Album', 'Album, show or series name.'),
      T('year', 'Year', 'Year (or date, e.g. 2026-10-27).'), T('genre', 'Genre', 'Genre as text, e.g. Pop, Podcast, ลูกทุ่ง.'), T('track', 'Track', 'Track number, optionally with the total: 3 or 3/12.'),
      { id: 'comment', label: 'Comment', type: 'textarea', rows: 3, value: m.comment, tip: 'Free text.' },
      { id: 'cv', type: 'note', label: '<div class="frow fi-cover"><label>Cover image</label><span class="fi-show"></span><button class="btn" data-fi="pick">Choose…</button><button class="btn" data-fi="del">Remove</button><input type="file" accept="image/png,image/jpeg" hidden></div>' },
      { id: 'n', type: 'note', label: 'Saved into the file by Save As / Save Selection As / Batch Process: MP3 and AAC (ID3v2.4), FLAC and Opus (Vorbis comments), M4A (MP4 atoms), WAV (LIST INFO + ID3, plus BWF / CART). UTF-8 — Thai is fine.' }],
      onReady: (box) => {
        const show = box.querySelector('.fi-show'), inp = box.querySelector('.fi-cover input'); show.innerHTML = coverHtml();
        box.querySelector('[data-fi=pick]').onclick = () => inp.click(); box.querySelector('[data-fi=del]').onclick = () => { cover = null; show.innerHTML = coverHtml(); };
        inp.onchange = async () => { const file = inp.files[0]; if (!file) return; if (file.size > 8 * 1024 * 1024) { UI.toast('Choose an image smaller than 8 MB.', 'error'); return; } const b = new Uint8Array(await file.arrayBuffer()); cover = { mime: /png/i.test(file.type) ? 'image/png' : AS.tags.sniffMime(b), b64: AS.tags.toB64(b) }; show.innerHTML = coverHtml(); };
        app.fileInfoBox = box; // app tests set the cover through app.setFileInfoCover
        app.setFileInfoCover = (c) => { cover = c; show.innerHTML = coverHtml(); };
      } });
    app.fileInfoBox = null; app.setFileInfoCover = null;
    if (!r) return;
    const next = AS.tags.clean({ ...r, cover });
    if (JSON.stringify(next) !== JSON.stringify(m)) { d.meta = next; d.dirty = true; updateFiles(); status('File info updated — it is written when the file is saved.'); }
  }
  async function exportMix() {
    const surround = app.session.opts.channels === 6;
    const r = surround
      ? await UI.dialog({ title: 'Export Multitrack Mixdown (5.1)', okLabel: 'Save', fields: [{ id: 'fmt', label: 'Format', type: 'select', options: Object.entries(FORMATS).filter(([, v]) => v.format === 'wav').map(([k, v]) => [k, v.label]), value: 'wav24' }, { id: 'dither', label: 'Apply TPDF dither (16-bit WAV)', type: 'check', value: true }, { id: 'n', type: 'note', label: '5.1 mixdowns are written as 6-channel WAV (L R C LFE Ls Rs, WAVE_FORMAT_EXTENSIBLE with the 5.1 speaker mask). MP3 / AAC / Opus encoders here are stereo only.' }] })
      : await exportOptions('Export Multitrack Mixdown', false, app.session.bits);
    if (!r) return null;
    try {
      const f = FORMATS[r.fmt], base = (app.session.fileName ? app.session.fileName.replace(/\.asession$/i, '') + ' ' : '') + (surround ? 'Mixdown 5.1' : 'Mixdown');
      let target = null;
      if (AS.disk.available) { // ask where first, so a cancelled dialog does not cost a render
        target = await AS.disk.chooseSave({ title: 'Export Multitrack Mixdown', name: base + '.' + f.ext, path: app.session.filePath ? AS.disk.join(AS.disk.dirOf(app.session.filePath), base + '.' + f.ext) : '', filters: [{ name: f.label, extensions: [f.ext] }] });
        if (!target) { status('Mixdown not exported.'); return null; }
      }
      const m = await UI.busy('Rendering mixdown…', () => AS.renderMix(app.session, app.session.sr));
      if (!target) { await encodeDownload(m.ch, m.sr, base, r.fmt, r.dither); return true; }
      const buf = await encodeBytes(m.ch, m.sr, r.fmt, r.dither);
      await UI.busy('Writing ' + AS.disk.baseName(target) + '…', () => AS.disk.writeBytes(target, buf));
      status('Mixdown exported: ' + target); return target;
    } catch (e) { reportErr(e); return null; }
  }
  /* 5.1: the output device gets 6 channels when it has them; otherwise Web Audio folds 5.1 down to stereo (spec downmix) */
  function setOutChannels() {
    if (!eng.ctx) return; const d = eng.ctx.destination, want = app.mode === 'multi' && app.session.opts.channels === 6 && d.maxChannelCount >= 6 ? 6 : 2;
    try { if (d.channelCount !== want) { d.channelCount = want; d.channelInterpretation = 'speakers'; } } catch (e) { /* device refuses: stays stereo */ }
  }
  app.setOutChannels = setOutChannels;
  /* Multitrack > Track Surround Panner… (5.1 sessions) */
  async function surroundDialog(t) {
    t = t || app.session.tracks.find((x) => x.id === app.selTrack); if (!t || t.type === 'video') { UI.toast('Select a track first.'); return; }
    const s = { x: 0, y: 1, spread: 1, lfe: -60, ...(t.sur || {}) };
    const r = await UI.dialog({ title: `Surround Panner — ${t.name}`, okLabel: 'Apply', fields: [
      { id: 'x', label: 'Left ↔ Right', type: 'range', min: -1, max: 1, step: 0.01, value: s.x }, { id: 'y', label: 'Rear ↔ Front', type: 'range', min: -1, max: 1, step: 0.01, value: s.y },
      { id: 'spread', label: 'Stereo spread', type: 'range', min: 0, max: 1, step: 0.01, value: s.spread }, { id: 'lfe', label: 'LFE send (−60 = off)', type: 'range', min: -60, max: 0, step: 0.5, value: s.lfe, unit: 'dB' },
      { id: 'n', type: 'note', label: app.session.opts.channels === 6 ? 'Front centre = (0, 1). The middle of the room (0, 0) spreads to all five speakers.' : 'The session master is stereo — switch Multitrack > Master Channels to 5.1 for this to be heard.' }] });
    if (!r) return; app.session.push(); t.sur = { x: r.x, y: r.y, spread: r.spread, lfe: r.lfe }; app.multiChanged(true); AS.panels.refreshAll();
  }
  actions['mt.surround'] = () => surroundDialog();
  for (const n of [2, 6]) actions['mt.ch.' + n] = () => { setMultiOpt('channels', n); setOutChannels(); AS.panels.refreshAll(); status(n === 6 ? '5.1 master: tracks are placed with their surround panners (Mixer / Multitrack > Track Surround Panner…). Master effects are bypassed in 5.1.' : 'Stereo master.'); };
  async function mixToNew() {
    try { await UI.busy('Rendering mixdown…', async () => { const m = await AS.renderMix(app.session, app.session.sr); addDoc('Mixdown.wav', m.sr, m.ch); setMode('wave'); }); }
    catch (e) { UI.toast(e.message, 'error'); }
  }
  /* .asession: versioned format + migration live in sessionio.js */
  /* Save Multitrack Session (Ctrl+S in Multitrack): over the .asession it came from / was last saved to, else asks
     where (Save Session As…). Format 4 = ZIP with the audio as separate WAVs, streamed to disk in pieces
     (sessionzip.js) — no length limit. The session counts as saved only after the whole file was written. */
  async function saveSession(as) {
    const s = app.session, rev = s.undoStack.length + ':' + s.redoStack.length + ':' + (s.rev || 0);
    const name = s.fileName || 'Session.asession';
    if (!AS.disk.available) { // browser build: a download built from pieces (a Blob, never one giant string)
      const parts = []; await UI.busy('Saving session…', async () => { await AS.sessionZip.write(s, { write: async (u) => { parts.push(u.slice()); } }); download(new Blob(parts), name, 'application/zip'); });
      s.dirty = false; updateTitle(); return true;
    }
    let target = !as && s.filePath ? s.filePath : null;
    if (!target) { target = await AS.disk.chooseSave({ title: 'Save Multitrack Session', name, path: s.filePath || s.suggestPath || '', filters: [{ name: 'AudioStage session', extensions: ['asession'] }] }); if (!target) { status('Session not saved.'); return false; } }
    const need = AS.sessionZip.estimate(s), free = await AS.disk.freeSpace(AS.disk.dirOf(target));
    if (free != null && free < need + 64 * 1024 * 1024) { UI.toast(`Not enough free disk space to save the session (${(need / 1048576).toFixed(0)} MB needed, ${(free / 1048576).toFixed(0)} MB free).`, 'error'); return false; }
    const ctl = { aborted: false }, sink = AS.disk.sink(target);
    try {
      await UI.busy('Saving session…', async () => {
        await AS.sessionZip.write(s, sink, { signal: ctl, onProgress: (a, n) => UI.busyMsg(`Saving session… ${Math.round((100 * a) / Math.max(1, n))} %`) });
        await sink.commit();
      }, () => { ctl.aborted = true; });
    } catch (e) { await sink.abort(); if (e && e.cancelled) UI.toast('Saving cancelled — the file was not changed.'); else reportErr(e); return false; }
    s.filePath = target; s.fileName = AS.disk.baseName(target);
    if (rev === s.undoStack.length + ':' + s.redoStack.length + ':' + (s.rev || 0)) s.dirty = false;
    AS.recent.note('sessions', target); updateTitle(); status('Session saved: ' + target);
    return true;
  }
  app.saveSession = saveSession;
  function useSession(s) { AS.welcome.hide(); if (eng.playing) stop(false); app.session = s; multi.s = s; multi.rebuildHeads(); setMode('multi'); multi.zoomAll(); AS.panels.refreshAll(); updateTitle(); }
  /* before the multitrack session is replaced (open another, New Session, recover): ask when it has unsaved changes.
     → true = go ahead (saved, or the user chose not to) */
  async function confirmSessionClose(what) {
    const s = app.session; if (!s || !s.dirty || !s.tracks.some((t) => t.clips.length || t.fx.length) && !s.filePath) return true;
    const r = await UI.dialog({ title: what || 'Unsaved session', html: `<p>The multitrack session${s.fileName ? ' “' + UI.esc(s.fileName) + '”' : ''} has unsaved changes.</p>`, okLabel: 'Save', cancelLabel: 'Cancel', extraButtons: [{ id: 'discard', label: 'Don’t Save' }] });
    if (r === 'discard') return true;
    if (!r) return false;
    return saveSession(false);
  }
  app.confirmSessionClose = confirmSessionClose;
  /* file: a File (dropped / browser), or a file on disk read in pieces (AS.disk.lazyFile). Format 4 (ZIP) is read
     piece by piece with progress and Cancel; formats 1–3 (one JSON text) still open. */
  async function loadSession(file, o) {
    if (!(o && o.noAsk) && !(await confirmSessionClose('Open Session'))) return false;
    const ctl = { aborted: false };
    try {
      const src = file.lazy ? await AS.disk.source(file.asPath) : AS.disk.fileSource(file);
      const s = await UI.busy('Opening session…', async () => {
        const head = await src.read(0, Math.min(4, src.size));
        if (AS.sessionZip.isZip(head)) return AS.sessionZip.read(src, { signal: ctl, onProgress: (a, n) => UI.busyMsg(`Opening session… ${Math.round((100 * a) / Math.max(1, n))} %`) });
        return AS.sessionIO.deserialize(JSON.parse(new TextDecoder().decode(await AS.disk.readAll(src, { signal: ctl }))));
      }, () => { ctl.aborted = true; });
      const p = file.asPath || (window.audioStageRecent ? window.audioStageRecent.pathOf(file) : '') || '';
      s.filePath = file.asPath || ''; s.fileName = file.name; s.dirty = false; if (!s.filePath && p) s.suggestPath = p; // (a dropped file: Save asks, starting there)
      useSession(s); AS.recent.note('sessions', file);
      return true;
    } catch (e) { if (e && e.cancelled) UI.toast('Opening cancelled.'); else UI.toast('Cannot open session: ' + e.message, 'error'); return false; }
  }
  /* title bar: the file being worked on + "*" when it has unsaved changes */
  let lastTitle = '';
  function updateTitle() {
    const s = app.session, d = app.cur, multiMode = app.mode === 'multi';
    const name = multiMode ? (s ? (s.fileName || 'Untitled Session') + (s.dirty ? ' *' : '') : '') : d ? d.name + (d.dirty ? ' *' : '') : '';
    const t = (name ? name + ' — ' : '') + 'AudioStage'; if (t !== lastTitle) { document.title = t; lastTitle = t; }
  }
  app.updateTitle = updateTitle;

  /* ================= Multitrack ops ================= */
  function insertDocIntoMulti(d) {
    if (!d) return;
    const s = app.session; s.push();
    const [a, b] = d.hasSel() ? [d.sel.a, d.sel.b] : [0, d.len];
    const src = AS.makeSource(d.name.replace(/\.\w+$/, ''), d.sr, D.sliceCh(d.ch, a, b));
    if (d.tempo) src.tempo = { ...d.tempo, offset: d.tempo.offset - a / d.sr }; // the file's tempo travels with the clip (Match to session tempo)
    let t = s.tracks.find((t) => t.id === app.selTrack && t.type !== 'bus') || s.tracks.find((t) => !t.clips.length && t.type !== 'bus') || s.addTrack();
    s.place(t, s.addClip(t, src, app.multiCursor)); s.sel = null;
    setMode('multi'); multi.rebuildHeads(); multi.resize(); if (s.duration * multi.pps > multi.W) multi.zoomAll();
  }
  /* files dropped on the multitrack: decode straight into clips (no Waveform document is created).
     The first file goes on track ti at time t, each further file on the next track (tracks are added as needed). */
  async function dropIntoMulti(files, ti, t) {
    const s = app.session; let pushed = false, n = 0;
    for (const f of files) {
      try {
        await UI.busy('Importing ' + f.name + '…', async () => {
          const res = await decodeFile(f);
          if (!pushed) { s.push(); pushed = true; }
          const tr = s.audioTrackAt(ti); ti = s.tracks.indexOf(tr); // never onto a bus lane
          const c = s.addClip(tr, AS.makeSource(f.name.replace(/\.\w+$/, ''), res.sr, res.ch), t); s.place(tr, c);
          s.sel = c.id; app.selTrack = tr.id; ti++; n++;
        });
      } catch (e) { UI.toast(`Cannot import “${f.name}”: ${e.message || 'unsupported format'}`, 'error'); }
    }
    if (!n) return;
    multi.rebuildHeads(); multi.resize(); if (s.duration * multi.pps > multi.W) multi.zoomAll();
    updateInfo(); app.multiChanged(true); AS.panels.refreshAll();
    status(`${n} file(s) added to the multitrack session.`);
  }
  function splitAtPlayhead() {
    const s = app.session, t = app.multiPos(); let done = false;
    s.push();
    const target = s.sel ? [s.findClip(s.sel)] : s.tracks.map((tr) => ({ t: tr, c: tr.clips.find((c) => t > c.start && t < c.start + c.dur) })).filter((x) => x.c);
    for (const f of target) if (f && s.split(f.c.id, t)) done = true;
    if (!done) { s.undoStack.pop(); UI.toast('Place the playhead inside a clip to split it.'); return; }
    multi.draw(); app.multiChanged(true);
  }
  /* delete the selected clips (groups included); ripple: later clips on those tracks move left to close the gaps */
  function deleteClip(ripple) {
    const s = app.session, ids = multi.selectedIds(); if (!ids.size) return;
    if ([...ids].some((id) => { const f = s.findClip(id); return f && f.t.frozen; })) { UI.toast('A selected clip is on a frozen track — unfreeze it first.'); return; }
    s.push(); s.deleteClips(ids, ripple === true); multi.selIds.clear(); s.sel = null; multi.draw(); updateInfo(); app.multiChanged(true);
  }
  /* selected clips, or a hint */
  const selClips = () => { const s = app.session, out = [...multi.selectedIds()].map((id) => s.findClip(id)).filter(Boolean); if (!out.length) UI.toast('Select a clip first (Ctrl+click or Ctrl+drag to select several).'); return out; };
  function clipToggle(key, label) {
    const fs = selClips(); if (!fs.length) return; const s = app.session, on = !fs.every((f) => f.c[key]); s.push();
    for (const f of fs) { if (key === 'loop') s.setLoop(f.c, on); else f.c[key] = on; }
    multi.draw(); app.multiChanged(true); status(`${label} ${on ? 'on' : 'off'} for ${fs.length} clip(s).`);
  }
  /* Bring Clip to Front / Send Clip to Back: where clips on a track overlap, the front one is heard */
  function clipStack(front) {
    if (app.mode !== 'multi') { UI.toast('Bring to Front / Send to Back work on multitrack clips.'); return; }
    const fs = selClips(); if (!fs.length) return; const s = app.session; s.push();
    if (front) s.stackFront(fs.map((f) => f.c.id)); else s.stackBack(fs.map((f) => f.c.id));
    multi.draw(); app.multiChanged(true); status(`${fs.length > 1 ? fs.length + ' clips' : 'Clip'} ${front ? 'brought to the front' : 'sent to the back'}.`);
  }
  /* Move Track Up / Down / to Top / to Bottom (the selected track headers; Ctrl / Shift+click selects several) */
  function moveTrack(dir) {
    if (app.mode !== 'multi') { UI.toast('Move Track works in the multitrack view.'); return; }
    const r = multi.shiftSel(dir); if (r === null) { UI.toast('Select a track first (click its header).'); return; }
    if (r) status(`Track${multi.trackSel().length > 1 ? 's' : ''} moved ${{ up: 'up', down: 'down', top: 'to the top', bottom: 'to the bottom' }[dir]}.`);
  }
  app.setClipColor = (color) => { const fs = selClips(); if (!fs.length) return; app.session.push(); for (const f of fs) { if (color) f.c.color = color; else delete f.c.color; } multi.draw(); };
  const selTrackObj = () => app.session.tracks.find((t) => t.id === app.selTrack);
  /* Freeze: render the track's clips through clip + track effects (pre-fader) into one buffer; playback then uses
     that buffer (no effect processing). Fader, pan, sends and routing still work. Unfreeze goes back to the clips. */
  async function freezeTrack() {
    const t = selTrackObj(); if (!t || t.type === 'bus') { UI.toast('Select an audio track (click its header) first.'); return; }
    if (t.frozen) { UI.toast('The track is already frozen.'); return; }
    const s = app.session, end = Math.max(0, ...t.clips.map((c) => c.start + c.dur)); if (!end) { UI.toast('The track has no clips.'); return; }
    try {
      const m = await UI.busy(`Freezing “${t.name}”…`, () => AS.renderRange(s, s.sr || 44100, 0, end, { id: t.id, point: 'pre' }, 3));
      s.push(); t.frozen = { src: AS.makeSource(t.name + ' (frozen)', m.sr, m.ch) };
      multi.rebuildHeads(); multi.draw(); app.multiChanged(true); status(`“${t.name}” frozen: its effects are no longer processed during playback.`);
    } catch (e) { reportErr(e); }
  }
  function unfreezeTrack() { const t = selTrackObj(); if (!t || !t.frozen) { UI.toast('Select a frozen track first.'); return; } app.session.push(); delete t.frozen; multi.rebuildHeads(); multi.draw(); app.multiChanged(true); status(`“${t.name}” unfrozen.`); }
  /* Bounce: render to a new audio track. what: 'track' (selected track, after fader + pan), 'mix' (master output),
     'clips' (selected clips with their clip effects / envelopes / fades, without track effects or fader).
     Range: the time selection, else the whole thing. */
  async function bounce(what) {
    const s = app.session, rg = multi.range; let src, a, b, name;
    try {
      if (what === 'clips') {
        const fs = selClips(); if (!fs.length) return;
        a = rg ? rg.a : Math.min(...fs.map((f) => f.c.start)); b = rg ? rg.b : Math.max(...fs.map((f) => f.c.start + f.c.dur));
        const tracks = [...new Set(fs.map((f) => f.t))].map((t) => ({ ...t, id: t.id + '-b', fx: [], rackCfg: null, vol: 0, pan: 0, out: 'master', sends: [], auto: { vol: [], pan: [] }, mute: false, solo: false, frozen: null, clips: fs.filter((f) => f.t === t).map((f) => f.c) }));
        const m = await UI.busy('Bouncing clips…', () => AS.renderRange({ tracks, master: { vol: 0, fx: [] } }, s.sr || 44100, a, b, null, 0.05));
        src = m; name = fs.length > 1 ? 'Bounced clips' : fs[0].c.name + ' (bounced)';
      } else {
        const t = selTrackObj(); if (what === 'track' && !t) { UI.toast('Select a track first.'); return; }
        a = rg ? rg.a : 0; b = rg ? rg.b : s.duration; if (!(b > a)) { UI.toast('Nothing to bounce.'); return; }
        src = await UI.busy('Bouncing…', () => AS.renderRange(s, s.sr || 44100, a, b, what === 'track' ? { id: t.id, point: 'out' } : null, 0.05));
        name = what === 'track' ? t.name + ' (bounced)' : 'Mix (bounced)';
      }
      s.push(); const nt = s.addTrack(name); s.addClip(nt, AS.makeSource(name, src.sr, src.ch), a);
      multi.rebuildHeads(); multi.resize(); app.multiChanged(true); status(`Bounced to the new track “${name}”.`);
    } catch (e) { reportErr(e); }
  }
  function dupClip() {
    const s = app.session, f = s.sel && s.findClip(s.sel); if (!f) return;
    s.push(); const n = s.addClip(f.t, f.c.src, f.c.start + f.c.dur, { off: f.c.off, dur: f.c.dur, gain: f.c.gain, fi: f.c.fi, fo: f.c.fo, fiCurve: f.c.fiCurve, foCurve: f.c.foCurve, name: f.c.name, ...AS.cloneClipProps(f.c) }); s.place(f.t, n); s.sel = n.id; multi.draw(); updateInfo(); app.multiChanged(true);
  }
  function pasteClip() {
    const s = app.session, c = app.clipClip; if (!c) { UI.toast('No clip copied.'); return; }
    s.push(); const sel = s.tracks.findIndex((t) => t.id === app.selTrack), t = s.audioTrackAt(sel < 0 ? 0 : sel);
    const n = s.addClip(t, c.src, app.multiPos(), { off: c.off, dur: c.dur, gain: c.gain, fi: c.fi, fo: c.fo, fiCurve: c.fiCurve, foCurve: c.foCurve, name: c.name, ...AS.cloneClipProps(c) }); s.place(t, n); s.sel = n.id; multi.draw(); updateInfo(); app.multiChanged(true);
  }
  async function clipProperties(id) {
    const s = app.session, f = s.findClip(id); if (!f) return; const c = f.c;
    const r = await UI.dialog({ title: 'Clip Properties', fields: [
      { id: 'name', label: 'Name', type: 'text', value: c.name },
      { id: 'start', label: 'Start time', type: 'range', min: 0, max: Math.max(60, s.duration + 30), step: 0.001, value: +c.start.toFixed(3), unit: 's' },
      { id: 'gain', label: 'Clip gain', type: 'range', min: -30, max: 30, step: 0.1, value: c.gain, unit: 'dB' },
      { id: 'fi', label: 'Fade in', type: 'range', min: 0, max: +(c.dur / 2).toFixed(2), step: 0.01, value: c.fi, unit: 's' },
      { id: 'fiCurve', label: 'Fade-in curve', type: 'select', options: AS.CURVES, value: c.fiCurve || 'linear' },
      { id: 'fo', label: 'Fade out', type: 'range', min: 0, max: +(c.dur / 2).toFixed(2), step: 0.01, value: c.fo, unit: 's' },
      { id: 'foCurve', label: 'Fade-out curve', type: 'select', options: AS.CURVES, value: c.foCurve || 'linear' },
      { id: 'stretch', label: 'Stretch (length)', type: 'range', min: 25, max: 400, step: 0.1, value: +(AS.cstretch.scale(c) * 100).toFixed(1), unit: '%' },
      { id: 'pitch', label: 'Pitch shift', type: 'range', min: -12, max: 12, step: 0.01, value: +(c.pitch || 0), unit: 'st' },
      { id: 'mode', label: 'Stretch mode', type: 'select', options: AS.cstretch.MODES, value: c.stretchMode || 'polyphonic' },
      { id: 'match', label: c.src.tempo && c.src.tempo.bpm ? `Match to session tempo (clip ${c.src.tempo.bpm} BPM → session ${app.session.opts.tempo.bpm} BPM)` : 'Match to session tempo (detects the clip tempo first)', type: 'check', value: false },
      { id: 'n', type: 'note', label: 'Tip: hold Alt while dragging a clip edge to time-stretch it. Varispeed changes speed and pitch together (pitch shift is ignored).' }] });
    if (!r) return;
    s.push(); const moved = Math.abs(r.start - c.start) > 1e-9, shownFi = c.fi, shownFo = c.fo;
    Object.assign(c, { name: r.name, start: r.start, gain: r.gain, fiCurve: r.fiCurve, foCurve: r.foCurve, pitch: r.pitch, stretchMode: r.mode });
    if (Math.abs(r.stretch / 100 - AS.cstretch.scale(c)) > 1e-6) AS.cstretch.setStretch(c, r.stretch / 100);
    if (r.match && !(await matchClipTempo(c))) { /* message already shown */ }
    if (Math.abs(r.fi - shownFi) > 1e-9) c.fi = r.fi; if (Math.abs(r.fo - shownFo) > 1e-9) c.fo = r.fo; // only fades the user changed (stretching scales them)
    if (moved) s.place(f.t, c); else s.applyCrossfades(f.t);
    multi.draw(); app.stretchChanged(c); AS.panels.refreshAll();
  }
  /* stretch a clip so its material's tempo matches the session's (detects the clip's tempo when unknown) */
  async function matchClipTempo(c) {
    if (!c.src.tempo || !c.src.tempo.bpm) {
      const r = D.detectTempo(c.src.ch, c.src.sr);
      if (!r.bpm) { UI.toast('No steady tempo found in “' + c.name + '”. Set it in the Waveform editor (Edit > Tempo) first.', 'error'); return false; }
      c.src.tempo = { bpm: r.bpm, num: 4, den: 4, offset: r.offset, detected: true }; status(`Detected ${r.bpm} BPM in “${c.name}”.`);
    }
    return AS.cstretch.matchTempo(c, app.session.opts.tempo.bpm);
  }
  actions['mt.matchtempo'] = async () => {
    const s = app.session, f = s.sel && s.findClip(s.sel); if (!f) { UI.toast('Select a clip first.'); return; }
    s.push(); if (await matchClipTempo(f.c)) { s.applyCrossfades(f.t); app.stretchChanged(f.c); } else s.undoStack.pop();
  };

  /* ================= Effects rack ================= */
  /* the rack lives in the dockable Effects Rack panel (rackpanel.js); target = track object, null = master bus, {clip: id} = clip */
  function openRack(target) { return AS.rackpanel.open(target); }

  /* ================= Essential Sound auto-detect ================= */
  const TYPE_PRESET = { Dialogue: 'Dialogue', Music: 'Music', 'Sound effects': 'Sound effects', Ambience: 'Ambience' };
  async function classifyTrack(t) {
    const m = await AS.renderMix({ tracks: [{ ...t, vol: 0, pan: 0, mute: false, solo: false, fx: [], auto: { vol: [], pan: [] } }], master: { vol: 0, fx: [] }, duration: app.session.duration }, 22050);
    return D.classifySound([m.ch[0]], 22050);
  }
  const applyPreset = (t, name) => { t.fx = AS.rack.PRESETS[name]().map((f) => ({ ...f, p: { ...AS.rack.RACK[f.type].defaults, ...f.p } })); t.rackCfg = AS.rack.defaultCfg(); };
  async function autoEssential() {
    const s = app.session, targets = s.tracks.filter((t) => t.clips.length && !AS.rack.activeFx(t.fx).length);
    if (!targets.length) { UI.toast('No tracks with clips and an empty rack to analyze.'); return; }
    try {
      const res = await UI.busy('Analyzing track content…', async () => { const out = []; for (const t of targets) out.push([t, await classifyTrack(t)]); return out; });
      s.push(); const lines = [];
      for (const [t, c] of res) { applyPreset(t, TYPE_PRESET[c.type]); lines.push(`${t.name}: ${c.type}`); }
      multi.rebuildHeads(); app.multiChanged(true); AS.panels.refreshAll(); UI.toast('Essential Sound applied — ' + lines.join(', '));
    } catch (e) { reportErr(e); }
  }

  /* ================= Spectral editing ================= */
  /* Delete / Attenuate / Amplify / Spot Heal the spectral selection (marquee, lasso, brush or harmonics) */
  async function spectralApply(mode, gainDb, label) {
    const d = app.cur;
    if (!d || !d.spec) { UI.toast('Switch to Spectral view and select a time/frequency region first (Marquee, Lasso, Brush or Auto-select Harmonics).'); return false; }
    const sp = d.spec, bd = D.shapeBounds(sp), pad = 4096, a = Math.max(0, Math.floor(bd.a) - pad), b = Math.min(d.len, Math.ceil(bd.b) + pad), chIdx = d.enabled();
    try {
      if (app.playDoc === d) stop(false);
      const slice = chIdx.map((i) => d.ch[i].slice(a, b));
      const out = await withJob('Spectral edit…', () => AS.jobs.spectral(slice, d.sr, { shape: D.shapeShift(sp, -a), mode, gainDb }));
      d.set(mergeResult(d, chIdx, a, b, out), label, d.sel); d.spec = sp; wave.specCache = null; wave.draw(); updateFiles();
      return true;
    } catch (e) { reportErr(e); return false; }
  }
  async function spectralGain(sign) {
    if (!app.cur || !app.cur.spec) { UI.toast('Make a spectral selection in Spectral view first.'); return; }
    const r = await UI.dialog({ title: sign < 0 ? 'Attenuate Selection' : 'Amplify Selection', fields: [{ id: 'g', label: 'Amount', type: 'range', min: 0, max: sign < 0 ? 80 : 24, step: 0.5, value: sign < 0 ? 20 : 6, unit: 'dB' }] });
    if (r) spectralApply('atten', sign * r.g, sign < 0 ? 'Spectral Attenuate' : 'Spectral Amplify');
  }
  /* Spot Healing Brush: the painted stroke is healed as soon as the mouse is released (one undo step) */
  async function spotHeal() {
    const d = app.cur; if (!d || !d.spec) return false;
    const done = await spectralApply('heal', 0, 'Spot Healing Brush');
    if (done) { d.spec = null; wave.draw(); status('Healed.'); }
    return done;
  }
  /* Auto-select harmonics: click a sound in Spectral view → its pitch over time and all its harmonics */
  async function harmonicsAt(s, f) {
    const d = app.cur; if (!d) return null;
    const sh = await UI.busy('Finding the harmonics…', async () => D.harmonicSelect(d.enabled().map((i) => d.ch[i]), d.sr, s, f));
    if (!sh.track.length) { UI.toast('No sound to select there.'); return null; }
    d.spec = sh; wave.draw(); app.specChanged(); return sh;
  }
  const TOOL_NAMES = { time: 'Time Selection', marquee: 'Marquee Selection', lasso: 'Lasso Selection', brush: 'Brush Selection', heal: 'Spot Healing Brush', harm: 'Auto-select Harmonics' };
  function setTool(t) {
    if (!(t in TOOL_NAMES)) return;
    if (t !== 'time' && !app.specMode) setSpec(true);
    wave.tool = t; document.querySelectorAll('#specTools button[data-tool]').forEach((b) => b.classList.toggle('on', b.dataset.tool === t));
    wave.mainC.style.cursor = t === 'time' ? 'text' : 'crosshair'; $('#brushSize').hidden = !(t === 'brush' || t === 'heal');
    if (t !== 'time') status(TOOL_NAMES[t] + (t === 'brush' ? ' — paint over a sound (Shift adds to the selection)' : t === 'heal' ? ' — paint over a click or noise to heal it' : t === 'harm' ? ' — click a sound to select it with its harmonics' : ''));
  }
  app.setTool = setTool;
  async function spectralSettings() {
    const SPx = AS.spectral, st = SPx.settings();
    const r = await UI.dialog({ title: 'Spectral Display Settings', okLabel: 'OK', fields: [
      { id: 'fft', label: 'FFT size (resolution)', type: 'select', options: SPx.FFTS.map((n) => [n, n + (n <= 512 ? ' (fast time)' : n >= 8192 ? ' (fine frequency)' : '')]), value: st.fft },
      { id: 'win', label: 'Window', type: 'select', options: Object.entries(D.WINDOWS), value: st.win },
      { id: 'dbMin', label: 'Range floor', type: 'range', min: -160, max: -40, step: 1, value: st.dbMin, unit: 'dB' },
      { id: 'dbMax', label: 'Range top', type: 'range', min: -60, max: 0, step: 1, value: st.dbMax, unit: 'dB' },
      { id: 'cmap', label: 'Color map', type: 'select', options: Object.entries(SPx.COLORMAPS).map(([k, v]) => [k, v[0]]), value: st.cmap },
      { id: 'pitch', label: 'Show pitch (Spectral Pitch Display)', type: 'check', value: st.pitch }],
      onChange(v) { SPx.set(v); wave.specCache = null; wave.draw(); } });
    if (!r) SPx.set(st); else SPx.set(r);
    wave.specCache = null; wave.draw();
  }

  /* ================= Batch processing ================= */
  /* Batch Process: one effect or a (multi-step) Favorite on the whole of every open file, then optionally export
     each with a file-name template. o: {docs, steps, label, fmt ('none' = edit in place), template, dir} */
  async function batchRun(o) {
    const docs = o.docs || app.docs.slice(), F = AS.favorites; let n = 0, job = null, cancelled = false; const written = [];
    let dir = o.dir || null; const files = window.audioStageFiles;
    if (o.fmt !== 'none' && files && !dir) { const r = await files.pickFolder('Batch Process: export to folder'); if (!r.ok || !r.dir) return null; dir = r.dir; }
    try {
      for (const d of docs) {
        n++;
        const out = await UI.busy(`Batch ${n}/${docs.length}: ${d.name}`, () => F.process(d.ch.map((c) => c.slice()), d.sr, o.steps, (id, c, sr, p) => (job = AS.jobs.fx(id, c, sr, p, app.noiseProfile)), (i, st) => status(`Batch ${n}/${docs.length}: ${d.name} — step ${i + 1}/${o.steps.length}: ${F.describe(st)}`)), () => { cancelled = true; if (job) job.cancel(); });
        if (app.playDoc === d) stop(false);
        d.set(out, 'Batch: ' + o.label, { a: 0, b: 0 });
        if (o.fmt !== 'none') {
          const base = d.name.replace(/\.\w+$/, ''), f = FORMATS[o.fmt], name = F.fileName(AS.tags.fillTemplate(o.template || '{name}_processed', d.meta, base), { name: base, n, fav: o.label, ext: f.ext });
          const buf = await encodeBytes(d.ch, d.sr, o.fmt, true, `Exporting ${n}/${docs.length}: ${name}`, d.meta ? { tags: d.meta } : null);
          if (files) { const w = await files.write(dir, name, new Uint8Array(buf)); if (!w.ok) throw new Error(w.error); written.push(w.name || name); } else { download(buf, name, f.mime); written.push(name); } // (an existing file is kept: the new one gets " (2)")
        }
      }
      status(`Batch finished: ${n} file(s) processed${written.length ? ', ' + written.length + ' exported' + (dir ? ' to ' + dir : '') : ''}.`);
    } catch (e) { if (cancelled) UI.toast('Batch cancelled after ' + (n - 1) + ' file(s).'); else reportErr(e); }
    wave.specCache = null; wave.draw(); updateFiles(); updateInfo();
    return { n, written, dir };
  }
  app.batchRun = batchRun;
  async function batchProcess() {
    if (!app.docs.length) { UI.toast('Open some files first.'); return; }
    const list = E.FX.filter((f) => !f.needsProfile || app.noiseProfile), favs = AS.favorites.all();
    const r = await UI.dialog({ title: 'Batch Process', okLabel: 'Next…', width: 520, html: `<div class="note">Processes the whole of every open file (${app.docs.length}) with one effect or a Favorite (any number of steps). Each file stays undoable.</div>`, fields: [
      { id: 'what', label: 'Process with', type: 'select', options: [...favs.map((f) => ['fav:' + f.id, '★ ' + f.name]), ...list.map((f) => [f.id, f.name.replace('...', '')])], value: 'loudnorm' },
      { id: 'fmt', label: 'Then export as', type: 'select', options: [['none', 'Do not export (edit in place)'], ...fmtOptions()], value: 'none' },
      { id: 'template', label: 'File names', type: 'text', value: '{name}_processed' },
      { id: 'n', type: 'note', label: 'Name template: {name} = original name, {n} / {nn} = 1, 2 / 01, 02 …, {fav} = favorite or effect name, {date} = today, {title} {artist} {album} {year} {track} = the file’s metadata (File Info). ' + (window.audioStageFiles ? 'You choose the destination folder next.' : 'Each file is downloaded.') }] });
    if (!r) return;
    let steps, label;
    if (r.what.startsWith('fav:')) { const f = AS.favorites.byId(r.what.slice(4)); steps = f.steps; label = f.name; }
    else {
      const fx = E.byId(r.what); let params = E.defaults(fx); label = fx.name.replace('...', '');
      if (fx.params.length) { const p = await UI.dialog({ title: label, fields: paramFields(fx, lastParams[fx.id]), okLabel: `Run on ${app.docs.length} files` }); if (!p) return; params = p; lastParams[fx.id] = p; }
      steps = [AS.favorites.fxStep(fx.id, params)];
    }
    await batchRun({ steps, label, fmt: r.fmt, template: r.template });
  }

  /* ================= Favorites ================= */
  /* apply a favorite: the selection / whole file (Waveform, one undo step) or the selected clip (Multitrack) */
  async function applyFavorite(id) {
    const F = AS.favorites, fav = F.byId(id); if (!fav) { UI.toast('That favorite no longer exists.'); return false; }
    let job = null; const runFx = (fid, c, sr, p) => (job = AS.jobs.fx(fid, c, sr, p, app.noiseProfile)), cancel = () => job && job.cancel();
    const prog = (i, st) => status(`★ ${fav.name} — step ${i + 1}/${fav.steps.length}: ${F.describe(st)}`);
    try {
      if (app.mode === 'multi') {
        const f = app.session.sel && app.session.findClip(app.session.sel); if (!f) { UI.toast('Select a clip in the multitrack first.'); return false; }
        const c = f.c, ps = (await AS.cstretch.ensure(c)) || c.src, s0 = Math.round(c.off * ps.sr), s1 = Math.round((c.off + c.dur) * ps.sr);
        const out = await UI.busy('★ ' + fav.name + '…', () => F.process(D.sliceCh(ps.ch, s0, s1), ps.sr, fav.steps, runFx, prog), cancel);
        app.session.push(); c.src = AS.makeSource(c.src.name, c.src.sr, out); c.off = 0; c.dur = c.src.dur; c.stretch = 1; c.pitch = 0; multi.draw(); updateInfo(); app.multiChanged(true);
      } else {
        if (!needDoc()) return false; const d = app.cur; if (app.playDoc === d) stop(false);
        const whole = F.changesChannels(fav.steps) || !d.hasSel(), [a, b] = whole ? [0, d.len] : [d.sel.a, d.sel.b], chIdx = F.changesChannels(fav.steps) ? d.ch.map((_, i) => i) : d.enabled();
        const out = await UI.busy('★ ' + fav.name + '…', () => F.process(chIdx.map((i) => d.ch[i].slice(a, b)), d.sr, fav.steps, runFx, prog), cancel);
        if (out.length !== d.ch.length) d.set(out, '★ ' + fav.name, { a: 0, b: 0 }); // channel count changed (Convert to Mono / Stereo)
        else d.set(mergeResult(d, chIdx, a, b, out), '★ ' + fav.name, whole ? { a: d.sel.a, b: d.sel.a } : { a, b: a + out[0].length });
        wave.specCache = null; wave.draw(); updateInfo(); updateFiles();
      }
      app.lastFx = { fav: id }; F.recorder.push && fav.steps.forEach((s) => F.recorder.push(s));
      status(`★ ${fav.name} applied.`); return true;
    } catch (e) { reportErr(e); return false; }
  }
  app.applyFavorite = applyFavorite;
  function favRecord() {
    const R = AS.favorites.recorder;
    if (!R.active()) { R.start(); status('● Recording a favorite: apply effects (and Convert to Mono/Stereo, Trim Silence) — then Favorites > Stop Recording.'); AS.panels.refreshAll(); return; }
    return favStop();
  }
  async function favStop() {
    const R = AS.favorites.recorder; if (!R.active()) return null; const steps = R.stop(); AS.panels.refreshAll();
    if (!steps.length) { UI.toast('Nothing was recorded — apply effects while recording.'); return null; }
    const r = await UI.dialog({ title: 'Save Favorite', okLabel: 'Save', fields: [{ id: 'name', label: 'Name', type: 'text', value: 'My favorite ' + (AS.favorites.all().length + 1) }, { id: 'n', type: 'note', label: steps.map((s, i) => `${i + 1}. ${UI.esc(AS.favorites.describe(s))}`).join('<br>') }] });
    if (!r) return null; const f = AS.favorites.add(r.name, steps); AS.panels.refreshAll(); status(`Favorite “${f.name}” saved (${steps.length} step(s)).`); return f;
  }
  async function favFromLast() {
    const l = app.lastFx; if (!l || !l.fx) { UI.toast('Apply an effect first — then it can be saved as a favorite with its settings.'); return null; }
    const r = await UI.dialog({ title: 'Save Last Effect as Favorite', okLabel: 'Save', fields: [{ id: 'name', label: 'Name', type: 'text', value: l.fx.name.replace('...', '') }, { id: 'n', type: 'note', label: UI.esc(AS.favorites.describe(AS.favorites.fxStep(l.fx.id, l.p))) }] });
    if (!r) return null; const f = AS.favorites.add(r.name, [AS.favorites.fxStep(l.fx.id, l.p)]); AS.panels.refreshAll(); return f;
  }
  Object.assign(actions, { 'fav.record': favRecord, 'fav.stop': favStop, 'fav.fromLast': favFromLast, 'fav.panel': () => AS.panels.show('favorites', { focus: true }) });
  app.favRecord = favRecord; app.favStop = favStop;

  /* ================= Keyboard shortcuts editor ================= */
  async function keysDialog() {
    const K = AS.keys, list = K.collect(menuDefs), work = K.state();
    const render = (el) => {
      const conf = K.conflicts(list, work), q = (el.querySelector('.ks-q').value || '').toLowerCase();
      el.querySelector('.ks-conf').innerHTML = Object.keys(conf).length ? '⚠ The same key is used by several commands: ' + Object.entries(conf).map(([k, ids]) => `<b>${UI.esc(k)}</b> (${ids.map((id) => UI.esc(list.find((c) => c.id === id).label.split(' › ').pop())).join(', ')})`).join('; ') : 'No conflicts.';
      el.querySelector('.ks-list').innerHTML = list.filter((c) => !q || c.label.toLowerCase().includes(q) || K.effective(c.id, c.dflt, work).toLowerCase().includes(q)).map((c) => {
        const k = K.effective(c.id, c.dflt, work), bad = k && conf[k];
        return `<tr data-id="${UI.esc(c.id)}"><td>${UI.esc(c.label)}</td><td><button class="btn sm ks-key ${bad ? 'danger' : ''}" title="Click, then press the new key combination (Esc cancels, Backspace clears)">${UI.esc(k || '—')}</button></td><td><button class="sm" data-a="clr" title="No shortcut">×</button> <button class="sm" data-a="def" title="Back to the default">↺</button></td></tr>`;
      }).join('');
    };
    const r = await UI.dialog({ title: 'Keyboard Shortcuts', okLabel: 'Save', width: 640,
      html: `<div class="frow"><label>Preset</label><select class="ks-preset">${Object.entries(K.PRESETS).map(([k, [n]]) => `<option value="${k}" ${k === work.preset ? 'selected' : ''}>${UI.esc(n)}</option>`).join('')}</select></div>
        <div class="note">The “Adobe Audition” preset uses Audition’s default keys for the commands AudioStage has (others keep AudioStage’s keys). Your own changes are kept on top of the preset.</div>
        <input class="ks-q txt" type="search" placeholder="Search commands or keys…" style="width:100%;margin:6px 0"><div class="ks-wrap"><table class="stats ks-list"></table></div><div class="note ks-conf"></div>`,
      onReady(el) {
        render(el);
        el.querySelector('.ks-preset').onchange = (e) => { work.preset = e.target.value; work.map = {}; render(el); };
        el.querySelector('.ks-q').addEventListener('input', () => render(el));
        el.querySelector('.ks-list').addEventListener('click', (e) => {
          const tr = e.target.closest('[data-id]'); if (!tr) return; const id = tr.dataset.id, c = list.find((x) => x.id === id);
          if (e.target.closest('[data-a="clr"]')) { work.map[id] = ''; render(el); return; }
          if (e.target.closest('[data-a="def"]')) { delete work.map[id]; render(el); return; }
          const b = e.target.closest('.ks-key'); if (!b) return;
          b.textContent = 'Press keys…'; b.classList.add('rec');
          // (window capture runs before the dialog's own Enter / Esc handling, so Enter or Esc combos can be assigned)
          const onKey = (ev) => {
            ev.preventDefault(); ev.stopPropagation();
            if (ev.key === 'Escape' && !ev.ctrlKey && !ev.shiftKey && !ev.altKey) { done(); return; }
            if (ev.key === 'Backspace' && !ev.ctrlKey && !ev.shiftKey && !ev.altKey) { work.map[id] = ''; done(); return; }
            const k = K.fromEvent(ev); if (!k) return; work.map[id] = k; done();
          };
          const done = () => { window.removeEventListener('keydown', onKey, true); render(el); void c; };
          window.addEventListener('keydown', onKey, true);
        });
      } });
    if (!r) return false;
    K.setState(work); app.refreshKeys(); status('Keyboard shortcuts saved.'); return true;
  }
  actions['edit.keys'] = keysDialog;
  actions['file.exportFcp'] = () => exportFCP7();
  actions['file.importFcp'] = () => { const i = document.createElement('input'); i.type = 'file'; i.accept = '.xml,application/xml,text/xml'; i.onchange = () => { if (i.files[0]) importFCP7(i.files[0]); }; i.click(); };

  /* ================= Auto-ducking (multitrack) ================= */
  async function autoDuck() {
    const s = app.session, keys = s.tracks.filter((t) => t.clips.length);
    if (keys.length < 2) { UI.toast('Auto-ducking needs at least two tracks with clips.'); return; }
    const r = await UI.dialog({ title: 'Auto-Duck', okLabel: 'Apply', html: '<div class="note">Lowers the target tracks’ volume (as automation) whenever the key track (e.g. voice) is active.</div>', fields: [
      { id: 'key', label: 'Key track (voice)', type: 'select', options: keys.map((t) => [t.id, t.name]), value: keys[0].id },
      { id: 'target', label: 'Duck', type: 'select', options: [['*', 'All other tracks'], ...s.tracks.map((t) => [t.id, t.name])], value: '*' },
      { id: 'amount', label: 'Duck amount', type: 'range', min: 3, max: 36, step: 0.5, value: 14, unit: 'dB' },
      { id: 'thr', label: 'Detection threshold', type: 'range', min: -70, max: -15, step: 1, value: -42, unit: 'dB' },
      { id: 'att', label: 'Fade down', type: 'range', min: 20, max: 1000, step: 10, value: 150, unit: 'ms' },
      { id: 'rel', label: 'Fade up', type: 'range', min: 50, max: 3000, step: 10, value: 600, unit: 'ms' }] });
    if (!r) return;
    try {
      const key = s.tracks.find((t) => t.id === r.key), sr = 22050;
      const m = await UI.busy('Analyzing key track…', () => AS.renderMix({ tracks: [{ ...key, vol: 0, pan: 0, mute: false, solo: false, fx: [], auto: { vol: [], pan: [] } }], master: { vol: 0, fx: [] }, duration: s.duration }, sr));
      const win = Math.round(sr * 0.025), thr = D.fromDb(r.thr), act = [];
      for (let i = 0; i + win <= m.ch[0].length; i += win) { let sq = 0; for (let k = i; k < i + win; k++) sq += m.ch[0][k] * m.ch[0][k] + m.ch[1][k] * m.ch[1][k]; act.push(Math.sqrt(sq / (2 * win)) > thr); }
      const segs = []; let st = -1;
      act.forEach((on, i) => { if (on && st < 0) st = i; if (!on && st >= 0) { segs.push([st * 0.025, i * 0.025]); st = -1; } });
      if (st >= 0) segs.push([st * 0.025, act.length * 0.025]);
      const att = r.att / 1000, rel = r.rel / 1000, merged = [];
      for (const sg of segs) { const l = merged[merged.length - 1]; if (l && sg[0] - l[1] < att + rel + 0.1) l[1] = sg[1]; else merged.push([...sg]); }
      s.push();
      for (const t of s.tracks) {
        if (t.id === key.id || (r.target !== '*' && t.id !== r.target)) continue;
        const pts = [];
        for (const [a, b] of merged) { pts.push({ t: Math.max(0, a - att), v: t.vol }, { t: a, v: t.vol - r.amount }, { t: b, v: t.vol - r.amount }, { t: b + rel, v: t.vol }); }
        const uniq = []; for (const p of pts) { const l = uniq[uniq.length - 1]; if (l && p.t <= l.t) p.t = l.t + 0.001; uniq.push(p); }
        t.auto.vol = uniq;
      }
      multi.autoMode = 'vol'; $('#mtAuto').value = 'vol'; multi.draw(); app.multiChanged(true);
      UI.toast(`Ducking applied: ${merged.length} speech region(s) found. Edit the envelopes via Auto: Volume.`);
    } catch (e) { reportErr(e); }
  }

  /* ================= Audio hardware ================= */
  /* File > Audio Hardware Setup… is the Audio Hardware tab of Preferences (devices: eng.outId / eng.inId, saved as as-audio) */
  try { const a = JSON.parse(localStorage.getItem('as-audio') || 'null'); if (a) { eng.outId = a.out; eng.inId = a.in; } } catch (e) { /* */ }

  /* ================= Video preview (synced to playhead) ================= */
  const vid = $('#videoEl');
  let vidUrl = '';
  /* what the Video panel shows: the open file's video (Waveform) or the session's video track (Multitrack) */
  function videoSource() {
    if (app.mode === 'wave') { const d = app.cur; return d && d.videoUrl ? { url: d.videoUrl, t: app.playSample(d) / d.sr, playing: eng.playing && app.playDoc === d } : null; }
    const vt = AS.vtrack.find(app.session), url = AS.vtrack.urlOf(vt);
    return url ? { url, t: app.multiPos() - vt.video.start, playing: eng.playing } : null;
  }
  function updateVideo() {
    const v = videoSource();
    $('#videoPanel').hidden = !(v && AS.panels.isVisible('video'));
    if (v && vidUrl !== v.url) { vidUrl = v.url; vid.src = v.url; }
    if (!v) vid.pause();
  }
  function syncVideo() {
    const v = videoSource(); if (!v || vid.readyState < 1) return;
    const t = Math.max(0, Math.min(v.t, (vid.duration || Infinity) - 0.01)), inside = v.t >= 0 && v.t < (vid.duration || Infinity);
    if (v.playing && inside) {
      if (Math.abs(vid.currentTime - t) > 0.25) vid.currentTime = t;
      if (vid.paused) vid.play().catch(() => {});
    } else { if (!vid.paused) vid.pause(); if (Math.abs(vid.currentTime - t) > 0.04) vid.currentTime = t; }
  }
  app.syncVideo = () => { updateVideo(); syncVideo(); };
  app.videoChanged = () => { updateVideo(); multi.draw(); };
  /* Multitrack > Insert Video…: the video becomes the session's video track and its soundtrack an audio clip */
  async function insertVideo(file, at, knownPath) {
    const s = app.session, path = knownPath || (window.audioStageVideo ? window.audioStageVideo.pathOf(file) : '');
    const url = path ? AS.vtrack.fileUrl(path) : URL.createObjectURL(file), name = file.name.replace(/\.\w+$/, '');
    const dur = await new Promise((r) => { const el = document.createElement('video'); el.preload = 'metadata'; el.onloadedmetadata = () => r(el.duration || 0); el.onerror = () => r(0); el.src = url; });
    let res = null; try { res = await UI.busy('Reading the video’s soundtrack…', () => decodeFile(file)); } catch (e) { /* video without (decodable) audio */ }
    s.push(); setMode('multi');
    const vt = AS.vtrack.setVideo(s, { name, path, url, dur: dur || (res ? res.ch[0].length / res.sr : 0), start: at || 0 });
    if (res && res.ch[0].length) { const tr = s.audioTrackAt(s.tracks.indexOf(vt) + 1), c = s.addClip(tr, AS.makeSource(name + ' (audio)', res.sr, res.ch), at || 0); s.place(tr, c); }
    multi.rebuildHeads(); multi.resize(); if (s.duration * multi.pps > multi.W) multi.zoomAll();
    AS.panels.show('video'); updateVideo(); app.multiChanged(true);
    status(`Video “${name}” added${res ? ' with its soundtrack on an audio track' : ' (no audio track found in it)'}.`);
    return vt;
  }
  app.insertVideo = insertVideo;
  /* File > Export Video with Mixdown…: the session's video with the multitrack mixdown as its soundtrack (ffmpeg) */
  async function exportVideo(o) {
    const vt = AS.vtrack.find(app.session), api = window.audioStageVideo;
    if (!vt) { UI.toast('Insert a video into the multitrack first (Multitrack > Insert Video…).'); return null; }
    if (!api) { UI.toast('Exporting into a video needs the desktop app (npm start) and ffmpeg.', 'error'); return null; }
    if (!vt.video.path) { UI.toast('The video file’s location is unknown — insert the video again.', 'error'); return null; }
    let ff = await api.ffmpeg();
    if (!ff.ok || !ff.ffmpeg) {
      if (!AS.runtimes.available || !(await UI.dialog({ title: 'ffmpeg is needed', okLabel: 'Install ffmpeg…', html: '<p>Export Video with Mixdown uses ffmpeg (free, LGPL), which is not installed yet.</p><p class="note">AudioStage can download an LGPL build into its own data folder — or install ffmpeg yourself and put it on PATH.</p>' }))) return null;
      if (!(await AS.runtimes.manage('ffmpeg', { auto: true }))) return null;
      ff = await api.ffmpeg(); if (!ff.ok || !ff.ffmpeg) { UI.toast('ffmpeg is still not available.', 'error'); return null; }
    }
    try {
      const v = vt.video, sr = 48000, m = await UI.busy('Rendering the mixdown…', () => AS.renderRange(app.session, sr, v.start, v.start + (v.dur || app.session.duration), null, 0));
      const wav = new Uint8Array(await UI.busy('Encoding…', () => AS.jobs.encode(m.ch.map((c) => c.slice()), sr, { format: 'wav', bits: 24 })));
      const r = await UI.busy('Writing the video (ffmpeg)…', () => api.mux(v.path, wav, o && o.out));
      if (!r.ok) throw new Error(r.error); if (!r.path) return null;
      status('Video exported: ' + r.path); UI.toast('Video exported: ' + r.path); return r.path;
    } catch (e) { reportErr(e); return null; }
  }
  app.exportVideo = exportVideo;

  /* ================= Time display formats ================= */
  function fmtDisp(sec) {
    const sr = (app.cur && app.cur.sr) || 44100, f = TF[tfi];
    if (f === 'samples') return String(Math.round(sec * sr));
    if (f === 'smpte') { const fr = Math.floor((sec % 1) * 30), t = Math.floor(sec); return [Math.floor(t / 3600), Math.floor((t % 3600) / 60) % 60, t % 60].map((x) => String(x).padStart(2, '0')).join(':') + ':' + String(fr).padStart(2, '0'); }
    if (f === 'bars') return AS.tempo.fmt(sec, app.tempo()); // bar | beat | tick at the session / file tempo
    return fmtTime(sec);
  }

  /* ================= Tempo, grid and metronome ================= */
  /* audio to detect the tempo from: the selection / file (Waveform), the selected clip or the whole mix (Multitrack);
     `at` = timeline time of the analysed audio's first sample */
  async function tempoSource() {
    if (app.mode !== 'multi') { const d = app.cur; const [a, b] = d.range(); return { ch: D.sliceCh(d.ch, a, b), sr: d.sr, at: a / d.sr, what: d.hasSel() ? 'the selection' : 'the file' }; }
    const s = app.session, f = s.sel && s.findClip(s.sel);
    if (f) { const c = f.c, ps = (await AS.cstretch.ensure(c)) || c.src, sr = ps.sr; return { ch: D.sliceCh(ps.ch, Math.round(c.off * sr), Math.round((c.off + c.dur) * sr)), sr, at: c.start, what: 'clip “' + c.name + '”' }; }
    const m = await AS.renderMix(s, 22050); return { ch: m.ch, sr: m.sr, at: 0, what: 'the mix' };
  }
  async function tempoDialog() {
    const multiMode = app.mode === 'multi', d = app.cur;
    if (!multiMode && !d) { UI.toast('Open a file first (or switch to Multitrack for the session tempo).'); return; }
    const t = app.tempo();
    const r = await UI.dialog({ title: 'Tempo and Time Signature', okLabel: 'Apply', width: 480,
      html: `<div class="note">${multiMode ? 'Session tempo: Bars:Beats rulers and time display, Snap to Grid and the metronome.' : 'Tempo of “' + UI.esc(d.name) + '” (Bars:Beats ruler / display, metronome).'} Switch the time display to Bars:Beats with View > Cycle Time Display Format.</div>
        <div class="frow"><label>Auto-detect</label><button class="btn" data-detect>Detect from audio</button><span class="tdres note" style="margin:0 0 0 8px"></span></div>`,
      fields: [
        { id: 'bpm', label: 'Tempo', type: 'range', min: 20, max: 300, step: 0.01, value: t.bpm, unit: 'BPM' },
        { id: 'num', label: 'Beats per bar', type: 'range', min: 1, max: 16, step: 1, value: t.num },
        { id: 'den', label: 'Beat unit', type: 'select', options: [[2, 'Half note (x/2)'], [4, 'Quarter note (x/4)'], [8, 'Eighth note (x/8)'], [16, 'Sixteenth (x/16)']], value: t.den },
        { id: 'offset', label: 'Bar 1 starts at', type: 'range', min: 0, max: 30, step: 0.001, value: +t.offset.toFixed(3), unit: 's' }],
      onReady(el) {
        const res = el.querySelector('.tdres'), setv = (id, v) => { const i = el.querySelector(`[data-id="${id}"]`); i.value = v; i.dispatchEvent(new Event('input')); };
        el.querySelector('[data-detect]').onclick = async () => {
          res.textContent = 'Analysing…';
          try {
            const src = await tempoSource(), r2 = D.detectTempo(src.ch, src.sr);
            if (!r2.bpm) { res.textContent = 'No steady beat found in ' + src.what + '.'; return; }
            const use = (bpm) => { setv('bpm', bpm); const beat = 60 / bpm; setv('offset', +((src.at + r2.offset) % beat).toFixed(3)); };
            use(r2.bpm);
            res.innerHTML = `${UI.esc(src.what)}: <b>${r2.bpm}</b> BPM (confidence ${Math.round(r2.confidence * 100)}%) ` + r2.candidates.slice(1).map((b) => `<button class="sm" data-bpm="${b}" title="Half / double tempo">${b}</button>`).join(' ');
            res.querySelectorAll('[data-bpm]').forEach((b) => (b.onclick = () => use(+b.dataset.bpm)));
          } catch (e) { res.textContent = e.message; }
        };
      } });
    if (!r) return;
    const nt = AS.tempo.norm({ bpm: r.bpm, num: r.num, den: +r.den, offset: r.offset });
    if (multiMode) { const s = app.session; s.push(); s.opts.tempo = nt; multi.draw(); app.multiChanged(); }
    else { d.setMeta('Tempo', (x) => { x.tempo = nt; }); wave.draw(); }
    lastTime = ''; updateInfo(); restartMetro(); status(`Tempo ${nt.bpm} BPM, ${nt.num}/${nt.den}`);
  }
  actions['edit.tempo'] = tempoDialog;
  for (const [k] of [['off'], ...AS.tempo.DIVS]) actions['mt.grid.' + k] = () => setMultiOpt('snapGrid', k);

  /* metronome: follows the transport (and counts in before recording) */
  const MS = AS.metronome.settings;
  let metro = null;
  function stopMetro() { if (metro) { metro.stop(); metro = null; } }
  function startMetro(countIn) {
    stopMetro();
    if (!MS.on || !eng.playing && !countIn) return;
    if (MS.recOnly && !app.recording) return;
    metro = AS.metronome.start(eng.ctx, eng.ctx.destination, app.tempo(), { t0: eng.t0, from: eng.startPos, loopLen: eng.loopLen, loopStart: eng.loopLen ? eng.loopStartSec : null }, { countIn: countIn || 0 });
  }
  function restartMetro() { if (eng.playing) startMetro(); }
  function updateMetroBtn() { $('#bMetro').classList.toggle('on', !!MS.on); }
  async function metronomeSettings() {
    const r = await UI.dialog({ title: 'Metronome', okLabel: 'OK', fields: [
      { id: 'on', label: 'Metronome on', type: 'check', value: MS.on },
      { id: 'sound', label: 'Sound', type: 'select', options: AS.metronome.SOUNDS, value: MS.sound },
      { id: 'db', label: 'Level', type: 'range', min: -40, max: 6, step: 0.5, value: MS.db, unit: 'dB' },
      { id: 'countIn', label: 'Count-in before recording', type: 'select', options: [[0, 'None'], [1, '1 bar'], [2, '2 bars']], value: MS.countIn },
      { id: 'recOnly', label: 'Only while recording', type: 'check', value: MS.recOnly },
      { id: 'n', type: 'note', label: 'The metronome is for monitoring only: it is never part of a mixdown or export. It follows the session tempo (Multitrack) or the file tempo (Waveform).' }],
      preview: { start(v) { eng.init(); const t0 = eng.ctx.currentTime + 0.05, tp = app.tempo(); for (const c of AS.tempo.clicks(0, AS.tempo.barLen(tp), { ...tp, offset: 0 })) AS.metronome.click(eng.ctx, eng.ctx.destination, t0 + c.time, c.accent, v.sound, Math.pow(10, v.db / 20)); }, stop() {} } });
    if (!r) return;
    Object.assign(MS, { on: r.on, sound: r.sound, db: r.db, countIn: +r.countIn, recOnly: r.recOnly }); AS.metronome.save(); updateMetroBtn(); restartMetro();
  }
  actions['tp.metro'] = () => { MS.on = !MS.on; AS.metronome.save(); updateMetroBtn(); if (MS.on) restartMetro(); else stopMetro(); status('Metronome ' + (MS.on ? 'on' : 'off')); };
  actions['tp.metroset'] = metronomeSettings;

  /* ================= Autosave, crash recovery, project versions ================= */
  const AU = AS.autosave, ST = AS.store;
  const AS_KEY = 'as-autosave', AUS = (() => { try { return { on: true, minutes: 2, ...(JSON.parse(localStorage.getItem(AS_KEY)) || {}) }; } catch (e) { return { on: true, minutes: 2 }; } })();
  let lastSig = '', lastSave = 0, saving = null;
  const workSig = () => [app.session.undoStack.length, app.session.redoStack.length, app.session.tracks.length, ...app.docs.map((d) => d.id + ':' + d.version + ':' + d.dirty + ':' + d.undoStack.length + ':' + d.redoStack.length)].join('|');
  const hasWork = () => app.session.tracks.some((t) => t.clips.length) || app.docs.some((d) => d.dirty);
  async function autosaveNow(force) {
    if (saving) return saving; const sig = workSig();
    if (!force && (sig === lastSig || !hasWork())) return null;
    saving = AU.saveNow(ST, { session: app.session, docs: app.docs, mode: app.mode })
      .then((m) => { lastSig = sig; lastSave = Date.now(); $('#statusMsg').title = 'Autosaved ' + new Date().toLocaleTimeString(); for (const sp of doneSpools.splice(0)) sp.stop(); return m; })
      .catch((e) => { console.warn('Autosave failed:', e); status('Autosave failed: ' + (e.message || e)); return null; })
      .finally(() => { saving = null; });
    return saving;
  }
  app.autosaveNow = autosaveNow; app.autosaveOpts = AUS;
  setInterval(() => { if (AUS.on && !app.recording && Date.now() - lastSave >= AUS.minutes * 60000) autosaveNow(); }, 15000);
  async function autosaveSettings() {
    const r = await UI.dialog({ title: 'Autosave', fields: [
      { id: 'on', label: 'Autosave the session and unsaved files', type: 'check', value: AUS.on },
      { id: 'minutes', label: 'Every', type: 'range', min: 1, max: 30, step: 1, value: AUS.minutes, unit: 'min' },
      { id: 'n', type: 'note', label: `Kept on this computer (${ST.kind === 'disk' ? 'the app’s data folder' : 'browser storage'}), never uploaded. After a crash the app offers to recover it at the next start. Project versions are kept there too (File > Versions…).` }] });
    if (!r) return; Object.assign(AUS, { on: r.on, minutes: r.minutes }); try { localStorage.setItem(AS_KEY, JSON.stringify(AUS)); } catch (e) { /* */ }
  }
  function useRecovered(r) {
    for (const d0 of r.docs) { const d = addDoc(d0.name, d0.sr, d0.ch); d.sel = d0.sel || d.sel; d.markers = d0.markers || []; d.playlist = d0.playlist || []; d.tempo = d0.tempo || null; d.meta = d0.meta || null; d.dirty = true; if (d0.path) { d.path = d0.path; d.savable = false; } }
    if (r.session.tracks.some((t) => t.clips.length) || r.mode === 'multi') { r.session.dirty = true; if (r.sessionFile) { r.session.fileName = r.sessionFile.name || ''; r.session.filePath = r.sessionFile.path || ''; } useSession(r.session); }
    updateFiles(); updateMarkers();
  }
  /* start-up: did the last run end normally? If not and there is an autosave, offer to recover it */
  let lastRunCrashed = false;
  async function checkRecovery() {
    const crashed = (lastRunCrashed = AU.boot()); let man = null;
    try { man = await AU.readAutosave(ST); } catch (e) { return; }
    if (!man) return;
    if (!crashed) { AU.keepAsLast(ST).catch(() => {}); return; } // clean exit last time: kept for File > Recover Last Session…
    const when = new Date(man.time).toLocaleString(), files = (man.docs || []).map((d) => '<li>' + UI.esc(d.name) + '</li>').join('');
    const ok = await UI.dialog({ title: 'Recover unsaved work', okLabel: 'Recover', cancelLabel: 'Discard', width: 480,
      html: `<p>AudioStage did not close normally last time. Work autosaved at <b>${UI.esc(when)}</b> can be recovered:</p><ul>${man.clips ? `<li>Multitrack session: ${man.tracks} track(s), ${man.clips} clip(s)</li>` : ''}${files}</ul><div class="note">Discard deletes this autosave.</div>` });
    if (!ok) { await AU.discard(ST); status('Autosave discarded.'); return; }
    try { useRecovered(await UI.busy('Recovering…', () => AU.restore(ST, man))); status('Recovered the work autosaved at ' + when + '.'); } catch (e) { UI.toast('Recovery failed: ' + (e.message || e), 'error'); }
  }
  app.recoveryChecked = checkRecovery();
  /* recordings that were still running (or not yet autosaved) when the app ended abnormally (recspool.js) */
  async function checkRecordings(crashed) {
    let list = []; try { list = await AS.recSpool.list(ST); } catch (e) { return; }
    if (!list.length) return;
    if (!crashed) { for (const r of list) await AS.recSpool.discard(ST, r.id); return; } // normal exit: the takes were in the app
    const rows = list.map((r) => `<li>${UI.esc(r.name)} — ${new Date(r.time).toLocaleString()}</li>`).join('');
    const ok = await UI.dialog({ title: 'Recover interrupted recording', okLabel: 'Recover', cancelLabel: 'Discard', width: 480, html: `<p>AudioStage did not close normally while recording. The recorded audio was kept on disk:</p><ul>${rows}</ul><div class="note">Recover opens each as a new unsaved file. Discard deletes it.</div>` });
    for (const r of list) {
      if (ok) { try { const x = await UI.busy('Recovering the recording…', () => AS.recSpool.recover(ST, r.id)); const d = addDoc(x.name.replace(/\.wav$/i, '') + ' (recovered).wav', x.sr, x.ch); d.dirty = true; } catch (e) { UI.toast('Recovery failed: ' + (e.message || e), 'error'); continue; } }
      await AS.recSpool.discard(ST, r.id);
    }
    if (ok) { updateFiles(); setMode('wave'); }
  }
  app.recordingsChecked = app.recoveryChecked.then(() => checkRecordings(lastRunCrashed)).catch(() => {});
  /* File > Recover Last Session…: the work autosaved before the last normal exit (also after "Close Without Saving") */
  async function recoverLast() {
    await app.recoveryChecked;
    let man = null; try { man = await AU.readLast(ST); } catch (e) { /* none */ }
    if (!man) { UI.toast('There is no autosaved work from the last session.'); return false; }
    const when = new Date(man.time).toLocaleString(), files = (man.docs || []).map((d) => '<li>' + UI.esc(d.name) + '</li>').join('');
    const ok = await UI.dialog({ title: 'Recover Last Session', okLabel: 'Recover', width: 480, html: `<p>Work autosaved at <b>${UI.esc(when)}</b>, before AudioStage was last closed:</p><ul>${man.clips ? `<li>Multitrack session${man.sessionFile && man.sessionFile.name ? ' “' + UI.esc(man.sessionFile.name) + '”' : ''}: ${man.tracks} track(s), ${man.clips} clip(s)</li>` : ''}${files}</ul><div class="note">Unsaved files open as new unsaved files; the multitrack session replaces the current one.</div>` });
    if (!ok) return false;
    if (man.clips && !(await confirmSessionClose('Recover Last Session'))) return false;
    try { useRecovered(await UI.busy('Recovering…', () => AU.restore(ST, man))); status('Recovered the work autosaved at ' + when + '.'); return true; } catch (e) { UI.toast('Recovery failed: ' + (e.message || e), 'error'); return false; }
  }
  app.recoverLast = recoverLast;
  /* the Start screen, once crash recovery and files from Windows are settled */
  app.welcomeShown = Promise.all([app.recoveryChecked, shellOpened]).catch(() => {}).then(() => AS.welcome.startup(app));
  app.welcomeShown.then(() => AS.updates.startup()).catch(() => {}); // Preferences > General: check for updates when AudioStage opens
  app.startNewSession = () => {
    const go = () => { if (eng.playing) stop(false); app.session = newSession(); multi.s = app.session; multi.rebuildHeads(); multi.resize(); setMode('multi'); updateTitle(); return true; };
    if (app.hasUnsaved && app.session.dirty && (app.session.tracks.some((t) => t.clips.length) || app.session.filePath)) return confirmSessionClose('New Multitrack Session').then((ok) => ok && go());
    return go();
  };
  async function saveVersionDlg() {
    const r = await UI.dialog({ title: 'Save Project Version', okLabel: 'Save', fields: [{ id: 'name', label: 'Name', type: 'text', value: 'Version ' + new Date().toLocaleString() }, { id: 'n', type: 'note', label: 'A snapshot of the multitrack session you can go back to at any time (File > Versions…).' }] });
    if (!r) return;
    try { const v = await UI.busy('Saving version…', () => AU.saveVersion(ST, r.name.trim() || 'Version', app.session)); status(`Version “${v.name}” saved.`); } catch (e) { reportErr(e); }
  }
  async function versionsDlg() {
    let list; try { list = await AU.listVersions(ST); } catch (e) { reportErr(e); return; }
    if (!list.length) { UI.toast('No versions yet — use File > Save Version… first.'); return; }
    const rows = list.map((v) => `<tr data-v="${v.id}"><td><b>${UI.esc(v.name)}</b><br><span class="note">${new Date(v.time).toLocaleString()} · ${v.tracks} track(s), ${v.clips} clip(s)</span></td><td style="white-space:nowrap"><button class="btn sm" data-a="restore">Restore</button> <button class="btn sm danger" data-a="del">Delete</button></td></tr>`).join('');
    await UI.dialog({ title: 'Project Versions', noOk: true, cancelLabel: 'Close', width: 560, dismissable: true, html: `<table class="stats vers">${rows}</table><div class="note">Restoring first saves the current session as a version, so it can be undone the same way.</div>`,
      onReady(el) {
        el.addEventListener('click', async (e) => {
          const b = e.target.closest('[data-a]'); if (!b) return; const id = b.closest('[data-v]').dataset.v, v = list.find((x) => x.id === id);
          if (b.dataset.a === 'del') { await AU.deleteVersion(ST, id); b.closest('tr').remove(); status(`Version “${v.name}” deleted.`); return; }
          try {
            await AU.saveVersion(ST, 'Auto: before restoring “' + v.name + '”', app.session);
            const cur = app.session, nv = await UI.busy('Restoring…', () => AU.loadVersion(ST, id));
            nv.filePath = cur.filePath; nv.fileName = cur.fileName; nv.dirty = true; // still the same session file, now changed
            useSession(nv); status(`Restored version “${v.name}”.`);
            el.closest('.modal-back').querySelector('[data-act="cancel"]').click();
          } catch (er) { reportErr(er); }
        });
      } });
  }
  actions['file.saveVersion'] = saveVersionDlg; actions['file.versions'] = versionsDlg; actions['file.autosave'] = autosaveSettings;

  /* ================= Misc dialogs ================= */
  /* Help > AudioStage Help (F1): the offline manual (app/help, made from README.md) — its own window in the desktop app */
  async function openHelp(q) {
    if (window.audioStageHelp) { const r = await window.audioStageHelp.open(q); if (!r.ok) UI.toast('Cannot open the manual: ' + r.error, 'error'); return r; }
    const w = window.open('help/index.html' + (q ? '#q=' + encodeURIComponent(q) : ''), 'audiostage-help'); if (!w) UI.toast('Allow pop-ups to open the manual (help/index.html).', 'error'); return { ok: !!w };
  }
  app.openHelp = openHelp;
  async function showLogs() { const r = await window.audioStageHelp.showLogs(); if (!r.ok) UI.toast('Cannot open the log folder: ' + r.error, 'error'); else status('Log files: ' + r.dir); return r; }
  /* Help > Report a Problem…: what to include in a report — versions, system, VST / ffmpeg state, the end of the log.
     Nothing is sent: copy it into an e-mail or an issue yourself. */
  async function reportProblem() {
    const H = window.audioStageHelp; let info = {}, tail = [], rt = '';
    if (H) { const r = await H.info(); info = r.info || {}; tail = r.tail || []; }
    else info = { app: 'AudioStage (browser build)', browser: navigator.userAgent };
    if (AS.runtimes.available) { try { const [v, f] = await Promise.all([AS.runtimes.status('vst'), AS.runtimes.status('ffmpeg')]); rt = `VST host: ${v.active && v.active.available ? 'ready (pedalboard ' + v.active.pedalboard + ', ' + v.active.source + ')' : 'not ready'}\nffmpeg: ${f.active && f.active.ffmpeg ? f.active.ffmpeg.version + ' (' + f.active.ffmpeg.source + ')' : 'not found'}\n`; } catch (e) { /* */ } }
    const text = `What happened:\n\nWhat I did just before:\n\n--- AudioStage information ---\n${Object.entries(info).map(([k, v]) => k + ': ' + v).join('\n')}\n${rt}Open files: ${app.docs.length} · Multitrack tracks: ${app.session.tracks.length}\n${tail.length ? '--- end of the log ---\n' + tail.join('\n') + '\n' : ''}`;
    await UI.dialog({ title: 'Report a Problem', noOk: true, cancelLabel: 'Close', width: 640, dismissable: true,
      html: `<div class="note">AudioStage does not send anything by itself. Describe the problem at the top, then copy the text into an e-mail or an issue${H ? ' — attach the log files too if they help (Show Log Files)' : ''}.</div><textarea class="rp-text" spellcheck="false">${UI.esc(text)}</textarea><div class="rk-bar"><button class="btn primary" data-rp="copy">Copy to Clipboard</button>${H ? '<button class="btn" data-rp="logs">Show Log Files</button>' : ''}</div>`,
      onReady(el) { el.addEventListener('click', async (e) => { const b = e.target.closest('[data-rp]'); if (!b) return; if (b.dataset.rp === 'logs') showLogs(); else { try { await navigator.clipboard.writeText(el.querySelector('.rp-text').value); UI.toast('Copied.'); } catch (er) { el.querySelector('.rp-text').select(); document.execCommand('copy'); UI.toast('Copied.'); } } }); } });
    return text;
  }
  app.reportProblem = reportProblem;
  function showKeys() {
    const rows = [['Space', 'Play / Stop'], ['Shift+Space', 'Record'], ['Ctrl+Z / Ctrl+Y', 'Undo / Redo'], ['Ctrl+X / C / V', 'Cut / Copy / Paste'], ['Ctrl+Shift+V', 'Mix Paste'], ['Delete', 'Delete selection / clip'], ['Ctrl+A', 'Select all'], ['Ctrl+= / Ctrl+-', 'Zoom in / out'], ['Mouse wheel', 'Scroll'], ['Ctrl+Wheel', 'Zoom at pointer'], ['Double-click', 'Select visible range'], ['M', 'Add marker at playhead (range marker over a selection)'], ['Ctrl+L', 'Toggle loop'], ['J / K / L', 'Shuttle reverse / stop / forward (again = faster, hold K = half speed)'], ['Drag in the ruler', 'Scrub (hear the audio under the playhead)'], ['Home / End', 'Go to start / end'], ['S', 'Split clip at playhead (multitrack)'], ['Ctrl+D', 'Duplicate clip'], ['Ctrl+S', 'Save (the file or, in Multitrack, the session)'], ['Ctrl+Shift+S', 'Save As']];
    UI.dialog({ title: 'Keyboard Shortcuts', noOk: true, cancelLabel: 'Close', dismissable: true, html: '<table class="stats">' + rows.map((r) => `<tr><td><b>${r[0]}</b></td><td>${r[1]}</td></tr>`).join('') + '</table>' });
  }
  /* the version comes from package.json through the main process (app.getVersion()), so it never goes stale */
  let appVersion = '';
  if (window.audioStageHelp && window.audioStageHelp.version) window.audioStageHelp.version().then((v) => { appVersion = typeof v === 'string' ? v : ''; }).catch(() => {});
  const COPYRIGHT = 'Copyright (c) BYS & RB. All rights reserved by BYS & RB';
  function showAbout() {
    const n = AS.fxmenu.counts();
    UI.dialog({ title: 'About AudioStage', noOk: true, cancelLabel: 'Close', dismissable: true, html: `<p><b>AudioStage${appVersion ? ' ' + UI.esc(appVersion) : ''}</b> — a professional-style digital audio workstation for editing, restoring and mixing audio.</p><p class="note">Waveform &amp; spectral editor · multitrack mixer · ${n.realtime} real-time rack effects · ${n.offline} offline processes · ${n.generators} generators · restoration · loudness &amp; analysis tools<br>Export: ${exportFormatNames().join(' / ')} · Import: WAV and anything the system decoder reads (MP3, FLAC, OGG, M4A/AAC, Opus, video soundtracks…)</p><p class="note about-copy">${UI.esc(COPYRIGHT)}</p>` });
  }
  function toggleTheme() { AS.prefs.set('general.theme', document.documentElement.dataset.theme === 'light' ? 'dark' : 'light'); }
  /* ================= Preferences (Edit > Preferences…, Ctrl+K) =================
     Every setting is registered once. The ones the older dialogs already kept (Recording Settings, Pre-roll / Post-roll,
     Autosave, Spectral Display Settings, Audio Hardware Setup, the theme toggle) read and write those same objects. */
  const P = AS.prefs, SR_OPTS = [8000, 11025, 16000, 22050, 32000, 44100, 48000, 88200, 96000, 192000].map((v) => [v, v + ' Hz']), BITS_OPTS = [[16, '16-bit'], [24, '24-bit'], [32, '32-bit float']];
  const via = (obj, k, save) => ({ get: () => obj[k], set: (v) => { obj[k] = v; save(); } });
  const saveAUS = () => { try { localStorage.setItem(AS_KEY, JSON.stringify(AUS)); } catch (e) { /* */ } };
  const applyTheme = (n) => { document.documentElement.dataset.theme = n; try { localStorage.setItem('as-theme', n); } catch (e) { /* */ } wave.draw(); multi.draw(); };
  const saveAudio = () => { try { localStorage.setItem('as-audio', JSON.stringify({ out: eng.outId || '', in: eng.inId || '' })); } catch (e) { /* */ } };
  let askedMic = false; // device names are only shown after microphone permission
  const devOpts = async (kind) => { if (!askedMic) { askedMic = true; try { const st = await navigator.mediaDevices.getUserMedia({ audio: true }); st.getTracks().forEach((x) => x.stop()); } catch (e) { /* names stay hidden */ } } let devs = []; try { devs = await navigator.mediaDevices.enumerateDevices(); } catch (e) { /* none */ } return [['', 'System default'], ...devs.filter((d) => d.kind === kind && d.deviceId !== 'default' && d.deviceId !== 'communications').map((d) => [d.deviceId, d.label || (kind === 'audioinput' ? 'Input' : 'Output') + ' ' + d.deviceId.slice(0, 6)])]; };
  const SPv = (k) => ({ get: () => AS.spectral.settings()[k], set: (v) => AS.spectral.set({ [k]: v }) });
  [
    { id: 'general.theme', tab: 'General', label: 'Color theme', type: 'select', options: [['dark', 'Dark'], ['light', 'Light']], dflt: 'dark', get: () => (document.documentElement.dataset.theme === 'light' ? 'light' : 'dark'), set: applyTheme },
    { id: 'general.confirmClose', tab: 'General', label: 'Ask before closing when files have unsaved changes', type: 'check', dflt: true },
    { id: 'edit.zeroSnap', tab: 'General', label: 'Snap selections to zero crossings', type: 'check', dflt: false, ...via(EDS, 'zeroSnap', saveEDS) },
    { id: 'edit.preRoll', tab: 'General', label: 'Preview Edit pre-roll', type: 'range', min: 0, max: 10, step: 0.1, unit: 's', dflt: 2, ...via(EDS, 'preRoll', saveEDS), tip: 'Transport > Preview Edit plays this much before the selection' },
    { id: 'edit.postRoll', tab: 'General', label: 'Preview Edit post-roll', type: 'range', min: 0, max: 10, step: 0.1, unit: 's', dflt: 2, ...via(EDS, 'postRoll', saveEDS), tip: '… and this much after it' },
    { id: 'audio.out', tab: 'Audio Hardware', label: 'Output device', type: 'select', options: () => devOpts('audiooutput'), dflt: '', get: () => eng.outId || '', set: (v) => { eng.outId = v; saveAudio(); if (eng.ctx && 'setSinkId' in eng.ctx) eng.ctx.setSinkId(v || '').catch((e) => UI.toast('Cannot use that output device: ' + e.message, 'error')); } },
    { id: 'audio.in', tab: 'Audio Hardware', label: 'Input device (recording)', type: 'select', options: () => devOpts('audioinput'), dflt: '', get: () => eng.inId || '', set: (v) => { eng.inId = v; saveAudio(); },
      note: 'Devices are used through the operating system’s audio engine (WASAPI / CoreAudio). ASIO drivers cannot be opened directly — expose the interface as a system device (e.g. ASIO4ALL, or its WASAPI mode).' },
    { id: 'rec.latencyMs', tab: 'Recording', label: 'Latency compensation', type: 'range', min: 0, max: 500, step: 0.1, unit: 'ms', dflt: 0, ...via(RS, 'latencyMs', saveRS), tip: 'Recordings are moved earlier by this much so overdubs line up (Transport > Recording Settings… can measure it)' },
    { id: 'rec.preRoll', tab: 'Recording', label: 'Punch pre-roll', type: 'range', min: 0, max: 10, step: 0.1, unit: 's', dflt: 2, ...via(RS, 'preRoll', saveRS) },
    { id: 'rec.postRoll', tab: 'Recording', label: 'Punch post-roll', type: 'range', min: 0, max: 10, step: 0.1, unit: 's', dflt: 1, ...via(RS, 'postRoll', saveRS) },
    { id: 'rec.folder', tab: 'Recording', label: 'Also save recordings to', type: 'folder', dflt: '', desktop: true, note: 'Every recording is also written to this folder as a 32-bit float WAV (not set: recordings live in the session / open files until you save them).' },
    { id: 'autosave.on', tab: 'Autosave', label: 'Autosave the session and unsaved files', type: 'check', dflt: true, ...via(AUS, 'on', saveAUS) },
    { id: 'autosave.minutes', tab: 'Autosave', label: 'Every', type: 'range', min: 1, max: 30, step: 1, unit: 'min', dflt: 2, ...via(AUS, 'minutes', saveAUS), note: 'Kept on this computer only. After a crash AudioStage offers to recover the work at the next start.' },
    { id: 'files.openDir', tab: 'Files', label: 'Open files from', type: 'folder', dflt: '', desktop: true, tip: 'The folder File > Open… starts in' },
    { id: 'files.saveDir', tab: 'Files', label: 'Save / export files to', type: 'folder', dflt: '', desktop: true, tip: 'The folder the Save dialog starts in' },
    { id: 'files.exportFmt', tab: 'Files', label: 'Default export format', type: 'select', options: () => fmtOptions(), dflt: 'wav24' },
    { id: 'files.newSr', tab: 'Files', label: 'New audio file: sample rate', type: 'select', options: SR_OPTS, dflt: 48000 },
    { id: 'files.newCh', tab: 'Files', label: 'New audio file: channels', type: 'select', options: [[1, 'Mono'], [2, 'Stereo']], dflt: 2 },
    { id: 'files.newBits', tab: 'Files', label: 'New audio file: bit depth', type: 'select', options: BITS_OPTS, dflt: 24 },
    { id: 'files.sessSr', tab: 'Files', label: 'New session: sample rate', type: 'select', options: SR_OPTS, dflt: 44100, tip: 'The rate the mixdown is rendered at' },
    { id: 'files.sessBits', tab: 'Files', label: 'New session: bit depth', type: 'select', options: BITS_OPTS, dflt: 24, tip: 'The format Export Multitrack Mixdown starts with' },
    { id: 'mt.xfade', tab: 'Multitrack', label: 'Automatic crossfades for new sessions', type: 'check', dflt: true },
    { id: 'mt.xfCurve', tab: 'Multitrack', label: 'Crossfade curve', type: 'select', options: AS.CURVES, dflt: 'cosine' },
    { id: 'mt.overlap', tab: 'Multitrack', label: 'Overlapping clips', type: 'select', options: [['overlap', 'Overlap (crossfade)'], ['overwrite', 'Overwrite'], ['ripple', 'Insert (ripple)']], dflt: 'overlap' },
    { id: 'mt.snapGrid', tab: 'Multitrack', label: 'Snap to grid', type: 'select', options: [['off', 'Off'], ...AS.tempo.DIVS], dflt: 'off' },
    { id: 'mt.trackVol', tab: 'Multitrack', label: 'New track volume', type: 'range', min: -40, max: 12, step: 0.5, unit: 'dB', dflt: 0, note: 'These are the settings of <b>new</b> sessions and tracks; the Multitrack menu changes the open session.' },
    { id: 'display.timeFmt', tab: 'Display', label: 'Time display', type: 'select', options: [['time', 'Decimal (m:ss.000)'], ['samples', 'Samples'], ['smpte', 'SMPTE timecode'], ['bars', 'Bars:Beats']], dflt: 'time', tip: 'View > Cycle Time Display Format changes it too' },
    { id: 'display.specFft', tab: 'Display', label: 'Spectral: FFT size', type: 'select', options: AS.spectral.FFTS.map((n) => [n, String(n)]), dflt: AS.spectral.DEFAULTS.fft, ...SPv('fft') },
    { id: 'display.specWin', tab: 'Display', label: 'Spectral: window', type: 'select', options: Object.entries(D.WINDOWS).map(([k, v]) => [k, typeof v === 'string' ? v : k]), dflt: AS.spectral.DEFAULTS.win, ...SPv('win') },
    { id: 'display.specMin', tab: 'Display', label: 'Spectral: range floor', type: 'range', min: -160, max: -40, step: 1, unit: 'dB', dflt: AS.spectral.DEFAULTS.dbMin, ...SPv('dbMin') },
    { id: 'display.specMax', tab: 'Display', label: 'Spectral: range top', type: 'range', min: -60, max: 0, step: 1, unit: 'dB', dflt: AS.spectral.DEFAULTS.dbMax, ...SPv('dbMax') },
    { id: 'display.specCmap', tab: 'Display', label: 'Spectral: color map', type: 'select', options: Object.entries(AS.spectral.COLORMAPS).map(([k, v]) => [k, v[0]]), dflt: AS.spectral.DEFAULTS.cmap, ...SPv('cmap') },
  ].forEach((d) => P.register(d));
  P.pane('VST / ffmpeg', (el) => {
    const draw = async () => {
      const [v, f] = await Promise.all([AS.runtimes.status('vst'), AS.runtimes.status('ffmpeg')]);
      el.innerHTML = `<table class="stats"><tr><td><b>VST3 plugins</b><br>${AS.runtimes.describe('vst', v)}</td><td><button class="btn sm" data-rk="vst">Manage…</button></td></tr><tr><td><b>ffmpeg</b> (Export Video with Mixdown)<br>${AS.runtimes.describe('ffmpeg', f)}</td><td><button class="btn sm" data-rk="ffmpeg">Manage…</button></td></tr></table><div class="rk-bar"><button class="btn" data-rk="mgr">Plugin Manager…</button></div>`;
    };
    el.addEventListener('click', async (e) => { const b = e.target.closest('[data-rk]'); if (!b) return; if (b.dataset.rk === 'mgr') await AS.vst.manager(); else await AS.runtimes.manage(b.dataset.rk); draw(); });
    draw();
  });
  /* new sessions / tracks use Preferences > Files / Multitrack */
  function newSession() {
    const s = new AS.Session(); s.sr = P.get('files.sessSr'); s.bits = P.get('files.sessBits');
    Object.assign(s.settings, { xfade: P.get('mt.xfade'), xfCurve: P.get('mt.xfCurve'), overlap: P.get('mt.overlap'), snapGrid: P.get('mt.snapGrid') });
    return s;
  }
  AS.newTrackDefaults = () => ({ vol: P.get('mt.trackVol') });
  app.newSession = newSession;
  app.session = newSession(); multi.s = app.session; multi.rebuildHeads();
  tfi = Math.max(0, TF.indexOf(P.get('display.timeFmt')));
  P.onChange((id, v) => {
    if (id === 'display.timeFmt') { tfi = Math.max(0, TF.indexOf(v)); lastTime = ''; updateInfo(); wave.draw(); multi.draw(); }
    else if (id.startsWith('display.spec')) { wave.specCache = null; wave.draw(); }
    else if (id === 'files.saveDir' && window.audioStageFiles) window.audioStageFiles.setSaveDir(v);
  });
  if (window.audioStageFiles) window.audioStageFiles.setSaveDir(P.get('files.saveDir'));
  actions['edit.prefs'] = () => P.open();
  /* File > Open… / Open Multitrack Session… in the desktop app: the system dialog, starting in Preferences > Files */
  async function openDialog(kind) {
    const F = window.audioStageFiles;
    if (!F) { $(kind === 'sessions' ? '#sessionInput' : '#fileInput').click(); return; }
    const r = await F.open(kind, P.get('files.openDir'));
    if (!r.ok) { UI.toast(r.error, 'error'); return; }
    const files = (r.files || []).map((x) => AS.disk.lazyFile(AS.disk.fromInfo(x.path, x.name, x.size))); // read one at a time when opened
    if (kind === 'sessions') { if (files[0]) await loadSession(files[0]); } else if (files.length) await openFiles(files);
  }


  /* ================= Menus ================= */
  const menuDefs = [
    { label: 'File', items: [
      { label: 'New Audio File…', id: 'file.new', shortcut: 'Ctrl+N' }, { label: 'New Multitrack Session…', id: 'mt.new' }, '-',
      { label: 'Open…', id: 'file.open', shortcut: 'Ctrl+O' }, { label: 'Open Multitrack Session…', id: 'file.openSession' }, { label: 'Open Recent', items: () => AS.recent.menuItems('files') }, { label: 'Open Recent Session', items: () => AS.recent.menuItems('sessions') }, '-',
      { label: 'Save', id: 'file.save', shortcut: 'Ctrl+S' }, { label: 'Save As (WAV / MP3 / FLAC)…', id: 'file.saveAs', shortcut: 'Ctrl+Shift+S' }, { label: 'Save Selection As…', id: 'file.saveSel' }, { label: 'File Info / Metadata…', id: 'file.info' }, { label: 'Save Multitrack Session', id: 'file.saveSession' }, { label: 'Save Multitrack Session As…', id: 'file.saveSessionAs' }, { label: 'Save Version…', id: 'file.saveVersion' }, { label: 'Versions…', id: 'file.versions' }, { label: 'Autosave…', id: 'file.autosave' }, { label: 'Recover Last Session…', id: 'file.recoverLast' }, { label: 'Export Multitrack Mixdown…', id: 'file.exportMix' }, { label: 'Export Video with Mixdown (ffmpeg)…', id: 'file.exportVideo' },
      { label: 'Export Session as FCP XML (Premiere / Resolve / Audition)…', id: 'file.exportFcp' }, { label: 'Import FCP XML Session…', id: 'file.importFcp' }, { label: 'CD Layout…', id: 'win:cd' }, { label: 'Batch Process…', id: 'file.batch' }, { label: 'Audio Hardware Setup…', id: 'file.audio' }, '-',
      { label: 'Close', id: 'file.close', shortcut: 'Ctrl+W' }, { label: 'Close All', id: 'file.closeall' }, '-', { label: 'Exit', id: 'file.exit' }] },
    { label: 'Edit', items: [
      { label: 'Undo', id: 'edit.undo', shortcut: 'Ctrl+Z' }, { label: 'Redo', id: 'edit.redo', shortcut: 'Ctrl+Y' }, '-',
      { label: 'Cut', id: 'edit.cut', shortcut: 'Ctrl+X' }, { label: 'Copy', id: 'edit.copy', shortcut: 'Ctrl+C' }, { label: 'Paste', id: 'edit.paste', shortcut: 'Ctrl+V' }, { label: 'Mix Paste', id: 'edit.mixpaste', shortcut: 'Ctrl+Shift+V' },
      { label: 'Copy to New', id: 'edit.copynew', shortcut: 'Ctrl+Alt+C' }, { label: 'Paste to New', id: 'edit.pastenew', shortcut: 'Ctrl+Alt+V' }, { label: 'Delete', id: 'edit.delete', shortcut: 'Delete' }, { label: 'Crop to Selection', id: 'edit.crop', shortcut: 'Ctrl+T' }, { label: 'Trim Leading/Trailing Silence', id: 'edit.trimsilence' }, '-',
      { label: 'Select All', id: 'edit.selall', shortcut: 'Ctrl+A' }, { label: 'Select None', id: 'edit.selnone', shortcut: 'Ctrl+Shift+A' }, { label: 'Select Visible Range', id: 'edit.selview' }, '-',
      { label: 'Snap to Zero Crossings', id: 'edit.zerosnap', checked: () => EDS.zeroSnap },
      { label: 'Zero Crossings', items: [{ label: 'Adjust Selection Inward', id: 'edit.z.in', shortcut: 'Shift+I' }, { label: 'Adjust Selection Outward', id: 'edit.z.out', shortcut: 'Shift+O' }, '-',
        { label: 'Adjust Left Side to Left', id: 'edit.z.ll', shortcut: 'Shift+H' }, { label: 'Adjust Left Side to Right', id: 'edit.z.lr', shortcut: 'Shift+J' }, { label: 'Adjust Right Side to Left', id: 'edit.z.rl', shortcut: 'Shift+K' }, { label: 'Adjust Right Side to Right', id: 'edit.z.rr', shortcut: 'Shift+L' }] }, '-',
      { label: 'Add Marker (with a selection: Range Marker)', id: 'edit.marker', shortcut: 'M' }, { label: 'Clear All Markers', id: 'edit.clearmarkers' }, { label: 'Export Range Markers…', id: 'edit.exportRanges' }, '-',
      { label: 'Tempo and Time Signature…', id: 'edit.tempo' }, { label: 'Keyboard Shortcuts…', id: 'edit.keys', shortcut: 'Alt+K' }, { label: 'Preferences…', id: 'edit.prefs', shortcut: 'Ctrl+K' }, '-',
      { label: 'Convert Sample Rate…', id: 'edit.convertsr' }, { label: 'Convert to Mono', id: 'edit.tomono' }, { label: 'Convert to Stereo', id: 'edit.tostereo' }] },
    { label: 'Multitrack', items: [
      { label: 'Insert Current File into Multitrack', id: 'mt.insert' }, { label: 'Insert Video…', id: 'mt.video' }, { label: 'Add Track', id: 'mt.addtrack' }, '-',
      { label: 'Split Clip at Playhead', id: 'mt.split', shortcut: 'S' }, { label: 'Duplicate Clip', id: 'mt.dup', shortcut: 'Ctrl+D' }, { label: 'Clip Properties…', id: 'mt.props', shortcut: 'F2' }, { label: 'Match Clip to Session Tempo', id: 'mt.matchtempo' },
      { label: 'Ripple Delete', id: 'edit.ripple', shortcut: 'Shift+Delete' }, { label: 'Group Clips', id: 'mt.group', shortcut: 'Ctrl+G' }, { label: 'Ungroup Clips', id: 'mt.ungroup', shortcut: 'Ctrl+Shift+G' },
      { label: 'Lock in Time', id: 'mt.lock' }, { label: 'Loop Clip', id: 'mt.loop' }, { label: 'Bring Clip to Front', id: 'mt.front' }, { label: 'Send Clip to Back', id: 'mt.back' }, '-',
      { label: 'Move Track Up', id: 'mt.trackup', shortcut: 'Alt+Shift+Up' }, { label: 'Move Track Down', id: 'mt.trackdown', shortcut: 'Alt+Shift+Down' }, { label: 'Move Track to Top', id: 'mt.tracktop', shortcut: 'Alt+Shift+Home' }, { label: 'Move Track to Bottom', id: 'mt.trackbottom', shortcut: 'Alt+Shift+End' },
      { label: 'Freeze Track', id: 'mt.freeze' }, { label: 'Unfreeze Track', id: 'mt.unfreeze' },
      { label: 'Bounce to New Track', items: [{ label: 'Selected Track (time selection or whole)', id: 'mt.bouncetrack' }, { label: 'Selected Clips', id: 'mt.bounceclips' }, { label: 'Session Mix (time selection or whole)', id: 'mt.bouncemix' }] }, '-',
      { label: 'Master Channels', items: [{ label: 'Stereo', id: 'mt.ch.2', checked: () => app.session.opts.channels !== 6 }, { label: '5.1 Surround (6 channels)', id: 'mt.ch.6', checked: () => app.session.opts.channels === 6 }] }, { label: 'Track Surround Panner…', id: 'mt.surround' },
      { label: 'Track Effects Rack…', id: 'mt.trackfx', shortcut: 'F3' }, { label: 'Master Bus Effects…', id: 'mt.master' }, { label: 'Auto-Duck…', id: 'mt.duck' }, { label: 'Auto-Match Essential Sound (detect track types)', id: 'mt.essential' }, '-', { label: 'Snap to Clips & Playhead', id: 'mt.snap', checked: () => multi.snap },
      { label: 'Snap to Grid', items: [['off', 'Off'], ...AS.tempo.DIVS].map(([k, n]) => ({ label: n, id: 'mt.grid.' + k, checked: () => (app.session.opts.snapGrid || 'off') === k })) },
      { label: 'Crossfades', items: [{ label: 'Automatic Crossfades', id: 'mt.xf.toggle', checked: () => app.session.opts.xfade }, '-',
        ...AS.CURVES.map(([k, n]) => ({ label: n, id: 'mt.xf.curve.' + k, checked: () => app.session.opts.xfCurve === k })), '-',
        { label: 'Symmetric', id: 'mt.xf.symmetric', checked: () => app.session.opts.xfShape === 'symmetric' }, { label: 'Asymmetric (opposite fade-out curve)', id: 'mt.xf.asymmetric', checked: () => app.session.opts.xfShape === 'asymmetric' }] },
      { label: 'Overlapping Clips', items: [{ label: 'Overlap (crossfade)', id: 'mt.ov.overlap', checked: () => app.session.opts.overlap === 'overlap' }, { label: 'Overwrite', id: 'mt.ov.overwrite', checked: () => app.session.opts.overlap === 'overwrite' }, { label: 'Insert (ripple)', id: 'mt.ov.ripple', checked: () => app.session.opts.overlap === 'ripple' }] }, '-', { label: 'Mixdown Session to New File', id: 'mt.mixnew' }] },
    { label: 'Effects', items: [
      { label: 'Repeat Last Effect', id: 'fx.repeat', shortcut: 'Ctrl+Shift+R' }, '-',
      ...AS.fxmenu.menuItems(), '-',
      ...(AS.vst.available ? [{ label: 'VST3 / AU Plugin (offline)…', id: 'fx.vst' }, { label: 'Plugin Manager…', id: 'fx.vstManager' }, { label: 'Install VST Support…', id: 'fx.vstInstall' }] : [])] }, // desktop app only
    { label: 'Favorites', items: () => [
      ...AS.favorites.all().map((f) => ({ label: f.name, id: 'fav:' + f.id, dflt: '', shortcut: AS.keys.effective('fav:' + f.id, '') || undefined })), '-',
      AS.favorites.recorder.active() ? { label: '■ Stop Recording Favorite…', id: 'fav.stop' } : { label: '● Start Recording Favorite', id: 'fav.record' },
      { label: 'Save Last Effect as Favorite…', id: 'fav.fromLast' }, { label: 'Edit Favorites…', id: 'fav.panel' }] },
    { label: 'Spectral', items: [
      { label: 'Time Selection Tool', id: 'sp.tool.time', shortcut: 'T', checked: () => wave.tool === 'time' }, { label: 'Marquee Selection Tool', id: 'sp.tool.marquee', shortcut: 'E', checked: () => wave.tool === 'marquee' },
      { label: 'Lasso Selection Tool', id: 'sp.tool.lasso', shortcut: 'D', checked: () => wave.tool === 'lasso' }, { label: 'Brush Selection Tool', id: 'sp.tool.brush', shortcut: 'P', checked: () => wave.tool === 'brush' },
      { label: 'Spot Healing Brush Tool', id: 'sp.tool.heal', shortcut: 'B', checked: () => wave.tool === 'heal' }, { label: 'Auto-select Harmonics (click a sound)', id: 'sp.tool.harm', shortcut: 'H', checked: () => wave.tool === 'harm' },
      { label: 'Increase Brush Size', id: 'sp.brushbig', shortcut: ']' }, { label: 'Decrease Brush Size', id: 'sp.brushsmall', shortcut: '[' }, '-',
      { label: 'Delete Selection (remove frequencies)', id: 'sp.delete' }, { label: 'Attenuate Selection…', id: 'sp.atten' }, { label: 'Amplify Selection…', id: 'sp.amp' }, { label: 'Spot Heal Selection', id: 'sp.heal' }, { label: 'Clear Spectral Selection', id: 'sp.clear' }, '-',
      { label: 'Show Pitch (Spectral Pitch Display)', id: 'sp.pitch', checked: () => AS.spectral.settings().pitch }, { label: 'Spectral Display Settings…', id: 'sp.settings' }] },
    { label: 'Generate', items: [...E.GEN.map((g) => ({ label: g.name, id: 'gen:' + g.id })), ...(AS.speech.available() ? [{ label: 'Speech...', id: 'gen.speech' }] : [])] },
    { label: 'Analyze', items: [{ label: 'Frequency Analysis…', id: 'an.freq' }, { label: 'Amplitude Statistics & Loudness…', id: 'an.stats' }, '-',
      { label: 'Loudness Meter (live)', id: 'win:loudness' }, { label: 'Phase Meter & Vectorscope', id: 'win:phase' }, { label: 'Diagnostics (clicks, clipping, silence)', id: 'win:diagnostics' }] },
    { label: 'View', items: [
      { label: 'Waveform Editor', id: 'view.wave', checked: () => !app.specMode }, { label: 'Spectral Frequency Display', id: 'view.spec', checked: () => app.specMode }, '-',
      { label: 'Zoom In', id: 'view.zin', shortcut: 'Ctrl+=' }, { label: 'Zoom Out', id: 'view.zout', shortcut: 'Ctrl+-' }, { label: 'Zoom to Selection', id: 'view.zsel' }, { label: 'Zoom Full', id: 'view.zall', shortcut: 'Ctrl+0' }, '-',
      { label: 'Cycle Time Display Format', id: 'view.timefmt' }, { label: 'Toggle Light/Dark Theme', id: 'view.theme' }] },
    { label: 'Transport', items: [
      { label: 'Play / Stop', id: 'tp.play', shortcut: 'Space' }, { label: 'Pause', id: 'tp.pause', shortcut: 'Shift+Enter' }, { label: 'Stop', id: 'tp.stop', shortcut: 'Enter' }, { label: 'Record', id: 'tp.rec', shortcut: 'Shift+Space' },
      { label: 'Loop Playback', id: 'tp.loop', shortcut: 'Ctrl+L', checked: () => app.loop }, '-',
      { label: 'Shuttle Reverse (again = faster)', id: 'tp.shuttle.j', shortcut: 'J' }, { label: 'Shuttle Stop', id: 'tp.shuttle.k', shortcut: 'K' }, { label: 'Shuttle Forward (again = faster)', id: 'tp.shuttle.l', shortcut: 'L' },
      { label: 'Skip Selection', id: 'tp.skipsel', checked: () => !!app.skipSel }, { label: 'Preview Edit (pre-roll + post-roll)', id: 'tp.preview', shortcut: 'Ctrl+Shift+Space' }, { label: 'Pre-roll / Post-roll…', id: 'tp.prevset' }, { label: 'Play Playlist', id: 'tp.playlist' }, '-',
      { label: 'Metronome', id: 'tp.metro', checked: () => AS.metronome.settings.on }, { label: 'Metronome Settings…', id: 'tp.metroset' }, '-',
      { label: 'Punch In/Out (record the time selection)', id: 'tp.punch', checked: () => !!app.punch }, { label: 'Recording Settings (latency, pre/post-roll)…', id: 'tp.recset' }, '-', { label: 'Go to Start', id: 'tp.start', shortcut: 'Home' }, { label: 'Go to End', id: 'tp.end', shortcut: 'End' }] },
    { label: 'Window', items: () => AS.panels.menuItems() },
    { label: 'Help', items: [{ label: 'AudioStage Help', id: 'help.manual', shortcut: 'F1' }, { label: 'Keyboard Shortcuts', id: 'help.keys', shortcut: 'Shift+F1' }, { label: 'Start Screen', id: 'help.start' }, '-', ...(AS.updates.available() ? [{ label: 'Check for Updates…', id: 'help.updates' }] : []), ...(AS.runtimes && AS.runtimes.available ? [{ label: 'Check VST / ffmpeg Status…', id: 'help.status' }] : []), ...(window.audioStageHelp ? [{ label: 'Show Log Files', id: 'help.logs' }] : []), { label: 'Report a Problem…', id: 'help.report' }, '-', { label: 'About AudioStage', id: 'help.about' }] },
  ];
  /* one dispatcher for menu items and the Effects panel:  rfx:<type> rack effect window · fx:<id> offline dialog · gen:<id> generator */
  function runId(id) {
    AS.welcome.hide(); // any command: the Start screen has done its job
    if (id.startsWith('win:')) return AS.panels.toggle(id.slice(4));
    if (AS.winActions && AS.winActions[id]) return AS.winActions[id]();
    if (id.startsWith('ws:')) return AS.workspaces.switchTo(id.slice(3));
    if (id.startsWith('rfx:')) return AS.fxmodal.openFromMenu(id.slice(4));
    if (id.startsWith('fx:')) return openFx(E.byId(id.slice(3)));
    if (id.startsWith('gen:')) return openGen(E.byId(id.slice(4)));
    if (id.startsWith('fav:')) return applyFavorite(id.slice(4));
    if (id.startsWith('recent:')) return openRecentId(id);
    const f = actions[id]; if (!f) return;
    const r = f();
    if (AS.favorites.OPS[id] && app.mode === 'wave') AS.favorites.recorder.push({ type: 'op', id }); // recordable file operations
    return r;
  }
  app.runId = runId;
  /* recent:<files|sessions>:<i> · recent:clear:<kind> */
  function openRecentId(id) {
    const [, a, b] = id.split(':');
    if (a === 'clear') return AS.recent.clear(b);
    if (a === 'files' || a === 'sessions') return AS.recent.open(a, +b, { file: (f) => openFiles([f]), session: loadSession, pick: (k) => $(k === 'sessions' ? '#sessionInput' : '#fileInput').click() });
  }
  app.loadSession = loadSession;
  AS.recent.load();
  app.menuDefs = menuDefs;
  AS.keys.apply(menuDefs); // the user's shortcuts / preset over the defaults
  const menus = UI.buildMenus($('#menubar'), menuDefs, (it) => runId(it.id));
  app.refreshKeys = () => { AS.keys.apply(menuDefs); menus.refreshKeys(); }; // after shortcut changes; menus built from lists (Window, Favorites) change too

  /* ================= Effects panel ================= */
  function buildFxPanel(q) {
    q = (q || '').toLowerCase();
    const items = [...AS.fxmenu.all(), ...E.GEN.map((g) => ({ label: g.name, id: 'gen:' + g.id, group: 'Generate' })), ...(AS.speech.available() ? [{ label: 'Speech...', id: 'gen.speech', group: 'Generate' }] : [])].filter((f) => f.label.toLowerCase().includes(q) || f.group.toLowerCase().includes(q));
    let html = '', last = '';
    for (const f of items) { if (f.group !== last) { html += `<div class="fxg">${UI.esc(f.group)}</div>`; last = f.group; } html += `<div class="fxi" data-k="${f.id}" title="${f.rack ? 'Real-time rack effect' : f.fx ? 'Offline process' : ''}">${UI.esc(f.label.replace(/\.\.\.$/, ''))}</div>`; }
    $('#fxList').innerHTML = html || '<div class="empty">No matches</div>';
  }
  buildFxPanel();
  $('#vstBtn').onclick = () => AS.vst.open();
  if (!AS.vst.available) $('#vstBtn').hidden = true; // no plugin host in the browser build
  $('#fxSearch').addEventListener('input', (e) => buildFxPanel(e.target.value));
  $('#fxList').addEventListener('click', (e) => { const i = e.target.closest('.fxi'); if (i) runId(i.dataset.k); });
  /* ================= Toolbar, transport, input ================= */
  document.querySelectorAll('#specTools button[data-tool]').forEach((b) => (b.onclick = () => setTool(b.dataset.tool)));
  $('#brushSize').addEventListener('input', (e) => { wave.brushPx = +e.target.value; });
  $('#timeDisp').onclick = () => actions['view.timefmt']();
  $('#bPlay').onclick = togglePlay; $('#bStop').onclick = () => stop(true); $('#bPause').onclick = pause; $('#bLoop').onclick = actions['tp.loop'];
  $('#bRec').onclick = toggleRecord; $('#bMetro').onclick = () => actions['tp.metro'](); $('#bMetro').oncontextmenu = (e) => { e.preventDefault(); metronomeSettings(); }; updateMetroBtn(); $('#bStart').onclick = () => goto(0); $('#bEnd').onclick = () => goto(Infinity);
  $('#zIn').onclick = actions['view.zin']; $('#zOut').onclick = actions['view.zout']; $('#zSel').onclick = actions['view.zsel']; $('#zAll').onclick = actions['view.zall'];
  $('#fileInput').addEventListener('change', (e) => { openFiles([...e.target.files]); e.target.value = ''; });
  $('#sessionInput').addEventListener('change', (e) => { if (e.target.files[0]) loadSession(e.target.files[0]); e.target.value = ''; });
  window.addEventListener('dragover', (e) => e.preventDefault());
  /* a file dragged from the Media Browser (a path, not a File): onto a multitrack lane → a clip there, elsewhere → open it */
  async function dropMediaPath(e, p) {
    try {
      const f = await AS.mediaPreview.file(p);
      if (app.mode === 'multi' && e.target.closest && e.target.closest('#multiMode')) { const at = multi.dropAt(e); await dropIntoMulti([f], at.ti, at.t); }
      else await openFiles([f]);
    } catch (er) { UI.toast(`Cannot open “${p.split(/[\\/]/).pop()}”: ${er.message || er}`, 'error'); }
  }
  app.dropMediaPath = dropMediaPath;
  window.addEventListener('drop', (e) => { e.preventDefault(); const mp = e.dataTransfer.getData && e.dataTransfer.getData('application/x-audiostage-path'); if (mp) { dropMediaPath(e, mp); return; } const fs = [...e.dataTransfer.files].filter((f) => /^audio\//.test(f.type) || /\.(wav|mp3|ogg|flac|m4a|aac|opus|webm|aif|aiff)$/i.test(f.name)); const sess = [...e.dataTransfer.files].find((f) => /\.asession$/i.test(f.name)); if (sess) loadSession(sess);
    if (!fs.length) return;
    if (app.mode === 'multi' && !sess && e.target.closest && e.target.closest('#multiMode')) { // dropped on the multitrack: straight into clips
      const at = multi.dropAt(e), isVid = (f) => /^video\//.test(f.type) || /\.(mp4|mov|mkv|m4v)$/i.test(f.name), vids = fs.filter(isVid);
      if (vids.length) insertVideo(vids[0], at.t); // a video becomes the session's video track (+ its soundtrack)
      const auds = fs.filter((f) => !isVid(f)); if (auds.length) dropIntoMulti(auds, at.ti, at.t);
    }
    else openFiles(fs);
  });
  document.addEventListener('keydown', (e) => {
    if (UI.dialogOpen()) return;
    const t = e.target.tagName;
    if ((t === 'INPUT' && e.target.type !== 'range') || t === 'SELECT' || t === 'TEXTAREA') return;
    if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey) { actions['tp.stop'](); e.preventDefault(); return; }
    if (e.key === 'F12') return;
    menus.handleKey(e);
  });
  // keep Space/Enter from re-triggering a focused toolbar button
  for (const sel of ['#toolbar', '#transport']) $(sel).addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) b.blur(); });
  // unsaved files or an unsaved multitrack session: ask before the window closes (main.js shows the question)
  app.hasUnsaved = () => app.docs.some((d) => d.dirty) || !!(app.session && app.session.dirty && (app.session.tracks.some((t) => t.clips.length) || app.session.filePath));
  window.addEventListener('beforeunload', (e) => { if (AS.prefs.get('general.confirmClose') && app.hasUnsaved()) { e.preventDefault(); e.returnValue = ''; } });

  /* ================= Meters + animation ================= */
  const mc = $('#meters'), mg = mc.getContext('2d');
  function drawMeters() {
    const dpr = window.devicePixelRatio || 1, w = mc.clientWidth, h = mc.clientHeight;
    if (mc.width !== w * dpr) { mc.width = w * dpr; mc.height = h * dpr; }
    mg.setTransform(dpr, 0, 0, dpr, 0, 0);
    const css = getComputedStyle(document.documentElement);
    mg.fillStyle = css.getPropertyValue('--wave-bg'); mg.fillRect(0, 0, w, h);
    const lv = eng.levels(), now = performance.now(), bh = (h - 6) / 2, x0 = 16, bw = w - x0 - 6, lo = -60;
    const pos = (db) => D.clamp((db - lo) / -lo, 0, 1) * bw;
    for (let c = 0; c < 2; c++) {
      const db = D.toDb(lv[c]), y = 2 + c * (bh + 2);
      if (lv[c] > app.peakHold[c]) { app.peakHold[c] = lv[c]; app.holdT[c] = now; } else if (now - app.holdT[c] > 1200) app.peakHold[c] = Math.max(lv[c], app.peakHold[c] * 0.97);
      mg.fillStyle = css.getPropertyValue('--dim'); mg.font = '9px Segoe UI'; mg.fillText(c ? 'R' : 'L', 4, y + bh - 1);
      const grd = mg.createLinearGradient(x0, 0, x0 + bw, 0); grd.addColorStop(0, '#2fb67c'); grd.addColorStop(0.7, '#d9c24a'); grd.addColorStop(0.92, '#e8503a');
      mg.fillStyle = grd; mg.fillRect(x0, y, pos(db), bh);
      mg.fillStyle = '#fff'; mg.fillRect(x0 + pos(D.toDb(app.peakHold[c])) - 1, y, 2, bh);
    }
    mg.fillStyle = css.getPropertyValue('--dim'); mg.font = '8px Segoe UI';
    for (const db of [-48, -36, -24, -12, -6, 0]) mg.fillText(db, x0 + pos(db) - 6, h - 0.5);
  }
  let lastTime = '';
  function tick() {
    requestAnimationFrame(tick);
    if (eng.playing) {
      const p = eng.pos();
      if (app.mode === 'wave' && app.playDoc === app.cur && app.cur) {
        wave.ensureVisible(p * app.cur.sr); wave.frame();
      } else if (app.mode === 'multi') { // (the end of the session is handled by playMulti's timer)
        const right = multi.t0 + multi.W / multi.pps; if (p > right || p < multi.t0) multi.t0 = Math.max(0, p - 0.5); multi.frame();
      }
    } else if (app.recording) {
      status(`Recording… ${fmtTime((performance.now() - app.recording.t0) / 1000)}`);
    }
    syncVideo(); AS.panels.tick(); drawMeters();
    let tsec = 0;
    if (app.mode === 'multi') tsec = app.multiPos(); else if (app.cur) tsec = app.playSample(app.cur) / app.cur.sr;
    if (app.recording) tsec = (performance.now() - app.recording.t0) / 1000 + app.recording.start;
    const str = fmtDisp(tsec); if (str !== lastTime) { $('#timeDisp').textContent = str; lastTime = str; }
    updateTitle();
  }

  /* ================= Boot ================= */
  try { const t = localStorage.getItem('as-theme'); if (t) document.documentElement.dataset.theme = t; } catch (e) { /* */ }
  AS.webenc.detect();
  document.addEventListener('pointerdown', () => eng.init(), { once: true }); // create the audio context (and load worklets) on the first click
  setMode('wave'); updateFiles(); updatePlayBtn(); wave.resize();
  requestAnimationFrame(tick);
  window.addEventListener('resize', () => { wave.resize(); multi.resize(); });
  Object.assign(app, { setMode, setSpec, openFiles, stopPlayback: () => stop(false), refreshFiles: updateFiles, classifyTrack, applyEssential: applyPreset });
  window.AS.app = app; window.AS.actions = actions;
})();




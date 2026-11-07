/* Audio engine (playback, metering, recording) + Doc model. */
(function (root) {
  'use strict';
  const AS = (root.AS = root.AS || {});
  const D = AS.dsp;

  class Engine {
    constructor() { this.ctx = null; this.sources = []; this.playing = false; this.rec = null; }
    init() {
      if (this.ctx && this.ctx.state === 'closed') this.dropContext(); // lost (device gone, driver reset): start a new one
      if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {}); return; }
      const Ctor = window.AudioContext || window.webkitAudioContext, o = this.contextOptions();
      let ctx;
      try { ctx = this.ctx = new Ctor(o); } catch (e) {
        try { ctx = this.ctx = new Ctor({ latencyHint: 'interactive' }); } // the chosen rate / latency may be what failed
        catch (e2) { this.ctx = null; this.report('error', 'Cannot start audio: ' + (e2.message || e2) + '. Check that an output device is available, then try again.'); throw new Error('No audio output is available: ' + (e2.message || e2)); }
      }
      ctx.onstatechange = () => this.contextState(ctx);
      this.watchDevices();
      this.master = ctx.createGain();
      this.split = ctx.createChannelSplitter(2);
      this.an = [0, 1].map(() => { const a = ctx.createAnalyser(); a.fftSize = 1024; return a; });
      this.master.connect(ctx.destination);
      if (this.outId && ctx.setSinkId) ctx.setSinkId(this.outId).catch((e) => this.report('warn', 'The chosen output device is not available (' + (e.message || e) + '). Using the system default.'));
      this.master.connect(this.split);
      this.split.connect(this.an[0], 0); this.split.connect(this.an[1], 1);
      this.buf = new Float32Array(1024);
      this.spec = ctx.createAnalyser(); this.spec.fftSize = 2048; this.spec.smoothingTimeConstant = 0.6; this.master.connect(this.spec); // Spectrum Analyzer panel
      this.meters = {}; // live per-clip / per-track / master level taps, rebuilt with every playback graph
      this.wl = AS.rack ? AS.rack.loadWorklets(ctx) : null; // noise-gate worklet
    }
    /* Preferences > Audio Hardware: this.latency = 'interactive' | 'balanced' | 'playback' or a buffer in seconds;
       this.rate = a sample rate (0 = the device's own). Used when the context is created (see restartContext). */
    contextOptions() {
      const o = { latencyHint: this.latency || 'interactive' };
      if (this.rate > 0) o.sampleRate = this.rate;
      return o;
    }
    /* something about the audio device the user should know: once per message per second, through app-level onProblem */
    report(level, msg) {
      const now = Date.now(); if (this._rep === msg && now - (this._repAt || 0) < 1000) return;
      this._rep = msg; this._repAt = now;
      if (this.onProblem) this.onProblem(level, msg);
    }
    /* forget a context that is gone. The nodes of the old graph go with it; the next init() builds everything again. */
    dropContext() {
      const ctx = this.ctx; this.ctx = null; this.sources = []; this.playing = false; this.stopWatch();
      if (this.input) { try { this.input.stream.getTracks().forEach((t) => t.stop()); } catch (e) { /* */ } this.input = null; }
      if (ctx) { ctx.onstatechange = null; if (ctx.state !== 'closed') ctx.close().catch(() => {}); }
      if (this.onContextLost) this.onContextLost();
    }
    /* apply a new latency / sample rate: only possible with a new context */
    restartContext() { const had = !!this.ctx; if (this.playing) this.stop(); if (had) { this.dropContext(); this.init(); } return had; }
    contextState(ctx) {
      if (ctx !== this.ctx) return;
      if (ctx.state === 'closed') { const was = this.playing; if (this.onStalled && was) this.onStalled('closed'); else if (this.playing) this.stop(); this.dropContext(); this.report('warn', 'The audio device was lost. Audio starts again on a new connection the next time you press Play.'); return; }
      if (ctx.state !== 'running' && this.playing) ctx.resume().catch(() => {}); // sleep / wake, Bluetooth profile switch: ask for it back
    }
    /* The chosen output disappearing (unplugged) does not end the context, it goes silent: fall back to the default. */
    watchDevices() {
      const md = typeof navigator !== 'undefined' && navigator.mediaDevices; if (!md || !md.addEventListener || this._devWatch) return;
      this._devWatch = true;
      md.addEventListener('devicechange', () => { if (this.onDevicesChanged) this.onDevicesChanged(); this.checkDevices(); });
    }
    async checkDevices() {
      const md = navigator.mediaDevices; if (!md || !md.enumerateDevices) return;
      let list; try { list = await md.enumerateDevices(); } catch (e) { return; }
      if (this.outId && !this.outGone && !list.some((d) => d.kind === 'audiooutput' && d.deviceId === this.outId)) {
        this.outGone = true; if (this.ctx && this.ctx.setSinkId) { try { await this.ctx.setSinkId(''); } catch (e) { /* the default is all there is */ } }
        this.report('warn', 'The chosen output device was disconnected. Playing through the system default.');
      } else if (this.outId && this.outGone && list.some((d) => d.kind === 'audiooutput' && d.deviceId === this.outId)) {
        this.outGone = false; if (this.ctx && this.ctx.setSinkId) { try { await this.ctx.setSinkId(this.outId); } catch (e) { return; } }
        this.report('info', 'The chosen output device is back.');
      }
      if (this.inId && this.rec && this.rec.own && !list.some((d) => d.kind === 'audioinput' && d.deviceId === this.inId)) this.report('error', 'The input device was disconnected while recording. Press Stop: what was recorded so far is kept.');
    }
    /* Watchdog while the transport runs: the context clock must advance. A context that stays suspended (no device, a
       driver that stopped) would otherwise leave the app "playing" for ever, in silence. After STALL_S seconds without
       progress: onStalled (the app stops the transport and says why). */
    startWatch() {
      this.stopWatch(); if (!this.ctx) return;
      let last = this.ctx.currentTime, lastAt = Date.now();
      this._watch = setInterval(() => {
        if (!this.playing || !this.ctx) { this.stopWatch(); return; }
        const ct = this.ctx.currentTime, now = Date.now();
        if (ct !== last) { last = ct; lastAt = now; return; }
        if (now - lastAt > 1000 && this.ctx.state !== 'closed') this.ctx.resume().catch(() => {});
        if (now - lastAt > Engine.STALL_S * 1000) { this.stopWatch(); if (this.onStalled) this.onStalled(this.ctx.state); else this.stop(); }
      }, 250);
    }
    stopWatch() { if (this._watch) { clearInterval(this._watch); this._watch = null; } }
    meterLevels(key) { return AS.rack.meterLevels(this.meters, key); }
    /* audio-thread recorder (AudioWorklet 'as-rec', needs the worklets loaded: await this.wl). Connect audio into
       .node; it is kept running through a silent sink. onChunk({ch, peak, frame}) sees every ~85 ms chunk.
       stop() resolves with the whole recording as Float32Array channels. */
    recorder(channels, onChunk, keep) {
      const ctx = this.ctx, nch = channels || 2, store = keep !== false; // keep === false: a live tap (meters), nothing stored
      const node = new AudioWorkletNode(ctx, 'as-rec', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [nch], channelCount: nch, channelCountMode: 'explicit', processorOptions: { channels: nch } });
      const sink = ctx.createGain(); sink.gain.value = 0; node.connect(sink); sink.connect(ctx.destination);
      const chunks = Array.from({ length: nch }, () => []); let finish = null;
      const handle = { node, startTime: null }; // startTime: context time of the first recorded sample
      node.port.onmessage = (e) => { const d = e.data; if (d.ch) { if (handle.startTime === null) handle.startTime = d.startTime; if (store) d.ch.forEach((c, i) => chunks[i].push(c)); if (onChunk) onChunk(d); } if (d.done && finish) finish(); };
      const join = (list) => { const o = new Float32Array(list.reduce((a, b) => a + (b ? b.length : 0), 0)); let p = 0; for (let i = 0; i < list.length; i++) { const b = list[i]; list[i] = null; o.set(b, p); p += b.length; } list.length = 0; return o; }; // each chunk is let go as soon as it is copied: no second copy of a long take at Stop
      return Object.assign(handle, {
        // The worklet answers "done" from the audio thread. If the context is closed / suspended (device lost) or the processor
        // died, that never comes: after 3 s the chunks collected so far are returned, so Stop always completes.
        stop: () => new Promise((resolve) => {
          let timer = null, ended = false;
          finish = () => { if (ended) return; ended = true; clearTimeout(timer); try { node.disconnect(); sink.disconnect(); } catch (er) { /* */ } resolve(chunks.map(join)); };
          node.onprocessorerror = () => finish();
          if (ctx.state !== 'running') { finish(); return; }
          timer = setTimeout(() => finish(), 3000);
          try { node.port.postMessage({ cmd: 'stop' }); } catch (er) { finish(); }
        }),
      });
    }
    /* live tap of what the speakers get (the master output) for meters: onChunk(channels) every ~85 ms; returns
       a function that removes the tap */
    tapMaster(onChunk) {
      this.init(); let rec = null, gone = false;
      Promise.resolve(this.wl).then((ok) => { if (gone || !this.ctx || ok === false) return; rec = this.recorder(2, (d) => onChunk(d.ch), false); this.master.connect(rec.node); });
      return () => { gone = true; if (rec) { try { this.master.disconnect(rec.node); } catch (e) { /* */ } rec.stop(); } };
    }
    toBuffer(chs, sr) {
      const b = new AudioBuffer({ numberOfChannels: chs.length, length: Math.max(1, chs[0].length), sampleRate: sr });
      chs.forEach((c, i) => b.copyToChannel(c, i));
      return b;
    }
    prepare() { this.init(); this.stop(); return this.ctx.currentTime + 0.04; }
    /* sources already started at t0 (absolute ctx time) from position startPos (seconds).
       o.rate: the playhead moves at this speed (Shuttle; negative = backwards) · o.map(el): position after el seconds
       of playback, for playback that jumps (Skip Selection, Preview Edit, playlists) */
    begin(sources, t0, startPos, endPos, loopLen, o) {
      this.sources = sources; this.t0 = t0; this.startPos = startPos; this.endPos = endPos; this.loopLen = loopLen || 0; this.playing = true;
      this.rate = (o && o.rate) || 1; this.map = (o && o.map) || null;
      this._ck = undefined; this.startWatch();
    }
    /* smoothed audio clock: ctx.currentTime only advances once per audio callback (~10 ms steps), which made the
       playhead jitter; extrapolate with performance.now() and steer gently back toward the real clock */
    clock() {
      const ct = this.ctx.currentTime, now = performance.now() / 1000;
      if (this._ck === undefined) { this._ck = ct; this._ckAt = now; return ct; }
      let t = this._ck + (now - this._ckAt);
      const err = ct - t;
      if (Math.abs(err) > 0.1) t = ct; else t += err * 0.05; // resync after a stall / suspend
      if (t < this._ck) t = this._ck; // never run backwards
      this._ck = t; this._ckAt = now;
      return t;
    }
    stop() {
      this.stopWatch();
      if (this.onStop) this.onStop();
      for (const s of this.sources) { try { s.onended = null; s.stop(); } catch (e) { /* already stopped */ } try { s.disconnect(); } catch (e) { /* */ } }
      this.sources = []; this.playing = false;
    }
    /* current position in seconds, or null if finished */
    pos() {
      if (!this.playing) return null;
      let el = Math.max(0, this.clock() - this.t0);
      if (this.map) return this.map(el);
      if (this.loopLen) return this.startPos + (el % this.loopLen);
      return this.startPos + el * (this.rate || 1);
    }
    levels() {
      if (!this.ctx) return [0, 0];
      const src = this.rec ? this.rec.an : null;
      const out = [];
      for (let c = 0; c < 2; c++) {
        const an = src || this.an[c];
        an.getFloatTimeDomainData(this.buf);
        let p = 0; for (let i = 0; i < this.buf.length; i++) { const v = Math.abs(this.buf[i]); if (v > p) p = v; }
        out.push(p);
      }
      return out;
    }
    /* the audio input (microphone / interface) as a node, shared by recording and input monitoring */
    async openInput() {
      this.init();
      if (this.input) return this.input.src;
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 2, ...(this.inId ? { deviceId: { exact: this.inId } } : {}) } });
      this.input = { stream, src: this.ctx.createMediaStreamSource(stream) };
      return this.input.src;
    }
    closeInput() { if (!this.input) return; try { this.input.src.disconnect(); } catch (e) { /* */ } this.input.stream.getTracks().forEach((t) => t.stop()); this.input = null; }
    /* Recording runs on the audio thread (AudioWorklet 'as-rec'), so no block is ever dropped and the context time
       of every recorded sample is known (startTime) — the caller places it on the timeline from that.
       opts.input: record any AudioNode instead of the audio input (latency test, tests); opts.onChunk({peak}) */
    async startRecord(opts) {
      const o = opts || {}; this.init();
      if ((await this.wl) === false) throw new Error('The recorder could not be loaded (audio worklet failed). Restart AudioStage and try again.');
      const src = o.input || (await this.openInput()), ctx = this.ctx, an = ctx.createAnalyser();
      an.fftSize = 1024;
      const rec = this.recorder(2, o.onChunk);
      src.connect(an); src.connect(rec.node);
      this.rec = { src, an, rec, sr: ctx.sampleRate, start: performance.now(), own: !o.input };
      return this.rec;
    }
    async stopRecord(keepInput) {
      const r = this.rec;
      if (!r) return null;
      this.rec = null;
      const ch = await r.rec.stop();
      try { r.src.disconnect(r.an); r.src.disconnect(r.rec.node); } catch (e) { /* */ }
      if (r.own && !keepInput) this.closeInput();
      return { sr: r.sr, ch, startTime: r.rec.startTime };
    }
  }

  Engine.STALL_S = 5;

  /* AudioBuffer copies made for playback (owner._ab): the audio exists twice while one is cached, so they are kept within a
     byte budget, least recently used dropped first. A buffer a running graph uses stays alive through that graph.
     sweep(used): drop those of owners that are no longer in use (the transport stopped, a clip was deleted). */
  const abCache = {
    map: new Map(), bytes: 0,
    budget: () => 1.5 * 1024 * 1024 * 1024,
    size: (b) => b.length * b.numberOfChannels * 4,
    drop(o) { if (!this.map.has(o)) return; this.bytes -= this.map.get(o); this.map.delete(o); o._ab = null; },
    put(o, b) {
      this.drop(o); const n = this.size(b); o._ab = b; this.map.set(o, n); this.bytes += n;
      for (const k of this.map.keys()) { if (this.bytes <= this.budget() || k === o) break; this.drop(k); }
      return b;
    },
    get(o, build) { if (o._ab && this.map.has(o)) { const n = this.map.get(o); this.map.delete(o); this.map.set(o, n); return o._ab; } return this.put(o, build()); },
    sweep(used) { for (const k of [...this.map.keys()]) if (!used(k)) this.drop(k); },
  };
  AS.abCache = abCache;

  let docId = 1;
  class Doc {
    constructor(name, sr, ch) {
      this.id = docId++; this.name = name; this.sr = sr; this.ch = ch;
      this.sel = { a: 0, b: 0 }; this.undoStack = []; this.redoStack = []; this.markers = []; this.playlist = []; // markers: {id, t, name, d?: range length}; playlist: [{id: range marker, loops}]
      this.version = 0; this.dirty = false; this.vs = { start: 0, spp: 0 };
      this.chOn = ch.map(() => true); this.spec = null;
    }
    /* indices of channels that edits/effects apply to */
    enabled() { const r = []; this.chOn.forEach((o, i) => { if (o) r.push(i); }); return r.length ? r : this.ch.map((_, i) => i); }
    get len() { return this.ch[0].length; }
    get dur() { return this.len / this.sr; }
    hasSel() { return this.sel.b > this.sel.a; }
    range() { return this.hasSel() ? [this.sel.a, this.sel.b] : [0, this.len]; }
    snap(label) { return { label, ch: this.ch, sr: this.sr, sel: { ...this.sel }, markers: this.markers.map((m) => ({ ...m })), playlist: (this.playlist || []).map((p) => ({ ...p })), tempo: this.tempo ? { ...this.tempo } : null }; }
    /* an undoable change that keeps the audio (tempo, …) */
    setMeta(label, fn) { this.undoStack.push(this.snap(label)); if (this.undoStack.length > 40) this.undoStack.shift(); this.redoStack = []; fn(this); this.dirty = true; } // (no version bump: the audio is unchanged)
    set(ch, label, sel, sr) {
      const s = this.snap(label);
      this.undoStack.push(s); if (this.undoStack.length > 40) this.undoStack.shift();
      this.redoStack = [];
      this.ch = ch; if (sr) this.sr = sr; this.version++; this.dirty = true; this.spec = null;
      if (this.chOn.length !== ch.length) this.chOn = ch.map(() => true);
      if (sel) this.sel = sel;
      this.clampSel();
      toDiff(s, this.ch); this.trimUndo();
    }
    /* Undo memory: every step that changed the audio keeps the audio as it was. A step that changed only a part
       (an effect on a selection) keeps only that part (toDiff); the steps together stay within a byte budget
       (Doc.undoBudget: a quarter of the memory, at most 1.5 GB) — the oldest are dropped first (at least the last
       step is kept), and the app is told once (Doc.onTrim) */
    undoBytes() { let n = 0; const seen = new Set(this.ch); for (const s of [...this.undoStack, ...this.redoStack]) n += snapBytes(s, seen); return n; }
    /* One budget for all open files together: when the total is over it, the oldest step of the file used least recently
       goes first (this file keeps at least its last step). Returns how many steps this file lost. */
    trimUndo() {
      this.touched = ++Doc.tick; Doc.live = Doc.live.filter((r) => r.deref()); if (!Doc.live.some((r) => r.deref() === this)) Doc.live.push(new WeakRef(this));
      const docs = Doc.live.map((r) => r.deref()).filter(Boolean), budget = Doc.undoBudget(), lost = new Map();
      let total = docs.reduce((n, d) => n + d.undoBytes(), 0);
      while (total > budget) {
        const v = docs.filter((d) => d.undoStack.length > (d === this ? 1 : 0)).sort((x, y) => (x.touched || 0) - (y.touched || 0))[0];
        if (!v) break;
        v.undoStack.shift(); lost.set(v, (lost.get(v) || 0) + 1); total = docs.reduce((n, d) => n + d.undoBytes(), 0);
      }
      for (const [d, n] of lost) if (Doc.onTrim) Doc.onTrim(d, n);
      return lost.get(this) || 0;
    }
    clampSel() { const L = this.len; this.sel.a = D.clamp(this.sel.a, 0, L); this.sel.b = D.clamp(this.sel.b, this.sel.a, L); }
    /* every marker gets a stable id (markers read from WAV cue points have none) */
    markerIds() { for (const m of this.markers) if (!m.id) m.id = 'm' + (Doc.mk = (Doc.mk || 0) + 1); return this.markers; }
    /* range markers in time order, as {id, name, a, b} (samples) */
    ranges() { return this.markerIds().filter((m) => m.d > 0).sort((p, q) => p.t - q.t).map((m) => ({ id: m.id, name: m.name, a: m.t, b: Math.min(this.len, m.t + m.d) })); }
    undo() { return this.step(this.undoStack, this.redoStack); }
    redo() { return this.step(this.redoStack, this.undoStack); }
    step(from, to) {
      const s = from.pop(); if (!s) return null;
      const back = this.snap(s.label), ch = fromDiff(s, this.ch);
      this.restore({ ...s, ch }); toDiff(back, this.ch); to.push(back);
      return s.label;
    }
    restore(s) { this.ch = s.ch; this.spec = null; this.tempo = s.tempo || null; if (this.chOn.length !== s.ch.length) this.chOn = s.ch.map(() => true); this.sr = s.sr; this.sel = s.sel; this.markers = s.markers; this.playlist = s.playlist || []; this.version++; this.dirty = true; this.clampSel(); }
    audioBuffer() {
      if (this._abV !== this.version) { abCache.drop(this); this._abV = this.version; }
      return abCache.get(this, () => AS.engine.toBuffer(this.ch, this.sr));
    }
    peaks() { if (!this._pk || this._pkV !== this.version) { this._pk = new Peaks(this.ch); this._pkV = this.version; } return this._pk; }
  }

  /* ---- undo snapshots that keep only the changed part of the audio ---- */
  /* turn snapshot s (s.ch = the audio before) into a diff against cur (the audio after), per channel:
     same array → { same }, a changed range of at most half the file → { a, old } (the samples before), else { full } */
  function toDiff(s, cur) {
    if (!s.ch || s.ch.length !== cur.length) return s;
    const parts = []; let saved = false;
    for (let c = 0; c < cur.length; c++) {
      const x = s.ch[c], y = cur[c];
      if (x === y) { parts.push({ same: true }); continue; }
      if (x.length !== y.length) { parts.push({ full: x }); continue; }
      let a = 0, b = x.length; while (a < b && x[a] === y[a]) a++; while (b > a && x[b - 1] === y[b - 1]) b--;
      if (b - a > x.length / 2) parts.push({ full: x }); else { parts.push({ a, old: x.slice(a, b) }); saved = true; }
    }
    if (saved) { s.parts = parts; s.ch = null; }
    return s;
  }
  /* the audio a (diff) snapshot stands for, given the current audio */
  function fromDiff(s, cur) {
    if (!s.parts) return s.ch;
    return s.parts.map((p, c) => { if (p.same) return cur[c]; if (p.full) return p.full; const y = cur[c].slice(); y.set(p.old, p.a); return y; });
  }
  function snapBytes(s, seen) {
    let n = 0; const add = (arr) => { if (arr && !seen.has(arr)) { seen.add(arr); n += arr.byteLength; } };
    if (s.parts) for (const p of s.parts) { if (p.full) add(p.full); if (p.old) n += p.old.byteLength; } else for (const c of s.ch || []) add(c);
    return n;
  }
  Doc.undoBudget = () => { const gb = 1024 * 1024 * 1024, mem = (root.navigator && root.navigator.deviceMemory) || 4; return Math.min(1.5 * gb, (mem * gb) / 4); };
  Doc.onTrim = null; Doc.live = []; Doc.tick = 0; // (the open files that have undo steps, for the shared budget)
  AS.undoDiff = { toDiff, fromDiff, snapBytes };

  class Peaks {
    constructor(chs, block) {
      this.chs = chs; this.block = block || 128; this.mn = []; this.mx = [];
      const B = this.block;
      for (const c of chs) {
        const n = Math.ceil(c.length / B), mn = new Float32Array(n), mx = new Float32Array(n);
        for (let b = 0; b < n; b++) {
          let lo = 1, hi = -1; const e = Math.min(c.length, (b + 1) * B);
          for (let i = b * B; i < e; i++) { const v = c[i]; if (v < lo) lo = v; if (v > hi) hi = v; }
          mn[b] = lo; mx[b] = hi;
        }
        this.mn.push(mn); this.mx.push(mx);
      }
    }
    range(c, s0, s1) {
      const x = this.chs[c], L = x.length;
      s0 = Math.max(0, Math.floor(s0)); s1 = Math.min(L, Math.max(s0 + 1, Math.ceil(s1)));
      if (s0 >= L) return null;
      let lo = 1, hi = -1;
      if (s1 - s0 <= this.block * 2) { for (let i = s0; i < s1; i++) { const v = x[i]; if (v < lo) lo = v; if (v > hi) hi = v; } }
      else {
        const B = this.block, b0 = Math.floor(s0 / B), b1 = Math.min(this.mn[c].length, Math.ceil(s1 / B)), mn = this.mn[c], mx = this.mx[c];
        for (let b = b0; b < b1; b++) { if (mn[b] < lo) lo = mn[b]; if (mx[b] > hi) hi = mx[b]; }
      }
      return [lo, hi];
    }
  }

  AS.engine = new Engine();
  AS.Doc = Doc; AS.Peaks = Peaks;
})(window);



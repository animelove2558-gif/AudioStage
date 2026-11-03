/* Audio engine (playback, metering, recording) + Doc model. */
(function (root) {
  'use strict';
  const AS = (root.AS = root.AS || {});
  const D = AS.dsp;

  class Engine {
    constructor() { this.ctx = null; this.sources = []; this.playing = false; this.rec = null; }
    init() {
      if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
      const ctx = (this.ctx = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'interactive' }));
      this.master = ctx.createGain();
      this.split = ctx.createChannelSplitter(2);
      this.an = [0, 1].map(() => { const a = ctx.createAnalyser(); a.fftSize = 1024; return a; });
      this.master.connect(ctx.destination);
      if (this.outId && ctx.setSinkId) ctx.setSinkId(this.outId).catch(() => {});
      this.master.connect(this.split);
      this.split.connect(this.an[0], 0); this.split.connect(this.an[1], 1);
      this.buf = new Float32Array(1024);
      this.spec = ctx.createAnalyser(); this.spec.fftSize = 2048; this.spec.smoothingTimeConstant = 0.6; this.master.connect(this.spec); // Spectrum Analyzer panel
      this.meters = {}; // live per-clip / per-track / master level taps, rebuilt with every playback graph
      this.wl = AS.rack ? AS.rack.loadWorklets(ctx) : null; // noise-gate worklet
    }
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
      const join = (list) => { const o = new Float32Array(list.reduce((a, b) => a + b.length, 0)); let p = 0; for (const b of list) { o.set(b, p); p += b.length; } return o; };
      return Object.assign(handle, {
        stop: () => new Promise((resolve) => { finish = () => { try { node.disconnect(); sink.disconnect(); } catch (er) { /* */ } resolve(chunks.map(join)); }; node.port.postMessage({ cmd: 'stop' }); }),
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
      this._ck = undefined;
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
      const o = opts || {}; this.init(); await this.wl;
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
      this.undoStack.push(this.snap(label)); if (this.undoStack.length > 40) this.undoStack.shift();
      this.redoStack = [];
      this.ch = ch; if (sr) this.sr = sr; this.version++; this.dirty = true; this.spec = null;
      if (this.chOn.length !== ch.length) this.chOn = ch.map(() => true);
      if (sel) this.sel = sel;
      this.clampSel();
    }
    clampSel() { const L = this.len; this.sel.a = D.clamp(this.sel.a, 0, L); this.sel.b = D.clamp(this.sel.b, this.sel.a, L); }
    /* every marker gets a stable id (markers read from WAV cue points have none) */
    markerIds() { for (const m of this.markers) if (!m.id) m.id = 'm' + (Doc.mk = (Doc.mk || 0) + 1); return this.markers; }
    /* range markers in time order, as {id, name, a, b} (samples) */
    ranges() { return this.markerIds().filter((m) => m.d > 0).sort((p, q) => p.t - q.t).map((m) => ({ id: m.id, name: m.name, a: m.t, b: Math.min(this.len, m.t + m.d) })); }
    undo() { const s = this.undoStack.pop(); if (!s) return null; this.redoStack.push(this.snap(s.label)); this.restore(s); return s.label; }
    redo() { const s = this.redoStack.pop(); if (!s) return null; this.undoStack.push(this.snap(s.label)); this.restore(s); return s.label; }
    restore(s) { this.ch = s.ch; this.spec = null; this.tempo = s.tempo || null; if (this.chOn.length !== s.ch.length) this.chOn = s.ch.map(() => true); this.sr = s.sr; this.sel = s.sel; this.markers = s.markers; this.playlist = s.playlist || []; this.version++; this.dirty = true; this.clampSel(); }
    audioBuffer() {
      if (!this._ab || this._abV !== this.version) { this._ab = AS.engine.toBuffer(this.ch, this.sr); this._abV = this.version; }
      return this._ab;
    }
    peaks() { if (!this._pk || this._pkV !== this.version) { this._pk = new Peaks(this.ch); this._pkV = this.version; } return this._pk; }
  }

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



/* Real-time effects rack (Web Audio node graphs): used per clip, per track and on the master bus, plus automation helpers.
   A rack owner is any object with `fx` (array of up to 16 slots; an empty slot is null) and `rackCfg`
   ({power, in, out, mix}: rack on/off, input gain dB, output gain dB, dry/wet percent). */
(function (root) {
  'use strict';
  const AS = (root.AS = root.AS || {});
  const fromDb = (d) => Math.pow(10, d / 20);
  const SLOTS = 16;
  const P = (id, label, min, max, value, step, unit) => ({ id, label, type: 'range', min, max, value, step: step || 0.1, unit: unit || '' });
  const SEL = (id, label, options, value) => ({ id, label, type: 'select', options, value });
  const CHK = (id, label, value) => ({ id, label, type: 'check', value: !!value });

  /* ---------- node helpers ---------- */
  const st = (ctx) => { const g = ctx.createGain(); g.channelCount = 2; g.channelCountMode = 'explicit'; g.channelInterpretation = 'speakers'; return g; }; // forces mono -> stereo upmix
  function mixer(ctx, input, wet, mix, ex) {
    const out = ctx.createGain(), dry = ctx.createGain(), wg = ctx.createGain();
    dry.gain.value = 1 - mix; wg.gain.value = mix;
    input.connect(dry); dry.connect(out); wet.connect(wg); wg.connect(out);
    reg(ex, 'mix', dry.gain, (v) => 1 - v); reg(ex, 'mix', wg.gain);
    return out;
  }
  /* mid/side encode: returns {M, S} mono gain nodes */
  function msEncode(ctx, input) {
    const s = st(ctx); input.connect(s);
    const sp = ctx.createChannelSplitter(2); s.connect(sp);
    const M = ctx.createGain(), S = ctx.createGain(), inv = ctx.createGain();
    M.gain.value = 0.5; S.gain.value = 0.5; inv.gain.value = -1;
    sp.connect(M, 0); sp.connect(M, 1); sp.connect(S, 0); sp.connect(inv, 1); inv.connect(S);
    return { M, S };
  }
  function msDecode(ctx, M, S) {
    const mg = ctx.createChannelMerger(2), L = ctx.createGain(), R = ctx.createGain(), neg = ctx.createGain();
    neg.gain.value = -1;
    M.connect(L); S.connect(L); M.connect(R); S.connect(neg); neg.connect(R);
    L.connect(mg, 0, 0); R.connect(mg, 0, 1);
    return mg;
  }
  const irCache = new WeakMap();
  function makeIR(ctx, secs, damp) {
    const key = secs + '|' + damp; let m = irCache.get(ctx); if (!m) { m = {}; irCache.set(ctx, m); }
    if (m[key]) return m[key];
    const sr = ctx.sampleRate, len = Math.max(1, Math.round(sr * secs)), b = new AudioBuffer({ numberOfChannels: 2, length: len, sampleRate: sr });
    for (let c = 0; c < 2; c++) {
      const d = b.getChannelData(c); let lp = 0;
      for (let i = 0; i < len; i++) { const t = i / len, n = Math.random() * 2 - 1; lp += (n - lp) * (1 - damp * 0.9); d[i] = lp * Math.pow(1 - t, 3) * (i < sr * 0.002 ? i / (sr * 0.002) : 1); }
    }
    return (m[key] = b);
  }
  /* register an AudioParam so it can be automated */
  function reg(ex, id, param, conv) { if (ex && ex.regs) ex.regs.push({ f: ex.cur, id, param, conv: conv || ((v) => v) }); }
  function lfo(ctx, ex, rate, depth) {
    const o = ctx.createOscillator(), g = ctx.createGain(); o.frequency.value = rate; g.gain.value = depth;
    o.connect(g); o.start(ex.t0); ex.nodes.push(o); g._osc = o; return g;
  }
  /* AudioWorklet modules (noise gate): load once per context before building graphs that use them */
  function loadWorklets(ctx) {
    if (!ctx.audioWorklet) return Promise.resolve(false);
    if (ctx._wlP) return ctx._wlP;
    // dsp.js first: the sidechain dynamics processor calls AS.dsp.createDynamics (same code the Node tests run)
    return (ctx._wlP = ctx.audioWorklet.addModule('js/dsp.js').then(() => ctx.audioWorklet.addModule('js/worklet.js')).then(() => (ctx._wl = true), (e) => { console.warn('AudioWorklet unavailable:', e && e.message); ctx._wl = false; return false; }));
  }

  /* ---------- sidechain ----------
     An effect with a `sc` parameter can be keyed by another track: the graph builder offers ex.key(trackId), a node
     carrying that track's post-fader signal (null when there is no valid key, e.g. in the Waveform editor or when
     the route would make a loop). The parameter's options are filled by the app (AS.rack.sidechainOptions). */
  const SC = (label) => ({ id: 'sc', label: label || 'Sidechain input', type: 'select', options: (cx) => (AS.rack.sidechainOptions ? AS.rack.sidechainOptions(cx) : [['', 'None (own input)']]), value: '' });
  const keyNode = (ex, p) => (p && p.sc && ex && ex.key ? ex.key(p.sc) : null);
  /* select options may be a function of the context ({ownerId}) — use this everywhere options are rendered */
  const optionsOf = (p, cx) => (typeof p.options === 'function' ? p.options(cx || {}) : p.options) || [];
  /* sidechain dynamics node (AudioWorklet 'as-dyn'); key may be null (= detect on the input itself) */
  function dynNode(ctx, mode, values, inp, key, ex, regIds) {
    const n = new AudioWorkletNode(ctx, 'as-dyn', { numberOfInputs: 2, numberOfOutputs: 1, outputChannelCount: [2], channelCount: 2, channelCountMode: 'explicit', processorOptions: { mode } });
    for (const [id, v] of Object.entries(values)) { const prm = n.parameters.get(id); if (prm) prm.value = v; }
    for (const [id, pid, conv] of regIds || []) { const prm = n.parameters.get(pid); if (prm) reg(ex, id, prm, conv); }
    inp.connect(n, 0, 0); if (key) key.connect(n, 0, 1);
    return n;
  }

  /* ---------- effect definitions ---------- */
  const RACK = {
    gain: { name: 'Gain', cat: 'Utility', params: [P('db', 'Gain', -30, 30, 0, 0.1, 'dB')], build: (ctx, p, inp, ex) => { const g = ctx.createGain(); g.gain.value = fromDb(p.db); reg(ex, 'db', g.gain, fromDb); inp.connect(g); return g; } },
    eq: { name: '3-Band EQ', cat: 'EQ and Filters', params: [P('lowG', 'Low (200 Hz)', -18, 18, 0, 0.1, 'dB'), P('midF', 'Mid freq', 200, 8000, 1500, 1, 'Hz'), P('midG', 'Mid gain', -18, 18, 0, 0.1, 'dB'), P('midQ', 'Mid Q', 0.2, 8, 1, 0.1), P('highG', 'High (5 kHz)', -18, 18, 0, 0.1, 'dB')],
      build: (ctx, p, inp, ex) => { const a = ctx.createBiquadFilter(), b = ctx.createBiquadFilter(), c = ctx.createBiquadFilter(); reg(ex, 'lowG', a.gain); reg(ex, 'midF', b.frequency); reg(ex, 'midG', b.gain); reg(ex, 'highG', c.gain); a.type = 'lowshelf'; a.frequency.value = 200; a.gain.value = p.lowG; b.type = 'peaking'; b.frequency.value = p.midF; b.Q.value = p.midQ; b.gain.value = p.midG; c.type = 'highshelf'; c.frequency.value = 5000; c.gain.value = p.highG; inp.connect(a); a.connect(b); b.connect(c); return c; } },
    filter: { name: 'Filter', cat: 'EQ and Filters', params: [SEL('type', 'Type', [['highpass', 'High-pass'], ['lowpass', 'Low-pass'], ['bandpass', 'Band-pass'], ['notch', 'Notch']], 'highpass'), P('f', 'Frequency', 20, 20000, 80, 1, 'Hz'), P('q', 'Q', 0.2, 12, 0.707, 0.01)],
      build: (ctx, p, inp, ex) => { const f = ctx.createBiquadFilter(); reg(ex, 'f', f.frequency); reg(ex, 'q', f.Q); f.type = p.type; f.frequency.value = p.f; f.Q.value = p.q; inp.connect(f); return f; } },
    comp: { name: 'Compressor', cat: 'Dynamics', params: [P('thr', 'Threshold', -60, 0, -24, 0.5, 'dB'), P('knee', 'Knee', 0, 40, 12, 1, 'dB'), P('ratio', 'Ratio', 1, 20, 4, 0.1, ': 1'), P('att', 'Attack', 0, 200, 10, 1, 'ms'), P('rel', 'Release', 10, 1000, 200, 5, 'ms'), P('makeup', 'Makeup gain', -12, 24, 3, 0.5, 'dB'), SC()],
      build: (ctx, p, inp, ex) => {
        const key = ctx._wl && keyNode(ex, p);
        if (key) return dynNode(ctx, 'comp', { thr: p.thr, knee: p.knee, ratio: p.ratio, att: p.att, rel: p.rel, makeup: p.makeup }, inp, key, ex, [['thr', 'thr'], ['knee', 'knee'], ['ratio', 'ratio'], ['att', 'att'], ['rel', 'rel'], ['makeup', 'makeup']]);
        const c = ctx.createDynamicsCompressor(), g = ctx.createGain(); reg(ex, 'thr', c.threshold); reg(ex, 'knee', c.knee); reg(ex, 'ratio', c.ratio); reg(ex, 'att', c.attack, (v) => v / 1000); reg(ex, 'rel', c.release, (v) => v / 1000); reg(ex, 'makeup', g.gain, fromDb); c.threshold.value = p.thr; c.knee.value = p.knee; c.ratio.value = p.ratio; c.attack.value = p.att / 1000; c.release.value = p.rel / 1000; g.gain.value = fromDb(p.makeup); inp.connect(c); c.connect(g); return g; } },
    limiter: { name: 'Limiter', cat: 'Dynamics', params: [P('ceil', 'Ceiling', -24, 0, -1, 0.1, 'dB')],
      build: (ctx, p, inp, ex) => { const c = ctx.createDynamicsCompressor(); reg(ex, 'ceil', c.threshold); c.threshold.value = p.ceil; c.knee.value = 0; c.ratio.value = 20; c.attack.value = 0.001; c.release.value = 0.08; inp.connect(c); return c; } },
    gate: { name: 'Noise Gate', cat: 'Dynamics', params: [P('thr', 'Threshold', -80, 0, -48, 0.5, 'dB'), P('floor', 'Reduction', -80, 0, -60, 1, 'dB'), P('att', 'Attack', 0, 100, 3, 1, 'ms'), P('hold', 'Hold', 0, 500, 40, 1, 'ms'), P('rel', 'Release', 5, 1000, 120, 5, 'ms'), SC('Key input')],
      build: (ctx, p, inp, ex) => {
        if (!ctx._wl) return inp; // worklet not available: pass through
        const key = keyNode(ex, p); // input 2 of the gate = sidechain key (opens the gate)
        const n = new AudioWorkletNode(ctx, 'as-gate', { numberOfInputs: 2, numberOfOutputs: 1, outputChannelCount: [2], channelCount: 2, channelCountMode: 'explicit' });
        for (const id of ['thr', 'floor', 'att', 'hold', 'rel']) { const prm = n.parameters.get(id); prm.value = p[id]; reg(ex, id, prm); }
        inp.connect(n, 0, 0); if (key) key.connect(n, 0, 1); return n;
      } },
    deess: { name: 'De-esser', cat: 'Dynamics', params: [P('f', 'Sibilance frequency', 3000, 10000, 6500, 50, 'Hz'), P('thr', 'Threshold', -60, 0, -32, 0.5, 'dB'), P('ratio', 'Ratio', 1, 20, 6, 0.1, ': 1')],
      build: (ctx, p, inp, ex) => {
        const lp = ctx.createBiquadFilter(), hp = ctx.createBiquadFilter(), c = ctx.createDynamicsCompressor(), sum = ctx.createGain();
        lp.type = 'lowpass'; hp.type = 'highpass'; lp.frequency.value = hp.frequency.value = p.f; lp.Q.value = hp.Q.value = 0.707;
        c.threshold.value = p.thr; c.ratio.value = p.ratio; c.knee.value = 4; c.attack.value = 0.002; c.release.value = 0.06;
        reg(ex, 'f', lp.frequency); reg(ex, 'f', hp.frequency); reg(ex, 'thr', c.threshold); reg(ex, 'ratio', c.ratio);
        inp.connect(lp); lp.connect(sum); inp.connect(hp); hp.connect(c); c.connect(sum); return sum;
      } },
    delay: { name: 'Delay / Echo', cat: 'Time', params: [P('ms', 'Time', 10, 1500, 350, 1, 'ms'), P('fb', 'Feedback', 0, 0.9, 0.35, 0.01), P('mix', 'Mix', 0, 1, 0.3, 0.01), SEL('image', 'Stereo image', [['all', 'Whole signal'], ['center', 'Center (mid) only'], ['side', 'Sides only']], 'all')],
      build: (ctx, p, inp, ex) => {
        const mk = (src) => { const d = ctx.createDelay(2), fb = ctx.createGain(); reg(ex, 'ms', d.delayTime, (v) => v / 1000); reg(ex, 'fb', fb.gain); d.delayTime.value = p.ms / 1000; fb.gain.value = p.fb; src.connect(d); d.connect(fb); fb.connect(d); return mixer(ctx, src, d, p.mix, ex); };
        if (p.image === 'center' || p.image === 'side') { const { M, S } = msEncode(ctx, inp); return p.image === 'center' ? msDecode(ctx, mk(M), S) : msDecode(ctx, M, mk(S)); }
        return mk(inp);
      } },
    reverb: { name: 'Reverb', cat: 'Time', params: [P('len', 'Decay', 0.2, 6, 1.8, 0.1, 's'), P('damp', 'Damping', 0, 1, 0.5, 0.01), P('mix', 'Mix', 0, 1, 0.25, 0.01)],
      build: (ctx, p, inp, ex) => { const c = ctx.createConvolver(); c.buffer = makeIR(ctx, p.len, p.damp); inp.connect(c); return mixer(ctx, inp, c, p.mix, ex); } },
    chorus: { name: 'Chorus', cat: 'Modulation', params: [P('rate', 'Rate', 0.1, 6, 0.8, 0.05, 'Hz'), P('depth', 'Depth', 0.5, 12, 4, 0.1, 'ms'), P('mix', 'Mix', 0, 1, 0.5, 0.01)],
      build: (ctx, p, inp, ex) => { const d = ctx.createDelay(0.1); d.delayTime.value = 0.02; const l = lfo(ctx, ex, p.rate, p.depth / 1000); l.connect(d.delayTime); reg(ex, 'rate', l._osc.frequency); reg(ex, 'depth', l.gain, (v) => v / 1000); inp.connect(d); return mixer(ctx, inp, d, p.mix, ex); } },
    flanger: { name: 'Flanger', cat: 'Modulation', params: [P('rate', 'Rate', 0.05, 5, 0.3, 0.05, 'Hz'), P('depth', 'Depth', 0.2, 4, 1.5, 0.1, 'ms'), P('fb', 'Feedback', 0, 0.9, 0.5, 0.01), P('mix', 'Mix', 0, 1, 0.6, 0.01)],
      build: (ctx, p, inp, ex) => { const d = ctx.createDelay(0.05), fb = ctx.createGain(); d.delayTime.value = 0.003; fb.gain.value = p.fb; const l = lfo(ctx, ex, p.rate, p.depth / 1000); l.connect(d.delayTime); reg(ex, 'rate', l._osc.frequency); reg(ex, 'depth', l.gain, (v) => v / 1000); reg(ex, 'fb', fb.gain); inp.connect(d); d.connect(fb); fb.connect(d); return mixer(ctx, inp, d, p.mix, ex); } },
    phaser: { name: 'Phaser', cat: 'Modulation', params: [P('rate', 'Rate', 0.05, 5, 0.5, 0.05, 'Hz'), P('depth', 'Depth', 100, 1500, 600, 10, 'Hz'), P('mix', 'Mix', 0, 1, 0.6, 0.01)],
      build: (ctx, p, inp, ex) => { let cur = inp; const l = lfo(ctx, ex, p.rate, p.depth); reg(ex, 'rate', l._osc.frequency); reg(ex, 'depth', l.gain); for (let i = 0; i < 4; i++) { const f = ctx.createBiquadFilter(); f.type = 'allpass'; f.frequency.value = 700 + i * 200; l.connect(f.frequency); cur.connect(f); cur = f; } return mixer(ctx, inp, cur, p.mix, ex); } },
    tremolo: { name: 'Tremolo', cat: 'Modulation', params: [P('rate', 'Rate', 0.1, 20, 5, 0.1, 'Hz'), P('depth', 'Depth', 0, 1, 0.5, 0.01)],
      build: (ctx, p, inp, ex) => { const g = ctx.createGain(); g.gain.value = 1 - p.depth / 2; const l = lfo(ctx, ex, p.rate, p.depth / 2); l.connect(g.gain); reg(ex, 'rate', l._osc.frequency); reg(ex, 'depth', l.gain, (v) => v / 2); reg(ex, 'depth', g.gain, (v) => 1 - v / 2); inp.connect(g); return g; } },
    distortion: { name: 'Distortion', cat: 'Distortion', params: [P('drive', 'Drive', 1, 30, 5, 0.1), P('mix', 'Mix', 0, 1, 1, 0.01), P('out', 'Output', -24, 6, -6, 0.5, 'dB')],
      build: (ctx, p, inp, ex) => { const w = ctx.createWaveShaper(), n = 2048, cv = new Float32Array(n); for (let i = 0; i < n; i++) cv[i] = Math.tanh(((i / (n - 1)) * 2 - 1) * p.drive); w.curve = cv; w.oversample = '4x'; inp.connect(w); const m = mixer(ctx, inp, w, p.mix, ex), o = ctx.createGain(); o.gain.value = fromDb(p.out); reg(ex, 'out', o.gain, fromDb); m.connect(o); return o; } },
    crush: { name: 'Bit Crusher', cat: 'Distortion', params: [P('bits', 'Bit depth', 2, 12, 8, 1, 'bits'), P('mix', 'Mix', 0, 1, 1, 0.01)],
      build: (ctx, p, inp, ex) => { const w = ctx.createWaveShaper(), n = 8192, lv = Math.pow(2, p.bits - 1), cv = new Float32Array(n); for (let i = 0; i < n; i++) cv[i] = Math.round(((i / (n - 1)) * 2 - 1) * lv) / lv; w.curve = cv; inp.connect(w); return mixer(ctx, inp, w, p.mix, ex); } },
    widener: { name: 'Stereo Widener', cat: 'Stereo', params: [P('width', 'Width', 0, 3, 1.5, 0.05, 'x')],
      build: (ctx, p, inp, ex) => { const { M, S } = msEncode(ctx, inp); S.gain.value = 0.5 * p.width; reg(ex, 'width', S.gain, (v) => 0.5 * v); return msDecode(ctx, M, S); } },
    haas: { name: 'Haas Stereo Maker', cat: 'Stereo', params: [P('ms', 'Delay', 1, 40, 18, 0.5, 'ms'), SEL('side', 'Delayed channel', [['right', 'Right'], ['left', 'Left']], 'right')],
      build: (ctx, p, inp, ex) => {
        const s = st(ctx); inp.connect(s); const sp = ctx.createChannelSplitter(2), mg = ctx.createChannelMerger(2), d = ctx.createDelay(0.1);
        d.delayTime.value = p.ms / 1000; reg(ex, 'ms', d.delayTime, (v) => v / 1000); s.connect(sp);
        const a = p.side === 'right' ? 0 : 1, b = 1 - a;
        sp.connect(mg, a, a); sp.connect(d, b); d.connect(mg, 0, b); return mg;
      } },
    centercut: { name: 'Center Channel Cut', cat: 'Stereo', params: [P('mix', 'Amount', 0, 1, 1, 0.01)],
      build: (ctx, p, inp, ex) => {
        const s = st(ctx); inp.connect(s); const sp = ctx.createChannelSplitter(2), mg = ctx.createChannelMerger(2), sum = ctx.createGain(), inv = ctx.createGain();
        inv.gain.value = -1; sum.gain.value = 0.5; s.connect(sp); sp.connect(sum, 0); sp.connect(inv, 1); inv.connect(sum); sum.connect(mg, 0, 0); sum.connect(mg, 0, 1);
        return mixer(ctx, s, mg, p.mix, ex);
      } },
  };
  const AUTOMATABLE = { gain: ['db'], eq: ['lowG', 'midF', 'midG', 'highG'], filter: ['f', 'q'], comp: ['thr', 'knee', 'ratio', 'att', 'rel', 'makeup'], limiter: ['ceil'], gate: ['thr', 'floor', 'att', 'hold', 'rel'], deess: ['f', 'thr', 'ratio'], delay: ['ms', 'fb', 'mix'], reverb: ['mix'], chorus: ['rate', 'depth', 'mix'], flanger: ['rate', 'depth', 'fb', 'mix'], phaser: ['rate', 'depth', 'mix'], tremolo: ['rate', 'depth'], distortion: ['mix', 'out'], crush: ['mix'], widener: ['width'], haas: ['ms'], centercut: ['mix'] };
  for (const [k, ids] of Object.entries(AUTOMATABLE)) for (const p of RACK[k].params) if (ids.includes(p.id)) p.auto = true;
  for (const d of Object.values(RACK)) d.defaults = Object.fromEntries(d.params.map((x) => [x.id, x.value]));

  /* ---------- chain / rack ---------- */
  let uidSeq = 1;
  const uid = () => 'fx' + Date.now().toString(36) + (uidSeq++).toString(36);
  const cloneP = (o) => JSON.parse(JSON.stringify(o));
  const newFx = (type, p) => ({ uid: uid(), type, bypass: false, p: { ...cloneP(RACK[type].defaults), ...cloneP(p || {}) } });
  function chain(ctx, list, input, ex) {
    let cur = input;
    for (const f of list || []) {
      if (!f || f.bypass) continue; const d = RACK[f.type]; if (!d) continue;
      if (!f.uid) f.uid = uid();
      ex.cur = f;
      if (ex.meters) meterTap(ctx, cur, ex.meters, 'si:' + f.uid);
      cur = d.build(ctx, { ...d.defaults, ...f.p }, cur, ex);
      if (ex.meters) meterTap(ctx, cur, ex.meters, 'so:' + f.uid);
    }
    return cur;
  }
  /* add / replace an effect type (used by rack2.js). autoIds lists the params that can be automated */
  function define(type, def, autoIds) {
    def.defaults = Object.fromEntries(def.params.map((x) => [x.id, x.value]));
    for (const p of def.params) if (autoIds && autoIds.includes(p.id)) p.auto = true;
    RACK[type] = def; return def;
  }
  /* push a changed parameter into the graph that is currently playing: true when it could be applied without a rebuild */
  function liveUpdate(f, id, value) {
    const e = AS.engine; if (!e || !e.ctx || !e.regs) return false; let n = 0;
    for (const g of e.regs) if (g.f === f && g.id === id) { try { g.param.setTargetAtTime(g.conv(value), e.ctx.currentTime, 0.015); n++; } catch (er) { /* param gone */ } }
    if (!n) { const nd = AS.rack.nodes && AS.rack.nodes[f.uid], d = RACK[f.type]; if (nd && d && d.message) { const m = d.message(id, value, f.p); if (m) { nd.port.postMessage(m); return true; } } } // worklet settings that are not AudioParams
    return n > 0;
  }
  const activeFx = (list) => (list || []).filter((f) => f && !f.bypass && RACK[f.type]);
  const hasTail = (list) => activeFx(list).some((f) => f.type === 'reverb' || f.type === 'delay' || f.type === 'flanger');
  const defaultCfg = () => ({ power: true, in: 0, out: 0, mix: 100 });
  const cfgOf = (o) => { if (!o.rackCfg) o.rackCfg = defaultCfg(); else for (const [k, v] of Object.entries(defaultCfg())) if (o.rackCfg[k] === undefined) o.rackCfg[k] = v; return o.rackCfg; };
  const slots = (o) => { if (!o.fx) o.fx = []; return o.fx; };

  /* build a whole rack for `owner` (clip, track or master); `key` registers a live level meter */
  function applyRack(ctx, owner, input, ex, key) {
    const cfg = cfgOf(owner), list = owner.fx || [], active = activeFx(list).length > 0;
    let out = input;
    if (cfg.power !== false && (active || cfg.in || cfg.out)) {
      const ig = st(ctx); ig.gain.value = fromDb(cfg.in || 0); input.connect(ig);
      let wet = active ? chain(ctx, list, ig, ex) : ig;
      const mix = Math.max(0, Math.min(100, cfg.mix == null ? 100 : cfg.mix)) / 100;
      if (active && mix < 0.999) {
        const o = ctx.createGain(), dry = ctx.createGain(), w = ctx.createGain(); dry.gain.value = 1 - mix; w.gain.value = mix;
        ig.connect(dry); dry.connect(o); wet.connect(w); w.connect(o); wet = o;
      }
      const og = ctx.createGain(); og.gain.value = fromDb(cfg.out || 0); wet.connect(og); out = og;
    }
    if (ex.meters && key) meterTap(ctx, out, ex.meters, key);
    return out;
  }
  function meterTap(ctx, node, store, key) {
    const sp = ctx.createChannelSplitter(2), aL = ctx.createAnalyser(), aR = ctx.createAnalyser();
    aL.fftSize = aR.fftSize = 1024; node.connect(sp); sp.connect(aL, 0); sp.connect(aR, 1);
    store[key] = { aL, aR, buf: new Float32Array(1024) };
  }
  function meterLevels(store, key) {
    const m = store && store[key]; if (!m) return [0, 0];
    const peak = (a) => { a.getFloatTimeDomainData(m.buf); let p = 0; for (let i = 0; i < m.buf.length; i++) { const v = Math.abs(m.buf[i]); if (v > p) p = v; } return p; };
    return [peak(m.aL), peak(m.aR)];
  }

  /* Essential-Sound style presets (used by the auto-detect feature) */
  const fx = (type, p) => ({ type, bypass: false, p });
  const PRESETS = {
    'Dialogue': () => [fx('filter', { type: 'highpass', f: 80, q: 0.707 }), fx('eq', { lowG: -2, midF: 3200, midG: 3, midQ: 1, highG: 1.5 }), fx('comp', { thr: -24, knee: 10, ratio: 3, att: 8, rel: 180, makeup: 5 }), fx('limiter', { ceil: -1 })],
    'Voiceover (clean)': () => [fx('filter', { type: 'highpass', f: 90, q: 0.707 }), fx('eq', { lowG: 1, midF: 4500, midG: 2, midQ: 0.9, highG: 2 }), fx('comp', { thr: -22, knee: 8, ratio: 4, att: 5, rel: 150, makeup: 5 }), fx('limiter', { ceil: -1 })],
    'Music': () => [fx('eq', { lowG: 1, midF: 1500, midG: -1, midQ: 0.8, highG: 1.5 }), fx('comp', { thr: -18, knee: 18, ratio: 2, att: 30, rel: 250, makeup: 2 })],
    'Sound effects': () => [fx('filter', { type: 'highpass', f: 40, q: 0.707 }), fx('comp', { thr: -20, knee: 6, ratio: 2.5, att: 3, rel: 120, makeup: 2 })],
    'Ambience': () => [fx('filter', { type: 'lowpass', f: 9000, q: 0.707 }), fx('reverb', { len: 3, damp: 0.6, mix: 0.35 }), fx('gain', { db: -4 })],
    'Telephone voice': () => [fx('filter', { type: 'highpass', f: 400, q: 1 }), fx('filter', { type: 'lowpass', f: 3400, q: 1 }), fx('distortion', { drive: 3, mix: 0.4, out: -3 })],
  };

  /* ---------- automation helpers ---------- */
  function valueAt(pts, t, dflt) {
    if (!pts || !pts.length) return dflt;
    if (t <= pts[0].t) return pts[0].v;
    for (let i = 1; i < pts.length; i++) if (t <= pts[i].t) { const a = pts[i - 1], b = pts[i], u = (t - a.t) / Math.max(1e-9, b.t - a.t); return a.v + (b.v - a.v) * u; }
    return pts[pts.length - 1].v;
  }
  function schedule(param, pts, fromT, t0, conv, dflt) {
    const v0 = valueAt(pts, fromT, dflt);
    param.setValueAtTime(conv(v0), t0);
    if (!pts || !pts.length) return;
    for (const p of pts) if (p.t > fromT) param.linearRampToValueAtTime(conv(p.v), t0 + p.t - fromT);
  }
  /* apply fx-parameter automation collected while building the chains */
  function applyFxAuto(ex, fromT, t0) {
    for (const g of ex.regs || []) {
      const pts = g.f && g.f.auto && g.f.auto[g.id];
      if (pts && pts.length) schedule(g.param, pts, fromT, t0, g.conv, g.f.p[g.id] !== undefined ? g.f.p[g.id] : RACK[g.f.type].defaults[g.id]);
    }
  }

  AS.rack = { cloneP, H: { st, mixer, msEncode, msDecode, reg, lfo, makeIR, fromDb, P, SEL, CHK, SC, keyNode, dynNode }, optionsOf, define, newFx, uid, liveUpdate, RACK, SLOTS, applyFxAuto, chain, applyRack, activeFx, hasTail, cfgOf, slots, defaultCfg, PRESETS, valueAt, schedule, loadWorklets, meterLevels, meterTap };
})(window);

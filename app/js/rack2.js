/* Additional rack effects (everything in the Effects menu that runs in the real-time engine).
   Each is a Web Audio / AudioWorklet graph, so the same code serves live playback on a track and the offline
   "Apply" render in the waveform editor. Needs rack.js (helpers in AS.rack.H) and dsp.js. */
(function (root) {
  'use strict';
  const AS = (root.AS = root.AS || {}), R = AS.rack, H = R.H, D = AS.dsp;
  const { st, mixer, msEncode, msDecode, reg, lfo, fromDb, P, SEL, CHK } = H;
  const CAT = { amp: 'Amplitude and Compression', delay: 'Delay and Echo', filter: 'Filter and EQ', mod: 'Modulation', nr: 'Noise Reduction / Restoration', rev: 'Reverb', special: 'Special', stereo: 'Stereo Imagery', pitch: 'Time and Pitch' };
  const LAT = (f) => (typeof f === 'function' ? f : () => f);
  R.nodes = {}; // live handles of worklet nodes by effect uid (meters / correction display)

  /* ---------- small helpers ---------- */
  const worklet = (ctx, name, processorOptions) => new AudioWorkletNode(ctx, name, { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2], channelCount: 2, channelCountMode: 'explicit', processorOptions });
  const quiet = (ex) => ({ ...ex, regs: null, meters: null }); // build a sub-effect without registering its parameters
  const sub = (type, over, ctx, node, ex) => { const d = R.RACK[type]; return d.build(ctx, { ...d.defaults, ...over }, node, quiet(ex)); };
  const irCaches = new WeakMap();
  function cachedIR(ctx, key, make) {
    let m = irCaches.get(ctx); if (!m) irCaches.set(ctx, (m = new Map()));
    if (m.has(key)) return m.get(key);
    const chs = make(), b = new AudioBuffer({ numberOfChannels: chs.length, length: chs[0].length, sampleRate: ctx.sampleRate });
    chs.forEach((c, i) => b.copyToChannel(c, i)); m.set(key, b); return b;
  }
  function convMix(ctx, inp, conv, p, ex) {
    const out = ctx.createGain(), dry = ctx.createGain(), wet = ctx.createGain();
    dry.gain.value = p.dry / 100; wet.gain.value = p.wet / 100;
    inp.connect(dry); dry.connect(out); inp.connect(conv); conv.connect(wet); wet.connect(out);
    reg(ex, 'dry', dry.gain, (v) => v / 100); reg(ex, 'wet', wet.gain, (v) => v / 100); return out;
  }
  const lr4 = (ctx, type, f, input, ex, id) => { let cur = input; for (let i = 0; i < 2; i++) { const b = ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = 0.7071; if (id) reg(ex, id, b.frequency); cur.connect(b); cur = b; } return cur; };
  const lin = (v) => (v <= -79 ? 0 : fromDb(v));
  const def = (type, d, autoIds) => R.define(type, d, autoIds);

  /* the original effects get their final menu names / categories */
  Object.assign(R.RACK.comp, { name: 'Single-band Compressor', cat: CAT.amp }); Object.assign(R.RACK.limiter, { name: 'Hard Limiter', cat: CAT.amp });
  Object.assign(R.RACK.gate, { name: 'Noise Gate', cat: CAT.amp }); Object.assign(R.RACK.deess, { name: 'DeEsser', cat: CAT.amp });
  Object.assign(R.RACK.delay, { name: 'Echo', cat: CAT.delay }); Object.assign(R.RACK.eq, { name: '3-Band EQ', cat: CAT.filter }); Object.assign(R.RACK.filter, { name: 'Filter', cat: CAT.filter });
  Object.assign(R.RACK.reverb, { name: 'Reverb', cat: CAT.rev }); Object.assign(R.RACK.distortion, { name: 'Distortion', cat: CAT.special }); Object.assign(R.RACK.crush, { name: 'Bit Crusher', cat: CAT.special });
  Object.assign(R.RACK.widener, { name: 'Stereo Widener', cat: CAT.stereo }); Object.assign(R.RACK.haas, { name: 'Haas Stereo Maker', cat: CAT.stereo }); Object.assign(R.RACK.centercut, { name: 'Center Channel Cut', cat: CAT.stereo });
  for (const k of ['chorus', 'flanger', 'phaser', 'tremolo']) R.RACK[k].cat = CAT.mod;
  R.RACK.gain.cat = CAT.amp;

  /* =============== Amplitude and Compression =============== */
  def('amplify', { name: 'Amplify', cat: CAT.amp, params: [CHK('link', 'Link left and right', true), P('db', 'Gain', -60, 48, 0, 0.1, 'dB'), P('dbL', 'Left gain', -60, 48, 0, 0.1, 'dB'), P('dbR', 'Right gain', -60, 48, 0, 0.1, 'dB')],
    build: (ctx, p, inp, ex) => {
      const s = st(ctx), sp = ctx.createChannelSplitter(2), mg = ctx.createChannelMerger(2), gl = ctx.createGain(), gr = ctx.createGain();
      gl.gain.value = fromDb(p.link ? p.db : p.dbL); gr.gain.value = fromDb(p.link ? p.db : p.dbR);
      if (p.link) { reg(ex, 'db', gl.gain, fromDb); reg(ex, 'db', gr.gain, fromDb); } else { reg(ex, 'dbL', gl.gain, fromDb); reg(ex, 'dbR', gr.gain, fromDb); }
      inp.connect(s); s.connect(sp); sp.connect(gl, 0); sp.connect(gr, 1); gl.connect(mg, 0, 0); gr.connect(mg, 0, 1); return mg;
    } });

  def('chanmix', { name: 'Channel Mixer', cat: CAT.amp, params: [P('ll', 'Left out ← Left in', -200, 200, 100, 1, '%'), P('rl', 'Left out ← Right in', -200, 200, 0, 1, '%'), P('lr', 'Right out ← Left in', -200, 200, 0, 1, '%'), P('rr', 'Right out ← Right in', -200, 200, 100, 1, '%'), CHK('invL', 'Invert left output', false), CHK('invR', 'Invert right output', false)],
    build: (ctx, p, inp, ex) => {
      const s = st(ctx), sp = ctx.createChannelSplitter(2), mg = ctx.createChannelMerger(2), sumL = ctx.createGain(), sumR = ctx.createGain();
      sumL.gain.value = p.invL ? -1 : 1; sumR.gain.value = p.invR ? -1 : 1; inp.connect(s); s.connect(sp);
      for (const [src, dst, id] of [[0, sumL, 'll'], [1, sumL, 'rl'], [0, sumR, 'lr'], [1, sumR, 'rr']]) { const g = ctx.createGain(); g.gain.value = p[id] / 100; reg(ex, id, g.gain, (v) => v / 100); sp.connect(g, src); g.connect(dst); }
      sumL.connect(mg, 0, 0); sumR.connect(mg, 0, 1); return mg;
    } }, ['ll', 'rl', 'lr', 'rr']);

  const dynParams = (full) => [CHK('gateOn', 'Noise gate', full), P('gateThr', 'Gate threshold', -80, 0, -50, 0.5, 'dB'), ...(full ? [CHK('expOn', 'Downward expander', false), P('expThr', 'Expander threshold', -80, 0, -40, 0.5, 'dB'), P('expRange', 'Expander range', -60, 0, -15, 1, 'dB')] : []),
    CHK('compOn', 'Compressor', true), P('compThr', 'Compressor threshold', -60, 0, -24, 0.5, 'dB'), P('compRatio', 'Ratio', 1, 20, 3, 0.1, ': 1'), P('att', 'Attack', 0, 200, 10, 1, 'ms'), P('rel', 'Release', 10, 1000, 200, 5, 'ms'), P('makeup', 'Makeup gain', -12, 24, 3, 0.5, 'dB'),
    CHK('limOn', 'Limiter', true), P('limCeil', 'Limiter ceiling', -24, 0, -1, 0.1, 'dB'), H.SC()];
  const dynBuild = (ctx, p, inp, ex) => {
    let cur = inp;
    const key = ctx._wl ? H.keyNode(ex, p) : null; // sidechain: the key drives the gate / expander / compressor detectors
    const gate = (thr, floor, rel, idThr) => {
      const d = R.RACK.gate; const n = d.build(ctx, { ...d.defaults, thr, floor, att: 4, hold: 50, rel }, cur, quiet(ex));
      if (n !== cur && key) key.connect(n, 0, 1);
      if (n !== cur && n.parameters && idThr) reg(ex, idThr, n.parameters.get('thr')); cur = n;
    };
    if (p.gateOn) gate(p.gateThr, -60, 120, 'gateThr');
    if (p.expOn) gate(p.expThr, p.expRange, 300, 'expThr');
    if (p.compOn && key) cur = H.dynNode(ctx, 'comp', { thr: p.compThr, ratio: p.compRatio, knee: 10, att: p.att, rel: p.rel, makeup: p.makeup }, cur, key, ex, [['compThr', 'thr'], ['compRatio', 'ratio'], ['att', 'att'], ['rel', 'rel'], ['makeup', 'makeup']]);
    else if (p.compOn) {
      const c = ctx.createDynamicsCompressor(), mk = ctx.createGain(); c.threshold.value = p.compThr; c.knee.value = 10; c.ratio.value = p.compRatio; c.attack.value = p.att / 1000; c.release.value = p.rel / 1000; mk.gain.value = fromDb(p.makeup);
      reg(ex, 'compThr', c.threshold); reg(ex, 'compRatio', c.ratio); reg(ex, 'att', c.attack, (v) => v / 1000); reg(ex, 'rel', c.release, (v) => v / 1000); reg(ex, 'makeup', mk.gain, fromDb); cur.connect(c); c.connect(mk); cur = mk;
    }
    if (p.limOn) { const l = ctx.createDynamicsCompressor(); l.threshold.value = p.limCeil; l.knee.value = 0; l.ratio.value = 20; l.attack.value = 0.001; l.release.value = 0.08; reg(ex, 'limCeil', l.threshold); cur.connect(l); cur = l; }
    return cur;
  };
  def('dynamics', { name: 'Dynamics', cat: CAT.amp, params: dynParams(false), build: dynBuild }, ['compThr', 'compRatio', 'att', 'rel', 'makeup', 'limCeil', 'gateThr']);
  def('dynproc', { name: 'Dynamics Processing', cat: CAT.amp, params: dynParams(true), build: dynBuild }, ['compThr', 'compRatio', 'att', 'rel', 'makeup', 'limCeil', 'gateThr', 'expThr']);

  /* Auto-Duck as a rack effect: lowers this track while the sidechain key (e.g. the voice track) is active */
  def('autoduck', { name: 'Auto-Duck (Sidechain)', cat: CAT.amp, info: 'Pick the key track in “Sidechain input” (for example the voice). This track is lowered by “Duck amount” whenever the key is above the threshold. The Multitrack > Auto-Duck command writes the same thing as editable volume automation instead.',
    params: [H.SC(), P('thr', 'Key threshold', -70, 0, -40, 0.5, 'dB'), P('amount', 'Duck amount', 0, 40, 12, 0.5, 'dB'), P('att', 'Fade down', 1, 1000, 80, 1, 'ms'), P('hold', 'Hold', 0, 2000, 250, 10, 'ms'), P('rel', 'Fade up', 10, 3000, 500, 10, 'ms')],
    build: (ctx, p, inp, ex) => {
      if (!ctx._wl) return inp;
      return H.dynNode(ctx, 'duck', { thr: p.thr, amount: p.amount, att: p.att, hold: p.hold, rel: p.rel }, inp, H.keyNode(ex, p), ex, [['thr', 'thr'], ['amount', 'amount'], ['att', 'att'], ['hold', 'hold'], ['rel', 'rel']]);
    } }, ['thr', 'amount']);

  def('mbcomp', { name: 'Multiband Compressor', cat: CAT.amp, params: [P('x1', 'Crossover low / mid', 50, 1000, 200, 1, 'Hz'), P('x2', 'Crossover mid / high', 1000, 12000, 2500, 10, 'Hz'),
    P('lThr', 'Low threshold', -60, 0, -26, 0.5, 'dB'), P('lRatio', 'Low ratio', 1, 20, 3, 0.1, ': 1'), P('lGain', 'Low gain', -18, 18, 0, 0.5, 'dB'),
    P('mThr', 'Mid threshold', -60, 0, -24, 0.5, 'dB'), P('mRatio', 'Mid ratio', 1, 20, 3, 0.1, ': 1'), P('mGain', 'Mid gain', -18, 18, 0, 0.5, 'dB'),
    P('hThr', 'High threshold', -60, 0, -28, 0.5, 'dB'), P('hRatio', 'High ratio', 1, 20, 3, 0.1, ': 1'), P('hGain', 'High gain', -18, 18, 0, 0.5, 'dB'),
    P('att', 'Attack', 0, 200, 15, 1, 'ms'), P('rel', 'Release', 10, 1000, 200, 5, 'ms'), P('out', 'Output gain', -18, 18, 0, 0.5, 'dB')],
    build: (ctx, p, inp, ex) => {
      const sum = ctx.createGain(), out = ctx.createGain(); out.gain.value = fromDb(p.out); reg(ex, 'out', out.gain, fromDb);
      const band = (src, k) => { const c = ctx.createDynamicsCompressor(), g = ctx.createGain(); c.threshold.value = p[k + 'Thr']; c.ratio.value = p[k + 'Ratio']; c.knee.value = 6; c.attack.value = p.att / 1000; c.release.value = p.rel / 1000; g.gain.value = fromDb(p[k + 'Gain']);
        reg(ex, k + 'Thr', c.threshold); reg(ex, k + 'Ratio', c.ratio); reg(ex, 'att', c.attack, (v) => v / 1000); reg(ex, 'rel', c.release, (v) => v / 1000); reg(ex, k + 'Gain', g.gain, fromDb); src.connect(c); c.connect(g); g.connect(sum); };
      band(lr4(ctx, 'lowpass', p.x1, inp, ex, 'x1'), 'l');
      const upper = lr4(ctx, 'highpass', p.x1, inp, ex, 'x1');
      band(lr4(ctx, 'lowpass', p.x2, upper, ex, 'x2'), 'm'); band(lr4(ctx, 'highpass', p.x2, upper, ex, 'x2'), 'h');
      sum.connect(out); return out;
    } }, ['x1', 'x2', 'lThr', 'lRatio', 'lGain', 'mThr', 'mRatio', 'mGain', 'hThr', 'hRatio', 'hGain', 'att', 'rel', 'out']);

  def('speechlev', { name: 'Speech Volume Leveler', cat: CAT.amp, info: 'Real-time approximation: a gated, slow-acting compressor that rides speech toward the target level. For the exact offline algorithm use Effects > Other Tools.', params: [P('target', 'Target level', -40, -6, -20, 0.5, 'dB'), P('boost', 'Maximum boost', 0, 30, 12, 0.5, 'dB'), P('speed', 'Response speed', 1, 10, 5, 1)],
    build: (ctx, p, inp, ex) => {
      const thr = p.target - 6, makeup = Math.min(p.boost, 0.45 * -thr); let cur = sub('gate', { thr: p.target - 32, floor: -12, att: 8, hold: 80, rel: 250 }, ctx, inp, ex);
      const c = ctx.createDynamicsCompressor(), mk = ctx.createGain(); c.threshold.value = thr; c.knee.value = 20; c.ratio.value = 3; c.attack.value = 0.12 - p.speed * 0.01; c.release.value = Math.max(0.12, 0.9 - p.speed * 0.07); mk.gain.value = fromDb(makeup);
      reg(ex, 'boost', mk.gain, (v) => fromDb(Math.min(v, 0.45 * -thr))); cur.connect(c); c.connect(mk); return mk;
    } }, ['boost']);

  def('tubecomp', { name: 'Tube-modeled Compressor', cat: CAT.amp, params: [P('inG', 'Input gain', -12, 24, 0, 0.5, 'dB'), P('thr', 'Threshold', -60, 0, -20, 0.5, 'dB'), P('ratio', 'Ratio', 1, 20, 3, 0.1, ': 1'), P('att', 'Attack', 0, 200, 15, 1, 'ms'), P('rel', 'Release', 10, 1000, 250, 5, 'ms'), P('tube', 'Tube warmth', 0, 100, 40, 1, '%'), P('out', 'Output gain', -24, 12, 0, 0.5, 'dB')],
    build: (ctx, p, inp, ex) => {
      const ig = ctx.createGain(), c = ctx.createDynamicsCompressor(), w = ctx.createWaveShaper(), og = ctx.createGain(), n = 4096, cv = new Float32Array(n), t = p.tube / 100, bias = 0.18 * t, k = 1 + 3.5 * t;
      for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; cv[i] = (Math.tanh(x * k + bias) - Math.tanh(bias)) / k; } // asymmetric soft clipping (even + odd harmonics), unity gain for small signals
      ig.gain.value = fromDb(p.inG); c.threshold.value = p.thr; c.ratio.value = p.ratio; c.knee.value = 12; c.attack.value = p.att / 1000; c.release.value = p.rel / 1000; w.curve = cv; w.oversample = '4x'; og.gain.value = fromDb(p.out);
      reg(ex, 'inG', ig.gain, fromDb); reg(ex, 'thr', c.threshold); reg(ex, 'ratio', c.ratio); reg(ex, 'att', c.attack, (v) => v / 1000); reg(ex, 'rel', c.release, (v) => v / 1000); reg(ex, 'out', og.gain, fromDb);
      inp.connect(ig); ig.connect(c); c.connect(w); w.connect(og); return og;
    } }, ['inG', 'thr', 'ratio', 'att', 'rel', 'out']);

  /* =============== Delay and Echo =============== */
  /* Web Audio adds one render quantum (128 samples) to every trip around a feedback loop. To keep echoes exactly on
     the requested time, the loop delay is shortened by that amount and the input is pre-delayed by the same amount. */
  function fbDelay(ctx, ms, fbAmt, ex, idT, idFb, fbConv, wrapTail) {
    const Q = 128 / ctx.sampleRate, pre = ctx.createDelay(0.1), dl = ctx.createDelay(2.2), fb = ctx.createGain(), time = (v) => Math.max(0, v / 1000 - Q);
    pre.delayTime.value = Q; dl.delayTime.value = time(ms); fb.gain.value = fbConv(fbAmt); pre.connect(dl);
    const tail = wrapTail ? wrapTail(dl) : dl; tail.connect(fb); fb.connect(dl);
    reg(ex, idT, dl.delayTime, time); reg(ex, idFb, fb.gain, fbConv); return { inNode: pre, out: tail, dl };
  }
  H.fbDelay = fbDelay;
  /* the original Echo uses the same exact-timing loop */
  R.RACK.delay.build = (ctx, p, inp, ex) => {
    const mk = (src) => { const f = fbDelay(ctx, p.ms, p.fb, ex, 'ms', 'fb', (v) => v); src.connect(f.inNode); return mixer(ctx, src, f.out, p.mix, ex); };
    if (p.image === 'center' || p.image === 'side') { const { M, S } = msEncode(ctx, inp); return p.image === 'center' ? msDecode(ctx, mk(M), S) : msDecode(ctx, M, mk(S)); }
    return mk(inp);
  };
  const delayParams = (analog) => [P('lms', 'Left delay', 0, 2000, 250, 1, 'ms'), P('rms', 'Right delay', 0, 2000, 250, 1, 'ms'), P('lfb', 'Left feedback', 0, 95, 30, 1, '%'), P('rfb', 'Right feedback', 0, 95, 30, 1, '%'),
    CHK('linv', 'Invert left', false), CHK('rinv', 'Invert right', false), SEL('units', 'Delay time units', [['ms', 'Milliseconds'], ['hz', 'Hertz']], 'ms'), P('mix', 'Dry / Wet', 0, 100, 50, 1, '%'),
    ...(analog ? [SEL('mode', 'Mode', [['tape', 'Tape'], ['tube', 'Tube'], ['analog', 'Analog']], 'tape'), P('tone', 'Feedback darkening', 500, 12000, 4500, 10, 'Hz'), P('sat', 'Saturation', 0, 100, 30, 1, '%'), P('flutter', 'Wow / flutter', 0, 100, 20, 1, '%')] : [])];
  const delayBuild = (analog) => (ctx, p, inp, ex) => {
    const s = st(ctx), sp = ctx.createChannelSplitter(2), mg = ctx.createChannelMerger(2); inp.connect(s); s.connect(sp);
    const curve = (() => { const n = 2048, cv = new Float32Array(n), k = 1 + (p.sat / 100) * 5, b = p.mode === 'tube' ? 0.15 : 0; for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; cv[i] = (Math.tanh(x * k + b) - Math.tanh(b)) / k; } return cv; })(); // unity small-signal gain: a feedback loop can only decay
    [['l', 0], ['r', 1]].forEach(([c, idx]) => {
      const wet = ctx.createGain(), dry = ctx.createGain(), inv = ctx.createGain(); inv.gain.value = p[c + 'inv'] ? -1 : 1; wet.gain.value = p.mix / 100; dry.gain.value = 1 - p.mix / 100;
      reg(ex, 'mix', wet.gain, (v) => v / 100); reg(ex, 'mix', dry.gain, (v) => 1 - v / 100);
      const f = fbDelay(ctx, p[c + 'ms'], p[c + 'fb'], ex, c + 'ms', c + 'fb', (v) => v / 100, analog ? (dl) => { const lp = ctx.createBiquadFilter(), ws = ctx.createWaveShaper(); lp.type = 'lowpass'; lp.frequency.value = p.tone; reg(ex, 'tone', lp.frequency); ws.curve = curve; dl.connect(lp); lp.connect(ws); return ws; } : null);
      if (analog && p.flutter > 0) { const l1 = lfo(ctx, ex, 0.7 + idx * 0.13, 0.00035 * (p.flutter / 100)), l2 = lfo(ctx, ex, 5.8 + idx * 0.4, 0.00012 * (p.flutter / 100)); l1.connect(f.dl.delayTime); l2.connect(f.dl.delayTime); }
      sp.connect(f.inNode, idx); f.out.connect(inv); inv.connect(wet); sp.connect(dry, idx); wet.connect(mg, 0, idx); dry.connect(mg, 0, idx);
    });
    return mg;
  };  def('delay2', { name: 'Delay', cat: CAT.delay, params: delayParams(false), build: delayBuild(false) }, ['lms', 'rms', 'lfb', 'rfb', 'mix']);
  def('analogdelay', { name: 'Analog Delay', cat: CAT.delay, params: delayParams(true), build: delayBuild(true) }, ['lms', 'rms', 'lfb', 'rfb', 'mix', 'tone']);

  /* =============== Filter and EQ =============== */
  def('fftfilter', { name: 'FFT Filter', cat: CAT.filter, latency: (p) => (p.size | 0) / 2, params: [{ id: 'pts', label: 'Frequency curve', type: 'curve', value: [{ f: 20, g: 0 }, { f: 20000, g: 0 }] }, SEL('size', 'FFT size', [['2048', '2048'], ['4096', '4096'], ['8192', '8192']], '4096')],
    build: (ctx, p, inp) => { const N = +p.size, key = 'fft|' + N + '|' + JSON.stringify(p.pts); const buf = cachedIR(ctx, key, () => [D.curveIR(ctx.sampleRate, p.pts, N)]); const c = ctx.createConvolver(); c.normalize = false; c.buffer = buf; inp.connect(c); return c; } });

  const GEQ = { geq10: [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000], geq20: [31, 44, 62, 88, 125, 177, 250, 354, 500, 707, 1000, 1414, 2000, 2828, 4000, 5657, 8000, 11314, 16000, 20000], geq30: [25, 31.5, 40, 50, 63, 80, 100, 125, 160, 200, 250, 315, 400, 500, 630, 800, 1000, 1250, 1600, 2000, 2500, 3150, 4000, 5000, 6300, 8000, 10000, 12500, 16000, 20000] };
  const GEQ_Q = { geq10: 1.41, geq20: 2.87, geq30: 4.32 };
  R.GEQ = GEQ;
  for (const [type, freqs] of Object.entries(GEQ)) {
    def(type, { name: `Graphic Equalizer (${freqs.length} Bands)`, cat: CAT.filter, bands: freqs, params: [...freqs.map((f, i) => P('b' + i, f >= 1000 ? f / 1000 + ' kHz' : f + ' Hz', -18, 18, 0, 0.1, 'dB')), P('master', 'Master gain', -18, 18, 0, 0.1, 'dB')],
      build: (ctx, p, inp, ex) => { let cur = inp; freqs.forEach((f, i) => { const b = ctx.createBiquadFilter(); b.type = 'peaking'; b.frequency.value = Math.min(f, ctx.sampleRate * 0.45); b.Q.value = GEQ_Q[type]; b.gain.value = p['b' + i]; reg(ex, 'b' + i, b.gain); cur.connect(b); cur = b; }); const m = ctx.createGain(); m.gain.value = fromDb(p.master); reg(ex, 'master', m.gain, fromDb); cur.connect(m); return m; } },
    freqs.map((_, i) => 'b' + i).concat('master'));
  }

  def('notch', { name: 'Notch Filter', cat: CAT.filter, params: [P('f', 'Frequency', 20, 20000, 60, 1, 'Hz'), P('q', 'Width (Q)', 1, 100, 30, 0.5), P('depth', 'Depth', -80, 0, -80, 1, 'dB'), P('harm', 'Harmonics', 1, 10, 1, 1)],
    build: (ctx, p, inp, ex) => { let cur = inp; for (let h = 1; h <= p.harm; h++) { const fr = p.f * h; if (fr > ctx.sampleRate * 0.45) break; const b = ctx.createBiquadFilter(); b.type = p.depth <= -60 ? 'notch' : 'peaking'; b.frequency.value = fr; b.Q.value = p.q; if (b.type === 'peaking') b.gain.value = p.depth; reg(ex, 'f', b.frequency, (v) => v * h); reg(ex, 'q', b.Q); cur.connect(b); cur = b; } return cur; } }, ['f', 'q']);

  /* parametric EQ: HP, low shelf, 5 peaking bands, high shelf, LP */
  const PEQ_BANDS = [['hp', 'HP'], ['ls', 'L'], ['b1', '1'], ['b2', '2'], ['b3', '3'], ['b4', '4'], ['b5', '5'], ['hs', 'H'], ['lp', 'LP']];
  const peqDefaults = { hpF: 40, lsF: 100, lsG: 0, lsQ: 0.7, b1F: 150, b1G: 0, b1Q: 1, b2F: 400, b2G: 0, b2Q: 1, b3F: 1000, b3G: 0, b3Q: 1, b4F: 2500, b4G: 0, b4Q: 1, b5F: 6000, b5G: 0, b5Q: 1, hsF: 10000, hsG: 0, hsQ: 0.7, lpF: 18000 };
  R.PEQ = { bands: PEQ_BANDS, defaults: peqDefaults };
  def('peq', { name: 'Parametric Equalizer', cat: CAT.filter, params: [CHK('hpOn', 'High-pass on', false), P('hpF', 'HP frequency', 20, 2000, 40, 1, 'Hz'), P('lsF', 'Low shelf frequency', 20, 2000, 100, 1, 'Hz'), P('lsG', 'Low shelf gain', -96, 96, 0, 0.1, 'dB'), P('lsQ', 'Low shelf Q', 0.1, 10, 0.7, 0.01),
    ...[1, 2, 3, 4, 5].flatMap((i) => [P(`b${i}F`, `Band ${i} frequency`, 20, 20000, peqDefaults[`b${i}F`], 1, 'Hz'), P(`b${i}G`, `Band ${i} gain`, -96, 96, 0, 0.1, 'dB'), P(`b${i}Q`, `Band ${i} Q / width`, 0.05, 30, 1, 0.01)]),
    P('hsF', 'High shelf frequency', 1000, 20000, 10000, 1, 'Hz'), P('hsG', 'High shelf gain', -96, 96, 0, 0.1, 'dB'), P('hsQ', 'High shelf Q', 0.1, 10, 0.7, 0.01), CHK('lpOn', 'Low-pass on', false), P('lpF', 'LP frequency', 1000, 20000, 18000, 1, 'Hz'),
    SEL('qmode', 'Q / Width', [['q', 'Constant Q'], ['width', 'Constant Width (octaves)']], 'q'), CHK('ultra', 'Ultra-quiet', false), SEL('range', 'Range', [['30', '30 dB'], ['96', '96 dB']], '30')],
    build: (ctx, p, inp, ex) => {
      const qOf = (v) => (p.qmode === 'width' ? 1 / (2 * Math.sinh((Math.log(2) / 2) * Math.max(0.01, v))) : v); let cur = inp;
      const mk = (type, f, g, q, ids) => { const b = ctx.createBiquadFilter(); b.type = type; b.frequency.value = Math.min(f, ctx.sampleRate * 0.45); if (g !== null) b.gain.value = g; b.Q.value = qOf(q); if (ids.f) reg(ex, ids.f, b.frequency); if (ids.g) reg(ex, ids.g, b.gain); if (ids.q) reg(ex, ids.q, b.Q, qOf); cur.connect(b); cur = b; };
      if (p.hpOn) mk('highpass', p.hpF, null, 0.7071, { f: 'hpF' });
      mk('lowshelf', p.lsF, p.lsG, p.lsQ, { f: 'lsF', g: 'lsG' });
      for (let i = 1; i <= 5; i++) mk('peaking', p[`b${i}F`], p[`b${i}G`], p[`b${i}Q`], { f: `b${i}F`, g: `b${i}G`, q: `b${i}Q` });
      mk('highshelf', p.hsF, p.hsG, p.hsQ, { f: 'hsF', g: 'hsG' });
      if (p.lpOn) mk('lowpass', p.lpF, null, 0.7071, { f: 'lpF' });
      return cur;
    } }, Object.keys(peqDefaults));

  const SCI_TYPES = [['butterworth', 'Butterworth'], ['bessel', 'Bessel'], ['cheby1', 'Chebyshev 1 (passband ripple)'], ['cheby2', 'Chebyshev 2 (stopband ripple)']];
  def('scifilter', { name: 'Scientific Filter', cat: CAT.filter, info: 'Elliptical filters are not included; Butterworth, Bessel and Chebyshev I / II are.', params: [SEL('ftype', 'Filter type', SCI_TYPES, 'butterworth'), SEL('mode', 'Mode', [['lowpass', 'Low-pass'], ['highpass', 'High-pass'], ['bandpass', 'Band-pass'], ['bandstop', 'Band-stop']], 'lowpass'), P('order', 'Order', 1, 10, 4, 1), P('f', 'Cutoff / centre', 20, 20000, 1000, 1, 'Hz'), P('width', 'Band width (band modes)', 0.1, 6, 1, 0.05, 'oct'), P('rp', 'Passband ripple (Cheby 1)', 0.1, 6, 1, 0.1, 'dB'), P('rs', 'Stopband attenuation (Cheby 2)', 20, 100, 40, 1, 'dB')],
    build: (ctx, p, inp) => {
      const sr = ctx.sampleRate, chainOf = (mode, f, node) => { let cur = node; for (const s of D.sciFilter(sr, p.ftype, mode, p.order, f, p.rp, p.rs)) { const n = ctx.createIIRFilter([s[0], s[1], s[2]], [1, s[3], s[4]]); cur.connect(n); cur = n; } return cur; };
      if (p.mode === 'lowpass' || p.mode === 'highpass') return chainOf(p.mode, p.f, inp);
      const lo = p.f / Math.pow(2, p.width / 2), hi = p.f * Math.pow(2, p.width / 2);
      if (p.mode === 'bandpass') return chainOf('lowpass', hi, chainOf('highpass', lo, inp));
      const sum = ctx.createGain(); chainOf('lowpass', lo, inp).connect(sum); chainOf('highpass', hi, inp).connect(sum); return sum;
    } });

  /* =============== Modulation =============== */
  def('chorusflanger', { name: 'Chorus/Flanger', cat: CAT.mod, params: [SEL('mode', 'Mode', [['chorus', 'Chorus'], ['flanger', 'Flanger']], 'chorus'), P('rate', 'Rate', 0.05, 10, 0.5, 0.05, 'Hz'), P('depth', 'Depth', 0.1, 20, 4, 0.1, 'ms'), P('delay', 'Base delay', 0.1, 40, 12, 0.1, 'ms'), P('fb', 'Feedback', -0.9, 0.9, 0, 0.01), P('voices', 'Voices', 1, 4, 2, 1), P('mix', 'Mix', 0, 1, 0.5, 0.01)],
    build: (ctx, p, inp, ex) => {
      const sum = ctx.createGain(); sum.gain.value = 1 / Math.sqrt(p.voices);
      for (let v = 0; v < p.voices; v++) { const d = ctx.createDelay(0.1), fb = ctx.createGain(); d.delayTime.value = (p.delay + v * (p.mode === 'chorus' ? 3.1 : 0.9)) / 1000; fb.gain.value = p.fb; const l = lfo(ctx, ex, p.rate * (1 + 0.11 * v), p.depth / 1000); l.connect(d.delayTime); if (v === 0) { reg(ex, 'rate', l._osc.frequency); reg(ex, 'depth', l.gain, (x) => x / 1000); } reg(ex, 'fb', fb.gain); inp.connect(d); d.connect(fb); fb.connect(d); d.connect(sum); }
      return mixer(ctx, inp, sum, p.mix, ex);
    } }, ['rate', 'depth', 'fb', 'mix']);

  /* =============== Noise reduction (worklet) =============== */
  const denoiseParams = (d) => [P('reduce', 'Noise reduction', 0, 60, d[0], 1, 'dB'), P('sens', 'Sensitivity', 0.2, 5, d[1], 0.05), P('smooth', 'Spectral smoothing', 0, 0.98, d[2], 0.01), P('track', 'Noise tracking speed', 0, 1, d[3], 0.05)];
  const denoiseBuild = (ctx, p, inp, ex) => { if (!ctx._wl) return inp; const n = worklet(ctx, 'as-denoise'); for (const id of ['reduce', 'sens', 'smooth', 'track']) { const prm = n.parameters.get(id); prm.value = p[id]; reg(ex, id, prm); } inp.connect(n); return n; };
  def('denoise', { name: 'DeNoise', cat: CAT.nr, latency: 3072, info: 'Real-time adaptive spectral denoiser. It treats anything steady (including held tones) as noise.', params: denoiseParams([14, 1.5, 0.7, 0.4]), build: denoiseBuild }, ['reduce', 'sens', 'smooth', 'track']);
  def('anr', { name: 'Adaptive Noise Reduction', cat: CAT.nr, latency: 3072, info: 'Tracks the noise floor continuously; suited to speech over changing background noise.', params: denoiseParams([18, 1.8, 0.75, 0.6]), build: denoiseBuild }, ['reduce', 'sens', 'smooth', 'track']);
  /* DeReverb: the same per-frame algorithm as the offline DeReverb (process) — AS.dsp.dereverbFrame inside the worklet.
     Live there is no whole file to measure, so the room decay (T60) is a parameter. */
  def('dereverb', { name: 'DeReverb', cat: CAT.nr, latency: 3072, info: 'Reduces room reverberation (the late reflections). Set Room decay to the room’s reverb time; DeReverb (process) can estimate it from the file.',
    params: [P('amount', 'Amount', 0, 100, 60, 1, '%'), SEL('focus', 'Processing focus', [['all', 'All frequencies'], ['low', 'Low frequencies'], ['mid', 'Mid frequencies (speech)'], ['high', 'High frequencies']], 'all'), P('t60', 'Room decay (T60)', 0.1, 8, 0.8, 0.05, 's'), P('gain', 'Gain compensation', -12, 24, 0, 0.5, 'dB')],
    build: (ctx, p, inp, ex) => {
      if (!ctx._wl) return inp;
      const n = worklet(ctx, 'as-dereverb'), g = ctx.createGain(), fi = (v) => Math.max(0, D.DEREVERB_FOCUS.indexOf(v));
      for (const [id, conv] of [['amount'], ['focus', fi], ['t60']]) { const prm = n.parameters.get(id); prm.value = conv ? conv(p[id]) : p[id]; reg(ex, id, prm, conv); }
      g.gain.value = fromDb(p.gain); reg(ex, 'gain', g.gain, fromDb); inp.connect(n); n.connect(g); return g;
    } }, ['amount', 't60', 'gain']);

  /* =============== Reverb =============== */
  const IRP = { room: { decay: 0.55, pre: 4, er: -6, diffusion: 80, density: 85, damp: 55, lowcut: 80, width: 100, size: 20 }, hall: { decay: 2.4, pre: 22, er: -10, diffusion: 85, density: 90, damp: 45, lowcut: 90, width: 100, size: 60 }, plate: { decay: 1.7, pre: 2, er: -30, diffusion: 100, density: 98, damp: 25, lowcut: 140, width: 100, size: 5 }, cathedral: { decay: 6, pre: 45, er: -14, diffusion: 90, density: 85, damp: 62, lowcut: 100, width: 100, size: 95 }, spring: { decay: 1.9, pre: 1, er: -40, diffusion: 40, density: 35, damp: 30, lowcut: 250, width: 40, size: 8 }, tunnel: { decay: 3.6, pre: 60, er: -12, diffusion: 50, density: 70, damp: 52, lowcut: 90, width: 100, size: 100 } };
  R.customIR = null; R.setCustomIR = (name, chs, sr) => { R.customIR = { name, chs, sr }; };
  const irFrom = (ctx, key, o) => cachedIR(ctx, key + JSON.stringify(o), () => D.reverbIR(ctx.sampleRate, o));
  def('fullreverb', { name: 'Full Reverb', cat: CAT.rev, params: [P('decay', 'Decay time', 0.2, 10, 2.2, 0.1, 's'), P('pre', 'Pre-delay', 0, 200, 25, 1, 'ms'), P('er', 'Early reflections', -40, 0, -10, 0.5, 'dB'), P('diffusion', 'Diffusion', 0, 100, 70, 1, '%'), P('density', 'Perception (density)', 0, 100, 80, 1, '%'), P('damp', 'High-frequency damping', 0, 100, 50, 1, '%'), P('lowcut', 'Low cut', 0, 500, 80, 1, 'Hz'), P('width', 'Stereo width', 0, 100, 100, 1, '%'), P('wet', 'Wet', 0, 100, 30, 1, '%'), P('dry', 'Dry', 0, 100, 100, 1, '%')],
    build: (ctx, p, inp, ex) => { const c = ctx.createConvolver(); c.buffer = irFrom(ctx, 'full', { decay: p.decay, pre: p.pre, er: p.er, diffusion: p.diffusion, density: p.density, damp: p.damp, lowcut: p.lowcut, width: p.width, size: 60 }); return convMix(ctx, inp, c, p, ex); } }, ['wet', 'dry']);
  def('studioreverb', { name: 'Studio Reverb', cat: CAT.rev, params: [P('room', 'Room size', 1, 100, 40, 1, '%'), P('decay', 'Decay time', 0.2, 8, 1.4, 0.1, 's'), P('pre', 'Pre-delay', 0, 100, 10, 1, 'ms'), P('damp', 'High-frequency damping', 0, 100, 40, 1, '%'), P('er', 'Early reflections', -40, 0, -9, 0.5, 'dB'), P('wet', 'Wet', 0, 100, 25, 1, '%'), P('dry', 'Dry', 0, 100, 100, 1, '%')],
    build: (ctx, p, inp, ex) => { const c = ctx.createConvolver(); c.buffer = irFrom(ctx, 'studio', { decay: p.decay, pre: p.pre, er: p.er, diffusion: 85, density: 92, damp: p.damp, lowcut: 100, width: 100, size: p.room }); return convMix(ctx, inp, c, p, ex); } }, ['wet', 'dry']);
  def('surroundreverb', { name: 'Surround Reverb', cat: CAT.rev, info: 'Surround layouts are rendered to stereo: the decorrelated, wide tail stands in for the rear channels.', params: [P('decay', 'Decay time', 0.3, 10, 2.5, 0.1, 's'), P('pre', 'Pre-delay', 0, 150, 30, 1, 'ms'), P('size', 'Room size', 1, 100, 60, 1, '%'), P('damp', 'High-frequency damping', 0, 100, 45, 1, '%'), P('spread', 'Surround spread', 0, 200, 150, 1, '%'), P('wet', 'Wet', 0, 100, 30, 1, '%'), P('dry', 'Dry', 0, 100, 100, 1, '%')],
    build: (ctx, p, inp, ex) => { const c = ctx.createConvolver(); c.buffer = irFrom(ctx, 'surround', { decay: p.decay, pre: p.pre, er: -12, diffusion: 90, density: 90, damp: p.damp, lowcut: 100, width: p.spread, size: p.size }); return convMix(ctx, inp, c, p, ex); } }, ['wet', 'dry']);
  def('convreverb', { name: 'Convolution Reverb', cat: CAT.rev, params: [SEL('ir', 'Impulse', [['room', 'Room'], ['hall', 'Concert hall'], ['plate', 'Plate'], ['cathedral', 'Cathedral'], ['spring', 'Spring'], ['tunnel', 'Tunnel'], ['custom', 'Custom file…']], 'hall'), P('size', 'Impulse length', 25, 400, 100, 1, '%'), P('pre', 'Pre-delay', 0, 200, 0, 1, 'ms'), P('damp', 'High-frequency damping', 0, 100, 0, 1, '%'), P('wet', 'Wet', 0, 100, 35, 1, '%'), P('dry', 'Dry', 0, 100, 100, 1, '%')],
    build: (ctx, p, inp, ex) => {
      const key = 'conv|' + p.ir + '|' + p.size + '|' + p.pre + '|' + p.damp + '|' + (p.ir === 'custom' && R.customIR ? R.customIR.name : '');
      const buf = cachedIR(ctx, key, () => {
        let chs; if (p.ir === 'custom' && R.customIR) { chs = R.customIR.chs.map((c) => (R.customIR.sr === ctx.sampleRate ? c : D.resample(c, ctx.sampleRate / R.customIR.sr))); if (chs.length === 1) chs = [chs[0], chs[0]]; } else chs = D.reverbIR(ctx.sampleRate, IRP[p.ir] || IRP.hall);
        chs = chs.slice(0, 2).map((c) => (Math.abs(p.size - 100) > 0.5 ? D.resample(c, p.size / 100) : c.slice()));
        const pre = Math.round((p.pre * ctx.sampleRate) / 1000), a = Math.exp((-TAU() * (20000 - p.damp * 190)) / ctx.sampleRate);
        return chs.map((c) => { const o = new Float32Array(c.length + pre); o.set(c, pre); if (p.damp > 0) { let y = 0; for (let i = 0; i < o.length; i++) { y = (1 - a) * o[i] + a * y; o[i] = y; } } return o; });
      });
      const c = ctx.createConvolver(); c.buffer = buf; return convMix(ctx, inp, c, p, ex);
    } }, ['wet', 'dry']);
  const TAU = () => Math.PI * 2;

  /* =============== Special =============== */
  def('guitarsuite', { name: 'Guitar Suite', cat: CAT.special, params: [P('comp', 'Compressor', 0, 100, 30, 1, '%'), P('drive', 'Drive', 0, 100, 40, 1, '%'), P('bass', 'Bass', -12, 12, 0, 0.5, 'dB'), P('mid', 'Mid', -12, 12, 0, 0.5, 'dB'), P('treble', 'Treble', -12, 12, 0, 0.5, 'dB'), CHK('cab', 'Cabinet simulation', true), P('amb', 'Ambience', 0, 100, 15, 1, '%'), P('out', 'Output', -24, 12, 0, 0.5, 'dB')],
    build: (ctx, p, inp, ex) => {
      let cur = p.comp > 0 ? sub('comp', { thr: -14 - 24 * (p.comp / 100), ratio: 2 + 6 * (p.comp / 100), att: 8, rel: 140, makeup: 2 + 6 * (p.comp / 100) }, ctx, inp, ex) : inp;
      if (p.drive > 0) { const w = ctx.createWaveShaper(), n = 4096, cv = new Float32Array(n), k = 1 + (p.drive / 100) * 28, pre = ctx.createGain(); pre.gain.value = 1; for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; cv[i] = Math.tanh(x * k + 0.08) - Math.tanh(0.08); } const nrm = Math.max(...cv.map(Math.abs)) || 1; for (let i = 0; i < n; i++) cv[i] /= nrm; w.curve = cv; w.oversample = '4x'; cur.connect(w); cur = w; }
      for (const [type, f, g] of [['lowshelf', 120, p.bass], ['peaking', 800, p.mid], ['highshelf', 3500, p.treble]]) { const b = ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; b.gain.value = g; if (type === 'peaking') b.Q.value = 0.8; cur.connect(b); cur = b; }
      if (p.cab) { cur = sub('filter', { type: 'highpass', f: 85, q: 0.9 }, ctx, cur, ex); cur = sub('filter', { type: 'lowpass', f: 5200, q: 0.9 }, ctx, cur, ex); cur = sub('eq', { lowG: 0, midF: 2400, midG: 2.5, midQ: 1.2, highG: -3 }, ctx, cur, ex); }
      if (p.amb > 0) cur = sub('reverb', { len: 1.1, damp: 0.6, mix: 0.4 * (p.amb / 100) }, ctx, cur, ex);
      const o = ctx.createGain(); o.gain.value = fromDb(p.out); reg(ex, 'out', o.gain, fromDb); cur.connect(o); return o;
    } }, ['out']);

  def('mastering', { name: 'Mastering', cat: CAT.special, params: [P('lowG', 'Low (120 Hz)', -12, 12, 0, 0.1, 'dB'), P('midG', 'Mid (1.5 kHz)', -12, 12, 0, 0.1, 'dB'), P('highG', 'High (6 kHz)', -12, 12, 0, 0.1, 'dB'), P('comp', 'Multiband compression', 0, 100, 35, 1, '%'), P('width', 'Stereo width', 0, 200, 100, 1, '%'), P('boost', 'Input boost', 0, 12, 0, 0.1, 'dB'), P('ceil', 'Output ceiling', -12, 0, -1, 0.1, 'dB')],
    build: (ctx, p, inp, ex) => {
      const g = ctx.createGain(); g.gain.value = fromDb(p.boost); reg(ex, 'boost', g.gain, fromDb); inp.connect(g);
      let cur = sub('eq', { lowG: p.lowG, midF: 1500, midG: p.midG, midQ: 0.8, highG: p.highG }, ctx, g, ex);
      if (p.comp > 0) { const c = p.comp / 100, t = -10 - 18 * c; cur = sub('mbcomp', { x1: 160, x2: 3000, lThr: t, mThr: t, hThr: t - 2, lRatio: 1 + 3 * c, mRatio: 1 + 3 * c, hRatio: 1 + 3 * c, att: 20, rel: 220, out: 2 * c }, ctx, cur, ex); }
      if (Math.abs(p.width - 100) > 1) cur = sub('widener', { width: p.width / 100 }, ctx, cur, ex);
      return sub('limiter', { ceil: p.ceil }, ctx, cur, ex);
    } }, ['boost']);

  /* level meters: pass-through worklet that reports LUFS to the effect window */
  const loudBuild = (ctx, p, inp, ex) => { if (!ctx._wl) return inp; const n = worklet(ctx, 'as-loudness'); inp.connect(n); if (ex.cur && ex.cur.uid) R.nodes[ex.cur.uid] = n; return n; };
  def('loudmeter', { name: 'Loudness Meter', cat: CAT.special, meter: true, params: [P('target', 'Target loudness', -40, -5, -23, 0.5, 'LUFS')], build: loudBuild });
  def('loudradar', { name: 'Loudness Radar Meter', cat: CAT.special, meter: true, params: [P('target', 'Target loudness', -40, -5, -23, 0.5, 'LUFS'), P('range', 'Radar range', 5, 30, 18, 1, 'LU'), P('span', 'Time per revolution', 0.5, 60, 2, 0.5, 'min')], build: loudBuild });

  const voc = { low: [['filter', { type: 'highpass', f: 70, q: 0.707 }], ['eq', { lowG: 1.5, midF: 2800, midG: 3, midQ: 1, highG: 1.5 }], ['comp', { thr: -24, knee: 10, ratio: 3, att: 8, rel: 180, makeup: 4 }], ['deess', { f: 5500, thr: -32, ratio: 5 }]],
    high: [['filter', { type: 'highpass', f: 110, q: 0.707 }], ['eq', { lowG: -1, midF: 4200, midG: 3, midQ: 1, highG: 2.5 }], ['comp', { thr: -26, knee: 10, ratio: 3, att: 6, rel: 160, makeup: 4 }], ['deess', { f: 7500, thr: -32, ratio: 5 }]],
    music: [['eq', { lowG: 1.5, midF: 3000, midG: 2, midQ: 0.9, highG: 3 }], ['comp', { thr: -20, knee: 14, ratio: 2, att: 18, rel: 220, makeup: 2 }], ['deess', { f: 8000, thr: -30, ratio: 3 }]] };
  def('vocalenh', { name: 'Vocal Enhancer', cat: CAT.special, params: [SEL('mode', 'Type', [['low', 'Low Tone'], ['high', 'High Tone'], ['music', 'Music']], 'low')],
    build: (ctx, p, inp, ex) => { let cur = inp; for (const [t, o] of voc[p.mode] || voc.low) cur = sub(t, o, ctx, cur, ex); return cur; } });

  /* =============== Stereo Imagery =============== */
  def('centerextract', { name: 'Center Channel Extractor', cat: CAT.stereo, params: [SEL('mode', 'Mode', [['extract', 'Extract center'], ['remove', 'Remove center'], ['custom', 'Custom']], 'extract'), P('lo', 'Center low cut', 20, 4000, 120, 1, 'Hz'), P('hi', 'Center high cut', 500, 20000, 8000, 10, 'Hz'), P('centerLevel', 'Center level', -80, 12, 0, 0.5, 'dB'), P('restLevel', 'Rest of mid level', -80, 12, -80, 0.5, 'dB'), P('sideLevel', 'Side level', -80, 12, -80, 0.5, 'dB')],
    build: (ctx, p, inp, ex) => {
      const { M, S } = msEncode(ctx, inp), band = lr4(ctx, 'lowpass', p.hi, lr4(ctx, 'highpass', p.lo, M, ex, 'lo'), ex, 'hi'), neg = ctx.createGain(), rest = ctx.createGain(), cG = ctx.createGain(), rG = ctx.createGain(), sG = ctx.createGain(), M2 = ctx.createGain(), S2 = ctx.createGain();
      neg.gain.value = -1; cG.gain.value = lin(p.centerLevel); rG.gain.value = lin(p.restLevel); sG.gain.value = lin(p.sideLevel); reg(ex, 'centerLevel', cG.gain, lin); reg(ex, 'restLevel', rG.gain, lin); reg(ex, 'sideLevel', sG.gain, lin);
      M.connect(rest); band.connect(neg); neg.connect(rest); band.connect(cG); rest.connect(rG); cG.connect(M2); rG.connect(M2); S.connect(sG); sG.connect(S2); return msDecode(ctx, M2, S2);
    } }, ['centerLevel', 'restLevel', 'sideLevel']);

  def('phaseshift', { name: 'Graphic Phase Shifter', cat: CAT.stereo, latency: (p) => (p.size | 0) / 2, params: [...D.PHASE_FREQS.map((f, i) => P('ph' + i, f >= 1000 ? f / 1000 + ' kHz' : f + ' Hz', -180, 180, 0, 1, '°')), SEL('size', 'Filter length', [['2048', '2048'], ['4096', '4096']], '4096')],
    build: (ctx, p, inp) => { const N = +p.size, degs = D.PHASE_FREQS.map((_, i) => p['ph' + i]); const buf = cachedIR(ctx, 'phase|' + N + '|' + degs.join(','), () => D.phaseIR(ctx.sampleRate, degs, N)); const s = st(ctx), c = ctx.createConvolver(); c.normalize = false; c.buffer = buf; inp.connect(s); s.connect(c); return c; } });

  def('stereoexpander', { name: 'Stereo Expander', cat: CAT.stereo, params: [P('width', 'Width', 0, 300, 150, 1, '%'), P('center', 'Center level', -12, 12, 0, 0.1, 'dB'), P('bassmono', 'Mono below', 0, 500, 0, 5, 'Hz')],
    build: (ctx, p, inp, ex) => {
      const { M, S } = msEncode(ctx, inp), sg = ctx.createGain(), mg = ctx.createGain(); sg.gain.value = p.width / 100; mg.gain.value = fromDb(p.center); reg(ex, 'width', sg.gain, (v) => v / 100); reg(ex, 'center', mg.gain, fromDb);
      M.connect(mg); let s = S; if (p.bassmono > 0) { const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = p.bassmono; S.connect(hp); s = hp; } s.connect(sg); return msDecode(ctx, mg, sg);
    } }, ['width', 'center']);

  /* =============== Time and Pitch =============== */
  const PREC = { low: { taps: 2, cubic: false, splice: 60, overlap: 20 }, medium: { taps: 3, cubic: false, splice: 40, overlap: 40 }, high: { taps: 4, cubic: true, splice: 25, overlap: 60 } };
  R.PREC = PREC;
  def('pitchshift', { name: 'Pitch Shifter', cat: CAT.pitch, latency: (p, sr) => Math.round(2 + sr / (p.auto ? PREC[p.precision].splice : p.splice) / 2), params: [P('semi', 'Semitones', -10, 10, 0, 0.01, 'st'), P('cents', 'Cents', -100, 100, 0, 1, 'ct'), SEL('precision', 'Precision', [['low', 'Low Precision'], ['medium', 'Medium Precision'], ['high', 'High Precision']], 'medium'), P('splice', 'Splicing frequency', 10, 200, 40, 1, 'Hz'), P('overlap', 'Overlapping', 0, 100, 40, 1, '%'), CHK('auto', 'Use appropriate default settings', true)],
    build: (ctx, p, inp, ex) => {
      if (!ctx._wl) return inp; const q = PREC[p.precision] || PREC.medium, n = worklet(ctx, 'as-pitch', { taps: q.taps, cubic: q.cubic }), set = (id, v) => { n.parameters.get(id).value = v; };
      set('semi', p.semi); set('cents', p.cents); reg(ex, 'semi', n.parameters.get('semi')); reg(ex, 'cents', n.parameters.get('cents'));
      if (p.auto) { set('splice', q.splice); set('overlap', q.overlap / 100); } else { set('splice', p.splice); set('overlap', p.overlap / 100); reg(ex, 'splice', n.parameters.get('splice')); reg(ex, 'overlap', n.parameters.get('overlap'), (v) => v / 100); }
      inp.connect(n); return n;
    } }, ['semi', 'cents', 'splice', 'overlap']);

  const SCALE_LIST = [['chromatic', 'Chromatic'], ['major', 'Major'], ['minor', 'Minor'], ['harmonicminor', 'Harmonic Minor'], ['pentatonic', 'Major Pentatonic'], ['minorpentatonic', 'Minor Pentatonic'], ['blues', 'Blues'], ['dorian', 'Dorian'], ['mixolydian', 'Mixolydian']];
  const KEY_LIST = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'].map((k, i) => [String(i), k]);
  R.SCALES = SCALE_LIST; R.KEYS = KEY_LIST;
  def('autopitch', { name: 'Automatic Pitch Correction', cat: CAT.pitch, latency: (p, sr) => Math.round(2 + sr / 50 / 2), params: [SEL('scale', 'Scale', SCALE_LIST, 'major'), SEL('key', 'Key', KEY_LIST, '0'), P('attack', 'Attack', 2, 8, 5, 0.1, ''), P('sens', 'Sensitivity', 50, 200, 100, 1, ''), SEL('ref', 'Reference channel', [['mix', 'Left + Right'], ['left', 'Left'], ['right', 'Right']], 'mix'), SEL('fft', 'FFT size', [['2048', '2048'], ['4096', '4096'], ['8192', '8192']], '4096'), P('calib', 'Calibration (A4)', 400, 480, 440, 0.1, 'Hz')],
    message: (id, v) => (id === 'scale' ? { scale: v } : id === 'key' ? { key: +v } : id === 'ref' ? { ref: v } : id === 'fft' ? { fft: +v } : null),
    build: (ctx, p, inp, ex) => {
      if (!ctx._wl) return inp; const n = worklet(ctx, 'as-autopitch', { scale: p.scale, key: +p.key, ref: p.ref, fft: +p.fft });
      for (const id of ['attack', 'sens', 'calib']) { n.parameters.get(id).value = p[id]; reg(ex, id, n.parameters.get(id)); }
      if (ex.cur && ex.cur.uid) R.nodes[ex.cur.uid] = n; inp.connect(n); return n;
    } }, ['attack', 'sens', 'calib']);

  /* latency (in samples) of one effect so the offline "apply" can trim the head */
  R.latencyOf = (fx, sr) => { const d = R.RACK[fx.type], l = d && d.latency; if (!l) return 0; const p = { ...d.defaults, ...fx.p }; return Math.round(typeof l === 'function' ? l(p, sr) : l); };

  /* Render one effect offline (waveform editor "Apply"): chs = Float32Array[]; returns processed Float32Array[]
     of the same length plus tailSec. The graph is exactly the one used live on a track. */
  R.renderFx = async function (fx, chs, sr, tailSec) {
    const n = chs[0].length, lat = R.latencyOf(fx, sr), tail = Math.max(0, Math.round((tailSec || 0) * sr)), groups = chs.length >= 2 ? [[0, 1], ...chs.slice(2).map((_, i) => [i + 2])] : [[0]], out = new Array(chs.length);
    for (const g of groups) {
      const oc = new OfflineAudioContext(g.length, n + tail + lat + 128, sr); await R.loadWorklets(oc);
      const buf = oc.createBuffer(g.length, Math.max(1, n), sr); g.forEach((c, i) => buf.copyToChannel(chs[c], i));
      const src = oc.createBufferSource(); src.buffer = buf; const ex = { nodes: [], t0: 0, regs: [], meters: null };
      const f = { ...fx, bypass: false }; R.applyRack(oc, { fx: [f], rackCfg: { power: true, in: 0, out: 0, mix: 100 } }, src, ex).connect(oc.destination); src.start(0);
      const res = await oc.startRendering(); g.forEach((c, i) => { out[c] = res.getChannelData(i).slice(lat, lat + n + tail); });
    }
    return out;
  };  void LAT;
})(window);

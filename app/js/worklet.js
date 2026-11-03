/* AudioWorklet processors for the real-time rack (things Web Audio has no native node for). */
const fromDb = (d) => Math.pow(10, d / 20);
const smooth = (ms, sr) => (ms <= 0 ? 0 : Math.exp(-1 / (ms * 0.001 * sr)));

/* Noise gate with hysteresis, hold and smoothed attack/release; channels are linked. */
class GateProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'thr', defaultValue: -45, minValue: -100, maxValue: 0, automationRate: 'k-rate' },
      { name: 'floor', defaultValue: -60, minValue: -100, maxValue: 0, automationRate: 'k-rate' },
      { name: 'att', defaultValue: 3, minValue: 0, maxValue: 200, automationRate: 'k-rate' },
      { name: 'hold', defaultValue: 40, minValue: 0, maxValue: 1000, automationRate: 'k-rate' },
      { name: 'rel', defaultValue: 120, minValue: 1, maxValue: 3000, automationRate: 'k-rate' },
    ];
  }
  constructor() { super(); this.env = 0; this.open = false; this.cnt = 0; this.g = 0.001; }
  process(inputs, outputs, params) {
    const inp = inputs[0], out = outputs[0];
    if (!inp || !inp.length) return true;
    const key = inputs[1] && inputs[1].length ? inputs[1] : inp; // optional sidechain key on input 2
    const n = inp[0].length, sr = sampleRate;
    const thOpen = fromDb(params.thr[0]), thClose = fromDb(params.thr[0] - 4), floor = fromDb(params.floor[0]);
    const aA = smooth(params.att[0], sr), aR = smooth(params.rel[0], sr), holdN = Math.round((params.hold[0] * sr) / 1000);
    for (let i = 0; i < n; i++) {
      let d = 0;
      for (let c = 0; c < key.length; c++) { const v = Math.abs(key[c][i]); if (v > d) d = v; }
      this.env = d > this.env ? d : this.env * 0.9995 + d * 0.0005;
      if (this.env >= thOpen) { this.open = true; this.cnt = holdN; }
      else if (this.open && this.env < thClose) { if (this.cnt-- <= 0) this.open = false; }
      const tgt = this.open ? 1 : floor;
      this.g = tgt > this.g ? aA * this.g + (1 - aA) * tgt : aR * this.g + (1 - aR) * tgt;
      for (let c = 0; c < out.length; c++) out[c][i] = (inp[Math.min(c, inp.length - 1)][i]) * this.g;
    }
    return true;
  }
}
registerProcessor('as-gate', GateProcessor);

/* Sidechain dynamics (compressor / gate / ducker): input 1 = audio, input 2 = key. The algorithm is
   AS.dsp.createDynamics from dsp.js, which rack.js loads into this worklet scope first (same code as the tests). */
class DynProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    const k = (name, defaultValue, minValue, maxValue) => ({ name, defaultValue, minValue, maxValue, automationRate: 'k-rate' });
    return [k('thr', -24, -100, 0), k('ratio', 4, 1, 100), k('knee', 6, 0, 40), k('att', 10, 0, 1000), k('rel', 200, 1, 5000), k('makeup', 0, -40, 40), k('floor', -60, -100, 0), k('amount', 12, 0, 60), k('hold', 50, 0, 2000)];
  }
  constructor(o) { super(); const D = globalThis.AS && globalThis.AS.dsp; this.dyn = D ? D.createDynamics((o && o.processorOptions && o.processorOptions.mode) || 'comp', sampleRate) : null; this.p = {}; this.t = 0; }
  process(inputs, outputs, params) {
    const inp = inputs[0], out = outputs[0]; if (!inp || !inp.length) { for (const c of out) c.fill(0); return true; }
    if (!this.dyn) { for (let c = 0; c < out.length; c++) out[c].set(inp[Math.min(c, inp.length - 1)]); return true; }
    for (const k in params) this.p[k] = params[k][0];
    const gdb = this.dyn.process(inp, inputs[1] && inputs[1].length ? inputs[1] : null, out, inp[0].length, this.p);
    if ((this.t += inp[0].length) >= 4096) { this.t = 0; this.port.postMessage({ gr: gdb }); } // gain-reduction readout
    return true;
  }
}
registerProcessor('as-dyn', DynProcessor);

/* Recorder tap: copies its input on the audio thread (no main-thread timing, so nothing is dropped) and posts
   chunks of ~0.1 s to the port as { ch: [Float32Array…], peak, frame }. Passes the audio through unchanged.
   port messages in: { cmd: 'stop' } flushes the last chunk and stops posting. Used by recording, latency measurement
   and the live-vs-offline tests. */
class RecProcessor extends AudioWorkletProcessor {
  constructor(o) {
    super(); const p = (o && o.processorOptions) || {};
    this.nch = p.channels || 2; this.size = p.chunk || 4096; this.buf = Array.from({ length: this.nch }, () => new Float32Array(this.size)); this.fill = 0; this.on = true; this.frame = 0; this.peak = 0; this.start = currentFrame;
    this.port.onmessage = (e) => { if (e.data && e.data.cmd === 'stop') { this.flush(); this.on = false; this.port.postMessage({ done: true }); } };
  }
  flush() { if (!this.fill) return; const ch = this.buf.map((b) => b.slice(0, this.fill)); this.port.postMessage({ ch, peak: this.peak, frame: this.frame - this.fill, startTime: this.startTime }, ch.map((c) => c.buffer)); this.fill = 0; this.peak = 0; }
  process(inputs, outputs) {
    const inp = inputs[0], out = outputs[0], n = (out[0] || (inp && inp[0]) || []).length || 128;
    if (this.startTime === undefined) this.startTime = currentTime; // context time of the first recorded sample
    if (inp && inp.length) for (let c = 0; c < out.length; c++) out[c].set(inp[Math.min(c, inp.length - 1)]);
    if (!this.on) return true;
    for (let i = 0; i < n; i++) {
      for (let c = 0; c < this.nch; c++) { const v = inp && inp.length ? inp[Math.min(c, inp.length - 1)][i] : 0; this.buf[c][this.fill] = v; const a = v < 0 ? -v : v; if (a > this.peak) this.peak = a; }
      this.fill++; this.frame++;
      if (this.fill === this.size) this.flush();
    }
    return true;
  }
}
registerProcessor('as-rec', RecProcessor);

/* ---------- granular delay-line pitch shifter (shared by the Pitch Shifter and Automatic Pitch Correction) ---------- */
const POW2 = 32768, MASK = POW2 - 1;
class Shifter {
  constructor(channels) { this.buf = Array.from({ length: channels }, () => new Float32Array(POW2)); this.w = 0; this.phase = 0; }
  static read(b, pos, cubic) {
    const i0 = Math.floor(pos), f = pos - i0;
    if (!cubic) return b[i0 & MASK] * (1 - f) + b[(i0 + 1) & MASK] * f;
    const y0 = b[(i0 - 1) & MASK], y1 = b[i0 & MASK], y2 = b[(i0 + 1) & MASK], y3 = b[(i0 + 2) & MASK];
    return y1 + 0.5 * f * (y2 - y0 + f * (2 * y0 - 5 * y1 + 4 * y2 - y3 + f * (3 * (y1 - y2) + y3 - y0)));
  }
  /* ratioAt(i) lets the caller glide the ratio per sample; overlap is 0..1 */
  run(inp, out, n, ratioAt, splice, overlap, taps, cubic) {
    const chs = this.buf.length, W = Math.max(64, Math.min(12000, sampleRate / Math.max(5, splice))), expo = 8 - 6 * overlap;
    for (let i = 0; i < n; i++) {
      const ratio = ratioAt(i); this.phase += (1 - ratio) / W; this.phase -= Math.floor(this.phase);
      for (let c = 0; c < chs; c++) this.buf[c][this.w] = inp[Math.min(c, inp.length - 1)][i];
      let wsum = 0; const acc = [0, 0];
      for (let k = 0; k < taps; k++) {
        const ph = (this.phase + k / taps) % 1, pos = this.w - (2 + ph * W), win = Math.pow(Math.sin(Math.PI * ph), expo);
        wsum += win; for (let c = 0; c < chs; c++) acc[c] += win * Shifter.read(this.buf[c], pos, cubic);
      }
      // near unity the shifter fades to a plain delayed copy (no comb filtering)
      const g = wsum > 1e-6 ? 1 / wsum : 1, wet = Math.min(1, Math.max(0, (Math.abs(12 * Math.log2(ratio)) - 0.02) / 0.18)), dd = Math.round(2 + W / 2);
      for (let c = 0; c < out.length; c++) { const cc = Math.min(c, chs - 1); out[c][i] = acc[cc] * g * wet + (wet < 1 ? this.buf[cc][(this.w - dd) & MASK] * (1 - wet) : 0); }
      this.w = (this.w + 1) & MASK;
    }
  }
}

class PitchProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'semi', defaultValue: 0, minValue: -24, maxValue: 24, automationRate: 'k-rate' },
      { name: 'cents', defaultValue: 0, minValue: -100, maxValue: 100, automationRate: 'k-rate' },
      { name: 'splice', defaultValue: 40, minValue: 5, maxValue: 400, automationRate: 'k-rate' },
      { name: 'overlap', defaultValue: 0.4, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
    ];
  }
  constructor(o) { super(); const p = (o && o.processorOptions) || {}; this.taps = p.taps || 3; this.cubic = !!p.cubic; this.sh = new Shifter(2); }
  process(inputs, outputs, params) {
    const inp = inputs[0], out = outputs[0]; if (!inp || !inp.length) return true;
    const r = Math.pow(2, (params.semi[0] + params.cents[0] / 100) / 12);
    this.sh.run(inp, out, inp[0].length, () => r, params.splice[0], params.overlap[0], this.taps, this.cubic);
    return true;
  }
}
registerProcessor('as-pitch', PitchProcessor);

/* ---------- automatic pitch correction: YIN pitch detection -> nearest scale note -> glide the shifter ---------- */
const SCALES = { chromatic: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], major: [0, 2, 4, 5, 7, 9, 11], minor: [0, 2, 3, 5, 7, 8, 10], harmonicminor: [0, 2, 3, 5, 7, 8, 11], pentatonic: [0, 2, 4, 7, 9], minorpentatonic: [0, 3, 5, 7, 10], blues: [0, 3, 5, 6, 7, 10], dorian: [0, 2, 3, 5, 7, 9, 10], mixolydian: [0, 2, 4, 5, 7, 9, 10] };
class AutoPitchProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'attack', defaultValue: 5, minValue: 1, maxValue: 10, automationRate: 'k-rate' },
      { name: 'sens', defaultValue: 100, minValue: 20, maxValue: 300, automationRate: 'k-rate' },
      { name: 'calib', defaultValue: 440, minValue: 400, maxValue: 480, automationRate: 'k-rate' },
    ];
  }
  constructor(o) {
    super(); const p = (o && o.processorOptions) || {}; this.cfg = { scale: p.scale || 'major', key: p.key || 0, ref: p.ref || 'mix', fft: p.fft || 4096 };
    this.sh = new Shifter(2); this.ratio = 1; this.hist = new Float32Array(8192); this.hw = 0; this.hop = 0; this.cents = 0; this.msgT = 0; this.tmp = 0; this.cnt = 0; this.last = 0;
    this.port.onmessage = (e) => { Object.assign(this.cfg, e.data); };
  }
  detect(sens) { // YIN on a 2x decimated copy of the reference signal
    const W = Math.min(1024, Math.max(256, this.cfg.fft >> 2)), fs = sampleRate / 2, tmin = Math.floor(fs / 800), tmax = Math.min(Math.floor(fs / 70), 700), need = W + tmax + 2, H = this.hist, mask = H.length - 1, base = this.hw - need;
    let e = 0; for (let j = 0; j < W; j++) { const v = H[(base + tmax + j) & mask]; e += v * v; } if (Math.sqrt(e / W) < 0.004) return 0;
    const d = new Float32Array(tmax + 1); let run = 0; d[0] = 1; const thr = 0.1 + 0.1 * (sens / 100);
    for (let t = 1; t <= tmax; t++) { let s = 0; for (let j = 0; j < W; j++) { const a = H[(base + j) & mask] - H[(base + j + t) & mask]; s += a * a; } run += s; d[t] = run > 0 ? (s * t) / run : 1; }
    let tau = -1; for (let t = tmin; t < tmax; t++) if (d[t] < thr) { while (t + 1 < tmax && d[t + 1] < d[t]) t++; tau = t; break; }
    if (tau < 0) return 0;
    const a = d[tau - 1], b = d[tau], c = d[tau + 1], den = a - 2 * b + c, shift = den !== 0 ? (0.5 * (a - c)) / den : 0;
    return fs / (tau + shift);
  }
  targetMidi(f0, calib) {
    const m = 69 + 12 * Math.log2(f0 / calib), mask = SCALES[this.cfg.scale] || SCALES.major, key = this.cfg.key | 0; let best = null;
    for (let n = Math.floor(m) - 2; n <= Math.ceil(m) + 2; n++) { const deg = (((n - key) % 12) + 12) % 12; if (mask.includes(deg)) { const dist = Math.abs(n - m); if (best === null || dist < best.dist) best = { n, dist }; } }
    return best ? best.n : Math.round(m);
  }
  process(inputs, outputs, params) {
    const inp = inputs[0], out = outputs[0]; if (!inp || !inp.length) return true;
    const n = inp[0].length, sens = params.sens[0], calib = params.calib[0], att = params.attack[0], ref = this.cfg.ref;
    for (let i = 0; i < n; i += 2) { // decimate by 2 into history
      const L = inp[0][i] + (i + 1 < n ? inp[0][i + 1] : 0), R = inp.length > 1 ? inp[1][i] + (i + 1 < n ? inp[1][i + 1] : 0) : L;
      this.hist[this.hw & (this.hist.length - 1)] = (ref === 'left' ? L : ref === 'right' ? R : L + R) * (ref === 'mix' ? 0.25 : 0.5); this.hw++;
    }
    this.hop += n;
    if (this.hop >= 256) {
      this.hop = 0; const f0 = this.detect(sens), tau = Math.max(0.006, 0.9 * Math.pow(0.55, att - 1)); // attack 1 = slow glide ... 10 = near-instant
      const alpha = 1 - Math.exp(-(256 / sampleRate) / tau);
      let target = 1; if (f0 > 0) { const m = 69 + 12 * Math.log2(f0 / calib); target = Math.pow(2, (this.targetMidi(f0, calib) - m) / 12); this.last = 0; } else if (++this.last > 4) target = 1;
      this.ratio += (target - this.ratio) * (f0 > 0 ? alpha : 0.05); this.cents = 1200 * Math.log2(this.ratio);
      if (++this.msgT >= 6) { this.msgT = 0; this.port.postMessage({ cents: this.cents, f0 }); }
    }
    this.sh.run(inp, out, n, () => this.ratio, 50, 0.6, 3, true);
    return true;
  }
}
registerProcessor('as-autopitch', AutoPitchProcessor);

/* ---------- spectral denoiser (STFT, per-bin minimum-statistics noise floor) ---------- */
function fftInPlace(re, im, inverse) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) { let bit = n >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit; if (i < j) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; } }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = ((2 * Math.PI) / len) * (inverse ? 1 : -1), wr = Math.cos(ang), wi = Math.sin(ang), half = len >> 1;
    for (let i = 0; i < n; i += len) { let cr = 1, ci = 0; for (let k = 0; k < half; k++) { const a = i + k, b = a + half, xr = re[b] * cr - im[b] * ci, xi = re[b] * ci + im[b] * cr; re[b] = re[a] - xr; im[b] = im[a] - xi; re[a] += xr; im[a] += xi; const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t; } }
  }
  if (inverse) for (let i = 0; i < n; i++) { re[i] /= n; im[i] /= n; }
}
/* per-bin minimum-statistics floor tracker (silence frames are ignored); same algorithm as dsp.js floorTracker */
function floorTracker(half, windows) {
  const hist = Array.from({ length: windows }, () => new Float64Array(half).fill(Infinity)), sub = new Float64Array(half).fill(Infinity); let h = 0, n = 0;
  return {
    live: 0,
    begin(energy) { this.live = energy > 1e-9 ? this.live + 1 : 0; },
    floor(k, v) { if (this.live >= 5 && v > 1e-9 && v < sub[k]) sub[k] = v; let m = sub[k]; for (let j = 0; j < windows; j++) if (hist[j][k] < m) m = hist[j][k]; return m === Infinity ? v : m; },
    frame() { if (++n % 21 === 0) { hist[h].set(sub); h = (h + 1) % windows; sub.fill(Infinity); } },
  };
}
class DenoiseProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'reduce', defaultValue: 14, minValue: 0, maxValue: 60, automationRate: 'k-rate' },
      { name: 'sens', defaultValue: 1.5, minValue: 0.2, maxValue: 5, automationRate: 'k-rate' },
      { name: 'smooth', defaultValue: 0.7, minValue: 0, maxValue: 0.98, automationRate: 'k-rate' },
      { name: 'track', defaultValue: 0.4, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
    ];
  }
  constructor() {
    super(); this.N = 2048; this.H = 512; this.win = new Float64Array(this.N); for (let i = 0; i < this.N; i++) this.win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / this.N);
    this.ch = []; for (let c = 0; c < 2; c++) this.ch.push({ inb: new Float32Array(this.N), acc: new Float32Array(this.N), outq: [], gain: new Float32Array(this.N / 2 + 1).fill(1), sp: new Float64Array(this.N / 2 + 1), tr: floorTracker(this.N / 2 + 1, 6) });
    this.re = new Float64Array(this.N); this.im = new Float64Array(this.N); this.fill = 0; this.pre = this.N - this.H; // initial silence = latency
    for (const s of this.ch) for (let i = 0; i < this.pre; i++) s.outq.push(0);
  }
  frame(s, p) {
    const { N, H, re, im, win } = this, half = N / 2, floor = Math.pow(10, -p.reduce / 20);
    for (let i = 0; i < N; i++) { re[i] = s.inb[i] * win[i]; im[i] = 0; }
    fftInPlace(re, im, false);
    let en = 0; for (let k = 0; k <= half; k++) en += re[k] * re[k] + im[k] * im[k]; s.tr.begin(en);
    for (let k = 0; k <= half; k++) {
      const m = Math.hypot(re[k], im[k]) + 1e-12; s.sp[k] = s.tr.live <= 1 || !s.sp[k] ? m : s.sp[k] * 0.8 + m * 0.2;
      const nf = s.tr.floor(k, s.sp[k]); let g = Math.max(floor, 1 - (p.sens * nf * 1.5) / m); g = g > s.gain[k] ? g : s.gain[k] * p.smooth + g * (1 - p.smooth); s.gain[k] = g;
      re[k] *= g; im[k] *= g; if (k > 0 && k < half) { re[N - k] *= g; im[N - k] *= g; }
    }
    s.tr.frame(); fftInPlace(re, im, true);
    for (let i = 0; i < N; i++) s.acc[i] += (re[i] * win[i]) / 1.5;
    for (let i = 0; i < H; i++) s.outq.push(s.acc[i]);
    s.acc.copyWithin(0, H); s.acc.fill(0, N - H);
  }
  process(inputs, outputs, params) {
    const inp = inputs[0], out = outputs[0]; if (!inp || !inp.length) return true;
    const n = inp[0].length, p = { reduce: params.reduce[0], sens: params.sens[0], smooth: params.smooth[0], track: params.track[0] };
    for (let i = 0; i < n; i++) {
      for (let c = 0; c < 2; c++) { const s = this.ch[c]; s.inb.copyWithin(0, 1); s.inb[this.N - 1] = inp[Math.min(c, inp.length - 1)][i]; }
      if (++this.fill >= this.H) { this.fill = 0; for (const s of this.ch) this.frame(s, p); }
      for (let c = 0; c < out.length; c++) { const q = this.ch[Math.min(c, 1)].outq; out[c][i] = q.length ? q.shift() : 0; }
    }
    return true;
  }
}
registerProcessor('as-denoise', DenoiseProcessor);

/* ---------- DeReverb (late-reverberation spectral subtraction) ----------
   The per-frame algorithm is AS.dsp.dereverbFrame from dsp.js (loaded into this scope first), so live = offline.
   focus: 0 all · 1 low · 2 mid · 3 high (index into AS.dsp.DEREVERB_FOCUS); t60 is the room decay in seconds. */
class DereverbProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'amount', defaultValue: 60, minValue: 0, maxValue: 100, automationRate: 'k-rate' },
      { name: 'focus', defaultValue: 0, minValue: 0, maxValue: 3, automationRate: 'k-rate' },
      { name: 't60', defaultValue: 0.8, minValue: 0.1, maxValue: 8, automationRate: 'k-rate' },
    ];
  }
  constructor() {
    super(); this.D = globalThis.AS && globalThis.AS.dsp; this.N = 2048; this.H = 512; this.win = new Float64Array(this.N); for (let i = 0; i < this.N; i++) this.win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / this.N);
    this.re = new Float64Array(this.N); this.im = new Float64Array(this.N); this.fill = 0; this.key = ''; this.o = null; this.ch = [];
  }
  opts(p) {
    const key = p.amount + '|' + p.focus + '|' + p.t60; if (key === this.key) return this.o;
    const nl = this.o && this.o.nl; this.key = key;
    this.o = this.D.dereverbOpts(sampleRate, this.N, this.H, p.amount, this.D.DEREVERB_FOCUS[Math.round(p.focus)] || 'all', p.t60);
    if (this.o.nl !== nl) this.ch = [0, 1].map(() => ({ inb: new Float32Array(this.N), acc: new Float32Array(this.N), outq: new Array(this.N - this.H).fill(0), st: this.D.dereverbState(this.N / 2 + 1, this.o.nl) }));
    return this.o;
  }
  frame(s, o) {
    const { N, H, re, im, win } = this;
    for (let i = 0; i < N; i++) { re[i] = s.inb[i] * win[i]; im[i] = 0; }
    fftInPlace(re, im, false); this.D.dereverbFrame(re, im, N, s.st, o); fftInPlace(re, im, true);
    for (let i = 0; i < N; i++) s.acc[i] += (re[i] * win[i]) / 1.5;
    for (let i = 0; i < H; i++) s.outq.push(s.acc[i]);
    s.acc.copyWithin(0, H); s.acc.fill(0, N - H);
  }
  process(inputs, outputs, params) {
    const inp = inputs[0], out = outputs[0]; if (!inp || !inp.length) return true;
    if (!this.D) { for (let c = 0; c < out.length; c++) out[c].set(inp[Math.min(c, inp.length - 1)]); return true; }
    const n = inp[0].length, o = this.opts({ amount: params.amount[0], focus: params.focus[0], t60: params.t60[0] });
    for (let i = 0; i < n; i++) {
      for (let c = 0; c < 2; c++) { const s = this.ch[c]; s.inb.copyWithin(0, 1); s.inb[this.N - 1] = inp[Math.min(c, inp.length - 1)][i]; }
      if (++this.fill >= this.H) { this.fill = 0; for (const s of this.ch) this.frame(s, o); }
      for (let c = 0; c < out.length; c++) { const q = this.ch[Math.min(c, 1)].outq; out[c][i] = q.length ? q.shift() : 0; }
    }
    return true;
  }
}
registerProcessor('as-dereverb', DereverbProcessor);

/* ---------- loudness meter (ITU-R BS.1770 K-weighting; momentary / short-term / integrated / range) ---------- */
function bq(type, f, q, gainDb) {
  const w0 = (2 * Math.PI * f) / sampleRate, cw = Math.cos(w0), sw = Math.sin(w0), A = Math.pow(10, (gainDb || 0) / 40), al = sw / (2 * q); let b0, b1, b2, a0, a1, a2;
  if (type === 'highpass') { b0 = (1 + cw) / 2; b1 = -(1 + cw); b2 = b0; a0 = 1 + al; a1 = -2 * cw; a2 = 1 - al; }
  else { const s = 2 * Math.sqrt(A) * al; b0 = A * (A + 1 + (A - 1) * cw + s); b1 = -2 * A * (A - 1 + (A + 1) * cw); b2 = A * (A + 1 + (A - 1) * cw - s); a0 = A + 1 - (A - 1) * cw + s; a1 = 2 * (A - 1 - (A + 1) * cw); a2 = A + 1 - (A - 1) * cw - s; }
  return [b0 / a0, b1 / a0, b2 / a0, a1 / a0, a2 / a0];
}
class LoudnessProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    // the exact BS.1770 K-weighting from dsp.js (loaded into this scope first); the RBJ approximation only as a fallback
    const D = globalThis.AS && globalThis.AS.dsp;
    if (D && D.kWeightCoefs) [this.s1, this.s2] = D.kWeightCoefs(sampleRate); else { this.s1 = bq('highshelf', 1681.97, 0.7071, 3.99984); this.s2 = bq('highpass', 38.1355, 0.5003); }
    this.st = [0, 1].map(() => new Float64Array(8));
    this.segLen = Math.round(sampleRate * 0.1); this.segAcc = 0; this.segN = 0; this.segs = []; this.blocks = []; this.shorts = []; this.peak = 0; this.msgT = 0;
    this.port.onmessage = (e) => { if (e.data && e.data.reset) { this.segs = []; this.blocks = []; this.shorts = []; this.peak = 0; } };
  }
  lk(z) { return z > 0 ? -0.691 + 10 * Math.log10(z) : -Infinity; }
  process(inputs, outputs) {
    const inp = inputs[0], out = outputs[0]; if (!inp || !inp.length) return true;
    const n = inp[0].length;
    for (let c = 0; c < out.length; c++) out[c].set(inp[Math.min(c, inp.length - 1)]);
    for (let c = 0; c < Math.min(2, inp.length); c++) {
      const s = this.st[c], x = inp[c]; let sq = 0, pk = this.peak;
      for (let i = 0; i < n; i++) {
        const v = x[i]; if (Math.abs(v) > pk) pk = Math.abs(v);
        let y = this.s1[0] * v + this.s1[1] * s[0] + this.s1[2] * s[1] - this.s1[3] * s[2] - this.s1[4] * s[3]; s[1] = s[0]; s[0] = v; s[3] = s[2]; s[2] = y;
        const z = this.s2[0] * y + this.s2[1] * s[4] + this.s2[2] * s[5] - this.s2[3] * s[6] - this.s2[4] * s[7]; s[5] = s[4]; s[4] = y; s[7] = s[6]; s[6] = z; sq += z * z;
      }
      this.segAcc += sq; this.peak = pk;
    }
    this.segN += n;
    while (this.segN >= this.segLen) { // one 100 ms segment finished
      const e = this.segAcc / this.segLen; this.segAcc = 0; this.segN -= this.segLen; this.segs.push(e); if (this.segs.length > 4000) this.segs.shift();
      if (this.segs.length >= 4) { const L = this.segs.length, z = (this.segs[L - 1] + this.segs[L - 2] + this.segs[L - 3] + this.segs[L - 4]) / 4; this.blocks.push(z); if (this.blocks.length > 40000) this.blocks.shift(); }
      if (this.segs.length >= 30) { let s30 = 0; for (let i = this.segs.length - 30; i < this.segs.length; i++) s30 += this.segs[i]; this.shorts.push(this.lk(s30 / 30)); if (this.shorts.length > 40000) this.shorts.shift(); }
      this.report();
    }
    return true;
  }
  report() {
    const L = this.segs.length, m = L >= 4 ? this.lk((this.segs[L - 1] + this.segs[L - 2] + this.segs[L - 3] + this.segs[L - 4]) / 4) : -Infinity, s = this.shorts.length ? this.shorts[this.shorts.length - 1] : -Infinity;
    const g1 = this.blocks.filter((z) => this.lk(z) > -70); let integ = -Infinity;
    if (g1.length) { const rel = this.lk(g1.reduce((a, b) => a + b, 0) / g1.length) - 10, g2 = g1.filter((z) => this.lk(z) > rel); if (g2.length) integ = this.lk(g2.reduce((a, b) => a + b, 0) / g2.length); }
    let lra = 0; const sv = this.shorts.filter((v) => v > -70);
    if (sv.length > 4) { const pw = sv.map((v) => Math.pow(10, v / 10)), rel = 10 * Math.log10(pw.reduce((a, b) => a + b, 0) / pw.length) - 20, g = sv.filter((v) => v > rel).sort((a, b) => a - b); if (g.length > 2) lra = g[Math.floor(g.length * 0.95)] - g[Math.floor(g.length * 0.1)]; }
    this.port.postMessage({ m, s, i: integ, lra, peak: this.peak > 0 ? 20 * Math.log10(this.peak) : -Infinity });
  }
}
registerProcessor('as-loudness', LoudnessProcessor);
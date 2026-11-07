/* AudioStage DSP core — pure functions on arrays of Float32Array channels. */
(function (root) {
  'use strict';
  const TAU = Math.PI * 2;
  const toDb = (x) => 20 * Math.log10(Math.max(x, 1e-12));
  const fromDb = (d) => Math.pow(10, d / 20);
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

  /* ---------- FFT ---------- */
  function fft(re, im, inverse) {
    const n = re.length;
    for (let i = 1, j = 0; i < n; i++) {
      let bit = n >> 1;
      for (; j & bit; bit >>= 1) j ^= bit;
      j ^= bit;
      if (i < j) {
        let t = re[i]; re[i] = re[j]; re[j] = t;
        t = im[i]; im[i] = im[j]; im[j] = t;
      }
    }
    for (let len = 2; len <= n; len <<= 1) {
      const ang = (TAU / len) * (inverse ? 1 : -1);
      const wr = Math.cos(ang), wi = Math.sin(ang), half = len >> 1;
      for (let i = 0; i < n; i += len) {
        let cr = 1, ci = 0;
        for (let k = 0; k < half; k++) {
          const a = i + k, b = a + half;
          const xr = re[b] * cr - im[b] * ci, xi = re[b] * ci + im[b] * cr;
          re[b] = re[a] - xr; im[b] = im[a] - xi;
          re[a] += xr; im[a] += xi;
          const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t;
        }
      }
    }
    if (inverse) for (let i = 0; i < n; i++) { re[i] /= n; im[i] /= n; }
  }

  const winCache = {};
  function hann(n) {
    if (!winCache[n]) {
      const w = new Float64Array(n);
      for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos((TAU * i) / n);
      winCache[n] = w;
    }
    return winCache[n];
  }

  /* ---------- helpers ---------- */
  const cloneCh = (chs) => chs.map((c) => c.slice());
  const mixMono = (chs) => {
    if (chs.length === 1) return chs[0];
    const L = chs[0].length, m = new Float32Array(L), k = 1 / chs.length;
    for (const c of chs) for (let i = 0; i < L; i++) m[i] += c[i] * k;
    return m;
  };
  function concatCh(parts, nch) {
    // parts: array of channel-arrays (each part = array of Float32Array)
    let total = 0;
    for (const p of parts) total += p[0] ? p[0].length : 0;
    const out = [];
    for (let c = 0; c < nch; c++) {
      const o = new Float32Array(total);
      let pos = 0;
      for (const p of parts) {
        const src = p[Math.min(c, p.length - 1)];
        if (src) { o.set(src, pos); pos += src.length; }
      }
      out.push(o);
    }
    return out;
  }
  function spliceCh(chs, start, end, insert) {
    const nch = chs.length;
    const before = chs.map((c) => c.subarray(0, start));
    const after = chs.map((c) => c.subarray(end));
    const parts = [before];
    if (insert && insert.length) parts.push(insert.length === nch ? insert : matchChannels(insert, nch));
    parts.push(after);
    return concatCh(parts, nch);
  }
  function matchChannels(chs, n) {
    if (chs.length === n) return chs;
    if (n === 1) return [mixMono(chs)];
    const out = [];
    for (let c = 0; c < n; c++) out.push(chs[Math.min(c, chs.length - 1)]);
    return out;
  }
  const sliceCh = (chs, s, e) => chs.map((c) => c.slice(s, e));
  /* NaN / Infinity → 0, in place; returns how many samples were bad. Files with such samples do not play elsewhere. */
  function sanitize(chs) {
    let bad = 0;
    for (const c of chs) for (let i = 0; i < c.length; i++) { const v = c[i]; if (v - v !== 0) { c[i] = 0; bad++; } } // (v - v is NaN for NaN and ±Infinity)
    return bad;
  }

  /* ---------- biquad ---------- */
  function biquadCoefs(type, sr, f, q, gainDb) {
    f = clamp(f, 1, sr * 0.499); q = Math.max(q || 0.707, 0.01);
    const w0 = (TAU * f) / sr, cw = Math.cos(w0), sw = Math.sin(w0);
    const A = Math.pow(10, (gainDb || 0) / 40), alpha = sw / (2 * q);
    let b0, b1, b2, a0, a1, a2;
    switch (type) {
      case 'lowpass': b0 = (1 - cw) / 2; b1 = 1 - cw; b2 = b0; a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha; break;
      case 'highpass': b0 = (1 + cw) / 2; b1 = -(1 + cw); b2 = b0; a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha; break;
      case 'bandpass': b0 = alpha; b1 = 0; b2 = -alpha; a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha; break;
      case 'notch': b0 = 1; b1 = -2 * cw; b2 = 1; a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha; break;
      case 'allpass': b0 = 1 - alpha; b1 = -2 * cw; b2 = 1 + alpha; a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha; break;
      case 'peaking': b0 = 1 + alpha * A; b1 = -2 * cw; b2 = 1 - alpha * A; a0 = 1 + alpha / A; a1 = -2 * cw; a2 = 1 - alpha / A; break;
      case 'lowshelf': {
        const s = 2 * Math.sqrt(A) * alpha;
        b0 = A * (A + 1 - (A - 1) * cw + s); b1 = 2 * A * (A - 1 - (A + 1) * cw); b2 = A * (A + 1 - (A - 1) * cw - s);
        a0 = A + 1 + (A - 1) * cw + s; a1 = -2 * (A - 1 + (A + 1) * cw); a2 = A + 1 + (A - 1) * cw - s; break;
      }
      case 'highshelf': {
        const s = 2 * Math.sqrt(A) * alpha;
        b0 = A * (A + 1 + (A - 1) * cw + s); b1 = -2 * A * (A - 1 + (A + 1) * cw); b2 = A * (A + 1 + (A - 1) * cw - s);
        a0 = A + 1 - (A - 1) * cw + s; a1 = 2 * (A - 1 - (A + 1) * cw); a2 = A + 1 - (A - 1) * cw - s; break;
      }
      default: throw new Error('bad biquad ' + type);
    }
    return [b0 / a0, b1 / a0, b2 / a0, a1 / a0, a2 / a0];
  }
  function applyBiquad(x, c) {
    const L = x.length, y = new Float32Array(L);
    const b0 = c[0], b1 = c[1], b2 = c[2], a1 = c[3], a2 = c[4];
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    for (let i = 0; i < L; i++) {
      const v = x[i];
      const o = b0 * v + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
      x2 = x1; x1 = v; y2 = y1; y1 = o; y[i] = o;
    }
    return y;
  }
  const filterCh = (chs, sr, type, f, q, g, passes) => chs.map((c) => {
    let y = c;
    const co = biquadCoefs(type, sr, f, q, g);
    for (let p = 0; p < (passes || 1); p++) y = applyBiquad(y, co);
    return y === c ? c.slice() : y;
  });

  /* ---------- resample / stretch / pitch ---------- */
  function resample(x, ratio) {
    const L = x.length, n = Math.max(1, Math.round(L * ratio)), y = new Float32Array(n), step = L / n;
    const last = L - 1;
    for (let i = 0; i < n; i++) {
      const p = i * step, i1 = p | 0, t = p - i1;
      const p0 = x[i1 > 0 ? i1 - 1 : 0], p1 = x[i1 > last ? last : i1];
      const p2 = x[i1 + 1 > last ? last : i1 + 1], p3 = x[i1 + 2 > last ? last : i1 + 2];
      y[i] = 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (-p0 + 3 * p1 - 3 * p2 + p3) * t * t * t);
    }
    return y;
  }
  function convertRate(chs, srIn, srOut) {
    if (srIn === srOut) return cloneCh(chs);
    const ratio = srOut / srIn;
    return chs.map((c) => {
      let x = c;
      if (ratio < 1) { const co = biquadCoefs('lowpass', srIn, srOut * 0.45, 0.707); x = applyBiquad(applyBiquad(x, co), co); }
      return resample(x, ratio);
    });
  }
  function timeStretch(chs, sr, factor, winN) {
    const L = chs[0].length;
    if (Math.abs(factor - 1) < 1e-4) return cloneCh(chs);
    if (L < 8192) return chs.map((c) => resample(c, factor));
    const N = winN || (sr >= 32000 ? 2048 : 1024), Hs = N >> 1, Ha = Hs / factor, tol = Hs >> 1;
    const outL = Math.round(L * factor), win = hann(N), mono = mixMono(chs);
    const out = chs.map(() => new Float32Array(outL + N));
    const frames = Math.ceil(outL / Hs) + 1;
    let prev = 0;
    for (let k = 0; k < frames; k++) {
      const target = Math.round(k * Ha);
      let pos = target;
      if (k > 0) {
        const tpl = prev + Hs;
        let best = -Infinity, bestPos = target;
        for (let cand = target - tol; cand <= target + tol; cand += 2) {
          if (cand < 0) continue;
          let dot = 0, en = 1e-9;
          for (let i = 0; i < N; i += 4) {
            const a = tpl + i < L ? mono[tpl + i] : 0, b = cand + i < L ? mono[cand + i] : 0;
            dot += a * b; en += b * b;
          }
          const score = dot / Math.sqrt(en);
          if (score > best) { best = score; bestPos = cand; }
        }
        pos = bestPos;
      }
      const o = k * Hs;
      for (let c = 0; c < chs.length; c++) {
        const src = chs[c], dst = out[c];
        for (let i = 0; i < N; i++) {
          const si = pos + i;
          if (si < L && o + i < dst.length) dst[o + i] += src[si] * win[i];
        }
      }
      prev = pos;
    }
    return out.map((c) => c.slice(0, outL));
  }
  function pitchShift(chs, sr, semitones, winN) {
    if (Math.abs(semitones) < 1e-6) return cloneCh(chs);
    const r = Math.pow(2, semitones / 12), L = chs[0].length;
    const st = timeStretch(chs, sr, r, winN);
    return st.map((c) => { const y = resample(c, 1 / r); return y.length === L ? y : fixLen(y, L); });
  }
  /* multitrack clip stretch. stretch = new length / original length.
       polyphonic  WSOLA with a long window (music, chords: smooth)
       monophonic  WSOLA with a short window (voice, solo instruments: tighter transients)
       varispeed   plain resampling: speed and pitch change together, like tape (semis is ignored) */
  function clipStretch(chs, sr, stretch, semis, mode) {
    if (mode === 'varispeed') return Math.abs(stretch - 1) < 1e-6 ? cloneCh(chs) : chs.map((c) => resample(c, stretch));
    const N = mode === 'monophonic' ? (sr >= 32000 ? 1024 : 512) : (sr >= 32000 ? 4096 : 2048);
    let o = Math.abs(stretch - 1) > 1e-4 ? timeStretch(chs, sr, stretch, N) : cloneCh(chs);
    if (Math.abs(semis || 0) > 1e-6) o = pitchShift(o, sr, semis, N);
    return o;
  }
  function fixLen(x, L) { const y = new Float32Array(L); y.set(x.subarray(0, Math.min(L, x.length))); return y; }

  /* ---------- amplitude ---------- */
  const gainCh = (chs, db) => { const g = fromDb(db); return chs.map((c) => { const y = new Float32Array(c.length); for (let i = 0; i < y.length; i++) y[i] = c[i] * g; return y; }); };
  function peakOf(chs) { let p = 0; for (const c of chs) for (let i = 0; i < c.length; i++) { const v = Math.abs(c[i]); if (v > p) p = v; } return p; }
  function normalize(chs, targetDb, perChannel, removeDc) {
    let src = chs;
    if (removeDc) src = dcRemove(chs);
    const t = fromDb(targetDb);
    if (perChannel) return src.map((c) => { const p = peakOf([c]) || 1; const g = t / p; return c.map((v) => v * g); });
    const p = peakOf(src) || 1, g = t / p;
    return src.map((c) => c.map((v) => v * g));
  }
  function dcRemove(chs) { return chs.map((c) => { let s = 0; for (let i = 0; i < c.length; i++) s += c[i]; const m = s / (c.length || 1); return c.map((v) => v - m); }); }
  function curveShape(t, type) {
    switch (type) {
      case 'cosine': return 0.5 - 0.5 * Math.cos(Math.PI * t);
      case 'log': return Math.log10(1 + 9 * t);
      case 'exp': return t * t * t;
      default: return t;
    }
  }
  function ramp(chs, startDb, endDb, curve) {
    const L = chs[0].length, g0 = startDb <= -100 ? 0 : fromDb(startDb), g1 = endDb <= -100 ? 0 : fromDb(endDb);
    return chs.map((c) => {
      const y = new Float32Array(L);
      for (let i = 0; i < L; i++) { const t = curveShape(L > 1 ? i / (L - 1) : 1, curve); y[i] = c[i] * (g0 + (g1 - g0) * t); }
      return y;
    });
  }
  const invert = (chs) => chs.map((c) => c.map((v) => -v));
  const reverse = (chs) => chs.map((c) => c.slice().reverse());
  const silence = (chs) => chs.map((c) => new Float32Array(c.length));

  /* ---------- dynamics ---------- */
  const coef = (ms, sr) => (ms <= 0 ? 0 : Math.exp(-1 / (ms * 0.001 * sr)));
  function compressor(chs, sr, thr, ratio, attack, release, makeup, knee) {
    const L = chs[0].length, aA = coef(attack, sr), aR = coef(release, sr), out = chs.map(() => new Float32Array(L));
    const slope = 1 / Math.max(ratio, 1) - 1;
    let env = 0;
    for (let i = 0; i < L; i++) {
      let d = 0;
      for (let c = 0; c < chs.length; c++) { const v = Math.abs(chs[c][i]); if (v > d) d = v; }
      env = d > env ? aA * env + (1 - aA) * d : aR * env + (1 - aR) * d;
      const over = toDb(env) - thr;
      let gr = 0;
      if (knee > 0 && 2 * over > -knee && 2 * Math.abs(over) <= knee) { const t = over + knee / 2; gr = (slope * t * t) / (2 * knee); }
      else if (over > 0 && (knee <= 0 || 2 * over > knee)) gr = slope * over;
      const g = fromDb(gr + makeup);
      for (let c = 0; c < chs.length; c++) out[c][i] = chs[c][i] * g;
    }
    return out;
  }
  function limiter(chs, sr, ceilDb, lookMs, relMs) {
    const L = chs[0].length, ceil = fromDb(ceilDb), sm = limiterGain(chs, sr, ceilDb, lookMs, relMs);
    return chs.map((c) => { const y = new Float32Array(L); for (let i = 0; i < L; i++) y[i] = clamp(c[i] * sm[i], -ceil, ceil); return y; });
  }
  /* the limiter's gain curve: look-ahead minimum of the required gain, release smoothing, box average */
  function limiterGain(chs, sr, ceilDb, lookMs, relMs) {
    const L = chs[0].length, W = Math.max(1, Math.round((lookMs * sr) / 1000)), ceil = fromDb(ceilDb);
    const req = new Float32Array(L);
    for (let i = 0; i < L; i++) { let m = 0; for (const c of chs) { const v = Math.abs(c[i]); if (v > m) m = v; } req[i] = m > ceil ? ceil / m : 1; }
    // sliding window min over [i, i+W-1]
    const gmin = new Float32Array(L), dq = new Int32Array(L + 1);
    let h = 0, t = 0;
    for (let i = L - 1; i >= -W; i--) {
      if (i >= 0) { while (t > h && req[dq[t - 1]] >= req[i]) t--; dq[t++] = i; }
      const idx = i;
      if (idx >= 0) { while (dq[h] > idx + W - 1) h++; gmin[idx] = req[dq[h]]; }
    }
    // release smoothing (limits how fast gain recovers), then trailing box average
    const rc = coef(relMs, sr);
    let prev = 1;
    for (let i = 0; i < L; i++) { const g = gmin[i]; if (g > prev) prev += (g - prev) * (1 - rc); else prev = g; gmin[i] = prev; }
    const sm = new Float32Array(L);
    const base = L ? gmin[0] : 1;
    let sum = base * W;
    for (let i = 0; i < L; i++) {
      sum += gmin[i] - (i - W >= 0 ? gmin[i - W] : base);
      sm[i] = sum / W;
    }
    return sm;
  }
  function gate(chs, sr, thr, floorDb, attack, hold, release) {
    const L = chs[0].length, aA = coef(attack, sr), aR = coef(release, sr), holdN = Math.round((hold * sr) / 1000);
    const floor = fromDb(floorDb), thL = fromDb(thr), thClose = fromDb(thr - 4), out = chs.map(() => new Float32Array(L));
    let env = 0, open = false, cnt = 0, g = floor;
    for (let i = 0; i < L; i++) {
      let d = 0;
      for (let c = 0; c < chs.length; c++) { const v = Math.abs(chs[c][i]); if (v > d) d = v; }
      env = d > env ? d : env * 0.9995 + d * 0.0005;
      if (env >= thL) { open = true; cnt = holdN; } else if (open && env < thClose) { if (cnt-- <= 0) open = false; }
      const tgt = open ? 1 : floor;
      g = tgt > g ? aA * g + (1 - aA) * tgt : aR * g + (1 - aR) * tgt;
      for (let c = 0; c < chs.length; c++) out[c][i] = chs[c][i] * g;
    }
    return out;
  }

  /* ---------- sidechain dynamics (block processor, shared by the 'as-dyn' AudioWorklet and the tests) ----------
     The detector listens to `key` (another track) — or to the input itself when no key is given — and the
     resulting gain is applied to `main`. Modes:
       comp  compressor: above thr, reduce by (1 - 1/ratio) of the overshoot, soft knee
       gate  noise gate / expander: below thr (with 4 dB hysteresis + hold) drop to `floor` dB
       duck  ducker: while the key is above thr, lower by `amount` dB (hold keeps it down between words)
     p: { thr, ratio, knee, att, rel, makeup, floor, amount, hold } (dB / ms). State lives in the returned object. */
  function createDynamics(mode, sr) {
    const S = { env: 0, gdb: 0, open: false, cnt: 0 };
    const relDet = Math.exp(-1 / (0.01 * sr)); // 10 ms detector release (peak follower)
    return {
      mode,
      /* main / key: arrays of channels (Float32Array); out: channels to write (may alias main); n samples */
      process(main, key, out, n, p) {
        const det = key && key.length ? key : main, aA = coef(p.att, sr), aR = coef(p.rel, sr), slope = 1 / Math.max(1, p.ratio || 1) - 1, knee = p.knee || 0;
        const thOpen = p.thr, thClose = p.thr - 4, holdN = Math.round(((p.hold || 0) * sr) / 1000), mk = p.makeup || 0;
        for (let i = 0; i < n; i++) {
          let d = 0; for (let c = 0; c < det.length; c++) { const v = Math.abs(det[c][i]); if (v > d) d = v; }
          S.env = d > S.env ? d : S.env * relDet + d * (1 - relDet);
          const lvl = toDb(S.env);
          let tgt = 0;
          if (mode === 'comp') {
            const over = lvl - thOpen;
            if (knee > 0 && 2 * Math.abs(over) <= knee) { const t = over + knee / 2; tgt = (slope * t * t) / (2 * knee); }
            else if (over > 0) tgt = slope * over;
          } else {
            if (lvl >= thOpen) { S.open = true; S.cnt = holdN; } else if (S.open && lvl < thClose) { if (S.cnt-- <= 0) S.open = false; }
            tgt = mode === 'gate' ? (S.open ? 0 : Math.min(0, p.floor)) : (S.open ? -Math.abs(p.amount || 0) : 0);
          }
          // gain smoothing: attack when the gain goes down, release when it comes back up
          S.gdb = tgt < S.gdb ? tgt + (S.gdb - tgt) * aA : tgt + (S.gdb - tgt) * aR;
          const g = fromDb(S.gdb + mk);
          for (let c = 0; c < out.length; c++) { const src = main[Math.min(c, main.length - 1)]; out[c][i] = (src ? src[i] : 0) * g; }
        }
        return S.gdb; // current gain change in dB (for meters)
      },
    };
  }

  /* ---------- tempo detection (onset envelope + autocorrelation) ----------
     1. onset strength: half-wave rectified spectral flux of log magnitudes (FFT 1024, hop 512), minus its local mean
     2. autocorrelation over 50–220 BPM, weighted by a broad prior around 120 BPM (picks the musically likely octave)
     3. fine search ±4 % around the winner: comb sums over the envelope give the exact BPM and the beat phase
     Analyses up to 90 s from the middle of long files.
     Returns { bpm, offset (s, first beat), confidence 0..1, candidates: [bpm, half, double] }. Half / double tempo is
     genuinely ambiguous (drum'n'bass at 174 "is" 87, hi-hats in 8ths make 72 look like 144), so the UI offers them. */
  function detectTempo(chs, sr) {
    const x = chs.length > 1 ? mixMono(chs) : chs[0], N = 1024, H = 512, maxLen = Math.round(90 * sr);
    const a0 = x.length > maxLen ? Math.floor((x.length - maxLen) / 2) : 0, L = Math.min(x.length, maxLen);
    const frames = Math.max(0, Math.floor((L - N) / H) + 1), fps = sr / H;
    if (frames < fps * 4) return { bpm: 0, offset: 0, confidence: 0 }; // needs a few seconds of audio
    const win = hann(N), re = new Float64Array(N), im = new Float64Array(N), prev = new Float64Array(N / 2), env = new Float64Array(frames);
    for (let f = 0; f < frames; f++) {
      const o = a0 + f * H;
      for (let i = 0; i < N; i++) { re[i] = x[o + i] * win[i]; im[i] = 0; }
      fft(re, im, false);
      let flux = 0;
      for (let k = 1; k < N / 2; k++) { const m = Math.log1p(1000 * Math.hypot(re[k], im[k])), d = m - prev[k]; if (d > 0) flux += d; prev[k] = m; }
      env[f] = f ? flux : 0;
    }
    // remove the local mean (≈ 0.5 s) and keep the peaks
    const w = Math.round(fps / 4), on = new Float64Array(frames); let acc = 0;
    for (let f = 0; f < frames; f++) { acc += env[f]; if (f > 2 * w) acc -= env[f - 2 * w - 1]; const n = Math.min(f, 2 * w) + 1, c = f - w; if (c >= 0) on[c] = Math.max(0, env[c] - acc / n); }
    const lagMin = Math.floor((60 * fps) / 220), lagMax = Math.ceil((60 * fps) / 50);
    let e0 = 0; for (let f = 0; f < frames; f++) e0 += on[f] * on[f]; if (e0 <= 0) return { bpm: 0, offset: 0, confidence: 0 };
    const ac = new Float64Array(lagMax + 2);
    for (let lag = lagMin - 1; lag <= lagMax + 1; lag++) { let s = 0; for (let f = lag; f < frames; f++) s += on[f] * on[f - lag]; ac[lag] = s / e0; }
    const prior = (bpm) => Math.exp(-0.5 * Math.pow(Math.log2(bpm / 120) / 0.9, 2));
    let best = lagMin, bestS = -Infinity;
    for (let lag = lagMin; lag <= lagMax; lag++) { const s = ac[lag] * prior((60 * fps) / lag); if (s > bestS) { bestS = s; best = lag; } }
    // comb score: mean onset strength on a beat grid (fractional period), best phase
    const comb = (period) => {
      let bs = -1, bp = 0; const steps = Math.max(8, Math.round(period));
      for (let k = 0; k < steps; k++) {
        const ph = (k / steps) * period; let s = 0, n = 0;
        for (let p = ph; p < frames - 1; p += period) { const i = Math.floor(p), u = p - i; s += on[i] * (1 - u) + on[i + 1] * u; n++; }
        if (n && s / n > bs) { bs = s / n; bp = ph; }
      }
      return [bs, bp];
    };
    let bpm0 = (60 * fps) / best, top = [-1, 0, bpm0];
    for (let b = bpm0 * 0.96; b <= bpm0 * 1.04; b += 0.02) { const [s, ph] = comb((60 * fps) / b); if (s > top[0]) top = [s, ph, b]; }
    let mean = 0; for (let f = 0; f < frames; f++) mean += on[f]; mean /= frames;
    const confidence = clamp((top[0] / Math.max(1e-12, mean) - 1) / 4, 0, 1);
    const bpm = Math.round(top[2] * 100) / 100, period = 60 / bpm;
    let offset = (a0 / sr + (top[1] + N / 2 / H) / fps) % period; if (offset < 0) offset += period; // centre of the analysis frame
    const candidates = [bpm, Math.round(bpm * 50) / 100, Math.round(bpm * 200) / 100].filter((b, i) => i === 0 || (b >= 40 && b <= 300));
    return { bpm, offset, confidence, candidates };
  }

  /* ---------- time-based fx ---------- */
  function echo(chs, sr, delayMs, feedback, mix) {
    const D = Math.max(1, Math.round((delayMs * sr) / 1000));
    return chs.map((x) => {
      const L = x.length, d = new Float32Array(L), y = new Float32Array(L);
      for (let i = 0; i < L; i++) { d[i] = i >= D ? x[i - D] + feedback * d[i - D] : 0; y[i] = x[i] * (1 - mix * 0.5) + d[i] * mix; }
      return y;
    });
  }
  function modDelay(chs, sr, o) {
    return chs.map((x, ci) => {
      const L = x.length, size = Math.ceil(((o.base + o.depth) * sr) / 1000) + 4, buf = new Float32Array(size), y = new Float32Array(L);
      let w = 0;
      const ph0 = (ci * (o.stereo || 0.25)) % 1;
      for (let i = 0; i < L; i++) {
        const lfo = 0.5 + 0.5 * Math.sin(TAU * (o.rate * (i / sr) + ph0));
        const dly = ((o.base + o.depth * lfo) * sr) / 1000;
        let rp = w - dly; while (rp < 0) rp += size;
        const i0 = rp | 0, fr = rp - i0, a = buf[i0 % size], b = buf[(i0 + 1) % size];
        const wet = a + (b - a) * fr;
        buf[w] = x[i] + wet * (o.fb || 0);
        w = (w + 1) % size;
        y[i] = o.dryOnly ? wet : x[i] * (1 - o.mix * 0.5) + wet * o.mix;
      }
      return y;
    });
  }
  function phaser(chs, sr, rate, depth, fb, mix, stages) {
    return chs.map((x, ci) => {
      const L = x.length, y = new Float32Array(L), z1 = new Float64Array(stages), fmin = 200, fmax = 200 + 3000 * depth;
      let last = 0;
      for (let i = 0; i < L; i++) {
        const lfo = 0.5 + 0.5 * Math.sin(TAU * (rate * (i / sr) + ci * 0.25));
        const f = fmin * Math.pow(fmax / fmin, lfo), tn = Math.tan((Math.PI * f) / sr), a = (tn - 1) / (tn + 1);
        let s = x[i] + last * fb;
        for (let k = 0; k < stages; k++) { const o = a * s + z1[k]; z1[k] = s - a * o; s = o; }
        last = s;
        y[i] = x[i] * (1 - mix * 0.5) + s * mix * 0.5;
      }
      return y;
    });
  }
  function tremolo(chs, sr, rate, depth) {
    return chs.map((x) => { const y = new Float32Array(x.length); for (let i = 0; i < y.length; i++) y[i] = x[i] * (1 - depth * (0.5 - 0.5 * Math.cos(TAU * rate * (i / sr)))); return y; });
  }
  function distortion(chs, drive, mix, outDb) {
    const k = Math.tanh(drive), og = fromDb(outDb);
    return chs.map((x) => { const y = new Float32Array(x.length); for (let i = 0; i < y.length; i++) y[i] = (x[i] * (1 - mix) + (Math.tanh(x[i] * drive) / k) * mix) * og; return y; });
  }
  function bitcrush(chs, bits, factor) {
    const q = Math.pow(2, bits - 1);
    return chs.map((x) => { const y = new Float32Array(x.length); let hold = 0; for (let i = 0; i < y.length; i++) { if (i % factor === 0) hold = Math.round(x[i] * q) / q; y[i] = hold; } return y; });
  }
  function reverb(chs, sr, room, damp, wet, dry, width) {
    const sc = sr / 44100, combT = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617], apT = [556, 441, 341, 225];
    const nch = chs.length, L = chs[0].length, fbk = 0.7 + 0.28 * room, mono = mixMono(chs);
    const rev = [];
    for (let c = 0; c < Math.min(nch, 2); c++) {
      const spread = c * 23, y = new Float32Array(L);
      const combs = combT.map((t) => ({ b: new Float32Array(Math.round((t + spread) * sc)), i: 0, f: 0 }));
      const aps = apT.map((t) => ({ b: new Float32Array(Math.round((t + spread) * sc)), i: 0 }));
      for (let n = 0; n < L; n++) {
        const inp = (nch > 1 ? chs[c][n] * 0.5 + mono[n] * 0.5 : mono[n]) * 0.015;
        let s = 0;
        for (const cb of combs) { const o = cb.b[cb.i]; cb.f = o * (1 - damp) + cb.f * damp; cb.b[cb.i] = inp + cb.f * fbk; if (++cb.i >= cb.b.length) cb.i = 0; s += o; }
        for (const ap of aps) { const bo = ap.b[ap.i], o = -s + bo; ap.b[ap.i] = s + bo * 0.5; if (++ap.i >= ap.b.length) ap.i = 0; s = o; }
        y[n] = s;
      }
      rev.push(y);
    }
    const w = wet * 3, w1 = w * (width / 2 + 0.5), w2 = (w * (1 - width)) / 2;
    return chs.map((x, c) => {
      const y = new Float32Array(L), r1 = rev[Math.min(c, rev.length - 1)], r2 = rev[rev.length === 2 ? 1 - c : 0];
      for (let n = 0; n < L; n++) y[n] = x[n] * dry + r1[n] * w1 + (rev.length === 2 ? r2[n] * w2 : 0);
      return y;
    });
  }

  /* ---------- EQ ---------- */
  function eqBands(chs, sr, bands) {
    return chs.map((c) => {
      let y = c;
      for (const b of bands) {
        if (b.type === 'peaking' || b.type === 'lowshelf' || b.type === 'highshelf') { if (Math.abs(b.gain) < 0.01) continue; }
        y = applyBiquad(y, biquadCoefs(b.type, sr, b.f, b.q, b.gain));
      }
      return y === c ? c.slice() : y;
    });
  }

  /* ---------- stereo ---------- */
  function stereoWidth(chs, w) {
    if (chs.length < 2) return cloneCh(chs);
    const L = chs[0].length, a = new Float32Array(L), b = new Float32Array(L);
    for (let i = 0; i < L; i++) { const m = (chs[0][i] + chs[1][i]) / 2, s = ((chs[0][i] - chs[1][i]) / 2) * w; a[i] = m + s; b[i] = m - s; }
    return [a, b, ...chs.slice(2).map((c) => c.slice())];
  }
  function balance(chs, pan) {
    if (chs.length < 2) return cloneCh(chs);
    const gl = pan > 0 ? 1 - pan : 1, gr = pan < 0 ? 1 + pan : 1;
    return [chs[0].map((v) => v * gl), chs[1].map((v) => v * gr), ...chs.slice(2).map((c) => c.slice())];
  }
  function centerRemove(chs) {
    if (chs.length < 2) return cloneCh(chs);
    const L = chs[0].length, o = new Float32Array(L);
    for (let i = 0; i < L; i++) o[i] = (chs[0][i] - chs[1][i]) / 2;
    return [o, o.slice()];
  }

  /* ---------- restoration ---------- */
  function noiseProfile(chs, N) {
    N = N || 2048;
    const x = mixMono(chs), win = hann(N), half = N / 2 + 1, acc = new Float64Array(half), re = new Float64Array(N), im = new Float64Array(N);
    let frames = 0;
    for (let s = 0; s + N <= x.length; s += N / 4) {
      for (let i = 0; i < N; i++) { re[i] = x[s + i] * win[i]; im[i] = 0; }
      fft(re, im, false);
      for (let k = 0; k < half; k++) acc[k] += Math.hypot(re[k], im[k]);
      frames++;
    }
    if (!frames) return null;
    const mag = new Float32Array(half);
    for (let k = 0; k < half; k++) mag[k] = acc[k] / frames;
    return { N, mag };
  }
  function noiseReduce(chs, prof, reductionDb, alpha, smooth) {
    const N = prof.N, hop = N / 4, win = hann(N), half = N / 2 + 1, floor = fromDb(-reductionDb), L = chs[0].length;
    const re = new Float64Array(N), im = new Float64Array(N);
    return chs.map((x) => {
      const out = new Float32Array(L + N * 2), prevG = new Float32Array(half).fill(1);
      for (let s = -N; s < L; s += hop) {
        for (let i = 0; i < N; i++) { const j = s + i; re[i] = (j >= 0 && j < L ? x[j] : 0) * win[i]; im[i] = 0; }
        fft(re, im, false);
        for (let k = 0; k < half; k++) {
          const m = Math.hypot(re[k], im[k]) + 1e-12;
          let g = Math.max(floor, 1 - (alpha * prof.mag[k]) / m);
          g = g > prevG[k] ? g : prevG[k] * smooth + g * (1 - smooth);
          prevG[k] = g;
          re[k] *= g; im[k] *= g;
          if (k > 0 && k < N / 2) { re[N - k] *= g; im[N - k] *= g; }
        }
        fft(re, im, true);
        for (let i = 0; i < N; i++) out[s + i + N] += re[i] * win[i] / 1.5;
      }
      return out.slice(N, N + L);
    });
  }
  /* clicks in one channel: [{s, e, score}] — the samples strictly between s and e are replaced by the repair.
     A click = the second difference far above its local average (sensitivity × mean over 512 samples). */
  function detectClicksCh(x, sensitivity, maxLen) {
    const L = x.length, d = new Float32Array(L), out = [];
    for (let i = 1; i < L - 1; i++) d[i] = Math.abs(x[i] - (x[i - 1] + x[i + 1]) / 2);
    const W = 512, P = new Float64Array(L + 1); for (let i = 0; i < L; i++) P[i + 1] = P[i] + d[i];
    // reference level: the mean over the W samples ending W/2 before i (so the click itself is not in it); near the
    // start, where that window does not exist yet, the W samples starting W/2 after i (before, the first samples of every
    // file were compared with an almost empty window and taken for clicks)
    const ref = (i) => { let a = i - W / 2 - W + 1, b = i - W / 2 + 1; if (a < 0) { a = Math.min(L, i + W / 2); b = Math.min(L, a + W); if (b - a < W / 4) { a = Math.max(0, L - W); b = L; } } return (P[b] - P[a]) / Math.max(1, b - a) + 1e-6; };
    let i = 2;
    while (i < L - 2) {
      const m = ref(i);
      if (d[i] > sensitivity * m) {
        let s = i - 1, e = i + 1;
        while (e < L - 2 && e - s < maxLen && d[e + 1] > sensitivity * 0.5 * ref(e)) e++;
        s = Math.max(0, s - 1); e = Math.min(L - 1, e + 1);
        out.push({ s, e, score: d[i] / m });
        i = e + 1;
      } else i++;
    }
    return out;
  }
  /* straight line between the samples around the click (in place) */
  function repairClick(y, s, e) { const a = y[s], b = y[e]; for (let k = s + 1; k < e; k++) y[k] = a + ((b - a) * (k - s)) / (e - s); }
  function clickRemove(chs, sensitivity, maxLen) {
    return chs.map((x) => { const y = x.slice(); for (const c of detectClicksCh(x, sensitivity, maxLen)) repairClick(y, c.s, c.e); return y; });
  }
  /* all channels: [{s, e, ch, score}] in time order */
  function detectClicks(chs, sensitivity, maxLen) {
    const out = []; chs.forEach((x, ch) => { for (const c of detectClicksCh(x, sensitivity, maxLen)) out.push({ ...c, ch }); });
    return out.sort((p, q) => p.s - q.s || p.ch - q.ch);
  }
  function deHum(chs, sr, base, harmonics, q) {
    return chs.map((c) => {
      let y = c;
      for (let h = 1; h <= harmonics; h++) { const f = base * h; if (f >= sr * 0.45) break; y = applyBiquad(y, biquadCoefs('notch', sr, f, q)); }
      return y === c ? c.slice() : y;
    });
  }
  function deEss(chs, sr, f, thr, ratio) {
    return chs.map((c) => {
      const bp = applyBiquad(c, biquadCoefs('bandpass', sr, f, 1.2)), L = c.length, y = new Float32Array(L);
      let env = 0; const a = coef(1, sr), r = coef(40, sr);
      for (let i = 0; i < L; i++) {
        const d = Math.abs(bp[i]); env = d > env ? a * env + (1 - a) * d : r * env + (1 - r) * d;
        const over = toDb(env) - thr, gr = over > 0 ? (1 / ratio - 1) * over : 0;
        y[i] = c[i] - bp[i] * (1 - fromDb(gr));
      }
      return y;
    });
  }

  /* Adaptive noise reduction: tracks a per-bin noise floor with minimum statistics. */
  /* Noise-floor tracker (minimum statistics): per bin, the minimum of the smoothed spectrum over the last few
     0.25 s sub-windows. Digital-silence frames are ignored so a quiet start can never pin the floor at zero. */
  function floorTracker(half, windows) {
    const hist = Array.from({ length: windows }, () => new Float64Array(half).fill(Infinity)), sub = new Float64Array(half).fill(Infinity); let h = 0, n = 0;
    const tr = {
      live: 0, // frames since the signal started (the window needs ~4 hops to be fully covered)
      begin(energy) { this.live = energy > 1e-9 ? this.live + 1 : 0; },
      floor(k, v) { if (this.live >= 5 && v > 1e-9 && v < sub[k]) sub[k] = v; let m = sub[k]; for (let j = 0; j < windows; j++) if (hist[j][k] < m) m = hist[j][k]; return m === Infinity ? v : m; },
      frame() { if (++n % 21 === 0) { hist[h].set(sub); h = (h + 1) % windows; sub.fill(Infinity); } },
    };
    return tr;
  }
  function adaptiveNR(chs, reductionDb, alpha, smooth, trackSpeed) {
    const N = 2048, hop = N / 4, win = hann(N), half = N / 2 + 1, floor = fromDb(-reductionDb), L = chs[0].length;
    const re = new Float64Array(N), im = new Float64Array(N), windows = Math.max(2, Math.round(8 - trackSpeed * 6));
    return chs.map((x) => {
      const out = new Float32Array(L + N * 2), prevG = new Float32Array(half).fill(1), sp = new Float64Array(half), tr = floorTracker(half, windows);
      for (let s = -N; s < L; s += hop) {
        for (let i = 0; i < N; i++) { const j = s + i; re[i] = (j >= 0 && j < L ? x[j] : 0) * win[i]; im[i] = 0; }
        fft(re, im, false);
        let en = 0; for (let k = 0; k < half; k++) en += re[k] * re[k] + im[k] * im[k]; tr.begin(en);
        for (let k = 0; k < half; k++) {
          const m = Math.hypot(re[k], im[k]) + 1e-12;
          sp[k] = tr.live <= 1 || !sp[k] ? m : sp[k] * 0.8 + m * 0.2;
          const nf = tr.floor(k, sp[k]); let g = Math.max(floor, 1 - (alpha * nf * 1.5) / m);
          g = g > prevG[k] ? g : prevG[k] * smooth + g * (1 - smooth);
          prevG[k] = g; re[k] *= g; im[k] *= g;
          if (k > 0 && k < N / 2) { re[N - k] *= g; im[N - k] *= g; }
        }
        tr.frame();
        fft(re, im, true);
        for (let i = 0; i < N; i++) out[s + i + N] += (re[i] * win[i]) / 1.5;
      }
      return out.slice(N, N + L);
    });
  }
  /* Speech volume leveler: slow gain riding toward a target RMS, never boosting below the noise floor. */
  function speechLeveler(chs, sr, targetDb, maxBoost, maxCut, floorDb) {
    const L = chs[0].length, win = Math.max(1, Math.round(0.05 * sr)), nBlk = Math.ceil(L / win), gains = new Float32Array(nBlk);
    let g = 1;
    const aA = Math.exp(-1 / (0.15 * 20)), aR = Math.exp(-1 / (0.6 * 20));
    for (let b = 0; b < nBlk; b++) {
      let sq = 0, n = 0;
      for (const c of chs) for (let i = b * win; i < Math.min(L, (b + 1) * win); i++) { sq += c[i] * c[i]; n++; }
      const lvl = toDb(Math.sqrt(sq / Math.max(1, n)));
      let tg = g;
      if (lvl > floorDb) tg = fromDb(clamp(targetDb - lvl, -maxCut, maxBoost));
      g = tg < g ? aA * g + (1 - aA) * tg : aR * g + (1 - aR) * tg;
      gains[b] = g;
    }
    return chs.map((c) => {
      const y = new Float32Array(L);
      for (let i = 0; i < L; i++) {
        const p = i / win - 0.5, b0 = Math.max(0, Math.floor(p)), b1 = Math.min(nBlk - 1, b0 + 1), t = clamp(p - b0, 0, 1);
        y[i] = c[i] * (gains[b0] + (gains[b1] - gains[b0]) * t);
      }
      return y;
    });
  }
  /* ---------- spectral selections ----------
     A spectral selection ("shape") is plain data, so it can travel to the worker and into undo snapshots:
       {kind:'rect', a, b, f0, f1}                 time (samples) × frequency (Hz) box — the Marquee
       {kind:'lasso', pts:[[s, f], …]}             closed polygon in (sample, log-frequency) space
       {kind:'brush', pts:[[s, f], …], rs, ro}     painted stroke: an ellipse rs samples wide and ro octaves tall around
                                                   every point (soft edge)
       {kind:'harm', track:[[s, f0], …], n, bw}    harmonics 1..n of a pitch track, each ±bw semitones
     A marquee without `kind` (older documents) is a rect. */
  const LOG2 = Math.log(2);
  function shapeBounds(sh) {
    if (!sh.kind || sh.kind === 'rect') return { a: sh.a, b: sh.b, f0: sh.f0, f1: sh.f1 };
    if (sh.kind === 'harm') {
      let a = Infinity, b = -Infinity, lo = Infinity, hi = 0; const k = Math.pow(2, sh.bw / 12);
      for (const [s, f] of sh.track) { if (!(f > 0)) continue; a = Math.min(a, s); b = Math.max(b, s); lo = Math.min(lo, f / k); hi = Math.max(hi, f * sh.n * k); }
      const pad = sh.hop || 0;
      return a <= b ? { a: Math.max(0, a - pad), b: b + pad, f0: lo, f1: hi } : { a: 0, b: 0, f0: 1, f1: 1 };
    }
    let a = Infinity, b = -Infinity, lo = Infinity, hi = 0, rs = 0, ro = 0;
    if (sh.kind === 'brush') { rs = sh.rs; ro = sh.ro; }
    for (const [s, f] of sh.pts) { a = Math.min(a, s - rs); b = Math.max(b, s + rs); lo = Math.min(lo, f * Math.pow(2, -ro)); hi = Math.max(hi, f * Math.pow(2, ro)); }
    return { a: Math.max(0, a), b, f0: Math.max(1, lo), f1: hi };
  }
  /* weight 0..1 of the time/frequency point (sample s, frequency f) in the shape. minHz: harmonic bands are at least
     this wide on each side (the STFT's main lobe — a narrow band at a low harmonic would leave most of it behind) */
  function shapeMask(sh, minHz) {
    if (!sh.kind || sh.kind === 'rect') return (s, f) => (s >= sh.a && s <= sh.b && f >= sh.f0 && f <= sh.f1 ? 1 : 0);
    if (sh.kind === 'lasso') {
      const P = sh.pts.map(([s, f]) => [s, Math.log(Math.max(1, f)) / LOG2]);
      return (s, f) => { // even-odd rule
        const y = Math.log(Math.max(1, f)) / LOG2; let inside = false;
        for (let i = 0, j = P.length - 1; i < P.length; j = i++) {
          const [xi, yi] = P[i], [xj, yj] = P[j];
          if ((yi > y) !== (yj > y) && s < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
        }
        return inside ? 1 : 0;
      };
    }
    if (sh.kind === 'brush') {
      const P = sh.pts.map(([s, f]) => [s, Math.log(Math.max(1, f)) / LOG2]).sort((p, q) => p[0] - q[0]), xs = P.map((p) => p[0]);
      const lower = (v) => { let lo = 0, hi = xs.length; while (lo < hi) { const m = (lo + hi) >> 1; if (xs[m] < v) lo = m + 1; else hi = m; } return lo; };
      return (s, f) => {
        const y = Math.log(Math.max(1, f)) / LOG2; let best = Infinity;
        for (let i = lower(s - sh.rs); i < P.length && P[i][0] <= s + sh.rs; i++) { const dx = (P[i][0] - s) / sh.rs, dy = (P[i][1] - y) / sh.ro, d = dx * dx + dy * dy; if (d < best) best = d; }
        return best >= 1 ? 0 : clamp((1 - Math.sqrt(best)) / 0.3, 0, 1); // flat inside, soft outer 30 %
      };
    }
    if (sh.kind === 'harm') {
      const T = sh.track.filter((p) => p[1] > 0), bw = sh.bw, hop = sh.hop || 1;
      const f0At = (s) => { // linear interpolation along the track; 0 outside it (or across unvoiced gaps)
        if (!T.length || s < T[0][0] - hop || s > T[T.length - 1][0] + hop) return 0;
        let lo = 0, hi = T.length - 1; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (T[m][0] <= s) lo = m; else hi = m; }
        const A = T[lo], B = T[hi]; if (s <= A[0]) return A[1]; if (s >= B[0]) return B[1];
        if (B[0] - A[0] > hop * 3) return 0;
        return A[1] + (B[1] - A[1]) * ((s - A[0]) / (B[0] - A[0]));
      };
      const rel = Math.pow(2, bw / 12) - 1, mh = minHz || 0;
      return (s, f) => {
        const f0 = f0At(s); if (!f0) return 0;
        const h = Math.round(f / f0); if (h < 1 || h > sh.n) return 0;
        // ±bw semitones, but never wider than a quarter of the harmonic spacing (high harmonics would merge)
        const half = Math.max(Math.min(h * f0 * rel, f0 * 0.25), mh), d = Math.abs(f - h * f0);
        return d >= half ? 0 : clamp((half - d) / (half * 0.4), 0, 1);
      };
    }
    return () => 0;
  }
  /* the shape moved in time by ds samples (selections are stored in file samples, edits run on a slice) */
  function shapeShift(sh, ds) {
    if (!sh.kind || sh.kind === 'rect') return { ...sh, kind: 'rect', a: sh.a + ds, b: sh.b + ds };
    if (sh.kind === 'harm') return { ...sh, track: sh.track.map(([s, f]) => [s + ds, f]) };
    return { ...sh, pts: sh.pts.map(([s, f]) => [s + ds, f]) };
  }

  /* Spectral editing on a slice. o = {t0,t1 (sample idx in slice), f0,f1 (Hz), mode:'atten'|'heal', gainDb}
     or o.shape (a spectral selection in slice samples, see above) instead of the box */
  function spectralEdit(chs, sr, o) {
    if (o.shape && o.shape.kind && o.shape.kind !== 'rect') return spectralEditShape(chs, sr, o);
    if (o.shape) o = { ...o, t0: o.shape.a, t1: o.shape.b, f0: o.shape.f0, f1: o.shape.f1 };
    const N = 2048, hop = N / 4, win = hann(N), half = N / 2 + 1, L = chs[0].length, g = fromDb(o.gainDb === undefined ? -200 : o.gainDb);
    const k0 = Math.max(0, Math.floor((o.f0 * N) / sr)), k1 = Math.min(half - 1, Math.ceil((o.f1 * N) / sr));
    const nF = Math.ceil((L + N) / hop) + 1, edge = 2;
    return chs.map((x) => {
      const frames = [], out = new Float32Array(L + N * 2);
      const re = new Float64Array(N), im = new Float64Array(N);
      for (let f = 0, s = -N; f < nF; f++, s += hop) {
        for (let i = 0; i < N; i++) { const j = s + i; re[i] = (j >= 0 && j < L ? x[j] : 0) * win[i]; im[i] = 0; }
        fft(re, im, false);
        frames.push({ s, re: Float64Array.from(re), im: Float64Array.from(im) });
      }
      const center = (fr) => fr.s + N / 2, inT = (fr) => center(fr) >= o.t0 && center(fr) <= o.t1;
      let refA = null, refB = null;
      if (o.mode === 'heal') {
        const idxIn = frames.map((fr, i) => (inT(fr) ? i : -1)).filter((i) => i >= 0);
        if (idxIn.length) {
          const a = Math.max(0, idxIn[0] - 3), b = Math.min(frames.length - 1, idxIn[idxIn.length - 1] + 3);
          const avg = (from, to) => { const m = new Float64Array(half); let c = 0; for (let i = Math.max(0, from); i <= Math.min(frames.length - 1, to); i++) { for (let k = 0; k < half; k++) m[k] += Math.hypot(frames[i].re[k], frames[i].im[k]); c++; } for (let k = 0; k < half; k++) m[k] /= c || 1; return m; };
          refA = avg(a - 2, a); refB = avg(b, b + 2);
        }
      }
      const first = frames.findIndex(inT), last = frames.length - 1 - [...frames].reverse().findIndex(inT);
      for (let fi = 0; fi < frames.length; fi++) {
        const fr = frames[fi];
        if (inT(fr)) {
          const u = last > first ? (fi - first) / (last - first) : 0.5;
          for (let k = k0; k <= k1; k++) {
            const fe = Math.min(1, (k - k0 + 1) / (edge + 1), (k1 - k + 1) / (edge + 1));
            let gain;
            if (o.mode === 'heal' && refA) {
              const target = refA[k] * (1 - u) + refB[k] * u, m = Math.hypot(fr.re[k], fr.im[k]) + 1e-12;
              gain = 1 - fe + fe * Math.min(1, target / m);
            } else gain = 1 - fe * (1 - g);
            fr.re[k] *= gain; fr.im[k] *= gain;
            if (k > 0 && k < N / 2) { fr.re[N - k] *= gain; fr.im[N - k] *= gain; }
          }
        }
        fft(fr.re, fr.im, true);
        for (let i = 0; i < N; i++) out[fr.s + i + N] += (fr.re[i] * win[i]) / 1.5;
      }
      return out.slice(N, N + L);
    });
  }
  /* the same for lasso / brush / harmonic selections: each STFT bin is weighted by the shape's mask at the frame
     centre. Heal fills the masked bins with the spectrum interpolated between just before and just after the shape. */
  function spectralEditShape(chs, sr, o) {
    const N = 2048, hop = N / 4, win = hann(N), half = N / 2 + 1, L = chs[0].length, g = fromDb(o.gainDb === undefined ? -200 : o.gainDb);
    const sh = o.shape, bd = shapeBounds(sh), mask = shapeMask(sh, (2.5 * sr) / N);
    const k0 = Math.max(1, Math.floor((bd.f0 * N) / sr)), k1 = Math.min(half - 1, Math.ceil((bd.f1 * N) / sr));
    const nF = Math.ceil((L + N) / hop) + 1, w = new Float32Array(half);
    return chs.map((x) => {
      const frames = [], out = new Float32Array(L + N * 2), re = new Float64Array(N), im = new Float64Array(N);
      for (let f = 0, s = -N; f < nF; f++, s += hop) {
        for (let i = 0; i < N; i++) { const j = s + i; re[i] = (j >= 0 && j < L ? x[j] : 0) * win[i]; im[i] = 0; }
        fft(re, im, false); frames.push({ s, re: Float64Array.from(re), im: Float64Array.from(im) });
      }
      const center = (fr) => fr.s + N / 2, inT = (fr) => center(fr) >= bd.a - hop && center(fr) <= bd.b + hop;
      const idx = frames.map((fr, i) => (inT(fr) ? i : -1)).filter((i) => i >= 0);
      let refA = null, refB = null;
      if (o.mode === 'heal' && idx.length) {
        const avg = (from, to) => { const m = new Float64Array(half); let c = 0; for (let i = Math.max(0, from); i <= Math.min(frames.length - 1, to); i++) { for (let k = 0; k < half; k++) m[k] += Math.hypot(frames[i].re[k], frames[i].im[k]); c++; } for (let k = 0; k < half; k++) m[k] /= c || 1; return m; };
        const a = idx[0], b = idx[idx.length - 1]; refA = avg(a - 5, a - 3); refB = avg(b + 3, b + 5);
      }
      for (const fi of idx) {
        const fr = frames[fi], c = center(fr), u = idx.length > 1 ? (fi - idx[0]) / (idx[idx.length - 1] - idx[0]) : 0.5;
        let any = false; for (let k = k0; k <= k1; k++) { w[k] = mask(c, (k * sr) / N); if (w[k]) any = true; }
        if (!any) continue;
        for (let k = k0; k <= k1; k++) {
          const wk = w[k]; if (!wk) continue;
          let gain;
          if (o.mode === 'heal' && refA) { const target = refA[k] * (1 - u) + refB[k] * u, m = Math.hypot(fr.re[k], fr.im[k]) + 1e-12; gain = 1 - wk + wk * Math.min(1, target / m); }
          else gain = 1 - wk * (1 - g);
          fr.re[k] *= gain; fr.im[k] *= gain; if (k < N / 2) { fr.re[N - k] *= gain; fr.im[N - k] *= gain; }
        }
      }
      for (const fr of frames) { fft(fr.re, fr.im, true); for (let i = 0; i < N; i++) out[fr.s + i + N] += (fr.re[i] * win[i]) / 1.5; }
      return out.slice(N, N + L);
    });
  }

  /* ---------- zero crossings ----------
     Nearest zero crossing to sample index i of the summed channels: an index k where the signal changes sign between
     k−1 and k (or is exactly 0 at k) — a selection edge there makes a cut without a click.
     dir −1: at or left of i · +1: at or right of i · 0: nearest. Searches maxDist samples; returns i if none. */
  function zeroCross(chs, i, dir, maxDist) {
    const L = chs[0].length; i = clamp(Math.round(i), 0, L); if (i <= 0 || i >= L) return i;
    const v = (k) => { let s = 0; for (const c of chs) s += c[k]; return s; };
    const isZ = (k) => k > 0 && k < L && (v(k) === 0 || (v(k - 1) < 0) !== (v(k) < 0));
    const m = maxDist == null ? L : maxDist;
    for (let d = 0; d <= m; d++) { if (dir <= 0 && isZ(i - d)) return i - d; if (dir >= 0 && isZ(i + d)) return i + d; }
    return i;
  }

  /* ---------- 5.1 surround panning ----------
     Channel order (WAV / SMPTE): 0 L, 1 R, 2 C, 3 LFE, 4 Ls, 5 Rs. The 5 main speakers sit on a circle at the ITU-R
     BS.775 angles (0° = front centre, + = right): C 0°, R 30°, Rs 110°, Ls −110°, L −30°. A source at (x, y)
     (x −1 left … +1 right, y −1 rear … +1 front) is panned between the two speakers around its direction with
     constant power; towards the middle of the room (radius < 1) it spreads to all five equally. offDeg turns the
     direction (used to place the left / right inputs of a stereo track either side of the point). Returns 6 gains
     with Σg² = 1 (LFE = 0; the LFE send is separate). */
  const SUR_ANG = [[2, 0], [1, 30], [5, 110], [4, 250], [0, 330]]; // [channel, degrees clockwise from front]
  function surroundGains(x, y, offDeg) {
    const g = [0, 0, 0, 0, 0, 0], r = Math.min(1, Math.hypot(x, y));
    let th = r > 1e-9 ? (Math.atan2(x, y) * 180) / Math.PI : 0; th = ((th + (offDeg || 0)) % 360 + 360) % 360;
    for (let k = 0; k < SUR_ANG.length; k++) {
      const [c1, a1] = SUR_ANG[k], [c2, a2r] = SUR_ANG[(k + 1) % SUR_ANG.length], a2 = a2r <= a1 ? a2r + 360 : a2r, t = th < a1 ? th + 360 : th;
      if (t >= a1 && t <= a2) { const u = (t - a1) / (a2 - a1); g[c1] += Math.cos((u * Math.PI) / 2); g[c2] += Math.sin((u * Math.PI) / 2); break; }
    }
    const d = 1 / Math.sqrt(5); let p = 0;
    for (const [c] of SUR_ANG) { g[c] = r * g[c] + (1 - r) * d; p += g[c] * g[c]; }
    const n = Math.sqrt(p) || 1; return g.map((v) => v / n);
  }

  /* ---------- windows (spectral display) ---------- */
  const WINDOWS = { hann: 'Hann', hamming: 'Hamming', blackman: 'Blackman', blackmanHarris: 'Blackman-Harris', rect: 'Rectangular' };
  function windowFn(name, n) {
    const key = (name || 'hann') + n; if (winCache[key]) return winCache[key];
    const w = new Float64Array(n), c = (k) => Math.cos((TAU * k) / n);
    for (let i = 0; i < n; i++) {
      w[i] = name === 'hamming' ? 0.54 - 0.46 * c(i) : name === 'blackman' ? 0.42 - 0.5 * c(i) + 0.08 * Math.cos((2 * TAU * i) / n)
        : name === 'blackmanHarris' ? 0.35875 - 0.48829 * c(i) + 0.14128 * Math.cos((2 * TAU * i) / n) - 0.01168 * Math.cos((3 * TAU * i) / n)
          : name === 'rect' ? 1 : 0.5 - 0.5 * c(i);
    }
    return (winCache[key] = w);
  }

  /* ---------- pitch (YIN) ----------
     de Cheveigné & Kawahara 2002: difference function (via FFT autocorrelation), cumulative-mean normalisation,
     absolute threshold, parabolic interpolation. Frames centred on `centers` (sample positions) of mono x.
     Returns {f: Hz or 0 (unvoiced), conf: 1 − d'(τ)} per frame. */
  function yin(x, sr, centers, o) {
    const oo = o || {}, fmin = oo.fmin || 60, fmax = Math.min(oo.fmax || 1600, sr / 4), thr = oo.thr || 0.15, floor = fromDb(oo.floorDb || -55);
    const tMax = Math.ceil(sr / fmin), tMin = Math.max(2, Math.floor(sr / fmax)), W = tMax * 2;
    let N = 1; while (N < W * 2) N <<= 1;
    const re = new Float64Array(N), im = new Float64Array(N), d = new Float64Array(tMax + 1), pre = new Float64Array(W + 1), frm = new Float64Array(W), hw = hann(W), L = x.length;
    const f = new Float32Array(centers.length), conf = new Float32Array(centers.length);
    centers.forEach((cs, n) => {
      const s0 = Math.round(cs - W / 2);
      let en = 0;
      for (let i = 0; i < N; i++) { const j = s0 + i, v = i < W && j >= 0 && j < L ? x[j] : 0; re[i] = v; im[i] = 0; en += v * v; }
      if (Math.sqrt(en / W) < floor) return;
      for (let i = 0; i < W; i++) { pre[i + 1] = pre[i] + re[i] * re[i]; frm[i] = re[i] * hw[i]; }
      fft(re, im, false); for (let k = 0; k < N; k++) { re[k] = re[k] * re[k] + im[k] * im[k]; im[k] = 0; } fft(re, im, true); // autocorrelation
      let run = 0; d[0] = 1;
      // (the overlap shrinks with the lag: scale back to the full window so long lags are not favoured)
      for (let t = 1; t <= tMax; t++) { const dt = ((pre[W - t] + (pre[W] - pre[t]) - 2 * re[t]) * W) / (W - t); run += dt; d[t] = run > 0 ? (dt * t) / run : 1; }
      let tau = -1;
      // first dip under the threshold; its lowest point (a high partial ripples the dip — its first local minimum can be
      // a few samples off the period)
      for (let t = tMin; t <= tMax; t++) if (d[t] < thr) { tau = t; while (t + 1 <= tMax && (d[t + 1] < thr || d[t + 1] < d[t])) { t++; if (d[t] < d[tau]) tau = t; } break; }
      if (tau < 0) return;
      const a = d[tau - 1], b = d[tau], c = tau + 1 <= tMax ? d[tau + 1] : b, den = a - 2 * b + c, sh = den > 0 ? clamp((0.5 * (a - c)) / den, -0.5, 0.5) : 0;
      f[n] = refine(sr / (tau + sh)); conf[n] = clamp(1 - b, 0, 1);
    });
    /* harmonic-comb refinement: the f (±3 %) whose harmonics carry the most energy. A steady sound that is not a
       harmonic of the note (another instrument) shifts YIN's dip a little; the comb does not care. */
    function refine(f0) {
      // power of frequency fr in the Hann-windowed frame (direct DTFT: exact frequencies, no bin quantisation)
      const P = (fr) => { const w = (TAU * fr) / sr; let c = 0, s = 0, cr = 1, ci = 0; const dr = Math.cos(w), di = -Math.sin(w); for (let j = 0; j < W; j++) { const v = frm[j]; c += v * cr; s += v * ci; const t = cr * dr - ci * di; ci = cr * di + ci * dr; cr = t; } return c * c + s * s; };
      const H = Math.max(1, Math.min(10, Math.floor(sr / 2 / (f0 * 1.03))));
      // only the harmonics that are really there (≥ −20 dB of the strongest)
      const lv = []; for (let h = 1; h <= H; h++) lv.push(Math.max(P(h * f0 * 0.985), P(h * f0), P(h * f0 * 1.015)));
      const top = Math.max(...lv), hs = []; lv.forEach((m, i) => { if (m > top * 0.01) hs.push(i + 1); });
      const comb = (fr) => { let s = 0; for (const h of hs) s += P(h * fr); return s; };
      let best = f0, bs = comb(f0);
      for (const step of [0.005, 0.0006]) { const c0 = best; for (let r = -6; r <= 6; r++) { if (!r) continue; const fr = c0 * (1 + r * step), v = comb(fr); if (v > bs) { bs = v; best = fr; } } }
      return best;
    }
    // 3-frame median removes single-frame octave slips
    const out = Float32Array.from(f);
    for (let n = 1; n < f.length - 1; n++) if (f[n - 1] && f[n] && f[n + 1]) { const m = [f[n - 1], f[n], f[n + 1]].sort((p, q) => p - q)[1]; if (Math.abs(Math.log(f[n] / m)) > 0.3) out[n] = m; }
    return { f: out, conf };
  }
  /* pitch track over [a, b) of the channels: hop in samples → [{s, f, conf}] */
  function pitchTrack(chs, sr, a, b, hop, o) {
    const x = mixMono(chs), centers = []; for (let s = a; s < b; s += hop) centers.push(s);
    const r = yin(x, sr, centers, o); return centers.map((s, i) => ({ s, f: r.f[i], conf: r.conf[i] }));
  }
  /* Auto-select harmonics: the sound under the click at (sample s, frequency f) → a 'harm' shape following its pitch
     over time (all its harmonics). The clicked partial may be any harmonic; it is matched against the YIN pitch. If the
     click is not on a pitched sound, the single partial is followed by spectral peak tracking instead (n = 1). */
  function harmonicSelect(chs, sr, s, f, o) {
    const oo = o || {}, hop = oo.hop || Math.round(sr * 0.01), span = Math.round(sr * (oo.maxSec || 8)), x = mixMono(chs), L = x.length;
    const a = Math.max(0, s - span), b = Math.min(L, s + span), centers = []; for (let c = a; c < b; c += hop) centers.push(c);
    const r = yin(x, sr, centers, { fmin: oo.fmin || 50, fmax: oo.fmax || 2000 }), at = Math.round((s - a) / hop);
    const near = (i) => { for (let k = 0; k < 4; k++) for (const j of [i - k, i + k]) if (r.f[j]) return j; return -1; };
    const i0 = near(clamp(at, 0, centers.length - 1));
    const N = 4096, win = hann(N), re = new Float64Array(N), im = new Float64Array(N);
    const spec = (c) => { for (let i = 0; i < N; i++) { const j = c - N / 2 + i; re[i] = (j >= 0 && j < L ? x[j] : 0) * win[i]; im[i] = 0; } fft(re, im, false); };
    const band = (fc, semis) => { const k0 = Math.max(1, Math.floor((fc * Math.pow(2, -semis / 12) * N) / sr)), k1 = Math.min(N / 2 - 1, Math.ceil((fc * Math.pow(2, semis / 12) * N) / sr)); let kb = k0, mb = 0; for (let k = k0; k <= k1; k++) { const m = Math.hypot(re[k], im[k]); if (m > mb) { mb = m; kb = k; } } return { k: kb, m: mb }; };
    // pitched = the click is on harmonic h of the YIN pitch AND at least one other harmonic of it is really there
    // (an inharmonic partial can happen to sit near a multiple of some detected pitch)
    const hOf = (f0) => Math.max(1, Math.round(f / f0));
    const fits = (f0) => {
      const h = hOf(f0); if (Math.abs(12 * Math.log(f / (h * f0)) / LOG2) > 0.5) return false;
      spec(s); const ref = band(f, 0.7).m * fromDb(-35); let support = 0;
      for (let k = 1; k <= 8; k++) if (k !== h && k * f0 < sr / 2 && band(k * f0, 0.25).m > ref) support++;
      return support >= 1;
    };
    if (i0 >= 0 && fits(r.f[i0])) {
      const ok = (i, prev) => r.f[i] > 0 && Math.abs(12 * Math.log(r.f[i] / prev) / LOG2) < 3;
      let lo = i0, hi = i0, miss = 0;
      for (let i = i0 - 1, prev = r.f[i0]; i >= 0; i--) { if (ok(i, prev)) { lo = i; prev = r.f[i]; miss = 0; } else if (++miss > 2) break; }
      miss = 0;
      for (let i = i0 + 1, prev = r.f[i0]; i < centers.length; i++) { if (ok(i, prev)) { hi = i; prev = r.f[i]; miss = 0; } else if (++miss > 2) break; }
      const track = []; let fmax = 0;
      for (let i = lo; i <= hi; i++) if (r.f[i]) { track.push([centers[i], r.f[i]]); fmax = Math.max(fmax, r.f[i]); }
      return { kind: 'harm', track, n: Math.max(1, Math.min(oo.maxHarm || 40, Math.floor(Math.min(sr / 2, 20000) / fmax))), bw: oo.bw || 0.6, hop, f0: r.f[i0], h: hOf(r.f[i0]) };
    }
    // not pitched there: follow the clicked partial's spectral peak while it stays within 30 dB of the click
    const peakAt = (c, fc) => {
      spec(c); const { k: kb, m: mb } = band(fc, 1);
      const y0 = Math.hypot(re[kb - 1], im[kb - 1]), y2 = Math.hypot(re[kb + 1], im[kb + 1]), den = y0 - 2 * mb + y2;
      return { f: ((kb + (den < 0 ? (0.5 * (y0 - y2)) / den : 0)) * sr) / N, m: mb };
    };
    const p0 = peakAt(s, f), lim = p0.m * fromDb(-30), track = [[s, p0.f]];
    for (const dir of [-1, 1]) for (let c = s + dir * hop, fc = p0.f; c >= 0 && c < L; c += dir * hop) { const p = peakAt(c, fc); if (p.m < lim) break; fc = p.f; if (dir < 0) track.unshift([c, fc]); else track.push([c, fc]); }
    return { kind: 'harm', track, n: 1, bw: oo.bw || 0.6, hop, f0: p0.f, h: 1 };
  }

  /* Music remix: change duration by cutting/repeating sections at points where the music sounds alike. */
  function musicRemix(chs, sr, factor, minPlaySec, fine) {
    const L = chs[0].length, hop = Math.round(0.25 * sr), n = Math.floor(L / hop), target = Math.round(L * factor);
    if (n < 32) return timeStretch(chs, sr, factor);
    const mono = mixMono(chs), N = 2048, win = hann(N), re = new Float64Array(N), im = new Float64Array(N), NB = 20;
    const edges = []; for (let b = 0; b <= NB; b++) edges.push(Math.round((N * 80 * Math.pow(8000 / 80, b / NB)) / sr));
    const feat = [];
    for (let b = 0; b < n; b++) {
      for (let i = 0; i < N; i++) { const j = b * hop + i; re[i] = (j < L ? mono[j] : 0) * win[i]; im[i] = 0; }
      fft(re, im, false);
      const f = new Float32Array(NB); let mean = 0;
      for (let k = 0; k < NB; k++) { let e = 0; const a = edges[k], z = Math.max(edges[k + 1], a + 1); for (let q = a; q < z; q++) e += re[q] * re[q] + im[q] * im[q]; f[k] = Math.log10(e / (z - a) + 1e-9); mean += f[k]; }
      mean /= NB; for (let k = 0; k < NB; k++) f[k] -= mean;
      feat.push(f);
    }
    const dist = (i, j) => { let s = 0; const a = feat[i], b = feat[j]; for (let k = 0; k < NB; k++) { const d = a[k] - b[k]; s += d * d; } return s; };
    const ctx = (i, j) => { let s = 0, c = 0; for (let k = -3; k <= 3; k++) { const a = i + k, b = j + k; if (a >= 0 && b >= 0 && a < n && b < n) { s += dist(a, b); c++; } } return s / c; };
    const intro = 6, outro = 8, minPlay = Math.max(8, Math.round((Math.min(minPlaySec, Math.max(2, (0.12 * L) / sr)) * sr) / hop));
    let r = Math.round((target - L) / hop), cursor = intro; const jumps = [];
    for (let it = 0; it < 24 && Math.abs(r) > 3; it++) {
      let best = null;
      if (r < 0) {
        for (let i = cursor + minPlay; i < n - outro - 2; i++) for (let j = i + 2; j <= Math.min(n - outro, i - r); j++) { const c = ctx(i, j) - 0.01 * (j - i); if (!best || c < best.c) best = { c, i, j }; }
        if (!best) break; jumps.push([best.i, best.j]); r += best.j - best.i; cursor = best.j;
      } else {
        for (let i = cursor + minPlay; i < n - outro; i++) for (let j = Math.max(intro, i - r); j <= i - 2; j++) { const c = ctx(i, j) - 0.01 * (i - j); if (!best || c < best.c) best = { c, i, j }; }
        if (!best) break; jumps.push([best.i, best.j]); r -= best.i - best.j; cursor = best.i;
      }
    }
    // assemble with equal-power crossfades
    const segs = []; let pos = 0;
    for (const [i, j] of jumps) { segs.push([pos * hop, i * hop]); pos = j; }
    segs.push([pos * hop, L]);
    const xf = Math.round(0.08 * sr);
    let total = 0; for (const s of segs) total += s[1] - s[0];
    const out = chs.map(() => new Float32Array(total + xf));
    let op = 0;
    segs.forEach((s, k) => {
      const len = s[1] - s[0], tail = k < segs.length - 1 ? xf : 0;
      for (let c = 0; c < chs.length; c++) {
        const src = chs[c], dst = out[c];
        for (let i = 0; i < len + tail; i++) {
          const si = s[0] + i; if (si >= L) break;
          let w = 1; if (k > 0 && i < xf) w = Math.sin((Math.PI / 2) * (i / xf)); if (i >= len) w = Math.cos((Math.PI / 2) * ((i - len) / xf));
          dst[op + i] += src[si] * w;
        }
      }
      op += len;
    });
    let res = out.map((c) => c.slice(0, total));
    if (fine && total > 0) { const f = target / total; if (f > 0.9 && f < 1.1 && Math.abs(f - 1) > 0.0005) res = timeStretch(res, sr, f); }
    return res;
  }

  /* ---------- learned sound removal (NMF source separation) ---------- */
  /* V: frame-major magnitudes [F*B]; W: bin-major [B*K]; H: frame-major [F*K]. KL-divergence multiplicative updates. */
  function nmfUpdate(V, W, H, F, B, K, fixedK, iters) {
    const numH = new Float32Array(K), numW = new Float32Array(B * K), denW = new Float32Array(K), denH = new Float32Array(K), eps = 1e-9;
    for (let it = 0; it < iters; it++) {
      numW.fill(0); denH.fill(0); denW.fill(0);
      for (let f = 0; f < F; f++) {
        const hb = f * K, vb = f * B;
        for (let k = 0; k < K; k++) denH[k] += H[hb + k];
        numH.fill(0);
        for (let b = 0; b < B; b++) {
          const wb = b * K; let wh = eps;
          for (let k = 0; k < K; k++) wh += W[wb + k] * H[hb + k];
          const r = V[vb + b] / wh;
          for (let k = 0; k < K; k++) { numH[k] += W[wb + k] * r; numW[wb + k] += H[hb + k] * r; }
        }
        // H update uses column sums of W (denW)
        if (f === 0) { for (let b = 0; b < B; b++) for (let k = 0; k < K; k++) denW[k] += W[b * K + k]; }
        for (let k = 0; k < K; k++) H[hb + k] *= numH[k] / (denW[k] + eps);
      }
      for (let b = 0; b < B; b++) for (let k = fixedK; k < K; k++) W[b * K + k] *= numW[b * K + k] / (denH[k] + eps);
    }
  }
  function stftMags(x, start, frames, N, hop, win) {
    const B = N / 2 + 1, V = new Float32Array(frames * B), re = new Float64Array(N), im = new Float64Array(N), L = x.length;
    for (let f = 0; f < frames; f++) {
      const s = start + f * hop - N;
      for (let i = 0; i < N; i++) { const j = s + i; re[i] = (j >= 0 && j < L ? x[j] : 0) * win[i]; im[i] = 0; }
      fft(re, im, false);
      for (let b = 0; b < B; b++) V[f * B + b] = Math.hypot(re[b], im[b]);
    }
    return V;
  }
  function soundRemoveNMF(chs, sr, printMono, printSr, ku, kr, iters, reductionDb) {
    const N = 2048, hop = 512, B = N / 2 + 1, win = hann(N), floor = fromDb(-reductionDb), L = chs[0].length;
    let pm = printMono; if (printSr !== sr) pm = convertRate([pm], printSr, sr)[0];
    // 1) learn a basis for the unwanted sound from the captured print
    const Fp = Math.max(4, Math.floor(pm.length / hop)), Vp = stftMags(pm, 0, Fp, N, hop, win), Wu = new Float32Array(B * ku), Hu = new Float32Array(Fp * ku);
    for (let i = 0; i < Wu.length; i++) Wu[i] = Math.random() + 0.1;
    for (let i = 0; i < Hu.length; i++) Hu[i] = Math.random() + 0.1;
    nmfUpdate(Vp, Wu, Hu, Fp, B, ku, 0, Math.max(30, iters * 2));
    for (let k = 0; k < ku; k++) { let s = 0; for (let b = 0; b < B; b++) s += Wu[b * ku + k]; for (let b = 0; b < B; b++) Wu[b * ku + k] /= s + 1e-9; }
    // 2) separate chunk by chunk: unwanted basis fixed, residual basis learned from the mix itself
    const K = ku + kr, mono = mixMono(chs), totalFrames = Math.ceil((L + N) / hop) + 1, CH = 900, out = chs.map(() => new Float32Array(L + 2 * N));
    const re = new Float64Array(N), im = new Float64Array(N);
    for (let f0 = 0; f0 < totalFrames; f0 += CH) {
      const F = Math.min(CH, totalFrames - f0), V = stftMags(mono, f0 * hop, F, N, hop, win);
      const W = new Float32Array(B * K), H = new Float32Array(F * K);
      for (let b = 0; b < B; b++) for (let k = 0; k < K; k++) W[b * K + k] = k < ku ? Wu[b * ku + k] : Math.random() + 0.1;
      for (let i = 0; i < H.length; i++) H[i] = Math.random() + 0.1;
      nmfUpdate(V, W, H, F, B, K, ku, iters);
      const mask = new Float32Array(F * B);
      for (let f = 0; f < F; f++) for (let b = 0; b < B; b++) {
        let u = 0, a = 1e-9; for (let k = 0; k < K; k++) { const v = W[b * K + k] * H[f * K + k]; a += v; if (k < ku) u += v; }
        mask[f * B + b] = floor + (1 - floor) * (1 - u / a);
      }
      chs.forEach((x, c) => {
        for (let f = 0; f < F; f++) {
          const s = (f0 + f) * hop - N;
          for (let i = 0; i < N; i++) { const j = s + i; re[i] = (j >= 0 && j < L ? x[j] : 0) * win[i]; im[i] = 0; }
          fft(re, im, false);
          for (let b = 0; b < B; b++) { const g = mask[f * B + b]; re[b] *= g; im[b] *= g; if (b > 0 && b < N / 2) { re[N - b] *= g; im[N - b] *= g; } }
          fft(re, im, true);
          for (let i = 0; i < N; i++) { const j = s + i + N; if (j >= 0 && j < out[c].length) out[c][j] += (re[i] * win[i]) / 1.5; }
        }
      });
    }
    return out.map((c) => c.slice(N, N + L));
  }

  /* ---------- heuristic sound-type classifier (for Essential Sound auto-match) ---------- */
  function classifySound(chs, sr) {
    const x = mixMono(chs), blk = Math.round(sr * 0.01), nb = Math.floor(x.length / blk);
    if (nb < 100) return { type: 'Sound effects', features: {} };
    const env = new Float64Array(nb);
    for (let b = 0; b < nb; b++) { let s = 0; for (let i = b * blk; i < (b + 1) * blk; i++) s += x[i] * x[i]; env[b] = Math.sqrt(s / blk); }
    const sorted = Array.from(env).sort((a, b) => a - b), p90 = sorted[Math.floor(nb * 0.9)] + 1e-9;
    const pauseFrac = env.filter((v) => toDb(v) < toDb(p90) - 25).length / nb, loudFrac = env.filter((v) => toDb(v) > toDb(p90) - 12).length / nb;
    // modulation spectrum of the envelope (100 Hz envelope rate)
    const M = 1024; let mod = new Float64Array(M / 2 + 1), cnt = 0; const re = new Float64Array(M), im = new Float64Array(M), w = hann(M);
    for (let s = 0; s + M <= nb; s += M / 2) {
      let mean = 0; for (let i = 0; i < M; i++) mean += env[s + i]; mean /= M;
      for (let i = 0; i < M; i++) { re[i] = (env[s + i] - mean) * w[i]; im[i] = 0; }
      fft(re, im, false); for (let k = 0; k <= M / 2; k++) mod[k] += re[k] * re[k] + im[k] * im[k]; cnt++;
    }
    const binHz = 100 / M; let band = 0, tot = 0;
    for (let k = 1; k <= M / 2; k++) { const f = k * binHz; if (f >= 0.5 && f <= 20) { tot += mod[k]; if (f >= 3 && f <= 8) band += mod[k]; } }
    const modRatio = cnt && tot > 0 ? band / tot : 0;
    // spectral flatness + centroid
    const N = 2048, win = hann(N); let flat = 0, cent = 0, fc = 0;
    const step = Math.max(1, Math.floor((x.length - N) / (N * 40)));
    for (let s = 0; s + N <= x.length; s += N * step) {
      const r = new Float64Array(N), i2 = new Float64Array(N); for (let i = 0; i < N; i++) r[i] = x[s + i] * win[i];
      fft(r, i2, false); let lg = 0, ar = 0, num = 0, den = 0, n = 0;
      for (let k = Math.round((100 * N) / sr); k < Math.round((8000 * N) / sr); k++) { const m = r[k] * r[k] + i2[k] * i2[k] + 1e-12; lg += Math.log(m); ar += m; num += m * ((k * sr) / N); den += m; n++; }
      flat += Math.exp(lg / n) / (ar / n); cent += num / den; fc++;
    }
    flat = fc ? flat / fc : 0; cent = fc ? cent / fc : 0;
    const features = { pauseFrac: +pauseFrac.toFixed(3), loudFrac: +loudFrac.toFixed(3), modRatio: +modRatio.toFixed(3), flatness: +flat.toFixed(3), centroid: Math.round(cent) };
    let type;
    if (loudFrac < 0.15 && pauseFrac > 0.6) type = 'Sound effects';
    else if (flat > 0.2 && modRatio < 0.5) type = 'Ambience';
    else if (modRatio > 0.25 && cent < 4500 && pauseFrac > 0.02) type = 'Dialogue';
    else type = 'Music';
    return { type, features };
  }

  /* ===================== v3: impulse responses, filter design, offline "process" effects ===================== */
  const mulberry = (a) => () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const gauss = (r) => Math.sqrt(-2 * Math.log(r() + 1e-12)) * Math.cos(2 * Math.PI * r());

  /* Synthetic reverb impulse response (deterministic: the live and offline renders use the same one).
     o = {decay s, pre ms, er dB, diffusion %, density %, damp %, lowcut Hz, width %, size %} -> [L, R] */
  function reverbIR(sr, o) {
    const pre = Math.round((o.pre || 0) * sr / 1000), decay = Math.max(0.05, o.decay), len = pre + Math.round(sr * (decay * 1.2 + 0.05)), out = [new Float32Array(len), new Float32Array(len)];
    const dens = 0.15 + 0.85 * (o.density === undefined ? 0.8 : o.density / 100), diff = o.diffusion === undefined ? 0.7 : o.diffusion / 100, damp = (o.damp === undefined ? 50 : o.damp) / 100;
    const build = 0.002 + (1 - diff) * 0.06, hp = o.lowcut > 0 ? Math.exp(-TAU * o.lowcut / sr) : 0;
    for (let c = 0; c < 2; c++) {
      const r = mulberry(7919 + c * 104729), d = out[c]; let lp = 0, hx = 0, hy = 0;
      for (let i = pre; i < len; i++) {
        const t = (i - pre) / sr, env = Math.exp((-6.907755 * t) / decay), rise = 1 - Math.exp(-t / build), cut = 1 - damp * (0.25 + 0.7 * Math.min(1, t / (decay * 0.8)));
        const n = r() < dens ? gauss(r) : 0; lp += (n - lp) * cut * cut;
        let v = lp * env * rise; if (hp) { const y = v - hx + hp * hy; hx = v; hy = y; v = y; }
        d[i] = v;
      }
      // early reflections: sparse taps inside the first ~90 ms, spread by room size
      const erGain = Math.pow(10, (o.er === undefined ? -8 : o.er) / 20) * 0.6, span = 0.012 + (o.size === undefined ? 50 : o.size) / 100 * 0.075;
      for (let k = 0; k < 14; k++) { const t = 0.003 + r() * span, i = pre + Math.round(t * sr); if (i < len) d[i] += (r() < 0.5 ? -1 : 1) * erGain * Math.pow(0.88, k) * (0.6 + 0.4 * r()); }
    }
    const w = (o.width === undefined ? 100 : o.width) / 100, L = out[0], R = out[1];
    for (let i = 0; i < len; i++) { const m = (L[i] + R[i]) / 2, s = ((L[i] - R[i]) / 2) * w; L[i] = m + s; R[i] = m - s; }
    return out;
  }
  /* Linear-phase FIR from a drawn magnitude curve. pts = [{f, g(dB)}] -> Float32Array(N) */
  function curveIR(sr, pts, N) {
    const p = (pts && pts.length ? pts.slice() : [{ f: 20, g: 0 }, { f: 20000, g: 0 }]).sort((a, b) => a.f - b.f), re = new Float64Array(N), im = new Float64Array(N);
    const gainAt = (f) => { if (f <= p[0].f) return p[0].g; if (f >= p[p.length - 1].f) return p[p.length - 1].g; let i = 1; while (p[i].f < f) i++; const a = p[i - 1], b = p[i], u = (Math.log(f) - Math.log(a.f)) / (Math.log(b.f) - Math.log(a.f)); return a.g + (b.g - a.g) * u; };
    for (let k = 0; k <= N / 2; k++) { const m = fromDb(gainAt(Math.max(1, (k * sr) / N))); re[k] = m; if (k > 0 && k < N / 2) re[N - k] = m; }
    fft(re, im, true);
    const h = new Float32Array(N), win = hann(N);
    for (let n = 0; n < N; n++) { const src = (n + N / 2) % N; h[n] = re[src] * (0.5 - 0.5 * Math.cos((TAU * (n + 0.5)) / N)) * 1; }
    void win; return h;
  }
  /* All-pass FIR whose phase follows a drawn curve (degrees at octave centres). L gets +phi/2, R gets -phi/2. */
  const PHASE_FREQS = [31.25, 62.5, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
  function phaseIR(sr, degs, N) {
    const phiAt = (f) => { if (f <= PHASE_FREQS[0]) return degs[0]; if (f >= PHASE_FREQS[9]) return degs[9]; let i = 1; while (PHASE_FREQS[i] < f) i++; const u = (Math.log(f) - Math.log(PHASE_FREQS[i - 1])) / Math.log(2); return degs[i - 1] + (degs[i] - degs[i - 1]) * u; };
    const res = [];
    for (const sign of [1, -1]) {
      const re = new Float64Array(N), im = new Float64Array(N);
      for (let k = 0; k <= N / 2; k++) { const ph = ((sign * phiAt(Math.max(1, (k * sr) / N))) / 2) * (Math.PI / 180); re[k] = Math.cos(ph); im[k] = k === 0 || k === N / 2 ? 0 : Math.sin(ph); if (k > 0 && k < N / 2) { re[N - k] = re[k]; im[N - k] = -im[k]; } }
      fft(re, im, true);
      const h = new Float32Array(N); for (let n = 0; n < N; n++) h[n] = re[(n + N / 2) % N] * (0.5 - 0.5 * Math.cos((TAU * (n + 0.5)) / N)); res.push(h);
    }
    return res;
  }

  /* ---- Scientific filter design: analog prototype -> bilinear transform -> biquad sections [b0,b1,b2,a1,a2] ---- */
  const cadd = (a, b) => [a[0] + b[0], a[1] + b[1]], csub = (a, b) => [a[0] - b[0], a[1] - b[1]], cmul = (a, b) => [a[0] * b[0] - a[1] * b[1], a[0] * b[1] + a[1] * b[0]];
  const cdiv = (a, b) => { const d = b[0] * b[0] + b[1] * b[1]; return [(a[0] * b[0] + a[1] * b[1]) / d, (a[1] * b[0] - a[0] * b[1]) / d]; };
  function besselPoles(n) { // roots of the reverse Bessel polynomial (Durand-Kerner), then scaled so the -3 dB point sits at 1 rad/s
    const c = [1]; let k = 1; // coefficients a_k = (2n-k)! / (2^(n-k) k! (n-k)!)
    const fact = (m) => { let r = 1; for (let i = 2; i <= m; i++) r *= i; return r; };
    const coef = []; for (let j = 0; j <= n; j++) coef.push(fact(2 * n - j) / (Math.pow(2, n - j) * fact(j) * fact(n - j))); // coef[j] multiplies s^j
    void c; void k;
    let roots = Array.from({ length: n }, (_, i) => [Math.cos((TAU * (i + 0.3)) / n) * 1.5, Math.sin((TAU * (i + 0.3)) / n) * 1.5 + 0.1 * i]);
    const lead = coef[n], poly = (s) => { let r = [0, 0]; for (let j = n; j >= 0; j--) r = cadd(cmul(r, s), [coef[j] / lead, 0]); return r; };
    for (let it = 0; it < 400; it++) { let moved = 0; roots = roots.map((r, i) => { let den = [1, 0]; roots.forEach((q, j) => { if (j !== i) den = cmul(den, csub(r, q)); }); const dlt = cdiv(poly(r), den); moved += Math.hypot(dlt[0], dlt[1]); return csub(r, dlt); }); if (moved < 1e-13) break; }
    const mag = (w) => { let num = coef[0] / lead, den = [1, 0]; void num; roots.forEach((p) => { den = cmul(den, csub([0, w], p)); }); let g = 1; roots.forEach((p) => { g *= Math.hypot(p[0], p[1]); }); return g / Math.hypot(den[0], den[1]); };
    let lo = 0.05, hi = 20; for (let i = 0; i < 80; i++) { const mid = (lo + hi) / 2; if (mag(mid) > Math.SQRT1_2) lo = mid; else hi = mid; }
    return roots.map((p) => [p[0] / lo, p[1] / lo]);
  }
  function analogPrototype(type, n, rp, rs) { // lowpass prototype, cutoff 1 rad/s -> {poles, zeros}
    const poles = [], zeros = [];
    if (type === 'butterworth') for (let k = 0; k < n; k++) { const th = (Math.PI * (2 * k + n + 1)) / (2 * n); poles.push([Math.cos(th), Math.sin(th)]); }
    else if (type === 'bessel') return { poles: besselPoles(n), zeros };
    else if (type === 'cheby1' || type === 'cheby2') {
      const stop = type === 'cheby2', eps = stop ? 1 / Math.sqrt(Math.pow(10, rs / 10) - 1) : Math.sqrt(Math.pow(10, rp / 10) - 1), v0 = Math.asinh(1 / eps) / n;
      for (let k = 0; k < n; k++) { const th = (Math.PI * (2 * k + 1)) / (2 * n), p = [-Math.sinh(v0) * Math.sin(th), Math.cosh(v0) * Math.cos(th)]; poles.push(stop ? cdiv([1, 0], p) : p); if (stop && Math.abs(Math.cos(th)) > 1e-9) zeros.push([0, 1 / Math.cos(th)]); }
    } else throw new Error('unknown filter type ' + type);
    return { poles, zeros };
  }
  /* mode: 'lowpass' | 'highpass'; band modes are built by the caller from two of these. */
  function sciFilter(sr, type, mode, order, fc, rp, rs) {
    order = Math.max(1, Math.min(20, Math.round(order))); fc = clamp(fc, 5, sr * 0.49);
    const { poles, zeros } = analogPrototype(type, order, rp || 1, rs || 40), wc = 2 * sr * Math.tan((Math.PI * fc) / sr), hp = mode === 'highpass';
    const tx = (s) => cdiv(cadd([2 * sr, 0], s), csub([2 * sr, 0], s)); // bilinear (s -> z)
    const dp = poles.map((p) => tx(hp ? cdiv([wc, 0], p) : [p[0] * wc, p[1] * wc]));
    const dz = zeros.map((z) => tx(hp ? cdiv([wc, 0], z) : [z[0] * wc, z[1] * wc])); const extra = order - dz.length, ez = hp ? [1, 0] : [-1, 0];
    // group conjugate pairs
    const up = dp.filter((p) => p[1] > 1e-9).sort((a, b) => b[1] - a[1]), real = dp.filter((p) => Math.abs(p[1]) <= 1e-9), zUp = dz.filter((z) => z[1] > 1e-9).sort((a, b) => b[1] - a[1]);
    const sections = [];
    up.forEach((p, i) => {
      let zr; if (zUp.length) { const z = zUp[Math.min(i, zUp.length - 1)]; zr = [z, [z[0], -z[1]]]; } else zr = [ez, ez];
      const a1 = -2 * p[0], a2 = p[0] * p[0] + p[1] * p[1], b1 = -(zr[0][0] + zr[1][0]), b2 = zr[0][0] * zr[1][0] - zr[0][1] * zr[1][1] * -1 * 1;
      sections.push({ b: [1, zr.length === 2 && zUp.length ? -2 * zr[0][0] : b1, zUp.length ? zr[0][0] * zr[0][0] + zr[0][1] * zr[0][1] : b2], a: [1, a1, a2] });
    });
    real.forEach((p) => sections.push({ b: [1, -ez[0], 0], a: [1, -p[0], 0] }));
    void extra;
    const ref = hp ? -1 : 1; // normalise every section to unity gain at DC (lowpass) or Nyquist (highpass)
    for (const s of sections) { const num = s.b[0] + s.b[1] * ref + s.b[2], den = 1 + s.a[1] * ref + s.a[2]; const g = den / (num || 1e-12); s.b = s.b.map((v) => v * g); }
    if (type === 'cheby1' && order % 2 === 0 && sections.length) { const g = Math.pow(10, -(rp || 1) / 20); sections[0].b = sections[0].b.map((v) => v * g); }
    return sections.map((s) => [s.b[0], s.b[1], s.b[2], s.a[1], s.a[2]]);
  }
  /* magnitude (linear) of a cascade of [b0,b1,b2,a1,a2] sections at frequency f */
  function sectionsResponse(sections, sr, f) {
    const w = (TAU * f) / sr, e1 = [Math.cos(-w), Math.sin(-w)], e2 = [Math.cos(-2 * w), Math.sin(-2 * w)]; let g = 1;
    for (const s of sections) { const num = cadd(cadd([s[0], 0], [s[1] * e1[0], s[1] * e1[1]]), [s[2] * e2[0], s[2] * e2[1]]), den = cadd(cadd([1, 0], [s[3] * e1[0], s[3] * e1[1]]), [s[4] * e2[0], s[4] * e2[1]]); g *= Math.hypot(num[0], num[1]) / Math.hypot(den[0], den[1]); }
    return g;
  }

  /* ---- granular delay-line pitch shifter (offline twin of the real-time worklet) ---- */
  function granularShift(chs, sr, ratioAt, splice, overlap, taps, cubic) {
    const L = chs[0].length, W = Math.max(64, Math.min(12000, sr / Math.max(5, splice))), expo = 8 - 6 * overlap, B = 65536, M = B - 1, comp = Math.round(2 + W / 2);
    const read = (b, pos) => { const i0 = Math.floor(pos), f = pos - i0; if (!cubic) return b[i0 & M] * (1 - f) + b[(i0 + 1) & M] * f; const y0 = b[(i0 - 1) & M], y1 = b[i0 & M], y2 = b[(i0 + 1) & M], y3 = b[(i0 + 2) & M]; return y1 + 0.5 * f * (y2 - y0 + f * (2 * y0 - 5 * y1 + 4 * y2 - y3 + f * (3 * (y1 - y2) + y3 - y0))); };
    const bufs = chs.map(() => new Float32Array(B)), outs = chs.map(() => new Float32Array(L)); let phase = 0, w = 0;
    for (let i = 0; i < L + comp; i++) {
      const ratio = ratioAt(Math.min(i, L - 1)); phase += (1 - ratio) / W; phase -= Math.floor(phase);
      for (let c = 0; c < chs.length; c++) bufs[c][w] = i < L ? chs[c][i] : 0;
      let wsum = 0; const acc = new Float64Array(chs.length);
      for (let k = 0; k < taps; k++) { const ph = (phase + k / taps) % 1, pos = w - (2 + ph * W), win = Math.pow(Math.sin(Math.PI * ph), expo); wsum += win; for (let c = 0; c < chs.length; c++) acc[c] += win * read(bufs[c], pos); }
      const g = wsum > 1e-6 ? 1 / wsum : 1, wet = clamp((Math.abs(12 * Math.log2(ratio)) - 0.02) / 0.18, 0, 1); // near unity the shifter fades to a plain delayed copy (no comb filtering)
      if (i >= comp) for (let c = 0; c < chs.length; c++) outs[c][i - comp] = acc[c] * g * wet + (wet < 1 ? read(bufs[c], w - comp) * (1 - wet) : 0);
      w = (w + 1) & M;
    }
    return outs;
  }
  /* pts: [{x: 0..1 of the selection, y: semitones}] */
  function pitchBend(chs, sr, pts, precision) {
    const L = chs[0].length, p = pts && pts.length ? pts.slice().sort((a, b) => a.x - b.x) : [{ x: 0, y: 0 }, { x: 1, y: 0 }];
    const semAt = (i) => { const x = i / Math.max(1, L - 1); if (x <= p[0].x) return p[0].y; if (x >= p[p.length - 1].x) return p[p.length - 1].y; let k = 1; while (p[k].x < x) k++; const a = p[k - 1], b = p[k]; return a.y + ((b.y - a.y) * (x - a.x)) / Math.max(1e-9, b.x - a.x); };
    const q = precision === 'low' ? [60, 0.2, 2, false] : precision === 'high' ? [25, 0.6, 4, true] : [40, 0.4, 3, false];
    return granularShift(chs, sr, (i) => Math.pow(2, semAt(i) / 12), q[0], q[1], q[2], q[3]);
  }
  /* envelope: pts [{x 0..1, y dB}]; shape controls how the level moves between points */
  function gainEnvelope(chs, pts, shape) {
    const L = chs[0].length, p = pts && pts.length ? pts.slice().sort((a, b) => a.x - b.x) : [{ x: 0, y: 0 }, { x: 1, y: 0 }], sh = (u) => (shape === 'cosine' ? 0.5 - 0.5 * Math.cos(Math.PI * u) : shape === 'log' ? Math.log10(1 + 9 * u) : shape === 'exp' ? u * u * u : u);
    const g = new Float32Array(L); let k = 1;
    for (let i = 0; i < L; i++) { const x = i / Math.max(1, L - 1); while (k < p.length - 1 && p[k].x < x) k++; let db; if (p.length === 1 || x <= p[0].x) db = p[0].y; else if (x >= p[p.length - 1].x) db = p[p.length - 1].y; else { const a = p[k - 1], b = p[k]; db = a.y + (b.y - a.y) * sh(clamp((x - a.x) / Math.max(1e-9, b.x - a.x), 0, 1)); } g[i] = db <= -90 ? 0 : fromDb(db); }
    return chs.map((c) => { const y = new Float32Array(L); for (let i = 0; i < L; i++) y[i] = c[i] * g[i]; return y; });
  }
  /* Clipped runs in one channel: samples at/above thr% of the channel peak, same sign, at least minRun long →
     [{s, e}] (inclusive). Repair: a cubic Hermite arc through the surrounding samples. */
  function detectClippingCh(x, thrPct, minRun) {
    const L = x.length, out = []; let pk = 0; for (let i = 0; i < L; i++) pk = Math.max(pk, Math.abs(x[i])); const thr = pk * (thrPct / 100);
    let i = 1;
    while (i < L - 1) {
      if (Math.abs(x[i]) >= thr && thr > 0) {
        const s = i, sgn = Math.sign(x[i]); let e = i; while (e + 1 < L && Math.abs(x[e + 1]) >= thr && Math.sign(x[e + 1]) === sgn) e++;
        if (e - s + 1 >= minRun && s >= 2 && e < L - 2) out.push({ s, e });
        i = e + 1;
      } else i++;
    }
    return out;
  }
  /* y: output (written), x: the original samples around the run */
  function repairClip(y, x, s, e) {
    const a = s - 1, b = e + 1, n = b - a, ya = x[a], yb = x[b], da = (x[a] - x[a - 1]), db = (x[b + 1] - x[b]);
    for (let k = a + 1; k < b; k++) { const t = (k - a) / n, h00 = 2 * t * t * t - 3 * t * t + 1, h10 = t * t * t - 2 * t * t + t, h01 = -2 * t * t * t + 3 * t * t, h11 = t * t * t - t * t; y[k] = h00 * ya + h10 * n * da + h01 * yb + h11 * n * db; }
  }
  function declip(chs, thrPct, minRun) {
    return chs.map((x) => { const y = x.slice(); for (const r of detectClippingCh(x, thrPct, minRun)) repairClip(y, x, r.s, r.e); return y; });
  }
  function detectClipping(chs, thrPct, minRun) {
    const out = []; chs.forEach((x, ch) => { for (const r of detectClippingCh(x, thrPct, minRun)) out.push({ ...r, ch }); });
    return out.sort((p, q) => p.s - q.s || p.ch - q.ch);
  }
  /* Find non-silent regions: returns [[start, end], ...] in samples (hold smooths short dips). */
  function detectAudio(chs, sr, thrDb, minSilenceMs, minAudioMs) {
    const L = chs[0].length, win = Math.max(8, Math.round(sr * 0.01)), thr = fromDb(thrDb), n = Math.floor(L / win), act = new Uint8Array(n);
    for (let b = 0; b < n; b++) { let s = 0, c = 0; for (const ch of chs) for (let i = b * win; i < (b + 1) * win; i++) { s += ch[i] * ch[i]; c++; } act[b] = Math.sqrt(s / c) >= thr ? 1 : 0; }
    const gap = Math.max(1, Math.round(minSilenceMs / 10)), regs = []; let start = -1, quiet = 0;
    for (let b = 0; b <= n; b++) {
      const on = b < n && act[b];
      if (on) { if (start < 0) start = b; quiet = 0; } else if (start >= 0) { quiet++; if (quiet >= gap || b >= n) { const end = b - quiet + 1; regs.push([start * win, Math.min(L, end * win)]); start = -1; quiet = 0; } }
    }
    const minA = Math.round(minAudioMs / 10) * win; return regs.filter((r) => r[1] - r[0] >= minA);
  }
  /* silent stretches longer than minSilenceMs (between, before and after the audio regions): [{s, e}] */
  function detectSilence(chs, sr, thrDb, minSilenceMs) {
    const L = chs[0].length, regs = detectAudio(chs, sr, thrDb, minSilenceMs, 0), min = (minSilenceMs * sr) / 1000, out = [];
    let prev = 0; for (const [a, b] of regs) { if (a - prev >= min) out.push({ s: prev, e: a }); prev = b; }
    if (L - prev >= min) out.push({ s: prev, e: L });
    return out;
  }
  /* Remove silences longer than minSilenceMs, keeping keepMs on each side so cuts breathe. */
  function deleteSilence(chs, sr, thrDb, minSilenceMs, keepMs) {
    const L = chs[0].length, regs = detectAudio(chs, sr, thrDb, minSilenceMs, 0), keep = Math.round((keepMs * sr) / 1000);
    if (!regs.length) return chs.map((c) => new Float32Array(Math.min(c.length, keep * 2)));
    const spans = []; for (const [a, b] of regs) { const s = Math.max(0, a - keep), e = Math.min(L, b + keep); if (spans.length && s <= spans[spans.length - 1][1]) spans[spans.length - 1][1] = Math.max(spans[spans.length - 1][1], e); else spans.push([s, e]); }
    const fade = Math.min(Math.round(sr * 0.004), keep || 1), total = spans.reduce((a, s) => a + s[1] - s[0], 0);
    return chs.map((c) => { const y = new Float32Array(total); let o = 0; for (const [s, e] of spans) { for (let i = s; i < e; i++) { let g = 1; if (i - s < fade && s > 0) g = (i - s) / fade; if (e - i <= fade && e < L) g = Math.min(g, (e - i) / fade); y[o++] = c[i] * g; } } return y; });
  }
  /* Hiss reduction: adaptive spectral gate applied only above `fromHz`. */
  function hissReduce(chs, sr, fromHz, reductionDb, sens, smooth) {
    const N = 2048, hop = N / 4, win = hann(N), half = N / 2 + 1, kmin = Math.floor((fromHz * N) / sr), floor = fromDb(-reductionDb), L = chs[0].length, re = new Float64Array(N), im = new Float64Array(N);
    return chs.map((x) => {
      const out = new Float32Array(L + N * 2), g = new Float32Array(half).fill(1), sp = new Float64Array(half), tr = floorTracker(half, 6);
      for (let s = -N; s < L; s += hop) {
        for (let i = 0; i < N; i++) { const j = s + i; re[i] = (j >= 0 && j < L ? x[j] : 0) * win[i]; im[i] = 0; } fft(re, im, false);
        let en = 0; for (let k = 0; k < half; k++) en += re[k] * re[k] + im[k] * im[k]; tr.begin(en);
        for (let k = kmin; k < half; k++) {
          const m = Math.hypot(re[k], im[k]) + 1e-12; sp[k] = tr.live <= 1 || !sp[k] ? m : sp[k] * 0.8 + m * 0.2; const nf = tr.floor(k, sp[k]);
          let gg = Math.max(floor, 1 - (sens * nf * 1.5) / m); gg = gg > g[k] ? gg : g[k] * smooth + gg * (1 - smooth); g[k] = gg; re[k] *= gg; im[k] *= gg; if (k > 0 && k < N / 2) { re[N - k] *= gg; im[N - k] *= gg; }
        }
        tr.frame(); fft(re, im, true); for (let i = 0; i < N; i++) out[s + i + N] += (re[i] * win[i]) / 1.5;
      }
      return out.slice(N, N + L);
    });
  }
  /* ---------- DeReverb: late-reverberation spectral subtraction (after Lebart, Boucher & Denbigh 2001) ----------
     The late reverb in each frequency bin is predicted from the signal's own (smoothed) power `Tl` earlier, decayed
     by the room: P_late(t) = P(t - Tl) · e^(-2·Δ·Tl), Δ = 3·ln10 / T60 — and subtracted with a gain floor.
     T60 is estimated from the file when not given (estimateT60). The real-time rack version (worklet.js as-dereverb)
     runs the same per-frame algorithm. */
  /* T60 from the decays in the file: a sound can never die away faster than the room lets it, so the steepest
     clean (straight, ≥ 6 dB) falls of the 10 ms energy envelope show the room's decay rate. → seconds, or 0 if none */
  function estimateT60(chs, sr) {
    const x = mixMono(chs), hop = Math.max(1, Math.round(0.01 * sr)), n = Math.floor(x.length / hop);
    if (n < 30) return 0;
    const E = new Float64Array(n);
    for (let i = 0; i < n; i++) { let s = 0; for (let j = i * hop, e = j + hop; j < e; j++) s += x[j] * x[j]; E[i] = 10 * Math.log10(s / hop + 1e-12); }
    const sorted = Array.from(E).sort((a, b) => a - b), floorDb = sorted[Math.floor(n * 0.1)], top = sorted[n - 1];
    const slopes = [];
    for (const W of [8, 12, 20, 40]) {
      for (let i = 0; i + W <= n; i += 2) {
        if (E[i] < floorDb + 20 || E[i] < top - 45 || E[i + W - 1] < floorDb + 3) continue; // decays well above the noise floor
        let rises = 0; for (let j = i; j < i + W - 1; j++) if (E[j + 1] > E[j] + 1.5) rises++;
        if (rises > 1 || E[i] - E[i + W - 1] < 6) continue;
        let sx = 0, sy = 0, sxx = 0, sxy = 0; for (let j = 0; j < W; j++) { sx += j; sy += E[i + j]; sxx += j * j; sxy += j * E[i + j]; }
        const b = (W * sxy - sx * sy) / (W * sxx - sx * sx), a = (sy - b * sx) / W; if (b >= 0) continue;
        let ss = 0, st = 0; const my = sy / W; for (let j = 0; j < W; j++) { const r = E[i + j] - (a + b * j); ss += r * r; st += (E[i + j] - my) * (E[i + j] - my); }
        if (st > 0 && 1 - ss / st >= 0.9) slopes.push(b / 0.01); // dB per second
      }
    }
    if (slopes.length < 3) return 0;
    slopes.sort((a, b) => a - b); // the median: the steepest ones are the direct sound's own offsets, not the room
    const s = slopes[Math.floor(slopes.length * 0.5)];
    return clamp(-60 / s, 0.1, 8);
  }
  const DEREVERB_FOCUS = ['all', 'low', 'mid', 'high'];
  /* how much of the reduction each bin gets for a Processing Focus (smooth in log-frequency) */
  function dereverbWeights(focus, half, sr, N) {
    const w = new Float64Array(half), lg = (f) => Math.log2(Math.max(f, 20));
    const band = { low: [20, 800], mid: [300, 4000], high: [2000, 24000] }[focus];
    for (let k = 0; k < half; k++) {
      if (!band) { w[k] = 1; continue; }
      const f = (k * sr) / N, d = f < band[0] ? lg(band[0]) - lg(f) : f > band[1] ? lg(f) - lg(band[1]) : 0;
      w[k] = 0.25 + 0.75 * Math.max(0, 1 - d); // full inside the band, a quarter one octave or more outside
    }
    return w;
  }
  /* one STFT frame of DeReverb (the offline effect and the live worklet as-dereverb both call this). st: per-channel state */
  function dereverbState(half, nl) { return { P: new Float64Array(half), hist: Array.from({ length: nl }, () => new Float64Array(half)), h: 0, g: new Float64Array(half).fill(1), n: 0 }; }
  function dereverbFrame(re, im, N, st, o) {
    const half = N / 2 + 1, past = st.hist[st.h];
    for (let k = 0; k < half; k++) {
      const p = re[k] * re[k] + im[k] * im[k];
      st.P[k] = st.n ? o.a * st.P[k] + (1 - o.a) * p : p;
      const late = st.n >= st.hist.length ? past[k] * o.decay : 0;
      let g = Math.max(o.floor, 1 - (o.beta * o.w[k] * late) / (st.P[k] + 1e-20));
      g = Math.sqrt(g); // power gain → magnitude gain
      g = g > st.g[k] ? g : st.g[k] * 0.4 + g * 0.6; // fast up (onsets), a little smoothing down (less musical noise)
      st.g[k] = g; re[k] *= g; im[k] *= g; if (k > 0 && k < N / 2) { re[N - k] *= g; im[N - k] *= g; }
    }
    past.set(st.P); st.h = (st.h + 1) % st.hist.length; st.n++;
  }
  /* amount 0–100 %, focus all|low|mid|high, gainDb (output makeup), t60 s (0 = estimate from the file) */
  function dereverbOpts(sr, N, hop, amount, focus, t60) {
    const a = clamp(amount / 100, 0, 1), nl = Math.max(1, Math.round((0.05 * sr) / hop)), Tl = (nl * hop) / sr, delta = (3 * Math.LN10) / Math.max(0.05, t60);
    return { nl, beta: 2.5 * a, floor: Math.pow(10, (-30 * a) / 10), decay: Math.exp(-2 * delta * Tl), a: Math.exp(-hop / sr / 0.02), w: dereverbWeights(DEREVERB_FOCUS.includes(focus) ? focus : 'all', N / 2 + 1, sr, N) };
  }
  function dereverb(chs, sr, amount, focus, gainDb, t60) {
    const N = 2048, hop = N / 4, win = hann(N), L = chs[0].length, re = new Float64Array(N), im = new Float64Array(N), g = fromDb(gainDb || 0);
    const T = t60 > 0 ? t60 : estimateT60(chs, sr) || 0.5, o = dereverbOpts(sr, N, hop, amount, focus, T);
    const out = chs.map((x) => {
      const y = new Float32Array(L + N * 2), st = dereverbState(N / 2 + 1, o.nl);
      for (let s = hop - N; s < L; s += hop) { // (the frame at -N is all zeros) — same frames as the live worklet
        for (let i = 0; i < N; i++) { const j = s + i; re[i] = (j >= 0 && j < L ? x[j] : 0) * win[i]; im[i] = 0; }
        fft(re, im, false); dereverbFrame(re, im, N, st, o); fft(re, im, true);
        for (let i = 0; i < N; i++) y[s + i + N] += (re[i] * win[i] * g) / 1.5;
      }
      return y.slice(N, N + L);
    });
    out.t60 = T; return out;
  }
  /* Doppler pass-by: the source travels along a straight line and passes the listener at the middle of the selection. */
  function doppler(chs, sr, kmh, closest, stereo) {
    const L = chs[0].length, v = kmh / 3.6, T = L / sr, mono = mixMono(chs), out = [new Float32Array(L), new Float32Array(L)], c0 = 343;
    let lp = 0; const d0 = Math.max(0.5, closest), dc = d0 / c0;
    for (let i = 0; i < L; i++) {
      const t = i / sr, x = v * (t - T / 2), r = Math.sqrt(d0 * d0 + x * x), pos = i - (r / c0 - dc) * sr;
      let s = 0; if (pos >= 0 && pos < L - 1) { const i0 = Math.floor(pos), f = pos - i0; s = mono[i0] * (1 - f) + mono[i0 + 1] * f; }
      const g = Math.min(1, d0 / r); lp += (s - lp) * clamp(0.15 + 0.85 * g * g, 0.05, 1); const y = lp * g, pan = stereo ? clamp(x / (r + 1e-6), -1, 1) : 0;
      out[0][i] = y * Math.cos(((pan + 1) * Math.PI) / 4) * Math.SQRT2; out[1][i] = y * Math.sin(((pan + 1) * Math.PI) / 4) * Math.SQRT2;
    }
    return stereo || chs.length > 1 ? out : [out[0]];
  }
  const channelMix = (chs, m) => { if (chs.length < 2) return cloneCh(chs); const L = chs[0].length, a = new Float32Array(L), b = new Float32Array(L); for (let i = 0; i < L; i++) { const l = chs[0][i], r = chs[1][i]; a[i] = l * m.ll + r * m.rl; b[i] = l * m.lr + r * m.rr; } return [a, b, ...chs.slice(2).map((c) => c.slice())]; };

  /* ---------- analysis ---------- */
  function spectrum(chs, sr, N) {
    N = N || 4096;
    const x = mixMono(chs), win = hann(N), half = N / 2 + 1, acc = new Float64Array(half), re = new Float64Array(N), im = new Float64Array(N);
    let frames = 0;
    const hop = N / 2;
    const total = Math.max(1, Math.ceil((x.length - N) / hop) + 1);
    const stride = Math.max(1, Math.floor(total / 400));
    for (let f = 0; f < total; f += stride) {
      const s = f * hop;
      for (let i = 0; i < N; i++) { re[i] = (s + i < x.length ? x[s + i] : 0) * win[i]; im[i] = 0; }
      fft(re, im, false);
      for (let k = 0; k < half; k++) acc[k] += re[k] * re[k] + im[k] * im[k];
      frames++;
    }
    const out = new Float32Array(half);
    for (let k = 0; k < half; k++) out[k] = 10 * Math.log10(acc[k] / frames / (N * N * 0.1) + 1e-14);
    return { db: out, N, sr };
  }
  /* K-weighting of ITU-R BS.1770 at any sample rate: the standard's pre-filter (high shelf) and RLB high-pass, from
     their analog prototypes (reproduces the published 48 kHz coefficients exactly). (A generic RBJ shelf with the same
     f0 / Q / gain — used before — reads about 0.25 dB low at 1 kHz.) */
  function kWeightCoefs(sr) {
    let K = Math.tan((Math.PI * 1681.974450955533) / sr); const Q = 0.7071752369554196, Vh = Math.pow(10, 3.999843853973347 / 20), Vb = Math.pow(Vh, 0.4996667741545416);
    let a0 = 1 + K / Q + K * K;
    const shelf = [(Vh + (Vb * K) / Q + K * K) / a0, (2 * (K * K - Vh)) / a0, (Vh - (Vb * K) / Q + K * K) / a0, (2 * (K * K - 1)) / a0, (1 - K / Q + K * K) / a0];
    K = Math.tan((Math.PI * 38.13547087602444) / sr); const Q2 = 0.5003270373238773; a0 = 1 + K / Q2 + K * K;
    const hp = [1, -2, 1, (2 * (K * K - 1)) / a0, (1 - K / Q2 + K * K) / a0];
    return [shelf, hp];
  }
  function loudness(chs, sr) {
    const [ks, kh] = kWeightCoefs(sr), kw = chs.slice(0, 3).map((c) => applyBiquad(applyBiquad(c, ks), kh));
    const seg = Math.round(0.1 * sr), L = kw[0].length, nSeg = Math.floor(L / seg);
    if (nSeg < 4) return -Infinity;
    const e = new Float64Array(nSeg);
    for (let s = 0; s < nSeg; s++) { let acc = 0; for (const c of kw) { let t = 0; for (let i = s * seg; i < (s + 1) * seg; i++) t += c[i] * c[i]; acc += t / seg; } e[s] = acc; }
    const blocks = [];
    for (let s = 0; s + 4 <= nSeg; s++) blocks.push((e[s] + e[s + 1] + e[s + 2] + e[s + 3]) / 4);
    const lk = (z) => -0.691 + 10 * Math.log10(z);
    let g1 = blocks.filter((z) => lk(z) > -70);
    if (!g1.length) return -Infinity;
    const rel = lk(g1.reduce((a, b) => a + b, 0) / g1.length) - 10;
    const g2 = g1.filter((z) => lk(z) > rel);
    if (!g2.length) return -Infinity;
    return lk(g2.reduce((a, b) => a + b, 0) / g2.length);
  }
  /* ---------- true peak (ITU-R BS.1770-4 Annex 2: 4× oversampling) ----------
     The 3 in-between points of every sample interval are interpolated with a 4-phase windowed-sinc filter (24 taps per
     phase, Kaiser β 8; flat within 0.001 dB up to 0.4 fs). The largest absolute value of the 4× signal = the true peak (dBTP). */
  const TP_T = 16, TP_PH = (() => {
    const I0 = (x) => { let s = 1, t = 1; for (let k = 1; k < 30; k++) { t *= (x / (2 * k)) * (x / (2 * k)); s += t; } return s; }, beta = 8, ph = [];
    for (let p = 1; p < 4; p++) {
      const h = new Float64Array(2 * TP_T); let sum = 0;
      for (let j = 0; j < 2 * TP_T; j++) { const tau = j - TP_T + 1 - p / 4, u = tau / TP_T; const w = Math.abs(u) <= 1 ? I0(beta * Math.sqrt(1 - u * u)) / I0(beta) : 0; h[j] = (tau === 0 ? 1 : Math.sin(Math.PI * tau) / (Math.PI * tau)) * w; sum += h[j]; }
      for (let j = 0; j < 2 * TP_T; j++) h[j] /= sum; // unity gain at DC
      ph.push(h);
    }
    return ph;
  })();
  /* the value of x interpolated at i - 1 + p/4 (p = 1..3), i.e. between samples i-1 and i */
  function tpAt(x, i, p) { const h = TP_PH[p - 1], L = x.length; let v = 0; for (let j = 0; j < 2 * TP_T; j++) { const k = i - TP_T + j; if (k >= 0 && k < L) v += x[k] * h[j]; } return v; }
  /* per-sample true-peak envelope: max |x| over the 4× points in (i-1, i] */
  function tpEnvelope(x) {
    const L = x.length, env = new Float32Array(L);
    for (let i = 0; i < L; i++) { let m = Math.abs(x[i]); if (i > 0) for (let p = 1; p < 4; p++) { const v = Math.abs(tpAt(x, i, p)); if (v > m) m = v; } env[i] = m; }
    return env;
  }
  /* true peak (linear) of the channels: {peak, per: [per channel]} */
  function truePeak(chs) {
    // (only intervals whose ends reach a third of the running maximum can hold the peak — skips the quiet majority)
    const per = chs.map((x) => { let m = 0; const L = x.length; for (let i = 0; i < L; i++) { const a = Math.abs(x[i]); if (a > m) m = a; if (i > 0 && (a > m * 0.33 || Math.abs(x[i - 1]) > m * 0.33)) for (let p = 1; p < 4; p++) { const v = Math.abs(tpAt(x, i, p)); if (v > m) m = v; } } return m; });
    return { peak: Math.max(0, ...per), per };
  }
  /* Limiter on the true peak: the gain is computed from the oversampled envelope, so the inter-sample peaks stay under
     the ceiling as well (a sample-peak limiter lets them through). A second pass catches any rounding overshoot. */
  function limiterTP(chs, sr, ceilDb, lookMs, relMs) {
    let target = ceilDb, out = chs;
    for (let pass = 0; pass < 3; pass++) {
      const env = chs.map(tpEnvelope), proxy = env.map((e, c) => e.map((v, i) => (chs[c][i] < 0 ? -v : v))); // a signal whose |x| is the TP envelope
      const g = limiterGain(proxy, sr, target, lookMs, relMs);
      out = chs.map((c) => { const y = new Float32Array(c.length); for (let i = 0; i < c.length; i++) y[i] = c[i] * g[i]; return y; });
      const tp = toDb(truePeak(out).peak); if (tp <= ceilDb + 0.02) break;
      target -= tp - ceilDb + 0.02;
    }
    return out;
  }

  /* ---------- loudness meter (ITU-R BS.1770-4 / EBU R128 / EBU Tech 3341–3342) ----------
     Streaming: push() channel chunks of any size. K-weighting per channel, mean square per 100 ms, then
       momentary  M = last 400 ms        short-term  S = last 3 s
       integrated I = 400 ms blocks (75 % overlap), absolute gate −70 LUFS, relative gate −10 LU
       LRA = 95th − 10th percentile of short-term values (every 100 ms), gates −70 LUFS and −20 LU
       true peak (4×) and PLR = true peak − integrated
     Channel weights: 1, except surround (5.1: channels 4–5) 1.41; the LFE (5.1 channel 3) is left out. */
  class LoudnessMeter {
    constructor(sr, nch) {
      this.sr = sr; this.nch = nch || 2; this.sub = Math.round(sr / 10);
      const [hs, hp] = kWeightCoefs(sr);
      this.flt = Array.from({ length: this.nch }, () => [{ c: hs, z1: 0, z2: 0 }, { c: hp, z1: 0, z2: 0 }]);
      this.w = Array.from({ length: this.nch }, (_, i) => (this.nch === 6 ? (i === 3 ? 0 : i >= 4 ? 1.41 : 1) : 1));
      this.reset();
    }
    reset() { this.acc = 0; this.n = 0; this.subs = []; this.blocks = []; this.shorts = []; this.tp = 0; this.mMax = -Infinity; this.sMax = -Infinity; this.hist = Array.from({ length: this.nch }, () => new Float32Array(2 * TP_T)); }
    push(chs) {
      const L = chs[0].length, nch = Math.min(this.nch, chs.length);
      // true peak across chunk borders: x = kept history + chunk; the points that still need TP_T future samples are
      // evaluated with the next chunk (the history's second half)
      for (let c = 0; c < nch; c++) {
        const h = this.hist[c], x = new Float32Array(h.length + L); x.set(h); x.set(chs[c], h.length);
        for (let i = TP_T; i < x.length - TP_T; i++) { const a = Math.abs(x[i]); if (a > this.tp) this.tp = a; for (let p = 1; p < 4; p++) { const v = Math.abs(tpAt(x, i, p)); if (v > this.tp) this.tp = v; } }
        this.hist[c] = x.slice(x.length - h.length);
      }
      for (let i = 0; i < L; i++) {
        let s = 0;
        for (let c = 0; c < nch; c++) {
          if (!this.w[c]) continue;
          let v = chs[c][i];
          for (const f of this.flt[c]) { const k = f.c, y = k[0] * v + f.z1; f.z1 = k[1] * v - k[3] * y + f.z2; f.z2 = k[2] * v - k[4] * y; v = y; } // biquad, transposed direct form II
          s += this.w[c] * v * v;
        }
        this.acc += s; if (++this.n === this.sub) { this.subBlock(this.acc / this.sub); this.acc = 0; this.n = 0; }
      }
    }
    subBlock(ms) {
      const S = this.subs; S.push(ms);
      const mean = (k) => { let t = 0; for (let i = S.length - k; i < S.length; i++) t += S[i]; return t / k; }, lk = (z) => -0.691 + 10 * Math.log10(z + 1e-30);
      if (S.length >= 4) { const z = mean(4); this.blocks.push(z); this.mMax = Math.max(this.mMax, lk(z)); }
      if (S.length >= 30) { const z = mean(30); this.shorts.push(z); this.sMax = Math.max(this.sMax, lk(z)); }
    }
    readings() {
      const lk = (z) => -0.691 + 10 * Math.log10(z + 1e-30), S = this.subs, last = (k) => { if (S.length < k) return -Infinity; let t = 0; for (let i = S.length - k; i < S.length; i++) t += S[i]; return lk(t / k); };
      const gate = (arr, rel) => { const g1 = arr.filter((z) => lk(z) > -70); if (!g1.length) return []; const r = lk(g1.reduce((a, b) => a + b, 0) / g1.length) + rel; return g1.filter((z) => lk(z) > r); };
      const g2 = gate(this.blocks, -10), I = g2.length ? lk(g2.reduce((a, b) => a + b, 0) / g2.length) : -Infinity;
      const sv = gate(this.shorts, -20).map(lk).sort((a, b) => a - b), pct = (q) => sv[Math.min(sv.length - 1, Math.max(0, Math.round(q * (sv.length - 1))))];
      let tp = this.tp; for (const h of this.hist) for (let i = TP_T; i < h.length; i++) tp = Math.max(tp, Math.abs(h[i])); // the not yet interpolated tail
      const LRA = sv.length > 1 ? pct(0.95) - pct(0.1) : 0, TP = toDb(tp);
      return { M: last(4), S: last(30), I, LRA, TP, PLR: isFinite(I) ? TP - I : NaN, Mmax: this.mMax, Smax: this.sMax, seconds: S.length / 10 };
    }
  }
  /* the whole loudness set of a file (offline) */
  function loudnessFull(chs, sr) { const m = new LoudnessMeter(sr, chs.length); m.push(chs); return m.readings(); }
  /* Pearson correlation of two channels (+1 mono, 0 unrelated, −1 out of phase); 0 for silence */
  function correlation(a, b) { let lr = 0, ll = 0, rr = 0; for (let i = 0; i < a.length; i++) { lr += a[i] * b[i]; ll += a[i] * a[i]; rr += b[i] * b[i]; } return ll > 1e-12 && rr > 1e-12 ? lr / Math.sqrt(ll * rr) : 0; }

  function stats(chs, sr) {
    const L = chs[0].length, per = [];
    let allSq = 0, allPeak = 0, clipped = 0;
    for (const c of chs) {
      let mn = 0, mx = 0, sum = 0, sq = 0, clip = 0;
      for (let i = 0; i < L; i++) { const v = c[i]; if (v < mn) mn = v; if (v > mx) mx = v; sum += v; sq += v * v; if (v >= 0.9999 || v <= -0.9999) clip++; }
      per.push({ min: mn, max: mx, dc: sum / (L || 1), rms: Math.sqrt(sq / (L || 1)), peak: Math.max(mx, -mn), clipped: clip });
      allSq += sq; clipped += clip; allPeak = Math.max(allPeak, -mn, mx);
    }
    return { length: L, sr, channels: chs.length, per, peak: allPeak, rms: Math.sqrt(allSq / ((L || 1) * chs.length)), clipped, lufs: loudness(chs, sr) };
  }

  /* ---------- generators ---------- */
  function genTone(sr, dur, f0, f1, wave, ampDb, nch) {
    const L = Math.round(dur * sr), a = fromDb(ampDb), y = new Float32Array(L);
    let ph = 0;
    for (let i = 0; i < L; i++) {
      const f = f0 + (f1 - f0) * (L > 1 ? i / (L - 1) : 0);
      ph += f / sr; ph -= Math.floor(ph);
      let v;
      switch (wave) {
        case 'square': v = ph < 0.5 ? 1 : -1; break;
        case 'saw': v = 2 * ph - 1; break;
        case 'triangle': v = 4 * Math.abs(ph - 0.5) - 1; break;
        default: v = Math.sin(TAU * ph);
      }
      y[i] = v * a;
    }
    return Array.from({ length: nch }, () => y.slice());
  }
  function genNoise(sr, dur, kind, ampDb, nch) {
    const L = Math.round(dur * sr), a = fromDb(ampDb);
    return Array.from({ length: nch }, () => {
      const y = new Float32Array(L);
      let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, br = 0;
      for (let i = 0; i < L; i++) {
        const w = Math.random() * 2 - 1;
        if (kind === 'pink') {
          b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759; b2 = 0.969 * b2 + w * 0.153852;
          b3 = 0.8665 * b3 + w * 0.3104856; b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898;
          y[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11 * a; b6 = w * 0.115926;
        } else if (kind === 'brown') { br = (br + 0.02 * w) / 1.02; y[i] = br * 3.5 * a; }
        else y[i] = w * a;
      }
      return y;
    });
  }

  const api = {
    sanitize, toDb, fromDb, clamp, fft, hann, cloneCh, mixMono, concatCh, spliceCh, sliceCh, matchChannels, biquadCoefs, applyBiquad, filterCh,
    resample, convertRate, timeStretch, pitchShift, clipStretch, fixLen, gainCh, peakOf, normalize, dcRemove, ramp, invert, reverse, silence,
    compressor, limiter, gate, createDynamics, detectTempo, echo, modDelay, phaser, tremolo, distortion, bitcrush, reverb, eqBands, stereoWidth, balance, centerRemove,
    adaptiveNR, speechLeveler, spectralEdit, musicRemix, soundRemoveNMF, classifySound, reverbIR, curveIR, phaseIR, PHASE_FREQS, sciFilter, sectionsResponse, granularShift, pitchBend, gainEnvelope, declip, detectAudio, deleteSilence, hissReduce, doppler, channelMix, estimateT60, dereverb, dereverbOpts, dereverbState, dereverbFrame, DEREVERB_FOCUS,
    noiseProfile, noiseReduce, clickRemove, deHum, deEss, spectrum, loudness, stats, genTone, genNoise,
    shapeBounds, shapeMask, shapeShift, spectralEditShape, WINDOWS, windowFn, yin, pitchTrack, harmonicSelect, zeroCross, kWeightCoefs, surroundGains,
    limiterGain, limiterTP, tpEnvelope, truePeak, LoudnessMeter, loudnessFull, correlation,
    detectClicks, detectClicksCh, repairClick, detectClipping, detectClippingCh, repairClip, detectSilence,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.AS = root.AS || {};
  root.AS.dsp = api;
})(typeof window !== 'undefined' ? window : globalThis);


/* Effect windows ("Rack Effect - <name>"): header, presets, effect-specific body, In/Out meters, power, location.
   Two modes share one implementation:
     slot  - bound to a slot of a track / clip / master rack: every change reaches the playing graph immediately
     wave  - waveform editor: live preview loop of the selection, "Apply" renders the effect offline into the selection */
(function (root) {
  'use strict';
  const AS = (root.AS = root.AS || {}), R = AS.rack, D = AS.dsp, UI = AS.ui, esc = UI.esc, app = () => root.app;
  const wins = new Map();
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const ICON = {
    save: '<svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"><path d="M2.5 2.5h9l2 2v9h-11z"/><path d="M5 2.5v3.5h5V2.5M5 13.5V9h6v4.5"/></svg>',
    trash: '<svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 4h11M6 4V2.5h4V4M4 4l.8 9.5h6.4L12 4M6.8 6.5v5M9.2 6.5v5"/></svg>',
    power: '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M8 2v5.5M4.6 4.4a5 5 0 1 0 6.8 0"/></svg>',
  };

  /* ================= presets ================= */
  const PH = (o) => o; // readability
  const peqFlat = () => ({ hpOn: false, lpOn: false, lsG: 0, hsG: 0, b1G: 0, b2G: 0, b3G: 0, b4G: 0, b5G: 0, range: '30', qmode: 'q' });
  const DLY = (lms, rms, lfb, rfb, mix, extra) => PH({ lms, rms, lfb, rfb, mix, linv: false, rinv: false, ...extra });
  const DELAY_PRESETS = [
    { name: '100ms Delay on Left', p: DLY(100, 0, 0, 0, 50) }, { name: 'Bounce', p: DLY(150, 300, 40, 40, 40) }, { name: 'Dueling Drunk Drummers', p: DLY(233, 337, 55, 50, 55) },
    { name: 'Mono Repeater', p: DLY(350, 350, 55, 55, 45) }, { name: 'Out of Time', p: DLY(427, 281, 35, 35, 40) }, { name: 'Rich Double', p: DLY(38, 52, 5, 5, 50) },
    { name: 'Rockabilly', p: DLY(120, 120, 25, 25, 35) }, { name: 'Room Ambience', p: DLY(22, 31, 15, 15, 25) }, { name: 'Slap Back', p: DLY(90, 90, 0, 0, 40) },
    { name: 'Spatial Echo', p: DLY(280, 410, 50, 50, 40) }, { name: 'Stutter', p: DLY(70, 70, 78, 78, 60) }, { name: 'Tape Slap', p: DLY(140, 160, 12, 12, 35) },
    { name: 'Wide Max Delay', p: DLY(1990, 1500, 40, 40, 45) },
  ];
  const FXPRESETS = R.FXPRESETS = {
    pitchshift: [
      { name: 'Angry Gerbil', p: { semi: 9, cents: 40, precision: 'low', auto: false, splice: 70, overlap: 20 } },
      { name: 'Deathly Ill', p: { semi: -4, cents: -35, precision: 'medium', auto: false, splice: 28, overlap: 55 } },
      { name: 'Stretch', p: { semi: -2.5, cents: 0, precision: 'high', auto: false, splice: 14, overlap: 85 } },
      { name: 'The Dark Lord', p: { semi: -10, cents: 0, precision: 'high', auto: false, splice: 22, overlap: 60 } },
    ],
    vocalenh: [{ name: 'High Tone', p: { mode: 'high' } }, { name: 'Low Tone', p: { mode: 'low' } }, { name: 'Music', p: { mode: 'music' } }],
    autopitch: [
      { name: 'A Minor', p: { scale: 'minor', key: '9' } }, { name: 'C Major', p: { scale: 'major', key: '0' } },
      { name: 'Extreme Correction', p: { scale: 'chromatic', attack: 8, sens: 200 } }, { name: 'Subtle Vocal Correction', p: { scale: 'major', key: '0', attack: 3, sens: 70 } },
    ],
    delay2: DELAY_PRESETS, analogdelay: DELAY_PRESETS,
    peq: [
      { name: 'Acoustic Guitar', p: { ...peqFlat(), lsF: 90, lsG: -3, b2F: 400, b2G: -2, b4F: 3000, b4G: 2.5, hsF: 9000, hsG: 2 } },
      { name: 'Beefy Snare', p: { ...peqFlat(), b1F: 150, b1G: 4, b1Q: 1.2, b3F: 800, b3G: -3, b3Q: 1.5, b4F: 4500, b4G: 3.5, b4Q: 1.1, hsF: 10000, hsG: 2 } },
      { name: 'Full Reset', p: { ...peqFlat() } },
      { name: 'Generic Hi-Pass', p: { ...peqFlat(), hpOn: true, hpF: 80 } },
      { name: 'Generic Low-Pass', p: { ...peqFlat(), lpOn: true, lpF: 12000 } },
      { name: 'Heavy Guitar', p: { ...peqFlat(), hpOn: true, hpF: 80, b1F: 120, b1G: 2, b3F: 800, b3G: -2.5, b4F: 2800, b4G: 4, lpOn: true, lpF: 9000 } },
      { name: 'Kick', p: { ...peqFlat(), b1F: 60, b1G: 5, b1Q: 1.2, b2F: 380, b2G: -6, b2Q: 1.5, b4F: 4000, b4G: 4, b4Q: 1.2 } },
      { name: 'Loudness Maximizer', p: { ...peqFlat(), lsF: 80, lsG: 4, hsF: 9000, hsG: 4, b3F: 1000, b3G: -3, b3Q: 0.7 } },
      { name: 'Old Time Radio', p: { ...peqFlat(), hpOn: true, hpF: 350, lpOn: true, lpF: 3200, b3F: 1500, b3G: 4, b3Q: 1.2 } },
      { name: 'Rap Vocals', p: { ...peqFlat(), hpOn: true, hpF: 90, b1F: 200, b1G: -3, b3F: 3000, b3G: 3, hsF: 10000, hsG: 4 } },
      { name: 'Vocal Enhancer', p: { ...peqFlat(), hpOn: true, hpF: 80, b2F: 250, b2G: -2, b3F: 3200, b3G: 3, hsF: 11000, hsG: 3 } },
    ],
  };
  const LS = (type) => 'as-fxpresets:' + type;
  const userPresets = (type) => { try { return JSON.parse(localStorage.getItem(LS(type))) || {}; } catch (e) { return {}; } };
  const saveUser = (type, o) => { try { localStorage.setItem(LS(type), JSON.stringify(o)); } catch (e) { /* */ } };
  const builtins = (type) => [{ name: '(Default)', p: {} }, ...(FXPRESETS[type] || [])];

  /* parameter rows that only make sense for some settings */
  const VIS = {
    amplify: (p) => ({ db: p.link, dbL: !p.link, dbR: !p.link }),
    dynamics: (p) => ({ gateThr: p.gateOn, compThr: p.compOn, compRatio: p.compOn, att: p.compOn, rel: p.compOn, makeup: p.compOn, limCeil: p.limOn }),
    dynproc: (p) => ({ gateThr: p.gateOn, expThr: p.expOn, expRange: p.expOn, compThr: p.compOn, compRatio: p.compOn, att: p.compOn, rel: p.compOn, makeup: p.compOn, limCeil: p.limOn }),
    scifilter: (p) => ({ width: /band/.test(p.mode), rp: p.ftype === 'cheby1', rs: p.ftype === 'cheby2' }),
    convreverb: (p) => ({}),
  };
  const TAIL = { reverb: 2.5, fullreverb: 3, studioreverb: 2.5, surroundreverb: 3, convreverb: 3, delay: 2, delay2: 2, analogdelay: 2 };

  /* ================= small UI helpers ================= */
  const h = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html !== undefined) e.innerHTML = html; return e; };
  const decimals = (step) => (step >= 1 ? 0 : Math.min(3, Math.ceil(-Math.log10(step))));
  const fmtN = (v, step) => (+v).toFixed(decimals(step || 0.1));
  const keyOf = (n) => ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'][n];

  function ctlSlider(w, id, label, o = {}) {
    const d = w.def.params.find((p) => p.id === id) || {}, min = o.min !== undefined ? o.min : d.min, max = o.max !== undefined ? o.max : d.max, step = o.step !== undefined ? o.step : d.step, unit = o.unit !== undefined ? o.unit : d.unit;
    const to = o.to || ((v) => v), from = o.from || ((v) => v);
    const row = h('div', 'fxr'), lab = h('label', '', esc(label)), s = h('input'), n = h('input', 'num'), u = h('span', 'unit', esc(unit || ''));
    s.type = 'range'; s.min = min; s.max = max; s.step = step; n.type = 'number'; n.min = o.numMin !== undefined ? o.numMin : to(min); n.max = o.numMax !== undefined ? o.numMax : to(max); n.step = o.numStep || step;
    row.append(lab, s, n, u); row.title = AS.tips.param('rack:' + w.type, id);
    s.addEventListener('input', () => { n.value = fmtN(to(+s.value), o.numStep || step); w.set(id, +s.value); if (o.after) o.after(); });
    n.addEventListener('change', () => { let v = from(+n.value); if (!isFinite(v)) return; v = Math.max(min, Math.min(max, v)); s.value = v; n.value = fmtN(to(v), o.numStep || step); w.set(id, v); if (o.after) o.after(); });
    s.addEventListener('dblclick', () => { s.value = d.value; s.dispatchEvent(new Event('input')); });
    const c = { el: row, id, update() { const v = w.fx.p[id]; s.value = v; n.value = fmtN(to(v), o.numStep || step); }, disable(b) { s.disabled = n.disabled = b; row.style.opacity = b ? 0.5 : 1; } };
    w.ctrls.push(c); return c;
  }
  function ctlSelect(w, id, label, options) {
    const row = h('div', 'fxr'), sel = h('select'); options = options || R.optionsOf(w.def.params.find((p) => p.id === id), w.optCx());
    row.append(h('label', '', esc(label)), sel); row.title = AS.tips.param('rack:' + w.type, id); sel.innerHTML = options.map((o) => `<option value="${esc(o[0])}">${esc(o[1])}</option>`).join('');
    sel.addEventListener('change', () => { w.set(id, sel.value); });
    const c = { el: row, id, update() { sel.value = String(w.fx.p[id]); }, sel }; w.ctrls.push(c); return c;
  }
  function ctlCheck(w, id, label) {
    const row = h('div', 'fxr'), lab = h('label', 'chk'), cb = h('input'); cb.type = 'checkbox'; lab.append(cb, document.createTextNode(' ' + label)); row.append(lab); row.title = AS.tips.param('rack:' + w.type, id);
    cb.addEventListener('change', () => w.set(id, cb.checked));
    const c = { el: row, id, update() { cb.checked = !!w.fx.p[id]; }, cb }; w.ctrls.push(c); return c;
  }
  function ctlRadios(w, id, options, cls) {
    const box = h('div', 'fxradios ' + (cls || '')), name = 'rg' + Math.random().toString(36).slice(2, 7), inputs = [];
    for (const [val, lab, hint] of options) {
      const l = h('label', 'radio'), r = h('input'); r.type = 'radio'; r.name = name; r.value = val; l.append(r, document.createTextNode(' ' + lab)); if (hint) l.title = hint; box.append(l); inputs.push(r);
      r.addEventListener('change', () => { if (r.checked) w.set(id, val); });
    }
    const c = { el: box, id, update() { inputs.forEach((r) => (r.checked = r.value === String(w.fx.p[id]))); }, inputs }; w.ctrls.push(c); return c;
  }
  const group = (title, ...kids) => { const g = h('fieldset', 'fxg'); g.append(h('legend', '', esc(title))); kids.forEach((k) => g.append(k.el || k)); return g; };

  /* ================= effect-specific bodies ================= */
  const BODIES = {};

  BODIES.pitchshift = (w) => {
    const box = h('div', 'fxbody'), ratio = h('div', 'fxratio', 'Ratio: <b>1.0000</b>'), upd = () => { const p = w.fx.p; ratio.querySelector('b').textContent = Math.pow(2, (p.semi + p.cents / 100) / 12).toFixed(4); };
    const semi = ctlSlider(w, 'semi', 'Semitones', { min: -10, max: 10, step: 0.01, unit: 'st', after: upd }), cents = ctlSlider(w, 'cents', 'Cents', { min: -100, max: 100, step: 1, unit: 'ct', after: upd });
    const prec = ctlRadios(w, 'precision', [['low', 'Low Precision'], ['medium', 'Medium Precision'], ['high', 'High Precision']]);
    const splice = ctlSlider(w, 'splice', 'Splicing Frequency', { min: 10, max: 200, step: 1, unit: 'Hz' }), overlap = ctlSlider(w, 'overlap', 'Overlapping', { min: 0, max: 100, step: 1, unit: '%' }), auto = ctlCheck(w, 'auto', 'Use appropriate default settings');
    box.append(group('Pitch Transpose', semi, cents, ratio), group('Precision', prec), group('Pitch Settings', splice, overlap, auto));
    w.ctrls.push({ update() { upd(); const a = !!w.fx.p.auto; splice.disable(a); overlap.disable(a); if (a) { const q = R.PREC[w.fx.p.precision] || R.PREC.medium; splice.el.querySelector('input[type=range]').value = q.splice; splice.el.querySelector('input.num').value = q.splice; overlap.el.querySelector('input[type=range]').value = q.overlap; overlap.el.querySelector('input.num').value = q.overlap; } } });
    return box;
  };

  BODIES.vocalenh = (w) => {
    const box = h('div', 'fxbody'), r = ctlRadios(w, 'mode', [['low', 'Low Tone', 'For deeper (male) voices'], ['high', 'High Tone', 'For higher (female) voices'], ['music', 'Music', 'For sung vocals and music']], 'big');
    const note = h('div', 'note', 'Cleans up and brightens a voice: low-cut, presence EQ, gentle compression and de-essing tuned for the chosen type.');
    box.append(group('Vocal type', r), note); return box;
  };

  BODIES.autopitch = (w) => {
    const box = h('div', 'fxbody apc'), left = h('div', 'apc-l'), right = h('div', 'apc-r'), cv = h('canvas'); cv.width = 84; cv.height = 250; right.append(cv, h('div', 'apc-val', '0.0 cents'));
    const scale = ctlSelect(w, 'scale', 'Scale'), key = ctlSelect(w, 'key', 'Key'), attack = ctlSlider(w, 'attack', 'Attack', { min: 2, max: 8, step: 0.1, unit: '' }), sens = ctlSlider(w, 'sens', 'Sensitivity', { min: 50, max: 200, step: 1, unit: '' });
    const ends = h('div', 'apc-ends', '<span>Slow 2</span><span>Fast 8</span>');
    const ref = ctlSelect(w, 'ref', 'Reference Channel'), fft = ctlSelect(w, 'fft', 'FFT Size'), cal = ctlSlider(w, 'calib', 'Calibration A4', { min: 400, max: 480, step: 0.1, unit: 'Hz' });
    left.append(group('Tuning', scale, key), group('Response', attack, ends, sens), group('Advanced', ref, fft, cal)); box.append(left, right);
    w.cents = 0; let lastNode = null;
    w.tick = () => {
      const nd = R.nodes[w.fx.uid]; if (nd && nd !== lastNode) { lastNode = nd; nd.port.onmessage = (e) => { if (e.data && typeof e.data.cents === 'number') w.cents = e.data.cents; }; }
      if (!w.live()) w.cents *= 0.9;
      const g = cv.getContext('2d'), css = getComputedStyle(document.documentElement), W = cv.width, H = cv.height, c = Math.max(-50, Math.min(50, w.cents)), y0 = H / 2;
      g.fillStyle = css.getPropertyValue('--wave-bg'); g.fillRect(0, 0, W, H); g.fillStyle = css.getPropertyValue('--dim'); g.font = '10px Segoe UI'; g.strokeStyle = css.getPropertyValue('--grid');
      for (let v = -50; v <= 50; v += 25) { const y = y0 - (v / 50) * (H / 2 - 12); g.beginPath(); g.moveTo(26, y); g.lineTo(W - 4, y); g.stroke(); g.fillText((v > 0 ? '+' : '') + v, 2, y + 3); }
      const y = y0 - (c / 50) * (H / 2 - 12); g.fillStyle = Math.abs(c) < 8 ? '#35c06a' : Math.abs(c) < 30 ? '#d9c24a' : '#e8503a'; g.fillRect(36, Math.min(y, y0), 30, Math.max(2, Math.abs(y - y0)));
      right.querySelector('.apc-val').textContent = w.cents.toFixed(1) + ' cents';
    };
    return box;
  };

  const delayBody = (analog) => (w) => {
    const box = h('div', 'fxbody'), unitsHz = () => w.fx.p.units === 'hz', to = (v) => (unitsHz() ? (v > 0 ? 1000 / v : 0) : v), from = (v) => (unitsHz() ? (v > 0 ? 1000 / v : 2000) : v);
    const mk = (side, label) => {
      const t = ctlSlider(w, side + 'ms', 'Delay time', { min: 0, max: 2000, step: 1, numStep: 1, to: (v) => +to(v).toFixed(unitsHz() ? 2 : 0), from, unit: '' }), fb = ctlSlider(w, side + 'fb', 'Feedback', { min: 0, max: 95, step: 1, unit: '%' }), inv = ctlCheck(w, side + 'inv', 'Invert');
      const unit = t.el.querySelector('.unit'); w.ctrls.push({ update() { unit.textContent = unitsHz() ? 'Hz' : 'ms'; } }); return group(label, t, fb, inv);
    };
    const units = ctlRadios(w, 'units', [['ms', 'Delay Time Units: milliseconds'], ['hz', 'Hertz']]); const mix = ctlSlider(w, 'mix', 'Dry / Wet', { min: 0, max: 100, step: 1, unit: '%' });
    const two = h('div', 'fx2'); two.append(mk('l', 'Left channel'), mk('r', 'Right channel'));
    box.append(two, group('Delay Time Units', units), group('Mix', mix));
    if (analog) box.append(group('Analog character', ctlSelect(w, 'mode', 'Mode'), ctlSlider(w, 'tone', 'Feedback darkening', { min: 500, max: 12000, step: 10, unit: 'Hz' }), ctlSlider(w, 'sat', 'Saturation', { min: 0, max: 100, step: 1, unit: '%' }), ctlSlider(w, 'flutter', 'Wow / flutter', { min: 0, max: 100, step: 1, unit: '%' })));
    return box;
  };
  BODIES.delay2 = delayBody(false); BODIES.analogdelay = delayBody(true);

  /* ---- parametric equalizer ---- */
  BODIES.peq = (w) => {
    const bands = R.PEQ.bands, ids = { hp: { f: 'hpF', on: 'hpOn' }, ls: { f: 'lsF', g: 'lsG', q: 'lsQ' }, hs: { f: 'hsF', g: 'hsG', q: 'hsQ' }, lp: { f: 'lpF', on: 'lpOn' } };
    for (let i = 1; i <= 5; i++) ids['b' + i] = { f: `b${i}F`, g: `b${i}G`, q: `b${i}Q` };
    const colors = { hp: '#9aa4b2', ls: '#e0605a', b1: '#ff8a50', b2: '#d6a02b', b3: '#8bc34a', b4: '#35b58a', b5: '#4fc1d8', hs: '#3b8eea', lp: '#c25ad6' };
    const W0 = 640, H0 = 230, pad = { l: 40, r: 10, t: 10, b: 20 }, box = h('div', 'fxbody peq'), cv = h('canvas'); cv.width = W0; cv.height = H0; cv.className = 'peq-cv';
    let sel = 'b3', drag = null; const sr = () => (AS.engine.ctx ? AS.engine.ctx.sampleRate : 44100), rng = () => +w.fx.p.range;
    const fx = (f) => pad.l + ((Math.log(f) - Math.log(20)) / (Math.log(20000) - Math.log(20))) * (W0 - pad.l - pad.r), xf = (x) => Math.exp(Math.log(20) + ((x - pad.l) / (W0 - pad.l - pad.r)) * (Math.log(20000) - Math.log(20)));
    const gy = (g) => pad.t + (1 - (g + rng()) / (2 * rng())) * (H0 - pad.t - pad.b), yg = (y) => -rng() + (1 - (y - pad.t) / (H0 - pad.t - pad.b)) * 2 * rng();
    const qEff = (q) => (w.fx.p.qmode === 'width' ? 1 / (2 * Math.sinh((Math.log(2) / 2) * Math.max(0.01, q))) : q);
    const sections = () => { const p = w.fx.p, out = [], s = sr(), cl = (f) => Math.min(f, s * 0.45); if (p.hpOn) out.push(D.biquadCoefs('highpass', s, cl(p.hpF), 0.7071)); out.push(D.biquadCoefs('lowshelf', s, cl(p.lsF), qEff(p.lsQ), p.lsG)); for (let i = 1; i <= 5; i++) out.push(D.biquadCoefs('peaking', s, cl(p[`b${i}F`]), qEff(p[`b${i}Q`]), p[`b${i}G`])); out.push(D.biquadCoefs('highshelf', s, cl(p.hsF), qEff(p.hsQ), p.hsG)); if (p.lpOn) out.push(D.biquadCoefs('lowpass', s, cl(p.lpF), 0.7071)); return out; };
    const draw = () => {
      const g = cv.getContext('2d'), css = getComputedStyle(document.documentElement), p = w.fx.p; g.fillStyle = css.getPropertyValue('--wave-bg'); g.fillRect(0, 0, W0, H0); g.font = '10px Segoe UI'; g.fillStyle = css.getPropertyValue('--dim'); g.strokeStyle = css.getPropertyValue('--grid');
      for (const f of [20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000]) { const x = fx(f); g.beginPath(); g.moveTo(x, pad.t); g.lineTo(x, H0 - pad.b); g.stroke(); g.fillText(f >= 1000 ? f / 1000 + 'k' : f, x - 6, H0 - 6); }
      const step = rng() === 30 ? 10 : 24; for (let v = -rng(); v <= rng(); v += step) { const y = gy(v); g.strokeStyle = v === 0 ? '#5a6270' : css.getPropertyValue('--grid'); g.beginPath(); g.moveTo(pad.l, y); g.lineTo(W0 - pad.r, y); g.stroke(); g.fillText((v > 0 ? '+' : '') + v, 4, y + 3); }
      const sec = sections(); g.strokeStyle = '#4fd1a5'; g.lineWidth = 2; g.beginPath();
      for (let x = pad.l; x <= W0 - pad.r; x += 2) { const db = 20 * Math.log10(D.sectionsResponse(sec, sr(), xf(x))), y = Math.max(pad.t, Math.min(H0 - pad.b, gy(db))); x === pad.l ? g.moveTo(x, y) : g.lineTo(x, y); } g.stroke(); g.lineWidth = 1;
      for (const [b, label] of bands) { const m = ids[b], on = m.on ? p[m.on] : true, f = p[m.f], gain = m.g ? p[m.g] : 0, x = fx(f), y = gy(gain); g.globalAlpha = on ? 1 : 0.35; g.fillStyle = colors[b]; g.beginPath(); g.arc(x, y, b === sel ? 8 : 6, 0, 7); g.fill(); g.strokeStyle = b === sel ? '#fff' : '#000'; g.lineWidth = b === sel ? 2 : 1; g.stroke(); g.lineWidth = 1; g.fillStyle = '#000'; g.font = 'bold 9px Segoe UI'; g.fillText(label, x - (label.length > 1 ? 5 : 3), y + 3); g.globalAlpha = 1; g.font = '10px Segoe UI'; }
    };
    const pos = (e) => { const r = cv.getBoundingClientRect(); return [((e.clientX - r.left) * W0) / r.width, ((e.clientY - r.top) * H0) / r.height]; };
    const hitBand = (x, y) => { const p = w.fx.p; let best = null, bd = 14; for (const [b] of bands) { const m = ids[b], d = Math.hypot(fx(p[m.f]) - x, gy(m.g ? p[m.g] : 0) - y); if (d < bd) { bd = d; best = b; } } return best; };
    cv.addEventListener('pointerdown', (e) => { const [x, y] = pos(e), b = hitBand(x, y); if (!b) return; sel = b; drag = b; try { cv.setPointerCapture(e.pointerId); } catch (er) { /* synthetic pointer */ } if (ids[b].on && !w.fx.p[ids[b].on]) w.set(ids[b].on, true); refresh(); });
    cv.addEventListener('pointermove', (e) => { if (!drag) return; const [x, y] = pos(e), m = ids[drag]; w.set(m.f, Math.round(Math.max(20, Math.min(20000, xf(x))))); if (m.g) w.set(m.g, +Math.max(-rng(), Math.min(rng(), yg(y))).toFixed(1)); refresh(); });
    cv.addEventListener('pointerup', () => { drag = null; });
    cv.addEventListener('wheel', (e) => { const [x, y] = pos(e), b = hitBand(x, y) || sel, m = ids[b]; if (!m.q) return; e.preventDefault(); const q = w.fx.p[m.q] * (e.deltaY < 0 ? 1.1 : 1 / 1.1); w.set(m.q, +Math.max(0.05, Math.min(w.fx.p.qmode === 'width' ? 6 : 30, q)).toFixed(2)); sel = b; refresh(); }, { passive: false });
    /* numeric panel */
    const tabs = h('div', 'peq-tabs'), btns = {}; for (const [b, label] of bands) { const bt = h('button', 'btn', label); bt.style.borderBottom = '3px solid ' + colors[b]; bt.addEventListener('click', () => { sel = b; refresh(); }); tabs.append(bt); btns[b] = bt; }
    const num = (label, step) => { const r = h('div', 'fxr'), n = h('input', 'num'); n.type = 'number'; n.step = step; r.append(h('label', '', label), n); return { r, n }; };
    const fF = num('Frequency (Hz)', 1), fG = num('Gain (dB)', 0.1), fQ = num('Q / Width', 0.01), gS = h('input'); gS.type = 'range'; gS.step = 0.1; fG.r.insertBefore(gS, fG.n);
    const en = h('label', 'chk'), enCb = h('input'); enCb.type = 'checkbox'; en.append(enCb, document.createTextNode(' Band enabled'));
    const cur = () => ids[sel];
    fF.n.addEventListener('change', () => { w.set(cur().f, Math.max(20, Math.min(20000, +fF.n.value || 1000))); refresh(); });
    fG.n.addEventListener('change', () => { if (cur().g) w.set(cur().g, Math.max(-rng(), Math.min(rng(), +fG.n.value || 0))); refresh(); });
    gS.addEventListener('input', () => { if (cur().g) w.set(cur().g, +gS.value); refresh(); });
    fQ.n.addEventListener('change', () => { if (cur().q) w.set(cur().q, Math.max(0.05, +fQ.n.value || 1)); refresh(); });
    enCb.addEventListener('change', () => { if (cur().on) w.set(cur().on, enCb.checked); refresh(); });
    const panel = group('Selected band', tabs, fF.r, fG.r, fQ.r, en);
    const qmode = ctlRadios(w, 'qmode', [['q', 'Constant Q'], ['width', 'Constant Width']]), ultra = ctlCheck(w, 'ultra', 'Ultra-quiet'), range = ctlSelect(w, 'range', 'Range');
    const orig = w.set.bind(w); const setWithConversion = (id, v) => { if (id === 'qmode' && v !== w.fx.p.qmode) { const toW = v === 'width'; for (const k of ['lsQ', 'hsQ', 'b1Q', 'b2Q', 'b3Q', 'b4Q', 'b5Q']) { const q = w.fx.p[k]; w.fx.p[k] = +(toW ? (2 / Math.log(2)) * Math.asinh(1 / (2 * q)) : 1 / (2 * Math.sinh((Math.log(2) / 2) * q))).toFixed(3); orig(k, w.fx.p[k]); } } orig(id, v); if (id === 'range') { const lim = +v; for (const k of ['lsG', 'hsG', 'b1G', 'b2G', 'b3G', 'b4G', 'b5G']) if (Math.abs(w.fx.p[k]) > lim) orig(k, Math.sign(w.fx.p[k]) * lim); } refresh(); };
    w.set = setWithConversion;
    function refresh() {
      const p = w.fx.p, m = cur(); for (const [b] of bands) btns[b].classList.toggle('on', b === sel);
      fF.n.value = Math.round(p[m.f]); fG.n.disabled = gS.disabled = !m.g; fG.n.value = m.g ? (+p[m.g]).toFixed(1) : ''; gS.min = -rng(); gS.max = rng(); gS.value = m.g ? p[m.g] : 0; fQ.n.disabled = !m.q; fQ.n.value = m.q ? p[m.q] : ''; fQ.r.querySelector('label').textContent = p.qmode === 'width' ? 'Width (octaves)' : 'Q'; en.style.display = m.on ? '' : 'none'; if (m.on) enCb.checked = !!p[m.on]; draw();
    }
    w.ctrls.push({ update: refresh }); box.append(cv, panel, group('Options', qmode, ultra, range)); return box;
  };

  /* ---- vertical-slider banks: graphic EQ and graphic phase shifter ---- */
  const bankBody = (labels, idPrefix, min, max, unit, extra) => (w) => {
    const box = h('div', 'fxbody'), bank = h('div', 'fxbank'), cols = [];
    labels.forEach((lab, i) => { const col = h('div', 'bk'), s = h('input'), v = h('span', 'bv'); s.type = 'range'; s.min = min; s.max = max; s.step = 0.1; s.className = 'vs'; col.append(v, s, h('span', 'bl', lab)); bank.append(col);
      s.addEventListener('input', () => { w.set(idPrefix + i, +s.value); v.textContent = (+s.value).toFixed(max > 60 ? 0 : 1); }); s.addEventListener('dblclick', () => { s.value = 0; s.dispatchEvent(new Event('input')); }); cols.push({ s, v }); });
    const flat = h('button', 'btn', 'Flat'); flat.addEventListener('click', () => { labels.forEach((_, i) => w.set(idPrefix + i, 0)); w.refresh(); });
    w.ctrls.push({ update() { cols.forEach((c, i) => { c.s.value = w.fx.p[idPrefix + i]; c.v.textContent = (+w.fx.p[idPrefix + i]).toFixed(max > 60 ? 0 : 1); }); } });
    box.append(bank, flat); if (extra) extra(box, w); return box;
  };
  for (const t of ['geq10', 'geq20', 'geq30']) {
    const labs = R.GEQ[t].map((f) => (f >= 1000 ? f / 1000 + 'k' : String(f)));
    BODIES[t] = (w) => { const b = bankBody(labs, 'b', -18, 18, 'dB')(w); const m = ctlSlider(w, 'master', 'Master gain', { min: -18, max: 18, step: 0.1, unit: 'dB' }); b.append(m.el); return b; };
  }
  BODIES.phaseshift = (w) => bankBody(D.PHASE_FREQS.map((f) => (f >= 1000 ? f / 1000 + 'k' : String(f))), 'ph', -180, 180, '°', (box) => box.append(ctlSelect(w, 'size', 'Filter length').el, h('div', 'note', 'Phase is rotated by +½ of the value on the left channel and −½ on the right, so the difference between channels equals the drawn angle.')))(w);

  BODIES.fftfilter = (w) => {
    const box = h('div', 'fxbody'); const ed = UI.curveEditor({ W: 620, H: 230, kx: 'f', ky: 'g', xLog: true, xMin: 20, xMax: 20000, yMin: -30, yMax: 30, fixedEnds: true, minPts: 2, pts: w.fx.p.pts, xTicks: [20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000].map((f) => [f, f >= 1000 ? f / 1000 + 'k' : String(f)]), yTicks: [-30, -20, -10, 0, 10, 20, 30].map((v) => [v, (v > 0 ? '+' : '') + v]), xFmt: (f) => Math.round(f) + ' Hz', yFmt: (g) => (g > 0 ? '+' : '') + g.toFixed(1) + ' dB', onChange: (pts) => w.set('pts', pts) });
    w.ctrls.push({ update() { ed.setPoints(w.fx.p.pts); } }); box.append(ed.el, ctlSelect(w, 'size', 'FFT size').el, h('div', 'note', 'Linear-phase filter drawn on a frequency curve (±30 dB). Adds a delay of half the FFT size that the offline Apply compensates automatically.')); return box;
  };

  BODIES.convreverb = (w) => {
    const box = genericBody(w), b = h('button', 'btn', 'Load impulse response file…'), name = h('span', 'note', R.customIR ? 'Loaded: ' + R.customIR.name : 'No custom file loaded'), inp = h('input'); inp.type = 'file'; inp.accept = 'audio/*,.wav'; inp.hidden = true;
    b.addEventListener('click', () => inp.click());
    inp.addEventListener('change', async () => { const f = inp.files[0]; if (!f) return; try { AS.engine.init(); const ab = await AS.engine.ctx.decodeAudioData(await f.arrayBuffer()); R.setCustomIR(f.name, Array.from({ length: Math.min(2, ab.numberOfChannels) }, (_, i) => ab.getChannelData(i).slice()), ab.sampleRate); name.textContent = 'Loaded: ' + f.name; w.set('ir', 'custom'); w.refresh(); } catch (e) { UI.toast('Cannot read that file: ' + e.message, 'error'); } });
    box.append(group('Custom impulse', b, name, inp)); return box;
  };

  /* ---- loudness meter / radar ---- */
  const loudBody = (radar) => (w) => {
    const box = h('div', 'fxbody'), big = h('div', 'ld-grid'); const cells = {};
    for (const [k, lab] of [['m', 'Momentary'], ['s', 'Short-term'], ['i', 'Integrated'], ['lra', 'Loudness range'], ['peak', 'Peak']]) { const c = h('div', 'ld-cell', `<span>${lab}</span><b>—</b><i>${k === 'lra' ? 'LU' : k === 'peak' ? 'dBFS' : 'LUFS'}</i>`); big.append(c); cells[k] = c.querySelector('b'); }
    const cv = h('canvas', 'ld-cv'); cv.width = radar ? 340 : 600; cv.height = radar ? 340 : 160; const reset = h('button', 'btn', 'Reset');
    const st = { m: -Infinity, s: -Infinity, i: -Infinity, lra: 0, peak: -Infinity }, hist = [], bins = new Float32Array(360).fill(NaN); let n = 0, lastNode = null;
    reset.addEventListener('click', () => { hist.length = 0; bins.fill(NaN); n = 0; const nd = R.nodes[w.fx.uid]; if (nd) nd.port.postMessage({ reset: true }); });
    w.tick = () => {
      const nd = R.nodes[w.fx.uid]; if (nd && nd !== lastNode) { lastNode = nd; nd.port.onmessage = (e) => { Object.assign(st, e.data); n++; hist.push(st.s); if (hist.length > 1200) hist.shift(); if (radar && isFinite(st.s)) { const span = w.fx.p.span * 60, t = (n * 0.1) % span; bins[Math.floor((t / span) * 360)] = st.s; for (let k = 1; k <= 3; k++) bins[(Math.floor((t / span) * 360) + k) % 360] = NaN; } }; }
      const fmt = (v, d) => (isFinite(v) ? v.toFixed(d) : '—'); cells.m.textContent = fmt(st.m, 1); cells.s.textContent = fmt(st.s, 1); cells.i.textContent = fmt(st.i, 1); cells.lra.textContent = st.lra ? st.lra.toFixed(1) : '—'; cells.peak.textContent = fmt(st.peak, 1);
      const g = cv.getContext('2d'), css = getComputedStyle(document.documentElement), W = cv.width, H = cv.height, tgt = w.fx.p.target; g.fillStyle = css.getPropertyValue('--wave-bg'); g.fillRect(0, 0, W, H);
      const color = (v) => (v > tgt + 3 ? '#e8503a' : v > tgt + 1 ? '#d9c24a' : v >= tgt - 1 ? '#35c06a' : v >= tgt - 6 ? '#3b8eea' : '#4a5160');
      if (radar) {
        const cx = W / 2, cy = H / 2, r0 = 40, r1 = H / 2 - 14, range = w.fx.p.range; g.strokeStyle = css.getPropertyValue('--grid'); for (const r of [r0, (r0 + r1) / 2, r1]) { g.beginPath(); g.arc(cx, cy, r, 0, 7); g.stroke(); }
        for (let k = 0; k < 360; k++) { const v = bins[k]; if (!isFinite(v)) continue; const a0 = (k / 360) * 2 * Math.PI - Math.PI / 2, a1 = ((k + 1.2) / 360) * 2 * Math.PI - Math.PI / 2, rr = r0 + ((Math.max(tgt - range / 2, Math.min(tgt + range / 2, v)) - (tgt - range / 2)) / range) * (r1 - r0); g.fillStyle = color(v); g.beginPath(); g.arc(cx, cy, rr, a0, a1); g.arc(cx, cy, r0, a1, a0, true); g.fill(); }
        const rt = r0 + 0.5 * (r1 - r0); g.strokeStyle = '#fff'; g.setLineDash([4, 3]); g.beginPath(); g.arc(cx, cy, rt, 0, 7); g.stroke(); g.setLineDash([]); g.fillStyle = css.getPropertyValue('--dim'); g.font = '10px Segoe UI'; g.fillText('target ' + tgt + ' LUFS', cx - 34, cy + 4);
      } else {
        const lo = tgt - 24, hi = tgt + 12, yy = (v) => H - 14 - ((Math.max(lo, Math.min(hi, v)) - lo) / (hi - lo)) * (H - 24); g.strokeStyle = '#fff6'; g.setLineDash([4, 3]); g.beginPath(); g.moveTo(0, yy(tgt)); g.lineTo(W, yy(tgt)); g.stroke(); g.setLineDash([]);
        g.strokeStyle = '#4fd1a5'; g.lineWidth = 2; g.beginPath(); hist.forEach((v, i) => { const x = (i / 1200) * W, y = yy(isFinite(v) ? v : lo); i ? g.lineTo(x, y) : g.moveTo(x, y); }); g.stroke(); g.lineWidth = 1; g.fillStyle = css.getPropertyValue('--dim'); g.font = '10px Segoe UI'; g.fillText('short-term loudness · dashed = target ' + tgt + ' LUFS', 6, 12);
      }
    };
    const tg = ctlSlider(w, 'target', 'Target loudness', { min: -40, max: -5, step: 0.5, unit: 'LUFS' }); box.append(big, cv, tg.el); if (radar) box.append(ctlSlider(w, 'range', 'Radar range', { min: 5, max: 30, step: 1, unit: 'LU' }).el, ctlSlider(w, 'span', 'Time per revolution', { min: 0.5, max: 60, step: 0.5, unit: 'min' }).el); box.append(reset, h('div', 'note', 'Pass-through meter (ITU-R BS.1770 K-weighting, gated). Play the track to see readings.')); return box;
  };
  BODIES.loudmeter = loudBody(false); BODIES.loudradar = loudBody(true);

  /* ---- generic body: one row per parameter ---- */
  function genericBody(w) {
    const box = h('div', 'fxbody'), rows = [];
    for (const p of w.def.params) {
      if (p.type === 'range') rows.push(ctlSlider(w, p.id, p.label));
      else if (p.type === 'select') rows.push(ctlSelect(w, p.id, p.label));
      else if (p.type === 'check') rows.push(ctlCheck(w, p.id, p.label));
    }
    rows.forEach((r) => box.append(r.el)); const vis = VIS[w.type];
    if (vis) w.ctrls.push({ update() { const m = vis(w.fx.p); rows.forEach((r) => { r.el.hidden = m[r.id] === false; }); } });
    if (w.def.info) box.append(h('div', 'note', esc(w.def.info)));
    return box;
  }

  /* ================= the window ================= */
  class FxWin {
    constructor(o) {
      this.type = o.type; this.fx = o.fx; this.def = R.RACK[o.type]; this.mode = o.mode; this.ref = o.ref || null; this.label = o.label || ''; this.uid = o.fx.uid; this.ctrls = []; this.lastPush = 0; this.presetName = '(Default)'; this.pv = null;
      const el = this.el = h('div', 'fxwin'); el.dataset.uid = this.uid; el.dataset.type = this.type;
      el.innerHTML = `<div class="fxw-head"><span class="fxw-title">Rack Effect - ${esc(this.def.name)}</span><button class="fxw-close" title="Close">×</button></div>
        <div class="fxw-presets"><select class="fxw-pre" title="Presets"></select><button class="ico" data-a="save" title="Save preset">${ICON.save}</button><button class="ico" data-a="del" title="Delete preset">${ICON.trash}</button></div>
        <div class="fxw-body"></div>
        <div class="fxw-foot"><div class="fxw-io"><span>In:</span><canvas data-m="in" width="30" height="22"></canvas><span class="lr">L R</span><span style="margin-left:10px">Out:</span><canvas data-m="out" width="30" height="22"></canvas><span class="lr">L R</span></div><span class="fxw-loc"></span><span class="spacer"></span>${this.mode === 'wave' ? '<label class="tail">Tail <input type="number" class="num" min="0" max="30" step="0.5" value="0"> s</label><button class="btn" data-a="preview">▶ Preview</button><button class="btn primary" data-a="apply">Apply</button>' : ''}<button class="fxw-power" title="Effect on / off">${ICON.power}</button></div>`;
      document.body.appendChild(el);
      const n = wins.size; el.style.left = Math.max(10, Math.min(innerWidth - 700, 330 + n * 28)) + 'px'; el.style.top = 70 + n * 28 + 'px';
      this.bodyHost = el.querySelector('.fxw-body'); this.pre = el.querySelector('.fxw-pre'); this.power = el.querySelector('.fxw-power'); this.locEl = el.querySelector('.fxw-loc');
      this.buildBody(); this.fillPresets(); this.refresh();
      el.querySelector('.fxw-close').onclick = () => this.close(); this.pre.onchange = () => this.applyPreset(this.pre.value);
      el.querySelector('[data-a=save]').onclick = () => this.savePreset(); el.querySelector('[data-a=del]').onclick = () => this.deletePreset();
      this.power.onclick = () => this.togglePower();
      if (this.mode === 'wave') { el.querySelector('[data-a=preview]').onclick = () => this.togglePreview(); el.querySelector('[data-a=apply]').onclick = () => this.apply(); this.tailEl = el.querySelector('.tail input'); this.tailEl.value = TAIL[this.type] || 0; }
      this.drag(el.querySelector('.fxw-head')); el.addEventListener('mousedown', () => { document.querySelectorAll('.fxwin').forEach((x) => (x.style.zIndex = 900)); el.style.zIndex = 901; });
    }
    live() { return this.mode === 'slot' ? AS.engine.playing : !!this.pv; }
    /* context for parameter options that depend on the session (sidechain sources): the track that owns this slot */
    optCx() {
      if (this.mode !== 'slot') return {};
      const s = app().session, owner = resolveOwner(this.ref);
      return { ownerId: AS.routing.ownerTrackId(s, owner), current: this.fx.p.sc };
    }
    buildBody() { this.ctrls = []; this.tick = null; const f = BODIES[this.type]; this.bodyHost.innerHTML = ''; this.bodyHost.appendChild(f ? f(this) : genericBody(this)); }
    refresh() { for (const c of this.ctrls) c.update && c.update(); this.updatePowerBtn(); }
    updatePowerBtn() { const on = !this.fx.bypass; this.power.classList.toggle('on', on); this.el.classList.toggle('off', !on); }
    touch() { if (this.mode === 'slot' && Date.now() - this.lastPush > 600) app().session.push(); this.lastPush = Date.now(); }
    set(id, value) {
      this.touch(); this.fx.p[id] = value;
      if (this.mode === 'slot') { if (!R.liveUpdate(this.fx, id, value)) app().multiChanged(); if (AS.rackpanel) AS.rackpanel.P.body && AS.rackpanel.render(); }
      else if (this.pv && !R.liveUpdate(this.fx, id, value)) this.restartPreview();
      if (VIS[this.type] || this.type === 'pitchshift') for (const c of this.ctrls) c.update && c.id === undefined && c.update();
    }
    togglePower() {
      this.touch(); this.fx.bypass = !this.fx.bypass; this.updatePowerBtn();
      if (this.mode === 'slot') { app().multi.rebuildHeads(); app().multiChanged(true); if (AS.rackpanel && AS.rackpanel.P.body) AS.rackpanel.render(); } else if (this.pv) this.restartPreview();
    }
    /* ---- presets ---- */
    fillPresets() {
      const user = userPresets(this.type), b = builtins(this.type);
      this.pre.innerHTML = b.map((p) => `<option value="b:${esc(p.name)}">${esc(p.name)}</option>`).join('') + (Object.keys(user).length ? `<optgroup label="User">${Object.keys(user).map((n) => `<option value="u:${esc(n)}">${esc(n)}</option>`).join('')}</optgroup>` : '');
      this.pre.value = this.presetVal || 'b:(Default)'; if (this.pre.value !== (this.presetVal || 'b:(Default)')) this.pre.value = 'b:(Default)';
    }
    applyPreset(val) {
      const kind = val.slice(0, 1), name = val.slice(2), pr = kind === 'b' ? builtins(this.type).find((x) => x.name === name) : userPresets(this.type)[name] && { p: userPresets(this.type)[name].p };
      if (!pr) return; this.touch(); this.presetVal = val;
      this.fx.p = { ...clone(this.def.defaults), ...clone(pr.p) }; this.refresh();
      let all = true; for (const id of Object.keys(this.fx.p)) if (!R.liveUpdate(this.fx, id, this.fx.p[id])) all = false;
      if (this.mode === 'slot') { if (!all || true) app().multiChanged(true); if (AS.rackpanel && AS.rackpanel.P.body) AS.rackpanel.render(); } else if (this.pv && !all) this.restartPreview();
    }
    async savePreset() {
      const r = await UI.dialog({ title: 'Save Preset', okLabel: 'Save', fields: [{ id: 'name', label: 'Preset name', type: 'text', value: this.presetVal && this.presetVal[0] === 'u' ? this.presetVal.slice(2) : 'My ' + this.def.name }] });
      if (!r || !r.name.trim()) return; const all = userPresets(this.type), name = r.name.trim(); all[name] = { p: clone(this.fx.p) }; saveUser(this.type, all); this.presetVal = 'u:' + name; this.fillPresets(); UI.toast(`Preset “${name}” saved.`);
    }
    async deletePreset() {
      const v = this.pre.value; if (!v) return;
      if (v[0] === 'b') { UI.toast('Built-in presets cannot be deleted.'); return; }
      const name = v.slice(2), r = await UI.dialog({ title: 'Delete Preset', okLabel: 'Delete', html: `<p>Delete the preset “${esc(name)}”?</p>` }); if (!r) return;
      const all = userPresets(this.type); delete all[name]; saveUser(this.type, all); this.presetVal = 'b:(Default)'; this.fillPresets();
    }
    /* ---- waveform-editor preview / apply ---- */
    async startPreview() {
      const a = app(), d = a.cur, eng = AS.engine; if (!d || !d.len) { UI.toast('Open an audio file first.'); return; }
      eng.init(); await eng.wl; if (a.playDoc) a.stopPlayback();
      const [s, e] = d.range(), end = Math.min(e, s + Math.round(d.sr * 20)), chs = d.ch.map((c) => c.slice(s, end));
      const t0 = eng.prepare(), ctx = eng.ctx, src = ctx.createBufferSource(); src.buffer = eng.toBuffer(chs, d.sr); src.loop = true;
      const ex = { nodes: [], t0, regs: [], meters: {} }; const out = R.applyRack(ctx, { fx: [this.fx], rackCfg: { power: true, in: 0, out: 0, mix: 100 } }, src, ex); out.connect(eng.master); src.start(t0);
      eng.begin([src, ...ex.nodes], t0, 0, src.buffer.duration, src.buffer.duration); eng.regs = ex.regs; a.playDoc = null; this.pv = { ex, src };
      this.el.querySelector('[data-a=preview]').textContent = '■ Stop';
    }
    stopPreview() { if (!this.pv) return; AS.engine.stop(); this.pv = null; const b = this.el.querySelector('[data-a=preview]'); if (b) b.textContent = '▶ Preview'; }
    togglePreview() { this.pv ? this.stopPreview() : this.startPreview(); }
    restartPreview() { clearTimeout(this._rt); this._rt = setTimeout(() => { if (this.pv) { this.stopPreview(); this.startPreview(); } }, 200); }
    async apply() {
      if (this.fx.bypass) { UI.toast('Turn the effect on (green power button) before applying.'); return; }
      this.stopPreview(); const fxCopy = clone(this.fx), tail = +this.tailEl.value || 0, name = this.def.name; this.close();
      await app().runCustom('Rack Effect - ' + name, (slice, sr) => R.renderFx(fxCopy, slice, sr, tail));
    }
    /* ---- window chrome ---- */
    drag(head) {
      head.addEventListener('mousedown', (e) => { if (e.target.closest('button')) return; const r = this.el.getBoundingClientRect(), dx = e.clientX - r.left, dy = e.clientY - r.top;
        const mv = (ev) => { this.el.style.left = Math.max(0, Math.min(innerWidth - 120, ev.clientX - dx)) + 'px'; this.el.style.top = Math.max(0, Math.min(innerHeight - 40, ev.clientY - dy)) + 'px'; }, up = () => { document.removeEventListener('mousemove', mv); document.removeEventListener('mouseup', up); };
        document.addEventListener('mousemove', mv); document.addEventListener('mouseup', up); e.preventDefault(); });
    }
    close() { this.stopPreview(); this.el.remove(); wins.delete(this.uid); }
    levels(kind) {
      if (this.mode === 'slot') return AS.engine.playing ? AS.engine.meterLevels((kind === 'in' ? 'si:' : 'so:') + this.uid) : [0, 0];
      return this.pv ? R.meterLevels(this.pv.ex.meters, (kind === 'in' ? 'si:' : 'so:') + this.uid) : [0, 0];
    }
    drawMeters() {
      for (const kind of ['in', 'out']) { const cv = this.el.querySelector(`[data-m=${kind}]`), g = cv.getContext('2d'), lv = this.levels(kind); g.fillStyle = '#14161a'; g.fillRect(0, 0, 30, 22); lv.forEach((v, c) => { const db = D.toDb(v), hgt = Math.max(0, Math.min(1, (db + 60) / 60)) * 20; g.fillStyle = db > -3 ? '#e8503a' : db > -12 ? '#d9c24a' : '#2fb67c'; g.fillRect(2 + c * 14, 21 - hgt, 12, hgt); }); }
    }
    update() {
      if (this.mode === 'slot') {
        const owner = resolveOwner(this.ref), fx = owner && (owner.fx || []).find((f) => f && f.uid === this.uid);
        if (!fx) { this.close(); return; }
        if (fx !== this.fx) { this.fx = fx; this.refresh(); }
        const idx = owner.fx.indexOf(fx) + 1, nm = this.ref.kind === 'master' ? 'Master' : this.ref.kind === 'track' ? 'Track: ' + owner.name : 'Clip: ' + owner.name;
        this.locEl.textContent = nm + ' | Slot ' + idx; this.updatePowerBtn();
      } else { const d = app().cur; this.locEl.textContent = d ? 'File: ' + d.name + ' | ' + (d.hasSel() ? 'Selection' : 'Entire file') : 'No file'; }
      this.drawMeters(); if (this.tick) this.tick();
    }
  }
  function resolveOwner(ref) { const s = app().session; if (ref.kind === 'master') return s.master; if (ref.kind === 'track') return s.tracks.find((t) => t.id === ref.id); const f = s.findClip(ref.id); return f && f.c; }

  let looping = false;
  function loop() { if (!wins.size) { looping = false; return; } for (const w of [...wins.values()]) { try { w.update(); } catch (e) { console.error(e); } } requestAnimationFrame(loop); }
  const ensureLoop = () => { if (!looping) { looping = true; requestAnimationFrame(loop); } };

  /* ================= public API ================= */
  function openSlot(owner, idx, label) {
    const a = app(), s = a.session, fx = (owner.fx || [])[idx]; if (!fx) return null;
    if (!fx.uid) fx.uid = R.uid(); const existing = wins.get(fx.uid); if (existing) { existing.el.style.zIndex = 901; existing.el.classList.add('flash'); setTimeout(() => existing.el.classList.remove('flash'), 900); return existing; }
    const ref = owner === s.master ? { kind: 'master' } : owner.clips ? { kind: 'track', id: owner.id } : { kind: 'clip', id: owner.id };
    const w = new FxWin({ type: fx.type, fx, mode: 'slot', ref, label }); wins.set(fx.uid, w); ensureLoop(); return w;
  }
  function openWave(type) {
    const fx = R.newFx(type); const w = new FxWin({ type, fx, mode: 'wave' }); wins.set(fx.uid, w); ensureLoop(); return w;
  }
  /* Effects menu entry for a rack effect */
  function openFromMenu(type) {
    const a = app(); if (!R.RACK[type]) return;
    if (a.mode === 'multi') {
      const s = a.session; let owner, label;
      if (s.sel && s.findClip(s.sel)) { owner = s.findClip(s.sel).c; label = 'Clip'; } else { owner = s.tracks.find((t) => t.id === a.selTrack) || s.tracks[0]; label = 'Track'; }
      const slots = R.slots(owner); while (slots.length < R.SLOTS) slots.push(null);
      const i = slots.findIndex((f) => !f); if (i < 0) { UI.toast('All 16 effect slots are in use — remove one first.', 'error'); return; }
      s.push(); slots[i] = R.newFx(type); R.cfgOf(owner); a.multi.rebuildHeads(); a.multiChanged(true); if (AS.rackpanel && AS.rackpanel.P.body) AS.rackpanel.render(); AS.panels && AS.panels.refreshAll();
      return openSlot(owner, i, label);
    }
    if (!a.cur) { UI.toast('Open an audio file first.'); return; }
    return openWave(type);
  }
  AS.fxmodal = { openSlot, openWave, openFromMenu, wins, FXPRESETS, builtins, userPresets, BODIES, VIS };
})(window);

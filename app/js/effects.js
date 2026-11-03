/* Effect / generator registry. Each effect: {id,name,cat,params[],process(chs,sr,p,env)->chs, direct?} */
(function (root) {
  'use strict';
  const D = (root.AS && root.AS.dsp) || require('./dsp.js');
  const R = (id, label, min, max, value, step, unit) => ({ id, label, type: 'range', min, max, value, step: step || 0.1, unit: unit || '' });
  const S = (id, label, options, value) => ({ id, label, type: 'select', options, value: value !== undefined ? value : options[0][0] });
  const C = (id, label, value) => ({ id, label, type: 'check', value: !!value });

  const eqBand = (n, f, g, q) => [R('f' + n, `Band ${n} freq`, 20, 20000, f, 1, 'Hz'), R('g' + n, `Band ${n} gain`, -24, 24, g, 0.1, 'dB'), R('q' + n, `Band ${n} Q`, 0.1, 10, q, 0.05)];

  const FX = [
    /* ---- Amplitude & Compression ---- */
    { id: 'amplify', cat: 'Amplitude and Compression', name: 'Amplify...', params: [R('gain', 'Gain', -60, 36, 6, 0.1, 'dB')], process: (c, sr, p) => D.gainCh(c, p.gain) },
    { id: 'normalize', cat: 'Amplitude and Compression', name: 'Normalize...', params: [R('target', 'Normalize to', -40, 0, -1, 0.1, 'dB peak'), C('perch', 'Normalize each channel independently', false), C('dc', 'Remove DC offset', true)], process: (c, sr, p) => D.normalize(c, p.target, p.perch, p.dc) },
    { id: 'loudnorm', cat: 'Amplitude and Compression', name: 'Loudness Normalize (LUFS)...', params: [R('target', 'Target loudness', -40, -5, -16, 0.1, 'LUFS'), R('ceil', 'True-peak ceiling', -12, 0, -1, 0.1, 'dB')],
      // the ceiling is a true-peak ceiling (4× oversampled, dBTP): inter-sample peaks are limited too
      process: (c, sr, p) => { const l = D.loudness(c, sr); if (!isFinite(l)) return D.cloneCh(c); let out = D.gainCh(c, p.target - l); const pk = D.toDb(D.truePeak(out).peak); if (pk > p.ceil) out = D.limiterTP(out, sr, p.ceil, 5, 100); return out; } },
    { id: 'fadein', cat: 'Amplitude and Compression', name: 'Fade In', direct: true, params: [S('curve', 'Curve', [['linear', 'Linear'], ['cosine', 'Cosine (S-curve)'], ['log', 'Logarithmic'], ['exp', 'Exponential']])], process: (c, sr, p) => D.ramp(c, -100, 0, p.curve) },
    { id: 'fadeout', cat: 'Amplitude and Compression', name: 'Fade Out', direct: true, params: [S('curve', 'Curve', [['linear', 'Linear'], ['cosine', 'Cosine (S-curve)'], ['log', 'Logarithmic'], ['exp', 'Exponential']])], process: (c, sr, p) => D.ramp(c, 0, -100, p.curve === 'log' ? 'exp' : p.curve === 'exp' ? 'log' : p.curve) },
    { id: 'envelope', cat: 'Amplitude and Compression', name: 'Gain Ramp...', params: [R('start', 'Start gain', -100, 24, -6, 0.5, 'dB'), R('end', 'End gain', -100, 24, 0, 0.5, 'dB'), S('curve', 'Curve', [['linear', 'Linear'], ['cosine', 'Cosine'], ['log', 'Logarithmic'], ['exp', 'Exponential']])], process: (c, sr, p) => D.ramp(c, p.start, p.end, p.curve) },
    { id: 'compressor', cat: 'Amplitude and Compression', name: 'Dynamics Processing: Compressor...', params: [R('thr', 'Threshold', -60, 0, -20, 0.5, 'dB'), R('ratio', 'Ratio', 1, 20, 3, 0.1, ': 1'), R('att', 'Attack', 0, 200, 10, 1, 'ms'), R('rel', 'Release', 5, 2000, 150, 5, 'ms'), R('knee', 'Knee', 0, 24, 6, 0.5, 'dB'), R('makeup', 'Output gain', -12, 24, 0, 0.5, 'dB')], process: (c, sr, p) => D.compressor(c, sr, p.thr, p.ratio, p.att, p.rel, p.makeup, p.knee) },
    { id: 'limiter', cat: 'Amplitude and Compression', name: 'Hard Limiter...', params: [R('ceil', 'Maximum amplitude', -30, 0, -1, 0.1, 'dB'), R('look', 'Look-ahead', 0.5, 20, 5, 0.5, 'ms'), R('rel', 'Release', 10, 1000, 100, 5, 'ms'), R('boost', 'Input boost', 0, 24, 0, 0.5, 'dB'), C('tp', 'True Peak limiting (4× oversampled, dBTP)', false)],
      process: (c, sr, p) => (p.tp ? D.limiterTP : D.limiter)(p.boost ? D.gainCh(c, p.boost) : c, sr, p.ceil, p.look, p.rel) },
    { id: 'gate', cat: 'Amplitude and Compression', name: 'Dynamics Processing: Noise Gate...', params: [R('thr', 'Threshold', -80, 0, -45, 0.5, 'dB'), R('floor', 'Reduction', -80, 0, -60, 1, 'dB'), R('att', 'Attack', 0, 100, 3, 1, 'ms'), R('hold', 'Hold', 0, 500, 40, 1, 'ms'), R('rel', 'Release', 5, 1000, 120, 5, 'ms')], process: (c, sr, p) => D.gate(c, sr, p.thr, p.floor, p.att, p.hold, p.rel) },
    { id: 'dcoffset', cat: 'Amplitude and Compression', name: 'Remove DC Offset', direct: true, params: [], process: (c) => D.dcRemove(c) },
    { id: 'invert', cat: 'Amplitude and Compression', name: 'Invert', direct: true, params: [], process: (c) => D.invert(c) },
    { id: 'reverse', cat: 'Amplitude and Compression', name: 'Reverse', direct: true, params: [], process: (c) => D.reverse(c) },
    { id: 'silence', cat: 'Amplitude and Compression', name: 'Silence', direct: true, params: [], process: (c) => D.silence(c) },

    /* ---- Filter and EQ ---- */
    { id: 'peq', cat: 'Filter and EQ', name: 'Parametric Equalizer...', params: [R('lsF', 'Low shelf freq', 20, 1000, 100, 1, 'Hz'), R('lsG', 'Low shelf gain', -24, 24, 0, 0.1, 'dB'), ...eqBand(1, 250, 0, 1), ...eqBand(2, 1000, 0, 1), ...eqBand(3, 4000, 0, 1), R('hsF', 'High shelf freq', 2000, 20000, 8000, 1, 'Hz'), R('hsG', 'High shelf gain', -24, 24, 0, 0.1, 'dB')],
      process: (c, sr, p) => D.eqBands(c, sr, [{ type: 'lowshelf', f: p.lsF, q: 0.707, gain: p.lsG }, { type: 'peaking', f: p.f1, q: p.q1, gain: p.g1 }, { type: 'peaking', f: p.f2, q: p.q2, gain: p.g2 }, { type: 'peaking', f: p.f3, q: p.q3, gain: p.g3 }, { type: 'highshelf', f: p.hsF, q: 0.707, gain: p.hsG }]) },
    { id: 'geq', cat: 'Filter and EQ', name: 'Graphic Equalizer (10 Bands)...',
      params: [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000].map((f, i) => R('b' + i, f >= 1000 ? f / 1000 + ' kHz' : f + ' Hz', -18, 18, 0, 0.1, 'dB')),
      process: (c, sr, p) => D.eqBands(c, sr, [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000].map((f, i) => ({ type: 'peaking', f, q: 1.41, gain: p['b' + i] }))) },
    { id: 'hpf', cat: 'Filter and EQ', name: 'High-Pass Filter...', params: [R('f', 'Cutoff', 20, 5000, 80, 1, 'Hz'), R('order', 'Order (x12 dB/oct)', 1, 4, 2, 1)], process: (c, sr, p) => D.filterCh(c, sr, 'highpass', p.f, 0.707, 0, p.order) },
    { id: 'lpf', cat: 'Filter and EQ', name: 'Low-Pass Filter...', params: [R('f', 'Cutoff', 200, 20000, 12000, 1, 'Hz'), R('order', 'Order (x12 dB/oct)', 1, 4, 2, 1)], process: (c, sr, p) => D.filterCh(c, sr, 'lowpass', p.f, 0.707, 0, p.order) },
    { id: 'bpf', cat: 'Filter and EQ', name: 'Band-Pass Filter...', params: [R('f', 'Center', 40, 16000, 1000, 1, 'Hz'), R('q', 'Q', 0.2, 20, 2, 0.1)], process: (c, sr, p) => D.filterCh(c, sr, 'bandpass', p.f, p.q) },
    { id: 'notch', cat: 'Filter and EQ', name: 'Notch Filter...', params: [R('f', 'Frequency', 20, 16000, 1000, 1, 'Hz'), R('q', 'Q', 0.5, 60, 10, 0.5)], process: (c, sr, p) => D.filterCh(c, sr, 'notch', p.f, p.q) },

    /* ---- Time and Pitch ---- */
    { id: 'stretch', cat: 'Time and Pitch', name: 'Stretch (Time, no pitch change)...', params: [R('pct', 'Stretch', 25, 400, 100, 0.5, '% of original length')], process: (c, sr, p) => D.timeStretch(c, sr, p.pct / 100) },
    { id: 'remix', cat: 'Time and Pitch', name: 'Music Remix (fit to length)...', params: [R('pct', 'Target length', 40, 200, 70, 1, '% of original'), R('minplay', 'Minimum play between edits', 4, 30, 10, 1, 's'), C('fine', 'Fine-tune exact length with time-stretch', true)], process: (c, sr, p) => D.musicRemix(c, sr, p.pct / 100, p.minplay, p.fine) },
    { id: 'pitch', cat: 'Time and Pitch', name: 'Pitch Shifter (keep duration)...', params: [R('semi', 'Semitones', -12, 12, 2, 0.01, 'st'), R('cents', 'Cents', -100, 100, 0, 1, 'ct')], process: (c, sr, p) => D.pitchShift(c, sr, p.semi + p.cents / 100) },
    { id: 'speed', cat: 'Time and Pitch', name: 'Varispeed (Speed + Pitch)...', params: [R('pct', 'Speed', 25, 400, 100, 0.5, '%')], process: (c, sr, p) => c.map((x) => D.resample(x, 100 / p.pct)) },

    /* ---- Delay and Echo / Modulation / Reverb ---- */
    { id: 'delay', cat: 'Delay and Echo', name: 'Echo...', params: [R('ms', 'Delay', 1, 2000, 300, 1, 'ms'), R('fb', 'Feedback', 0, 0.95, 0.35, 0.01), R('mix', 'Wet mix', 0, 1, 0.5, 0.01)], process: (c, sr, p) => D.echo(c, sr, p.ms, p.fb, p.mix) },
    { id: 'chorus', cat: 'Modulation', name: 'Chorus...', params: [R('rate', 'Rate', 0.05, 5, 0.8, 0.05, 'Hz'), R('depth', 'Depth', 0.5, 15, 4, 0.1, 'ms'), R('mix', 'Mix', 0, 1, 0.5, 0.01)], process: (c, sr, p) => D.modDelay(c, sr, { base: 18, depth: p.depth, rate: p.rate, fb: 0, mix: p.mix, stereo: 0.25 }) },
    { id: 'flanger', cat: 'Modulation', name: 'Flanger...', params: [R('rate', 'Rate', 0.05, 5, 0.3, 0.05, 'Hz'), R('depth', 'Depth', 0.2, 8, 2.5, 0.1, 'ms'), R('fb', 'Feedback', -0.9, 0.9, 0.5, 0.01), R('mix', 'Mix', 0, 1, 0.6, 0.01)], process: (c, sr, p) => D.modDelay(c, sr, { base: 0.5, depth: p.depth, rate: p.rate, fb: p.fb, mix: p.mix, stereo: 0.1 }) },
    { id: 'vibrato', cat: 'Modulation', name: 'Vibrato...', params: [R('rate', 'Rate', 0.5, 15, 5, 0.1, 'Hz'), R('depth', 'Depth', 0.1, 5, 1, 0.1, 'ms')], process: (c, sr, p) => D.modDelay(c, sr, { base: 1, depth: p.depth, rate: p.rate, fb: 0, mix: 1, dryOnly: true, stereo: 0 }) },
    { id: 'phaser', cat: 'Modulation', name: 'Phaser...', params: [R('rate', 'Rate', 0.05, 5, 0.5, 0.05, 'Hz'), R('depth', 'Depth', 0.1, 1, 0.7, 0.01), R('fb', 'Feedback', 0, 0.9, 0.4, 0.01), R('stages', 'Stages', 2, 12, 6, 2), R('mix', 'Mix', 0, 1, 0.7, 0.01)], process: (c, sr, p) => D.phaser(c, sr, p.rate, p.depth, p.fb, p.mix, p.stages) },
    { id: 'tremolo', cat: 'Modulation', name: 'Tremolo...', params: [R('rate', 'Rate', 0.1, 30, 5, 0.1, 'Hz'), R('depth', 'Depth', 0, 1, 0.6, 0.01)], process: (c, sr, p) => D.tremolo(c, sr, p.rate, p.depth) },
    { id: 'reverb', cat: 'Reverb', name: 'Reverb...', params: [R('room', 'Room size', 0, 1, 0.6, 0.01), R('damp', 'Damping', 0, 1, 0.45, 0.01), R('wet', 'Wet', 0, 1, 0.3, 0.01), R('dry', 'Dry', 0, 1, 0.8, 0.01), R('width', 'Stereo width', 0, 1, 1, 0.01)], process: (c, sr, p) => D.reverb(c, sr, p.room, p.damp, p.wet, p.dry, p.width) },

    /* ---- Distortion ---- */
    { id: 'distortion', cat: 'Special', name: 'Distortion...', params: [R('drive', 'Drive', 1, 40, 6, 0.1), R('mix', 'Mix', 0, 1, 1, 0.01), R('out', 'Output', -24, 6, -6, 0.5, 'dB')], process: (c, sr, p) => D.distortion(c, p.drive, p.mix, p.out) },
    { id: 'bitcrush', cat: 'Special', name: 'Bit Crusher...', params: [R('bits', 'Bit depth', 1, 16, 8, 1, 'bits'), R('down', 'Downsample', 1, 64, 4, 1, 'x')], process: (c, sr, p) => D.bitcrush(c, p.bits, p.down) },

    /* ---- Stereo ---- */
    { id: 'width', cat: 'Stereo Imagery', name: 'Stereo Width...', params: [R('w', 'Width', 0, 3, 1.5, 0.05, 'x')], process: (c, sr, p) => D.stereoWidth(c, p.w) },
    { id: 'balance', cat: 'Stereo Imagery', name: 'Balance (Pan)...', params: [R('pan', 'Balance (L -1 ... R +1)', -1, 1, 0, 0.01)], process: (c, sr, p) => D.balance(c, p.pan) },
    { id: 'swap', cat: 'Stereo Imagery', name: 'Swap Left/Right', direct: true, params: [], process: (c) => (c.length > 1 ? [c[1].slice(), c[0].slice(), ...c.slice(2).map((x) => x.slice())] : D.cloneCh(c)) },
    { id: 'vocalremove', cat: 'Stereo Imagery', name: 'Center Channel Cut (Vocal Remover)', direct: true, params: [], process: (c) => D.centerRemove(c) },

    /* ---- Noise Reduction / Restoration ---- */
    { id: 'nr', cat: 'Noise Reduction / Restoration', name: 'Noise Reduction (uses captured profile)...', needsProfile: true, params: [R('red', 'Noise reduction', 3, 60, 20, 1, 'dB'), R('alpha', 'Sensitivity', 0.5, 4, 1.6, 0.05), R('smooth', 'Spectral smoothing', 0, 0.98, 0.7, 0.01)], process: (c, sr, p, env) => { if (!env.noiseProfile) throw new Error('Capture a noise print first (select a noise-only region, then Effects > Capture Noise Print).'); return D.noiseReduce(c, env.noiseProfile, p.red, p.alpha, p.smooth); } },
    { id: 'anr', cat: 'Noise Reduction / Restoration', name: 'Adaptive Noise Reduction...', params: [R('red', 'Noise reduction', 3, 40, 14, 1, 'dB'), R('alpha', 'Sensitivity', 0.5, 4, 1.5, 0.05), R('smooth', 'Spectral smoothing', 0, 0.98, 0.75, 0.01), R('track', 'Noise tracking speed', 0, 1, 0.4, 0.05)], process: (c, sr, p) => D.adaptiveNR(c, p.red, p.alpha, p.smooth, p.track) },
    { id: 'leveler', cat: 'Amplitude and Compression', name: 'Speech Volume Leveler...', params: [R('target', 'Target level', -40, -6, -20, 0.5, 'dB RMS'), R('boost', 'Max boost', 0, 30, 15, 0.5, 'dB'), R('cut', 'Max cut', 0, 30, 12, 0.5, 'dB'), R('floor', 'Noise floor (no boost below)', -80, -20, -50, 1, 'dB')], process: (c, sr, p) => D.speechLeveler(c, sr, p.target, p.boost, p.cut, p.floor) },
    { id: 'soundremove', cat: 'Noise Reduction / Restoration', name: 'Sound Remover (learns from captured sound)...', needsProfile: true, params: [R('red', 'Removal strength', 6, 60, 30, 1, 'dB'), R('ku', 'Unwanted-sound components', 2, 16, 6, 1), R('kr', 'Other-sound components', 4, 32, 12, 1), R('iters', 'Learning iterations', 8, 60, 20, 1)], process: (c, sr, p, env) => { const pr = env.noiseProfile; if (!pr || !pr.audio) throw new Error('Select a few seconds of the unwanted sound alone, then choose Effects > Capture Noise Print.'); return D.soundRemoveNMF(c, sr, pr.audio, pr.sr, p.ku, p.kr, p.iters, p.red); } },    { id: 'click', cat: 'Noise Reduction / Restoration', name: 'Click / Pop Eliminator...', params: [R('sens', 'Sensitivity (lower = more)', 4, 40, 12, 0.5), R('len', 'Max click length', 4, 200, 48, 1, 'samples')], process: (c, sr, p) => D.clickRemove(c, p.sens, p.len) },
    { id: 'dehum', cat: 'Noise Reduction / Restoration', name: 'DeHummer...', params: [S('base', 'Mains frequency', [[50, '50 Hz'], [60, '60 Hz']], 50), R('harm', 'Harmonics', 1, 12, 5, 1), R('q', 'Q', 5, 80, 30, 1)], process: (c, sr, p) => D.deHum(c, sr, +p.base, p.harm, p.q) },
    { id: 'deess', cat: 'Noise Reduction / Restoration', name: 'DeEsser...', params: [R('f', 'Sibilance frequency', 3000, 10000, 6500, 50, 'Hz'), R('thr', 'Threshold', -60, 0, -30, 1, 'dB'), R('ratio', 'Ratio', 1, 12, 4, 0.1)], process: (c, sr, p) => D.deEss(c, sr, p.f, p.thr, p.ratio) },
  ];

  /* ---- offline "(process)" tools (destructive, applied to the selection / selected clip) ---- */
  const CURVE = (id, label, value, o) => ({ id, label, type: 'curve', value, opts: o });
  const TICKS_T = [[0, '0%'], [0.25, '25%'], [0.5, '50%'], [0.75, '75%'], [1, '100%']];
  const DEREVERB_FOCUS = S('focus', 'Processing focus', [['all', 'All frequencies'], ['low', 'Low frequencies'], ['mid', 'Mid frequencies (speech)'], ['high', 'High frequencies']], 'all');
  const SHAPES = S('shape', 'Curve between points', [['linear', 'Linear'], ['cosine', 'Cosine (S-curve)'], ['log', 'Logarithmic'], ['exp', 'Exponential']]);
  FX.push(
    { id: 'fadeenv', cat: 'Amplitude and Compression', name: 'Fade Envelope (process)...', params: [CURVE('pts', 'Fade envelope', [{ x: 0, y: -60 }, { x: 1, y: 0 }], { yMin: -60, yMax: 12, fixedEnds: true, xTicks: TICKS_T, yTicks: [[-60, '-60'], [-40, '-40'], [-20, '-20'], [0, '0'], [12, '+12']], xFmt: (v) => Math.round(v * 100) + '%', yFmt: (v) => v.toFixed(1) + ' dB', xMin: 0, xMax: 1 }), SHAPES], process: (c, sr, p) => D.gainEnvelope(c, p.pts, p.shape) },
    { id: 'gainenv', cat: 'Amplitude and Compression', name: 'Gain Envelope (process)...', params: [CURVE('pts', 'Gain envelope', [{ x: 0, y: 0 }, { x: 0.5, y: 0 }, { x: 1, y: 0 }], { yMin: -40, yMax: 24, fixedEnds: true, xTicks: TICKS_T, yTicks: [[-40, '-40'], [-20, '-20'], [0, '0'], [12, '+12'], [24, '+24']], xFmt: (v) => Math.round(v * 100) + '%', yFmt: (v) => v.toFixed(1) + ' dB', xMin: 0, xMax: 1 }), SHAPES], process: (c, sr, p) => D.gainEnvelope(c, p.pts, p.shape) },
    { id: 'declicker', cat: 'Diagnostics', name: 'DeClicker (process)...', params: [R('sens', 'Sensitivity (lower = more clicks)', 4, 40, 10, 0.5), R('len', 'Maximum click length', 4, 200, 40, 1, 'samples')], process: (c, sr, p) => D.clickRemove(c, p.sens, p.len) },
    { id: 'declip', cat: 'Diagnostics', name: 'DeClipper (process)...', params: [R('thr', 'Clipping threshold', 50, 99.9, 97, 0.1, '% of peak'), R('run', 'Minimum clipped run', 2, 50, 3, 1, 'samples')], process: (c, sr, p) => D.declip(c, p.thr, p.run) },
    { id: 'delsilence', cat: 'Diagnostics', name: 'Delete Silence (process)...', params: [R('thr', 'Silence below', -80, -20, -50, 1, 'dB'), R('min', 'Silence longer than', 50, 5000, 400, 10, 'ms'), R('keep', 'Keep around speech', 0, 1000, 100, 5, 'ms')], process: (c, sr, p) => D.deleteSilence(c, sr, p.thr, p.min, p.keep) },
    { id: 'markaudio', cat: 'Diagnostics', name: 'Mark Audio (process)...', marks: true, params: [R('thr', 'Silence below', -80, -20, -50, 1, 'dB'), R('minSil', 'Silence at least', 50, 5000, 300, 10, 'ms'), R('minAud', 'Audio at least', 10, 2000, 200, 10, 'ms')], process: (c) => D.cloneCh(c) },
    { id: 'dereverb', cat: 'Noise Reduction / Restoration', name: 'DeReverb (process)...', params: [R('amount', 'Amount', 0, 100, 60, 1, '%'), DEREVERB_FOCUS, R('gain', 'Gain compensation', -12, 24, 0, 0.5, 'dB'), C('auto', 'Auto gain compensation (keep the loudness)', true), R('t60', 'Room decay T60 (0 = estimate from the audio)', 0, 8, 0, 0.05, 's')],
      // auto gain: the removed reverb lowers the loudness; bring it back (at most +12 dB) before the manual gain
      process: (c, sr, p) => { const o = D.dereverb(c, sr, p.amount, p.focus, p.gain, p.t60); if (!p.auto) return o; const a = D.loudness(c, sr), b = D.loudness(o, sr); return isFinite(a) && isFinite(b) ? D.gainCh(o, Math.min(12, a - b)) : o; } },
    { id: 'hiss', cat: 'Noise Reduction / Restoration', name: 'Hiss Reduction (process)...', params: [R('from', 'Reduce hiss above', 1000, 16000, 4000, 50, 'Hz'), R('red', 'Amount', 3, 40, 15, 1, 'dB'), R('sens', 'Sensitivity', 0.5, 4, 1.6, 0.05), R('smooth', 'Spectral smoothing', 0, 0.98, 0.6, 0.01)], process: (c, sr, p) => D.hissReduce(c, sr, p.from, p.red, p.sens, p.smooth) },
    { id: 'doppler', cat: 'Special', name: 'Doppler Shifter (process)...', params: [R('kmh', 'Source speed', 10, 400, 80, 1, 'km/h'), R('close', 'Closest distance', 1, 100, 6, 0.5, 'm'), C('stereo', 'Pan the source across the stereo field', true)], process: (c, sr, p) => D.doppler(c, sr, p.kmh, p.close, p.stereo) },
    { id: 'pitchbend', cat: 'Time and Pitch', name: 'Pitch Bender (process)...', params: [CURVE('pts', 'Pitch over time (semitones)', [{ x: 0, y: 0 }, { x: 1, y: 0 }], { yMin: -12, yMax: 12, fixedEnds: true, xTicks: TICKS_T, yTicks: [[-12, '-12'], [-6, '-6'], [0, '0'], [6, '+6'], [12, '+12']], xFmt: (v) => Math.round(v * 100) + '%', yFmt: (v) => v.toFixed(2) + ' st', xMin: 0, xMax: 1 }), S('prec', 'Precision', [['low', 'Low'], ['medium', 'Medium'], ['high', 'High']], 'medium')], process: (c, sr, p) => D.pitchBend(c, sr, p.pts, p.prec) },
    { id: 'manualpitch', cat: 'Time and Pitch', name: 'Manual Pitch Correction (process)...', params: [R('semi', 'Shift', -12, 12, 0, 0.01, 'st'), R('cents', 'Fine tune', -100, 100, 0, 1, 'ct'), R('xfade', 'Edge crossfade', 0, 200, 25, 1, 'ms')], process: (c, sr, p) => { const o = D.pitchShift(c, sr, p.semi + p.cents / 100), n = Math.round((p.xfade * sr) / 1000), L = c[0].length; return o.map((y, k) => { const x = c[k], r = new Float32Array(L); for (let i = 0; i < L; i++) { const w = n > 0 ? Math.min(1, i / n, (L - 1 - i) / n) : 1; r[i] = x[i] * (1 - w) + y[i] * w; } return r; }); } },
    { id: 'stretchpitch', cat: 'Time and Pitch', name: 'Stretch and Pitch (process)...', params: [R('pct', 'Stretch (length)', 25, 400, 100, 0.5, '%'), R('semi', 'Pitch shift', -12, 12, 0, 0.01, 'st'), R('cents', 'Fine tune', -100, 100, 0, 1, 'ct')], process: (c, sr, p) => { let o = Math.abs(p.pct - 100) > 0.05 ? D.timeStretch(c, sr, p.pct / 100) : D.cloneCh(c); const st = p.semi + p.cents / 100; if (Math.abs(st) > 1e-6) o = D.pitchShift(o, sr, st); return o; } },
  );
  /* Generators: return NEW audio to insert */
  const GEN = [
    { id: 'gsilence', name: 'Silence...', params: [R('dur', 'Duration', 0.01, 600, 1, 0.01, 's')], gen: (sr, nch, p) => Array.from({ length: nch }, () => new Float32Array(Math.round(p.dur * sr))) },
    { id: 'gtone', name: 'Tone...', params: [S('wave', 'Waveform', [['sine', 'Sine'], ['square', 'Square'], ['saw', 'Sawtooth'], ['triangle', 'Triangle']]), R('f0', 'Start frequency', 20, 20000, 440, 1, 'Hz'), R('f1', 'End frequency', 20, 20000, 440, 1, 'Hz'), R('amp', 'Amplitude', -60, 0, -6, 0.5, 'dB'), R('dur', 'Duration', 0.01, 600, 3, 0.01, 's')], gen: (sr, nch, p) => D.genTone(sr, p.dur, p.f0, p.f1, p.wave, p.amp, nch) },
    { id: 'gnoise', name: 'Noise...', params: [S('kind', 'Color', [['white', 'White'], ['pink', 'Pink'], ['brown', 'Brown']]), R('amp', 'Amplitude', -60, 0, -12, 0.5, 'dB'), R('dur', 'Duration', 0.01, 600, 3, 0.01, 's')], gen: (sr, nch, p) => D.genNoise(sr, p.dur, p.kind, p.amp, nch) },
    { id: 'gdtmf', name: 'DTMF Tones...', params: [{ id: 'digits', label: 'Digits', type: 'text', value: '5551234' }, R('tone', 'Tone length', 0.03, 1, 0.12, 0.01, 's'), R('gap', 'Gap', 0, 1, 0.08, 0.01, 's')],
      gen: (sr, nch, p) => {
        const lo = { 1: 697, 2: 697, 3: 697, A: 697, 4: 770, 5: 770, 6: 770, B: 770, 7: 852, 8: 852, 9: 852, C: 852, '*': 941, 0: 941, '#': 941, D: 941 };
        const hi = { 1: 1209, 4: 1209, 7: 1209, '*': 1209, 2: 1336, 5: 1336, 8: 1336, 0: 1336, 3: 1477, 6: 1477, 9: 1477, '#': 1477, A: 1633, B: 1633, C: 1633, D: 1633 };
        const parts = [];
        for (const ch of String(p.digits).toUpperCase()) {
          if (!(ch in lo)) continue;
          const a = D.genTone(sr, p.tone, lo[ch], lo[ch], 'sine', -10, 1)[0], b = D.genTone(sr, p.tone, hi[ch], hi[ch], 'sine', -10, 1)[0];
          const t = new Float32Array(a.length); for (let i = 0; i < t.length; i++) t[i] = (a[i] + b[i]) * 0.5;
          parts.push([t], [new Float32Array(Math.round(p.gap * sr))]);
        }
        if (!parts.length) parts.push([new Float32Array(1)]);
        const mono = D.concatCh(parts, 1)[0];
        return Array.from({ length: nch }, () => mono.slice());
      } },
  ];

  const api = { FX, GEN, byId: (id) => FX.find((f) => f.id === id) || GEN.find((f) => f.id === id), defaults: (fx) => Object.fromEntries(fx.params.map((p) => [p.id, p.type === 'curve' ? JSON.parse(JSON.stringify(p.value)) : p.value])) };
  root.AS = root.AS || {};
  root.AS.effects = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);


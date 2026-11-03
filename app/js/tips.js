/* Tooltips that say what a parameter does — for the offline effect dialogs (Effects menu) and the rack effect windows.
   AS.tips.param(effectId, param) → text. A text for "<effect>.<param>" wins over the one for "<param>" (same id,
   different meaning in some effects); numbered bands (b0…b29, ph0…, b1F…) get theirs from a pattern.
   tests/tips.test.js checks that every parameter of every effect has a tooltip. */
(function (root) {
  'use strict';
  const AS = (root.AS = root.AS || {});
  const T = {
    // amplitude / dynamics
    gain: 'How much louder (+) or quieter (−) the audio becomes.',
    db: 'How much louder (+) or quieter (−) the audio becomes.',
    target: 'The level the audio is brought to.',
    perch: 'Each channel reaches the target on its own (otherwise the loudest channel decides, keeping the balance).',
    dc: 'Removes a constant offset from zero, which wastes headroom and causes clicks at edits.',
    ceil: 'The highest level the output may reach; peaks above it are held down.',
    thr: 'Processing starts when the level goes above (compressor) or below (gate) this level.',
    ratio: 'How strongly the level above the threshold is reduced: 4:1 lets 1 dB through for every 4 dB above it.',
    att: 'How quickly the effect reacts once the threshold is crossed. Short = catches peaks, long = keeps transients.',
    rel: 'How quickly the effect lets go after the level falls back. Too short can pump, too long can sound squashed.',
    knee: 'Soft knee: the compression starts gradually around the threshold instead of switching on at once.',
    makeup: 'Gain added after compression to bring the overall level back up.',
    look: 'The limiter looks this far ahead so it can turn the gain down before a peak arrives (no distortion).',
    boost: 'Gain applied before limiting / levelling — more boost = louder, with more limiting.',
    tp: 'Also catches peaks between samples (inter-sample / true peaks), so the file does not clip after MP3 / AAC encoding.',
    floor: 'How far the sound is turned down while the gate is closed.',
    hold: 'How long the gate stays open after the level drops, so word endings are not cut off.',
    cut: 'The most the leveler may turn loud passages down.',
    speed: 'How fast the leveler follows changes in level.',
    inG: 'Gain into the compressor.',
    tube: 'Adds warm, tube-like harmonic saturation.',
    gateOn: 'Turns the noise gate section on.', gateThr: 'Below this level the gate closes (silences the audio).',
    compOn: 'Turns the compressor section on.', compThr: 'Above this level the compressor reduces the gain.', compRatio: 'How strongly the compressor reduces the level above its threshold.',
    limOn: 'Turns the limiter section on.', limCeil: 'The limiter never lets the output go above this level.',
    expOn: 'Turns the downward expander on: quiet parts (noise, room) get quieter.', expThr: 'Below this level the expander turns the sound down.', expRange: 'The most the expander may turn quiet parts down.',
    amount: 'How far the music is turned down while the key (speech) track is active.',
    sc: 'Another track (or bus) that controls this effect — e.g. duck the music when the voice track plays.',
    x1: 'Crossover between the low and the mid band.', x2: 'Crossover between the mid and the high band.',
    lThr: 'Threshold of the low band.', lRatio: 'Ratio of the low band.', lGain: 'Output gain of the low band.',
    mThr: 'Threshold of the mid band.', mRatio: 'Ratio of the mid band.', mGain: 'Output gain of the mid band.',
    hThr: 'Threshold of the high band.', hRatio: 'Ratio of the high band.', hGain: 'Output gain of the high band.',
    out: 'Output level after the effect.',
    link: 'Moves the left and right gain together.', dbL: 'Gain of the left channel.', dbR: 'Gain of the right channel.',
    // fades / envelopes
    curve: 'The shape of the fade: linear, logarithmic (fast start) or exponential (slow start), or S-curve.',
    start: 'Gain at the start of the selection.', end: 'Gain at the end of the selection.',
    pts: 'Drag the points on the curve; double-click to add or remove a point.',
    shape: 'Straight lines or smooth curves between the points.',
    // filters / EQ
    f: 'The frequency the filter works at (cutoff, centre or notch frequency).',
    q: 'How narrow the band is: higher Q = narrower, more precise.',
    order: 'Steepness of the filter: each step adds 12 dB per octave.',
    type: 'The kind of filter (low-pass, high-pass, band-pass, …).',
    lsF: 'Frequencies below this are raised or lowered by the low shelf.', lsG: 'How much the low shelf raises (+) or lowers (−) the bass.', lsQ: 'Slope of the low shelf.',
    hsF: 'Frequencies above this are raised or lowered by the high shelf.', hsG: 'How much the high shelf raises (+) or lowers (−) the treble.', hsQ: 'Slope of the high shelf.',
    hpOn: 'Turns the high-pass (low cut) filter on.', hpF: 'Frequencies below this are cut.', lpOn: 'Turns the low-pass (high cut) filter on.', lpF: 'Frequencies above this are cut.',
    qmode: 'Show bandwidth as Q or as width in octaves.', ultra: 'Higher-precision filtering for very quiet, critical material (uses more CPU).',
    range: 'Vertical range of the EQ graph.', master: 'Overall gain after the equalizer.',
    lowG: 'Raises (+) or lowers (−) the low frequencies.', midF: 'Centre of the mid band.', midG: 'Raises (+) or lowers (−) the mid frequencies.', midQ: 'Width of the mid band.', highG: 'Raises (+) or lowers (−) the high frequencies.',
    ftype: 'Filter design: Butterworth (flat), Chebyshev (steeper with ripple), Bessel (clean timing), Elliptic (steepest).',
    rp: 'Allowed ripple in the passband (Chebyshev 1 / elliptic): more ripple = steeper.', rs: 'How far the stopband is attenuated (Chebyshev 2 / elliptic).',
    size: 'FFT / impulse / room size: larger = finer frequency detail or a bigger space, more latency.',
    // time / pitch
    pct: 'New length or speed in percent of the original.',
    semi: 'Pitch change in semitones (12 = one octave).', cents: 'Fine pitch change in cents (100 cents = 1 semitone).',
    minplay: 'Edits are never closer together than this, so the remix stays musical.', fine: 'After the remix, stretch it slightly so it hits the target length exactly.',
    prec: 'Higher precision follows the pitch curve more closely (slower).', precision: 'Higher precision = better quality, more processing.',
    splice: 'How often the pitch shifter splices the audio; lower suits low voices.', overlap: 'How much the splices overlap: more = smoother, more phasing.', auto: 'Choose splice and overlap automatically for the material.',
    xfade: 'Crossfade at the edges so the changed part joins the rest without a click.',
    scale: 'Musical scale the pitch is corrected to.', key: 'Key (root note) of the scale.', attack: 'How quickly the pitch is pulled to the right note: fast = robotic, slow = natural.',
    ref: 'Which channel the pitch is detected from.', fft: 'Analysis size: larger detects low notes better, responds more slowly.', calib: 'The frequency of A4 (440 Hz standard).',
    // delay / modulation
    ms: 'Delay time: how long after the original sound the echo (or the delayed channel) is heard.', fb: 'How much of the output is fed back into the delay: more = more repeats / stronger effect.',
    mix: 'Balance between the original (dry) and the processed (wet) sound.',
    rate: 'Speed of the modulation (LFO).', depth: 'How strong the modulation is.', stages: 'Number of phaser stages: more = more notches, a richer sweep.',
    delay: 'Base delay of the voices.', voices: 'Number of chorus voices: more = thicker.',
    image: 'Where the echoes sit in the stereo field.', side: 'Which channel is delayed (Haas effect: widens a mono source).',
    lms: 'Delay of the left channel.', rms: 'Delay of the right channel.', lfb: 'Feedback of the left delay.', rfb: 'Feedback of the right delay.',
    linv: 'Inverts the left echo’s polarity.', rinv: 'Inverts the right echo’s polarity.', units: 'Delay times in milliseconds or in beats of the session tempo.',
    sat: 'Tape-style saturation of the repeats.', flutter: 'Speed wobble of an old tape machine.',
    // reverb
    room: 'Size of the simulated room.', damp: 'How quickly high frequencies die away in the room: more = darker reverb.',
    wet: 'Level of the reverberation.', dry: 'Level of the original sound.', width: 'Stereo width: 0 = mono, 100 % = unchanged, above = wider.',
    decay: 'How long the reverb takes to die away.', pre: 'Time before the reverb starts — separates the voice from the room.',
    er: 'Level of the first reflections from the walls.', diffusion: 'How quickly echoes blend into a smooth tail.', density: 'How dense the reflections are.',
    lowcut: 'Removes low frequencies from the reverb (less mud).', spread: 'How far the reverb spreads to the surround channels.', ir: 'The recorded room (impulse response) that is used.',
    len: 'Length of the decay / click to look for.',
    // distortion / character
    drive: 'How hard the signal is driven into distortion.', bits: 'Fewer bits = more quantisation noise (lo-fi).', down: 'Sample-rate reduction factor (aliasing, lo-fi).',
    comp: 'Amount of compression.', bass: 'Bass tone control.', mid: 'Mid tone control.', treble: 'Treble tone control.', cab: 'Simulates a guitar speaker cabinet.', amb: 'Adds room ambience.',
    tone: 'Tone (brightness) of the sound.',
    // stereo
    w: 'Stereo width: 0 = mono, 100 % = unchanged, 200 % = twice as wide.', pan: 'Moves the sound left (−1) or right (+1).',
    ll: 'How much of the left input goes to the left output.', rl: 'How much of the right input goes to the left output.', lr: 'How much of the left input goes to the right output.', rr: 'How much of the right input goes to the right output.',
    invL: 'Inverts the polarity of the left output.', invR: 'Inverts the polarity of the right output.',
    lo: 'Lowest frequency counted as centre (voice) content.', hi: 'Highest frequency counted as centre content.',
    centerLevel: 'Level of the centre (e.g. the vocal).', restLevel: 'Level of the rest of the middle.', sideLevel: 'Level of the side (stereo) content.',
    center: 'Level of the centre of the stereo image.', bassmono: 'Frequencies below this are made mono (tight bass on all systems).',
    // restoration
    red: 'How much of the noise is removed. Too much makes speech sound watery.',
    alpha: 'How much of the sound counts as noise: higher removes more.',
    smooth: 'Smooths the reduction over frequency to avoid "musical noise" artefacts.',
    track: 'How fast the noise estimate follows changing noise.',
    reduce: 'How much of the noise is removed.',
    sens: 'How readily something is detected: see the label for which direction finds more.',
    base: 'Frequency of the mains hum: 50 Hz (Europe, Asia) or 60 Hz (Americas).', harm: 'How many harmonics of the hum (or notch) are removed too.',
    run: 'Clipping is repaired only where at least this many samples in a row are flat.',
    from: 'Hiss above this frequency is reduced.',
    ku: 'Detail of the model of the sound to remove.', kr: 'Detail of the model of everything else.', iters: 'More iterations learn the sound better (slower).',
    // silence / markers
    min: 'Only silences longer than this are removed.', keep: 'Silence kept before and after each piece of audio so speech does not sound cut.',
    minSil: 'A gap counts as silence when it lasts at least this long.', minAud: 'Audio shorter than this is ignored (clicks, breaths).',
    // generators
    dur: 'Length of the generated audio.', wave: 'Shape of the tone (sine is pure; square / saw are buzzy).', f0: 'Frequency at the start (a sweep goes to the end frequency).',
    amp: 'Level of the generated sound.', kind: 'Noise color: white (bright), pink (equal per octave), brown (dark).',
    digits: 'Phone keys to generate (0-9, *, #, A-D).', gap: 'Silence between the tones.',
    kmh: 'How fast the sound source passes by.', close: 'How close the source passes the listener.', stereo: 'Also moves the sound from one side to the other.',
    mode: 'How the effect works — see the choices.', span: 'Time the radar needs for one turn.',
  };
  /* where the same id means something else */
  const FX = {
    'nr.red': 'How much of the captured noise is removed. Too much makes speech sound watery.',
    'leveler.floor': 'Sound below this level is treated as silence and never boosted (no pumping noise).',
    'leveler.boost': 'The most a quiet passage may be raised.',
    'gate.thr': 'The gate closes when the level falls below this — the sound is turned down by the Reduction amount.',
    'compressor.makeup': 'Gain added after compression to bring the overall level back up.',
    'delsilence.thr': 'Audio quieter than this counts as silence.', 'markaudio.thr': 'Audio quieter than this counts as silence.',
    'declip.thr': 'Samples at or above this level count as clipped.',
    'click.sens': 'Lower values find more (and smaller) clicks.', 'declicker.sens': 'Lower values find more (and smaller) clicks.',
    'click.len': 'Longest gap that is repaired as a click.', 'declicker.len': 'Longest gap that is repaired as a click.',
    'rack:reverb.len': 'How long the reverb tail lasts.',
    'gtone.f1': 'Frequency at the end (sweep). Same as the start frequency for a steady tone.',
    'gdtmf.tone': 'How long each key tone lasts.', 'rack:analogdelay.tone': 'Each repeat gets darker, like tape.',
    'rack:autoduck.att': 'How quickly the music is turned down when the voice starts.', 'rack:autoduck.rel': 'How quickly the music comes back after the voice stops.',
    'rack:autoduck.thr': 'The key (voice) track is "active" above this level.',
    'rack:autopitch.sens': 'How clearly pitched a sound must be before it is corrected.',
    'rack:loudmeter.target': 'The loudness the meter compares against (e.g. −16 LUFS podcast, −23 LUFS broadcast).',
    'rack:loudradar.target': 'The loudness the radar compares against.', 'rack:loudradar.range': 'Loudness range shown from the centre to the edge.',
    'rack:centercut.mix': 'How much of the centre (vocal) is removed.',
    'rack:notch.depth': 'How deep each notch cuts.', 'rack:notch.q': 'Width of each notch.',
    'rack:phaseshift.size': 'Length of the all-pass filter: longer shifts low frequencies more precisely.',
    'rack:convreverb.size': 'How much of the impulse response is used.',
    'rack:fftfilter.size': 'FFT size: larger = steeper, more precise filter curves, more latency.',
    'rack:surroundreverb.size': 'Size of the simulated room.',
    'rack:scifilter.width': 'Width of the band (band-pass / band-stop modes).',
    'rack:vocalenh.mode': 'Male / Female voice or Music: the frequencies that are enhanced.',
    'stretch.pct': 'New length in percent of the original (pitch stays the same).', 'speed.pct': 'Playback speed in percent (pitch changes with it).',
    'remix.pct': 'Target length of the remix.', 'stretchpitch.pct': 'New length in percent (pitch set separately).',
    'manualpitch.semi': 'Pitch change of the selection in semitones.',
    'dereverb.amount': 'How much of the room reverberation is removed. High values can make the voice thin or "underwater".', 'rack:dereverb.amount': 'How much of the room reverberation is removed. High values can make the voice thin or "underwater".',
    'dereverb.focus': 'Which frequencies get the strongest reduction: mid suits speech, low a boomy room, high a bright, hard room.', 'rack:dereverb.focus': 'Which frequencies get the strongest reduction: mid suits speech, low a boomy room, high a bright, hard room.',
    'dereverb.gain': 'Output gain after the reverb is removed (removing reverb makes the audio quieter).', 'rack:dereverb.gain': 'Output gain after the reverb is removed (removing reverb makes the audio quieter).',
    'dereverb.auto': 'Brings the loudness back to what it was before the reverb was removed; Gain compensation is added on top.',
    'dereverb.t60': 'How long the room takes to die away by 60 dB. 0 = measure it from the decays in the audio.', 'rack:dereverb.t60': 'How long the room takes to die away by 60 dB (small room ≈ 0.3 s, hall ≈ 2 s). Longer = more is treated as reverb.',
  };
  const PATTERNS = [
    [/^b(\d+)$/, (m) => `Gain of band ${+m[1] + 1}.`],
    [/^b(\d)F$/, (m) => `Centre frequency of band ${m[1]}.`], [/^b(\d)G$/, (m) => `Gain of band ${m[1]}: + raises, − lowers those frequencies.`], [/^b(\d)Q$/, (m) => `Width (Q) of band ${m[1]}.`],
    [/^f(\d)$/, (m) => `Centre frequency of band ${m[1]}.`], [/^g(\d)$/, (m) => `Gain of band ${m[1]}: + raises, − lowers those frequencies.`], [/^q(\d)$/, (m) => `Width (Q) of band ${m[1]}: higher = narrower.`],
    [/^ph(\d)$/, (m) => `Phase shift of band ${+m[1] + 1}.`],
  ];
  function param(fxId, p) {
    const id = typeof p === 'string' ? p : p.id;
    const own = FX[fxId + '.' + id]; if (own) return own;
    if (T[id]) return T[id];
    for (const [re, f] of PATTERNS) { const m = re.exec(id); if (m) return f(m); }
    return '';
  }
  AS.tips = { param, T, FX };
})(window);

/* Built-in rack presets (names follow the classic broadcast / post-production set). Each preset is a list of
   effect slots plus optional rack settings; parameters not listed fall back to the effect's defaults. */
(function (root) {
  'use strict';
  const AS = (root.AS = root.AS || {});
  const f = (type, p) => ({ type, bypass: false, p: p || {} });
  const hp = (hz, q) => f('filter', { type: 'highpass', f: hz, q: q || 0.707 });
  const lp = (hz, q) => f('filter', { type: 'lowpass', f: hz, q: q || 0.707 });
  const bp = (hz, q) => f('filter', { type: 'bandpass', f: hz, q: q || 1 });
  const FLAT_EQ = () => f('eq', { lowG: 0, midF: 1500, midG: 0, midQ: 1, highG: 0 });
  const comp = (thr, ratio, makeup, att, rel, knee) => f('comp', { thr, ratio, makeup, att: att === undefined ? 10 : att, rel: rel === undefined ? 180 : rel, knee: knee === undefined ? 10 : knee });
  const lim = (ceil) => f('limiter', { ceil: ceil === undefined ? -1 : ceil });

  const LIST = [
    ['AM Radio', () => [hp(300), lp(3500), f('distortion', { drive: 4, mix: 0.4, out: -4 }), comp(-20, 4, 4)]],
    ['Bandpass Reverb', () => [bp(1500, 1.2), f('reverb', { len: 3.5, damp: 0.4, mix: 0.6 })]],
    ['Boxing Announcer', () => [hp(150), f('eq', { lowG: 1, midF: 2500, midG: 4, midQ: 1, highG: 1 }), comp(-26, 5, 6), f('delay', { ms: 120, fb: 0.25, mix: 0.2, image: 'all' }), f('reverb', { len: 2.2, damp: 0.5, mix: 0.35 }), lim()]],
    ['Clean Up and Level Voice Over', () => [hp(80), f('gate', { thr: -52, floor: -30, att: 5, hold: 60, rel: 200 }), f('eq', { lowG: -2, midF: 3000, midG: 2, midQ: 1, highG: 0.5 }), comp(-26, 3, 5), lim()]],
    ['Compressor-EQ (flat)', () => [comp(-20, 2, 0), FLAT_EQ()]],
    ['DeEss and Limit Female Voice Over', () => [hp(100), f('deess', { f: 7500, thr: -32, ratio: 6 }), comp(-24, 3, 4), lim()]],
    ['DeEss and Limit Male Voice Over', () => [hp(70), f('deess', { f: 5500, thr: -32, ratio: 6 }), comp(-24, 3, 4), lim()]],
    ['Delay Center Image (Stereo Only)', () => [f('delay', { ms: 250, fb: 0.3, mix: 0.4, image: 'center' })]],
    ['Delay Side Image (Stereo Only)', () => [f('delay', { ms: 250, fb: 0.3, mix: 0.4, image: 'side' })]],
    ['Double Dose of EQ (flat)', () => [FLAT_EQ(), FLAT_EQ()]],
    ['EQ-Compressor (flat)', () => [FLAT_EQ(), comp(-20, 2, 0)]],
    ['Echo Center Image (Stereo Only)', () => [f('delay', { ms: 420, fb: 0.55, mix: 0.45, image: 'center' })]],
    ['Echo Side Image (Stereo Only)', () => [f('delay', { ms: 420, fb: 0.55, mix: 0.45, image: 'side' })]],
    ['Far Away Source', () => [lp(4500), f('eq', { lowG: 0, midF: 2000, midG: -2, midQ: 1, highG: -6 }), f('reverb', { len: 2.8, damp: 0.7, mix: 0.55 }), f('gain', { db: -6 })]],
    ['Guitar Delay', () => [f('eq', { lowG: 0, midF: 2200, midG: 2, midQ: 0.9, highG: 0 }), comp(-22, 2.5, 2), f('delay', { ms: 380, fb: 0.4, mix: 0.3, image: 'all' })]],
    ['Hip Hop Vocal Chain', () => [hp(100), f('deess', { f: 7000, thr: -30, ratio: 5 }), comp(-22, 4, 4), f('eq', { lowG: 1, midF: 3500, midG: 1.5, midQ: 1, highG: 3 }), f('delay', { ms: 300, fb: 0.2, mix: 0.15, image: 'all' }), lim()]],
    ['Hospital Radio', () => [bp(1100, 0.8), f('distortion', { drive: 2.5, mix: 0.3, out: -3 }), f('reverb', { len: 1.2, damp: 0.7, mix: 0.25 }), comp(-22, 4, 4)]],
    ['Jump to Hyper-space', () => [f('flanger', { rate: 0.6, depth: 3, fb: 0.8, mix: 0.9 }), f('phaser', { rate: 1.5, depth: 900, mix: 0.8 }), f('delay', { ms: 150, fb: 0.5, mix: 0.4, image: 'all' })]],
    ['Karaoke Machine (Stereo Only)', () => [f('centercut', { mix: 1 }), f('eq', { lowG: 2, midF: 1500, midG: 0, midQ: 1, highG: 0 })]],
    ['LP Restoration - Heavy', () => [hp(35), lp(9000), f('gate', { thr: -55, floor: -18, att: 10, hold: 80, rel: 300 }), f('eq', { lowG: 0, midF: 3000, midG: 0, midQ: 1, highG: -3 }), comp(-24, 2, 2)]],
    ['LP Restoration - Light', () => [hp(25), lp(14000)]],
    ['Lift Pop Vocals 3 dB', () => [f('eq', { lowG: 0, midF: 4000, midG: 3, midQ: 0.8, highG: 1 }), comp(-20, 2, 1, 15, 200)]],
    ['Music Enhancer', () => [f('eq', { lowG: 2, midF: 1500, midG: 0, midQ: 1, highG: 3 }), f('widener', { width: 1.3 }), comp(-18, 2, 1, 30, 250)]],
    ['On the Telephone', () => [hp(500), lp(3200), f('distortion', { drive: 2, mix: 0.3, out: -3 }), comp(-22, 4, 4)]],
    ['Podcast Voice', () => [hp(80), f('gate', { thr: -55, floor: -35, att: 5, hold: 60, rel: 200 }), f('eq', { lowG: 1.5, midF: 3000, midG: 2, midQ: 1, highG: 1 }), comp(-24, 3.5, 5), f('deess', { f: 6500, thr: -32, ratio: 4 }), lim()]],
    ['Radio Announcer Voice', () => [hp(90), f('eq', { lowG: 4, midF: 3500, midG: 3, midQ: 1, highG: 1 }), comp(-28, 5, 6, 5, 160), lim()]],
    ['Reverberated Phaser', () => [f('phaser', { rate: 0.4, depth: 800, mix: 0.7 }), f('reverb', { len: 3, damp: 0.5, mix: 0.4 })]],
    ['Smashed Dynamics', () => [comp(-40, 20, 14, 1, 60, 0), f('distortion', { drive: 2, mix: 0.25, out: -2 }), lim(-2)]],
    ['Sonic Destructor', () => [f('crush', { bits: 6, mix: 1 }), f('distortion', { drive: 20, mix: 0.8, out: -8 }), lp(6000), lim(-3)]],
    ['Stereo Maker (Hass Effect)', () => [f('haas', { ms: 20, side: 'right' })]],
    ['Stereo Maker Wide (Hass Effect)', () => [f('haas', { ms: 35, side: 'right' }), f('widener', { width: 1.6 })]],
    ['Stereo Widener (Hass Effect)', () => [f('haas', { ms: 12, side: 'left' }), f('widener', { width: 1.4 })]],
    ['Stereo Widener Subtle (Phase Shifter)', () => [f('phaser', { rate: 0.2, depth: 300, mix: 0.25 }), f('widener', { width: 1.15 })]],
    ['Underwater Speech', () => [lp(700, 1), f('chorus', { rate: 0.4, depth: 8, mix: 0.6 }), f('flanger', { rate: 0.2, depth: 2, fb: 0.3, mix: 0.4 }), f('gain', { db: 3 })]],
    ['Vocal Flange', () => [f('flanger', { rate: 0.35, depth: 2.5, fb: 0.6, mix: 0.5 }), comp(-22, 3, 2)]],
    ['Voice Leveler and Noise Gate', () => [f('gate', { thr: -48, floor: -40, att: 4, hold: 60, rel: 180 }), comp(-26, 4, 6), lim()]],
    ['Weaponized Effects', () => [f('distortion', { drive: 12, mix: 0.7, out: -6 }), f('crush', { bits: 8, mix: 0.6 }), f('phaser', { rate: 2, depth: 1000, mix: 0.6 }), f('delay', { ms: 90, fb: 0.5, mix: 0.3, image: 'all' }), lim(-2)]],
    ['Wide Spooky Echo', () => [f('delay', { ms: 600, fb: 0.65, mix: 0.5, image: 'side' }), f('reverb', { len: 4, damp: 0.6, mix: 0.4 }), f('widener', { width: 1.8 })]],
  ];

  /* returns fresh slot data (every param filled in) for a preset spec */
  const instantiate = (slotList) => slotList.slice(0, AS.rack.SLOTS).map((s) => ({ type: s.type, bypass: !!s.bypass, p: { ...AS.rack.RACK[s.type].defaults, ...s.p } }));

  AS.rack.BUILTIN = LIST.map(([name, make]) => ({ name, make }));
  AS.rack.instantiate = instantiate;
  AS.rack.builtin = (name) => { const b = AS.rack.BUILTIN.find((x) => x.name === name); return b ? { fx: instantiate(b.make()), cfg: AS.rack.defaultCfg() } : null; };
})(window);

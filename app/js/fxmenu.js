/* The Effects menu / Effects panel model.
   item kinds:  {rack}   real-time rack effect  -> opens a "Rack Effect - ..." window (slot on a track/clip in Multitrack, live preview + Apply in Waveform)
                {fx}     offline "(process)" effect -> parameter dialog, applied to the selection / selected clip
                {action} plain command (no dialog)                                                                     */
(function (root) {
  'use strict';
  const AS = (root.AS = root.AS || {});
  const r = (label, rack) => ({ label, rack }), p = (label, fx) => ({ label, fx }), a = (label, action, shortcut) => ({ label, action, shortcut });
  const CATS = [
    { name: 'Amplitude and Compression', items: [r('Amplify...', 'amplify'), r('Auto-Duck (Sidechain)...', 'autoduck'), r('Channel Mixer...', 'chanmix'), r('DeEsser...', 'deess'), r('Dynamics...', 'dynamics'), r('Dynamics Processing...', 'dynproc'), p('Fade Envelope (process)...', 'fadeenv'), p('Gain Envelope (process)...', 'gainenv'), r('Hard Limiter...', 'limiter'), r('Multiband Compressor...', 'mbcomp'), p('Normalize (process)...', 'normalize'), r('Single-band Compressor...', 'comp'), r('Speech Volume Leveler...', 'speechlev'), r('Tube-modeled Compressor...', 'tubecomp')] },
    { name: 'Delay and Echo', items: [r('Analog Delay...', 'analogdelay'), r('Delay...', 'delay2'), r('Echo...', 'delay')] },
    { name: 'Diagnostics', items: [p('DeClicker (process)...', 'declicker'), p('DeClipper (process)...', 'declip'), p('Delete Silence (process)...', 'delsilence'), p('Mark Audio (process)...', 'markaudio')] },
    { name: 'Filter and EQ', items: [r('FFT Filter...', 'fftfilter'), r('Graphic Equalizer (10 Bands)...', 'geq10'), r('Graphic Equalizer (20 Bands)...', 'geq20'), r('Graphic Equalizer (30 Bands)...', 'geq30'), r('Notch Filter...', 'notch'), r('Parametric Equalizer...', 'peq'), r('Scientific Filter...', 'scifilter')] },
    { name: 'Modulation', items: [r('Chorus...', 'chorus'), r('Chorus/Flanger...', 'chorusflanger'), r('Flanger...', 'flanger'), r('Phaser...', 'phaser')] },
    { name: 'Noise Reduction / Restoration', items: [a('Capture Noise Print', 'fx.noiseprint', 'Shift+P'), p('Noise Reduction (process)...', 'nr'), a('Learn Sound Model', 'fx.learnmodel'), p('Sound Remover (process)...', 'soundremove'), p('Click/Pop Eliminator (process)...', 'click'), p('Hiss Reduction (process)...', 'hiss'), r('DeNoise...', 'denoise'), r('DeReverb...', 'dereverb'), p('DeReverb (process)...', 'dereverb'), r('Adaptive Noise Reduction...', 'anr')] },
    { name: 'Reverb', items: [r('Convolution Reverb...', 'convreverb'), r('Full Reverb...', 'fullreverb'), r('Reverb...', 'reverb'), r('Studio Reverb...', 'studioreverb'), r('Surround Reverb...', 'surroundreverb')] },
    { name: 'Special', items: [r('Distortion...', 'distortion'), p('Doppler Shifter (process)...', 'doppler'), r('Guitar Suite...', 'guitarsuite'), r('Mastering...', 'mastering'), r('Loudness Meter...', 'loudmeter'), r('Loudness Radar Meter...', 'loudradar'), r('Vocal Enhancer...', 'vocalenh')] },
    { name: 'Stereo Imagery', items: [r('Center Channel Extractor...', 'centerextract'), r('Graphic Phase Shifter...', 'phaseshift'), r('Stereo Expander...', 'stereoexpander')] },
    { name: 'Time and Pitch', items: [r('Automatic Pitch Correction...', 'autopitch'), p('Manual Pitch Correction (process)...', 'manualpitch'), p('Pitch Bender (process)...', 'pitchbend'), r('Pitch Shifter...', 'pitchshift'), p('Stretch and Pitch (process)...', 'stretchpitch')] },
  ];
  /* older offline tools that have no slot in the list above (kept so nothing is lost) */
  const OTHER = ['leveler', 'anr', 'dehum', 'loudnorm', 'fadein', 'fadeout', 'invert', 'reverse', 'silence', 'dcoffset', 'stretch', 'speed', 'remix', 'vibrato', 'tremolo', 'bitcrush', 'balance', 'swap', 'vocalremove'];
  const otherItems = () => OTHER.map((id) => AS.effects.byId(id)).filter(Boolean).map((fx) => ({ label: fx.name.replace(/\.\.\.$/, '').replace(/\s*\(process\)$/, '') + ' (process)' + (fx.params.length && !fx.direct ? '...' : ''), fx: fx.id }));
  const itemId = (it) => (it.rack ? 'rfx:' + it.rack : it.fx ? 'fx:' + it.fx : it.action);
  const all = () => [...CATS.flatMap((c) => c.items.map((it) => ({ ...it, group: c.name, id: itemId(it) }))), ...otherItems().map((it) => ({ ...it, group: 'Other Tools (process)', id: itemId(it) }))];
  /* this file is the single source of effect names / grouping: the Effects menu, the Effects panel and the
     rack slot picker (rackpanel.js) all read it. Rack types that are not in the menu (the basic building blocks
     such as Gain, 3-Band EQ, Filter) are listed under their own category, after the menu entries. */
  function rackGroups() {
    const RACK = AS.rack.RACK, seen = new Set(), groups = [];
    for (const c of CATS) {
      const list = c.items.filter((it) => it.rack && RACK[it.rack]).map((it) => { seen.add(it.rack); return [it.rack, it.label.replace(/\.\.\.$/, '')]; });
      if (list.length) groups.push([c.name, list]);
    }
    for (const [k, d] of Object.entries(RACK)) {
      if (seen.has(k)) continue;
      let g = groups.find((x) => x[0] === d.cat); if (!g) groups.push((g = [d.cat || 'Other', []]));
      g[1].push([k, d.name]);
    }
    return groups;
  }
  /* counts for the About box, straight from the registries */
  const counts = () => ({ realtime: Object.keys(AS.rack.RACK).length, offline: AS.effects.FX.length, generators: AS.effects.GEN.length });
  AS.fxmenu = {
    CATS, OTHER,
    /* menu items for UI.buildMenus */
    menuItems() {
      return [...CATS.map((c) => ({ label: c.name, items: c.items.map((it) => ({ label: it.label, id: itemId(it), shortcut: it.shortcut })) })), { label: 'Other Tools (process)', items: otherItems().map((it) => ({ label: it.label, id: itemId(it) })) }];
    },
    otherItems, itemId, all, rackGroups, counts,
  };
})(window);

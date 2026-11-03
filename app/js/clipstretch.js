/* Multitrack clip time-stretch / pitch (non-destructive).
   A clip keeps its original audio in c.src; c.stretch (new length / original, 0.25–4), c.pitch (semitones) and
   c.stretchMode ('polyphonic' | 'monophonic' | 'varispeed') describe the processing. The processed audio is rendered
   in the background worker (dsp.clipStretch) and cached per source + settings; c.off / c.dur / fades / envelope
   times are in the processed (timeline) domain. Playback skips a clip until its audio is ready (the app waits
   for ensureAll() before playing / mixing down). */
(function (root) {
  'use strict';
  const AS = (root.AS = root.AS || {});
  const MODES = [['polyphonic', 'Polyphonic (music)'], ['monophonic', 'Monophonic (voice / solo)'], ['varispeed', 'Varispeed (speed + pitch, like tape)']];
  const cache = new WeakMap(), pending = new Map(); // src -> Map(key -> processed source)
  const scale = (c) => (c && c.stretch > 0 ? c.stretch : 1);
  const isOn = (c) => !!c && (Math.abs(scale(c) - 1) > 1e-6 || (c.stretchMode !== 'varispeed' && Math.abs(c.pitch || 0) > 1e-6));
  const key = (c) => [scale(c).toFixed(6), (+(c.pitch || 0)).toFixed(4), c.stretchMode || 'polyphonic'].join('|');
  /* the audio the clip plays: the original, the processed version, or null while it is being rendered */
  function play(c) { if (!isOn(c)) return c.src; const m = cache.get(c.src); return (m && m.get(key(c))) || null; }
  /* length of the clip's material on the timeline */
  const srcDur = (c) => c.src.dur * scale(c);
  function ensure(c) {
    if (!isOn(c) || play(c)) return Promise.resolve(play(c));
    const k = key(c), src = c.src, pk = src; let m = pending.get(pk); if (!m) pending.set(pk, (m = new Map()));
    if (m.has(k)) return m.get(k);
    const opts = { stretch: scale(c), semis: +(c.pitch || 0), mode: c.stretchMode || 'polyphonic' };
    const job = AS.jobs ? AS.jobs.stretch(src.ch.map((x) => x.slice()), src.sr, opts) : Promise.resolve(AS.dsp.clipStretch(src.ch, src.sr, opts.stretch, opts.semis, opts.mode));
    const p = job.then((ch) => {
      const out = { name: src.name, sr: src.sr, ch, dur: ch[0].length / src.sr };
      let cm = cache.get(src); if (!cm) cache.set(src, (cm = new Map())); cm.set(k, out); m.delete(k); return out;
    }, (e) => { m.delete(k); throw e; });
    m.set(k, p); return p;
  }
  const clipsOf = (s) => (s.tracks || []).flatMap((t) => t.clips || []);
  const missing = (s) => clipsOf(s).filter((c) => isOn(c) && !play(c));
  const ensureAll = (s) => Promise.all(clipsOf(s).map(ensure));
  /* change the stretch, keeping the clip's start: offset, length, fades, crossfades and envelope times scale with it */
  function setStretch(c, s1, from) {
    const o = from || c, s0 = scale(o), r = (s1 = Math.max(0.25, Math.min(4, s1))) / s0; // from: the clip before a drag began
    c.stretch = s1; c.off = o.off * r; c.dur = o.dur * r;
    for (const k of ['fi', 'fo']) c[k] = (o[k] || 0) * r;
    const env = AS.env.of(o), ne = { volume: env.volume.map((p) => ({ t: p.t * r, v: p.v })), pan: env.pan.map((p) => ({ t: p.t * r, v: p.v })) };
    c.env = ne;
    if (o.loop) { c.loopOff = o.loopOff * r; c.loopLen = o.loopLen * r; } // a looped clip's unit scales too
    return r;
  }
  /* "Match to session tempo": the clip's material has a tempo (src.tempo.bpm); stretch it to the session's */
  function matchTempo(c, bpm) {
    const st = c.src.tempo && c.src.tempo.bpm; if (!st || !bpm) return false;
    setStretch(c, st / bpm); // e.g. 100 BPM material in a 120 BPM session plays at 100/120 of its length
    return true;
  }
  /* turn the processed audio into the clip's own audio (before destructive edits such as Effects on a clip) */
  function bake(c) { const p = play(c); if (!isOn(c) || !p) return false; c.src = { ...p, tempo: c.src.tempo ? { ...c.src.tempo, bpm: c.src.tempo.bpm / scale(c) } : undefined }; c.stretch = 1; c.pitch = 0; return true; }

  AS.cstretch = { MODES, scale, isOn, key, play, srcDur, ensure, ensureAll, missing, setStretch, matchTempo, bake };
})(typeof window !== 'undefined' ? window : globalThis);

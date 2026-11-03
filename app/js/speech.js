/* Effects > Generate > Speech… — the parts that do not need the desktop app: the voice list for the dialog and turning
   the WAV a Windows voice produced into audio for the open file (sample rate, channels, pitch). The speaking itself is
   window.audioStageTts (main process, electron/tts.js); in the browser there is no offline speech-to-file, so the menu
   item is not shown there. Tested in tests/tts.test.js. */
(function (root) {
  'use strict';
  const AS = (root.AS = root.AS || {}), D = AS.dsp;
  const MISSING = 'missing:';
  const langLabel = (tag, langs) => { const l = (langs || []).find((x) => x.tag.toLowerCase() === String(tag).toLowerCase()); return l ? (l.own && l.own !== l.name ? `${l.name} (${l.own})` : l.name) : tag; };
  /* select options: installed voices (Thai first, then by language), then the common languages that have no voice — "missing:<tag>" */
  const rank = (v) => (/^th/i.test(v.lang) ? 0 : 1);
  const voiceOptionsSorted = (voices) => voices.slice().sort((a, b) => rank(a) - rank(b) || a.lang.localeCompare(b.lang) || a.name.localeCompare(b.name));
  function voiceOptions(voices, langs) {
    const have = new Set(voices.map((v) => v.lang.toLowerCase()));
    return [...voiceOptionsSorted(voices).map((v) => [v.engine + '|' + v.id, `${langLabel(v.lang, langs)} — ${v.name}`]),
      ...(langs || []).filter((l) => !have.has(l.tag.toLowerCase())).map((l) => [MISSING + l.tag, `${langLabel(l.tag, langs)} — no voice installed (how to add one…)`])];
  }
  const parseVoice = (value) => { const s = String(value || ''), i = s.indexOf('|'); return s.startsWith(MISSING) ? { missing: s.slice(MISSING.length) } : i > 0 ? { engine: s.slice(0, i), id: s.slice(i + 1) } : null; };
  /* the default voice: the last one used if still installed, else Thai when the text has Thai letters, else the first */
  const valueOf = (v) => v.engine + '|' + v.id;
  function defaultVoice(voices, last, text) {
    if (last && voices.some((v) => valueOf(v) === last)) return last;
    const th = /[฀-๿]/.test(text || '') && voices.find((v) => /^th/i.test(v.lang));
    return th ? valueOf(th) : voices.length ? valueOf(voiceOptionsSorted(voices)[0]) : '';
  }
  /* WAV bytes from a voice → channels at the file's rate / channel count, pitch-shifted (semitones, same duration), a short fade at both ends */
  function render(bytes, sr, nch, semitones) {
    const buf = bytes instanceof ArrayBuffer ? bytes : bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), w = AS.wav.decodeWav(buf);
    if (!w || !w.ch.length || !w.ch[0].length) throw new Error('The voice produced no audio.');
    let ch = w.sr === sr ? w.ch : D.convertRate(w.ch, w.sr, sr);
    if (Math.abs(semitones || 0) > 1e-3) ch = D.pitchShift(ch, sr, semitones);
    ch = D.matchChannels([D.mixMono(ch)], nch).map((c) => c.slice());
    const f = Math.min(Math.round(sr * 0.005), ch[0].length >> 1); for (const c of ch) for (let i = 0; i < f; i++) { c[i] *= i / f; c[c.length - 1 - i] *= i / f; }
    return ch;
  }
  AS.speech = { voiceOptions, parseVoice, defaultVoice, render, langLabel, MISSING, available: () => !!root.audioStageTts };
})(typeof window !== 'undefined' ? window : globalThis);

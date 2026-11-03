/* CD Layout: songs in order with gaps → one 44.1 kHz stereo image (WAV) + a CUE sheet. Red Book timing: 75 frames a
   second (588 samples); every track starts on a frame boundary; a gap is the track's pre-gap (INDEX 00 → INDEX 01).
   Burning the disc is left to any burning program that reads CUE + WAV. */
(function (root) {
  'use strict';
  const AS = (root.AS = root.AS || {});
  const SR = 44100, FRAME = 588, MAX_TRACKS = 99, MAX_SECONDS = 79 * 60 + 57;
  /* frames → "mm:ss:ff" (minutes may exceed 59, as CUE sheets allow) */
  const msf = (f) => { const m = Math.floor(f / 4500), s = Math.floor((f % 4500) / 75), fr = f % 75; return [m, s, fr].map((v) => String(v).padStart(2, '0')).join(':'); };
  const q = (s) => '"' + String(s || '').replace(/"/g, "'").replace(/[\r\n]+/g, ' ').slice(0, 80) + '"';
  /* items: [{name, title?, performer?, ch, sr, gap (s)}] → {ch, cue, tracks: [{n, title, index0, index1, end} (samples)], seconds, warnings} */
  function build(items, o) {
    const D = AS.dsp, oo = o || {}, file = oo.file || 'CD.wav', parts = [], tracks = [], warnings = [];
    if (!items.length) throw new Error('The CD layout is empty.');
    if (items.length > MAX_TRACKS) throw new Error(`A CD holds at most ${MAX_TRACKS} tracks.`);
    let pos = 0; // samples, always a whole number of frames
    items.forEach((it, i) => {
      const gapF = Math.max(0, Math.round(((+it.gap || 0) * SR) / FRAME)), audio = D.matchChannels(D.convertRate(it.ch, it.sr, SR), 2);
      if (gapF) parts.push([new Float32Array(gapF * FRAME), new Float32Array(gapF * FRAME)]);
      const index0 = pos, index1 = pos + gapF * FRAME, len = audio[0].length, padded = Math.ceil(len / FRAME) * FRAME;
      parts.push(padded > len ? audio.map((c) => { const y = new Float32Array(padded); y.set(c); return y; }) : audio);
      pos = index1 + padded;
      tracks.push({ n: i + 1, title: it.title || it.name, performer: it.performer || '', index0, index1, end: pos });
      if (len < 4 * SR) warnings.push(`Track ${i + 1} is shorter than 4 seconds (the Red Book minimum).`);
    });
    const seconds = pos / SR; if (seconds > MAX_SECONDS) warnings.push(`The CD is ${Math.floor(seconds / 60)}:${String(Math.round(seconds % 60)).padStart(2, '0')} long — more than fits on a standard 80-minute disc.`);
    const ch = D.concatCh(parts, 2);
    const lines = ['REM COMMENT "AudioStage CD Layout"'];
    if (oo.performer) lines.push('PERFORMER ' + q(oo.performer)); if (oo.title) lines.push('TITLE ' + q(oo.title));
    lines.push('FILE ' + q(file) + ' WAVE');
    for (const t of tracks) {
      lines.push(`  TRACK ${String(t.n).padStart(2, '0')} AUDIO`, '    TITLE ' + q(t.title)); if (t.performer) lines.push('    PERFORMER ' + q(t.performer));
      if (t.index1 > t.index0) lines.push('    INDEX 00 ' + msf(t.index0 / FRAME)); lines.push('    INDEX 01 ' + msf(t.index1 / FRAME));
    }
    return { ch, sr: SR, cue: lines.join('\r\n') + '\r\n', tracks, seconds, warnings };
  }
  /* read the INDEX 01 times back from a CUE sheet (for checks): [{n, title, index0?, index1}] in frames */
  function parseCue(text) {
    const out = []; let cur = null;
    for (const l of String(text).split(/\r?\n/)) {
      let m;
      if ((m = /^\s*TRACK (\d+) AUDIO/.exec(l))) { cur = { n: +m[1] }; out.push(cur); }
      else if (cur && (m = /^\s*TITLE "(.*)"/.exec(l))) cur.title = m[1];
      else if (cur && (m = /^\s*INDEX (\d\d) (\d+):(\d\d):(\d\d)/.exec(l))) cur['index' + +m[1]] = +m[2] * 4500 + +m[3] * 75 + +m[4];
    }
    return out;
  }
  AS.cd = { SR, FRAME, MAX_TRACKS, MAX_SECONDS, msf, build, parseCue };
})(typeof window !== 'undefined' ? window : globalThis);

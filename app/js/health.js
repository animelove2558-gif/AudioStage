/* Session Audio Health: what is wrong with the audio of a multitrack session, each finding with a hint how to fix it.
   Pure function on a Session, tested in tests/health.test.js. Also available as JSON (AS.health.json). */
(function (root) {
  'use strict';
  const AS = (root.AS = root.AS || {});
  /* level: 'error' (will not play correctly) | 'warn' (probably not intended) | 'info'. opts.scanMs: time budget for the sample scan */
  function check(s, opts) {
    const o = opts || {}, issues = [], add = (level, code, where, msg, fix) => issues.push({ level, code, where, msg, fix });
    const deadline = Date.now() + (o.scanMs || 4000), seen = new Set();
    for (const t of s.tracks) {
      for (const c of t.clips) {
        const where = `${t.name} / ${c.name || 'clip ' + c.id}`, src = c.src;
        if (!src || !Array.isArray(src.ch) || !src.ch.length || !src.ch[0] || !src.ch[0].length) { add('error', 'missing-audio', where, 'The clip has no audio.', 'Delete the clip or re-insert the file.'); continue; }
        const sdur = src.dur != null ? src.dur : src.ch[0].length / src.sr, scale = AS.cstretch && AS.cstretch.scale ? AS.cstretch.scale(c) : 1;
        if (src.sr !== s.sr) add('warn', 'rate-mismatch', where, `The audio is ${src.sr} Hz, the session is ${s.sr} Hz.`, 'It is resampled when played; convert the file to the session rate to avoid the resampling.');
        if (!c.loop && c.off + c.dur > sdur * scale + 0.005) add('error', 'beyond-source', where, `The clip reaches ${(c.off + c.dur - sdur * scale).toFixed(3)} s past the end of its audio.`, 'Trim the end of the clip.');
        if (c.off < 0 || c.dur <= 0 || !Number.isFinite(c.start)) add('error', 'bad-range', where, 'The clip has an invalid position or length.', 'Delete and re-insert the clip.');
        if (seen.has(src)) continue; seen.add(src);
        if (Date.now() > deadline) continue; // (the sample scan is skipped for the rest once the time budget is used)
        let bad = 0, peak = 0;
        for (const ch of src.ch) for (let i = 0; i < ch.length; i++) { const v = ch[i]; if (v !== v || v === Infinity || v === -Infinity) bad++; else { const a = v < 0 ? -v : v; if (a > peak) peak = a; } }
        if (bad) add('error', 'bad-samples', where, `${bad} samples are not numbers (NaN / infinity).`, 'Re-record or re-import the file; Effects > Silence on the damaged part also works.');
        else if (peak === 0) add('info', 'silent', where, 'The audio is completely silent.', 'Check that the right file was inserted.');
        else if (peak > 1) add('warn', 'over-full-scale', where, `The audio peaks at ${(20 * Math.log10(peak)).toFixed(1)} dBFS (above full scale).`, 'Lower the clip gain or normalise it.');
      }
      if (t.video && t.video.path === '' && !t.video.url) add('warn', 'video-path', t.name, 'The video has no file path.', 'Re-insert the video so it can be exported with the new soundtrack.');
    }
    const n = (l) => issues.filter((i) => i.level === l).length;
    return { ok: !n('error'), errors: n('error'), warnings: n('warn'), infos: n('info'), issues };
  }
  const json = (s, opts) => JSON.stringify(check(s, opts), null, 1);
  AS.health = { check, json };
})(typeof window !== 'undefined' ? window : globalThis);

/* Timecode text for the time display: all common frame rates, drop-frame (29.97 / 59.94) and Feet+Frames (35 mm, 16 frames
   per foot). Pure functions, tested in tests/timecode.test.js. */
(function (root) {
  'use strict';
  const AS = (root.AS = root.AS || {});
  /* key → { fps: nominal frames per second used in the counter, real: true frames per second, drop: frames dropped per minute } */
  const RATES = {
    '23.976': { label: '23.976 fps', fps: 24, real: 24000 / 1001, drop: 0 }, '24': { label: '24 fps', fps: 24, real: 24, drop: 0 }, '25': { label: '25 fps', fps: 25, real: 25, drop: 0 },
    '29.97': { label: '29.97 fps non-drop', fps: 30, real: 30000 / 1001, drop: 0 }, '29.97df': { label: '29.97 fps drop-frame', fps: 30, real: 30000 / 1001, drop: 2 }, '30': { label: '30 fps', fps: 30, real: 30, drop: 0 },
    '50': { label: '50 fps', fps: 50, real: 50, drop: 0 }, '59.94': { label: '59.94 fps non-drop', fps: 60, real: 60000 / 1001, drop: 0 }, '59.94df': { label: '59.94 fps drop-frame', fps: 60, real: 60000 / 1001, drop: 4 }, '60': { label: '60 fps', fps: 60, real: 60, drop: 0 },
  };
  const pad = (n, w) => String(n).padStart(w || 2, '0');
  /* frame number → h:m:s:f (drop-frame: the standard algorithm that skips frame numbers 0..drop-1 at the start of every minute except every tenth) */
  function frameParts(frames, r) {
    let n = frames;
    if (r.drop) {
      const per10 = r.fps * 600 - r.drop * 9, per1 = r.fps * 60 - r.drop, d = Math.floor(n / per10), m = n % per10;
      n += r.drop * 9 * d + (m > r.drop ? r.drop * Math.floor((m - r.drop) / per1) : 0);
    }
    const f = n % r.fps, s = Math.floor(n / r.fps) % 60, mi = Math.floor(n / (r.fps * 60)) % 60, h = Math.floor(n / (r.fps * 3600));
    return { h, m: mi, s, f };
  }
  /* seconds → "hh:mm:ss:ff" (";" before the frames in drop-frame) */
  function fmt(sec, key) {
    const r = RATES[key] || RATES['30'], frames = Math.max(0, Math.floor(Math.max(0, sec) * r.real + 1e-6)), p = frameParts(frames, r);
    return `${pad(p.h)}:${pad(p.m)}:${pad(p.s)}${r.drop ? ';' : ':'}${pad(p.f, r.fps >= 100 ? 3 : 2)}`;
  }
  /* seconds → 35 mm "feet+frames" at 24 fps (16 frames per foot), e.g. 90+07 */
  function feetFrames(sec) { const fr = Math.max(0, Math.floor(Math.max(0, sec) * 24 + 1e-6)); return `${Math.floor(fr / 16)}+${pad(fr % 16)}`; }
  AS.timecode = { RATES, fmt, feetFrames, options: () => Object.entries(RATES).map(([k, v]) => [k, v.label]) };
})(typeof window !== 'undefined' ? window : globalThis);

/* Errors that nobody caught: window "error" and "unhandledrejection", and the animation-frame loop (AS.errors.report).
   Each distinct message is written to the log file and shown as a toast once; repeats are only counted (the log gets
   a line at the 10th, 100th, 1000th… repeat), so a fault inside a 60-per-second loop cannot flood the log, hide the
   first error or bury the user in toasts. */
(function (root) {
  'use strict';
  const AS = (root.AS = root.AS || {});
  const seen = new Map(); // message -> repeat count
  const MAX_KEYS = 200;

  function text(e) {
    if (e && e.stack) return String(e.stack).split('\n').slice(0, 6).join(' | ');
    if (e && e.message) return String(e.message);
    try { return typeof e === 'string' ? e : JSON.stringify(e); } catch (er) { return String(e); }
  }
  function send(level, msg) {
    try { if (root.audioStageHelp && root.audioStageHelp.log) { const p = root.audioStageHelp.log(level, msg); if (p && p.catch) p.catch(() => {}); } } catch (e) { /* */ }
  }
  /* where: a short label ("frame", "window", "promise"); e: the error. Returns the repeat count (1 = first time). */
  function report(where, e) {
    const msg = where + ': ' + text(e), key = (e && e.message ? e.message : msg).slice(0, 300);
    if (seen.size >= MAX_KEYS) seen.clear();
    const n = (seen.get(key) || 0) + 1; seen.set(key, n);
    if (n === 1) {
      send('error', msg);
      try { if (AS.ui && AS.ui.toast) AS.ui.toast('Something went wrong: ' + (e && e.message ? e.message : String(e)).slice(0, 160) + ' (details are in Help > Show Log Files)', 'error'); } catch (er) { /* */ }
    } else if (n === 10 || n === 100 || n === 1000 || n % 10000 === 0) send('error', `${where}: the same error happened ${n} times: ${key}`);
    return n;
  }
  AS.errors = { report, text, seen };
  if (root.addEventListener) {
    root.addEventListener('error', (ev) => { report('window', ev.error || ev.message || 'unknown error'); });
    root.addEventListener('unhandledrejection', (ev) => { report('promise', ev.reason || 'rejected without a reason'); });
  }
})(typeof window !== 'undefined' ? window : globalThis);

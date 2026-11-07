// app/js/errors.js: a repeated error is logged and shown once, then only counted.
const assert = require('assert');
const logged = [], toasts = [], listeners = {};
global.window = global; global.addEventListener = (n, f) => { listeners[n] = f; };
global.audioStageHelp = { log: (l, m) => { logged.push([l, m]); return Promise.resolve(true); } };
global.AS = { ui: { toast: (m, k) => toasts.push([m, k]) } };
require('../app/js/errors.js');
let failed = 0; const ok = (n, f) => { try { f(); console.log('ok   ', n); } catch (e) { failed++; console.log('FAIL ', n, '\n   ', e.message); } };
ok('1000 identical errors from a frame loop: one log line, one toast, counts at 10 / 100 / 1000', () => {
  for (let i = 0; i < 1000; i++) AS.errors.report('frame', new TypeError('clip.src is undefined'));
  assert.strictEqual(toasts.length, 1); assert(/clip\.src is undefined/.test(toasts[0][0]) && toasts[0][1] === 'error');
  assert.strictEqual(logged.length, 4, JSON.stringify(logged.map((l) => l[1].slice(0, 60)))); assert(/TypeError/.test(logged[0][1]) && /1000 times/.test(logged[3][1]));
});
ok('a different error is reported again; window error and unhandled rejection listeners are installed', () => {
  AS.errors.report('frame', new Error('another'));
  assert.strictEqual(toasts.length, 2);
  listeners.error({ error: new Error('from window') }); listeners.unhandledrejection({ reason: 'plain string' });
  assert.strictEqual(toasts.length, 4); assert(logged.some((l) => /window: .*from window/.test(l[1])) && logged.some((l) => /promise: plain string/.test(l[1])));
});
ok('reporting never throws, even without a log bridge or a toast', () => {
  delete global.audioStageHelp; global.AS.ui = null; AS.errors.report('x', null); AS.errors.report('x', { toString() { throw 1; } });
});
if (failed) { console.log(`\n${failed} failed`); process.exit(1); } else console.log('\nall passed');

// Policies in electron/guards.js (error-dialog throttle, reload limiter) and the file-name rules in electron/filenames.js.
const assert = require('assert');
const { DialogThrottle, ReloadLimiter } = require('../electron/guards');
const { okName, safeName } = require('../electron/filenames');
let failed = 0;
const ok = (n, f) => { try { f(); console.log('ok   ', n); } catch (e) { failed++; console.log('FAIL ', n, '\n   ', e.message); } };

ok('dialog throttle: one dialog per interval, the rest counted, restart offered after the third', () => {
  const t = new DialogThrottle({ intervalMs: 1000, restartAfter: 3 });
  assert.deepStrictEqual(t.hit(0), { show: true, suppressed: 0, offerRestart: false });
  for (let i = 1; i <= 50; i++) assert.strictEqual(t.hit(i * 10).show, false);
  const b = t.hit(1000); assert(b.show && b.suppressed === 50 && !b.offerRestart);
  assert.strictEqual(t.hit(1500).show, false);
  assert(t.hit(2100).offerRestart, 'third dialog');
});
ok('reload limiter: at most 3 automatic reloads a minute', () => {
  const r = new ReloadLimiter({ max: 3, windowMs: 60000 });
  assert(r.allow(0) && r.allow(1000) && r.allow(2000)); assert(!r.allow(3000)); assert(r.allow(61000));
});
ok('file names: Windows device names and trailing dots / spaces are not accepted', () => {
  for (const n of ['CON', 'nul', 'Aux', 'com1', 'LPT9', 'aux.wav', 'Con.txt', 'Intro.', 'Track ', '', '.', '..', 'a/b', 'a:b', 'x'.repeat(181)]) assert(!okName(n), n);
  for (const n of ['Intro', 'Take 1.wav', 'บทที่ 1.wav', 'console.wav', 'auxiliary', 'com10', 'a.b.c']) assert(okName(n), n);
});
ok('safeName always gives a usable name', () => {
  assert.strictEqual(safeName('Aux'), '_Aux'); assert.strictEqual(safeName('Intro.'), 'Intro'); assert.strictEqual(safeName('Track '), 'Track');
  assert.strictEqual(safeName('a/b:c'), 'a_b_c'); assert.strictEqual(safeName(''), 'Untitled'); assert.strictEqual(safeName('...'), 'Untitled'); assert.strictEqual(safeName('con.wav'), '_con.wav');
  for (const n of ['Aux', 'Intro.', 'Track ', 'a/b', 'nul.', '  ', 'ก'.repeat(300)]) assert(okName(safeName(n)), n);
});
// C-02: the helper process dies; later writes must be rejected, not thrown as an uncaught EPIPE
process.on('uncaughtException', (e) => { failed++; console.log('FAIL  uncaught exception:', e.message); });
const { VstHost } = require('../electron/vst-host');
(async () => {
  const h = new VstHost(); h.pythonInfo = { cmd: process.execPath, pre: ['-e', 'process.exit(0)', '--'], source: 'system', pedalboard: '0' };
  try {
    for (let i = 0; i < 6; i++) { await assert.rejects(h.request('ping', {}, 3000), /stopped unexpectedly|Cannot start/); await new Promise((r) => setTimeout(r, i % 2 ? 0 : 150)); }
    await assert.rejects(h.request('ping', {}, 3000), /stopped unexpectedly/);
    console.log('ok    C-02: requests to a dead plugin host are rejected, no uncaught EPIPE');
  } catch (e) { failed++; console.log('FAIL  C-02', e.message); }
  h.shutdown();
  await new Promise((r) => setTimeout(r, 200));
  if (failed) { console.log(`\n${failed} failed`); process.exit(1); } else console.log('\nall passed');
})();

// Loaded by main.js when AUDIOSTAGE_SELFTEST is set: runs every tests/app/*.scenario.js inside the real (hidden)
// app window, collects console errors, prints the results and exits with 0 / 1.
const fs = require('fs'), path = require('path');

/* helpers available to scenarios as the first argument (runs in the renderer) */
const PRELUDE = `(() => {
  const results = [];
  const H = {
    AS: window.AS, app: window.app, results, env: ${JSON.stringify({ video: process.env.AUDIOSTAGE_TEST_VIDEO || '', tmp: process.env.AUDIOSTAGE_SELFTEST || '' })},
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    assert(c, msg) { if (!c) throw new Error(msg || 'assertion failed'); },
    near(a, b, eps, msg) { if (!(Math.abs(a - b) <= eps)) throw new Error((msg ? msg + ': ' : '') + a + ' != ' + b + ' (±' + eps + ')'); },
    async t(name, fn) { try { await fn(); results.push({ name, ok: true }); } catch (e) { results.push({ name, ok: false, msg: (e && e.stack) || String(e) }); } },
  };
  return H;
})()`;

module.exports = function selftest(app, win) {
  const errors = [];
  const onConsole = (...a) => {
    const d = a[1] && typeof a[1] === 'object' ? a[1] : { level: a[1], message: a[2], sourceId: a[4], lineNumber: a[3] };
    const lvl = typeof d.level === 'string' ? d.level : ['verbose', 'info', 'warning', 'error'][d.level] || d.level;
    if (lvl === 'error') errors.push(`${d.message}  (${path.basename(String(d.sourceId || ''))}:${d.lineNumber})`);
  };
  win.webContents.on('console-message', onConsole);
  win.webContents.on('render-process-gone', (e, d) => { errors.push('renderer gone: ' + d.reason); finish(1); });
  const timer = setTimeout(() => { console.log('SELFTEST TIMEOUT'); finish(1); }, +(process.env.AUDIOSTAGE_SELFTEST_TIMEOUT || 180000));
  let done = false;
  function finish(code) { if (done) return; done = true; clearTimeout(timer); setTimeout(() => app.exit(code), 50); }

  win.webContents.once('did-finish-load', async () => {
    let failed = 0, passed = 0;
    try {
      await new Promise((r) => setTimeout(r, 1200)); // let the app finish booting (fonts, panels, worklets…)
      const only = process.env.AUDIOSTAGE_SELFTEST_ONLY;
      // phase 2 = a second start of the app on the same data folder (crash recovery): *.after-restart.scenario.js
      const phase2 = process.env.AUDIOSTAGE_SELFTEST_PHASE === '2';
      const files = fs.readdirSync(__dirname).filter((f) => f.endsWith('.scenario.js') && f.includes('.after-restart.') === phase2 && (!only || f.includes(only))).sort();
      for (const f of files) {
        const fn = require(path.join(__dirname, f));
        console.log(`\n=== app: ${f} ===`);
        const code = `(async () => { const H = ${PRELUDE}; await (${fn.toString()})(H); return H.results; })()`;
        let res;
        try { res = await win.webContents.executeJavaScript(code, true); } catch (e) { res = [{ name: f + ' (scenario crashed)', ok: false, msg: String(e && e.message || e) }]; }
        for (const r of res) { if (r.ok) { passed++; console.log('ok   ', r.name); } else { failed++; console.log('FAIL ', r.name, '\n      ' + String(r.msg).split('\n').slice(0, 4).join('\n      ')); } }
        // AUDIOSTAGE_SELFTEST_SHOTS=<folder>: save a screenshot after each scenario (for checking layouts by eye)
        if (process.env.AUDIOSTAGE_SELFTEST_SHOTS) { try { await new Promise((r) => setTimeout(r, 600)); const img = await win.webContents.capturePage(); fs.writeFileSync(path.join(process.env.AUDIOSTAGE_SELFTEST_SHOTS, f.replace(/\.js$/, '.png')), img.toPNG()); } catch (e) { console.log('(screenshot failed: ' + e.message + ')'); } }
      }
    } catch (e) { failed++; console.log('FAIL  selftest harness', e); }
    if (errors.length) { failed++; console.log('FAIL  console errors:\n  ' + errors.join('\n  ')); } else { passed++; console.log('ok    no errors in the console'); }
    console.log(`\napp: ${passed} passed · ${failed} failed`);
    finish(failed ? 1 : 0);
  });
};

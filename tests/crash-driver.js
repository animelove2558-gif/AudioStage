// Loaded by main.js instead of tests/app/selftest.js when AUDIOSTAGE_SELFTEST_DRIVER=crash (see tests/crash.test.js).
// Makes the crash handlers run for real in the hidden app: uncaught errors in the main process (C-03), a dead window
// process (C-01), a second start of the app (C-19), and checks what the log kept (C-18).
const fs = require('fs'), path = require('path'), { spawn } = require('child_process');
module.exports = function crashDriver(app, win) {
  const T = global.AUDIOSTAGE_TEST, results = [];
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const t = async (name, fn) => { try { await fn(); results.push([true, name]); } catch (e) { results.push([false, name + ' -> ' + (e && e.message || e)]); } };
  const assert = (c, m) => { if (!c) throw new Error(m || 'assertion failed'); };
  const logFile = path.join(app.getPath('userData'), 'logs', 'audiostage.log');
  const logText = () => { try { return fs.readFileSync(logFile, 'utf8'); } catch (e) { return ''; } };
  const loaded = () => new Promise((r) => win.webContents.once('did-finish-load', r));
  let finished = false;
  const finish = (code) => { if (finished) return; finished = true; for (const [ok, n] of results) console.log(ok ? 'ok   ' : 'FAIL ', n); console.log(`\ncrash handlers: ${results.filter((r) => r[0]).length} passed · ${results.filter((r) => !r[0]).length} failed`); setTimeout(() => app.exit(code), 50); };
  setTimeout(() => { results.push([false, 'timeout']); finish(1); }, 60000);

  win.webContents.once('did-finish-load', async () => {
    await sleep(1500);
    await t('C-03: 40 uncaught errors in the main process -> one dialog, every error logged once and counted', async () => {
      for (let i = 0; i < 40; i++) setTimeout(() => { throw new Error('crash-driver: uncaught ' + (i % 2)); }, 0);
      await sleep(400);
      assert(T.stats().errDialogs === 1, 'dialogs: ' + T.stats().errDialogs);
      assert(/crash-driver: uncaught/.test(logText()), 'logged');
    });
    await t('C-03: the app keeps running after the errors', async () => { assert(!win.isDestroyed(), 'window'); assert(await win.webContents.executeJavaScript('!!window.AS && !!AS.app'), 'page'); });
    await t('C-01: a dead window process is logged and the window is reloaded and works again', async () => {
      const again = loaded(); win.webContents.forcefullyCrashRenderer();
      await Promise.race([again, sleep(15000).then(() => { throw new Error('the window was not reloaded'); })]);
      await sleep(1500);
      assert(T.stats().rendererReloads === 1, 'reloads: ' + T.stats().rendererReloads);
      assert(await win.webContents.executeJavaScript('!!window.AS && !!AS.app && !!AS.engine'), 'page after reload');
      assert(/The window process is gone: (crashed|killed)/.test(logText()), 'log: ' + logText().slice(-300));
    });
    await t('C-19: a second start of the app ends at once, without a log or window of its own', async () => {
      const before = (logText().match(/ started \(/g) || []).length;
      const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
      const code = await new Promise((res) => { const c = spawn(process.execPath, [path.join(__dirname, '..')], { env, stdio: 'ignore' }); const to = setTimeout(() => { c.kill(); res('timeout'); }, 20000); c.on('exit', (x) => { clearTimeout(to); res(x); }); });
      assert(code === 0, 'second instance exit code: ' + code);
      assert((logText().match(/ started \(/g) || []).length === before, 'second instance wrote a start line');
      assert(!win.isDestroyed(), 'first window alive');
    });
    await t('C-18: the first error is still in the log file', async () => { assert(/crash-driver: uncaught 0/.test(logText()), 'first error kept'); });
    finish(results.some((r) => !r[0]) ? 1 : 0);
  });
};

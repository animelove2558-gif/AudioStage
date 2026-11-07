// Run: node tests/crash.test.js — starts the real Electron app hidden and makes its crash handlers run for real:
// uncaught errors in the main process (one dialog only), a dead window process (reloaded), a second start (ends at
// once). Needs Electron and takes the same CPU/RAM as the app tests: hold D:\BYS All Stages Projects\.electron-lock.
const { spawnSync } = require('child_process'), fs = require('fs'), os = require('os'), path = require('path');
let electron; try { electron = require('electron'); } catch (e) { electron = null; }
if (!electron || typeof electron !== 'string' || !fs.existsSync(electron)) { console.log('skip  Electron is not installed (npm install) — crash tests not run'); process.exit(0); }
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'audiostage-crash-'));
const env = { ...process.env, AUDIOSTAGE_SELFTEST: dir, AUDIOSTAGE_SELFTEST_DRIVER: 'crash' }; delete env.ELECTRON_RUN_AS_NODE;
const r = spawnSync(electron, [path.join(__dirname, '..')], { env, encoding: 'utf8', timeout: 120000 });
process.stdout.write(r.stdout || '');
try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* */ }
if (r.status !== 0) { console.log('FAIL  crash handlers (exit ' + r.status + ')\n' + (r.stderr || '').split('\n').filter((l) => /error/i.test(l)).slice(0, 5).join('\n')); process.exit(1); }

// Run: node tests/app.test.js — starts the real Electron app hidden (own temporary userData) and runs
// tests/app/*.scenario.js inside it: real Web Audio (live + OfflineAudioContext), real DOM, no console errors allowed.
// Then, if there are tests/app/*.after-restart.scenario.js, starts the app a second time on the same data folder —
// the first run ended with app.exit() (no normal page close), which the app treats like a crash.
// Skipped (with a note) when the Electron binary is not installed.
const { spawnSync } = require('child_process'), fs = require('fs'), os = require('os'), path = require('path');
let electron;
try { electron = require('electron'); } catch (e) { electron = null; }
if (!electron || typeof electron !== 'string' || !fs.existsSync(electron)) { console.log('skip  Electron is not installed (npm install) — app tests not run'); process.exit(0); }
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'audiostage-selftest-'));
// a small test video (2 s, 160x90, with a 300 Hz soundtrack) for the video-track scenario, when ffmpeg is installed
let testVideo = '';
const ff = require('../electron/video').findFfmpeg();
if (ff) {
  const v = path.join(dir, 'test-video.mp4');
  const g = spawnSync(ff.path, ['-hide_banner', '-y', '-f', 'lavfi', '-i', 'testsrc=size=160x90:rate=10:duration=2', '-f', 'lavfi', '-i', 'sine=frequency=300:duration=2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', v], { encoding: 'utf8' });
  if (g.status === 0) testVideo = v;
}
// Install VST Support… / Install ffmpeg… download from a slow local server instead of python.org / GitHub (and get cancelled)
const slow = require('child_process').spawn(process.execPath, [path.join(__dirname, '_slowserver.js')], { stdio: ['ignore', 'pipe', 'ignore'] });
let slowOut = ''; slow.stdout.on('data', (d) => (slowOut += d));
const slowPort = () => new Promise((r) => { const t = Date.now(), w = () => (/\d+/.test(slowOut) ? r(+slowOut.trim()) : Date.now() - t > 10000 ? r(1) : setTimeout(w, 30)); w(); });
const run = (phase, sources) => {
  const env = { ...process.env, AUDIOSTAGE_SELFTEST: dir, AUDIOSTAGE_SELFTEST_PHASE: phase, AUDIOSTAGE_TEST_VIDEO: testVideo, AUDIOSTAGE_RUNTIME_SOURCES: sources, AUDIOSTAGE_TTS_MOCK: '1', AUDIOSTAGE_UPDATE_MOCK: '{}' };
  delete env.ELECTRON_RUN_AS_NODE;
  const r = spawnSync(electron, [path.join(__dirname, '..')], { env, encoding: 'utf8', timeout: 400000 });
  process.stdout.write(r.stdout || ''); if (r.stderr && /error/i.test(r.stderr)) process.stdout.write(r.stderr.split('\n').filter((l) => /error/i.test(l) && !/GPU|gpu_|dxgi|Direct3D|cache_util|disk_cache/.test(l)).join('\n'));
  return r.status === 0;
};
slowPort().then((p) => {
  const u = 'http://127.0.0.1:' + p, Z = '0'.repeat(64);
  const sources = JSON.stringify({ python: { version: '3.13.17', url: u + '/python.zip', sha256: Z, size: 4 * 1048576 }, pip: { version: '0', url: u + '/pip-0-py3-none-any.whl', sha256: Z, size: 1 }, ffmpeg: { base: u + '/rel/', checksums: 'checksums.sha256' } });
  let ok = run('1', sources);
  const only = process.env.AUDIOSTAGE_SELFTEST_ONLY;
  if (fs.readdirSync(path.join(__dirname, 'app')).some((f) => f.includes('.after-restart.') && (!only || f.includes(only)))) { console.log('\n--- restarting the app on the same data folder ---'); ok = run('2', sources) && ok; }
  slow.kill();
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* */ }
  process.exit(ok ? 0 : 1);
});

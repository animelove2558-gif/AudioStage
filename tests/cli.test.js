// tools/audiostage-cli.js: batch convert / normalise without a window, exit codes, JSON output.
const assert = require('assert'), fs = require('fs'), os = require('os'), path = require('path'), { spawnSync } = require('child_process');
const cli = path.join(__dirname, '..', 'tools', 'audiostage-cli.js');
let failed = 0;
const ok = (n, f) => { try { f(); console.log('ok   ', n); } catch (e) { failed++; console.log('FAIL ', n, '\n   ', e.message); } };
const run = (...a) => spawnSync(process.execPath, [cli, ...a], { encoding: 'utf8' });
globalThis.AS = {}; require('../app/js/wav.js'); require('../app/js/aiff.js');
const d = fs.mkdtempSync(path.join(os.tmpdir(), 'as-cli-'));
const x = Float32Array.from({ length: 4410 }, (_, i) => 0.2 * Math.sin(i / 5));
fs.writeFileSync(path.join(d, 'a.wav'), Buffer.from(AS.wav.encodeWav([x, x], 44100, 16, false, null)));
ok('convert + normalize: peak lands on the target, rate and length are kept, AIFF and FLAC outputs', () => {
  let r = run('normalize', path.join(d, 'a.wav'), path.join(d, 'n.aiff'), '--peak', '-6', '--bits', '24');
  assert.strictEqual(r.status, 0, r.stderr);
  const o = AS.aiff.decodeAiff(fs.readFileSync(path.join(d, 'n.aiff')).buffer.slice(0));
  assert.strictEqual(o.sr, 44100); assert.strictEqual(o.ch[0].length, 4410);
  const pk = Math.max(...o.ch[0].map(Math.abs)); assert(Math.abs(pk - Math.pow(10, -6 / 20)) < 1e-3, 'peak ' + pk);
  r = run('convert', path.join(d, 'a.wav'), path.join(d, 'c.flac'), '--bits', '16');
  assert.strictEqual(r.status, 0, r.stderr); assert.strictEqual(fs.readFileSync(path.join(d, 'c.flac')).subarray(0, 4).toString(), 'fLaC');
});
ok('batch: every WAV in a folder, a broken file is reported with exit code 1, --json', () => {
  fs.writeFileSync(path.join(d, 'bad.wav'), 'not audio');
  const r = run('batch', d, path.join(d, 'out'), '--normalize', '-3', '--json', '--format', 'wav');
  const j = JSON.parse(r.stdout);
  assert.strictEqual(r.status, 1); assert(j.done.length >= 1 && j.failed.length === 1 && /bad\.wav/.test(j.failed[0].input)); assert(fs.existsSync(path.join(d, 'out', 'a.wav')));
});
ok('usage errors exit with 2, missing files with 1', () => {
  assert.strictEqual(run().status, 2); assert.strictEqual(run('convert', 'x').status, 2); assert.strictEqual(run('convert', 'a', 'b', '--bits', '20').status, 2);
  assert.strictEqual(run('convert', path.join(d, 'missing.wav'), path.join(d, 'm.wav')).status, 1);
  assert.strictEqual(run('normalize', path.join(d, 'a.wav'), path.join(d, 'm.wav'), '--peak', '3').status, 1);
});
fs.rmSync(d, { recursive: true, force: true });
if (failed) process.exit(1); else console.log('\nall passed');

// Run: node tests/vst_helper.test.js — the plugin host without a real plugin: a hung request is recovered (C-14), other requests
// are answered while a plugin window is open (C-28, needs tools/vst/.venv), audio goes through files in pieces (C-15), and the
// search for Python does not block (C-12).
const assert = require('assert'), fs = require('fs'), path = require('path');
const { spawn } = require('child_process');
const { VstHost, HOST_SCRIPT } = require('../electron/vst-host');
const video = require('../electron/video');
let fail = 0;
const ok = async (name, fn) => { try { await fn(); console.log('ok   ', name); } catch (e) { fail++; console.log('FAIL ', name, e.message); } };
const venv = path.join(__dirname, '..', 'tools', 'vst', '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');

/* a stand-in helper written in Node: answers ping, never answers "hang", copies the file for "process" */
const FAKE = `
const fs = require('fs');
let buf = ''; process.stdin.setEncoding('utf8');
process.stdin.on('data', (d) => { buf += d; let i; while ((i = buf.indexOf('\\n')) >= 0) { const r = JSON.parse(buf.slice(0, i)); buf = buf.slice(i + 1);
  if (r.cmd === 'hang') continue;
  if (r.cmd === 'process') { fs.copyFileSync(r.inPath, r.outPath); console.log(JSON.stringify({ id: r.id, ok: true, ch: r.ch, n: r.n })); continue; }
  console.log(JSON.stringify({ id: r.id, ok: true, pid: process.pid })); } });`;
function fakeHost() {
  const h = new VstHost({ probe: () => ({ status: 0, stdout: 'fake' }) }), real = h.ensureChild.bind(h);
  // ensureChild spawns python; here the same pipes run the stand-in above through this Node
  const dir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'as-fakehost-')), script = path.join(dir, 'fake.js'); fs.writeFileSync(script, FAKE);
  h.spawnFor = () => spawn(process.execPath, [script], { stdio: ['pipe', 'pipe', 'pipe'] });
  h._real = real; return h;
}

(async () => {
  await ok('a request that gets no answer ends the helper; the next request gets a new one (C-14)', async () => {
    const h = fakeHost(); const first = await h.request('ping');
    await assert.rejects(h.request('hang', {}, 200), /did not answer in time/);
    const second = await h.request('ping'); assert.notStrictEqual(second.pid, first.pid, 'a new helper'); h.shutdown();
  });
  await ok('requests waiting behind the stuck one fail at once instead of timing out one by one (C-14)', async () => {
    const h = fakeHost(); await h.request('ping');
    const a = h.request('hang', {}, 200), b = h.request('hang', {}, 60000), t0 = Date.now();
    await assert.rejects(a, /did not answer in time/); await assert.rejects(b, /restarted/); assert(Date.now() - t0 < 5000); h.shutdown();
  });
  await ok('process(): audio comes back intact through the temporary files, in pieces (C-15)', async () => {
    const h = fakeHost(), n = 5 * 1024 * 1024, L = new Float32Array(n), R = new Float32Array(n); for (let i = 0; i < n; i += 1000) { L[i] = i / n; R[i] = -i / n; }
    const o = await h.process([L, R], 48000, 0); assert.strictEqual(o.length, 2); assert.strictEqual(o[0].length, n);
    for (let i = 0; i < n; i += 1000) { assert.strictEqual(o[0][i], L[i]); assert.strictEqual(o[1][i], R[i]); }
    h.shutdown();
  });
  await ok('status() answers at once while the search runs, statusAsync() waits for it (C-12)', async () => {
    const h = new VstHost({}); h.candidates = () => [{ cmd: process.execPath, pre: ['-e', 'setTimeout(()=>process.exit(1),400)', '--'], source: 'system' }];
    const t0 = Date.now(), s = h.status(); assert(Date.now() - t0 < 100, 'blocked ' + (Date.now() - t0) + ' ms'); assert(s.checking && !s.available);
    const s2 = await h.statusAsync(); assert(!s2.checking && !s2.available && s2.error, JSON.stringify(s2));
  });
  await ok('a missing ffmpeg costs no child process (C-12)', () => {
    assert.strictEqual(video.programExists('no-such-program-here', { PATH: __dirname, PATHEXT: '.EXE' }), false);
    assert.strictEqual(video.programExists(process.execPath), true);
    const t0 = Date.now(), old = process.env.PATH, ff = process.env.AUDIOSTAGE_FFMPEG; process.env.PATH = __dirname; delete process.env.AUDIOSTAGE_FFMPEG;
    try { assert.strictEqual(video.findFfmpeg({}), null); assert(Date.now() - t0 < 200); } finally { process.env.PATH = old; if (ff) process.env.AUDIOSTAGE_FFMPEG = ff; }
  });
  if (!fs.existsSync(venv)) console.log('skip  tools/vst/.venv is not installed: the helper threading test was not run');
  else await ok('the helper answers other requests while a plugin window is open, refuses another load (C-28, stand-in plugin)', async () => {
    const p = spawn(venv, ['-I', '-u', HOST_SCRIPT], { stdio: ['pipe', 'pipe', 'inherit'], env: { ...process.env, AUDIOSTAGE_VST_FAKE_PLUGIN: '1', PYTHONIOENCODING: 'utf-8' } });
    let buf = ''; const got = new Map(), wait = new Map(); p.stdout.setEncoding('utf8');
    p.stdout.on('data', (d) => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { const m = JSON.parse(buf.slice(0, i)); buf = buf.slice(i + 1); got.set(m.id, m); if (wait.has(m.id)) wait.get(m.id)(m); } });
    const ask = (id, o) => new Promise((res, rej) => { wait.set(id, res); setTimeout(() => rej(new Error('no answer to ' + o.cmd)), 30000); p.stdin.write(JSON.stringify({ id, ...o }) + '\n'); });
    try {
      await ask(1, { cmd: 'ping' });
      const editor = ask(2, { cmd: 'editor', maxSeconds: 4 });
      const t0 = Date.now(), ping = await ask(3, { cmd: 'ping' }); assert(ping.ok && Date.now() - t0 < 3000, 'ping waited for the window');
      assert(!got.has(2), 'the window is still open');
      const load = await ask(4, { cmd: 'unload' }); assert(!load.ok && /Close the plugin window/.test(load.error), JSON.stringify(load));
      const closed = await editor; assert(closed.ok, JSON.stringify(closed));
      assert((await ask(5, { cmd: 'ping' })).ok, 'still works after the window closed');
    } finally { p.kill(); }
  });
  console.log(fail ? `\n${fail} failed` : '\nall passed'); process.exit(fail ? 1 : 0);
})();

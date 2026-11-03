// Run: node tests/runtimes.test.js — electron/runtimes.js (Install VST Support… / Install ffmpeg…) and the Python search
// of electron/vst-host.js, offline: a local HTTP server stands in for python.org / PyPI / GitHub, a fake runner for the
// processes, a temp folder for userData. Set VST3_TEST_PLUGIN=<path of a .vst3> to also test-load a real plugin.
const assert = require('assert'), fs = require('fs'), os = require('os'), path = require('path'), http = require('http'), crypto = require('crypto'), zlib = require('zlib');
const { ok, okAsync, done } = require('./_sandbox');
const R = require('../electron/runtimes');
const V = require('../electron/vst-host');

const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), 'as-rt-' + (p || '')));
/* a small ZIP writer (store / deflate) for the archives the mock server hands out */
function makeZip(files, deflate) {
  const loc = [], cen = []; let off = 0;
  for (const [name, content] of Object.entries(files)) {
    const data = Buffer.from(content), comp = deflate ? zlib.deflateRawSync(data) : data, nm = Buffer.from(name), crc = zlib.crc32 ? zlib.crc32(data) : 0;
    const h = Buffer.alloc(30); h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(deflate ? 8 : 0, 8); h.writeUInt32LE(crc >>> 0, 14); h.writeUInt32LE(comp.length, 18); h.writeUInt32LE(data.length, 22); h.writeUInt16LE(nm.length, 26);
    const c = Buffer.alloc(46); c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(deflate ? 8 : 0, 10); c.writeUInt32LE(crc >>> 0, 16); c.writeUInt32LE(comp.length, 20); c.writeUInt32LE(data.length, 24); c.writeUInt16LE(nm.length, 28); c.writeUInt32LE(off, 42);
    loc.push(h, nm, comp); cen.push(c, nm); off += 30 + nm.length + comp.length;
  }
  const cd = Buffer.concat(cen), e = Buffer.alloc(22); e.writeUInt32LE(0x06054b50, 0); e.writeUInt16LE(cen.length / 2, 8); e.writeUInt16LE(cen.length / 2, 10); e.writeUInt32LE(cd.length, 12); e.writeUInt32LE(off, 16);
  return Buffer.concat([...loc, cd, e]);
}
/* the mock network: path → Buffer | {redirect} | {slow: Buffer} | {status} */
function server(routes) {
  return new Promise((resolve) => {
    const s = http.createServer((req, res) => {
      const r = routes[req.url];
      if (!r) { res.writeHead(404); res.end(); return; }
      if (r.redirect) { res.writeHead(302, { Location: r.redirect }); res.end(); return; }
      if (r.status) { res.writeHead(r.status); res.end(); return; }
      if (r.slow) { res.writeHead(200, { 'Content-Length': r.slow.length }); let i = 0; const t = setInterval(() => { if (res.destroyed || i >= r.slow.length) { clearInterval(t); res.end(); return; } res.write(r.slow.subarray(i, i + 1024)); i += 1024; }, 20); res.on('close', () => clearInterval(t)); return; }
      res.writeHead(200, { 'Content-Length': r.length }); res.end(r);
    });
    s.listen(0, '127.0.0.1', () => resolve({ url: `http://127.0.0.1:${s.address().port}`, close: () => new Promise((r) => { s.closeAllConnections && s.closeAllConnections(); s.close(r); }) }));
  });
}

/* ---- the Python search order and the hint ---- */
ok('python search order: AUDIOSTAGE_PYTHON → installed runtime → tools/vst/.venv → system', () => {
  const ud = tmp('ud'), rt = path.join(ud, 'vst-runtime', 'python', 'python.exe'), venv = path.join(ud, 'venv-python.exe');
  fs.mkdirSync(path.dirname(rt), { recursive: true }); fs.writeFileSync(rt, ''); fs.writeFileSync(venv, '');
  const c = V.pythonCandidates({ env: { AUDIOSTAGE_PYTHON: 'C:\\my\\python.exe' }, runtimePy: rt, venvPy: venv, platform: 'win32' });
  assert.deepStrictEqual(c.map((x) => x.source), ['env', 'runtime', 'venv', 'system', 'system']);
  assert.strictEqual(c[1].cmd, rt); assert.deepStrictEqual(c[3], { cmd: 'py', pre: ['-3'], source: 'system' });
  // nothing installed: straight to the system Python; a runtime that is not on disk is not offered
  const c2 = V.pythonCandidates({ env: {}, runtimePy: path.join(ud, 'nope.exe'), venvPy: path.join(ud, 'nope2.exe'), platform: 'linux' });
  assert.deepStrictEqual(c2.map((x) => x.cmd), ['python3', 'python']);
  fs.rmSync(ud, { recursive: true, force: true });
});
ok('the installed app never tells the user to run npm', () => {
  const w = V.hintFor({ platform: 'win32', arch: 'x64', packaged: true }), l = V.hintFor({ platform: 'linux', arch: 'x64', packaged: true }), m = V.hintFor({ platform: 'darwin', arch: 'arm64', packaged: true });
  for (const h of [w, l, m]) assert(!/npm/.test(h), h);
  assert(/Install VST Support/.test(w), w); assert(/pip install pedalboard/.test(l));
  assert(/npm run setup:vst/.test(V.hintFor({ platform: 'win32', arch: 'x64', packaged: false })), 'developers still see the npm script');
});
ok('detectPython takes the first candidate that imports pedalboard, remembers it until reset()', () => {
  const h = new V.VstHost({ probe: (cmd) => (cmd === 'good' ? { status: 0, stdout: '0.9.26\n' } : cmd === 'nopb' ? { status: 1, stderr: "ModuleNotFoundError: No module named 'pedalboard'" } : { error: { code: 'ENOENT' } }) });
  let list = [{ cmd: 'missing', pre: [], source: 'env' }, { cmd: 'nopb', pre: [], source: 'runtime' }, { cmd: 'good', pre: [], source: 'system' }];
  h.candidates = () => list;
  assert.deepStrictEqual(h.detectPython(), { cmd: 'good', pre: [], source: 'system', pedalboard: '0.9.26' });
  list = [{ cmd: 'nopb', pre: [], source: 'runtime' }];
  assert.strictEqual(h.detectPython().cmd, 'good', 'cached');
  h.reset(); // after Install / Remove: no restart needed
  const st = h.status(); assert(!st.available && /not installed/.test(st.error) && st.hint, JSON.stringify(st));
});

/* ---- small pieces ---- */
ok('enableSite: the embeddable ._pth gets import site and Lib\\site-packages (once)', () => {
  const d = tmp('pth'); fs.writeFileSync(path.join(d, 'python313._pth'), 'python313.zip\r\n.\r\n\r\n# Uncomment to run site.main() automatically\r\n#import site\r\n');
  R.enableSite(d); R.enableSite(d);
  const t = fs.readFileSync(path.join(d, 'python313._pth'), 'utf8').split('\r\n');
  assert(t.includes('import site') && t.filter((l) => l === 'Lib\\site-packages').length === 1 && t.indexOf('Lib\\site-packages') < t.indexOf('import site'), t.join('|'));
  fs.rmSync(d, { recursive: true, force: true });
});
ok('pickFfmpeg: the newest LGPL shared Windows release build, master as fallback, never GPL', () => {
  const s = (n) => sha(n) + '  ' + n;
  const text = [s('ffmpeg-master-latest-win64-gpl.zip'), s('ffmpeg-master-latest-win64-lgpl-shared.zip'), s('ffmpeg-n8.1-latest-win64-lgpl-shared-8.1.zip'), s('ffmpeg-n9.0-latest-win64-gpl-shared-9.0.zip'), s('ffmpeg-n9.0-latest-win64-lgpl-shared-9.0.zip'), s('ffmpeg-n9.0-latest-linux64-lgpl-shared-9.0.tar.xz')].join('\n');
  assert.deepStrictEqual(R.pickFfmpeg(text).map((r) => r.name), ['ffmpeg-n9.0-latest-win64-lgpl-shared-9.0.zip', 'ffmpeg-n8.1-latest-win64-lgpl-shared-8.1.zip', 'ffmpeg-master-latest-win64-lgpl-shared.zip']);
  assert.strictEqual(R.pickFfmpeg(text)[0].sha256, sha('ffmpeg-n9.0-latest-win64-lgpl-shared-9.0.zip'));
});
okAsync('unzip: stored + deflated entries, pick(), refuses paths that leave the folder', async () => {
  const d = tmp('zip'), z = path.join(d, 'a.zip');
  fs.writeFileSync(z, makeZip({ 'top/bin/ffmpeg.exe': 'EXE', 'top/doc/readme.txt': 'x'.repeat(5000), 'top/LICENSE.txt': 'LGPL' }, true));
  await R.unzip(z, path.join(d, 'out'), (n) => { const m = /^[^/]+\/(bin\/[^/]+|LICENSE[^/]*)$/.exec(n); return m ? m[1] : null; });
  assert.strictEqual(fs.readFileSync(path.join(d, 'out/bin/ffmpeg.exe'), 'utf8'), 'EXE'); assert(fs.existsSync(path.join(d, 'out/LICENSE.txt')) && !fs.existsSync(path.join(d, 'out/doc')));
  fs.writeFileSync(z, makeZip({ '../evil.txt': 'x' }, false));
  await assert.rejects(R.unzip(z, path.join(d, 'out2')), /Unsafe path/);
  fs.writeFileSync(z, 'not a zip'); await assert.rejects(R.unzip(z, path.join(d, 'out3')), /not a valid ZIP/);
  fs.rmSync(d, { recursive: true, force: true });
});
okAsync('download: progress, redirects, SHA-256; HTTP errors, refused connections and cancel are readable', async () => {
  const body = crypto.randomBytes(300000), srv = await server({ '/f': body, '/r': { redirect: '/f' }, '/gone': { status: 404 }, '/slow': { slow: crypto.randomBytes(400000) } });
  const d = tmp('dl'); let last = null;
  const r = await R.download(srv.url + '/r', path.join(d, 'f.bin'), { onProgress: (g, t) => (last = [g, t]) });
  assert.strictEqual(r.sha256, sha(body)); assert.deepStrictEqual(last, [body.length, body.length]); assert(fs.readFileSync(path.join(d, 'f.bin')).equals(body));
  await assert.rejects(R.download(srv.url + '/gone', path.join(d, 'g')), /HTTP 404/);
  const ac = new AbortController();
  const p = R.download(srv.url + '/slow', path.join(d, 's.bin'), { signal: ac.signal, onProgress: (g) => { if (g > 20000) ac.abort(); } });
  await assert.rejects(p, (e) => e.code === 'CANCELLED');
  assert(!fs.existsSync(path.join(d, 's.bin')) && !fs.existsSync(path.join(d, 's.bin.part')), 'the partial file is deleted');
  await srv.close();
  await assert.rejects(R.download(srv.url + '/f', path.join(d, 'x')), /refused the connection/);
  fs.rmSync(d, { recursive: true, force: true });
});

/* ---- the whole installs, against the mock network ---- */
function vstFixture(srvUrl, o) {
  const pyZip = makeZip({ 'python.exe': 'fake python', 'python313._pth': 'python313.zip\r\n.\r\n#import site\r\n', 'python313.zip': 'stdlib' }, true), whl = Buffer.from('fake pip wheel');
  const sources = { python: { version: '3.13.17', url: srvUrl + '/python.zip', sha256: o && o.badSum ? sha('other') : sha(pyZip), size: pyZip.length }, pip: { version: '26', url: srvUrl + '/pip-26-py3-none-any.whl', sha256: sha(whl), size: whl.length } };
  return { pyZip, whl, sources };
}
okAsync('Install VST Support (mock network + runner): Python unpacked, site enabled, pip + requirements installed, status says installed', async () => {
  const routes = {}, srv = await server(routes), fx = vstFixture(srv.url); routes['/python.zip'] = fx.pyZip; routes['/pip-26-py3-none-any.whl'] = fx.whl;
  const ud = tmp('ud'), calls = [], steps = [];
  const rts = new R.Runtimes({ userData: ud, platform: 'win32', arch: 'x64', sources: fx.sources, requirements: 'REQ.txt', run: async (cmd, args, o) => { calls.push([cmd, args, o.env]); if (o.onLine) o.onLine('Collecting pedalboard'); return { code: 0, out: args.includes('-I') ? '0.9.26 2.3.1 3.13.17\n' : 'Successfully installed' }; } });
  assert.strictEqual(rts.status('vst').installed, false);
  const st = await rts.install('vst', (p) => steps.push(p));
  assert(st.installed && !st.busy && st.path === path.join(ud, 'vst-runtime', 'python', 'python.exe'), JSON.stringify(st));
  assert.deepStrictEqual({ python: st.info.python, pedalboard: st.info.pedalboard, numpy: st.info.numpy }, { python: '3.13.17', pedalboard: '0.9.26', numpy: '2.3.1' });
  assert(/import site/.test(fs.readFileSync(path.join(ud, 'vst-runtime/python/python313._pth'), 'utf8')));
  assert.strictEqual(calls.length, 3); assert(calls.every((c) => c[0] === path.join(ud, 'vst-runtime', 'python.new', 'python.exe')), 'runs the new Python');
  assert(calls[1][1].join(' ').includes('-m pip install') && calls[1][1].includes('REQ.txt') && calls[1][1].includes('--only-binary=:all:'));
  assert.strictEqual(calls[1][2].PYTHONNOUSERSITE, '1');
  for (let i = 1; i < steps.length; i++) assert(steps[i].pct >= steps[i - 1].pct - 1e-9, 'progress only goes forward');
  assert.strictEqual(steps[steps.length - 1].pct, 1);
  assert(!fs.existsSync(path.join(ud, 'vst-runtime/.download')) && !fs.existsSync(path.join(ud, 'vst-runtime/python.new')), 'temp files cleaned');
  // the Python search now finds it first (after env)
  assert.strictEqual(V.pythonCandidates({ env: {}, runtimePy: rts.pythonExe(), platform: 'win32' })[0].source, 'runtime');
  assert(rts.remove('vst') && !rts.status('vst').installed && !fs.existsSync(path.join(ud, 'vst-runtime')));
  await srv.close(); fs.rmSync(ud, { recursive: true, force: true });
});
okAsync('a failed checksum, pip error or cancelled download never touches the working runtime', async () => {
  const routes = {}, srv = await server(routes), ud = tmp('ud');
  const runOk = async (cmd, args) => ({ code: 0, out: args.includes('-I') ? '0.9.26 2.3.1 3.13.17' : '' });
  const final = path.join(ud, 'vst-runtime', 'python'); fs.mkdirSync(final, { recursive: true }); fs.writeFileSync(path.join(final, 'python.exe'), 'the old working one');
  // checksum mismatch
  let fx = vstFixture(srv.url, { badSum: true }); routes['/python.zip'] = fx.pyZip; routes['/pip-26-py3-none-any.whl'] = fx.whl;
  let rts = new R.Runtimes({ userData: ud, platform: 'win32', arch: 'x64', sources: fx.sources, requirements: 'r', run: runOk });
  await assert.rejects(rts.install('vst'), /checksum/);
  // pip cannot reach PyPI
  fx = vstFixture(srv.url); routes['/python.zip'] = fx.pyZip;
  rts = new R.Runtimes({ userData: ud, platform: 'win32', arch: 'x64', sources: fx.sources, requirements: 'r', run: async (c, args) => (args.includes('-r') ? { code: 1, out: 'ERROR: Could not find a version that satisfies the requirement pedalboard' } : { code: 0, out: '' }) });
  await assert.rejects(rts.install('vst'), /could not download the plugin-host packages/);
  // cancel during the (slow) Python download
  routes['/python.zip'] = { slow: fx.pyZip.length > 60000 ? fx.pyZip : Buffer.concat([fx.pyZip, crypto.randomBytes(200000)]) };
  rts = new R.Runtimes({ userData: ud, platform: 'win32', arch: 'x64', sources: fx.sources, requirements: 'r', run: runOk });
  let cancelled = false;
  const p = rts.install('vst', (pr) => { if (!cancelled && pr.phase === 'download' && pr.pct > 0.01) { cancelled = true; assert(rts.status('vst').busy); rts.cancel('vst'); } });
  await assert.rejects(p, (e) => e.code === 'CANCELLED');
  assert(!rts.status('vst').busy, 'not busy any more');
  assert.strictEqual(fs.readFileSync(path.join(final, 'python.exe'), 'utf8'), 'the old working one');
  assert(!fs.existsSync(path.join(ud, 'vst-runtime/python.new')) && !fs.existsSync(path.join(ud, 'vst-runtime/.download')));
  // other systems: no automatic install, a pip hint instead
  await assert.rejects(new R.Runtimes({ userData: ud, platform: 'linux', arch: 'x64' }).install('vst'), /pip install pedalboard/);
  await srv.close(); fs.rmSync(ud, { recursive: true, force: true });
});
okAsync('Install ffmpeg (mock GitHub release): the LGPL build from checksums.sha256, bin + LICENSE only; findFfmpeg prefers it over PATH', async () => {
  const name = 'ffmpeg-n9.0-latest-win64-lgpl-shared-9.0.zip', top = name.replace(/\.zip$/, '');
  const zip = makeZip({ [top + '/bin/ffmpeg.exe']: 'EXE', [top + '/bin/avcodec-62.dll']: 'DLL', [top + '/LICENSE.txt']: 'LGPL', [top + '/include/x.h']: 'h' }, true);
  const srv = await server({ '/rel/checksums.sha256': Buffer.from(`${sha('g')}  ffmpeg-n9.0-latest-win64-gpl-9.0.zip\n${sha(zip)}  ${name}\n`), ['/rel/' + name]: zip });
  const ud = tmp('ud'), rts = new R.Runtimes({ userData: ud, platform: 'win32', arch: 'x64', sources: { ffmpeg: { base: srv.url + '/rel/', checksums: 'checksums.sha256' } }, run: async () => ({ code: 0, out: 'ffmpeg version n9.0-7-g1234 Copyright' }) });
  const st = await rts.install('ffmpeg');
  assert(st.installed && st.info.build === name && st.info.license === 'LGPL' && st.info.version === 'n9.0-7-g1234', JSON.stringify(st));
  assert(fs.existsSync(path.join(ud, 'ffmpeg/build/bin/avcodec-62.dll')) && !fs.existsSync(path.join(ud, 'ffmpeg/build/include')));
  assert.deepStrictEqual(require('../electron/video').ffmpegCandidates({ local: rts.ffmpegExe() }).map((c) => c[1]).filter((s) => s !== 'env'), ['installed', 'path']);
  rts.remove('ffmpeg'); assert(!rts.status('ffmpeg').installed);
  await srv.close(); fs.rmSync(ud, { recursive: true, force: true });
});

/* ---- Plugin Manager scan ---- */
okAsync('Plugin Manager scan: ok / failed / crashed, remembered; crashed ones skipped until Retry; an interrupted scan counts as a crash', async () => {
  const d = tmp('pm'), cache = path.join(d, 'vst-scan.json'), plug = (n) => { const f = path.join(d, n + '.vst3'); fs.writeFileSync(f, n); return { path: f, name: n, kind: 'VST3' }; };
  const list = [plug('Good'), plug('Bad'), plug('Boom')], loads = [];
  const host = { detectPython: () => ({ cmd: 'py' }), hint: () => '', shutdown() {}, async request(cmd, a) {
    if (cmd === 'unload') return {}; loads.push(path.basename(a.path));
    if (/Good/.test(a.path)) return { name: 'Good Verb', manufacturer: 'Free DSP', params: [1, 2] };
    if (/Bad/.test(a.path)) throw new Error('RuntimeError: Unable to load plugin: not a VST3');
    throw new Error('The plugin host stopped unexpectedly (exit 3221225477).');
  } };
  let out = await V.verifyPlugins(host, list, { cacheFile: cache });
  assert.deepStrictEqual(out.map((p) => p.status), ['ok', 'failed', 'crashed']);
  assert(out[0].vendor === 'Free DSP' && /not a VST3/.test(out[1].reason) && !/RuntimeError/.test(out[1].reason) && /crashed/.test(out[2].reason));
  loads.length = 0; out = await V.verifyPlugins(host, list, { cacheFile: cache });
  assert.deepStrictEqual(loads, [], 'unchanged plugins are not loaded again'); assert(out[2].skipped);
  loads.length = 0; await V.verifyPlugins(host, list, { cacheFile: cache, force: true });
  assert.deepStrictEqual(loads, ['Good.vst3', 'Bad.vst3'], 'Rescan All still skips the crashed plugin');
  loads.length = 0; await V.verifyPlugins(host, list, { cacheFile: cache, retry: [list[2].path] });
  assert.deepStrictEqual(loads, ['Boom.vst3'], 'Retry loads it');
  assert.deepStrictEqual(V.annotate(list, cache).map((p) => p.status), ['ok', 'failed', 'crashed'], 'the plugin list shows the results without loading');
  // the app died while a plugin was loading
  const c = V.readScanCache(cache); c.plugins[list[0].path].status = 'scanning'; fs.writeFileSync(cache, JSON.stringify(c));
  assert.strictEqual(V.annotate(list, cache)[0].status, 'crashed');
  out = await V.verifyPlugins(host, list, { cacheFile: cache }); assert(out[0].status === 'crashed' && /closed while/.test(out[0].reason));
  fs.rmSync(d, { recursive: true, force: true });
});

/* ---- a real plugin, when one is given ---- */
if (process.env.VST3_TEST_PLUGIN) okAsync('real plugin test-load: ' + process.env.VST3_TEST_PLUGIN, async () => {
  const h = new V.VstHost(); const st = h.status(); assert(st.available, st.error);
  const d = tmp('pm'), p = process.env.VST3_TEST_PLUGIN, out = await V.verifyPlugins(h, [{ path: p, name: path.basename(p), kind: 'VST3' }], { cacheFile: path.join(d, 'c.json') });
  h.shutdown(); assert.strictEqual(out[0].status, 'ok', out[0].reason); fs.rmSync(d, { recursive: true, force: true });
});
else console.log('skip  VST3_TEST_PLUGIN is not set — the real plugin load is skipped');
done();

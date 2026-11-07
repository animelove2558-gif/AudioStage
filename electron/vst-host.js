// Manages the Python plugin-host child process (tools/vst/vst_host.py) for offline VST3/AU processing.
const { spawn, spawnSync } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path');

// In the installed app the code lives inside app.asar; Python must run the unpacked copy of tools/vst.
const ROOT = path.join(__dirname, '..').replace(/app\.asar(?=[\\/]|$)/, 'app.asar.unpacked');
const HOST_SCRIPT = path.join(ROOT, 'tools', 'vst', 'vst_host.py');
const VENV_PY = path.join(ROOT, 'tools', 'vst', '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');

function defaultPluginDirs() {
  const h = os.homedir();
  if (process.platform === 'win32') return [path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Common Files', 'VST3'), path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Common Files', 'VST3'), path.join(process.env.LOCALAPPDATA || path.join(h, 'AppData', 'Local'), 'Programs', 'Common', 'VST3')];
  if (process.platform === 'darwin') return ['/Library/Audio/Plug-Ins/VST3', path.join(h, 'Library/Audio/Plug-Ins/VST3'), '/Library/Audio/Plug-Ins/Components', path.join(h, 'Library/Audio/Plug-Ins/Components')];
  return [path.join(h, '.vst3'), '/usr/lib/vst3', '/usr/local/lib/vst3'];
}

/* where the plugin host's Python comes from, in this order: AUDIOSTAGE_PYTHON → the runtime the app installed into
   userData (Install VST Support…) → tools/vst/.venv (npm run setup:vst, development) → a system Python */
function pythonCandidates(o) {
  const env = o.env || process.env, exists = o.exists || fs.existsSync, win = (o.platform || process.platform) === 'win32', out = [];
  if (env.AUDIOSTAGE_PYTHON) out.push({ cmd: env.AUDIOSTAGE_PYTHON, pre: [], source: 'env' });
  if (o.runtimePy && exists(o.runtimePy)) out.push({ cmd: o.runtimePy, pre: [], source: 'runtime' });
  if (o.venvPy && exists(o.venvPy)) out.push({ cmd: o.venvPy, pre: [], source: 'venv' });
  for (const [cmd, pre] of win ? [['py', ['-3']], ['python', []]] : [['python3', []], ['python', []]]) out.push({ cmd, pre, source: 'system' });
  return out;
}
/* what to tell the user when there is no plugin host. The installed app never mentions npm: on Windows x64 it points
   at Install VST Support…, elsewhere at pip. npm run setup:vst stays for developers (npm start). */
function hintFor(o) {
  if (o.platform === 'win32' && o.arch === 'x64') return 'Click “Install VST Support…” — AudioStage downloads Python and the free plugin host (pedalboard) into its own data folder (about 40 MB, one time). Nothing else needs to be installed.' + (o.packaged ? '' : ' (Developers can also run  npm run setup:vst.)');
  if (o.packaged) return 'Install Python 3.10 or newer, then run  python3 -m pip install pedalboard numpy  and click Retry (or point AUDIOSTAGE_PYTHON at that Python).';
  return 'Run  npm run setup:vst  in the AudioStage folder (or  python3 -m pip install pedalboard numpy), then click Retry.';
}

class VstHost {
  /* o: { runtimePy: python.exe of the runtime installed into userData, packaged: running from the installed .exe,
          probe(cmd, pre) → {status, stdout, stderr, error} (tests) } */
  constructor(o = {}) { this.child = null; this.pending = new Map(); this.seq = 1; this.buf = ''; this.pythonInfo = null; this.lastStderr = ''; this.tmp = path.join(os.tmpdir(), 'audiostage-vst-' + process.pid + '-' + Math.random().toString(16).slice(2, 6)); this.runtimePy = o.runtimePy || null; this.packaged = !!o.packaged; this.probe = o.probe || null; }

  candidates() { return pythonCandidates({ runtimePy: this.runtimePy, venvPy: VENV_PY }); }
  /* find a python that can import pedalboard (a success is cached until reset()) */
  detectPython() {
    if (this.pythonInfo) return this.pythonInfo;
    // a failed detection is remembered for a minute: every vst:status / vst:call used to run up to three child processes again
    if (this.noPython && Date.now() - this.noPython.at < 60000) return this.noPython.info;
    let lastErr = '';
    for (const { cmd, pre, source } of this.candidates()) {
      const r = this.probe ? this.probe(cmd, pre) : spawnSync(cmd, [...pre, '-I', '-c', 'import pedalboard,numpy;print(pedalboard.__version__)'], { encoding: 'utf8', timeout: source === 'system' ? 10000 : 30000, windowsHide: true });
      if (r.status === 0) return (this.pythonInfo = { cmd, pre, source, pedalboard: String(r.stdout).trim() });
      if (r.error) { if (source !== 'system') lastErr = `${cmd}: ${r.error.code || r.error.message}`; continue; } // a missing system python says nothing new
      lastErr = /No module named/.test(r.stderr || '') ? 'The plugin-host packages (pedalboard) are not installed.' : (r.stderr || '').trim().split('\n').pop() || lastErr;
    }
    const info = { error: lastErr || 'Python was not found.' }; this.noPython = { at: Date.now(), info };
    return info;
  }
  /* the same without blocking: one child process at a time, on the event loop. Concurrent callers share the run. */
  detectAsync() {
    if (this.probe) return Promise.resolve(this.detectPython());
    if (this.pythonInfo) return Promise.resolve(this.pythonInfo);
    if (this.noPython && Date.now() - this.noPython.at < 60000) return Promise.resolve(this.noPython.info);
    if (this.detecting) return this.detecting;
    const run = (cmd, pre, ms) => new Promise((res) => {
      let out = '', err = '', done = false, p;
      const end = (r) => { if (done) return; done = true; clearTimeout(t); res(r); };
      const t = setTimeout(() => { try { if (p) p.kill(); } catch (e) { /* */ } end({ status: null, stdout: out, stderr: err, error: new Error('timed out') }); }, ms);
      try { p = spawn(cmd, [...pre, '-I', '-c', 'import pedalboard,numpy;print(pedalboard.__version__)'], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }); } catch (e) { end({ status: null, stdout: '', stderr: '', error: e }); return; }
      p.stdout.setEncoding('utf8'); p.stderr.setEncoding('utf8'); p.stdout.on('data', (d) => (out += d)); p.stderr.on('data', (d) => (err += d));
      p.on('error', (e) => end({ status: null, stdout: out, stderr: err, error: e })); p.on('close', (code) => end({ status: code, stdout: out, stderr: err }));
    });
    return (this.detecting = (async () => {
      let lastErr = '';
      try {
        for (const { cmd, pre, source } of this.candidates()) {
          const r = await run(cmd, pre, source === 'system' ? 10000 : 30000);
          if (r.status === 0) return (this.pythonInfo = { cmd, pre, source, pedalboard: String(r.stdout).trim() });
          if (r.error) { if (source !== 'system') lastErr = `${cmd}: ${r.error.code || r.error.message}`; continue; }
          lastErr = /No module named/.test(r.stderr || '') ? 'The plugin-host packages (pedalboard) are not installed.' : (r.stderr || '').trim().split('\n').pop() || lastErr;
        }
        const info = { error: lastErr || 'Python was not found.' }; this.noPython = { at: Date.now(), info };
        return info;
      } finally { this.detecting = null; }
    })());
  }
  /* forget the detected Python and stop the helper: the next request uses a runtime that was just installed / removed */
  reset() { this.shutdown(); this.pythonInfo = null; this.noPython = null; }
  hint() { return hintFor({ platform: process.platform, arch: process.arch, packaged: this.packaged }); }
  /* never blocks: while the search runs in the background it says checking: true (the preload asks again until it is done) */
  status() {
    const canInstall = process.platform === 'win32' && process.arch === 'x64', known = this.probe || this.pythonInfo || (this.noPython && Date.now() - this.noPython.at < 60000);
    if (!known) { this.detectAsync(); return { available: false, checking: true, error: 'Looking for Python…', hint: this.hint(), canInstall }; }
    const p = this.detectPython();
    if (p.error) return { available: false, error: p.error, hint: this.hint(), canInstall };
    return { available: true, python: p.cmd, source: p.source, pedalboard: p.pedalboard, platform: process.platform, canInstall };
  }

  async statusAsync() { await this.detectAsync(); return this.status(); }

  ensureChild() {
    if (this.child) return;
    const p = this.detectPython(); if (p.error) throw new Error(p.error + ' ' + this.hint());
    fs.mkdirSync(this.tmp, { recursive: true });
    const child = this.spawnFor ? this.spawnFor() : spawn(p.cmd, [...p.pre, '-I', '-u', HOST_SCRIPT], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, env: { ...process.env, PYTHONIOENCODING: 'utf-8' } });
    this.child = child; this.buf = '';
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    child.stdout.on('data', (d) => {
      this.buf += d; let i;
      while ((i = this.buf.indexOf('\n')) >= 0) {
        const line = this.buf.slice(0, i); this.buf = this.buf.slice(i + 1);
        let msg; try { msg = JSON.parse(line); } catch (e) { continue; }
        const pr = this.pending.get(msg.id); if (!pr) continue;
        this.pending.delete(msg.id); clearTimeout(pr.timer);
        msg.ok ? pr.res(msg) : pr.rej(new Error(msg.error || 'Plugin host error'));
      }
    });
    child.stderr.on('data', (d) => { this.lastStderr = (this.lastStderr + d).slice(-2000); });
    const dead = (why) => {
      if (this.child !== child) return; this.child = null;
      for (const pr of this.pending.values()) { clearTimeout(pr.timer); pr.rej(new Error(why)); }
      this.pending.clear();
    };
    child.on('exit', (code, sig) => dead(`The plugin host stopped unexpectedly (${sig || 'exit ' + code}). The plugin probably crashed — reload it.`));
    child.on('error', (e) => dead('Cannot start the plugin host: ' + e.message));
    // the helper died (a plugin crashed it) while a request was being written: EPIPE arrives here, not as an uncaught
    // exception; the pending requests fail with the same message as an unexpected exit
    child.stdin.on('error', (e) => dead(`The plugin host stopped unexpectedly (${e.code || e.message}). The plugin probably crashed — reload it.`));
  }
  /* the helper is stuck in an old job and every later request would queue behind it: end it; the next request starts a new one */
  abortChild(why) {
    const c = this.child; this.child = null;
    for (const pr of this.pending.values()) { clearTimeout(pr.timer); pr.rej(new Error(why)); }
    this.pending.clear();
    if (c) { try { c.kill(); } catch (e) { /* */ } }
  }
  async request(cmd, args = {}, timeoutMs = 60000) {
    if (!this.child) await this.detectAsync(); // (the search for Python never blocks the main process)
    return new Promise((res, rej) => {
      try { this.ensureChild(); } catch (e) { rej(e); return; }
      const id = this.seq++;
      const timer = setTimeout(() => { this.pending.delete(id); rej(new Error('The plugin host did not answer in time, so it was restarted. Load the plugin again.')); this.abortChild('The plugin host was restarted because an earlier request did not answer in time. Load the plugin again.'); }, timeoutMs);
      this.pending.set(id, { res, rej, timer });
      const fail = (e) => { if (!this.pending.has(id)) return; this.pending.delete(id); clearTimeout(timer); rej(new Error(`The plugin host stopped unexpectedly (${(e && (e.code || e.message)) || 'write failed'}). The plugin probably crashed — reload it.`)); };
      const stdin = this.child && this.child.stdin;
      if (!stdin || !stdin.writable) { fail({ code: 'not running' }); return; }
      try { stdin.write(JSON.stringify({ id, cmd, ...args }) + '\n', (e) => { if (e) fail(e); }); } catch (e) { fail(e); }
    });
  }

  /* list plugin files in standard + extra folders (filesystem only: nothing is loaded here) */
  scan(extraDirs = []) {
    const out = [], seen = new Set();
    const exts = process.platform === 'darwin' ? ['.vst3', '.component'] : ['.vst3'];
    let visited = 0; const deadline = Date.now() + 5000; // a huge folder added as a plugin folder must not freeze the app
    const walk = (dir, depth) => {
      if (++visited > 20000 || Date.now() > deadline) return;
      let ents; try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
      for (const e of ents) {
        const full = path.join(dir, e.name), ext = path.extname(e.name).toLowerCase();
        if (exts.includes(ext)) { if (!seen.has(full)) { seen.add(full); out.push({ path: full, name: path.basename(e.name, ext), kind: ext === '.component' ? 'AU' : 'VST3' }); } }
        else if (e.isDirectory() && depth < 3) walk(full, depth + 1);
      }
    };
    for (const d of [...defaultPluginDirs(), ...extraDirs]) walk(d, 0);
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }

  /* channels: Float32Array[] -> processed Float32Array[] (may be longer by tailSeconds) */
  async process(channels, sr, tailSeconds) {
    const ch = channels.length, n = channels[0].length;
    const id = Date.now() + '-' + Math.random().toString(16).slice(2, 8);
    fs.mkdirSync(this.tmp, { recursive: true });
    const inPath = path.join(this.tmp, id + '.in.f32'), outPath = path.join(this.tmp, id + '.out.f32');
    const PIECE = 16 * 1024 * 1024;
    /* in pieces on the event loop, straight from / into the arrays: no whole-clip Buffer, no frozen window */
    const fhIn = await fs.promises.open(inPath, 'w');
    try { for (const c of channels) { const v = Buffer.from(c.buffer, c.byteOffset, c.byteLength); for (let o = 0; o < v.length;) { const { bytesWritten } = await fhIn.write(v, o, Math.min(PIECE, v.length - o)); o += bytesWritten; } } }
    finally { await fhIn.close(); }
    try {
      const r = await this.request('process', { inPath, outPath, ch, n, sr, tailSeconds: tailSeconds || 0 }, 15 * 60 * 1000);
      const total = r.n, out = [], fhOut = await fs.promises.open(outPath, 'r');
      try {
        for (let c = 0; c < r.ch; c++) {
          const a = new Float32Array(total), v = Buffer.from(a.buffer); let pos = c * total * 4;
          for (let o = 0; o < v.length;) { const { bytesRead } = await fhOut.read(v, o, Math.min(PIECE, v.length - o), pos); if (!bytesRead) break; o += bytesRead; pos += bytesRead; }
          out.push(a);
        }
      } finally { await fhOut.close(); }
      return out;
    } finally { for (const p of [inPath, outPath]) fs.rm(p, { force: true }, () => {}); }
  }

  shutdown() { try { if (this.child) { this.child.stdin.end(); this.child.kill(); } } catch (e) { /* */ } this.child = null; try { fs.rmSync(this.tmp, { recursive: true, force: true }); } catch (e) { /* */ } }
}

/* ---- Plugin Manager scan ----
   Every plugin is loaded once in a helper process of its own (`host`, not the one the effect dialog uses), and the
   result is remembered per file and modification time in cacheFile: ok (name, vendor…), failed (with the reason) or
   crashed. A plugin that takes the helper down is marked crashed and skipped by every later scan until the user
   retries it. Before each load the entry is saved as "scanning", so if the whole app dies while a plugin loads, the
   next scan finds it and marks it crashed too. */
const readScanCache = (f) => { try { const j = JSON.parse(fs.readFileSync(f, 'utf8')); if (j && j.plugins && typeof j.plugins === 'object') return j; } catch (e) { /* none yet */ } return { v: 1, plugins: {} }; };
function writeScanCache(f, c) { require('./savefile').writeFileAtomic(f, JSON.stringify(c)); }
/* list: [{path, name, kind}] (from scan()) → the same entries + {status, reason?, vendor?, version?, params?, skipped?}.
   o: { cacheFile, force (load again even if unchanged; crashed ones stay skipped), retry: [paths], timeoutMs, onProgress(i, n, item) } */
async function verifyPlugins(host, list, o) {
  const cache = readScanCache(o.cacheFile), P = cache.plugins, retry = new Set(o.retry || []), out = [];
  for (const [k, v] of Object.entries(P)) if (v.status === 'scanning') P[k] = { ...v, status: 'crashed', reason: 'AudioStage closed while this plugin was loading — the plugin probably crashed it.' };
  const py = host.detectAsync ? await host.detectAsync() : host.detectPython(); if (py.error) throw new Error(py.error + ' ' + host.hint());
  for (let i = 0; i < list.length; i++) {
    const p = list[i]; let mtime = 0; try { mtime = Math.round(fs.statSync(p.path).mtimeMs); } catch (e) { /* gone */ }
    const c0 = P[p.path];
    if (c0 && c0.status === 'crashed' && !retry.has(p.path)) { out.push({ ...p, ...c0, skipped: true }); continue; }
    if (c0 && c0.mtime === mtime && !o.force && !retry.has(p.path)) { out.push({ ...p, ...c0 }); continue; }
    if (o.onProgress) o.onProgress(i, list.length, p);
    P[p.path] = { status: 'scanning', mtime, name: p.name }; writeScanCache(o.cacheFile, cache);
    let c;
    try {
      const r = await host.request('load', { path: p.path }, o.timeoutMs || 60000);
      c = { status: 'ok', mtime, name: r.name || p.name, vendor: r.manufacturer || '', version: r.version || '', params: (r.params || []).length };
      try { await host.request('unload', {}, 10000); } catch (e) { /* the next load replaces it anyway */ }
    } catch (e) {
      const msg = e.message || String(e), crashed = /stopped unexpectedly/.test(msg), slow = /did not answer in time/.test(msg);
      if (slow) host.shutdown();
      c = { status: crashed ? 'crashed' : 'failed', mtime, name: p.name, reason: crashed ? 'The plugin crashed the plugin host while loading. It is skipped in later scans (Retry tries it again).' : slow ? `It did not finish loading within ${Math.round((o.timeoutMs || 60000) / 1000)} s.` : msg.replace(/^[A-Za-z]+Error: /, '') };
    }
    P[p.path] = c; writeScanCache(o.cacheFile, cache); out.push({ ...p, ...c });
  }
  if (o.onProgress) o.onProgress(list.length, list.length, null);
  return out;
}
/* scan() entries + what the last Plugin Manager scan found (cheap: nothing is loaded) */
function annotate(list, cacheFile) { const P = readScanCache(cacheFile).plugins; return list.map((p) => { const c = P[p.path]; return c ? { ...p, status: c.status === 'scanning' ? 'crashed' : c.status, reason: c.reason, vendor: c.vendor } : p; }); }

module.exports = { VstHost, defaultPluginDirs, pythonCandidates, hintFor, verifyPlugins, annotate, readScanCache, HOST_SCRIPT, ROOT };

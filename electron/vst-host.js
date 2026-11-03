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
    let lastErr = '';
    for (const { cmd, pre, source } of this.candidates()) {
      const r = this.probe ? this.probe(cmd, pre) : spawnSync(cmd, [...pre, '-I', '-c', 'import pedalboard,numpy;print(pedalboard.__version__)'], { encoding: 'utf8', timeout: 30000, windowsHide: true });
      if (r.status === 0) return (this.pythonInfo = { cmd, pre, source, pedalboard: String(r.stdout).trim() });
      if (r.error) { if (source !== 'system') lastErr = `${cmd}: ${r.error.code || r.error.message}`; continue; } // a missing system python says nothing new
      lastErr = /No module named/.test(r.stderr || '') ? 'The plugin-host packages (pedalboard) are not installed.' : (r.stderr || '').trim().split('\n').pop() || lastErr;
    }
    return { error: lastErr || 'Python was not found.' };
  }
  /* forget the detected Python and stop the helper: the next request uses a runtime that was just installed / removed */
  reset() { this.shutdown(); this.pythonInfo = null; }
  hint() { return hintFor({ platform: process.platform, arch: process.arch, packaged: this.packaged }); }
  status() {
    const p = this.detectPython(), canInstall = process.platform === 'win32' && process.arch === 'x64';
    if (p.error) return { available: false, error: p.error, hint: this.hint(), canInstall };
    return { available: true, python: p.cmd, source: p.source, pedalboard: p.pedalboard, platform: process.platform, canInstall };
  }

  ensureChild() {
    if (this.child) return;
    const p = this.detectPython(); if (p.error) throw new Error(p.error + ' ' + this.hint());
    fs.mkdirSync(this.tmp, { recursive: true });
    const child = spawn(p.cmd, [...p.pre, '-I', '-u', HOST_SCRIPT], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, env: { ...process.env, PYTHONIOENCODING: 'utf-8' } });
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
  }
  request(cmd, args = {}, timeoutMs = 60000) {
    return new Promise((res, rej) => {
      try { this.ensureChild(); } catch (e) { rej(e); return; }
      const id = this.seq++;
      const timer = setTimeout(() => { this.pending.delete(id); rej(new Error('The plugin host did not answer in time.')); }, timeoutMs);
      this.pending.set(id, { res, rej, timer });
      this.child.stdin.write(JSON.stringify({ id, cmd, ...args }) + '\n');
    });
  }

  /* list plugin files in standard + extra folders (filesystem only: nothing is loaded here) */
  scan(extraDirs = []) {
    const out = [], seen = new Set();
    const exts = process.platform === 'darwin' ? ['.vst3', '.component'] : ['.vst3'];
    const walk = (dir, depth) => {
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
    const raw = Buffer.alloc(ch * n * 4);
    channels.forEach((c, i) => Buffer.from(c.buffer, c.byteOffset, c.byteLength).copy(raw, i * n * 4));
    fs.writeFileSync(inPath, raw);
    try {
      const r = await this.request('process', { inPath, outPath, ch, n, sr, tailSeconds: tailSeconds || 0 }, 15 * 60 * 1000);
      const data = fs.readFileSync(outPath), total = r.n;
      const out = [];
      for (let c = 0; c < r.ch; c++) { const a = new Float32Array(total); Buffer.from(a.buffer).fill(0); data.copy(Buffer.from(a.buffer), 0, c * total * 4, (c + 1) * total * 4); out.push(a); }
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
function writeScanCache(f, c) { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f + '.tmp', JSON.stringify(c)); fs.renameSync(f + '.tmp', f); }
/* list: [{path, name, kind}] (from scan()) → the same entries + {status, reason?, vendor?, version?, params?, skipped?}.
   o: { cacheFile, force (load again even if unchanged; crashed ones stay skipped), retry: [paths], timeoutMs, onProgress(i, n, item) } */
async function verifyPlugins(host, list, o) {
  const cache = readScanCache(o.cacheFile), P = cache.plugins, retry = new Set(o.retry || []), out = [];
  for (const [k, v] of Object.entries(P)) if (v.status === 'scanning') P[k] = { ...v, status: 'crashed', reason: 'AudioStage closed while this plugin was loading — the plugin probably crashed it.' };
  const py = host.detectPython(); if (py.error) throw new Error(py.error + ' ' + host.hint());
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

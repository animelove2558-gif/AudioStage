// Optional runtimes that AudioStage installs into the user's data folder when asked (Windows x64), so an app installed
// from the .exe needs no npm, Python or ffmpeg set up by hand:
//   vst     Python embeddable package (python.org, PSF licence) + pip + pedalboard + numpy  → <userData>/vst-runtime/python
//   ffmpeg  BtbN FFmpeg-Builds, LGPL "shared" build (ffmpeg.exe + its DLLs)                  → <userData>/ffmpeg/bin
// Nothing GPL is part of the app: pedalboard (GPLv3) comes from PyPI onto the user's computer, like the npm script does.
// Every download is checked: Python against the SHA-256 python.org publishes (pinned here), pip against PyPI's digest
// (pinned), ffmpeg against the checksums.sha256 file of the same GitHub release. pip itself verifies PyPI over HTTPS.
// Plain Node, tested in tests/runtimes.test.js (local mock server for the network, a fake runner for the processes).
const fs = require('fs'), path = require('path'), crypto = require('crypto'), zlib = require('zlib'), { spawn } = require('child_process');

const SOURCES = {
  python: { version: '3.13.17', url: 'https://www.python.org/ftp/python/3.13.17/python-3.13.17-embed-amd64.zip', sha256: '9e35319bffedab8b36ad44d8f377cb4f1733bcec257a0b6d04d94f01486ddb38', size: 11441267 },
  pip: { version: '26.2.2', url: 'https://files.pythonhosted.org/packages/3f/06/3e4420302363fbb71be3c7f35ce042f54bfca330e3e66b3a2e3c4cca579f/pip-26.2.2-py3-none-any.whl', sha256: 'fd7f4dfa8190e014013b9f08f3e973f4e4c26ffd179a204895533a7254813a70', size: 1819850 },
  ffmpeg: { base: 'https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/', checksums: 'checksums.sha256' },
};

/* ---------- errors people can read ---------- */
function friendly(e, what) {
  if (e && e.code === 'CANCELLED') return e;
  const c = e && e.code, m = (e && e.message) || String(e);
  let msg;
  if (c === 'ENOTFOUND' || c === 'EAI_AGAIN') msg = `No internet connection — ${what || 'the download server'} cannot be reached. Connect to the internet and try again.`;
  else if (c === 'ECONNREFUSED') msg = `The download server refused the connection (${what || 'server'}). Try again later.`;
  else if (c === 'ETIMEDOUT' || c === 'ESOCKETTIMEDOUT' || c === 'STALLED') msg = 'The connection timed out — the internet connection may be slow or interrupted. Try again.';
  else if (c === 'ECONNRESET' || c === 'EPIPE') msg = 'The connection was interrupted during the download. Try again.';
  else if (c === 'ENOSPC') msg = 'The disk is full. Free some space and try again.';
  else if (c === 'EACCES' || c === 'EPERM' || c === 'EBUSY') msg = 'A file could not be written (it may be in use or blocked by antivirus software): ' + m;
  else msg = m;
  const out = new Error(msg); out.code = c; return out;
}
const cancelled = () => { const e = new Error('Cancelled'); e.code = 'CANCELLED'; return e; };
const checkAbort = (signal) => { if (signal && signal.aborted) throw cancelled(); };

/* ---------- download: http(s), redirects, progress, cancel, SHA-256 ----------
   o: { signal, onProgress(got, total), headers, stallMs } → { bytes, sha256 } (written to dest; a partial file is deleted) */
function download(url, dest, o = {}) {
  return new Promise((resolve, reject) => {
    const { signal } = o; let req = null, out = null, done = false;
    const fail = (e) => { if (done) return; done = true; try { if (req) req.destroy(); } catch (er) { /* */ } const fin = () => fs.rm(dest + '.part', { force: true }, () => reject(e)); if (out && !out.closed) { out.on('close', fin); out.destroy(); } else fin(); };
    if (signal && signal.aborted) { reject(cancelled()); return; }
    if (signal) signal.addEventListener('abort', () => fail(cancelled()), { once: true });
    const get = (u, left) => {
      let mod; try { mod = new URL(u).protocol === 'http:' ? require('http') : require('https'); } catch (e) { fail(new Error('Bad download address: ' + u)); return; }
      req = mod.get(u, { headers: { 'User-Agent': 'AudioStage', Accept: '*/*', ...(o.headers || {}) } }, (res) => {
        if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
          res.resume(); if (left <= 0) { fail(new Error('Too many redirects: ' + url)); return; }
          get(new URL(res.headers.location, u).toString(), left - 1); return;
        }
        if (res.statusCode !== 200) { res.resume(); fail(new Error(`Download failed (HTTP ${res.statusCode}): ${url}`)); return; }
        const total = +res.headers['content-length'] || 0, hash = crypto.createHash('sha256'); let got = 0;
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        out = fs.createWriteStream(dest + '.part');
        out.on('error', (e) => fail(friendly(e)));
        res.on('data', (d) => { got += d.length; hash.update(d); if (o.onProgress) o.onProgress(got, total); });
        res.on('error', (e) => fail(friendly(e)));
        res.on('aborted', () => fail(friendly({ code: 'ECONNRESET' })));
        res.pipe(out);
        out.on('finish', () => {
          if (done) return;
          if (total && got !== total) { fail(friendly({ code: 'ECONNRESET' })); return; }
          out.close(() => { try { fs.renameSync(dest + '.part', dest); } catch (e) { fail(friendly(e)); return; } done = true; resolve({ bytes: got, sha256: hash.digest('hex') }); });
        });
      });
      req.setTimeout(o.stallMs || 30000, () => fail(friendly({ code: 'STALLED' })));
      req.on('error', (e) => fail(friendly(e, new URL(u).host)));
    };
    get(url, 5);
  });
}
async function downloadText(url, o) {
  const tmp = path.join(require('os').tmpdir(), 'audiostage-dl-' + process.pid + '-' + Date.now() + '.txt');
  try { await download(url, tmp, o); return fs.readFileSync(tmp, 'utf8'); } finally { fs.rm(tmp, { force: true }, () => {}); }
}

/* ---------- unzip (store + deflate, ZIP64 sizes / offsets), no dependencies ----------
   pick(name) → relative output path, or null to skip. Paths that would leave `dir` are refused. */
function zipEntries(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65557); i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('The downloaded file is not a valid ZIP archive.');
  let count = buf.readUInt16LE(eocd + 10), cdOff = buf.readUInt32LE(eocd + 16);
  if (eocd >= 20 && buf.readUInt32LE(eocd - 20) === 0x07064b50) { // ZIP64 end of central directory
    const z = Number(buf.readBigUInt64LE(eocd - 20 + 8));
    if (buf.readUInt32LE(z) === 0x06064b50) { count = Number(buf.readBigUInt64LE(z + 32)); cdOff = Number(buf.readBigUInt64LE(z + 48)); }
  }
  const out = []; let p = cdOff;
  for (let k = 0; k < count; k++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('The ZIP archive is damaged.');
    const method = buf.readUInt16LE(p + 10), nl = buf.readUInt16LE(p + 28), el = buf.readUInt16LE(p + 30), cl = buf.readUInt16LE(p + 32);
    let csize = buf.readUInt32LE(p + 20), size = buf.readUInt32LE(p + 24), loff = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nl);
    for (let e = p + 46 + nl; e < p + 46 + nl + el;) { // ZIP64 extra field: only the values that are 0xFFFFFFFF, in order
      const id = buf.readUInt16LE(e), len = buf.readUInt16LE(e + 2);
      if (id === 1) { let q = e + 4; if (size === 0xffffffff) { size = Number(buf.readBigUInt64LE(q)); q += 8; } if (csize === 0xffffffff) { csize = Number(buf.readBigUInt64LE(q)); q += 8; } if (loff === 0xffffffff) loff = Number(buf.readBigUInt64LE(q)); }
      e += 4 + len;
    }
    out.push({ name, method, csize, size, loff, dir: name.endsWith('/') });
    p += 46 + nl + el + cl;
  }
  return out;
}
async function unzip(file, dir, pick, o = {}) {
  const buf = await fs.promises.readFile(file), entries = zipEntries(buf), root = path.resolve(dir), inflate = require('util').promisify(zlib.inflateRaw);
  let n = 0; const files = entries.filter((e) => !e.dir);
  for (const e of files) {
    checkAbort(o.signal);
    const rel = pick ? pick(e.name) : e.name; n++;
    if (!rel) continue;
    const dest = path.resolve(root, rel);
    if (dest !== root && !dest.startsWith(root + path.sep)) throw new Error('Unsafe path in the archive: ' + e.name);
    if (buf.readUInt32LE(e.loff) !== 0x04034b50) throw new Error('The ZIP archive is damaged.');
    const start = e.loff + 30 + buf.readUInt16LE(e.loff + 26) + buf.readUInt16LE(e.loff + 28), raw = buf.subarray(start, start + e.csize);
    const data = e.method === 0 ? raw : e.method === 8 ? await inflate(raw) : null;
    if (!data) throw new Error(`Unsupported compression in the archive (${e.name}).`);
    if (data.length !== e.size) throw new Error('The ZIP archive is damaged (' + e.name + ').');
    await fs.promises.mkdir(path.dirname(dest), { recursive: true });
    await fs.promises.writeFile(dest, data);
    if (o.onProgress) o.onProgress(n, files.length);
  }
  return n;
}

/* ---------- processes: run(cmd, args, {cwd, env, signal, onLine}) → {code, out} ---------- */
function run(cmd, args, o = {}) {
  return new Promise((resolve, reject) => {
    let p; try { p = spawn(cmd, args, { cwd: o.cwd, env: o.env || process.env, windowsHide: true }); } catch (e) { reject(e); return; }
    let out = '', buf = '';
    const line = (d) => { out = (out + d).slice(-20000); buf += d; let i; while ((i = buf.search(/\r?\n/)) >= 0) { const l = buf.slice(0, i); buf = buf.slice(i + 1).replace(/^\n/, ''); if (o.onLine && l.trim()) o.onLine(l); } };
    p.stdout.setEncoding('utf8'); p.stderr.setEncoding('utf8'); p.stdout.on('data', line); p.stderr.on('data', line);
    const abort = () => { try { p.kill(); } catch (e) { /* */ } };
    if (o.signal) { if (o.signal.aborted) abort(); o.signal.addEventListener('abort', abort, { once: true }); }
    p.on('error', reject);
    p.on('close', (code) => { if (o.signal) o.signal.removeEventListener('abort', abort); if (o.signal && o.signal.aborted) reject(cancelled()); else resolve({ code, out }); });
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/* rename with retries (antivirus scanners briefly lock freshly written files on Windows) */
async function swapDir(staging, final) {
  for (let i = 0; ; i++) {
    try { if (fs.existsSync(final)) fs.rmSync(final, { recursive: true, force: true }); fs.renameSync(staging, final); return; }
    catch (e) { if (i >= 8) throw friendly(e); await sleep(250 * (i + 1)); }
  }
}
/* the embeddable package's python3XX._pth: turn on site (pip / site-packages) and list Lib\site-packages */
function enableSite(pyDir) {
  const f = fs.readdirSync(pyDir).find((n) => /^python\d+\._pth$/i.test(n)); if (!f) throw new Error('The Python package has no ._pth file.');
  const lines = fs.readFileSync(path.join(pyDir, f), 'utf8').split(/\r?\n/).map((l) => (/^\s*#\s*import site\s*$/.test(l) ? 'import site' : l)).filter((l, i, a) => l !== '' || i < a.length - 1);
  if (!lines.includes('import site')) lines.push('import site');
  if (!lines.some((l) => /^Lib[\\/]site-packages$/i.test(l.trim()))) lines.splice(lines.indexOf('import site'), 0, 'Lib\\site-packages');
  fs.writeFileSync(path.join(pyDir, f), lines.join('\r\n') + '\r\n');
  return f;
}
/* checksums.sha256 → the newest LGPL shared Windows build: [{name, sha256}] best first */
function pickFfmpeg(text) {
  const rows = text.split(/\r?\n/).map((l) => /^([0-9a-f]{64})\s+\*?(\S+)$/i.exec(l.trim())).filter(Boolean).map((m) => ({ sha256: m[1].toLowerCase(), name: m[2] }));
  const ver = (n) => { const m = /^ffmpeg-n(\d+(?:\.\d+)*)-latest-win64-lgpl-shared-[\d.]+\.zip$/.exec(n); return m ? m[1].split('.').map(Number) : null; };
  const rel = rows.filter((r) => ver(r.name)).sort((a, b) => { const x = ver(a.name), y = ver(b.name); for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] || 0) !== (y[i] || 0)) return (y[i] || 0) - (x[i] || 0); return 0; });
  return [...rel, ...rows.filter((r) => r.name === 'ffmpeg-master-latest-win64-lgpl-shared.zip')];
}

/* ---------- the manager: status / install / remove of both runtimes ----------
   o: { userData, platform, arch, sources, run, download, requirements (path of tools/vst/requirements.txt) } */
class Runtimes {
  constructor(o) {
    this.userData = o.userData; this.platform = o.platform || process.platform; this.arch = o.arch || process.arch;
    this.sources = { ...SOURCES, ...(o.sources || {}) }; this.run = o.run || run; this.download = o.download || download; this.requirements = o.requirements;
    this.busy = {}; // kind → AbortController of the running install
  }
  supported() { return this.platform === 'win32' && this.arch === 'x64'; }
  dirs(kind) { const root = path.join(this.userData, kind === 'vst' ? 'vst-runtime' : 'ffmpeg'); return { root, final: path.join(root, kind === 'vst' ? 'python' : 'build') }; }
  pythonExe() { return path.join(this.dirs('vst').final, 'python.exe'); }
  ffmpegExe() { return path.join(this.dirs('ffmpeg').final, 'bin', this.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'); }
  info(kind) { try { return JSON.parse(fs.readFileSync(path.join(this.dirs(kind).root, kind === 'vst' ? 'runtime.json' : 'ffmpeg.json'), 'utf8')); } catch (e) { return null; } }
  status(kind) {
    const exe = kind === 'vst' ? this.pythonExe() : this.ffmpegExe();
    return { kind, supported: this.supported(), installed: fs.existsSync(exe), path: exe, busy: !!this.busy[kind], info: this.info(kind) };
  }
  cancel(kind) { const c = this.busy[kind]; if (c) c.abort(); return !!c; }
  remove(kind) {
    if (this.busy[kind]) throw new Error('An installation is running — cancel it first.');
    const d = this.dirs(kind); fs.rmSync(d.root, { recursive: true, force: true }); return true;
  }
  /* onProgress({phase, pct (0..1), msg}) → status when installed; rejects with a readable Error (code CANCELLED on cancel) */
  async install(kind, onProgress) {
    if (!this.supported()) throw new Error('Automatic installation is available on Windows (64-bit). On this system install Python 3.10+ and run: python3 -m pip install pedalboard numpy');
    if (this.busy[kind]) throw new Error('Already installing.');
    const ac = new AbortController(); this.busy[kind] = ac;
    const say = (phase, pct, msg) => { if (onProgress) onProgress({ kind, phase, pct: Math.max(0, Math.min(1, pct)), msg }); };
    const tmp = path.join(this.dirs(kind).root, '.download'), staging = this.dirs(kind).final + '.new';
    try {
      fs.mkdirSync(tmp, { recursive: true }); fs.rmSync(staging, { recursive: true, force: true });
      const r = kind === 'vst' ? await this.installVst(tmp, staging, say, ac.signal) : await this.installFfmpeg(tmp, staging, say, ac.signal);
      checkAbort(ac.signal);
      say('finish', 0.99, 'Finishing…');
      await swapDir(staging, this.dirs(kind).final); // the old runtime is replaced only now: a failed / cancelled install leaves it working
      fs.writeFileSync(path.join(this.dirs(kind).root, kind === 'vst' ? 'runtime.json' : 'ffmpeg.json'), JSON.stringify({ ...r, installedAt: new Date().toISOString() }, null, 1));
      delete this.busy[kind]; say('done', 1, 'Installed.');
      return this.status(kind);
    } catch (e) {
      fs.rmSync(staging, { recursive: true, force: true });
      throw friendly(e);
    } finally {
      delete this.busy[kind]; fs.rmSync(tmp, { recursive: true, force: true });
    }
  }
  async fetchChecked(src, dest, say, phase, a, b, signal, label) {
    const r = await this.download(src.url, dest, { signal, onProgress: (got, total) => say(phase, a + (b - a) * (got / (total || src.size || got * 2 || 1)), `Downloading ${label}… ${(got / 1048576).toFixed(1)}${total ? ' / ' + (total / 1048576).toFixed(1) : ''} MB`) });
    if (r.sha256 !== src.sha256) throw new Error(`The downloaded ${label} failed the checksum test (it may be damaged or tampered with). Nothing was installed — try again.`);
    return r;
  }
  async installVst(tmp, staging, say, signal) {
    const S = this.sources, zip = path.join(tmp, 'python.zip'), whl = path.join(tmp, path.basename(new URL(S.pip.url).pathname));
    await this.fetchChecked(S.python, zip, say, 'download', 0, 0.25, signal, `Python ${S.python.version}`);
    say('extract', 0.25, 'Unpacking Python…');
    await unzip(zip, staging, null, { signal, onProgress: (i, n) => say('extract', 0.25 + 0.05 * (i / n), 'Unpacking Python…') });
    enableSite(staging);
    await this.fetchChecked(S.pip, whl, say, 'download', 0.3, 0.34, signal, 'pip');
    const py = path.join(staging, 'python.exe'), env = { ...process.env, PYTHONIOENCODING: 'utf-8', PIP_CACHE_DIR: path.join(this.dirs('vst').root, 'pip-cache'), PYTHONNOUSERSITE: '1' };
    delete env.PYTHONPATH; delete env.PYTHONHOME;
    const pip = async (args, a, b, what) => {
      let k = 0;
      const r = await this.run(py, args, { env, signal, cwd: staging, onLine: (l) => { const m = /^\s*(Collecting|Downloading|Installing collected packages|Successfully installed)\s*:?\s*(.*)$/.exec(l); if (m) { k++; say('packages', a + (b - a) * Math.min(0.95, k / 12), `${what}: ${m[1]} ${m[2].replace(/\s*\(.*$/, '').slice(0, 80)}`); } } });
      checkAbort(signal);
      if (r.code !== 0) {
        if (/Failed to establish a new connection|getaddrinfo failed|NewConnectionError|Temporary failure in name resolution|No matching distribution|Could not find a version/i.test(r.out)) throw new Error('pip could not download the plugin-host packages from PyPI — check the internet connection and try again.');
        throw new Error(`${what} failed: ` + (r.out.trim().split(/\r?\n/).filter((l) => /error/i.test(l)).slice(-2).join(' ') || 'exit ' + r.code));
      }
      return r;
    };
    say('pip', 0.34, 'Installing pip…');
    // (the ._pth file fixes sys.path, so pip runs from its wheel through runpy rather than as `python pip.whl/pip`)
    await pip(['-c', 'import sys,runpy;sys.path.insert(0,sys.argv.pop(1));runpy.run_module("pip",run_name="__main__",alter_sys=True)', whl, 'install', '--disable-pip-version-check', '--no-warn-script-location', whl], 0.34, 0.4, 'pip');
    say('packages', 0.4, 'Installing pedalboard + numpy…');
    await pip(['-m', 'pip', 'install', '--disable-pip-version-check', '--no-warn-script-location', '--only-binary=:all:', '-r', this.requirements], 0.4, 0.94, 'Plugin host');
    say('verify', 0.95, 'Checking the plugin host…');
    const v = await this.run(py, ['-I', '-c', 'import sys,pedalboard,numpy;print(pedalboard.__version__, numpy.__version__, sys.version.split()[0])'], { env, signal });
    checkAbort(signal);
    if (v.code !== 0) throw new Error('The plugin host was installed but does not start: ' + v.out.trim().split(/\r?\n/).pop());
    const [pb, np, pyv] = v.out.trim().split(/\r?\n/).pop().split(/\s+/);
    return { python: pyv || S.python.version, pedalboard: pb, numpy: np };
  }
  async installFfmpeg(tmp, staging, say, signal) {
    const S = this.sources.ffmpeg;
    say('download', 0, 'Looking up the latest LGPL build…');
    const sums = await downloadText(S.base + S.checksums, { signal });
    const pick = pickFfmpeg(sums)[0]; if (!pick) throw new Error('No LGPL Windows build was found in the ffmpeg release.');
    const zip = path.join(tmp, pick.name);
    await this.fetchChecked({ url: S.base + pick.name, sha256: pick.sha256, size: 80e6 }, zip, say, 'download', 0.02, 0.9, signal, 'ffmpeg (LGPL)');
    say('extract', 0.9, 'Unpacking ffmpeg…');
    await unzip(zip, staging, (n) => { const m = /^[^/]+\/(bin\/[^/]+|LICENSE[^/]*)$/i.exec(n); return m ? m[1] : null; }, { signal, onProgress: (i, n) => say('extract', 0.9 + 0.07 * (i / n), 'Unpacking ffmpeg…') });
    const exe = path.join(staging, 'bin', 'ffmpeg.exe'); if (!fs.existsSync(exe)) throw new Error('ffmpeg.exe was not found in the downloaded build.');
    say('verify', 0.97, 'Checking ffmpeg…');
    const v = await this.run(exe, ['-hide_banner', '-version'], { signal });
    if (v.code !== 0 || !/ffmpeg version/.test(v.out)) throw new Error('The downloaded ffmpeg does not start.');
    return { version: (/ffmpeg version (\S+)/.exec(v.out) || [])[1] || '?', build: pick.name, license: 'LGPL' };
  }
}

module.exports = { SOURCES, Runtimes, download, downloadText, unzip, zipEntries, run, enableSite, pickFfmpeg, friendly };

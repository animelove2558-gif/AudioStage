const { app, BrowserWindow, session, Menu, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { VstHost, verifyPlugins, annotate, ROOT: UNPACKED_ROOT } = require('./electron/vst-host');
const { Runtimes } = require('./electron/runtimes');

app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
// `npm run test:app` starts the real app hidden, with its own userData folder, and runs tests/app/*.scenario.js in it
const SELFTEST = process.env.AUDIOSTAGE_SELFTEST || '';
if (SELFTEST) app.setPath('userData', SELFTEST);

/* ---- Log files (Help > Show Log Files / Report a Problem): <userData>/logs ---- */
const { Log, systemInfo } = require('./electron/logs');
const log = new Log(path.join(app.getPath('userData'), 'logs'));
log.write('info', `AudioStage ${app.getVersion()} started (Electron ${process.versions.electron}, ${process.platform} ${process.arch}${app.isPackaged ? '' : ', development'})`);
process.on('uncaughtException', (e) => { log.write('error', e); if (!SELFTEST) dialog.showErrorBox('AudioStage', 'An unexpected error happened: ' + e.message + '\n\nDetails are in the log file (Help > Show Log Files).'); });
process.on('unhandledRejection', (e) => log.write('error', e));
app.on('child-process-gone', (e, d) => log.write('warn', `${d.type} process gone: ${d.reason} (exit ${d.exitCode})`));
ipcMain.handle('log:info', () => ({ ok: true, info: systemInfo({ version: app.getVersion(), packaged: app.isPackaged }), dir: log.dir, tail: log.tail(40) }));
ipcMain.handle('log:show', wrapLater((e) => { fs.mkdirSync(log.dir, { recursive: true }); return SELFTEST ? { dir: log.dir } : shell.openPath(log.dir).then((err) => { if (err) throw new Error(err); return { dir: log.dir }; }); }));
ipcMain.handle('log:write', (e, level, msg) => { log.write(level === 'error' ? 'error' : level === 'warn' ? 'warn' : 'info', 'renderer: ' + String(msg).slice(0, 4000)); return true; });
/* ---- Help > AudioStage Help (F1): the offline manual app/help/index.html in a window of its own ---- */
let helpWin = null;
ipcMain.handle('help:open', wrapLater((e, q) => {
  if (helpWin && !helpWin.isDestroyed()) { if (q) helpWin.webContents.executeJavaScript(`window.helpSearch && window.helpSearch(${JSON.stringify(String(q))})`).catch(() => {}); if (!SELFTEST) { helpWin.show(); helpWin.focus(); } return { reused: true }; }
  helpWin = new BrowserWindow({ width: 1060, height: 780, title: 'AudioStage Help', backgroundColor: '#1b1d21', show: !SELFTEST, autoHideMenuBar: true, webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true } });
  helpWin.setMenu(null);
  helpWin.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  helpWin.on('closed', () => { helpWin = null; });
  return helpWin.loadFile(path.join(__dirname, 'app', 'help', 'index.html'), q ? { hash: 'q=' + encodeURIComponent(q) } : undefined).then(() => ({ opened: true }));
}));
// (app tests only) run a script in the help window
if (SELFTEST) ipcMain.handle('test:helpEval', (e, js) => (helpWin && !helpWin.isDestroyed() ? helpWin.webContents.executeJavaScript(js) : null));
function wrapLater(fn) { return async (...a) => { try { return { ok: true, ...(await fn(...a)) }; } catch (e) { return { ok: false, error: e.message || String(e) }; } }; }

/* optional runtimes installed into userData on request: Python + pedalboard (VST support) and ffmpeg (LGPL build).
   The app tests may point the downloads at a local test server (AUDIOSTAGE_RUNTIME_SOURCES, honoured only then). */
let testSources = null; if (SELFTEST && process.env.AUDIOSTAGE_RUNTIME_SOURCES) { try { testSources = JSON.parse(process.env.AUDIOSTAGE_RUNTIME_SOURCES); } catch (e) { /* */ } }
const runtimes = new Runtimes({ userData: app.getPath('userData'), requirements: path.join(UNPACKED_ROOT, 'tools', 'vst', 'requirements.txt'), sources: testSources || undefined });
const vst = new VstHost({ runtimePy: runtimes.pythonExe(), packaged: app.isPackaged });
const scanHost = new VstHost({ runtimePy: runtimes.pythonExe(), packaged: app.isPackaged }); // Plugin Manager scans load plugins in a helper of their own
const scanCache = path.join(app.getPath('userData'), 'vst-scan.json');
let win = null;

/* ---- offline plugin host IPC (renderer -> main -> python helper) ---- */
const CALLS = new Set(['ping', 'load', 'params', 'setParam', 'reset', 'getState', 'setState', 'editor', 'unload']);
const wrap = (fn) => async (...a) => { try { return { ok: true, ...(await fn(...a)) }; } catch (e) { return { ok: false, error: e.message || String(e) }; } };
ipcMain.handle('vst:status', wrap(() => vst.status()));
const dirList = (dirs) => (Array.isArray(dirs) ? dirs.filter((d) => typeof d === 'string') : []);
ipcMain.handle('vst:scan', wrap((e, dirs) => ({ plugins: annotate(vst.scan(dirList(dirs)), scanCache) })));
ipcMain.handle('vst:dirs', wrap(() => ({ dirs: require('./electron/vst-host').defaultPluginDirs() })));
/* Plugin Manager: load every plugin once (new / changed ones; force = all; retry = these crashed ones again) */
let verifying = null;
ipcMain.handle('vst:verify', wrap(async (e, dirs, o) => {
  if (verifying) throw new Error('A scan is already running.');
  const oo = o && typeof o === 'object' ? o : {};
  try {
    verifying = verifyPlugins(scanHost, vst.scan(dirList(dirs)), { cacheFile: scanCache, force: !!oo.force, retry: dirList(oo.retry), onProgress: (i, n, p) => { if (!e.sender.isDestroyed()) e.sender.send('vst:scanProgress', { i, n, name: p ? p.name : '' }); } });
    return { plugins: await verifying };
  } finally { verifying = null; scanHost.shutdown(); }
}));
/* ---- runtimes: status / install (progress events, cancel) / remove ---- */
const RT_KINDS = new Set(['vst', 'ffmpeg']);
const rtKind = (k) => { if (!RT_KINDS.has(k)) throw new Error('Unknown runtime.'); return k; };
const rtStatus = (k) => ({ ...runtimes.status(k), active: k === 'vst' ? vst.status() : { ffmpeg: ffmpeg() } });
ipcMain.handle('rt:status', wrap((e, k) => ({ status: rtStatus(rtKind(k)) })));
ipcMain.handle('rt:install', wrap(async (e, k) => {
  rtKind(k); if (k === 'vst') { vst.shutdown(); scanHost.shutdown(); } // the old runtime's files are replaced
  try { await runtimes.install(k, (p) => { if (!e.sender.isDestroyed()) e.sender.send('rt:progress', p); }); }
  finally { if (k === 'vst') { vst.reset(); scanHost.reset(); } else ffmpegInfo = undefined; } // usable at once, no restart
  return { status: rtStatus(k) };
}));
ipcMain.handle('rt:cancel', wrap((e, k) => ({ cancelled: runtimes.cancel(rtKind(k)) })));
ipcMain.handle('rt:remove', wrap((e, k) => {
  rtKind(k); if (k === 'vst') { vst.shutdown(); scanHost.shutdown(); }
  runtimes.remove(k); if (k === 'vst') { vst.reset(); scanHost.reset(); } else ffmpegInfo = undefined;
  return { status: rtStatus(k) };
}));
ipcMain.handle('vst:browse', wrap(async (e, what) => {
  const folder = what === 'folder';
  const r = await dialog.showOpenDialog(win, { title: folder ? 'Add a plugin folder' : 'Choose a plugin', properties: folder ? ['openDirectory'] : ['openFile', 'openDirectory'], filters: folder ? [] : [{ name: 'Audio plugins', extensions: ['vst3', 'component'] }] });
  return { path: r.canceled ? null : r.filePaths[0] };
}));
ipcMain.handle('vst:call', wrap(async (e, cmd, args) => {
  if (!CALLS.has(cmd)) throw new Error('Unknown plugin-host command.');
  return vst.request(cmd, args && typeof args === 'object' ? args : {}, cmd === 'editor' ? 6 * 60 * 60 * 1000 : 120000);
}));
ipcMain.handle('vst:process', wrap(async (e, channels, sr, tail) => {
  if (!Array.isArray(channels) || !channels.length || !(channels[0] instanceof Float32Array)) throw new Error('Bad audio data.');
  return { channels: await vst.process(channels, +sr, Math.min(30, Math.max(0, +tail || 0))) };
}));

/* ---- Media Browser: list folders and read audio / video files (allow-listed extensions only) ---- */
const MEDIA_EXT = /\.(wav|wave|mp3|ogg|flac|m4a|aac|opus|aif|aiff|webm|mp4|mov|mkv|m4v)$/i;
ipcMain.handle('media:roots', wrap(() => {
  const roots = [];
  for (const [name, key] of [['Home', 'home'], ['Music', 'music'], ['Documents', 'documents'], ['Desktop', 'desktop'], ['Downloads', 'downloads']]) { try { const p = app.getPath(key); if (fs.existsSync(p)) roots.push({ name, path: p }); } catch (e) { /* folder not available */ } }
  if (process.platform === 'win32') for (const l of 'CDEFGHIJKLMNOPQRSTUVWXYZ') { const p = l + ':\\'; try { if (fs.existsSync(p)) roots.push({ name: 'Drive ' + l + ':', path: p }); } catch (e) { /* */ } }
  else roots.push({ name: 'Computer (/)', path: '/' });
  return { roots };
}));
ipcMain.handle('media:list', wrap((e, dir) => {
  if (typeof dir !== 'string' || !dir) throw new Error('Bad folder.');
  const d = path.resolve(dir), out = [];
  for (const ent of fs.readdirSync(d, { withFileTypes: true })) {
    if (ent.name.startsWith('.') || ent.name === '$RECYCLE.BIN' || ent.name === 'System Volume Information') continue;
    const full = path.join(d, ent.name); let size = 0, isDir = ent.isDirectory();
    if (!isDir) { if (!ent.isFile()) continue; try { size = fs.statSync(full).size; } catch (er) { continue; } }
    out.push({ name: ent.name, path: full, dir: isDir, size });
  }
  out.sort((a, b) => (a.dir === b.dir ? a.name.localeCompare(b.name, undefined, { numeric: true }) : a.dir ? -1 : 1));
  const parent = path.dirname(d);
  return { dir: d, parent: parent !== d ? parent : '', entries: out };
}));
ipcMain.handle('media:read', wrap((e, p) => {
  if (typeof p !== 'string' || !MEDIA_EXT.test(p)) throw new Error('Only audio and video files can be opened.');
  const st = fs.statSync(p); if (!st.isFile()) throw new Error('Not a file.'); if (st.size > 1.5 * 1024 * 1024 * 1024) throw new Error('File is too large.');
  return { data: new Uint8Array(fs.readFileSync(p)) };
}));

/* ---- File > Open Recent / Open Recent Session (userData/recent.json) + the Windows Jump List ----
   Only files that are in a recent list can be read back through recent:read. */
const { RecentStore } = require('./electron/recent');
const recent = new RecentStore(path.join(app.getPath('userData'), 'recent.json'));
const RECENT_EXT = { files: MEDIA_EXT, sessions: /\.asession$/i };
ipcMain.handle('recent:get', wrap(() => ({ lists: recent.get() })));
ipcMain.handle('recent:add', wrap((e, k, p) => {
  if (!RECENT_EXT[k] || typeof p !== 'string' || !RECENT_EXT[k].test(p)) throw new Error('Not a file for this list.');
  const lists = recent.add(k, p); try { if (!SELFTEST) app.addRecentDocument(path.resolve(p)); } catch (er) { /* no Jump List here */ } return { lists };
}));
ipcMain.handle('recent:remove', wrap((e, k, p) => ({ lists: recent.remove(k, p) })));
ipcMain.handle('recent:clear', wrap((e, k) => { const lists = recent.clear(k); if (!SELFTEST && !lists.files.length && !lists.sessions.length) try { app.clearRecentDocuments(); } catch (er) { /* */ } return { lists }; }));
ipcMain.handle('recent:read', wrap((e, p) => {
  if (typeof p !== 'string' || !recent.has(p)) throw new Error('Not a recent file.');
  if (!fs.existsSync(p)) return { missing: true };
  const st = fs.statSync(p); if (!st.isFile()) return { missing: true }; if (st.size > 1.5 * 1024 * 1024 * 1024) throw new Error('File is too large.');
  return { data: new Uint8Array(fs.readFileSync(p)), name: path.basename(p) };
}));

/* ---- Effects > Generate > Speech…: the voices Windows has (offline). The app tests use a fake engine (AUDIOSTAGE_TTS_MOCK). ---- */
const ttsMod = require('./electron/tts');
const tts = new ttsMod.Tts(SELFTEST && process.env.AUDIOSTAGE_TTS_MOCK ? { mock: ttsMod.mockEngine() } : {});
ipcMain.handle('tts:voices', wrap(async () => ({ available: tts.available, voices: await tts.voices(), langs: ttsMod.LANGS.map(([tag, name, own]) => ({ tag, name, own, help: ttsMod.missingVoiceHelp(tag) })) })));
ipcMain.handle('tts:speak', wrap(async (e, o) => ({ data: new Uint8Array(await tts.speak(o || {})) })));

/* ---- Help > Check for Updates…: electron-updater + GitHub Releases, off (quietly) until build.publish names a GitHub owner.
   The app tests use a fake update server (AUDIOSTAGE_UPDATE_MOCK) and never check at start. ---- */
const upd = require('./electron/updater');
let updMock = null; if (SELFTEST && process.env.AUDIOSTAGE_UPDATE_MOCK) { try { updMock = upd.mockUpdater(JSON.parse(process.env.AUDIOSTAGE_UPDATE_MOCK)); } catch (e) { /* */ } }
const updater = new upd.Updater({ packaged: app.isPackaged, resourcesPath: process.resourcesPath, version: app.getVersion(), startupCheck: !SELFTEST, log: (l, m) => log.write(l, m), send: (ch, d) => { if (win && !win.isDestroyed()) win.webContents.send(ch, d); },
  ...(updMock ? { autoUpdater: updMock, feed: { provider: 'github', owner: 'selftest', repo: 'AudioStage' } } : {}) });
ipcMain.handle('upd:status', wrap(() => ({ status: updater.status() })));
ipcMain.handle('upd:check', wrap(() => updater.check()));
ipcMain.handle('upd:download', wrap(() => updater.download()));
ipcMain.handle('upd:cancel', wrap(() => ({ cancelled: updater.cancel() })));
ipcMain.handle('upd:install', wrap(() => ({ installing: updater.install() })));
if (SELFTEST) ipcMain.handle('test:updInstalled', () => (updMock ? updMock.installed : -1));

/* ---- Video: ffmpeg (installed separately) for "Export audio back into video" ---- */
const video = require('./electron/video');
let ffmpegInfo; const ffmpeg = () => (ffmpegInfo === undefined ? (ffmpegInfo = video.findFfmpeg({ local: runtimes.ffmpegExe() })) : ffmpegInfo); // (cleared when ffmpeg is installed / removed)
const VIDEO_EXT = /\.(mp4|mov|mkv|m4v|webm)$/i;
ipcMain.handle('video:ffmpeg', wrap(() => ({ ffmpeg: ffmpeg() })));
ipcMain.handle('video:probe', wrap((e, p) => { if (typeof p !== 'string' || !fs.existsSync(p)) throw new Error('File not found.'); const f = ffmpeg(); if (!f) throw new Error('ffmpeg is not installed.'); return { info: video.probe(f.path, p) }; }));
ipcMain.handle('video:mux', wrap(async (e, src, wav, out) => {
  const f = ffmpeg(); if (!f) throw new Error('ffmpeg was not found. Use Help > Check VST / ffmpeg Status… > Install ffmpeg… (or put ffmpeg on PATH).');
  if (typeof src !== 'string' || !VIDEO_EXT.test(src) || !fs.existsSync(src)) throw new Error('The session’s video file was not found.');
  if (!(wav instanceof Uint8Array) && !(wav instanceof ArrayBuffer)) throw new Error('Bad audio data.');
  if (!(SELFTEST && typeof out === 'string')) { // the user picks where to save
    const r = await dialog.showSaveDialog(win, { title: 'Export video with the new soundtrack', defaultPath: src.replace(/(\.\w+)$/, ' (AudioStage mix).mp4'), filters: [{ name: 'MP4 video', extensions: ['mp4'] }] });
    if (r.canceled || !r.filePath) return { path: null };
    out = r.filePath;
  }
  return { path: await video.mux(f.path, src, wav, out) };
}));

/* ---- Exports of several files at once (Export Ranges, CD Layout, interchange XML + media): the user picks a folder,
   then files may be written into that folder only (plain file names, no sub-paths, no overwriting outside it).
   The app tests write into their own temporary folder without the dialog. ---- */
const outDirs = new Set();
const allowedDir = (dir) => typeof dir === 'string' && (outDirs.has(path.resolve(dir)) || (SELFTEST && path.resolve(dir).startsWith(path.resolve(SELFTEST))));
/* folders chosen in Preferences (recordings, save folder) stay writable after a restart: remembered in userData */
const keptDirsFile = path.join(app.getPath('userData'), 'folders.json');
try { for (const d of JSON.parse(fs.readFileSync(keptDirsFile, 'utf8'))) if (typeof d === 'string') outDirs.add(path.resolve(d)); } catch (e) { /* none yet */ }
ipcMain.handle('files:pickFolder', wrap(async (e, title, remember) => {
  const r = await dialog.showOpenDialog(win, { title: typeof title === 'string' ? title : 'Choose a folder', properties: ['openDirectory', 'createDirectory'] });
  if (r.canceled || !r.filePaths[0]) return { dir: null };
  const d = path.resolve(r.filePaths[0]); outDirs.add(d);
  if (remember) { let kept = []; try { kept = JSON.parse(fs.readFileSync(keptDirsFile, 'utf8')); } catch (er) { /* */ } fs.writeFileSync(keptDirsFile, JSON.stringify([...new Set([...kept, d])].slice(-50))); }
  return { dir: d };
}));
/* File > Open… / Open Multitrack Session…: the system dialog, starting in Preferences > Files > Open files from */
ipcMain.handle('files:open', wrap(async (e, kind, dir) => {
  const sess = kind === 'sessions';
  const r = await dialog.showOpenDialog(win, { title: sess ? 'Open Multitrack Session' : 'Open', defaultPath: typeof dir === 'string' && dir && fs.existsSync(dir) ? dir : undefined, properties: sess ? ['openFile'] : ['openFile', 'multiSelections'],
    filters: sess ? [{ name: 'AudioStage session', extensions: ['asession'] }] : [{ name: 'Audio and video', extensions: ['wav', 'wave', 'mp3', 'ogg', 'flac', 'm4a', 'aac', 'opus', 'aif', 'aiff', 'webm', 'mp4', 'mov', 'mkv', 'm4v'] }, { name: 'All files', extensions: ['*'] }] });
  if (r.canceled) return { files: [] };
  return { files: r.filePaths.map((p) => { const st = fs.statSync(p); if (st.size > 1.5 * 1024 * 1024 * 1024) throw new Error('File is too large: ' + path.basename(p)); return { path: p, name: path.basename(p), data: new Uint8Array(fs.readFileSync(p)) }; }) };
}));
/* the folder the Save dialog of a download (Save As, Export…) starts in: Preferences > Files */
let saveDir = '';
ipcMain.handle('files:setSaveDir', wrap((e, d) => { saveDir = typeof d === 'string' ? d : ''; return {}; }));
ipcMain.handle('files:write', wrap((e, dir, name, data) => {
  if (!allowedDir(dir)) throw new Error('Choose the destination folder first.');
  if (typeof name !== 'string' || !/^[^\\/:*?"<>|\x00-\x1f]{1,180}$/.test(name) || name === '.' || name === '..') throw new Error('Bad file name: ' + name);
  if (!(data instanceof Uint8Array) && !(data instanceof ArrayBuffer) && typeof data !== 'string') throw new Error('Bad data.');
  fs.mkdirSync(dir, { recursive: true });
  const p = path.join(path.resolve(dir), name);
  fs.writeFileSync(p, typeof data === 'string' ? Buffer.from(data, 'utf8') : Buffer.from(data instanceof ArrayBuffer ? new Uint8Array(data) : data));
  return { path: p };
}));

/* ---- Local store for autosave / crash recovery / project versions: files under <userData>/store ----
   Keys are relative paths of letters, digits, '-', '_', '.' and '/' (no '..'), so nothing outside the folder can be touched. */
const storeRoot = () => path.join(app.getPath('userData'), 'store');
const storePath = (key) => {
  if (typeof key !== 'string' || !/^[A-Za-z0-9_\-./]{1,200}$/.test(key) || key.split('/').some((p) => p === '..' || p === '.' || !p)) throw new Error('Bad store key.');
  return path.join(storeRoot(), ...key.split('/'));
};
ipcMain.handle('store:put', wrap((e, key, data) => {
  const p = storePath(key), buf = typeof data === 'string' ? Buffer.from(data, 'utf8') : Buffer.from(data instanceof ArrayBuffer ? new Uint8Array(data) : data);
  fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p + '.tmp', buf); fs.renameSync(p + '.tmp', p); // write-then-rename: never a half-written file
  return {};
}));
ipcMain.handle('store:get', wrap((e, key) => { const p = storePath(key); return { data: fs.existsSync(p) ? new Uint8Array(fs.readFileSync(p)) : null }; }));
ipcMain.handle('store:del', wrap((e, key) => { const p = storePath(key); if (fs.existsSync(p)) fs.unlinkSync(p); return {}; }));
ipcMain.handle('store:list', wrap((e, prefix) => {
  const out = [], root = storeRoot();
  const walk = (dir, rel) => { if (!fs.existsSync(dir)) return; for (const ent of fs.readdirSync(dir, { withFileTypes: true })) { const r = rel ? rel + '/' + ent.name : ent.name; if (ent.isDirectory()) walk(path.join(dir, ent.name), r); else if (!ent.name.endsWith('.tmp')) out.push(r); } };
  walk(root, ''); return { keys: out.filter((k) => !prefix || k.startsWith(prefix)) };
}));

/* ---- External edit (EditorStage "Edit in AudioStage"): open a file given on the command line, save back to it ---- */
const EXT_ARG = '--editorstage-edit=';
const extFiles = new Set(); // only these paths may be written by extedit:save
let pendingExt = [];
const extFromArgv = (argv) => argv.filter((a) => typeof a === 'string' && a.startsWith(EXT_ARG)).map((a) => path.resolve(a.slice(EXT_ARG.length))).filter((p) => fs.existsSync(p));
function queueExt(paths) {
  for (const p of paths) extFiles.add(p);
  if (!paths.length) return;
  if (win && !win.webContents.isLoading()) { for (const p of paths) win.webContents.send('extedit:open', { path: p, name: path.basename(p) }); if (win.isMinimized()) win.restore(); win.focus(); }
  else pendingExt.push(...paths);
}
/* ---- Files opened from Windows (double-click a .asession, "Open with" AudioStage on an audio file, the Jump List) ----
   at start: process.argv; while running: the second instance's argv. .asession → multitrack, audio → Waveform.
   Only these paths can be read back through open:read. */
const { filesFromArgv } = require('./electron/openfiles');
const shellFiles = new Set();
let pendingOpen = [];
function queueOpen(list) {
  for (const f of list) shellFiles.add(f.path);
  if (!list.length) return;
  if (win && !win.webContents.isLoading()) win.webContents.send('open:files', list);
  else pendingOpen.push(...list);
}
function onSecondInstance(argv, cwd) {
  queueExt(extFromArgv(argv)); queueOpen(filesFromArgv(argv, { cwd }));
  if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
}
ipcMain.handle('open:pending', () => { const p = pendingOpen; pendingOpen = []; return p; });
ipcMain.handle('open:read', wrap((e, p) => {
  if (typeof p !== 'string' || !shellFiles.has(p)) throw new Error('Not a file given to AudioStage.');
  if (!fs.existsSync(p)) return { missing: true };
  if (fs.statSync(p).size > 1.5 * 1024 * 1024 * 1024) throw new Error('File is too large.');
  return { data: new Uint8Array(fs.readFileSync(p)), name: path.basename(p) };
}));
// (app tests only) the same path as a second start of AudioStage with these arguments
if (SELFTEST) ipcMain.handle('test:secondInstance', (e, argv, cwd) => { onSecondInstance(argv, cwd); return true; });
if (!app.requestSingleInstanceLock()) app.quit();
else app.on('second-instance', (_e, argv, cwd) => onSecondInstance(argv, cwd));
ipcMain.handle('extedit:pending', () => { const p = pendingExt.map((x) => ({ path: x, name: path.basename(x) })); pendingExt = []; return p; });
ipcMain.handle('extedit:read', wrap((e, p) => { if (!extFiles.has(p)) throw new Error('Not an external-edit file.'); return { data: new Uint8Array(fs.readFileSync(p)) }; }));
ipcMain.handle('extedit:save', wrap((e, p, data) => {
  if (!extFiles.has(p)) throw new Error('Not an external-edit file.');
  if (!(data instanceof Uint8Array) && !(data instanceof ArrayBuffer)) throw new Error('Bad data.');
  fs.writeFileSync(p, Buffer.from(data instanceof ArrayBuffer ? new Uint8Array(data) : data)); return { path: p };
}));

function createWindow() {
  win = new BrowserWindow({
    width: 1500, height: 900, minWidth: 900, minHeight: 600, backgroundColor: '#1b1d21', title: 'AudioStage', show: !SELFTEST,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, preload: path.join(__dirname, 'electron', 'preload.js'), offscreen: !!(SELFTEST && process.env.AUDIOSTAGE_SELFTEST_SHOTS) },
  });
  Menu.setApplicationMenu(null);
  win.loadFile(path.join(__dirname, 'app', 'index.html'));
  win.webContents.on('before-input-event', (e, input) => {
    if (input.type === 'keyDown' && input.key === 'F12') win.webContents.toggleDevTools();
  });
  // the page asks to stay open (unsaved files): Electron would cancel the close silently, so ask the user
  win.webContents.on('will-prevent-unload', (e) => {
    if (SELFTEST) { e.preventDefault(); return; }
    const choice = dialog.showMessageBoxSync(win, { type: 'question', buttons: ['Close Without Saving', 'Cancel'], defaultId: 1, cancelId: 1, title: 'AudioStage', message: 'Some files have unsaved changes.', detail: 'Close anyway? (Save them with File > Save As first if you want to keep the changes.)' });
    if (choice === 0) e.preventDefault(); // preventDefault here = ignore the page's objection and close
  });
  win.webContents.on('console-message', (...a) => { const d = a[1] && typeof a[1] === 'object' ? a[1] : { level: a[1], message: a[2], sourceId: a[4], lineNumber: a[3] }; const lv = typeof d.level === 'string' ? d.level : ['verbose', 'info', 'warning', 'error'][d.level]; if (lv === 'error' || lv === 'warning') log.write(lv === 'error' ? 'error' : 'warn', `${d.message} (${path.basename(String(d.sourceId || ''))}:${d.lineNumber})`); });
  win.webContents.on('render-process-gone', (e, d) => log.write('error', 'The window crashed: ' + d.reason));
  win.on('closed', () => { win = null; if (helpWin && !helpWin.isDestroyed()) helpWin.close(); });
  if (SELFTEST) require('./tests/app/selftest')(app, win);
}

app.whenReady().then(() => {
  session.defaultSession.setPermissionRequestHandler((wc, permission, cb) => cb(permission === 'media' || permission === 'audioCapture'));
  session.defaultSession.on('will-download', (e, item) => { if (saveDir && fs.existsSync(saveDir)) item.setSaveDialogOptions({ defaultPath: path.join(saveDir, item.getFilename()) }); });
  createWindow();
  queueExt(extFromArgv(process.argv));
  queueOpen(filesFromArgv(process.argv));
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('before-quit', () => { vst.shutdown(); scanHost.shutdown(); runtimes.cancel('vst'); runtimes.cancel('ffmpeg'); });
app.on('window-all-closed', () => { vst.shutdown(); scanHost.shutdown(); if (process.platform !== 'darwin') app.quit(); });

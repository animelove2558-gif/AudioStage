// Exposes narrow desktop APIs (plugin host, runtimes, files, store…) to the (sandboxed, context-isolated) renderer.
const { contextBridge, ipcRenderer, webUtils } = require('electron');

// Video track: the path of a dropped / chosen file (for the preview and for re-muxing), ffmpeg tools
contextBridge.exposeInMainWorld('audioStageVideo', {
  pathOf: (file) => { try { return webUtils.getPathForFile(file) || ''; } catch (e) { return ''; } },
  ffmpeg: () => ipcRenderer.invoke('video:ffmpeg'),
  probe: (p) => ipcRenderer.invoke('video:probe', p),
  mux: (src, wav, out) => ipcRenderer.invoke('video:mux', src, wav, out),
});

// Help > Check for Updates…: check / download / install only when the person says so (electron/updater.js)
// only when this copy has a usable update source (an installed app with app-update.yml); AudioStage normally gets its
// updates through the BYS All Stages Launcher, so then Help > Check for Updates… and the preference are not shown
let updatesOn = false; try { updatesOn = ipcRenderer.sendSync('upd:enabled') === true; } catch (e) { /* */ }
if (updatesOn) contextBridge.exposeInMainWorld('audioStageUpdate', {
  status: () => ipcRenderer.invoke('upd:status'),
  check: () => ipcRenderer.invoke('upd:check'),
  download: () => ipcRenderer.invoke('upd:download'),
  cancel: () => ipcRenderer.invoke('upd:cancel'),
  install: () => ipcRenderer.invoke('upd:install'),
  onProgress: (cb) => { const h = (_e, d) => cb(d); ipcRenderer.on('upd:progress', h); return () => ipcRenderer.removeListener('upd:progress', h); },
  testInstalled: () => ipcRenderer.invoke('test:updInstalled'), // app tests only (refused otherwise)
});

// Effects > Generate > Speech…: offline text to speech with the Windows voices (main process, PowerShell)
contextBridge.exposeInMainWorld('audioStageTts', {
  voices: () => ipcRenderer.invoke('tts:voices'),
  speak: (o) => ipcRenderer.invoke('tts:speak', o),
});

contextBridge.exposeInMainWorld('audioStageVst', {
  status: () => ipcRenderer.invoke('vst:status'),
  scan: (extraDirs) => ipcRenderer.invoke('vst:scan', extraDirs || []),
  browse: (what) => ipcRenderer.invoke('vst:browse', what),
  call: (cmd, args) => ipcRenderer.invoke('vst:call', cmd, args || {}),
  process: (channels, sr, tailSeconds) => ipcRenderer.invoke('vst:process', channels, sr, tailSeconds || 0),
  // Plugin Manager: the standard folders, a full load-test scan (with progress events)
  dirs: () => ipcRenderer.invoke('vst:dirs'),
  verify: (extraDirs, o) => ipcRenderer.invoke('vst:verify', extraDirs || [], o || {}),
  onScanProgress: (cb) => { const h = (_e, d) => cb(d); ipcRenderer.on('vst:scanProgress', h); return () => ipcRenderer.removeListener('vst:scanProgress', h); },
});

// Optional runtimes installed into userData on request: 'vst' (Python + pedalboard) and 'ffmpeg' (LGPL build)
contextBridge.exposeInMainWorld('audioStageRuntime', {
  status: (kind) => ipcRenderer.invoke('rt:status', kind),
  install: (kind) => ipcRenderer.invoke('rt:install', kind),
  cancel: (kind) => ipcRenderer.invoke('rt:cancel', kind),
  remove: (kind) => ipcRenderer.invoke('rt:remove', kind),
  onProgress: (cb) => { const h = (_e, d) => cb(d); ipcRenderer.on('rt:progress', h); return () => ipcRenderer.removeListener('rt:progress', h); },
});

// External edit from EditorStage: files to open, and save-back to the same path
contextBridge.exposeInMainWorld('audioStageExt', {
  pending: () => ipcRenderer.invoke('extedit:pending'),
  onOpen: (cb) => ipcRenderer.on('extedit:open', (_e, d) => cb(d)),
  read: (p) => ipcRenderer.invoke('extedit:read', p),
  save: (p, data) => ipcRenderer.invoke('extedit:save', p, data),
});

// File > Open Recent / Open Recent Session (+ Windows Jump List). pathOf: where a chosen / dropped file is on disk.
contextBridge.exposeInMainWorld('audioStageRecent', {
  pathOf: (file) => { try { return webUtils.getPathForFile(file) || ''; } catch (e) { return ''; } },
  get: () => ipcRenderer.invoke('recent:get'),
  add: (kind, p) => ipcRenderer.invoke('recent:add', kind, p),
  remove: (kind, p) => ipcRenderer.invoke('recent:remove', kind, p),
  clear: (kind) => ipcRenderer.invoke('recent:clear', kind),
  read: (p) => ipcRenderer.invoke('recent:read', p),
});

// Files Windows gives AudioStage (double-click / Open with / Jump List): at start (pending) and while running (onFiles)
contextBridge.exposeInMainWorld('audioStageOpen', {
  pending: () => ipcRenderer.invoke('open:pending'),
  onFiles: (cb) => ipcRenderer.on('open:files', (_e, list) => cb(list)),
  read: (p) => ipcRenderer.invoke('open:read', p),
  testSecondInstance: (argv, cwd) => ipcRenderer.invoke('test:secondInstance', argv, cwd), // app tests only (refused otherwise)
});

// Help: the offline manual window, log files, information for a problem report (nothing is sent anywhere)
contextBridge.exposeInMainWorld('audioStageHelp', {
  open: (q) => ipcRenderer.invoke('help:open', q || ''),
  info: () => ipcRenderer.invoke('log:info'),
  version: () => ipcRenderer.invoke('app:version'), // package.json version (About box)
  showLogs: () => ipcRenderer.invoke('log:show'),
  log: (level, msg) => ipcRenderer.invoke('log:write', level, msg),
  testEval: (js) => ipcRenderer.invoke('test:helpEval', js), // app tests only (refused otherwise)
});

// Local store (userData/store): autosave, crash recovery, project versions
contextBridge.exposeInMainWorld('audioStageStore', {
  put: (key, data) => ipcRenderer.invoke('store:put', key, data),
  get: (key) => ipcRenderer.invoke('store:get', key),
  del: (key) => ipcRenderer.invoke('store:del', key),
  list: (prefix) => ipcRenderer.invoke('store:list', prefix || ''),
});

// Exports of several files: pick a destination folder once, then write plain file names into it
contextBridge.exposeInMainWorld('audioStageFiles', {
  pickFolder: (title, remember) => ipcRenderer.invoke('files:pickFolder', title, !!remember),
  open: (kind, dir) => ipcRenderer.invoke('files:open', kind, dir || ''),
  setSaveDir: (dir) => ipcRenderer.invoke('files:setSaveDir', dir || ''),
  write: (dir, name, data, o) => ipcRenderer.invoke('files:write', dir, name, data, o || {}),
  exists: (dir, names) => ipcRenderer.invoke('files:exists', dir, names || []),
  // Save / Save As: the dialog (main process) → a path; then a chunked write to a temporary file renamed when complete
  chooseSave: (o) => ipcRenderer.invoke('files:chooseSave', o || {}),
  begin: (p) => ipcRenderer.invoke('files:begin', p),
  append: (id, data) => ipcRenderer.invoke('files:append', id, data),
  commit: (id) => ipcRenderer.invoke('files:commit', id),
  abort: (id) => ipcRenderer.invoke('files:abort', id),
  // files the user opened, read in pieces
  stat: (p) => ipcRenderer.invoke('files:stat', p),
  read: (p, off, len) => ipcRenderer.invoke('files:read', p, off, len),
  freeSpace: (dir) => ipcRenderer.invoke('files:freeSpace', dir || ''),
  testSaveAnswer: (list) => ipcRenderer.invoke('test:saveAnswer', list), // app tests only (refused otherwise)
});

contextBridge.exposeInMainWorld('audioStageMedia', {
  roots: () => ipcRenderer.invoke('media:roots'),
  list: (dir) => ipcRenderer.invoke('media:list', dir),
  read: (p) => ipcRenderer.invoke('media:read', p),
});
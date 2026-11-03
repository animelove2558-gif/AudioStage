// Run: node tests/security.test.js — the main window's guards in main.js (audit 2026-11-02 B1 / B2) and the IPC rules
// for writing files: no new windows / navigation away from app/index.html, developer tools only in development,
// writes only to paths chosen in a Save dialog or opened by the user.
const assert = require('assert'), fs = require('fs'), path = require('path');
const { ok, done } = require('./_sandbox');
const main = fs.readFileSync(path.join(__dirname, '../main.js'), 'utf8');
const createWindow = main.slice(main.indexOf('function createWindow()'), main.indexOf('app.whenReady()'));

ok('main window: window.open denied (web links go to the browser), navigation away from app/index.html blocked', () => {
  assert(/win\.webContents\.setWindowOpenHandler\([^)]*\) => \{[^}]*shell\.openExternal\(url\);[^}]*\}?[^]*?action: 'deny'/.test(createWindow), 'window open handler');
  assert(/win\.webContents\.on\('will-navigate', \(e, url\) => \{ if \(!isAppPage\(url\)\) \{ e\.preventDefault\(\)/.test(createWindow), 'will-navigate guard');
  assert(/will-redirect/.test(createWindow));
  // isAppPage as main.js defines it
  const src = /const APP_PAGE = [^\n]+\nconst isAppPage = [^\n]+/.exec(main)[0], fn = new Function('require', 'path', '__dirname', src + '; return isAppPage;')(require, path, 'C:/Program Files/AudioStage/resources/app.asar');
  assert(fn('file:///C:/Program%20Files/AudioStage/resources/app.asar/app/index.html#x'), 'the app page itself');
  assert(!fn('file:///C:/Users/x/Downloads/evil.html') && !fn('https://example.com/') && !fn('not a url'), 'anything else');
});
ok('F12 developer tools only when not packaged (npm start) or with AUDIOSTAGE_DEVTOOLS=1', () => {
  assert(/const DEVTOOLS = !app\.isPackaged \|\| process\.env\.AUDIOSTAGE_DEVTOOLS === '1';/.test(main));
  assert(/input\.key === 'F12' && DEVTOOLS/.test(createWindow) && /if \(!DEVTOOLS\) win\.webContents\.on\('devtools-opened'/.test(createWindow));
});
ok('file writes: Save-dialog / opened paths only; the export folder is never overwritten silently; atomic writes everywhere', () => {
  assert(/ipcMain\.handle\('files:begin', wrap\(\(e, p\) => \{ if \(!canWrite\(p\)\) throw/.test(main));
  assert(/nm = o && o\.overwrite \? name : freeName\(d, name\)/.test(main), 'files:write keeps existing files');
  assert(!/fs\.writeFileSync\(p, /.test(main.slice(main.indexOf("ipcMain.handle('files:write'"), main.indexOf('function createWindow()'))), 'no direct overwrite in the file / store / save-back handlers');
  assert(/ipcMain\.handle\('extedit:save'[^]*?writeFileAtomic\(p, data\)/.test(main), 'save back to EditorStage is atomic');
  assert(/const EXT_ARG = '--editorstage-edit=';/.test(main), 'EditorStage contract kept');
});
done();

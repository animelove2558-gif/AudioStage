// Files given to AudioStage by the system (Windows: double-click on a .asession, "Open with" on an audio file, the
// Jump List · Linux: the same through the .desktop file and its MimeType list): they arrive on the command line — at
// start (process.argv) or, when AudioStage is already open, through the second-instance event. The Linux .desktop file
// uses Exec=… %U, so file managers may pass file:// URIs instead of paths. Plain Node, tested in tests/assoc.test.js.
const fs = require('fs'), path = require('path'), { fileURLToPath } = require('url');
const AUDIO = /\.(wav|wave|mp3|ogg|flac|m4a|aac|opus|aif|aiff)$/i, SESSION = /\.asession$/i;

/* a file:// URI (local files only) → path; anything else unchanged */
function fromUri(a) { if (!/^file:\/\//i.test(a)) return a; try { return fileURLToPath(a); } catch (e) { return ''; } }
/* argv → [{ path, kind: 'session' | 'audio' }]: existing files with a known extension only (no flags, no folders —
   `electron .` passes the app folder — and not the program itself) */
function filesFromArgv(argv, o = {}) {
  const exists = o.exists || ((p) => { try { return fs.statSync(p).isFile(); } catch (e) { return false; } }), cwd = o.cwd || process.cwd(), out = [];
  for (const a0 of (argv || []).slice(1)) {
    if (typeof a0 !== 'string' || !a0 || a0.startsWith('--') || /^-\w$/.test(a0)) continue;
    if (/^[a-z][a-z0-9+.-]+:\/\//i.test(a0) && !/^file:\/\//i.test(a0)) continue; // http://… and other URLs: not files
    const a = fromUri(a0); if (!a) continue;
    const p = path.resolve(cwd, a), kind = SESSION.test(p) ? 'session' : AUDIO.test(p) ? 'audio' : null;
    if (kind && exists(p) && !out.some((x) => x.path === p)) out.push({ path: p, kind });
  }
  return out;
}
module.exports = { filesFromArgv, fromUri, AUDIO, SESSION };

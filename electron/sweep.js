// Start-up clean-up of files that a hard crash (power loss, task manager, a dead process) leaves behind (plain Node,
// tested in tests/sweep.test.js): "*.tmp" files of interrupted saves in the local store, and the raw audio folders
// "audiostage-vst-<pid>-*" of plugin renders in the temp folder whose process no longer exists.
const fs = require('fs'), path = require('path');

const pidAlive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };
/* delete "*.tmp" below `root` that were last written more than `minAgeMs` ago (a save in progress is younger) */
function sweepTmp(root, minAgeMs = 60000, now = Date.now()) {
  let n = 0;
  const walk = (dir) => {
    let ents; try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
    for (const e of ents) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.tmp')) { try { if (now - fs.statSync(p).mtimeMs > minAgeMs) { fs.unlinkSync(p); n++; } } catch (er) { /* in use */ } }
    }
  };
  walk(root); return n;
}
function sweepVstTemp(tmpdir, alive = pidAlive) {
  let n = 0, ents = []; try { ents = fs.readdirSync(tmpdir, { withFileTypes: true }); } catch (e) { return 0; }
  for (const e of ents) {
    const m = e.isDirectory() && /^audiostage-vst-(\d+)-/.exec(e.name);
    if (m && +m[1] !== process.pid && !alive(+m[1])) { try { fs.rmSync(path.join(tmpdir, e.name), { recursive: true, force: true }); n++; } catch (er) { /* */ } }
  }
  return n;
}
module.exports = { sweepTmp, sweepVstTemp, pidAlive };

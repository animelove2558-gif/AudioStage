// npm run setup:vst  — creates tools/vst/.venv and installs the plugin-host dependencies (pedalboard, numpy).
const { spawnSync } = require('child_process');
const fs = require('fs'), path = require('path');
const dir = __dirname, venv = path.join(dir, '.venv');
const win = process.platform === 'win32';
const venvPy = path.join(venv, win ? 'Scripts' : 'bin', win ? 'python.exe' : 'python');

function run(cmd, args, opts) { const r = spawnSync(cmd, args, { stdio: 'inherit', ...opts }); return r.status === 0; }
function findPython() {
  const cands = process.env.AUDIOSTAGE_PYTHON ? [[process.env.AUDIOSTAGE_PYTHON, []]] : win ? [['py', ['-3']], ['python', []]] : [['python3', []], ['python', []]];
  for (const [c, a] of cands) { const r = spawnSync(c, [...a, '-c', 'import sys;print(sys.version_info[:2]>=(3,8))'], { encoding: 'utf8' }); if (r.status === 0 && /True/.test(r.stdout)) return [c, a]; }
  return null;
}
const py = findPython();
if (!py) { console.error('Python 3.8+ was not found. Install it from python.org (or set AUDIOSTAGE_PYTHON) and run this again.'); process.exit(1); }
if (!fs.existsSync(venvPy)) { console.log('Creating virtual environment…'); if (!run(py[0], [...py[1], '-m', 'venv', venv])) process.exit(1); }
console.log('Installing pedalboard + numpy…');
if (!run(venvPy, ['-m', 'pip', 'install', '--disable-pip-version-check', '-r', path.join(dir, 'requirements.txt')])) process.exit(1);
console.log('Plugin host ready. Restart AudioStage.');

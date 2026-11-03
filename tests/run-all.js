// Run: npm test — runs every tests/*.test.js (except the VST host test, which needs Python: npm run test:vst)
// and prints the total, so the number quoted in README.md can be checked.
const { spawnSync } = require('child_process'), fs = require('fs'), path = require('path');
const files = fs.readdirSync(__dirname).filter((f) => f.endsWith('.test.js') && f !== 'vst_host.test.js').sort();
let passed = 0, failed = 0, bad = [];
for (const f of files) {
  const r = spawnSync(process.execPath, [path.join(__dirname, f)], { encoding: 'utf8' });
  process.stdout.write(`\n=== ${f} ===\n` + r.stdout + (r.stderr || ''));
  const okN = (r.stdout.match(/^ok\s/gm) || []).length, failN = (r.stdout.match(/^FAIL\s/gm) || []).length;
  passed += okN; failed += failN;
  if (r.status !== 0) bad.push(f);
}
console.log(`\n${files.length} test files · ${passed} passed · ${failed} failed`);
if (bad.length) { console.log('failing files: ' + bad.join(', ')); process.exit(1); }

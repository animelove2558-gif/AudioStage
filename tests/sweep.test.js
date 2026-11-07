const assert = require('assert'), fs = require('fs'), os = require('os'), path = require('path');
const { sweepTmp, sweepVstTemp } = require('../electron/sweep');
let failed = 0; const ok = (n, f) => { try { f(); console.log('ok   ', n); } catch (e) { failed++; console.log('FAIL ', n, '\n   ', e.message); } };
ok('old *.tmp files in the store are deleted, young ones and real files stay', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'as-sweep-')); fs.mkdirSync(path.join(d, 'a/b'), { recursive: true });
  fs.writeFileSync(path.join(d, 'a/b/x.json.1234.tmp'), '1'); fs.writeFileSync(path.join(d, 'a/y.tmp'), '1'); fs.writeFileSync(path.join(d, 'a/keep.json'), '1');
  const old = new Date(Date.now() - 3600000); fs.utimesSync(path.join(d, 'a/b/x.json.1234.tmp'), old, old);
  assert.strictEqual(sweepTmp(d), 1); assert(!fs.existsSync(path.join(d, 'a/b/x.json.1234.tmp'))); assert(fs.existsSync(path.join(d, 'a/y.tmp')) && fs.existsSync(path.join(d, 'a/keep.json')));
  fs.rmSync(d, { recursive: true, force: true });
});
ok('plugin render folders of dead processes are deleted, live ones and other folders stay', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'as-sweep-'));
  for (const n of ['audiostage-vst-111-ab12', 'audiostage-vst-222-cd34', 'other-folder']) fs.mkdirSync(path.join(d, n));
  assert.strictEqual(sweepVstTemp(d, (pid) => pid === 222), 1);
  assert(!fs.existsSync(path.join(d, 'audiostage-vst-111-ab12')) && fs.existsSync(path.join(d, 'audiostage-vst-222-cd34')) && fs.existsSync(path.join(d, 'other-folder')));
  fs.rmSync(d, { recursive: true, force: true });
});
if (failed) process.exit(1); else console.log('\nall passed');

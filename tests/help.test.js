// Run: node tests/help.test.js — the offline manual made from README.md (tools/make-help.js → app/help/index.html) and
// the log files behind Help > Show Log Files / Report a Problem (electron/logs.js).
const assert = require('assert'), fs = require('fs'), os = require('os'), path = require('path');
const { ok, done } = require('./_sandbox');
const H = require('../tools/make-help');
const { Log, systemInfo } = require('../electron/logs');
const ROOT = path.join(__dirname, '..');

ok('app/help/index.html is up to date with README.md (node tools/make-help.js)', () => {
  assert.strictEqual(fs.readFileSync(path.join(ROOT, 'app/help/index.html'), 'utf8'), H.build());
});
ok('topics: every user-facing README section (not the developer ones), bold-titled paragraphs as sub-topics', () => {
  const md = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8'), s = H.sections(md), titles = s.map((x) => x.title);
  const all = [...md.matchAll(/^## (.+)$/gm)].map((m) => m[1].trim());
  assert.deepStrictEqual(titles, all.filter((t) => t !== 'รัน' && t !== 'โครงสร้าง'));
  assert(s.some((x) => x.subs.some((u) => u.title === 'Plugin Manager…')), 'sub-topics');
  const html = H.build(); assert(/<input id="q" type="search"/.test(html) && /<script src="help.js">/.test(html) && /Content-Security-Policy/.test(html));
  assert(!/<script>/.test(html), 'no inline script (CSP)');
});
ok('markdown: code, bold, links, lists with sub-items, code blocks — escaped', () => {
  assert.strictEqual(H.inline('**a** `<b>` [x](https://e.org) 1 < 2'), '<b>a</b> <code>&lt;b&gt;</code> <a href="https://e.org" target="_blank" rel="noopener">x</a> 1 &lt; 2');
  const s = H.sections('# T\n\n## One\n\npara **x**\nmore\n\n- a\n  - b\n- c\n\n```\n<raw>\n```\n\n## รัน\n\nskip\n')[0];
  assert.strictEqual(s.html, '<p>para <b>x</b> more</p>\n<ul><li>a<ul><li>b</li></ul></li><li>c</li></ul>\n<pre>&lt;raw&gt;</pre>\n');
});
ok('log file: lines with time and level, the end for a report', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'as-log-')), log = new Log(path.join(d, 'logs'));
  log.write('info', 'started'); log.write('error', new Error('boom\nsecond line'));
  const t = log.tail(200); assert(/INFO  started$/.test(t[0]) && /ERROR Error: boom/.test(t[1]) && /^    second line/.test(t[2]), t.join('|'));
  assert.deepStrictEqual(new Log(path.join(d, 'none')).tail(), []);
  const info = systemInfo({ version: '1.1.0', packaged: false }); assert(info.app === '1.1.0' && info.os && info.node);
  fs.rmSync(d, { recursive: true, force: true });
});
ok('log file: every start rotates (3 runs kept), the crashed run is marked, repeats are counted, the size is capped', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'as-log-')), dir = path.join(d, 'logs');
  const run = (name, fn) => { const l = new Log(dir); l.write('info', name); if (fn) fn(l); return l; };
  const a = run('run A', (l) => l.close()); assert(!a.previousRunEndedBadly, 'first start');
  const b = run('run B first error'); // never closed = crashed
  const c = run('run C'); assert(c.previousRunEndedBadly, 'B did not end cleanly'); c.close();
  const dd = run('run D'); assert(!dd.previousRunEndedBadly, 'C ended cleanly');
  const rd = (f) => fs.readFileSync(path.join(dir, f), 'utf8');
  assert(/run D/.test(rd('audiostage.log')) && /run C/.test(rd('audiostage.1.log')) && /run B first error/.test(rd('audiostage.2.log')), 'D, C, B kept');
  assert(!fs.existsSync(path.join(dir, 'audiostage.3.log')), 'run A is gone');
  // a storm: the first error stays and the rest is counted
  const s = new Log(dir); s.write('error', 'first'); for (let i = 0; i < 1000; i++) s.write('error', 'same'); s.write('error', 'same'); s.write('warn', 'other');
  const t = s.tail(50); assert(t.length === 4 && /repeated 1000 times/.test(t[2]) && /other$/.test(t[3]) && /first$/.test(t[0]), t.join('|'));
  // size cap: nothing is rotated away, later messages are dropped after one notice
  const m = new Log(dir, { max: 300 }); m.write('info', 'keep me'); for (let i = 0; i < 20; i++) m.write('info', 'line ' + i);
  const mt = m.tail(100); assert(/keep me/.test(mt[0]) && /limit reached/.test(mt[mt.length - 1]) && fs.statSync(m.file).size < 700, mt.join('|'));
  fs.rmSync(d, { recursive: true, force: true });
});
done();

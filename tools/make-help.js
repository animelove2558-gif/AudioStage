// node tools/make-help.js — builds the offline manual app/help/index.html (Help > AudioStage Help, F1) from README.md:
// every "## " section becomes a topic (developer sections are left out), with a search box (app/help/help.js).
// README stays the one source; tests/help.test.js checks that the manual is up to date with it.
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const SKIP = [/^รัน$/, /^โครงสร้าง$/]; // developer-only: how to run from source, the file list

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
/* inline markdown: `code`, **bold**, *italic*, [text](url) — on escaped text */
function inline(s) {
  const codes = [];
  s = s.replace(/`([^`]+)`/g, (m, c) => { codes.push(c); return '\u0000' + (codes.length - 1) + '\u0000'; });
  s = esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/(^|[^*\w])\*([^*\s][^*]*?)\*(?!\w)/g, '$1<i>$2</i>')
    .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  return s.replace(/\u0000(\d+)\u0000/g, (m, i) => '<code>' + esc(codes[+i]) + '</code>');
}
/* README → [{ id, title, html }] */
function sections(md) {
  const out = []; let cur = null, list = [], para = [], code = null;
  const flushPara = () => {
    if (!para.length) return;
    const t = para.join(' '), m = /^\*\*(.+?)\*\*/.exec(t); // a paragraph that starts with a bold title is a sub-topic
    if (m) { const id = cur.id + '-' + cur.subs.length; cur.subs.push({ id, title: m[1].replace(/[:：]\s*$/, '') }); cur.html += `<p id="${id}">` + inline(t) + '</p>\n'; } else cur.html += '<p>' + inline(t) + '</p>\n';
    para = [];
  };
  const flushList = () => {
    if (!list.length) return;
    let h = '<ul>', depth = 0;
    for (const it of list) { if (it.d > depth) h += '<ul>'; else if (it.d < depth) h += '</li></ul></li>'; else if (h !== '<ul>') h += '</li>'; depth = it.d; h += '<li>' + inline(it.t); }
    h += '</li>' + (depth ? '</ul></li>' : '') + '</ul>\n'; cur.html += h; list = [];
  };
  for (const line of md.split(/\r?\n/)) {
    if (code !== null) { if (/^```/.test(line)) { cur.html += '<pre>' + esc(code.join('\n')) + '</pre>\n'; code = null; } else code.push(line); continue; }
    const h2 = /^## (.+)$/.exec(line), h3 = /^### (.+)$/.exec(line), li = /^( *)[-*] (.+)$/.exec(line);
    if (h2) { if (cur) { flushPara(); flushList(); } cur = { id: 's' + out.length, title: h2[1].trim(), html: '', subs: [] }; out.push(cur); continue; }
    if (!cur) continue; // the title / intro above the first section
    if (/^```/.test(line)) { flushPara(); flushList(); code = []; continue; }
    if (h3) { flushPara(); flushList(); cur.html += '<h3>' + inline(h3[1]) + '</h3>\n'; continue; }
    if (li) { flushPara(); list.push({ d: li[1].length >= 2 ? 1 : 0, t: li[2] }); continue; }
    if (/^\s*$/.test(line)) { flushPara(); flushList(); continue; }
    if (list.length && /^ {2,}\S/.test(line)) { list[list.length - 1].t += ' ' + line.trim(); continue; }
    flushList(); para.push(line.trim());
  }
  if (cur) { flushPara(); flushList(); }
  return out.filter((s) => !SKIP.some((re) => re.test(s.title)));
}
function page(md, version) {
  const secs = sections(md);
  return `<!doctype html>
<html lang="th">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self' data:">
<title>AudioStage Help</title>
<link rel="stylesheet" href="help.css">
</head>
<body>
<!-- generated from README.md by tools/make-help.js — edit README.md, then run: node tools/make-help.js -->
<header><b>AudioStage ${esc(version)} — คู่มือ</b><input id="q" type="search" placeholder="ค้นหาในคู่มือ… (Search)" autofocus><span id="count"></span></header>
<nav id="toc">${secs.map((s) => `<a href="#${s.id}" data-sec="${s.id}">${inline(s.title)}</a>` + s.subs.map((u) => `<a href="#${u.id}" class="sub" data-sec="${s.id}" data-sub="${u.id}">${inline(u.title)}</a>`).join('')).join('\n')}</nav>
<main id="doc">
${secs.map((s) => `<section id="${s.id}"><h2>${inline(s.title)}</h2>\n${s.html}</section>`).join('\n')}
<p id="none" hidden>ไม่พบคำที่ค้นหา (No matches).</p>
</main>
<script src="help.js"></script>
</body>
</html>
`;
}
function build() { return page(fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8'), require(path.join(ROOT, 'package.json')).version); }
module.exports = { sections, inline, page, build };
if (require.main === module) { const out = path.join(ROOT, 'app', 'help', 'index.html'); fs.mkdirSync(path.dirname(out), { recursive: true }); fs.writeFileSync(out, build()); console.log('wrote', out); }

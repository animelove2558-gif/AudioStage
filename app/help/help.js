/* Search in the offline manual: shows only the paragraphs / list items / topics that contain every word typed
   (Thai or English, any case), highlights the words. #q=<words> in the address opens the manual with a search. */
(function () {
  'use strict';
  const q = document.getElementById('q'), doc = document.getElementById('doc'), count = document.getElementById('count'), none = document.getElementById('none');
  const blocks = [...doc.querySelectorAll('section > p, section > ul > li, section > pre, section > h3')];
  const sections = [...doc.querySelectorAll('section')], links = [...document.querySelectorAll('#toc a')];
  const subVisible = (id) => { const p = document.getElementById(id); return !!p && !p.hidden; };
  for (const b of blocks) b.dataset.html = b.innerHTML;
  const norm = (s) => s.toLowerCase();
  const reEsc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  /* highlight words in text nodes only (never inside tags) */
  function mark(el, words) {
    const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT), nodes = [];
    while (walk.nextNode()) nodes.push(walk.currentNode);
    const re = new RegExp('(' + words.map(reEsc).join('|') + ')', 'gi');
    for (const n of nodes) {
      if (!re.test(n.nodeValue)) continue; re.lastIndex = 0;
      const f = document.createDocumentFragment(); let last = 0, m;
      while ((m = re.exec(n.nodeValue))) { f.append(n.nodeValue.slice(last, m.index)); const k = document.createElement('mark'); k.textContent = m[0]; f.append(k); last = m.index + m[0].length; }
      f.append(n.nodeValue.slice(last)); n.replaceWith(f);
    }
  }
  function run() {
    const words = norm(q.value).split(/\s+/).filter(Boolean); let n = 0;
    for (const b of blocks) { b.innerHTML = b.dataset.html; const hit = !words.length || words.every((w) => norm(b.textContent).includes(w)); b.hidden = !hit; if (hit && words.length) { n++; mark(b, words); } }
    sections.forEach((s) => { const title = norm(s.querySelector('h2').textContent), titleHit = words.length && words.every((w) => title.includes(w));
      if (titleHit) s.querySelectorAll('[hidden]').forEach((x) => { if (x !== none) x.hidden = false; });
      const any = !words.length || titleHit || [...s.children].some((c) => c.tagName !== 'H2' && !c.hidden && (c.tagName !== 'UL' || [...c.children].some((li) => !li.hidden)));
      s.hidden = !any; s.querySelectorAll('ul').forEach((u) => (u.hidden = words.length && !titleHit && ![...u.children].some((li) => !li.hidden)));
      for (const a of links) if (a.dataset.sec === s.id) a.hidden = !any || !!(a.dataset.sub && words.length && !titleHit && !subVisible(a.dataset.sub)); });
    count.textContent = words.length ? n + ' match(es)' : '';
    none.hidden = !words.length || sections.some((s) => !s.hidden);
    try { history.replaceState(null, '', words.length ? '#q=' + encodeURIComponent(q.value) : location.pathname); } catch (e) { /* file: URLs */ }
  }
  q.addEventListener('input', run);
  const m = /#q=([^&]*)/.exec(location.hash); if (m) { q.value = decodeURIComponent(m[1]); run(); }
  window.helpSearch = (s) => { q.value = s; run(); return { matches: blocks.filter((b) => !b.hidden && s).length, sections: sections.filter((x) => !x.hidden).length }; }; // (tests)
})();

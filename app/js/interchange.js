/* Multitrack interchange: Final Cut Pro 7 XML ("xmeml" version 5) — opened by Premiere Pro, DaVinci Resolve and
   Adobe Audition (File > Import), and written by them. The subset: audio tracks, clips (position, source in/out,
   file), clip level (clip gain × track volume), track pan, fade in / out (as audio transitions). Times in xmeml are
   frames of the sequence timebase (default 30 fps), so positions are rounded to 1/30 s. */
(function (root) {
  'use strict';
  const AS = (root.AS = root.AS || {});
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));

  /* ---- a small XML reader (elements, attributes, text; enough for xmeml) ---- */
  function parseXml(text) {
    const s = String(text).replace(/^\uFEFF/, ''), root0 = { name: '#doc', attrs: {}, children: [], text: '' }, stack = [root0];
    const ent = (t) => t.replace(/&(lt|gt|amp|quot|apos|#\d+|#x[0-9a-f]+);/gi, (m, e) => (e[0] === '#' ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : +e.slice(1)) : { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" }[e.toLowerCase()]));
    let i = 0;
    while (i < s.length) {
      const lt = s.indexOf('<', i);
      if (lt < 0) { stack[stack.length - 1].text += ent(s.slice(i)); break; }
      if (lt > i) stack[stack.length - 1].text += ent(s.slice(i, lt));
      if (s.startsWith('<!--', lt)) { i = s.indexOf('-->', lt) + 3; continue; }
      if (s.startsWith('<![CDATA[', lt)) { const e = s.indexOf(']]>', lt); stack[stack.length - 1].text += s.slice(lt + 9, e); i = e + 3; continue; }
      if (s[lt + 1] === '?' || s[lt + 1] === '!') { i = s.indexOf('>', lt) + 1; continue; }
      const gt = s.indexOf('>', lt); if (gt < 0) throw new Error('Broken XML.');
      const tag = s.slice(lt + 1, gt);
      if (tag[0] === '/') { const n = tag.slice(1).trim(); while (stack.length > 1 && stack.pop().name !== n); i = gt + 1; continue; }
      const self = tag.endsWith('/'), body = self ? tag.slice(0, -1) : tag, m = /^([^\s/]+)/.exec(body), el = { name: m[1], attrs: {}, children: [], text: '' };
      body.slice(m[1].length).replace(/([\w:.-]+)\s*=\s*("([^"]*)"|'([^']*)')/g, (x, k, v, a, b) => { el.attrs[k] = ent(a !== undefined ? a : b); return ''; });
      stack[stack.length - 1].children.push(el); if (!self) stack.push(el);
      i = gt + 1;
    }
    return root0;
  }
  const kids = (el, n) => (el ? el.children.filter((c) => c.name === n) : []);
  const kid = (el, n) => kids(el, n)[0] || null;
  const txt = (el, n) => { const k = kid(el, n); return k ? k.text.trim() : ''; };
  const find = (el, n) => { if (!el) return null; for (const c of el.children) { if (c.name === n) return c; const r = find(c, n); if (r) return r; } return null; };

  /* file:// URL ↔ path (Windows and POSIX) */
  const toUrl = (p) => (/^[a-z]+:\/\//i.test(p) || !/[\\/]/.test(p) ? p : 'file://localhost/' + encodeURI(p.replace(/\\/g, '/').replace(/^\//, '')).replace(/#/g, '%23'));
  function fromUrl(u) {
    if (!/^file:/i.test(u)) return u;
    let p = decodeURIComponent(u.replace(/^file:\/\/(localhost)?/i, ''));
    if (/^\/[a-z]:\//i.test(p)) p = p.slice(1); // /C:/… → C:/…
    return p;
  }

  /* session + media table → xmeml text. media(src) → {id, name, url, sr, nch, frames (source length in samples)}.
     o: {name, timebase} */
  function toFCP7(session, media, o) {
    const oo = o || {}, tb = oo.timebase || 30, F = (sec) => Math.round(sec * tb), D = AS.dsp, sr = session.sr || 48000;
    const rate = `<rate><timebase>${tb}</timebase><ntsc>FALSE</ntsc></rate>`, seen = new Set();
    let clipN = 0, total = 0;
    const tracks = session.tracks.filter((t) => t.type !== 'video' && t.type !== 'bus' && t.clips.length).map((t) => {
      const items = t.clips.slice().sort((a, b) => a.start - b.start).map((c) => {
        const m = media(c), id = 'clipitem-' + ++clipN, start = F(c.start), end = Math.max(start + 1, F(c.start + c.dur)), inn = F(m.off != null ? m.off : c.off), dur = F(m.frames / m.sr);
        total = Math.max(total, end);
        const level = Math.min(3.98107, D.fromDb((c.gain || 0) + (t.vol || 0)));
        const file = seen.has(m.id) ? `<file id="${m.id}"/>` : (seen.add(m.id), `<file id="${m.id}"><name>${esc(m.name)}</name><pathurl>${esc(m.url)}</pathurl>${rate}<duration>${dur}</duration><media><audio><samplecharacteristics><depth>24</depth><samplerate>${m.sr}</samplerate></samplecharacteristics><channelcount>${m.nch}</channelcount></audio></media></file>`);
        let x = `<clipitem id="${id}"><name>${esc(c.name || m.name)}</name><enabled>TRUE</enabled><duration>${dur}</duration>${rate}<start>${start}</start><end>${end}</end><in>${inn}</in><out>${inn + end - start}</out>${file}<sourcetrack><mediatype>audio</mediatype><trackindex>1</trackindex></sourcetrack>`;
        x += `<filter><effect><name>Audio Levels</name><effectid>audiolevels</effectid><effectcategory>audiolevels</effectcategory><effecttype>audiolevels</effecttype><mediatype>audio</mediatype><parameter><parameterid>level</parameterid><name>Level</name><valuemin>0</valuemin><valuemax>3.98109</valuemax><value>${+level.toFixed(6)}</value></parameter></effect></filter>`;
        if (t.pan) x += `<filter><effect><name>Audio Pan</name><effectid>audiopan</effectid><effectcategory>audiopan</effectcategory><effecttype>audiopan</effecttype><mediatype>audio</mediatype><parameter><parameterid>pan</parameterid><name>pan</name><valuemin>-1</valuemin><valuemax>1</valuemax><value>${+t.pan.toFixed(4)}</value></parameter></effect></filter>`;
        x += '</clipitem>';
        const tr = (a, b, align) => `<transitionitem>${rate}<start>${a}</start><end>${b}</end><alignment>${align}</alignment><effect><name>Cross Fade (0dB)</name><effectid>KGAudioTransCrossFade0dB</effectid><effectcategory>audiotransition</effectcategory><effecttype>transition</effecttype><mediatype>audio</mediatype></effect></transitionitem>`;
        const fi = c.fi > 0 ? tr(start, Math.min(end, start + Math.max(1, F(c.fi))), 'start') : '', fo = c.fo > 0 ? tr(Math.max(start, end - Math.max(1, F(c.fo))), end, 'end') : '';
        return fi + x + fo;
      });
      return `<track><name>${esc(t.name)}</name><enabled>TRUE</enabled><locked>FALSE</locked>${items.join('')}</track>`;
    });
    return '<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE xmeml>\n<xmeml version="5">\n<sequence id="sequence-1"><name>' + esc(oo.name || 'AudioStage Session') + `</name><duration>${total}</duration>${rate}<media><audio><format><samplecharacteristics><depth>24</depth><samplerate>${sr}</samplerate></samplecharacteristics></format>${tracks.join('\n')}</audio></media></sequence>\n</xmeml>\n`;
  }

  /* xmeml text → {name, timebase, files: {id: {name, path, sr, nch}}, tracks: [{name, pan, clips: [{name, file, start, dur, off, gainDb, fi, fo}]}]} (seconds) */
  function fromFCP7(text) {
    const doc = parseXml(text), xm = find(doc, 'xmeml'); if (!xm) throw new Error('Not an FCP XML (xmeml) file.');
    const seq = find(xm, 'sequence'); if (!seq) throw new Error('The XML has no sequence.');
    const tbOf = (el, d) => { const r = kid(el, 'rate'); return r ? +txt(r, 'timebase') || d : d; }, tb = tbOf(seq, 30);
    const audio = find(kid(seq, 'media'), 'audio'); const files = {}, tracks = [];
    for (const tr of kids(audio, 'track')) {
      const t = { name: txt(tr, 'name') || 'Track ' + (tracks.length + 1), pan: 0, clips: [] }, trans = [];
      for (const it of tr.children) {
        if (it.name === 'transitionitem') { trans.push({ a: +txt(it, 'start'), b: +txt(it, 'end'), align: txt(it, 'alignment') }); continue; }
        if (it.name !== 'clipitem' || txt(it, 'enabled') === 'FALSE') continue;
        const ctb = tbOf(it, tb), f = kid(it, 'file'), fid = f ? f.attrs.id || 'f' + Object.keys(files).length : null;
        if (f && f.children.length) {
          const sc = find(f, 'samplecharacteristics');
          files[fid] = { id: fid, name: txt(f, 'name'), path: fromUrl(txt(f, 'pathurl')), sr: sc ? +txt(sc, 'samplerate') || 0 : 0, nch: +txt(find(f, 'audio') || f, 'channelcount') || 0 };
        }
        let start = +txt(it, 'start'), end = +txt(it, 'end'); const inn = +txt(it, 'in'), out = +txt(it, 'out');
        if (start < 0 || end < 0) { start = start < 0 ? (end >= 0 ? end - (out - inn) : 0) : start; end = start + (out - inn); } // -1 = next to a transition
        let level = 1, pan = null;
        for (const fl of kids(it, 'filter')) { const ef = kid(fl, 'effect'), id = txt(ef, 'effectid'); for (const p of kids(ef, 'parameter')) { const pid = txt(p, 'parameterid'); if (id === 'audiolevels' && pid === 'level') level *= +txt(p, 'value') || 0; if (id === 'audiopan' && pid === 'pan') pan = +txt(p, 'value'); } }
        if (pan != null) t.pan = Math.max(-1, Math.min(1, pan));
        t.clips.push({ name: txt(it, 'name'), file: fid, start: start / ctb, dur: (end - start) / ctb, off: inn / ctb, gainDb: level > 0 ? 20 * Math.log10(level) : -96, fi: 0, fo: 0, _a: start, _b: end, _tb: ctb });
      }
      for (const x of trans) for (const c of t.clips) { // fades: transitions at a clip's start / end
        if (x.align === 'start' && Math.abs(x.a - c._a) <= 1) c.fi = (x.b - x.a) / c._tb;
        else if (x.align === 'end' && Math.abs(x.b - c._b) <= 1) c.fo = (x.b - x.a) / c._tb;
        else if (x.align === 'center' || x.align === 'end-black' || x.align === 'start-black') { if (Math.abs(x.a - c._a) <= 1 || (x.a < c._a && x.b > c._a)) c.fi = Math.max(c.fi, (x.b - Math.max(x.a, c._a)) / c._tb); if (Math.abs(x.b - c._b) <= 1 || (x.a < c._b && x.b > c._b)) c.fo = Math.max(c.fo, (Math.min(x.b, c._b) - x.a) / c._tb); }
      }
      t.clips.forEach((c) => { delete c._a; delete c._b; delete c._tb; });
      if (t.clips.length) tracks.push(t);
    }
    return { name: txt(seq, 'name'), timebase: tb, files, tracks };
  }

  AS.interchange = { parseXml, toFCP7, fromFCP7, toUrl, fromUrl, esc };
})(typeof window !== 'undefined' ? window : globalThis);

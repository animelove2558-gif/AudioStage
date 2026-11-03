/* Favorites: a named sequence of effects (with their parameters) and simple file operations, applied with one click,
   recorded from what you do, and usable in Batch Process. Also the export file-name templates of Batch Process. */
(function (root) {
  'use strict';
  const AS = (root.AS = root.AS || {});
  const KEY = 'as-favorites';
  const D = () => AS.dsp, E = () => AS.effects;

  /* file operations a favorite can contain (pure: channels in, channels out) */
  const OPS = {
    'edit.tomono': { label: 'Convert to Mono', changesChannels: true, apply: (c) => (c.length === 1 ? c : [D().mixMono(c).slice()]) },
    'edit.tostereo': { label: 'Convert to Stereo', changesChannels: true, apply: (c) => (c.length === 2 ? c : c.length === 1 ? [c[0].slice(), c[0].slice()] : [c[0].slice(), c[1].slice()]) },
    'edit.trimsilence': { label: 'Trim Leading/Trailing Silence', changesLength: true, apply: (c) => {
      const thr = D().fromDb(-50), L = c[0].length, pk = (i) => { let m = 0; for (const x of c) m = Math.max(m, Math.abs(x[i])); return m; };
      let a = 0, b = L; while (a < b && pk(a) < thr) a++; while (b > a && pk(b - 1) < thr) b--; return D().sliceCh(c, a, b);
    } },
  };
  /* built-in favorites (like Audition's): effects with fixed settings; steps only list the parameters that differ
     from the effect's defaults */
  const BUILTIN = [
    { id: 'b-norm3', name: 'Normalize to -3 dB', builtin: true, steps: [{ type: 'fx', id: 'normalize', p: { target: -3 } }] },
    { id: 'b-fadein', name: 'Fade In (S-curve)', builtin: true, steps: [{ type: 'fx', id: 'fadein', p: { curve: 'cosine' } }] },
    { id: 'b-fadeout', name: 'Fade Out (S-curve)', builtin: true, steps: [{ type: 'fx', id: 'fadeout', p: { curve: 'cosine' } }] },
    { id: 'b-podcast', name: 'Podcast Voice (rumble cut, leveler, −16 LUFS)', builtin: true, steps: [{ type: 'fx', id: 'hpf', p: { f: 80 } }, { type: 'fx', id: 'leveler', p: {} }, { type: 'fx', id: 'loudnorm', p: { target: -16, ceil: -1 } }] },
    { id: 'b-broadcast', name: 'Broadcast Loudness (EBU R128, −23 LUFS)', builtin: true, steps: [{ type: 'fx', id: 'loudnorm', p: { target: -23, ceil: -1 } }] },
    { id: 'b-mono', name: 'Mono, Normalize to -1 dB', builtin: true, steps: [{ type: 'op', id: 'edit.tomono' }, { type: 'fx', id: 'normalize', p: { target: -1 } }] },
  ];
  let user = [];
  try { user = JSON.parse(root.localStorage.getItem(KEY)) || []; } catch (e) { user = []; }
  const save = () => { try { root.localStorage.setItem(KEY, JSON.stringify(user)); } catch (e) { /* */ } };
  const all = () => [...BUILTIN, ...user];
  const byId = (id) => all().find((f) => f.id === id) || null;
  const newId = () => 'f' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  function add(name, steps) { const f = { id: newId(), name: String(name || 'Favorite').trim() || 'Favorite', steps: JSON.parse(JSON.stringify(steps)) }; user.push(f); save(); return f; }
  function remove(id) { const n = user.length; user = user.filter((f) => f.id !== id); save(); return user.length < n; }
  function rename(id, name) { const f = user.find((x) => x.id === id); if (f && name) { f.name = name; save(); } return f; }
  /* a step's full parameter set: the effect's defaults + the step's own values */
  const params = (st) => ({ ...(E().defaults(E().byId(st.id)) || {}), ...(st.p || {}) });
  function describe(st) {
    if (st.type === 'op') return (OPS[st.id] || { label: st.id }).label;
    if (st.type === 'vst') return 'VST: ' + (st.name || String(st.path || '').split(/[\\/]/).pop()) + (st.tail ? ` (tail ${st.tail} s)` : '');
    const fx = E().byId(st.id); if (!fx) return st.id + ' (missing)';
    const ps = Object.entries(st.p || {}).map(([k, v]) => { const d = fx.params.find((q) => q.id === k); return d ? `${d.label} ${typeof v === 'number' ? +v.toFixed(2) : v}${d.unit ? ' ' + d.unit : ''}` : ''; }).filter(Boolean);
    return fx.name.replace(/\.\.\.$/, '') + (ps.length ? ' (' + ps.join(', ') + ')' : '');
  }
  const valid = (st) => (st.type === 'op' ? !!OPS[st.id] : st.type === 'vst' ? !!st.path : st.type === 'fx' && !!E().byId(st.id));
  const changesChannels = (steps) => steps.some((s) => s.type === 'op' && OPS[s.id] && OPS[s.id].changesChannels);
  /* run the steps on channels; runFx(id, chs, sr, params) → Promise<chs> (the app runs effects in the worker) */
  async function process(chs, sr, steps, runFx, onStep) {
    let c = chs;
    for (let i = 0; i < steps.length; i++) {
      const st = steps[i]; if (!valid(st)) throw new Error('This favorite uses something that no longer exists: ' + (st.id || st.type));
      if (onStep) onStep(i, st);
      if (st.type === 'vst') { if (!AS.favorites.vstRun) throw new Error('VST plugins need the desktop app.'); c = await AS.favorites.vstRun(st, c, sr); } // set by vst.js
      else c = st.type === 'op' ? OPS[st.id].apply(c, sr) : await runFx(st.id, c, sr, params(st));
    }
    return c;
  }
  /* recording: what the user applies is appended until stop() */
  let rec = null;
  const recorder = {
    start() { rec = []; }, active: () => !!rec, steps: () => (rec ? rec.slice() : []),
    push(st) { if (rec && valid(st)) rec.push(JSON.parse(JSON.stringify(st))); },
    stop() { const s = rec || []; rec = null; return s; },
  };
  /* only the parameters that differ from the defaults are kept (smaller, survives new parameters) */
  function fxStep(id, p) {
    const fx = E().byId(id), d = (fx && E().defaults(fx)) || {}, out = {};
    for (const [k, v] of Object.entries(p || {})) if (JSON.stringify(v) !== JSON.stringify(d[k])) out[k] = v;
    return { type: 'fx', id, p: out };
  }

  /* Batch Process export names: {name} source file name (no extension) · {n} 1, 2, … · {nn} 01, 02, … · {fav} the
     favorite / effect name · {date} YYYY-MM-DD. Characters Windows forbids become "_". */
  function fileName(template, o) {
    const pad = (v) => String(v).padStart(2, '0'), dt = o.date || new Date();
    const s = String(template || '{name}').replace(/\{name\}/g, o.name || 'untitled').replace(/\{nn\}/g, pad(o.n || 1)).replace(/\{n\}/g, String(o.n || 1))
      .replace(/\{fav\}/g, o.fav || '').replace(/\{date\}/g, `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`);
    return (s.replace(/[\\/:*?"<>|\x00-\x1f]+/g, '_').replace(/^\.+/, '').trim().slice(0, 150) || 'untitled') + (o.ext ? '.' + o.ext : '');
  }

  AS.favorites = { OPS, BUILTIN, all, byId, add, remove, rename, params, describe, valid, changesChannels, process, recorder, fxStep, fileName, _reset: () => { user = []; save(); } };
})(typeof window !== 'undefined' ? window : globalThis);

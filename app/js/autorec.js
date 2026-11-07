/* Recording track automation from the faders while the transport runs (Multitrack > Automation Mode).
     write  the selected tracks' volume and pan are recorded for the whole pass
     touch  a fader is recorded while it is held, then its old automation carries on
     latch  from the first touch until the transport stops
     trim   while held, the move is added to the automation already there (nothing there: as touch)
   The pass goes into track.auto at Stop, as one undo step, with redundant points removed. The pure part (merge, thin) has no
   Web Audio or DOM, so the tests run it in Node. */
(function (root) {
  'use strict';
  const AS = (root.AS = root.AS || {});
  const MODES = [['off', 'Off'], ['write', 'Write'], ['touch', 'Touch'], ['latch', 'Latch'], ['trim', 'Trim']];
  const EPS = { vol: 0.25, pan: 0.01 }, GLIDE = 0.05;

  /* straight line between two points, value at time t */
  function valueAt(pts, t, dflt) {
    if (!pts || !pts.length) return dflt;
    if (t <= pts[0].t) return pts[0].v;
    for (let i = 1; i < pts.length; i++) if (t <= pts[i].t) { const a = pts[i - 1], b = pts[i], d = b.t - a.t; return d > 0 ? a.v + ((b.v - a.v) * (t - a.t)) / d : b.v; }
    return pts[pts.length - 1].v;
  }
  /* Ramer-Douglas-Peucker: keeps the points needed to stay within eps of the recorded curve */
  function thin(pts, eps) {
    if (pts.length < 3) return pts.slice();
    const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1; const st = [[0, pts.length - 1]];
    while (st.length) {
      const [a, b] = st.pop(); let worst = -1, at = -1; const A = pts[a], B = pts[b], d = B.t - A.t;
      for (let i = a + 1; i < b; i++) { const v = d > 0 ? A.v + ((B.v - A.v) * (pts[i].t - A.t)) / d : A.v, e = Math.abs(pts[i].v - v); if (e > worst) { worst = e; at = i; } }
      if (worst > eps) { keep[at] = 1; st.push([a, at], [at, b]); }
    }
    return pts.filter((_, i) => keep[i]);
  }
  /* a recorded segment replaces [first, last] of old; the old curve comes back after a short glide */
  function merge(old, seg, dflt, eps) {
    if (!seg.length) return (old || []).slice();
    const a = seg[0].t, b = seg[seg.length - 1].t, pts = old || [], v0 = valueAt(pts, a, dflt), v1 = valueAt(pts, b + GLIDE, dflt);
    const before = pts.filter((p) => p.t < a - 1e-6), after = pts.filter((p) => p.t > b + GLIDE + 1e-6);
    const lead = before.length || a <= 1e-6 ? [] : [{ t: Math.max(0, a - 1e-3), v: v0 }];
    return [...before, ...lead, ...thin(seg, eps), { t: b + GLIDE, v: v1 }, ...after].map((p) => ({ t: p.t, v: p.v }));
  }
  /* trim: delta (dB or pan) added to the old curve over [a, b] */
  function trim(old, a, b, delta, dflt, lim) {
    const pts = old || [], clamp = (v) => Math.max(lim[0], Math.min(lim[1], v));
    const inside = pts.filter((p) => p.t >= a && p.t <= b).map((p) => ({ t: p.t, v: clamp(p.v + delta) }));
    return [...pts.filter((p) => p.t < a), { t: Math.max(0, a - GLIDE), v: valueAt(pts, Math.max(0, a - GLIDE), dflt) }, { t: a, v: clamp(valueAt(pts, a, dflt) + delta) }, ...inside, { t: b, v: clamp(valueAt(pts, b, dflt) + delta) }, { t: b + GLIDE, v: valueAt(pts, b + GLIDE, dflt) }, ...pts.filter((p) => p.t > b + GLIDE)]
      .sort((x, y) => x.t - y.t).filter((p, i, l) => i === 0 || p.t > l[i - 1].t);
  }
  const LIM = { vol: [-60, 12], pan: [-1, 1] };

  /* one pass of the transport. o: { mode, now() → timeline seconds, tracks: those Write records, setLive(t, param, v), restoreLive(t, param, pts, time) } */
  class Pass {
    constructor(o) { this.o = o; this.recs = new Map(); if (o.mode === 'write') for (const t of o.tracks || []) for (const p of ['vol', 'pan']) { const r = this.rec(t, p); r.on = true; r.write = true; } }
    rec(t, param) {
      const k = t.id + ':' + param; let r = this.recs.get(k);
      if (!r) { r = { t, param, base: t[param], on: false, held: false, segs: [], cur: null, trims: [] }; this.recs.set(k, r); }
      return r;
    }
    /* a fader was grabbed */
    hold(t, param) {
      const r = this.rec(t, param), m = this.o.mode; r.held = true;
      if (m === 'trim') { const at = this.o.now(); r.trimStart = t[param]; r.trimAt = at; r.delta = 0; }
      else if (!r.write) { r.on = true; }
    }
    /* it moved: the new value is heard at once */
    move(t, param, v) {
      const r = this.rec(t, param); if (this.o.mode === 'trim') { if (r.held) r.delta = v - r.trimStart; } else if (!r.on) r.on = true;
      if (this.o.setLive) this.o.setLive(t, param, v, this.o.mode === 'trim' ? valueAt(t.auto && t.auto[param], this.o.now(), r.base) + (r.delta || 0) : v);
      this.sample(r);
    }
    /* it was let go */
    release(t, param) {
      const r = this.rec(t, param), m = this.o.mode; r.held = false;
      if (m === 'trim') { if (r.delta) r.trims.push({ a: r.trimAt, b: this.o.now(), d: r.delta }); r.delta = 0; if (this.o.restoreLive) this.o.restoreLive(t, param, t.auto && t.auto[param], this.o.now(), r.base); }
      else if (m === 'touch') { this.sample(r); r.on = false; this.close(r); if (this.o.restoreLive) this.o.restoreLive(t, param, t.auto && t.auto[param], this.o.now(), r.base); }
    }
    close(r) { if (r.cur && r.cur.length) r.segs.push(r.cur); r.cur = null; }
    sample(r) {
      if (!r.on || this.o.mode === 'trim') return;
      const time = this.o.now(); if (time === null || time === undefined) return;
      if (r.cur && r.cur.length && time < r.cur[r.cur.length - 1].t - 0.05) this.close(r); // (the playhead jumped back: a loop pass)
      (r.cur || (r.cur = [])).push({ t: time, v: r.t[r.param] });
    }
    tick() { for (const r of this.recs.values()) this.sample(r); }
    /* into track.auto; returns how many lanes changed. push() runs once, before the first change (undo). */
    commit(push) {
      let n = 0, pushed = false;
      const edit = (r, pts) => { if (!pushed) { pushed = true; if (push) { const keep = [...this.recs.values()].map((x) => [x, x.t[x.param]]); for (const [x] of keep) x.t[x.param] = x.base; push(); for (const [x, v] of keep) x.t[x.param] = v; } } r.t.auto[r.param] = pts; n++; };
      for (const r of this.recs.values()) {
        const m = this.o.mode;
        if (m === 'trim') { for (const x of r.trims) edit(r, trim(r.t.auto[r.param], x.a, x.b, x.d, r.base, LIM[r.param])); }
        else { this.sample(r); this.close(r); for (const s of r.segs) if (s.length > 1) edit(r, merge(r.t.auto[r.param], s, r.base, EPS[r.param])); }
        r.t[r.param] = r.base; // the static value is what it was: the lane now holds the moves
      }
      return n;
    }
  }
  AS.autorec = { MODES, Pass, valueAt, thin, merge, trim, GLIDE };
})(typeof window !== 'undefined' ? window : globalThis);

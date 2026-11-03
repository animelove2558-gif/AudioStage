/* Waveform / spectral editor view. */
(function (root) {
  'use strict';
  const AS = (root.AS = root.AS || {});
  const D = AS.dsp;
  const RULER_H = 26;

  function fmtTime(sec, step) {
    const neg = sec < 0; sec = Math.abs(sec);
    const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    let dec = 3;
    if (step !== undefined) dec = step >= 1 ? 0 : Math.min(3, Math.max(0, Math.ceil(-Math.log10(step))));
    const ss = s.toFixed(dec).padStart(dec ? dec + 3 : 2, '0');
    return (neg ? '-' : '') + (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + ss;
  }
  function niceStep(minStep) {
    const base = [1, 2, 5];
    for (let e = -4; e < 6; e++) for (const b of base) { const v = b * Math.pow(10, e); if (v >= minStep) return v; }
    return 3600;
  }
  const SP = AS.spectral; // display settings (FFT size, window, dB range, colour map, pitch overlay)
  const SPEC_TOOLS = ['marquee', 'lasso', 'brush', 'heal', 'harm'];

  class WaveView {
    constructor(el, app) {
      this.app = app; this.el = el; this.doc = null; this.mode = 'wave'; this.tool = 'time'; this.drag = null; this.dpr = window.devicePixelRatio || 1;
      this.brushPx = 14; // Brush / Spot Healing Brush radius in pixels
      el.innerHTML = '<div class="wv-ruler"><canvas></canvas></div><div class="wv-main"><canvas></canvas></div><div class="wv-scroll"><input type="range" min="0" max="1000000" value="0"></div>';
      this.rulerC = el.querySelector('.wv-ruler canvas'); this.mainC = el.querySelector('.wv-main canvas'); this.scroll = el.querySelector('input');
      this.scroll.addEventListener('input', () => {
        const d = this.doc; if (!d) return;
        const span = Math.max(0, d.len - this.W * d.vs.spp);
        d.vs.start = (this.scroll.value / 1e6) * span; this.draw();
      });
      const mc = this.mainC;
      mc.addEventListener('mousedown', (e) => this.onDown(e));
      window.addEventListener('mousemove', (e) => this.onMove(e));
      window.addEventListener('mouseup', () => this.onUp());
      mc.addEventListener('dblclick', () => this.selectView());
      mc.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });
      this.rulerC.addEventListener('mousedown', (e) => { if (!this.doc) return; this.drag = { type: 'ruler' }; this.setCursorFromX(e, true); });
      new ResizeObserver(() => this.resize()).observe(el.querySelector('.wv-main'));
      this.specCache = null;
      // static layer (everything but the playhead), re-rendered only when the view changes
      this.baseM = document.createElement('canvas'); this.baseR = document.createElement('canvas'); this.baseKey = null;
    }
    resize() {
      const m = this.el.querySelector('.wv-main'), r = this.el.querySelector('.wv-ruler');
      this.W = m.clientWidth; this.H = m.clientHeight; this.dpr = window.devicePixelRatio || 1;
      this.mainC.width = Math.max(1, this.W * this.dpr); this.mainC.height = Math.max(1, this.H * this.dpr);
      this.rulerC.width = Math.max(1, this.W * this.dpr); this.rulerC.height = RULER_H * this.dpr;
      this.mainC.style.width = this.W + 'px'; this.mainC.style.height = this.H + 'px';
      this.rulerC.style.width = this.W + 'px'; this.rulerC.style.height = RULER_H + 'px';
      this.baseM.width = this.mainC.width; this.baseM.height = this.mainC.height; this.baseR.width = this.rulerC.width; this.baseR.height = this.rulerC.height;
      if (this.doc && !this.doc.vs.spp) this.zoomAll();
      this.draw();
    }
    setDoc(d) { this.doc = d; if (d && (!d.vs.spp || d.vs.spp <= 0) && this.W) this.zoomAll(); this.draw(); }
    setMode(m) { this.mode = m; this.draw(); }
    /* ---------- geometry ---------- */
    x2s(x) { return this.doc.vs.start + x * this.doc.vs.spp; }
    s2x(s) { return (s - this.doc.vs.start) / this.doc.vs.spp; }
    visibleSamples() { return this.W * this.doc.vs.spp; }
    clampView() {
      const d = this.doc, vis = this.visibleSamples();
      d.vs.start = D.clamp(d.vs.start, 0, Math.max(0, d.len - vis));
    }
    zoomAll() { const d = this.doc; if (!d || !this.W) return; d.vs.spp = Math.max(1 / 64, d.len / this.W); d.vs.start = 0; this.draw(); }
    zoomSel() { const d = this.doc; if (!d || !d.hasSel()) return; d.vs.spp = Math.max(1 / 64, (d.sel.b - d.sel.a) / this.W); d.vs.start = d.sel.a; this.draw(); }
    zoomBy(f, ax) {
      const d = this.doc; if (!d) return;
      ax = ax === undefined ? this.W / 2 : ax;
      const anchor = this.x2s(ax), maxSpp = Math.max(1 / 64, d.len / this.W);
      d.vs.spp = D.clamp(d.vs.spp * f, 1 / 64, maxSpp);
      d.vs.start = anchor - ax * d.vs.spp; this.clampView(); this.draw();
    }
    scrollTo(sample) { const d = this.doc; d.vs.start = sample; this.clampView(); this.draw(); }
    ensureVisible(s) {
      const d = this.doc, vis = this.visibleSamples();
      if (s < d.vs.start || s > d.vs.start + vis) { d.vs.start = s - vis * 0.1; this.clampView(); }
    }
    selectView() { const d = this.doc; if (!d) return; d.sel = { a: Math.round(d.vs.start), b: Math.min(d.len, Math.round(d.vs.start + this.visibleSamples())) }; this.app.selectionChanged(); }
    /* ---------- mouse ---------- */
    localX(e) { const r = this.mainC.getBoundingClientRect(); return e.clientX - r.left; }
    /* click / drag in the ruler: move the playhead; while stopped, scrub (hear the audio under it) */
    setCursorFromX(e, scrub) {
      const r = this.rulerC.getBoundingClientRect(), s = Math.round(D.clamp(this.x2s(e.clientX - r.left), 0, this.doc.len)), playing = AS.engine.playing;
      this.doc.sel = { a: s, b: s }; this.app.cursorMoved(true);
      if (scrub && !playing && this.app.scrub) this.app.scrub(s / this.doc.sr, 'wave');
    }
    localY(e) { return e.clientY - this.mainC.getBoundingClientRect().top; }
    laneAt(y) { return Math.min(this.doc.ch.length - 1, Math.max(0, Math.floor(y / (this.H / this.doc.ch.length)))); }
    y2f(y) { const d = this.doc, h = this.H / d.ch.length, yl = y - this.laneAt(y) * h; return 30 * Math.pow(d.sr / 2 / 30, 1 - D.clamp(yl / h, 0, 1)); }
    f2y(f, lane) { const d = this.doc, h = this.H / d.ch.length; return lane * h + h * (1 - Math.log(f / 30) / Math.log(d.sr / 2 / 30)); }
    /* brush radius → shape units: rs samples wide, ro octaves tall */
    brushShape(pts) { const d = this.doc, h = this.H / d.ch.length; return { kind: 'brush', pts, rs: this.brushPx * d.vs.spp, ro: (this.brushPx / h) * Math.log2(d.sr / 2 / 30) }; }
    onDown(e) {
      const d = this.doc; if (!d) return;
      const x = this.localX(e), s = Math.round(D.clamp(this.x2s(x), 0, d.len));
      if (e.button !== 0) return;
      const y = this.localY(e);
      if (x < 24 && d.ch.length > 1 && y < this.H) {
        const lane = this.laneAt(y); d.chOn[lane] = !d.chOn[lane];
        if (!d.chOn.some(Boolean)) d.chOn[lane] = true;
        this.draw(); this.app.selectionChanged(); return;
      }
      if (this.mode === 'spec' && SPEC_TOOLS.includes(this.tool)) {
        const f = this.y2f(y), lane = this.laneAt(y);
        if (this.tool === 'marquee') { this.drag = { type: 'marquee', s0: s, f0: f, lane }; d.spec = { kind: 'rect', a: s, b: s, f0: f, f1: f }; }
        else if (this.tool === 'lasso') { this.drag = { type: 'lasso', lane, lx: x, ly: y }; d.spec = { kind: 'lasso', pts: [[s, f]] }; }
        else if (this.tool === 'brush' || this.tool === 'heal') {
          // Shift + Brush adds to the current brush selection; the Spot Healing Brush always starts a new stroke
          const keep = this.tool === 'brush' && e.shiftKey && d.spec && d.spec.kind === 'brush';
          this.drag = { type: 'brush', lane, lx: x, ly: y, heal: this.tool === 'heal' };
          d.spec = keep ? { ...d.spec, pts: [...d.spec.pts, [s, f]] } : this.brushShape([[s, f]]);
        } else if (this.tool === 'harm') { this.drag = null; this.app.harmonicsAt(s, f); return; }
        this.draw(); return;
      }
      if (d.hasSel()) {
        const xa = this.s2x(d.sel.a), xb = this.s2x(d.sel.b);
        if (Math.abs(x - xa) < 6) { this.drag = { type: 'sel', anchor: d.sel.b }; return; }
        if (Math.abs(x - xb) < 6) { this.drag = { type: 'sel', anchor: d.sel.a }; return; }
      }
      if (e.shiftKey && d.hasSel() || e.shiftKey) {
        const anchor = d.hasSel() ? (Math.abs(s - d.sel.a) < Math.abs(s - d.sel.b) ? d.sel.b : d.sel.a) : d.sel.a;
        this.drag = { type: 'sel', anchor }; this.updateSel(s); return;
      }
      const z = this.app.snapS ? this.app.snapS(s) : s;
      this.drag = { type: 'sel', anchor: z, moved: false, startX: x };
      d.sel = { a: z, b: z }; this.app.cursorMoved(true);
    }
    updateSel(s) {
      const d = this.doc, a = this.drag.anchor; if (this.app.snapS) s = this.app.snapS(s); // Snap to Zero Crossings
      d.sel = { a: Math.min(a, s), b: Math.max(a, s) }; this.app.selectionChanged();
    }
    onMove(e) {
      const d = this.doc; if (!d) return;
      const x = this.localX(e);
      if (this.drag && ['marquee', 'lasso', 'brush'].includes(this.drag.type)) {
        const s = D.clamp(Math.round(this.x2s(x)), 0, d.len), y = D.clamp(this.localY(e), this.drag.lane * (this.H / d.ch.length), (this.drag.lane + 1) * (this.H / d.ch.length) - 1), f = this.y2f(y);
        if (this.drag.type === 'marquee') d.spec = { kind: 'rect', a: Math.min(this.drag.s0, s), b: Math.max(this.drag.s0, s), f0: Math.min(this.drag.f0, f), f1: Math.max(this.drag.f0, f) };
        else { // lasso / brush: a new point every few pixels
          if (this.drag.type === 'brush') { this.ring = [x, this.localY(e)]; this.frame(); }
          const step = this.drag.type === 'brush' ? Math.max(2, this.brushPx / 3) : 3, dist = Math.hypot(x - this.drag.lx, y - this.drag.ly);
          if (dist < step) return;
          const add = [];
          if (this.drag.type === 'brush') for (let k = 1; k < dist / step; k++) { // fast strokes: fill the gap between events
            const u = (k * step) / dist, xi = this.drag.lx + (x - this.drag.lx) * u, yi = this.drag.ly + (y - this.drag.ly) * u;
            add.push([Math.round(D.clamp(this.x2s(xi), 0, d.len)), this.y2f(yi)]);
          }
          add.push([s, f]); this.drag.lx = x; this.drag.ly = y; d.spec = { ...d.spec, pts: [...d.spec.pts, ...add] };
        }
        this.draw(); this.app.specChanged(); return;
      }
      if (this.drag && this.drag.type === 'sel') {
        if (x < 0 || x > this.W) { d.vs.start += (x < 0 ? x : x - this.W) * d.vs.spp * 0.2; this.clampView(); }
        this.updateSel(Math.round(D.clamp(this.x2s(x), 0, d.len)));
      } else if (this.drag && this.drag.type === 'ruler') {
        this.setCursorFromX(e, true);
      } else {
        const r = this.mainC.getBoundingClientRect();
        const inside = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
        if (inside) {
          const s = D.clamp(this.x2s(x), 0, d.len);
          let near = false;
          if (d.hasSel()) near = Math.abs(x - this.s2x(d.sel.a)) < 6 || Math.abs(x - this.s2x(d.sel.b)) < 6;
          const specTool = this.mode === 'spec' && SPEC_TOOLS.includes(this.tool);
          this.mainC.style.cursor = specTool ? (this.tool === 'brush' || this.tool === 'heal' ? 'none' : 'crosshair') : near ? 'ew-resize' : 'text';
          this.app.hover(s, e.clientY - r.top, this);
        }
        // brush outline follows the pointer
        const was = this.ring; this.ring = inside && this.mode === 'spec' && (this.tool === 'brush' || this.tool === 'heal') ? [x, this.localY(e)] : null;
        if (this.ring || was) this.frame();
      }
    }
    onUp() {
      const dr = this.drag, d = this.doc; this.drag = null;
      if (!dr || !d || !d.spec) return;
      if (dr.type === 'marquee' || dr.type === 'lasso') { // too small to mean anything: clear it
        const b = D.shapeBounds(d.spec);
        if (b.b - b.a < 64 || b.f1 / b.f0 < 1.02 || (dr.type === 'lasso' && d.spec.pts.length < 3)) { d.spec = null; this.draw(); this.app.specChanged(); }
      } else if (dr.type === 'brush' && dr.heal) this.app.spotHeal(); // Spot Healing Brush: heal as soon as the stroke ends
    }
    onWheel(e) {
      const d = this.doc; if (!d) return;
      e.preventDefault();
      if (e.ctrlKey) this.zoomBy(e.deltaY > 0 ? 1.25 : 0.8, this.localX(e));
      else { d.vs.start += (e.deltaY || e.deltaX) * d.vs.spp * 0.6; this.clampView(); this.draw(); }
    }
    /* ---------- drawing ---------- */
    ticks() {
      const d = this.doc, secPerPx = d.vs.spp / d.sr, step = niceStep(secPerPx * 90), out = [];
      const t0 = Math.floor(d.vs.start / d.sr / step) * step, t1 = (d.vs.start + this.visibleSamples()) / d.sr;
      for (let t = t0; t <= t1 + step; t += step) out.push(t);
      return { step, list: out };
    }
    /* full redraw (call after anything visible changed) */
    draw() { this.baseKey = null; this.frame(); }
    /* per-frame entry used during playback: re-renders the static layer only when the view moved, then overlays the playhead */
    frame() {
      const d = this.doc, key = d ? [d.id, d.version, d.vs.start, d.vs.spp, this.W, this.H, this.dpr, this.mode, this.app.timeFormat ? this.app.timeFormat() : '', JSON.stringify(d.tempo || null)].join('|') : '';
      if (key !== this.baseKey) { if (!this.renderBase()) return; this.baseKey = key; }
      const g = this.mainC.getContext('2d'), rg = this.rulerC.getContext('2d'), dpr = this.dpr;
      g.setTransform(1, 0, 0, 1, 0, 0); rg.setTransform(1, 0, 0, 1, 0, 0);
      g.clearRect(0, 0, this.mainC.width, this.mainC.height); g.drawImage(this.baseM, 0, 0);
      rg.clearRect(0, 0, this.rulerC.width, this.rulerC.height); rg.drawImage(this.baseR, 0, 0);
      if (!d) return;
      g.setTransform(dpr, 0, 0, dpr, 0, 0); rg.setTransform(dpr, 0, 0, dpr, 0, 0);
      /* cursor / playhead */
      const p = this.app.playSample(d);
      const px = this.s2x(p);
      if (px >= 0 && px <= this.W) {
        g.strokeStyle = this.cursorCol; g.lineWidth = 1.5; g.beginPath(); g.moveTo(Math.round(px) + 0.5, 0); g.lineTo(Math.round(px) + 0.5, this.H); g.stroke(); g.lineWidth = 1;
        rg.fillStyle = this.cursorCol; rg.beginPath(); rg.moveTo(px - 5, RULER_H - 9); rg.lineTo(px + 5, RULER_H - 9); rg.lineTo(px, RULER_H); rg.fill();
      }
      if (this.ring && this.mode === 'spec') { // Brush / Spot Healing Brush outline
        g.strokeStyle = this.tool === 'heal' ? '#ffd166' : '#fff'; g.lineWidth = 1.5; g.beginPath(); g.arc(this.ring[0], this.ring[1], this.brushPx, 0, Math.PI * 2); g.stroke(); g.lineWidth = 1;
      }
    }
    /* static layer into the offscreen canvases; false if it handed off to zoomAll() */
    renderBase() {
      const g = this.baseM.getContext('2d'), rg = this.baseR.getContext('2d'), dpr = this.dpr;
      const css = getComputedStyle(document.documentElement);
      const col = (n) => css.getPropertyValue(n).trim();
      this.cursorCol = col('--cursor');
      g.setTransform(dpr, 0, 0, dpr, 0, 0); rg.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.fillStyle = col('--wave-bg'); g.fillRect(0, 0, this.W, this.H);
      rg.fillStyle = col('--panel2'); rg.fillRect(0, 0, this.W, RULER_H);
      const d = this.doc;
      if (!d) {
        g.fillStyle = col('--dim'); g.font = '14px Segoe UI, sans-serif'; g.textAlign = 'center';
        g.fillText('Open or drop an audio file, or use File > New Audio File', this.W / 2, this.H / 2);
        g.textAlign = 'left'; return true;
      }
      if (!d.vs.spp) { this.zoomAll(); return false; }
      const nch = d.ch.length, laneH = this.H / nch, sr = d.sr, tk = this.ticks();
      /* grid + ruler */
      rg.fillStyle = col('--dim'); rg.font = '10px Segoe UI, sans-serif'; rg.strokeStyle = col('--border'); rg.lineWidth = 1;
      g.strokeStyle = col('--grid'); g.lineWidth = 1;
      if (this.app.timeFormat && this.app.timeFormat() === 'bars') { // Bars:Beats ruler at the file's tempo
        const tp = AS.tempo.norm(d.tempo), pps = sr / d.vs.spp;
        for (const m of AS.tempo.gridLines(d.vs.start / sr, (d.vs.start + this.visibleSamples()) / sr, tp, pps)) {
          const x = Math.round(this.s2x(m.time * sr)) + 0.5; if (x < -1 || x > this.W + 1) continue;
          const len = m.level === 'bar' ? 9 : m.level === 'beat' ? 5 : 3;
          rg.beginPath(); rg.moveTo(x, RULER_H - len); rg.lineTo(x, RULER_H); rg.stroke(); if (m.label) rg.fillText(m.label, x + 3, 12);
          g.globalAlpha = m.level === 'bar' ? 1 : m.level === 'beat' ? 0.55 : 0.3; g.beginPath(); g.moveTo(x, 0); g.lineTo(x, this.H); g.stroke();
        }
        g.globalAlpha = 1; tk.list = [];
      }
      for (const t of tk.list) {
        const x = Math.round(this.s2x(t * sr)) + 0.5;
        if (x < -1 || x > this.W + 1) continue;
        rg.beginPath(); rg.moveTo(x, RULER_H - 9); rg.lineTo(x, RULER_H); rg.stroke();
        rg.fillText(fmtTime(t, tk.step), x + 3, 12);
        g.beginPath(); g.moveTo(x, 0); g.lineTo(x, this.H); g.stroke();
        for (let k = 1; k < 5; k++) { const xm = Math.round(this.s2x((t + (tk.step * k) / 5) * sr)) + 0.5; rg.beginPath(); rg.moveTo(xm, RULER_H - 4); rg.lineTo(xm, RULER_H); rg.stroke(); }
      }
      for (let ch = 0; ch < nch; ch++) {
        const y0 = ch * laneH;
        g.strokeStyle = col('--grid'); g.beginPath(); g.moveTo(0, y0 + laneH / 2 + 0.5); g.lineTo(this.W, y0 + laneH / 2 + 0.5); g.stroke();
        if (this.mode === 'spec') this.drawSpec(g, ch, y0, laneH); else this.drawWave(g, ch, y0, laneH, col('--wave'));
        if (ch > 0) { g.strokeStyle = col('--border'); g.beginPath(); g.moveTo(0, y0 + 0.5); g.lineTo(this.W, y0 + 0.5); g.stroke(); }
        const on = d.chOn[ch] !== false;
        if (!on) { g.fillStyle = 'rgba(0,0,0,0.45)'; g.fillRect(0, y0, this.W, laneH); }
        if (this.mode !== 'spec') {
          g.fillStyle = col('--dim'); g.font = '9px Segoe UI, sans-serif'; g.textAlign = 'right';
          for (const db of [0, -6, -12, -24]) { const yy = y0 + laneH / 2 - (laneH / 2 - 3) * D.fromDb(db); if (yy > y0 + 2) { g.fillRect(this.W - 5, yy, 5, 1); g.fillText(db + '', this.W - 7, yy + 3); } }
          g.textAlign = 'left';
        }
        if (nch > 1) {
          g.fillStyle = on ? col('--accent') : col('--border'); g.fillRect(2, y0 + 3, nch === 6 ? 24 : 18, 14);
          g.fillStyle = on ? '#fff' : col('--dim'); g.font = '10px Segoe UI, sans-serif'; g.fillText(nch === 2 ? (ch ? 'R' : 'L') : nch === 6 ? ['L', 'R', 'C', 'LFE', 'Ls', 'Rs'][ch] : String(ch + 1), 7, y0 + 14);
        }
      }
      if (this.mode === 'spec' && SP.settings().pitch) for (let ch = 0; ch < nch; ch++) this.drawPitch(g, ch, ch * laneH);
      if (d.spec && this.mode === 'spec') for (let ch = 0; ch < nch; ch++) SP.drawShape(g, this, d.spec, ch, 'rgba(255,255,255,0.14)', '#fff');
      /* markers */
      for (const m of d.markers) {
        if (m.d > 0) { // range marker: a band in the ruler and an end line
          const xa = this.s2x(m.t), xb = this.s2x(m.t + m.d);
          if (xb >= 0 && xa <= this.W) {
            rg.fillStyle = col('--marker'); rg.globalAlpha = 0.35; rg.fillRect(Math.max(0, xa), RULER_H - 6, Math.min(this.W, xb) - Math.max(0, xa), 6); rg.globalAlpha = 1;
            if (xb <= this.W) { g.strokeStyle = col('--marker'); g.setLineDash([3, 3]); g.beginPath(); g.moveTo(xb + 0.5, 0); g.lineTo(xb + 0.5, this.H); g.stroke(); g.setLineDash([]); }
          }
        }
        const x = this.s2x(m.t); if (x < 0 || x > this.W) continue;
        g.strokeStyle = col('--marker'); g.beginPath(); g.moveTo(x + 0.5, 0); g.lineTo(x + 0.5, this.H); g.stroke();
        rg.fillStyle = col('--marker'); rg.beginPath(); rg.moveTo(x, RULER_H); rg.lineTo(x + 8, RULER_H - 10); rg.lineTo(x + 8, RULER_H); rg.fill();
        g.fillStyle = col('--marker'); g.fillText(m.name, x + 4, this.H - 6);
      }
      /* selection */
      if (d.hasSel()) {
        const xa = Math.max(0, this.s2x(d.sel.a)), xb = Math.min(this.W, this.s2x(d.sel.b));
        if (xb > xa) {
          g.fillStyle = col('--sel'); g.fillRect(xa, 0, xb - xa, this.H);
          rg.fillStyle = col('--sel-ruler'); rg.fillRect(xa, RULER_H - 5, xb - xa, 5);
        }
        g.strokeStyle = col('--sel-edge'); g.beginPath();
        for (const s of [d.sel.a, d.sel.b]) { const x = Math.round(this.s2x(s)) + 0.5; if (x >= 0 && x <= this.W) { g.moveTo(x, 0); g.lineTo(x, this.H); } }
        g.stroke();
      }
      /* scrollbar */
      const span = Math.max(0, d.len - this.visibleSamples());
      this.scroll.disabled = span <= 0; this.scroll.value = span > 0 ? Math.round((d.vs.start / span) * 1e6) : 0;
      return true;
    }
    drawWave(g, ch, y0, laneH, color) {
      const d = this.doc, pk = d.peaks(), vs = d.vs, yc = y0 + laneH / 2, amp = laneH / 2 - 3;
      g.strokeStyle = color; g.fillStyle = color;
      if (vs.spp < 1) {
        const x = d.ch[ch], i0 = Math.max(0, Math.floor(vs.start) - 1), i1 = Math.min(d.len - 1, Math.ceil(vs.start + this.W * vs.spp) + 1);
        g.beginPath();
        for (let i = i0; i <= i1; i++) { const px = (i - vs.start) / vs.spp, py = yc - x[i] * amp; if (i === i0) g.moveTo(px, py); else g.lineTo(px, py); }
        g.stroke();
        if (vs.spp < 0.125) for (let i = i0; i <= i1; i++) g.fillRect((i - vs.start) / vs.spp - 2, yc - x[i] * amp - 2, 4, 4);
        return;
      }
      g.beginPath();
      for (let x = 0; x < this.W; x++) {
        const s0 = vs.start + x * vs.spp;
        if (s0 >= d.len) break;
        const r = pk.range(ch, s0, s0 + vs.spp);
        if (!r) break;
        let top = yc - r[1] * amp, bot = yc - r[0] * amp;
        if (bot - top < 1) { top -= 0.5; bot += 0.5; }
        g.rect(x, top, 1, bot - top);
      }
      g.fill();
    }
    drawSpec(g, ch, y0, h) {
      const d = this.doc, vs = d.vs, W = this.W, Hh = Math.max(4, Math.floor(h)), st = SP.settings(), N = st.fft, key = [d.id, d.version, vs.start, vs.spp, W, Hh, ch, this.dpr, SP.sig()].join('|');
      if (!this.specCache) this.specCache = {};
      let ent = this.specCache[ch];
      if (!ent || ent.key !== key) {
        const half = N / 2, cols = Math.ceil(W / 2), img = new ImageData(cols, Hh), win = D.windowFn(st.win, N), re = new Float64Array(N), im = new Float64Array(N);
        let wsum = 0; for (let i = 0; i < N; i++) wsum += win[i]; // window gain: a full-scale sine reads 0 dB with any window
        const x = d.ch[ch], fmin = 30, fmax = d.sr / 2, bins = new Float32Array(Hh), lut = SP.lut(st.cmap);
        for (let y = 0; y < Hh; y++) bins[y] = (fmin * Math.pow(fmax / fmin, 1 - y / (Hh - 1))) * N / d.sr;
        for (let cx = 0; cx < cols; cx++) {
          const center = Math.round(vs.start + cx * 2 * vs.spp) - N / 2;
          for (let i = 0; i < N; i++) { const j = center + i; re[i] = (j >= 0 && j < d.len ? x[j] : 0) * win[i]; im[i] = 0; }
          D.fft(re, im, false);
          for (let y = 0; y < Hh; y++) {
            const b = Math.min(half - 1, bins[y]), b0 = b | 0, fr = b - b0;
            const m0 = Math.hypot(re[b0], im[b0]), m1 = Math.hypot(re[b0 + 1], im[b0 + 1]);
            const db = 20 * Math.log10(((m0 + (m1 - m0) * fr) * 2) / wsum + 1e-9);
            const li = Math.round(SP.level(db, st) * 255) * 3, o = (y * cols + cx) * 4;
            img.data[o] = lut[li]; img.data[o + 1] = lut[li + 1]; img.data[o + 2] = lut[li + 2]; img.data[o + 3] = 255;
          }
        }
        const oc = document.createElement('canvas'); oc.width = cols; oc.height = Hh; oc.getContext('2d').putImageData(img, 0, 0);
        ent = this.specCache[ch] = { key, canvas: oc };
      }
      g.imageSmoothingEnabled = true;
      g.drawImage(ent.canvas, 0, y0, W, h);
      g.fillStyle = 'rgba(255,255,255,0.65)'; g.font = '10px Segoe UI, sans-serif';
      for (const f of [100, 1000, 10000]) {
        if (f > d.sr / 2) continue;
        const y = y0 + h * (1 - Math.log(f / 30) / Math.log(d.sr / 2 / 30));
        g.fillRect(this.W - 30, y, 30, 1); g.fillText(f >= 1000 ? f / 1000 + 'k' : f, this.W - 28, y - 2);
      }
    }
    /* Spectral Pitch Display: YIN pitch of the visible part (one frame every 3 px), as a line over the spectrogram */
    pitchOf(ch) {
      const d = this.doc, vs = d.vs, key = [d.id, d.version, vs.start, vs.spp, this.W, ch].join('|');
      if (!this.pitchCache) this.pitchCache = {};
      const ent = this.pitchCache[ch]; if (ent && ent.key === key) return ent.pts;
      const hop = Math.max(Math.round(d.sr * 0.004), 4 * vs.spp), pts = [];
      const centers = []; for (let s = vs.start; s < Math.min(d.len, vs.start + this.W * vs.spp); s += hop) centers.push(Math.round(s));
      const r = D.yin(d.ch[ch], d.sr, centers, { fmin: 50, fmax: 2000 });
      centers.forEach((s, i) => pts.push([s, r.f[i]]));
      this.pitchCache[ch] = { key, pts }; return pts;
    }
    drawPitch(g, ch, y0) {
      const pts = this.pitchOf(ch), hop = pts.length > 1 ? pts[1][0] - pts[0][0] : 1;
      g.save(); g.strokeStyle = '#7CFFEA'; g.lineWidth = 2; g.shadowColor = 'rgba(0,0,0,0.8)'; g.shadowBlur = 2; g.beginPath();
      let pen = false, prev = null;
      for (const [s, f] of pts) {
        if (!f) { pen = false; prev = null; continue; }
        const x = this.s2x(s), y = this.f2y(f, ch);
        if (pen && prev && Math.abs(Math.log2(f / prev[1])) < 0.25 && s - prev[0] <= hop * 1.5) g.lineTo(x, y); else g.moveTo(x, y);
        pen = true; prev = [s, f];
      }
      g.stroke(); g.restore();
      // the pitch under the right edge of the visible part, as a label
      const last = [...pts].reverse().find((p) => p[1]); if (last) { g.fillStyle = '#7CFFEA'; g.font = '10px Segoe UI, sans-serif'; g.fillText('Pitch ' + Math.round(last[1]) + ' Hz', 6, y0 + 28); }
    }
  }
  AS.WaveView = WaveView;
  AS.fmtTime = fmtTime;
})(window);

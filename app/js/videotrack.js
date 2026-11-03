/* Multitrack video track: one video per session, shown as the top row of the multitrack (type 'video', no audio,
   no mixer strip). Thumbnails are grabbed from a hidden <video> element as the view needs them and cached.
   The Video panel follows the multitrack playhead. Exporting the mix back into the video uses ffmpeg in the
   desktop app (electron/video.js).
   track.video = { name, path (desktop: the file, for preview after reopening and for export), url, dur, start } */
(function (root) {
  'use strict';
  const AS = (root.AS = root.AS || {});
  const TW = 80, THH = 45; // thumbnail size (px)
  const fileUrl = (p) => 'file:///' + p.replace(/\\/g, '/').split('/').map(encodeURIComponent).join('/').replace(/^([A-Za-z])%3A/, '$1:');
  const find = (s) => (s.tracks || []).find((t) => t.type === 'video');
  /* make the session's video track (replacing an existing one), at the top */
  function setVideo(s, v) {
    let t = find(s);
    if (!t) { t = s.addTrack(v.name); t.type = 'video'; t.color = '#5a6472'; s.tracks.splice(s.tracks.indexOf(t), 1); s.tracks.unshift(t); }
    t.name = v.name; t.video = { name: v.name, path: v.path || '', url: v.url || (v.path ? fileUrl(v.path) : ''), dur: v.dur || 0, start: v.start || 0 };
    return t;
  }
  const urlOf = (t) => t && t.video && (t.video.url || (t.video.path ? fileUrl(t.video.path) : ''));

  /* ---- thumbnails ---- */
  const caches = new Map(); // url -> { el, map: Map(key -> canvas), queue: [], busy }
  function cacheFor(url) {
    let c = caches.get(url); if (c) return c;
    const el = document.createElement('video'); el.muted = true; el.preload = 'auto'; el.src = url; el.crossOrigin = 'anonymous';
    c = { el, map: new Map(), queue: [], busy: false, ready: new Promise((r) => { el.onloadeddata = () => r(true); el.onerror = () => r(false); }) };
    caches.set(url, c); return c;
  }
  /* the thumbnail for time t (rounded to `step`), or null while it is being made; onReady() when new ones arrive */
  function thumb(url, t, step, onReady) {
    const c = cacheFor(url), key = Math.round(t / step) * step, k = key.toFixed(3);
    if (c.map.has(k)) return c.map.get(k);
    if (!c.queue.some((q) => q.k === k)) { c.queue.push({ k, t: key, onReady }); pump(c); }
    return null;
  }
  async function pump(c) {
    if (c.busy) return; c.busy = true;
    try {
      if (!(await c.ready)) { c.queue = []; return; }
      while (c.queue.length) {
        const q = c.queue.shift(), el = c.el;
        await new Promise((r) => { const done = () => { el.removeEventListener('seeked', done); r(); }; el.addEventListener('seeked', done); el.currentTime = Math.min(Math.max(0, q.t), Math.max(0, (el.duration || 0) - 0.05)); setTimeout(done, 1500); });
        const cv = document.createElement('canvas'); cv.width = TW; cv.height = THH;
        try { cv.getContext('2d').drawImage(c.el, 0, 0, TW, THH); } catch (e) { /* not decodable */ }
        c.map.set(q.k, cv); if (q.onReady) q.onReady();
      }
    } finally { c.busy = false; }
  }
  /* draw the video lane (thumbnails across the video's span) */
  function drawLane(g, view, t, y0, h) {
    const v = t.video, url = urlOf(t);
    g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(0, y0, view.W, h);
    if (!v || !url) { g.fillStyle = '#aab'; g.font = '11px Segoe UI, sans-serif'; g.fillText('Video file not available — Multitrack > Insert Video… to link it again', 8, y0 + h / 2); return; }
    const x0 = view.t2x(v.start), x1 = view.t2x(v.start + (v.dur || 0)), th = h - 18, tw = Math.round(th * 16 / 9);
    g.fillStyle = '#5a647244'; g.fillRect(x0, y0 + 3, x1 - x0, h - 6);
    const step = Math.max(0.04, tw / view.pps); // one thumbnail per tw px of timeline
    for (let x = Math.max(x0, Math.floor((0 - x0) / tw) * tw + x0); x < Math.min(x1, view.W); x += tw) {
      const tt = (x - x0) / view.pps, im = thumb(url, tt, step, view.redraw);
      if (im) g.drawImage(im, x, y0 + 14, Math.min(tw, x1 - x), th); else { g.fillStyle = '#2a2f36'; g.fillRect(x + 1, y0 + 14, tw - 2, th); }
    }
    g.fillStyle = '#dfe3e8'; g.font = '10px Segoe UI, sans-serif'; g.fillText('🎞 ' + v.name, Math.max(0, x0) + 4, y0 + 11);
  }
  AS.vtrack = { find, setVideo, urlOf, fileUrl, thumb, drawLane, caches };
})(window);

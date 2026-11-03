/* Recording maths (pure — no Web Audio, unit-tested in Node): turning a recorder capture into timeline audio
   (latency compensation, punch-in / punch-out, loop passes → takes), comping takes, and measuring the round-trip
   latency from a loopback recording.

   Timing model: the recorder knows the AudioContext time of its first sample (startTime), so capture sample i was
   heard by the graph at ctx time startTime + i/sr. Sound played at ctx time T reaches the speakers, goes through
   the air / cable and arrives back in the graph `lat` seconds later (round-trip latency). So the take audio for
   ctx time T is capture[(T + lat - startTime) * sr]. */
(function (root) {
  'use strict';
  const AS = (root.AS = root.AS || {});

  /* the part of a capture that belongs to ctx times [c0, c1) (c1 = Infinity: to the end), latency compensated */
  function window_(ch, sr, startTime, c0, c1, lat) {
    const len = ch[0].length, i0 = Math.max(0, Math.round((c0 + (lat || 0) - startTime) * sr));
    const i1 = c1 === Infinity ? len : Math.min(len, Math.round((c1 + (lat || 0) - startTime) * sr));
    const n = Math.max(0, i1 - i0), want = c1 === Infinity ? n : Math.round((c1 - c0) * sr);
    return ch.map((c) => { const o = new Float32Array(c1 === Infinity ? n : want); o.set(c.subarray(i0, i0 + Math.min(n, o.length))); return o; }); // padded with silence if the capture ended early
  }
  /* map: transport ctx time t0 plays timeline position `from`. Returns the audio for timeline [a, b) */
  const timelineRange = (ch, sr, startTime, map, a, b, lat) => window_(ch, sr, startTime, map.t0 + (a - map.from), b === Infinity ? Infinity : map.t0 + (b - map.from), lat);
  /* loop recording: pass k plays timeline [a, a+L) at ctx time t0 + k*L. Returns one take per pass that was
     recorded for at least `minFrac` of the loop (a short last pass is dropped) */
  function passes(ch, sr, startTime, t0, L, lat, minFrac) {
    const out = [], total = ch[0].length / sr, mf = minFrac == null ? 0.5 : minFrac;
    for (let k = 0; ; k++) {
      const c0 = t0 + k * L, avail = startTime + total - (c0 + (lat || 0));
      if (avail < L * mf || avail <= 0) break;
      out.push(window_(ch, sr, startTime, c0, c0 + L, lat));
      if (k > 999) break;
    }
    return out;
  }

  /* ---------- comping ----------
     A comped clip keeps all its takes (same length and timeline alignment) and a comp list
     [{ from, to, take }] in take time that covers [0, len] without gaps. */
  function normComp(comp, len, nTakes) {
    const c = (comp || []).map((s) => ({ from: Math.max(0, Math.min(len, s.from)), to: Math.max(0, Math.min(len, s.to)), take: Math.max(0, Math.min(nTakes - 1, s.take | 0)) })).filter((s) => s.to - s.from > 1e-9).sort((a, b) => a.from - b.from);
    const out = [];
    for (const s of c) {
      const last = out[out.length - 1];
      if (last && s.from < last.to) s.from = last.to; // earlier entries win on overlap (assign() puts the new range first)
      if (s.to - s.from <= 1e-9) continue;
      if (last && last.take === s.take && Math.abs(last.to - s.from) < 1e-9) last.to = s.to; else out.push({ ...s });
    }
    // fill gaps with the neighbouring take (or the last take)
    const full = []; let pos = 0;
    for (const s of out) { if (s.from > pos + 1e-9) full.push({ from: pos, to: s.from, take: s.take }); full.push(s); pos = s.to; }
    if (pos < len - 1e-9) full.push({ from: pos, to: len, take: full.length ? full[full.length - 1].take : Math.max(0, nTakes - 1) });
    const merged = []; for (const s of full) { const l = merged[merged.length - 1]; if (l && l.take === s.take && Math.abs(l.to - s.from) < 1e-9) l.to = s.to; else merged.push({ ...s }); }
    return merged;
  }
  /* swipe: take `take` plays in [from, to) */
  function assign(comp, from, to, take, len, nTakes) {
    if (to < from) [from, to] = [to, from];
    const rest = [];
    for (const s of comp) { if (s.to <= from || s.from >= to) rest.push(s); else { if (s.from < from) rest.push({ ...s, to: from }); if (s.to > to) rest.push({ ...s, from: to }); } }
    return normComp([{ from, to, take }, ...rest], len, nTakes);
  }
  /* render the comp into plain audio: each segment from its take, with an equal-power crossfade of `xf` seconds
     centred on every seam between two different takes */
  function flatten(takes, comp, sr, xf) {
    const nch = Math.max(...takes.map((t) => t.length)), len = Math.max(...takes.map((t) => t[0].length)), X = Math.max(0, Math.round((xf == null ? 0.01 : xf) * sr));
    const out = Array.from({ length: nch }, () => new Float32Array(len));
    const segs = normComp(comp, len / sr, takes.length).map((s) => ({ a: Math.round(s.from * sr), b: Math.round(s.to * sr), take: s.take }));
    segs.forEach((s, k) => {
      const prev = segs[k - 1], next = segs[k + 1], h = X >> 1;
      const fadeIn = prev && prev.take !== s.take ? X : 0, fadeOut = next && next.take !== s.take ? X : 0;
      const a = Math.max(0, s.a - (fadeIn ? h : 0)), b = Math.min(len, s.b + (fadeOut ? X - h : 0)), tk = takes[s.take];
      for (let c = 0; c < nch; c++) {
        const src = tk[Math.min(c, tk.length - 1)], dst = out[c];
        for (let i = a; i < b; i++) {
          let g = 1;
          if (fadeIn && i < a + fadeIn) g *= Math.sin((Math.PI / 2) * ((i - a + 0.5) / fadeIn));
          if (fadeOut && i >= b - fadeOut) g *= Math.cos((Math.PI / 2) * ((i - (b - fadeOut) + 0.5) / fadeOut));
          dst[i] += (src[i] || 0) * g;
        }
      }
    });
    return out;
  }

  /* ---------- latency measurement ----------
     x: loopback capture, startTime: ctx time of x[0], clicks: ctx times the test clicks were played.
     Each click's echo is the first onset after the click; the median delay is the round-trip latency. */
  function measureLatency(x, sr, startTime, clicks, maxLat) {
    const mx = maxLat || 0.5, d = [];
    let floor = 0; for (let i = 0; i < Math.min(x.length, sr * 0.1); i++) floor = Math.max(floor, Math.abs(x[i]));
    let pk = 0; for (let i = 0; i < x.length; i++) pk = Math.max(pk, Math.abs(x[i]));
    const thr = Math.max(floor * 3, pk * 0.3);
    if (pk < 1e-4) return { latency: null, found: 0, error: 'No signal came back. Connect the output to the input (loopback cable, or hold the microphone to the speaker).' };
    for (const c of clicks) {
      const i0 = Math.max(0, Math.round((c - startTime) * sr)), i1 = Math.min(x.length, i0 + Math.round(mx * sr));
      for (let i = i0; i < i1; i++) if (Math.abs(x[i]) >= thr) { d.push((i - i0) / sr + (i0 / sr - (c - startTime))); break; }
    }
    if (d.length < Math.max(2, Math.ceil(clicks.length / 2))) return { latency: null, found: d.length, error: 'The test clicks were not heard clearly enough. Raise the level or reduce background noise and try again.' };
    d.sort((a, b) => a - b); const med = d[d.length >> 1], spread = d[d.length - 1] - d[0];
    return { latency: med, found: d.length, spread, error: spread > 0.005 ? 'Measurements disagree by more than 5 ms; the result may be unreliable.' : null };
  }

  AS.rec = { window: window_, timelineRange, passes, normComp, assign, flatten, measureLatency };
})(typeof window !== 'undefined' ? window : globalThis);

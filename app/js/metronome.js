/* Metronome: oscillator clicks on the tempo grid while the transport runs (monitoring only — never in a mixdown).
   A lookahead scheduler (every 25 ms, 150 ms ahead) creates the clicks just in time, so an hour-long session does
   not create thousands of nodes up front. Count-in clicks before the transport start use the same grid. */
(function (root) {
  'use strict';
  const AS = (root.AS = root.AS || {});
  const SOUNDS = [['beep', 'Beep'], ['click', 'Click'], ['wood', 'Woodblock'], ['cowbell', 'Cowbell']];
  const KEY = 'as-metronome';
  const DEFAULTS = () => ({ on: false, sound: 'beep', db: -6, countIn: 0, recOnly: false });
  function load() { try { return { ...DEFAULTS(), ...(JSON.parse(localStorage.getItem(KEY)) || {}) }; } catch (e) { return DEFAULTS(); } }
  const settings = load();
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(settings)); } catch (e) { /* */ } };

  /* one click at ctx time `when` */
  function click(ctx, dest, when, accent, sound, gainLin) {
    const g = ctx.createGain(), peak = gainLin * (accent ? 1 : 0.7);
    const env = (dur) => { g.gain.setValueAtTime(0, when); g.gain.linearRampToValueAtTime(peak, when + 0.001); g.gain.exponentialRampToValueAtTime(0.0005, when + dur); return when + dur + 0.01; };
    const osc = (type, f) => { const o = ctx.createOscillator(); o.type = type; o.frequency.value = f; return o; };
    let srcs, end, node = g;
    if (sound === 'click') { srcs = [osc('square', accent ? 3000 : 2000)]; end = env(0.015); }
    else if (sound === 'wood') { const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = accent ? 1400 : 1000; bp.Q.value = 8; srcs = [osc('triangle', accent ? 1400 : 1000)]; srcs[0].connect(bp); bp.connect(g); node = null; end = env(0.04); }
    else if (sound === 'cowbell') { const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 800; bp.Q.value = 3; srcs = [osc('square', accent ? 587 : 540), osc('square', accent ? 845 : 800)]; srcs.forEach((s) => s.connect(bp)); bp.connect(g); node = null; end = env(0.12); }
    else { srcs = [osc('sine', accent ? 1500 : 1000)]; end = env(0.05); }
    if (node) srcs.forEach((s) => s.connect(node));
    g.connect(dest);
    for (const s of srcs) { s.start(when); s.stop(end); }
    srcs[0].onended = () => { try { g.disconnect(); } catch (e) { /* */ } };
  }

  /* start clicking. map: { t0 (ctx time of timeline `from`), from (s), loopLen (s, 0 = none), loopStart } ;
     countIn: bars of clicks before t0. Returns { stop() }. */
  function start(ctx, dest, tempo, map, o) {
    const t = AS.tempo.norm(tempo), opt = { ...settings, ...(o || {}) }, gainLin = Math.pow(10, opt.db / 20);
    let next = ctx.currentTime, alive = true; // ctx time scheduled up to
    const tl = (ct) => { const el = ct - map.t0; if (map.loopLen && el > 0) return (map.loopStart != null ? map.loopStart : map.from) + ((map.from - (map.loopStart != null ? map.loopStart : map.from) + el) % map.loopLen); return map.from + el; };
    // count-in: the bars before the start position, mapped to the time before t0
    if (opt.countIn > 0) for (const c of AS.tempo.clicks(map.from - opt.countIn * AS.tempo.barLen(t), map.from, t)) { const when = map.t0 + (c.time - map.from); if (when >= ctx.currentTime) click(ctx, dest, when, c.accent, opt.sound, gainLin); }
    next = Math.max(next, map.t0);
    const tick = () => {
      if (!alive) return;
      const until = ctx.currentTime + 0.15;
      // walk [next, until) in ctx time, splitting where the loop wraps
      let a = next;
      while (a < until - 1e-9) {
        const la = tl(a); let b = until;
        if (map.loopLen) { const ls = map.loopStart != null ? map.loopStart : map.from, toWrap = ls + map.loopLen - la; if (toWrap > 0 && a + toWrap < b) b = a + toWrap; }
        for (const c of AS.tempo.clicks(la, la + (b - a), t)) click(ctx, dest, a + (c.time - la), c.accent, opt.sound, gainLin);
        a = b;
      }
      next = until;
    };
    tick(); const id = setInterval(tick, 25);
    return { stop() { alive = false; clearInterval(id); } };
  }

  AS.metronome = { SOUNDS, settings, save, start, click };
})(window);

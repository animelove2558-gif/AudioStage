/* Tempo map (constant tempo): BPM, time signature and offset → bars:beats, grid lines and snapping.
   Pure functions (no DOM / Web Audio) so the tests run them in Node.
   tempo = { bpm: 120, num: 4, den: 4, offset: 0 }   offset = time (s) of bar 1, beat 1 */
(function (root) {
  'use strict';
  const AS = (root.AS = root.AS || {});
  const TICKS = 960; // ticks per beat (bar | beat | tick display)
  const DEFAULT = () => ({ bpm: 120, num: 4, den: 4, offset: 0 });
  const norm = (t) => {
    const o = { ...DEFAULT(), ...(t || {}) };
    o.bpm = Math.min(999, Math.max(10, +o.bpm || 120)); o.num = Math.min(32, Math.max(1, Math.round(+o.num || 4)));
    o.den = [1, 2, 4, 8, 16, 32].includes(+o.den) ? +o.den : 4; o.offset = +o.offset || 0;
    return o;
  };
  /* one beat = one `den` note; the BPM counts those notes (6/8 at 120 = 120 eighth notes per minute) */
  const beatLen = (t) => 60 / t.bpm;
  const barLen = (t) => beatLen(t) * t.num;
  const wholeLen = (t) => beatLen(t) * t.den; // a whole note
  /* grid divisions offered for snapping */
  const DIVS = [['bar', 'Bar'], ['beat', 'Beat'], ['1/8', '1/8 note'], ['1/16', '1/16 note']];
  function divLen(t, div) {
    if (div === 'bar') return barLen(t);
    if (div === 'beat') return beatLen(t);
    const m = /^1\/(\d+)$/.exec(div || ''); return m ? wholeLen(t) / +m[1] : beatLen(t);
  }
  /* seconds → { bar (1-based), beat (1-based), tick } (negative times before bar 1 count backwards from bar 0) */
  function toBBT(sec, t) {
    const b = (sec - t.offset) / beatLen(t), whole = Math.floor(b + 1e-9);
    const bar = Math.floor(whole / t.num), beat = whole - bar * t.num, tick = Math.min(TICKS - 1, Math.round((b - whole) * TICKS));
    return { bar: bar + 1, beat: beat + 1, tick };
  }
  const fromBBT = (bar, beat, tick, t) => t.offset + ((bar - 1) * t.num + (beat - 1) + (tick || 0) / TICKS) * beatLen(t);
  const fmt = (sec, t) => { const x = toBBT(sec, t); return `${x.bar} | ${x.beat} | ${String(x.tick).padStart(3, '0')}`; };
  /* nearest grid point of the division */
  function snap(sec, t, div) { const L = divLen(t, div); return t.offset + Math.round((sec - t.offset) / L) * L; }
  /* ruler / grid lines between t0 and t1 seconds for a zoom of pps pixels per second.
     Returns [{ time, level: 'bar' | 'beat' | 'sub', label }] with the finest level whose lines stay >= minPx apart. */
  function gridLines(t0, t1, t, pps, minPx) {
    minPx = minPx || 6;
    const bl = beatLen(t), barL = barLen(t), out = [];
    let sub = 0; // subdivisions per beat to show (0 = none)
    for (const n of [4, 2]) if (bl / n * pps >= 16) { sub = n; break; } // subdivisions need >= 16 px
    const showBeats = bl * pps >= minPx, step = sub ? bl / sub : showBeats ? bl : barL;
    let barEvery = 1; while (barL * barEvery * pps < 40) barEvery *= 2; // bar labels need ~40 px
    const i0 = Math.floor((t0 - t.offset) / step) - 1, i1 = Math.ceil((t1 - t.offset) / step) + 1;
    if (i1 - i0 > 20000) return out; // absurd zoom: nothing
    for (let i = i0; i <= i1; i++) {
      const time = t.offset + i * step, bpos = (time - t.offset) / bl, isBeat = Math.abs(bpos - Math.round(bpos)) < 1e-6;
      const beatIdx = Math.round(bpos), isBar = isBeat && ((beatIdx % t.num) + t.num) % t.num === 0;
      const level = isBar ? 'bar' : isBeat ? 'beat' : 'sub';
      if (level === 'beat' && !showBeats) continue;
      let label = '';
      if (isBar) { const bar = Math.round(beatIdx / t.num) + 1; if (((bar - 1) % barEvery + barEvery) % barEvery === 0) label = String(bar); }
      else if (isBeat && bl * pps >= 28) { const x = toBBT(time, t); label = x.bar + '.' + x.beat; }
      out.push({ time, level, label });
    }
    return out;
  }
  /* metronome clicks in [from, to): { time, accent } (accent = first beat of a bar) */
  function clicks(from, to, t) {
    const bl = beatLen(t), out = []; let i = Math.ceil((from - t.offset) / bl - 1e-9);
    for (let time = t.offset + i * bl; time < to - 1e-9; i++, time = t.offset + i * bl) out.push({ time, accent: ((i % t.num) + t.num) % t.num === 0 });
    return out;
  }
  AS.tempo = { TICKS, DEFAULT, norm, beatLen, barLen, wholeLen, DIVS, divLen, toBBT, fromBBT, fmt, snap, gridLines, clicks };
})(typeof window !== 'undefined' ? window : globalThis);

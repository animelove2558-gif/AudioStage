/* Job runner: runs DSP / encoding in a Web Worker, falling back to the main thread if workers are unavailable. */
(function (root) {
  'use strict';
  const AS = (root.AS = root.AS || {});
  let worker = null, broken = false, seq = 1, healthy = false;
  const pending = new Map();

  function failAll(err) { for (const p of pending.values()) p.rej(err); pending.clear(); }
  function ensure() {
    if (worker || broken) return;
    try {
      worker = new Worker('js/worker.js');
      worker.onmessage = (e) => {
        healthy = true;
        const p = pending.get(e.data.id); if (!p) return; pending.delete(e.data.id);
        e.data.ok ? p.res(e.data.out) : p.rej(new Error(e.data.error));
      };
      worker.onerror = () => {
        if (healthy) return;
        // worker failed to start (e.g. file:// restrictions): rerun everything on the main thread
        broken = true; try { worker.terminate(); } catch (e) { /* */ } worker = null;
        const jobs = [...pending.values()]; pending.clear();
        for (const p of jobs) syncRun(p.msg).then(p.res, p.rej);
      };
    } catch (e) { broken = true; worker = null; }
  }
  function loadScript(src) { return new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error('Cannot load ' + src)); document.head.appendChild(s); }); }

  async function syncRun(m) {
    await new Promise((r) => setTimeout(r, 20));
    if (m.kind === 'fx') return AS.effects.byId(m.fxId).process(m.ch, m.sr, m.params, { noiseProfile: m.noiseProfile });
    if (m.kind === 'gen') return AS.effects.byId(m.fxId).gen(m.sr, m.nch, m.params);
    if (m.kind === 'spectral') return AS.dsp.spectralEdit(m.ch, m.sr, m.opts);
    if (m.kind === 'stretch') return AS.dsp.clipStretch(m.ch, m.sr, m.opts.stretch, m.opts.semis, m.opts.mode);
    if (m.kind === 'encode') {
      const o = m.opts;
      if (o.format === 'mp3') { if (typeof lamejs === 'undefined') await loadScript('vendor/lame.min.js'); return AS.codec.encodeMp3(m.ch, m.sr, o.kbps, AS.dsp.convertRate); }
      if (o.format === 'flac') return AS.codec.encodeFlac(m.ch, m.sr, o.bits === 24 ? 24 : 16);
      if (o.format === 'aiff') return AS.aiff.encodeAiff(m.ch, m.sr, o.bits, o.dither);
      return AS.wav.encodeWav(m.ch, m.sr, o.bits, o.dither, o);
    }
    throw new Error('unknown job');
  }

  /* returns a promise with a .cancel() method. Channel arrays in msg.ch are transferred (pass copies). */
  function run(msg) {
    ensure();
    const id = seq++;
    msg.id = id;
    let handle;
    const p = new Promise((res, rej) => {
      if (!worker) { syncRun(msg).then(res, rej); return; }
      pending.set(id, { res, rej, msg });
      // transfer only once the worker is known to work, so a failed start can still fall back with intact data
      const tr = healthy && msg.ch ? msg.ch.map((c) => c.buffer) : [];
      try { worker.postMessage(msg, tr); } catch (e) { pending.delete(id); syncRun(msg).then(res, rej); }
    });
    p.cancel = () => { if (worker) { worker.terminate(); worker = null; healthy = false; failAll(new Error('Cancelled')); } };
    return p;
  }

  AS.jobs = {
    run,
    fx: (fxId, ch, sr, params, noiseProfile) => run({ kind: 'fx', fxId, ch, sr, params, noiseProfile }),
    gen: (fxId, sr, nch, params) => run({ kind: 'gen', fxId, sr, nch, params }),
    spectral: (ch, sr, opts) => run({ kind: 'spectral', ch, sr, opts }),
    stretch: (ch, sr, opts) => run({ kind: 'stretch', ch, sr, opts }),
    encode: (ch, sr, opts) => run({ kind: 'encode', ch, sr, opts }),
  };
})(window);


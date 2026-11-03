/* Background worker: effects, generators, spectral edits and file encoding. */
importScripts('dsp.js', 'wav.js', 'effects.js', 'flac.js');
const AS = self.AS;
let lameLoaded = false;

self.onmessage = (e) => {
  const m = e.data;
  try {
    let out, transfer = [];
    if (m.kind === 'fx') {
      const fx = AS.effects.byId(m.fxId);
      out = fx.process(m.ch, m.sr, m.params, { noiseProfile: m.noiseProfile });
      transfer = out.map((c) => c.buffer);
    } else if (m.kind === 'gen') {
      out = AS.effects.byId(m.fxId).gen(m.sr, m.nch, m.params);
      transfer = out.map((c) => c.buffer);
    } else if (m.kind === 'stretch') { // multitrack clip time-stretch / pitch cache
      out = AS.dsp.clipStretch(m.ch, m.sr, m.opts.stretch, m.opts.semis, m.opts.mode);
      transfer = out.map((c) => c.buffer);
    } else if (m.kind === 'spectral') {
      out = AS.dsp.spectralEdit(m.ch, m.sr, m.opts);
      transfer = out.map((c) => c.buffer);
    } else if (m.kind === 'encode') {
      const o = m.opts;
      if (o.format === 'mp3') {
        if (!lameLoaded) { importScripts('../vendor/lame.min.js'); lameLoaded = true; }
        out = AS.codec.encodeMp3(m.ch, m.sr, o.kbps, AS.dsp.convertRate);
      } else if (o.format === 'flac') out = AS.codec.encodeFlac(m.ch, m.sr, o.bits === 24 ? 24 : 16);
      else out = AS.wav.encodeWav(m.ch, m.sr, o.bits, o.dither, o);
      transfer = [out];
    }
    self.postMessage({ id: m.id, ok: true, out }, transfer);
  } catch (err) {
    self.postMessage({ id: m.id, ok: false, error: err.message || String(err) });
  }
};


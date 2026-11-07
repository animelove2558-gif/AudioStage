/* Decoding compressed audio without a live AudioContext and without changing the sample rate. The rate comes from the
   file's header; an OfflineAudioContext at that rate decodes it (decodeAudioData resamples to its context's rate, so the
   same rate means no resampling, and no output device is needed). Also: a size estimate, so a file that cannot fit in
   memory once decoded is refused with a clear message instead of ending the window. */
(function (root) {
  'use strict';
  const AS = (root.AS = root.AS || {});
  const GB = 1024 * 1024 * 1024;
  const u32be = (b, o) => b[o] * 16777216 + (b[o + 1] << 16) + (b[o + 2] << 8) + b[o + 3];
  const u32le = (b, o) => b[o + 3] * 16777216 + (b[o + 2] << 16) + (b[o + 1] << 8) + b[o];
  const at = (b, o, s) => { if (o + s.length > b.length) return false; for (let i = 0; i < s.length; i++) if (b[o + i] !== s.charCodeAt(i)) return false; return true; };
  const MP3_RATES = [44100, 48000, 32000], ADTS_RATES = [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350];
  const KBPS_V1 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320], KBPS_V2 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];
  /* size of an ID3v2 tag at the start (MP3, sometimes FLAC / AAC) */
  const id3Skip = (b) => (at(b, 0, 'ID3') && b.length > 10 ? 10 + ((b[6] & 127) << 21) + ((b[7] & 127) << 14) + ((b[8] & 127) << 7) + (b[9] & 127) : 0);
  function indexOfTag(b, tag, from) {
    const c0 = tag.charCodeAt(0), n = b.length - tag.length;
    for (let i = from || 0; i <= n; i++) { if (b[i] === c0 && at(b, i, tag)) return i; }
    return -1;
  }
  /* bytes (Uint8Array) -> { rate, channels?, frames?, seconds? } as far as the header says; {} when unknown */
  function probe(b) {
    if (at(b, 0, 'RIFF') && at(b, 8, 'WAVE')) { const f = indexOfTag(b.subarray(0, Math.min(b.length, 65536)), 'fmt '); return f > 0 && f + 16 <= b.length ? { rate: u32le(b, f + 12), channels: b[f + 10] | (b[f + 11] << 8) } : {}; }
    if (at(b, 0, 'OggS')) {
      const p = 27 + b[26];
      if (at(b, p, 'OpusHead')) return { rate: 48000, channels: b[p + 9] }; // Opus always decodes at 48 kHz
      if (b[p] === 1 && at(b, p + 1, 'vorbis')) return { rate: u32le(b, p + 12), channels: b[p + 11] };
      return {};
    }
    if (at(b, 4, 'ftyp')) { // MP4 / M4A / MOV: AudioSampleEntry of the AAC track (the moov box may be at the end)
      const m = indexOfTag(b, 'mp4a', 8); if (m < 0) return {};
      const rate = (b[m + 28] << 8) | b[m + 29];
      return rate ? { rate: rate <= 24000 ? rate * 2 : rate, channels: (b[m + 20] << 8) | b[m + 21] } : {}; // (HE-AAC: the entry holds the core rate, half of what the decoder gives)
    }
    const s = id3Skip(b);
    if (at(b, s, 'fLaC')) {
      const o = s + 18; if (o + 8 > b.length) return {};
      const rate = (b[o] << 12) | (b[o + 1] << 4) | (b[o + 2] >> 4), channels = ((b[o + 2] >> 1) & 7) + 1, frames = (b[o + 3] & 15) * 4294967296 + u32be(b, o + 4);
      return { rate, channels, frames: frames || undefined };
    }
    for (let i = s, end = Math.min(b.length - 4, s + 65536); i < end; i++) { // MP3 / ADTS: the first valid frame header
      if (b[i] !== 0xff || (b[i + 1] & 0xe0) !== 0xe0) continue;
      const layer = (b[i + 1] >> 1) & 3, ver = (b[i + 1] >> 3) & 3;
      if (layer === 0 && (b[i + 1] & 0xf6) === 0xf0) { const r = ADTS_RATES[(b[i + 2] >> 2) & 15]; if (r) return { rate: r }; continue; }
      if (ver === 1 || layer === 0) continue;
      const bi = b[i + 2] >> 4, ri = (b[i + 2] >> 2) & 3; if (bi === 15 || ri === 3) continue;
      const rate = MP3_RATES[ri] / (ver === 3 ? 1 : ver === 2 ? 2 : 4), kbps = (ver === 3 ? KBPS_V1 : KBPS_V2)[bi];
      return { rate, channels: b[i + 3] >> 6 === 3 ? 1 : 2, seconds: kbps ? ((b.length - s) * 8) / (kbps * 1000) : undefined };
    }
    return {};
  }
  /* bytes of Float32 audio the decoded file needs (assumed: stereo, 96 kbps when the header says nothing) */
  function estimateBytes(info, size) {
    const ch = info.channels || 2, rate = info.rate || 48000;
    const seconds = info.frames ? info.frames / rate : info.seconds || (size * 8) / 96000;
    return seconds * rate * ch * 4;
  }
  /* half of the memory the browser reports (Chromium caps it at 8 GB), so about 3 hours of stereo 48 kHz here */
  const limitBytes = () => ((root.navigator && root.navigator.deviceMemory) || 4) * 0.5 * GB;
  /* buf: ArrayBuffer (emptied by this call) -> { sr, ch: Float32Array[] }. The channels are the AudioBuffer's own arrays: no second copy. */
  async function audio(buf, o) {
    const info = probe(new Uint8Array(buf)), need = estimateBytes(info, buf.byteLength), limit = (o && o.limit) || limitBytes();
    if (need > limit) throw new Error(`it would need about ${(need / GB).toFixed(1)} GB of memory once decoded (limit ${(limit / GB).toFixed(1)} GB here). Split it into shorter files first.`);
    const rate = info.rate >= 3000 && info.rate <= 768000 ? info.rate : 48000;
    const ab = await new OfflineAudioContext(1, 1, rate).decodeAudioData(buf);
    return { sr: ab.sampleRate, ch: Array.from({ length: ab.numberOfChannels }, (_, i) => ab.getChannelData(i)) };
  }
  AS.decode = { probe, estimateBytes, limitBytes, audio };
})(typeof window !== 'undefined' ? window : globalThis);

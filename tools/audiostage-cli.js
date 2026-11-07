#!/usr/bin/env node
/* AudioStage command line: batch convert / normalise audio files with the same DSP and encoders as the app, no window.
     node tools/audiostage-cli.js convert   <in> <out> [--bits 16|24|32] [--dither]
     node tools/audiostage-cli.js normalize <in> <out> [--peak -1] [--bits 24]
     node tools/audiostage-cli.js batch <inputFolder> <outputFolder> [--format wav|aiff|flac] [--normalize -1] [--bits 24]
   Reads WAV and AIFF, writes WAV, AIFF or FLAC (the format follows the output extension for convert / normalize).
   MP3 / M4A decoding needs the app (system decoder). Exit codes: 0 = done, 1 = a file failed, 2 = wrong usage.
   Add --json for a machine-readable result on stdout. */
const fs = require('fs'), path = require('path');
globalThis.AS = {};
const A = path.join(__dirname, '..', 'app', 'js');
for (const f of ['dsp.js', 'wav.js', 'aiff.js', 'flac.js']) require(path.join(A, f));
const { dsp, wav, aiff, codec } = globalThis.AS;

function parse(argv) {
  const pos = [], opt = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) { const k = a.slice(2); if (['dither', 'json', 'help'].includes(k)) opt[k] = true; else opt[k] = argv[++i]; } else pos.push(a);
  }
  return { pos, opt };
}
const ext = (p) => path.extname(p).toLowerCase().slice(1);
function readAudio(file) {
  const b = fs.readFileSync(file), ab = b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), e = ext(file);
  if (e === 'wav' || e === 'wave') { const r = wav.decodeWav(ab); return { sr: r.sr, ch: r.ch }; }
  if (e === 'aif' || e === 'aiff') { const r = aiff.decodeAiff(ab); return { sr: r.sr, ch: r.ch }; }
  throw new Error('cannot read .' + (e || '?') + ' files here (WAV and AIFF only)');
}
function encode(a, format, bits, dither) {
  if (format === 'aiff') return Buffer.from(aiff.encodeAiff(a.ch, a.sr, bits, dither));
  if (format === 'flac') return Buffer.from(codec.encodeFlac(a.ch, a.sr, bits === 24 ? 24 : 16));
  if (format === 'wav') return Buffer.from(wav.encodeWav(a.ch, a.sr, bits, dither, null));
  throw new Error('unknown output format: ' + format);
}
function processFile(inFile, outFile, o) {
  const a = readAudio(inFile), fmt = o.format || { wave: 'wav', aif: 'aiff' }[ext(outFile)] || ext(outFile);
  if (o.peak != null) {
    if (!Number.isFinite(o.peak) || o.peak > 0) throw new Error('--peak / --normalize must be a level in dB at or below 0');
    a.ch = dsp.normalize(a.ch, o.peak, false, false);
  }
  const buf = encode(a, fmt, o.bits, o.dither);
  fs.mkdirSync(path.dirname(path.resolve(outFile)), { recursive: true });
  require('../electron/savefile').writeFileAtomic(outFile, buf);
  return { input: inFile, output: outFile, sampleRate: a.sr, channels: a.ch.length, frames: a.ch[0].length, bytes: buf.length };
}
function main(argv) {
  const { pos, opt } = parse(argv), cmd = pos[0], out = [], fail = [];
  const bits = opt.bits == null ? 24 : +opt.bits;
  const usage = (m) => {
    console.error((m ? m + '\n' : '') + fs.readFileSync(__filename, 'utf8').split('\n').slice(1, 8).map((l) => l.replace(/^[/ *]+/, '')).join('\n'));
    return 2;
  };
  if (!cmd || opt.help || !['convert', 'normalize', 'batch'].includes(cmd)) return usage();
  if (![16, 24, 32].includes(bits)) return usage('--bits must be 16, 24 or 32');
  const peakOpt = cmd === 'normalize' ? (opt.peak == null ? -1 : +opt.peak) : cmd === 'batch' && opt.normalize != null ? +opt.normalize : null;
  const base = { bits, dither: !!opt.dither, peak: peakOpt };
  if (cmd === 'batch') {
    if (pos.length !== 3) return usage('batch needs an input folder and an output folder');
    const format = opt.format || 'wav';
    if (!['wav', 'aiff', 'flac'].includes(format)) return usage('--format must be wav, aiff or flac');
    let names;
    try { names = fs.readdirSync(pos[1]).filter((n) => /\.(wav|wave|aif|aiff)$/i.test(n)).sort(); } catch (e) { return usage('cannot read folder: ' + e.message); }
    for (const n of names) {
      const o = path.join(pos[2], n.replace(/\.\w+$/, '') + '.' + format);
      try { out.push(processFile(path.join(pos[1], n), o, { ...base, format })); } catch (e) { fail.push({ input: path.join(pos[1], n), error: e.message }); }
    }
  } else {
    if (pos.length !== 3) return usage(cmd + ' needs an input file and an output file');
    try { out.push(processFile(pos[1], pos[2], base)); } catch (e) { fail.push({ input: pos[1], error: e.message }); }
  }
  if (opt.json) console.log(JSON.stringify({ ok: !fail.length, done: out, failed: fail }, null, 1));
  else {
    for (const r of out) console.log(`ok    ${r.input} -> ${r.output} (${r.channels} ch, ${r.sampleRate} Hz, ${r.frames} frames)`);
    for (const f of fail) console.error(`FAIL  ${f.input}: ${f.error}`);
  }
  return fail.length ? 1 : 0;
}
if (require.main === module) process.exitCode = main(process.argv.slice(2));
module.exports = { main, processFile, readAudio };

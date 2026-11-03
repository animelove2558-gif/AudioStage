// Video helpers for the desktop app: find ffmpeg (not bundled: installed by the user, or by Install ffmpeg… into userData), probe a
// video, and put a new soundtrack into a video ("Export audio back into video"). Plain Node: tested in tests/video.test.js.
const { spawn, spawnSync } = require('child_process');
const fs = require('fs'), path = require('path');

/* AUDIOSTAGE_FFMPEG, then the copy the app installed (o.local: <userData>/ffmpeg/…/ffmpeg.exe, Install ffmpeg…),
   then ffmpeg on PATH; returns { path, version, source } or null */
function ffmpegCandidates(o) { return [[process.env.AUDIOSTAGE_FFMPEG, 'env'], [o && o.local && fs.existsSync(o.local) ? o.local : '', 'installed'], ['ffmpeg', 'path']].filter(([c]) => c); }
function findFfmpeg(o) {
  for (const [c, source] of ffmpegCandidates(o)) {
    try { const r = spawnSync(c, ['-hide_banner', '-version'], { encoding: 'utf8', timeout: 8000, windowsHide: true }); if (r.status === 0 && /ffmpeg version/.test(r.stdout)) return { path: c, source, version: (/ffmpeg version (\S+)/.exec(r.stdout) || [])[1] || '?' }; } catch (e) { /* next */ }
  }
  return null;
}
/* `ffmpeg -i file` info: { duration (s), video: bool, audio: bool, width, height } */
function parseProbe(stderr) {
  const d = /Duration: (\d+):(\d+):(\d+(?:\.\d+)?)/.exec(stderr), v = /Stream #\S+.*Video: [^\n]*?(\d{2,5})x(\d{2,5})/.exec(stderr);
  return { duration: d ? +d[1] * 3600 + +d[2] * 60 + +d[3] : null, video: /Stream #\S+.*Video:/.test(stderr), audio: /Stream #\S+.*Audio:/.test(stderr), width: v ? +v[1] : null, height: v ? +v[2] : null };
}
function probe(ff, file) { const r = spawnSync(ff, ['-hide_banner', '-i', file], { encoding: 'utf8', timeout: 20000, windowsHide: true }); return parseProbe(r.stderr || ''); }
/* the video stream is copied untouched; the new audio is AAC, padded with silence and cut to the video's length.
   duration (s, from probe): an explicit -t, because "-af apad -shortest" alone lets some ffmpeg versions run on past
   the end of a copied video stream by a fraction of a second */
function muxArgs(video, wav, out, kbps, duration) {
  const t = duration > 0 ? ['-t', duration.toFixed(3)] : [];
  return ['-hide_banner', '-y', '-i', video, '-i', wav, '-map', '0:v:0', '-map', '1:a:0', '-c:v', 'copy', '-c:a', 'aac', '-b:a', (kbps || 256) + 'k', '-af', 'apad', '-shortest', ...t, '-movflags', '+faststart', out];
}
/* written to "<name>.partial<ext>" first and renamed when ffmpeg finished: a failed export never leaves a broken file */
function mux(ff, video, wavBytes, out, kbps) {
  return new Promise((resolve, reject) => {
    const wav = path.join(require('os').tmpdir(), 'audiostage-mix-' + process.pid + '-' + Date.now() + '.wav');
    const ext = path.extname(out) || '.mp4', part = out.slice(0, out.length - path.extname(out).length) + '.partial' + ext;
    let duration = null; try { duration = probe(ff, video).duration; } catch (e) { /* unknown: -shortest only */ }
    fs.writeFileSync(wav, Buffer.from(wavBytes));
    const p = spawn(ff, muxArgs(video, wav, part, kbps, duration), { windowsHide: true }); let err = '';
    const clean = () => { try { fs.unlinkSync(wav); } catch (er) { /* */ } };
    p.stderr.on('data', (d) => { err += d; if (err.length > 20000) err = err.slice(-10000); });
    p.on('error', (e) => { clean(); try { fs.unlinkSync(part); } catch (er) { /* */ } reject(e); });
    p.on('close', (code) => {
      clean();
      if (code !== 0) { try { fs.unlinkSync(part); } catch (er) { /* */ } reject(new Error('ffmpeg failed: ' + err.split('\n').filter(Boolean).slice(-2).join(' '))); return; }
      try { require('./savefile').replaceFile(part, out); resolve(out); } catch (e) { reject(e); }
    });
  });
}
module.exports = { findFfmpeg, ffmpegCandidates, parseProbe, probe, muxArgs, mux };

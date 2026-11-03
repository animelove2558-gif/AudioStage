// Run: node tests/video.test.js — electron/video.js: ffmpeg command, probe parsing, and (when ffmpeg is installed)
// a real "audio back into video" mux of a generated test video.
const assert = require('assert'), fs = require('fs'), os = require('os'), path = require('path'), { spawnSync } = require('child_process');
const { ok, okAsync, done } = require('./_sandbox');
const V = require('../electron/video');

ok('mux command: copies the video stream, new AAC audio padded / cut to the video length', () => {
  const a = V.muxArgs('in.mp4', 'mix.wav', 'out.mp4', 192);
  const s = a.join(' ');
  assert(/-map 0:v:0 -map 1:a:0/.test(s) && /-c:v copy/.test(s) && /-c:a aac -b:a 192k/.test(s) && /-af apad -shortest/.test(s) && a[a.length - 1] === 'out.mp4', s);
});
ok('probe parsing (ffmpeg -i output)', () => {
  const info = V.parseProbe('Input #0, mov,mp4\n  Duration: 00:01:02.50, start: 0\n  Stream #0:0[0x1](und): Video: h264 (High), yuv420p, 1280x720 [SAR 1:1], 25 fps\n  Stream #0:1[0x2](und): Audio: aac (LC), 48000 Hz, stereo\n');
  assert.deepStrictEqual(info, { duration: 62.5, video: true, audio: true, width: 1280, height: 720 });
  assert.deepStrictEqual(V.parseProbe('nothing'), { duration: null, video: false, audio: false, width: null, height: null });
});
const ff = V.findFfmpeg();
if (!ff) console.log('skip  ffmpeg is not installed — the real mux test is skipped');
else okAsync(`real mux with ffmpeg ${ff.version}: video untouched, new soundtrack, video length kept`, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'as-video-')), vid = path.join(dir, 'clip.mp4'), out = path.join(dir, 'out.mp4');
  const g = spawnSync(ff.path, ['-hide_banner', '-y', '-f', 'lavfi', '-i', 'testsrc=size=160x90:rate=10:duration=2', '-f', 'lavfi', '-i', 'sine=frequency=300:duration=2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', vid], { encoding: 'utf8' });
  if (g.status !== 0) { // essentials builds always have libx264; fall back to mpeg4 just in case
    spawnSync(ff.path, ['-hide_banner', '-y', '-f', 'lavfi', '-i', 'testsrc=size=160x90:rate=10:duration=2', '-c:v', 'mpeg4', vid]);
  }
  // a 1 s WAV (shorter than the video): must be padded to the video's 2 s
  const sr = 8000, n = sr, buf = Buffer.alloc(44 + n * 2); buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVEfmt ', 8); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22); buf.writeUInt32LE(sr, 24); buf.writeUInt32LE(sr * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34); buf.write('data', 36); buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) buf.writeInt16LE(Math.round(8000 * Math.sin(2 * Math.PI * 440 * i / sr)), 44 + i * 2);
  await V.mux(ff.path, vid, new Uint8Array(buf), out, 128);
  const info = V.probe(ff.path, out); assert(info.video && info.audio, JSON.stringify(info)); assert(Math.abs(info.duration - 2) < 0.15, 'duration ' + info.duration);
  fs.rmSync(dir, { recursive: true, force: true });
});
done();

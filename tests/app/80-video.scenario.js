// Roadmap 1.7 — multitrack video track (thumbnails, synced preview, soundtrack extraction, moving it) and
// "Export audio back into video" with ffmpeg. Needs the test video the runner makes with ffmpeg.
module.exports = async ({ t, AS, app, assert, near, sleep, env }) => {
  if (!env.video) { await t('video track (skipped: ffmpeg not installed, no test video)', async () => {}); return; }
  const fresh = () => { app.setMode('multi'); const s = new AS.Session(); s.tracks = []; s.addTrack('Music'); app.session = s; app.multi.s = s; app.multi.rebuildHeads(); app.multi.resize(); return s; };
  await t('Insert Video: video track on top with thumbnails, its soundtrack becomes an audio clip', async () => {
    const s = fresh(), r = await window.audioStageMedia.read(env.video); assert(r.ok, 'read');
    const vt = await app.insertVideo(new File([r.data], 'test-video.mp4', { type: 'video/mp4' }), 0, env.video);
    assert(s.tracks[0] === vt && vt.type === 'video', 'video track first'); near(vt.video.dur, 2, 0.1, 'duration');
    const clip = s.tracks.flatMap((x) => x.clips).find((c) => /test-video/.test(c.name)); assert(clip, 'soundtrack clip'); near(clip.dur, 2, 0.1);
    assert(document.querySelector('.mt-head.video'), 'video header'); assert(!document.querySelectorAll('.mx-strip').length || ![...document.querySelectorAll('.mx-strip')].some((el) => /test-video/.test(el.textContent) && !/audio/.test(el.textContent)), 'no mixer strip for the video row');
    app.multi.t0 = 0; app.multi.pps = 300; app.multi.draw();
    let n = 0; for (let i = 0; i < 80 && !n; i++) { await sleep(100); for (const c of AS.vtrack.caches.values()) n += c.map.size; }
    assert(n > 0, 'no thumbnails were made');
    const m = await AS.renderMix(s, 44100); let pk = 0; for (let i = 0; i < 88200; i++) pk = Math.max(pk, Math.abs(m.ch[0][i])); assert(pk > 0.05, 'the soundtrack plays in the mix (the video row itself is silent)');
  });
  await t('the Video panel follows the multitrack playhead (minus the video start)', async () => {
    const vt = AS.vtrack.find(app.session); vt.video.start = 0.5; app.multiCursor = 1.7; app.syncVideo();
    const el = document.querySelector('#videoEl'); for (let i = 0; i < 40 && el.readyState < 1; i++) await sleep(50); app.syncVideo(); await sleep(200);
    near(el.currentTime, 1.2, 0.05, 'video time');
  });
  await t('dragging the video lane moves the video in time; undo', async () => {
    const v = app.multi, vt = AS.vtrack.find(app.session); vt.video.start = 0; v.t0 = 0; v.pps = 100; v.draw();
    const r = v.mainC.getBoundingClientRect(), ev = (x) => ({ button: 0, clientX: r.left + x, clientY: r.top + 40, ctrlKey: false, altKey: false, target: v.mainC, preventDefault() {} });
    v.onDown(ev(50)); v.onMove(ev(100)); v.onUp(); near(vt.video.start, 0.5, 0.02);
    AS.actions['edit.undo'](); near(AS.vtrack.find(app.session).video.start, 0, 1e-9, 'undo');
  });
  await t('Export Video with Mixdown (ffmpeg): video + the new mix as its soundtrack, video length', async () => {
    const out = env.tmp + '\\exported.mp4', p = await app.exportVideo({ out }); assert(p, 'no output');
    const pr = await window.audioStageVideo.probe(p); assert(pr.ok && pr.info.video && pr.info.audio, JSON.stringify(pr)); near(pr.info.duration, 2, 0.15, 'length');
  });
};

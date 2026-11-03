// Screenshot state: video track with thumbnails, looped / locked / grouped / coloured clips, a frozen track.
module.exports = async ({ t, AS, app, assert, sleep, env }) => {
  await t('layout state for screenshots (video lane, clip badges, frozen track)', async () => {
    app.setMode('multi'); const s = new AS.Session(); s.tracks = []; app.session = s; app.multi.s = s; const sr = 44100;
    const tone = (f, secs) => { const x = new Float32Array(sr * secs); for (let i = 0; i < x.length; i++) x[i] = 0.5 * Math.sin(2 * Math.PI * f * i / sr) * (0.4 + 0.6 * Math.abs(Math.sin(i / sr * 3))); return [x]; };
    if (env.video) { const r = await window.audioStageMedia.read(env.video); await app.insertVideo(new File([r.data], 'test-video.mp4'), 0, env.video); }
    const a = s.addTrack('Drums'), b = s.addTrack('Keys'), fz = s.addTrack('Pad (frozen)');
    const l = s.addClip(a, AS.makeSource('beat', sr, tone(120, 0.5)), 0); s.setLoop(l, true); l.dur = 2.5;
    const k1 = s.addClip(b, AS.makeSource('keys 1', sr, tone(330, 1)), 0.2), k2 = s.addClip(b, AS.makeSource('keys 2', sr, tone(440, 1)), 1.4); s.group([k1.id, k2.id]); k2.locked = true; k1.color = '#c25ad6';
    s.addClip(fz, AS.makeSource('pad', sr, tone(220, 2)), 0.3); fz.frozen = { src: AS.makeSource('frozen', sr, tone(220, 3)) };
    app.multi.rebuildHeads(); app.multi.resize(); app.multi.t0 = 0; app.multi.pps = 330; app.multi.selectClips([k1.id, k2.id]);
    for (let i = 0; i < 30; i++) { await sleep(100); app.multi.draw(); }
    AS.panels.hide('mixer'); assert(true);
  });
};

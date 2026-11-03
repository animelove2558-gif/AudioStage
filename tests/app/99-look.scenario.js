// Leaves the multitrack in a representative state for the optional screenshot (AUDIOSTAGE_SELFTEST_SHOTS):
// two audio tracks with clips and envelopes, a bus fed by an output and a send, the Mixer open.
module.exports = async ({ t, AS, app, assert }) => {
  await t('layout state for screenshots (multitrack + bus + sends + mixer)', async () => {
    app.setMode('multi'); const s = new AS.Session(); s.tracks = []; const sr = 44100;
    const tone = (f, a) => { const x = new Float32Array(sr * 3); for (let i = 0; i < x.length; i++) x[i] = a * Math.sin(2 * Math.PI * f * i / sr) * (0.5 + 0.5 * Math.sin(i / sr * 3)); return x; };
    const v = s.addTrack('Voice'), m = s.addTrack('Music'), bus = s.addBus('Reverb Bus');
    s.addClip(v, AS.makeSource('voice', sr, [tone(220, 0.6)]), 0.5); s.addClip(m, AS.makeSource('music', sr, [tone(440, 0.4), tone(440, 0.4)]), 0);
    s.addClip(m, AS.makeSource('music 2', sr, [tone(330, 0.4), tone(330, 0.4)]), 2.2); s.applyCrossfades(m); // crossfade X
    m.out = bus.id; AS.routing.addSend(s, v, bus.id).db = -8; m.fx = [AS.rack.newFx('autoduck', { sc: v.id })];
    AS.env.of(v.clips[0]).volume.push({ t: 0.5, v: 1 }, { t: 1.5, v: 0.3 }, { t: 2.5, v: 1.4 });
    app.session = s; app.multi.s = s; app.multi.rebuildHeads(); app.multi.resize(); app.multi.zoomAll();
    AS.panels.show('mixer'); AS.panels.refreshAll();
    assert(document.querySelectorAll('.mx-strip').length === 4);
  });
};

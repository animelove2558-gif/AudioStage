// Leaves the multitrack showing the recording UI for the optional screenshot: a comped clip with 3 take lanes,
// a punch time selection, armed + monitored track buttons.
module.exports = async ({ t, AS, app, assert }) => {
  await t('layout state for screenshots (takes / comp lanes / punch range)', async () => {
    app.setMode('multi'); const s = new AS.Session(); s.tracks = []; const sr = 44100, L = 2;
    const tr = s.addTrack('Vocal'), other = s.addTrack('Guitar'); tr.arm = true; tr.monitor = true;
    const take = (f, a) => { const x = new Float32Array(sr * L); for (let i = 0; i < x.length; i++) x[i] = a * Math.sin(2 * Math.PI * f * i / sr) * Math.abs(Math.sin(i / sr * 4 + f)); return [x]; };
    const c = s.addClip(tr, AS.makeSource('Recording', sr, take(200, 0.6)), 0.5, { name: 'Recording (3 takes)' });
    c.takes = [take(200, 0.3), take(250, 0.6), take(300, 0.9)].map((ch, i) => ({ name: 'Take ' + (i + 1), src: AS.makeSource('Take ' + (i + 1), sr, ch) }));
    c.comp = [{ from: 0, to: 0.7, take: 2 }, { from: 0.7, to: 1.3, take: 0 }, { from: 1.3, to: 2, take: 1 }]; AS.applyComp(c);
    s.addClip(other, AS.makeSource('gtr', sr, take(330, 0.5)), 0);
    app.session = s; app.multi.s = s; app.multi.rebuildHeads(); app.multi.resize(); app.multi.t0 = 0; app.multi.pps = 300; app.multi.compId = c.id;
    app.punch = true; app.multi.setRange(1.6, 2.2); app.multi.draw(); AS.panels.hide('mixer');
    assert(c.src.ch[0].length === sr * L);
  });
};

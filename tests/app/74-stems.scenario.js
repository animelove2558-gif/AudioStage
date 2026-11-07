// File > Export Stems…: one file per audio track, same length, each track alone; solo flags are put back.
module.exports = async ({ t, AS, app, assert, near, env }) => {
  await t('Export Stems: a file per track (named safely), equal lengths, each stem has only its own track, solo flags restored', async () => {
    app.setMode('multi'); const s = new AS.Session(), sr = 8000, a = s.tracks[0]; a.name = 'Aux';
    const b = s.addTrack('Second'); s.addClip(a, AS.makeSource('a', sr, [new Float32Array(sr).fill(0.5)]), 0); s.addClip(b, AS.makeSource('b', sr, [new Float32Array(sr).fill(0.25)]), 0.5);
    b.solo = true; s.sr = sr; app.session = s; app.multi.s = s;
    const dir = env.tmp + '/stems'; const r = await app.exportStems({ fmt: 'wav16', dir });
    assert(r && r.names.length === 2, JSON.stringify(r)); assert(r.names.every((n) => !/^Aux\./.test(n)) && r.names.some((n) => /01 Aux\.wav$/.test(n)), r.names.join());
    assert(s.tracks[0].solo === false && b.solo === true, 'solo flags restored');
    const bytes = []; for (const n of r.names) { const x = await window.audioStageFiles.stat(dir + '/' + n); bytes.push(x.size); }
    assert(bytes[0] === bytes[1] && bytes[0] > 2 * 1.5 * sr * 0.9, 'equal lengths ' + bytes.join());
  });
};

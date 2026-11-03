// ROADMAP-MISSING 4 — files Windows hands to AudioStage (double-click a .asession, "Open with" on audio): the same path
// main.js uses for a second start of the app (second-instance argv). .asession → multitrack, audio → Waveform.
module.exports = async ({ t, AS, app, assert, sleep, env }) => {
  const until = async (f, ms) => { for (let i = 0; i < (ms || 6000) / 50; i++) { if (f()) return true; await sleep(50); } return false; };
  const write = async (name, bytes) => { const r = await window.audioStageFiles.write(env.tmp, name, bytes); assert(r.ok, r.error); return r.path; };
  await t('a .asession and a .wav given on the command line of a second start: session in Multitrack, audio in Waveform', async () => {
    const s = app.newSession(); s.tracks[0].name = 'From Explorer';
    s.place(s.tracks[0], s.addClip(s.tracks[0], AS.makeSource('tone', 44100, [new Float32Array(4410).fill(0.2)]), 0.5));
    const sess = await write('double-click.asession', new TextEncoder().encode(JSON.stringify(AS.sessionIO.serialize(s))));
    const wav = await write('open-with.wav', new Uint8Array(AS.wav.encodeWav([new Float32Array(2205).fill(0.1)], 22050, 16, false)));
    const n = app.docs.length;
    await window.audioStageOpen.testSecondInstance(['AudioStage.exe', '--some-flag', sess, wav, env.tmp], env.tmp);
    assert(await until(() => app.docs.length === n + 1), 'audio opened');
    const d = app.docs[app.docs.length - 1]; assert(d.name === 'open-with.wav' && d.sr === 22050, d.name);
    assert(app.session.tracks[0].name === 'From Explorer' && app.session.tracks[0].clips.length === 1, 'session opened');
    assert(AS.recent.list('sessions')[0].name === 'double-click.asession' && AS.recent.list('files')[0].name === 'open-with.wav', 'both in the recent lists');
    // the session came first, then the audio file: Waveform is in front, the multitrack holds the session
    app.setMode('multi'); assert(app.mode === 'multi'); app.setMode('wave');
  });
  await t('only files given to AudioStage can be read through that route', async () => {
    const r = await window.audioStageOpen.read(env.tmp + '/not-given.wav'); assert(!r.ok && /Not a file given/.test(r.error), JSON.stringify(r));
  });
};

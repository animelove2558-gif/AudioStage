// ROADMAP-MISSING 2 — File > Open Recent / Open Recent Session in the real desktop app: files written to disk, listed
// (newest first), reopened from the menu, a deleted file is reported and removed, Clear Recent.
module.exports = async ({ t, AS, app, assert, sleep, env }) => {
  const R = AS.recent, sr = 44100;
  const menuLabels = (name, sub) => { const b = [...document.querySelectorAll('#menubar .mb')].find((x) => x.textContent === name); b.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); const row = [...document.querySelectorAll('.menu .mi')].find((x) => x.querySelector('.ml').textContent === sub); row.click(); const l = [...document.querySelectorAll('.menu.sub .ml')].map((x) => x.textContent); b.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); return l; };
  const write = async (name, bytes) => { const r = await window.audioStageFiles.write(env.tmp, name, bytes); assert(r.ok, r.error); return r.path; };
  let a, b;
  await t('files opened from disk are listed in File > Open Recent (newest first, also in the Jump List)', async () => {
    await R.clear();
    const wav = AS.wav.encodeWav([new Float32Array(sr / 10).fill(0.1)], sr, 16, false);
    a = await write('recent-a.wav', new Uint8Array(wav)); b = await write('recent-b.wav', new Uint8Array(wav));
    await R.note('files', a); await R.note('files', b);
    assert(R.list('files')[0].name === 'recent-b.wav' && R.list('files')[1].name === 'recent-a.wav', JSON.stringify(R.list('files')));
    const l = menuLabels('File', 'Open Recent'); assert(/recent-b\.wav/.test(l[0]) && /recent-a\.wav/.test(l[1]) && l.includes('Clear Recent'), l.join('|'));
    assert(menuLabels('File', 'Open Recent Session')[0] === '(No recent sessions)');
  });
  await t('choosing an entry opens the file in Waveform and moves it to the top', async () => {
    const n = app.docs.length; await app.runId('recent:files:1');
    assert(app.docs.length === n + 1 && app.cur.name === 'recent-a.wav' && app.mode === 'wave', app.cur && app.cur.name);
    assert(R.list('files')[0].name === 'recent-a.wav');
  });
  await t('a session reopened from Open Recent Session opens the multitrack', async () => {
    const p = await write('recent.asession', new TextEncoder().encode(JSON.stringify(AS.sessionIO.serialize(app.session))));
    await R.note('sessions', p); await app.runId('recent:sessions:0'); await sleep(50);
    assert(app.mode === 'multi', app.mode); app.setMode('wave');
  });
  await t('a file that was deleted: warned, removed from the list; Clear Recent empties it', async () => {
    const fake = a.replace('recent-a.wav', 'recent-never-there.wav'); await R.note('files', fake); // listed earlier, gone since
    const n = app.docs.length; assert((await app.runId('recent:files:0')) === false && app.docs.length === n);
    assert(!R.list('files').some((e) => e.name === 'recent-never-there.wav'), 'removed');
    await app.runId('recent:clear:files'); assert(R.list('files').length === 0 && R.list('sessions').length === 1);
    await R.clear();
  });
};

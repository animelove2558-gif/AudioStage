// Roadmap-missing 9 — File > File Info / Metadata… in the real app: Thai text + a cover image, written by the real
// encoders (MP3 / FLAC / WAV in the worker, Opus / M4A / AAC through WebCodecs when available), read back when the file
// is opened again and kept when it is saved again; the tagged files still decode; Batch Process {artist} - {title}.
module.exports = async ({ t, AS, app, assert, near, sleep, env }) => {
  const sr = 44100, D = AS.dsp, eng = AS.engine, modal = () => [...document.querySelectorAll('.modal')].pop(), until = async (f) => { for (let i = 0; i < 200 && !f(); i++) await sleep(25); assert(f(), 'timed out'); };
  const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...Array.from({ length: 2000 }, (_, i) => (i * 29) & 255)]);
  const META = { title: 'เพลงทดสอบ', artist: 'ศิลปิน ไทย', album: 'อัลบั้ม', year: '2026', genre: 'ลูกทุ่ง', track: '2/9', comment: 'ความเห็น ✓', cover: { mime: 'image/png', b64: AS.tags.toB64(png) } };
  const same = (got, what) => { assert(got, what + ': no tags read'); for (const k of AS.tags.FIELDS) assert(got[k] === META[k], `${what}: ${k} = ${JSON.stringify(got[k])}`); assert(got.cover && got.cover.b64 === META.cover.b64, what + ': cover'); };
  const set = (m, id, v) => { const el = m.querySelector(`[data-id="${id}"]`); el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); };
  const closeAll = () => { for (const d of app.docs) d.dirty = false; while (app.docs.length) AS.actions['file.close'](); };
  const x = D.genTone(sr, 1.5, 440, 440, 'sine', -6, 2);

  await t('File > File Info / Metadata…: every field (Thai) + cover image → the file’s metadata', async () => {
    app.setMode('wave'); closeAll(); eng.init(); await app.openFiles([new File([AS.wav.encodeWav(x, sr, 16, false)], 'meta-src.wav')]);
    const d = app.cur; d.dirty = false; const p = app.runId('file.info'); await until(() => modal() && modal().querySelector('[data-id="album"]'));
    const m = modal(); assert(/No cover image/.test(m.textContent) && m.querySelector('[data-fi="pick"]'), 'cover controls'); assert(/BWF/.test(m.querySelector('[data-id="title"]').closest('.frow').title), 'tooltip');
    for (const k of AS.tags.FIELDS) set(m, k, META[k]); app.setFileInfoCover(META.cover); assert(m.querySelector('.fi-img'), 'cover preview');
    m.querySelector('[data-act="ok"]').click(); await p;
    for (const k of AS.tags.FIELDS) assert(d.meta[k] === META[k], k); assert(d.meta.cover.b64 === META.cover.b64 && d.dirty, 'cover + unsaved');
  });
  const fmts = ['wav16', 'flac16', 'mp3_192', ...(AS.webenc.avail.opus ? ['opus_128'] : []), ...(AS.webenc.avail.aac ? ['m4a_192', 'aac_192'] : [])];
  await t(`saving writes the tags (${fmts.join(', ')}); the files still decode; reopening reads them back`, async () => {
    const d = app.cur, bufs = {};
    for (const k of fmts) {
      const buf = await app.encodeBytes(d.ch, d.sr, k, false, null, { tags: d.meta }); bufs[k] = buf; same(AS.tags.read(new Uint8Array(buf)), k);
      const ab = await eng.ctx.decodeAudioData(buf.slice(0)); near(ab.duration, 1.5, 0.1, k + ' decodes, duration');
    }
    if (!AS.webenc.avail.opus || !AS.webenc.avail.aac) console.log('      (WebCodecs Opus / AAC not available here: those formats checked in tests/tags.test.js only)');
    for (const k of ['mp3_192', 'flac16', ...(AS.webenc.avail.aac ? ['m4a_192'] : [])]) {
      const ext = { mp3_192: 'mp3', flac16: 'flac', m4a_192: 'm4a' }[k]; await app.openFiles([new File([bufs[k]], 'reopen.' + ext)]);
      const r = app.cur; assert(r.name === 'reopen.' + ext); same(r.meta, 'reopened ' + ext);
      const again = await app.encodeBytes(r.ch, r.sr, 'mp3_128', false, null, { tags: r.meta }); same(AS.tags.read(new Uint8Array(again)), 'saved again from ' + ext);
      r.dirty = false; AS.actions['file.close']();
    }
  });
  await t('Save As dialog: Title / Artist come from (and go back to) the same metadata', async () => {
    const d = app.cur, p = AS.actions['file.saveAs'](); await until(() => modal() && modal().querySelector('[data-id="title"]'));
    const m = modal(); assert(m.querySelector('[data-id="title"]').value === META.title && m.querySelector('[data-id="artist"]').value === META.artist, 'prefilled'); assert(/File Info/.test(m.textContent), 'points to File Info');
    m.querySelector('[data-act="cancel"]').click(); await p; assert(d.meta.album === META.album);
  });
  await t('Batch Process: {artist} - {title} names from the tags, and the exported files keep the tags', async () => {
    const d = app.cur, dir = env.tmp + '\\meta-batch', r = await app.batchRun({ docs: [d], steps: [], label: 'none', fmt: 'mp3_128', template: '{track} {artist} - {title}', dir });
    assert(r && r.written.length === 1 && r.written[0] === '2-9 ศิลปิน ไทย - เพลงทดสอบ.mp3', JSON.stringify(r && r.written));
    const f = await window.audioStageMedia.read(dir + '\\' + r.written[0]); assert(f.ok, 'written'); same(AS.tags.read(f.data), 'batch mp3');
    AS.actions['edit.undo'](); closeAll();
  });
};

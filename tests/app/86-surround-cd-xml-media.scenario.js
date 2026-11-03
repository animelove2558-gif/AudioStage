// Roadmap 2.5 — in the real app: 5.1 master (surround panners, LFE send, 6-channel mixdown + WAV, live playback,
// Mixer pad, saved in the session), CD Layout → CUE + WAV, FCP7 XML export → import round trip, Media Browser
// preview (auto-play / loop) and drag & drop onto a multitrack lane.
module.exports = async ({ t, AS, app, assert, near, sleep, env }) => {
  const sr = 48000, D = AS.dsp, eng = AS.engine;
  const sine = (f, amp, secs) => { const x = new Float32Array(Math.round(sr * secs)); for (let i = 0; i < x.length; i++) x[i] = amp * Math.sin(2 * Math.PI * f * i / sr); return x; };
  const amp = (y, f) => { let re = 0, im = 0, n = Math.min(y.length, sr); for (let i = 0; i < n; i++) { re += y[i] * Math.cos(2 * Math.PI * f * i / sr); im += y[i] * Math.sin(2 * Math.PI * f * i / sr); } return 2 * Math.hypot(re, im) / n; };
  const modal = () => [...document.querySelectorAll('.modal')].pop();
  const fresh = () => { app.setMode('multi'); const s = new AS.Session(); s.tracks = []; s.sr = sr; app.session = s; app.multi.s = s; app.multi.rebuildHeads(); app.multi.resize(); return s; };
  const closeDocs = () => { for (const d of app.docs) d.dirty = false; while (app.docs.length) AS.actions['file.close'](); };

  await t('5.1: Master Channels → 5.1; tracks land in their speakers (rear-left, centre, LFE); undo', async () => {
    const s = fresh(), a = s.addTrack('Rear left'), b = s.addTrack('Centre'), c = s.addTrack('Sub');
    s.addClip(a, AS.makeSource('a', sr, [sine(300, 0.5, 1)]), 0); s.addClip(b, AS.makeSource('b', sr, [sine(500, 0.5, 1)]), 0); s.addClip(c, AS.makeSource('c', sr, [sine(50, 0.5, 1)]), 0);
    a.sur = { x: -Math.sin(110 * Math.PI / 180), y: Math.cos(110 * Math.PI / 180), spread: 0 }; b.sur = { x: 0, y: 1, spread: 0 }; c.sur = { x: 0, y: 1, spread: 0, lfe: 0 };
    AS.actions['mt.ch.6'](); assert(s.opts.channels === 6, 'channels');
    const m = await AS.renderMix(s, sr); assert(m.ch.length === 6, '6 channels: ' + m.ch.length);
    const [L, R, C, LFE, Ls, Rs] = m.ch;
    near(amp(Ls, 300), 0.5 * Math.SQRT2, 0.02, '300 Hz in Ls (mono clip: equal-power pan, both sides summed)'); for (const ch of [L, R, C, Rs]) assert(amp(ch, 300) < 0.01, '300 Hz only in Ls');
    near(amp(C, 500), 0.5 * Math.SQRT2, 0.02, '500 Hz in C'); assert(amp(L, 500) < 0.01 && amp(Ls, 500) < 0.01);
    assert(amp(LFE, 50) > 0.3 && amp(LFE, 300) < 0.02 && amp(LFE, 500) < 0.01, 'LFE: low-passed send of the sub track only');
    AS.actions['edit.undo'](); assert(app.session.opts.channels !== 6, 'undo → stereo'); AS.actions['edit.redo']();
  });
  await t('5.1 mixdown export: WAV only, 6 channels with the 5.1 speaker mask', async () => {
    const p = AS.actions['file.exportMix'](); await sleep(80); const opts = [...modal().querySelectorAll('[data-id="fmt"] option')].map((o) => o.value);
    assert(opts.length && opts.every((v) => /^wav/.test(v)), 'formats ' + opts); modal().querySelector('[data-act="cancel"]').click(); await p;
    const m = await AS.renderMix(app.session, sr), buf = await app.encodeBytes(m.ch, sr, 'wav24', false), w = AS.wav.decodeWav(buf);
    assert(w.ch.length === 6 && w.channelMask === 0x3f, 'decoded ' + w.ch.length + ' mask ' + w.channelMask);
  });
  await t('5.1 live playback runs (6-channel device or folded to stereo); Mixer shows a surround pad that moves the track', async () => {
    AS.panels.show('mixer'); await sleep(80); const pads = AS.panels.defs.mixer.body.querySelectorAll('.mx-sur'); assert(pads.length === 3, 'pads ' + pads.length);
    const pad = pads[1], r = pad.getBoundingClientRect(), tr = app.session.tracks[1];
    pad.dispatchEvent(new PointerEvent('pointerdown', { clientX: r.left + r.width * 0.9, clientY: r.top + r.height * 0.5, pointerId: 1, bubbles: true })); pad.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, bubbles: true }));
    assert(tr.sur.x > 0.6 && Math.abs(tr.sur.y) < 0.2, 'moved right: ' + JSON.stringify(tr.sur)); AS.actions['edit.undo'](); assert(app.session.tracks[1].sur.x === 0, 'pad move undone');
    app.multiCursor = 0; AS.actions['tp.play'](); await sleep(500); assert(eng.playing, 'playing');
    const dc = eng.ctx.destination; assert(dc.channelCount === (dc.maxChannelCount >= 6 ? 6 : 2), `device channels ${dc.channelCount} (max ${dc.maxChannelCount})`);
    AS.actions['tp.stop'](); AS.panels.hide('mixer');
  });
  await t('5.1 settings and surround positions are saved in the session file', async () => {
    const j = JSON.parse(JSON.stringify(AS.sessionIO.serialize(app.session))), s2 = AS.sessionIO.deserialize(j);
    assert(s2.opts.channels === 6, 'channels'); near(s2.tracks[0].sur.x, app.session.tracks[0].sur.x, 1e-9); assert(s2.tracks[2].sur.lfe === 0);
    AS.actions['mt.ch.2'](); assert(app.session.opts.channels === 2);
  });
  await t('CD Layout: add songs, gap, reorder, undo; Export CUE + WAV writes a 44.1 kHz stereo image', async () => {
    closeDocs(); app.setMode('wave');
    for (const [n, f, secs] of [['Song A.wav', 330, 5], ['Song B.wav', 440, 4.5]]) await app.openFiles([new File([AS.wav.encodeWav([sine(f, 0.3, secs)], sr, 32, false)], n)]);
    AS.panels.show('cd'); const b = AS.panels.defs.cd.body, cd = AS.cdLayout.state;
    b.querySelector('[data-a="addall"]').click(); assert(cd.items.length === 2 && cd.items[1].gap === 2, 'two songs, default 2 s gap');
    const gap = b.querySelectorAll('.cd-gap')[1]; gap.value = 1; gap.dispatchEvent(new Event('change', { bubbles: true })); assert(cd.items[1].gap === 1);
    b.querySelectorAll('.cd-it')[1].querySelector('[data-a="up"]').click(); assert(cd.items[0].name === 'Song B', 'reordered');
    b.querySelector('[data-a="undo"]').click(); assert(cd.items[0].name === 'Song A', 'undo reorder'); b.querySelector('[data-a="undo"]').click(); assert(cd.items[1].gap === 2, 'undo gap');
    cd.title = 'Test CD'; const r = await app.exportCD(cd, { dir: env.tmp + '\\cd' }); assert(r && r.names.join('|') === 'Test CD.wav|Test CD.cue', JSON.stringify(r && r.names));
    const f = await window.audioStageMedia.read(env.tmp + '\\cd\\Test CD.wav'); const w = AS.wav.decodeWav(f.data.buffer.slice(f.data.byteOffset, f.data.byteOffset + f.data.byteLength));
    assert(w.sr === 44100 && w.ch.length === 2 && w.ch[0].length === r.build.tracks[1].end, 'image ' + w.sr + ' ' + w.ch.length); assert(/INDEX 00 00:05:00/.test(r.build.cue) && /INDEX 01 00:07:00/.test(r.build.cue), r.build.cue);
    AS.panels.hide('cd');
  });
  await t('FCP7 XML: export the session with its media, import it back as a new session (same clips, audio)', async () => {
    const s = fresh(), a = s.addTrack('Voice'), m = s.addTrack('Music'); m.vol = -6; m.pan = -0.5;
    const va = AS.makeSource('voice take', sr, [sine(250, 0.4, 3)]), mu = AS.makeSource('bed', sr, [sine(600, 0.2, 6), sine(650, 0.2, 6)]);
    s.addClip(a, va, 1, { off: 0.5, dur: 2, gain: -2, fi: 0.2 }); s.addClip(m, mu, 0, { dur: 6, fo: 1 });
    const out = await app.exportFCP7({ dir: env.tmp + '\\fcp', name: 'Round trip' }); assert(out && out.names.length === 3, JSON.stringify(out && out.names));
    const r = await app.importFCP7(new File([out.xml], 'Round trip.xml'), { force: true }); assert(r && r.clips === 2 && !r.skipped, JSON.stringify(r && { clips: r.clips, skipped: r.skipped, missing: r.missing }));
    const s2 = app.session; assert(s2 !== s && s2.tracks.map((x) => x.name).join('|') === 'Voice|Music');
    const c = s2.tracks[0].clips[0]; near(c.start, 1, 1e-9); near(c.off, 0.5, 1e-9); near(c.dur, 2, 1e-9); near(c.gain, -2, 0.01); near(c.fi, 0.2, 1e-9);
    near(s2.tracks[1].clips[0].gain, -6, 0.01, 'track volume → clip level'); near(s2.tracks[1].pan, -0.5, 1e-9);
    let e = 0; for (let i = 0; i < c.src.ch[0].length; i++) e = Math.max(e, Math.abs(c.src.ch[0][i] - va.ch[0][i])); assert(e < 1e-5, 'media is the same audio (24-bit): ' + e);
  });
  await t('Media Browser: click previews (Auto-play), Loop, Stop; drag a file onto a multitrack lane → clip there', async () => {
    const dir = env.tmp + '\\media'; await window.audioStageFiles.write(dir, 'preview me.wav', new Uint8Array(AS.wav.encodeWav([sine(700, 0.3, 0.6)], sr, 16, false)));
    AS.panels.show('media'); const P = AS.panels.defs.media; await P.go(dir); const item = P.body.querySelector('.mbi.aud'); assert(item && /preview me/.test(item.textContent), 'listed');
    const MP = AS.mediaPreview; MP.settings.auto = true; MP.settings.loop = false; item.click(); for (let i = 0; i < 40 && !MP.state.src; i++) await sleep(50);
    assert(MP.state.src && /preview me\.wav$/.test(MP.state.path), 'auto-play preview'); assert(item.classList.contains('playing'), 'highlighted while playing');
    const loop = P.body.querySelector('[data-o="loop"]'); loop.checked = true; loop.dispatchEvent(new Event('change')); assert(MP.state.src.loop, 'loop on the playing preview');
    await sleep(900); assert(MP.state.src, 'still looping after the file length'); P.body.querySelector('[data-a="stop"]').click(); assert(!MP.state.src, 'stopped');
    loop.checked = false; loop.dispatchEvent(new Event('change'));
    const s = fresh(); s.addTrack('One'); s.addTrack('Two'); app.multi.rebuildHeads(); app.multi.resize(); app.multi.t0 = 0; app.multi.pps = 100; app.multi.draw();
    const mc = app.multi.mainC, rc = mc.getBoundingClientRect(), dt = new DataTransfer(); dt.setData('application/x-audiostage-path', item.dataset.p);
    mc.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, clientX: rc.left + 200, clientY: rc.top + (() => { let y = 0; while (app.multi.trackAt(y) < 1) y++; return y + 20; })(), bubbles: true, cancelable: true }));
    for (let i = 0; i < 40 && !s.tracks[1].clips.length; i++) await sleep(50);
    assert(s.tracks[1].clips.length === 1, 'clip on the second lane: ' + s.tracks.map((x) => x.clips.length)); near(s.tracks[1].clips[0].start, 2, 0.1, 'at the drop time');
    AS.panels.hide('media'); closeDocs();
  });
};

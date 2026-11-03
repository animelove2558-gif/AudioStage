// Roadmap-missing 11 — layers in the multitrack (like Adobe Audition): drag track headers (drop line, auto-scroll,
// several tracks, bus and video rows), Multitrack > Move Track… + keys + header right-click menu, the Mixer follows
// (and its strips can be dragged), the mixdown does not change; Bring Clip to Front / Send Clip to Back.
module.exports = async ({ t, AS, app, assert, near, sleep, env }) => {
  const sr = 44100, tone = (secs, f, a) => { const x = new Float32Array(Math.round(secs * sr)); for (let i = 0; i < x.length; i++) x[i] = (a || 0.3) * Math.sin(2 * Math.PI * f * i / sr); return x; };
  const v = app.multi;
  const fresh = () => { app.setMode('multi'); const s = new AS.Session(); s.tracks = []; app.session = s; v.s = s; v.selIds.clear(); app.selTracks = null; app.selTrack = null; return s; };
  const show = () => { v.rebuildHeads(); v.resize(); v.t0 = 0; v.pps = 100; v.body.scrollTop = 0; v.draw(); };
  const names = () => app.session.tracks.map((x) => x.name).join(',');
  const heads = () => [...v.heads.children];
  const headNames = () => heads().map((h) => (h.querySelector('.tname') ? h.querySelector('.tname').value : h.querySelector('.vname').textContent)).join(',');
  const mouse = (type, target, x, y, o) => target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, ...(o || {}) }));
  /* drag header i to the gap before slot k (0 = top, n = bottom); mods: { ctrlKey } etc. for the mousedown only */
  const dragHead = async (i, k, check) => {
    const h = heads()[i], r = h.getBoundingClientRect(), x = r.left + r.width - 20, y0 = r.top + 30, br = v.body.getBoundingClientRect();
    const y1 = br.top - v.body.scrollTop + k * 96 + (k ? -8 : 6);
    mouse('mousedown', h.querySelector('.row.note') || h, x, y0); mouse('mousemove', window, x, y0 + 2); mouse('mousemove', window, x, (y0 + y1) / 2); mouse('mousemove', window, x, y1);
    if (check) await check(); mouse('mouseup', window, x, y1); await sleep(20);
  };
  const mix = async () => (await AS.renderMix(app.session, sr)).ch;
  const same = (a, b) => a.length === b.length && a.every((c, i) => c.length === b[i].length && c.every((x, j) => Math.abs(x - b[i][j]) < 1e-7));

  await t('drag a track header: drop line while dragging, new order, one undo step, the mixdown is the same', async () => {
    const s = fresh(), a = s.addTrack('A'), b = s.addTrack('B'), bus = s.addBus('Bus'), c = s.addTrack('C');
    s.addClip(a, AS.makeSource('a', sr, [tone(1, 300)]), 0); s.addClip(b, AS.makeSource('b', sr, [tone(1, 500)]), 0.3); s.addClip(c, AS.makeSource('c', sr, [tone(1, 700)]), 0.1);
    a.pan = -0.6; a.out = bus.id; AS.routing.addSend(s, c, bus.id).db = -4; bus.vol = -3; bus.fx = [AS.rack.newFx('eq', { lowG: 4, midF: 1000, midG: -3, midQ: 1, highG: 2 })]; show();
    const before = await mix(), undo0 = s.undoStack.length;
    let line = null; await dragHead(3, 0, async () => { line = v.body.querySelector('.mt-dropline'); });
    assert(line && Math.abs(parseFloat(line.style.top) + 1) < 2, 'drop line at the top: ' + (line && line.style.top));
    assert(!v.body.querySelector('.mt-dropline'), 'line removed after the drop');
    assert(names() === 'C,A,B,Bus', names()); assert(headNames() === 'C,A,B,Bus', 'headers follow: ' + headNames());
    assert(s.undoStack.length === undo0 + 1, 'one undo step');
    assert(a.out === bus.id && c.sends[0].to === bus.id, 'routing / sends kept');
    assert(same(await mix(), before), 'the mixdown changed after moving a track');
    await dragHead(3, 1); assert(names() === 'C,Bus,A,B', 'bus header dragged: ' + names()); // the bus row moves too
    AS.actions['edit.undo'](); AS.actions['edit.undo'](); assert(names() === 'A,B,Bus,C', 'undo: ' + names()); assert(headNames() === 'A,B,Bus,C');
    AS.actions['edit.redo'](); assert(names() === 'C,A,B,Bus', 'redo');
  });
  await t('Ctrl+click / Shift+click select several headers; dragging one of them moves all of them', async () => {
    const s = fresh(); for (const n of ['A', 'B', 'C', 'D', 'E']) s.addTrack(n); show();
    const hd = (i) => heads()[i], at = (i) => { const r = hd(i).getBoundingClientRect(); return [r.left + 150, r.top + 30]; };
    mouse('mousedown', hd(0), ...at(0)); mouse('mouseup', window, ...at(0));
    mouse('mousedown', hd(2), ...at(2), { ctrlKey: true }); mouse('mouseup', window, ...at(2));
    assert(v.trackSel().length === 2 && hd(0).classList.contains('sel') && hd(2).classList.contains('sel') && !hd(1).classList.contains('sel'), 'Ctrl+click');
    await dragHead(2, 5); assert(names() === 'B,D,E,A,C', 'both moved, order kept: ' + names());
    mouse('mousedown', hd(0), ...at(0)); mouse('mouseup', window, ...at(0)); mouse('mousedown', hd(2), ...at(2), { shiftKey: true }); mouse('mouseup', window, ...at(2));
    assert(v.trackSel().join() === s.tracks.slice(0, 3).map((x) => x.id).join(), 'Shift+click selects the range');
    AS.actions['mt.trackdown'](); assert(names() === 'A,B,D,E,C', 'Move Track Down with three selected: ' + names());
    mouse('mousedown', hd(4), ...at(4)); mouse('mouseup', window, ...at(4)); assert(v.trackSel().length === 1, 'plain click: one track');
  });
  await t('Multitrack menu, header right-click menu and keyboard shortcuts (editable, Alt+Shift+arrows by default)', async () => {
    const s = fresh(); for (const n of ['A', 'B', 'C']) s.addTrack(n); show();
    const mb = [...document.querySelectorAll('#menubar .mb')].find((x) => x.textContent === 'Multitrack'); mb.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    const labels = [...document.querySelectorAll('.menu .ml')].map((x) => x.textContent); mb.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    for (const l of ['Move Track Up', 'Move Track Down', 'Move Track to Top', 'Move Track to Bottom', 'Bring Clip to Front', 'Send Clip to Back']) assert(labels.includes(l), 'menu: ' + l);
    const h = heads()[2], r = h.getBoundingClientRect(); mouse('mousedown', h, r.left + 150, r.top + 30); mouse('mouseup', window, r.left + 150, r.top + 30);
    h.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.left + 150, clientY: r.top + 30 }));
    const pop = document.querySelector('.mt-trackmenu'); assert(pop, 'header menu'); assert(/Move Track to Top/.test(pop.textContent));
    [...pop.querySelectorAll('.mi')].find((x) => /to Top/.test(x.textContent)).click(); assert(names() === 'C,A,B', 'header menu → top: ' + names());
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', code: 'ArrowDown', altKey: true, shiftKey: true, bubbles: true })); assert(names() === 'A,C,B', 'Alt+Shift+Down: ' + names());
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', code: 'End', altKey: true, shiftKey: true, bubbles: true })); assert(names() === 'A,B,C', 'Alt+Shift+End: ' + names());
    const list = AS.keys.collect(app.menuDefs || []); if (list.length) { const c = list.find((x) => x.id === 'mt.trackup'); assert(c && c.dflt === 'Alt+Shift+Up', 'in the Keyboard Shortcuts list: ' + JSON.stringify(c)); assert(!Object.keys(AS.keys.conflicts(list)).includes('Alt+Shift+Up'), 'no key conflict'); }
  });
  await t('auto-scroll when dragging a header to the bottom edge of a long track list', async () => {
    const s = fresh(); for (let i = 0; i < 14; i++) s.addTrack('T' + i); show();
    const h = heads()[0], r = h.getBoundingClientRect(), br = v.body.getBoundingClientRect(), x = r.left + 150;
    assert(v.body.scrollHeight > v.body.clientHeight + 200, 'the list scrolls');
    mouse('mousedown', h, x, r.top + 30); mouse('mousemove', window, x, r.top + 40); mouse('mousemove', window, x, br.bottom - 5);
    await sleep(400); const sc = v.body.scrollTop; mouse('mouseup', window, x, br.bottom - 5); await sleep(20);
    assert(sc > 50, 'scrolled down while dragging: ' + sc); assert(s.tracks.indexOf(s.tracks.find((x) => x.name === 'T0')) > 3, 'dropped further down: ' + names());
  });
  await t('Mixer: strips follow the track order; dragging a strip by its name moves the track', async () => {
    const s = fresh(); for (const n of ['A', 'B', 'C']) s.addTrack(n); show(); AS.panels.show('mixer'); await sleep(60);
    const strips = () => [...AS.panels.defs.mixer.body.querySelectorAll('.mx-strip[data-tid]')], sn = () => strips().map((x) => x.querySelector('.mx-name').textContent.trim()).join(',');
    assert(sn() === 'A,B,C', sn()); AS.actions['mt.tracktop'] && (app.selTrack = s.tracks[2].id, app.selTracks = null, AS.actions['mt.tracktop']()); await sleep(250);
    assert(sn() === 'C,A,B', 'mixer re-ordered: ' + sn());
    const nm = strips()[0].querySelector('.mx-name'), r = nm.getBoundingClientRect(), last = strips()[2].getBoundingClientRect(), pe = (type, tg, x) => tg.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: r.top + 4, button: 0, pointerId: 1 }));
    pe('pointerdown', nm, r.left + 5); pe('pointermove', window, r.left + 20); pe('pointermove', window, last.right - 4);
    assert(strips()[2].classList.contains('mx-drop-r'), 'drop marker after the last strip'); pe('pointerup', window, last.right - 4); await sleep(250);
    assert(names() === 'A,B,C' && sn() === 'A,B,C', 'strip dragged to the end: ' + names() + ' / ' + sn());
    AS.actions['edit.undo'](); await sleep(250); assert(names() === 'C,A,B', 'undo');
    AS.panels.hide('mixer');
  });
  await t('Bring Clip to Front / Send Clip to Back: the front clip is heard in the overlap, drawn on top, picked by a click; undo', async () => {
    const s = fresh(), tr = s.addTrack('T'), x = s.addClip(tr, AS.makeSource('X', sr, [tone(2, 300)]), 0), y = s.addClip(tr, AS.makeSource('Y', sr, [tone(0.5, 900)]), 0.5); show();
    const seg = (ch, a, b) => ch[0].slice(Math.round(a * sr), Math.round(b * sr)), rms = (a) => Math.sqrt(a.reduce((p, q) => p + q * q, 0) / a.length);
    const corr = (a, f) => { let s1 = 0; for (let i = 0; i < a.length; i++) s1 += a[i] * Math.sin(2 * Math.PI * f * (i + Math.round(0.6 * sr)) / sr); return Math.abs(s1) / a.length; };
    let m = await mix(); assert(corr(seg(m, 0.6, 0.9), 900) > 0.05 && corr(seg(m, 0.6, 0.9), 300) < 0.005, 'Y in front: only Y in the overlap');
    const cy = 96 * 0 + 50, hitX = v.t2x(0.7); assert(v.hit(hitX, cy).c === y, 'click picks the front clip');
    v.selectClips([y.id]); AS.actions['mt.back'](); assert(y.z < x.z, 'sent back'); assert(v.hit(hitX, cy).c === x, 'now X is picked');
    m = await mix(); assert(corr(seg(m, 0.6, 0.9), 300) > 0.05 && corr(seg(m, 0.6, 0.9), 900) < 0.005, 'X in front: only X in the overlap');
    near(rms(seg(m, 1.2, 1.5)), 0.3 / Math.SQRT2 * Math.SQRT1_2, 0.02, 'outside the overlap X plays as usual');
    AS.actions['edit.undo'](); assert(app.session.findClip(y.id).c.z > app.session.findClip(x.id).c.z, 'undo');
    v.selectClips([x.id]); AS.actions['mt.front'](); assert(app.session.findClip(x.id).c.z > app.session.findClip(y.id).c.z, 'X to the front');
    const cv = v.mainC.getBoundingClientRect(); v.mainC.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: cv.left + v.t2x(1.5), clientY: cv.top + 50 }));
    const pop = document.querySelector('.curve-pop'); assert(pop && /Bring Clip to Front/.test(pop.textContent) && /Send Clip to Back/.test(pop.textContent), 'clip right-click menu'); pop.remove();
  });
  await t('Overwrite policy no longer cuts: the covered clip comes back when the clip on top moves away', async () => {
    const s = fresh(), tr = s.addTrack('T'); s.opts.overlap = 'overwrite'; const x = s.addClip(tr, AS.makeSource('X', sr, [tone(2, 300)]), 0); show();
    const y = s.addClip(tr, AS.makeSource('Y', sr, [tone(0.5, 900)]), 0.5); s.place(tr, y);
    assert(tr.clips.length === 2 && Math.abs(x.dur - 2) < 1e-9, 'X untouched'); const covered = await mix();
    y.start = 3; s.place(tr, y); const m = await mix(), seg = m[0].slice(Math.round(0.6 * sr), Math.round(0.9 * sr)), segC = covered[0].slice(Math.round(0.6 * sr), Math.round(0.9 * sr));
    assert(!same([seg], [segC]) && Math.max(...seg.map(Math.abs)) > 0.1, 'X audible again');
    s.opts.overlap = 'overlap';
  });
  await t('the video row can be dragged too', async () => {
    if (!env.video) return; // needs the test video (ffmpeg)
    const s = fresh(); s.addTrack('Music'); show(); const r = await window.audioStageMedia.read(env.video);
    const vt = await app.insertVideo(new File([r.data], 'test-video.mp4', { type: 'video/mp4' }), 0, env.video); show();
    const i = s.tracks.indexOf(vt); await dragHead(i, s.tracks.length); assert(s.tracks[s.tracks.length - 1] === vt, 'video row at the bottom: ' + names());
    assert(document.querySelector('.mt-head.video') === heads()[heads().length - 1], 'video header last');
  });
};

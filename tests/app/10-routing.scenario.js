// Roadmap 1.1 — bus tracks, sends, sidechain: real Web Audio (OfflineAudioContext + the live AudioContext).
module.exports = async ({ t, AS, app, assert, near, sleep }) => {
  const RT = AS.routing, D = AS.dsp, sr = 48000;
  const sine = (amp, secs, f, from) => { const n = Math.round(secs * sr), x = new Float32Array(n); for (let i = Math.round((from || 0) * sr); i < n; i++) x[i] = amp * Math.sin(2 * Math.PI * (f || 440) * i / sr); return x; };
  const peak = (x, a, b) => { let p = 0; for (let i = a; i < b; i++) p = Math.max(p, Math.abs(x[i])); return p; };
  const rms = (x, a, b) => { let s = 0; for (let i = a; i < b; i++) s += x[i] * x[i]; return Math.sqrt(s / (b - a)); };
  const session = () => { const s = new AS.Session(); s.tracks = []; return s; };

  await t('track -> bus -> master: bus fader and rack apply (offline mixdown)', async () => {
    const s = session(), a = s.addTrack('A'), bus = s.addBus('Bus'); s.addClip(a, AS.makeSource('a', sr, [sine(0.5, 1)]), 0);
    a.out = bus.id; bus.vol = -6.0206;
    // mono 0.5 -> track panner (mono -> stereo, equal power: x 0.7071) -> bus -> bus fader x 0.5
    const m = await AS.renderMix(s, sr); near(peak(m.ch[0], sr / 4, sr * 3 / 4), 0.5 * Math.SQRT1_2 * 0.5, 0.005, 'level through the bus');
  });
  await t('send level: post-fader follows the track fader, pre-fader does not', async () => {
    const level = async (pre) => {
      const s = session(), a = s.addTrack('A'), mutedBus = s.addBus('Silent'), bus = s.addBus('Send bus');
      s.addClip(a, AS.makeSource('a', sr, [sine(0.5, 1), sine(0.5, 1)]), 0); // stereo: panners pass it through unchanged
      a.out = mutedBus.id; mutedBus.mute = true; // the track's own output is silenced -> only the send is heard
      a.vol = -20; const x = RT.addSend(s, a, bus.id); x.pre = pre; x.db = -6.0206;
      const m = await AS.renderMix(s, sr); return peak(m.ch[0], sr / 4, sr * 3 / 4);
    };
    near(await level(true), 0.25, 0.005, 'pre-fader: 0.5 x send -6 dB'); near(await level(false), 0.025, 0.001, 'post-fader: also x fader -20 dB');
  });
  await t('sidechain Auto-Duck: music drops ~12 dB while the voice plays (offline)', async () => {
    const s = session(), v = s.addTrack('Voice'), mu = s.addTrack('Music');
    s.addClip(v, AS.makeSource('v', sr, [sine(0.5, 2, 300, 1)]), 0); // voice only during the 2nd second
    s.addClip(mu, AS.makeSource('m', sr, [sine(0.3, 2, 1000), sine(0.3, 2, 1000)]), 0);
    mu.fx = [AS.rack.newFx('autoduck', { sc: v.id, thr: -40, amount: 12, att: 5, hold: 0, rel: 50 })];
    v.mute = true; // key-only: the voice is not heard but still drives the ducker
    const m = await AS.renderMix(s, sr), before = rms(m.ch[0], sr * 0.3, sr * 0.9), during = rms(m.ch[0], sr * 1.3, sr * 1.9);
    near(D.toDb(during / before), -12, 1, 'duck depth');
  });
  await t('sidechain compressor keyed by another track compresses; without key it does not', async () => {
    const mk = async (sc) => { const s = session(), k = s.addTrack('Key'), a = s.addTrack('A'); s.addClip(k, AS.makeSource('k', sr, [sine(0.9, 1, 200)]), 0); s.addClip(a, AS.makeSource('a', sr, [sine(0.2, 1, 1000)]), 0); k.mute = true; a.fx = [AS.rack.newFx('comp', { sc: sc ? k.id : '', thr: -30, ratio: 10, knee: 0, att: 1, rel: 50, makeup: 0 })]; const m = await AS.renderMix(s, sr); return rms(m.ch[0], sr / 2, sr * 0.95); };
    const keyed = await mk(true), self = await mk(false);
    assert(keyed < self * 0.5, `keyed ${keyed} vs self ${self}`);
  });
  await t('a hand-edited looping session still plays (loop edge dropped, not silenced)', async () => {
    const s = session(), a = s.addTrack('A'), b1 = s.addBus('B1'), b2 = s.addBus('B2'); s.addClip(a, AS.makeSource('a', sr, [sine(0.5, 1)]), 0);
    a.out = b1.id; b1.out = b2.id; b2.out = b1.id; // B1 <-> B2 loop
    const m = await AS.renderMix(s, sr); assert(peak(m.ch[0], 0, sr) > 0.1, 'silent');
  });
  await t('UI: + Bus, header output selector, Mixer bus strip / + Send, sidechain choices, undo', async () => {
    app.setMode('multi'); const s = app.session, n0 = s.tracks.length;
    document.querySelector('#mtAddBus').click();
    const bus = s.tracks[s.tracks.length - 1]; assert(s.tracks.length === n0 + 1 && bus.type === 'bus', 'bus added');
    const heads = document.querySelectorAll('.mt-head'); assert(heads[heads.length - 1].classList.contains('bus'), 'bus header');
    const first = s.tracks.find((x) => x.type !== 'bus'), sel = heads[s.tracks.indexOf(first)].querySelector('.tout');
    assert([...sel.options].some((o) => o.value === bus.id), 'bus offered as output');
    sel.value = bus.id; sel.dispatchEvent(new Event('change')); assert(first.out === bus.id, 'output set');
    AS.panels.show('mixer'); const strips = document.querySelectorAll('.mx-strip');
    assert([...strips].some((el) => el.classList.contains('bus')), 'bus strip in the Mixer');
    const add = document.querySelector('.mx-addsend'); assert(add, '+ Send'); add.click();
    const owner = s.tracks.find((x) => (x.sends || []).length); assert(owner, 'send added');
    assert(document.querySelector('.mx-send select'), 'send row');
    assert(AS.rack.sidechainOptions({ ownerId: bus.id }).some(([v]) => v === first.id), 'a track feeding the bus may key the bus');
    assert(!AS.rack.sidechainOptions({ ownerId: first.id }).some(([v]) => v === bus.id), 'the bus may not key a track that feeds it (loop)');
    AS.actions['edit.undo'](); AS.actions['edit.undo']();
    const f2 = app.session.tracks.find((x) => x.id === first.id); assert(f2.out === 'master', 'undo restored the output');
    AS.panels.hide('mixer');
  });
  await t('live playback = offline mixdown (bus + send + sidechain ducker)', async () => {
    const eng = AS.engine; eng.init(); await eng.wl; await eng.ctx.resume(); const ctx = eng.ctx, rate = ctx.sampleRate;
    const s = session(), v = s.addTrack('Voice'), mu = s.addTrack('Music'), bus = s.addBus('FX Bus');
    const sn = (amp, secs, f, from) => { const n = Math.round(secs * rate), x = new Float32Array(n); for (let i = Math.round((from || 0) * rate); i < n; i++) x[i] = amp * Math.sin(2 * Math.PI * f * i / rate); return x; };
    s.addClip(v, AS.makeSource('v', rate, [sn(0.4, 1.2, 300, 0.5)]), 0); s.addClip(mu, AS.makeSource('m', rate, [sn(0.3, 1.2, 700), sn(0.3, 1.2, 700)]), 0);
    mu.out = bus.id; RT.addSend(s, v, bus.id).db = -6; bus.vol = -3;
    mu.fx = [AS.rack.newFx('autoduck', { sc: v.id, thr: -40, amount: 10, att: 5, hold: 0, rel: 60 })];
    const off = await AS.renderMix(s, rate);
    // live: the same graph into the audio-thread recorder (a ScriptProcessor capture drops blocks — not usable here)
    const rec = eng.recorder(2), into = ctx.createGain(); into.connect(rec.node);
    const t0 = ctx.currentTime + 0.3, nodes = AS.buildGraph(ctx, into, s, 0, t0);
    await sleep(2200); const live = (await rec.stop())[0];
    for (const n of nodes) { try { n.stop && n.stop(); } catch (e) { /* */ } try { n.disconnect(); } catch (e) { /* */ } } into.disconnect();
    // align by the first loud sample, then compare
    const first = (x) => { for (let i = 0; i < x.length; i++) if (Math.abs(x[i]) > 0.05) return i; return -1; };
    const lo = first(live), oo = first(off.ch[0]); assert(lo >= 0 && oo >= 0, 'no signal (live ' + lo + ', offline ' + oo + ')');
    const L = Math.min(Math.round(rate * 1.1), live.length - lo, off.ch[0].length - oo);
    let best = Infinity;
    for (let d = -3; d <= 3; d++) { let e = 0, sig = 0; for (let i = 64; i < L - 64; i++) { const a = live[lo + i + d], b = off.ch[0][oo + i]; e += (a - b) * (a - b); sig += b * b; } best = Math.min(best, 10 * Math.log10(e / sig)); }
    assert(best < -30, `live differs from offline: residual ${best.toFixed(1)} dB`);
  });
};

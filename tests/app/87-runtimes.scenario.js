// ROADMAP-MISSING 1 — VST support in the installed app: the menu commands, the Install VST Support… dialog (download
// from a slow local test server, progress, Cancel leaves nothing behind), the status overview, the Plugin Manager,
// the not-installed dialog offering the install, and a VST step in a Favorite.
module.exports = async ({ t, AS, app, assert, sleep }) => {
  const modal = () => [...document.querySelectorAll('.modal')].pop();
  const menuLabels = (name) => { const b = [...document.querySelectorAll('#menubar .mb')].find((x) => x.textContent === name); b.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); const l = [...document.querySelectorAll('.menu .ml')].map((x) => x.textContent); b.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); return l; };
  const until = async (f, ms) => { for (let i = 0; i < (ms || 8000) / 50; i++) { if (f()) return true; await sleep(50); } return false; };

  await t('desktop menus: Effects > Plugin Manager… / Install VST Support…, Help > Check VST / ffmpeg Status…', async () => {
    const fx = menuLabels('Effects'), help = menuLabels('Help');
    for (const l of ['VST3 / AU Plugin (offline)…', 'Plugin Manager…', 'Install VST Support…']) assert(fx.includes(l), 'Effects: ' + l);
    assert(help.includes('Check VST / ffmpeg Status…'), help.join('|'));
    assert(AS.runtimes.available && AS.vst.available && !document.querySelector('#vstBtn').hidden);
  });
  await t('Install VST Support…: progress from the (test) server, Cancel → nothing installed, dialog closable again', async () => {
    const st0 = await AS.runtimes.status('vst'); assert(!st0.installed && st0.supported === (navigator.userAgent.includes('Windows')), JSON.stringify(st0));
    const done = AS.actions['fx.vstInstall'](); await until(() => modal() && modal().querySelector('[data-rt="install"]'));
    const m = modal(), inst = m.querySelector('[data-rt="install"]');
    if (!st0.supported) { assert(inst.hidden, 'no install button off Windows'); m.querySelector('[data-act="cancel"]').click(); await done; return; }
    assert(/Install VST Support/.test(inst.textContent)); inst.click();
    assert(await until(() => AS.runtimes.state.last.vst && AS.runtimes.state.last.vst.pct > 0.005), 'download progress arrives');
    assert(m.querySelector('[data-act="cancel"]').disabled, 'Close is disabled while installing');
    assert(parseFloat(m.querySelector('.rt-bar i').style.width) > 0, 'the bar moves');
    m.querySelector('[data-rt="cancel"]').click();
    assert(await until(() => /Cancelled/.test(m.querySelector('.rt-msg').textContent) && !m.querySelector('[data-act="cancel"]').disabled), m.querySelector('.rt-msg').textContent);
    assert(!m.querySelector('[data-act="cancel"]').disabled && !inst.hidden, 'can close / retry');
    const st = await AS.runtimes.status('vst'); assert(!st.installed && !st.busy, JSON.stringify(st));
    m.querySelector('[data-act="cancel"]').click(); assert((await done) === AS.runtimes.ready('vst', st), 'resolves to: usable now (a dev venv may be there)');
  });
  await t('Check VST / ffmpeg Status… shows both, with Manage buttons', async () => {
    const p = AS.actions['help.status'](); await until(() => modal() && /VST \/ ffmpeg Status/.test(modal().textContent));
    const m = modal(); assert(m.querySelectorAll('[data-k]').length === 2 && /ffmpeg/.test(m.textContent));
    m.querySelector('[data-act="cancel"]').click(); await p;
  });
  await t('VST3 Plugin… without a plugin host: explains and offers Install VST Support… (no npm in the text)', async () => {
    app.setMode('wave'); await app.openFiles([new File([AS.wav.encodeWav([new Float32Array(4410)], 44100, 16, false)], 'vst.wav')]);
    const st = await window.audioStageVst.status();
    if (st.available) return; // a developer machine with tools/vst/.venv: the dialog opens instead — nothing to check here
    const p = AS.actions['fx.vst'](); await until(() => modal() && /not installed yet/.test(modal().textContent));
    const m = modal(); assert(/Install VST Support|Retry/.test(m.querySelector('[data-act="ok"]').textContent));
    m.querySelector('[data-act="cancel"]').click(); await p;
  });
  await t('Plugin Manager…: standard folders listed, own folders remembered and removable', async () => {
    localStorage.setItem('as-vst-dirs', JSON.stringify(['C:\\NoSuchPlugins']));
    const p = AS.actions['fx.vstManager'](); await until(() => modal() && modal().querySelector('.pm-dirs') && modal().querySelector('.pm-list tr'));
    const m = modal(); assert(/standard/.test(m.querySelector('.pm-dirs').textContent) && /NoSuchPlugins/.test(m.querySelector('.pm-dirs').textContent), m.querySelector('.pm-dirs').textContent);
    m.querySelector('[data-del]').click(); await sleep(50); assert(JSON.parse(localStorage.getItem('as-vst-dirs')).length === 0 && !/NoSuchPlugins/.test(m.querySelector('.pm-dirs').textContent));
    m.querySelector('[data-act="cancel"]').click(); await p;
  });
  await t('a VST step in a Favorite: described, kept, and runs through the plugin host (runStep hook)', async () => {
    const F = AS.favorites, st = { type: 'vst', path: 'C:\\VST3\\Verb.vst3', name: 'Verb', state: 'ab', tail: 2 };
    assert(F.valid(st) && F.describe(st) === 'VST: Verb (tail 2 s)' && F.vstRun === AS.vst.runStep);
    const keep = F.vstRun; let got = null; F.vstRun = async (s, chs) => { got = s; return chs.map((c) => c.map((x) => x * 2)); };
    const out = await F.process([new Float32Array([0.25])], 44100, [st], null); F.vstRun = keep;
    assert(got.path === st.path && out[0][0] === 0.5);
  });
};

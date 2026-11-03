/* Install VST Support… / Install ffmpeg…: what is installed, install with a progress bar (cancellable), repair /
   reinstall, remove. The work runs in the main process (electron/runtimes.js), so the UI never stalls.
   Desktop app only (window.audioStageRuntime): the browser build shows none of these commands. */
(function (root) {
  'use strict';
  const AS = (root.AS = root.AS || {});
  const api = root.audioStageRuntime;
  const UI = () => AS.ui, esc = (s) => AS.ui.esc(s);
  const KINDS = {
    vst: { title: 'VST Support', install: 'Install VST Support', what: 'Python 3.13 (python.org embeddable package, PSF licence), pip, the plugin host <b>pedalboard</b> (GPLv3, from PyPI) and numpy — downloaded from their official sites onto this computer only, into AudioStage’s own data folder.', size: 'about 40 MB download (≈ 120 MB on disk)' },
    ffmpeg: { title: 'ffmpeg', install: 'Install ffmpeg', what: 'An <b>LGPL</b> build of FFmpeg for Windows (BtbN FFmpeg-Builds on GitHub, checked against the release’s SHA-256 list) — used by File &gt; Export Video with Mixdown. Installed into AudioStage’s data folder; nothing else on the system changes.', size: 'about 80 MB download' },
  };
  const SOURCE = { env: 'AUDIOSTAGE_PYTHON', runtime: 'installed by AudioStage', venv: 'developer setup (tools/vst/.venv)', system: 'Python on this computer', installed: 'installed by AudioStage', path: 'on PATH' };
  const state = { running: {}, last: {} }; // (tests) the last progress / result per kind

  async function status(kind) { const r = await api.status(kind); if (!r.ok) throw new Error(r.error); return r.status; }
  /* is it usable right now? */
  const ready = (kind, st) => (kind === 'vst' ? !!(st.active && st.active.available) : !!(st.active && st.active.ffmpeg));
  function describe(kind, st) {
    const a = st.active || {}, inf = st.info;
    let h = '';
    if (kind === 'vst') h = a.available ? `<b style="color:#2fb67c">Ready</b> — plugin host pedalboard ${esc(a.pedalboard)} (${esc(SOURCE[a.source] || a.source || '')})` : `<b style="color:#e8a33a">Not ready</b> — ${esc(a.error || 'Python / pedalboard not found.')}`;
    else h = a.ffmpeg ? `<b style="color:#2fb67c">Ready</b> — ffmpeg ${esc(a.ffmpeg.version)} (${esc(SOURCE[a.ffmpeg.source] || a.ffmpeg.source || '')})` : '<b style="color:#e8a33a">Not found</b> — Export Video with Mixdown needs ffmpeg.';
    if (st.installed && inf) h += `<div class="note">Installed by AudioStage on ${esc(new Date(inf.installedAt).toLocaleString())}: ${kind === 'vst' ? `Python ${esc(inf.python)}, pedalboard ${esc(inf.pedalboard)}, numpy ${esc(inf.numpy)}` : `ffmpeg ${esc(inf.version)} (${esc(inf.build)}, ${esc(inf.license)})`}</div>`;
    return h;
  }
  async function confirm(title, html, ok) { return !!(await UI().dialog({ title, html, okLabel: ok })); }

  /* the status / install dialog. o.auto: start installing at once. Resolves true when the runtime is ready afterwards. */
  async function manage(kind, o) {
    const K = KINDS[kind]; if (!api || !K) { UI().toast('This needs the desktop app.', 'error'); return false; }
    let st = await status(kind);
    await UI().dialog({ title: K.title, noOk: true, cancelLabel: 'Close', width: 560, dismissable: false, canClose: () => !state.running[kind],
      html: `<div class="rt-state"></div><div class="rt-prog" hidden><div class="rt-bar"><i></i></div><div class="rt-msg note"></div></div>
        <div class="rt-btns"><button class="btn primary" data-rt="install"></button><button class="btn" data-rt="cancel" hidden>Cancel</button><button class="btn danger" data-rt="remove" hidden>Remove ${esc(K.title)}</button></div>
        <div class="note">${K.what} ${esc(K.size)}.</div>`,
      onReady(el) {
        const $ = (s) => el.querySelector(s), bar = $('.rt-bar i'), msg = $('.rt-msg'), prog = $('.rt-prog'), close = el.querySelector('[data-act="cancel"]');
        const paint = () => {
          $('.rt-state').innerHTML = describe(kind, st) + (st.supported ? '' : '<div class="note">Automatic installation is available on Windows (64-bit) only.</div>');
          const b = $('[data-rt="install"]'); b.textContent = st.installed ? 'Repair / Reinstall' : K.install + '…'; b.hidden = !st.supported || !!state.running[kind]; b.disabled = !!state.running[kind];
          $('[data-rt="remove"]').hidden = !st.installed || !!state.running[kind]; $('[data-rt="cancel"]').hidden = !state.running[kind]; close.disabled = !!state.running[kind];
        };
        const install = async () => {
          state.running[kind] = true; prog.hidden = false; bar.style.width = '0%'; msg.style.color = ''; msg.textContent = 'Starting…'; paint();
          const off = api.onProgress((p) => { if (p.kind !== kind) return; state.last[kind] = p; bar.style.width = Math.round(p.pct * 100) + '%'; msg.textContent = `${Math.round(p.pct * 100)}% — ${p.msg}`; });
          const r = await api.install(kind); off(); state.running[kind] = false;
          if (r.ok) { st = r.status; msg.textContent = 'Installed — ready to use (no restart needed).'; bar.style.width = '100%'; state.last[kind] = { done: true }; }
          else { msg.style.color = r.error === 'Cancelled' ? '' : 'var(--danger)'; msg.textContent = r.error === 'Cancelled' ? 'Cancelled — nothing was changed.' : 'Installation failed: ' + r.error; state.last[kind] = { error: r.error }; try { st = await status(kind); } catch (e) { /* keep the old */ } }
          paint();
        };
        el.addEventListener('click', async (e) => {
          const b = e.target.closest('[data-rt]'); if (!b) return;
          if (b.dataset.rt === 'install') install();
          else if (b.dataset.rt === 'cancel') { msg.textContent = 'Cancelling…'; await api.cancel(kind); }
          else if (b.dataset.rt === 'remove' && await confirm('Remove ' + K.title, `<p>Delete the copy of ${esc(K.title)} AudioStage installed (its whole folder)? You can install it again at any time.</p>`, 'Remove')) {
            const r = await api.remove(kind); if (r.ok) { st = r.status; prog.hidden = true; UI().toast(K.title + ' removed.'); } else UI().toast(r.error, 'error'); paint();
          }
        });
        paint(); if (o && o.auto && st.supported && !state.running[kind]) install();
      } });
    try { st = await status(kind); } catch (e) { /* */ }
    return ready(kind, st);
  }
  /* Help > Check VST / ffmpeg Status…: both at a glance, with the buttons to manage each */
  async function overview() {
    if (!api) return;
    const [v, f] = await Promise.all([status('vst'), status('ffmpeg')]);
    await UI().dialog({ title: 'VST / ffmpeg Status', noOk: true, cancelLabel: 'Close', width: 560, dismissable: true,
      html: `<table class="stats"><tr><td><b>VST3 plugins</b><br>${describe('vst', v)}</td><td><button class="btn sm" data-k="vst">Manage…</button></td></tr><tr><td><b>ffmpeg</b> (video export)<br>${describe('ffmpeg', f)}</td><td><button class="btn sm" data-k="ffmpeg">Manage…</button></td></tr></table>`,
      onReady(el, close) { el.addEventListener('click', (e) => { const b = e.target.closest('[data-k]'); if (b) { close(null); manage(b.dataset.k); } }); } });
  }

  AS.runtimes = { available: !!api, KINDS, status, ready, manage, overview, describe, state };
})(window);

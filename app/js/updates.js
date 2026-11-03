/* Help > Check for Updates… and the check when AudioStage opens (desktop app; electron/updater.js does the work).
   Always asks: "download?" and then "restart and install?". With no update source set up (or in `npm start`), the
   startup check does nothing and the menu command explains why. In the browser there is no menu item. */
(function (root) {
  'use strict';
  const AS = (root.AS = root.AS || {}), U = () => root.audioStageUpdate;
  if (U()) AS.prefs.register({ id: 'general.checkUpdates', tab: 'General', label: 'Check for updates when AudioStage opens', type: 'check', dflt: true, tip: 'Looks for a newer version on the update server (GitHub Releases) a few seconds after the start. It always asks before downloading or installing.' });
  const esc = (s) => AS.ui.esc(s);
  let busy = false;
  /* silent: the startup check — says nothing unless there is an update (errors only go to the log) */
  async function check(o) {
    const u = U(), silent = !!(o && o.silent), UI = AS.ui; if (!u || busy) return null;
    busy = true;
    try {
      const r = silent ? await u.check() : await UI.busy('Checking for updates…', () => u.check());
      if (!r || !r.ok || r.error) { if (silent) return r; /* the main process has logged it */ await UI.dialog({ title: 'Check for Updates', html: `<p>${esc((r && r.error) || 'The update check failed.')}</p>`, noOk: true, cancelLabel: 'Close' }); return r; }
      if (r.busy) return r;
      if (r.enabled === false) {
        if (!silent) await UI.dialog({ title: 'Check for Updates', noOk: true, cancelLabel: 'Close', html: `<p>${r.reason === 'dev' ? 'Updates are checked in the installed app (from the AudioStage setup .exe), not when running from the source folder.' : 'Automatic updates are not set up for this copy of AudioStage (no update server is configured). Get new versions from wherever you downloaded AudioStage.'}</p>` });
        return r;
      }
      if (!r.available) { if (!silent) await UI.dialog({ title: 'Check for Updates', html: `<p>AudioStage ${esc(r.current)} is up to date.</p>`, noOk: true, cancelLabel: 'Close' }); return r; }
      const yes = await UI.dialog({ title: 'Update Available', okLabel: 'Download', cancelLabel: 'Not Now', width: 520, html: `<p><b>AudioStage ${esc(r.version)}</b> is available — you have ${esc(r.current)}.</p>${r.notes ? `<div class="note upd-notes">${esc(r.notes).replace(/\n/g, '<br>')}</div>` : ''}<p>Download it now? You will be asked again before it is installed.</p>` });
      if (!yes) return { ...r, declined: 'download' };
      let off = null; const d = await UI.busy('Downloading AudioStage ' + r.version + '…', () => { off = u.onProgress((p) => { const el = document.querySelector('#busy span'); if (el) el.textContent = `Downloading AudioStage ${r.version}… ${p.percent} %`; }); return u.download(); }, () => u.cancel());
      if (off) off();
      if (!d || !d.ok || d.error) { await UI.dialog({ title: 'Update', html: `<p>${esc((d && d.error) || 'The download failed.')}</p>`, noOk: true, cancelLabel: 'Close' }); return d; }
      const go = await UI.dialog({ title: 'Update Ready', okLabel: 'Restart and Install', cancelLabel: 'Later', html: `<p>AudioStage ${esc(r.version)} has been downloaded. Restart AudioStage now to install it? Save your work first.</p>` });
      if (!go) return { ...r, downloaded: true, declined: 'install' };
      await u.install(); return { ...r, installed: true };
    } finally { busy = false; }
  }
  /* a few seconds after the start, if Preferences > General says so and updates are set up */
  async function startup() {
    const u = U(); if (!u || !AS.prefs.get('general.checkUpdates')) return false;
    const s = await u.status(); if (!s.ok || !s.status.enabled || !s.status.auto) return false;
    setTimeout(() => check({ silent: true }), 5000); return true;
  }
  AS.updates = { check, startup, available: () => !!U() };
})(window);

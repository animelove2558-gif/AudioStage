/* Start screen: shown when AudioStage opens with nothing to do yet — New Audio File, New Multitrack Session, Open…,
   the recent files / sessions, the manual. It goes away as soon as anything is opened or any command runs.
   Preferences > General > "Show the Start screen when AudioStage opens"; Help > Start Screen shows it again. */
(function (root) {
  'use strict';
  const AS = (root.AS = root.AS || {});
  let el = null, offRecent = null;
  AS.prefs.register({ id: 'general.welcome', tab: 'General', label: 'Show the Start screen when AudioStage opens', type: 'check', dflt: true });

  function render() {
    const esc = AS.ui.esc, R = AS.recent, desk = R.desktop;
    const rec = (kind) => { const l = R.list(kind); return l.length ? l.map((e, i) => `<button class="ws-rec" data-rec="${kind}:${i}" title="${esc(e.path || e.name)}">${esc(e.name)}${e.path ? `<small>${esc(e.path.replace(/[\\/][^\\/]*$/, ''))}</small>` : ''}</button>`).join('') : `<div class="note">${kind === 'sessions' ? 'No recent sessions.' : 'No recent files.'}${desk ? '' : ' (The browser remembers only the names.)'}</div>`; };
    el.innerHTML = `<div class="ws-box">
      <button class="ws-x" data-ws="close" title="Close the Start screen">×</button>
      <h1>AudioStage</h1><div class="note">Edit, restore and mix audio — everything stays on this computer.</div>
      <div class="ws-cols">
        <div class="ws-col"><h2>Start</h2>
          <button class="ws-act" data-ws="file.new">New Audio File…<small>Ctrl+N</small></button>
          <button class="ws-act" data-ws="newSession">New Multitrack Session</button>
          <button class="ws-act" data-ws="file.open">Open…<small>Ctrl+O</small></button>
          <button class="ws-act" data-ws="file.openSession">Open Multitrack Session…</button>
          <h2>Learn</h2>
          <button class="ws-act" data-ws="help.manual">AudioStage Help<small>F1</small></button>
          <button class="ws-act" data-ws="help.keys">Keyboard Shortcuts</button>
        </div>
        <div class="ws-col"><h2>Recent Files</h2>${rec('files')}<h2>Recent Sessions</h2>${rec('sessions')}</div>
      </div>
      <label class="chk ws-show"><input type="checkbox" data-ws-show ${AS.prefs.get('general.welcome') ? 'checked' : ''}> Show this screen when AudioStage opens</label>
    </div>`;
  }
  function show() {
    if (!el) {
      el = document.createElement('div'); el.id = 'welcome';
      el.addEventListener('click', async (e) => {
        const b = e.target.closest('[data-ws]'), r = e.target.closest('[data-rec]'), app = root.app;
        if (r) { const [k, i] = r.dataset.rec.split(':'); hide(); app.runId(`recent:${k}:${i}`); return; }
        if (!b) return; const a = b.dataset.ws; hide();
        if (a === 'newSession') app.startNewSession(); else if (a !== 'close') app.runId(a);
      });
      el.addEventListener('change', (e) => { if (e.target.matches('[data-ws-show]')) AS.prefs.set('general.welcome', e.target.checked); });
      (document.getElementById('center') || document.body).appendChild(el);
      offRecent = AS.recent.onChange(() => { if (el && !el.hidden) render(); });
    }
    render(); el.hidden = false;
  }
  function hide() { if (el) el.hidden = true; }
  const visible = () => !!el && !el.hidden;
  /* at start: only when the preference is on and nothing was opened (files from Windows, crash recovery…) */
  function startup(app) {
    if (!AS.prefs.get('general.welcome')) return false;
    if (app.docs.length || app.session.tracks.some((t) => t.clips.length)) return false;
    show(); return true;
  }
  AS.welcome = { show, hide, visible, startup, _off: () => offRecent && offRecent() };
})(window);

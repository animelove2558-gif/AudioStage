// Roadmap-missing 10 — Help > Check for Updates… in the real app against a fake update server (AUDIOSTAGE_UPDATE_MOCK:
// version 9.9.9): it asks before downloading, shows the progress, asks again before installing; "Not Now" / "Later"
// do nothing; the startup check is a preference (and never runs in the app tests).
module.exports = async ({ t, AS, app, assert, sleep }) => {
  const modal = () => [...document.querySelectorAll('.modal')].pop(), until = async (f, ms) => { for (let i = 0; i < (ms || 5000) / 25 && !f(); i++) await sleep(25); assert(f(), 'timed out'); };
  const menuLabels = (name) => { const b = [...document.querySelectorAll('#menubar .mb')].find((x) => x.textContent === name); b.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); const l = [...document.querySelectorAll('.menu .ml')].map((x) => x.textContent); b.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); return l; };
  const titled = (s) => modal() && modal().querySelector('.modal-title').textContent === s;
  const U = window.audioStageUpdate;

  await t('Help > Check for Updates… and Preferences > General "Check for updates when AudioStage opens"', async () => {
    assert(menuLabels('Help').includes('Check for Updates…'), 'menu item');
    assert(AS.prefs.get('general.checkUpdates') === true, 'on by default'); assert((await AS.updates.startup()) === false, 'no startup check in the app tests');
  });
  await t('update available → "Not Now" downloads nothing', async () => {
    const p = AS.actions['help.updates'](); await until(() => titled('Update Available'));
    assert(/AudioStage 9\.9\.9/.test(modal().textContent) && /Test release/.test(modal().textContent), modal().textContent);
    modal().querySelector('[data-act="cancel"]').click(); const r = await p; assert(r.declined === 'download');
    assert((await U.status()).status.state === 'available', 'not downloading');
  });
  await t('Download → progress → "Later" does not install; again → "Restart and Install"', async () => {
    let p = AS.updates.check(); await until(() => titled('Update Available')); modal().querySelector('[data-act="ok"]').click();
    await until(() => /Downloading AudioStage 9\.9\.9… \d+ %/.test(document.querySelector('#busy span').textContent) && !document.getElementById('busy').hidden);
    await until(() => titled('Update Ready')); assert(/Restart AudioStage now/.test(modal().textContent)); modal().querySelector('[data-act="cancel"]').click();
    let r = await p; assert(r.declined === 'install'); assert((await U.testInstalled()) === 0, 'not installed');
    p = AS.updates.check(); await until(() => titled('Update Available')); modal().querySelector('[data-act="ok"]').click(); await until(() => titled('Update Ready'));
    modal().querySelector('[data-act="ok"]').click(); r = await p; assert(r.installed && (await U.testInstalled()) === 1, 'installed after the second yes');
  });
};

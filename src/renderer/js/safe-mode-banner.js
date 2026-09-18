// === Safe mode, explained =================================================
//
// Vex starts in safe mode after two launches that never finished starting, or
// when it is started with --safe-mode. Without a word on screen that is
// indistinguishable from "my extensions vanished and my panels are gone" — so
// it says what it did, and offers the two ways out: restore the settings as
// they were before the last update, or restart normally now that whatever
// broke has been left out once.
const SafeModeBanner = {
  async init() {
    if (!window.vex || typeof window.vex.safeMode !== 'function') return false;
    let info;
    try { info = await window.vex.safeMode(); }
    catch (err) { VexProblems?.note('Safe mode', 'Could not read the startup state', err); return false; }
    if (!info || !info.safeMode) return false;
    this.show(info);
    return true;
  },

  show(info) {
    document.querySelector('.safe-mode-banner')?.remove();
    const el = document.createElement('div');
    el.className = 'safe-mode-banner';
    const why = info.asked
      ? 'You started Vex in safe mode.'
      : `Vex did not finish starting ${info.fails} times in a row, so this launch left things out.`;
    el.innerHTML = `
      <div class="smb-text">
        <strong>Safe mode</strong>
        <span>${this._esc(why)} No extensions, no panels, no session restore — so you can undo whatever caused it.</span>
      </div>
      <div class="smb-actions">
        <button class="smb-btn" data-act="restore">Restore earlier settings</button>
        <button class="smb-btn smb-primary" data-act="restart">Restart normally</button>
        <button class="smb-btn smb-x" data-act="close" aria-label="Dismiss">Dismiss</button>
      </div>`;
    document.body.appendChild(el);
    el.querySelector('[data-act="close"]').addEventListener('click', () => el.remove());
    el.querySelector('[data-act="restart"]').addEventListener('click', () => {
      // The boot state was reset the moment this interface loaded, so a plain
      // restart is already a normal one.
      if (typeof window.vex.restartApp === 'function') window.vex.restartApp();
      else window.showToast?.('Close and open Vex to start normally', 'info');
    });
    el.querySelector('[data-act="restore"]').addEventListener('click', () => this.chooseSnapshot(info));
  },

  async chooseSnapshot(info) {
    const list = Array.isArray(info.snapshots) ? info.snapshots : [];
    if (!list.length) { window.showToast?.('There is no earlier copy of your settings to go back to', 'error'); return; }
    const newest = list[0];
    const when = new Date(newest.at).toLocaleString();
    const ok = await vexConfirm({
      title: 'Restore earlier settings?',
      message: `Your settings will go back to the copy kept under version ${newest.label} (${when}).\n\nThe settings you have now are copied aside first, so this can be undone. Vex then restarts.`,
      okLabel: 'Restore and restart',
      danger: true,
    });
    if (!ok) return;
    const r = await window.vex.restoreSettings(newest.name);
    if (!r || !r.ok) { window.showToast?.('Could not restore: ' + ((r && r.error) || 'unknown'), 'error'); return; }
    if (typeof window.vex.restartApp === 'function') window.vex.restartApp();
    else window.showToast?.('Restored — close and open Vex to finish', 'info');
  },

  _esc(s) { return window.escapeHtml ? window.escapeHtml(String(s)) : String(s); },
};

if (typeof window !== 'undefined') window.SafeModeBanner = SafeModeBanner;
if (typeof module !== 'undefined' && module.exports) module.exports = { SafeModeBanner };

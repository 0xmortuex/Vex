// === Update safety net =======================================================
//
// Before an in-app update installs, the update cover (js/update-notifier.js)
// takes a backup of the settings (VexBackup.snapshot: the same file Settings ›
// Backup makes, secrets excluded) and the main process keeps it in
// userData/backups (src/main/update-backups.js). Nothing installs if that
// backup cannot be made unless the person says to go on.
//
// This is the other half: after the update, one click puts those settings
// back if the new version misbehaves. It finds the backup made before THIS
// version, says what is in it, asks, restores it through VexBackup (so the
// secret filter and the shape checks are the same ones as for any restore) and
// keeps an Undo.
//
// It never runs an updater and never touches the update download; it only
// reads backups that already exist.
const VexUpdateSafetyNet = {
  ANNOUNCED_KEY: 'vex.updateSafetyNet.announced',
  RECENT_DAYS: 14,
  _undo: false,

  _api() {
    const api = window.vex && window.vex.updates;
    if (!api || typeof api.listBackups !== 'function' || typeof api.readBackup !== 'function') return null;
    return api;
  },

  // The backup made right before the running version was installed.
  // -> { item, version } | null. Throws when the list cannot be read.
  async find() {
    if (window.VexTabPolicy && window.VexTabPolicy.isPrivateWindow) return null;
    const api = this._api();
    if (!api) return null;
    if (!window.vex || typeof window.vex.getAppVersion !== 'function') return null;
    const version = String(await window.vex.getAppVersion());
    const r = await api.listBackups();
    if (!r || !r.ok) throw new Error('The backups made before updates could not be listed: ' + ((r && r.error) || 'unknown error'));
    const limit = Date.now() - this.RECENT_DAYS * 24 * 60 * 60 * 1000;
    const item = (r.items || []).find(b => b.kind === 'before' && b.version === version && b.at >= limit);
    return item ? { item, version } : null;
  },

  async _read(item) {
    const got = await this._api().readBackup(item.name);
    if (!got || !got.ok) throw new Error('That backup could not be read: ' + ((got && got.error) || 'unknown error'));
    let data;
    try { data = JSON.parse(got.text); }
    catch (err) { throw new Error('That backup is not readable as a Vex backup', { cause: err }); }
    const seen = VexBackup.describe(data);
    if (!seen) throw new Error('That is not a Vex backup file');
    return { data, seen };
  },

  // Asks, then restores. -> { written, failed } or null when the person said no.
  async restore(item) {
    const { data, seen } = await this._read(item);
    const when = seen.when ? seen.when.toLocaleString() : 'an unknown date';
    const ok = await vexConfirm({
      title: 'Go back to the settings from before this update?',
      message: 'This puts back ' + seen.count + ' settings saved on ' + when + (seen.app ? ' by Vex ' + seen.app : '') + '. '
        + 'Anything you changed since then is written over by what the backup holds; saved logins are not part of it and are not touched. '
        + 'You can undo this until you close Vex.',
      okLabel: 'Restore', cancelLabel: 'Cancel', danger: true,
    });
    if (!ok) return null;
    const r = VexBackup.apply(data);
    VexBackup._undoStores = null;
    r.written += await VexBackup.applyStores(data);
    VexBackup._reloadLive();
    this._undo = true;
    return r;
  },

  async undo() {
    if (!this._undo) throw new Error('Nothing has been restored to undo');
    VexBackup.undo();
    await VexBackup.undoStores();
    VexBackup._reloadLive();
    this._undo = false;
  },

  _note(el, text) { el.appendChild(VexSettingsGroups.note(text)); },

  open() {
    const dlg = VexSettingsGroups.dialog({
      id: 'vex-safety-net-dialog',
      title: 'If this update misbehaves',
      sub: 'Vex backs up your settings just before it installs an update. If the new version is not right, you can go back to those settings.',
    });
    const { body } = dlg;
    const msg = document.createElement('div');
    msg.className = 'vexsr-msg';
    msg.setAttribute('role', 'status');
    const say = (t, bad) => { msg.textContent = t || ''; msg.style.color = bad ? 'var(--danger, #ef4444)' : 'var(--text-muted)'; };
    body.appendChild(msg);
    const area = document.createElement('div');
    body.appendChild(area);
    const draw = async () => {
      area.textContent = '';
      let found;
      try { found = await this.find(); }
      catch (err) { say(err.message, true); return; }
      if (!found) {
        this._note(area, 'There is no backup from just before this version (' + this.RECENT_DAYS + ' days back). One is made at each in-app update, and at the first start of a version installed another way.');
        return;
      }
      let detail = '';
      try {
        const { seen } = await this._read(found.item);
        detail = seen.count + ' settings, saved ' + (seen.when ? seen.when.toLocaleString() : new Date(found.item.at).toLocaleString()) + (seen.app ? ' by Vex ' + seen.app : '') + '.';
      } catch (err) { say(err.message, true); return; }
      this._note(area, 'Backup made before updating to ' + found.version + ': ' + detail);
      const go = VexSettingsGroups.button('Restore the settings from before the update', async () => {
        go.disabled = true;
        try {
          const r = await this.restore(found.item);
          if (r) {
            say('Restored ' + r.written + ' settings' + (r.failed ? ' (' + r.failed + ' skipped)' : '') + '. Restart Vex for all of it to take.');
            undoBtn.hidden = false;
          }
        } catch (err) { say(err.message, true); }
        go.disabled = false;
      }, { primary: true });
      const undoBtn = VexSettingsGroups.button('Undo the restore', async () => {
        try { await this.undo(); say('Put back the way it was. Restart Vex.'); undoBtn.hidden = true; }
        catch (err) { say(err.message, true); }
      });
      undoBtn.hidden = !this._undo;
      area.append(go, undoBtn);
    };
    draw();
    return dlg;
  },

  group(el) {
    this._note(el, 'Before each update Vex backs up your settings (logins and authenticator codes are never included). If a new version misbehaves, this restores them in one click, and the restore can be undone.');
    el.appendChild(VexSettingsGroups.button('If this update misbehaves…', () => this.open(), { primary: true }));
  },

  // Said once per backup, a little after start: that the update was backed up
  // and where to go if it misbehaves.
  async announce() {
    let found;
    try { found = await this.find(); }
    catch (err) { console.error('[SafetyNet]', err.message); return false; }
    if (!found) return false;
    let seen = '';
    try { seen = localStorage.getItem(this.ANNOUNCED_KEY) || ''; }
    catch (err) { console.error('[SafetyNet] could not read what was announced:', err.message); }
    if (seen === found.item.name) return false;
    try { localStorage.setItem(this.ANNOUNCED_KEY, found.item.name); }
    catch (err) { console.error('[SafetyNet] could not save what was announced:', err.message); }
    window.showToast?.('Vex updated to ' + found.version + '. Your settings from before the update are saved.', 'info', 9000, {
      action: { label: 'If it misbehaves', title: 'Restore the settings from before the update', run: () => this.open() },
    });
    return true;
  },
};

if (typeof window !== 'undefined') {
  window.VexUpdateSafetyNet = VexUpdateSafetyNet;
  if (typeof VexSettingsGroups !== 'undefined') {
    VexSettingsGroups.register({
      id: 'update-safety-net',
      title: 'Update safety net',
      keywords: 'update restore previous settings roll back undo update broke misbehaves backup before update',
      before: 'about',
      build: (el) => VexUpdateSafetyNet.group(el),
    });
  }
  // Not at once: the window is still drawing, and the update cover and the
  // what's-new card get the first seconds.
  window.addEventListener('load', () => setTimeout(() => { VexUpdateSafetyNet.announce(); }, 6000));
}
if (typeof module !== 'undefined' && module.exports) module.exports = { VexUpdateSafetyNet };

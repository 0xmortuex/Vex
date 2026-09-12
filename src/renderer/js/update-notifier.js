// === Vex Update Notifier ===

const UpdateNotifier = {
  init() {
    window.vex.onUpdateAvailable?.((info) => this._showAvailable(info));
    window.vex.onUpdateDownloadProgress?.((p) => this._updateProgress(p));
    window.vex.onUpdateDownloaded?.((info) => this._showReady(info));
    // An update that fails has to say so. This used to log to a console nobody
    // has open while the progress bar sat at 0% forever, so a broken download
    // was indistinguishable from a slow one.
    window.vex.onUpdateError?.((err) => this._showError(err));
    // A few seconds after launch, quietly ask the update server whether a newer
    // build exists and, if so, show a download prompt. This uses the lightweight
    // HTTPS version check (not electron-updater), so it can never crash the app.
    setTimeout(() => this.checkOnStartup(), 4000);
  },

  // Startup check: only surfaces a prompt when an update genuinely exists.
  async checkOnStartup() {
    let r; try { r = await window.vex.checkForUpdates?.(); } catch { return; }
    if (r?.ok && r.hasUpdate) this._showDownloadPrompt(r);
  },

  // Update-available popup with a Download button. Clicking it opens the direct
  // installer link in a new tab (Vex downloads the .exe via its own download
  // manager); the user runs it to update.
  _showDownloadPrompt(info) {
    document.getElementById('update-notification')?.remove();
    const el = document.createElement('div');
    el.id = 'update-notification';
    el.className = 'update-notif';
    el.innerHTML = `
      <div class="update-notif-icon">&#127881;</div>
      <div class="update-notif-body">
        <div class="update-notif-title">Vex ${this._esc(info.latest)} is available</div>
        <div class="update-notif-sub">You're on ${this._esc(info.current)} — download the new version</div>
      </div>
      <div class="update-notif-actions">
        <button class="update-btn-dl" id="update-get-btn">Download</button>
        <button class="update-btn-later" id="update-skip-btn">Later</button>
      </div>`;
    document.body.appendChild(el);
    requestAnimationFrame(() => el.classList.add('show'));
    const close = () => { el.classList.remove('show'); setTimeout(() => el.remove(), 300); };
    document.getElementById('update-get-btn')?.addEventListener('click', () => {
      const url = info.downloadUrl || info.url;
      // Without this, a release with no asset URL opened an "undefined" tab and
      // the toast still announced a download that was never going to happen.
      if (!/^https:\/\//i.test(String(url || ''))) {
        window.showToast?.('This release has no download link yet — get it from the Vex releases page', 'error', 6000);
        return;
      }
      try {
        if (typeof TabManager !== 'undefined' && TabManager.createTab) TabManager.createTab(url, true);
        else window.open(url, '_blank');
      } catch { window.open(url, '_blank'); }
      window.showToast?.('Downloading Vex ' + info.latest + '… run the installer when it finishes', 'info', 4000);
      close();
    });
    document.getElementById('update-skip-btn')?.addEventListener('click', close);
  },

  _showAvailable(info) {
    let el = document.getElementById('update-notification');
    if (el) el.remove();

    el = document.createElement('div');
    el.id = 'update-notification';
    el.className = 'update-notif';
    el.innerHTML = `
      <div class="update-notif-icon">&#127881;</div>
      <div class="update-notif-body">
        <div class="update-notif-title">Vex ${this._esc(info.version)} available</div>
        <div class="update-notif-sub">A new version is ready to download</div>
      </div>
      <div class="update-notif-actions">
        <button class="update-btn-dl" id="update-dl-btn">Download</button>
        <button class="update-btn-later" id="update-later-btn">Later</button>
      </div>
    `;
    document.body.appendChild(el);
    requestAnimationFrame(() => el.classList.add('show'));

    document.getElementById('update-dl-btn')?.addEventListener('click', () => {
      el.querySelector('.update-notif-actions').innerHTML =
        '<div class="update-progress-wrap"><div class="update-progress-bar"><div class="update-progress-fill" id="upd-fill"></div></div><span class="update-progress-text" id="upd-text">0%</span></div>';
      window.vex.downloadUpdate?.();
    });
    document.getElementById('update-later-btn')?.addEventListener('click', () => {
      el.classList.remove('show');
      setTimeout(() => el.remove(), 300);
    });
  },

  _updateProgress(p) {
    const fill = document.getElementById('upd-fill');
    const text = document.getElementById('upd-text');
    // electron-updater reports fractional percentages (12.3456), which rendered
    // verbatim as "12.3456%".
    const pct = Math.max(0, Math.min(100, Math.round(Number(p && p.percent) || 0)));
    if (fill) fill.style.width = pct + '%';
    if (text) text.textContent = pct + '%';
  },

  // Replace whatever the notification is showing with the failure, and leave a
  // way to retry. Called for any electron-updater error, including one that
  // arrives mid-download.
  _showError(err) {
    const message = (err && err.message) || 'Update failed';
    console.warn('[Update] Error:', message);
    const el = document.getElementById('update-notification');
    if (!el) { window.showToast?.('Update failed — ' + message, 'error', 6000); return; }
    const body = el.querySelector('.update-notif-body');
    const actions = el.querySelector('.update-notif-actions');
    if (body) body.innerHTML = `<div class="update-notif-title">Update failed</div><div class="update-notif-sub">${this._esc(message)}</div>`;
    if (actions) {
      actions.innerHTML = '<button class="update-btn-dl" id="upd-retry">Try again</button><button class="update-btn-later" id="upd-err-close">Close</button>';
      document.getElementById('upd-retry')?.addEventListener('click', () => { el.remove(); this.checkManually(); });
      document.getElementById('upd-err-close')?.addEventListener('click', () => {
        el.classList.remove('show');
        setTimeout(() => el.remove(), 300);
      });
    }
  },

  _showReady(info) {
    const el = document.getElementById('update-notification');
    if (!el) return;
    el.querySelector('.update-notif-body').innerHTML =
      `<div class="update-notif-title">Vex ${this._esc(info.version)} ready</div><div class="update-notif-sub">Restart to apply</div>`;
    el.querySelector('.update-notif-actions').innerHTML =
      '<button class="update-btn-dl" id="upd-install">Restart Now</button><button class="update-btn-later" id="upd-install-later">Later</button>';
    document.getElementById('upd-install')?.addEventListener('click', () => window.vex.installUpdate?.());
    document.getElementById('upd-install-later')?.addEventListener('click', () => {
      el.classList.remove('show');
      setTimeout(() => el.remove(), 300);
    });
  },

  async checkManually() {
    const result = await window.vex.checkForUpdates?.();
    if (result?.ok && result.hasUpdate) this._showDownloadPrompt(result);
    else if (result?.ok) window.showToast?.('You\'re running the latest version');
    else window.showToast?.('Couldn\'t check for updates: ' + (result?.error || 'network error'), 'error', 5000);
    return result;
  },

  _esc(s) { return window.escapeHtml(s); }
};

// Exported the same way every other renderer module is, so the update flow can
// be exercised from tests instead of only existing as a script-scoped const.
if (typeof window !== 'undefined') window.UpdateNotifier = UpdateNotifier;
if (typeof module !== 'undefined' && module.exports) module.exports = { UpdateNotifier };

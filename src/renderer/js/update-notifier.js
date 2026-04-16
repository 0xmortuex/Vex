// === Vex Update Notifier ===

const UpdateNotifier = {
  init() {
    window.vex.onUpdateAvailable?.((info) => this._showAvailable(info));
    window.vex.onUpdateDownloadProgress?.((p) => this._updateProgress(p));
    window.vex.onUpdateDownloaded?.((info) => this._showReady(info));
    window.vex.onUpdateError?.((err) => console.log('[Update] Error:', err.message));
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
    if (fill) fill.style.width = p.percent + '%';
    if (text) text.textContent = p.percent + '%';
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
    if (result?.ok && !result.info?.updateInfo) {
      window.showToast?.('You\'re running the latest version');
    }
    return result;
  },

  _esc(s) { const d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML; }
};

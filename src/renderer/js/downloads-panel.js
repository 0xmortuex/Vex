// === Vex Downloads Manager + Panel ===
// - Subscribes to download events globally at startup (not panel-open) so
//   downloads started before the panel is first viewed are still captured.
// - Shows toasts for start/complete, keeps a sidebar badge count.
// - Panel lists history with open/show-in-folder/remove actions.

const DownloadsPanel = {
  STORAGE_KEY: 'vex.downloads',
  downloads: [],
  activeDownloads: new Map(),
  _panelEl: null,
  _wired: false,

  // Called once, as early as possible (app.js on DOMContentLoaded)
  bootstrap() {
    if (this._wired) return;
    this._wired = true;
    const saved = localStorage.getItem(this.STORAGE_KEY);
    if (saved) { try { this.downloads = JSON.parse(saved) || []; } catch {} }
    // Any download left in 'progressing' from a previous session is stale
    this.downloads.forEach(d => { if (d.state === 'progressing') d.state = 'interrupted'; });

    window.vex?.onDownloadStarted?.((data) => this._onStart(data));
    window.vex?.onDownloadProgress?.((data) => this._onProgress(data));
    window.vex?.onDownloadComplete?.((data) => this._onComplete(data));

    this._updateBadge();
  },

  // Called the first time the user opens the Downloads sidebar panel
  init() {
    this.bootstrap();
    const panel = document.getElementById('panel-downloads');
    if (!panel) return;
    this._panelEl = panel;
    if (!panel.dataset.rendered) {
      panel.dataset.rendered = 'true';
      this._renderShell(panel);
    }
    this.renderList();
  },

  _onStart(data) {
    const dl = {
      id: data.id || ('dl_' + Date.now()),
      filename: data.fileName || data.filename || 'download',
      url: data.url || '',
      totalBytes: data.totalBytes || 0,
      receivedBytes: 0,
      state: 'progressing',
      path: data.path || '',
      startedAt: data.startedAt || new Date().toISOString()
    };
    this.downloads.unshift(dl);
    this.activeDownloads.set(dl.id, dl);
    this.save();
    this.renderList();
    this._updateBadge();
    window.showToast?.(`Downloading ${dl.filename}…`, 'info', 2500);
  },

  _onProgress(data) {
    const dl = this.activeDownloads.get(data.id);
    if (!dl) return;
    dl.receivedBytes = data.receivedBytes || 0;
    if (data.totalBytes) dl.totalBytes = data.totalBytes;
    if (data.state) dl.state = data.state === 'interrupted' ? 'interrupted' : 'progressing';
    this._patchRow(dl);
  },

  _onComplete(data) {
    const dl = this.activeDownloads.get(data.id) || this.downloads.find(d => d.id === data.id);
    if (!dl) return;
    dl.state = data.state === 'completed' ? 'completed' : (data.state || 'failed');
    if (dl.state === 'completed') dl.receivedBytes = dl.totalBytes;
    if (data.path) dl.path = data.path;
    this.activeDownloads.delete(data.id);
    this.save();
    this.renderList();
    this._updateBadge();

    if (dl.state === 'completed') {
      window.showToast?.(`\u2713 ${dl.filename} downloaded`, 'success', 4000);
    } else if (dl.state === 'cancelled') {
      window.showToast?.(`Download cancelled: ${dl.filename}`, 'info');
    } else {
      window.showToast?.(`Download failed: ${dl.filename}`, 'error');
    }
  },

  save() {
    if (this.downloads.length > 100) this.downloads.length = 100;
    try { localStorage.setItem(this.STORAGE_KEY, JSON.stringify(this.downloads)); } catch {}
  },

  _updateBadge() {
    const icon = document.querySelector('.sidebar-icon[data-panel="downloads"]');
    if (!icon) return;
    const active = this.downloads.filter(d => d.state === 'progressing').length;
    let badge = icon.querySelector('.icon-badge');
    if (active > 0) {
      if (!badge) {
        badge = document.createElement('span');
        badge.className = 'icon-badge';
        icon.style.position = icon.style.position || 'relative';
        icon.appendChild(badge);
      }
      badge.textContent = active;
    } else if (badge) {
      badge.remove();
    }
  },

  _renderShell(panel) {
    panel.innerHTML = `
      <div class="downloads-container">
        <div class="downloads-header">
          <h2>Downloads</h2>
          <div class="downloads-actions">
            <button class="btn-link" id="btn-open-dl-folder">Open downloads folder</button>
            <button class="downloads-clear-btn" id="downloads-clear-btn">Clear finished</button>
          </div>
        </div>
        <div class="downloads-list" id="downloads-list"></div>
      </div>
    `;
    panel.querySelector('#btn-open-dl-folder')?.addEventListener('click', () => window.vex.downloadsOpenFolder?.());
    panel.querySelector('#downloads-clear-btn')?.addEventListener('click', () => {
      this.downloads = this.downloads.filter(d => d.state === 'progressing');
      this.save();
      this.renderList();
      this._updateBadge();
    });
  },

  renderList() {
    const list = document.getElementById('downloads-list');
    if (!list) return;
    if (this.downloads.length === 0) {
      list.innerHTML = '<div class="downloads-empty">No downloads yet</div>';
      return;
    }
    list.innerHTML = this.downloads.map(dl => this._rowHtml(dl)).join('');
    list.querySelectorAll('[data-action="open-file"]').forEach(b => b.addEventListener('click', () => window.vex.downloadsOpenFile?.(b.dataset.path)));
    list.querySelectorAll('[data-action="show-in-folder"]').forEach(b => b.addEventListener('click', () => window.vex.downloadsShowInFolder?.(b.dataset.path)));
    list.querySelectorAll('[data-action="remove"]').forEach(b => b.addEventListener('click', () => {
      this.downloads = this.downloads.filter(d => d.id !== b.dataset.id);
      this.activeDownloads.delete(b.dataset.id);
      this.save();
      this.renderList();
      this._updateBadge();
    }));
  },

  // Update a single row's progress bar without full re-render (smoother).
  _patchRow(dl) {
    const row = document.querySelector(`.download-item[data-id="${dl.id}"]`);
    if (!row) { this.renderList(); return; }
    const pct = dl.totalBytes > 0 ? Math.round((dl.receivedBytes / dl.totalBytes) * 100) : 0;
    const bar = row.querySelector('.download-progress-bar');
    if (bar) bar.style.width = pct + '%';
    const meta = row.querySelector('.download-meta');
    if (meta) {
      const size = this.formatBytes(dl.totalBytes);
      const date = new Date(dl.startedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
      meta.innerHTML = `${size} &middot; ${date} &middot; ${pct}% (${this.formatBytes(dl.receivedBytes)})`;
    }
  },

  _rowHtml(dl) {
    const isActive = dl.state === 'progressing';
    const isComplete = dl.state === 'completed';
    const isFailed = dl.state === 'failed' || dl.state === 'cancelled' || dl.state === 'interrupted';
    const pct = dl.totalBytes > 0 ? Math.round((dl.receivedBytes / dl.totalBytes) * 100) : 0;
    const size = this.formatBytes(dl.totalBytes);
    const date = new Date(dl.startedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    const metaText = isActive
      ? `${size} &middot; ${date} &middot; ${pct}% (${this.formatBytes(dl.receivedBytes)})`
      : `${size} &middot; ${date}${isComplete ? ' &middot; completed' : isFailed ? ' &middot; failed' : ''}`;

    return `
      <div class="download-item ${dl.state}" data-id="${this._esc(dl.id)}">
        <div class="download-icon${isComplete ? ' complete' : ''}${isFailed ? ' failed' : ''}">
          ${isActive
            ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>'
            : isComplete
              ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>'
              : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>'}
        </div>
        <div class="download-info">
          <div class="download-filename">${this._esc(dl.filename)}</div>
          <div class="download-meta">${metaText}</div>
          ${isActive ? `<div class="download-progress"><div class="download-progress-bar" style="width:${pct}%"></div></div>` : ''}
        </div>
        <div class="download-actions">
          ${isComplete ? `
            <button class="dl-btn" data-action="open-file" data-path="${this._esc(dl.path)}" title="Open file">Open</button>
            <button class="dl-btn" data-action="show-in-folder" data-path="${this._esc(dl.path)}" title="Show in folder">\ud83d\udcc1</button>
          ` : ''}
          <button class="dl-btn" data-action="remove" data-id="${this._esc(dl.id)}" title="Remove from list">\u2715</button>
        </div>
      </div>
    `;
  },

  formatBytes(bytes) {
    if (!bytes || bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  },

  _esc(s) { const d = document.createElement('div'); d.textContent = s == null ? '' : String(s); return d.innerHTML; }
};

window.DownloadsPanel = DownloadsPanel;

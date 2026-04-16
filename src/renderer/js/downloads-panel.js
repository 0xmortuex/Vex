// === Vex Downloads Manager ===

const DownloadsPanel = {
  STORAGE_KEY: 'vex.downloads',
  downloads: [],
  activeDownloads: new Map(),

  init() {
    const panel = document.getElementById('panel-downloads');
    if (!panel || panel.dataset.rendered) return;
    panel.dataset.rendered = 'true';

    const saved = localStorage.getItem(this.STORAGE_KEY);
    if (saved) { try { this.downloads = JSON.parse(saved); } catch {} }

    this.render(panel);
    this.setupIPC();
  },

  save() {
    // Keep last 100
    if (this.downloads.length > 100) this.downloads.length = 100;
    localStorage.setItem(this.STORAGE_KEY, JSON.stringify(this.downloads));
  },

  setupIPC() {
    window.vex?.onDownloadStarted?.((event, data) => {
      const dl = {
        id: data.id || Date.now().toString(),
        filename: data.fileName,
        url: data.url || '',
        totalBytes: data.totalBytes || 0,
        receivedBytes: 0,
        state: 'progressing',
        path: data.path || '',
        startedAt: new Date().toISOString()
      };
      this.downloads.unshift(dl);
      this.activeDownloads.set(dl.id, dl);
      this.save();
      this.renderList();
    });

    window.vex?.onDownloadProgress?.((event, data) => {
      const dl = this.activeDownloads.get(data.id);
      if (dl) {
        dl.receivedBytes = data.receivedBytes;
        dl.state = data.state;
        this.renderList();
      }
    });

    window.vex?.onDownloadComplete?.((event, data) => {
      const dl = this.activeDownloads.get(data.id) || this.downloads.find(d => d.id === data.id);
      if (dl) {
        dl.state = data.state === 'completed' ? 'completed' : 'failed';
        dl.receivedBytes = dl.totalBytes;
        if (data.path) dl.path = data.path;
        this.activeDownloads.delete(data.id);
        this.save();
        this.renderList();
      }
    });
  },

  render(panel) {
    panel.innerHTML = `
      <div class="downloads-container">
        <div class="downloads-header">
          <h2>Downloads</h2>
          <button class="downloads-clear-btn" id="downloads-clear-btn">Clear completed</button>
        </div>
        <div class="downloads-list" id="downloads-list"></div>
      </div>
    `;

    document.getElementById('downloads-clear-btn')?.addEventListener('click', () => {
      this.downloads = this.downloads.filter(d => d.state === 'progressing');
      this.save();
      this.renderList();
    });

    this.renderList();
  },

  renderList() {
    const list = document.getElementById('downloads-list');
    if (!list) return;

    if (this.downloads.length === 0) {
      list.innerHTML = '<div class="downloads-empty">No downloads yet</div>';
      return;
    }

    list.innerHTML = this.downloads.map(dl => {
      const isActive = dl.state === 'progressing';
      const isComplete = dl.state === 'completed';
      const isFailed = dl.state === 'failed' || dl.state === 'cancelled';
      const pct = dl.totalBytes > 0 ? Math.round((dl.receivedBytes / dl.totalBytes) * 100) : 0;
      const size = this.formatBytes(dl.totalBytes);
      const date = new Date(dl.startedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

      return `
        <div class="download-item" data-id="${dl.id}">
          <div class="download-icon${isComplete ? ' complete' : ''}${isFailed ? ' failed' : ''}">
            ${isActive ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>' :
              isComplete ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>' :
              '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>'}
          </div>
          <div class="download-info">
            <div class="download-filename">${this._esc(dl.filename)}</div>
            <div class="download-meta">${size} &middot; ${date}${isActive ? ' &middot; ' + pct + '%' : ''}</div>
            ${isActive ? `<div class="download-progress"><div class="download-progress-bar" style="width:${pct}%"></div></div>` : ''}
          </div>
        </div>
      `;
    }).join('');
  },

  formatBytes(bytes) {
    if (!bytes || bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  },

  _esc(s) { const d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML; }
};

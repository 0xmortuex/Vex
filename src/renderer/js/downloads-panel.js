// === Vex Downloads Manager + Panel ===
// - Subscribes to download events globally at startup (not panel-open) so
//   downloads started before the panel is first viewed are still captured.
// - Shows toasts for start/complete, keeps a sidebar badge count.
// - Panel lists history with pause/resume/cancel while a transfer runs, and
//   open / show-in-folder / retry / remove once it has finished.

const DownloadsPanel = {
  STORAGE_KEY: 'vex.downloads',
  downloads: [],
  activeDownloads: new Map(),
  _panelEl: null,
  _wired: false,

  // Inline icons. No emoji anywhere in this panel: these follow the theme via
  // currentColor, which a glyph from a colour font never does.
  ICONS: {
    download: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>',
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>',
    failed: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>',
    folder: '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>',
    close: '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
    pause: '<svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>',
    resume: '<svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor"><path d="M8 5.5v13l11-6.5z"/></svg>',
    retry: '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>'
  },

  // Called once, as early as possible (app.js on DOMContentLoaded)
  bootstrap() {
    if (this._wired) return;
    this._wired = true;
    const saved = localStorage.getItem(this.STORAGE_KEY);
    if (saved) {
      try { this.downloads = JSON.parse(saved) || []; }
      catch (err) { console.warn('[Downloads] stored history was unreadable, starting empty:', err.message); this.downloads = []; }
    }
    if (!Array.isArray(this.downloads)) this.downloads = [];
    // Any download left in 'progressing' from a previous session is stale
    this.downloads.forEach(d => { if (d.state === 'progressing') { d.state = 'interrupted'; d.paused = false; } });

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
    // Every later event is matched by id. A start event without one would leave
    // an orphan row that never progresses or completes, so say so rather than
    // inventing an id that nothing else will ever use.
    if (!data || !data.id) { console.error('[Downloads] start event has no id; ignoring', data); return; }
    const dl = {
      id: data.id,
      filename: data.fileName || data.filename || 'download',
      url: data.url || '',
      totalBytes: data.totalBytes || 0,
      receivedBytes: 0,
      state: 'progressing',
      paused: false,
      canResume: false,
      path: data.path || '',
      startedAt: data.startedAt || new Date().toISOString()
    };
    this.downloads.unshift(dl);
    this.activeDownloads.set(dl.id, dl);
    this.save();
    this._prependRow(dl);
    this._updateBadge();
    window.showToast?.(`Downloading ${dl.filename}…`, 'info', 2500);
  },

  _onProgress(data) {
    const dl = this.activeDownloads.get(data.id);
    if (!dl) return;
    dl.receivedBytes = data.receivedBytes || 0;
    if (data.totalBytes) dl.totalBytes = data.totalBytes;
    const wasPaused = dl.paused;
    dl.paused = !!data.paused;
    dl.canResume = !!data.canResume;
    if (data.state) dl.state = data.state === 'interrupted' ? 'interrupted' : 'progressing';
    // Pausing swaps which buttons the row needs, so rebuild it; otherwise just
    // move the bar, which is far cheaper and doesn't fight the CSS transition.
    if (wasPaused !== dl.paused) this._replaceRow(dl);
    else this._patchRow(dl);
  },

  _onComplete(data) {
    const dl = this.activeDownloads.get(data.id) || this.downloads.find(d => d.id === data.id);
    if (!dl) return;
    dl.state = data.state === 'completed' ? 'completed' : (data.state || 'failed');
    dl.paused = false;
    dl.canResume = false;
    // Trust the counts the item actually reported. Servers that send no
    // Content-Length leave totalBytes at 0 all the way through, and copying that
    // zero over the received count rendered a finished download as "0 B".
    if (Number.isFinite(data.receivedBytes) && data.receivedBytes > 0) dl.receivedBytes = data.receivedBytes;
    if (Number.isFinite(data.totalBytes) && data.totalBytes > 0) dl.totalBytes = data.totalBytes;
    if (dl.state === 'completed' && !(dl.totalBytes > 0)) dl.totalBytes = dl.receivedBytes;
    if (data.path) dl.path = data.path;
    if (data.url && !dl.url) dl.url = data.url;
    this.activeDownloads.delete(data.id);
    this.save();
    this._replaceRow(dl);
    this._updateBadge();

    if (dl.state === 'completed') {
      window.DownloadToast?.show({
        filename: dl.filename,
        path: dl.path,
        size: dl.totalBytes || dl.receivedBytes || 0
      });
    } else if (dl.state === 'cancelled') {
      window.showToast?.(`Download cancelled: ${dl.filename}`, 'info');
    } else {
      window.showToast?.(`Download failed: ${dl.filename}`, 'error');
    }
  },

  save() {
    // Trim from the END (oldest), and never drop a transfer that is still
    // running — truncating the array head-first used to evict live downloads.
    if (this.downloads.length > 100) {
      const keep = this.downloads.filter(d => d.state === 'progressing');
      const rest = this.downloads.filter(d => d.state !== 'progressing').slice(0, Math.max(0, 100 - keep.length));
      this.downloads = this.downloads.filter(d => keep.includes(d) || rest.includes(d));
    }
    try { localStorage.setItem(this.STORAGE_KEY, JSON.stringify(this.downloads)); }
    catch (err) { console.error('[Downloads] could not persist history:', err.message); }
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
      list.innerHTML = window.VexUI
        ? '<div class="downloads-empty">' + VexUI.emptyState('download', 'No downloads yet', 'Files you download will appear here') + '</div>'
        : '<div class="downloads-empty">No downloads yet</div>';
      return;
    }
    list.innerHTML = this.downloads.map(dl => this._rowHtml(dl)).join('');
    list.querySelectorAll('.download-item').forEach(row => this._bindRowActions(row));
  },

  // Ask main to pause/resume/cancel. Main owns the only handle to the live
  // DownloadItem; a refusal (already finished, not resumable) is reported rather
  // than dropped, or the button looks broken.
  // `quiet` is used by Remove, where the download finishing a moment before the
  // click is normal and must not produce an error toast for a row the user was
  // deleting anyway.
  async _control(id, action, quiet) {
    const result = await window.vex.downloadsControl?.(id, action);
    if (!result) { if (!quiet) window.showToast?.('Download controls are unavailable', 'error'); return; }
    if (!result.ok) {
      if (!quiet) window.showToast?.(result.error || 'Could not ' + action + ' that download', 'error');
      // Main no longer has the item: our row is stale. Reconcile it.
      const dl = this.activeDownloads.get(id);
      if (dl && dl.state === 'progressing') { dl.state = 'interrupted'; this.activeDownloads.delete(id); this.save(); this._replaceRow(dl); this._updateBadge(); }
      return;
    }
    const dl = this.activeDownloads.get(id);
    if (dl && (action === 'pause' || action === 'resume')) { dl.paused = action === 'pause'; this._replaceRow(dl); }
  },

  async _retry(id) {
    const dl = this.downloads.find(d => d.id === id);
    if (!dl || !dl.url) { window.showToast?.('No source URL saved for that download', 'error'); return; }
    const result = await window.vex.downloadsRetry?.(dl.url);
    if (!result || !result.ok) window.showToast?.((result && result.error) || 'Could not restart that download', 'error');
  },

  // Wire up a single row's action buttons (used by renderList and the
  // incremental _prependRow/_replaceRow paths).
  _bindRowActions(rowEl) {
    rowEl.querySelectorAll('[data-action="open-file"]').forEach(b => b.addEventListener('click', async () => {
      const result = await window.vex.downloadsOpenFile?.(b.dataset.path);
      if (result && !result.ok) window.showToast?.(result.error || 'Could not open that file', 'error');
    }));
    rowEl.querySelectorAll('[data-action="show-in-folder"]').forEach(b => b.addEventListener('click', () => window.vex.downloadsShowInFolder?.(b.dataset.path)));
    rowEl.querySelectorAll('[data-action="pause"]').forEach(b => b.addEventListener('click', () => this._control(b.dataset.id, 'pause')));
    rowEl.querySelectorAll('[data-action="resume"]').forEach(b => b.addEventListener('click', () => this._control(b.dataset.id, 'resume')));
    rowEl.querySelectorAll('[data-action="cancel"]').forEach(b => b.addEventListener('click', () => this._control(b.dataset.id, 'cancel')));
    rowEl.querySelectorAll('[data-action="retry"]').forEach(b => b.addEventListener('click', () => this._retry(b.dataset.id)));
    rowEl.querySelectorAll('[data-action="remove"]').forEach(b => b.addEventListener('click', () => {
      const id = b.dataset.id;
      // Removing a row that is still downloading should stop the transfer too,
      // not leave it running invisibly with no way to reach it again.
      if (this.activeDownloads.has(id)) this._control(id, 'cancel', true);
      this.downloads = this.downloads.filter(d => d.id !== id);
      this.activeDownloads.delete(id);
      this.save();
      this.renderList();
      this._updateBadge();
    }));
  },

  // Find a row by download id without trusting the id to be selector-safe.
  _rowFor(id) {
    const list = document.getElementById('downloads-list');
    if (!list) return null;
    return [...list.querySelectorAll('.download-item')].find(row => row.dataset.id === id) || null;
  },

  // Build a row element from _rowHtml without re-rendering the whole list.
  _buildRow(dl) {
    const tmp = document.createElement('div');
    tmp.innerHTML = this._rowHtml(dl);
    return tmp.firstElementChild;
  },

  // Prepend a new download's row (full renderList only when leaving the empty state).
  _prependRow(dl) {
    const list = document.getElementById('downloads-list');
    if (!list) return;
    if (list.querySelector('.downloads-empty')) { this.renderList(); return; }
    const row = this._buildRow(dl);
    list.prepend(row);
    this._bindRowActions(row);
  },

  // Swap a finished download's row in place (buttons differ between states).
  _replaceRow(dl) {
    const row = this._rowFor(dl.id);
    if (!row) { this.renderList(); return; }
    const newRow = this._buildRow(dl);
    row.replaceWith(newRow);
    this._bindRowActions(newRow);
  },

  // Update a single row's progress bar without full re-render (smoother).
  _patchRow(dl) {
    const row = this._rowFor(dl.id);
    if (!row) { this.renderList(); return; }
    const bar = row.querySelector('.download-progress-bar');
    if (bar) bar.style.width = this._percent(dl) + '%';
    const meta = row.querySelector('.download-meta');
    if (meta) meta.innerHTML = this._metaText(dl);
  },

  _percent(dl) { return dl.totalBytes > 0 ? Math.min(100, Math.round((dl.receivedBytes / dl.totalBytes) * 100)) : 0; },

  _metaText(dl) {
    const isActive = dl.state === 'progressing';
    const date = new Date(dl.startedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    if (isActive) {
      // With no Content-Length there is no percentage to show — report what has
      // arrived instead of a permanent, meaningless "0%".
      const progress = dl.totalBytes > 0
        ? `${this.formatBytes(dl.totalBytes)} &middot; ${this._percent(dl)}% (${this.formatBytes(dl.receivedBytes)})`
        : `${this.formatBytes(dl.receivedBytes)} downloaded`;
      return `${progress} &middot; ${date}${dl.paused ? ' &middot; paused' : ''}`;
    }
    const size = this.formatBytes(dl.totalBytes || dl.receivedBytes);
    const label = dl.state === 'completed' ? ' &middot; completed'
      : dl.state === 'cancelled' ? ' &middot; cancelled'
      : dl.state === 'interrupted' ? ' &middot; interrupted'
      : dl.state === 'failed' ? ' &middot; failed' : '';
    return `${size} &middot; ${date}${label}`;
  },

  _rowHtml(dl) {
    const isActive = dl.state === 'progressing';
    const isComplete = dl.state === 'completed';
    const isFailed = dl.state === 'failed' || dl.state === 'cancelled' || dl.state === 'interrupted';
    const pct = this._percent(dl);
    const id = this._esc(dl.id);

    const icon = isActive ? this.ICONS.download : isComplete ? this.ICONS.check : this.ICONS.failed;
    let actions = '';
    if (isActive) {
      actions = dl.paused
        ? `<button class="dl-btn" data-action="resume" data-id="${id}" title="Resume" aria-label="Resume download">${this.ICONS.resume}</button>`
        : `<button class="dl-btn" data-action="pause" data-id="${id}" title="Pause" aria-label="Pause download">${this.ICONS.pause}</button>`;
      actions += `<button class="dl-btn" data-action="cancel" data-id="${id}" title="Cancel" aria-label="Cancel download">${this.ICONS.close}</button>`;
    } else if (isComplete) {
      actions = `<button class="dl-btn" data-action="open-file" data-path="${this._esc(dl.path)}" title="Open file">Open</button>
            <button class="dl-btn" data-action="show-in-folder" data-path="${this._esc(dl.path)}" title="Show in folder" aria-label="Show in folder">${this.ICONS.folder}</button>`;
    } else if (isFailed && dl.url) {
      actions = `<button class="dl-btn" data-action="retry" data-id="${id}" title="Try this download again" aria-label="Retry download">${this.ICONS.retry}</button>`;
    }

    return `
      <div class="download-item ${dl.state}${dl.paused ? ' paused' : ''}" data-id="${id}">
        <div class="download-icon${isComplete ? ' complete' : ''}${isFailed ? ' failed' : ''}">${icon}</div>
        <div class="download-info">
          <div class="download-filename">${this._esc(dl.filename)}</div>
          <div class="download-meta">${this._metaText(dl)}</div>
          ${isActive ? `<div class="download-progress"><div class="download-progress-bar" style="width:${pct}%"></div></div>` : ''}
        </div>
        <div class="download-actions">
          ${actions}
          <button class="dl-btn" data-action="remove" data-id="${id}" title="Remove from list" aria-label="Remove from list">${this.ICONS.close}</button>
        </div>
      </div>
    `;
  },

  formatBytes(bytes) {
    if (!bytes || bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
    const i = Math.min(Math.floor(Math.log(bytes) / Math.log(k)), sizes.length - 1);
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  },

  _esc(s) { return window.escapeHtml(s); }
};

if (typeof window !== 'undefined') window.DownloadsPanel = DownloadsPanel;
if (typeof module !== 'undefined' && module.exports) module.exports = { DownloadsPanel };

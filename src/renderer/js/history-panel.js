// === Vex Browsing History Panel ===

const HistoryPanel = {
  STORAGE_KEY: 'vex.history',
  MAX_ENTRIES: 5000,
  entries: [],
  activeFilter: 'all',

  init() {
    const panel = document.getElementById('panel-history');
    if (!panel || panel.dataset.rendered) return;
    panel.dataset.rendered = 'true';

    const saved = localStorage.getItem(this.STORAGE_KEY);
    if (saved) { try { this.entries = JSON.parse(saved); } catch {} }

    panel.innerHTML = `
      <div class="history-container">
        <div class="history-header">
          <h2>History</h2>
          <div class="history-search">
            <input type="text" id="history-search-input" placeholder="Search history...">
          </div>
          <div class="history-filters">
            <button class="history-filter active" data-filter="all">All time</button>
            <button class="history-filter" data-filter="today">Today</button>
            <button class="history-filter" data-filter="yesterday">Yesterday</button>
            <button class="history-filter" data-filter="week">Last 7 days</button>
            <button class="history-filter" data-filter="month">Last 30 days</button>
          </div>
        </div>
        <div class="history-list" id="history-list"></div>
        <div class="history-footer">
          <button class="history-clear-btn" id="history-clear-btn">Clear History...</button>
        </div>
      </div>
    `;

    document.getElementById('history-search-input')?.addEventListener('input', () => this.renderList());

    panel.querySelectorAll('.history-filter').forEach(btn => {
      btn.addEventListener('click', () => {
        panel.querySelectorAll('.history-filter').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.activeFilter = btn.dataset.filter;
        this.renderList();
      });
    });

    document.getElementById('history-clear-btn')?.addEventListener('click', () => {
      if (confirm('Clear all browsing history?')) {
        this.entries = [];
        this.save();
        this.renderList();
        window.showToast?.('History cleared');
      }
    });

    this.renderList();
  },

  save() {
    if (this.entries.length > this.MAX_ENTRIES) this.entries.length = this.MAX_ENTRIES;
    localStorage.setItem(this.STORAGE_KEY, JSON.stringify(this.entries));
  },

  addEntry(url, title, favicon) {
    if (!url || url.startsWith('file://') || url.startsWith('about:') || url.startsWith('vex://')) return;
    // Dedupe: don't log if same as last entry
    if (this.entries.length > 0 && this.entries[0].url === url) return;

    this.entries.unshift({
      id: 'h_' + Date.now(),
      url, title: title || url, favicon: favicon || '',
      visitedAt: new Date().toISOString()
    });
    this.save();
  },

  deleteEntry(id) {
    this.entries = this.entries.filter(e => e.id !== id);
    this.save();
    this.renderList();
  },

  getFiltered() {
    const search = document.getElementById('history-search-input')?.value.toLowerCase() || '';
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    return this.entries.filter(e => {
      // Search filter
      if (search && !e.title.toLowerCase().includes(search) && !e.url.toLowerCase().includes(search)) return false;

      // Date filter
      const d = new Date(e.visitedAt);
      if (this.activeFilter === 'today') return d >= startOfToday;
      if (this.activeFilter === 'yesterday') {
        const yesterday = new Date(startOfToday); yesterday.setDate(yesterday.getDate() - 1);
        return d >= yesterday && d < startOfToday;
      }
      if (this.activeFilter === 'week') {
        const weekAgo = new Date(now); weekAgo.setDate(weekAgo.getDate() - 7);
        return d >= weekAgo;
      }
      if (this.activeFilter === 'month') {
        const monthAgo = new Date(now); monthAgo.setDate(monthAgo.getDate() - 30);
        return d >= monthAgo;
      }
      return true;
    });
  },

  renderList() {
    const list = document.getElementById('history-list');
    if (!list) return;

    const filtered = this.getFiltered();
    if (filtered.length === 0) {
      list.innerHTML = '<div class="history-empty">No history found</div>';
      return;
    }

    // Group by date
    const groups = {};
    filtered.forEach(e => {
      const d = new Date(e.visitedAt);
      const key = d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
      if (!groups[key]) groups[key] = [];
      groups[key].push(e);
    });

    list.innerHTML = Object.entries(groups).map(([date, items]) => `
      <div class="history-date-group">
        <div class="history-date-label">${date}</div>
        ${items.slice(0, 100).map(e => {
          const time = new Date(e.visitedAt).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
          const favicon = e.favicon || `https://www.google.com/s2/favicons?domain=${new URL(e.url).hostname}&sz=32`;
          return `
            <div class="history-item" data-id="${e.id}" data-url="${this._esc(e.url)}">
              <img src="${favicon}" alt="" onerror="this.style.display='none'">
              <div class="history-item-info">
                <div class="history-item-title">${this._esc(e.title)}</div>
                <div class="history-item-url">${this._esc(e.url)}</div>
              </div>
              <span class="history-item-time">${time}</span>
              <button class="history-item-delete" title="Delete">
                <svg width="10" height="10" viewBox="0 0 10 10"><path d="M2 2L8 8M8 2L2 8" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>
              </button>
            </div>`;
        }).join('')}
      </div>
    `).join('');

    list.querySelectorAll('.history-item').forEach(el => {
      el.addEventListener('click', (e) => {
        if (e.target.closest('.history-item-delete')) {
          this.deleteEntry(el.dataset.id);
        } else {
          SidebarManager.hideActivePanel();
          TabManager.createTab(el.dataset.url, true);
        }
      });
    });
  },

  _esc(s) { const d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML; }
};

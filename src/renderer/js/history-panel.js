// === Vex Browsing History Panel ===
// Phase 12: adds AI-powered semantic search mode alongside keyword search.

const HistoryPanel = {
  STORAGE_KEY: 'vex.history',
  AI_WORKER_URL: 'https://vex-ai.mortuexhavoc.workers.dev',
  MAX_ENTRIES: 5000,
  entries: [],
  activeFilter: 'all',
  searchMode: 'keyword', // 'keyword' | 'ai'
  lastAISearch: null,    // { parsed, entries } cached for re-render

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
          <div class="search-mode-toggle">
            <button class="search-mode active" data-mode="keyword">&#128269; Keyword</button>
            <button class="search-mode" data-mode="ai">&#10024; AI Search</button>
          </div>
          <div class="history-search history-search-wrapper">
            <input type="text" id="history-search-input" placeholder="Search history...">
            <button id="history-search-btn" class="search-btn hidden">Search</button>
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

    // Mode toggle
    panel.querySelectorAll('.search-mode').forEach(btn => {
      btn.addEventListener('click', () => {
        panel.querySelectorAll('.search-mode').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.searchMode = btn.dataset.mode;
        const input = document.getElementById('history-search-input');
        const searchBtn = document.getElementById('history-search-btn');
        if (this.searchMode === 'ai') {
          input.placeholder = 'Ask: "that article about DPI last week"...';
          searchBtn?.classList.remove('hidden');
        } else {
          input.placeholder = 'Search history...';
          searchBtn?.classList.add('hidden');
          this.lastAISearch = null;
        }
        this.renderList();
      });
    });

    // Keyword input — live render
    const input = document.getElementById('history-search-input');
    input?.addEventListener('input', () => {
      if (this.searchMode === 'keyword') this.renderList();
    });
    input?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && this.searchMode === 'ai') this.runAISearch(e.target.value);
    });
    document.getElementById('history-search-btn')?.addEventListener('click', () => {
      this.runAISearch(input?.value || '');
    });

    panel.querySelectorAll('.history-filter').forEach(btn => {
      btn.addEventListener('click', () => {
        panel.querySelectorAll('.history-filter').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.activeFilter = btn.dataset.filter;
        this.lastAISearch = null;
        this.renderList();
      });
    });

    document.getElementById('history-clear-btn')?.addEventListener('click', () => {
      if (confirm('Clear all browsing history?')) {
        this.entries = [];
        this.save();
        this.lastAISearch = null;
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
    if (this.entries.length > 0 && this.entries[0].url === url) return;

    this.entries.unshift({
      id: 'h_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
      url, title: title || url, favicon: favicon || '',
      visitedAt: new Date().toISOString(),
      indexed: false
    });
    this.save();
  },

  deleteEntry(id) {
    this.entries = this.entries.filter(e => e.id !== id);
    this.save();
    this.renderList();
  },

  getTimeFiltered() {
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    return this.entries.filter(e => {
      const d = new Date(e.visitedAt);
      if (this.activeFilter === 'today') return d >= startOfToday;
      if (this.activeFilter === 'yesterday') {
        const y = new Date(startOfToday); y.setDate(y.getDate() - 1);
        return d >= y && d < startOfToday;
      }
      if (this.activeFilter === 'week') {
        const w = new Date(now); w.setDate(w.getDate() - 7);
        return d >= w;
      }
      if (this.activeFilter === 'month') {
        const m = new Date(now); m.setDate(m.getDate() - 30);
        return d >= m;
      }
      return true;
    });
  },

  getKeywordFiltered() {
    const search = (document.getElementById('history-search-input')?.value || '').toLowerCase();
    return this.getTimeFiltered().filter(e => {
      if (!search) return true;
      return (e.title || '').toLowerCase().includes(search)
        || (e.url || '').toLowerCase().includes(search)
        || (e.summary || '').toLowerCase().includes(search)
        || (Array.isArray(e.tags) && e.tags.some(t => String(t).toLowerCase().includes(search)));
    });
  },

  renderList() {
    if (this.searchMode === 'ai' && this.lastAISearch) {
      this._renderAIResults(this.lastAISearch.parsed, this.lastAISearch.entries);
      return;
    }
    this._renderKeywordList();
  },

  _renderKeywordList() {
    const list = document.getElementById('history-list');
    if (!list) return;

    const filtered = this.getKeywordFiltered();
    if (filtered.length === 0) {
      list.innerHTML = '<div class="history-empty">No history found</div>';
      return;
    }

    const groups = {};
    filtered.forEach(e => {
      const d = new Date(e.visitedAt);
      const key = d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
      (groups[key] ||= []).push(e);
    });

    list.innerHTML = Object.entries(groups).map(([date, items]) => `
      <div class="history-date-group">
        <div class="history-date-label">${date}</div>
        ${items.slice(0, 100).map(e => {
          const time = new Date(e.visitedAt).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
          let favicon = e.favicon;
          if (!favicon) { try { favicon = `https://www.google.com/s2/favicons?domain=${new URL(e.url).hostname}&sz=32`; } catch {} }
          return `
            <div class="history-item" data-id="${e.id}" data-url="${this._esc(e.url)}">
              <img src="${favicon || ''}" alt="" onerror="this.style.display='none'">
              <div class="history-item-info">
                <div class="history-item-title">${this._esc(e.title)}</div>
                <div class="history-item-url">${this._esc(e.url)}</div>
                ${e.summary ? `<div class="item-summary">${this._esc(e.summary)}</div>` : ''}
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

  async runAISearch(query) {
    if (!query || !query.trim()) return;
    const list = document.getElementById('history-list');
    if (!list) return;
    list.innerHTML = `
      <div class="ai-search-loading">
        <div class="spinner-lg"></div>
        <div class="ai-search-loading-text">Searching through your browsing memory...</div>
      </div>
    `;

    try {
      const scoped = this.getTimeFiltered();
      const compact = scoped.slice(0, 200).map(e => ({
        id: e.id, url: e.url, title: e.title,
        summary: e.summary || '', tags: e.tags || [],
        contentType: e.contentType || '', visitedAt: e.visitedAt
      }));

      const aiResult = await AIRouter.callAI('historySearch', {
        query, historyEntries: compact, timeContext: new Date().toISOString()
      });

      let parsed;
      try {
        const str = String(aiResult.result || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '');
        parsed = JSON.parse(str);
      } catch {
        throw new Error('Could not parse AI response');
      }

      this.lastAISearch = { parsed, entries: scoped };
      this._renderAIResults(parsed, scoped);
    } catch (err) {
      list.innerHTML = `
        <div class="ai-search-error">
          <div>&#9888;&#65039; Search failed</div>
          <div class="error-detail">${this._esc(err.message || String(err))}</div>
        </div>
      `;
    }
  },

  _renderAIResults(parsed, allEntries) {
    const list = document.getElementById('history-list');
    if (!list) return;

    if (!parsed || !Array.isArray(parsed.matches) || parsed.matches.length === 0) {
      list.innerHTML = `
        <div class="ai-search-empty">
          <div class="empty-icon">&#128269;</div>
          <div class="empty-title">No matches found</div>
          <div class="empty-subtitle">${this._esc(parsed?.interpretation || 'Try rephrasing or broadening your query')}</div>
        </div>
      `;
      return;
    }

    let html = '';
    if (parsed.interpretation) {
      html += `<div class="ai-interpretation">&#10024; ${this._esc(parsed.interpretation)}</div>`;
    }
    html += '<div class="ai-search-results">';
    for (const match of parsed.matches) {
      const entry = allEntries.find(e => e.id === match.id);
      if (!entry) continue;
      const relevancePct = Math.round((match.relevanceScore || 0) * 100);
      const timeAgo = this._relativeTime(entry.visitedAt);
      let host = ''; try { host = new URL(entry.url).hostname; } catch {}
      html += `
        <div class="history-item ai-result" data-url="${this._esc(entry.url)}">
          <img src="${host ? `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=32` : ''}" width="20" height="20" onerror="this.style.display='none'">
          <div class="history-item-info item-content">
            <div class="history-item-title item-title">${this._esc(entry.title || 'Untitled')}</div>
            <div class="history-item-url item-url">${this._esc(entry.url)}</div>
            ${entry.summary ? `<div class="item-summary">${this._esc(entry.summary)}</div>` : ''}
            <div class="item-meta">
              <span class="relevance-badge">${relevancePct}% match</span>
              <span class="why-relevant">${this._esc(match.whyRelevant || '')}</span>
              <span class="item-time">${timeAgo}</span>
            </div>
          </div>
        </div>
      `;
    }
    html += '</div>';
    list.innerHTML = html;

    list.querySelectorAll('.history-item').forEach(el => {
      el.addEventListener('click', () => {
        const url = el.dataset.url;
        if (!url) return;
        SidebarManager.hideActivePanel();
        TabManager.createTab(url, true);
      });
    });
  },

  _relativeTime(iso) {
    const date = new Date(iso);
    const diff = Date.now() - date.getTime();
    const mins = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    if (hours < 24) return `${hours}h ago`;
    if (days < 7) return `${days}d ago`;
    return date.toLocaleDateString();
  },

  /** Open panel with AI search mode pre-selected (Ctrl+Shift+H) */
  openInAIMode() {
    if (typeof SidebarManager !== 'undefined') SidebarManager.showPanel?.('history');
    setTimeout(() => {
      const aiBtn = document.querySelector('.search-mode[data-mode="ai"]');
      aiBtn?.click();
      document.getElementById('history-search-input')?.focus();
    }, 50);
  },

  _esc(s) { const d = document.createElement('div'); d.textContent = s == null ? '' : String(s); return d.innerHTML; }
};

window.HistoryPanel = HistoryPanel;

// === Vex Browsing History Panel ===
// Phase 12: adds AI-powered semantic search mode alongside keyword search.

const HistoryPanel = {
  STORAGE_KEY: 'vex.history',
  // Cloud AI routing lives in ai-router.js (backed by VexConfig / Settings).
  AI_WORKER_URL: (typeof window !== 'undefined' && window.VexConfig) ? window.VexConfig.aiWorkerUrl() : '',
  MAX_ENTRIES: 5000,
  entries: [],
  activeFilter: 'all',
  searchMode: 'keyword', // 'keyword' | 'ai'
  lastAISearch: null,    // { parsed, entries } cached for re-render

  init() {
    const panel = document.getElementById('panel-history');
    if (!panel) return;
    // Re-read and re-draw on every open. The panel used to build itself once
    // and never look at storage again, so anything visited while it was closed
    // stayed invisible until the next restart.
    this._hydrate();
    if (panel.dataset.rendered) { this.renderList(); return; }
    panel.dataset.rendered = 'true';

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

    // Keyword input — debounced render (re-rendering thousands of grouped
    // rows on every keystroke is too heavy)
    const input = document.getElementById('history-search-input');
    let searchDebounce = null;
    input?.addEventListener('input', () => {
      if (this.searchMode !== 'keyword') return;
      clearTimeout(searchDebounce);
      searchDebounce = setTimeout(() => this.renderList(), 120);
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

    document.getElementById('history-clear-btn')?.addEventListener('click', async () => {
      if (await vexConfirm({ title: 'Clear history', message: 'Clear all browsing history?', okLabel: 'Clear', danger: true })) {
        this.entries = [];
        this.save();
        this.lastAISearch = null;
        this.renderList();
        window.showToast?.('History cleared');
      }
    });

    this.renderList();
  },

  // The saved list is the source of truth. `entries` used to be filled only
  // when the panel was first opened, so a page visited before that wrote a
  // one-item array over everything saved before it — the whole history, lost
  // on the first visit of every session. Hydrating before any write (and at
  // load, at the bottom of this file) is what stops that.
  _hydrate() {
    let saved = [];
    try { saved = JSON.parse(localStorage.getItem(this.STORAGE_KEY) || '[]'); } catch { saved = []; }
    const list = Array.isArray(saved) ? saved.map(e => this._normalize(e)).filter(Boolean) : [];
    // Newest first, whatever order the writer — or a sync merge — left behind.
    list.sort((a, b) => this._when(b) - this._when(a));
    this.entries = list;
    this._hydrated = true;
    return this.entries;
  },

  // Entries reach this list from two writers with different shapes (ISO
  // `visitedAt` here, epoch `time` in the file store) and from sync, so every
  // read is normalised to one shape.
  _normalize(e) {
    if (!e || typeof e.url !== 'string' || !/^https?:\/\//i.test(e.url)) return null;
    const when = e.visitedAt || (Number.isFinite(e.time) ? new Date(e.time).toISOString() : null);
    return {
      id: e.id || 'h_' + (Date.parse(when || '') || Date.now()) + '_' + Math.random().toString(36).slice(2, 7),
      url: e.url,
      title: typeof e.title === 'string' && e.title ? e.title : e.url,
      favicon: this._safeFavicon(e.favicon),
      visitedAt: when || new Date().toISOString(),
      summary: e.summary, tags: e.tags, contentType: e.contentType, indexed: !!e.indexed,
    };
  },

  // A favicon goes straight into an <img src>, and stored or synced data is not
  // trusted — only real http(s) images get through.
  _safeFavicon(value) {
    return typeof value === 'string' && /^https?:\/\//i.test(value) ? value : '';
  },

  // When a visit happened, whichever writer recorded it.
  _when(e) {
    const d = new Date(e.visitedAt || e.time || 0);
    return Number.isNaN(d.getTime()) ? new Date(0) : d;
  },

  // The one list every history surface should read.
  list() {
    if (!this._hydrated) this._hydrate();
    return this.entries;
  },

  save() {
    if (this.entries.length > this.MAX_ENTRIES) this.entries.length = this.MAX_ENTRIES;
    localStorage.setItem(this.STORAGE_KEY, JSON.stringify(this.entries));
  },

  // The title is unknown when a visit is recorded: "Loading…" and the bare URL
  // are placeholders that updateTitle() replaces once the page says its name.
  _isPlaceholder(title, url) {
    return !title || title === url || /^loading[.…\s]*$/i.test(String(title).trim());
  },

  addEntry(url, title, favicon) {
    if (!url || !/^https?:\/\//i.test(url)) return;   // file://, about:, vex://, data:
    // Always read what is saved first. The stored list can arrive AFTER this
    // module loads — PersistentStorage restores localStorage from its own file
    // during start-up — so writing a cached copy would drop the history that
    // was restored a moment later.
    this._hydrate();

    // Going back to a page you saw today moves its row up and refreshes the
    // time rather than stacking another identical row, the way Chrome does.
    const dayAgo = Date.now() - 86400000;
    const at = this.entries.findIndex(e => e.url === url && this._when(e).getTime() > dayAgo);
    const existing = at >= 0 ? this.entries.splice(at, 1)[0] : null;

    this.entries.unshift({
      id: existing?.id || 'h_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
      url,
      title: this._isPlaceholder(title, url) ? (existing?.title || url) : title,
      favicon: this._safeFavicon(favicon) || existing?.favicon || '',
      visitedAt: new Date().toISOString(),
      summary: existing?.summary, tags: existing?.tags, indexed: existing?.indexed || false,
    });
    this.save();
    this._refreshIfOpen();
  },

  // The real title arrives after the visit is recorded (page-title-updated in
  // js/webview.js); without this every entry keeps its placeholder.
  updateTitle(url, title) {
    if (!url || this._isPlaceholder(title, url)) return;
    this._hydrate();
    const entry = this.entries.find(e => e.url === url);
    if (!entry || entry.title === title) return;
    entry.title = title;
    this.save();
    this._refreshIfOpen();
  },

  // Redraw only while the panel is on screen — visits happen constantly.
  _refreshIfOpen() {
    const panel = document.getElementById('panel-history');
    if (!panel || !panel.dataset.rendered || panel.style.display === 'none') return;
    clearTimeout(this._refreshTimer);
    this._refreshTimer = setTimeout(() => this.renderList(), 250);
  },

  deleteEntry(id) {
    this._hydrate();
    this.entries = this.entries.filter(e => e.id !== id);
    this.save();
    this.renderList();
  },

  // One day's heading, used both to group rows and to clear that group.
  _dayLabel(d) {
    return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  },

  // Clearing everything was the only way to remove anything in bulk. These two
  // are what people actually reach for: one site, or one day.
  deleteSite(host) {
    this._hydrate();
    const before = this.entries.length;
    this.entries = this.entries.filter(e => { try { return new URL(e.url).hostname !== host; } catch { return true; } });
    this.save();
    this.renderList();
    window.showToast?.(`Removed ${before - this.entries.length} from ${host}`);
  },

  deleteDay(label) {
    this._hydrate();
    const before = this.entries.length;
    this.entries = this.entries.filter(e => this._dayLabel(this._when(e)) !== label);
    this.save();
    this.renderList();
    window.showToast?.(`Cleared ${before - this.entries.length} from ${label}`);
  },

  _rowMenu(event, url) {
    let host = '';
    try { host = new URL(url).hostname; } catch { return; }
    document.querySelectorAll('.tab-context-menu').forEach(m => m.remove());
    const menu = document.createElement('div');
    menu.className = 'tab-context-menu';
    menu.style.left = event.clientX + 'px';
    menu.style.top = event.clientY + 'px';
    const item = document.createElement('div');
    item.className = 'tab-context-item danger';
    item.textContent = `Delete every visit to ${host}`;
    item.addEventListener('click', () => { menu.remove(); this.deleteSite(host); });
    menu.appendChild(item);
    document.body.appendChild(menu);
    // Same dismissal as the tab menus, so a click into a page closes it too.
    if (typeof TabManager !== 'undefined' && TabManager._attachMenuDismissal) TabManager._attachMenuDismissal(menu);
    else setTimeout(() => {
      const close = (ev) => { if (!menu.contains(ev.target)) { menu.remove(); document.removeEventListener('click', close); } };
      document.addEventListener('click', close);
    }, 0);
  },

  getTimeFiltered() {
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    return this.entries.filter(e => {
      const d = this._when(e);
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
    list._virtualDispose?.();
    if (filtered.length > 100 && window.VexVirtualList) {
      window.VexVirtualList.mount(list, filtered, entry => {
        const row = document.createElement('div'); row.className = 'history-item'; row.tabIndex = 0; row.setAttribute('role', 'link');
        const text = document.createElement('div'); text.className = 'history-item-info';
        const title = document.createElement('div'); title.className = 'history-item-title'; title.textContent = entry.title || entry.url;
        const detail = document.createElement('div'); detail.className = 'history-item-url'; detail.textContent = this._when(entry).toLocaleString() + ' · ' + entry.url;
        text.append(title, detail);
        // Same furniture as the grouped rows: a long history shouldn't suddenly
        // lose its icons.
        const icon = document.createElement('img');
        icon.loading = 'lazy'; icon.alt = ''; icon.dataset.imageFallback = 'hide';
        let favicon = this._safeFavicon(entry.favicon);
        if (!favicon) { try { favicon = new URL(entry.url).origin + '/favicon.ico'; } catch {} }
        icon.src = favicon;
        const remove = document.createElement('button'); remove.textContent = '×'; remove.setAttribute('aria-label', 'Delete history entry');
        remove.addEventListener('click', event => { event.stopPropagation(); this.deleteEntry(entry.id); });
        row.append(icon, text, remove);
        row.addEventListener('click', () => { SidebarManager.hideActivePanel(); TabManager.createTab(entry.url, true); });
        row.addEventListener('keydown', event => { if (event.target === row && event.key === 'Enter') row.click(); });
        return row;
      });
      return;
    }
    if (filtered.length === 0) {
      list.innerHTML = window.VexUI
        ? VexUI.emptyState('history', 'No history found', 'Try a different search or time filter')
        : '<div class="history-empty">No history found</div>';
      return;
    }

    const groups = {};
    filtered.forEach(e => {
      const d = this._when(e);
      const key = this._dayLabel(d);
      (groups[key] ||= []).push(e);
    });

    list.innerHTML = Object.entries(groups).map(([date, items]) => `
      <div class="history-date-group">
        <div class="history-date-label">${date}<button class="history-day-clear" data-day="${this._esc(date)}" title="Remove every entry from this day">Clear day</button></div>
        ${items.slice(0, 100).map(e => {
          const time = this._when(e).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
          let favicon = this._safeFavicon(e.favicon);
          if (!favicon) { try { favicon = new URL(e.url).origin + '/favicon.ico'; } catch {} } // first-party, no Google leak
          return `
            <div class="history-item" data-id="${this._esc(e.id)}" data-url="${this._esc(e.url)}" tabindex="0" role="link">
              <img src="${this._esc(favicon || '')}" alt="" loading="lazy" data-image-fallback="hide">
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

    list.querySelectorAll('.history-day-clear').forEach(btn => {
      btn.addEventListener('click', (e) => { e.stopPropagation(); this.deleteDay(btn.dataset.day); });
    });

    list.querySelectorAll('.history-item').forEach(el => {
      el.addEventListener('contextmenu', (e) => { e.preventDefault(); this._rowMenu(e, el.dataset.url); });
      el.addEventListener('click', (e) => {
        if (e.target.closest('.history-item-delete')) {
          this.deleteEntry(el.dataset.id);
        } else {
          SidebarManager.hideActivePanel();
          TabManager.createTab(el.dataset.url, true);
        }
      });
      el.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); el.click(); }
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
        <div class="history-item ai-result" data-url="${this._esc(entry.url)}" tabindex="0" role="link">
          <img src="${host ? `https://${encodeURIComponent(host)}/favicon.ico` : ''}" width="20" height="20" loading="lazy" data-image-fallback="hide">
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
      el.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); el.click(); }
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

  _esc(s) { return window.escapeHtml(s); }
};

window.HistoryPanel = HistoryPanel;
// Load the saved history as soon as this module does: pages get recorded long
// before the panel is ever opened, and a write from an empty list wipes it.
try { HistoryPanel._hydrate(); } catch (err) { console.error('[history] could not load saved history:', err); }
window.addEventListener('vex-sync-data-applied', () => {
  HistoryPanel._hydrate();
  HistoryPanel.lastAISearch = null;
  HistoryPanel.renderList();
});

if (typeof module !== 'undefined' && module.exports) module.exports = { HistoryPanel };

// === Vex Memory Minimizer Panel ===

const MemoryPanel = {
  refreshInterval: null,

  init() {
    const panel = document.getElementById('panel-memory');
    if (!panel || panel.dataset.rendered) return;
    panel.dataset.rendered = 'true';

    panel.innerHTML = `
      <div class="memory-container">
        <div class="memory-header">
          <h2>Memory</h2>
          <div class="memory-total" id="memory-total">-- MB</div>
        </div>
        <div class="memory-actions">
          <button id="memory-sleep-all">Sleep inactive tabs</button>
          <button id="memory-reload-all">Reload all tabs</button>
        </div>
        <div class="memory-list" id="memory-list">
          <div style="padding:40px;text-align:center;color:var(--text-muted)">Loading...</div>
        </div>
      </div>
    `;

    document.getElementById('memory-sleep-all')?.addEventListener('click', async (e) => {
      // Reuse TabManager's audible-aware path so we never silence a tab that's
      // playing audio. Redraw only once the sleeps have finished — refreshing
      // straight away showed every tab still awake.
      const btn = e.currentTarget;
      btn.disabled = true;
      try { await TabManager.sleepAllInactive(); } finally { btn.disabled = false; }
      await this.refresh();
      window.showToast?.('Inactive tabs put to sleep');
    });

    document.getElementById('memory-reload-all')?.addEventListener('click', () => {
      TabManager.tabs.forEach(t => {
        if (!t.sleeping && !t._lazy) {
          const wv = WebviewManager.webviews.get(t.id);
          if (wv) wv.reload();
        }
      });
      window.showToast?.('All tabs reloading');
    });

    this.refresh();
    this.startAutoRefresh();
  },

  startAutoRefresh() {
    this.stopAutoRefresh();
    this.refreshInterval = setInterval(() => {
      // Only refresh if panel is visible
      const panel = document.getElementById('panel-memory');
      if (panel && panel.style.display !== 'none') {
        this.refresh();
      }
    }, 3000);
  },

  stopAutoRefresh() {
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
      this.refreshInterval = null;
    }
  },

  async refresh() {
    const list = document.getElementById('memory-list');
    const totalEl = document.getElementById('memory-total');
    if (!list) return;

    // Gather each materialized tab's <webview> webContents id so main can map it
    // to its real OS process memory. Sleeping/lazy tabs have no process.
    const entries = TabManager.tabs.map(tab => {
      const wv = WebviewManager.webviews.get(tab.id);
      const materialized = !!wv && !tab.sleeping && !tab._lazy;
      let wcId = null;
      if (materialized && typeof wv.getWebContentsId === 'function') {
        try { wcId = wv.getWebContentsId(); } catch { /* not attached yet */ }
      }
      return { tab, wv, materialized, wcId };
    });

    // Real per-process memory from main. No estimates: a number shown here is
    // a measurement, or the row says why there isn't one.
    let mem;
    try {
      mem = await window.vex.tabMemory(entries.filter(e => e.wcId != null).map(e => e.wcId));
    } catch (err) {
      console.error('[memory] could not read tab memory:', err);
      if (totalEl) { totalEl.textContent = "Couldn't read memory"; totalEl.className = 'memory-total red'; }
      return;
    }
    const shareCount = MemoryPanel.shareCounts(mem.byId);

    const tabData = entries.map(e => {
      const real = e.wcId != null ? mem.byId[e.wcId] || null : null;
      const d = MemoryPanel.describe(e.tab, real, real ? shareCount[real.pid] : 0);
      return {
        id: e.tab.id,
        title: e.tab.title,
        url: e.tab.url,
        active: e.tab.id === TabManager.activeTabId,
        sleeping: d.sleeping,
        memMB: d.mb,
        label: d.label,
      };
    });

    const asleep = entries.filter(e => e.tab.sleeping || e.tab._lazy).length;
    // True browser footprint (all processes incl. main/GPU), not the per-tab sum.
    const totalMB = Math.round(mem.totalKB / 1024);

    if (totalEl) {
      const fmt = totalMB < 1024 ? totalMB + ' MB' : (totalMB / 1024).toFixed(1) + ' GB';
      totalEl.textContent = asleep ? `${fmt} · ${asleep} asleep 💤` : fmt;
      totalEl.className = 'memory-total ' + (totalMB < 500 ? 'green' : totalMB < 1000 ? 'amber' : 'red');
    }

    // Sort by memory descending; a tab still starting (no number yet) goes last.
    tabData.sort((a, b) => (b.memMB ?? -1) - (a.memMB ?? -1));

    list.innerHTML = tabData.map(t => {
      const sizeClass = t.memMB == null ? '' : t.memMB < 100 ? 'green' : t.memMB < 300 ? 'amber' : 'red';
      const sleeping = t.sleeping;
      const sizeLabel = this._esc(t.label);
      return `
        <div class="memory-item${sleeping ? ' memory-sleeping' : ''}" data-id="${t.id}">
          <div class="memory-item-info">
            <div class="memory-item-title">${this._esc(t.title)}${t.active ? ' (active)' : ''}</div>
            <div class="memory-item-url">${this._esc(t.url)}</div>
          </div>
          <div class="memory-item-size ${sleeping ? '' : sizeClass}">${sizeLabel}</div>
          <div class="memory-item-actions">
            ${!sleeping && !t.active ? '<button class="mem-sleep" title="Sleep">Sleep</button>' : ''}
            ${sleeping ? '<button class="mem-wake" title="Wake">Wake</button>' : ''}
            ${!sleeping ? '<button class="mem-reload" title="Reload">Reload</button>' : ''}
            <button class="mem-close" title="Close" style="color:var(--danger)">Close</button>
          </div>
        </div>
      `;
    }).join('');

    list.querySelectorAll('.memory-item').forEach(el => {
      const tabId = el.dataset.id;
      // A click on Sleep is a direct request: force it past keep-awake (as Tab
      // Health does), and redraw once it has actually slept.
      el.querySelector('.mem-sleep')?.addEventListener('click', async (e) => {
        e.currentTarget.disabled = true;
        e.currentTarget.textContent = '…';
        await TabManager.sleepTab(tabId, true);
        await this.refresh();
      });
      el.querySelector('.mem-wake')?.addEventListener('click', () => { TabManager.wakeTab(tabId); this.refresh(); });
      el.querySelector('.mem-reload')?.addEventListener('click', () => {
        const wv = WebviewManager.webviews.get(tabId);
        if (wv) wv.reload();
      });
      el.querySelector('.mem-close')?.addEventListener('click', () => { TabManager.closeTab(tabId); this.refresh(); });
    });
  },

  // How many of the measured tabs each process backs (same-site tabs share a
  // renderer, so one process's memory is shown on each of them).
  shareCounts(byId) {
    const n = {};
    for (const e of Object.values(byId || {})) n[e.pid] = (n[e.pid] || 0) + 1;
    return n;
  },

  // What a tab's memory row says — actual numbers only. `real` is main's
  // measurement of the tab's process ({ memKB, pid }) or null; `shareCount` is
  // how many open tabs that process backs. A sleeping tab has no process, so it
  // really uses 0 MB; what it used just before it slept is shown beside that.
  describe(tab, real, shareCount) {
    if (tab.sleeping) {
      const was = tab.memBeforeSleep;
      const wasText = was ? ` (was ${was.mb} MB${was.shared ? ', shared' : ''})` : '';
      return { mb: 0, sleeping: true, label: `0 MB · asleep${wasText}` };
    }
    if (tab._lazy) return { mb: 0, sleeping: true, label: '0 MB · not loaded yet' };
    if (!real) return { mb: null, sleeping: false, label: 'starting…' };
    const mb = Math.round(real.memKB / 1024);
    return { mb, sleeping: false, label: shareCount > 1 ? `${mb} MB · shared by ${shareCount} tabs` : `${mb} MB` };
  },

  _esc(s) { return window.escapeHtml(s); }
};

if (typeof module !== 'undefined' && module.exports) module.exports = { MemoryPanel };

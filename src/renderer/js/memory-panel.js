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

    document.getElementById('memory-sleep-all')?.addEventListener('click', () => {
      // Reuse TabManager's audible-aware path so we never silence a tab that's
      // playing audio.
      TabManager.sleepAllInactive();
      this.refresh();
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

    // Ask main for REAL per-process memory (falls back to estimates if the IPC
    // isn't available, e.g. an older preload).
    let mem = null;
    const ids = entries.filter(e => e.wcId != null).map(e => e.wcId);
    try { if (window.vex?.tabMemory) mem = await window.vex.tabMemory(ids); } catch { /* ignore */ }
    const haveReal = !!(mem && mem.byId);

    const tabData = entries.map(e => {
      const real = haveReal && e.wcId != null ? mem.byId[e.wcId] : null;
      // Real working-set in MB; sleeping/lazy ≈ 0. Estimate only if IPC missing.
      let memMB;
      if (real) memMB = Math.round(real.memKB / 1024);
      else if (!e.materialized) memMB = 0;
      else memMB = e.tab.id === TabManager.activeTabId ? 150 : 80; // fallback estimate
      return {
        id: e.tab.id,
        title: e.tab.title,
        url: e.tab.url,
        sleeping: e.tab.sleeping || false,
        lazy: e.tab._lazy || false,
        active: e.tab.id === TabManager.activeTabId,
        shared: !!(real && real.shared),
        estimate: !haveReal && e.materialized,
        memMB
      };
    });

    const asleep = entries.filter(e => e.tab.sleeping || e.tab._lazy).length;
    // True browser footprint (all processes incl. main/GPU), not the per-tab sum.
    const totalMB = haveReal && mem.totalKB
      ? Math.round(mem.totalKB / 1024)
      : tabData.reduce((sum, t) => sum + t.memMB, 0);

    if (totalEl) {
      const fmt = totalMB < 1024 ? totalMB + ' MB' : (totalMB / 1024).toFixed(1) + ' GB';
      totalEl.textContent = asleep ? `${fmt} · ${asleep} asleep 💤` : fmt;
      totalEl.className = 'memory-total ' + (totalMB < 500 ? 'green' : totalMB < 1000 ? 'amber' : 'red');
    }

    // Sort by memory descending
    tabData.sort((a, b) => b.memMB - a.memMB);

    list.innerHTML = tabData.map(t => {
      const sizeClass = t.memMB < 100 ? 'green' : t.memMB < 300 ? 'amber' : 'red';
      const sleeping = t.sleeping || t.lazy;
      const sizeLabel = sleeping ? 'asleep' : `${t.memMB} MB${t.estimate ? '*' : ''}${t.shared ? ' ·shared' : ''}`;
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
      el.querySelector('.mem-sleep')?.addEventListener('click', () => { TabManager.sleepTab(tabId); this.refresh(); });
      el.querySelector('.mem-wake')?.addEventListener('click', () => { TabManager.wakeTab(tabId); this.refresh(); });
      el.querySelector('.mem-reload')?.addEventListener('click', () => {
        const wv = WebviewManager.webviews.get(tabId);
        if (wv) wv.reload();
      });
      el.querySelector('.mem-close')?.addEventListener('click', () => { TabManager.closeTab(tabId); this.refresh(); });
    });
  },

  _esc(s) { const d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML; }
};

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
      TabManager.tabs.forEach(t => {
        if (t.id !== TabManager.activeTabId && !t.sleeping) {
          TabManager.sleepTab(t.id);
        }
      });
      this.refresh();
      window.showToast?.('All inactive tabs put to sleep');
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

    // Estimate memory per tab based on webview existence
    const tabData = TabManager.tabs.map(tab => {
      const wv = WebviewManager.webviews.get(tab.id);
      const hasMaterialized = !!wv && !tab.sleeping && !tab._lazy;
      // Rough estimate: active webview ~50-200MB, sleeping/lazy ~1MB
      const estimatedMB = hasMaterialized ? (tab.id === TabManager.activeTabId ? 150 : 80) : 1;
      return {
        id: tab.id,
        title: tab.title,
        url: tab.url,
        sleeping: tab.sleeping || false,
        lazy: tab._lazy || false,
        active: tab.id === TabManager.activeTabId,
        estimatedMB
      };
    });

    const totalMB = tabData.reduce((sum, t) => sum + t.estimatedMB, 0);

    if (totalEl) {
      totalEl.textContent = totalMB < 1024 ? totalMB + ' MB' : (totalMB / 1024).toFixed(1) + ' GB';
      totalEl.className = 'memory-total ' + (totalMB < 500 ? 'green' : totalMB < 1000 ? 'amber' : 'red');
    }

    // Sort by memory descending
    tabData.sort((a, b) => b.estimatedMB - a.estimatedMB);

    list.innerHTML = tabData.map(t => {
      const sizeClass = t.estimatedMB < 100 ? 'green' : t.estimatedMB < 300 ? 'amber' : 'red';
      const sleeping = t.sleeping || t.lazy;
      return `
        <div class="memory-item${sleeping ? ' memory-sleeping' : ''}" data-id="${t.id}">
          <div class="memory-item-info">
            <div class="memory-item-title">${this._esc(t.title)}${t.active ? ' (active)' : ''}</div>
            <div class="memory-item-url">${this._esc(t.url)}</div>
          </div>
          <div class="memory-item-size ${sizeClass}">${t.estimatedMB} MB</div>
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

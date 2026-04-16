// === Vex Tab Manager ===

// Start page URL — defaults to vex:// protocol, replaced with file:// fallback once resolved
let START_URL = 'vex://start';

// Resolve the file:// fallback URL asynchronously
if (window.vex?.getStartPageUrl) {
  window.vex.getStartPageUrl().then(url => {
    if (url) START_URL = url;
  }).catch(() => {});
}

function isStartPage(url) {
  return url === 'vex://start' || url === START_URL || url?.startsWith('vex://start') || url?.includes('start.html');
}

const TabManager = {
  tabs: [],
  activeTabId: null,
  tabCounter: 0,
  groups: [],
  defaultGroups: [
    { id: 'cusa', name: 'CUSA', color: '#6366f1', collapsed: false },
    { id: 'school', name: 'School', color: '#22c55e', collapsed: false },
    { id: 'dev', name: 'Dev', color: '#00b4d8', collapsed: false },
    { id: 'chat', name: 'Chat', color: '#f59e0b', collapsed: false }
  ],

  async init() {
    this.groups = (await VexStorage.loadGroups());
    if (this.groups.length === 0) {
      this.groups = [...this.defaultGroups];
      await VexStorage.saveGroups(this.groups);
    }

    const savedTabs = await VexStorage.loadTabs();
    if (savedTabs.length > 0) {
      for (const t of savedTabs) {
        this.createTab(t.url, false, t.groupId);
      }
      this.switchTab(this.tabs[0].id);
    } else {
      this.createTab(START_URL, true);
    }

    this.renderGroups();
    this.setupNewTabButton();
    this.setupDragDrop();
  },

  createTab(url, activate = true, groupId = null) {
    const id = `tab-${++this.tabCounter}`;
    const tab = {
      id,
      url: url || START_URL,
      title: isStartPage(url) ? 'New Tab' : 'Loading...',
      favicon: null,
      loading: true,
      pinned: false,
      unread: false,
      groupId: groupId
    };

    this.tabs.push(tab);
    WebviewManager.createWebview(tab);
    this.renderTab(tab);

    if (activate) {
      this.switchTab(id);
    }

    this.persistTabs();
    return tab;
  },

  switchTab(id) {
    const tab = this.tabs.find(t => t.id === id);
    if (!tab) return;

    // Hide any active panel
    SidebarManager.hideActivePanel();

    this.activeTabId = id;
    tab.unread = false;

    // Update tab list UI
    document.querySelectorAll('.tab-item').forEach(el => {
      el.classList.toggle('active', el.dataset.tabId === id);
    });

    // Show correct webview
    WebviewManager.showWebview(id);

    // Update URL bar
    this.updateUrlBar(tab);
  },

  closeTab(id) {
    const idx = this.tabs.findIndex(t => t.id === id);
    if (idx === -1) return;

    WebviewManager.destroyWebview(id);

    // Remove tab element
    const el = document.querySelector(`.tab-item[data-tab-id="${id}"]`);
    if (el) el.remove();

    this.tabs.splice(idx, 1);

    if (this.tabs.length === 0) {
      this.createTab(START_URL, true);
    } else if (this.activeTabId === id) {
      const newIdx = Math.min(idx, this.tabs.length - 1);
      this.switchTab(this.tabs[newIdx].id);
    }

    this.persistTabs();
  },

  updateTab(id, data) {
    const tab = this.tabs.find(t => t.id === id);
    if (!tab) return;

    if (data.title !== undefined) tab.title = data.title;
    if (data.url !== undefined) tab.url = data.url;
    if (data.favicon !== undefined) tab.favicon = data.favicon;
    if (data.loading !== undefined) tab.loading = data.loading;

    // Mark unread if not active
    if (id !== this.activeTabId && data.title) {
      tab.unread = true;
    }

    this.renderTabUpdate(tab);

    if (id === this.activeTabId) {
      this.updateUrlBar(tab);
    }

    this.persistTabs();
  },

  updateUrlBar(tab) {
    const urlInput = document.getElementById('url-input');
    if (isStartPage(tab.url)) {
      urlInput.value = '';
      urlInput.placeholder = 'Search or enter URL...';
    } else {
      urlInput.value = tab.url;
    }
  },

  renderTab(tab) {
    const container = tab.groupId
      ? document.querySelector(`.tab-group[data-group-id="${tab.groupId}"] .tab-group-tabs`)
      : document.getElementById('tabs-list');

    if (!container) {
      // Fallback to ungrouped
      tab.groupId = null;
      document.getElementById('tabs-list').appendChild(this._createTabElement(tab));
      return;
    }

    container.appendChild(this._createTabElement(tab));
  },

  _createTabElement(tab) {
    const el = document.createElement('div');
    el.className = 'tab-item';
    el.dataset.tabId = tab.id;
    el.draggable = true;

    if (tab.id === this.activeTabId) el.classList.add('active');

    el.innerHTML = `
      ${tab.loading
        ? '<div class="tab-loading"></div>'
        : tab.favicon
          ? `<img class="tab-favicon" src="${tab.favicon}" alt="">`
          : '<div class="tab-favicon-placeholder"><svg viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="5.5" stroke="currentColor" stroke-width="1.5"/></svg></div>'
      }
      <div class="tab-info">
        <div class="tab-title">${this._escapeHtml(tab.title)}</div>
      </div>
      ${tab.unread ? '<div class="tab-unread"></div>' : ''}
      <button class="tab-close" title="Close tab">
        <svg width="10" height="10" viewBox="0 0 10 10"><path d="M2 2L8 8M8 2L2 8" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>
      </button>
    `;

    el.addEventListener('click', (e) => {
      if (e.target.closest('.tab-close')) {
        this.closeTab(tab.id);
      } else {
        this.switchTab(tab.id);
      }
    });

    el.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      this.showContextMenu(e, tab);
    });

    return el;
  },

  renderTabUpdate(tab) {
    const el = document.querySelector(`.tab-item[data-tab-id="${tab.id}"]`);
    if (!el) return;

    const faviconArea = el.querySelector('.tab-loading, .tab-favicon, .tab-favicon-placeholder');
    if (faviconArea) {
      if (tab.loading) {
        if (!faviconArea.classList.contains('tab-loading')) {
          faviconArea.outerHTML = '<div class="tab-loading"></div>';
        }
      } else if (tab.favicon) {
        faviconArea.outerHTML = `<img class="tab-favicon" src="${tab.favicon}" alt="">`;
      } else {
        faviconArea.outerHTML = '<div class="tab-favicon-placeholder"><svg viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="5.5" stroke="currentColor" stroke-width="1.5"/></svg></div>';
      }
    }

    const titleEl = el.querySelector('.tab-title');
    if (titleEl) titleEl.textContent = tab.title;

    // Unread dot
    const unreadEl = el.querySelector('.tab-unread');
    if (tab.unread && !unreadEl) {
      const dot = document.createElement('div');
      dot.className = 'tab-unread';
      el.querySelector('.tab-close').before(dot);
    } else if (!tab.unread && unreadEl) {
      unreadEl.remove();
    }
  },

  renderGroups() {
    const container = document.getElementById('tab-groups-container');
    container.innerHTML = '';

    this.groups.forEach(group => {
      const el = document.createElement('div');
      el.className = `tab-group${group.collapsed ? ' collapsed' : ''}`;
      el.dataset.groupId = group.id;

      const tabCount = this.tabs.filter(t => t.groupId === group.id).length;

      el.innerHTML = `
        <div class="tab-group-header">
          <div class="tab-group-dot" style="background: ${group.color}"></div>
          <span class="tab-group-name">${this._escapeHtml(group.name)}</span>
          <span class="tab-group-count">${tabCount}</span>
          <svg class="tab-group-chevron" width="12" height="12" viewBox="0 0 12 12"><path d="M4 3L8 6L4 9" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
        </div>
        <div class="tab-group-tabs"></div>
      `;

      el.querySelector('.tab-group-header').addEventListener('click', () => {
        group.collapsed = !group.collapsed;
        el.classList.toggle('collapsed');
        VexStorage.saveGroups(this.groups);
      });

      container.appendChild(el);
    });
  },

  showContextMenu(e, tab) {
    // Remove existing menu
    document.querySelectorAll('.tab-context-menu').forEach(m => m.remove());

    const menu = document.createElement('div');
    menu.className = 'tab-context-menu';
    menu.style.left = e.clientX + 'px';
    menu.style.top = e.clientY + 'px';

    const items = [
      { label: tab.pinned ? 'Unpin Tab' : 'Pin Tab', action: () => { tab.pinned = !tab.pinned; this.persistTabs(); } },
      { label: 'Duplicate', action: () => this.createTab(tab.url) },
      { sep: true },
      ...this.groups.map(g => ({
        label: `Move to ${g.name}`,
        action: () => {
          tab.groupId = g.id;
          this.rebuildAllTabs();
          this.persistTabs();
        }
      })),
      { label: 'Remove from Group', action: () => { tab.groupId = null; this.rebuildAllTabs(); this.persistTabs(); } },
      { sep: true },
      { label: 'Close', action: () => this.closeTab(tab.id), danger: true },
      { label: 'Close Others', action: () => {
        const others = this.tabs.filter(t => t.id !== tab.id).map(t => t.id);
        others.forEach(id => this.closeTab(id));
      }, danger: true }
    ];

    items.forEach(item => {
      if (item.sep) {
        const sep = document.createElement('div');
        sep.className = 'tab-context-sep';
        menu.appendChild(sep);
      } else {
        const el = document.createElement('div');
        el.className = `tab-context-item${item.danger ? ' danger' : ''}`;
        el.textContent = item.label;
        el.addEventListener('click', () => {
          item.action();
          menu.remove();
        });
        menu.appendChild(el);
      }
    });

    document.body.appendChild(menu);

    // Close on click outside
    const closeMenu = (ev) => {
      if (!menu.contains(ev.target)) {
        menu.remove();
        document.removeEventListener('click', closeMenu);
      }
    };
    setTimeout(() => document.addEventListener('click', closeMenu), 0);
  },

  rebuildAllTabs() {
    // Clear all tab elements
    document.getElementById('tabs-list').innerHTML = '';
    document.querySelectorAll('.tab-group-tabs').forEach(el => el.innerHTML = '');
    this.renderGroups();

    // Re-render all tabs
    this.tabs.forEach(tab => this.renderTab(tab));

    // Re-apply active state
    document.querySelectorAll('.tab-item').forEach(el => {
      el.classList.toggle('active', el.dataset.tabId === this.activeTabId);
    });
  },

  setupNewTabButton() {
    document.getElementById('btn-new-tab').addEventListener('click', () => {
      this.createTab(START_URL, true);
    });
  },

  setupDragDrop() {
    const tabsList = document.getElementById('tabs-list');

    tabsList.addEventListener('dragstart', (e) => {
      const tabEl = e.target.closest('.tab-item');
      if (!tabEl) return;
      tabEl.classList.add('dragging');
      e.dataTransfer.setData('text/plain', tabEl.dataset.tabId);
    });

    tabsList.addEventListener('dragend', (e) => {
      const tabEl = e.target.closest('.tab-item');
      if (tabEl) tabEl.classList.remove('dragging');
      document.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
    });

    tabsList.addEventListener('dragover', (e) => {
      e.preventDefault();
      const tabEl = e.target.closest('.tab-item');
      if (tabEl && !tabEl.classList.contains('dragging')) {
        document.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
        tabEl.classList.add('drag-over');
      }
    });

    tabsList.addEventListener('drop', (e) => {
      e.preventDefault();
      const draggedId = e.dataTransfer.getData('text/plain');
      const targetEl = e.target.closest('.tab-item');
      if (!targetEl) return;

      const targetId = targetEl.dataset.tabId;
      if (draggedId === targetId) return;

      const dragIdx = this.tabs.findIndex(t => t.id === draggedId);
      const targetIdx = this.tabs.findIndex(t => t.id === targetId);

      const [dragged] = this.tabs.splice(dragIdx, 1);
      this.tabs.splice(targetIdx, 0, dragged);

      this.rebuildAllTabs();
      this.persistTabs();
    });
  },

  async persistTabs() {
    await VexStorage.saveTabs(this.tabs);
  },

  getActiveTab() {
    return this.tabs.find(t => t.id === this.activeTabId);
  },

  _escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }
};

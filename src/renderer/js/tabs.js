// === Vex Tab Manager ===

// TODO(Phase 2.5): drag-to-group — drop a tab onto a group header to assign,
// drag a tab out of a group's body to ungroup. Right-click is the only path
// for now; ship without it to keep the diff small.

// Phase 2 group color palette — amber-leaning to match Vex's accent.
// Existing groups keep their previously-saved colors; this palette only
// governs new groups and the color picker.
const GROUP_COLORS = [
  '#d4a574', // amber (default)
  '#9b59b6', // purple
  '#5b8def', // blue
  '#6fbf73', // green
  '#e8c45a', // yellow
  '#e8685a', // red
  '#5ac8c8', // teal
  '#a08574'  // brown
];

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

// Recently closed tabs
const RECENTLY_CLOSED_KEY = 'vex.recentlyClosed';
const MAX_RECENTLY_CLOSED = 25;

function getRecentlyClosed() {
  try { return JSON.parse(localStorage.getItem(RECENTLY_CLOSED_KEY) || '[]'); } catch { return []; }
}
function saveRecentlyClosed(list) {
  if (list.length > MAX_RECENTLY_CLOSED) list.length = MAX_RECENTLY_CLOSED;
  localStorage.setItem(RECENTLY_CLOSED_KEY, JSON.stringify(list));
}

const TabManager = {
  tabs: [],
  activeTabId: null,
  tabCounter: 0,
  _autoSleepInterval: null,
  groups: [],
  // Legacy seed groups (CUSA/School/Dev/Chat) removed — groups now start
  // empty. Users create groups via right-click "New group from this tab"
  // or the Phase 16 AI auto-grouper (Ctrl+Shift+G).
  _legacySeedIds: new Set(['cusa', 'school', 'dev', 'chat']),

  async init() {
    this.groups = (await VexStorage.loadGroups()) || [];

    // One-time cleanup: prune legacy seed groups AND any abandoned empty
    // groups (e.g. Phase 16 AI runs that didn't leave tabs behind).
    const beforeCount = this.groups.length;
    const loadedTabs = (await VexStorage.loadTabs()) || [];
    const liveGroupIds = new Set(loadedTabs.map(t => t.groupId).filter(Boolean));
    this.groups = this.groups.filter(g =>
      !this._legacySeedIds.has(g.id) && liveGroupIds.has(g.id)
    );
    if (this.groups.length !== beforeCount) {
      console.log(`[Tabs] Pruned ${beforeCount - this.groups.length} empty/legacy group(s)`);
      await VexStorage.saveGroups(this.groups);
    }

    const savedTabs = await VexStorage.loadTabs();
    if (savedTabs.length > 0) {
      for (const t of savedTabs) {
        if (t.sleeping) {
          // Bring tabs that were sleeping at shutdown back up sleeping —
          // no webview created, scroll position preserved for next wake.
          const id = `tab-${++this.tabCounter}`;
          const tab = {
            id,
            url: t.url,
            title: t.title || (isStartPage(t.url) ? 'New Tab' : t.url),
            favicon: null,
            loading: false,
            pinned: !!t.pinned,
            unread: false,
            groupId: t.groupId || null,
            sleeping: true,
            originalUrl: t.originalUrl || t.url,
            scrollPosition: t.scrollPosition || null
          };
          this.tabs.push(tab);
          this.renderTab(tab);
          const el = document.querySelector(`.tab-item[data-tab-id="${id}"]`);
          if (el) el.classList.add('sleeping');
        } else {
          const tab = this.createTab(t.url, false, t.groupId);
          if (tab) tab.pinned = !!t.pinned;
        }
      }
      // Activate the first non-sleeping tab so we don't immediately wake one
      const firstAwake = this.tabs.find(t => !t.sleeping) || this.tabs[0];
      this.switchTab(firstAwake.id);
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
    tab.lastViewedAt = Date.now();

    // Wake sleeping tab on activation
    if (tab.sleeping) {
      this.wakeTab(id);
    }

    // Lazy-create webview on first activation
    if (tab._lazy) {
      this._materializeTab(tab);
    }

    // Update tab list UI
    document.querySelectorAll('.tab-item').forEach(el => {
      el.classList.toggle('active', el.dataset.tabId === id);
    });

    // Show correct webview
    WebviewManager.showWebview(id);

    // Update URL bar
    this.updateUrlBar(tab);

    // Match Chrome/Edge: when the active tab is a start page, put the caret in
    // the URL bar so Ctrl+T → type/paste lands there instead of being lost.
    // Deferred one frame so the webview swap + class toggles settle first.
    if (isStartPage(tab.url)) {
      requestAnimationFrame(() => {
        const urlInput = document.getElementById('url-input');
        if (urlInput) { urlInput.focus(); urlInput.select(); }
      });
    }
  },

  closeTab(id) {
    const idx = this.tabs.findIndex(t => t.id === id);
    if (idx === -1) return;

    // Save to recently closed before destroying (skip during bulk ops)
    if (!this._bulkClosing) {
      const tab = this.tabs[idx];
      if (tab && !isStartPage(tab.url)) {
        const list = getRecentlyClosed();
        list.unshift({
          url: tab.url, title: tab.title, favicon: tab.favicon,
          groupId: tab.groupId, closedAt: new Date().toISOString()
        });
        saveRecentlyClosed(list);
      }
    }

    // Remember the closed tab's group so we can prune the group object if
    // this was its last member (no zombie empty groups).
    const closedGroupId = this.tabs[idx]?.groupId || null;

    WebviewManager.destroyWebview(id);

    // Remove tab element
    const el = document.querySelector(`.tab-item[data-tab-id="${id}"]`);
    if (el) el.remove();

    this.tabs.splice(idx, 1);

    // Skip auto-create during bulk operations (workspace switch)
    if (this._bulkClosing) return;

    // Auto-delete the group if it has no tabs left. renderGroups already
    // hides empty groups, but the object would otherwise linger in
    // TabManager.groups + persisted storage forever.
    if (closedGroupId) {
      const stillUsed = this.tabs.some(t => t.groupId === closedGroupId);
      if (!stillUsed) {
        this.groups = this.groups.filter(g => g.id !== closedGroupId);
        VexStorage.saveGroups(this.groups);
      }
    }

    if (this.tabs.length === 0) {
      this.createTab(START_URL, true);
    } else if (this.activeTabId === id) {
      const newIdx = Math.min(idx, this.tabs.length - 1);
      this.switchTab(this.tabs[newIdx].id);
    }

    this.persistTabs();
  },

  // Bulk-close all tabs without triggering auto-create or per-tab persistence
  closeAllTabs() {
    this._bulkClosing = true;
    // Destroy all webviews in one pass — just remove from DOM, no src change
    for (const tab of this.tabs) {
      const wv = WebviewManager.webviews.get(tab.id);
      if (wv) {
        wv.remove();
        WebviewManager.webviews.delete(tab.id);
      }
    }
    this.tabs = [];
    this.activeTabId = null;
    // Clear tab list UI in one shot
    document.getElementById('tabs-list').innerHTML = '';
    document.querySelectorAll('.tab-group-tabs').forEach(el => el.innerHTML = '');
    this._bulkClosing = false;
  },

  // Create a tab with lazy webview — webview only created when activated
  createLazyTab(url, groupId, title) {
    const id = `tab-${++this.tabCounter}`;
    const tab = {
      id,
      url: url || START_URL,
      title: title || (isStartPage(url) ? 'New Tab' : url),
      favicon: null,
      loading: false,
      pinned: false,
      unread: false,
      groupId: groupId,
      _lazy: true  // webview not yet created
    };
    this.tabs.push(tab);
    this.renderTab(tab);
    return tab;
  },

  // Materialize a lazy tab's webview on first activation
  _materializeTab(tab) {
    if (!tab._lazy) return;
    tab._lazy = false;
    tab.loading = true;
    WebviewManager.createWebview(tab);
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
      ${tab.audible && !tab.muted ? '<span class="tab-audio" title="Playing audio — click to mute">&#128266;</span>' : ''}
      ${tab.muted ? '<span class="tab-audio muted" title="Muted — click to unmute">&#128264;</span>' : ''}
      ${tab.unread ? '<div class="tab-unread"></div>' : ''}
      <button class="tab-close" title="Close tab">
        <svg width="10" height="10" viewBox="0 0 10 10"><path d="M2 2L8 8M8 2L2 8" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>
      </button>
    `;

    el.addEventListener('click', (e) => {
      if (e.target.closest('.tab-close')) {
        this.closeTab(tab.id);
      } else if (e.target.closest('.tab-audio')) {
        this.toggleMuteTab(tab.id);
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

    console.log('[Tabs] renderGroups:', {
      groups: this.groups.length,
      tabs: this.tabs.length,
      groupedTabs: this.tabs.filter(t => t.groupId).length
    });

    this.groups.forEach(group => {
      const tabCount = this.tabs.filter(t => t.groupId === group.id).length;
      // Hide empty groups — if a group ends up with 0 tabs, don't show a
      // ghost row in the sidebar. It still exists (can be re-shown via
      // right-click Move-to on a tab) until the user explicitly deletes it.
      if (tabCount === 0) return;

      const el = document.createElement('div');
      el.className = `tab-group${group.collapsed ? ' collapsed' : ''}`;
      el.dataset.groupId = group.id;

      el.innerHTML = `
        <div class="tab-group-header">
          <div class="tab-group-dot" style="background: ${group.color}"></div>
          <span class="tab-group-name">${this._escapeHtml(group.name)}</span>
          <span class="tab-group-count">${tabCount}</span>
          <svg class="tab-group-chevron" width="12" height="12" viewBox="0 0 12 12"><path d="M4 3L8 6L4 9" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
        </div>
        <div class="tab-group-tabs"></div>
      `;

      el.querySelector('.tab-group-header').addEventListener('click', (e) => {
        // Don't toggle when clicking a button inside the header
        if (e.target.closest('button')) return;
        group.collapsed = !group.collapsed;
        el.classList.toggle('collapsed');
        const body = el.querySelector('.tab-group-tabs');
        console.log('[Tabs] Group toggle:', {
          groupId: group.id,
          collapsed: group.collapsed,
          tabsInDom: body ? body.children.length : 0
        });
        VexStorage.saveGroups(this.groups);
      });

      el.querySelector('.tab-group-header').addEventListener('contextmenu', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.showGroupContextMenu(e, group.id);
      });

      container.appendChild(el);
    });
  },

  // Right-click menu for a group header
  showGroupContextMenu(event, groupId) {
    document.querySelectorAll('.tab-group-context-menu, .tab-context-menu').forEach(m => m.remove());
    const group = this.groups.find(g => g.id === groupId);
    if (!group) return;
    const tabsInGroup = this.tabs.filter(t => t.groupId === groupId);

    const menu = document.createElement('div');
    menu.className = 'tab-context-menu tab-group-context-menu';
    menu.style.left = event.clientX + 'px';
    menu.style.top  = event.clientY + 'px';
    const x = event.clientX, y = event.clientY;
    const count = tabsInGroup.length;
    menu.innerHTML = `
      <div class="tab-context-item" data-action="rename">\u270f\ufe0f Rename group</div>
      <div class="tab-context-item" data-action="change-color">\ud83c\udfa8 Change color</div>
      <div class="tab-context-sep"></div>
      <div class="tab-context-item" data-action="close-tabs">\u2715 Close ${count} tab${count === 1 ? '' : 's'}</div>
      <div class="tab-context-item" data-action="ungroup">\ud83d\udce4 Ungroup (keep tabs)</div>
      <div class="tab-context-sep"></div>
      <div class="tab-context-item danger" data-action="delete">\ud83d\uddd1\ufe0f Delete group &amp; all tabs</div>
    `;
    document.body.appendChild(menu);
    this._clampMenuToViewport(menu, x, y);

    menu.querySelectorAll('.tab-context-item').forEach(item => {
      item.addEventListener('click', () => {
        const action = item.dataset.action;
        menu.remove();
        this._handleGroupAction(action, groupId);
      });
    });
    this._attachMenuDismissal(menu);
  },

  _handleGroupAction(action, groupId) {
    const group = this.groups.find(g => g.id === groupId);
    if (!group) return;
    const tabsInGroup = this.tabs.filter(t => t.groupId === groupId);

    switch (action) {
      // NB: rebuildAllTabs() calls renderGroups() internally. Calling
      // renderGroups() separately AFTER rebuildAllTabs() blanks every tab
      // out of every group (innerHTML = ''). Just call rebuildAllTabs().
      case 'rename': {
        // Native prompt() is disabled in Electron renderer — use in-app modal.
        this._promptInput('Rename group', 'New name', group.name).then(name => {
          if (name && name.trim()) {
            group.name = name.trim();
            VexStorage.saveGroups(this.groups);
            this.rebuildAllTabs();
          }
        });
        break;
      }
      case 'change-color': {
        this._showGroupColorPicker(groupId, (hex) => {
          group.color = hex;
          VexStorage.saveGroups(this.groups);
          this.rebuildAllTabs();
        });
        break;
      }
      case 'close-tabs': {
        if (!confirm(`Close ${tabsInGroup.length} tab${tabsInGroup.length === 1 ? '' : 's'} in "${group.name}"? The group itself stays.`)) return;
        tabsInGroup.forEach(t => this.closeTab(t.id));
        break;
      }
      case 'ungroup': {
        tabsInGroup.forEach(t => { t.groupId = null; });
        this.groups = this.groups.filter(g => g.id !== groupId);
        VexStorage.saveGroups(this.groups);
        this.rebuildAllTabs();
        this.persistTabs();
        window.showToast?.('Tabs ungrouped', 'info');
        break;
      }
      case 'delete': {
        if (!confirm(`Delete "${group.name}" and close all ${tabsInGroup.length} tab${tabsInGroup.length === 1 ? '' : 's'} inside? This cannot be undone.`)) return;
        tabsInGroup.forEach(t => this.closeTab(t.id));
        this.groups = this.groups.filter(g => g.id !== groupId);
        VexStorage.saveGroups(this.groups);
        this.rebuildAllTabs();
        this.persistTabs();
        window.showToast?.('Group deleted', 'success');
        break;
      }
    }
  },

  async _newGroupFromTab(tab) {
    // Electron's renderer disables the native window.prompt() — it returns
    // null silently, which silently swallowed this whole flow before. Use the
    // in-app modal instead.
    const name = await this._promptInput('New group', 'Group name', '');
    if (!name || !name.trim()) return;
    const id = 'grp_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    this.groups.push({ id, name: name.trim(), color: GROUP_COLORS[0], collapsed: false });
    tab.groupId = id;
    VexStorage.saveGroups(this.groups);
    this.rebuildAllTabs();
    this.persistTabs();
    window.showToast?.(`Created group "${name.trim()}"`, 'success');
  },

  _showGroupColorPicker(groupId, onPick) {
    const colors = GROUP_COLORS;
    document.querySelectorAll('.group-color-picker-overlay').forEach(o => o.remove());
    const overlay = document.createElement('div');
    overlay.className = 'group-color-picker-overlay';
    overlay.innerHTML = `
      <div class="group-color-picker">
        <div class="group-color-picker-title">Pick a color</div>
        <div class="group-color-grid">
          ${colors.map(c => `<button class="group-color-swatch" data-color="${c}" style="background:${c}" title="${c}"></button>`).join('')}
        </div>
      </div>`;
    document.body.appendChild(overlay);
    overlay.querySelectorAll('.group-color-swatch').forEach(btn => {
      btn.addEventListener('click', () => {
        onPick(btn.dataset.color);
        overlay.remove();
      });
    });
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) overlay.remove();
    });
  },

  showContextMenu(e, tab) {
    // Remove existing menu
    document.querySelectorAll('.tab-context-menu, .tab-group-context-menu').forEach(m => m.remove());

    const menu = document.createElement('div');
    menu.className = 'tab-context-menu';
    const x = e.clientX, y = e.clientY;
    menu.style.left = x + 'px';
    menu.style.top  = y + 'px';

    // Only offer Move-to for groups OTHER than the tab's current one,
    // and only if the group actually has tabs (prunes zombie groups).
    const liveGroupIds = new Set(this.tabs.map(t => t.groupId).filter(Boolean));
    const moveTargets = this.groups.filter(g =>
      g.id !== tab.groupId && (liveGroupIds.has(g.id) || this.tabs.some(t => t.groupId === g.id))
    );

    const items = [
      { label: tab.pinned ? 'Unpin Tab' : 'Pin Tab', action: () => { tab.pinned = !tab.pinned; this.persistTabs(); } },
      { label: 'Duplicate', action: () => this.createTab(tab.url) },
      { sep: true },
      ...moveTargets.map(g => ({
        label: `Move to ${g.name}`,
        color: g.color,
        action: () => {
          tab.groupId = g.id;
          this.rebuildAllTabs();
          this.persistTabs();
        }
      })),
      ...(moveTargets.length ? [{ sep: true }] : []),
      { label: 'Add to new group', action: () => this._newGroupFromTab(tab) },
      ...(tab.groupId ? [{ label: '\u2190 Remove from group', action: () => { tab.groupId = null; this.rebuildAllTabs(); this.persistTabs(); } }] : []),
      { sep: true },
      { label: tab.muted ? 'Unmute Tab' : 'Mute Tab', action: () => this.toggleMuteTab(tab.id) },
      { label: 'Mute All Others', action: () => this.muteAllOtherTabs(tab.id) },
      { sep: true },
      { label: tab.sleeping ? 'Wake Tab' : 'Sleep Tab', action: () => tab.sleeping ? this.wakeTab(tab.id) : this.sleepTab(tab.id) },
      { sep: true },
      { label: 'Close', action: () => this.closeTab(tab.id), danger: true },
      { label: 'Close Others', action: () => this.closeOtherTabs(tab.id), danger: true },
      { label: 'Close Tabs to the Right', action: () => this.closeTabsToTheRight(tab.id), danger: true }
    ];

    items.forEach(item => {
      if (item.sep) {
        const sep = document.createElement('div');
        sep.className = 'tab-context-sep';
        menu.appendChild(sep);
      } else {
        const el = document.createElement('div');
        el.className = `tab-context-item${item.danger ? ' danger' : ''}`;
        if (item.color) {
          el.innerHTML = `<span class="ctx-color-dot" style="background:${item.color}"></span>${this._escapeHtml(item.label)}`;
        } else {
          el.textContent = item.label;
        }
        el.addEventListener('click', () => {
          item.action();
          menu.remove();
        });
        menu.appendChild(el);
      }
    });

    document.body.appendChild(menu);
    this._clampMenuToViewport(menu, x, y);
    this._attachMenuDismissal(menu);
  },

  rebuildAllTabs() {
    // Clear all tab elements
    document.getElementById('tabs-list').innerHTML = '';
    document.querySelectorAll('.tab-group-tabs').forEach(el => el.innerHTML = '');

    // Remove old pinned container
    document.querySelector('.pinned-tabs-container')?.remove();

    this.renderGroups();

    // Render pinned tabs as compact icons
    const pinned = this.tabs.filter(t => t.pinned);
    if (pinned.length > 0) {
      const pinnedContainer = document.createElement('div');
      pinnedContainer.className = 'pinned-tabs-container';
      pinned.forEach(tab => {
        const el = document.createElement('div');
        el.className = `pinned-tab${tab.id === this.activeTabId ? ' active' : ''}`;
        el.dataset.tabId = tab.id;
        el.title = tab.title;
        el.innerHTML = tab.favicon
          ? `<img src="${tab.favicon}" alt="">`
          : `<div class="pinned-placeholder">${(tab.title || 'T')[0]}</div>`;
        el.addEventListener('click', () => this.switchTab(tab.id));
        el.addEventListener('contextmenu', (e) => { e.preventDefault(); this.showContextMenu(e, tab); });
        pinnedContainer.appendChild(el);
      });
      const tabsList = document.getElementById('tabs-list');
      tabsList.parentElement.insertBefore(pinnedContainer, tabsList);
    }

    // Render unpinned tabs normally
    this.tabs.filter(t => !t.pinned).forEach(tab => this.renderTab(tab));

    // Re-apply active state on unpinned
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

  // === Sleep/Wake ===
  async sleepTab(id) {
    const tab = this.tabs.find(t => t.id === id);
    if (!tab || tab.sleeping || tab.id === this.activeTabId) return;

    tab.originalUrl = tab.url;

    // Capture scroll position before tearing down the webview, so wake can
    // restore where the user left off. Best-effort — if executeJavaScript
    // throws (page already gone, cross-origin top frame, etc.) fall back to 0.
    const wv = WebviewManager.webviews.get(id);
    if (wv) {
      try {
        const pos = await wv.executeJavaScript('({x: window.scrollX, y: window.scrollY})');
        if (pos && Number.isFinite(pos.x) && Number.isFinite(pos.y)) {
          tab.scrollPosition = { x: pos.x, y: pos.y };
        }
      } catch { /* ignore */ }
      wv.remove();
      WebviewManager.webviews.delete(id);
    }

    tab.sleeping = true;

    // Update UI for the vertical sidebar (.tab-item) AND the horizontal tab
    // bar (.top-tab). Default layout is horizontal, so without the second
    // path Sleep Tab from the right-click menu produced no visible change.
    const el = document.querySelector(`.tab-item[data-tab-id="${id}"]`);
    if (el) el.classList.add('sleeping');
    if (typeof HorizontalTabs !== 'undefined') HorizontalTabs.render?.();

    this.persistTabs();
  },

  wakeTab(id) {
    const tab = this.tabs.find(t => t.id === id);
    if (!tab || !tab.sleeping) return;

    tab.sleeping = false;
    const url = tab.originalUrl || tab.url;
    tab.url = url;

    // Recreate webview
    WebviewManager.createWebview(tab);

    // Restore scroll position once the page has loaded. One-shot listener;
    // best-effort (cross-origin pages may ignore it, that's fine).
    const wv = WebviewManager.webviews.get(id);
    if (wv && tab.scrollPosition) {
      const pos = tab.scrollPosition;
      const restoreScroll = () => {
        try {
          wv.executeJavaScript(`window.scrollTo(${pos.x}, ${pos.y})`).catch(() => {});
        } catch { /* ignore */ }
      };
      wv.addEventListener('did-finish-load', restoreScroll, { once: true });
    }

    const el = document.querySelector(`.tab-item[data-tab-id="${id}"]`);
    if (el) el.classList.remove('sleeping');
    if (typeof HorizontalTabs !== 'undefined') HorizontalTabs.render?.();

    this.persistTabs();
  },

  sleepAllInactive() {
    this.tabs.forEach(t => {
      if (t.id !== this.activeTabId && !t.sleeping && !t._lazy) {
        this.sleepTab(t.id);
      }
    });
  },

  wakeAllTabs() {
    this.tabs.forEach(t => {
      if (t.sleeping) this.wakeTab(t.id);
    });
  },

  // === Auto-Sleep ===
  startAutoSleep(thresholdMinutes, excludePinned) {
    this.stopAutoSleep();
    this._autoSleepInterval = setInterval(() => {
      const threshold = (thresholdMinutes || 30) * 60 * 1000;
      const now = Date.now();
      this.tabs.forEach(t => {
        if (t.id === this.activeTabId) return;
        if (t.sleeping || t._lazy) return;
        if (excludePinned && t.pinned) return;
        if (!t.lastViewedAt) t.lastViewedAt = now;
        if (now - t.lastViewedAt >= threshold) {
          this.sleepTab(t.id);
        }
      });
    }, 30000);
  },

  stopAutoSleep() {
    if (this._autoSleepInterval) {
      clearInterval(this._autoSleepInterval);
      this._autoSleepInterval = null;
    }
  },

  // === Recently Closed ===
  reopenLastClosed() {
    const list = getRecentlyClosed();
    if (list.length === 0) {
      window.showToast?.('No recently closed tabs');
      return;
    }
    const last = list.shift();
    saveRecentlyClosed(list);
    this.createTab(last.url, true, last.groupId);
  },

  // === Mute/Unmute ===
  toggleMuteTab(id) {
    const tabId = id || this.activeTabId;
    const tab = this.tabs.find(t => t.id === tabId);
    if (!tab) return;
    const wv = WebviewManager.webviews.get(tabId);
    if (wv) {
      const muted = wv.isAudioMuted();
      wv.setAudioMuted(!muted);
      tab.muted = !muted;
      this.renderTabUpdate(tab);
      window.showToast?.(tab.muted ? 'Tab muted' : 'Tab unmuted');
    }
  },

  muteAllOtherTabs(keepId) {
    const keep = keepId || this.activeTabId;
    this.tabs.forEach(t => {
      if (t.id !== keep) {
        const wv = WebviewManager.webviews.get(t.id);
        if (wv) { wv.setAudioMuted(true); t.muted = true; }
      }
    });
    this.rebuildAllTabs();
  },

  // Close every tab except the specified one; pinned tabs are preserved.
  // Switches to the kept tab first so we never briefly activate a tab we're
  // about to destroy (which caused flicker + potential webview race conditions).
  closeOtherTabs(keepId) {
    const keep = keepId || this.activeTabId;
    if (!keep) return;
    const toClose = this.tabs.filter(t => t.id !== keep && !t.pinned).map(t => t.id);
    if (!toClose.length) {
      window.showToast?.('No other tabs to close', 'info');
      return;
    }
    if (this.activeTabId !== keep) this.switchTab(keep);
    toClose.forEach(id => this.closeTab(id));
    window.showToast?.(`Closed ${toClose.length} other tab${toClose.length === 1 ? '' : 's'}`, 'success');
  },

  // Close tabs that appear *after* the given anchor in display order;
  // pinned tabs are preserved.
  closeTabsToTheRight(anchorId) {
    const idx = this.tabs.findIndex(t => t.id === anchorId);
    if (idx < 0) return;
    const toClose = this.tabs.slice(idx + 1).filter(t => !t.pinned).map(t => t.id);
    if (!toClose.length) {
      window.showToast?.('No tabs to the right', 'info');
      return;
    }
    if (toClose.includes(this.activeTabId)) this.switchTab(anchorId);
    toClose.forEach(id => this.closeTab(id));
    window.showToast?.(`Closed ${toClose.length} tab${toClose.length === 1 ? '' : 's'} to the right`, 'success');
  },

  // === Pin/Unpin (icon-only mode) ===
  pinTab(id) {
    const tab = this.tabs.find(t => t.id === id);
    if (!tab) return;
    tab.pinned = true;
    this.rebuildAllTabs();
    this.persistTabs();
  },

  unpinTab(id) {
    const tab = this.tabs.find(t => t.id === id);
    if (!tab) return;
    tab.pinned = false;
    this.rebuildAllTabs();
    this.persistTabs();
  },

  togglePinTab(id) {
    const tab = this.tabs.find(t => t.id === (id || this.activeTabId));
    if (!tab) return;
    tab.pinned ? this.unpinTab(tab.id) : this.pinTab(tab.id);
  },

  _escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  },

  // Custom prompt — Electron's renderer disables window.prompt(). Returns a
  // Promise that resolves to the entered string, or null on cancel/escape.
  _promptInput(title, label, defaultValue) {
    return new Promise(resolve => {
      document.querySelectorAll('.vex-prompt-overlay').forEach(o => o.remove());
      const overlay = document.createElement('div');
      overlay.className = 'vex-prompt-overlay';
      overlay.innerHTML = `
        <div class="vex-prompt">
          <div class="vex-prompt-title">${this._escapeHtml(title || 'Input')}</div>
          ${label ? `<div class="vex-prompt-label">${this._escapeHtml(label)}</div>` : ''}
          <input type="text" class="vex-prompt-input" value="${this._escapeHtml(defaultValue || '')}">
          <div class="vex-prompt-actions">
            <button class="vex-prompt-cancel">Cancel</button>
            <button class="vex-prompt-ok">OK</button>
          </div>
        </div>`;
      document.body.appendChild(overlay);
      const input = overlay.querySelector('.vex-prompt-input');
      const done = (val) => { overlay.remove(); resolve(val); };
      input.focus();
      input.select();
      overlay.querySelector('.vex-prompt-ok').addEventListener('click', () => done(input.value));
      overlay.querySelector('.vex-prompt-cancel').addEventListener('click', () => done(null));
      overlay.addEventListener('click', (e) => { if (e.target === overlay) done(null); });
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter')  { e.preventDefault(); done(input.value); }
        if (e.key === 'Escape') { e.preventDefault(); done(null); }
      });
    });
  },

  // Shared dismissal wiring for any context menu we open. Listens on capture
  // phase so child handlers calling stopPropagation() (the tab close button
  // does this) can't swallow the close. Also handles right-click to relocate
  // and Escape to dismiss.
  _attachMenuDismissal(menu) {
    const close = () => {
      menu.remove();
      document.removeEventListener('click', onDocClick, true);
      document.removeEventListener('contextmenu', onDocCtx, true);
      document.removeEventListener('keydown', onKey, true);
      window.removeEventListener('blur', close, true);
    };
    const onDocClick = (ev) => { if (!menu.contains(ev.target)) close(); };
    const onDocCtx   = (ev) => { if (!menu.contains(ev.target)) close(); };
    const onKey      = (ev) => { if (ev.key === 'Escape') close(); };
    // Defer attach to the next tick so the right-click that opened the menu
    // doesn't immediately fire the dismissal listeners.
    setTimeout(() => {
      document.addEventListener('click', onDocClick, true);
      document.addEventListener('contextmenu', onDocCtx, true);
      document.addEventListener('keydown', onKey, true);
      window.addEventListener('blur', close, true);
    }, 0);
  },

  // Clamp menu inside the viewport. Call on rAF after the menu is in the DOM
  // so getBoundingClientRect picks up actual rendered size.
  _clampMenuToViewport(menu, x, y) {
    requestAnimationFrame(() => {
      const r = menu.getBoundingClientRect();
      let nx = x, ny = y;
      if (r.right > window.innerWidth)  nx = Math.max(8, window.innerWidth  - r.width  - 8);
      if (r.bottom > window.innerHeight) ny = Math.max(8, window.innerHeight - r.height - 8);
      if (nx !== x) menu.style.left = nx + 'px';
      if (ny !== y) menu.style.top  = ny + 'px';
    });
  }
};

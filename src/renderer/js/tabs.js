// === Vex Tab Manager ===
//
// Owns the in-memory tab list and group list, drives sleep/wake (with scroll
// capture), auto-sleep, drag-drop reordering, recently-closed restore, and the
// vertical-sidebar tab UI. Persists via VexStorage.{saveTabs,saveGroups}.
// Public API: TabManager (singleton). Depends on WebviewManager,
// HorizontalTabs (optional), VexStorage, TabGrouper (optional).

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

// Build the start-page URL carrying the active theme. At runtime the start page
// loads over file:// (get-start-page-url's fallback), which bypasses the vex://
// protocol theme-baker — so we hand the theme to start.html via a ?theme= query
// it reads on load. Theme source is the same value ThemeManager persists
// (mirrored to localStorage('vex.theme')); falls back to oxford. A vex://start
// base is returned untouched so its server-side baker still handles the theme.
function startUrlWithTheme(base) {
  let theme = 'oxford';
  try {
    if (typeof ThemeManager !== 'undefined' && typeof ThemeManager.getCurrentTheme === 'function') {
      theme = ThemeManager.getCurrentTheme() || theme;
    } else {
      theme = localStorage.getItem('vex.theme') || theme;
    }
  } catch {}
  const url = base || START_URL;
  // Drop any existing query/hash so restored tabs don't stack stale ?theme=.
  const clean = String(url).split('#')[0].split('?')[0];
  if (/^vex:\/\/start/i.test(clean)) return clean; // vex:// handler bakes theme itself
  return `${clean}?theme=${encodeURIComponent(theme)}`;
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
  // Phase 4a — tab stacks. Mutually exclusive with groups (a tab may have
  // groupId XOR stackId, never both). Stack shape: {id, name, color, topTabId}.
  // See docs/PHASE-4-TAB-STACKS-PLAN.md.
  stacks: [],
  // Phase 4c — which stacks are currently expanded. Ephemeral UI state ONLY:
  // never persisted (plan §2/§3a — stacks are "always collapsed" on disk;
  // expansion is transient). A newly created stack is collapsed by default
  // because its id is absent from this Set.
  _expandedStackIds: new Set(),
  // Legacy seed groups (CUSA/School/Dev/Chat) removed — groups now start
  // empty. Users create groups via right-click "New group from this tab"
  // or the Phase 16 AI auto-grouper (Ctrl+Shift+G).
  _legacySeedIds: new Set(['cusa', 'school', 'dev', 'chat']),

  async init() {
    this.groups = (await VexStorage.loadGroups()) || [];
    this.stacks = (typeof VexStorage.loadStacks === 'function')
      ? ((await VexStorage.loadStacks()) || [])
      : [];

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

    // Same prune pass for stacks: drop stacks whose member set is empty,
    // and run topTabId fallback for stacks whose top is no longer live.
    const liveStackIds = new Set(loadedTabs.map(t => t.stackId).filter(Boolean));
    const beforeStacks = this.stacks.length;
    this.stacks = this.stacks.filter(s => liveStackIds.has(s.id));
    for (const stack of this.stacks) {
      const stillLiveMember = loadedTabs.some(t => t.stackId === stack.id && t.id === stack.topTabId);
      if (!stillLiveMember) {
        const fallback = loadedTabs.find(t => t.stackId === stack.id);
        if (fallback) stack.topTabId = fallback.id;
      }
    }
    if (this.stacks.length !== beforeStacks && typeof VexStorage.saveStacks === 'function') {
      console.log(`[Tabs] Pruned ${beforeStacks - this.stacks.length} empty stack(s)`);
      await VexStorage.saveStacks(this.stacks);
    }

    // Restore in TWO phases so grouping comes back for ALL tabs at once.
    // Phase 1: build every tab object into this.tabs (and create webviews for
    // awake tabs) WITHOUT rendering. Phase 2: a single rebuildAllTabs() renders
    // the group containers FIRST, then places each tab into its group.
    //
    // The old code rendered each tab as it was created (createTab → renderTab)
    // BEFORE renderGroups() had built the group containers, so renderTab's
    // "container missing" fallback stripped groupId off every restored tab —
    // leaving them ungrouped until the auto-grouper lazily re-assigned them one
    // by one on activation. Building first and rendering last fixes that.
    const savedTabs = await VexStorage.loadTabs();
    if (savedTabs.length > 0) {
      for (const t of savedTabs) {
        const id = `tab-${++this.tabCounter}`;
        // Restored start tabs reload in the CURRENT persisted theme: rebuild
        // their URL with a fresh ?theme= (the saved one may carry a stale
        // theme). Non-start tabs keep their saved URL untouched.
        const tabUrl = isStartPage(t.url) ? startUrlWithTheme() : (t.url || START_URL);
        if (t.sleeping) {
          // Sleeping at shutdown → stay sleeping; no webview, scroll preserved.
          this.tabs.push({
            id,
            url: tabUrl,
            title: t.title || (isStartPage(t.url) ? 'New Tab' : t.url),
            favicon: null,
            loading: false,
            pinned: !!t.pinned,
            unread: false,
            groupId: t.groupId || null,
            stackId: t.stackId || null,
            sleeping: true,
            originalUrl: isStartPage(t.url) ? tabUrl : (t.originalUrl || t.url),
            scrollPosition: t.scrollPosition || null
          });
        } else {
          // Lazy restore: rebuild the tab record WITHOUT a webview. It
          // materializes (creates its webview, loads the URL) only when first
          // activated — see switchTab → _materializeTab. So a big saved session
          // costs almost nothing at launch; only the focused tab is live.
          // Saved title + favicon keep the sidebar looking right meanwhile.
          this.tabs.push({
            id,
            url: tabUrl,
            title: t.title || (isStartPage(t.url) ? 'New Tab' : (t.url || 'Tab')),
            favicon: t.favicon || null,
            loading: false,
            pinned: !!t.pinned,
            unread: false,
            groupId: t.groupId || null,
            stackId: t.stackId || null,
            _lazy: true
          });
        }
      }
      // On launch, always focus a Home (vex://start) tab rather than the
      // previously-shown tab. Reuse an existing restored start tab if present
      // so we don't pile up duplicate Home tabs across launches (a fresh one
      // each launch would persist into vex.tabs and accumulate); create one
      // only when none was restored. Restored tabs/groups are left untouched —
      // this only changes which tab is active (+ at most one added Home tab).
      let home = this.tabs.find(t => isStartPage(t.url));
      if (!home) {
        home = {
          id: `tab-${++this.tabCounter}`,
          url: startUrlWithTheme(),
          title: 'New Tab',
          favicon: null,
          loading: true,
          pinned: false,
          unread: false,
          groupId: null,
          stackId: null
        };
        this.tabs.push(home);
        WebviewManager.createWebview(home);
      }
      this.activeTabId = home.id;
    } else {
      const tab = {
        id: `tab-${++this.tabCounter}`,
        url: startUrlWithTheme(),
        title: 'New Tab',
        favicon: null,
        loading: true,
        pinned: false,
        unread: false,
        groupId: null,
        stackId: null
      };
      this.tabs.push(tab);
      WebviewManager.createWebview(tab);
      this.activeTabId = tab.id;
    }

    // Single ordered render pass. rebuildAllTabs() internally does
    // renderGroups() (builds containers) → pinned → renderTab() per tab →
    // renderStacks(), so every restored tab lands in its group in one shot.
    this.rebuildAllTabs();

    // Drive the full activation side-effects (show webview, URL bar, wake).
    if (this.activeTabId) this.switchTab(this.activeTabId);

    this.setupNewTabButton();
    this.setupDragDrop();
  },

  createTab(url, activate = true, groupId = null, opts = null) {
    const id = `tab-${++this.tabCounter}`;
    // A start tab gets the active theme baked into its URL (?theme=) so the
    // file://-loaded start page renders in-theme; real URLs pass through.
    const target = url || START_URL;
    const resolvedUrl = isStartPage(target) ? startUrlWithTheme() : target;
    const tab = {
      id,
      url: resolvedUrl,
      title: isStartPage(target) ? 'New Tab' : 'Loading...',
      favicon: null,
      loading: true,
      pinned: false,
      unread: false,
      groupId: groupId,
      stackId: null,
      // Container tabs: an isolated cookie jar (persist:container-<name>)
      partition: (opts && opts.partition) || null
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
    // Phase 4a: same idea for stacks. Route through removeTabFromStack
    // BEFORE the splice so auto-disband sees the still-living member set.
    const closedStackId = this.tabs[idx]?.stackId || null;
    if (closedStackId) {
      this.removeTabFromStack(id);
    }

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

    // Phase 4c — closing a stack member shifts the header's count badge and
    // may have auto-disbanded the stack. The stack header has no data-tab-id,
    // so the el.remove() above can't reach it; rebuild to resync the strip.
    if (closedStackId) this.rebuildAllTabs();
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
      stackId: null,
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
    // Don't stomp the user's in-progress edit. Async webview load events
    // (did-navigate/did-stop-loading/etc.) re-run this while the user has just
    // focused + pasted/typed into the bar, which would wipe their text (the
    // "paste twice" bug). When the bar is focused we skip the overwrite; the
    // blur handler below re-syncs the bar to the real URL once editing ends.
    if (document.activeElement === urlInput) return;
    if (isStartPage(tab.url)) {
      urlInput.value = '';
      urlInput.placeholder = 'Search or enter URL...';
    } else {
      urlInput.value = tab.url;
    }
  },

  renderTab(tab) {
    // Phase 4b — stacked tabs have no individual .tab-item element. They're
    // represented entirely by the stack header (renderStacks). Skipping here
    // keeps single-tab render paths (createTab → renderTab, init's sleeping
    // branch → renderTab) consistent with rebuildAllTabs's filter.
    if (tab.stackId) return;

    const container = tab.groupId
      ? document.querySelector(`.tab-group[data-group-id="${tab.groupId}"] .tab-group-tabs`)
      : document.getElementById('tabs-list');

    if (!container) {
      // Container not found. Only ORPHAN the tab (clear groupId) if its group
      // genuinely no longer exists. A missing-but-valid group just means
      // renderGroups() hasn't built the container yet (e.g. mid-restore, or a
      // stray renderTab before rebuildAllTabs) — wiping groupId there would
      // permanently destroy membership, which was the session-restore bug.
      // In that case keep groupId and render into the loose list temporarily;
      // the next rebuildAllTabs() places it correctly.
      const groupStillExists = tab.groupId && this.groups.some(g => g.id === tab.groupId);
      if (!groupStillExists) {
        this._setTabGroup(tab.id, null);
      }
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
    // Sleeping tabs render dimmed. Set here so any render path (init restore,
    // rebuildAllTabs) shows the state — not just the old init sleeping branch.
    if (tab.sleeping) el.classList.add('sleeping');

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

  // Phase 4b — render the closed-state stack header for each stack into
  // #tabs-list. Per docs/PHASE-4-TAB-STACKS-PLAN.md §3a, each stack emits ONE
  //
  //   <li class="tab-item tab-stack" data-stack-id="…">
  //
  // whose contents reflect the top tab (favicon + title) plus a count badge.
  // Member tabs are NOT rendered as separate elements in 4b — they're
  // represented entirely by the stack header. The renderTab filter at line
  // referenced below skips any tab whose stackId is set.
  //
  // The deck-of-cards illusion comes from CSS pseudo-elements on .tab-stack;
  // no extra DOM. Click-to-switch lives on the header itself and routes to
  // the topTabId tab. Expansion / right-click menu / Ctrl+ArrowDown are 4c.
  renderStacks() {
    const tabsList = document.getElementById('tabs-list');
    if (!tabsList) return;

    for (const stack of this.stacks) {
      const members = this.tabs.filter(t => t.stackId === stack.id);
      const memberCount = members.length;
      // Defensive: 4a's load-time prune + auto-disband should keep this from
      // ever hitting in practice. If we still see one, log + skip — better
      // than rendering an empty header that goes nowhere on click.
      if (memberCount === 0) {
        console.warn('[Tabs] renderStacks: skipping empty stack', stack.id);
        continue;
      }
      const topTab = this.tabs.find(t => t.id === stack.topTabId && t.stackId === stack.id);
      if (!topTab) {
        // topTabId points at a tab that doesn't exist or isn't in this stack.
        // 4a's _fallbackTopTab on init should prevent this — log and skip.
        console.warn('[Tabs] renderStacks: orphan topTabId for stack', stack.id, '→', stack.topTabId);
        continue;
      }

      // Phase 4c — expansion is ephemeral UI state in _expandedStackIds.
      // Absent ⇒ collapsed (the default for any freshly created stack).
      const expanded = this._expandedStackIds.has(stack.id);

      const el = document.createElement('div');
      el.className = 'tab-item tab-stack' + (expanded ? ' expanded' : '');
      el.dataset.stackId = stack.id;
      // Per the existing --group-color pattern in tabs.css, expose the stack
      // colour as a CSS custom property so the deck-of-cards pseudo-elements
      // and left-border accent can pull from it without inline style hacks.
      el.style.setProperty('--stack-color', stack.color || '#d4a574');

      const favicon = topTab.favicon
        ? `<img class="tab-favicon" src="${topTab.favicon}" alt="">`
        : `<div class="tab-favicon-placeholder">${this._escapeHtml((topTab.title || 'T')[0])}</div>`;
      // Count badge is shown only when collapsed (CSS hides it on .expanded):
      // "Research (5)" collapsed, just "Research" expanded — per the 4c spec.
      // The chevron mirrors the tab-group chevron and rotates on expand.
      el.innerHTML = `
        ${favicon}
        <span class="tab-title">${this._escapeHtml(topTab.title || 'Untitled')}</span>
        <span class="tab-stack-count" aria-label="${memberCount} tabs in stack">${memberCount}</span>
        <svg class="tab-stack-chevron" width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M4 3L8 6L4 9" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" fill="none"/></svg>
      `;

      // Phase 4c — clicking the header toggles expand/collapse. This
      // supersedes the 4b click-to-switch: switching to a tab now happens by
      // clicking a member row inside the expanded stack (see below).
      el.addEventListener('click', () => this.toggleStackExpanded(stack.id));
      el.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.showStackContextMenu(e, stack.id);
      });

      tabsList.appendChild(el);

      // Expanded — render every member as an indented .tab-item.in-stack row
      // directly below the header. Reusing _createTabElement keeps the member
      // rows' click-to-switch / close / context-menu wiring identical to a
      // free tab; clicking one switches to it without leaving the stack.
      if (expanded) {
        for (const member of members) {
          const memberEl = this._createTabElement(member);
          memberEl.classList.add('in-stack');
          memberEl.style.setProperty('--stack-color', stack.color || '#d4a574');
          tabsList.appendChild(memberEl);
        }
      }
    }
  },

  // Phase 4c — Feature 3. Flip a stack between collapsed and expanded.
  // Expansion lives only in memory (_expandedStackIds); a full rebuild
  // re-renders the strip with or without the member rows.
  toggleStackExpanded(stackId) {
    const stack = this.stacks.find(s => s.id === stackId);
    if (!stack) return;
    if (this._expandedStackIds.has(stackId)) {
      this._expandedStackIds.delete(stackId);
    } else {
      this._expandedStackIds.add(stackId);
    }
    this.rebuildAllTabs();
  },

  // Phase 4c — Feature 1. Turn an existing tab group into a stack: every tab
  // in the group becomes a stack member (createStack clears their groupId via
  // _setTabStack), then the now-empty group object is dropped. The new stack
  // starts collapsed — its id is never added to _expandedStackIds here.
  convertGroupToStack(groupId) {
    const group = this.groups.find(g => g.id === groupId);
    if (!group) return null;
    const tabIds = this.tabs.filter(t => t.groupId === groupId).map(t => t.id);
    if (tabIds.length < 2) {
      window.showToast?.('A stack needs at least 2 tabs', 'info');
      return null;
    }
    const stack = this.createStack(tabIds, group.name, group.color);
    if (!stack) return null;

    // createStack already cleared groupId on every member; drop the emptied
    // group object so it doesn't linger in TabManager.groups + storage.
    this.groups = this.groups.filter(g => g.id !== groupId);
    if (typeof VexStorage !== 'undefined' && typeof VexStorage.saveGroups === 'function') {
      VexStorage.saveGroups(this.groups);
    }

    this.rebuildAllTabs();
    this.persistTabs();
    window.showToast?.(`Converted "${group.name}" to a stack`, 'success');
    return stack;
  },

  // Phase 4c — Feature 5. Right-click menu for a stack header.
  showStackContextMenu(event, stackId) {
    document.querySelectorAll('.tab-context-menu, .tab-group-context-menu, .context-menu-overlay').forEach(m => m.remove());
    const stack = this.stacks.find(s => s.id === stackId);
    if (!stack) return;
    const members = this.tabs.filter(t => t.stackId === stackId);
    const count = members.length;

    const menu = document.createElement('div');
    menu.className = 'tab-context-menu tab-stack-context-menu';
    const x = event.clientX, y = event.clientY;
    menu.style.left = x + 'px';
    menu.style.top  = y + 'px';
    menu.innerHTML = `
      <div class="tab-context-item" data-action="ungroup">📤 Ungroup (back to group)</div>
      <div class="tab-context-sep"></div>
      <div class="tab-context-item danger" data-action="close-tabs">✕ Close all ${count} tab${count === 1 ? '' : 's'}</div>
    `;
    document.body.appendChild(menu);
    this._clampMenuToViewport(menu, x, y);

    menu.querySelectorAll('.tab-context-item').forEach(item => {
      item.addEventListener('click', () => {
        const action = item.dataset.action;
        this._dismissMenu(menu);
        this._handleStackAction(action, stackId);
      });
    });
    this._attachMenuDismissal(menu);
  },

  _handleStackAction(action, stackId) {
    const stack = this.stacks.find(s => s.id === stackId);
    if (!stack) return;
    const members = this.tabs.filter(t => t.stackId === stackId);

    switch (action) {
      case 'close-tabs': {
        // Each closeTab routes through removeTabFromStack; the stack
        // auto-disbands once it falls below 2 members, so closing the whole
        // member set also removes the stack object. closeTab rebuilds the
        // strip per-call (see its 4c tail), keeping the DOM in sync.
        const n = members.length;
        members.forEach(t => this.closeTab(t.id));
        this._expandedStackIds.delete(stackId);
        window.showToast?.(`Closed ${n} tab${n === 1 ? '' : 's'}`, 'success');
        break;
      }
      case 'ungroup': {
        // Convert the stack back into a regular group: re-home every member
        // into a fresh group (which clears stackId), then drop the stack.
        const id = 'grp_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
        this.groups.push({ id, name: stack.name, color: stack.color, collapsed: false });
        members.forEach(t => this._setTabGroup(t.id, id));
        this.stacks = this.stacks.filter(s => s.id !== stackId);
        this._expandedStackIds.delete(stackId);
        if (typeof VexStorage !== 'undefined') {
          if (typeof VexStorage.saveGroups === 'function') VexStorage.saveGroups(this.groups);
          if (typeof VexStorage.saveStacks === 'function') VexStorage.saveStacks(this.stacks);
        }
        this.rebuildAllTabs();
        this.persistTabs();
        window.showToast?.(`Ungrouped "${stack.name}"`, 'info');
        break;
      }
    }
  },

  // Right-click menu for a group header
  showGroupContextMenu(event, groupId) {
    document.querySelectorAll('.tab-group-context-menu, .tab-context-menu, .context-menu-overlay').forEach(m => m.remove());
    const group = this.groups.find(g => g.id === groupId);
    if (!group) return;
    const tabsInGroup = this.tabs.filter(t => t.groupId === groupId);

    const menu = document.createElement('div');
    menu.className = 'tab-context-menu tab-group-context-menu';
    menu.style.left = event.clientX + 'px';
    menu.style.top  = event.clientY + 'px';
    const x = event.clientX, y = event.clientY;
    const count = tabsInGroup.length;
    // "Convert to Stack" needs \u22652 tabs (createStack rejects single-member
    // stacks \u2014 Section 7 risk register). Disabled, not hidden, so the user
    // sees the option exists and learns why it's unavailable.
    const canStack = count >= 2;
    menu.innerHTML = `
      <div class="tab-context-item" data-action="rename">\u270f\ufe0f Rename group</div>
      <div class="tab-context-item" data-action="change-color">\ud83c\udfa8 Change color</div>
      <div class="tab-context-item${canStack ? '' : ' disabled'}" data-action="convert-to-stack" title="${canStack ? '' : 'A stack needs at least 2 tabs'}">\ud83d\udcda Convert to Stack</div>
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
        if (item.classList.contains('disabled')) return;
        const action = item.dataset.action;
        this._dismissMenu(menu);
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
        this._showGroupColorPicker(groupId, (colorValue) => {
          // colorValue is a CSS color or a var(--vex-*) ref (see _themeGroupPalette).
          group.color = colorValue;
          VexStorage.saveGroups(this.groups);
          this.rebuildAllTabs();
        });
        break;
      }
      case 'convert-to-stack': {
        this.convertGroupToStack(groupId);
        break;
      }
      case 'close-tabs': {
        if (!confirm(`Close ${tabsInGroup.length} tab${tabsInGroup.length === 1 ? '' : 's'} in "${group.name}"? The group itself stays.`)) return;
        tabsInGroup.forEach(t => this.closeTab(t.id));
        break;
      }
      case 'ungroup': {
        tabsInGroup.forEach(t => { this._setTabGroup(t.id, null); });
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
    // Default a new group to the active theme's accent (as a var() ref so it
    // re-matches when the theme changes); recolor from the theme palette via
    // right-click.
    const defaultColor = (this._themeGroupPalette()[0] || {}).ref || GROUP_COLORS[0];
    this.groups.push({ id, name: name.trim(), color: defaultColor, collapsed: false });
    this._setTabGroup(tab.id, id);
    VexStorage.saveGroups(this.groups);
    this.rebuildAllTabs();
    this.persistTabs();
    window.showToast?.(`Created group "${name.trim()}"`, 'success');
  },

  // Build the group-color palette from the ACTIVE theme's own tokens so the
  // choices always belong to the current theme — pick in Dracula and you get
  // Dracula's purple/pink/green; pick in Ocean and you get its cyans.
  //
  // Returns [{ ref, color }] where:
  //   • ref   — what we STORE on the group: a CSS var() reference like
  //             "var(--vex-accent)". Stored as a var() so the group RE-MATCHES
  //             the theme when the user switches themes — the var re-resolves
  //             live against the new [data-theme] with zero re-render.
  //   • color — the var's CURRENTLY resolved hex, used to paint the swatch and
  //             to de-dup roles that collapse to the same hue in this theme.
  // getComputedStyle returns custom properties as their authored value, and the
  // theme blocks define these semantic vars as plain hex, so reading them gives
  // real colors. Falls back to fixed hexes (ref == color) when tokens can't be
  // read (e.g. jsdom under vitest) — those simply won't re-theme.
  _themeGroupPalette() {
    const roles = [
      '--vex-accent', '--vex-text-accent', '--vex-success',
      '--vex-warning', '--vex-danger', '--accent', '--primary',
    ];
    try {
      const cs = getComputedStyle(document.documentElement);
      const seen = new Set();
      const out = [];
      for (const r of roles) {
        const v = (cs.getPropertyValue(r) || '').trim();
        // Skip empties and anything still symbolic — can't de-dup or preview it.
        if (!v || /var\(|color-mix/i.test(v) || /^(transparent|inherit|initial)$/i.test(v)) continue;
        const key = v.toLowerCase().replace(/\s+/g, '');
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ ref: `var(${r})`, color: v });
      }
      if (out.length >= 4) return out.slice(0, 8);
    } catch { /* fall through to fixed palette */ }
    return GROUP_COLORS.map(c => ({ ref: c, color: c }));
  },

  _showGroupColorPicker(groupId, onPick) {
    const colors = this._themeGroupPalette();
    document.querySelectorAll('.group-color-picker-overlay').forEach(o => o.remove());
    const overlay = document.createElement('div');
    overlay.className = 'group-color-picker-overlay';
    overlay.innerHTML = `
      <div class="group-color-picker">
        <div class="group-color-picker-title">Pick a color</div>
        <div class="group-color-grid">
          ${colors.map(c => `<button class="group-color-swatch" data-color="${c.ref}" style="background:${c.color}" title="${c.color}"></button>`).join('')}
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
    document.querySelectorAll('.tab-context-menu, .tab-group-context-menu, .context-menu-overlay').forEach(m => m.remove());

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
      { label: 'Page volume…', action: async () => {
        const v = typeof vexPromptModal === 'function' ? await vexPromptModal('Page volume (0–100%)', '100') : prompt('Volume 0-100', '100');
        const n = parseInt(v, 10);
        if (isNaN(n)) return;
        const wv = WebviewManager.webviews.get(tab.id);
        try { wv?.executeJavaScript(`document.querySelectorAll('video,audio').forEach(m=>m.volume=${Math.min(100, Math.max(0, n)) / 100})`); } catch {}
        window.showToast?.('Volume ' + Math.min(100, Math.max(0, n)) + '%');
      } },
      { sep: true },
      ...moveTargets.map(g => ({
        label: `Move to ${g.name}`,
        color: g.color,
        action: () => {
          this._setTabGroup(tab.id, g.id);
          this.rebuildAllTabs();
          this.persistTabs();
        }
      })),
      ...(moveTargets.length ? [{ sep: true }] : []),
      { label: 'Add to new group', action: () => this._newGroupFromTab(tab) },
      ...(tab.groupId ? [{ label: '\u2190 Remove from group', action: () => { this._setTabGroup(tab.id, null); this.rebuildAllTabs(); this.persistTabs(); } }] : []),
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
          this._dismissMenu(menu);
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

    // Render unpinned, non-stacked tabs normally. Stacked tabs are
    // represented by the stack header (rendered next) and must not appear
    // as their own .tab-item — otherwise the user sees both the stack
    // header AND its members at once, which is visual chaos and breaks
    // the "1 strip slot per stack" contract from the planning doc §1.
    this.tabs.filter(t => !t.pinned && !t.stackId).forEach(tab => this.renderTab(tab));

    // Phase 4b — render stack headers AFTER ungrouped tabs so the visual
    // hierarchy reads top→bottom: groups (containers with members visible),
    // ungrouped tabs (loose), then stacks (collapsed containers). Logical
    // structured-first → loose-last. UI for 4c can revisit if hierarchy
    // feels wrong in practice.
    this.renderStacks();

    // Re-apply active state on unpinned. Stack headers don't get .active
    // (the active tab IS one of the stack's members, not the header itself);
    // visually showing "active" on a stack header would lie about which tab
    // the webview is actually showing. The header is a navigation target,
    // not a state indicator.
    document.querySelectorAll('.tab-item').forEach(el => {
      el.classList.toggle('active', el.dataset.tabId === this.activeTabId);
    });

    // Zero-padded sequential index per .tab-item, exposed as data-tab-index for
    // any theme/feature that wants a "[01] Title" prefix. The DOM order at this
    // point is the visible top→bottom order, which is what we want.
    document.querySelectorAll('.tab-item').forEach((el, i) => {
      el.setAttribute('data-tab-index', String(i + 1).padStart(2, '0'));
    });
    // NB: the horizontal top bar is refreshed automatically — HorizontalTabs
    // ._patchTabManager() wraps rebuildAllTabs() to call its render() after
    // this returns. Do NOT call HorizontalTabs.render() here too, or every
    // rebuild paints the top bar twice.
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

  // === Memory-pressure guard (adaptive) ===
  // Only when total browser memory crosses the ceiling, sleep the least-
  // recently-viewed background tabs (never the active or pinned ones) until
  // back under. Light sessions are never touched; heavy ones stay capped —
  // this is what keeps Vex near its floor without disrupting normal use.
  startMemoryGuard(ceilingMB) {
    this.stopMemoryGuard();
    this._memCeiling = ceilingMB || 0;
    if (!this._memCeiling) return;
    this._memGuard = setInterval(() => this._memorySweep(), 45000);
    setTimeout(() => this._memorySweep(), 20000);
  },
  stopMemoryGuard() { if (this._memGuard) { clearInterval(this._memGuard); this._memGuard = null; } },
  async _memorySweep() {
    if (!this._memCeiling || !(window.vex && window.vex.appMetrics)) return;
    let metrics;
    try { metrics = await window.vex.appMetrics(); } catch { return; }
    const totalMB = metrics.reduce((s, p) => s + (p.memKB || 0), 0) / 1024;
    if (totalMB <= this._memCeiling) return;
    const cands = this.tabs
      .filter(t => t.id !== this.activeTabId && !t.pinned && !t.sleeping && !t._lazy)
      .sort((a, b) => (a.lastViewedAt || 0) - (b.lastViewedAt || 0));
    let slept = 0;
    for (const t of cands) {
      if (slept >= 5) break; // small batches; re-evaluate next tick
      await this.sleepTab(t.id);
      slept++;
    }
    if (slept) window.showToast?.(`💤 High memory — slept ${slept} idle tab${slept === 1 ? '' : 's'}`);
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

  // Shared dismissal wiring for any context menu we open.
  //
  // Why an overlay instead of document listeners: events inside a <webview>
  // (Chromium OOPIF guest) do NOT bubble to the host document. The previous
  // approach added document-level mousedown/click/contextmenu listeners on
  // the assumption that "mousedown on the webview ELEMENT itself does fire
  // here when the element receives focus." That assumption was wrong in
  // practice — Electron's webContentsView swallows the host-side mousedown
  // before it reaches our capture-phase listener, so the first outside-click
  // was missed entirely and the user had to click twice (round 1 fix did
  // not actually solve the bug).
  //
  // The overlay is a transparent fixed-position div sitting just below the
  // menu in z-stack. It covers the entire viewport, so any click outside the
  // menu lands on the overlay (a host-doc element) and dismisses cleanly on
  // the very first press. This matches Chrome's own context-menu behavior:
  // first click dismisses the menu, second click acts on the page.
  // Fully dismiss a context menu built with _attachMenuDismissal — removes
  // both the menu and its full-screen dismissal overlay. Item-click handlers
  // MUST use this instead of bare menu.remove() or the overlay is orphaned.
  _dismissMenu(menu) {
    if (menu && typeof menu._closeMenu === 'function') menu._closeMenu();
    else menu?.remove();
  },

  _attachMenuDismissal(menu) {
    const overlay = document.createElement('div');
    overlay.className = 'context-menu-overlay';
    // z-index 999 sits exactly one below .tab-context-menu's 1000, so the
    // menu paints on top of the overlay while the overlay catches every
    // outside click — including those that would otherwise be eaten by a
    // <webview> guest.
    overlay.style.cssText = 'position:fixed;inset:0;z-index:999;background:transparent;';

    const onKey  = (ev) => { if (ev.key === 'Escape') close('escape'); };
    const onBlur = () => close('window-blur');
    function close(reason) {
      // Diagnostic: surfaces WHY a context menu was dismissed. The
      // guest↔host focus 'window-blur' race (which used to eat <webview>
      // menu item clicks before they fired) is invisible without this.
      console.log('[Vex menu] context menu dismissed —', reason || 'unknown');
      overlay.remove();
      menu.remove();
      document.removeEventListener('keydown', onKey, true);
      window.removeEventListener('blur', onBlur, true);
    }
    // Expose close() so item-click handlers can tear the WHOLE menu down —
    // overlay included. Calling bare menu.remove() on a click used to leave
    // the transparent z:999 dismissal overlay orphaned over the entire window,
    // silently eating the next click (and stacking one orphan per menu use).
    // That's the "group context menu / change-color feels broken" bug.
    menu._closeMenu = close;

    // mousedown (not click) so we close BEFORE the user releases — feels
    // instant and avoids any race with click handlers fired afterward.
    overlay.addEventListener('mousedown', () => close('overlay-click'), true);
    // Right-click on the overlay closes the current menu; the underlying
    // contextmenu event on the webview will then re-open a fresh menu at
    // the new position, so chained right-clicks don't stack.
    overlay.addEventListener('contextmenu', () => close('overlay-right-click'), true);

    document.addEventListener('keydown', onKey, true);
    window.addEventListener('blur', onBlur, true);

    // Insert overlay before menu in DOM order so the menu (z:1000) wins over
    // the overlay (z:999) at hit-test time even before paint reorders.
    document.body.insertBefore(overlay, menu);
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
  },

  // ===== Phase 4a — Tab Stacks: data primitives + invariants =====
  //
  // Mutual-exclusion helpers. _setTabGroup(id, groupId) is the single point
  // of truth for "this tab is in group X" — it sets tab.groupId AND clears
  // tab.stackId (and vice versa for _setTabStack). Existing group code that
  // used to do `tab.groupId = X` directly now routes through here so the
  // mutual-exclusion invariant from docs/PHASE-4-TAB-STACKS-PLAN.md §2 holds
  // at exactly one place. Pure setters: no persistence, no rerender — the
  // caller already owns that. (Confirmed transparent for groups: existing
  // tests pass unchanged.)
  _setTabGroup(tabId, groupId) {
    const tab = this.tabs.find(t => t.id === tabId);
    if (!tab) return null;
    tab.groupId = groupId || null;
    if (groupId) tab.stackId = null;
    return tab;
  },

  _setTabStack(tabId, stackId) {
    const tab = this.tabs.find(t => t.id === tabId);
    if (!tab) return null;
    tab.stackId = stackId || null;
    if (stackId) tab.groupId = null;
    return tab;
  },

  // ----- Stack operations API -----

  // Generate a fresh stack id. Format mirrors group id ('grp_' + base36).
  _newStackId() {
    return 'stk_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  },

  // Create a stack from N tabs. Requires ≥ 2 (Section 7 risk register —
  // stacks-of-1 are just heavy tabs). Returns the stack object on success,
  // null on validation failure. Clears any existing groupId on the inputs.
  createStack(tabIds, name = 'New stack', color = '#d4a574') {
    if (!Array.isArray(tabIds) || tabIds.length < 2) return null;
    const tabs = tabIds.map(id => this.tabs.find(t => t.id === id)).filter(Boolean);
    if (tabs.length < 2) return null;
    // Pinned tabs cannot join a stack (Section 2 invariant 4).
    if (tabs.some(t => t.pinned)) return null;

    const id = this._newStackId();
    const stack = { id, name: String(name), color: String(color), topTabId: tabs[0].id };
    this.stacks.push(stack);

    for (const t of tabs) this._setTabStack(t.id, id);

    if (typeof VexStorage !== 'undefined') {
      if (typeof VexStorage.saveStacks === 'function') VexStorage.saveStacks(this.stacks);
      if (typeof this.persistTabs === 'function') this.persistTabs();
    }
    return stack;
  },

  // Add a tab to an existing stack. Returns true on success.
  addTabToStack(tabId, stackId) {
    const stack = this.stacks.find(s => s.id === stackId);
    if (!stack) return false;
    const tab = this.tabs.find(t => t.id === tabId);
    if (!tab) return false;
    if (tab.pinned) return false;
    if (tab.stackId === stackId) return true; // idempotent

    this._setTabStack(tabId, stackId);

    if (typeof VexStorage !== 'undefined') {
      if (typeof VexStorage.saveStacks === 'function') VexStorage.saveStacks(this.stacks);
      if (typeof this.persistTabs === 'function') this.persistTabs();
    }
    return true;
  },

  // Remove a tab from its stack. Auto-disbands the stack if it drops below 2
  // members. Returns true if the tab was removed from a stack, false if it
  // wasn't in one to begin with.
  removeTabFromStack(tabId) {
    const tab = this.tabs.find(t => t.id === tabId);
    if (!tab || !tab.stackId) return false;
    const stackId = tab.stackId;
    this._setTabStack(tabId, null);

    // Top-tab fallback: if the removed tab was the top, pick another live
    // member as the new top. _autoDisbandIfThin runs after, so if the stack
    // is now too small the topTabId reassignment is moot — but it's cheap
    // and keeps invariant 2 from the planning doc holding mid-flight.
    const stack = this.stacks.find(s => s.id === stackId);
    if (stack && stack.topTabId === tabId) this._fallbackTopTab(stackId);

    this._autoDisbandIfThin(stackId);

    if (typeof VexStorage !== 'undefined') {
      if (typeof VexStorage.saveStacks === 'function') VexStorage.saveStacks(this.stacks);
      if (typeof this.persistTabs === 'function') this.persistTabs();
    }
    return true;
  },

  // Promote a member to be the visible "top" of the stack. The candidate
  // MUST already be a member; this method does not move tabs between stacks.
  setStackTop(stackId, tabId) {
    const stack = this.stacks.find(s => s.id === stackId);
    if (!stack) return false;
    const tab = this.tabs.find(t => t.id === tabId);
    if (!tab || tab.stackId !== stackId) return false;
    stack.topTabId = tabId;
    if (typeof VexStorage !== 'undefined' && typeof VexStorage.saveStacks === 'function') {
      VexStorage.saveStacks(this.stacks);
    }
    return true;
  },

  // Disband a stack: clear stackId on every member, remove the stack object.
  disbandStack(stackId) {
    const stack = this.stacks.find(s => s.id === stackId);
    if (!stack) return false;
    for (const t of this.tabs) {
      if (t.stackId === stackId) this._setTabStack(t.id, null);
    }
    this.stacks = this.stacks.filter(s => s.id !== stackId);
    // Phase 4c — drop any stale expand state for a stack that no longer exists.
    if (this._expandedStackIds) this._expandedStackIds.delete(stackId);
    if (typeof VexStorage !== 'undefined') {
      if (typeof VexStorage.saveStacks === 'function') VexStorage.saveStacks(this.stacks);
      if (typeof this.persistTabs === 'function') this.persistTabs();
    }
    return true;
  },

  // Internal: if a stack has fewer than 2 members, disband it. Used by
  // removeTabFromStack and the closeTab close path.
  _autoDisbandIfThin(stackId) {
    const stack = this.stacks.find(s => s.id === stackId);
    if (!stack) return;
    const memberCount = this.tabs.filter(t => t.stackId === stackId).length;
    if (memberCount < 2) this.disbandStack(stackId);
  },

  // Internal: if topTabId no longer references a live member, set the top
  // to the first remaining member (or leave the stack alone if it's about
  // to be auto-disbanded anyway).
  _fallbackTopTab(stackId) {
    const stack = this.stacks.find(s => s.id === stackId);
    if (!stack) return;
    const topStillMember = this.tabs.some(t => t.id === stack.topTabId && t.stackId === stackId);
    if (topStillMember) return;
    const firstMember = this.tabs.find(t => t.stackId === stackId);
    if (firstMember) stack.topTabId = firstMember.id;
  }
};

// Renderer-safe export (Phase 4a — for tests/renderer/tabStacksData.test.js).
// The renderer loads this file via <script> tag where `module` is undefined,
// so the guard keeps the global TabManager surface unchanged.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { TabManager, isStartPage };
}

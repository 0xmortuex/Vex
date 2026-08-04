// === Vex extension host — renderer side ===
//
// Two jobs:
//   1. Host the extension's own side panel UI (chrome-extension://…/sidepanel.html)
//      inside Vex's chrome, so Claude renders as a real panel rather than a
//      detached window.
//   2. Serve the tab operations main can't do alone. Creating, closing and
//      activating a tab is TabManager's business, so main forwards those here
//      and waits for the answer.
//
// Public API: ExtHostPanel (init, toggle, open, close, isOpen).

const ExtHostPanel = {
  _el: null,
  _webview: null,
  _open: false,
  _extId: null,
  _activeReported: null,

  async init() {
    if (!window.vex?.extHost) return;

    window.vex.extHost.rendererReady();
    this._wireRequests();
    this._watchActiveTab();

    window.vex.extHost.onSidePanel(({ open }) => {
      // chrome.sidePanel.open() from inside the extension.
      if (open) this.open(); else this.close();
    });

    try {
      const st = await window.vex.extHost.status();
      if (st && st.installed) this._extId = st.id;
    } catch {}
  },

  // Main asks, TabManager answers.
  _wireRequests() {
    window.vex.extHost.onRequest(async ({ id, action, payload }) => {
      let result = null;
      try {
        switch (action) {
          case 'tabs.create': {
            const tab = TabManager.createTab(payload.url || 'about:blank', payload.active !== false);
            // The guest needs a moment to attach before it has a webContents id.
            await new Promise(r => setTimeout(r, 350));
            const wv = WebviewManager.getActiveWebview();
            let wcId = -1;
            try { wcId = wv && wv.getWebContentsId ? wv.getWebContentsId() : -1; } catch {}
            result = { id: wcId, url: payload.url || '', active: payload.active !== false, index: 0, windowId: 1 };
            break;
          }
          case 'tabs.remove': {
            const t = this._tabByWcId(payload.tabId);
            if (t) TabManager.closeTab(t.id);
            result = { ok: true };
            break;
          }
          case 'tabs.activate': {
            const t = this._tabByWcId(payload.tabId);
            if (t) TabManager.switchTab(t.id);
            result = { ok: true };
            break;
          }
          case 'tabGroups.query': {
            result = (TabManager.groups || [])
              .map(g => this._toChromeGroup(g))
              .filter(g => this._groupMatches(g, payload));
            break;
          }
          case 'tabGroups.get': {
            const g = this._vexGroup(payload.groupId);
            result = g ? this._toChromeGroup(g) : null;
            break;
          }
          case 'tabGroups.update': {
            const g = this._vexGroup(payload.groupId);
            if (g) {
              const p = payload.props || {};
              if (p.title !== undefined) g.name = String(p.title);
              if (p.collapsed !== undefined) g.collapsed = !!p.collapsed;
              if (p.color) g.color = this._vexColor(p.color);
              this._commitGroups();
            }
            result = g ? this._toChromeGroup(g) : null;
            break;
          }
          case 'tabs.group': {
            result = this._groupTabs(payload);
            break;
          }
          case 'tabs.ungroup': {
            for (const wcId of payload.tabIds || []) {
              const t = this._tabByWcId(wcId);
              if (t) TabManager._setTabGroup(t.id, null);
            }
            this._commitGroups();
            result = { ok: true };
            break;
          }
          default:
            result = null;
        }
      } catch (err) {
        console.error('[vex-ext] renderer request failed', action, err);
      }
      window.vex.extHost.respond(id, result);
    });
  },

  // === Tab groups =========================================================
  // Chrome addresses groups by integer id; Vex uses string ids ('grp_…').
  // This keeps a stable two-way mapping for the life of the session so the
  // extension can hold onto a groupId across calls.
  _groupIds: new Map(),   // vex string id -> chrome int id
  _groupSeq: 1,

  _chromeGroupId(vexId) {
    if (!this._groupIds.has(vexId)) this._groupIds.set(vexId, this._groupSeq++);
    return this._groupIds.get(vexId);
  },

  _vexGroup(chromeId) {
    for (const [vexId, cid] of this._groupIds) {
      if (cid === Number(chromeId)) return (TabManager.groups || []).find(g => g.id === vexId) || null;
    }
    return null;
  },

  _toChromeGroup(g) {
    return {
      id: this._chromeGroupId(g.id),
      title: g.name || '',
      color: this._chromeColor(g.color),
      collapsed: !!g.collapsed,
      windowId: 1,
    };
  },

  _groupMatches(g, q) {
    if (!q) return true;
    if (q.collapsed !== undefined && g.collapsed !== q.collapsed) return false;
    if (q.color && g.color !== q.color) return false;
    if (q.title && g.title !== q.title) return false;
    return true;
  },

  // Vex stores group colours as theme-token references so groups re-colour
  // when the theme changes. Chrome only knows nine fixed names, so translate
  // in both directions and prefer a real theme token when one is available.
  _CHROME_COLORS: ['grey', 'blue', 'red', 'yellow', 'green', 'pink', 'purple', 'cyan', 'orange'],

  _vexColor(chromeName) {
    try {
      const palette = TabManager._themeGroupPalette ? TabManager._themeGroupPalette() : [];
      if (palette && palette.length) {
        const i = Math.max(0, this._CHROME_COLORS.indexOf(chromeName));
        return (palette[i % palette.length] || palette[0]).ref;
      }
    } catch {}
    return chromeName; // the names are valid CSS colours, so this still renders
  },

  _chromeColor(vexColor) {
    if (typeof vexColor === 'string' && this._CHROME_COLORS.includes(vexColor)) return vexColor;
    try {
      const palette = TabManager._themeGroupPalette ? TabManager._themeGroupPalette() : [];
      const i = palette.findIndex(p => p && p.ref === vexColor);
      if (i >= 0) return this._CHROME_COLORS[i % this._CHROME_COLORS.length];
    } catch {}
    return 'blue';
  },

  _groupTabs({ tabIds, groupId, createProperties }) {
    const tabs = (tabIds || []).map(id => this._tabByWcId(id)).filter(Boolean);
    if (!tabs.length) return { groupId: -1 };

    let group = groupId != null ? this._vexGroup(groupId) : null;
    if (!group) {
      const cp = createProperties || {};
      const id = 'grp_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
      group = {
        id,
        name: cp.title || 'Group',
        color: this._vexColor(cp.color || 'blue'),
        collapsed: false,
      };
      TabManager.groups.push(group);
    }

    // _setTabGroup is Vex's single point of truth — it also clears stackId,
    // preserving the groups/stacks mutual-exclusion invariant.
    for (const t of tabs) TabManager._setTabGroup(t.id, group.id);
    this._commitGroups();
    return { groupId: this._chromeGroupId(group.id) };
  },

  _commitGroups() {
    try { VexStorage.saveGroups(TabManager.groups); } catch {}
    try { TabManager.rebuildAllTabs(); } catch {}
    try { TabManager.persistTabs(); } catch {}
  },

  // Map a webContents id back to a Vex tab. Vex tabs are keyed by their own
  // ids; the extension only ever sees webContents ids, so this is the join.
  _tabByWcId(wcId) {
    if (typeof TabManager === 'undefined') return null;
    for (const t of TabManager.tabs || []) {
      try {
        const wv = document.querySelector(`webview[data-tab-id="${t.id}"]`);
        if (wv && wv.getWebContentsId && wv.getWebContentsId() === Number(wcId)) return t;
      } catch {}
    }
    return null;
  },

  // Main needs to know which guest is "the active tab" for chrome.tabs.query
  // ({active:true}) and captureVisibleTab. Polling is unglamorous but it's
  // resilient to every path that can change the active tab.
  _watchActiveTab() {
    setInterval(() => {
      try {
        const wv = WebviewManager.getActiveWebview();
        const id = wv && wv.getWebContentsId ? wv.getWebContentsId() : null;
        if (id && id > 0 && id !== this._activeReported) {
          this._activeReported = id;
          window.vex.extHost.setActiveTab(id);
        }
      } catch {}
    }, 1000);
  },

  _build() {
    if (this._el) return this._el;

    const el = document.createElement('div');
    el.id = 'ext-host-panel';
    el.innerHTML = `
      <div class="ext-host-header">
        <span class="ext-host-title">Claude</span>
        <button class="ext-host-close" type="button" title="Close">&times;</button>
      </div>
      <div class="ext-host-body"></div>
    `;
    document.body.appendChild(el);
    el.querySelector('.ext-host-close').addEventListener('click', () => this.close());

    this._el = el;
    return el;
  },

  async open() {
    if (!this._extId) {
      try {
        const st = await window.vex.extHost.status();
        if (!st || !st.installed) {
          window.showToast?.('Claude for Chrome is not installed — add it in Settings → Extensions');
          return;
        }
        this._extId = st.id;
      } catch { return; }
    }

    const el = this._build();
    if (!this._webview) {
      // Same partition the extension is loaded into, or chrome-extension://
      // URLs won't resolve for this guest.
      const wv = document.createElement('webview');
      wv.setAttribute('partition', 'persist:main');
      wv.setAttribute('src', `chrome-extension://${this._extId}/sidepanel.html`);
      wv.setAttribute('allowpopups', '');
      wv.style.cssText = 'width:100%;height:100%;border:0;background:#F4F1EA';
      el.querySelector('.ext-host-body').appendChild(wv);
      this._webview = wv;
    }

    el.classList.add('visible');
    this._open = true;
  },

  close() {
    if (this._el) this._el.classList.remove('visible');
    this._open = false;
  },

  toggle() { this._open ? this.close() : this.open(); },
  isOpen() { return this._open; },
};

document.addEventListener('DOMContentLoaded', () => {
  try { ExtHostPanel.init(); } catch (err) { console.error('[vex-ext] panel init failed', err); }
});

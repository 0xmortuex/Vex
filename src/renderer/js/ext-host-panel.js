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
          default:
            result = null;
        }
      } catch (err) {
        console.error('[vex-ext] renderer request failed', action, err);
      }
      window.vex.extHost.respond(id, result);
    });
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

// === An extension's side panel, docked beside the page (2026-10-28) ===========
//
// chrome.sidePanel.open: the extension chose a page for its side panel (the Claude extension's chat, "sidepanel.html?tabId=N") and asks for
// it to be shown. Vex docks it at the right edge of the page area and shrinks the page to make room. As in Chrome the panel belongs to the
// TAB it was opened for: it shows while that tab is in front, is kept (and so keeps its conversation) while another tab is, and goes with
// the tab. The panel is the extension's own page in its own session, in a webview of Vex's window.
const VexExtSidePanel = {
  WIDTH_KEY: 'vex.extSidePanelWidth',
  DEFAULT_WIDTH: 420,
  MIN_WIDTH: 280,
  _panels: new Map(),   // `${extId}|${wcId}` -> { key, el, wv, extId, wcId, vexTabId, name, url }

  _t(key, fallback) { return (window.VexI18n && window.VexI18n.t(key, fallback)) || fallback; },

  width() {
    let w = this.DEFAULT_WIDTH;
    try { const n = Number(localStorage.getItem(this.WIDTH_KEY)); if (Number.isFinite(n) && n >= this.MIN_WIDTH) w = n; } catch { /* vex-allow-empty-catch: no storage: the default width */ }
    const area = document.getElementById('content-area');
    const max = area ? Math.floor(area.getBoundingClientRect().width * 0.7) : 900;
    return Math.max(this.MIN_WIDTH, Math.min(w, max || 900));
  },

  _activeWcId() {
    try {
      if (typeof WebviewManager === 'undefined' || typeof TabManager === 'undefined') return null;
      const wv = WebviewManager.webviews.get(TabManager.activeTabId);
      return wv ? wv.getWebContentsId() : null;
    } catch { return null; }   // vex-allow-empty-catch: a tab with no page yet has no panel
  },

  _vexTabIdOf(wcId) {
    try { const t = TabManager.tabsByPageId([wcId]).tabs[0]; return t ? t.id : null; } catch { return null; }   // vex-allow-empty-catch: the tab is gone
  },

  // The extension asks (through main) for its page beside the tab. One panel per extension and tab; asked again with another page it moves there.
  open({ tabId, extId, name, url }) {
    if (!Number.isInteger(tabId) || typeof extId !== 'string' || typeof url !== 'string') throw new Error('A side panel needs a tab, an extension and a page');
    if (!url.startsWith('chrome-extension://' + extId + '/')) throw new Error('A side panel is one of the extension\'s own pages');
    const key = extId + '|' + tabId;
    let p = this._panels.get(key);
    if (!p) {
      p = this._make({ key, tabId, extId, name: String(name || extId), url });
      this._panels.set(key, p);
    } else if (p.url !== url) {
      p.url = url;
      p.wv.setAttribute('src', url);
      try { p.wv.loadURL(url); } catch (err) { console.error('[Extensions] could not move a side panel to ' + url + ':', err.message); }
    }
    // Opened for a tab that is not in front: it waits for that tab. Opened for the one in front: it shows.
    this.refresh();
    return true;
  },

  close({ extId, tabId }) {
    let n = 0;
    for (const p of [...this._panels.values()]) {
      if ((extId == null || p.extId === extId) && (tabId == null || p.wcId === tabId)) { this._remove(p); n++; }
    }
    this.refresh();
    return n;
  },

  _make({ key, tabId, extId, name, url }) {
    const el = document.createElement('aside');
    el.className = 'ext-sidepanel';
    el.setAttribute('aria-label', name);
    el.hidden = true;
    const grip = document.createElement('div');
    grip.className = 'ext-sidepanel-grip';
    grip.title = this._t('extSpResize', 'Drag to resize');
    grip.addEventListener('pointerdown', (e) => this._startResize(e));
    const head = document.createElement('div');
    head.className = 'ext-sidepanel-head';
    const title = document.createElement('span');
    title.className = 'ext-sidepanel-title';
    title.textContent = name;
    const x = document.createElement('button');
    x.type = 'button';
    x.className = 'ext-sidepanel-close';
    x.setAttribute('aria-label', this._t('extSpClose', 'Close the side panel'));
    x.innerHTML = window.VexIcons ? VexIcons.svg('x', { size: 14 }) : 'x';
    x.addEventListener('click', () => this.close({ extId, tabId }));
    head.append(title, x);
    const wv = document.createElement('webview');
    wv.className = 'ext-sidepanel-view';
    wv.setAttribute('src', url);
    wv.setAttribute('partition', 'persist:main');
    wv.setAttribute('webpreferences', 'contextIsolation=yes,vexExtPanel=yes');
    wv.style.background = 'var(--vex-bg-base)';
    el.append(grip, head, wv);
    (document.getElementById('content-area') || document.body).appendChild(el);
    if (typeof VexLayer !== 'undefined') VexLayer.track(el, { tier: 'panel', id: 'ext-sidepanel-' + key, keep: true });
    return { key, el, wv, extId, wcId: tabId, vexTabId: this._vexTabIdOf(tabId), name, url };
  },

  _remove(p) {
    this._panels.delete(p.key);
    try { p.el.remove(); } catch (err) { console.error('[Extensions] could not remove a side panel:', err.message); }
  },

  // Show the panel of the tab in front, hide the others, and make (or take back) room for it.
  refresh() {
    const active = this._activeWcId();
    let shown = false;
    for (const p of this._panels.values()) {
      const show = p.wcId === active;
      p.el.hidden = !show;
      if (show) shown = true;
    }
    const area = document.getElementById('content-area');
    if (!area) return;
    area.classList.toggle('ext-sp-open', shown);
    if (shown) area.style.setProperty('--ext-sp-w', this.width() + 'px'); else area.style.removeProperty('--ext-sp-w');
    if (typeof VexExtDebugBar !== 'undefined') VexExtDebugBar._place();
  },

  // A page (a webview) takes every mouse event over it away from the window, so while dragging a transparent shield covers the page area and
  // hears them instead.
  _startResize(e) {
    e.preventDefault();
    const area = document.getElementById('content-area');
    if (!area) return;
    const shield = document.createElement('div');
    shield.className = 'ext-sidepanel-shield';
    area.appendChild(shield);
    const move = (ev) => {
      const r = area.getBoundingClientRect();
      const w = Math.max(this.MIN_WIDTH, Math.min(Math.round(r.right - ev.clientX), Math.floor(r.width * 0.7)));
      area.style.setProperty('--ext-sp-w', w + 'px');
      this._lastWidth = w;
      if (typeof VexExtDebugBar !== 'undefined') VexExtDebugBar._place();
    };
    const up = () => {
      shield.removeEventListener('pointermove', move); shield.removeEventListener('pointerup', up); shield.removeEventListener('pointercancel', up);
      shield.remove();
      try { if (this._lastWidth) localStorage.setItem(this.WIDTH_KEY, String(this._lastWidth)); } catch (err) { console.error('[Extensions] could not keep the side panel width:', err.message); }
    };
    shield.addEventListener('pointermove', move);
    shield.addEventListener('pointerup', up);
    shield.addEventListener('pointercancel', up);
  },

  // A tab closed: its panels go with it. An extension unloaded: so do its panels.
  _tabClosed(vexTabId) {
    for (const p of [...this._panels.values()]) if (p.vexTabId === vexTabId) this._remove(p);
    this.refresh();
  },

  init() {
    window.addEventListener('vex:tab-activated', () => this.refresh());
    document.addEventListener('vex:tab-closed', (e) => this._tabClosed(e.detail && e.detail.tabId));
    window.addEventListener('resize', () => this.refresh());
    if (window.vex && typeof window.vex.onExtensionsSidePanelClose === 'function') window.vex.onExtensionsSidePanelClose((req) => this.close({ extId: req && req.extId }));
  },
};

if (typeof window !== 'undefined') {
  window.VexExtSidePanel = VexExtSidePanel;
  if (typeof document !== 'undefined' && window.vex) VexExtSidePanel.init();
}
if (typeof module !== 'undefined' && module.exports) module.exports = { VexExtSidePanel };

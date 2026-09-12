// === Split-Screen Browsing (2, 3 or 4 panes) ===

const SplitScreen = {
  active: false,
  panes: [],        // tab IDs currently shown, length 2..4
  splitRatio: 0.5,  // 2-way divider position only
  MAX_PANES: 4,

  init() {
    const splitBtn = document.getElementById('btn-split');
    if (splitBtn) splitBtn.addEventListener('click', () => this.toggle());

    // Divider drag (2-way only)
    const divider = document.getElementById('split-divider');
    if (divider) {
      let dragging = false;
      divider.addEventListener('mousedown', (e) => { dragging = true; divider.classList.add('dragging'); e.preventDefault(); });
      document.addEventListener('mousemove', (e) => {
        if (!dragging || this.panes.length !== 2) return;
        const container = document.getElementById('webviews-container');
        const rect = container.getBoundingClientRect();
        let ratio = (e.clientX - rect.left) / rect.width;
        ratio = Math.max(0.2, Math.min(0.8, ratio));
        this.splitRatio = ratio;
        container.style.gridTemplateColumns = `${ratio}fr 4px ${1 - ratio}fr`;
      });
      document.addEventListener('mouseup', () => { if (dragging) { dragging = false; divider.classList.remove('dragging'); } });
    }

    const picker = document.getElementById('split-picker');
    if (picker) picker.addEventListener('click', (e) => { if (e.target === picker) this._cancelPicker(); });

    // Any change to the tab set can invalidate a pane: closing a tab that was
    // in a pane, a workspace switch (bulk close), a sync apply. Before this the
    // pane id just went stale — the split stayed "2 panes" with one live
    // webview and a dead half-screen that nothing could repair.
    window.addEventListener('vex-tabs-changed', () => this.pruneClosedPanes());
  },

  // Drop panes whose tab no longer exists. Below 2 live panes a split is
  // meaningless, so we leave split mode entirely. Returns true if anything
  // changed. Safe to call at any time; a no-op when split is off.
  pruneClosedPanes() {
    if (!this.active) return false;
    const live = this.panes.filter(id => TabManager.tabs.some(t => t.id === id));
    if (live.length === this.panes.length) return false;
    this.panes = live;
    if (live.length < 2) {
      this.deactivate();
      window.showToast?.('Split screen closed — a pane\'s tab was closed', 'info');
    } else {
      this.applySplit();
    }
    return true;
  },

  // Split button = plain on/off (2-way). Multi-pane is via setLayout(3|4).
  toggle() { if (this.active) this.deactivate(); else this.activate(2); },

  // Start a split with the active tab as pane 1, then let the user PICK each
  // remaining pane from a list of their open tabs (instead of grabbing whatever
  // tab happened to be next). Cancelling the first pick leaves split off.
  activate(count = 2) {
    const tabs = TabManager.tabs;
    if (tabs.length < 2) { window.showToast?.('Open at least 2 tabs to split the screen'); return; }
    count = Math.max(2, Math.min(this.MAX_PANES, count));
    const first = TabManager.activeTabId || tabs[0].id;
    this.panes = [first];
    this.active = true;
    document.getElementById('btn-split')?.classList.add('active');
    this._fillPanesInteractively(count);
  },

  // Change pane count on the fly (from the command palette). When adding panes,
  // pick each new one; when trimming, drop from the end. Re-activates if off.
  setLayout(count) {
    count = Math.max(2, Math.min(this.MAX_PANES, count));
    if (!this.active) { this.activate(count); return; }
    if (this.panes.length < count) {
      this._fillPanesInteractively(count);
    } else if (this.panes.length > count) {
      this.panes = this.panes.slice(0, count);
      this.applySplit();
    }
  },

  // Fill panes up to targetCount by prompting for each new pane in turn. Applies
  // the split as soon as we have >=2 panes (on pick, on cancel-with-enough, or
  // when there are no more tabs to offer). If the user cancels before a 2nd pane
  // exists, split is turned back off.
  _fillPanesInteractively(targetCount) {
    const step = () => {
      if (this.panes.length >= targetCount) { this.applySplit(); return; }
      const remaining = TabManager.tabs.filter(t => !this.panes.includes(t.id));
      if (!remaining.length) {
        if (this.panes.length >= 2) { this.applySplit(); }
        else { window.showToast?.('No other tab to place in the second pane — open one more'); this.deactivate(); }
        return;
      }
      this._pickTabForPane({
        title: `Choose a tab for pane ${this.panes.length + 1}`,
        onPick: (tabId) => { this.panes.push(tabId); step(); },
        onCancel: () => { if (this.panes.length >= 2) this.applySplit(); else this.deactivate(); },
      });
    };
    step();
  },

  deactivate() {
    this.active = false;
    const container = document.getElementById('webviews-container');
    container.classList.remove('split-mode', 'split-2', 'split-3', 'split-4');
    container.style.gridTemplateColumns = '';
    container.style.gridTemplateRows = '';
    container.querySelectorAll('webview').forEach(wv => {
      wv.classList.remove('split-pane', 'split-left', 'split-right');
      wv.style.gridColumn = ''; wv.style.gridRow = '';
    });
    document.querySelectorAll('.split-url-bar').forEach(bar => bar.classList.remove('visible'));
    // applySplit hides the divider inline for 3/4-way layouts; clear that so a
    // later 2-way split gets it back even if CSS ordering changes.
    const divider = document.getElementById('split-divider');
    if (divider) divider.style.display = '';
    const focus = this.panes[0];
    this.panes = [];
    if (focus) TabManager.switchTab(focus);
    document.getElementById('btn-split')?.classList.remove('active');
  },

  applySplit() {
    // Never lay out a pane whose tab is gone — that produced a live-looking
    // grid cell with nothing in it. Filter here (not via pruneClosedPanes) so
    // the two can't call each other in a loop.
    this.panes = this.panes.filter(id => TabManager.tabs.some(t => t.id === id));
    // Fewer than 2 panes is not a split. Returning quietly left the container
    // still wearing .split-mode.split-2 with nothing marked .split-pane — every
    // webview hidden, a completely blank window. That is what a workspace
    // switch during split screen produced: closeAllTabs killed both pane tabs,
    // then switchTab handed the new workspace's only tab to handleTabClick,
    // which landed here with one pane. Leave split mode instead of pretending.
    if (this.panes.length < 2) {
      if (this.active) this.deactivate();
      return;
    }
    SidebarManager.hideActivePanel();
    const n = this.panes.length;

    // Ensure every pane has a live webview FIRST — sleeping/lazy tabs have none,
    // which left panes blank. Wake/materialize creates the webview synchronously.
    const wvs = this.panes.map((id) => this._ensureWebview(id));

    const container = document.getElementById('webviews-container');
    container.classList.add('split-mode');
    container.classList.remove('split-2', 'split-3', 'split-4');
    container.classList.add('split-' + n);
    // 2-way keeps a draggable ratio divider; 3/4 use the equal CSS grid.
    if (n === 2) { container.style.gridTemplateColumns = `${this.splitRatio}fr 4px ${1 - this.splitRatio}fr`; container.style.gridTemplateRows = ''; }
    else { container.style.gridTemplateColumns = ''; container.style.gridTemplateRows = ''; }

    container.querySelectorAll('webview').forEach(wv => {
      wv.classList.remove('active', 'split-pane', 'split-left', 'split-right');
      wv.style.gridColumn = ''; wv.style.gridRow = '';
    });

    wvs.forEach((wv, i) => {
      if (!wv) return;
      wv.classList.add('split-pane');
      const gc = this._gridColumn(n, i), gr = this._gridRow(n, i);
      wv.style.gridColumn = gc; wv.style.gridRow = gr;
    });

    const divider = document.getElementById('split-divider');
    if (divider) divider.style.display = n === 2 ? '' : 'none';

    this.updateMiniUrlBars();
  },

  // Grid placement per pane index.
  _gridColumn(n, i) {
    if (n === 2) return i === 0 ? '1' : '3';   // divider occupies column 2
    if (n === 3) return String(i + 1);          // 1 | 2 | 3
    return String((i % 2) + 1);                 // 4-way: 2 columns
  },
  _gridRow(n, i) {
    if (n === 4) return String(Math.floor(i / 2) + 1); // 4-way: 2 rows
    return '1';
  },

  // A split pane needs a real webview. Wake a sleeping tab / materialize a lazy
  // one (both create the webview synchronously). Returns the element, or null
  // when the tab is genuinely gone — callers prune those. Errors from wake /
  // materialize are NOT swallowed: a webview that fails to come up is a real
  // fault and must be visible, not a silently blank pane.
  _ensureWebview(tabId) {
    const tab = TabManager.tabs.find(t => t.id === tabId);
    if (!tab) return null;
    if (!WebviewManager.webviews.has(tabId)) {
      if (tab.sleeping) TabManager.wakeTab(tabId);
      else if (tab._lazy) TabManager._materializeTab(tab);
    }
    return WebviewManager.webviews.get(tabId) || null;
  },

  // Mini URL bars: only the 2-way left/right ones exist in the DOM; hide them for
  // 3/4-way (the equal grid doesn't map to left/right halves).
  updateMiniUrlBars() {
    const leftBar = document.getElementById('split-url-left');
    const rightBar = document.getElementById('split-url-right');
    if (this.panes.length !== 2) {
      leftBar?.classList.remove('visible'); rightBar?.classList.remove('visible');
      return;
    }
    const setBar = (bar, id) => {
      if (!bar || !id) return;
      const tab = TabManager.tabs.find(t => t.id === id);
      const txt = bar.querySelector('.split-url-text'); if (txt) txt.textContent = tab ? tab.url : '';
      bar.classList.add('visible');
    };
    setBar(leftBar, this.panes[0]);
    setBar(rightBar, this.panes[1]);
  },

  // Render the tab list and resolve via onPick(tabId) / onCancel(). Only offers
  // tabs not already in a pane. Falls back to auto-pick if the picker DOM is
  // missing so split never dead-ends.
  _pickTabForPane({ title, onPick, onCancel }) {
    const picker = document.getElementById('split-picker');
    const content = document.getElementById('split-picker-content');
    const avail = TabManager.tabs.filter(t => !this.panes.includes(t.id));
    if (!picker || !content) { if (avail[0]) onPick(avail[0].id); else onCancel?.(); return; }
    const esc = (s) => TabManager._escapeHtml(String(s == null ? '' : s));
    content.innerHTML = '';
    const h = document.createElement('h3'); h.textContent = title || 'Choose a tab for this pane'; content.appendChild(h);
    avail.forEach(tab => {
      const item = document.createElement('div');
      item.className = 'split-picker-item';
      let host = ''; try { host = new URL(tab.url).hostname.replace(/^www\./, ''); } catch {}
      item.innerHTML = `${tab.favicon ? `<img src="${esc(tab.favicon)}" alt="">` : ''}<span>${esc(tab.title || host || tab.url || 'Tab')}</span>`;
      item.addEventListener('click', () => { this._activeCancel = null; this.closePicker(); onPick(tab.id); });
      content.appendChild(item);
    });
    const cancel = document.createElement('button');
    cancel.className = 'split-picker-cancel';
    cancel.textContent = 'Cancel';
    cancel.addEventListener('click', () => this._cancelPicker());
    content.appendChild(cancel);
    this._activeCancel = onCancel || null;
    picker.classList.add('visible');
  },

  // Backdrop click or Cancel button — resolve the open pick as a cancel, once.
  _cancelPicker() {
    const c = this._activeCancel; this._activeCancel = null;
    this.closePicker();
    try { c?.(); } catch {}
  },

  closePicker() { document.getElementById('split-picker')?.classList.remove('visible'); },

  // Clicking a sidebar/strip tab while split → swap it into the last pane.
  // Called from TabManager.switchTab; without it the tab went "active" while
  // its webview stayed display:none behind the panes.
  handleTabClick(tabId) {
    if (!this.active) return false;
    if (this.panes.includes(tabId)) return true; // already shown
    if (!TabManager.tabs.some(t => t.id === tabId)) return false;
    this.panes[this.panes.length - 1] = tabId;
    this.applySplit();
    return true;
  }
};

// Renderer-safe export (for tests/renderer/splitPanePruning.test.js). The
// renderer loads this file via a <script> tag where `module` is undefined, so
// the guard leaves the global SplitScreen surface unchanged.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { SplitScreen };
}

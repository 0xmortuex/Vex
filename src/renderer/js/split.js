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
    if (picker) picker.addEventListener('click', (e) => { if (e.target === picker) this.closePicker(); });
  },

  // Split button = plain on/off (2-way). Multi-pane is via setLayout(3|4).
  toggle() { if (this.active) this.deactivate(); else this.activate(2); },

  // Collect up to `count` DISTINCT tabs (active first, then the rest) and split.
  activate(count = 2) {
    const tabs = TabManager.tabs;
    if (tabs.length < 2) { window.showToast?.('Open at least 2 tabs to split the screen'); return; }
    count = Math.max(2, Math.min(this.MAX_PANES, count));
    const first = TabManager.activeTabId || tabs[0].id;
    this.panes = [first];
    for (const t of tabs) { if (this.panes.length >= count) break; if (!this.panes.includes(t.id)) this.panes.push(t.id); }
    this.active = true;
    document.getElementById('btn-split')?.classList.add('active');
    this.applySplit();
  },

  // Change pane count on the fly (from the command palette). Adds tabs from the
  // remaining open tabs, or trims down. Re-activates if off.
  setLayout(count) {
    count = Math.max(2, Math.min(this.MAX_PANES, count));
    if (!this.active) { this.activate(count); return; }
    if (this.panes.length < count) {
      for (const t of TabManager.tabs) { if (this.panes.length >= count) break; if (!this.panes.includes(t.id)) this.panes.push(t.id); }
      if (this.panes.length < count) window.showToast?.(`Only ${this.panes.length} tabs available — open more to fill ${count} panes`);
    } else if (this.panes.length > count) {
      this.panes = this.panes.slice(0, count);
    }
    this.applySplit();
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
    const focus = this.panes[0];
    this.panes = [];
    if (focus) TabManager.switchTab(focus);
    document.getElementById('btn-split')?.classList.remove('active');
  },

  applySplit() {
    if (this.panes.length < 2) return;
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
  // one (both create the webview synchronously). Returns the element.
  _ensureWebview(tabId) {
    try {
      const tab = TabManager.tabs.find(t => t.id === tabId);
      if (tab && !WebviewManager.webviews.has(tabId)) {
        if (tab.sleeping) TabManager.wakeTab(tabId);
        else if (tab._lazy) TabManager._materializeTab(tab);
      }
      return WebviewManager.webviews.get(tabId) || null;
    } catch { return null; }
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

  showPicker(slotIndex) {
    const picker = document.getElementById('split-picker');
    const content = document.getElementById('split-picker-content');
    if (!picker || !content) return;
    content.innerHTML = `<h3>Choose a tab for this pane</h3>`;
    TabManager.tabs.forEach(tab => {
      if (this.panes.includes(tab.id)) return;
      const item = document.createElement('div');
      item.className = 'split-picker-item';
      item.innerHTML = `${tab.favicon ? `<img src="${tab.favicon}" alt="">` : ''}<span>${TabManager._escapeHtml(tab.title)}</span>`;
      item.addEventListener('click', () => {
        if (slotIndex != null && slotIndex < this.panes.length) this.panes[slotIndex] = tab.id;
        else this.panes.push(tab.id);
        this.closePicker();
        this.applySplit();
      });
      content.appendChild(item);
    });
    picker.classList.add('visible');
  },

  closePicker() { document.getElementById('split-picker')?.classList.remove('visible'); },

  // Clicking a sidebar tab while split → swap it into the last pane.
  handleTabClick(tabId) {
    if (!this.active) return false;
    if (this.panes.includes(tabId)) return true; // already shown
    this.panes[this.panes.length - 1] = tabId;
    this.applySplit();
    return true;
  }
};

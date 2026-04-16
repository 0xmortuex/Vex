// === Split-Screen Browsing ===

const SplitScreen = {
  active: false,
  leftTabId: null,
  rightTabId: null,
  splitRatio: 0.5, // 50/50

  init() {
    // Split button in top bar
    const splitBtn = document.getElementById('btn-split');
    if (splitBtn) {
      splitBtn.addEventListener('click', () => this.toggle());
    }

    // Divider drag
    const divider = document.getElementById('split-divider');
    if (divider) {
      let dragging = false;
      divider.addEventListener('mousedown', (e) => {
        dragging = true;
        divider.classList.add('dragging');
        e.preventDefault();
      });

      document.addEventListener('mousemove', (e) => {
        if (!dragging) return;
        const container = document.getElementById('webviews-container');
        const rect = container.getBoundingClientRect();
        let ratio = (e.clientX - rect.left) / rect.width;
        ratio = Math.max(0.2, Math.min(0.8, ratio)); // min 20% each side
        this.splitRatio = ratio;
        container.style.gridTemplateColumns = `${ratio}fr 4px ${1 - ratio}fr`;
      });

      document.addEventListener('mouseup', () => {
        if (dragging) {
          dragging = false;
          divider.classList.remove('dragging');
        }
      });
    }

    // Split picker close on backdrop
    const picker = document.getElementById('split-picker');
    if (picker) {
      picker.addEventListener('click', (e) => {
        if (e.target === picker) this.closePicker();
      });
    }
  },

  toggle() {
    if (this.active) {
      this.deactivate();
    } else {
      this.activate();
    }
  },

  activate() {
    const tabs = TabManager.tabs;
    if (tabs.length < 1) return;

    this.active = true;
    this.leftTabId = TabManager.activeTabId;

    // If there's more than one tab, pick the next one for right side
    if (tabs.length >= 2) {
      const leftIdx = tabs.findIndex(t => t.id === this.leftTabId);
      const rightIdx = (leftIdx + 1) % tabs.length;
      this.rightTabId = tabs[rightIdx].id;
      this.applySplit();
    } else {
      // Show picker for right side
      this.showPicker('right');
    }

    document.getElementById('btn-split')?.classList.add('active');
  },

  deactivate() {
    this.active = false;
    const container = document.getElementById('webviews-container');
    container.classList.remove('split-mode');
    container.style.gridTemplateColumns = '';

    // Remove split classes from all webviews
    container.querySelectorAll('webview').forEach(wv => {
      wv.classList.remove('split-left', 'split-right');
    });

    // Hide mini URL bars
    document.querySelectorAll('.split-url-bar').forEach(bar => bar.classList.remove('visible'));

    // Show the left tab as active
    if (this.leftTabId) {
      TabManager.switchTab(this.leftTabId);
    }

    this.leftTabId = null;
    this.rightTabId = null;

    document.getElementById('btn-split')?.classList.remove('active');
  },

  applySplit() {
    if (!this.leftTabId || !this.rightTabId) return;

    SidebarManager.hideActivePanel();

    const container = document.getElementById('webviews-container');
    container.style.display = 'grid';
    container.classList.add('split-mode');
    container.style.gridTemplateColumns = `${this.splitRatio}fr 4px ${1 - this.splitRatio}fr`;

    // Hide all webviews first
    container.querySelectorAll('webview').forEach(wv => {
      wv.classList.remove('active', 'split-left', 'split-right');
    });

    // Show left and right
    const leftWv = WebviewManager.webviews.get(this.leftTabId);
    const rightWv = WebviewManager.webviews.get(this.rightTabId);

    if (leftWv) leftWv.classList.add('split-left');
    if (rightWv) rightWv.classList.add('split-right');

    // Update mini URL bars
    this.updateMiniUrlBars();
  },

  updateMiniUrlBars() {
    const leftBar = document.getElementById('split-url-left');
    const rightBar = document.getElementById('split-url-right');

    if (leftBar && this.leftTabId) {
      const tab = TabManager.tabs.find(t => t.id === this.leftTabId);
      leftBar.querySelector('.split-url-text').textContent = tab ? tab.url : '';
      leftBar.classList.add('visible');
    }

    if (rightBar && this.rightTabId) {
      const tab = TabManager.tabs.find(t => t.id === this.rightTabId);
      rightBar.querySelector('.split-url-text').textContent = tab ? tab.url : '';
      rightBar.classList.add('visible');
    }
  },

  showPicker(side) {
    const picker = document.getElementById('split-picker');
    const content = document.getElementById('split-picker-content');
    if (!picker || !content) return;

    content.innerHTML = `<h3>Choose tab for ${side} side</h3>`;

    TabManager.tabs.forEach(tab => {
      if (side === 'right' && tab.id === this.leftTabId) return;
      if (side === 'left' && tab.id === this.rightTabId) return;

      const item = document.createElement('div');
      item.className = 'split-picker-item';
      item.innerHTML = `
        ${tab.favicon ? `<img src="${tab.favicon}" alt="">` : ''}
        <span>${TabManager._escapeHtml(tab.title)}</span>
      `;
      item.addEventListener('click', () => {
        if (side === 'right') {
          this.rightTabId = tab.id;
        } else {
          this.leftTabId = tab.id;
        }
        this.closePicker();
        this.applySplit();
      });
      content.appendChild(item);
    });

    picker.classList.add('visible');
  },

  closePicker() {
    document.getElementById('split-picker')?.classList.remove('visible');
  },

  // Called when a tab is clicked in split mode — ask which side
  handleTabClick(tabId) {
    if (!this.active) return false;

    // If clicking on an already-shown tab, just focus it
    if (tabId === this.leftTabId || tabId === this.rightTabId) return true;

    // Replace right side with clicked tab
    this.rightTabId = tabId;
    this.applySplit();
    return true;
  }
};

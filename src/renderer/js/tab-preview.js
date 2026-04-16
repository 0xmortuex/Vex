// === Vex Tab Preview on Hover ===

const TabPreview = {
  _hoverTimer: null,
  _previewEl: null,

  init() {
    // Create preview element
    this._previewEl = document.createElement('div');
    this._previewEl.id = 'tab-preview';
    this._previewEl.innerHTML = '<img src="" alt=""><div class="preview-info"><div class="preview-title"></div><div class="preview-url"></div></div>';
    document.body.appendChild(this._previewEl);

    // Delegate hover events on tabs-list
    const tabsList = document.getElementById('tabs-list');
    if (!tabsList) return;

    tabsList.addEventListener('mouseenter', (e) => {
      const item = e.target.closest('.tab-item');
      if (item) this._startHover(item);
    }, true);

    tabsList.addEventListener('mouseleave', (e) => {
      const item = e.target.closest('.tab-item');
      if (item) this._cancelHover();
    }, true);

    tabsList.addEventListener('mousemove', (e) => {
      const item = e.target.closest('.tab-item');
      if (!item) this._cancelHover();
    });
  },

  _startHover(tabEl) {
    this._cancelHover();
    this._hoverTimer = setTimeout(() => {
      const tabId = tabEl.dataset.tabId;
      const tab = TabManager.tabs.find(t => t.id === tabId);
      if (!tab || tab.sleeping || tab._lazy) return;

      // Try to get thumbnail
      const wv = WebviewManager.webviews.get(tabId);
      if (wv && typeof wv.capturePage === 'function') {
        wv.capturePage().then(img => {
          if (!img || img.isEmpty()) return;
          const dataUrl = img.resize({ width: 280 }).toDataURL();
          this._show(tabEl, tab, dataUrl);
        }).catch(() => {
          this._show(tabEl, tab, null);
        });
      } else {
        this._show(tabEl, tab, null);
      }
    }, 500);
  },

  _cancelHover() {
    clearTimeout(this._hoverTimer);
    this._previewEl?.classList.remove('visible');
  },

  _show(tabEl, tab, thumbnailUrl) {
    const preview = this._previewEl;
    if (!preview) return;

    const img = preview.querySelector('img');
    if (thumbnailUrl) {
      img.src = thumbnailUrl;
      img.style.display = 'block';
    } else {
      img.style.display = 'none';
    }

    preview.querySelector('.preview-title').textContent = tab.title || 'Untitled';
    preview.querySelector('.preview-url').textContent = tab.url || '';

    // Position to the right of the tab sidebar
    const rect = tabEl.getBoundingClientRect();
    const sidebar = document.getElementById('tabs-sidebar');
    const sidebarRight = sidebar ? sidebar.getBoundingClientRect().right : rect.right;

    preview.style.left = (sidebarRight + 8) + 'px';
    preview.style.top = Math.min(rect.top, window.innerHeight - 220) + 'px';
    preview.classList.add('visible');
  }
};

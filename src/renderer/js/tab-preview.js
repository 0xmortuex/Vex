// === Vex Tab Preview on Hover ===
//
// Hover any tab (vertical sidebar OR horizontal top bar) for HOVER_DELAY_MS
// and a glassmorphic popup appears showing a live thumbnail (via
// webview.capturePage()) plus the tab's title and URL. Designed to feel like
// the OS X dock preview, not the Chrome tooltip — fast enough to be useful
// when tab-strafing, slow enough not to flash on every mouse jiggle.
//
// Test surface (CommonJS): TabPreview is exported so tests/renderer/
// tabPreview.test.js can mount it under jsdom + fake timers without touching
// the real Electron webview.

const HOVER_DELAY_MS = 800;
const THUMB_WIDTH = 280;

// Both layouts emit the same data-tab-id attribute, so we delegate from each
// container with the matching item selector. Keeping these as a table makes
// adding a third layout (e.g. mini-tabs) a one-line change.
const TAB_LISTS = [
  { containerId: 'tabs-list',     itemSelector: '.tab-item' },
  { containerId: 'top-tabs-list', itemSelector: '.top-tab' },
];

const TabPreview = {
  _hoverTimer: null,
  _previewEl: null,

  init() {
    this._previewEl = document.createElement('div');
    this._previewEl.id = 'tab-preview';
    this._previewEl.innerHTML =
      '<img src="" alt=""><div class="preview-info"><div class="preview-title"></div><div class="preview-url"></div></div>';
    document.body.appendChild(this._previewEl);

    for (const { containerId, itemSelector } of TAB_LISTS) {
      const list = document.getElementById(containerId);
      if (!list) continue;
      this._wireList(list, itemSelector);
    }
  },

  _wireList(list, itemSelector) {
    // mouseenter / mouseleave don't bubble, but capture-phase listeners on an
    // ancestor still fire for descendant targets — which is what we need
    // since the .tab-item / .top-tab elements are recreated on every render.
    list.addEventListener('mouseenter', (e) => {
      const item = e.target.closest?.(itemSelector);
      if (item && list.contains(item)) this._startHover(item);
    }, true);

    list.addEventListener('mouseleave', (e) => {
      const item = e.target.closest?.(itemSelector);
      if (item) this._cancelHover();
    }, true);

    // If the cursor enters a non-item region inside the list (e.g. group
    // label, gap), kill the pending preview so we don't pop while the user
    // is no longer over a tab.
    list.addEventListener('mousemove', (e) => {
      if (!e.target.closest?.(itemSelector)) this._cancelHover();
    });
  },

  _startHover(tabEl) {
    this._cancelHover();
    this._hoverTimer = setTimeout(() => {
      const tabId = tabEl.dataset.tabId;
      if (typeof TabManager === 'undefined') return;
      const tab = TabManager.tabs.find(t => t.id === tabId);
      if (!tab || tab.sleeping || tab._lazy) return;

      const wv = (typeof WebviewManager !== 'undefined' && WebviewManager.webviews)
        ? WebviewManager.webviews.get(tabId)
        : null;

      if (wv && typeof wv.capturePage === 'function') {
        // capturePage is async; the user may have moved off the tab by the
        // time the bitmap arrives. We still show — the timer already proved
        // intent — but bail if the captured bitmap is empty (happens on
        // sleeping/unloaded tabs) and fall back to the metadata-only popup.
        Promise.resolve(wv.capturePage()).then(img => {
          if (!img || (typeof img.isEmpty === 'function' && img.isEmpty())) {
            this._show(tabEl, tab, null);
            return;
          }
          let dataUrl = null;
          try {
            dataUrl = img.resize({ width: THUMB_WIDTH }).toDataURL();
          } catch {
            dataUrl = typeof img.toDataURL === 'function' ? img.toDataURL() : null;
          }
          this._show(tabEl, tab, dataUrl);
        }).catch(() => {
          this._show(tabEl, tab, null);
        });
      } else {
        this._show(tabEl, tab, null);
      }
    }, HOVER_DELAY_MS);
  },

  _cancelHover() {
    if (this._hoverTimer) {
      clearTimeout(this._hoverTimer);
      this._hoverTimer = null;
    }
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

    // Position next to the tab. Vertical layout: pin to the right edge of
    // the tabs sidebar so the preview doesn't overlap the tab strip.
    // Horizontal layout: drop below the tab bar.
    const rect = tabEl.getBoundingClientRect();
    const layout = document.body.dataset.tabLayout === 'horizontal' ? 'horizontal' : 'vertical';

    if (layout === 'vertical') {
      const sidebar = document.getElementById('tabs-sidebar');
      const sidebarRight = sidebar ? sidebar.getBoundingClientRect().right : rect.right;
      preview.style.left = (sidebarRight + 8) + 'px';
      preview.style.top  = Math.min(rect.top, window.innerHeight - 220) + 'px';
    } else {
      const x = Math.min(rect.left, window.innerWidth - THUMB_WIDTH - 16);
      preview.style.left = Math.max(8, x) + 'px';
      preview.style.top  = (rect.bottom + 6) + 'px';
    }
    preview.classList.add('visible');
  },

  // Test seam: lets jsdom unit tests assert the active timeout id without
  // racing real time.
  _getHoverTimerForTest() { return this._hoverTimer; },
};

// Renderer-safe export: Node (vitest) gets TabPreview; <script>-tag path
// on the renderer leaves the existing global alone.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { TabPreview, HOVER_DELAY_MS };
}

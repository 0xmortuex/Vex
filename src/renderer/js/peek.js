// === Vex Peek — floating link preview (Arc "Peek" / Zen "Glance") ===
//
// Shift+click a link (or any window.open popup that isn't print/OAuth) opens
// the page in a centered overlay instead of a tab: read it, then Esc to
// dismiss — or promote it to a real tab with one click. The webview uses the
// same persist:main session as tabs, so logins carry over.
// Public API: VexPeek.open(url) / close() / promote(). Wired from main.js via
// the 'peek:open' IPC (see setWindowOpenHandler) + window.vex.onPeekOpen.

const VexPeek = {
  _els: null,
  _url: '',
  _onKey: null,

  isOpen() { return !!(this._els && !this._els.root.hidden); },

  _build() {
    if (this._els) return;
    const root = document.createElement('div');
    root.id = 'vex-peek';
    root.hidden = true;
    root.innerHTML = `
      <div class="peek-backdrop"></div>
      <div class="peek-frame" role="dialog" aria-label="Link preview">
        <div class="peek-bar">
          <div class="peek-nav">
            <button class="peek-btn" data-act="back" title="Back">
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M10 12L6 8L10 4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
            </button>
            <button class="peek-btn" data-act="reload" title="Reload">
              <svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><path d="M13.5 2v3h-3" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
            </button>
          </div>
          <div class="peek-url" title=""></div>
          <div class="peek-actions">
            <button class="peek-btn peek-promote" data-act="promote" title="Open as tab (Ctrl+Enter)">
              <svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M6 3H3v10h10v-3M9 3h4v4M13 3L7.5 8.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
              <span>Open as tab</span>
            </button>
            <button class="peek-btn" data-act="copy" title="Copy link">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
            </button>
            <button class="peek-btn peek-close" data-act="close" title="Close (Esc)">
              <svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>
            </button>
          </div>
        </div>
        <div class="peek-body"></div>
        <div class="peek-hint">Esc to close · Ctrl+Enter to open as a tab</div>
      </div>`;
    document.body.appendChild(root);

    this._els = {
      root,
      backdrop: root.querySelector('.peek-backdrop'),
      body: root.querySelector('.peek-body'),
      url: root.querySelector('.peek-url'),
      wv: null,
    };

    this._els.backdrop.addEventListener('click', () => this.close());
    root.querySelectorAll('[data-act]').forEach(btn => btn.addEventListener('click', () => {
      const act = btn.dataset.act;
      if (act === 'close') this.close();
      else if (act === 'promote') this.promote();
      else if (act === 'copy') { try { navigator.clipboard.writeText(this._url); window.showToast?.('Link copied'); } catch {} }
      else if (act === 'back') { try { this._els.wv?.goBack(); } catch {} }
      else if (act === 'reload') { try { this._els.wv?.reload(); } catch {} }
    }));
  },

  open(url) {
    if (!url) return;
    this._build();
    this._url = url;
    const E = this._els;
    E.url.textContent = url;
    E.url.title = url;

    // Fresh webview per peek — cheaper than keeping one alive, and avoids
    // stale history bleeding between peeks.
    E.body.innerHTML = '';
    const wv = document.createElement('webview');
    wv.setAttribute('src', url);
    wv.setAttribute('partition', 'persist:main');
    wv.setAttribute('webpreferences', 'contextIsolation=yes');
    wv.addEventListener('did-navigate', (e) => { if (e.url) { this._url = e.url; E.url.textContent = e.url; E.url.title = e.url; } });
    wv.addEventListener('did-navigate-in-page', (e) => { if (e.url) { this._url = e.url; E.url.textContent = e.url; } });
    E.body.appendChild(wv);
    E.wv = wv;

    E.root.hidden = false;
    requestAnimationFrame(() => E.root.classList.add('show'));

    this._onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); this.close(); }
      else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); this.promote(); }
    };
    window.addEventListener('keydown', this._onKey, true);
  },

  close() {
    if (!this._els) return;
    const E = this._els;
    E.root.classList.remove('show');
    window.removeEventListener('keydown', this._onKey, true);
    setTimeout(() => {
      E.root.hidden = true;
      E.body.innerHTML = ''; // tear down the webview
      E.wv = null;
    }, 160);
  },

  promote() {
    const url = this._url;
    this.close();
    if (url && typeof TabManager !== 'undefined') {
      try { TabManager.createTab(url, true); } catch (err) { console.error('[Peek] promote failed:', err); }
    }
  },

  init() {
    window.vex?.onPeekOpen?.((data) => {
      if (data && data.url) this.open(data.url);
    });
  },
};

if (typeof window !== 'undefined') window.VexPeek = VexPeek;
if (typeof module !== 'undefined' && module.exports) module.exports = { VexPeek };

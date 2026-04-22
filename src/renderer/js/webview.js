// === Vex Webview Manager ===

const WebviewManager = {
  webviews: new Map(),

  createWebview(tab) {
    const container = document.getElementById('webviews-container');
    const webview = document.createElement('webview');
    webview.setAttribute('src', tab.url);
    webview.setAttribute('partition', 'persist:main');
    webview.setAttribute('allowpopups', '');
    webview.setAttribute('webpreferences', 'contextIsolation=yes');
    webview.dataset.tabId = tab.id;

    // Events
    webview.addEventListener('did-start-loading', () => {
      TabManager.updateTab(tab.id, { loading: true });
      container.classList.add('wv-loading');
    });

    webview.addEventListener('did-stop-loading', () => {
      TabManager.updateTab(tab.id, { loading: false });
      container.classList.remove('wv-loading');
    });

    webview.addEventListener('did-finish-load', () => {
      TabManager.updateTab(tab.id, { loading: false });
      container.classList.remove('wv-loading');

      // Detect page background color and apply to webview element
      try {
        webview.executeJavaScript(`getComputedStyle(document.body).backgroundColor`)
          .then(bg => { if (bg) webview.style.background = bg; })
          .catch(() => {});
      } catch {}

      // Apply saved zoom for this domain
      try {
        const url = webview.getURL();
        if (url && !url.startsWith('about:') && !url.startsWith('file:')) {
          const host = new URL(url).hostname;
          const zooms = JSON.parse(localStorage.getItem('vex.zooms') || '{}');
          if (zooms[host]) webview.setZoomFactor(zooms[host]);
        }
      } catch {}

      // Force dark mode if enabled
      try {
        const forceDark = localStorage.getItem('vex.forceDarkSites') === 'true';
        if (forceDark) {
          webview.insertCSS('html{filter:invert(1) hue-rotate(180deg);background:#0a0c10!important}img,video,iframe,[style*="background-image"]{filter:invert(1) hue-rotate(180deg)}');
        }
      } catch {}

      // Phase 12: Queue most-recent history entry for AI indexing
      // (wait 2s so dynamic content settles; the top entry in HistoryPanel.entries
      // is the most recent and typically corresponds to the page that just loaded)
      setTimeout(() => {
        try {
          if (!window.HistoryIndexer || !window.HistoryPanel) return;
          const url = webview.getURL && webview.getURL();
          if (!url) return;
          const entry = HistoryPanel.entries.find(e => e.url === url && !e.indexed);
          if (entry) HistoryIndexer.queueForIndexing(entry, webview);
        } catch (e) { /* best-effort */ }
      }, 2000);
    });

    webview.addEventListener('page-title-updated', (e) => {
      TabManager.updateTab(tab.id, { title: e.title });
    });

    webview.addEventListener('did-navigate', (e) => {
      const url = e.url;
      TabManager.updateTab(tab.id, { url });
      this._updateFavicon(tab.id, url);

      // Add to history (both legacy storage and new HistoryPanel)
      if (!isStartPage(url)) {
        const t = TabManager.tabs.find(t => t.id === tab.id);
        VexStorage.addHistory({ url, title: t?.title || url });
        if (typeof HistoryPanel !== 'undefined') {
          HistoryPanel.addEntry(url, t?.title || url, t?.favicon);
        }
        // Phase 16 auto-grouping: try to match against remembered patterns.
        // The call internally waits for the title to settle and uses purely
        // local pattern matching (domains + keywords) — no AI round-trip.
        if (typeof TabGrouper !== 'undefined') {
          TabGrouper.maybeAutoAssignToGroup?.(tab.id);
        }
      }
    });

    webview.addEventListener('did-navigate-in-page', (e) => {
      if (e.isMainFrame) {
        TabManager.updateTab(tab.id, { url: e.url });
      }
    });

    webview.addEventListener('new-window', (e) => {
      e.preventDefault();
      TabManager.createTab(e.url, true);
    });

    // Audio indicator
    webview.addEventListener('media-started-playing', () => {
      const t = TabManager.tabs.find(t => t.id === tab.id);
      if (t) { t.audible = true; TabManager.renderTabUpdate(t); }
    });
    webview.addEventListener('media-paused', () => {
      const t = TabManager.tabs.find(t => t.id === tab.id);
      if (t) { t.audible = false; TabManager.renderTabUpdate(t); }
    });

    webview.addEventListener('page-favicon-updated', (e) => {
      if (e.favicons && e.favicons.length > 0) {
        TabManager.updateTab(tab.id, { favicon: e.favicons[0] });
      }
    });

    // Listen for VEX_CMD messages from start page and other webview content
    webview.addEventListener('console-message', (e) => {
      if (e.message && e.message.startsWith('VEX_CMD:')) {
        try {
          const cmd = JSON.parse(e.message.slice(8));
          if (cmd.type === 'navigate' && cmd.url) {
            // Navigate THIS webview (the start-page tab that emitted the command)
            // rather than spawning a new tab. Matches Chrome's new-tab page where
            // search submissions and shortcut clicks replace the current tab's
            // content. Callers can opt in to a new tab with { newTab: true }.
            if (cmd.newTab) {
              TabManager.createTab(cmd.url, true);
            } else {
              try { webview.loadURL(cmd.url); } catch { webview.src = cmd.url; }
            }
          } else if (cmd.type === 'open-panel' && cmd.panel) {
            SidebarManager.openPanel(cmd.panel);
          } else if (cmd.type === 'exit-reading') {
            if (typeof ReadingMode !== 'undefined') ReadingMode.exitReadingMode(tab.id);
          }
        } catch (err) {
          console.error('VEX_CMD parse error:', err);
        }
      }
    });

    // Context menu
    webview.addEventListener('context-menu', (e) => {
      this.showContextMenu(e, webview);
    });

    container.appendChild(webview);
    this.webviews.set(tab.id, webview);
  },

  showWebview(tabId) {
    this.webviews.forEach((wv, id) => {
      wv.classList.toggle('active', id === tabId);
    });
  },

  destroyWebview(tabId) {
    const wv = this.webviews.get(tabId);
    if (wv) {
      wv.remove();
      this.webviews.delete(tabId);
    }
  },

  getActiveWebview() {
    return this.webviews.get(TabManager.activeTabId);
  },

  navigate(url) {
    const wv = this.getActiveWebview();
    if (wv) {
      // Electron webview DOM element uses .src or .loadURL()
      // .loadURL() is the correct webview API method, but .src works as fallback
      if (typeof wv.loadURL === 'function') {
        wv.loadURL(url);
      } else {
        wv.src = url;
      }
    }
  },

  goBack() {
    const wv = this.getActiveWebview();
    if (wv && wv.canGoBack()) wv.goBack();
  },

  goForward() {
    const wv = this.getActiveWebview();
    if (wv && wv.canGoForward()) wv.goForward();
  },

  reload() {
    const wv = this.getActiveWebview();
    if (wv) wv.reload();
  },

  // Hard reload: clear the webview's HTTP cache in the main process, then
  // reloadIgnoringCache. Falls back to the renderer-side reloadIgnoringCache /
  // reload if the IPC bridge is unavailable (dev-reload edge cases).
  hardReload() {
    const wv = this.getActiveWebview();
    if (!wv) return;
    try {
      const id = typeof wv.getWebContentsId === 'function' ? wv.getWebContentsId() : null;
      if (id != null && window.vex?.hardReloadWebview) {
        window.vex.hardReloadWebview(id).then(res => {
          if (!res?.ok) {
            console.warn('[Vex] hard-reload IPC failed:', res?.error);
            if (typeof wv.reloadIgnoringCache === 'function') wv.reloadIgnoringCache();
            else wv.reload();
          }
        }).catch(err => {
          console.error('[Vex] hard-reload failed:', err);
          if (typeof wv.reloadIgnoringCache === 'function') wv.reloadIgnoringCache();
          else wv.reload();
        });
        window.showToast?.('Hard reload — clearing cache');
        return;
      }
    } catch (err) {
      console.error('[Vex] hard-reload error:', err);
    }
    if (typeof wv.reloadIgnoringCache === 'function') wv.reloadIgnoringCache();
    else wv.reload();
  },

  zoomIn() {
    const wv = this.getActiveWebview();
    if (wv) {
      const cur = wv.getZoomFactor ? wv.getZoomFactor() : 1;
      const next = Math.min(cur + 0.1, 5);
      wv.setZoomFactor(next);
      this._saveZoom(wv, next);
    }
  },

  zoomOut() {
    const wv = this.getActiveWebview();
    if (wv) {
      const cur = wv.getZoomFactor ? wv.getZoomFactor() : 1;
      const next = Math.max(cur - 0.1, 0.25);
      wv.setZoomFactor(next);
      this._saveZoom(wv, next);
    }
  },

  zoomReset() {
    const wv = this.getActiveWebview();
    if (wv) {
      wv.setZoomFactor(1);
      this._saveZoom(wv, 1);
    }
  },

  _saveZoom(wv, zoom) {
    try {
      const url = wv.getURL();
      if (!url || url.startsWith('about:') || url.startsWith('file:')) return;
      const host = new URL(url).hostname;
      const zooms = JSON.parse(localStorage.getItem('vex.zooms') || '{}');
      if (zoom === 1) { delete zooms[host]; } else { zooms[host] = zoom; }
      localStorage.setItem('vex.zooms', JSON.stringify(zooms));
    } catch {}
  },

  findInPage(text) {
    const wv = this.getActiveWebview();
    if (wv && text) {
      wv.findInPage(text);
    }
  },

  stopFindInPage() {
    const wv = this.getActiveWebview();
    if (wv) wv.stopFindInPage('clearSelection');
  },

  showContextMenu(e, webview) {
    document.querySelectorAll('.tab-context-menu').forEach(m => m.remove());

    const menu = document.createElement('div');
    menu.className = 'tab-context-menu';
    menu.style.left = e.params.x + document.getElementById('icon-sidebar').offsetWidth +
                      document.getElementById('tabs-sidebar').offsetWidth + 'px';
    menu.style.top = (e.params.y + 44) + 'px';

    const items = [
      { label: 'Back', action: () => webview.goBack(), disabled: !webview.canGoBack() },
      { label: 'Forward', action: () => webview.goForward(), disabled: !webview.canGoForward() },
      { label: 'Reload', action: () => webview.reload() },
      { sep: true },
      { label: 'Copy Page URL', action: () => navigator.clipboard.writeText(webview.getURL()) },
      { label: 'Open in New Tab', action: () => TabManager.createTab(webview.getURL()) }
    ];

    if (e.params.selectionText) {
      items.push({ sep: true });
      items.push({
        label: `Search "${e.params.selectionText.substring(0, 20)}..."`,
        action: () => {
          const q = encodeURIComponent(e.params.selectionText);
          TabManager.createTab(`https://www.google.com/search?q=${q}`, true);
        }
      });
      items.push({
        label: 'Copy',
        action: () => webview.copy()
      });
      // AI options for selected text
      if (typeof AIPanel !== 'undefined') {
        const sel = e.params.selectionText;
        items.push({ sep: true });
        items.push({
          label: `\u2728 Explain "${sel.substring(0, 25)}${sel.length > 25 ? '...' : ''}"`,
          action: () => { AIPanel.open(); AIPanel.sendMessage('explain', { selectedText: sel }); }
        });
        items.push({
          label: '\u{1F310} Translate selection',
          action: () => { AIPanel.open(); AIPanel.sendMessage('translate', { selectedText: sel, targetLanguage: 'English' }); }
        });
      }
    }

    if (e.params.linkURL) {
      items.push({ sep: true });
      items.push({
        label: 'Open Link in New Tab',
        action: () => TabManager.createTab(e.params.linkURL, true)
      });
      items.push({
        label: 'Copy Link',
        action: () => navigator.clipboard.writeText(e.params.linkURL)
      });
    }

    items.forEach(item => {
      if (item.sep) {
        const sep = document.createElement('div');
        sep.className = 'tab-context-sep';
        menu.appendChild(sep);
      } else {
        const el = document.createElement('div');
        el.className = 'tab-context-item';
        el.textContent = item.label;
        if (item.disabled) {
          el.style.opacity = '0.4';
          el.style.pointerEvents = 'none';
        }
        el.addEventListener('click', () => {
          item.action();
          menu.remove();
        });
        menu.appendChild(el);
      }
    });

    document.body.appendChild(menu);
    const closeMenu = (ev) => {
      if (!menu.contains(ev.target)) {
        menu.remove();
        document.removeEventListener('click', closeMenu);
      }
    };
    setTimeout(() => document.addEventListener('click', closeMenu), 0);
  },

  _updateFavicon(tabId, url) {
    try {
      const domain = new URL(url).hostname;
      if (domain && !isStartPage(url)) {
        const favicon = `https://www.google.com/s2/favicons?domain=${domain}&sz=32`;
        TabManager.updateTab(tabId, { favicon });
      }
    } catch {}
  }
};

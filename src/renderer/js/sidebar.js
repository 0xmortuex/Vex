// === Vex Sidebar Panel Manager ===

const SidebarManager = {
  activePanel: null,
  panelWebviews: {},
  // Panels that use custom JS rendering (no webview)
  customPanels: ['settings', 'cusa', 'roblox', 'github', 'notes', 'downloads', 'history', 'memory', 'shortcuts', 'themes', 'schedules'],

  panelConfigs: {
    start: { url: null, partition: null },
    whatsapp: { url: 'https://web.whatsapp.com/', partition: 'persist:whatsapp' },
    claude: { url: 'https://claude.ai/', partition: 'persist:claude' },
    spotify: { url: 'https://open.spotify.com/', partition: 'persist:spotify' },
    settings: { url: null, partition: null },
    cusa: { url: null, partition: null },
    roblox: { url: null, partition: null },
    github: { url: null, partition: null },
    notes: { url: null, partition: null },
    downloads: { url: null, partition: null },
    history: { url: null, partition: null },
    memory: { url: null, partition: null },
    schedules: { url: null, partition: null },
    shortcuts: { url: null, partition: null },
    themes: { url: null, partition: null }
  },

  init() {
    // Set up sidebar icon clicks
    document.querySelectorAll('.sidebar-icon').forEach(btn => {
      btn.addEventListener('click', () => {
        const panel = btn.dataset.panel;
        // The "Start Page" (house) icon has no corresponding panel UI —
        // panel-start is an empty div — so opening it used to blank the
        // webview area. Route it to open/focus the real start-page tab
        // (start.html, the new-tab page) instead.
        if (panel === 'start') {
          this.openStartPage();
          return;
        }
        this.togglePanel(panel);
      });
      // Right-click → context menu with Refresh + Open DevTools. Only meaningful
      // for panels that host a webview (Claude, Spotify, WhatsApp). Custom
      // panels (settings, history, downloads, ...) and the Start icon get no
      // menu since there's nothing to refresh.
      btn.addEventListener('contextmenu', (e) => {
        const panel = btn.dataset.panel;
        if (!panel || panel === 'start') return;
        if (this.customPanels.includes(panel)) return;
        e.preventDefault();
        this.showContextMenu(e, panel);
      });
    });

    // Ctrl+Shift+J — open DevTools for the active panel's embedded webview
    // (Gmail, Claude, WhatsApp). Ctrl+Shift+I is taken by the tab DevTools
    // shortcut from earlier work, so a separate chord keeps panel DevTools
    // distinct from tab DevTools.
    document.addEventListener('keydown', (e) => {
      if (!(e.ctrlKey && e.shiftKey && (e.key === 'J' || e.key === 'j'))) return;
      const name = this.activePanel;
      if (!name) return;
      const wv = this.panelWebviews[name];
      if (!wv) return;
      e.preventDefault();
      try {
        const id = typeof wv.getWebContentsId === 'function' ? wv.getWebContentsId() : null;
        if (id != null && window.vexDevTools?.openForWebContents) {
          window.vexDevTools.openForWebContents(id).catch(err => {
            console.error('[Vex] panel DevTools IPC failed:', err);
          });
        } else if (typeof wv.openDevTools === 'function') {
          wv.openDevTools();
        } else {
          console.warn('[Vex] panel DevTools unavailable for:', name);
        }
      } catch (err) {
        console.error('[Vex] panel DevTools error:', err);
      }
    });
  },

  openStartPage() {
    if (this.activePanel) this.hideActivePanel();
    const existing = TabManager.tabs.find(t =>
      typeof isStartPage === 'function' ? isStartPage(t.url) : false
    );
    if (existing) {
      TabManager.switchTab(existing.id);
    } else {
      const url = typeof START_URL !== 'undefined' ? START_URL : 'vex://start';
      TabManager.createTab(url, true);
    }
    document.querySelectorAll('.sidebar-icon').forEach(b => {
      b.classList.toggle('active', b.dataset.panel === 'start');
    });
  },

  togglePanel(panelName) {
    if (this.activePanel === panelName) {
      this.hideActivePanel();
      return;
    }

    this.showPanel(panelName);
  },

  showPanel(panelName) {
    // Hide all panels
    document.querySelectorAll('#panels-container .panel').forEach(p => {
      p.style.display = 'none';
    });

    // Hide webviews
    document.getElementById('webviews-container').style.display = 'none';

    // Show panels container
    document.getElementById('panels-container').style.pointerEvents = 'auto';

    const panelEl = document.getElementById(`panel-${panelName}`);
    if (!panelEl) return;

    panelEl.style.display = 'block';

    // Initialize custom panels on first open
    if (panelName === 'cusa') CUSAPanel.init();
    if (panelName === 'roblox') RobloxPanel.init();
    if (panelName === 'github') GitHubPanel.init();
    if (panelName === 'notes') NotesPanel.init();
    if (panelName === 'downloads') DownloadsPanel.init();
    if (panelName === 'history') HistoryPanel.init();
    if (panelName === 'memory') MemoryPanel.init();
    if (panelName === 'schedules') SchedulesPanel.init();
    if (panelName === 'shortcuts') ShortcutsPanel.init();
    if (panelName === 'themes') ThemeEditor.init();
    if (panelName === 'settings' && typeof SyncSettings !== 'undefined') {
      // Phase 13: render the Vex Sync section whenever Settings opens
      const c = document.getElementById('sync-panel-content');
      if (c) SyncSettings.renderSyncPanel(c);
    }
    if (panelName === 'settings' && typeof AISettings !== 'undefined') {
      // Phase 14: populate the AI Backend section each time Settings opens
      AISettings.renderAISettings();
    }
    if (panelName === 'settings' && typeof PersonasSettings !== 'undefined') {
      // Phase 15: render the Personas grid each time Settings opens
      PersonasSettings.renderPanel(document.getElementById('personas-panel-content'));
    }
    if (panelName === 'settings' && typeof ShortcutEditor !== 'undefined') {
      // Phase 17: render the keyboard shortcut editor each time Settings opens
      ShortcutEditor.renderPanel(document.getElementById('shortcuts-editor-content'));
    }
    if (panelName === 'settings' && typeof ExtensionsSettings !== 'undefined') {
      // Phase 18: render the Chrome Extensions manager each time Settings opens
      ExtensionsSettings.render(document.getElementById('extensions-panel-content'));
    }
    if (panelName === 'settings' && typeof PermissionsSettings !== 'undefined') {
      // Site permissions manager each time Settings opens
      PermissionsSettings.render(document.getElementById('permissions-panel-content'));
    }
    if (panelName === 'settings' && typeof LocationSettings !== 'undefined') {
      // Manual-location override (replaces Google Cloud geolocation)
      LocationSettings.render(document.getElementById('location-panel-content'));
    }

    // Create webview for panel if needed
    if (!this.customPanels.includes(panelName) && !this.panelWebviews[panelName]) {
      const config = this.panelConfigs[panelName];
      if (config && config.url) {
        const wv = document.createElement('webview');
        wv.setAttribute('src', config.url);
        if (config.partition) {
          wv.setAttribute('partition', config.partition);
        }
        wv.setAttribute('allowpopups', '');
        wv.setAttribute('webpreferences', 'contextIsolation=yes');
        wv.style.width = '100%';
        wv.style.height = '100%';
        panelEl.appendChild(wv);
        this.panelWebviews[panelName] = wv;
      }
    }

    this.activePanel = panelName;

    // Update sidebar icons
    document.querySelectorAll('.sidebar-icon').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.panel === panelName);
    });
  },

  hideActivePanel() {
    if (!this.activePanel) return;

    // Hide all panels
    document.querySelectorAll('#panels-container .panel').forEach(p => {
      p.style.display = 'none';
    });
    document.getElementById('panels-container').style.pointerEvents = 'none';

    // Show webviews
    document.getElementById('webviews-container').style.display = 'block';

    this.activePanel = null;

    // Remove active from sidebar icons
    document.querySelectorAll('.sidebar-icon').forEach(btn => {
      btn.classList.remove('active');
    });

    // Show active tab webview
    if (TabManager.activeTabId) {
      WebviewManager.showWebview(TabManager.activeTabId);
    }
  },

  openPanel(name) {
    this.showPanel(name);
  },

  // Right-click context menu for panel icons (Claude/Spotify/WhatsApp).
  // Reuses TabManager's .tab-context-menu styling + dismissal helpers so the
  // outside-click / Esc / viewport-clamp behavior matches the tab menu the
  // user already knows.
  showContextMenu(e, panelName) {
    document.querySelectorAll('.tab-context-menu, .tab-group-context-menu').forEach(m => m.remove());

    const menu = document.createElement('div');
    menu.className = 'tab-context-menu';
    const x = e.clientX, y = e.clientY;
    menu.style.left = x + 'px';
    menu.style.top  = y + 'px';

    const items = [
      {
        label: 'Refresh',
        action: () => {
          // If the panel webview hasn't been mounted yet (panel never opened),
          // open the panel first — that creates the webview and loads the URL,
          // which is functionally a "first refresh".
          const wv = this.panelWebviews[panelName];
          if (wv && typeof wv.reload === 'function') {
            try { wv.reload(); } catch (err) { console.error('[Sidebar] reload failed:', err); }
          } else {
            this.showPanel(panelName);
          }
        }
      },
      {
        label: 'Open DevTools',
        action: () => {
          const wv = this.panelWebviews[panelName];
          if (!wv) {
            this.showPanel(panelName);
            return;
          }
          try {
            const id = typeof wv.getWebContentsId === 'function' ? wv.getWebContentsId() : null;
            if (id != null && window.vexDevTools?.openForWebContents) {
              window.vexDevTools.openForWebContents(id).catch(err => console.error('[Sidebar] DevTools IPC failed:', err));
            } else if (typeof wv.openDevTools === 'function') {
              wv.openDevTools();
            }
          } catch (err) { console.error('[Sidebar] DevTools error:', err); }
        }
      }
    ];

    items.forEach(item => {
      const el = document.createElement('div');
      el.className = 'tab-context-item';
      el.textContent = item.label;
      el.addEventListener('click', () => { item.action(); menu.remove(); });
      menu.appendChild(el);
    });

    document.body.appendChild(menu);

    // Reuse TabManager's clamp + dismissal so behavior matches the tab menu.
    if (window.TabManager?._clampMenuToViewport) {
      TabManager._clampMenuToViewport(menu, x, y);
    }
    if (window.TabManager?._attachMenuDismissal) {
      TabManager._attachMenuDismissal(menu);
    } else {
      // Defensive fallback if tabs.js loads after sidebar.js for any reason.
      const close = () => { menu.remove(); document.removeEventListener('click', onClick, true); document.removeEventListener('keydown', onKey, true); };
      const onClick = (ev) => { if (!menu.contains(ev.target)) close(); };
      const onKey = (ev) => { if (ev.key === 'Escape') close(); };
      setTimeout(() => {
        document.addEventListener('click', onClick, true);
        document.addEventListener('keydown', onKey, true);
      }, 0);
    }
  }
};

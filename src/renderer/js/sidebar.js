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
    gmail: { url: 'https://mail.google.com/', partition: 'persist:gmail' },
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
        // Gmail: spoof Chrome UA BEFORE src so the first request doesn't leak
        // "Electron/X.X.X" — Google blocks sign-in on webviews advertising
        // Electron ("This browser may not be secure").
        if (panelName === 'gmail') {
          wv.setAttribute('useragent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36');
        }
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

        // Gmail: keep the login flow (accounts.google.com) inside the same
        // webview so cookies land in persist:gmail. Google's popup-based
        // sign-in is caught at the MAIN-PROCESS level via
        // setWindowOpenHandler (see src/main.js) because new-window on
        // the renderer-side webview tag doesn't fire for modern popups.
        // These two listeners stay as a diagnostic fallback — if one fires,
        // we can see exactly which event Google is using in DevTools.
        if (panelName === 'gmail') {
          wv.addEventListener('new-window', (e) => {
            console.log('[Vex] Gmail new-window fired:', e.url);
            e.preventDefault();
            const isGoogleAuth = e.url && (
              e.url.includes('accounts.google.com') ||
              e.url.includes('mail.google.com') ||
              e.url.includes('accounts.youtube.com')
            );
            if (isGoogleAuth) {
              try { wv.loadURL(e.url); } catch (err) { console.warn('[Gmail] loadURL failed:', err); }
            } else if (typeof TabManager !== 'undefined' && TabManager.createTab) {
              TabManager.createTab(e.url, true);
            }
          });
          wv.addEventListener('did-create-window', (e) => {
            console.log('[Vex] Gmail did-create-window fired:', e);
          });
        }
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
  }
};

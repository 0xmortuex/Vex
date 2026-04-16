// === Vex Sidebar Panel Manager ===

const SidebarManager = {
  activePanel: null,
  panelWebviews: {},
  // Panels that use custom JS rendering (no webview)
  customPanels: ['settings', 'cusa', 'roblox', 'github', 'notes', 'downloads', 'history', 'memory', 'shortcuts', 'themes'],

  panelConfigs: {
    start: { url: null, partition: null },
    whatsapp: { url: 'https://web.whatsapp.com/', partition: 'persist:whatsapp' },
    claude: { url: 'https://claude.ai/', partition: 'persist:claude' },
    settings: { url: null, partition: null },
    cusa: { url: null, partition: null },
    roblox: { url: null, partition: null },
    github: { url: null, partition: null },
    notes: { url: null, partition: null },
    downloads: { url: null, partition: null },
    history: { url: null, partition: null },
    memory: { url: null, partition: null },
    shortcuts: { url: null, partition: null },
    themes: { url: null, partition: null }
  },

  init() {
    // Set up sidebar icon clicks
    document.querySelectorAll('.sidebar-icon').forEach(btn => {
      btn.addEventListener('click', () => {
        const panel = btn.dataset.panel;
        this.togglePanel(panel);
      });
    });
  },

  togglePanel(panelName) {
    if (this.activePanel === panelName) {
      // Close panel, show active tab
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
    if (panelName === 'shortcuts') ShortcutsPanel.init();
    if (panelName === 'themes') ThemeEditor.init();

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
  }
};

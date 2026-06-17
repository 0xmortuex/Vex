// === Vex Sidebar Panel Manager ===

// Refresh-action factory. Hoisted to module scope so tests can require() it
// independently of the DOM-bound SidebarManager. Behaviour:
//   - If the panel's webview already exists, ensure the panel is visible
//     (showPanel) and call wv.reload(). Showing first prevents the silent
//     no-op the user reported when right-clicking an icon for a panel that
//     wasn't currently open — the reload was already firing, just invisible.
//   - If no webview exists yet (panel never opened), showPanel will create
//     one and load the URL, which is functionally a "first refresh".
function makeRefreshAction(manager, panelName) {
  return () => {
    const wv = manager.panelWebviews && manager.panelWebviews[panelName];
    if (wv && typeof wv.reload === 'function') {
      if (manager.activePanel !== panelName && typeof manager.showPanel === 'function') {
        manager.showPanel(panelName);
      }
      try {
        wv.reload();
        console.log('[Sidebar] Refresh:', panelName);
      } catch (err) {
        console.error('[Sidebar] Refresh failed for', panelName, '-', err);
      }
    } else if (typeof manager.openPanel === 'function') {
      manager.openPanel(panelName);
    } else if (typeof manager.showPanel === 'function') {
      manager.showPanel(panelName);
    }
  };
}

// Ready-made icons for the sidebar service buttons (20x20, currentColor).
const SIDEBAR_ICONS = {
  claude:  '<svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M10 2L3 6V14L10 18L17 14V6L10 2Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><circle cx="10" cy="10" r="2.3" stroke="currentColor" stroke-width="1.5"/></svg>',
  gemini:  '<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2c.4 4.9 2.1 6.6 7 7-4.9.4-6.6 2.1-7 7-.4-4.9-2.1-6.6-7-7 4.9-.4 6.6-2.1 7-7z"/></svg>',
  chatgpt: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M12 3l7.5 4.3v8.6L12 20.2 4.5 15.9V7.3L12 3z"/><circle cx="12" cy="12" r="2.6"/></svg>',
  whatsapp:'<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"><path d="M4 20l1.3-4A8 8 0 1 1 9 18.5L4 20z"/><path d="M9 9.5c0 3 2.5 5.5 5.5 5.5" stroke-linecap="round"/></svg>',
  spotify: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><path d="M8 11.5c2.5-1 6-1 8.5.5"/><path d="M8 14.5c2-1 5.5-1 7.5 0"/><path d="M8 8.5c3-1 7.5-1 9.5.5"/></svg>',
  globe:   '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.5 2.5 15 0 18M12 3c-2.5 2.5-2.5 15 0 18"/></svg>',
  chat:    '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"><path d="M4 5h16v11H9l-4 4z"/></svg>',
  mail:    '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/></svg>',
  video:   '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="5" width="18" height="14" rx="3"/><path d="M10 9l5 3-5 3z" fill="currentColor" stroke="none"/></svg>',
  music:   '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="6" cy="18" r="2.5"/><circle cx="18" cy="16" r="2.5"/><path d="M8.5 18V6l12-2v12"/></svg>',
  code:    '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M8 6l-5 6 5 6M16 6l5 6-5 6"/></svg>',
  search:  '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4-4" stroke-linecap="round"/></svg>',
  star:    '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"><path d="M12 3l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9 6.8 19.2l1-5.8-4.3-4.1 5.9-.9z"/></svg>',
  bolt:    '<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M13 2L4 14h6l-1 8 9-12h-6z"/></svg>',
  sparkle: '<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l1.8 5.2L19 9l-5.2 1.8L12 16l-1.8-5.2L5 9l5.2-1.8z"/></svg>',
  netflix: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 19V5l10 14V5"/></svg>',
  prime:   '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="3"/><path d="M10 9l5 3-5 3z" fill="currentColor" stroke="none"/></svg>',
  disney:  '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M11 3l1.5 4.3L17 9l-4.5 1.7L11 15l-1.5-4.3L5 9l4.5-1.7z" fill="currentColor" stroke="none"/><path d="M18 14v5M15.5 16.5h5"/></svg>',
};

// Quick-switch presets for AI service buttons.
const AI_SERVICES = {
  claude:  { name: 'Claude',  url: 'https://claude.ai/',            icon: 'claude' },
  gemini:  { name: 'Gemini',  url: 'https://gemini.google.com/app', icon: 'gemini' },
  chatgpt: { name: 'ChatGPT', url: 'https://chatgpt.com/',          icon: 'chatgpt' },
};

// Quick-switch presets for the streaming (Netflix) button. No `icon` key — they
// keep the button's current icon (the streaming "N"); only name + url change.
const STREAMING_SERVICES = {
  netflix: { name: 'Netflix',     url: 'https://www.netflix.com/',     icon: 'netflix' },
  prime:   { name: 'Prime Video', url: 'https://www.primevideo.com/',  icon: 'prime' },
  disney:  { name: 'Disney+',     url: 'https://www.disneyplus.com/',  icon: 'disney' },
};

function loadPanelOverrides() { try { return JSON.parse(localStorage.getItem('vex.panelOverrides') || '{}'); } catch { return {}; } }
function savePanelOverrides(o) { try { localStorage.setItem('vex.panelOverrides', JSON.stringify(o)); } catch {} }
function normalizeServiceUrl(u) { u = (u || '').trim(); if (!u) return ''; if (!/^https?:\/\//i.test(u)) u = 'https://' + u; return u; }

// Electron disables window.prompt, so use a small in-app modal instead.
function vexPromptModal(title, value) {
  return new Promise(resolve => {
    document.getElementById('vex-prompt-modal')?.remove();
    const m = document.createElement('div');
    m.id = 'vex-prompt-modal';
    m.style.cssText = 'position:fixed;inset:0;z-index:100050;background:rgba(0,0,0,0.55);display:flex;align-items:center;justify-content:center;';
    m.innerHTML = `<div style="width:360px;max-width:92vw;background:var(--surface);border:1px solid var(--border);border-radius:14px;padding:20px;box-shadow:0 24px 60px rgba(0,0,0,0.5)">
      <div style="font-size:15px;font-weight:700;color:var(--text);margin-bottom:12px">${title}</div>
      <input id="vex-prompt-input" type="text" value="" style="width:100%;box-sizing:border-box;padding:10px 12px;background:var(--bg);border:1px solid var(--border);border-radius:9px;color:var(--text);font-size:14px;outline:none;font-family:'Outfit',sans-serif">
      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px">
        <button id="vex-prompt-cancel" style="padding:8px 16px;background:var(--bg);color:var(--text);border:1px solid var(--border);border-radius:8px;cursor:pointer;font-family:'Outfit',sans-serif;font-size:13px">Cancel</button>
        <button id="vex-prompt-ok" style="padding:8px 18px;background:var(--primary);color:#fff;border:none;border-radius:8px;cursor:pointer;font-family:'Outfit',sans-serif;font-size:13px;font-weight:600">Save</button>
      </div></div>`;
    document.body.appendChild(m);
    const input = m.querySelector('#vex-prompt-input');
    input.value = value || '';
    input.focus(); input.select();
    const done = (v) => { m.remove(); resolve(v); };
    m.querySelector('#vex-prompt-ok').addEventListener('click', () => done(input.value));
    m.querySelector('#vex-prompt-cancel').addEventListener('click', () => done(null));
    m.addEventListener('click', (e) => { if (e.target === m) done(null); });
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') done(input.value); if (e.key === 'Escape') done(null); });
  });
}

const SidebarManager = {
  activePanel: null,
  panelWebviews: {},
  // Panels that use custom JS rendering (no webview)
  customPanels: ['settings', 'roblox', 'github', 'notes', 'downloads', 'history', 'memory', 'shortcuts', 'schedules', 'queue', 'bookmarks', 'feeds', 'library', 'annotations', 'recall'],

  panelConfigs: {
    start: { url: null, partition: null },
    whatsapp: { url: 'https://web.whatsapp.com/', partition: 'persist:whatsapp' },
    claude: { url: 'https://claude.ai/', partition: 'persist:claude' },
    spotify: { url: 'https://open.spotify.com/', partition: 'persist:spotify' },
    netflix: { url: 'https://www.netflix.com/', partition: 'persist:netflix' },
    queue: { url: null, partition: null },
    settings: { url: null, partition: null },
    roblox: { url: null, partition: null },
    github: { url: null, partition: null },
    notes: { url: null, partition: null },
    downloads: { url: null, partition: null },
    history: { url: null, partition: null },
    memory: { url: null, partition: null },
    schedules: { url: null, partition: null },
    shortcuts: { url: null, partition: null },
    bookmarks: { url: null, partition: null },
    feeds: { url: null, partition: null },
    library: { url: null, partition: null },
    annotations: { url: null, partition: null },
    recall: { url: null, partition: null }
  },

  // ---- Pin ANY site as a sidebar panel (Vivaldi-style web panels) ----
  SITE_KEY: 'vex.sitePanels',
  _sitePanels() { try { const a = JSON.parse(localStorage.getItem(this.SITE_KEY) || '[]'); return Array.isArray(a) ? a : []; } catch { return []; } },
  _saveSitePanels(a) { try { localStorage.setItem(this.SITE_KEY, JSON.stringify(a)); } catch {} },

  loadSitePanels() {
    this._sitePanels().forEach(p => this._mountSitePanel(p));
  },

  pinCurrentSite() {
    const t = typeof TabManager !== 'undefined' ? TabManager.getActiveTab() : null;
    if (!t || !t.url || !/^https?:/i.test(t.url)) { window.showToast?.('Open a website first'); return; }
    let host = t.url; try { host = new URL(t.url).hostname.replace(/^www\./, ''); } catch {}
    const list = this._sitePanels();
    if (list.some(p => p.url === t.url)) { window.showToast?.('Already pinned'); return; }
    const p = { id: 'site_' + Date.now(), name: host, url: t.url };
    list.push(p);
    this._saveSitePanels(list);
    this._mountSitePanel(p);
    window.showToast?.('📌 Pinned ' + host + ' to the sidebar (right-click its icon to unpin)');
  },

  _mountSitePanel(p) {
    this.panelConfigs[p.id] = { url: p.url, partition: 'persist:main' };
    // Panel container div
    if (!document.getElementById('panel-' + p.id)) {
      const div = document.createElement('div');
      div.className = 'panel';
      div.id = 'panel-' + p.id;
      div.style.display = 'none';
      document.getElementById('panels-container')?.appendChild(div);
    }
    // Sidebar icon (favicon), placed just above the spacer
    if (!document.querySelector('.sidebar-icon[data-panel="' + p.id + '"]')) {
      let host = p.url; try { host = new URL(p.url).hostname; } catch {}
      const btn = document.createElement('button');
      btn.className = 'sidebar-icon';
      btn.dataset.panel = p.id;
      btn.title = p.name + ' (pinned site — right-click for options)';
      btn.innerHTML = '<img src="https://www.google.com/s2/favicons?domain=' + encodeURIComponent(host) + '&sz=32" style="width:18px;height:18px;border-radius:4px" onerror="this.replaceWith(document.createTextNode(\'🌐\'))">';
      btn.addEventListener('click', () => this.togglePanel(p.id));
      // Full customization menu (Rename / Change icon / Change link / Unpin).
      btn.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        this.showContextMenu(e, p.id);
      });
      // Capture originals so "Reset to default" works for pinned sites too.
      this._origIcons[p.id] = { html: btn.innerHTML, title: btn.title };
      this._origUrls[p.id] = p.url;
      const spacer = document.querySelector('#icon-sidebar .sidebar-spacer');
      if (spacer) spacer.parentElement.insertBefore(btn, spacer);
    }
    this.applySidebarOrder();
  },

  unpinSite(id) {
    this._saveSitePanels(this._sitePanels().filter(p => p.id !== id));
    document.querySelector('.sidebar-icon[data-panel="' + id + '"]')?.remove();
    if (this.activePanel === id) this.hideActivePanel();
    document.getElementById('panel-' + id)?.remove();
    delete this.panelConfigs[id];
    delete this.panelWebviews[id];
    this.renderSidebarManager();
    window.showToast?.('Unpinned');
  },

  _origIcons: {},
  _origUrls: {},

  init() {
    // Capture original icon/title/url so "Reset to default" can restore them.
    document.querySelectorAll('.sidebar-icon[data-panel]').forEach(b => {
      this._origIcons[b.dataset.panel] = { html: b.innerHTML, title: b.title || '' };
    });
    Object.keys(this.panelConfigs).forEach(k => { this._origUrls[k] = this.panelConfigs[k].url; });

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
      // Right-click → customization menu. Every sidebar button gets one now:
      // URL-backed buttons (Claude/Spotify/WhatsApp, pinned sites) get the full
      // menu incl. Change link / Switch service / Refresh; internal feature
      // panels (Notes, Downloads, …) get Rename / Change icon / Hide / Reset.
      // showContextMenu() decides which items to show per button type.
      btn.addEventListener('contextmenu', (e) => {
        const panel = btn.dataset.panel;
        if (!panel) return;
        e.preventDefault();
        this.showContextMenu(e, panel);
      });
    });

    // Apply any saved per-button customizations (name/icon/link/hidden).
    this.applyPanelOverrides();

    // Mount user-pinned site panels (Vivaldi-style web panels).
    this.loadSitePanels();

    // Apply saved button order + populate the Settings → Sidebar manager.
    this.applySidebarOrder();
    this.renderSidebarManager();

    // Ctrl+Shift+J is now handled in main.js as a globalShortcut that calls
    // openDevTools on webContents.getFocusedWebContents(). The previous
    // renderer-side `document.addEventListener('keydown', ...)` listener
    // never fired for normal tabs because keydown events inside a guest
    // <webview> (OOPIF) don't bubble to the host doc. Moving to main fixes
    // that — and using getFocusedWebContents naturally routes to the right
    // target whether the user has a panel or a tab in front.
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
    if (panelName === 'roblox') RobloxPanel.init();
    if (panelName === 'github') GitHubPanel.init();
    if (panelName === 'notes') NotesPanel.init();
    if (panelName === 'downloads') DownloadsPanel.init();
    if (panelName === 'history') HistoryPanel.init();
    if (panelName === 'memory') MemoryPanel.init();
    if (panelName === 'schedules') SchedulesPanel.init();
    if (panelName === 'shortcuts') ShortcutsPanel.init();
    if (panelName === 'queue') QueuePanel.init();
    if (panelName === 'bookmarks' && typeof Bookmarks !== 'undefined') Bookmarks.renderPanel(panelEl);
    if (panelName === 'feeds' && typeof VexFeeds !== 'undefined') VexFeeds.renderPanel(panelEl);
    if (panelName === 'library' && typeof ReadLater !== 'undefined') ReadLater.renderPanel(panelEl);
    if (panelName === 'annotations' && typeof Annotations !== 'undefined') Annotations.renderPanel(panelEl);
    if (panelName === 'recall' && typeof Recall !== 'undefined') Recall.renderPanel(panelEl);
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
    if (panelName === 'settings' && typeof VexSkills !== 'undefined') {
      // AI Skills manager each time Settings opens
      VexSkills.renderPanel(document.getElementById('skills-panel-content'));
    }
    if (panelName === 'settings' && typeof VexBoosts !== 'undefined') {
      // Boosts (per-site customization) list each time Settings opens
      VexBoosts.renderPanel(document.getElementById('boosts-panel-content'));
    }
    if (panelName === 'settings' && typeof PasswordVault !== 'undefined') {
      // Saved passwords list each time Settings opens
      PasswordVault.renderPanel(document.getElementById('passwords-panel-content'));
    }
    if (panelName === 'settings' && typeof FocusMode !== 'undefined') {
      FocusMode.renderPanel(document.getElementById('focus-panel-content'));
    }
    if (panelName === 'settings' && typeof CommandChains !== 'undefined') {
      CommandChains.renderPanel(document.getElementById('chains-panel-content'));
    }
    if (panelName === 'settings' && typeof TabArchiver !== 'undefined') {
      TabArchiver.renderSettings(document.getElementById('library-panel-content'));
    }
    if (panelName === 'settings' && typeof AccessibilityPack !== 'undefined') {
      AccessibilityPack.renderPanel(document.getElementById('a11y-panel-content'));
    }
    if (panelName === 'settings' && typeof Recall !== 'undefined') {
      Recall.renderSettings(document.getElementById('recall-panel-content'));
    }
    if (panelName === 'settings' && typeof PrivacyPack !== 'undefined') {
      PrivacyPack.renderSettings(document.getElementById('privacy-panel-content'));
    }
    if (panelName === 'settings' && typeof AIMemory !== 'undefined') {
      AIMemory.renderSettings(document.getElementById('ai-memory-panel-content'));
    }
    if (panelName === 'settings' && typeof WebLLM !== 'undefined') {
      WebLLM.renderSettings(document.getElementById('webllm-panel-content'));
    }
    if (panelName === 'settings' && typeof McpClient !== 'undefined') {
      McpClient.renderSettings(document.getElementById('mcp-panel-content'));
    }
    if (panelName === 'settings' && typeof SettingsUI !== 'undefined') {
      // Categorize + colorize the settings panel (presentation only).
      SettingsUI.enhance();
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
        // Wire the guest right-click → Vex context menu, exactly like normal
        // tab webviews do in WebviewManager.createWebview. Without this, panel
        // webviews (Claude/Spotify/WhatsApp) swallowed right-clicks entirely —
        // no menu, and spellcheck suggestions never surfaced. Guarded in case
        // webview.js hasn't loaded yet.
        wv.addEventListener('context-menu', (e) => {
          if (window.WebviewManager && typeof WebviewManager.showContextMenu === 'function') {
            WebviewManager.showContextMenu(e, wv);
          }
        });
        // Apply the saved Master Volume level to this panel's media (Spotify,
        // Netflix, etc.) on load + as media appears, like tab webviews do.
        wv.addEventListener('dom-ready', () => {
          if (typeof MasterVolume !== 'undefined' && MasterVolume.level() !== 1) MasterVolume.applyToWebview(wv);
        });
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

  // ---- Per-button customization (name / icon / link / hide / order) ----

  // A button is "URL-backed" if clicking it loads a web page: the AI/web-app
  // panels (Claude/Spotify/WhatsApp), pinned sites (site_*), or any panel the
  // user has given a link override. Those offer Change link + Switch service +
  // Refresh/DevTools; internal feature panels (Notes, Downloads, …) only offer
  // Rename / Change icon / Hide / Reset (Change link doesn't apply — they open
  // Vex's own UI, not a URL).
  _isUrlPanel(panel) {
    if (!panel) return false;
    if (panel.startsWith('site_')) return true;
    const cfg = this.panelConfigs[panel];
    return !!(cfg && cfg.url);
  },

  applyPanelOverrides() {
    const ov = loadPanelOverrides();
    Object.keys(ov).forEach(panel => {
      const o = ov[panel] || {};
      if (o.url && this.panelConfigs[panel]) this.panelConfigs[panel].url = o.url;
      const btn = document.querySelector('.sidebar-icon[data-panel="' + panel + '"]');
      if (!btn) return;
      if (o.hidden) { btn.style.display = 'none'; return; }
      btn.style.display = '';
      if (o.name) btn.title = o.name;
      if (o.icon && SIDEBAR_ICONS[o.icon]) btn.innerHTML = SIDEBAR_ICONS[o.icon];
    });
  },

  setPanelOverride(panel, patch) {
    const ov = loadPanelOverrides();
    ov[panel] = Object.assign({}, ov[panel], patch);
    savePanelOverrides(ov);
    this.applyPanelOverrides();
    if (patch.url && this.panelWebviews[panel]) {
      const wv = this.panelWebviews[panel];
      try { if (typeof wv.loadURL === 'function') wv.loadURL(patch.url); else wv.src = patch.url; } catch (err) {}
    }
    this.renderSidebarManager();
    window.showToast?.('Updated');
  },

  resetPanelOverride(panel) {
    const ov = loadPanelOverrides(); delete ov[panel]; savePanelOverrides(ov);
    const btn = document.querySelector('.sidebar-icon[data-panel="' + panel + '"]');
    if (btn && this._origIcons[panel]) {
      btn.innerHTML = this._origIcons[panel].html;
      btn.title = this._origIcons[panel].title;
      btn.style.display = '';
    }
    if (this.panelConfigs[panel] && (panel in this._origUrls)) this.panelConfigs[panel].url = this._origUrls[panel];
    const wv = this.panelWebviews[panel];
    if (wv && this._origUrls[panel]) { try { wv.loadURL?.(this._origUrls[panel]); } catch (err) {} }
    this.applySidebarOrder();
    this.renderSidebarManager();
    window.showToast?.('Reset to default');
  },

  _esc(s) { const d = document.createElement('div'); d.textContent = s == null ? '' : String(s); return d.innerHTML; },

  // ---- Sidebar order (reorder the top buttons) ----
  _loadOrder() { try { const a = JSON.parse(localStorage.getItem('vex.sidebarOrder') || '[]'); return Array.isArray(a) ? a : []; } catch { return []; } },
  _saveOrder(a) { try { localStorage.setItem('vex.sidebarOrder', JSON.stringify(a)); } catch {} },

  // The reorderable region is every .sidebar-icon ABOVE the spacer — Settings
  // and the tools-bar stay pinned at the bottom. Returns buttons in DOM order.
  _topButtons() {
    const bar = document.getElementById('icon-sidebar');
    if (!bar) return [];
    const out = [];
    for (const el of Array.from(bar.children)) {
      if (el.classList && el.classList.contains('sidebar-spacer')) break;
      if (el.classList && el.classList.contains('sidebar-icon') && el.dataset.panel) out.push(el);
    }
    return out;
  },

  applySidebarOrder() {
    const bar = document.getElementById('icon-sidebar');
    if (!bar) return;
    const spacer = bar.querySelector('.sidebar-spacer');
    const btns = this._topButtons();
    const order = this._loadOrder();
    if (!btns.length || !order.length) return; // no custom order → keep HTML order
    const byPanel = {};
    btns.forEach(b => { byPanel[b.dataset.panel] = b; });
    const seen = new Set();
    const seq = [];
    order.forEach(p => { if (byPanel[p]) { seq.push(byPanel[p]); seen.add(p); } });
    btns.forEach(b => { if (!seen.has(b.dataset.panel)) seq.push(b); }); // new buttons keep their spot at the end
    seq.forEach(b => { if (spacer) bar.insertBefore(b, spacer); else bar.appendChild(b); });
  },

  moveButton(panel, dir) {
    const panels = this._topButtons().map(b => b.dataset.panel);
    let order = this._loadOrder().filter(p => panels.includes(p));
    panels.forEach(p => { if (!order.includes(p)) order.push(p); }); // seed from current order
    const i = order.indexOf(panel);
    const j = dir < 0 ? i - 1 : i + 1;
    if (i < 0 || j < 0 || j >= order.length) return;
    [order[i], order[j]] = [order[j], order[i]];
    this._saveOrder(order);
    this.applySidebarOrder();
    this.renderSidebarManager();
  },

  // ---- Settings → Sidebar manager (master list: show/hide + restore, rename,
  // change icon, change link for URL buttons, reorder) ----
  renderSidebarManager() {
    const host = document.getElementById('sidebar-manager-list');
    if (!host) return;
    const ov = loadPanelOverrides();
    const btns = this._topButtons();
    host.innerHTML = '';
    btns.forEach((btn) => {
      const panel = btn.dataset.panel;
      const o = ov[panel] || {};
      const hidden = !!o.hidden;
      const name = o.name || btn.title || panel;
      const isUrl = this._isUrlPanel(panel);
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;align-items:center;gap:6px;padding:6px 2px;border-bottom:1px solid var(--border)';
      const btnCss = 'background:var(--surface);border:1px solid var(--border);color:var(--text);border-radius:6px;cursor:pointer;width:26px;height:26px;display:grid;place-items:center;font-size:12px;padding:0';
      row.innerHTML =
        '<span style="width:22px;height:22px;display:grid;place-items:center;opacity:' + (hidden ? '0.4' : '1') + '">' + btn.innerHTML + '</span>' +
        '<span style="flex:1;font-size:13px;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;' + (hidden ? 'opacity:0.5;text-decoration:line-through' : '') + '">' + this._esc(name) + '</span>' +
        '<button data-act="up"     title="Move up"     style="' + btnCss + '">▲</button>' +
        '<button data-act="down"   title="Move down"   style="' + btnCss + '">▼</button>' +
        '<button data-act="rename" title="Rename"      style="' + btnCss + '">✎</button>' +
        '<button data-act="icon"   title="Change icon" style="' + btnCss + '">★</button>' +
        (isUrl ? '<button data-act="link" title="Change link" style="' + btnCss + '">🔗</button>' : '') +
        '<button data-act="toggle" title="' + (hidden ? 'Show' : 'Hide') + '" style="' + btnCss + '">' + (hidden ? '+' : '−') + '</button>' +
        (panel.startsWith('site_') ? '' : '<button data-act="reset" title="Reset to default" style="' + btnCss + '">↺</button>');
      row.querySelectorAll('button[data-act]').forEach(b => {
        b.addEventListener('click', (ev) => {
          const act = b.dataset.act;
          if (act === 'up') this.moveButton(panel, -1);
          else if (act === 'down') this.moveButton(panel, +1);
          else if (act === 'rename') this.renamePanel(panel);
          else if (act === 'icon') {
            const r = b.getBoundingClientRect();
            this.showIconPicker({ clientX: r.left, clientY: r.bottom }, panel);
          } else if (act === 'link') this.changePanelLink(panel);
          else if (act === 'toggle') this.setPanelOverride(panel, { hidden: !hidden });
          else if (act === 'reset') this.resetPanelOverride(panel);
        });
      });
      host.appendChild(row);
    });
  },

  switchPanelService(panel, key) {
    const s = AI_SERVICES[key] || STREAMING_SERVICES[key]; if (!s) return;
    const patch = { name: s.name, url: s.url, hidden: false };
    if (s.icon) patch.icon = s.icon; // streaming services keep the current icon
    this.setPanelOverride(panel, patch);
    window.showToast?.('Switched to ' + s.name);
  },

  async renamePanel(panel) {
    const btn = document.querySelector('.sidebar-icon[data-panel="' + panel + '"]');
    const v = await vexPromptModal('Rename button', (btn && btn.title) || panel);
    if (v && v.trim()) this.setPanelOverride(panel, { name: v.trim() });
  },

  async changePanelLink(panel) {
    const cur = (this.panelConfigs[panel] && this.panelConfigs[panel].url) || '';
    const v = await vexPromptModal('Change link (URL)', cur);
    if (v && v.trim()) this.setPanelOverride(panel, { url: normalizeServiceUrl(v) });
  },

  showIconPicker(e, panel) {
    document.querySelectorAll('.tab-context-menu, .vex-icon-pop').forEach(m => m.remove());
    const pop = document.createElement('div');
    pop.className = 'tab-context-menu vex-icon-pop';
    pop.style.cssText = 'left:' + e.clientX + 'px;top:' + e.clientY + 'px;display:grid;grid-template-columns:repeat(5,34px);gap:5px;padding:9px;';
    Object.keys(SIDEBAR_ICONS).forEach(id => {
      const b = document.createElement('button');
      b.style.cssText = 'width:34px;height:34px;display:grid;place-items:center;border-radius:9px;border:1px solid var(--border);background:var(--surface);color:var(--text);cursor:pointer';
      b.innerHTML = SIDEBAR_ICONS[id];
      b.title = id;
      b.addEventListener('click', () => { this.setPanelOverride(panel, { icon: id }); pop.remove(); });
      pop.appendChild(b);
    });
    document.body.appendChild(pop);
    if (window.TabManager?._clampMenuToViewport) TabManager._clampMenuToViewport(pop, e.clientX, e.clientY);
    if (window.TabManager?._attachMenuDismissal) TabManager._attachMenuDismissal(pop);
  },

  // Right-click context menu for ANY sidebar button. The item set adapts to the
  // button type (see _isUrlPanel): URL-backed buttons get the full menu;
  // internal feature panels get Rename / Change icon / Hide / Reset; pinned
  // sites get Unpin instead of Hide. Reuses TabManager's .tab-context-menu
  // styling + dismissal helpers so behavior matches the tab menu.
  showContextMenu(e, panelName) {
    document.querySelectorAll('.tab-context-menu, .tab-group-context-menu, .context-menu-overlay').forEach(m => m.remove());

    const menu = document.createElement('div');
    menu.className = 'tab-context-menu';
    const x = e.clientX, y = e.clientY;
    menu.style.left = x + 'px';
    menu.style.top  = y + 'px';

    const isUrl = this._isUrlPanel(panelName);
    const isSite = panelName.startsWith('site_');

    const items = [
      { label: 'Rename…', action: () => this.renamePanel(panelName) },
      { label: 'Change icon…', action: () => this.showIconPicker(e, panelName) },
    ];
    // Change link + service switch + refresh/devtools only make sense for
    // buttons that actually load a web page.
    if (isUrl) {
      items.push({ label: 'Change link…', action: () => this.changePanelLink(panelName) });
      items.push({ separator: true });
      if (panelName === 'netflix') {
        // Streaming switcher: Netflix ↔ Prime Video ↔ Disney+ (shared persist:netflix jar).
        items.push({ label: '🎬 Switch to Netflix', action: () => this.switchPanelService(panelName, 'netflix') });
        items.push({ label: '📺 Switch to Prime Video', action: () => this.switchPanelService(panelName, 'prime') });
        items.push({ label: '✨ Switch to Disney+', action: () => this.switchPanelService(panelName, 'disney') });
      } else {
        items.push({ label: 'Switch to Claude', action: () => this.switchPanelService(panelName, 'claude') });
        items.push({ label: 'Switch to Gemini', action: () => this.switchPanelService(panelName, 'gemini') });
        items.push({ label: 'Switch to ChatGPT', action: () => this.switchPanelService(panelName, 'chatgpt') });
      }
      items.push({ separator: true });
      items.push({ label: 'Refresh', action: makeRefreshAction(this, panelName) });
      items.push({
        label: 'Open DevTools',
        action: () => {
          const wv = this.panelWebviews[panelName];
          if (!wv) { this.showPanel(panelName); return; }
          const id  = typeof wv.getWebContentsId === 'function' ? wv.getWebContentsId() : null;
          const url = typeof wv.getURL === 'function' ? wv.getURL() : null;
          if (window.vexDevTools?.openForWebContents) {
            window.vexDevTools.openForWebContents(id, url).then(r => {
              if (!r?.ok) console.warn('[Sidebar] DevTools failed for ' + panelName + ':', r);
            }).catch(err => console.error('[Sidebar] DevTools IPC failed:', err));
          } else if (typeof wv.openDevTools === 'function') {
            try { wv.openDevTools(); } catch (err) { console.error('[Sidebar] wv.openDevTools error:', err); }
          }
        }
      });
    }
    items.push({ separator: true });
    if (isSite) {
      // Pinned sites are removed entirely, not just hidden.
      items.push({ label: 'Unpin', danger: true, action: () => this.unpinSite(panelName) });
    } else if (panelName !== 'settings') {
      // Settings stays un-hideable — it's the gateway to the Sidebar manager
      // where hidden buttons are restored.
      items.push({ label: 'Hide button', danger: true, action: () => this.setPanelOverride(panelName, { hidden: true }) });
    }
    items.push({ label: 'Reset to default', action: () => this.resetPanelOverride(panelName) });

    items.forEach(item => {
      if (item.separator) {
        const sep = document.createElement('div');
        sep.className = 'tab-context-separator';
        sep.style.cssText = 'height:1px;margin:4px 8px;background:var(--border)';
        menu.appendChild(sep);
        return;
      }
      const el = document.createElement('div');
      el.className = 'tab-context-item' + (item.danger ? ' danger' : '');
      el.textContent = item.label;
      // Use _dismissMenu (not bare menu.remove) so the dismissal overlay is
      // torn down too — otherwise it lingers and eats the next click.
      el.addEventListener('click', () => {
        item.action();
        if (window.TabManager?._dismissMenu) TabManager._dismissMenu(menu); else menu.remove();
      });
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

// Renderer-safe export: Node (vitest) gets makeRefreshAction + SidebarManager;
// the <script>-tag path on the renderer leaves the existing globals alone.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { makeRefreshAction, SidebarManager };
}

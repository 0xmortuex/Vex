// === Vex Sidebar Panel Manager ===

// Refresh-action factory. Hoisted to module scope so tests can require() it
// independently of the DOM-bound SidebarManager. Behaviour:
//   - If the panel's webview already exists, ensure the panel is visible
//     (showPanel) and call wv.reload(). Showing first prevents the silent
//     no-op the user reported when right-clicking an icon for a panel that
//     wasn't currently open — the reload was already firing, just invisible.
//   - If no webview exists yet (panel never opened), showPanel will create
//     one and load the URL, which is functionally a "first refresh".
// Resolve a panel's LIVE <webview>.
//
// panelWebviews[panelName] is a cached node reference, and it goes stale: after
// a service switch, a re-mount or a hide/show the panel's real element can be a
// different node, and loadURL()/reload() on the detached one is a SILENT no-op
// (every call site wraps it in an empty catch) - the button simply does nothing.
// makeRefreshAction and the panel nav bar already preferred the DOM node for
// exactly this reason; the override paths ("Switch to ...", "Change link",
// "Reset to default") did not, so those stayed broken whenever the cache went
// stale. Re-syncs the cache so the next caller starts from the right node.
function resolvePanelWebview(manager, panelName) {
  let wv = manager && manager.panelWebviews && manager.panelWebviews[panelName];
  try {
    const panelEl = typeof document !== 'undefined' && document.getElementById('panel-' + panelName);
    const domWv = panelEl && typeof panelEl.querySelector === 'function' && panelEl.querySelector('webview');
    if (domWv && domWv !== wv) {
      wv = domWv;
      if (manager && manager.panelWebviews) manager.panelWebviews[panelName] = domWv;
    }
  } catch { /* no DOM (tests) - fall back to the cached ref */ }
  return wv || null;
}

// Which page should F12 / Ctrl+Shift+I open DevTools for.
//
// An open sidebar panel covers the content area, so the panel - not the active
// tab - is what you are looking at. The handler used to resolve the active TAB
// only, and panels are not tabs: over the Discord or Spotify panel F12 opened
// DevTools for whatever hidden tab happened to be active, or reported "No
// active tab" and did nothing visible. Falls back to the active tab when no
// panel is open, or when the open panel is a built-in view with no page of its
// own (Settings, History, Downloads...).
function resolveDevToolsTarget(sidebar, tabs, webviews) {
  try {
    const panel = sidebar && sidebar.activePanel;
    if (panel) {
      const wv = resolvePanelWebview(sidebar, panel);
      if (wv) return { webview: wv, source: 'panel', name: panel };
    }
  } catch { /* fall through to the active tab */ }

  try {
    const active = tabs && typeof tabs.getActiveTab === 'function' && tabs.getActiveTab();
    if (active && webviews && typeof webviews.get === 'function') {
      const wv = webviews.get(active.id);
      if (wv) return { webview: wv, source: 'tab', name: active.id };
    }
  } catch { /* nothing to open */ }

  return null;
}

// Navigate a panel to `url`, loudly. loadURL() rejects/throws when the guest
// isn't attached yet; fall back to the src attribute so the panel still moves
// instead of silently staying put.
function navigatePanelWebview(wv, url) {
  if (!wv || !url) return false;
  try {
    if (typeof wv.loadURL === 'function') {
      Promise.resolve(wv.loadURL(url)).catch((err) => {
        console.warn('[Sidebar] loadURL failed -', err && err.message, '- falling back to src');
        try { wv.setAttribute('src', url); } catch { /* element is gone */ }
      });
    } else if (typeof wv.setAttribute === 'function') {
      wv.setAttribute('src', url);
    } else {
      return false;
    }
    return true;
  } catch (err) {
    console.warn('[Sidebar] navigate failed -', err && err.message);
    try { wv.setAttribute('src', url); return true; } catch { return false; }
  }
}

function makeRefreshAction(manager, panelName) {
  return () => {
    // Resolve the panel's webview. Prefer the LIVE <webview> in the panel's DOM
    // over the stored reference: after a service switch, re-mount or hide/show,
    // panelWebviews[panelName] can point at a node that's no longer in the DOM,
    // and reload() on a detached node is a silent no-op — the "Refresh does
    // nothing" this fixes. The stored ref is the fallback (and is what the unit
    // tests exercise, since jsdom has no panel element).
    let wv = manager.panelWebviews && manager.panelWebviews[panelName];
    try {
      const panelEl = typeof document !== 'undefined' && document.getElementById('panel-' + panelName);
      const domWv = panelEl && typeof panelEl.querySelector === 'function' && panelEl.querySelector('webview');
      if (domWv) wv = domWv;
    } catch {}
    if (wv && typeof wv.reload === 'function') {
      if (manager.activePanel !== panelName && typeof manager.showPanel === 'function') {
        manager.showPanel(panelName);
      }
      try {
        wv.reload();
        console.log('[Sidebar] Refresh:', panelName);
      } catch (err) {
        // reload() throws when the element isn't attached/dom-ready yet — re-load
        // the panel's URL instead so Refresh still does something visible.
        console.warn('[Sidebar] reload() failed for', panelName, '— reloading URL:', err && err.message);
        try {
          const cfg = manager.panelConfigs && manager.panelConfigs[panelName];
          const url = (cfg && cfg.url) || (typeof wv.getURL === 'function' ? wv.getURL() : '');
          if (url && typeof wv.loadURL === 'function') wv.loadURL(url);
          else if (url && typeof wv.setAttribute === 'function') wv.setAttribute('src', url);
        } catch (e2) { console.error('[Sidebar] Refresh failed for', panelName, '-', e2 && e2.message); }
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
  roku:    '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="6" width="18" height="12" rx="3"/><path d="M8 15V9h2.3a1.6 1.6 0 0 1 0 3.2H8M10.6 12.2L12.6 15"/></svg>',
  discord: '<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M20 5.3A17 17 0 0 0 15.7 4l-.2.4a15.6 15.6 0 0 1 3.9 1.2 13.6 13.6 0 0 0-11.8 0A15.6 15.6 0 0 1 11.5 4.4L11.3 4A17 17 0 0 0 7 5.3C4.3 9.3 3.6 13.2 4 17a17 17 0 0 0 5.1 2.6l.6-1a11 11 0 0 1-1.8-.9c.15-.1.3-.2.44-.32a9.7 9.7 0 0 0 8.3 0c.15.12.3.22.45.32a11 11 0 0 1-1.8.9l.6 1A17 17 0 0 0 21 17c.5-4.3-.5-8.2-3-11.7zM9.3 14.6c-.9 0-1.6-.84-1.6-1.86 0-1.02.69-1.86 1.6-1.86.92 0 1.63.84 1.6 1.86 0 1.02-.69 1.86-1.6 1.86zm5.4 0c-.9 0-1.6-.84-1.6-1.86 0-1.02.69-1.86 1.6-1.86.92 0 1.63.84 1.6 1.86 0 1.02-.68 1.86-1.6 1.86z"/></svg>',
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
  roku:    { name: 'The Roku Channel', url: 'https://therokuchannel.roku.com/', icon: 'roku' },
};

function loadPanelOverrides() { try { return JSON.parse(localStorage.getItem('vex.panelOverrides') || '{}'); } catch { return {}; } }
function savePanelOverrides(o) { try { localStorage.setItem('vex.panelOverrides', JSON.stringify(o)); } catch {} }
function normalizeServiceUrl(u) { u = (u || '').trim(); if (!u) return ''; if (!/^https?:\/\//i.test(u)) u = 'https://' + u; return u; }

// Electron disables window.prompt — thin compat alias over the unified
// dialog (js/vex-dialog.js); many call sites across the app use this name.
function vexPromptModal(title, value) {
  return window.vexPrompt({ title, value, okLabel: 'Save' });
}

const SidebarManager = {
  activePanel: null,
  // A second panel shown beside activePanel (openBeside), or null.
  sidePanel: null,
  panelWebviews: {},
  // Panels that use custom JS rendering (no webview)
  customPanels: ['settings', 'github', 'notes', 'downloads', 'history', 'memory', 'shortcuts', 'schedules', 'queue', 'bookmarks', 'feeds', 'library', 'annotations', 'recall', 'authenticator', 'privacy'],

  panelConfigs: {
    start: { url: null, partition: null },
    whatsapp: { url: 'https://web.whatsapp.com/', partition: 'persist:whatsapp' },
    claude: { url: 'https://claude.ai/', partition: 'persist:claude' },
    spotify: { url: 'https://open.spotify.com/', partition: 'persist:spotify' },
    netflix: { url: 'https://www.netflix.com/', partition: 'persist:netflix' },
    discord: { url: 'https://discord.com/app', partition: 'persist:discord' },
    queue: { url: null, partition: null },
    settings: { url: null, partition: null },
    roblox: { url: 'https://www.roblox.com/', partition: 'persist:roblox' },
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
    recall: { url: null, partition: null },
    authenticator: { url: null, partition: null },
    privacy: { url: null, partition: null }
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
    const p = { id: vexId('site_'), name: host, url: t.url };
    list.push(p);
    this._saveSitePanels(list);
    this._mountSitePanel(p);
    window.showToast?.('Pinned ' + host + ' to the sidebar (right-click its icon to unpin)');
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
      btn.innerHTML = '<img src="https://' + encodeURIComponent(host) + '/favicon.ico" style="width:18px;height:18px;border-radius:4px" data-image-fallback="hide">';
      btn.addEventListener('click', (e) => {
        if (e.shiftKey && this._besideOnShift(p.id)) return;
        this.togglePanel(p.id);
      });
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
    else if (this.sidePanel === id) this.closeBeside();
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
    // Hidden panels give their process back after a while; Discord is watched.
    this._wirePanelSleepSettings();
    this.startPanelAutoSleep();
    this.startDiscordMemoryWatch();
    // Past its limit, a hidden idle Discord is swapped for a fresh one (js/discord-memory.js).
    if (window.DiscordMemory) window.DiscordMemory.start();
    this.startDiscordRest();
    this.startGpuCourtesy();
    // The Memory panel's trend line samples from launch, not from its first open.
    if (typeof MemoryPanel !== 'undefined' && MemoryPanel.startTrend) MemoryPanel.startTrend();

    // Set up sidebar icon clicks
    document.querySelectorAll('.sidebar-icon').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const panel = btn.dataset.panel;
        // The "Start Page" (house) icon has no corresponding panel UI —
        // panel-start is an empty div — so opening it used to blank the
        // webview area. Route it to open/focus the real start-page tab
        // (start.html, the new-tab page) instead.
        if (panel === 'start') {
          this.openStartPage();
          return;
        }
        if (e.shiftKey && this._besideOnShift(panel)) return;
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

    // One-time: hide the niche feature panels by default so the sidebar ships
    // lean (the browser core + apps stay; the rest are one click away in
    // Settings → Sidebar). Runs once per install; respects later user choices.
    this._applyLeanDefault();
    this._hideBookmarksOnce();

    // Apply any saved per-button customizations (name/icon/link/hidden).
    this.applyPanelOverrides();

    // Mount user-pinned site panels (Vivaldi-style web panels).
    this.loadSitePanels();

    // Apply saved button order + populate the Settings → Sidebar manager.
    this.applySidebarOrder();
    this.renderSidebarManager();

    // Discord block-bypass: main defaults to 'light'; re-apply the user's saved
    // On ('auto') / Off choice on startup.
    try {
      const m = localStorage.getItem('vex.discordBypassMode');
      if (window.vex?.setDiscordBypassMode && (m === 'auto' || m === 'off')) {
        // Re-run the sweep on startup; when it lands on a working mode, reload the
        // Discord panel (if already open) so it picks up the proxy — no blank flash.
        Promise.resolve(window.vex.setDiscordBypassMode(m, {})).then((r) => {
          if (r && r.ok) { const wv = this.panelWebviews['discord']; if (wv) { try { wv.reload(); } catch {} } }
        }).catch(() => {});
      }
    } catch {}
    // Live progress for the auto-configure sweep → update the progress card.
    try { window.vex?.onDiscordBypassProgress?.((p) => { if (p && p.phase === 'testing') this._updateDiscordProgress(`Testing ${p.label}… (${p.i}/${p.total})`); }); } catch {}
    // Re-apply the saved Roblox bypass (shares Discord's ByeDPI) on startup.
    try {
      if (localStorage.getItem('vex.robloxBypass') === 'on' && window.vex?.setRobloxBypass) {
        Promise.resolve(window.vex.setRobloxBypass(true)).then((r) => {
          if (r && r.ok) { const wv = this.panelWebviews['roblox']; if (wv) { try { wv.reload(); } catch {} } }
        }).catch(() => {});
      }
    } catch {}

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
    // Its icon again takes the second panel away, and only that one.
    if (this.sidePanel === panelName) {
      this.closeBeside();
      return;
    }

    this.showPanel(panelName);
  },

  showPanel(panelName) {
    // Discord set to open as a tab (Settings › Performance): its button, Ctrl+K
    // and links open or switch to that tab instead of the panel.
    if (panelName === 'discord' && window.DiscordMemory && DiscordMemory.mode() === 'tab') { DiscordMemory.openTab(); return; }
    // Split screen and sidebar panels both own the content area — opening a panel
    // must exit split first. Otherwise .split-mode's `display:grid !important`
    // beats the inline `display:none` below, so the container never hides and you
    // come back to a broken half-width grid (reported live).
    if (typeof SplitScreen !== 'undefined' && SplitScreen.active) { try { SplitScreen.deactivate(); } catch {} }
    // Usage timestamps feed the one-time declutter nudge (maybeOfferDeclutter)
    // and the panel sleep clock: the panels leaving the front are stamped too.
    if (this.activePanel !== panelName) this._touchUsage(this.activePanel);
    if (this.sidePanel !== panelName) this._touchUsage(this.sidePanel);
    this._touchUsage(panelName);
    // A fresh open of Discord re-arms the "looks blocked" prompt.
    if (panelName === 'discord') this._discordPromptDismissed = false;
    // Hide all panels
    document.querySelectorAll('#panels-container .panel').forEach(p => {
      p.style.display = 'none';
    });

    // Hide webviews — unless the panel docks beside the page (browser looks).
    document.getElementById('webviews-container').style.display = this._docksBesidePage(panelName) ? 'block' : 'none';

    // Show panels container
    document.getElementById('panels-container').style.pointerEvents = 'auto';

    const panelEl = document.getElementById(`panel-${panelName}`);
    if (!panelEl) return;

    // Shown by removing the inline "display:none", not by forcing "block":
    // a panel whose stylesheet lays it out as a flex column (Work, Clock)
    // needs that to scroll — forced to block, its content ran off the bottom
    // with nothing to scroll in the docked sidebar of the Firefox look.
    panelEl.style.display = '';
    this._preparePanel(panelName, panelEl);
    this.activePanel = panelName;

    // The panel remembered beside this one (openBeside) comes back with it;
    // whatever sat beside the previous panel goes.
    const paired = this._pairs()[panelName];
    const sideEl = paired && paired !== panelName && this._canSit(paired) && this._canSit(panelName)
      ? document.getElementById(`panel-${paired}`) : null;
    this.sidePanel = sideEl ? paired : null;
    if (sideEl) { sideEl.style.display = ''; this._preparePanel(paired, sideEl); }
    this._layoutPanels();
    this._announcePanel(panelName);
    // Discord in front runs unthrottled at once (checkDiscordThrottle).
    if (this.panelWebviews.discord) this.checkDiscordThrottle().catch(() => {});
  },

  // Everything a panel needs on its way to being shown: the feature panels
  // draw themselves, the web panels get their <webview> on first open. The
  // panel is already displayed — a <webview> must not be attached hidden.
  _preparePanel(panelName, panelEl) {
    // Initialize custom panels on first open
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
    if (panelName === 'authenticator' && typeof Authenticator !== 'undefined') Authenticator.renderPanel(panelEl);
    if (panelName === 'privacy' && typeof PrivacyDashboard !== 'undefined') PrivacyDashboard.renderPanel(panelEl);
    if (panelName === 'work' && typeof WorkPanel !== 'undefined') WorkPanel.renderPanel(panelEl);
    if (panelName === 'clock' && typeof VexClock !== 'undefined') VexClock.renderPanel(panelEl);
    if (panelName === 'devtools-dash' && typeof VexDevMode !== 'undefined') VexDevMode.renderPanel(panelEl);
    if (panelName === 'settings' && typeof SyncSettings !== 'undefined') {
      // Phase 13: render the Vex Sync section whenever Settings opens
      const c = document.getElementById('sync-panel-content');
      if (c) SyncSettings.renderSyncPanel(c);
    }
    if (panelName === 'settings' && typeof AISettings !== 'undefined') {
      // Phase 14: populate the AI Backend section each time Settings opens
      AISettings.renderAISettings();
    }
    if (panelName === 'settings' && typeof GameMode !== 'undefined') {
      // Streamer mode and the Discord hotkeys (js/game-mode.js).
      GameMode.renderSettings().catch(err => VexProblems?.note('Settings', 'Could not show the gaming settings', err));
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
      this._createPanelWebview(panelName, panelEl);
    }
  },

  // One web panel's <webview>, wired and placed in its panel. Used by
  // showPanel, and by the Discord memory limit (js/discord-memory.js) to
  // replace a bloated Discord with a fresh one WITHOUT showing it.
  _createPanelWebview(panelName, panelEl) {
    const config = this.panelConfigs[panelName];
    if (!config || !config.url || !panelEl) return null;
    const wv = document.createElement('webview');
    wv.setAttribute('src', config.url);
    if (config.partition) {
      wv.setAttribute('partition', config.partition);
    }
    wv.setAttribute('allowpopups', '');
    // Discord freezes for a few seconds when you toggle the panel off (or
    // switch tabs) and come back: hiding the panel sets the guest to
    // display:none, and Electron's default backgroundThrottling lets
    // Chromium suspend the page — so on return the heavy Discord SPA has to
    // reconnect its gateway and replay throttled timers before it paints.
    // Keep the Discord guest running while hidden so re-showing is instant.
    const wp = panelName === 'discord'
      ? 'contextIsolation=yes,backgroundThrottling=no'
      : 'contextIsolation=yes';
    wv.setAttribute('webpreferences', wp);
    if (panelName === 'discord') this._discordThrottled = false;   // created unthrottled (see checkDiscordThrottle)
    // Microphone / camera in use (preload-webview.js getUserMedia wrapper):
    // a badge on the icon, never slept meanwhile, and a call signal for Discord.
    wv.addEventListener('ipc-message', (e) => {
      if (e.channel !== 'vex-media-capture') return;
      const d = (e.args && e.args[0]) || {};
      this.setPanelCapturing(panelName, d.kind, d.active);
    });
    wv.style.width = '100%';
    wv.style.height = '100%';
    // Wire the guest right-click → Vex context menu, exactly like normal
    // tab webviews do in WebviewManager.createWebview. Without this, panel
    // webviews (Claude/Spotify/WhatsApp) swallowed right-clicks entirely —
    // no menu, and spellcheck suggestions never surfaced. Guard with
    // typeof, NOT window.WebviewManager: webview.js declares a top-level
    // `const`, which is visible across classic scripts but is NOT a window
    // property — the old `window.WebviewManager &&` guard was always
    // undefined, silently eating every panel right-click (found live via
    // CDP, 2026-08-25).
    wv.addEventListener('context-menu', (e) => {
      if (typeof WebviewManager !== 'undefined' && typeof WebviewManager.showContextMenu === 'function') {
        WebviewManager.showContextMenu(e, wv);
      }
    });
    // Password vault — panels (Spotify, Claude, WhatsApp…) get the same
    // save-prompt + autofill as tab webviews. Without this, logging into
    // the Spotify panel never offered to save and never autofilled (the
    // vault was only wired in WebviewManager.createWebview for tabs).
    if (typeof PasswordVault !== 'undefined') PasswordVault.attach(wv);
    // Apply the saved Master Volume level to this panel's media (Spotify,
    // Netflix, etc.) on load + as media appears, like tab webviews do.
    wv.addEventListener('dom-ready', () => {
      if (typeof MasterVolume !== 'undefined' && MasterVolume.level() !== 1) MasterVolume.applyToWebview(wv);
      if (typeof PasswordVault !== 'undefined') { try { PasswordVault.autofill(wv, wv.getURL()); } catch {} }
      if (typeof TotpAutofill !== 'undefined') { try { TotpAutofill.autofill(wv, wv.getURL()); } catch {} }
      if (typeof EmailCodeAutofill !== 'undefined') { try { EmailCodeAutofill.tryFill(wv, wv.getURL()); } catch {} }
    });
    // Discord: if the page fails to connect (it's blocked), offer the bypass.
    if (panelName === 'discord') {
      wv.addEventListener('did-fail-load', (e) => {
        if (!e.isMainFrame || e.errorCode === -3) return; // ignore aborts
        this._showDiscordBlockedPrompt(wv, panelEl);
      });
      wv.addEventListener('did-finish-load', () => this._hideDiscordBlockedPrompt());
    }
    panelEl.appendChild(wv);
    this.panelWebviews[panelName] = wv;
    // Panels aren't tabs, so the main toolbar's back/forward/reload can't
    // drive them. Give every web panel (Spotify, Claude, Discord, pinned
    // sites, …) its own slim back/forward/reload bar.
    this._addPanelNav(panelEl, wv, panelName);
    return wv;
  },

  // ---- Two panels at once -------------------------------------------------
  // Claude beside Discord, both usable: openBeside puts a second panel next to
  // the open one, half the area each (css: #panels-container[data-split]).
  // The pair is remembered both ways, so opening either later brings the other
  // back with it, until closeBeside — or the second panel's own icon — takes
  // it away again. Settings is a whole page and never shares.

  _canSit(panelName) {
    // 'start' has a panel element too, but it is an empty div: the house
    // button opens the New Tab page, not a panel.
    return !!panelName && panelName !== 'settings' && panelName !== 'start' && !!document.getElementById('panel-' + panelName);
  },

  _pairs() {
    try {
      const p = JSON.parse(localStorage.getItem('vex.panelPairs') || '{}');
      return p && typeof p === 'object' && !Array.isArray(p) ? p : {};
    } catch { return {}; }
  },

  _savePair(primary, side) {
    const pairs = this._pairs();
    if (side) {
      pairs[primary] = side;
      pairs[side] = primary;
    } else {
      const other = pairs[primary];
      delete pairs[primary];
      if (other && pairs[other] === primary) delete pairs[other];
    }
    try { localStorage.setItem('vex.panelPairs', JSON.stringify(pairs)); } catch {}
  },

  // Shows exactly activePanel and sidePanel, marks which is which for the
  // layout, and lights both icons.
  _layoutPanels() {
    const container = document.getElementById('panels-container');
    const side = this.sidePanel;
    document.querySelectorAll('#panels-container .panel').forEach(p => {
      const name = p.id.replace(/^panel-/, '');
      const primary = !!this.activePanel && name === this.activePanel;
      const beside = !!side && name === side;
      p.classList.toggle('sb-primary', primary);
      p.classList.toggle('sb-side', beside);
      // '' (the panel's own stylesheet display), not 'block' — see showPanel.
      p.style.display = primary || beside ? '' : 'none';
    });
    if (container) {
      if (side) {
        container.dataset.split = side;
        container.style.setProperty('--sb-split', (this._splitRatio() * 100).toFixed(2) + '%');
        this._ensureSplitGrip(container);
      } else {
        delete container.dataset.split;
      }
    }
    document.querySelectorAll('.sidebar-icon').forEach(btn => {
      const n = btn.dataset.panel;
      btn.classList.toggle('active', (!!this.activePanel && n === this.activePanel) || (!!side && n === side));
    });
  },

  panelLabel(panelName) {
    const btn = document.querySelector('.sidebar-icon[data-panel="' + panelName + '"]');
    const title = (btn && btn.title) || panelName;
    return title.replace(/\s*\(.*\)\s*$/, '').split(' — ')[0];
  },

  openBeside(panelName) {
    if (!this.activePanel) throw new Error('Open a panel first, then put another beside it');
    if (panelName === this.activePanel) throw new Error(this.panelLabel(panelName) + ' is already open');
    if (!this._canSit(panelName) || !this._canSit(this.activePanel)) throw new Error('Settings takes the whole area and cannot share it');
    const panelEl = document.getElementById('panel-' + panelName);
    this.sidePanel = panelName;
    panelEl.style.display = '';
    this._preparePanel(panelName, panelEl);
    this._savePair(this.activePanel, panelName);
    this._layoutPanels();
    this._announcePanel(this.activePanel);
  },

  closeBeside() {
    if (!this.sidePanel) return;
    this._savePair(this.activePanel, null);
    this.sidePanel = null;
    this._layoutPanels();
    this._announcePanel(this.activePanel);
  },

  swapBeside() {
    if (!this.sidePanel) throw new Error('There is no second panel to swap with');
    const a = this.activePanel, b = this.sidePanel;
    this.activePanel = b;
    this.sidePanel = a;
    this._layoutPanels();
    this._announcePanel(b);
  },

  // ---- The divider between the two panels: drag it to change the share
  // (css: --sb-split on #panels-container), double-click to swap sides.
  _splitRatio() {
    const r = Number(localStorage.getItem('vex.panelSplitRatio'));
    return Number.isFinite(r) && r >= 0.2 && r <= 0.8 ? r : 0.5;
  },

  setSplitRatio(ratio) {
    if (!Number.isFinite(ratio)) throw new Error('Split ratio must be a number');
    const v = Math.min(0.8, Math.max(0.2, ratio));
    const container = document.getElementById('panels-container');
    if (container) container.style.setProperty('--sb-split', (v * 100).toFixed(2) + '%');
    try { localStorage.setItem('vex.panelSplitRatio', String(v)); } catch {}
    return v;
  },

  _ensureSplitGrip(container) {
    let grip = document.getElementById('sb-split-grip');
    if (grip) return grip;
    grip = document.createElement('div');
    grip.id = 'sb-split-grip';
    grip.title = 'Drag to resize — double-click to swap sides';
    grip.addEventListener('pointerdown', (e) => this._startSplitDrag(e));
    container.appendChild(grip);
    return grip;
  },

  _startSplitDrag(e) {
    e.preventDefault();
    // A double-click swaps the sides. Counted from the pointer-downs: the
    // drag shield below takes the second click's mouseup, so the browser's
    // own dblclick never reaches the divider.
    const now = Date.now();
    if (now - (this._gripDownAt || 0) < 400) {
      this._gripDownAt = 0;
      this.swapBeside();
      return;
    }
    this._gripDownAt = now;
    const box = document.getElementById('panels-container').getBoundingClientRect();
    // Pages are separate processes and swallow pointer moves, so a shield
    // covers them for the length of the drag (as js/look-sidebar.js does).
    const shield = document.createElement('div');
    shield.id = 'sb-split-shield';
    document.body.appendChild(shield);
    const move = (ev) => this.setSplitRatio((ev.clientX - box.left) / box.width);
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      shield.remove();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  },

  // Shift+click on an icon: beside the open panel rather than instead of it.
  _besideOnShift(panelName) {
    if (!this.activePanel || this.activePanel === panelName || this.sidePanel === panelName) return false;
    if (!this._canSit(panelName) || !this._canSit(this.activePanel)) return false;
    try { this.openBeside(panelName); }
    catch (err) { window.showToast?.(err.message, 'error'); }
    return true;
  },

  // ---- Sleeping web panels --------------------------------------------------
  // A hidden web panel keeps its <webview>, and so its process: Claude,
  // Spotify, GitHub… stayed resident (150–350 MB each) after one open, for
  // good. Sleeping one drops the webview; showPanel makes a fresh one on the
  // next open. Discord is kept awake by default (voice, notifications), and a
  // panel playing audio never sleeps.

  isWebPanel(name) {
    const c = this.panelConfigs[name];
    return !!(c && c.url) && !this.customPanels.includes(name);
  },

  // vex.panelAutoSleep ('0' = off), vex.panelSleepMinutes (default 30, capped
  // at 10 under Memory Saver like tabs), vex.panelSleepExempt — the panels
  // kept awake. Discord and WhatsApp by default: a sleeping panel cannot show
  // a new-message notification.
  KEEP_AWAKE_DEFAULT: ['discord', 'whatsapp'],
  panelSleepPrefs() {
    let exempt = [...this.KEEP_AWAKE_DEFAULT];
    try {
      const e = JSON.parse(localStorage.getItem('vex.panelSleepExempt') || 'null');
      if (Array.isArray(e)) exempt = e.filter(x => typeof x === 'string');
    } catch {}
    let minutes = Number(localStorage.getItem('vex.panelSleepMinutes'));
    if (!Number.isFinite(minutes) || minutes <= 0) minutes = 30;
    if (localStorage.getItem('vex.memorySaver') === '1') minutes = Math.min(minutes, 10);
    return { enabled: localStorage.getItem('vex.panelAutoSleep') !== '0', minutes, exempt };
  },

  sleptPanels: {},

  sleepPanel(name) {
    const wv = this.panelWebviews[name];
    if (!wv) throw new Error(this.panelLabel(name) + ' is not loaded');
    if (name === this.activePanel || name === this.sidePanel) throw new Error(this.panelLabel(name) + ' is open — close it first');
    try { wv.remove(); } catch {}
    delete this.panelWebviews[name];
    document.querySelectorAll('.panel-navbar[data-panel="' + name + '"]').forEach(n => n.remove());
    this.sleptPanels[name] = Date.now();
    document.dispatchEvent(new CustomEvent('vex:panel-slept', { detail: { panel: name } }));
    document.dispatchEvent(new CustomEvent('vex:memory-event', { detail: { note: 'Slept panel: ' + this.panelLabel(name) } }));
  },

  // When a panel was last in front (vex.panelUsage): stamped on open and on
  // being hidden, so the idle clock starts when you leave it, not when you
  // came to it.
  _touchUsage(name) {
    if (!name) return;
    try {
      const u = JSON.parse(localStorage.getItem('vex.panelUsage') || '{}') || {};
      u[name] = Date.now();
      localStorage.setItem('vex.panelUsage', JSON.stringify(u));
    } catch {}
  },

  // The hidden web panels due to sleep now.
  panelsDueToSleep(now = Date.now()) {
    const p = this.panelSleepPrefs();
    if (!p.enabled) return [];
    let usage = {};
    try { usage = JSON.parse(localStorage.getItem('vex.panelUsage') || '{}') || {}; } catch {}
    return Object.keys(this.panelWebviews).filter(name => {
      if (name === this.activePanel || name === this.sidePanel || p.exempt.includes(name) || this.isPanelCapturing(name)) return false;
      const wv = this.panelWebviews[name];
      try { if (typeof wv.isCurrentlyAudible === 'function' && wv.isCurrentlyAudible()) return false; } catch {}
      return now - (Number(usage[name]) || 0) > p.minutes * 60000;
    });
  },

  // While Vex is hidden — minimised, or behind a fullscreen game — the local
  // model is holding video memory for nobody. Measured: a game with the card
  // at 7.7 of 8 GB pushed the model onto the processor, and the same agent task
  // that took 30 seconds ran past the two-minute limit and returned nothing.
  // So: hidden for five minutes and the card under pressure, hand it back. The
  // next request loads it again in a few seconds.
  GPU_COURTESY_MS: 5 * 60000,
  startGpuCourtesy() {
    if (this._gpuCourtesy) return;
    const consider = () => {
      clearTimeout(this._gpuCourtesyTimer);
      if (!document.hidden) return;
      this._gpuCourtesyTimer = setTimeout(() => this.freeGpuIfCrowded(), this.GPU_COURTESY_MS);
    };
    this._gpuCourtesy = consider;
    document.addEventListener('visibilitychange', consider);
    consider();
  },

  async freeGpuIfCrowded() {
    if (!document.hidden || typeof ModelManager === 'undefined') return null;
    // Never while the agent or a chat is mid-answer.
    if (typeof AgentLoop !== 'undefined' && AgentLoop.isRunning && AgentLoop.isRunning()) return null;
    if (typeof AIPanel !== 'undefined' && AIPanel._sending) return null;
    let gpu = null;
    try { gpu = (window.vex && window.vex.gpu) ? await window.vex.gpu() : null; } catch { return null; }
    // Only when something else actually wants the card.
    if (!gpu || gpu.usedPercent < 70) return null;
    try {
      const r = await ModelManager.freeGpu();
      if (r.models.length) {
        const note = `Gave ${(r.freed / 1024).toFixed(1)} GB of video memory back while Vex was hidden (${r.models.join(', ')})`;
        document.dispatchEvent(new CustomEvent('vex:memory-event', { detail: { note } }));
        return r;
      }
    } catch (err) { VexProblems?.note('Local AI', 'Could not free the graphics card', err); }
    return null;
  },

  startPanelAutoSleep() {
    if (this._panelSleepTimer) clearInterval(this._panelSleepTimer);
    this._panelSleepTimer = setInterval(() => {
      for (const name of this.panelsDueToSleep()) {
        try { this.sleepPanel(name); }
        catch (err) { console.error('[Sidebar] could not sleep panel ' + name + ':', err.message); }
      }
    }, 60000);
  },

  // Settings › Performance: the two panel switches.
  _wirePanelSleepSettings() {
    if (window.DiscordMemory) window.DiscordMemory.renderSetting();
    const auto = document.getElementById('setting-panel-autosleep');
    const keep = document.getElementById('setting-panel-keep-discord');
    if (auto) {
      auto.checked = this.panelSleepPrefs().enabled;
      auto.addEventListener('change', () => { try { localStorage.setItem('vex.panelAutoSleep', auto.checked ? '1' : '0'); } catch {} });
    }
    if (keep) {
      keep.checked = this.panelSleepPrefs().exempt.includes('discord');
      keep.addEventListener('change', () => this.setKeepAwake('discord', keep.checked));
    }
    this.renderKeepAwakeList();
    const rest = document.getElementById('setting-discord-rest');
    if (rest) {
      rest.checked = this.discordRestPrefs().enabled;
      rest.addEventListener('change', () => {
        try { localStorage.setItem('vex.discordRestHidden', rest.checked ? '1' : '0'); } catch {}
        this.checkDiscordThrottle().catch(() => {});
      });
    }
    const notice = document.getElementById('setting-memory-notice');
    if (notice) {
      notice.value = localStorage.getItem('vex.memoryNoticeMB') || '';
      notice.addEventListener('change', () => {
        this.setMemoryNoticeCeiling(notice.value);
        this._discordBannerSnoozedUntil = 0;
        this.checkDiscordMemory().catch(() => {});
      });
    }
  },

  setKeepAwake(name, on) {
    const exempt = this.panelSleepPrefs().exempt.filter(x => x !== name);
    if (on) exempt.push(name);
    try { localStorage.setItem('vex.panelSleepExempt', JSON.stringify(exempt)); } catch {}
    this.renderKeepAwakeList();
  },

  // Settings › Performance › Keep awake: one switch per web panel. The
  // tradeoff is on the label — a sleeping panel cannot notify.
  renderKeepAwakeList() {
    const host = document.getElementById('setting-panel-keepawake');
    if (!host) return;
    const exempt = this.panelSleepPrefs().exempt;
    host.innerHTML = '';
    for (const name of Object.keys(this.panelConfigs).filter(n => this.isWebPanel(n))) {
      const row = document.createElement('label');
      row.className = 'keepawake-row';
      row.style.cssText = 'display:flex;align-items:center;gap:8px;padding:4px 0;font-size:12px;cursor:pointer';
      const box = document.createElement('input');
      box.type = 'checkbox';
      box.dataset.panel = name;
      box.checked = exempt.includes(name);
      box.addEventListener('change', () => this.setKeepAwake(name, box.checked));
      const text = document.createElement('span');
      text.textContent = this.panelLabel(name);
      row.append(box, text);
      host.appendChild(row);
    }
  },

  // ---- Discord memory watch -------------------------------------------------
  // Discord runs fully awake and a long session grows (1.4 GB seen). Past the
  // ceiling (vex.discordMemoryWarnMB, 1024) it gets a notice with a Reload —
  // never automatic: a reload drops a voice call.
  _fmtMB(mb) { return mb >= 1024 ? (mb / 1024).toFixed(1) + ' GB' : mb + ' MB'; },

  // Memory notices (Discord's, and a heavy tab's — tabs.js) share one
  // ceiling, vex.memoryNoticeMB: unset means each keeps its own default,
  // 0 means off. Settings › Performance, or Don't show again on the notice.
  memoryNoticeCeiling(defaultMB) {
    const raw = localStorage.getItem('vex.memoryNoticeMB');
    if (raw === null || raw === '') return defaultMB;
    const n = Number(raw);
    return Number.isFinite(n) && n >= 0 ? n : defaultMB;
  },

  setMemoryNoticeCeiling(mb) {
    try { localStorage.setItem('vex.memoryNoticeMB', mb === null || mb === '' ? '' : String(mb)); } catch {}
    const sel = document.getElementById('setting-memory-notice');
    if (sel) sel.value = mb === null || mb === '' ? '' : String(mb);
  },

  async checkDiscordMemory() {
    const wv = this.panelWebviews.discord;
    if (!wv || typeof wv.getWebContentsId !== 'function') return null;
    if (!window.vex || typeof window.vex.tabMemory !== 'function') return null;
    let id;
    try { id = wv.getWebContentsId(); } catch { return null; }
    const mem = await window.vex.tabMemory([id]);
    const row = mem && mem.byId && mem.byId[id];
    if (!row) return null;
    const mb = Math.round(row.memKB / 1024);
    // Off (0) is a real setting; Later is four hours of quiet for the notice.
    const ceiling = this.memoryNoticeCeiling(Number(localStorage.getItem('vex.discordMemoryWarnMB')) || 1024);
    if (!ceiling) { this._discordMemBanner(0); return { mb, over: false, off: true }; }
    const over = mb >= ceiling;
    const quiet = (this._discordBannerSnoozedUntil || 0) > Date.now();
    this._discordMemBanner(over && !quiet ? mb : 0);
    if (over && !quiet && Date.now() - (this._discordWarnedAt || 0) > 30 * 60000) {
      this._discordWarnedAt = Date.now();
      window.showToast?.('Discord is using ' + this._fmtMB(mb) + ' — reload it from the notice in the Discord panel or the Memory panel', 'warn');
    }
    return { mb, over };
  },

  _discordMemBanner(mb) {
    const panel = document.getElementById('panel-discord');
    if (!panel) return;
    let b = panel.querySelector('.discord-mem-banner');
    if (!mb) { if (b) b.remove(); return; }
    if (!b) {
      b = document.createElement('div');
      b.className = 'discord-mem-banner';
      b.innerHTML = '<span></span><button class="dmb-reload">Reload Discord</button><button class="dmb-later" title="Quiet for four hours">Later</button><button class="dmb-never" title="Turn memory notices off (Settings › Performance turns them back on)">Don\'t show again</button>';
      b.querySelector('.dmb-reload').addEventListener('click', () => {
        try { this.panelWebviews.discord?.reload(); } catch {}
        document.dispatchEvent(new CustomEvent('vex:memory-event', { detail: { note: 'Discord reloaded' } }));
        b.remove();
      });
      // Later used to silence only the toast: the notice came straight back on
      // the next minute's check, over the message box. Four hours of quiet.
      b.querySelector('.dmb-later').addEventListener('click', () => {
        b.remove();
        this._discordWarnedAt = Date.now();
        this._discordBannerSnoozedUntil = Date.now() + 4 * 3600000;
      });
      b.querySelector('.dmb-never').addEventListener('click', () => {
        b.remove();
        this.setMemoryNoticeCeiling(0);
        window.showToast?.('Memory notices are off — Settings › Performance turns them back on');
      });
      panel.appendChild(b);
    }
    b.querySelector('span').textContent = 'Discord is using ' + this._fmtMB(mb) + '. Reloading frees it — a voice call would drop.';
  },

  startDiscordMemoryWatch() {
    if (this._discordMemTimer) clearInterval(this._discordMemTimer);
    this._discordMemTimer = setInterval(() => {
      this.checkDiscordMemory().catch(err => console.error('[Sidebar] Discord memory check failed:', err.message));
    }, 60000);
  },

  // ---- Microphone / camera in a panel -----------------------------------------
  panelCapture: {},

  setPanelCapturing(name, kind, active) {
    if (kind !== 'mic' && kind !== 'camera') return;
    this.panelCapture[name] = { ...(this.panelCapture[name] || {}), [kind]: !!active };
    document.dispatchEvent(new CustomEvent('vex:media-capture', { detail: { where: 'panel', id: name, kind, active: !!active } }));
    const c = this.panelCapture[name];
    const btn = document.querySelector('.sidebar-icon[data-panel="' + name + '"]');
    if (btn) {
      let b = btn.querySelector('.icon-badge.capture');
      if (!c.mic && !c.camera) { if (b) b.remove(); }
      else {
        if (!b) { b = document.createElement('span'); b.className = 'icon-badge capture'; btn.appendChild(b); }
        b.innerHTML = VexIcons.svg(c.camera ? 'camera' : 'mic', { size: 10 });
        b.title = c.camera && c.mic ? 'Using the camera and microphone' : c.camera ? 'Using the camera' : 'Using the microphone';
      }
    }
    if (name === 'discord') this.checkDiscordThrottle().catch(() => {});
  },

  isPanelCapturing(name) {
    const c = this.panelCapture[name];
    return !!(c && (c.mic || c.camera));
  },

  // Free memory now (Memory panel): every hidden web panel that may sleep,
  // idle or not. Returns the names slept.
  sleepHiddenPanels() {
    const p = this.panelSleepPrefs();
    const slept = [];
    for (const name of Object.keys(this.panelWebviews)) {
      if (name === this.activePanel || name === this.sidePanel || p.exempt.includes(name) || this.isPanelCapturing(name)) continue;
      const wv = this.panelWebviews[name];
      try { if (typeof wv.isCurrentlyAudible === 'function' && wv.isCurrentlyAudible()) continue; } catch {}
      try { this.sleepPanel(name); slept.push(name); }
      catch (err) { console.error('[Sidebar] could not sleep panel ' + name + ':', err.message); }
    }
    return slept;
  },

  // ---- Discord rests when hidden and not in a call -----------------------------
  // Discord's <webview> is created with backgroundThrottling off so a hidden
  // panel reconnects instantly; left that way it burned ~35% of a core all day
  // (3,763 s of CPU in three hours, measured). Hidden for two minutes with no
  // call — no microphone in use, not audible, no Disconnect button in its
  // page — throttling goes back on; shown again, or a call, and it is off.
  discordRestPrefs() {
    return { enabled: localStorage.getItem('vex.discordRestHidden') !== '0', afterMs: 2 * 60000 };
  },

  async _discordInCall(wv) {
    if (this.isPanelCapturing('discord')) return true;
    try { if (typeof wv.isCurrentlyAudible === 'function' && wv.isCurrentlyAudible()) return true; } catch {}
    if (typeof wv.executeJavaScript !== 'function') return false;
    try {
      return !!(await wv.executeJavaScript(`!!document.querySelector('button[aria-label="Disconnect"], [class*="rtcConnectionStatus"]')`, true));
    } catch { return false; }
  },

  async _setDiscordThrottle(on) {
    const wv = this.panelWebviews.discord;
    if (!wv || !window.vex || typeof window.vex.setBackgroundThrottling !== 'function') return false;
    if (this._discordThrottled === on) return true;
    let id;
    try { id = wv.getWebContentsId(); } catch { return false; }
    await window.vex.setBackgroundThrottling(id, on);
    this._discordThrottled = on;
    return true;
  },

  async checkDiscordThrottle(now = Date.now()) {
    const wv = this.panelWebviews.discord;
    if (!wv) return null;
    const visible = this.activePanel === 'discord' || this.sidePanel === 'discord';
    const prefs = this.discordRestPrefs();
    if (visible || !prefs.enabled) {
      await this._setDiscordThrottle(false);
      return { visible, inCall: null, throttled: false };
    }
    let usage = {};
    try { usage = JSON.parse(localStorage.getItem('vex.panelUsage') || '{}') || {}; } catch {}
    if (now - (Number(usage.discord) || 0) < prefs.afterMs) return { visible, inCall: null, throttled: !!this._discordThrottled };
    const inCall = await this._discordInCall(wv);
    await this._setDiscordThrottle(!inCall);
    return { visible, inCall, throttled: !inCall };
  },

  startDiscordRest() {
    if (this._discordRestTimer) clearInterval(this._discordRestTimer);
    this._discordRestTimer = setInterval(() => {
      this.checkDiscordThrottle().catch(err => console.error('[Sidebar] Discord rest check failed:', err.message));
    }, 30000);
    // The call, on the Discord icon: muted or live, and sharing — without
    // opening the panel. A cheap look at Discord's own buttons every 10 s.
    if (this._discordStateTimer) clearInterval(this._discordStateTimer);
    this._discordStateTimer = setInterval(() => {
      this.updateDiscordBadge().catch(err => console.warn('[Sidebar] Discord call state:', err.message));
    }, 10000);
  },

  // ---- Discord call state on its icon --------------------------------------------
  // Read by Discord's button labels (class names change every few weeks, the
  // labels do not). Muted is either "Unmute" (older) or "Mute" pressed
  // (aria-checked) (newer); the same for Deafen. Sharing: "Stop Streaming".
  DISCORD_STATE_SCRIPT: `(() => {
    const q = (s) => document.querySelector(s);
    const btn = (prefix) => q('button[aria-label^="' + prefix + '"]');
    const mute = btn('Mute') || btn('Unmute');
    const deaf = btn('Deafen') || btn('Undeafen');
    const on = (b, word) => !!b && ((b.getAttribute('aria-label') || '').startsWith('Un' + word.toLowerCase()) || b.getAttribute('aria-checked') === 'true');
    return {
      inCall: !!q('button[aria-label="Disconnect"], [class*="rtcConnectionStatus"]'),
      muted: on(mute, 'Mute'),
      deafened: on(deaf, 'Deafen'),
      sharing: !!q('button[aria-label^="Stop Streaming"], button[aria-label^="Stop Sharing"]'),
    };
  })()`,

  // → { icon, tone, title } for the badge, or null when not in a call.
  discordBadgeFor(s) {
    if (!s || !s.inCall) return null;
    const parts = [s.deafened ? 'deafened' : s.muted ? 'muted' : 'microphone live', s.sharing ? 'sharing your screen' : ''].filter(Boolean);
    return {
      icon: s.sharing ? 'monitor' : s.deafened ? 'headphones' : 'mic',
      tone: s.deafened || s.muted ? 'off' : 'live',
      title: 'In a Discord call: ' + parts.join(', '),
    };
  },

  async updateDiscordBadge() {
    const wv = window.DiscordMemory ? DiscordMemory.webview() : this.panelWebviews.discord;
    const btn = document.querySelector('.sidebar-icon[data-panel="discord"]');
    if (!btn) return null;
    let state = null;
    if (wv && typeof wv.executeJavaScript === 'function') {
      try { state = await wv.executeJavaScript(this.DISCORD_STATE_SCRIPT, true); } catch { state = null; }   // still loading
    }
    const badge = this.discordBadgeFor(state);
    let el = btn.querySelector('.icon-badge.discord-call');
    if (!badge) { if (el) el.remove(); return null; }
    if (!el) { el = document.createElement('span'); el.className = 'icon-badge discord-call'; btn.appendChild(el); }
    el.dataset.tone = badge.tone;
    el.innerHTML = VexIcons.svg(badge.icon, { size: 10 });
    el.title = badge.title;
    btn.setAttribute('aria-description', badge.title);
    return badge;
  },

  // The browser looks and Glass (css/gui-browser.css section 7) dock a panel
  // beside the page rather than covering it — gui-style.js stamps
  // body[data-sb-side] for every style that has a sidebar. Settings is a whole
  // page of its own, so it still takes the full area.
  _docksBesidePage(panelName) {
    return !!document.body.dataset.sbSide && panelName !== 'settings';
  },

  // body[data-sidebar-panel] drives the docked layout's open state; the event
  // lets js/look-sidebar.js keep its header and toolbar button in step.
  _announcePanel(panelName) {
    if (panelName) document.body.dataset.sidebarPanel = panelName;
    else document.body.removeAttribute('data-sidebar-panel');
    document.dispatchEvent(new CustomEvent('vex:panel-changed', { detail: { panel: panelName, beside: this.sidePanel } }));
  },

  hideActivePanel() {
    if (!this.activePanel) return;

    // Leaving them starts their sleep clock.
    this._touchUsage(this.activePanel);
    this._touchUsage(this.sidePanel);
    this.activePanel = null;
    // The second panel closes with the first; the pair stays remembered.
    this.sidePanel = null;
    // Hides every panel and clears the icons.
    this._layoutPanels();
    document.getElementById('panels-container').style.pointerEvents = 'none';

    // Show webviews
    document.getElementById('webviews-container').style.display = 'block';

    // Show active tab webview
    if (TabManager.activeTabId) {
      WebviewManager.showWebview(TabManager.activeTabId);
    }
    this._announcePanel(null);
  },

  openPanel(name) {
    this.showPanel(name);
  },

  // ---- One-time declutter nudge ----
  // Two weeks after install, if several app panels have never been opened,
  // offer (once, dismissible) to hide them. Complements the wizard's setup
  // profiles: someone who kept everything "just in case" gets one gentle
  // chance to trim without hunting through Settings.
  DECLUTTER_AFTER_MS: 14 * 24 * 60 * 60 * 1000,

  // The visible app panels not opened within the window (or ever). Pure
  // (time injected) so tests can pin the clock.
  _declutterCandidates(now) {
    const APP = (window.Onboarding && typeof Onboarding._APP_PANELS === 'function') ? Onboarding._APP_PANELS() : [];
    let usage = {}, ov = {};
    try { usage = JSON.parse(localStorage.getItem('vex.panelUsage') || '{}') || {}; } catch {}
    try { ov = JSON.parse(localStorage.getItem('vex.panelOverrides') || '{}') || {}; } catch {}
    return APP.filter(p =>
      !(ov[p.id] && ov[p.id].hidden) &&
      (!usage[p.id] || now - usage[p.id] >= this.DECLUTTER_AFTER_MS));
  },

  async maybeOfferDeclutter(opts) {
    const now = (opts && opts.now) || Date.now();
    try {
      if (localStorage.getItem('vex.declutterDone') === 'true') return false;
      // Never on top of (or before) onboarding — retry on a later boot instead.
      if (document.getElementById('vex-onboarding')) return false;
      if (window.Onboarding && typeof Onboarding.done === 'function' && !Onboarding.done()) return false;
      let installedAt = parseInt(localStorage.getItem('vex.installedAt'), 10);
      if (!Number.isFinite(installedAt) || installedAt <= 0) {
        localStorage.setItem('vex.installedAt', String(now));
        return false;
      }
      if (!(opts && opts.force) && now - installedAt < this.DECLUTTER_AFTER_MS) return false;
      const cand = this._declutterCandidates(now);
      // One-time either way: an active user with ≤1 idle panel shouldn't be
      // re-evaluated forever.
      localStorage.setItem('vex.declutterDone', 'true');
      if (cand.length < 2) return false;
      const names = cand.map(p => p.name).join(', ');
      const ok = await window.vexConfirm({
        title: 'Tidy up your sidebar?',
        message: `You haven’t used these panels: ${names}. Hide them? (Everything stays one click away in Settings → Sidebar.)`,
        okLabel: `Hide ${cand.length} panels`,
        cancelLabel: 'Keep everything',
      });
      if (ok) {
        let ov = {};
        try { ov = JSON.parse(localStorage.getItem('vex.panelOverrides') || '{}') || {}; } catch {}
        for (const p of cand) ov[p.id] = Object.assign({}, ov[p.id], { hidden: true });
        try { localStorage.setItem('vex.panelOverrides', JSON.stringify(ov)); } catch {}
        this.applyPanelOverrides();
        window.showToast?.(`Hidden ${cand.length} panels — restore any of them in Settings → Sidebar`);
      }
      return ok;
    } catch { return false; }
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

  // Niche feature panels hidden from the rail by default — they stay fully
  // available in Settings → Sidebar (Show) and the command bar (Ctrl+K). The
  // browser core (start/history/downloads/settings), the app panels
  // (WhatsApp/Claude/Spotify/Netflix/Discord/Roblox) and Notes/Authenticator
  // stay visible. Bookmarks is default-off too (still one click away to re-show).
  DEFAULT_HIDDEN_PANELS: ['queue', 'memory', 'schedules', 'library', 'feeds', 'annotations', 'recall', 'bookmarks'],

  // Applied once per install (guarded by vex.sidebarLeanV1). Merges hidden:true
  // onto each default-hidden panel; a later Show in Settings sticks because this
  // never runs again. Idempotent and safe if the flag is pre-set (e.g. applied
  // live to an already-running instance).
  _applyLeanDefault() {
    try {
      if (localStorage.getItem('vex.sidebarLeanV1')) return;
      const ov = loadPanelOverrides();
      for (const p of this.DEFAULT_HIDDEN_PANELS) ov[p] = Object.assign({}, ov[p], { hidden: true });
      savePanelOverrides(ov);
      localStorage.setItem('vex.sidebarLeanV1', '1');
    } catch {}
  },

  // Bookmarks became default-off AFTER the lean default shipped, so existing
  // installs (which already set vex.sidebarLeanV1) won't get it from
  // _applyLeanDefault. This one-time migration hides Bookmarks for them too —
  // once, and only if they haven't explicitly chosen to Show it — so it stays
  // optional (re-show in Settings → Sidebar and it sticks).
  _hideBookmarksOnce() {
    try {
      if (localStorage.getItem('vex.sidebarBookmarksHiddenV1')) return;
      const ov = loadPanelOverrides();
      if (!ov.bookmarks || ov.bookmarks.hidden !== false) {
        ov.bookmarks = Object.assign({}, ov.bookmarks, { hidden: true });
        savePanelOverrides(ov);
      }
      localStorage.setItem('vex.sidebarBookmarksHiddenV1', '1');
    } catch {}
  },

  applyPanelOverrides() {
    const ov = loadPanelOverrides();
    // Iterate EVERY sidebar button, not just the ones with an override — a
    // panel whose override was removed (e.g. un-hidden by switching setup
    // profile from Minimal back to Full) must have its display reset, or it
    // stays stuck at display:none. Applying URL overrides still only needs the
    // override map, so that stays keyed off ov.
    Object.keys(ov).forEach(panel => {
      const o = ov[panel] || {};
      if (o.url && this.panelConfigs[panel]) this.panelConfigs[panel].url = o.url;
    });
    document.querySelectorAll('.sidebar-icon[data-panel]').forEach(btn => {
      const panel = btn.dataset.panel;
      const o = ov[panel] || {};
      btn.style.display = o.hidden ? 'none' : '';
      if (o.name) btn.title = o.name;
      if (o.icon && SIDEBAR_ICONS[o.icon]) btn.innerHTML = SIDEBAR_ICONS[o.icon];
    });
  },

  setPanelOverride(panel, patch) {
    const ov = loadPanelOverrides();
    ov[panel] = Object.assign({}, ov[panel], patch);
    savePanelOverrides(ov);
    this.applyPanelOverrides();
    // If we just hid the button for the panel that's currently open, close the
    // panel too — otherwise its content stays on screen and "Hide" looks broken.
    if (patch.hidden && this.activePanel === panel) this.hideActivePanel();
    else if (patch.hidden && this.sidePanel === panel) this.closeBeside();
    if (patch.url) {
      navigatePanelWebview(resolvePanelWebview(this, panel), patch.url);
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
    if (this._origUrls[panel]) {
      navigatePanelWebview(resolvePanelWebview(this, panel), this._origUrls[panel]);
    }
    this.applySidebarOrder();
    this.renderSidebarManager();
    window.showToast?.('Reset to default');
  },

  _esc(s) { return window.escapeHtml(s); },

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
    const hint = document.createElement('p');
    hint.className = 'sidebar-manager-hint';
    hint.style.cssText = 'margin:0 0 8px;font-size:12px;line-height:1.5;color:var(--text-muted)';
    hint.textContent = 'Two at once: Shift+click a button (or right-click it → Open beside) to open that panel beside the one already open. In the Chrome, Safari and IE looks use the + in the panel header. Drag the divider to resize; double-click it to swap sides.';
    host.appendChild(hint);
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
        (isUrl ? '<button data-act="link" title="Change link" style="' + btnCss + '">' + VexIcons.svg('link', { size: 13 }) + '</button>' : '') +
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
    if (window.Tabs?._clampMenuToViewport) TabManager._clampMenuToViewport(pop, e.clientX, e.clientY);
    if (window.Tabs?._attachMenuDismissal) TabManager._attachMenuDismissal(pop);
  },

  // Right-click context menu for ANY sidebar button. The item set adapts to the
  // button type (see _isUrlPanel): URL-backed buttons get the full menu;
  // internal feature panels get Rename / Change icon / Hide / Reset; pinned
  // sites get Unpin instead of Hide. Reuses TabManager's .tab-context-menu
  // styling + dismissal helpers so behavior matches the tab menu.
  // ---- Discord "looks blocked" prompt (auto-offer the bypass) ----
  _hideDiscordBlockedPrompt() {
    if (this._discordPromptEl) { try { this._discordPromptEl.remove(); } catch {} this._discordPromptEl = null; }
  },

  _showDiscordBlockedPrompt(wv, panelEl) {
    if (this._discordPromptDismissed || !panelEl) return;
    this._hideDiscordBlockedPrompt();
    this._injectDiscordPromptStyles();
    const ov = document.createElement('div');
    ov.className = 'discord-blocked-ov';
    ov.innerHTML = `<div class="dbo-card">
        <div class="dbo-ico">${VexIcons.svg('shield', { size: 26 })}</div>
        <div class="dbo-title">Discord looks blocked</div>
        <div class="dbo-msg">Turn on the bypass to try to get through.</div>
        <div class="dbo-row">
          <button class="dbo-btn primary" data-act="on">Enable bypass</button>
          <button class="dbo-btn ghost" data-act="dismiss">Not now</button>
        </div>
      </div>`;
    try { panelEl.style.position = 'relative'; } catch {}
    panelEl.appendChild(ov);
    this._discordPromptEl = ov;
    ov.querySelectorAll('[data-act]').forEach(b => b.addEventListener('click', () => this._discordPromptAction(b.dataset.act, wv)));
  },

  _discordPromptAction(act) {
    if (act === 'on') { this._enableBypassAuto(); return; }
    this._discordPromptDismissed = true; this._hideDiscordBlockedPrompt();
  },

  // Auto-configure: run the main-side sweep (built-in + every ByeDPI desync mode,
  // each rigorously tested) with a live progress card, keeping the first that works.
  async _enableBypassAuto() {
    try { this.showPanel('discord'); } catch {}   // ensure the panel (and its progress card) is visible
    const wv = this.panelWebviews['discord'];
    try { localStorage.setItem('vex.discordBypassMode', 'auto'); } catch {}
    this._showDiscordProgress('Setting up bypass…', 'Trying connection methods…');
    try {
      const r = await window.vex?.setDiscordBypassMode?.('auto', {});
      if (r && r.ok) { this._hideDiscordBlockedPrompt(); if (wv) { try { wv.reload(); } catch {} } else this.showPanel('discord'); }
      else this._showDiscordFailCard();
    } catch { this._showDiscordFailCard(); }
  },

  _showDiscordProgress(title, sub) {
    const panelEl = document.getElementById('panel-discord');
    if (!panelEl) return;
    this._injectDiscordPromptStyles();
    this._hideDiscordBlockedPrompt();
    const ov = document.createElement('div');
    ov.className = 'discord-blocked-ov';
    ov.innerHTML = `<div class="dbo-card"><div class="dbo-spin"></div><div class="dbo-title">${this._esc(title)}</div><div class="dbo-msg dbo-progress">${this._esc(sub || '')}</div></div>`;
    try { panelEl.style.position = 'relative'; } catch {}
    panelEl.appendChild(ov);
    this._discordPromptEl = ov;
  },

  _updateDiscordProgress(text) {
    if (this._discordPromptEl) { const el = this._discordPromptEl.querySelector('.dbo-progress'); if (el) el.textContent = text; }
  },

  _showDiscordFailCard() {
    const panelEl = document.getElementById('panel-discord');
    if (!panelEl) return;
    this._hideDiscordBlockedPrompt();
    this._injectDiscordPromptStyles();
    const ov = document.createElement('div');
    ov.className = 'discord-blocked-ov';
    ov.innerHTML = `<div class="dbo-card">
        <div class="dbo-ico">${VexIcons.svg('warning', { size: 26 })}</div>
        <div class="dbo-title">Couldn't get through</div>
        <div class="dbo-msg">None of the built-in methods beat your network. For tough ISPs, run <b>Zapret</b> and turn bypass off — Discord works through it.</div>
        <div class="dbo-row">
          <button class="dbo-btn primary" data-act="retry">Try again</button>
          <button class="dbo-btn" data-act="off">Turn off (use Zapret)</button>
          <button class="dbo-btn ghost" data-act="dismiss">Dismiss</button>
        </div>
      </div>`;
    try { panelEl.style.position = 'relative'; } catch {}
    panelEl.appendChild(ov);
    this._discordPromptEl = ov;
    ov.querySelectorAll('[data-act]').forEach(b => b.addEventListener('click', () => {
      const a = b.dataset.act;
      if (a === 'retry') this._enableBypassAuto();
      else if (a === 'off') { try { localStorage.setItem('vex.discordBypassMode', 'off'); } catch {} try { window.vex?.setDiscordBypassMode?.('off', {}); } catch {} this._hideDiscordBlockedPrompt(); window.showToast?.('Bypass off — start Zapret, then reload Discord'); }
      else { this._discordPromptDismissed = true; this._hideDiscordBlockedPrompt(); }
    }));
  },

  _injectDiscordPromptStyles() {
    if (document.getElementById('discord-blocked-styles')) return;
    const st = document.createElement('style');
    st.id = 'discord-blocked-styles';
    st.textContent = `
      .discord-blocked-ov{position:absolute;inset:0;z-index:30;display:flex;align-items:center;justify-content:center;background:rgba(10,12,16,0.82);backdrop-filter:blur(3px);}
      .dbo-card{width:360px;max-width:88%;padding:22px;border-radius:16px;text-align:center;background:var(--surface,#1b1b24);border:1px solid var(--border,rgba(255,255,255,0.1));box-shadow:0 20px 60px rgba(0,0,0,0.55);font-family:inherit;}
      .dbo-ico{margin-bottom:8px;line-height:0;color:var(--text);}
      .dbo-spin{width:30px;height:30px;margin:0 auto 12px;border:3px solid var(--border,rgba(255,255,255,0.18));border-top-color:var(--primary,#6366f1);border-radius:50%;animation:dboSpin .8s linear infinite;}
      @keyframes dboSpin{to{transform:rotate(360deg)}}
      .dbo-title{font-size:16px;font-weight:700;color:var(--text,#e9e9ee);margin-bottom:8px;}
      .dbo-msg{font-size:12.5px;line-height:1.5;color:var(--text-muted,#9a9aa5);margin-bottom:16px;}
      .dbo-row{display:flex;gap:8px;justify-content:center;flex-wrap:wrap;}
      .dbo-btn{border:1px solid var(--border,rgba(255,255,255,0.14));background:transparent;color:var(--text,#e9e9ee);border-radius:9px;padding:8px 13px;font-size:12.5px;font-family:inherit;cursor:pointer;}
      .dbo-btn:hover{background:color-mix(in srgb,var(--primary,#6366f1) 16%,transparent);}
      .dbo-btn.primary{background:var(--primary,#6366f1);border-color:transparent;color:#fff;font-weight:600;}
      .dbo-btn.ghost{border-color:transparent;color:var(--text-muted,#9a9aa5);}
    `;
    document.head.appendChild(st);
  },

  // Slim back/forward/reload bar for the Discord panel (web Discord has no
  // history buttons, and the panel isn't a tab so the main toolbar can't drive
  // it). Themed via --vex-* tokens so it matches Classic and Glass.
  _injectPanelNavStyles() {
    if (document.getElementById('panel-nav-styles')) return;
    const st = document.createElement('style');
    st.id = 'panel-nav-styles';
    // The bar is a strip of its own above the page. It used to float over the
    // page's top-left corner, where sites keep their own buttons — it sat on
    // Claude's sidebar toggle and hid Roblox's logo menu.
    st.textContent = `
      .panel-navbar { position:absolute; top:0; left:0; right:0; z-index:30; height:34px; box-sizing:border-box;
        display:flex; align-items:center; gap:4px; padding:0 7px;
        background:var(--vex-glass-strong, #1b1b24); border-bottom:1px solid var(--vex-border-subtle, rgba(255,255,255,0.12)); }
      .panel:has(> .panel-navbar) > webview { position:absolute; top:34px; left:0; right:0; bottom:0;
        width:100% !important; height:auto !important; }
      .panel-navbar .pnav-btn { width:26px; height:24px; border-radius:7px;
        border:1px solid var(--vex-border-subtle, rgba(255,255,255,0.16));
        background:transparent; color:var(--vex-text-primary, #e9e9ee); cursor:pointer; font-size:15px; line-height:1;
        display:grid; place-items:center; padding:0; }
      .panel-navbar .pnav-btn:hover:not(:disabled) { background:var(--vex-accent, #6366f1); color:#fff; }
      .panel-navbar .pnav-btn:disabled { opacity:0.3; cursor:default; }
    `;
    document.head.appendChild(st);
  },

  _addPanelNav(panelEl, wv, panelName) {
    // Look it up by panel name: in the browser looks js/look-sidebar.js moves
    // the bar into the sidebar header, out of the panel.
    if (!panelEl || !wv || document.querySelector(`.panel-navbar[data-panel="${panelName}"]`)) return;
    this._injectPanelNavStyles();
    // The panel anchors the bar (top) and the webview (below it); the panel's
    // display is toggled inline by showPanel, so neither is sized by flow.
    try { panelEl.style.position = 'relative'; } catch {}
    const nav = document.createElement('div');
    nav.className = 'panel-navbar';
    nav.dataset.panel = panelName;
    nav.innerHTML = '<button class="pnav-btn pnav-back" title="Back">‹</button>'
      + '<button class="pnav-btn pnav-fwd" title="Forward">›</button>'
      + '<button class="pnav-btn pnav-reload" title="Reload">⟳</button>';
    const back = nav.querySelector('.pnav-back');
    const fwd = nav.querySelector('.pnav-fwd');
    const reload = nav.querySelector('.pnav-reload');
    // Always drive the LIVE <webview> in the panel — the captured `wv` can go
    // stale after a service switch / re-mount, and back/reload on a detached
    // node silently does nothing (the "back & refresh don't work" this fixes).
    const liveWv = () => { try { return panelEl.querySelector('webview') || wv; } catch { return wv; } };
    back.addEventListener('click', () => { const w = liveWv(); try { if (w && w.canGoBack()) w.goBack(); } catch {} });
    fwd.addEventListener('click', () => { const w = liveWv(); try { if (w && w.canGoForward()) w.goForward(); } catch {} });
    reload.addEventListener('click', () => { const w = liveWv(); try { if (w) w.reload(); } catch {} });
    const upd = () => { const w = liveWv(); try { if (w) { back.disabled = !w.canGoBack(); fwd.disabled = !w.canGoForward(); } } catch {} };
    wv.addEventListener('did-navigate', upd);
    wv.addEventListener('did-navigate-in-page', upd);
    wv.addEventListener('dom-ready', upd);
    panelEl.insertBefore(nav, panelEl.firstChild);
    upd();
  },

  showContextMenu(e, panelName) {
    document.querySelectorAll('.tab-context-menu, .tab-group-context-menu, .context-menu-overlay').forEach(m => m.remove());

    const menu = document.createElement('div');
    menu.className = 'tab-context-menu';
    const x = e.clientX, y = e.clientY;
    menu.style.left = x + 'px';
    menu.style.top  = y + 'px';

    const isUrl = this._isUrlPanel(panelName);
    const isSite = panelName.startsWith('site_');

    const items = [];
    // Two panels at once (Claude beside Discord): offered while another panel
    // is open; the panel already sitting beside it is offered its way out.
    if (panelName === this.sidePanel) {
      items.push({ label: 'Close beside ' + this.panelLabel(this.activePanel), action: () => this.closeBeside() });
      items.push({ label: 'Swap sides', action: () => this.swapBeside() });
      items.push({ separator: true });
    } else if (panelName === this.activePanel && this.sidePanel) {
      items.push({ label: 'Swap sides', action: () => this.swapBeside() });
      items.push({ separator: true });
    } else if (this.activePanel && this.activePanel !== panelName && this._canSit(panelName) && this._canSit(this.activePanel)) {
      items.push({ label: 'Open beside ' + this.panelLabel(this.activePanel), action: () => this.openBeside(panelName) });
      items.push({ separator: true });
    }
    items.push(
      { label: 'Rename…', action: () => this.renamePanel(panelName) },
      { label: 'Change icon…', action: () => this.showIconPicker(e, panelName) },
    );
    // Change link + service switch + refresh/devtools only make sense for
    // buttons that actually load a web page.
    if (isUrl) {
      items.push({ label: 'Change link…', action: () => this.changePanelLink(panelName) });
      items.push({ separator: true });
      if (panelName === 'netflix') {
        // Streaming switcher: Netflix Prime Video Disney+ (shared persist:netflix jar).
        items.push({ label: 'Switch to Netflix', action: () => this.switchPanelService(panelName, 'netflix') });
        items.push({ label: 'Switch to Prime Video', action: () => this.switchPanelService(panelName, 'prime') });
        items.push({ label: 'Switch to Disney+', action: () => this.switchPanelService(panelName, 'disney') });
        items.push({ label: 'Switch to Roku Channel', action: () => this.switchPanelService(panelName, 'roku') });
      } else if (panelName === 'discord') {
        // One-click Vencord (plugins/themes) install into the Discord panel.
        items.push({
          label: 'Install / Update Vencord',
          action: async () => {
            window.showToast?.('Downloading Vencord…');
            try {
              const r = await window.vex?.installVencord?.();
              if (r && r.ok) {
                window.showToast?.(`Vencord ${r.version || ''} installed — reloading Discord`);
                const wv = this.panelWebviews['discord'];
                if (wv) { try { wv.reload(); } catch {} } else { this.showPanel('discord'); }
              } else {
                window.showToast?.('Vencord install failed: ' + ((r && r.error) || 'unknown'), 'error');
              }
            } catch (e) { window.showToast?.('Vencord install failed', 'error'); }
          }
        });
        // Install YOUR local Vencord build (custom userplugins that aren't in the
        // official devbuild). Point Vex at the extension-chrome.zip from `pnpm buildWeb`.
        items.push({
          label: 'Install my Vencord build (custom plugins)',
          action: async () => {
            window.showToast?.('Installing your Vencord build…');
            try {
              const r = await window.vex?.installVencordLocal?.();
              if (r && r.ok) {
                // Fully RECREATE the Discord panel webview (don't just reload it):
                // a reloaded webContents can keep running the previously-loaded
                // Vencord build, so an updated plugin wouldn't show up. A brand-new
                // webview binds the freshly-installed extension. Then switch to it
                // so the result is unmissable, and say where the feature lives.
                try {
                  const old = this.panelWebviews['discord'];
                  if (old) { try { old.remove(); } catch {} }
                  delete this.panelWebviews['discord'];
                  const panelEl = document.getElementById('panel-discord');
                  // By panel name: in the browser looks the bar sits in the sidebar header.
                  if (panelEl) { try { document.querySelectorAll('.panel-navbar[data-panel="discord"]').forEach(n => n.remove()); } catch {} }
                  if (this.activePanel === 'discord') this.activePanel = null;
                } catch {}
                this.showPanel('discord');
                window.showToast?.(`Vencord ${r.version || ''} installed. In Discord, right-click a server → “Bulk Export Servers”.`, 'success');
              } else {
                const why = (r && r.error) || 'unknown';
                window.showToast?.('Vencord install failed: ' + why, 'error');
                if (typeof vexAlert === 'function') {
                  vexAlert({ title: 'Couldn’t install your Vencord build', message: why + '\n\nBuild it first:\n  cd vencord-dev && pnpm buildWeb\n\nThat writes dist/extension-chrome.zip, which Vex looks for.' });
                }
              }
            } catch (e) { window.showToast?.('Vencord install failed: ' + (e && e.message || 'error'), 'error'); }
          }
        });
        items.push({ separator: true });
        // Block bypass: a single "auto-configure" action that sweeps every method
        // and an off switch (for people running Zapret).
        const bypassOn = ((localStorage.getItem('vex.discordBypassMode') || 'light') !== 'off');
        items.push({ label: 'Auto-configure bypass', action: () => this._enableBypassAuto() });
        if (bypassOn) {
          items.push({
            label: 'Turn bypass off (use Zapret)',
            action: async () => {
              try { localStorage.setItem('vex.discordBypassMode', 'off'); } catch {}
              try { await window.vex?.setDiscordBypassMode?.('off', {}); } catch {}
              const wv = this.panelWebviews['discord']; if (wv) { try { wv.reload(); } catch {} }
              window.showToast?.('Bypass off');
            }
          });
        }
      } else if (panelName === 'roblox') {
        // Roblox is blocked by the same ISP/DPI as Discord — share the bypass.
        const robloxOn = (localStorage.getItem('vex.robloxBypass') === 'on');
        items.push({
          label: robloxOn ? 'Block bypass: On' : 'Block bypass: Off',
          action: async () => {
            const on = !robloxOn;
            try { localStorage.setItem('vex.robloxBypass', on ? 'on' : 'off'); } catch {}
            window.showToast?.(on ? 'Turning on Roblox bypass…' : 'Roblox bypass off');
            try {
              const r = await window.vex?.setRobloxBypass?.(on);
              const wv = this.panelWebviews['roblox'];
              if (r && r.ok) { if (wv) { try { wv.reload(); } catch {} } }
              else window.showToast?.("Couldn't bypass — try Zapret", 'error');
            } catch { window.showToast?.('Bypass failed', 'error'); }
          }
        });
      } else {
        items.push({ label: 'Switch to Claude', action: () => this.switchPanelService(panelName, 'claude') });
        items.push({ label: 'Switch to Gemini', action: () => this.switchPanelService(panelName, 'gemini') });
        items.push({ label: 'Switch to ChatGPT', action: () => this.switchPanelService(panelName, 'chatgpt') });
      }
      items.push({ separator: true });
      items.push({ label: 'Refresh', action: makeRefreshAction(this, panelName) });
      // A loaded, hidden web panel can give its process back.
      if (this.panelWebviews[panelName] && panelName !== this.activePanel && panelName !== this.sidePanel) {
        items.push({
          label: 'Sleep panel (frees its memory)',
          action: () => {
            try { this.sleepPanel(panelName); window.showToast?.(this.panelLabel(panelName) + ' is asleep'); }
            catch (err) { window.showToast?.(err.message, 'error'); }
          }
        });
      }
      items.push({
        label: 'Open DevTools',
        action: () => {
          const wv = this.panelWebviews[panelName];
          if (!wv) { this.showPanel(panelName); return; }
          const id  = typeof wv.getWebContentsId === 'function' ? wv.getWebContentsId() : null;
          const url = typeof wv.getURL === 'function' ? wv.getURL() : null;
          if (window.vexDevTools?.openForWebContents) {
            // A failure here used to go only to the console — to the person it
            // looked like the button did nothing. Say what happened.
            window.vexDevTools.openForWebContents(id, url).then(r => {
              if (!r?.ok) window.showToast?.('Could not open DevTools for ' + panelName + ': ' + ((r && r.error) || 'unknown error'), 'error');
            }).catch(err => window.showToast?.('Could not open DevTools for ' + panelName + ': ' + ((err && err.message) || 'IPC failed'), 'error'));
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
        if (window.Tabs?._dismissMenu) TabManager._dismissMenu(menu); else menu.remove();
      });
      menu.appendChild(el);
    });

    document.body.appendChild(menu);

    // Reuse TabManager's clamp + dismissal so behavior matches the tab menu.
    if (window.Tabs?._clampMenuToViewport) {
      TabManager._clampMenuToViewport(menu, x, y);
    }
    if (window.Tabs?._attachMenuDismissal) {
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
  module.exports = { makeRefreshAction, resolvePanelWebview, navigatePanelWebview, resolveDevToolsTarget, SidebarManager };
}

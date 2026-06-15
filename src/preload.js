const { contextBridge, ipcRenderer } = require('electron');

// === open-url buffering (cold-start link race fix) ===
// On a COLD start (Vex not already running) the main process sends the clicked
// link via the 'open-url' IPC at the window's did-finish-load. But the renderer
// only registers its handler late in its async init (after PersistentStorage /
// ThemeManager / TabManager.init …), so that first message arrived before any
// listener existed and was dropped — Vex opened to the start page instead of
// the link. Fix: subscribe HERE at preload-eval time (which runs before the
// page's scripts) and buffer URLs until the renderer attaches its callback.
//
// This mirrors createOpenUrlBuffer() in main-helpers.js (the tested spec) —
// preload is sandboxed and can't require() it, so keep the two in sync.
let _openUrlCb = null;
const _openUrlBuffer = [];
ipcRenderer.on('open-url', (_, url) => {
  console.log('[Vex URL] preload: received open-url IPC ->', url);
  if (_openUrlCb) {
    try { _openUrlCb(url); } catch (err) { console.error('[Vex URL] preload: onOpenUrl cb threw:', err && err.stack || err); }
  } else {
    console.log('[Vex URL] preload: no handler yet — buffering URL');
    _openUrlBuffer.push(url);
  }
});

contextBridge.exposeInMainWorld('vex', {
  // Window controls
  minimize: () => ipcRenderer.send('window-minimize'),
  maximize: () => ipcRenderer.send('window-maximize'),
  close: () => ipcRenderer.send('window-close'),

  // Storage
  saveData: (key, data) => ipcRenderer.invoke('storage-save', key, data),
  loadData: (key) => ipcRenderer.invoke('storage-load', key),

  // Smart Searchbar — Google Suggest web predictions, proxied through main to
  // dodge CORS (Google Suggest sends no Access-Control-Allow-Origin). Returns
  // string[] (fail-silent: [] on any error).
  webSuggest: (query) => ipcRenderer.invoke('web-suggest', query),

  // Tab management
  getStartPagePath: () => ipcRenderer.invoke('get-start-page-path'),
  getStartPageUrl: () => ipcRenderer.invoke('get-start-page-url'),

  // Ad blocker
  getAdBlockerState: () => ipcRenderer.invoke('adblocker-get-state'),
  setAdBlockerState: (enabled) => ipcRenderer.invoke('adblocker-set-state', enabled),

  // Events from main
  onCommandBar: (callback) => ipcRenderer.on('toggle-command-bar', callback),
  onZoomIn: (callback) => ipcRenderer.on('zoom-in', callback),
  onZoomOut: (callback) => ipcRenderer.on('zoom-out', callback),
  onZoomReset: (callback) => ipcRenderer.on('zoom-reset', callback),
  onFindInPage: (callback) => ipcRenderer.on('find-in-page', callback),
  onNewTab: (callback) => ipcRenderer.on('new-tab', callback),
  onCloseTab: (callback) => ipcRenderer.on('close-tab', callback),
  onReloadTab: (callback) => ipcRenderer.on('reload-tab', callback),
  onHardReloadTab: (callback) => ipcRenderer.on('hard-reload-tab', callback),
  hardReloadWebview: (webContentsId) => ipcRenderer.invoke('webview:hard-reload', webContentsId),
  onNavigateBack: (callback) => ipcRenderer.on('navigate-back', callback),
  onNavigateForward: (callback) => ipcRenderer.on('navigate-forward', callback),

  // Split & PiP
  onToggleSplit: (callback) => ipcRenderer.on('toggle-split', callback),
  onTogglePip: (callback) => ipcRenderer.on('toggle-pip', callback),
  openPipWindow: (url) => ipcRenderer.invoke('open-pip-window', url),

  // Downloads (with progress tracking)
  onTabCreateFromExternal: (cb) => ipcRenderer.on('tab:create-from-external', (_e, d) => cb(d)),

  // Peek overlay (shift+click a link → floating preview)
  onPeekOpen: (cb) => ipcRenderer.on('peek:open', (_e, d) => cb(d)),

  // RSS feeds (fetched in main to dodge CORS)
  rssFetch: (url) => ipcRenderer.invoke('rss:fetch', url),

  // QR code + resource metrics
  qrMake: (text) => ipcRenderer.invoke('qr:make', text),
  appMetrics: () => ipcRenderer.invoke('app:metrics'),

  // Full-text recall (memex) + translate (both run in main)
  recallIndex: (entry) => ipcRenderer.invoke('recall:index', entry),
  recallSearch: (q) => ipcRenderer.invoke('recall:search', q),
  recallClear: () => ipcRenderer.invoke('recall:clear'),
  translateText: (text, tl) => ipcRenderer.invoke('translate:text', { text, tl }),

  // Privacy hardening (fingerprint farbling, DoH, tracker tally) — all in main
  privacyGetConfig: () => ipcRenderer.invoke('privacy:get-config'),
  privacySetConfig: (cfg) => ipcRenderer.invoke('privacy:set-config', cfg),
  privacyTrackerStats: () => ipcRenderer.invoke('privacy:tracker-stats'),
  privacyTrackerReset: () => ipcRenderer.invoke('privacy:tracker-reset'),

  // Generic HTTP request (API client + page-change monitor), runs in main
  apiRequest: (opts) => ipcRenderer.invoke('api:request', opts),

  // Password vault (safeStorage-encrypted in main)
  vaultList: () => ipcRenderer.invoke('vault:list'),
  vaultGet: (host) => ipcRenderer.invoke('vault:get', host),
  vaultSave: (entry) => ipcRenderer.invoke('vault:save', entry),
  vaultDelete: (q) => ipcRenderer.invoke('vault:delete', q),

  // Permission prompts (geolocation, mic, camera, notifications, ...)
  onPermissionRequest:  (cb) => ipcRenderer.on('permission:request', (_e, d) => cb(d)),
  permissionsRendererReady: () => ipcRenderer.send('permissions:renderer-ready'),
  permissionRespond:    (payload) => ipcRenderer.invoke('permission:respond', payload),
  permissionsList:      () => ipcRenderer.invoke('permissions:list'),
  permissionsRevoke:    (key) => ipcRenderer.invoke('permissions:revoke', key),
  permissionsClearAll:  () => ipcRenderer.invoke('permissions:clear-all'),

  onDownloadStarted:  (cb) => ipcRenderer.on('download-started',  (_e, d) => cb(d)),
  onDownloadProgress: (cb) => ipcRenderer.on('download-progress', (_e, d) => cb(d)),
  onDownloadComplete: (cb) => ipcRenderer.on('download-complete', (_e, d) => cb(d)),
  downloadsOpenFile:     (p) => ipcRenderer.invoke('downloads:open-file', p),
  downloadsShowInFolder: (p) => ipcRenderer.invoke('downloads:show-in-folder', p),
  downloadsOpenFolder:   ()  => ipcRenderer.invoke('downloads:open-folder'),

  // Notes & Sessions shortcuts
  onToggleNotes: (callback) => ipcRenderer.on('toggle-notes', callback),
  onToggleSessions: (callback) => ipcRenderer.on('toggle-sessions', callback),

  // Phase 4: History, Memory, Sleep, Restore
  onReopenLastClosed: (callback) => ipcRenderer.on('reopen-last-closed', callback),
  onToggleHistory: (callback) => ipcRenderer.on('toggle-history', callback),
  onToggleHistoryAi: (callback) => ipcRenderer.on('toggle-history-ai', callback),
  onToggleMemory: (callback) => ipcRenderer.on('toggle-memory', callback),
  onSleepCurrentTab: (callback) => ipcRenderer.on('sleep-current-tab', callback),
  onSaveSessionBeforeQuit: (callback) => ipcRenderer.on('save-session-before-quit', callback),

  // Phase 5
  onToggleReadingMode: (callback) => ipcRenderer.on('toggle-reading-mode', callback),
  onTakeScreenshot: (callback) => ipcRenderer.on('take-screenshot', callback),

  // Phase 6: fullscreen, private, mute
  toggleFullscreen: () => ipcRenderer.invoke('toggle-fullscreen'),
  isFullscreen: () => ipcRenderer.invoke('is-fullscreen'),
  onFullscreenChanged: (callback) => ipcRenderer.on('fullscreen-changed', (_, state) => callback(state)),
  openPrivateWindow: () => ipcRenderer.invoke('open-private-window'),
  onToggleMuteTab: (callback) => ipcRenderer.on('toggle-mute-tab', callback),

  // Tabs sidebar toggle
  onToggleTabsSidebar: (callback) => ipcRenderer.on('toggle-tabs-sidebar', callback),

  // Phase 8: Schedules
  onToggleSchedules: (callback) => ipcRenderer.on('toggle-schedules', callback),

  // Phase 7A: AI
  onToggleAiPanel: (callback) => ipcRenderer.on('toggle-ai-panel', callback),

  // Phase 9: Updates
  checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),
  widevineStatus: () => ipcRenderer.invoke('widevine:status'),
  widevineRetry: () => ipcRenderer.invoke('widevine:retry'),
  downloadUpdate: () => ipcRenderer.invoke('download-update'),
  installUpdate: () => ipcRenderer.invoke('install-update'),
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  onUpdateAvailable: (cb) => ipcRenderer.on('update-available', (_, i) => cb(i)),
  onUpdateNotAvailable: (cb) => ipcRenderer.on('update-not-available', cb),
  onUpdateDownloadProgress: (cb) => ipcRenderer.on('update-download-progress', (_, p) => cb(p)),
  onUpdateDownloaded: (cb) => ipcRenderer.on('update-downloaded', (_, i) => cb(i)),
  onUpdateError: (cb) => ipcRenderer.on('update-error', (_, e) => cb(e)),

  // Default browser. Attaches the renderer's handler and immediately flushes any
  // URLs that arrived (and were buffered) before this point — see the early
  // ipcRenderer.on('open-url') subscription at the top of this file.
  onOpenUrl: (cb) => {
    console.log('[Vex URL] preload: renderer registered onOpenUrl listener; flushing', _openUrlBuffer.length, 'buffered URL(s)');
    _openUrlCb = cb;
    while (_openUrlBuffer.length) {
      const url = _openUrlBuffer.shift();
      try { cb(url); } catch (err) { console.error('[Vex URL] preload: onOpenUrl cb threw:', err && err.stack || err); }
    }
  },
  setAsDefaultBrowser: () => ipcRenderer.invoke('set-as-default-browser'),
  isDefaultBrowser: () => ipcRenderer.invoke('is-default-browser'),

  // Platform + versions
  platform: process.platform,
  electronVersion: process.versions.electron,
  chromeVersion: process.versions.chrome,
  nodeVersion: process.versions.node,
  getElectronVersion: () => process.versions.electron,
  getChromeVersion: () => process.versions.chrome,
  getNodeVersion: () => process.versions.node,

  // Local sidebar config (userData/sidebar-config.json) — personalized tool URLs
  getSidebarConfig: () => ipcRenderer.invoke('sidebar-config:get'),

  // Persistent storage (survives reinstalls — backs the localStorage shim)
  persistGetAll: () => ipcRenderer.invoke('persist-get-all'),
  persistSet: (key, value) => ipcRenderer.invoke('persist-set', key, value),
  persistDelete: (key) => ipcRenderer.invoke('persist-delete', key),
  getUserDataPath: () => ipcRenderer.invoke('get-user-data-path'),

  // Phase 18: Chrome extensions management
  extensionsList:           () => ipcRenderer.invoke('extensions:list'),
  extensionsInstallFolder:  () => ipcRenderer.invoke('extensions:install-folder'),
  extensionsInstallZip:     () => ipcRenderer.invoke('extensions:install-zip'),
  extensionsUninstall:      (folderName) => ipcRenderer.invoke('extensions:uninstall', folderName),
  extensionsOpenFolder:     () => ipcRenderer.invoke('extensions:open-folder'),

  // Phase 13: Vex Sync — encryption key + session metadata
  syncSaveKey: (hex) => ipcRenderer.invoke('sync-save-key', hex),
  syncLoadKey: () => ipcRenderer.invoke('sync-load-key'),
  syncSaveMeta: (meta) => ipcRenderer.invoke('sync-save-meta', meta),
  syncLoadMeta: () => ipcRenderer.invoke('sync-load-meta'),
  syncClearState: () => ipcRenderer.invoke('sync-clear-state')
});

contextBridge.exposeInMainWorld('vexDevTools', {
  // Renderer notifies main to toggle DevTools for a specific webContents
  onToggleRequest: (cb) => ipcRenderer.on('devtools:toggle-request', () => cb()),
  // Renderer calls this to toggle DevTools on a specific tab (by webContentsId)
  toggleWebview: (webContentsId) => ipcRenderer.invoke('devtools:toggle-webview', webContentsId),
  // Open DevTools (detached) for a target webContents. Pass the URL as the
  // optional second argument so main can fall back to URL-matching across
  // all live webContents when getWebContentsId() returned -1 (the silent-
  // failure case for Inspect Element on a freshly-attached <webview>).
  openForWebContents: (webContentsId, fallbackUrl) => ipcRenderer.invoke('devtools:open-for-webcontents', webContentsId, fallbackUrl),
  // Legacy callback support (kept for compatibility, but not used)
  onToggle: (cb) => ipcRenderer.on('devtools:toggle', () => cb()),
});

contextBridge.exposeInMainWorld('vexHid', {
  // WebHID device chooser. Main fires 'hid:select-request' when a site calls
  // navigator.hid.requestDevice(); the renderer shows the picker and replies
  // with the chosen deviceId (or '' to cancel) via 'hid:select-respond'.
  onSelectRequest: (cb) => ipcRenderer.on('hid:select-request', (_e, d) => cb(d)),
  rendererReady:   () => ipcRenderer.send('hid:renderer-ready'),
  respond:         (payload) => ipcRenderer.invoke('hid:select-respond', payload),
});

contextBridge.exposeInMainWorld('vexSpellcheck', {
  // Replace a misspelled word with a spellcheck suggestion. replaceMisspelling
  // lives on webContents in the main process — the <webview> tag element does
  // NOT expose it. Pass the guest URL as the third arg so main can URL-match
  // when getWebContentsId() returned -1 on a freshly-attached guest.
  replaceMisspelling: (webContentsId, suggestion, fallbackUrl) =>
    ipcRenderer.invoke('spellcheck:replace-misspelling', webContentsId, suggestion, fallbackUrl),
});

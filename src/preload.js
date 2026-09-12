const { contextBridge, ipcRenderer } = require('electron');
function subscribe(channel, callback) {
  const listener = (_event, ...args) => callback(...args);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

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
  if (_openUrlCb) {
    try { _openUrlCb(url); } catch { console.error('[Vex URL] URL handler failed'); }
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

  // Toggle background throttling on a live webContents (kept-awake tabs).
  setBackgroundThrottling: (wcId, enabled) => ipcRenderer.invoke('vex:set-bg-throttling', wcId, enabled),

  // Per-container routing (Tor / custom proxy / direct) for a session partition.
  routingSet: (partition, mode, custom) => ipcRenderer.invoke('routing:set', partition, mode, custom),
  routingGet: (partition) => ipcRenderer.invoke('routing:get', partition),

  // Storage
  saveData: (key, data) => ipcRenderer.invoke('storage-save', key, data),
  loadData: (key) => ipcRenderer.invoke('storage-load', key),
  clearBrowsingData: () => ipcRenderer.invoke('browsing:clear-data'),
  addHistory: (entry) => ipcRenderer.invoke('storage:history-add', entry),
  flushStorage: () => ipcRenderer.invoke('storage:flush'),
  cloudRequest: body => ipcRenderer.invoke('cloud:request', body),
  saveCloudToken: token => ipcRenderer.invoke('cloud:token-save', token),
  onFlushRequested: cb => {
    const listener = () => Promise.resolve(cb()).then(() => ipcRenderer.send('storage:flushed')).catch(() => ipcRenderer.send('storage:flush-failed'));
    ipcRenderer.on('storage:flush-request', listener);
    return () => ipcRenderer.removeListener('storage:flush-request', listener);
  },

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
  onCommandBar: (callback) => subscribe('toggle-command-bar', callback),
  onZoomIn: (callback) => subscribe('zoom-in', callback),
  onZoomOut: (callback) => subscribe('zoom-out', callback),
  onZoomReset: (callback) => subscribe('zoom-reset', callback),
  onFindInPage: (callback) => subscribe('find-in-page', callback),
  onNewTab: (callback) => subscribe('new-tab', callback),
  onCloseTab: (callback) => subscribe('close-tab', callback),
  onReloadTab: (callback) => subscribe('reload-tab', callback),
  // Core browser shortcuts forwarded from a focused page's <webview> guest
  // (they don't reach the host document otherwise).
  onFocusAddressBar: (callback) => subscribe('focus-address-bar', callback),
  onNextTab: (callback) => subscribe('next-tab', callback),
  onPrevTab: (callback) => subscribe('prev-tab', callback),
  onJumpToTab: (callback) => subscribe('jump-to-tab', callback),
  onBookmarkCurrent: (callback) => subscribe('bookmark-current', callback),
  onHardReloadTab: (callback) => subscribe('hard-reload-tab', callback),
  hardReloadWebview: (webContentsId) => ipcRenderer.invoke('webview:hard-reload', webContentsId),
  onNavigateBack: (callback) => subscribe('navigate-back', callback),
  onNavigateForward: (callback) => subscribe('navigate-forward', callback),

  // Split & PiP
  onToggleSplit: (callback) => subscribe('toggle-split', callback),
  onTogglePip: (callback) => subscribe('toggle-pip', callback),
  openPipWindow: (url) => ipcRenderer.invoke('open-pip-window', url),
  closePipWindow: () => ipcRenderer.invoke('close-pip-window'),
  isPipOpen: () => ipcRenderer.invoke('is-pip-open'),
  // Fires when the pop-out goes away, with 'closed' or 'back-to-tab'. The
  // renderer owns the source tab (main only ever gets a URL), so it is the
  // only side that can un-mute it and switch back to it.
  onPipClosed: (callback) => subscribe('pip:closed', callback),

  // Downloads (with progress tracking)
  onTabCreateFromExternal: (cb) => subscribe('tab:create-from-external', cb),

  // Peek overlay (shift+click a link → floating preview)
  onPeekOpen: (cb) => subscribe('peek:open', cb),

  // OAuth/login popup backdrop — the auth popup is a REAL (opener-connected)
  // child window dressed like Peek; main dims Vex behind it via these events,
  // and a backdrop click dismisses the frameless popup.
  onOAuthPopupOpen: (cb) => subscribe('oauth-popup:open', cb),
  onOAuthPopupClose: (cb) => subscribe('oauth-popup:close', cb),
  dismissOAuthPopup: () => ipcRenderer.send('oauth-popup:dismiss'),

  // Generic main → renderer toast (e.g. Discord pop-out pin feedback).
  onToast: (cb) => subscribe('vex:toast', cb),
  // Fires once when a Discord stream pop-out window opens (discoverability hint).
  onDiscordPopoutOpen: (cb) => subscribe('vex:discord-popout-open', cb),

  // RSS feeds (fetched in main to dodge CORS)
  rssFetch: (url) => ipcRenderer.invoke('rss:fetch', url),

  // QR code + resource metrics
  qrMake: (text) => ipcRenderer.invoke('qr:make', text),
  appMetrics: () => ipcRenderer.invoke('app:metrics'),
  // Real per-tab memory: pass the materialized tabs' <webview> webContents ids,
  // get back { totalKB, byId: { id: {memKB, pid, shared} } }.
  tabMemory: (ids) => ipcRenderer.invoke('app:tab-memory', ids),
  // "Read free": clear one site's data in its partition to reset metered paywalls.
  clearSiteData: (opts) => ipcRenderer.invoke('site:clear-data', opts),
  // Media grabber: list/download media detected on a tab (by its webContents id).
  mediaList: (wcId) => ipcRenderer.invoke('media:list', wcId),
  mediaDownload: (wcId, url) => ipcRenderer.invoke('media:download', wcId, url),
  // Discord censorship bypass (DoH + SNI fragmentation on persist:discord).
  discordBypass: (on) => ipcRenderer.send('discord:set-bypass', on),
  // Bypass mode: 'off' | 'light' (built-in) | 'strong' (ByeDPI).
  // opts = { preset?: number (>=0 forces, else auto-tune), custom?: string }.
  // Returns { ok, mode, preset?, auto?, port?, error? }.
  setDiscordBypassMode: (mode, opts) => ipcRenderer.invoke('discord:set-bypass-mode', mode, opts),
  // One-click Vencord install into the Discord panel.
  installVencord: () => ipcRenderer.invoke('discord:install-vencord'),
  // Install a LOCAL Vencord build (your custom userplugins/plugins). Optional
  // path points at the build's extension-chrome.zip or its repo/dist folder.
  installVencordLocal: (path) => ipcRenderer.invoke('discord:install-vencord-local', path),
  // Auto-configure sweep progress: { phase:'testing'|'done', label, i, total, ok, via, preset }.
  onDiscordBypassProgress: (cb) => subscribe('discord:bypass-progress', cb),
  // Screen-share source picker (Discord Go Live / Share Screen).
  onScreenPickerOpen: (cb) => subscribe('screen-picker:open', cb),
  chooseScreenSource: (id, sourceId, opts) => ipcRenderer.invoke('screen-picker:choose', Object.assign({ id, sourceId }, opts || {})),
  // Roblox panel block-bypass (shares Discord's ByeDPI).
  setRobloxBypass: (on) => ipcRenderer.invoke('roblox:set-bypass', on),
  // Persist the GUI Style so the start page (served by main, separate origin) can match.
  setGuiStyle: (style) => ipcRenderer.invoke('gui-style:set', style),

  // Full-text recall (memex) + translate (both run in main)
  recallIndex: (entry) => ipcRenderer.invoke('recall:index', entry),
  recallSearch: (q, options) => ipcRenderer.invoke('recall:search', q, options),
  recallStats: () => ipcRenderer.invoke('recall:stats'),
  recallForget: (target) => ipcRenderer.invoke('recall:forget', target),
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
  vaultHealth: () => ipcRenderer.invoke('vault:health'),
  vaultSave: (entry) => ipcRenderer.invoke('vault:save', entry),
  vaultDelete: (q) => ipcRenderer.invoke('vault:delete', q),
  // TOTP authenticator (2FA). Secrets stay in the main process — the renderer
  // only ever gets metadata (totpList) and the finished 6-digit codes (totpCodes).
  totpList: () => ipcRenderer.invoke('totp:list'),
  totpCodes: () => ipcRenderer.invoke('totp:codes'),
  totpAdd: (input) => ipcRenderer.invoke('totp:add', input),
  totpDelete: (id) => ipcRenderer.invoke('totp:delete', id),

  // Permission prompts (geolocation, mic, camera, notifications, ...)
  onPermissionRequest:  (cb) => subscribe('permission:request', cb),
  permissionsRendererReady: () => ipcRenderer.send('permissions:renderer-ready'),
  permissionRespond:    (payload) => ipcRenderer.invoke('permission:respond', payload),
  permissionsList:      () => ipcRenderer.invoke('permissions:list'),
  permissionsRevoke:    (key) => ipcRenderer.invoke('permissions:revoke', key),
  permissionsClearAll:  () => ipcRenderer.invoke('permissions:clear-all'),

  onDownloadStarted:  (cb) => subscribe('download-started', cb),
  onDownloadProgress: (cb) => subscribe('download-progress', cb),
  onDownloadComplete: (cb) => subscribe('download-complete', cb),
  downloadsOpenFile:     (p) => ipcRenderer.invoke('downloads:open-file', p),
  downloadsShowInFolder: (p) => ipcRenderer.invoke('downloads:show-in-folder', p),
  downloadsOpenFolder:   ()  => ipcRenderer.invoke('downloads:open-folder'),
  // Pause / resume / cancel a transfer that is still running, and re-request one
  // that failed. `action` is 'pause' | 'resume' | 'cancel'.
  downloadsControl:      (id, action) => ipcRenderer.invoke('downloads:control', id, action),
  downloadsRetry:        (url) => ipcRenderer.invoke('downloads:retry', url),

  // Notes & Sessions shortcuts
  onToggleNotes: (callback) => subscribe('toggle-notes', callback),
  onToggleSessions: (callback) => subscribe('toggle-sessions', callback),

  // Phase 4: History, Memory, Sleep, Restore
  onReopenLastClosed: (callback) => subscribe('reopen-last-closed', callback),
  onToggleHistory: (callback) => subscribe('toggle-history', callback),
  onToggleHistoryAi: (callback) => subscribe('toggle-history-ai', callback),
  onToggleMemory: (callback) => subscribe('toggle-memory', callback),
  onSleepCurrentTab: (callback) => subscribe('sleep-current-tab', callback),
  onSaveSessionBeforeQuit: (callback) => subscribe('save-session-before-quit', callback),

  // Phase 5
  onToggleReadingMode: (callback) => subscribe('toggle-reading-mode', callback),
  onTakeScreenshot: (callback) => subscribe('take-screenshot', callback),

  // Phase 6: fullscreen, private, mute
  toggleFullscreen: () => ipcRenderer.invoke('toggle-fullscreen'),
  isFullscreen: () => ipcRenderer.invoke('is-fullscreen'),
  onFullscreenChanged: (callback) => subscribe('fullscreen-changed', callback),
  openPrivateWindow: () => ipcRenderer.invoke('open-private-window'),
  // New Identity: a throwaway isolated session (random consistent Chrome UA).
  createIdentity: () => ipcRenderer.invoke('identity:create'),
  // Tor session: isolated, proxied through a local Tor SOCKS5 (max security).
  createTor: () => ipcRenderer.invoke('tor:create'),
  verifyTor: (partition) => ipcRenderer.invoke('tor:verify', partition),
  // Progress while Vex downloads + bootstraps its own Tor (no Tor Browser needed).
  // cb({ phase:'download'|'bootstrap', value, detail }). Returns an unsubscribe fn.
  onTorProgress: (cb) => { const h = (_e, p) => { try { cb(p); } catch {} }; ipcRenderer.on('tor:progress', h); return () => { try { ipcRenderer.removeListener('tor:progress', h); } catch {} }; },
  onToggleMuteTab: (callback) => subscribe('toggle-mute-tab', callback),

  // Tabs sidebar toggle
  onToggleTabsSidebar: (callback) => subscribe('toggle-tabs-sidebar', callback),

  // Phase 8: Schedules
  onToggleSchedules: (callback) => subscribe('toggle-schedules', callback),

  // Phase 7A: AI
  onToggleAiPanel: (callback) => subscribe('toggle-ai-panel', callback),

  // Phase 9: Updates
  checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),
  widevineStatus: () => ipcRenderer.invoke('widevine:status'),
  widevineRetry: () => ipcRenderer.invoke('widevine:retry'),
  downloadUpdate: () => ipcRenderer.invoke('download-update'),
  installUpdate: () => ipcRenderer.invoke('install-update'),
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  getReleaseNotes: (tag) => ipcRenderer.invoke('updates:notes', tag),
  getReleaseList: () => ipcRenderer.invoke('updates:list'),
  restartApp: () => ipcRenderer.invoke('app:restart'),
  focusWindow: () => ipcRenderer.invoke('app:focus'),
  qrGenerate: (text) => ipcRenderer.invoke('qr:generate', text),
  fxRates: () => ipcRenderer.invoke('fx:rates'),
  openAsApp: (url, title) => ipcRenderer.invoke('app:open-as-app', url, title),
  getCustomThemeImage: () => ipcRenderer.invoke('theme:get-custom-image'),
  setCustomThemeImage: (dataUrl) => ipcRenderer.invoke('theme:set-custom-image', dataUrl),
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  onUpdateAvailable: (cb) => subscribe('update-available', cb),
  onUpdateNotAvailable: (cb) => subscribe('update-not-available', cb),
  onUpdateDownloadProgress: (cb) => subscribe('update-download-progress', cb),
  onUpdateDownloaded: (cb) => subscribe('update-downloaded', cb),
  onUpdateError: (cb) => subscribe('update-error', cb),

  // Default browser. Attaches the renderer's handler and immediately flushes any
  // URLs that arrived (and were buffered) before this point — see the early
  // ipcRenderer.on('open-url') subscription at the top of this file.
  onOpenUrl: (cb) => {
    console.log('[Vex URL] preload: renderer registered onOpenUrl listener; flushing', _openUrlBuffer.length, 'buffered URL(s)');
    _openUrlCb = cb;
    while (_openUrlBuffer.length) {
      const url = _openUrlBuffer.shift();
      try { cb(url); } catch { console.error('[Vex URL] URL handler failed'); }
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
  extensionsSetEnabled:     (folderName, enabled) => ipcRenderer.invoke('extensions:set-enabled', folderName, enabled),
  extensionsOpenPopup:      (request) => ipcRenderer.invoke('extensions:open-popup', request),

  // Phase 13: Vex Sync — encryption key + session metadata
  syncSaveKey: (hex) => ipcRenderer.invoke('sync-save-key', hex),
  syncLoadKey: () => ipcRenderer.invoke('sync-load-key'),
  syncSaveMeta: (meta) => ipcRenderer.invoke('sync-save-meta', meta),
  syncLoadMeta: () => ipcRenderer.invoke('sync-load-meta'),
  syncClearState: () => ipcRenderer.invoke('sync-clear-state')
});

contextBridge.exposeInMainWorld('vexDevTools', {
  // Renderer notifies main to toggle DevTools for a specific webContents
  onToggleRequest: (cb) => subscribe('devtools:toggle-request', cb),
  // Renderer calls this to toggle DevTools on a specific tab (by webContentsId)
  toggleWebview: (webContentsId) => ipcRenderer.invoke('devtools:toggle-webview', webContentsId),
  // Open DevTools (detached) for a target webContents. Pass the URL as the
  // optional second argument so main can fall back to URL-matching across
  // all live webContents when getWebContentsId() returned -1 (the silent-
  // failure case for Inspect Element on a freshly-attached <webview>).
  openForWebContents: (webContentsId, fallbackUrl) => ipcRenderer.invoke('devtools:open-for-webcontents', webContentsId, fallbackUrl),
  // Legacy callback support (kept for compatibility, but not used)
  onToggle: (cb) => subscribe('devtools:toggle', cb),
});

contextBridge.exposeInMainWorld('vexHid', {
  // WebHID device chooser. Main fires 'hid:select-request' when a site calls
  // navigator.hid.requestDevice(); the renderer shows the picker and replies
  // with the chosen deviceId (or '' to cancel) via 'hid:select-respond'.
  onSelectRequest: (cb) => subscribe('hid:select-request', cb),
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

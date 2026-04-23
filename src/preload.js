const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('vex', {
  // Window controls
  minimize: () => ipcRenderer.send('window-minimize'),
  maximize: () => ipcRenderer.send('window-maximize'),
  close: () => ipcRenderer.send('window-close'),

  // Storage
  saveData: (key, data) => ipcRenderer.invoke('storage-save', key, data),
  loadData: (key) => ipcRenderer.invoke('storage-load', key),

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
  hardReloadWebview: (webContentsId) => ipcRenderer.invoke('webview:hard-reload', webContentsId),
  onNavigateBack: (callback) => ipcRenderer.on('navigate-back', callback),
  onNavigateForward: (callback) => ipcRenderer.on('navigate-forward', callback),

  // Split & PiP
  onToggleSplit: (callback) => ipcRenderer.on('toggle-split', callback),
  onTogglePip: (callback) => ipcRenderer.on('toggle-pip', callback),
  openPipWindow: (url) => ipcRenderer.invoke('open-pip-window', url),

  // Downloads (with progress tracking)
  onTabCreateFromExternal: (cb) => ipcRenderer.on('tab:create-from-external', (_e, d) => cb(d)),

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
  downloadUpdate: () => ipcRenderer.invoke('download-update'),
  installUpdate: () => ipcRenderer.invoke('install-update'),
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  onUpdateAvailable: (cb) => ipcRenderer.on('update-available', (_, i) => cb(i)),
  onUpdateNotAvailable: (cb) => ipcRenderer.on('update-not-available', cb),
  onUpdateDownloadProgress: (cb) => ipcRenderer.on('update-download-progress', (_, p) => cb(p)),
  onUpdateDownloaded: (cb) => ipcRenderer.on('update-downloaded', (_, i) => cb(i)),
  onUpdateError: (cb) => ipcRenderer.on('update-error', (_, e) => cb(e)),

  // Default browser
  onOpenUrl: (cb) => ipcRenderer.on('open-url', (_, url) => cb(url)),
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
  // Ctrl+Shift+J — open DevTools for the active panel's webview in a detached window
  openForWebContents: (webContentsId) => ipcRenderer.invoke('devtools:open-for-webcontents', webContentsId),
  // Legacy callback support (kept for compatibility, but not used)
  onToggle: (cb) => ipcRenderer.on('devtools:toggle', () => cb()),
});

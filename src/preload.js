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
  onNavigateBack: (callback) => ipcRenderer.on('navigate-back', callback),
  onNavigateForward: (callback) => ipcRenderer.on('navigate-forward', callback),

  // Split & PiP
  onToggleSplit: (callback) => ipcRenderer.on('toggle-split', callback),
  onTogglePip: (callback) => ipcRenderer.on('toggle-pip', callback),
  openPipWindow: (url) => ipcRenderer.invoke('open-pip-window', url),

  // Downloads (with progress tracking)
  onDownloadStarted: (callback) => ipcRenderer.on('download-started', callback),
  onDownloadProgress: (callback) => ipcRenderer.on('download-progress', callback),
  onDownloadComplete: (callback) => ipcRenderer.on('download-complete', callback),

  // Notes & Sessions shortcuts
  onToggleNotes: (callback) => ipcRenderer.on('toggle-notes', callback),
  onToggleSessions: (callback) => ipcRenderer.on('toggle-sessions', callback),

  // Phase 4: History, Memory, Sleep, Restore
  onReopenLastClosed: (callback) => ipcRenderer.on('reopen-last-closed', callback),
  onToggleHistory: (callback) => ipcRenderer.on('toggle-history', callback),
  onToggleMemory: (callback) => ipcRenderer.on('toggle-memory', callback),
  onSleepCurrentTab: (callback) => ipcRenderer.on('sleep-current-tab', callback),
  onSaveSessionBeforeQuit: (callback) => ipcRenderer.on('save-session-before-quit', callback),

  // Platform
  platform: process.platform
});

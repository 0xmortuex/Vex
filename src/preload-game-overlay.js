// Preload for the in-game overlay window (renderer/game-overlay.html).
//
// The overlay is a small card with a few panels, so it gets exactly the calls
// it needs and nothing else: it cannot reach tabs, storage, files or any other
// window, and it has nothing that looks at another program. Every channel here
// has a schema in main/ipc-schemas.js and is checked against the window's own
// address in main/ipc-policy.js.
const { contextBridge, ipcRenderer } = require('electron');

const listen = (channel, fn) => {
  if (typeof fn !== 'function') throw new TypeError('A listener must be a function');
  const wrapped = (_e, payload) => fn(payload);
  ipcRenderer.on(channel, wrapped);
  return () => ipcRenderer.removeListener(channel, wrapped);
};

contextBridge.exposeInMainWorld('vexGameOverlay', {
  get: () => ipcRenderer.invoke('gameoverlay:get'),
  hide: () => ipcRenderer.invoke('gameoverlay:hide'),
  setClickThrough: (on) => ipcRenderer.invoke('gameoverlay:click-through', on),
  setInteractive: (on) => ipcRenderer.invoke('gameoverlay:interactive', on),
  setOpacity: (level) => ipcRenderer.invoke('gameoverlay:opacity', level),
  setCompact: (on) => ipcRenderer.invoke('gameoverlay:compact', on),
  showPanel: (panel, rect) => ipcRenderer.invoke('gameoverlay:view', { panel, ...rect }),
  search: (query) => ipcRenderer.invoke('gameoverlay:search', query),
  saveNotes: (text) => ipcRenderer.invoke('gameoverlay:save-notes', text),
  saveTimer: (timer) => ipcRenderer.invoke('gameoverlay:timer', timer),
  music: (action) => ipcRenderer.invoke('gameoverlay:music', action),
  onState: (fn) => listen('gameoverlay:state', fn),
});

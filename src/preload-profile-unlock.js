// Preload of the unlock window (main/profile-unlock.js): two calls and nothing else.
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('vexUnlock', {
  unlock: (mode, secret) => ipcRenderer.invoke('profilecrypt:unlock', mode, secret),
  quit: () => ipcRenderer.send('profilecrypt:quit'),
});

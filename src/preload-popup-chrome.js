const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('popupChrome', {
  action: action => { if (['back','reload','open-as-tab','copy','close'].includes(action)) ipcRenderer.send('popup-chrome:action', { action }); },
  onUrl: callback => { const listener = (_event, url) => callback(String(url || '')); ipcRenderer.on('popup-chrome:url', listener); return () => ipcRenderer.removeListener('popup-chrome:url', listener); },
  // The bar wears the user's colours: main reads the resolved tokens off the
  // main window and sends them here (see 'popup-chrome:palette' in main.js).
  onPalette: callback => { const listener = (_event, p) => callback(p && typeof p === 'object' ? p : {}); ipcRenderer.on('popup-chrome:palette', listener); return () => ipcRenderer.removeListener('popup-chrome:palette', listener); }
});

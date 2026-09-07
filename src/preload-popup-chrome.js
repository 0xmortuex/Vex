const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('popupChrome', {
  action: action => { if (['back','reload','open-as-tab','copy','close'].includes(action)) ipcRenderer.send('popup-chrome:action', { action }); },
  onUrl: callback => { const listener = (_event, url) => callback(String(url || '')); ipcRenderer.on('popup-chrome:url', listener); return () => ipcRenderer.removeListener('popup-chrome:url', listener); }
});

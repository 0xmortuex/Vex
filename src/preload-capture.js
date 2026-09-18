// Preload for the quick-capture window (renderer/capture.html).
//
// The window is one input box that floats over whatever you were doing, so it
// gets exactly two things: submit a line, and close. Nothing else is exposed —
// it has no reason to touch tabs, storage or the page you were on.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('vexCapture', {
  submit: (entry) => ipcRenderer.invoke('capture:submit', entry),
  close: () => ipcRenderer.send('capture:close'),
});

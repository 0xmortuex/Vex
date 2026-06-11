// === Picture-in-Picture Window Manager ===

const { BrowserWindow } = require('electron');
const path = require('path');

let pipWindow = null;

function createPipWindow(url) {
  if (pipWindow && !pipWindow.isDestroyed()) {
    pipWindow.loadURL(url);
    pipWindow.focus();
    return pipWindow;
  }

  pipWindow = new BrowserWindow({
    width: 400,
    height: 225,
    frame: false,
    alwaysOnTop: true,
    resizable: true,
    minimizable: false,
    maximizable: false,
    skipTaskbar: true,
    backgroundColor: '#000000',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true
    }
  });

  pipWindow.setAlwaysOnTop(true, 'screen-saver');
  pipWindow.setAspectRatio(16 / 9);
  pipWindow.loadURL(url);

  pipWindow.on('closed', () => {
    pipWindow = null;
  });

  return pipWindow;
}

function closePipWindow() {
  if (pipWindow && !pipWindow.isDestroyed()) {
    pipWindow.close();
    pipWindow = null;
  }
}

function isPipOpen() {
  return pipWindow && !pipWindow.isDestroyed();
}

module.exports = { createPipWindow, closePipWindow, isPipOpen };

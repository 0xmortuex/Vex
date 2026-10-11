// Whether Windows has apps in dark mode, for Light and dark
// (src/renderer/js/theme-auto.js): read on request, and told to every Vex
// window when it changes. nativeTheme's 'updated' also fires for high contrast
// and inverted colours, so only a real light/dark change is passed on.
//
// Website appearance (src/main/website-appearance.js) sets
// nativeTheme.themeSource, and from then on shouldUseDarkColors answers with
// that choice instead of Windows' own. Windows' app mode is then read where
// Windows keeps it (AppsUseLightTheme), so Light and dark still follows
// Windows and not Vex's own answer back to itself.
const { execFile } = require('child_process');

const PERSONALIZE = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize';

// Windows' "app mode": true for dark. No value means light (Windows before
// the setting existed). A failed read is an error, not a guess.
function readWindowsAppsDark() {
  return new Promise((resolve, reject) => {
    execFile('reg', ['query', PERSONALIZE, '/v', 'AppsUseLightTheme'], { windowsHide: true, timeout: 5000 }, (err, stdout) => {
      if (err) {
        if (err.code === 1 && /unable to find/i.test(String(err.message) + String(stdout))) { resolve(false); return; }
        reject(new Error('could not read Windows\' app mode: ' + err.message));
        return;
      }
      const m = /AppsUseLightTheme\s+REG_DWORD\s+0x([0-9a-f]+)/i.exec(stdout);
      if (!m) { reject(new Error('Windows\' app mode was not in the answer')); return; }
      resolve(parseInt(m[1], 16) === 0);
    });
  });
}

function wireSystemTheme({ ipcMain, nativeTheme, windows, readAppsDark = readWindowsAppsDark, platform = process.platform }) {
  if (!ipcMain || !nativeTheme || typeof windows !== 'function') throw new Error('wireSystemTheme needs ipcMain, nativeTheme and windows()');
  const osDark = async () => {
    if (nativeTheme.themeSource === 'system' || platform !== 'win32') return nativeTheme.shouldUseDarkColors;
    return readAppsDark();
  };
  ipcMain.handle('system-theme:get', async () => ({ dark: await osDark() }));
  let last = null;
  osDark().then((d) => { if (last === null) last = d; }).catch(err => console.error('[system-theme]', err.message));
  const onUpdated = () => {
    osDark().then((dark) => {
      if (dark === last) return;
      last = dark;
      for (const win of windows()) {
        if (!win || win.isDestroyed() || win.webContents.isDestroyed()) continue;
        win.webContents.send('system-theme:changed', { dark });
      }
    }).catch(err => console.error('[system-theme]', err.message));
  };
  nativeTheme.on('updated', onUpdated);
  return { dispose: () => nativeTheme.removeListener('updated', onUpdated) };
}

module.exports = { wireSystemTheme, readWindowsAppsDark };

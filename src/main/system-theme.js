// Whether Windows has apps in dark mode, for Light and dark
// (src/renderer/js/theme-auto.js): read on request, and told to every Vex
// window when it changes. nativeTheme's 'updated' also fires for high contrast
// and inverted colours, so only a real light/dark change is passed on.
function wireSystemTheme({ ipcMain, nativeTheme, windows }) {
  if (!ipcMain || !nativeTheme || typeof windows !== 'function') throw new Error('wireSystemTheme needs ipcMain, nativeTheme and windows()');
  ipcMain.handle('system-theme:get', () => ({ dark: nativeTheme.shouldUseDarkColors }));
  let last = nativeTheme.shouldUseDarkColors;
  const onUpdated = () => {
    const dark = nativeTheme.shouldUseDarkColors;
    if (dark === last) return;
    last = dark;
    for (const win of windows()) {
      if (!win || win.isDestroyed() || win.webContents.isDestroyed()) continue;
      win.webContents.send('system-theme:changed', { dark });
    }
  };
  nativeTheme.on('updated', onUpdated);
  return { dispose: () => nativeTheme.removeListener('updated', onUpdated) };
}

module.exports = { wireSystemTheme };

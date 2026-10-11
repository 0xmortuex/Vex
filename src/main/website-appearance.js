// Website appearance (Settings > Appearance): whether web pages are told the
// user prefers light or dark (prefers-color-scheme), and which way Chromium
// draws their scrollbars and form controls. Websites ignored Vex's theme: a
// dark Vex showed white sites with white scrollbars (cat-themes gaps).
//
// Electron has one switch for that, for the whole app: nativeTheme.themeSource.
// The renderer (js/website-appearance.js) decides the value from the setting
// and the theme Vex is wearing; this only applies it.
const SOURCES = ['system', 'light', 'dark'];

function wireWebsiteAppearance({ ipcMain, nativeTheme }) {
  if (!ipcMain || !nativeTheme) throw new Error('wireWebsiteAppearance needs ipcMain and nativeTheme');
  ipcMain.handle('theme:set-website-appearance', (_event, source) => {
    if (!SOURCES.includes(source)) throw new Error('Not a website appearance: ' + source);
    if (nativeTheme.themeSource !== source) nativeTheme.themeSource = source;
    return { ok: true, source };
  });
}

module.exports = { wireWebsiteAppearance, SOURCES };

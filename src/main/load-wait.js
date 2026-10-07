// One wait per page load for a guest page's executeJavaScript.
//
// Electron runs webContents.executeJavaScript only once the main frame has
// stopped loading, and every call made before that adds its own
// once('did-stop-loading') listener. On every boot about nine Vex modules
// (Today, the cookie-banner fixer, accessibility, the look, the font, link
// hints…) inject into the New Tab page at dom-ready, all before its load is
// done, so its WebContents passed Node's limit of ten listeners and main
// printed "MaxListenersExceededWarning: 11 did-stop-loading listeners added
// to [WebContents]" (walkthrough L13, 2026-10-07). Nothing leaked — each
// listener ran once — but raising the limit would hide a real leak later.
// Instead, the calls made during one load share ONE listener and run, in the
// order they were made, when the load stops; Electron then runs each at once.
'use strict';

function shareLoadWait(wc) {
  if (!wc || typeof wc.executeJavaScript !== 'function' || wc.__vexLoadWait) return false;
  const run = wc.executeJavaScript.bind(wc);
  let loaded = null;   // the shared wait for the load in progress
  const loading = () => {
    try { return !wc.isDestroyed() && !!wc.getURL() && wc.isLoadingMainFrame(); }
    catch { return false; }   // destroyed between the checks: let Electron's own call report it
  };
  wc.executeJavaScript = function executeJavaScript(code, userGesture) {
    if (!loading()) return run(code, userGesture);
    if (!loaded) {
      loaded = new Promise((resolve) => {
        wc.once('did-stop-loading', () => { loaded = null; resolve(); });
      });
    }
    return loaded.then(() => run(code, userGesture));
  };
  wc.__vexLoadWait = true;
  return true;
}

module.exports = { shareLoadWait };

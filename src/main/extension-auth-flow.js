// === chrome.identity.launchWebAuthFlow for an extension (2026-10-28) ===========
//
// An extension signs a person in by sending a window to its provider's authorize page and waiting for the page to redirect to an address
// that belongs to the extension. The Claude extension does it "silently" (interactive: false): it loads claude.ai's authorize page with no
// window shown, and if the person is already signed in to claude.ai in the browser, the page redirects straight back with a code. Electron has
// no chrome.identity, so the call was refused and the extension could never sign in.
//
//   - the window uses the extension's own session (so the person's claude.ai cookies are the ones used), and has no preload and no Node;
//   - it ends the moment it is sent to https://<id>.chromiumapp.org/... or chrome-extension://<id>/... (the extension's own addresses): the
//     navigation is stopped there and the full address, with the code, is what the extension is given;
//   - interactive: false shows nothing. A page that loads and does not redirect says "User interaction required."; a page that cannot be
//     loaded, or takes too long, says "Authorization page could not be loaded." (the words the Claude extension tells apart);
//   - interactive: true shows the window; closing it, or five minutes, says "The user did not approve access.".
// Pure over createWindow, so it is tested against fakes.

const INTERACTIVE_MS = 5 * 60 * 1000;
const SETTLE_MS = 1500;      // after a non-interactive page has loaded: a redirect that follows within this is still the answer
const DEFAULT_QUIET_MS = 15000;

function redirectPrefixes(extId) { return ['https://' + extId + '.chromiumapp.org/', 'chrome-extension://' + extId + '/']; }

function createAuthFlow({ createWindow, setTimeoutFn = setTimeout, clearTimeoutFn = clearTimeout }) {
  function launch({ ses, extId, url, interactive = false, timeoutMs }) {
    return new Promise((resolve, reject) => {
      let u;
      try { u = new URL(String(url)); } catch { reject(new Error('Authorization page could not be loaded.')); return; }
      if (u.protocol !== 'https:' && u.protocol !== 'http:') { reject(new Error('Authorization page could not be loaded.')); return; }
      const prefixes = redirectPrefixes(extId);
      const isRedirect = (address) => prefixes.some(p => String(address).startsWith(p));
      let done = false;
      let timer = null;
      let settle = null;
      let win = null;
      const finish = (err, value) => {
        if (done) return;
        done = true;
        clearTimeoutFn(timer); clearTimeoutFn(settle);
        try { if (win && !win.isDestroyed()) win.destroy(); }
        catch (e) { console.error('[Extensions] could not close the sign-in window:', e.message); }
        if (err) reject(err); else resolve(value);
      };
      win = createWindow({ ses, interactive, title: u.hostname });
      const wc = win.webContents;
      const check = (event, address) => {
        if (!isRedirect(address)) return false;
        if (event && typeof event.preventDefault === 'function') event.preventDefault();
        finish(null, String(address));
        return true;
      };
      wc.on('will-redirect', (e, address) => { check(e, address); });
      wc.on('will-navigate', (e, address) => { check(e, address); });
      wc.on('did-start-navigation', (a, b) => { check(a, a && typeof a.url === 'string' ? a.url : b); });
      wc.on('did-fail-load', (_e, _code, _desc, address, isMainFrame) => {
        if (isRedirect(address)) { finish(null, String(address)); return; }
        if (isMainFrame && !interactive) finish(new Error('Authorization page could not be loaded.'));
      });
      wc.on('did-finish-load', () => {
        if (interactive || done) return;
        clearTimeoutFn(settle);
        settle = setTimeoutFn(() => finish(new Error('User interaction required.')), SETTLE_MS);
      });
      win.on('closed', () => finish(new Error('The user did not approve access.')));
      timer = setTimeoutFn(() => finish(new Error(interactive ? 'The user did not approve access.' : 'Authorization page could not be loaded.')),
        interactive ? INTERACTIVE_MS : (Number.isFinite(timeoutMs) && timeoutMs > 0 ? Math.min(timeoutMs, 60000) : DEFAULT_QUIET_MS));
      Promise.resolve(wc.loadURL(u.href)).catch((err) => {
        // Stopping the navigation at the redirect is how the answer is taken: it ends "aborted". Anything else is a page that did not load.
        if (!done && !/ERR_ABORTED|\(-3\)/.test(String(err && err.message))) { if (!interactive) finish(new Error('Authorization page could not be loaded.')); }
      });
      if (interactive && typeof win.show === 'function') win.show();
    });
  }
  return { launch, redirectPrefixes };
}

module.exports = { createAuthFlow, redirectPrefixes, INTERACTIVE_MS, SETTLE_MS, DEFAULT_QUIET_MS };

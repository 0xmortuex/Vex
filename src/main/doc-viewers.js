'use strict';
// === The pages Vex shows INSTEAD of Chromium's bare document viewers ============
//
// When a tab's main frame is navigated to a document Chromium would show in a sealed viewer of its own (a video or a sound file
// today; other viewers register the same way), Vex can show a page of its own. This is the one small place that decides it:
//
//   register({ id, match(url, contentType) -> bool, redirect(details, pendingUrl) -> address, enabled?() })
//
// take(details, callback) is called from each session's onHeadersReceived (one line each in main.js). A main-frame answer a viewer
// matches is turned into a 302 to the viewer's page, so the tab makes ONE ordinary navigation (cancelling the request and loading
// the page from here instead froze the main process once, measured 2026-10-25). Only a MAIN frame of a Vex tab or panel is ever
// taken: never a <video> inside a page, never a download (Content-Disposition: attachment), never an error answer.
//
// The viewer's own page then fetches the document through THE SAME SESSION the tab runs in (private and Tor tabs included), so
// this registry never touches the network.

const BYPASS_MS = 20000;

function headerValue(headers, name) {
  if (!headers) return '';
  const want = name.toLowerCase();
  for (const key of Object.keys(headers)) if (key.toLowerCase() === want) return [].concat(headers[key])[0] || '';
  return '';
}

// deps: { isGuest(webContents) -> bool }
function createDocViewers(deps) {
  const isGuest = deps && deps.isGuest;
  if (typeof isGuest !== 'function') throw new Error('createDocViewers needs isGuest');
  const viewers = new Map();
  const bypass = new Map();      // `${viewer id} ${webContents id} ${address}` -> expiry

  function register(def) {
    if (!def || typeof def.id !== 'string' || typeof def.match !== 'function' || typeof def.redirect !== 'function') {
      throw new Error('A document viewer needs an id, match(url, contentType) and redirect(details, pendingUrl)');
    }
    if (viewers.has(def.id)) throw new Error('There is already a document viewer called ' + def.id);
    viewers.set(def.id, def);
  }

  const key = (id, wcId, url) => id + ' ' + wcId + ' ' + String(url).replace(/#.*$/, '');
  // "Open it the browser's way, once": the next main-frame answer for this address in this tab is left alone.
  function allowOnce(id, webContentsId, url) { bypass.set(key(id, webContentsId, url), Date.now() + BYPASS_MS); }
  function consumeBypass(id, webContentsId, url) {
    const k = key(id, webContentsId, url);
    const until = bypass.get(k);
    if (until == null) return false;
    bypass.delete(k);
    return until > Date.now();
  }

  // true = the navigation was taken over and the callback has been answered.
  function take(details, callback) {
    if (!details || details.resourceType !== 'mainFrame') return false;
    if (!(details.statusCode >= 200 && details.statusCode < 300)) return false;
    if (!/^https?:\/\//i.test(String(details.url || ''))) return false;
    if (/^\s*attachment/i.test(headerValue(details.responseHeaders, 'content-disposition'))) return false;
    const type = headerValue(details.responseHeaders, 'content-type');
    const wc = details.webContents;
    for (const def of viewers.values()) {
      if (typeof def.enabled === 'function' && !def.enabled()) continue;
      if (!def.match(details.url, type)) continue;
      if (!isGuest(wc)) return false;
      if (consumeBypass(def.id, wc.id, details.url)) return false;
      let pending;
      try { pending = wc.getURL() || ''; } catch { pending = ''; }
      const to = def.redirect(details, pending);
      callback({ statusLine: 'HTTP/1.1 302 Found', responseHeaders: { location: [to], 'content-length': ['0'], 'cache-control': ['no-store'] } });
      return true;
    }
    return false;
  }

  return { register, take, allowOnce, consumeBypass, ids: () => [...viewers.keys()] };
}

module.exports = { createDocViewers, headerValue, BYPASS_MS };

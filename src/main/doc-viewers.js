'use strict';
// === The registry of Vex's own viewers for files a tab would otherwise download ===================
//
// A viewer is a page of Vex's own (served under its own scheme by main) that takes over the navigation to a file of some kind: an
// office document, a book, a picture, a text. This registry is the one place that decides WHICH viewer takes a navigation:
//
//   register({ id, match(url, contentType) -> boolean, page(url, hash) -> address, enabled?() -> boolean,
//              attachments?() -> boolean, fileTypes?: RegExp })
//
//   * match      says whether the file at `url` that the server answered with `contentType` is the viewer's.
//   * page       the address of the viewer page that shows `url` (the tab's own address stays `url`: the window maps it back).
//   * enabled    the viewer's on/off switch (a Settings choice); a switched-off viewer never takes anything.
//   * attachments  true when the viewer also takes answers the server marked "attachment" (a Download button on a site); the
//                default is false: a site that says "save this" is believed.
//   * fileTypes  matches a file: address, for takeDownload (below).
//
// Two seams use it:
//   take(details, callback)      from the session's onHeadersReceived: an answer to a main-frame navigation that a viewer wants is
//                                turned into a redirect to the viewer page, so the tab makes one ordinary navigation (cancelling the
//                                request and loading the page from here instead froze the main process once, measured 2026-10-25).
//   takeDownload(event, item, wc)  from the session's will-download (run before the Downloads panel's own listener): a file: address
//                                that Chromium turned into a download because it cannot show it is sent to the viewer instead.
//
// "Download instead" in a viewer calls allowOnce(webContentsId, url): the next answer for that address in that tab is let through.

const BYPASS_MS = 20000;

function headerValue(headers, name) {
  if (!headers) return '';
  const want = name.toLowerCase();
  for (const key of Object.keys(headers)) if (key.toLowerCase() === want) return [].concat(headers[key])[0] || '';
  return '';
}

// deps: { isGuest(webContents) -> boolean }  (a tab's page, in a Vex window; never a Vex window's own page)
function createDocViewerRegistry(deps = {}) {
  const entries = [];
  const bypass = new Map();      // `${webContentsId} ${address}` -> expiry
  const key = (id, url) => id + ' ' + String(url).replace(/#.*$/, '');

  function register(entry) {
    if (!entry || !entry.id || typeof entry.match !== 'function' || typeof entry.page !== 'function') throw new Error('A viewer needs an id, match() and page()');
    if (entries.some((e) => e.id === entry.id)) throw new Error('A viewer called "' + entry.id + '" is already registered');
    entries.push(entry);
    return entry;
  }
  const on = (e) => (typeof e.enabled === 'function' ? !!e.enabled() : true);

  function allowOnce(webContentsId, url) { bypass.set(key(webContentsId, url), Date.now() + BYPASS_MS); }
  function consumeBypass(webContentsId, url) {
    const k = key(webContentsId, url);
    const until = bypass.get(k);
    if (until == null) return false;
    bypass.delete(k);
    return until > Date.now();
  }

  function viewerFor(url, contentType) {
    for (const e of entries) if (on(e) && e.match(String(url || ''), String(contentType || ''))) return e;
    return null;
  }

  // true = the navigation was taken over and the callback has been answered
  function take(details, callback) {
    if (!details || details.resourceType !== 'mainFrame') return false;
    if (!(details.statusCode >= 200 && details.statusCode < 300)) return false;
    if (!/^https?:\/\//i.test(String(details.url || ''))) return false;
    const type = headerValue(details.responseHeaders, 'content-type');
    const entry = viewerFor(details.url, type);
    if (!entry) return false;
    if (/^\s*attachment/i.test(headerValue(details.responseHeaders, 'content-disposition')) && !(typeof entry.attachments === 'function' && entry.attachments())) return false;
    const wc = details.webContents;
    if (!deps.isGuest || !deps.isGuest(wc)) return false;
    if (consumeBypass(wc.id, details.url)) return false;
    let pending;
    try { pending = wc.getURL() || ''; } catch { pending = ''; }
    const frag = pending.replace(/#.*$/, '') === details.url.replace(/#.*$/, '') && pending.includes('#') ? pending.slice(pending.indexOf('#') + 1) : '';
    callback({ statusLine: 'HTTP/1.1 302 Found', responseHeaders: { location: [entry.page(details.url, frag)], 'content-length': ['0'], 'cache-control': ['no-store'] } });
    return true;
  }

  // Called from a session's will-download. A file: download is sent to its viewer: the download is cancelled (event.preventDefault())
  // and the tab loads the viewer page. The Downloads panel's listener checks event.defaultPrevented and leaves it alone.
  function takeDownload(event, item, contents) {
    let url = '';
    try { url = item.getURL(); } catch { return false; }
    if (!/^file:\/\//i.test(url)) return false;
    if (!contents || contents.isDestroyed() || !deps.isGuest || !deps.isGuest(contents)) return false;
    if (consumeBypass(contents.id, url)) return false;
    for (const e of entries) {
      if (!on(e) || !(e.fileTypes instanceof RegExp) || !e.fileTypes.test(url.replace(/[?#].*$/, ''))) continue;
      event.preventDefault();
      const page = e.page(url, '');
      // After this event has finished: loading from inside it would run before the cancelled download is gone.
      setImmediate(() => { try { if (!contents.isDestroyed()) contents.loadURL(page); } catch (err) { console.error('[Viewers] could not show ' + url + ' in "' + e.id + '":', err.message); } });
      return true;
    }
    return false;
  }

  // A link click to a file: address inside a tab (will-navigate): the same, without the download ever starting.
  function takeNavigation(event, url, contents) {
    if (!/^file:\/\//i.test(String(url || ''))) return false;
    if (!contents || contents.isDestroyed() || !deps.isGuest || !deps.isGuest(contents)) return false;
    if (consumeBypass(contents.id, url)) return false;
    for (const e of entries) {
      if (!on(e) || !(e.fileTypes instanceof RegExp) || !e.fileTypes.test(String(url).replace(/[?#].*$/, ''))) continue;
      event.preventDefault();
      contents.loadURL(e.page(url, ''));
      return true;
    }
    return false;
  }

  return { register, take, takeDownload, takeNavigation, viewerFor, allowOnce, consumeBypass, entries, headerValue };
}

module.exports = { createDocViewerRegistry, headerValue, BYPASS_MS };

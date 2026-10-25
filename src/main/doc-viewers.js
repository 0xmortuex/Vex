'use strict';
// === Document viewers: how a navigation to a document is taken over by a page of Vex's own =====
//
// Vex shows some documents with a page of its own instead of Chromium's bare view (or instead of a download): text-like files, pictures,
// sound and video, office documents and e-books. This file is the ONE registry they share, so the catch lives in one place and a new kind
// of document is one register() call:
//
//   registry.register({
//     id: 'image',                                  // short name
//     isEnabled() -> boolean  (or enabled())        // the person's switch (default true); a switched-off viewer takes nothing
//     match(url, contentType, details) -> boolean   // does THIS answer belong to the viewer? Content-Type first
//     page(originalUrl, fragment) -> string         // the address of the viewer page that shows the document
//     wire?(session, partition)                     // serve the viewer's own scheme on that session
//     attachments?() -> boolean                     // also take answers the server marked "attachment" (default: no, a site that says
//                                                   // "save this" is believed)
//     fileTypes?: RegExp                            // file: addresses the viewer takes (takeDownload / takeNavigation)
//   })
//
// What the registry does for every kind, so a viewer cannot get it wrong:
//   * ONLY a main-frame navigation (details.resourceType === 'mainFrame'): never an <img>, never a sub-frame, never a page that merely
//     contains the document;
//   * only a GET that really answered 2xx on an http(s) address, and not a download (Content-Disposition: attachment), unless the viewer
//     asked for those;
//   * only a page of a Vex window (owner(contents)), never a Vex-internal or extension page;
//   * the answer becomes a 302 to the viewer page, so the tab makes ONE ordinary navigation (cancelling the request and loading the
//     viewer from main froze the main process when the PDF viewer tried it, 2026-10-25). The viewer then reads the document through the
//     SAME session the tab runs in, so a private or Tor tab never fetches through another session;
//   * "Download instead" / "Open in the browser's own view" mark one navigation as not to be caught (allowOnce).
//
// Three seams: take(details, callback) is the one line each onHeadersReceived handler in main.js starts with; takeDownload(event, item,
// contents) runs first on a session's will-download (a file: address Chromium turned into a download goes to its viewer instead);
// takeNavigation(event, url, contents) is the same for a link click to a file: address (will-navigate).

const BYPASS_MS = 20000;

function headerValue(headers, name) {
  if (!headers) return '';
  const want = name.toLowerCase();
  for (const key of Object.keys(headers)) if (key.toLowerCase() === want) return [].concat(headers[key])[0] || '';
  return '';
}

// deps: { owner(contents) -> truthy for a page of a Vex window, isGuest?(contents) (replaces the owner-based test), log?(msg) }
function createDocViewers(deps) {
  if (!deps || (typeof deps.owner !== 'function' && typeof deps.isGuest !== 'function')) throw new Error('createDocViewers needs owner() or isGuest()');
  const entries = [];
  const bypass = new Map();      // `${webContentsId} ${address}` -> expiry
  const wired = new WeakMap();   // session -> Set of entry ids already wired
  const log = (msg) => { if (deps.log) deps.log(msg); };

  const bypassKey = (id, url) => id + ' ' + String(url).replace(/#.*$/, '');

  function register(entry) {
    if (!entry || typeof entry.id !== 'string' || typeof entry.match !== 'function' || typeof entry.page !== 'function') {
      throw new Error('A document viewer needs an id, match() and page()');
    }
    if (entries.some((e) => e.id === entry.id)) throw new Error('A document viewer called ' + entry.id + ' is already registered');
    entries.push(entry);
    return entry;
  }

  // allowOnce(webContentsId, url). The three-argument form (viewerId, webContentsId, url) is accepted too; the viewer id is not part of the key.
  function allowOnce(...args) { const [id, url] = args.slice(-2); bypass.set(bypassKey(id, url), Date.now() + BYPASS_MS); }
  function consumeBypass(...args) {
    const [id, url] = args.slice(-2);
    const key = bypassKey(id, url);
    const until = bypass.get(key);
    if (until == null) return false;
    bypass.delete(key);
    return until > Date.now();
  }

  function isGuest(wc) {
    try {
      if (deps.isGuest) return !!deps.isGuest(wc);
      return !!wc && !wc.isDestroyed() && wc.getType() === 'webview' && !!deps.owner(wc);
    } catch { return false; }
  }

  function isOn(e) {
    try {
      if (typeof e.isEnabled === 'function') return e.isEnabled() !== false;
      if (typeof e.enabled === 'function') return !!e.enabled();
      return true;
    } catch (err) { log('[doc-viewers] ' + e.id + ' switch failed: ' + err.message); return false; }
  }

  function viewerFor(url, contentType, details) {
    for (const e of entries) {
      if (!isOn(e)) continue;
      let hit = false;
      try { hit = !!e.match(String(url || ''), String(contentType || ''), details); } catch (err) { log('[doc-viewers] ' + e.id + '.match failed: ' + err.message); }
      if (hit) return e;
    }
    return null;
  }

  // true = the navigation was taken over and the callback has been answered.
  function take(details, callback) {
    if (!details || details.resourceType !== 'mainFrame' || !entries.length) return false;
    if (details.method && String(details.method).toUpperCase() !== 'GET') return false;
    if (!(details.statusCode >= 200 && details.statusCode < 300)) return false;
    if (!/^https?:\/\//i.test(String(details.url || ''))) return false;
    const type = headerValue(details.responseHeaders, 'content-type');
    const entry = viewerFor(details.url, type, details);
    if (!entry) return false;
    if (/^\s*attachment/i.test(headerValue(details.responseHeaders, 'content-disposition')) && !(typeof entry.attachments === 'function' && entry.attachments())) return false;
    const wc = details.webContents;
    if (!isGuest(wc)) return false;
    if (consumeBypass(wc.id, details.url)) return false;
    // A #fragment the person typed or followed is not part of the request; the tab's own pending address has it.
    let pending;
    try { pending = wc.getURL() || ''; } catch { pending = ''; }
    const frag = pending.replace(/#.*$/, '') === details.url.replace(/#.*$/, '') && pending.includes('#') ? pending.slice(pending.indexOf('#') + 1) : '';
    callback({ statusLine: 'HTTP/1.1 302 Found', responseHeaders: { location: [entry.page(details.url, frag)], 'content-length': ['0'], 'cache-control': ['no-store'] } });
    return true;
  }

  function fileViewerFor(url) {
    const bare = String(url || '').replace(/[?#].*$/, '');
    for (const e of entries) if (isOn(e) && e.fileTypes instanceof RegExp && e.fileTypes.test(bare)) return e;
    return null;
  }

  // Called from a session's will-download. A file: download is sent to its viewer: the download is cancelled (event.preventDefault())
  // and the tab loads the viewer page. The Downloads panel's listener checks event.defaultPrevented and leaves it alone.
  function takeDownload(event, item, contents) {
    let url = '';
    try { url = item.getURL(); } catch { return false; }
    if (!/^file:\/\//i.test(url)) return false;
    if (!contents || contents.isDestroyed() || !isGuest(contents)) return false;
    if (consumeBypass(contents.id, url)) return false;
    const e = fileViewerFor(url);
    if (!e) return false;
    event.preventDefault();
    const page = e.page(url, '');
    // After this event has finished: loading from inside it would run before the cancelled download is gone.
    setImmediate(() => { try { if (!contents.isDestroyed()) contents.loadURL(page); } catch (err) { console.error('[Viewers] could not show ' + url + ' in "' + e.id + '":', err.message); } });
    return true;
  }

  // A link click to a file: address inside a tab (will-navigate): the same, without the download ever starting.
  function takeNavigation(event, url, contents) {
    if (!/^file:\/\//i.test(String(url || ''))) return false;
    if (!contents || contents.isDestroyed() || !isGuest(contents)) return false;
    if (consumeBypass(contents.id, url)) return false;
    const e = fileViewerFor(url);
    if (!e) return false;
    event.preventDefault();
    contents.loadURL(e.page(url, ''));
    return true;
  }

  // Each viewer serves its own scheme on every session a tab can run in.
  function wireSession(ses, partition) {
    if (!ses) return;
    let done = wired.get(ses);
    if (!done) { done = new Set(); wired.set(ses, done); }
    for (const e of entries) {
      if (done.has(e.id) || typeof e.wire !== 'function') continue;
      done.add(e.id);
      e.wire(ses, partition);
    }
  }

  return { register, take, takeDownload, takeNavigation, wireSession, viewerFor, allowOnce, consumeBypass, isGuest, entries: () => entries.slice(), ids: () => entries.map((e) => e.id), headerValue };
}

module.exports = { createDocViewers, createDocViewerRegistry: createDocViewers, headerValue, BYPASS_MS };

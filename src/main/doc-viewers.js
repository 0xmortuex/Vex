'use strict';
// === Document viewers: how a main-frame navigation to a document is taken over ===============
//
// Vex shows some documents with a page of its own instead of Chromium's bare view (images today; a PDF, text, media and
// folders are built the same way by their own modules). This file is the small registry they share, so the catch lives in
// ONE place and a new kind of document is one `register()` call:
//
//   registry.register({
//     id: 'image',                       // short name; also the bypass key's owner
//     isEnabled() -> boolean,            // the person's switch (default true)
//     match(url, contentType, details) -> boolean,   // does THIS response belong to the viewer? Content-Type first
//     page(originalUrl, fragment) -> string,         // the address of the viewer page for that document
//     wire?(session, partition),         // optional: serve the viewer's own scheme on that session
//   })
//
// What the registry does for every kind, so a viewer cannot get it wrong:
//   * ONLY a main-frame navigation (details.resourceType === 'mainFrame'): never an <img>, never a sub-frame, never a page that
//     merely contains the document;
//   * only a GET that really answered 2xx on an http(s) address, and not a download (Content-Disposition: attachment);
//   * only a page of a Vex window (owner(contents)), never a Vex-internal or extension page;
//   * the answer is turned into a 302 to the viewer page, so the tab makes ONE ordinary navigation (cancelling the request and
//     loading the viewer from main froze the main process when the PDF viewer tried it, 2026-10-25). The viewer then reads the
//     document through the SAME session the tab runs in, so a private or Tor tab never fetches through another session;
//   * "Open in the browser's own view" marks one navigation as not to be caught (allowOnce).
//
// take(details, callback) is the one line each onHeadersReceived handler in main.js starts with.

const BYPASS_MS = 20000;

function headerValue(headers, name) {
  if (!headers) return '';
  const want = name.toLowerCase();
  for (const key of Object.keys(headers)) if (key.toLowerCase() === want) return [].concat(headers[key])[0] || '';
  return '';
}

// deps: { owner(contents) -> truthy for a page of a Vex window, log?(msg) }
function createDocViewers(deps) {
  if (!deps || typeof deps.owner !== 'function') throw new Error('createDocViewers needs owner()');
  const entries = [];
  const bypass = new Map();      // `${webContentsId} ${address}` -> expiry
  const wired = new WeakMap();   // session -> Set of entry ids already wired

  const bypassKey = (id, url) => id + ' ' + String(url).replace(/#.*$/, '');

  function register(entry) {
    if (!entry || typeof entry.id !== 'string' || typeof entry.match !== 'function' || typeof entry.page !== 'function') {
      throw new Error('A document viewer needs an id, match() and page()');
    }
    if (entries.some((e) => e.id === entry.id)) throw new Error('A document viewer called ' + entry.id + ' is already registered');
    entries.push(entry);
    return entry;
  }

  function allowOnce(webContentsId, url) { bypass.set(bypassKey(webContentsId, url), Date.now() + BYPASS_MS); }
  function consumeBypass(webContentsId, url) {
    const key = bypassKey(webContentsId, url);
    const until = bypass.get(key);
    if (until == null) return false;
    bypass.delete(key);
    return until > Date.now();
  }

  function isGuest(wc) {
    try { return !!wc && !wc.isDestroyed() && wc.getType() === 'webview' && !!deps.owner(wc); } catch { return false; }
  }

  // true = the navigation was taken over and the callback has been answered.
  function take(details, callback) {
    if (!details || details.resourceType !== 'mainFrame' || !entries.length) return false;
    if (details.method && String(details.method).toUpperCase() !== 'GET') return false;
    if (!(details.statusCode >= 200 && details.statusCode < 300)) return false;
    if (!/^https?:\/\//i.test(String(details.url || ''))) return false;
    if (/^\s*attachment/i.test(headerValue(details.responseHeaders, 'content-disposition'))) return false;
    const type = headerValue(details.responseHeaders, 'content-type');
    let entry = null;
    for (const e of entries) {
      let on = true;
      try { on = e.isEnabled ? e.isEnabled() !== false : true; } catch { on = false; }
      if (!on) continue;
      let hit = false;
      try { hit = !!e.match(details.url, type, details); } catch (err) { if (deps.log) deps.log('[doc-viewers] ' + e.id + '.match failed: ' + err.message); }
      if (hit) { entry = e; break; }
    }
    if (!entry) return false;
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

  return { register, take, wireSession, allowOnce, consumeBypass, isGuest, entries: () => entries.slice() };
}

module.exports = { createDocViewers, headerValue, BYPASS_MS };

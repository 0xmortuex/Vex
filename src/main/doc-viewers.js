'use strict';
// === Documents that Vex shows in a page of its own: the registry ================
//
// A main-frame navigation whose RESPONSE is a document of a kind Vex has a viewer for (a text document, a PDF, an image, a
// folder listing, ...) is turned into one ordinary redirect to that viewer's page, while the tab keeps showing the original
// address (the window maps the viewer's address back, js/webview.js). Each kind of viewer registers one small entry:
//
//   registry.register({ id: 'text', match(url, contentType, details) { -> boolean }, page(url, fragment) { -> viewer address } })
//
// and every session's onHeadersReceived calls   if (registry.take(details, callback)) return;   as its first line.
//
// What is taken: only the TOP-LEVEL navigation (resourceType mainFrame, a GET, a 2xx answer, not an attachment, in a tab of a
// Vex window). A page's own fetch() or XHR, an image, a script, an iframe: never. A site that serves JSON to a program still
// sends the program the raw bytes; only a person who navigated to it sees the viewer.
// "Open the browser's own view" asks for one navigation to be let through (allowOnce), which is how a viewer's Raw button works.

const BYPASS_MS = 20000;

function headerValue(headers, name) {
  if (!headers) return '';
  const want = name.toLowerCase();
  for (const key of Object.keys(headers)) if (key.toLowerCase() === want) return [].concat(headers[key])[0] || '';
  return '';
}

// deps: { isEnabled?() , owner(contents) -> truthy for a page of a Vex window }
function createDocViewerRegistry(deps) {
  const owner = deps && deps.owner;
  if (typeof owner !== 'function') throw new Error('createDocViewerRegistry needs owner(contents)');
  const isEnabled = deps.isEnabled || (() => true);
  const kinds = [];
  const bypass = new Map();      // `${webContentsId} ${address}` -> expiry

  const key = (id, url) => id + ' ' + String(url).replace(/#.*$/, '');

  function register(entry) {
    if (!entry || typeof entry.id !== 'string' || typeof entry.match !== 'function' || typeof entry.page !== 'function') {
      throw new Error('A document viewer needs an id, match(url, contentType) and page(url, fragment)');
    }
    if (kinds.some((k) => k.id === entry.id)) throw new Error('A document viewer named ' + entry.id + ' is already registered');
    kinds.push(entry);
  }

  function allowOnce(webContentsId, url) { bypass.set(key(webContentsId, url), Date.now() + BYPASS_MS); }
  function consumeBypass(webContentsId, url) {
    const k = key(webContentsId, url);
    const until = bypass.get(k);
    if (until == null) return false;
    bypass.delete(k);
    return until > Date.now();
  }

  function isGuest(wc) {
    try { return !!wc && !wc.isDestroyed() && wc.getType() === 'webview' && !!owner(wc); } catch { return false; }
  }

  // Called with the details and the callback of onHeadersReceived. true = the navigation was taken over and the callback answered.
  function take(details, callback) {
    if (!details || details.resourceType !== 'mainFrame' || !kinds.length || !isEnabled()) return false;
    if (details.method && details.method !== 'GET') return false;
    if (!(details.statusCode >= 200 && details.statusCode < 300)) return false;
    if (!/^https?:\/\//i.test(String(details.url || ''))) return false;
    if (/^\s*attachment/i.test(headerValue(details.responseHeaders, 'content-disposition'))) return false;
    const type = headerValue(details.responseHeaders, 'content-type');
    const kind = kinds.find((k) => { try { return k.match(details.url, type, details); } catch { return false; } });
    if (!kind) return false;
    const wc = details.webContents;
    if (!isGuest(wc)) return false;
    if (consumeBypass(wc.id, details.url)) return false;
    // A #fragment the person typed or followed is not part of the request; the tab's own pending address has it.
    let pending;
    try { pending = wc.getURL() || ''; } catch { pending = ''; }
    const frag = pending.replace(/#.*$/, '') === details.url.replace(/#.*$/, '') && pending.includes('#') ? pending.slice(pending.indexOf('#') + 1) : '';
    // The answer is turned into a redirect to the viewer: the tab makes one single, ordinary navigation.
    callback({ statusLine: 'HTTP/1.1 302 Found', responseHeaders: { location: [kind.page(details.url, frag)], 'content-length': ['0'], 'cache-control': ['no-store'] } });
    return true;
  }

  return { register, take, allowOnce, consumeBypass, isGuest, kinds };
}

module.exports = { createDocViewerRegistry, headerValue, BYPASS_MS };

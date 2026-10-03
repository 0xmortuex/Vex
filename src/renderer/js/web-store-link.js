// === Chrome Web Store links ================================================
// Which extension a Chrome Web Store link (or a bare id) names. Shared by the
// interface (the "Add to Vex" button, Settings › Extensions, the command bar)
// and by main (src/main/webstore.js), which decides for itself: whatever the
// interface sends is parsed again there, and anything that is not one of these
// is refused.
//
// An extension id is 32 letters from a to p (the first 16 bytes of the
// SHA-256 of its public key, one letter per hex digit). The store's pages are
//   https://chromewebstore.google.com/detail/<name>/<id>   (and /detail/<id>)
//   https://chrome.google.com/webstore/detail/<name>/<id>  (the old store)
(function () {
  const ID = /^[a-p]{32}$/;
  const HOSTS = { 'chromewebstore.google.com': '/detail/', 'chrome.google.com': '/webstore/detail/' };

  // The id in a store detail page's address, or null when the address is not one.
  function idFromUrl(url) {
    let u;
    try { u = new URL(String(url)); } catch { return null; }
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    const prefix = HOSTS[u.hostname.toLowerCase()];
    if (!prefix || !u.pathname.toLowerCase().startsWith(prefix)) return null;
    const parts = u.pathname.slice(prefix.length).split('/').filter(Boolean).map(p => p.toLowerCase());
    // /detail/<name>/<id> or /detail/<id>; the id is the last part that is one.
    for (let i = parts.length - 1; i >= 0; i--) if (ID.test(parts[i])) return parts[i];
    return null;
  }

  // An id or a store link, as pasted. Throws, in words, for anything else.
  function extensionIdFrom(input) {
    if (typeof input !== 'string') throw new TypeError('extensionIdFrom: expected a string');
    const text = input.trim();
    if (!text) throw new Error('Paste a Chrome Web Store link or an extension id first.');
    if (ID.test(text.toLowerCase())) return text.toLowerCase();
    const id = idFromUrl(text);
    if (id) return id;
    let host = '';
    try { host = new URL(text).hostname.toLowerCase(); } catch { /* not an address */ }
    if (Object.prototype.hasOwnProperty.call(HOSTS, host)) {
      throw new Error('That Web Store page is not an extension\'s page. Open the extension itself and copy that address.');
    }
    throw new Error('That is not a Chrome Web Store link. Paste the address of an extension\'s page on chromewebstore.google.com, or its 32-letter id.');
  }

  const api = { ID, idFromUrl, extensionIdFrom };
  if (typeof window !== 'undefined') window.VexWebStoreLink = Object.freeze(api);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();

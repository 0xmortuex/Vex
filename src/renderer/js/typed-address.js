// === What a typed line means: an address to open, or words to search ===
//
// The address bar, the command bar's "Go to" row and Paste & Go each had their
// own guess, and all three were wrong in the same ways (2026-09-29):
//   * the check was not anchored, so "node.js tutorial" opened
//     https://node.js tutorial and "example.com is down" a broken address;
//   * localhost, 127.0.0.1:8080, 192.168.1.1, [::1]:3000, about:blank,
//     file:///… and my-server:3000 were searched on Google instead of opened;
//   * only Google, DuckDuckGo and Brave were known, so choosing Bing,
//     Startpage or Ecosia (offered by setup and the New Tab page) still
//     searched Google.
// One answer now, used by all of them.
(function () {
  // Kept in step with the New Tab page's list (start.html ENGINES).
  const SEARCH_ENGINES = {
    google:     { name: 'Google',     q: 'https://www.google.com/search?q=%s' },
    bing:       { name: 'Bing',       q: 'https://www.bing.com/search?q=%s' },
    duckduckgo: { name: 'DuckDuckGo', q: 'https://duckduckgo.com/?q=%s' },
    brave:      { name: 'Brave',      q: 'https://search.brave.com/search?q=%s' },
    startpage:  { name: 'Startpage',  q: 'https://www.startpage.com/sp/search?query=%s' },
    ecosia:     { name: 'Ecosia',     q: 'https://www.ecosia.org/search?q=%s' },
  };

  const SCHEME = /^(https?|file|about|vex|view-source|chrome|data|mailto|blob):/i;
  const LOCAL_HOST = /^(localhost|\d{1,3}(\.\d{1,3}){3}|\[[0-9a-f:.]+\])(:\d{1,5})?([/?#]\S*)?$/i;
  const DOMAIN = /^[a-z0-9]([a-z0-9-]*\.)+[a-z]{2,}\.?(:\d{1,5})?([/?#]\S*)?$/i;
  const HOST_WITH_PORT = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?:\d{2,5}([/?#]\S*)?$/i;

  // The address a line names, or null when it is words to search for.
  function addressFor(text) {
    const t = String(text || '').trim();
    if (!t) return null;
    // Typed with its scheme, it is an address as it stands (a space in one is
    // encoded when it loads). Without one, an address has no spaces.
    if (SCHEME.test(t)) return t;
    if (/\s/.test(t)) return null;
    if (LOCAL_HOST.test(t) || HOST_WITH_PORT.test(t)) return 'http://' + t;
    if (DOMAIN.test(t)) return 'https://' + t;
    return null;
  }

  function engineOf(id) { return SEARCH_ENGINES[id] ? id : 'google'; }

  // The engine chosen in Settings, setup or on the New Tab page (all three
  // keep it in vex.searchEngine).
  function currentEngine() {
    try { return engineOf(localStorage.getItem('vex.searchEngine')); }
    catch (err) { console.warn('[Search] could not read the chosen engine:', err && err.message); return 'google'; }
  }

  // Omit engineId for the chosen engine.
  function searchUrl(text, engineId) {
    const id = engineId === undefined ? currentEngine() : engineOf(engineId);
    return SEARCH_ENGINES[id].q.replace('%s', encodeURIComponent(String(text || '').trim()));
  }

  const api = { SEARCH_ENGINES, addressFor, engineOf, currentEngine, searchUrl };
  if (typeof window !== 'undefined') window.VexTypedAddress = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();

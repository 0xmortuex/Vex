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
  // The New Tab page loads this file and offers exactly these (start.html).
  // `suggest` is the engine's own suggestion address (all six answer in the
  // OpenSearch shape ["query", ["one", "two", ...]]). Suggestions used to go
  // to Google whatever engine was chosen; now they go only to the engine you
  // search with, and an engine without one gets none (src/main.js, web-suggest).
  const SEARCH_ENGINES = {
    google:     { name: 'Google',     q: 'https://www.google.com/search?q=%s',           suggest: 'https://suggestqueries.google.com/complete/search?client=firefox&q=%s' },
    bing:       { name: 'Bing',       q: 'https://www.bing.com/search?q=%s',             suggest: 'https://api.bing.com/osjson.aspx?query=%s' },
    duckduckgo: { name: 'DuckDuckGo', q: 'https://duckduckgo.com/?q=%s',                 suggest: 'https://duckduckgo.com/ac/?q=%s&type=list' },
    brave:      { name: 'Brave',      q: 'https://search.brave.com/search?q=%s',         suggest: 'https://search.brave.com/api/suggest?q=%s' },
    startpage:  { name: 'Startpage',  q: 'https://www.startpage.com/sp/search?query=%s', suggest: 'https://www.startpage.com/osuggestions?q=%s' },
    ecosia:     { name: 'Ecosia',     q: 'https://www.ecosia.org/search?q=%s',           suggest: 'https://ac.ecosia.org/autocomplete?q=%s&type=list' },
  };

  // Settings › General › Search suggestions. Missing means on: what you type
  // goes to the engine you already search with, never anywhere else.
  const SUGGEST_KEY = 'vex.searchSuggest';
  function suggestionsOn(value) { return value !== 'off'; }

  const SCHEME = /^(https?|file|about|vex|view-source|chrome|data|mailto|blob):/i;
  const LOCAL_HOST = /^(localhost|\d{1,3}(\.\d{1,3}){3}|\[[0-9a-f:.]+\])(:\d{1,5})?([/?#]\S*)?$/i;
  // Letters of any script, so münchen.de, www.bücher.de/katalog and
  // пример.рф open instead of being searched (found 2026-09-29). The browser
  // turns them into xn-- names when it loads them; an xn-- top level typed
  // by hand opens too.
  const DOMAIN = /^[\p{L}\p{N}]([\p{L}\p{M}\p{N}-]*\.)+(\p{L}[\p{L}\p{M}]+|xn--[a-z0-9-]+)\.?(:\d{1,5})?([/?#]\S*)?$/iu;
  // A bare name with a port (my-server:3000). The port has 3-5 digits and an
  // all-capitals word is a label, not a host: "time:10" and "ISBN:12345"
  // opened as http://time:10 and http://ISBN:12345 (found 2026-09-29).
  const HOST_WITH_PORT = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?:\d{3,5}([/?#]\S*)?$/i;
  const ALL_CAPS_LABEL = /^[A-Z]+:/;
  // C:\x, C:\Windows\win.ini, c:/x/y.html and \\server\share were searched
  // instead of opened (found 2026-09-29).
  const DRIVE_PATH = /^[a-z]:[\\/]/i;
  const UNC_PATH = /^\\\\[^\\/\s]+[\\/]/;
  // "index.html", "readme.md" and "node.js" opened as broken addresses: typed
  // alone, a name ending in a file type is a file name to search for, not a
  // site. Only the bare form: with www., a path or a port it is still an
  // address (www.readme.md, example.md/x, notes.md:8080). The trade-off: .md
  // (Moldova), .py (Paraguay), .zip and .mov are real top-level names, so a bare
  // "site.md" is searched too; type www., a path or https:// to open one.
  // Not rs, sh or io: docs.rs, bun.sh and example.io are real sites.
  const FILE_TYPES = new Set(['html', 'htm', 'xhtml', 'md', 'markdown', 'js', 'mjs', 'cjs', 'jsx', 'ts', 'tsx',
    'py', 'json', 'txt', 'css', 'scss', 'exe', 'msi', 'dll', 'bat', 'cmd', 'ps1', 'zip', 'rar', '7z', 'tar', 'gz',
    'pdf', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico', 'mp3', 'mp4', 'mov', 'wav', 'avi', 'mkv',
    'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'csv', 'xml', 'yml', 'yaml', 'ini', 'log', 'cfg', 'toml',
    'java', 'cpp', 'hpp', 'php', 'rb', 'swift', 'kt', 'vue', 'lock']);

  function isBareFileName(t) {
    if (/^www\./i.test(t) || /[:/?#]/.test(t)) return false;
    const last = t.replace(/\.$/, '').split('.').pop().toLowerCase();
    return FILE_TYPES.has(last);
  }

  // A # or % in a Windows path is part of a name: "C:\dev\c#\notes.txt" opened
  // C:\dev\c with "\notes.txt" as a fragment, and "100%.txt" made an address
  // that could not be read (found 2026-10-10).
  function fileUrlFor(t) {
    const p = t.replace(/\\/g, '/').replace(/%/g, '%25').replace(/#/g, '%23');
    if (DRIVE_PATH.test(t)) return 'file:///' + p;
    return 'file:' + p;
  }

  // The real top-level domains (js/tld-list.js, IANA's list plus local network
  // names). Any word after a dot counted, so "document.getElementById" and
  // "e.coli" opened as broken addresses (found 2026-10-10).
  const TLDS = (typeof window !== 'undefined' && window.VexTlds) ||
    (typeof require === 'function' ? require('./tld-list.js') : null);
  if (!TLDS) throw new Error('js/tld-list.js must load before js/typed-address.js');
  function knownTld(t) {
    const host = t.split(/[:/?#]/)[0].replace(/\.$/, '');
    return TLDS.has(host.slice(host.lastIndexOf('.') + 1).toLowerCase());
  }
  // A bare name with nothing after it: the only kind that can be words.
  const BARE_NAME = /^[^:/?#]+$/;

  // An IPv4 address has four parts of at most 255: "999.1.1.1" opened.
  function realIpv4(t) {
    const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})(?=$|[:/?#])/.exec(t);
    return !m || m.slice(1).every(n => Number(n) <= 255);
  }

  // A one-word intranet name and a slash, as Chrome opens it: "router/",
  // "nas/admin" were searched. Not a number: "24/7" and "1/2" are words. With
  // a path, only a name already visited: "nas/admin" and "and/or" look alike.
  const INTRANET_PATH = /^(?=[a-z0-9-]*[a-z])[a-z0-9]([a-z0-9-]*[a-z0-9])?\/\S*$/i;
  function intranetAddress(t) {
    if (!INTRANET_PATH.test(t)) return false;
    const host = t.slice(0, t.indexOf('/')).toLowerCase();
    if (t.length === host.length + 1) return true;
    const list = (typeof HistoryPanel !== 'undefined' && HistoryPanel.list) ? HistoryPanel.list() : [];
    return list.some(e => { try { return new URL(e.url).hostname.toLowerCase() === host; } catch { return false; } });
  }

  // The address a line names, or null when it is words to search for.
  function addressFor(text) {
    const t = String(text || '').trim();
    if (!t) return null;
    // Typed with its scheme, it is an address as it stands (a space in one is
    // encoded when it loads). So is a Windows path, whose folders often have
    // spaces. Without one, an address has no spaces.
    if (SCHEME.test(t)) return t;
    if (DRIVE_PATH.test(t) || UNC_PATH.test(t)) return fileUrlFor(t);
    if (/\s/.test(t)) return null;
    if (LOCAL_HOST.test(t)) return realIpv4(t) ? 'http://' + t : null;
    if (HOST_WITH_PORT.test(t) && !ALL_CAPS_LABEL.test(t)) return 'http://' + t;
    if (intranetAddress(t)) return 'http://' + t;
    if (DOMAIN.test(t) && !isBareFileName(t) && (!BARE_NAME.test(t) || knownTld(t))) return 'https://' + t;
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

  // The address that asks engineId for suggestions for text, or null when
  // that engine has none.
  function suggestUrl(text, engineId) {
    const e = SEARCH_ENGINES[engineOf(engineId)];
    const q = String(text || '').trim();
    if (!e.suggest || !q) return null;
    return e.suggest.replace('%s', encodeURIComponent(q));
  }

  // Shape every suggestion answer as string[]; anything else is [].
  function parseSuggestions(raw) {
    try {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr) && Array.isArray(arr[1])) return arr[1].filter(s => typeof s === 'string');
    } catch { /* not JSON: an error page, a block page */ }
    return [];
  }

  // Where a typed line goes, the one answer for the address bar, Ctrl+K and
  // the New Tab box: they each made their own, so "@yt cats" or a keyword of
  // your own worked in one and not the others (found 2026-10-10).
  // → { kind: 'address'|'keyword'|'search', url, name?, query?, guessedHttps? }
  // or null for nothing typed. guessedHttps: the address had no scheme and
  // https was guessed, so a failed load may try http (WebviewManager.navigate).
  function resolve(text, engineId) {
    const t = String(text || '').trim();
    if (!t) return null;
    const address = addressFor(t);
    if (address) return { kind: 'address', url: address, guessedHttps: !SCHEME.test(t) && address.startsWith('https://') };
    const SS = (typeof window !== 'undefined' && window.SearchShortcuts) ||
      (typeof require === 'function' ? require('./search-shortcuts.js').SearchShortcuts : null);
    if (!SS) throw new Error('js/search-shortcuts.js is not loaded, so search keywords cannot be read');
    const k = SS.resolveKeywordSearch(t);
    if (k) return { kind: 'keyword', url: k.url, name: k.name, query: k.query };
    const id = engineId === undefined ? currentEngine() : engineOf(engineId);
    return { kind: 'search', url: searchUrl(t, id), name: SEARCH_ENGINES[id].name, query: t };
  }

  const api = { SEARCH_ENGINES, SUGGEST_KEY, addressFor, resolve, engineOf, currentEngine, searchUrl, suggestUrl, suggestionsOn, parseSuggestions };
  if (typeof window !== 'undefined') window.VexTypedAddress = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();

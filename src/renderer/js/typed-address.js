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

  function fileUrlFor(t) {
    if (DRIVE_PATH.test(t)) return 'file:///' + t.replace(/\\/g, '/');
    return 'file:' + t.replace(/\\/g, '/');
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
    if (LOCAL_HOST.test(t)) return 'http://' + t;
    if (HOST_WITH_PORT.test(t) && !ALL_CAPS_LABEL.test(t)) return 'http://' + t;
    if (DOMAIN.test(t) && !isBareFileName(t)) return 'https://' + t;
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

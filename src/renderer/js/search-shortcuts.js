// === Vex Search Shortcuts — keyword engines + DuckDuckGo bangs ===
//
// Resolve a typed address-bar query that isn't a URL into a site-specific search
// BEFORE falling back to the default engine:
//   • keyword engines —  "yt cats"  → YouTube,  "gh vex" → GitHub,  "w einstein"
//     → Wikipedia. First word is the keyword, the rest is the query.
//   • DuckDuckGo bangs —  "!w einstein", "einstein !yt"  → routed through DDG,
//     which resolves the bang server-side (hundreds of bangs, zero maintenance).
//
// Pure + unit-tested (tests/renderer/searchShortcuts.test.js): resolve(query)
// returns a URL string, or null when nothing matches (caller uses the default
// engine). Users can add/override keywords via localStorage 'vex.searchKeywords'
// (a { keyword: "https://site/q=%s" } object); %s is replaced with the encoded
// query.

const SEARCH_SHORTCUT_BUILTINS = {
  g:        'https://www.google.com/search?q=%s',
  ddg:      'https://duckduckgo.com/?q=%s',
  b:        'https://www.bing.com/search?q=%s',
  yt:       'https://www.youtube.com/results?search_query=%s',
  gh:       'https://github.com/search?q=%s&type=repositories',
  w:        'https://en.wikipedia.org/w/index.php?search=%s',
  wiki:     'https://en.wikipedia.org/w/index.php?search=%s',
  a:        'https://www.amazon.com/s?k=%s',
  amazon:   'https://www.amazon.com/s?k=%s',
  r:        'https://www.reddit.com/search/?q=%s',
  reddit:   'https://www.reddit.com/search/?q=%s',
  so:       'https://stackoverflow.com/search?q=%s',
  npm:      'https://www.npmjs.com/search?q=%s',
  mdn:      'https://developer.mozilla.org/en-US/search?q=%s',
  maps:     'https://www.google.com/maps/search/%s',
  img:      'https://www.google.com/search?tbm=isch&q=%s',
  x:        'https://x.com/search?q=%s',
  tw:       'https://x.com/search?q=%s',
  imdb:     'https://www.imdb.com/find/?q=%s',
  tr:       'https://translate.google.com/?sl=auto&tl=en&text=%s',
};

function _userKeywords() {
  try {
    if (typeof localStorage === 'undefined') return null;
    const raw = localStorage.getItem('vex.searchKeywords');
    if (!raw) return null;
    const obj = JSON.parse(raw);
    return obj && typeof obj === 'object' ? obj : null;
  } catch { return null; }
}

function resolveSearchShortcut(raw) {
  const val = (raw == null ? '' : String(raw)).trim();
  if (!val) return null;

  // DDG bang anywhere in the query (leading or trailing) → let DuckDuckGo
  // resolve it. Matches "!w …", "… !yt", "!gh".
  if (/(^|\s)![a-z0-9+._-]+/i.test(val)) {
    return 'https://duckduckgo.com/?q=' + encodeURIComponent(val);
  }

  // Keyword engine: "<kw> <query>". Needs a space and a non-empty remainder.
  const sp = val.search(/\s/);
  if (sp <= 0) return null;
  const kw = val.slice(0, sp).toLowerCase();
  const rest = val.slice(sp + 1).trim();
  if (!rest) return null;

  const user = _userKeywords();
  const tmpl = (user && typeof user[kw] === 'string' && user[kw]) || SEARCH_SHORTCUT_BUILTINS[kw];
  if (!tmpl || tmpl.indexOf('%s') === -1) return null;
  return tmpl.replace('%s', encodeURIComponent(rest));
}

const SearchShortcuts = { resolve: resolveSearchShortcut, BUILTINS: SEARCH_SHORTCUT_BUILTINS };

if (typeof window !== 'undefined') window.SearchShortcuts = SearchShortcuts;
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { SearchShortcuts, resolveSearchShortcut, SEARCH_SHORTCUT_BUILTINS };
}

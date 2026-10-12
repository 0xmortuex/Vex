// === Vex Search Shortcuts — keyword engines + DuckDuckGo bangs ===
//
// Resolve a typed address-bar query that isn't a URL into a site-specific search
// BEFORE falling back to the default engine:
//   • keyword engines —  "@yt cats"  → YouTube,  "@w einstein" → Wikipedia:
//     "@" and the keyword, then the query (or the keyword and Tab in the
//     address bar, which writes the @). A keyword you added yourself, and the
//     few built-in ones no sentence starts with (yt, gh, npm...), work
//     without the @. One-letter and everyday-word keywords used to take any
//     sentence starting with them: "a good book" searched Amazon, "so what is
//     love" Stack Overflow, "w hotels" Wikipedia (found 2026-10-10).
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

// The built-in keywords that work without "@": no sentence starts with them.
const SEARCH_SHORTCUT_BARE = new Set(['yt', 'gh', 'ddg', 'npm', 'mdn', 'imdb']);

// What each built-in searches, for the row that says where a search goes.
const SEARCH_SHORTCUT_NAMES = {
  g: 'Google', ddg: 'DuckDuckGo', b: 'Bing', yt: 'YouTube', gh: 'GitHub', w: 'Wikipedia', wiki: 'Wikipedia',
  a: 'Amazon', amazon: 'Amazon', r: 'Reddit', reddit: 'Reddit', so: 'Stack Overflow', npm: 'npm', mdn: 'MDN',
  maps: 'Google Maps', img: 'Google Images', x: 'X', tw: 'X', imdb: 'IMDb', tr: 'Google Translate',
};

const USER_KEYWORDS_KEY = 'vex.searchKeywords';

// The keywords you added: { keyword: "https://site/?q=%s" }. A list that
// cannot be read is said, not taken as "none".
function _userKeywords() {
  if (typeof localStorage === 'undefined') return {};
  const raw = localStorage.getItem(USER_KEYWORDS_KEY);
  if (!raw) return {};
  let obj;
  try { obj = JSON.parse(raw); } catch (err) { console.warn('[Search] your search keywords could not be read:', err && err.message); return {}; }
  return obj && typeof obj === 'object' && !Array.isArray(obj) ? obj : {};
}

// The keyword a word names, with "@" or without: { keyword, url, name, user }
// or null. Without "@" only your own keywords and the bare-safe built-ins.
function searchKeyword(word) {
  const w = String(word == null ? '' : word).trim().toLowerCase();
  const at = w.startsWith('@');
  const kw = at ? w.slice(1) : w;
  if (!kw) return null;
  const user = _userKeywords();
  if (typeof user[kw] === 'string' && user[kw].includes('%s')) return { keyword: kw, url: user[kw], name: kw, user: true };
  const tmpl = SEARCH_SHORTCUT_BUILTINS[kw];
  if (!tmpl || (!at && !SEARCH_SHORTCUT_BARE.has(kw))) return null;
  return { keyword: kw, url: tmpl, name: SEARCH_SHORTCUT_NAMES[kw] || kw, user: false };
}

// The keyword search a typed line asks for: { url, name, query } or null.
function resolveKeywordSearch(raw) {
  const val = (raw == null ? '' : String(raw)).trim();
  if (!val) return null;

  // DDG bang anywhere in the query (leading or trailing) → let DuckDuckGo
  // resolve it. Matches "!w …", "… !yt", "!gh".
  if (/(^|\s)![a-z0-9+._-]+/i.test(val)) {
    return { url: 'https://duckduckgo.com/?q=' + encodeURIComponent(val), name: 'DuckDuckGo', query: val };
  }

  // Keyword engine: "<kw> <query>". Needs a space and a non-empty remainder.
  const sp = val.search(/\s/);
  if (sp <= 0) return null;
  const rest = val.slice(sp + 1).trim();
  if (!rest) return null;
  const k = searchKeyword(val.slice(0, sp));
  if (!k) return null;
  return { url: k.url.replace('%s', encodeURIComponent(rest)), name: k.name, query: rest };
}

// Your keywords as saved, for changing them: an unreadable list is an error
// here, so a change can never write an empty list over it.
function _userKeywordsStrict() {
  const raw = localStorage.getItem(USER_KEYWORDS_KEY);
  if (!raw) return {};
  const obj = JSON.parse(raw);
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) throw new Error('Your search keywords are not readable, so they were not changed');
  return obj;
}

// Settings › General › Search keywords. A keyword is one short word; the
// address is a web address with %s where the words go.
function setUserKeyword(keyword, url) {
  const kw = String(keyword == null ? '' : keyword).trim().toLowerCase().replace(/^@/, '');
  if (!/^[a-z0-9][a-z0-9._-]{0,31}$/.test(kw)) throw new Error('A keyword is one word of letters or digits, without spaces');
  const addr = String(url == null ? '' : url).trim();
  if (!/^https?:\/\/[^\s]+$/i.test(addr)) throw new Error('The address must start with https:// (or http://)');
  if (!addr.includes('%s')) throw new Error('Put %s in the address where the words you type go');
  const all = _userKeywordsStrict();
  all[kw] = addr;
  localStorage.setItem(USER_KEYWORDS_KEY, JSON.stringify(all));
  return kw;
}

function removeUserKeyword(keyword) {
  const all = _userKeywordsStrict();
  delete all[String(keyword || '').toLowerCase()];
  localStorage.setItem(USER_KEYWORDS_KEY, JSON.stringify(all));
}

function resolveSearchShortcut(raw) {
  const hit = resolveKeywordSearch(raw);
  return hit ? hit.url : null;
}

const SearchShortcuts = {
  resolve: resolveSearchShortcut, resolveKeywordSearch, keyword: searchKeyword,
  userKeywords: () => ({ ..._userKeywords() }), setUserKeyword, removeUserKeyword,
  BUILTINS: SEARCH_SHORTCUT_BUILTINS, NAMES: SEARCH_SHORTCUT_NAMES, BARE: SEARCH_SHORTCUT_BARE, USER_KEYWORDS_KEY,
};

if (typeof window !== 'undefined') window.SearchShortcuts = SearchShortcuts;
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { SearchShortcuts, resolveSearchShortcut, resolveKeywordSearch, searchKeyword, SEARCH_SHORTCUT_BUILTINS, SEARCH_SHORTCUT_NAMES };
}
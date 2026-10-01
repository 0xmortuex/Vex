// === Vex Mobile — omnibox input ===
//
// Decides whether what you typed is a URL or a search, and builds suggestions
// out of local history and bookmarks — and, when you let it, out of the search
// engine's own suggestions.
//
// Those cost something: the engine sees what you are typing before you press go.
// So they are a setting (Settings → Search), they never run in a private tab,
// they never run on something that is already a URL, and they go out through
// native rather than from the chrome — not for privacy, but because no
// suggestion endpoint sends an Access-Control-Allow-Origin header, so a fetch
// from the chrome's origin is refused before it leaves the phone.

const VexSearch = (() => {
  const ENGINES = {
    duckduckgo: {
      name: 'DuckDuckGo', url: 'https://duckduckgo.com/?q=%s',
      suggest: 'https://duckduckgo.com/ac/?q=%s&type=list'
    },
    google: {
      name: 'Google', url: 'https://www.google.com/search?q=%s',
      suggest: 'https://suggestqueries.google.com/complete/search?client=firefox&q=%s'
    },
    brave: {
      name: 'Brave', url: 'https://search.brave.com/search?q=%s',
      suggest: 'https://search.brave.com/api/suggest?q=%s'
    },
    startpage: {
      name: 'Startpage', url: 'https://www.startpage.com/sp/search?query=%s',
      suggest: 'https://www.startpage.com/suggestions?q=%s&format=opensearch'
    },
    ecosia: {
      name: 'Ecosia', url: 'https://www.ecosia.org/search?q=%s',
      suggest: 'https://ac.ecosia.org/autocomplete?q=%s&type=list'
    },
    bing: {
      name: 'Bing', url: 'https://www.bing.com/search?q=%s',
      suggest: 'https://api.bing.com/osjson.aspx?query=%s'
    }
  };

  // Engines do not agree on a shape. Three are in use:
  //   ["hey", ["hey arnold", …]]        — OpenSearch, most of them
  //   { suggestions: ["hey arnold", …] } — Ecosia
  //   [{ phrase: "hey arnold" }, …]      — DuckDuckGo's json type
  function parseSuggestions(body) {
    let data;
    try { data = JSON.parse(body); } catch { return []; }
    let list = [];
    if (Array.isArray(data)) {
      list = Array.isArray(data[1]) ? data[1] : data;
    } else if (data && Array.isArray(data.suggestions)) {
      list = data.suggestions;
    }
    return list
      .map(entry => typeof entry === 'string' ? entry
        : entry && (entry.phrase || entry.suggestion || entry.q || entry.text))
      .filter(entry => typeof entry === 'string' && entry.trim())
      .map(entry => entry.trim());
  }

  // The last few answers, because backspacing retypes a query you just asked
  // about and a phone's connection is not free.
  const remembered = new Map();
  const REMEMBER = 24;
  let inFlight = 0;

  // A bare word with a dot and no space is a host ("news.ycombinator.com"),
  // anything with a space is a search, and localhost/IPs stay navigable.
  const LOOKS_LIKE_HOST = /^(?:[a-z0-9-]+\.)+[a-z]{2,}(?::\d+)?(?:[/?#].*)?$/i;
  const LOOKS_LIKE_LOCAL = /^(?:localhost|\d{1,3}(?:\.\d{1,3}){3})(?::\d+)?(?:[/?#].*)?$/i;

  // A search of your own: SearXNG on a box in the hall, Kagi, a university
  // catalogue, anything with a %s in it. Stored as one preference rather than a
  // list, because nobody has two.
  function custom() {
    const stored = window.VexStore ? VexStore.get('vex.customEngine', null) : null;
    if (!stored || typeof stored !== 'object') return null;
    const url = String(stored.url || '');
    if (!url.includes('%s')) return null;
    return {
      name: String(stored.name || '').slice(0, 40) || 'Your search',
      url,
      suggest: String(stored.suggest || '') || ''
    };
  }

  return {
    ENGINES,
    custom,

    /** The six built in, plus yours when you have one. */
    engines() {
      const mine = custom();
      return mine ? Object.assign({}, ENGINES, { custom: mine }) : Object.assign({}, ENGINES);
    },

    /**
     * What a custom engine has to be before it is accepted. Returned rather than
     * thrown: the settings panel says it in a toast, and "it has to have a %s"
     * is a sentence, not an exception.
     */
    checkCustom({ name, url, suggest }) {
      const address = String(url || '').trim();
      if (!address) return 'A search URL is needed';
      if (!/^https?:\/\//i.test(address)) return 'The URL has to start with http:// or https://';
      if (!address.includes('%s')) return 'Put %s where the words you type should go';
      const hint = String(suggest || '').trim();
      // Suggestions go out through native, which refuses anything but https —
      // the letters you are typing are not going over plain http.
      if (hint && !/^https:\/\//i.test(hint)) return 'The suggestions URL has to be https://';
      if (hint && !hint.includes('%s')) return 'The suggestions URL needs a %s too';
      if (!String(name || '').trim()) return 'Give it a name';
      return '';
    },

    engineId() {
      const stored = window.VexStore ? VexStore.get('vex.searchEngine', 'duckduckgo') : 'duckduckgo';
      // A custom engine that was chosen and then deleted must not leave the
      // omnibox pointing at nothing.
      if (stored === 'custom' && !custom()) return 'duckduckgo';
      return stored;
    },

    searchUrl(query, engineId) {
      const all = this.engines();
      const engine = all[engineId || this.engineId()] || all.duckduckgo;
      return engine.url.replace('%s', encodeURIComponent(query));
    },

    // "what did I mean" — returns a loadable URL for anything typed.
    toUrl(input) {
      const text = String(input || '').trim();
      if (!text) return '';
      if (/^(?:https?|file|data|about|vex):/i.test(text)) return text;
      if (text.startsWith('//')) return 'https:' + text;
      if (LOOKS_LIKE_HOST.test(text) || LOOKS_LIKE_LOCAL.test(text)) return 'https://' + text;
      return this.shortcut(text) || this.searchUrl(text);
    },

    /**
     * "yt cats", "gh vex", "!w einstein": a keyword or a DuckDuckGo !bang, the
     * desktop's own resolver (shared/search-shortcuts.js, copied verbatim).
     * The address it goes to, or '' when what was typed is an ordinary search.
     */
    shortcut(text) {
      const resolver = typeof window !== 'undefined' && window.SearchShortcuts;
      return (resolver && resolver.resolve(text)) || '';
    },

    isSearch(input) {
      const text = String(input || '').trim();
      return !!text && !/^(?:https?|file|data|about|vex):/i.test(text)
        && !LOOKS_LIKE_HOST.test(text) && !LOOKS_LIKE_LOCAL.test(text);
    },

    suggestionsOn() {
      return window.VexStore ? VexStore.get('vex.searchSuggestions', true) !== false : false;
    },

    /**
     * What the engine thinks you are typing. Resolves to [] rather than throwing
     * for every reason it might not happen — no setting, a private tab, a URL,
     * no network, a shape nobody recognises — because a suggestion that does not
     * arrive is not an error, it is just an address bar with fewer rows in it.
     */
    async remoteSuggest(input, engineId) {
      const query = String(input || '').trim();
      if (query.length < 2 || query.length > 120) return [];
      if (!this.suggestionsOn()) return [];
      if (!this.isSearch(query)) return [];        // already a URL; nothing to suggest
      // A private tab is private from the engine too.
      const tab = window.VexTabStore ? VexTabStore.active() : null;
      if (tab && tab.incognito) return [];
      // Anything that looks like it is being typed into the wrong box.
      if (/\s(?:password|passwd|pwd)\s*[:=]/i.test(query)) return [];

      const all = this.engines();
      const engine = all[engineId || this.engineId()] || all.duckduckgo;
      if (!engine.suggest) return [];
      const key = (engineId || this.engineId()) + '\u0000' + query.toLowerCase();
      if (remembered.has(key)) return remembered.get(key);
      // Two in flight is a fast typist; a dozen is a queue nobody will read.
      if (inFlight > 2) return [];

      inFlight++;
      let answers = [];
      try {
        const url = engine.suggest.replace('%s', encodeURIComponent(query));
        const response = await VexBridge.fetchText(url);
        if (response && response.ok) answers = parseSuggestions(response.body).slice(0, 8);
      } catch {
        answers = [];
      } finally {
        inFlight--;
      }

      remembered.set(key, answers);
      if (remembered.size > REMEMBER) remembered.delete(remembered.keys().next().value);
      return answers;
    },

    forgetSuggestions() { remembered.clear(); },

    // Suggestions: bookmarks first (you saved them), then history, capped.
    suggest(input, limit = 8) {
      const text = String(input || '').trim().toLowerCase();
      const rows = [];
      if (text) {
        // A keyword or a !bang says where it is going, since that is no
        // longer the engine underneath.
        const shortcut = this.shortcut(String(input || '').trim());
        rows.push(shortcut
          ? {
            kind: 'search', title: text, url: shortcut,
            snippet: /(^|\s)!/.test(text) ? 'A !bang, through DuckDuckGo' : 'On ' + this.prettyHost(shortcut)
          }
          : { kind: 'search', title: text, url: this.searchUrl(text) });
      }
      if (!window.VexStore) return rows;

      const seen = new Set();
      const match = entry => {
        if (!entry || !entry.url || seen.has(entry.url)) return false;
        if (!text) return true;
        return (entry.url + ' ' + (entry.title || '')).toLowerCase().includes(text);
      };
      for (const bookmark of VexStore.get('vex.bookmarks', [])) {
        if (rows.length >= limit) break;
        if (!match(bookmark)) continue;
        seen.add(bookmark.url);
        rows.push({ kind: 'bookmark', title: bookmark.title || bookmark.url, url: bookmark.url, icon: bookmark.icon || '' });
      }
      // History comes from VexHistory's in-memory slice, which exists precisely
      // so the omnibox can draw without awaiting a database. It used to read the
      // vex.history preference — which VexHistory empties the first time it
      // migrates history into IndexedDB, and never writes again — so after the
      // first launch the address bar suggested nothing you had ever visited.
      const visited = (typeof VexHistory !== 'undefined' && VexHistory.recent) ? VexHistory.recent(400) : [];
      for (const entry of visited) {
        if (rows.length >= limit) break;
        if (!match(entry)) continue;
        seen.add(entry.url);
        rows.push({ kind: 'history', title: entry.title || entry.url, url: entry.url, icon: entry.icon || '' });
      }
      return rows;
    },

    // Pretty host for the URL pill: strip scheme and a leading www.
    prettyHost(url) {
      try {
        const parsed = new URL(url);
        return parsed.hostname.replace(/^www\./, '') || parsed.protocol;
      } catch { return ''; }
    }
  };
})();

if (typeof window !== 'undefined') window.VexSearch = VexSearch;
if (typeof module !== 'undefined' && module.exports) module.exports = { VexSearch };

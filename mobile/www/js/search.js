// === Vex Mobile — omnibox input ===
//
// Decides whether what you typed is a URL or a search, and builds suggestions
// out of local history and bookmarks. No network suggestion service: the
// desktop app does not phone one either, and on mobile it would leak every
// keystroke to the engine before you press go.

const VexSearch = (() => {
  const ENGINES = {
    duckduckgo: { name: 'DuckDuckGo', url: 'https://duckduckgo.com/?q=%s' },
    google: { name: 'Google', url: 'https://www.google.com/search?q=%s' },
    brave: { name: 'Brave', url: 'https://search.brave.com/search?q=%s' },
    startpage: { name: 'Startpage', url: 'https://www.startpage.com/sp/search?query=%s' },
    ecosia: { name: 'Ecosia', url: 'https://www.ecosia.org/search?q=%s' },
    bing: { name: 'Bing', url: 'https://www.bing.com/search?q=%s' }
  };

  // A bare word with a dot and no space is a host ("news.ycombinator.com"),
  // anything with a space is a search, and localhost/IPs stay navigable.
  const LOOKS_LIKE_HOST = /^(?:[a-z0-9-]+\.)+[a-z]{2,}(?::\d+)?(?:[/?#].*)?$/i;
  const LOOKS_LIKE_LOCAL = /^(?:localhost|\d{1,3}(?:\.\d{1,3}){3})(?::\d+)?(?:[/?#].*)?$/i;

  return {
    ENGINES,

    engineId() { return window.VexStore ? VexStore.get('vex.searchEngine', 'duckduckgo') : 'duckduckgo'; },

    searchUrl(query, engineId) {
      const engine = ENGINES[engineId || this.engineId()] || ENGINES.duckduckgo;
      return engine.url.replace('%s', encodeURIComponent(query));
    },

    // "what did I mean" — returns a loadable URL for anything typed.
    toUrl(input) {
      const text = String(input || '').trim();
      if (!text) return '';
      if (/^(?:https?|file|data|about|vex):/i.test(text)) return text;
      if (text.startsWith('//')) return 'https:' + text;
      if (LOOKS_LIKE_HOST.test(text) || LOOKS_LIKE_LOCAL.test(text)) return 'https://' + text;
      return this.searchUrl(text);
    },

    isSearch(input) {
      const text = String(input || '').trim();
      return !!text && !/^(?:https?|file|data|about|vex):/i.test(text)
        && !LOOKS_LIKE_HOST.test(text) && !LOOKS_LIKE_LOCAL.test(text);
    },

    // Suggestions: bookmarks first (you saved them), then history, capped.
    suggest(input, limit = 8) {
      const text = String(input || '').trim().toLowerCase();
      const rows = [];
      if (text) rows.push({ kind: 'search', title: text, url: this.searchUrl(text) });
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
        rows.push({ kind: 'bookmark', title: bookmark.title || bookmark.url, url: bookmark.url });
      }
      for (const entry of VexStore.get('vex.history', [])) {
        if (rows.length >= limit) break;
        if (!match(entry)) continue;
        seen.add(entry.url);
        rows.push({ kind: 'history', title: entry.title || entry.url, url: entry.url });
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

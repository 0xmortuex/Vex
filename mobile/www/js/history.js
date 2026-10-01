// === Vex Mobile — history and Recall ===
//
// One API over two things: the visit log (what you opened, when) and Recall
// (the readable text of the pages you actually read, so you can find one by
// what it said rather than what it was called). The desktop keeps the same
// pair — js/history-panel.js and main/recall-index.js.
//
// The omnibox and the start page draw synchronously, so the newest slice is
// kept in memory and the database is the source of truth behind it. Everything
// that writes goes to the database first.

const VexHistory = (() => {
  const CACHE_SIZE = 400;
  let cache = [];              // newest first, the slice the chrome draws from
  let loaded = false;

  function hostOf(url) {
    return VexSearch.prettyHost(url);
  }

  return {
    // Bring the recent slice into memory, and move a pre-IndexedDB history
    // across the first time.
    async load() {
      if (loaded) return cache;
      const legacy = VexStore.get('vex.history', []);
      if (Array.isArray(legacy) && legacy.length && VexDB.available()) {
        const already = await VexDB.count('history');
        if (!already) {
          for (const entry of legacy.slice().reverse()) {
            await VexDB.add('history', {
              url: entry.url, title: entry.title || '', at: entry.at || Date.now(),
              icon: entry.icon || '', host: hostOf(entry.url)
            });
          }
        }
        await VexStore.set('vex.history', []);      // the database owns it now
      }
      cache = await VexDB.scan('history', { limit: CACHE_SIZE });
      loaded = true;
      return cache;
    },

    /**
     * A visit that happened somewhere else — the desktop, the other phone —
     * arriving through sync.
     *
     * Not add(): that one treats what it is given as happening now, folds a
     * repeat of the current page into the last row, and puts the result at the
     * front. A visit from yesterday on another device is none of those things,
     * so this one keeps the cache in time order instead.
     */
    async addRaw(entry) {
      if (!entry || !entry.url || entry.url === 'about:blank') return null;
      const record = {
        url: entry.url,
        title: entry.title || '',
        at: entry.at || Date.now(),
        icon: entry.icon || '',
        host: hostOf(entry.url)
      };
      record.id = await VexDB.add('history', record);
      const at = cache.findIndex(row => (row.at || 0) < record.at);
      if (at === -1) cache.push(record); else cache.splice(at, 0, record);
      if (cache.length > CACHE_SIZE) cache.length = CACHE_SIZE;
      return record;
    },

    // What the omnibox and start page read — no await, no database.
    recent(limit = CACHE_SIZE) { return cache.slice(0, limit); },

    async add(entry) {
      if (!entry || !entry.url || entry.url === 'about:blank') return null;
      const record = {
        url: entry.url,
        title: entry.title || '',
        at: entry.at || Date.now(),
        icon: entry.icon || '',
        host: hostOf(entry.url)
      };
      // Revisiting the page you are already on is not a new visit.
      if (cache[0] && cache[0].url === record.url && record.at - cache[0].at < 60000) {
        cache[0].title = record.title || cache[0].title;
        cache[0].at = record.at;
        if (cache[0].id != null) await VexDB.put('history', cache[0]);
        return cache[0];
      }
      const id = await VexDB.add('history', record);
      record.id = id;
      cache.unshift(record);
      if (cache.length > CACHE_SIZE) cache.length = CACHE_SIZE;
      return record;
    },

    // Fill in the favicon on the most recent visit to a page.
    async setIcon(url, icon) {
      if (!url || !icon) return;
      const entry = cache.find(row => row.url === url);
      if (!entry || entry.icon === icon) return;
      entry.icon = icon;
      if (entry.id != null) await VexDB.put('history', entry);
    },

    async remove(entry) {
      cache = cache.filter(row => !(row.url === entry.url && row.at === entry.at));
      if (entry.id != null) await VexDB.delete('history', entry.id);
    },

    async removeSite(host) {
      cache = cache.filter(row => row.host !== host);
      return VexDB.deleteWhere('history', row => row.host === host);
    },

    async clear() {
      await this.clearVisits();
      await this.clearPageText();
    },

    // The two halves, because "clear browsing data" lets you ask for one
    // without the other: the list of what you opened, and the text behind
    // Recall. They are separate stores and separate decisions.
    async clearVisits() {
      cache = [];
      await VexDB.clear('history');
      await VexStore.set('vex.history', []);
    },

    clearPageText() { return VexDB.clear('recall'); },

    // The panel's search: the database, not the in-memory slice, so a page
    // from last year is findable.
    async search(query, limit = 300) {
      const needle = String(query || '').trim().toLowerCase();
      if (!needle) return VexDB.scan('history', { limit });
      return VexDB.scan('history', {
        limit,
        match: row => ((row.title || '') + ' ' + row.url).toLowerCase().includes(needle)
      });
    },

    async range(limit = 300) { return VexDB.scan('history', { limit }); },

    // ── Recall ─────────────────────────────────────────────────────────────
    // The desktop indexes the text of every page you read so you can find it
    // later by content. Private tabs are never indexed, and neither is a page
    // whose site you have switched it off for.
    async index(entry) {
      if (!entry || !entry.url || !entry.text) return;
      if (VexStore.get('vex.recall', true) === false) return;
      const words = VexDB.tokenize(entry.title + ' ' + entry.text);
      if (words.length < 5) return;
      await VexDB.put('recall', {
        url: entry.url,
        title: entry.title || '',
        at: Date.now(),
        text: String(entry.text).slice(0, 20000),
        words
      });
    },

    recall(query, limit = 40) { return VexDB.search(query, limit); },

    // A line of context around the first match, for the result row.
    snippet(row, query) {
      const text = String(row.text || '');
      const needle = String(query || '').trim().split(/\s+/)[0] || '';
      const at = needle ? text.toLowerCase().indexOf(needle.toLowerCase()) : -1;
      if (at < 0) return text.slice(0, 120).trim();
      const from = Math.max(0, at - 50);
      return (from ? '…' : '') + text.slice(from, at + 90).trim() + '…';
    },

    // Most-visited, weighted towards the last fortnight — the start page's
    // tiles and the desktop start page use the same rule.
    topSites(limit = 8) {
      const scores = new Map();
      const now = Date.now();
      for (const entry of cache) {
        const host = entry.host || hostOf(entry.url);
        if (!host) continue;
        const weight = now - (entry.at || 0) < 14 * 86400000 ? 1 : 0.35;
        const seen = scores.get(host) || { host, url: entry.url, score: 0, icon: entry.icon || '' };
        seen.score += weight;
        if (!seen.icon && entry.icon) seen.icon = entry.icon;
        scores.set(host, seen);
      }
      return [...scores.values()].sort((a, b) => b.score - a.score).slice(0, limit);
    },

    async stats() {
      return {
        visits: (await VexDB.count('history')) || 0,
        pages: (await VexDB.count('recall')) || 0,
        saved: (await VexDB.count('pages')) || 0
      };
    },

    prune(options) { return VexDB.prune(options); }
  };
})();

if (typeof window !== 'undefined') window.VexHistory = VexHistory;
if (typeof module !== 'undefined' && module.exports) module.exports = { VexHistory };

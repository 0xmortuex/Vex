// === Vex Mobile — the database ===
//
// SharedPreferences is a settings file: every read parses the whole value, and
// a browser's history is not a setting. History, the full-text index behind
// Recall, saved pages and the download log live in IndexedDB instead, which
// the chrome WebView has and which is happy with tens of thousands of rows.
//
// Small things — settings, bookmarks, the sync state — stay in VexStore,
// because they are small, they are read synchronously while drawing, and they
// are what syncs to the desktop.
//
// Stores:
//   history  { url, title, at, icon, host }        — one row per visit
//   recall   { url, title, at, text, words[] }     — the page's readable text
//   pages    { id, url, title, at, size }         — saved for offline, no html
//   pagehtml { id, html }                         — the document, read on open
//   downloads{ url, filename, at, size, localUri }
//   notes    { id, url, host, title, text, kind, at }
//   blobs    { name, at, … }                        — one big cached thing each
//
// `words` is a multiEntry index, which is what makes Recall a lookup rather
// than a scan: the terms of a query hit the index, and only the rows that came
// back are read.
//
// A saved page's HTML lives in its own store for the same reason. It used to
// sit in the `pages` row, and drawing the list of saved pages walked that
// store — which meant deserializing up to four megabytes of document per row
// to show a title and a date.

const VexDB = (() => {
  const NAME = 'vex';
  const VERSION = 5;
  let database = null;
  let broken = false;
  // History kept this many days or more is history kept for good.
  const NEVER = 1000;

  function open() {
    if (database) return Promise.resolve(database);
    if (broken || typeof indexedDB === 'undefined') return Promise.resolve(null);
    return new Promise(resolve => {
      let request;
      try { request = indexedDB.open(NAME, VERSION); }
      catch { broken = true; resolve(null); return; }

      request.onupgradeneeded = event => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains('history')) {
          const history = db.createObjectStore('history', { keyPath: 'id', autoIncrement: true });
          history.createIndex('at', 'at');
          history.createIndex('url', 'url');
          history.createIndex('host', 'host');
        }
        if (!db.objectStoreNames.contains('recall')) {
          const recall = db.createObjectStore('recall', { keyPath: 'url' });
          recall.createIndex('at', 'at');
          recall.createIndex('words', 'words', { multiEntry: true });
        }
        if (!db.objectStoreNames.contains('pages')) {
          const pages = db.createObjectStore('pages', { keyPath: 'id', autoIncrement: true });
          pages.createIndex('at', 'at');
          pages.createIndex('url', 'url');
        }
        if (!db.objectStoreNames.contains('notes')) {
          const notes = db.createObjectStore('notes', { keyPath: 'id', autoIncrement: true });
          notes.createIndex('at', 'at');
          notes.createIndex('host', 'host');
        }
        if (!db.objectStoreNames.contains('downloads')) {
          const downloads = db.createObjectStore('downloads', { keyPath: 'id', autoIncrement: true });
          downloads.createIndex('at', 'at');
        }
        // Version 3: the last few things that went wrong. A browser that cannot
        // say what it failed at is a browser you cannot report a bug about.
        if (!db.objectStoreNames.contains('errors')) {
          const errors = db.createObjectStore('errors', { keyPath: 'id', autoIncrement: true });
          errors.createIndex('at', 'at');
        }
        // Version 5: somewhere to keep one large thing under a name. The filter
        // lists live here now. They were in a preference, which is a settings
        // file: every launch primed several megabytes of parsed EasyList into
        // memory before the first page could be drawn.
        if (!db.objectStoreNames.contains('blobs')) {
          db.createObjectStore('blobs', { keyPath: 'name' });
        }
        // Version 4: a saved page's document moves out of its row, and the
        // rows already written are moved with it — once, here, rather than
        // leaving two shapes in the store forever.
        if (!db.objectStoreNames.contains('pagehtml')) {
          db.createObjectStore('pagehtml', { keyPath: 'id' });
          const transaction = event.target.transaction;
          const pages = transaction.objectStore('pages');
          const html = transaction.objectStore('pagehtml');
          const cursor = pages.openCursor();
          cursor.onsuccess = cursorEvent => {
            const at = cursorEvent.target.result;
            if (!at) return;
            const row = at.value;
            if (row && row.html) {
              html.put({ id: row.id, html: row.html });
              delete row.html;
              at.update(row);
            }
            at.continue();
          };
        }
      };
      request.onsuccess = () => { database = request.result; resolve(database); };
      request.onerror = () => { broken = true; resolve(null); };
      request.onblocked = () => resolve(null);
    });
  }

  function run(store, mode, work) {
    return open().then(db => {
      if (!db) return null;
      return new Promise((resolve, reject) => {
        let transaction;
        try { transaction = db.transaction(store, mode); }
        catch (error) { reject(error); return; }
        const request = work(transaction.objectStore(store));
        transaction.oncomplete = () => resolve(request && 'result' in request ? request.result : null);
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error);
      });
    }).catch(error => {
      console.warn('[db]', store, error && error.message);
      return null;
    });
  }

  // Newest first, with an optional filter, without reading the whole store.
  function scan(store, { index = 'at', limit = 100, direction = 'prev', match, upperBound } = {}) {
    return open().then(db => {
      if (!db) return [];
      return new Promise(resolve => {
        const rows = [];
        let transaction;
        try { transaction = db.transaction(store, 'readonly'); }
        catch { resolve([]); return; }
        const source = index ? transaction.objectStore(store).index(index) : transaction.objectStore(store);
        const range = upperBound != null ? IDBKeyRange.upperBound(upperBound) : null;
        const cursor = source.openCursor(range, direction);
        cursor.onsuccess = event => {
          const at = event.target.result;
          if (!at || rows.length >= limit) { resolve(rows); return; }
          if (!match || match(at.value)) rows.push(at.value);
          at.continue();
        };
        cursor.onerror = () => resolve(rows);
      });
    });
  }

  // The terms a page is findable by: lowercase words of three characters or
  // more, deduplicated, capped so one enormous page cannot fill the index.
  function tokenize(text, cap = 500) {
    const seen = new Set();
    for (const word of String(text || '').toLowerCase().split(/[^\p{L}\p{N}]+/u)) {
      if (word.length < 3 || word.length > 32) continue;
      seen.add(word);
      if (seen.size >= cap) break;
    }
    return [...seen];
  }

  return {
    NEVER,
    open,
    tokenize,

    available() { return !broken && typeof indexedDB !== 'undefined'; },

    add(store, record) { return run(store, 'readwrite', object => object.add(record)); },
    put(store, record) { return run(store, 'readwrite', object => object.put(record)); },
    get(store, key) { return run(store, 'readonly', object => object.get(key)); },
    delete(store, key) { return run(store, 'readwrite', object => object.delete(key)); },
    clear(store) { return run(store, 'readwrite', object => object.clear()); },
    count(store) { return run(store, 'readonly', object => object.count()); },
    scan,

    // One row by an indexed value, without walking the store. scan() with a
    // match predicate reads and deserializes every row until it finds one,
    // which is the wrong shape of question for "is this URL in here".
    byIndex(store, index, value, limit = 1) {
      return open().then(db => {
        if (!db) return [];
        return new Promise(resolve => {
          let transaction;
          try { transaction = db.transaction(store, 'readonly'); }
          catch { resolve([]); return; }
          const request = transaction.objectStore(store).index(index)
            .getAll(IDBKeyRange.only(value), limit);
          request.onsuccess = () => resolve(request.result || []);
          request.onerror = () => resolve([]);
        });
      });
    },

    // Every row whose url matches, so a "remove this site from history" is one
    // call rather than a read-modify-write of a 3,000-entry array.
    async deleteWhere(store, predicate) {
      const db = await open();
      if (!db) return 0;
      return new Promise(resolve => {
        let removed = 0;
        const transaction = db.transaction(store, 'readwrite');
        const cursor = transaction.objectStore(store).openCursor();
        cursor.onsuccess = event => {
          const at = event.target.result;
          if (!at) return;
          if (predicate(at.value)) { at.delete(); removed++; }
          at.continue();
        };
        transaction.oncomplete = () => resolve(removed);
        transaction.onerror = () => resolve(removed);
      });
    },

    /**
     * Delete every row whose indexed value is below `bound`. It walks the index
     * from the oldest end and stops at the first row that stays, so pruning a
     * year of history on every launch reads the few rows that go rather than
     * deserialising every visit there is.
     */
    async deleteBefore(store, index, bound) {
      const db = await open();
      if (!db) return 0;
      return new Promise(resolve => {
        let removed = 0;
        const transaction = db.transaction(store, 'readwrite');
        const cursor = transaction.objectStore(store).index(index)
          .openCursor(IDBKeyRange.upperBound(bound, true));
        cursor.onsuccess = event => {
          const at = event.target.result;
          if (!at) return;
          at.delete();
          removed++;
          at.continue();
        };
        transaction.oncomplete = () => resolve(removed);
        transaction.onerror = () => resolve(removed);
      });
    },

    // Full-text: look the query's terms up in the multiEntry index, keep the
    // pages that carry all of them, then rank by how recent they are.
    async search(query, limit = 40) {
      const terms = tokenize(query, 8);
      if (!terms.length) return [];
      const db = await open();
      if (!db) return [];
      return new Promise(resolve => {
        const counts = new Map();
        const pages = new Map();
        let pending = terms.length;
        let transaction;
        try { transaction = db.transaction('recall', 'readonly'); }
        catch { resolve([]); return; }
        const index = transaction.objectStore('recall').index('words');
        for (const term of terms) {
          const request = index.getAll(IDBKeyRange.only(term), 400);
          request.onsuccess = () => {
            for (const row of request.result || []) {
              counts.set(row.url, (counts.get(row.url) || 0) + 1);
              pages.set(row.url, row);
            }
            if (--pending === 0) {
              const hits = [...counts.entries()]
                .filter(([, hitCount]) => hitCount === terms.length)
                .map(([url]) => pages.get(url))
                .sort((a, b) => (b.at || 0) - (a.at || 0))
                .slice(0, limit);
              resolve(hits);
            }
          };
          request.onerror = () => { if (--pending === 0) resolve([]); };
        }
      });
    },

    // Keep the stores from growing without end: history by age, recall and the
    // error log by count — recall's rows carry whole pages of text, and a page
    // stuck in a reload loop can write errors faster than anyone reads them.
    //
    // A historyDays of NEVER or more keeps history for good — the setting's
    // "Never" used to be 1000 days, which is not never.
    async prune({ historyDays = 365, recallRows = 4000, errorRows = 200 } = {}) {
      const removed = Number(historyDays) >= NEVER ? 0
        : await this.deleteBefore('history', 'at', Date.now() - historyDays * 86400000);
      await this.trim('recall', recallRows, 'url');
      await this.trim('errors', errorRows, 'id');
      return removed;
    },

    // Drop the oldest rows until no more than `keep` are left.
    async trim(store, keep, keyField) {
      const total = await this.count(store);
      if (!total || total <= keep) return 0;
      const oldest = await scan(store, { index: 'at', direction: 'next', limit: total - keep });
      for (const row of oldest) await this.delete(store, row[keyField]);
      return oldest.length;
    }
  };
})();

if (typeof window !== 'undefined') window.VexDB = VexDB;
if (typeof module !== 'undefined' && module.exports) module.exports = { VexDB };

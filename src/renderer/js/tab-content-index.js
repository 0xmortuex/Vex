// === Finding a tab by what is ON it ========================================
//
// Ctrl+K finds a tab by its title, which is fine until you have thirty and the
// one you want is called "Order confirmation" — and what you remember is the
// word "refund". The words are right there in the page and nothing was looking
// at them.
//
// Each tab's readable text is skimmed once when it settles and kept as a small
// set of words. Nothing leaves the machine, nothing is written to disk, and a
// private tab is never touched.
const TabContentIndex = {
  MAX_WORDS: 400,        // per tab: enough to recognise a page, not a copy of it
  MAX_TEXT_CHARS: 6000000,   // all the pages' text together, in characters
  MIN_WORD: 3,
  _byTab: new Map(),     // tabId -> { url, words:Set, title, at }
  STOP: new Set(('the a an and or but of to in for on at by with from as is are was were be been it its this that these those you your we our they their he she his her not no do does did have has had will would can could should may might must i me my if then than so such about into over under out up down more most some any all each other new use used using page site web home menu search close open cookie cookies accept privacy terms sign log in out'.split(' '))),

  // The words worth remembering from a page.
  keywords(text) {
    const seen = new Map();
    for (const raw of String(text || '').toLowerCase().split(/[^a-z0-9£$€+#.-]+/)) {
      const w = raw.replace(/^[.\-]+|[.\-]+$/g, '');
      if (w.length < this.MIN_WORD || w.length > 32) continue;
      if (this.STOP.has(w)) continue;
      if (/^\d+$/.test(w) && w.length > 6) continue;         // ids and timestamps
      seen.set(w, (seen.get(w) || 0) + 1);
      if (seen.size > this.MAX_WORDS * 3) break;
    }
    // The most repeated words describe the page best.
    return new Set([...seen.entries()].sort((a, b) => b[1] - a[1]).slice(0, this.MAX_WORDS).map(e => e[0]));
  },

  // Read a tab once it has settled. Cheap, and never on a private tab.
  async index(tabId, webview, tab) {
    if (!webview || !tab) return null;
    if (window.VexTabPolicy && !window.VexTabPolicy.canReadWebview(webview)) return null;
    if (!/^https?:/i.test(tab.url || '')) return null;
    let text = '';
    try {
      text = await window.vexGuestEval(webview, `(() => {
        const el = document.querySelector('article, main, [role="main"]') || document.body;
        return (el.innerText || el.textContent || '').slice(0, 40000);
      })()`, false, 4000);
    } catch (err) {
      // A page that will not answer is simply not indexed; it is still findable
      // by title, which is what it was before.
      return null;
    }
    // The page's own words are kept in memory too, for an exact search over them (searchText, js/tab-text-find.js):
    // never written to disk, never sent anywhere, dropped with the tab and trimmed to MAX_TEXT_CHARS in all.
    const entry = { url: tab.url, title: tab.title || '', words: this.keywords(text), at: Date.now(), text: String(text).normalize('NFC').replace(/\s+/g, ' ').trim() };
    this._byTab.set(tabId, entry);
    this._trimText();
    this._syncOne(tabId);
    return entry;
  },

  // ---- the shared search index (js/search-index.js, T3-108) --------------------------------------------------
  // The page text of each open tab is also kept in the window's one shared index (source 'tabs:text'), so an exact
  // search names the few tabs that can contain it instead of folding and scanning every page. The index only
  // NARROWS: each candidate is still checked by the same exact scan, so the answers are the same as a full scan.
  // It is used only while it holds exactly the tabs that have text; any other state scans everything, as before.
  INDEX_SOURCE: 'tabs:text',
  _textual() { return [...this._byTab].filter(([, e]) => e.text); },
  _item(tabId, e) { return { id: String(tabId), title: '', subtitle: '', body: e.text, bodyMax: 100000 }; },
  // Keep the index level with one tab (a page read, a tab closed, its text trimmed away).
  _syncOne(tabId) {
    if (typeof VexSearchIndex === 'undefined') return;
    const idx = VexSearchIndex.shared();
    const e = this._byTab.get(tabId);
    if (e && e.text) idx.upsert(this.INDEX_SOURCE, this._item(tabId, e));
    else idx.remove(this.INDEX_SOURCE, String(tabId));
  },
  _rebuild() {
    VexSearchIndex.shared().replace(this.INDEX_SOURCE, this._textual().map(([tabId, e]) => this._item(tabId, e)));
  },
  // → Set of tab ids that could contain `needle`, or null when every tab has to be scanned. The index is used only
  // while it holds exactly the tabs that have text (it is rebuilt once if it does not); anything else scans, as before.
  _candidateIds(needle) {
    if (typeof VexSearchIndex === 'undefined' || !globalThis.VexTr || typeof globalThis.VexTr.fold !== 'function') return null;
    const idx = VexSearchIndex.shared();
    const want = this._textual().length;
    if (!want) return null;
    if (!idx.isIndexed(this.INDEX_SOURCE) || idx.count(this.INDEX_SOURCE) !== want) this._rebuild();
    if (!idx.isIndexed(this.INDEX_SOURCE) || idx.count(this.INDEX_SOURCE) !== want) return null;
    // Folded the way the index folds its text, whatever the exact search does with case.
    const found = idx.candidates(this.INDEX_SOURCE, [globalThis.VexTr.fold(needle)]);
    return found === null ? null : new Set(found.map(i => i.id));
  },


  // The oldest pages lose their text first when all of it is more than MAX_TEXT_CHARS (their words stay).
  _trimText() {
    let total = 0;
    for (const e of this._byTab.values()) total += e.text ? e.text.length : 0;
    if (total <= this.MAX_TEXT_CHARS) return;
    for (const [tabId, e] of [...this._byTab.entries()].sort((a, b) => a[1].at - b[1].at)) {
      if (!e.text) continue;
      total -= e.text.length;
      e.text = '';
      this._syncOne(tabId);
      if (total <= this.MAX_TEXT_CHARS) break;
    }
  },

  // Which open tabs contain this EXACT text? Case, the Turkish dotted/dotless I and ç/ğ/ö/ş/ü are not told apart
  // ("istanbul" finds "İstanbul"), nothing else is loosened: no stemming, no typos, no partial words missed.
  // A query in double quotes is matched letter for letter instead. → [{ tabId, url, title, count, before, match, after }]
  searchText(query, { limit = 50, around = 48 } = {}) {
    let q = String(query == null ? '' : query).normalize('NFC').trim();
    const strict = q.length > 2 && q.startsWith('"') && q.endsWith('"');
    if (strict) q = q.slice(1, -1);
    if (q.length < 2) return [];
    const tr = globalThis.VexTr || null;
    const fold = strict || !tr ? (x) => x : (x) => tr.fold(x);
    const needle = fold(q);
    const out = [];
    const only = this._candidateIds(needle);
    for (const [tabId, e] of this._byTab) {
      if (!e.text) continue;
      if (only && !only.has(String(tabId))) continue;
      const hay = fold(e.text);
      let at = hay.indexOf(needle), count = 0, first = -1;
      while (at !== -1) { if (first < 0) first = at; count++; at = hay.indexOf(needle, at + needle.length); }
      if (!count) continue;
      // The words around the first hit, from the page's own text (the folded copy only when it is the same length).
      const src = hay.length === e.text.length ? e.text : hay;
      out.push({ tabId, url: e.url, title: e.title, count,
        before: src.slice(Math.max(0, first - around), first),
        match: src.slice(first, first + needle.length),
        after: src.slice(first + needle.length, first + needle.length + around) });
    }
    return out.sort((a, b) => b.count - a.count).slice(0, limit);
  },

  forget(tabId) { this._byTab.delete(tabId); this._syncOne(tabId); },
  clear() { this._byTab.clear(); if (typeof VexSearchIndex !== 'undefined') VexSearchIndex.shared().clear(this.INDEX_SOURCE); },
  size() { return this._byTab.size; },

  // Which open tabs contain these words? Title and address are already handled
  // by the command bar, so this only answers for the page's own text.
  search(query) {
    const words = String(query || '').toLowerCase().split(/\s+/).map(w => w.replace(/[^a-z0-9£$€+#.-]/g, '')).filter(w => w.length >= this.MIN_WORD);
    if (!words.length) return [];
    const out = [];
    for (const [tabId, entry] of this._byTab) {
      // Every word has to be there. Counting only the score let one strong
      // match stand in for a word that was simply missing, so "refund bicycle"
      // matched a page with no bicycle on it.
      let matched = 0, score = 0;
      for (const w of words) {
        if (entry.words.has(w)) { matched++; score += 2; continue; }
        // A word the user half-remembers: "refun" should find "refund".
        for (const known of entry.words) { if (known.startsWith(w)) { matched++; score += 1; break; } }
      }
      if (matched === words.length) out.push({ tabId, score, url: entry.url, title: entry.title });
    }
    return out.sort((a, b) => b.score - a.score);
  },

  // Index a tab when it settles, and forget it when it goes.
  watch() {
    if (this._watching) return false;
    this._watching = true;
    document.addEventListener('vex:tab-settled', (e) => {
      const { tabId } = e.detail || {};
      const wv = (typeof WebviewManager !== 'undefined') ? WebviewManager.webviews.get(tabId) : null;
      const tab = (typeof TabManager !== 'undefined') ? TabManager.tabs.find(t => t.id === tabId) : null;
      if (wv && tab) this.index(tabId, wv, tab).catch(() => {});
    });
    document.addEventListener('vex:tab-closed', (e) => this.forget((e.detail || {}).tabId));
    return true;
  },
};

if (typeof window !== 'undefined') window.TabContentIndex = TabContentIndex;
if (typeof module !== 'undefined' && module.exports) module.exports = { TabContentIndex };

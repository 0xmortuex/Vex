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
        return (el.innerText || el.textContent || '').slice(0, 20000);
      })()`, false, 4000);
    } catch (err) {
      // A page that will not answer is simply not indexed; it is still findable
      // by title, which is what it was before.
      return null;
    }
    const entry = { url: tab.url, title: tab.title || '', words: this.keywords(text), at: Date.now() };
    this._byTab.set(tabId, entry);
    return entry;
  },

  forget(tabId) { this._byTab.delete(tabId); },
  clear() { this._byTab.clear(); },
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

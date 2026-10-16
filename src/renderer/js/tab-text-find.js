// === Find text across all open tabs, exactly (T3-057) ==========================
//
// "Which tab had that phrase?" Ctrl+F looks in one page; Ctrl+K finds a tab by
// its title or by the handful of keywords it remembers. This looks for the exact
// words you type in the TEXT of every open tab, including tabs that are asleep,
// and says which tabs have them, how many times, and the words around the first
// one. Enter goes to that tab and marks the words in the page.
//
// Exact on purpose: no stemming, no "did you mean", no AI. Capital letters and the
// Turkish dotted and dotless I are not told apart ("istanbul" finds "İstanbul");
// put the words in "double quotes" to match letter for letter.
//
// The text is what js/tab-content-index.js already reads when a page settles. It
// stays in memory, is never written to disk or sent anywhere, and is not read from
// a private or Tor tab. A tab that has not loaded yet since Vex started (asleep, or
// not opened) has nothing to search; the list says how many.
//
// Ctrl+K, "Find text in all tabs" (no default key: Ctrl+Alt+F is Focus mode).
const VexTabTextFind = {
  KEY: 'vex.tabTextFind',            // '0' = off
  MIN_CHARS: 2,

  enabled() { return localStorage.getItem(this.KEY) !== '0'; },
  setEnabled(on) {
    localStorage.setItem(this.KEY, on ? '1' : '0');
    if (!on && typeof VexPickList !== 'undefined' && VexPickList.isOpen()) VexPickList.close();
  },

  _tabs() {
    return (typeof TabManager !== 'undefined' ? TabManager.tabs : []).filter(t => /^https?:/i.test(t.url || ''));
  },

  // How many of the open web pages have text to search.
  coverage() {
    const web = this._tabs();
    const ready = web.filter(t => TabContentIndex._byTab.has(t.id) && TabContentIndex._byTab.get(t.id).text);
    return { total: web.length, ready: ready.length, waiting: web.length - ready.length };
  },

  _plain(query) {
    const q = String(query || '').trim();
    return q.length > 2 && q.startsWith('"') && q.endsWith('"') ? q.slice(1, -1) : q;
  },

  // The list for a query.
  rows(query) {
    const q = this._plain(query);
    if (q.length < this.MIN_CHARS) return [];
    return TabContentIndex.searchText(query).flatMap((hit) => {
      const tab = TabManager.tabs.find(t => t.id === hit.tabId);
      if (!tab) return [];
      const where = hit.count === 1 ? '1 time' : hit.count + ' times';
      return [{
        id: tab.id,
        query: q,
        title: tab.title || hit.title || hit.url,
        sub: where + ':  …' + hit.before + '«' + hit.match + '»' + hit.after + '…',
        favicon: tab.favicon || null,
        flags: (tab.pinned ? ['pin'] : []).concat(tab.sleeping ? ['sleep'] : []),
      }];
    });
  },

  // Go to the tab and mark the words in its page.
  go(row) {
    if (!TabManager.tabs.some(t => t.id === row.id)) return false;
    const tab = TabManager.tabs.find(t => t.id === row.id);
    TabManager.switchTab(row.id);
    // A tab that was asleep is being built again: its page cannot be marked until it has loaded.
    if (!tab.sleeping && !tab._lazy && typeof WebviewManager !== 'undefined') {
      try { WebviewManager.findInPage(row.query); }
      catch (err) { if (typeof VexProblems !== 'undefined') VexProblems.note('Find in all tabs', 'Could not mark the words in the page', err); }
    }
    return true;
  },

  open() {
    if (!this.enabled()) throw new Error('Find text in all tabs is switched off in Settings');
    if (typeof TabContentIndex === 'undefined') throw new Error('The page text index is not loaded');
    const c = this.coverage();
    const note = c.waiting ? ' ' + c.waiting + ' of ' + c.total + ' tabs have not loaded yet and cannot be searched.' : '';
    VexPickList.open({
      label: 'Find text in all tabs',
      placeholder: 'Type the exact words (use "quotes" to match letter for letter)',
      hint: 'Enter to go to the tab and mark the words, Esc to cancel.' + note,
      empty: 'No open tab has those words' + (c.waiting ? ' (' + c.waiting + ' not loaded yet)' : ''),
      source: (q) => this.rows(q),
      onPick: (row) => { this.go(row); },
    });
    return true;
  },
};

if (typeof window !== 'undefined') window.VexTabTextFind = VexTabTextFind;
if (typeof module !== 'undefined' && module.exports) module.exports = { VexTabTextFind };

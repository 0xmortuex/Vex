// === Vex Mobile — clearing what the browser kept ===
//
// Samsung Internet's "Delete browsing data" is a list with tick boxes, and it
// can do the same list every time you close the browser. All-or-nothing is the
// wrong shape for this: the person who wants cookies gone at the door usually
// wants their history kept, and the person clearing a cache they suspect is
// stale does not want to lose six months of Recall with it.
//
// Every category here is one thing, named in the words the rest of Vex uses, and
// nothing clears anything it did not say it would. The vault is deliberately
// absent: logins are sealed by a Keystore key and are removed one at a time,
// from the panel that shows them, after a fingerprint.

const VexClear = (() => {
  // id, label, the note under it, and how to count what is there. `heavy` marks
  // the ones that take something away you cannot get back by visiting again.
  const ITEMS = [
    {
      id: 'cookies', label: 'Cookies and site data', heavy: true,
      note: 'Signs you out of everything',
      count: () => null
    },
    {
      id: 'cache', label: 'Cached files',
      note: 'Pages load slower once, then the same as before',
      count: () => null
    },
    {
      id: 'history', label: 'History',
      note: 'Every page you opened',
      count: stats => stats.visits
    },
    {
      id: 'recall', label: 'The Recall index', heavy: true,
      note: 'The text of the pages you read, which is what Recall searches',
      count: stats => stats.pages
    },
    {
      id: 'saved', label: 'Saved pages', heavy: true,
      note: 'The ones kept for reading offline',
      count: stats => stats.saved
    },
    {
      id: 'downloads', label: 'The downloads list',
      note: 'The list only — the files stay in your Downloads folder',
      count: stats => stats.downloads
    },
    {
      id: 'closed', label: 'Recently closed tabs',
      note: 'What "Reopen closed tab" would bring back',
      count: stats => stats.closed
    },
    {
      id: 'tabs', label: 'Open tabs', heavy: true,
      note: 'Closes everything you have open',
      count: stats => stats.tabs
    }
  ];

  // What is ticked. Cookies and cache are the two most people mean by "clear
  // browsing data", so they are the default; nothing that loses something
  // unrecoverable is on until it is turned on.
  const DEFAULTS = { cookies: true, cache: true, history: true };

  function chosen() {
    const stored = VexStore.get('vex.clearItems', null);
    const value = stored && typeof stored === 'object' ? stored : DEFAULTS;
    const out = {};
    for (const item of ITEMS) out[item.id] = value[item.id] === true;
    return out;
  }

  return {
    ITEMS,
    DEFAULTS,
    chosen,

    onExit() { return VexStore.get('vex.clearOnExit', false) === true; },

    setChosen(id, on) {
      const next = Object.assign(chosen(), { [id]: !!on });
      return VexStore.set('vex.clearItems', next);
    },

    /** How much of each there is, for the panel to put beside the labels. */
    async counts() {
      const stats = await VexHistory.stats();
      const closed = VexStore.get('vex.closedTabs', []);
      return {
        visits: stats.visits,
        pages: stats.pages,
        saved: stats.saved,
        downloads: (await VexDB.count('downloads')) || 0,
        closed: Array.isArray(closed) ? closed.length : 0,
        tabs: VexTabStore.normal().length
      };
    },

    /**
     * Clear what is asked for. Returns the ids actually cleared, so the caller
     * can say what happened rather than guessing.
     *
     * Order matters in one place: the open tabs go last, because closing the
     * last tab opens a fresh one and that should not be carrying cookies the
     * person asked to be rid of.
     */
    async run(items = chosen()) {
      const done = [];
      const native = {};
      if (items.cookies) { native.cookies = true; native.storage = true; }
      if (items.cache) native.cache = true;
      if (native.cookies || native.cache) {
        await VexBridge.clearData(native);
        if (items.cookies) done.push('cookies');
        if (items.cache) done.push('cache');
      }
      // History and Recall share a clear, and each can be asked for alone.
      if (items.history && items.recall) {
        await VexHistory.clear();
        done.push('history', 'recall');
      } else if (items.history) {
        await VexHistory.clearVisits();
        done.push('history');
      } else if (items.recall) {
        await VexHistory.clearPageText();
        done.push('recall');
      }
      if (items.saved) {
        await VexDB.clear('pages');
        await VexDB.clear('pagehtml');
        done.push('saved');
      }
      if (items.downloads) { await VexDB.clear('downloads'); done.push('downloads'); }
      if (items.closed) { await VexStore.set('vex.closedTabs', []); done.push('closed'); }
      if (items.tabs) {
        await VexTabStore.closeAll(false);
        await VexTabStore.closeAll(true);
        done.push('tabs');
      }
      return done;
    },

    /**
     * Called when Vex goes to the background, and only then: "on exit" on a
     * phone means the moment you leave, because an app is not closed, it is
     * left. Open tabs are never closed from here — coming back to an empty
     * browser because you took a phone call is not what anybody asked for.
     */
    async onLeaving() {
      if (!this.onExit()) return [];
      const items = Object.assign(chosen(), { tabs: false });
      if (!Object.values(items).some(Boolean)) return [];
      return this.run(items);
    },

    /** A line for the settings row: what would go. */
    describe() {
      const picked = chosen();
      const names = ITEMS.filter(item => picked[item.id]).map(item => item.label.toLowerCase());
      if (!names.length) return 'Nothing is ticked';
      if (names.length > 3) return names.length + ' things';
      return names.join(', ');
    }
  };
})();

if (typeof window !== 'undefined') window.VexClear = VexClear;
if (typeof module !== 'undefined' && module.exports) module.exports = { VexClear };

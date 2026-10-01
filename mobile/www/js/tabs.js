// === Vex Mobile — tab model ===
//
// The JS half of a tab. The native half (an Android WebView) is created by
// VexTabs and referred to by the same id, so this object never holds a view —
// it holds what the chrome needs to draw: url, title, loading state, history
// flags, the last snapshot, and whether the tab is private.
//
// Private tabs live in a separate native WebView profile (no cookie
// persistence, no cache write-back) and are never written to history or
// restored on the next launch.

const VexTabStore = (() => {
  const tabs = new Map();           // id -> tab record
  let order = [];                   // creation/most-recent order for the grid
  let activeId = null;
  const changeHandlers = new Set();

  function emit() {
    for (const fn of changeHandlers) { try { fn(); } catch (err) { console.error('[tabs]', err); } }
  }

  function record(id, url, incognito) {
    return {
      id,
      url: url || '',
      pendingUrl: url || '',
      title: '',
      loading: false,
      progress: 0,
      canGoBack: false,
      canGoForward: false,
      incognito: !!incognito,
      desktopMode: false,
      blocked: 0,
      snapshot: '',
      icon: '',
      themeColor: '',
      scrollY: 0,
      errorUrl: '',
      createdAt: Date.now(),
      lastActiveAt: Date.now(),
      // Set when its WebView has been paused for being in the background a
      // while; cleared the moment it is activated again.
      asleep: false
    };
  }

  return {
    onChange(fn) { changeHandlers.add(fn); return () => changeHandlers.delete(fn); },

    all() { return order.map(id => tabs.get(id)).filter(Boolean); },
    normal() { return this.all().filter(tab => !tab.incognito); },
    private() { return this.all().filter(tab => tab.incognito); },
    get(id) { return tabs.get(id) || null; },
    active() { return activeId ? tabs.get(activeId) || null : null; },
    activeId() { return activeId; },
    count(incognito) { return this.all().filter(tab => !!tab.incognito === !!incognito).length; },

    /**
     * A new tab. `lazy` makes one that knows its address but has not gone there:
     * the WebView exists, blank, and the page loads the first time the tab is
     * brought to the front.
     *
     * That is what a restored session needs. Thirty tabs left open meant thirty
     * page loads on every cold start, all at once, before anything had been
     * touched — the network, the battery and the first page you actually wanted
     * all queuing behind pages you might not open today.
     */
    async create(url, opts = {}) {
      const target = url || 'about:blank';
      const lazy = opts.lazy === true && target !== 'about:blank';
      const { id } = await VexBridge.createTab(lazy ? 'about:blank' : target, { incognito: !!opts.incognito });
      if (!id) return null;
      const tab = record(id, target, opts.incognito);
      // Where it came from decides what Back does once its own history runs
      // out: a tab a page opened goes back to that page, a link another app
      // sent goes back to that app, and anything else is left alone.
      if (opts.opener && tabs.get(opts.opener)) tab.openerId = opts.opener;
      if (opts.fromApp) tab.fromApp = true;
      if (lazy) {
        tab.lazy = true;
        tab.pendingUrl = '';
        tab.title = opts.title || '';
      }
      tabs.set(id, tab);
      order.push(id);
      if (opts.background !== true) await this.activate(id);
      else emit();
      this.persist();
      return tab;
    },

    async activate(id) {
      if (!tabs.get(id)) return;
      activeId = id;
      tabs.get(id).lastActiveAt = Date.now();
      // Native wakes it as part of activating; this is the chrome agreeing.
      tabs.get(id).asleep = false;
      await VexBridge.activateTab(id);
      await this.load(id);
      emit();
      this.persist();
    },

    async close(id) {
      const tab = tabs.get(id);
      if (!tab) return;
      // Closing the last page should not leave a blank shell: remember it so
      // "Reopen closed tab" can bring it back, then pick a neighbour.
      if (!tab.incognito && tab.url && tab.url !== 'about:blank') {
        VexStore.push('vex.closedTabs', { url: tab.url, title: tab.title, at: Date.now() }, 25);
      }
      const index = order.indexOf(id);
      order = order.filter(other => other !== id);
      tabs.delete(id);
      await VexBridge.closeTab(id);
      if (activeId === id) {
        activeId = null;
        const siblings = order.map(other => tabs.get(other)).filter(other => other && other.incognito === tab.incognito);
        const next = siblings[Math.min(index, siblings.length - 1)] || order.map(o => tabs.get(o)).filter(Boolean).pop();
        if (next) await this.activate(next.id); else emit();
      } else emit();
      this.persist();
    },

    async closeAll(incognito) {
      for (const tab of this.all().filter(other => !!other.incognito === !!incognito)) await this.close(tab.id);
    },

    async navigate(id, url) {
      const tab = tabs.get(id);
      if (!tab || !url) return;
      tab.pendingUrl = url;
      tab.loading = true;
      emit();
      await VexBridge.load(id, url);
    },

    // Native events land here; everything the chrome draws flows from this.
    /**
     * Send a lazy tab to the address it was holding. Called on activation; safe
     * to call on any tab, because a tab that is not lazy has nowhere pending.
     * Where you were on the page waits for the real document: restoring it
     * earlier would scroll the blank one.
     */
    async load(id) {
      const tab = tabs.get(id);
      if (!tab || !tab.lazy) return false;
      tab.lazy = false;
      tab.pendingUrl = tab.url;
      tab.loading = true;
      emit();
      await VexBridge.load(id, tab.url);
      if (tab.scrollY > 0 && VexBridge.restoreScroll) VexBridge.restoreScroll(id, tab.scrollY);
      return true;
    },

    update(id, patch) {
      const tab = tabs.get(id);
      if (!tab) return null;
      // A lazy tab's WebView is showing about:blank, and every event it raises
      // is about that blank page. Its address and title are the ones it was
      // created with until it is woken, so the blank page's are not taken.
      if (tab.lazy && patch) {
        patch = Object.assign({}, patch);
        delete patch.url;
        delete patch.title;
        delete patch.pendingUrl;
        delete patch.loading;
        delete patch.progress;
        delete patch.canGoBack;
        delete patch.canGoForward;
      }
      Object.assign(tab, patch);
      emit();
      return tab;
    },

    // Persist normal tabs only — private tabs are gone when the app is.
    persist() {
      if (!window.VexStore) return;
      clearTimeout(this._persistTimer);
      this._persistTimer = setTimeout(() => {
        // lastActiveAt has to survive the restart, or "close tabs you have not
        // opened in a month" can never fire: a restored tab was created a
        // moment ago, so every tab looks new on every launch.
        const open = this.normal().map(tab => ({
          url: tab.url, title: tab.title, icon: tab.icon || '', scrollY: tab.scrollY || 0,
          lastActiveAt: tab.lastActiveAt || tab.createdAt || Date.now()
        }));
        VexStore.set('vex.openTabs', open);
        const active = this.active();
        VexStore.set('vex.activeTabUrl', active && !active.incognito ? active.url : '');
      }, 400);
    },

    // Restore the previous session; returns the number of tabs brought back.
    async restore() {
      const saved = VexStore.get('vex.openTabs', []);
      const wanted = VexStore.get('vex.activeTabUrl', '');
      if (!Array.isArray(saved) || !saved.length) return 0;
      let restoredActive = null;
      for (const entry of saved) {
        if (!entry || !entry.url) continue;
        // Lazily: only the tab you were looking at loads now. The rest know
        // where they are and go there when you open them.
        const tab = await this.create(entry.url, { background: true, lazy: true, title: entry.title });
        if (!tab) continue;
        tab.title = entry.title || '';
        tab.icon = entry.icon || '';
        if (entry.lastActiveAt) tab.lastActiveAt = entry.lastActiveAt;
        // Where you were on the page is part of where you were; load() puts it
        // back once the real page is there.
        if (entry.scrollY > 0) tab.scrollY = entry.scrollY;
        if (entry.url === wanted) restoredActive = tab.id;
      }
      const first = this.all()[0];
      if (restoredActive) await this.activate(restoredActive);
      else if (first) await this.activate(first.id);
      return saved.length;
    }
  };
})();

if (typeof window !== 'undefined') window.VexTabStore = VexTabStore;
if (typeof module !== 'undefined' && module.exports) module.exports = { VexTabStore };

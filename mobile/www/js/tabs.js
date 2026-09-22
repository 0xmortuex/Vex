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
      createdAt: Date.now(),
      lastActiveAt: Date.now()
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

    async create(url, opts = {}) {
      const target = url || 'about:blank';
      const { id } = await VexBridge.createTab(target, { incognito: !!opts.incognito });
      if (!id) return null;
      const tab = record(id, target, opts.incognito);
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
      await VexBridge.activateTab(id);
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
    update(id, patch) {
      const tab = tabs.get(id);
      if (!tab) return null;
      Object.assign(tab, patch);
      emit();
      return tab;
    },

    // Persist normal tabs only — private tabs are gone when the app is.
    persist() {
      if (!window.VexStore) return;
      clearTimeout(this._persistTimer);
      this._persistTimer = setTimeout(() => {
        const open = this.normal().map(tab => ({ url: tab.url, title: tab.title }));
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
        const tab = await this.create(entry.url, { background: true });
        if (tab) { tab.title = entry.title || ''; if (entry.url === wanted) restoredActive = tab.id; }
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

// === Vex Persistent Storage ===
//
// Two layers, both renderer-side:
//   1. VexStorage — structured per-key JSON files (tabs, groups, settings,
//      history, shortcuts) via window.vex.{saveData,loadData}.
//   2. PersistentStorage — localStorage shim backed by a single JSON file
//      (vex-persist.json) in userData. Hydrates localStorage on startup and
//      mirrors every setItem/removeItem call to disk. Data survives
//      reinstalls and Chromium-origin churn without touching any existing
//      localStorage call site.
// Public API: window.VexStorage (async), window.PersistentStorage (init only).
// Depends on the preload bridge (window.vex) for IPC to main.

const PersistentStorage = {
  _ready: false,
  _readyPromise: null,
  _queue: new Map(),
  _timer: null,

  init() {
    if (this._readyPromise) return this._readyPromise;
    this._readyPromise = (async () => {
      try {
        const fileData = (window.vex && window.vex.persistGetAll) ? (await window.vex.persistGetAll()) : {};
        const fileKeys = Object.keys(fileData);

        if (fileKeys.length === 0) {
          // First run (or fresh install with lost data): seed file from whatever is in localStorage.
          for (let i = 0; i < localStorage.length; i++) {
            const k = localStorage.key(i);
            if (!k) continue;
            if (k.startsWith('vex.') || k === 'vex-theme' || k.startsWith('vex_')) {
              this._enqueue('set', k, localStorage.getItem(k));
            }
          }
        } else {
          // File storage is authoritative — hydrate localStorage from it.
          // Values are always stored as raw strings to preserve exact round-trip.
          for (const [k, v] of Object.entries(fileData)) {
            try {
              const str = typeof v === 'string' ? v : JSON.stringify(v);
              if (localStorage.getItem(k) !== str) {
                _origSetItem.call(localStorage, k, str);
              }
            } catch {}
          }
          // Also back-fill any vex.* keys only present in localStorage (e.g. first-run
          // writes that happened before init() completed).
          for (let i = 0; i < localStorage.length; i++) {
            const k = localStorage.key(i);
            if (!k || !(k.startsWith('vex.') || k === 'vex-theme' || k.startsWith('vex_'))) continue;
            if (!(k in fileData)) this._enqueue('set', k, localStorage.getItem(k));
          }
        }

        this._ready = true;
        await this._flush();
        console.log('[PersistentStorage] ready — file keys:', Object.keys(fileData).length);
      } catch (e) {
        console.error('[PersistentStorage] init failed:', e);
      }
    })();
    return this._readyPromise;
  },

  _enqueue(op, key, value) {
    this._queue.set(key, { op, value });
    if (this._timer) return;
    this._timer = setTimeout(() => this._flush(), 300);
  },

  async _flush() {
    this._timer = null;
    if (!window.vex || !window.vex.persistSet) return;
    const batch = Array.from(this._queue.entries());
    this._queue.clear();
    for (const [key, { op, value }] of batch) {
      try {
        if (op === 'set') {
          // Store as raw string — exact byte-for-byte round-trip through the file.
          await window.vex.persistSet(key, typeof value === 'string' ? value : String(value));
        } else {
          await window.vex.persistDelete(key);
        }
      } catch (e) { console.error('[PersistentStorage] flush err', key, e); }
    }
  }
};

// Shim localStorage.setItem / removeItem so every existing call site is mirrored
// to the persistent file. Reads stay synchronous against the hydrated localStorage.
const _origSetItem = localStorage.setItem;
const _origRemoveItem = localStorage.removeItem;
localStorage.setItem = function (key, value) {
  _origSetItem.call(this, key, value);
  if (typeof key === 'string' && (key.startsWith('vex.') || key === 'vex-theme' || key.startsWith('vex_'))) {
    PersistentStorage._enqueue('set', key, value);
  }
};
localStorage.removeItem = function (key) {
  _origRemoveItem.call(this, key);
  if (typeof key === 'string' && (key.startsWith('vex.') || key === 'vex-theme' || key.startsWith('vex_'))) {
    PersistentStorage._enqueue('delete', key, null);
  }
};

window.PersistentStorage = PersistentStorage;

const VexStorage = {
  async save(key, data) {
    return await window.vex.saveData(key, data);
  },

  async load(key) {
    return await window.vex.loadData(key);
  },

  async saveTabs(tabs) {
    const serialized = tabs.map(t => ({
      id: t.id,
      url: t.url,
      title: t.title,
      // Persist the favicon so lazily-restored tabs show their icon before
      // their webview is ever created.
      favicon: t.favicon || null,
      pinned: t.pinned || false,
      groupId: t.groupId || null,
      // Phase 4a: tab-stack membership rides on the tab record alongside
      // groupId. Pre-4a saves don't have this field — `|| null` migrates
      // them transparently on load.
      stackId: t.stackId || null,
      sleeping: t.sleeping || false,
      originalUrl: t.originalUrl || null,
      scrollPosition: t.scrollPosition || null
    }));
    return this.save('tabs', serialized);
  },

  async loadTabs() {
    return (await this.load('tabs')) || [];
  },

  async saveGroups(groups) {
    return this.save('groups', groups);
  },

  async loadGroups() {
    return (await this.load('groups')) || [];
  },

  // Phase 4a — tab stacks. Mirrors saveGroups/loadGroups exactly. Stack
  // shape: { id, name, color, topTabId }. Persisted file: stacks.json.
  async saveStacks(stacks) {
    return this.save('stacks', stacks);
  },

  async loadStacks() {
    return (await this.load('stacks')) || [];
  },

  async saveSettings(settings) {
    return this.save('settings', settings);
  },

  async loadSettings() {
    return (await this.load('settings')) || {
      searchEngine: 'google',
      adBlocker: true,
      tabsVisible: true
    };
  },

  async addHistory(entry) {
    const history = await this.loadHistory();
    history.unshift({
      url: entry.url,
      title: entry.title,
      time: Date.now()
    });
    // Keep last 500
    if (history.length > 500) history.length = 500;
    return this.save('history', history);
  },

  async loadHistory() {
    return (await this.load('history')) || [];
  },

  async saveShortcuts(shortcuts) {
    return this.save('shortcuts', shortcuts);
  },

  async loadShortcuts() {
    return await this.load('shortcuts');
  }
};

// Renderer-safe export (Phase 4a — for tests). The renderer loads this file
// via <script> tag where `module` is undefined, so the guard keeps the
// global VexStorage / PersistentStorage surface unchanged.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { VexStorage, PersistentStorage };
}

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
  _versions: new Map(),
  _failures: 0,

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
            if (k === '__vexPreferenceStore' || this._queue.has(k)) continue;
            try {
              const str = typeof v === 'string' ? v : JSON.stringify(v);
              if (localStorage.getItem(k) !== str) {
                _origSetItem.call(localStorage, k, str);
              }
            } catch {}
          }
          // Remove stale Chromium copies of deleted preferences. New writes
          // made during hydration are already queued and must be preserved.
          for (let i = localStorage.length - 1; i >= 0; i--) {
            const k = localStorage.key(i);
            if (!k || !(k.startsWith('vex.') || k === 'vex-theme' || k.startsWith('vex_'))) continue;
            if (!Object.hasOwn(fileData, k) && !this._queue.has(k)) _origRemoveItem.call(localStorage, k);
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
    const version = (this._versions.get(key) || 0) + 1;
    this._versions.set(key, version);
    this._queue.set(key, { op, value, version });
    if (this._timer) return;
    this._timer = setTimeout(() => this._flush().catch(() => {}), 300);
  },

  async _flush() {
    if (this._timer) clearTimeout(this._timer);
    this._timer = null;
    if (!window.vex || !window.vex.persistSet) return;
    const batch = Array.from(this._queue.entries());
    this._queue.clear();
    // Keep batches in invocation order even if an earlier IPC is slow.
    const previous = this._flushPending || Promise.resolve();
    this._flushPending = previous.catch(() => {}).then(async () => {
    let failure = null;
    for (const [key, { op, value, version }] of batch) {
      try {
        if (op === 'set') {
          // Store as raw string — exact byte-for-byte round-trip through the file.
          if (await window.vex.persistSet(key, typeof value === 'string' ? value : String(value)) === false) throw new Error('Save was not acknowledged');
        } else {
          if (await window.vex.persistDelete(key) === false) throw new Error('Delete was not acknowledged');
        }
      } catch (e) {
        failure = e;
        if (this._versions.get(key) === version) this._queue.set(key, { op, value, version });
      }
    }
    if (failure) {
      window.dispatchEvent(new CustomEvent('vex-storage-status', { detail: { source: 'preferences', ok: false, message: 'Changes could not be saved. Retry before closing.' } }));
      if (++this._failures <= 3 && !this._timer) this._timer = setTimeout(() => this._flush().catch(() => {}), this._failures * 1000);
      throw failure;
    }
    this._failures = 0;
    window.dispatchEvent(new CustomEvent('vex-storage-status', { detail: { source: 'preferences', ok: true } }));
    });
    return this._flushPending;
  }
};

// Shim localStorage.setItem / removeItem so every existing call site is mirrored
// to the persistent file. Reads stay synchronous against the hydrated localStorage.
// Storage instances have a named-property setter: assigning setItem on the
// instance stores a STRING under that key instead of replacing the method.
// Patch the prototype and only mirror calls made on localStorage.
const _storageMethods = typeof Storage !== 'undefined' && localStorage instanceof Storage
  ? Storage.prototype : localStorage;
const _storageOriginalsKey = Symbol.for('vex.storage.originals');
const _storageOriginals = _storageMethods[_storageOriginalsKey] || {
  setItem: _storageMethods.setItem, removeItem: _storageMethods.removeItem, clear: _storageMethods.clear
};
if (!_storageMethods[_storageOriginalsKey]) {
  Object.defineProperty(_storageMethods, _storageOriginalsKey, { value: _storageOriginals });
}
const _origSetItem = _storageOriginals.setItem;
const _origRemoveItem = _storageOriginals.removeItem;
_storageMethods.setItem = function (key, value) {
  _origSetItem.call(this, key, value);
  key = String(key);
  if (this === localStorage && (key.startsWith('vex.') || key === 'vex-theme' || key.startsWith('vex_'))) {
    PersistentStorage._enqueue('set', key, this.getItem(key));
  }
};
_storageMethods.removeItem = function (key) {
  _origRemoveItem.call(this, key);
  key = String(key);
  if (this === localStorage && (key.startsWith('vex.') || key === 'vex-theme' || key.startsWith('vex_'))) {
    PersistentStorage._enqueue('delete', key, null);
  }
};
_storageMethods.clear = function () {
  const keys = this === localStorage ? Object.keys(this) : [];
  _storageOriginals.clear.call(this);
  for (const key of keys) {
    if (key.startsWith('vex.') || key === 'vex-theme' || key.startsWith('vex_')) {
      PersistentStorage._enqueue('delete', key, null);
    }
  }
};

window.PersistentStorage = PersistentStorage;
window.vex?.onFlushRequested?.(async () => {
  if (typeof WorkspaceManager !== 'undefined') WorkspaceManager.saveCurrentState();
  if (typeof TabManager !== 'undefined') await TabManager.persistTabs();
  await PersistentStorage._flush();
  await VexStorage.retryFailed();
  await window.vex.flushStorage?.();
});

const VexStorage = {
  _failed: new Map(),
  _versions: new Map(),
  async save(key, data) {
    const version = (this._versions.get(key) || 0) + 1;
    this._versions.set(key, version);
    try {
      const result = await window.vex.saveData(key, data);
      if (result === false) throw new Error('Save was not acknowledged');
      if (this._versions.get(key) === version) {
        this._failed.delete(key);
        window.dispatchEvent(new CustomEvent('vex-storage-status', { detail: { source: key, ok: true } }));
      }
      return result;
    } catch (error) {
      if (this._versions.get(key) === version) {
        this._failed.set(key, structuredClone(data));
        window.dispatchEvent(new CustomEvent('vex-storage-status', { detail: { source: key, ok: false, message: 'Could not save ' + key } }));
      }
      throw error;
    }
  },

  async retryFailed() { for (const [key, value] of [...this._failed]) await this.save(key, value); },
  async load(key) {
    return await window.vex.loadData(key);
  },

  async saveTabs(tabs) {
    if (window.VexTabPolicy) return this.save('tabs', window.VexTabPolicy.snapshot(tabs));
    const serialized = tabs
      // Ephemeral tabs (Tor 🧅, off-the-record) live in an in-memory partition
      // that's wiped on close — NEVER persist them. Restoring one would resurrect
      // the URL as a normal persist:main tab: it'd leak what you browsed
      // privately into your saved session AND reload it over your real
      // connection (no Tor, no isolation). Persist-partitioned tabs are fine.
      .filter(t => !(t.partition && !String(t.partition).startsWith('persist:')))
      .map(t => ({
      id: t.id,
      partition: t.partition || null,
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
      scrollPosition: t.scrollPosition || null,
      // "Prevent from sleeping" expiry (ms epoch; large value = until reverted).
      keepAwakeUntil: t.keepAwakeUntil || 0
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
    if (window.vex.addHistory) return window.vex.addHistory(entry);
    // Serialize read-modify-write operations: simultaneous tab loads must not
    // both read the same history and overwrite one another's new entry.
    const next = (this._historyWrite || Promise.resolve()).then(() => this._addHistory(entry));
    this._historyWrite = next.catch(() => {});
    return next;
  },

  async _addHistory(entry) {
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

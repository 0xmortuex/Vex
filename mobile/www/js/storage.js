// === Vex Mobile — storage ===
//
// One async key/value store over @capacitor/preferences (SharedPreferences on
// Android), with a localStorage fallback for desktop development. Values are
// JSON. Reads are served from an in-memory cache after the first load so the
// chrome can render synchronously once boot has finished.
//
// Keys mirror the desktop app's ('vex.bookmarks', 'vex.history', …) so a
// future sync path can move records between the two without renaming.

const VexStore = (() => {
  const cache = new Map();
  let prefs = null;

  function local() {
    return {
      async get({ key }) { return { value: localStorage.getItem(key) }; },
      async set({ key, value }) { localStorage.setItem(key, value); },
      async remove({ key }) { localStorage.removeItem(key); }
    };
  }

  return {
    async init() {
      const plugin = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Preferences;
      prefs = plugin || local();
    },

    // Load a key into the cache. Call for every key the chrome reads at boot.
    async prime(key, fallbackValue) {
      try {
        const { value } = await prefs.get({ key });
        cache.set(key, value == null ? fallbackValue : JSON.parse(value));
      } catch {
        cache.set(key, fallbackValue);
      }
      return cache.get(key);
    },

    get(key, fallbackValue) {
      return cache.has(key) ? cache.get(key) : fallbackValue;
    },

    async set(key, value) {
      cache.set(key, value);
      try { await prefs.set({ key, value: JSON.stringify(value) }); } catch (err) { console.error('[store] set', key, err); }
      return value;
    },

    async remove(key) {
      cache.delete(key);
      try { await prefs.remove({ key }); } catch {}
    },

    // Append to a capped, newest-first list (history, downloads, closed tabs).
    async push(key, entry, cap = 500) {
      const list = this.get(key, []);
      list.unshift(entry);
      if (list.length > cap) list.length = cap;
      return this.set(key, list);
    }
  };
})();

if (typeof window !== 'undefined') window.VexStore = VexStore;
if (typeof module !== 'undefined' && module.exports) module.exports = { VexStore };

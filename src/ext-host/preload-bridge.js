// === Vex extension host — the bridge preload ===
//
// Runs inside the extension's service worker (and its pages) via
// session.registerPreloadScript. That context is isolated from the worker's own
// scope — it has `require` and `ipcRenderer` but no `self` and no `chrome` — so
// the only way across is contextBridge, which does land in the worker's global
// scope. Verified: exposeInMainWorld here shows up as globalThis.vexBridge in
// the extension's service worker.
//
// This file deliberately implements no chrome.* API. It is a dumb pipe: the
// shim (which runs inside the extension's own scope and can therefore define
// `chrome.*`) calls through it, and main does the real work.

const { contextBridge, ipcRenderer } = require('electron');

// event key ("tabs.onUpdated") -> Set of callbacks registered by the shim
const listeners = new Map();

ipcRenderer.on('ext:event', (_e, msg) => {
  if (!msg || !msg.key) return;
  const set = listeners.get(msg.key);
  if (!set) return;
  for (const fn of set) {
    // One bad listener must not stop the others, and an exception here would
    // otherwise surface as an unhandled rejection inside the worker.
    try { fn(...(msg.args || [])); } catch (err) { console.error('[vex-ext] listener error', msg.key, err); }
  }
});

const api = {
  // chrome.foo.bar(...) -> invoke('foo', 'bar', args)
  invoke(namespace, method, args) {
    return ipcRenderer.invoke('ext:api', { namespace, method, args: args || [] });
  },

  addListener(key, fn) {
    if (typeof fn !== 'function') return;
    let set = listeners.get(key);
    if (!set) { listeners.set(key, (set = new Set())); ipcRenderer.send('ext:subscribe', key); }
    set.add(fn);
  },

  removeListener(key, fn) {
    const set = listeners.get(key);
    if (!set) return;
    set.delete(fn);
    if (!set.size) { listeners.delete(key); ipcRenderer.send('ext:unsubscribe', key); }
  },

  hasListener(key, fn) {
    const set = listeners.get(key);
    return !!(set && set.has(fn));
  },

  // Synchronous constants (extension IDs, manifest bits) that the shim needs
  // at module-evaluation time, before any promise can resolve.
  constants() {
    return ipcRenderer.sendSync('ext:constants');
  },
};

try {
  contextBridge.exposeInMainWorld('vexBridge', api);
} catch (err) {
  // exposeInMainWorld throws if the context is already torn down; nothing we
  // can do, and the shim degrades to no-op stubs.
  console.error('[vex-ext] bridge exposure failed', err);
}

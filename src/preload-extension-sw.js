// === Preload for extension service workers ===
//
// Registered on each session right before an extension loads (main.js,
// ensureExtensionSwPreload). An MV3 extension's background is a service
// worker, which never runs the page preload (preload-webview.js), so the
// chrome.storage.sync stand-in did not reach it: Return YouTube Dislike's
// worker could not record a vote (2026-09-28). This runs the same function in
// the worker's own world, before the extension's code. A website's service
// worker is left alone (the function needs chrome.runtime.id).
const { contextBridge } = require('electron');

// === BEGIN vex-storage-sync-shim ===
// Keep this block identical in src/preload-webview.js (extension pages) and
// src/preload-extension-sw.js (extension service workers); a test compares them.
//
// Electron has chrome.storage.sync, but every call fails with '"sync" is not
// available in this instance of Chrome'. Dark Reader read its settings as null
// and crashed; Return YouTube Dislike could not record a vote; Stylus and
// uBlock use it too. There is no account to sync with here, so "sync" is kept
// on this machine, in one reserved entry of the extension's own
// storage.local — the one place its background, service worker, popup and
// options page all share. The entry is hidden from the extension's own local
// reads, and its changes arrive as 'sync' changes everywhere.
function vexStorageSyncShim(c) {
  c = c || (typeof chrome !== 'undefined' ? chrome : null);
  // Only an extension has a runtime id; a website's service worker is left alone.
  if (!c || !c.runtime || !c.runtime.id || !c.storage || !c.storage.local || !c.storage.onChanged || c.storage.__vexSync) return false;
  var KEY = '__vexStorageSync';
  var local = c.storage.local;
  var origGet = local.get.bind(local);
  var origSet = local.set.bind(local);
  var origClear = typeof local.clear === 'function' ? local.clear.bind(local) : null;
  function answer(p, cb) {
    if (typeof cb === 'function') { p.then(function (v) { cb(v); }); return undefined; }
    return p;
  }
  function load() { return new Promise(function (res) { origGet(KEY, function (o) { res((o && o[KEY]) || {}); }); }); }
  function store(all) { return new Promise(function (res) { var o = {}; o[KEY] = all; origSet(o, function () { res(); }); }); }
  // One change at a time, so two quick sets cannot overwrite each other.
  var chain = Promise.resolve();
  function edit(fn) {
    var p = chain.then(load).then(function (all) { return store(fn(Object.assign({}, all))); });
    chain = p.catch(function () {});
    return p;
  }
  function pick(all, keys) {
    if (keys == null) return Object.assign({}, all);
    if (typeof keys === 'string') keys = [keys];
    var out = {};
    if (Array.isArray(keys)) { keys.forEach(function (k) { if (k in all) out[k] = all[k]; }); return out; }
    Object.keys(keys).forEach(function (k) { out[k] = k in all ? all[k] : keys[k]; });
    return out;
  }
  function diff(ch) {
    var o = ch.oldValue || {}, n = ch.newValue || {}, out = {};
    Object.keys(o).concat(Object.keys(n)).forEach(function (k) {
      if (k in out || JSON.stringify(o[k]) === JSON.stringify(n[k])) return;
      out[k] = {};
      if (k in o) out[k].oldValue = o[k];
      if (k in n) out[k].newValue = n[k];
    });
    return out;
  }
  // The reserved entry is not the extension's: keep it out of its local reads
  // and survive its local.clear().
  local.get = function (keys, cb) {
    if (typeof keys === 'function') { cb = keys; keys = null; }
    var everything = keys == null;
    return answer(new Promise(function (res) {
      origGet(keys, function (o) { o = Object.assign({}, o || {}); if (everything) delete o[KEY]; res(o); });
    }), cb);
  };
  if (origClear) {
    local.clear = function (cb) {
      return answer(load().then(function (keep) {
        return new Promise(function (res) { origClear(function () { res(); }); }).then(function () { return store(keep); });
      }), cb);
    };
  }
  var syncListeners = [];
  var ev = c.storage.onChanged;
  var nativeAdd = ev.addListener.bind(ev);
  var nativeRemove = ev.removeListener.bind(ev);
  var wrapped = [];
  nativeAdd(function (ch, area) {
    if (area !== 'local' || !ch[KEY]) return;
    var s = diff(ch[KEY]);
    if (Object.keys(s).length) syncListeners.slice().forEach(function (fn) { fn(s); });
  });
  ev.addListener = function (fn) {
    var w = function (ch, area) {
      if (area !== 'local' || !ch[KEY]) { fn(ch, area); return; }
      var rest = {};
      Object.keys(ch).forEach(function (k) { if (k !== KEY) rest[k] = ch[k]; });
      if (Object.keys(rest).length) fn(rest, 'local');
      var s = diff(ch[KEY]);
      if (Object.keys(s).length) fn(s, 'sync');
    };
    wrapped.push([fn, w]);
    nativeAdd(w);
  };
  ev.removeListener = function (fn) {
    for (var i = 0; i < wrapped.length; i++) if (wrapped[i][0] === fn) { nativeRemove(wrapped[i][1]); wrapped.splice(i, 1); return; }
    nativeRemove(fn);
  };
  ev.hasListener = function (fn) { return wrapped.some(function (p) { return p[0] === fn; }); };
  var sync = {
    QUOTA_BYTES: 102400, QUOTA_BYTES_PER_ITEM: 8192, MAX_ITEMS: 512,
    MAX_WRITE_OPERATIONS_PER_HOUR: 1800, MAX_WRITE_OPERATIONS_PER_MINUTE: 120,
    get: function (keys, cb) {
      if (typeof keys === 'function') { cb = keys; keys = null; }
      return answer(chain.then(load).then(function (all) { return pick(all, keys); }), cb);
    },
    set: function (items, cb) { return answer(edit(function (all) { Object.keys(items || {}).forEach(function (k) { all[k] = items[k]; }); return all; }), cb); },
    remove: function (keys, cb) { return answer(edit(function (all) { [].concat(keys).forEach(function (k) { delete all[k]; }); return all; }), cb); },
    clear: function (cb) { return answer(edit(function () { return {}; }), cb); },
    getBytesInUse: function (keys, cb) {
      if (typeof keys === 'function') { cb = keys; keys = null; }
      return answer(chain.then(load).then(function (all) { return JSON.stringify(pick(all, keys)).length; }), cb);
    },
    onChanged: {
      addListener: function (fn) { syncListeners.push(fn); },
      removeListener: function (fn) { var i = syncListeners.indexOf(fn); if (i >= 0) syncListeners.splice(i, 1); },
      hasListener: function (fn) { return syncListeners.indexOf(fn) >= 0; },
    },
  };
  Object.defineProperty(c.storage, 'sync', { value: sync, configurable: true, enumerable: true });
  Object.defineProperty(c.storage, '__vexSync', { value: true });
  return true;
}
// === END vex-storage-sync-shim ===

contextBridge.executeInMainWorld({ func: vexStorageSyncShim });

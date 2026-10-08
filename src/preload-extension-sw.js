// === Preload for extension service workers ===
//
// Registered on each session right before an extension loads (main.js,
// ensureExtensionSwPreload). An MV3 extension's background is a service
// worker, which never runs the page preload (preload-webview.js), so the
// chrome.storage.sync stand-in did not reach it: Return YouTube Dislike's
// worker could not record a vote (2026-09-28). This runs the same function in
// the worker's own world, before the extension's code. A website's service
// worker is left alone (the function needs chrome.runtime.id).
const { contextBridge, ipcRenderer } = require('electron');

// === BEGIN vex-extension-stand-ins ===
// Keep this block identical in src/preload-webview.js (extension pages) and
// src/preload-extension-sw.js (extension service workers); a test compares them.
//
// Electron gives an extension no chrome.permissions, no browserAction/action,
// no contextMenus, no commands and no chrome.extension.isAllowed*Access, and
// an extension that reads one of them while starting up throws there:
//   * Dark Reader's background read chrome.permissions.onRemoved and never
//     answered a page again (2026-09-27), and set its badge through
//     browserAction; its popup waited for ever on commands.getAll and
//     isAllowedFileSchemeAccess ("Loading, please wait", 2026-09-28);
//   * uBlock Origin stopped at contextMenus.onClicked (2026-09-28);
//   * Stylus's service worker at permissions.contains and Violentmonkey's at
//     extension.isAllowedIncognitoAccess, so both were dead while Vex showed
//     them "On" (2026-09-29).
// Each gets an honest stand-in: permissions reports what the manifest granted
// and Vex provides and grants nothing new; file access is allowed (Vex loads
// extensions with allowFileAccess) and there is no incognito here.
//
// Right-click menu items, the toolbar button's badge and title, and keyboard
// shortcuts are real (since 2026-10-08): extApi, where given, takes them to
// main ({ op, args }), which keeps the items and the badge, draws them in
// Vex's right-click menu and toolbar menu, and binds the keys
// (src/main/extension-ui.js, src/main/extension-commands.js). onExtEvent,
// where given, is called once with a function that main's events then reach
// ({ type, args }): a menu click, a shortcut, a click on the toolbar button.
// Every context of the extension that listens hears them, as in Chrome, and
// an item's own onclick runs in the context that made it.
//
// It runs in the extension's own world: directly in a page without isolation
// (a background page), through contextBridge.executeInMainWorld where the
// page is isolated (a toolbar popup, an options page) and in a service worker.
// Earlier, a popup's own chrome never got any of it (2026-09-29).
//
// askPopupTab, where given, asks main which tab the extension's toolbar popup
// was opened over. Electron calls whichever page has the focus the active tab,
// and the popup takes the focus, so asked for the active tab the extension got
// its own popup back: Dark Reader said "This page is protected by browser" and
// its site switch pointed at the popup (2026-09-28).
//
// openTab, where given, asks main to open a Vex tab: a web page or one of the
// extension's own pages (tabs.create, runtime.openOptionsPage). It answers
// with the tab made: { id, url, active }, id being the page's webContents id.
//
// closeTab, where given, asks main to close Vex tabs by those ids ({ ids }).
//
// askActiveTabs, where given, asks main which page is the tab in front in each
// Vex window ({ ids }) and in the Vex window used last ({ current }).
function vexExtensionStandIns(c, askPopupTab, openTab, closeTab, askActiveTabs, extApi, onExtEvent) {
  c = c || (typeof chrome !== 'undefined' ? chrome : null);
  // Only an extension has a runtime id; a website is left alone.
  if (!c || !c.runtime || !c.runtime.id || typeof c.runtime.getManifest !== 'function') return false;
  var manifest = c.runtime.getManifest() || {};
  function done(value) {
    return function () {
      var cb = arguments[arguments.length - 1];
      if (typeof cb === 'function') { setTimeout(function () { cb(value); }, 0); return undefined; }
      return Promise.resolve(value);
    };
  }
  function noEvent() { return { addListener: function () {}, removeListener: function () {}, hasListener: function () { return false; } }; }

  // Main's side of the menus, the badge and the shortcuts. A failure comes
  // back in main's own words, without the wrapping Electron puts round it.
  var api = typeof extApi === 'function' ? function (op, args) {
    return Promise.resolve(extApi({ op: op, args: args || {} })).catch(function (err) {
      throw new Error(String((err && err.message) || err).replace(/^Error invoking remote method '[^']*': (?:Error: )?/, ''));
    });
  } : null;
  // With a callback a failure is what Chrome calls an unchecked
  // runtime.lastError: said in the console, and the callback still runs.
  function settle(p, cb, what) {
    if (typeof cb !== 'function') return p;
    p.then(function (v) { cb(v); }, function (err) { console.error('Unchecked runtime.lastError (' + what + '): ' + err.message); cb(); });
    return undefined;
  }
  var hubs = {};
  var heard = false;
  var ownClicks = {};
  function deliver(msg) {
    if (!msg || typeof msg.type !== 'string') return;
    var args = Array.isArray(msg.args) ? msg.args : [];
    var call = function (fn) { try { fn.apply(null, args); } catch (err) { setTimeout(function () { throw err; }, 0); } };
    if (msg.type === 'menus.onClicked' && args[0] && Object.prototype.hasOwnProperty.call(ownClicks, String(args[0].menuItemId))) call(ownClicks[String(args[0].menuItemId)]);
    (hubs[msg.type] || []).slice().forEach(call);
  }
  function listen() {
    if (heard || typeof onExtEvent !== 'function') return;
    heard = true;
    onExtEvent(deliver);
  }
  function hubEvent(type) {
    var fns = hubs[type] || (hubs[type] = []);
    return {
      addListener: function (fn) { if (typeof fn === 'function' && fns.indexOf(fn) === -1) fns.push(fn); listen(); },
      removeListener: function (fn) { var i = fns.indexOf(fn); if (i !== -1) fns.splice(i, 1); },
      hasListener: function (fn) { return fns.indexOf(fn) !== -1; },
      hasListeners: function () { return fns.length > 0; },
    };
  }

  if (!c.permissions) {
    var granted = [].concat(manifest.permissions || [], manifest.host_permissions || []);
    var origins = granted.filter(function (p) { return /[:/*<]/.test(p); });
    // Permissions that never come with a chrome.<name> namespace of their own.
    var NO_NAMESPACE = ['activeTab', 'unlimitedStorage', 'background', 'clipboardRead', 'clipboardWrite', 'webRequestBlocking', 'geolocation'];
    var apis = granted.filter(function (p) {
      return !/[:/*<]/.test(p) && (typeof c[p] !== 'undefined' || NO_NAMESPACE.indexOf(p) !== -1);
    });
    var has = function (q) {
      q = q || {};
      return (q.permissions || []).every(function (p) { return apis.indexOf(p) !== -1; })
        && (q.origins || []).every(function (o) { return origins.indexOf(o) !== -1 || origins.indexOf('<all_urls>') !== -1; });
    };
    c.permissions = {
      contains: function (q, cb) { return done(has(q))(cb); },
      getAll: function (cb) { return done({ permissions: apis.slice(), origins: origins.slice() })(cb); },
      // Already granted: true. Anything more cannot be granted here: false.
      request: function (q, cb) { return done(has(q))(cb); },
      remove: function (q, cb) { return done(false)(cb); },
      onAdded: noEvent(),
      onRemoved: noEvent(),
    };
  }

  // The toolbar button: its badge and title are kept by main and drawn on the
  // extension's icon in Vex's extensions menu, for every tab or for one
  // (details.tabId). Its icon, popup and on/off stay as the manifest says.
  function actionApi() {
    var setter = function (prop, key) {
      return function (details, cb) {
        var d = details || {};
        return settle(api('action.set', { prop: prop, value: d[key], tabId: d.tabId }).then(function () { return undefined; }), cb, 'action.set');
      };
    };
    var getter = function (prop) {
      return function (details, cb) {
        if (typeof details === 'function') { cb = details; details = {}; }
        return settle(api('action.get', { prop: prop, tabId: (details || {}).tabId }), cb, 'action.get');
      };
    };
    return {
      setBadgeText: setter('text', 'text'), getBadgeText: getter('text'),
      setBadgeBackgroundColor: setter('bg', 'color'), getBadgeBackgroundColor: getter('bg'),
      setBadgeTextColor: setter('color', 'color'), getBadgeTextColor: getter('color'),
      setTitle: setter('title', 'title'), getTitle: getter('title'),
      setIcon: done(undefined), setPopup: done(undefined), getPopup: done(''),
      enable: done(undefined), disable: done(undefined), isEnabled: done(true),
      onClicked: hubEvent('action.onClicked'),
    };
  }
  function actionStub() {
    return {
      setIcon: done(undefined), setBadgeText: done(undefined), setBadgeBackgroundColor: done(undefined),
      setBadgeTextColor: done(undefined), setTitle: done(undefined), setPopup: done(undefined),
      getBadgeText: done(''), getTitle: done(manifest.name || ''), getPopup: done(''),
      enable: done(undefined), disable: done(undefined),
      onClicked: noEvent(),
    };
  }
  // Electron 42 has a chrome.action of its own in a service worker, which
  // keeps a badge nobody can see (found 2026-10-08): Vex's is put in its place.
  function takeOver(target, mine, what) {
    Object.keys(mine).forEach(function (k) {
      try { target[k] = mine[k]; } catch (e) { /* read-only: tried again below */ }
      if (target[k] !== mine[k]) { try { Object.defineProperty(target, k, { value: mine[k], configurable: true, writable: true }); } catch (e) { /* said below */ } }
      if (target[k] !== mine[k]) console.error('[Vex] could not provide ' + what + '.' + k + ' here');
    });
    return target;
  }
  var ACTION_KEYS = ['setBadgeText', 'getBadgeText', 'setBadgeBackgroundColor', 'getBadgeBackgroundColor', 'setBadgeTextColor', 'getBadgeTextColor', 'setTitle', 'getTitle', 'onClicked'];
  function actionFor(name) {
    if (!c[name]) { c[name] = api ? actionApi() : actionStub(); return; }
    if (!api) return;
    var mine = actionApi(), part = {};
    ACTION_KEYS.forEach(function (k) { part[k] = mine[k]; });
    takeOver(c[name], part, name);
  }
  if (manifest.browser_action) actionFor('browserAction');
  if (manifest.action) actionFor('action');

  // chrome.runtime.onInstalled: Electron never fires it, and most extensions
  // make their menu items there. Main fires it (main.js _extTellInstalled);
  // a listener hears that as well as anything Electron itself might send.
  if (api && c.runtime.onInstalled && typeof c.runtime.onInstalled.addListener === 'function') {
    var installed = c.runtime.onInstalled;
    var installedHub = hubEvent('runtime.onInstalled');
    var nativeOn = installed.addListener.bind(installed);
    var nativeOff = typeof installed.removeListener === 'function' ? installed.removeListener.bind(installed) : null;
    takeOver(installed, {
      addListener: function (fn) { nativeOn(fn); installedHub.addListener(fn); },
      removeListener: function (fn) { if (nativeOff) nativeOff(fn); installedHub.removeListener(fn); },
    }, 'runtime.onInstalled');
  }

  var perms = manifest.permissions || [];
  if ((perms.indexOf('contextMenus') !== -1 || perms.indexOf('menus') !== -1) && (!c.contextMenus || api)) {
    var menuId = 0;
    // Only what can cross to main: no functions.
    var plainProps = function (props) {
      var out = {};
      Object.keys(props || {}).forEach(function (k) { if (k !== 'onclick' && typeof props[k] !== 'function') out[k] = props[k]; });
      return out;
    };
    var ContextType = {}, ItemType = {};
    ['all', 'page', 'frame', 'selection', 'link', 'editable', 'image', 'video', 'audio', 'launcher', 'browser_action', 'page_action', 'action'].forEach(function (t) { ContextType[t.toUpperCase()] = t; });
    ['normal', 'checkbox', 'radio', 'separator'].forEach(function (t) { ItemType[t.toUpperCase()] = t; });
    var menusApi = api ? {
      ACTION_MENU_TOP_LEVEL_LIMIT: 6, ContextType: ContextType, ItemType: ItemType,
      create: function (props, cb) {
        props = props || {};
        var id = props.id != null ? props.id : ++menuId;
        var plain = plainProps(props);
        plain.id = id;
        if (typeof props.onclick === 'function') { ownClicks[String(id)] = props.onclick; listen(); }
        var p = api('menus.create', { props: plain }).then(function () { return undefined; });
        if (typeof cb === 'function') settle(p, cb, 'contextMenus.create');
        else p.catch(function (err) { console.error('Unchecked runtime.lastError (contextMenus.create): ' + err.message); });
        return id;
      },
      update: function (id, props, cb) {
        props = props || {};
        if (typeof props.onclick === 'function') { ownClicks[String(id)] = props.onclick; listen(); }
        return settle(api('menus.update', { id: id, props: plainProps(props) }).then(function () { return undefined; }), cb, 'contextMenus.update');
      },
      remove: function (id, cb) {
        delete ownClicks[String(id)];
        return settle(api('menus.remove', { id: id }).then(function () { return undefined; }), cb, 'contextMenus.remove');
      },
      removeAll: function (cb) {
        ownClicks = {};
        return settle(api('menus.removeAll').then(function () { return undefined; }), cb, 'contextMenus.removeAll');
      },
      onClicked: hubEvent('menus.onClicked'),
    } : {
      create: function (props, cb) { if (typeof cb === 'function') setTimeout(cb, 0); return (props && props.id) || ++menuId; },
      update: done(undefined), remove: done(undefined), removeAll: done(undefined),
      onClicked: noEvent(),
    };
    if (!c.contextMenus) c.contextMenus = menusApi;
    else takeOver(c.contextMenus, menusApi, 'contextMenus');
  }

  if (!c.commands || api) {
    var commands = manifest.commands || {};
    var commandsApi = api ? {
      getAll: function (cb) { return settle(api('commands.getAll'), cb, 'commands.getAll'); },
      onCommand: hubEvent('commands.onCommand'),
    } : {
      getAll: done(Object.keys(commands).map(function (name) {
        return { name: name, description: (commands[name] && commands[name].description) || '', shortcut: '' };
      })),
      onCommand: noEvent(),
    };
    if (!c.commands) c.commands = commandsApi;
    else takeOver(c.commands, commandsApi, 'commands');
  }

  if (!c.extension) c.extension = {};
  if (typeof c.extension.isAllowedFileSchemeAccess !== 'function') c.extension.isAllowedFileSchemeAccess = done(true);
  if (typeof c.extension.isAllowedIncognitoAccess !== 'function') c.extension.isAllowedIncognitoAccess = done(false);
  if (typeof c.extension.inIncognitoContext === 'undefined') c.extension.inIncognitoContext = false;

  // Stylus's worker read webNavigation.onCommitted and Violentmonkey's
  // cookies.getAll while starting, and both died there (2026-09-29). Electron
  // has neither. Here navigation events never fire, only a tab's top frame is
  // known, no cookies are readable, and changing one fails and says why.
  // Stylus's popup maps over getAllFrames' answer, and null threw "reading
  // 'length'" (found 2026-09-29): the top frame is the tab itself. A tab that
  // does not exist has no frames, which Chrome answers with null.
  function topFrame(details) {
    if (!c.tabs || typeof c.tabs.get !== 'function' || !details || !Number.isInteger(details.tabId)) return Promise.resolve(null);
    return Promise.resolve(c.tabs.get(details.tabId)).then(function (tab) {
      return tab ? { frameId: 0, parentFrameId: -1, processId: -1, url: tab.url || '', errorOccurred: false } : null;
    }, function () { return null; });
  }
  function answerWith(p, cb) {
    if (typeof cb !== 'function') return p;
    p.then(function (v) { cb(v); }, function (err) { setTimeout(function () { throw err; }, 0); });
    return undefined;
  }
  if (perms.indexOf('webNavigation') !== -1 && !c.webNavigation) {
    c.webNavigation = {
      getFrame: function (details, cb) { return answerWith(details && details.frameId === 0 ? topFrame(details) : Promise.resolve(null), cb); },
      getAllFrames: function (details, cb) { return answerWith(topFrame(details).then(function (f) { return f ? [f] : null; }), cb); },
      onBeforeNavigate: noEvent(), onCommitted: noEvent(), onDOMContentLoaded: noEvent(), onCompleted: noEvent(),
      onErrorOccurred: noEvent(), onCreatedNavigationTarget: noEvent(), onReferenceFragmentUpdated: noEvent(),
      onTabReplaced: noEvent(), onHistoryStateUpdated: noEvent(),
    };
  }
  if (perms.indexOf('cookies') !== -1 && !c.cookies) {
    var noCookies = function () { return Promise.reject(new Error('chrome.cookies is not available in Vex')); };
    c.cookies = {
      get: done(null), getAll: done([]), getAllCookieStores: done([]),
      set: noCookies, remove: noCookies,
      onChanged: noEvent(),
    };
  }

  // A toolbar popup is not a tab: Chrome answers undefined (Stylus's popup
  // called it and drew nothing, 2026-09-29).
  if (c.tabs && typeof c.tabs.getCurrent !== 'function') c.tabs.getCurrent = done(undefined);

  // Electron calls a tab active when its page has the focus. It cannot know
  // which Vex tab is in front, so with Vex's own bar focused no tab was
  // active, or every one was, and {active: true} named the wrong tabs (found
  // 2026-09-30). Main says which pages are in front; tabs.query and tabs.get
  // answer with that, and {active: true} with currentWindow or
  // lastFocusedWindow is the one tab in front of the Vex window used last.
  // Electron puts every tab in one window, so currentWindow alone narrows
  // nothing.
  var FRONT_KEYS = ['active', 'highlighted', 'currentWindow', 'lastFocusedWindow'];
  if (typeof askActiveTabs === 'function' && c.tabs && typeof c.tabs.query === 'function' && typeof c.tabs.get === 'function') {
    var nativeQuery = c.tabs.query.bind(c.tabs);
    var nativeGet = c.tabs.get.bind(c.tabs);
    var inFront = function (tab, front) {
      if (!tab) return tab;
      var on = front.ids.indexOf(tab.id) !== -1;
      return Object.assign({}, tab, { active: on, highlighted: on, selected: on });
    };
    c.tabs.query = function (q, cb) {
      q = q || {};
      var rest = {};
      Object.keys(q).forEach(function (k) { if (FRONT_KEYS.indexOf(k) === -1) rest[k] = q[k]; });
      var oneWindow = q.currentWindow === true || q.lastFocusedWindow === true;
      var p = Promise.all([nativeQuery(rest), askActiveTabs()]).then(function (r) {
        var front = r[1];
        return (r[0] || []).map(function (t) { return inFront(t, front); }).filter(function (t) {
          if (typeof q.active === 'boolean' && t.active !== q.active) return false;
          if (typeof q.highlighted === 'boolean' && t.highlighted !== q.highlighted) return false;
          if ((q.active === true || q.highlighted === true) && oneWindow && t.id !== front.current) return false;
          return true;
        });
      });
      return answerWith(p, cb);
    };
    // A tab that is not there fails in Electron's own words (with the
    // callback, through chrome.runtime.lastError), as before.
    c.tabs.get = function (id, cb) {
      if (typeof cb !== 'function') return Promise.all([nativeGet(id), askActiveTabs()]).then(function (r) { return inFront(r[0], r[1]); });
      return nativeGet(id, function (tab) {
        if (!tab) return cb(tab);
        answerWith(askActiveTabs().then(function (front) { return inFront(tab, front); }), cb);
      });
    };
  }

  // While this extension's popup is open, a question for the active tab is
  // about the tab under it, from whichever of its contexts asks: Stylus's
  // popup asks its service worker, which heard [] and the popup drew nothing
  // (found 2026-09-29). A question that also filters (url, title, …) is left
  // to Electron.
  //
  // Opening the popup grants an extension with "activeTab" the tab under it,
  // as clicking its button does in Chrome: main then also answers that tab's
  // url, title and favIconUrl, which Electron's tabs.get leaves out for an
  // extension with no "tabs" or host permission. Material Icons for GitHub
  // read no address there and said "Not Supported" (found 2026-10-04).
  var WINDOW_ONLY = ['active', 'currentWindow', 'lastFocusedWindow', 'windowId', 'windowType'];
  if (typeof askPopupTab === 'function' && c.tabs && typeof c.tabs.query === 'function' && typeof c.tabs.get === 'function') {
    var query = c.tabs.query.bind(c.tabs);
    var get = c.tabs.get.bind(c.tabs);
    var granted = function (tab, over) {
      if (!tab || !over || over.tab !== tab.id) return tab;
      var seen = {};
      ['url', 'title', 'favIconUrl'].forEach(function (k) { if (typeof over[k] === 'string' && !tab[k]) seen[k] = over[k]; });
      return Object.keys(seen).length ? Object.assign({}, tab, seen) : tab;
    };
    c.tabs.query = function (q, cb) {
      var p = query(q || {}).then(function (tabs) {
        tabs = tabs || [];
        if (!q || q.active !== true || Object.keys(q).some(function (k) { return WINDOW_ONLY.indexOf(k) === -1; })) return tabs;
        return askPopupTab().then(function (over) {
          if (!over) return tabs;
          var rest = tabs.filter(function (t) { return t.id !== over.popup && t.id !== over.tab; });
          if (over.tab == null) return rest;
          return get(over.tab).then(function (tab) { return tab ? [Object.assign({}, granted(tab, over), { active: true })].concat(rest) : rest; });
        });
      });
      return answerWith(p, cb);
    };
    // A tab that is not there still fails in Electron's own words.
    c.tabs.get = function (id, cb) {
      var withGrant = function (tab) { return tab ? askPopupTab().then(function (over) { return granted(tab, over); }) : tab; };
      if (typeof cb !== 'function') return Promise.resolve(get(id)).then(withGrant);
      return get(id, function (tab) {
        if (!tab) return cb(tab);
        answerWith(Promise.resolve(withGrant(tab)), cb);
      });
    };
  }

  // Electron has no tabs.create, and its runtime.openOptionsPage fails: a
  // popup's "Manage", "Options" and "Report a bug" did nothing (found
  // 2026-09-29). Both open a Vex tab through main, which opens only web pages
  // and this extension's own pages. A relative address is the extension's.
  // tabs.create answered undefined, so an extension had no id to update or
  // close the tab by (found 2026-09-29): it answers with the tab, as Electron's
  // tabs.get describes it (window, index) where it knows the page yet.
  if (typeof openTab === 'function' && typeof c.runtime.getURL === 'function') {
    var base = c.runtime.getURL('');
    var openUrl = function (url, active) {
      if (!url) return Promise.reject(new Error('Vex opens a tab for an extension only with an address'));
      return Promise.resolve(openTab({ url: new URL(String(url), base).href, active: active !== false }));
    };
    var asTab = function (made) {
      var tab = { id: made.id, index: 0, windowId: 0, url: made.url, pendingUrl: made.url, active: made.active };
      if (!c.tabs || typeof c.tabs.get !== 'function') return tab;
      return Promise.resolve(c.tabs.get(made.id)).then(function (known) {
        if (!known) return tab;
        return Object.assign({}, known, { url: known.url || made.url, pendingUrl: made.url, active: made.active, highlighted: made.active });
      });
    };
    if (c.tabs && typeof c.tabs.create !== 'function') {
      c.tabs.create = function (props, cb) { return answerWith(openUrl(props && props.url, props && props.active).then(asTab), cb); };
    }
    var optionsPage = manifest.options_page || (manifest.options_ui && manifest.options_ui.page) || null;
    c.runtime.openOptionsPage = function (cb) {
      return answerWith(optionsPage ? openUrl(optionsPage, true).then(function () { return undefined; }) : Promise.reject(new Error('This extension has no options page')), cb);
    };
  }

  // Electron has no tabs.remove either, so an extension that closed a tab it
  // had opened threw there (found 2026-09-30). Main closes only a Vex tab in
  // this extension's session; an id that is none fails as in Chrome, "No tab
  // with id: N." (without the wrapping Electron puts round an IPC failure).
  if (typeof closeTab === 'function' && c.tabs && typeof c.tabs.remove !== 'function') {
    c.tabs.remove = function (ids, cb) {
      var p = Promise.resolve(closeTab({ ids: [].concat(ids) })).then(function () { return undefined; }, function (err) {
        throw new Error(String((err && err.message) || err).replace(/^Error invoking remote method '[^']*': (?:Error: )?/, ''));
      });
      return answerWith(p, cb);
    };
  }
  return true;
}
// === END vex-extension-stand-ins ===

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

// A worker's IPC reaches its own ServiceWorkerMain in main (main.js,
// _wireExtensionWorkerIpc), which answers only an extension's worker.
const askPopupTab = () => ipcRenderer.invoke('extensions:popup-tab');
const openTab = (request) => ipcRenderer.invoke('extensions:open-tab', request);
const closeTab = (request) => ipcRenderer.invoke('extensions:close-tab', request);
const askActiveTabs = () => ipcRenderer.invoke('extensions:active-tabs');
// Menus, badge, shortcuts (main.js _extApi), and main's events for them
// (serviceWorkerMain.send, main.js _extDispatch).
const extApi = (request) => ipcRenderer.invoke('extensions:api', request);
const onExtEvent = (fn) => { ipcRenderer.on('extensions:event', (_event, msg) => fn(msg)); };
contextBridge.executeInMainWorld({ func: vexExtensionStandIns, args: [null, askPopupTab, openTab, closeTab, askActiveTabs, extApi, onExtEvent] });
contextBridge.executeInMainWorld({ func: vexStorageSyncShim });

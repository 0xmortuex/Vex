// === Vex extension host — the chrome.* shim ===
//
// Copied into the extension's own directory at install time and evaluated
// before the extension's bundle, in both the service worker and every
// extension page. It defines the chrome.* namespaces Electron doesn't ship,
// forwarding each call over globalThis.vexBridge to Vex's main process.
//
// Written as a plain IIFE with no exports on purpose: the service worker
// imports it as an ES module, extension pages load it as a classic <script>,
// and this is the one shape that is valid in both.
//
// Rules it follows:
//   - Never clobber a namespace Electron already implements properly.
//   - Support both calling conventions. Chrome APIs take an optional trailing
//     callback *and* return a promise when it's omitted; MV3 code uses both,
//     often in the same file.
//   - Enum constants must be real values available synchronously — the UI reads
//     chrome.tabGroups.Color at module scope, and a promise there is what
//     originally crashed the whole extension.

(function () {
  'use strict';

  const bridge = globalThis.vexBridge;
  const g = globalThis;
  if (typeof g.chrome === 'undefined') g.chrome = {};
  const chrome = g.chrome;

  if (!bridge) {
    console.error('[vex-ext] bridge missing — chrome.* shims will be inert');
  }

  // --- call plumbing -------------------------------------------------------

  // Build a method that works whether the caller passes a callback or awaits.
  function m(namespace, method) {
    return function (...args) {
      let cb = null;
      if (args.length && typeof args[args.length - 1] === 'function') cb = args.pop();

      if (!bridge) {
        if (cb) { try { cb(undefined); } catch (e) {} return undefined; }
        return Promise.resolve(undefined);
      }

      const p = bridge.invoke(namespace, method, args);
      if (!cb) return p;

      p.then(
        (r) => { try { cb(r); } catch (e) { console.error('[vex-ext] callback threw', e); } },
        (err) => {
          // Chrome reports failures through runtime.lastError, not rejection.
          chrome.runtime.lastError = { message: String(err && err.message || err) };
          try { cb(undefined); } catch (e) {}
          // Chrome clears lastError once the callback returns.
          setTimeout(() => { delete chrome.runtime.lastError; }, 0);
        }
      );
      return undefined;
    };
  }

  function ev(key) {
    return {
      addListener(fn) { bridge && bridge.addListener(key, fn); },
      removeListener(fn) { bridge && bridge.removeListener(key, fn); },
      hasListener(fn) { return bridge ? bridge.hasListener(key, fn) : false; },
      // Some MV3 bundles feature-detect these; a missing one throws on access.
      addRules() {}, removeRules() {}, getRules() {},
    };
  }

  // Define a whole namespace at once. `methods` become bridged calls,
  // `events` become listener objects, `statics` are copied verbatim.
  function ns(name, { methods = [], events = [], statics = {} } = {}, { force = false } = {}) {
    const existing = chrome[name];
    if (existing && !force) {
      // Fill only the gaps — Electron's partial implementation stays authoritative.
      for (const k of methods) if (typeof existing[k] !== 'function') existing[k] = m(name, k);
      for (const e of events) if (!existing[e]) existing[e] = ev(name + '.' + e);
      for (const [k, v] of Object.entries(statics)) if (existing[k] === undefined) existing[k] = v;
      return existing;
    }
    const obj = {};
    for (const k of methods) obj[k] = m(name, k);
    for (const e of events) obj[e] = ev(name + '.' + e);
    Object.assign(obj, statics);
    try {
      Object.defineProperty(chrome, name, { value: obj, configurable: true, writable: true, enumerable: true });
    } catch (err) {
      chrome[name] = obj;
    }
    return obj;
  }

  // --- tabs ---------------------------------------------------------------
  // Overridden rather than gap-filled: Electron's partial chrome.tabs uses its
  // own id space, and the extension cross-references tab ids with
  // chrome.debugger targets. Two id spaces would attach the debugger to the
  // wrong page. Vex uses webContents ids for both. Native sendMessage/connect
  // are preserved — those drive content-script messaging and Electron's
  // implementation is the correct one.
  {
    const nativeTabs = chrome.tabs || {};
    const sendMessage = nativeTabs.sendMessage;
    const connect = nativeTabs.connect;

    const tabs = ns('tabs', {
      methods: [
        'get', 'getCurrent', 'query', 'create', 'update', 'remove', 'reload',
        'duplicate', 'captureVisibleTab', 'goBack', 'goForward', 'discard',
        'move', 'highlight', 'group', 'ungroup', 'setZoom', 'getZoom',
        'detectLanguage', 'executeScript', 'insertCSS', 'removeCSS',
      ],
      events: [
        'onCreated', 'onUpdated', 'onRemoved', 'onActivated', 'onReplaced',
        'onMoved', 'onAttached', 'onDetached', 'onZoomChange', 'onHighlighted',
      ],
      statics: { TAB_ID_NONE: -1, TAB_INDEX_NONE: -1 },
    }, { force: true });

    if (typeof sendMessage === 'function') tabs.sendMessage = sendMessage.bind(nativeTabs);
    if (typeof connect === 'function') tabs.connect = connect.bind(nativeTabs);
  }

  // --- debugger -----------------------------------------------------------
  // The one the agent actually needs. Backed by webContents.debugger, which is
  // the same CDP surface chrome.debugger exposes in Chrome.
  ns('debugger', {
    methods: ['attach', 'detach', 'sendCommand', 'getTargets'],
    events: ['onEvent', 'onDetach'],
  });

  // --- side panel ---------------------------------------------------------
  ns('sidePanel', {
    methods: ['open', 'close', 'setOptions', 'getOptions', 'setPanelBehavior', 'getPanelBehavior'],
  });

  // --- tab groups ---------------------------------------------------------
  // Color is read at module scope by the UI, so it has to be a real frozen
  // object rather than anything async.
  ns('tabGroups', {
    methods: ['get', 'query', 'update', 'move'],
    events: ['onCreated', 'onUpdated', 'onRemoved', 'onMoved'],
    statics: {
      TAB_GROUP_ID_NONE: -1,
      Color: Object.freeze({
        GREY: 'grey', BLUE: 'blue', RED: 'red', YELLOW: 'yellow', GREEN: 'green',
        PINK: 'pink', PURPLE: 'purple', CYAN: 'cyan', ORANGE: 'orange',
      }),
    },
  });

  // --- windows ------------------------------------------------------------
  ns('windows', {
    methods: ['get', 'getCurrent', 'getLastFocused', 'getAll', 'create', 'update', 'remove'],
    events: ['onCreated', 'onRemoved', 'onFocusChanged', 'onBoundsChanged'],
    statics: {
      WINDOW_ID_NONE: -1,
      WINDOW_ID_CURRENT: -2,
      CreateType: Object.freeze({ NORMAL: 'normal', POPUP: 'popup', PANEL: 'panel' }),
      WindowState: Object.freeze({
        NORMAL: 'normal', MINIMIZED: 'minimized', MAXIMIZED: 'maximized',
        FULLSCREEN: 'fullscreen', LOCKED_FULLSCREEN: 'locked-fullscreen',
      }),
      WindowType: Object.freeze({ NORMAL: 'normal', POPUP: 'popup', PANEL: 'panel', APP: 'app', DEVTOOLS: 'devtools' }),
    },
  });

  // --- webNavigation ------------------------------------------------------
  ns('webNavigation', {
    methods: ['getFrame', 'getAllFrames'],
    events: [
      'onBeforeNavigate', 'onCommitted', 'onDOMContentLoaded', 'onCompleted',
      'onErrorOccurred', 'onCreatedNavigationTarget', 'onReferenceFragmentUpdated',
      'onTabReplaced', 'onHistoryStateUpdated',
    ],
  });

  // --- notifications ------------------------------------------------------
  ns('notifications', {
    methods: ['create', 'update', 'clear', 'getAll', 'getPermissionLevel'],
    events: ['onClicked', 'onClosed', 'onButtonClicked', 'onPermissionLevelChanged', 'onShowSettings'],
    statics: { TemplateType: Object.freeze({ BASIC: 'basic', IMAGE: 'image', LIST: 'list', PROGRESS: 'progress' }) },
  });

  // --- downloads ----------------------------------------------------------
  ns('downloads', {
    methods: ['download', 'search', 'pause', 'resume', 'cancel', 'erase', 'open', 'show', 'showDefaultFolder', 'removeFile', 'getFileIcon'],
    events: ['onCreated', 'onErased', 'onChanged', 'onDeterminingFilename'],
  });

  // --- permissions --------------------------------------------------------
  // Electron has no runtime permission model. Everything in the manifest is
  // effectively granted, so reporting otherwise would permanently disable
  // features the extension is entitled to.
  ns('permissions', {
    methods: ['getAll', 'contains', 'request', 'remove'],
    events: ['onAdded', 'onRemoved'],
  });

  // --- commands -----------------------------------------------------------
  ns('commands', { methods: ['getAll'], events: ['onCommand'] });

  // --- contextMenus -------------------------------------------------------
  ns('contextMenus', {
    methods: ['create', 'update', 'remove', 'removeAll'],
    events: ['onClicked'],
    statics: { ACTION_MENU_TOP_LEVEL_LIMIT: 6 },
  });

  // --- identity -----------------------------------------------------------
  ns('identity', {
    methods: ['getAuthToken', 'removeCachedAuthToken', 'launchWebAuthFlow', 'getProfileUserInfo', 'clearAllCachedAuthTokens'],
    events: ['onSignInChanged'],
    statics: {
      getRedirectURL(pathStr) {
        const id = (chrome.runtime && chrome.runtime.id) || 'extension';
        return 'https://' + id + '.chromiumapp.org/' + (pathStr || '');
      },
    },
  });

  // --- misc gap-fills -----------------------------------------------------
  ns('cookies', { methods: ['get', 'getAll', 'set', 'remove', 'getAllCookieStores'], events: ['onChanged'] });
  ns('idle', { methods: ['queryState', 'setDetectionInterval', 'getAutoLockDelay'], events: ['onStateChanged'] });
  ns('browsingData', { methods: ['remove', 'removeCache', 'removeCookies', 'settings'] });
  ns('system', { statics: { cpu: { getInfo: m('system', 'cpu.getInfo') }, memory: { getInfo: m('system', 'memory.getInfo') } } });

  // chrome.storage.session is missing in Electron (only .local ships). It is
  // ordinary ephemeral storage, so main keeps it in memory for the app's life.
  if (chrome.storage && !chrome.storage.session) {
    chrome.storage.session = {
      get: m('storage', 'session.get'),
      set: m('storage', 'session.set'),
      remove: m('storage', 'session.remove'),
      clear: m('storage', 'session.clear'),
      getBytesInUse: m('storage', 'session.getBytesInUse'),
      setAccessLevel: m('storage', 'session.setAccessLevel'),
      onChanged: ev('storage.session.onChanged'),
    };
  }

  // Runtime gap-fills. External messaging is how claude.ai talks to the
  // extension (see externally_connectable in the manifest).
  if (chrome.runtime) {
    if (!chrome.runtime.onMessageExternal) chrome.runtime.onMessageExternal = ev('runtime.onMessageExternal');
    if (!chrome.runtime.onConnectExternal) chrome.runtime.onConnectExternal = ev('runtime.onConnectExternal');
    if (!chrome.runtime.onInstalled) chrome.runtime.onInstalled = ev('runtime.onInstalled');
    if (!chrome.runtime.onStartup) chrome.runtime.onStartup = ev('runtime.onStartup');
    if (!chrome.runtime.onSuspend) chrome.runtime.onSuspend = ev('runtime.onSuspend');
    if (!chrome.runtime.onUpdateAvailable) chrome.runtime.onUpdateAvailable = ev('runtime.onUpdateAvailable');
    if (!chrome.runtime.getPlatformInfo) chrome.runtime.getPlatformInfo = m('runtime', 'getPlatformInfo');
    if (!chrome.runtime.setUninstallURL) chrome.runtime.setUninstallURL = m('runtime', 'setUninstallURL');
    if (!chrome.runtime.openOptionsPage) chrome.runtime.openOptionsPage = m('runtime', 'openOptionsPage');
    if (!chrome.runtime.connectNative) {
      // No native messaging host in Vex. Return a well-formed port that
      // disconnects immediately rather than throwing — the extension treats a
      // failed native connection as "feature unavailable" and moves on.
      chrome.runtime.connectNative = function () {
        const port = {
          name: 'vex-null', postMessage() {}, disconnect() {},
          onMessage: { addListener() {}, removeListener() {}, hasListener() { return false; } },
          onDisconnect: { addListener(fn) { setTimeout(() => { try { fn(port); } catch (e) {} }, 0); }, removeListener() {}, hasListener() { return false; } },
        };
        return port;
      };
    }
  }

  if (chrome.action) {
    for (const k of ['setBadgeText', 'getBadgeText', 'setBadgeBackgroundColor', 'setIcon', 'setTitle', 'getTitle', 'enable', 'disable', 'setPopup', 'getPopup', 'openPopup']) {
      if (typeof chrome.action[k] !== 'function') chrome.action[k] = m('action', k);
    }
    if (!chrome.action.onClicked) chrome.action.onClicked = ev('action.onClicked');
  }

  if (chrome.scripting && !chrome.scripting.registerContentScripts) {
    for (const k of ['registerContentScripts', 'getRegisteredContentScripts', 'unregisterContentScripts', 'updateContentScripts']) {
      chrome.scripting[k] = m('scripting', k);
    }
  }

  console.log('[vex-ext] chrome shim installed (' +
    (typeof ServiceWorkerGlobalScope !== 'undefined' ? 'service-worker' : 'page') + ')');
})();

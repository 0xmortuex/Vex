// === Vex extension host — chrome.* implementations ===
//
// Every call the shim makes lands here. These are real implementations on top
// of Electron and Vex, not stubs: chrome.tabs enumerates Vex's actual <webview>
// guests, chrome.debugger drives webContents.debugger (the same CDP surface
// Chrome exposes to extensions), chrome.notifications posts real OS
// notifications, and so on.
//
// Tab identity is the webContents id throughout. That's the invariant that
// makes chrome.tabs and chrome.debugger agree — an extension that queries a
// tab and then attaches the debugger to it must land on the same page.

const { ipcMain, webContents, BrowserWindow, Notification, session, app, shell } = require('electron');
const fs = require('fs');
const path = require('path');
const diag = require('./diag');

let _activeTabId = null;         // told to us by Vex's renderer
let _manifest = null;            // the installed extension's manifest
let _extensionId = null;
let _extPath = null;             // on-disk root, for scripting file injection
const _insertedCss = new Map();  // insertCSS key -> webContents id
let _onSidePanelOpen = null;     // callback into Vex's renderer

// event key -> Set<WebContents> (the SW / extension pages that subscribed)
const _subs = new Map();
// keys we've already wired a real source event for
const _wired = new Set();
// chrome.storage.session — ephemeral by definition, so memory is correct
const _sessionStore = new Map();

// --- helpers ---------------------------------------------------------------

function guests() {
  try {
    return webContents.getAllWebContents().filter(wc => {
      if (wc.isDestroyed()) return false;
      try {
        if (wc.getType() !== 'webview') return false;
        // The extension's own pages render in webviews too (the side panel is
        // one). They are not browsing tabs, and offering them as tabs makes
        // the extension try to act on itself.
        const u = wc.getURL() || '';
        if (u.startsWith('chrome-extension://')) return false;
        return true;
      } catch { return false; }
    });
  } catch { return []; }
}

// Which guest counts as "the active tab".
//
// The renderer reports this as the user switches tabs, but there are windows
// where it hasn't reported yet — startup, or a tab closing — and during those
// the extension asks for the active tab, gets nothing, and throws "No active
// tab" with no way to recover. Falling back to the first real guest keeps it
// working, since a browser showing any page always has a current one.
function activeGuest() {
  const list = guests();
  if (!list.length) return null;
  const known = list.find(wc => wc.id === _activeTabId);
  if (known) return known;
  if (_activeTabId != null) {
    diag.write('warn', `active tab ${_activeTabId} is not a live guest; falling back to ${list[0].id}`);
  }
  return list[0];
}

function wcById(id) {
  const n = Number(id);
  if (!Number.isFinite(n)) return null;
  try {
    const wc = webContents.fromId(n);
    return wc && !wc.isDestroyed() ? wc : null;
  } catch { return null; }
}

function toTab(wc, index = 0, activeId = null) {
  let url = '', title = '';
  try { url = wc.getURL() || ''; } catch {}
  try { title = wc.getTitle() || ''; } catch {}
  // Resolve "active" against the same fallback everything else uses, so a tab
  // is never reported as active:false across the board.
  const act = activeId != null ? activeId : (() => { const g = activeGuest(); return g ? g.id : null; })();
  return {
    id: wc.id,
    index,
    windowId: 1,
    active: wc.id === act,
    highlighted: wc.id === act,
    selected: wc.id === act,
    url,
    pendingUrl: url,
    title,
    favIconUrl: '',
    status: (() => { try { return wc.isLoading() ? 'loading' : 'complete'; } catch { return 'complete'; } })(),
    pinned: false,
    audible: (() => { try { return wc.isCurrentlyAudible(); } catch { return false; } })(),
    mutedInfo: { muted: (() => { try { return wc.isAudioMuted(); } catch { return false; } })() },
    discarded: false,
    autoDiscardable: true,
    incognito: false,
    groupId: -1,
    width: 0,
    height: 0,
  };
}

function matches(tab, q) {
  if (!q || typeof q !== 'object') return true;
  if (q.active !== undefined && tab.active !== q.active) return false;
  if (q.pinned !== undefined && tab.pinned !== q.pinned) return false;
  if (q.audible !== undefined && tab.audible !== q.audible) return false;
  if (q.status !== undefined && tab.status !== q.status) return false;
  if (q.title && !new RegExp('^' + String(q.title).replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$').test(tab.title)) return false;
  if (q.url) {
    const pats = Array.isArray(q.url) ? q.url : [q.url];
    const ok = pats.some(p => {
      // Chrome match patterns, reduced to the parts extensions actually use.
      const rx = new RegExp('^' + String(p)
        .replace(/[.+^${}()|[\]\\]/g, '\\$&')
        .replace(/\*/g, '.*')
        .replace(/^\\\.\\\*/, '.*') + '$');
      return rx.test(tab.url);
    });
    if (!ok) return false;
  }
  // currentWindow / lastFocusedWindow are always true — Vex is single-window.
  return true;
}

function emit(key, ...args) {
  const set = _subs.get(key);
  if (!set || !set.size) return;
  for (const wc of [...set]) {
    if (!wc || wc.isDestroyed()) { set.delete(wc); continue; }
    try { wc.send('ext:event', { key, args }); } catch {}
  }
}

// Wire the underlying Electron event for a key the first time something
// subscribes. Doing it lazily keeps us from attaching listeners to every guest
// for events the extension never asked for.
function wire(key) {
  if (_wired.has(key)) return;
  _wired.add(key);

  const perGuest = (attach) => {
    const seen = new WeakSet();
    const hook = (wc) => {
      if (!wc || wc.isDestroyed() || seen.has(wc)) return;
      seen.add(wc);
      try { attach(wc); } catch {}
    };
    guests().forEach(hook);
    app.on('web-contents-created', (_e, wc) => {
      try { if (wc.getType() === 'webview') hook(wc); } catch {}
    });
  };

  switch (key) {
    case 'tabs.onCreated':
      app.on('web-contents-created', (_e, wc) => {
        try { if (wc.getType() === 'webview') setTimeout(() => !wc.isDestroyed() && emit(key, toTab(wc)), 0); } catch {}
      });
      break;
    case 'tabs.onRemoved':
      perGuest(wc => wc.once('destroyed', () => emit(key, wc.id, { windowId: 1, isWindowClosing: false })));
      break;
    case 'tabs.onUpdated':
      perGuest(wc => {
        const push = (changeInfo) => { if (!wc.isDestroyed()) emit(key, wc.id, changeInfo, toTab(wc)); };
        wc.on('page-title-updated', (_e, title) => push({ title }));
        wc.on('did-start-loading', () => push({ status: 'loading' }));
        wc.on('did-stop-loading', () => push({ status: 'complete', url: (() => { try { return wc.getURL(); } catch { return ''; } })() }));
        wc.on('did-navigate', (_e, url) => push({ url, status: 'loading' }));
        wc.on('did-navigate-in-page', (_e, url) => push({ url }));
      });
      break;
    case 'webNavigation.onBeforeNavigate':
      // will-redirect matters as much as will-navigate here: the OAuth login
      // finishes with claude.ai issuing a 302 to
      // chrome-extension://<id>/oauth_callback.html, and the extension reads
      // the authorization code off that URL. A server redirect never fires
      // will-navigate, so listening to it alone would silently drop the login.
      perGuest(wc => {
        const send = (url) => emit(key, { tabId: wc.id, url, frameId: 0, parentFrameId: -1, timeStamp: Date.now() });
        wc.on('will-navigate', (_e, url) => send(url));
        wc.on('will-redirect', (_e, url) => send(url));
      });
      break;
    case 'webNavigation.onCommitted':
      perGuest(wc => {
        const send = (url) => emit(key, { tabId: wc.id, url, frameId: 0, parentFrameId: -1, transitionType: 'link', transitionQualifiers: [], timeStamp: Date.now() });
        wc.on('did-navigate', (_e, url) => send(url));
        wc.on('will-redirect', (_e, url) => send(url));
        // The callback page isn't shipped in the extension, so the navigation
        // ends in a load failure. The URL still carries the code, and this is
        // the last chance to surface it.
        wc.on('did-fail-load', (_e, _code, _desc, url, isMainFrame) => { if (isMainFrame && url) send(url); });
      });
      break;
    case 'webNavigation.onDOMContentLoaded':
      perGuest(wc => wc.on('dom-ready', () => emit(key, { tabId: wc.id, url: (() => { try { return wc.getURL(); } catch { return ''; } })(), frameId: 0, parentFrameId: -1, timeStamp: Date.now() })));
      break;
    case 'webNavigation.onCompleted':
      perGuest(wc => wc.on('did-finish-load', () => emit(key, { tabId: wc.id, url: (() => { try { return wc.getURL(); } catch { return ''; } })(), frameId: 0, parentFrameId: -1, timeStamp: Date.now() })));
      break;
    case 'webNavigation.onErrorOccurred':
      perGuest(wc => wc.on('did-fail-load', (_e, code, desc, url) => emit(key, { tabId: wc.id, url, error: desc || String(code), frameId: 0, parentFrameId: -1, timeStamp: Date.now() })));
      break;
    default:
      // Everything else is either driven from elsewhere (debugger, sidePanel)
      // or has no Electron source, in which case it simply never fires.
      break;
  }
}

// --- chrome.debugger --------------------------------------------------------

const _attached = new Set();

function debuggerAttach(target) {
  const wc = wcById(target && target.tabId);
  if (!wc) throw new Error('No tab with id ' + (target && target.tabId));
  if (wc.debugger.isAttached()) { _attached.add(wc.id); return; }
  wc.debugger.attach('1.3');
  _attached.add(wc.id);
  wc.debugger.on('message', (_e, method, params) => {
    emit('debugger.onEvent', { tabId: wc.id }, method, params);
  });
  wc.debugger.on('detach', (_e, reason) => {
    _attached.delete(wc.id);
    emit('debugger.onDetach', { tabId: wc.id }, reason || 'target_closed');
  });
  wc.once('destroyed', () => _attached.delete(wc.id));
}

// --- API table --------------------------------------------------------------

const API = {
  tabs: {
    async query(q) {
      const act = activeGuest();
      const actId = act ? act.id : null;
      const list = guests().map((wc, i) => toTab(wc, i, actId));
      const out = list.filter(t => matches(t, q));
      if (!out.length) diag.write('warn', `tabs.query(${JSON.stringify(q || {})}) matched nothing of ${list.length} guest(s)`);
      return out;
    },
    async get(id) { const wc = wcById(id); return wc ? toTab(wc) : null; },
    async getCurrent() { const wc = activeGuest(); return wc ? toTab(wc) : null; },
    async create(props) {
      // Vex owns tab creation, so this is delegated to the renderer.
      const created = await askRenderer('tabs.create', props || {});
      return created || { id: -1, url: (props && props.url) || '' };
    },
    async remove(ids) {
      for (const id of [].concat(ids)) await askRenderer('tabs.remove', { tabId: Number(id) });
      return undefined;
    },
    async update(id, props) {
      const p = typeof id === 'object' ? id : props;
      const wc = typeof id === 'object' ? activeGuest() : (wcById(id) || activeGuest());
      if (!wc) return null;
      if (p && p.url) wc.loadURL(p.url);
      if (p && p.muted !== undefined) wc.setAudioMuted(!!p.muted);
      if (p && p.active) await askRenderer('tabs.activate', { tabId: wc.id });
      return toTab(wc);
    },
    async reload(id, props) {
      const wc = (typeof id === 'object' || id == null) ? activeGuest() : (wcById(id) || activeGuest());
      if (!wc) return undefined;
      if (props && props.bypassCache) wc.reloadIgnoringCache(); else wc.reload();
      return undefined;
    },
    async goBack(id) { const wc = (wcById(id) || activeGuest()); if (wc && wc.canGoBack()) wc.goBack(); return undefined; },
    async goForward(id) { const wc = (wcById(id) || activeGuest()); if (wc && wc.canGoForward()) wc.goForward(); return undefined; },
    async captureVisibleTab() {
      const wc = activeGuest();
      if (!wc) return undefined;
      const img = await wc.capturePage();
      return 'data:image/jpeg;base64,' + img.toJPEG(80).toString('base64');
    },
    async setZoom(id, factor) { const wc = (wcById(id) || activeGuest()); if (wc) wc.setZoomFactor(factor || 1); return undefined; },
    async getZoom(id) { const wc = (wcById(id) || activeGuest()); return wc ? wc.getZoomFactor() : 1; },
    async duplicate(id) { const wc = wcById(id); if (!wc) return null; return askRenderer('tabs.create', { url: wc.getURL(), active: true }); },
    async detectLanguage() { return 'en'; },
    async group(options) {
      const o = options || {};
      const tabIds = [].concat(o.tabIds || []).map(Number).filter(Boolean);
      const res = await askRenderer('tabs.group', {
        tabIds,
        groupId: o.groupId,
        createProperties: o.createProperties || {},
      });
      return res && res.groupId != null ? res.groupId : -1;
    },
    async ungroup(tabIds) {
      await askRenderer('tabs.ungroup', { tabIds: [].concat(tabIds || []).map(Number).filter(Boolean) });
      return undefined;
    },
    async move(id) { const wc = wcById(id); return wc ? toTab(wc) : null; },
    async highlight() { return { id: 1, focused: true }; },
    async discard(id) { const wc = wcById(id); return wc ? toTab(wc) : null; },
    async executeScript(id, details) {
      const wc = typeof id === 'object' ? activeGuest() : (wcById(id) || activeGuest());
      const d = typeof id === 'object' ? id : details;
      if (!wc || !d || !d.code) return [];
      return [await wc.executeJavaScript(d.code, true)];
    },
    async insertCSS(id, details) {
      const wc = typeof id === 'object' ? activeGuest() : (wcById(id) || activeGuest());
      const d = typeof id === 'object' ? id : details;
      if (!wc || !d || !d.code) return undefined;
      await wc.insertCSS(d.code);
      return undefined;
    },
    async removeCSS() { return undefined; },
  },

  debugger: {
    async attach(target) { debuggerAttach(target); return undefined; },
    async detach(target) {
      const wc = wcById(target && target.tabId);
      if (wc) { try { if (wc.debugger.isAttached()) wc.debugger.detach(); } catch {} _attached.delete(wc.id); }
      return undefined;
    },
    async sendCommand(target, method, params) {
      const wc = wcById(target && target.tabId);
      if (!wc) throw new Error('No tab with id ' + (target && target.tabId));
      if (!wc.debugger.isAttached()) debuggerAttach(target);
      return wc.debugger.sendCommand(method, params || {});
    },
    async getTargets() {
      return guests().map(wc => ({
        id: String(wc.id), type: 'page', title: (() => { try { return wc.getTitle(); } catch { return ''; } })(),
        url: (() => { try { return wc.getURL(); } catch { return ''; } })(),
        attached: _attached.has(wc.id), tabId: wc.id,
      }));
    },
  },

  sidePanel: {
    async open() { if (_onSidePanelOpen) _onSidePanelOpen(true); return undefined; },
    async close() { if (_onSidePanelOpen) _onSidePanelOpen(false); return undefined; },
    async setOptions() { return undefined; },
    async getOptions() { return { path: 'sidepanel.html', enabled: true }; },
    async setPanelBehavior() { return undefined; },
    async getPanelBehavior() { return { openPanelOnActionClick: true }; },
  },

  // Vex has real tab groups, so these are real too — Claude can create, name,
  // recolour and collapse groups here exactly as it does in Chrome. The group
  // list lives in the renderer's TabManager, so every call round-trips there.
  tabGroups: {
    async query(q) { return (await askRenderer('tabGroups.query', q || {})) || []; },
    async get(groupId) { return await askRenderer('tabGroups.get', { groupId }); },
    async update(groupId, props) { return await askRenderer('tabGroups.update', { groupId, props: props || {} }); },
    async move(groupId) { return await askRenderer('tabGroups.get', { groupId }); },
  },

  windows: {
    async getCurrent() { return { id: 1, focused: true, type: 'normal', state: 'normal', incognito: false, alwaysOnTop: false }; },
    async getLastFocused() { return API.windows.getCurrent(); },
    async get() { return API.windows.getCurrent(); },
    async getAll(info) {
      const w = await API.windows.getCurrent();
      if (info && info.populate) w.tabs = await API.tabs.query({});
      return [w];
    },
    async create(props) {
      if (props && props.url) await askRenderer('tabs.create', { url: [].concat(props.url)[0], active: true });
      return API.windows.getCurrent();
    },
    async update() { return API.windows.getCurrent(); },
    async remove() { return undefined; },
  },

  webNavigation: {
    async getFrame() { const wc = activeGuest(); return wc ? { url: wc.getURL(), parentFrameId: -1, errorOccurred: false } : null; },
    async getAllFrames() { const wc = activeGuest(); return wc ? [{ frameId: 0, parentFrameId: -1, url: wc.getURL(), errorOccurred: false }] : []; },
  },

  notifications: (() => {
    const live = new Map();
    let seq = 0;
    return {
      async create(idOrOpts, maybeOpts) {
        const id = typeof idOrOpts === 'string' ? idOrOpts : 'vex-notif-' + (++seq);
        const o = (typeof idOrOpts === 'string' ? maybeOpts : idOrOpts) || {};
        try {
          const n = new Notification({ title: o.title || 'Claude', body: o.message || '', silent: !!o.silent });
          n.on('click', () => emit('notifications.onClicked', id));
          n.on('close', () => { live.delete(id); emit('notifications.onClosed', id, true); });
          n.show();
          live.set(id, n);
        } catch {}
        return id;
      },
      async update() { return true; },
      async clear(id) { const n = live.get(id); if (n) { try { n.close(); } catch {} live.delete(id); } return true; },
      async getAll() { const o = {}; for (const k of live.keys()) o[k] = true; return o; },
      async getPermissionLevel() { return 'granted'; },
    };
  })(),

  downloads: {
    async download(opts) {
      const wc = activeGuest();
      if (wc && opts && opts.url) { wc.downloadURL(opts.url); return 1; }
      return -1;
    },
    async search() { return []; },
    async pause() { return undefined; },
    async resume() { return undefined; },
    async cancel() { return undefined; },
    async erase() { return []; },
    async open() { return undefined; },
    async show() { return undefined; },
    async showDefaultFolder() { try { shell.openPath(app.getPath('downloads')); } catch {} return undefined; },
    async removeFile() { return undefined; },
    async getFileIcon() { return ''; },
  },

  permissions: {
    // Electron grants whatever the manifest declares; reporting false would
    // switch off features the extension is entitled to use.
    async contains() { return true; },
    async request() { return true; },
    async remove() { return true; },
    async getAll() {
      return {
        permissions: (_manifest && _manifest.permissions) || [],
        origins: (_manifest && _manifest.host_permissions) || ['<all_urls>'],
      };
    },
  },

  commands: {
    async getAll() {
      const cmds = (_manifest && _manifest.commands) || {};
      return Object.entries(cmds).map(([name, c]) => ({
        name,
        description: c.description || '',
        shortcut: (c.suggested_key && (c.suggested_key.default || c.suggested_key.windows)) || '',
      }));
    },
  },

  contextMenus: {
    async create() { return 'vex-menu'; },
    async update() { return undefined; },
    async remove() { return undefined; },
    async removeAll() { return undefined; },
  },

  identity: {
    getRedirectURL() { return 'https://' + _extensionId + '.chromiumapp.org/'; },
    async getAuthToken() { throw new Error('getAuthToken is not available in Vex'); },
    async getProfileUserInfo() { return { email: '', id: '' }; },
    async removeCachedAuthToken() { return undefined; },
    async clearAllCachedAuthTokens() { return undefined; },
    // Real OAuth: open the provider in a window and resolve when it redirects
    // back to the extension's chromiumapp.org URL, exactly like Chrome does.
    async launchWebAuthFlow(details) {
      const url = details && details.url;
      if (!url) throw new Error('launchWebAuthFlow requires a url');
      const redirectPrefix = 'https://' + _extensionId + '.chromiumapp.org/';
      return new Promise((resolve, reject) => {
        const win = new BrowserWindow({
          width: 520, height: 700, show: !!(details && details.interactive),
          autoHideMenuBar: true,
          webPreferences: { partition: 'persist:main', nodeIntegration: false, contextIsolation: true },
        });
        let done = false;
        const finish = (fn, arg) => { if (done) return; done = true; try { win.destroy(); } catch {} fn(arg); };
        const check = (target) => {
          if (typeof target === 'string' && target.startsWith(redirectPrefix)) finish(resolve, target);
        };
        win.webContents.on('will-redirect', (_e, u) => check(u));
        win.webContents.on('will-navigate', (_e, u) => check(u));
        win.webContents.on('did-navigate', (_e, u) => check(u));
        win.on('closed', () => { if (!done) { done = true; reject(new Error('The user closed the login window')); } });
        win.loadURL(url).catch(err => finish(reject, err));
      });
    },
  },

  cookies: {
    async get(d) {
      const c = await session.fromPartition('persist:main').cookies.get({ url: d && d.url, name: d && d.name });
      return c && c[0] ? c[0] : null;
    },
    async getAll(d) { return session.fromPartition('persist:main').cookies.get(d || {}); },
    async set(d) { await session.fromPartition('persist:main').cookies.set(d || {}); return d; },
    async remove(d) { await session.fromPartition('persist:main').cookies.remove(d.url, d.name); return d; },
    async getAllCookieStores() { return [{ id: '0', tabIds: guests().map(w => w.id) }]; },
  },

  idle: { async queryState() { return 'active'; }, async setDetectionInterval() { return undefined; }, async getAutoLockDelay() { return 0; } },
  browsingData: { async remove() { return undefined; }, async removeCache() { return undefined; }, async removeCookies() { return undefined; }, async settings() { return { options: {}, dataToRemove: {}, dataRemovalPermitted: {} }; } },
  system: { async 'cpu.getInfo'() { return { numOfProcessors: require('os').cpus().length }; }, async 'memory.getInfo'() { return { capacity: require('os').totalmem(), availableCapacity: require('os').freemem() }; } },

  storage: {
    async 'session.get'(keys) {
      const out = {};
      if (keys == null) { for (const [k, v] of _sessionStore) out[k] = v; return out; }
      const list = Array.isArray(keys) ? keys : (typeof keys === 'string' ? [keys] : Object.keys(keys));
      for (const k of list) {
        if (_sessionStore.has(k)) out[k] = _sessionStore.get(k);
        else if (keys && typeof keys === 'object' && !Array.isArray(keys) && keys[k] !== undefined) out[k] = keys[k];
      }
      return out;
    },
    async 'session.set'(items) { for (const [k, v] of Object.entries(items || {})) _sessionStore.set(k, v); return undefined; },
    async 'session.remove'(keys) { for (const k of [].concat(keys)) _sessionStore.delete(k); return undefined; },
    async 'session.clear'() { _sessionStore.clear(); return undefined; },
    async 'session.getBytesInUse'() { return 0; },
    async 'session.setAccessLevel'() { return undefined; },
  },

  runtime: {
    async getPlatformInfo() { return { os: process.platform === 'win32' ? 'win' : process.platform === 'darwin' ? 'mac' : 'linux', arch: process.arch === 'x64' ? 'x86-64' : process.arch, nacl_arch: 'x86-64' }; },
    async setUninstallURL() { return undefined; },
    async openOptionsPage() { await askRenderer('tabs.create', { url: 'chrome-extension://' + _extensionId + '/options.html', active: true }); return undefined; },
  },

  action: {
    async setBadgeText() { return undefined; }, async getBadgeText() { return ''; },
    async setBadgeBackgroundColor() { return undefined; }, async setIcon() { return undefined; },
    async setTitle() { return undefined; }, async getTitle() { return 'Claude'; },
    async enable() { return undefined; }, async disable() { return undefined; },
    async setPopup() { return undefined; }, async getPopup() { return ''; },
    async openPopup() { if (_onSidePanelOpen) _onSidePanelOpen(true); return undefined; },
  },

  // Electron ships a native chrome.scripting, but it resolves tabIds in its
  // OWN id space — which is not the webContents id space chrome.tabs and
  // chrome.debugger use here. Calling it with a tab id from chrome.tabs.get
  // fails with "No tab with id N", and since the extension reads page content
  // through executeScript (13 call sites), that failure silently kills the
  // whole answer path: the message is sent, nothing comes back.
  //
  // So this is overridden too, on the same webContents ids as everything else.
  scripting: {
    async executeScript(injection) {
      const inj = injection || {};
      const target = inj.target || {};
      const wc = wcById(target.tabId) || activeGuest();
      if (!wc) throw new Error('No tab with id ' + target.tabId);

      let expression = null;
      if (inj.funcSource) {
        // The shim stringifies `func` for us — a function can't cross IPC.
        const args = JSON.stringify(inj.args || []);
        expression = `(function(){ try { return (${inj.funcSource}).apply(null, ${args}); } catch (e) { throw e; } })()`;
      } else if (Array.isArray(inj.files) && inj.files.length) {
        const parts = [];
        for (const rel of inj.files) {
          const abs = path.join(_extPath || '', String(rel).replace(/^\/+/, ''));
          // Never let a crafted path escape the extension directory.
          if (!_extPath || !abs.startsWith(_extPath)) throw new Error('Refusing to inject outside the extension: ' + rel);
          parts.push(fs.readFileSync(abs, 'utf8'));
        }
        expression = parts.join('\n;\n');
      } else {
        throw new Error('executeScript needs func or files');
      }

      // userGesture=true so the injected code can do things a real click could.
      const result = await wc.executeJavaScript(expression, true);
      return [{ frameId: 0, documentId: String(wc.id), result }];
    },

    async insertCSS(injection) {
      const inj = injection || {};
      const wc = wcById((inj.target || {}).tabId) || activeGuest();
      if (!wc) throw new Error('No tab to insert CSS into');
      let css = inj.css || '';
      if (!css && Array.isArray(inj.files)) {
        for (const rel of inj.files) {
          const abs = path.join(_extPath || '', String(rel).replace(/^\/+/, ''));
          if (!_extPath || !abs.startsWith(_extPath)) throw new Error('Refusing to read outside the extension: ' + rel);
          css += fs.readFileSync(abs, 'utf8') + '\n';
        }
      }
      const key = await wc.insertCSS(css);
      _insertedCss.set(key, wc.id);
      return undefined;
    },

    async removeCSS() {
      // Chrome removes by matching the original injection; Electron needs the
      // key it handed back. Clearing everything we inserted is the honest
      // approximation and is what callers actually want.
      for (const [key, wcId] of [..._insertedCss]) {
        const wc = wcById(wcId);
        if (wc) { try { await wc.removeInsertedCSS(key); } catch {} }
        _insertedCss.delete(key);
      }
      return undefined;
    },

    async registerContentScripts() { return undefined; },
    async getRegisteredContentScripts() { return []; },
    async unregisterContentScripts() { return undefined; },
    async updateContentScripts() { return undefined; },
  },
};

// --- renderer round-trip ----------------------------------------------------
// Some things (creating/closing/activating a Vex tab) are owned by the
// renderer's TabManager, not by main. This asks it and waits for a reply.
let _rendererWc = null;
let _reqSeq = 0;
const _pending = new Map();

function askRenderer(action, payload) {
  if (!_rendererWc || _rendererWc.isDestroyed()) return Promise.resolve(null);
  const id = ++_reqSeq;
  return new Promise((resolve) => {
    _pending.set(id, resolve);
    try { _rendererWc.send('ext:renderer-request', { id, action, payload }); } catch { _pending.delete(id); resolve(null); }
    // Never hang the extension on a renderer that isn't answering.
    setTimeout(() => { if (_pending.has(id)) { _pending.delete(id); resolve(null); } }, 4000);
  });
}

// --- registration -----------------------------------------------------------

function register({ onSidePanelOpen } = {}) {
  _onSidePanelOpen = onSidePanelOpen || null;

  ipcMain.handle('ext:api', async (_e, { namespace, method, args }) => {
    const impl = API[namespace];
    if (!impl) {
      const err = 'Unimplemented namespace: chrome.' + namespace;
      diag.write('API!', err);
      throw new Error(err);
    }
    const fn = impl[method];
    if (typeof fn !== 'function') {
      const err = 'Unimplemented: chrome.' + namespace + '.' + method;
      diag.write('API!', err);
      throw new Error(err);
    }
    try {
      const out = await fn.apply(impl, args || []);
      // Trace successes too, compactly. When a message "does nothing", the
      // useful signal is where the call sequence stops, not just what threw.
      diag.write('api ', `chrome.${namespace}.${method} -> ok`);
      return out;
    } catch (err) {
      // The shim converts this into runtime.lastError, which extensions
      // routinely ignore — so record it here or it vanishes without trace.
      let a = '';
      try { a = JSON.stringify(args || []).slice(0, 300); } catch {}
      diag.write('API!', `chrome.${namespace}.${method}(${a}) -> ${err && err.message}`);
      throw err;
    }
  });

  ipcMain.on('ext:subscribe', (e, key) => {
    let set = _subs.get(key);
    if (!set) _subs.set(key, (set = new Set()));
    set.add(e.sender);
    wire(key);
  });

  ipcMain.on('ext:unsubscribe', (e, key) => {
    const set = _subs.get(key);
    if (set) set.delete(e.sender);
  });

  ipcMain.on('ext:constants', (e) => {
    e.returnValue = { extensionId: _extensionId, manifest: _manifest };
  });

  // Vex's renderer registers itself and reports which guest is the active tab.
  ipcMain.on('ext:renderer-ready', (e) => {
    _rendererWc = e.sender;
    diag.write('host', 'renderer registered — tab operations available');
  });
  ipcMain.on('ext:set-active-tab', (_e, id) => {
    const n = Number(id) || null;
    if (n !== _activeTabId) diag.write('host', 'active tab -> ' + n);
    _activeTabId = n;
  });
  ipcMain.on('ext:renderer-response', (_e, { id, result }) => {
    const resolve = _pending.get(id);
    if (resolve) { _pending.delete(id); resolve(result); }
  });
}

function setExtension(id, manifest, extPath) {
  _extensionId = id;
  _manifest = manifest;
  _extPath = extPath ? path.resolve(extPath) : null;
}
function activeTabId() { return _activeTabId; }

module.exports = { register, setExtension, activeTabId, API, toTab, matches };

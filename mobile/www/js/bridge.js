// === Vex Mobile — native bridge ===
//
// One object between the chrome and the four native plugins:
//   VexTabs   — the Android WebViews that render pages, one per tab
//   VexBlock  — request blocking, inside shouldInterceptRequest
//   VexVault  — secrets under an Android Keystore key
//   VexSystem — the device: biometrics, shortcuts, dictation, PiP, permissions
//
// The desktop chrome talks to Electron through window.vex (src/preload.js);
// this is its counterpart, and the method names are kept close on purpose so
// ported code reads the same.
//
// With no Capacitor present — the page opened in a desktop browser — every
// call falls back to something harmless, and page rendering falls back to
// iframes. That is for building the chrome on a laptop: sites that refuse
// framing will not load, and blocking, snapshots, find, downloads, biometrics
// and the Keystore are all no-ops.

const VexBridge = (() => {
  const listeners = new Map();              // event -> Set<fn>
  const devSecrets = Object.create(null);   // fallback only; never persisted
  const plugins = { VexTabs: null, VexBlock: null, VexVault: null, VexSystem: null, VexRemind: null };
  let native = false;

  function emit(event, payload) {
    const set = listeners.get(event);
    if (!set) return;
    for (const fn of set) {
      try { fn(payload || {}); } catch (error) { console.error('[bridge]', event, error); }
    }
  }

  // ── Fallback: iframes standing in for native WebViews ────────────────────
  const fallback = (() => {
    const frames = new Map();
    let host = null, seq = 0, bounds = { x: 0, y: 0, width: 0, height: 0 };

    function ensureHost() {
      if (host) return host;
      host = document.createElement('div');
      host.id = 'fallback-webviews';
      Object.assign(host.style, { position: 'fixed', left: '0', top: '0', zIndex: '4', overflow: 'hidden' });
      document.body.appendChild(host);
      return host;
    }

    return {
      create({ url }) {
        const id = 'fb' + (++seq);
        const frame = document.createElement('iframe');
        frame.src = url || 'about:blank';
        Object.assign(frame.style, {
          position: 'absolute', inset: '0', width: '100%', height: '100%',
          border: '0', display: 'none', background: '#fff'
        });
        frame.addEventListener('load', () => {
          emit('loadEnd', { id, url: frame.src, title: frame.src, canGoBack: false, canGoForward: false });
        });
        ensureHost().appendChild(frame);
        frames.set(id, frame);
        return { id };
      },
      close({ id }) { const frame = frames.get(id); if (frame) frame.remove(); frames.delete(id); return {}; },
      activate({ id }) {
        for (const [key, frame] of frames) frame.style.display = key === id ? 'block' : 'none';
        return {};
      },
      setBounds(rect) {
        bounds = rect;
        Object.assign(ensureHost().style, {
          left: bounds.x + 'px', top: bounds.y + 'px',
          width: bounds.width + 'px', height: bounds.height + 'px'
        });
        return {};
      },
      setVisible({ visible }) { ensureHost().style.display = visible ? 'block' : 'none'; return {}; },
      load({ id, url }) {
        const frame = frames.get(id);
        if (!frame) return {};
        emit('loadStart', { id, url });
        frame.src = url;
        return {};
      },
      back({ id }) { try { frames.get(id).contentWindow.history.back(); } catch { /* cross-origin */ } return {}; },
      forward({ id }) { try { frames.get(id).contentWindow.history.forward(); } catch { /* cross-origin */ } return {}; },
      reload({ id }) { const frame = frames.get(id); if (frame) frame.src = frame.src; return {}; },
      state({ id }) { const frame = frames.get(id); return { url: frame ? frame.src : '', title: '', canGoBack: false, canGoForward: false }; },
      loadHtml({ id, html }) {
        const frame = frames.get(id);
        if (frame) frame.srcdoc = html;
        return {};
      },
      evaluate() { return { result: null }; },
      snapshot() { return { dataUrl: '' }; }
    };
  })();

  function call(pluginName, method, args) {
    const plugin = plugins[pluginName];
    if (!plugin) {
      const stub = pluginName === 'VexTabs' ? fallback[method] : null;
      return Promise.resolve(stub ? stub(args || {}) : {});
    }
    return plugin[method](args || {}).catch(error => {
      console.error('[' + pluginName + '.' + method + ']', error);
      return {};
    });
  }

  const tabs = (method, args) => call('VexTabs', method, args);
  const system = (method, args) => call('VexSystem', method, args);

  const api = {
    get isNative() { return native; },

    async init() {
      const capacitor = window.Capacitor;
      native = !!(capacitor && capacitor.isNativePlatform && capacitor.isNativePlatform()
        && capacitor.Plugins && capacitor.Plugins.VexTabs);
      if (!native) return false;
      for (const name of Object.keys(plugins)) plugins[name] = capacitor.Plugins[name] || null;
      for (const event of ['loadStart', 'loadProgress', 'loadEnd', 'title', 'urlChange', 'icon',
        'newTab', 'download', 'error', 'blocked', 'findResult', 'permission', 'edgeSwipe',
        'longPress', 'fullscreen', 'scroll', 'selection']) {
        plugins.VexTabs.addListener(event, data => emit(event, data));
      }
      if (plugins.VexBlock) plugins.VexBlock.addListener('blocked', data => emit('blocked', data));
      return true;
    },

    on(event, fn) {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event).add(fn);
      return () => listeners.get(event).delete(fn);
    },

    // ── Tabs ───────────────────────────────────────────────────────────────
    createTab(url, options = {}) { return tabs('create', { url: url || 'about:blank', incognito: !!options.incognito }); },
    closeTab(id) { return tabs('close', { id }); },
    activateTab(id) { return tabs('activate', { id }); },
    setBounds(rect) { return tabs('setBounds', rect); },
    setVisible(visible) { return tabs('setVisible', { visible: !!visible }); },
    load(id, url) { return tabs('load', { id, url }); },
    loadHtml(id, html, baseUrl) { return tabs('loadHtml', { id, html, baseUrl: baseUrl || '' }); },
    back(id) { return tabs('back', { id }); },
    forward(id) { return tabs('forward', { id }); },
    reload(id, options = {}) { return tabs('reload', { id, bypassCache: !!options.bypassCache }); },
    stop(id) { return tabs('stop', { id }); },
    state(id) { return tabs('state', { id }); },
    snapshot(id) { return tabs('snapshot', { id }); },
    find(id, text) { return tabs('find', { id, text }); },
    findNext(id, forward) { return tabs('findNext', { id, forward: forward !== false }); },
    clearFind(id) { return tabs('clearFind', { id }); },
    setDesktopMode(id, enabled) { return tabs('setDesktopMode', { id, enabled: !!enabled }); },
    setDarkMode(id, enabled) { return tabs('setDarkMode', { id, enabled: !!enabled }); },
    setScriptsEnabled(id, enabled) { return tabs('setScriptsEnabled', { id, enabled: enabled !== false }); },
    setImagesEnabled(id, enabled) { return tabs('setImagesEnabled', { id, enabled: enabled !== false }); },
    setZoom(id, factor) { return tabs('setZoom', { id, factor: Number(factor) || 1 }); },
    setUserAgent(id, userAgent) { return tabs('setUserAgent', { id, userAgent: userAgent || '' }); },
    setTextZoom(percent) { return tabs('setTextZoom', { percent }); },
    print(id) { return tabs('print', { id }); },
    download(id, url) { return tabs('download', { id, url }); },
    scrollPosition(id) { return tabs('scrollPosition', { id }); },
    restoreScroll(id, y) { return tabs('restoreScroll', { id, y: Math.round(y) || 0 }); },
    setDocumentStartScript(script) { return tabs('setDocumentStartScript', { script: script || '' }); },
    setPrivacy(options = {}) { return tabs('setPrivacy', options); },
    setPullToRefresh(enabled) { return tabs('setPullToRefresh', { enabled: !!enabled }); },
    setBackgroundAudio(enabled) { return tabs('setBackgroundAudio', { enabled: !!enabled }); },
    evaluate(id, code) { return tabs('evaluate', { id, code }); },
    clearData(options = {}) { return tabs('clearData', options); },
    clearSiteData(host, origin) { return tabs('clearSiteData', { host: host || '', origin: origin || '' }); },
    capturePage(id, full) { return tabs('capturePage', { id, full: !!full }); },
    downloadStatus() { return tabs('downloadStatus', {}); },
    openDownload(localUri) { return tabs('openDownload', { localUri }); },
    setWindowBackground(color, dark) {
      if (!plugins.VexTabs) return Promise.resolve({});
      return tabs('setWindowBackground', { color, dark: dark !== false });
    },

    // ── Blocking ───────────────────────────────────────────────────────────
    async setBlocking(enabled) { await call('VexBlock', 'setEnabled', { enabled: !!enabled }); },
    async setSiteAllowed(host, allowed) { await call('VexBlock', 'setSiteAllowed', { host, allowed: !!allowed }); },
    async blockStats() { return call('VexBlock', 'stats', {}); },
    async loadRules(payload) { return call('VexBlock', 'loadRules', payload); },

    // ── Secrets ────────────────────────────────────────────────────────────
    // In the browser fallback there is no keystore, so a secret is kept in
    // memory for the session and forgotten after it.
    async vaultSet(key, value) {
      if (plugins.VexVault) { await plugins.VexVault.set({ key, value: value || '' }); return; }
      devSecrets[key] = value || '';
    },
    async vaultGet(key) {
      if (plugins.VexVault) {
        const result = await plugins.VexVault.get({ key }).catch(() => ({ value: '' }));
        return (result && result.value) || '';
      }
      return devSecrets[key] || '';
    },
    async vaultClear() {
      if (plugins.VexVault) { await plugins.VexVault.clear(); return; }
      for (const key of Object.keys(devSecrets)) delete devSecrets[key];
    },

    // ── The device ─────────────────────────────────────────────────────────
    async biometricsAvailable() {
      const result = await system('biometricsAvailable', {});
      return !!(result && result.available);
    },
    async authenticate(title, subtitle) {
      if (!plugins.VexSystem) return { ok: true, simulated: true };   // fallback: nothing to guard
      return system('authenticate', { title, subtitle });
    },
    addShortcut(url, title, icon) { return system('addShortcut', { url, title, icon }); },
    async voiceInput() {
      const result = await system('voiceInput', {});
      return (result && result.text) || '';
    },
    enterPictureInPicture(width, height) { return system('enterPictureInPicture', { width, height }); },
    async hasPermission(name) {
      const result = await system('hasPermission', { name });
      return !!(result && result.granted);
    },
    async requestPermission(name) {
      if (!plugins.VexSystem) {
        // In a desktop browser the platform prompt is the browser's own.
        return true;
      }
      const result = await system('requestPermission', { name });
      return !!(result && result.granted);
    },
    async isDefaultBrowser() {
      const result = await system('isDefaultBrowser', {});
      return !!(result && result.value);
    },
    openDefaultBrowserSettings() { return system('openDefaultBrowserSettings', {}); },
    setFullscreen(value) { return system('setFullscreen', { value: !!value }); },
    setKeepAwake(value) { return system('setKeepAwake', { value: !!value }); },
    shareFile(path, mimeType, title) { return system('shareFile', { path, mimeType, title }); },

    // ── Reminders ──────────────────────────────────────────────────────────
    // The time goes over as a string: a millisecond timestamp does not fit in
    // the int the bridge would otherwise make of it.
    scheduleReminder(entry) {
      return call('VexRemind', 'schedule', {
        id: entry.id, atMillis: String(entry.at), url: entry.url,
        title: entry.title || '', note: entry.note || ''
      });
    },
    cancelReminder(id) { return call('VexRemind', 'cancel', { id }); },

    // ── Platform odds and ends ─────────────────────────────────────────────
    async share(url, title) {
      const plugin = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Share;
      if (plugin) {
        try { await plugin.share({ title: title || url, url, dialogTitle: 'Share link' }); } catch { /* dismissed */ }
        return;
      }
      if (navigator.share) {
        try { await navigator.share({ title, url }); } catch { /* dismissed */ }
      }
    },
    // `dark` describes the THEME, so the bar's icons have to be the opposite:
    // a dark theme gets light icons, which Capacitor calls style DARK.
    async setStatusBarStyle(dark, color) {
      const plugin = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.StatusBar;
      if (!plugin) return;
      try {
        await plugin.setStyle({ style: dark ? 'DARK' : 'LIGHT' });
        if (color) await plugin.setBackgroundColor({ color });
      } catch { /* some devices refuse a coloured bar */ }
    },
    onAppEvent(name, fn) {
      const plugin = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.App;
      if (plugin) plugin.addListener(name, fn);
    }
  };

  // The chrome is driven by native events. In the browser fallback there is no
  // native to fire them, so the smoke run does — nothing else uses this, and on
  // a device the events come from the plugin.
  if (typeof window !== 'undefined') window.__vexEmit = emit;

  return api;
})();

if (typeof window !== 'undefined') window.VexBridge = VexBridge;
if (typeof module !== 'undefined' && module.exports) module.exports = { VexBridge };

// === Vex Mobile — native bridge ===
//
// One object between the chrome and the two native plugins:
//   VexTabs  — owns the Android WebViews that render pages (one per tab)
//   VexBlock — the request blocker that runs inside shouldInterceptRequest
//
// The desktop app talks to Electron through window.vex (src/preload.js); the
// mobile chrome talks to Android through window.VexBridge. Method names are
// kept close to the desktop ones on purpose, so ported UI code reads the same.
//
// When the page is opened in a plain desktop browser (no Capacitor), every
// call falls back to an <iframe> implementation. That is for laying out the
// chrome on a laptop — sites that send X-Frame-Options will refuse to load,
// and blocking, snapshots and find-in-page are no-ops. Real browsing is the
// native path only.

const VexBridge = (() => {
  const listeners = new Map();          // event -> Set<fn>
  let Tabs = null, Block = null;
  let native = false;

  function emit(event, payload) {
    const set = listeners.get(event);
    if (!set) return;
    for (const fn of set) { try { fn(payload || {}); } catch (err) { console.error('[bridge]', event, err); } }
  }

  // ── Fallback: iframes standing in for native WebViews ────────────────────
  const fallback = (() => {
    const frames = new Map();
    let host = null, seq = 0, activeId = null, bounds = { x: 0, y: 0, width: 0, height: 0 };
    function ensureHost() {
      if (host) return host;
      host = document.createElement('div');
      host.id = 'fallback-webviews';
      Object.assign(host.style, { position: 'fixed', left: '0', top: '0', zIndex: '4', overflow: 'hidden' });
      document.body.appendChild(host);
      return host;
    }
    function place() {
      ensureHost();
      Object.assign(host.style, {
        left: bounds.x + 'px', top: bounds.y + 'px',
        width: bounds.width + 'px', height: bounds.height + 'px'
      });
    }
    return {
      create({ url }) {
        const id = 'fb' + (++seq);
        const frame = document.createElement('iframe');
        frame.src = url || 'about:blank';
        Object.assign(frame.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', border: '0', display: 'none', background: '#fff' });
        frame.addEventListener('load', () => {
          emit('loadEnd', { id, url: frame.src, canGoBack: false, canGoForward: false });
          emit('title', { id, title: frame.src });
        });
        ensureHost().appendChild(frame);
        frames.set(id, frame);
        return { id };
      },
      close({ id }) { const f = frames.get(id); if (f) f.remove(); frames.delete(id); return {}; },
      activate({ id }) {
        activeId = id;
        for (const [key, frame] of frames) frame.style.display = key === id ? 'block' : 'none';
        return {};
      },
      setBounds(rect) { bounds = rect; place(); return {}; },
      setVisible({ visible }) { ensureHost().style.display = visible ? 'block' : 'none'; return {}; },
      load({ id, url }) {
        const f = frames.get(id); if (!f) return {};
        emit('loadStart', { id, url });
        f.src = url;
        return {};
      },
      back({ id }) { try { frames.get(id).contentWindow.history.back(); } catch {} return {}; },
      forward({ id }) { try { frames.get(id).contentWindow.history.forward(); } catch {} return {}; },
      reload({ id }) { const f = frames.get(id); if (f) f.src = f.src; return {}; },
      stop() { return {}; },
      snapshot() { return { dataUrl: '' }; },
      find() { return { matches: 0 }; },
      findNext() { return {}; },
      clearFind() { return {}; },
      setDesktopMode() { return {}; },
      setTextZoom() { return {}; },
      evaluate() { return { result: null }; },
      clearData() { return {}; },
      state({ id }) { const f = frames.get(id); return { url: f ? f.src : '', title: '', canGoBack: false, canGoForward: false }; }
    };
  })();

  function call(name, args) {
    const plugin = Tabs;
    if (!plugin) return Promise.resolve(fallback[name] ? fallback[name](args || {}) : {});
    return plugin[name](args || {}).catch(err => {
      console.error('[VexTabs.' + name + ']', err);
      return {};
    });
  }

  const api = {
    get isNative() { return native; },

    async init() {
      const cap = window.Capacitor;
      native = !!(cap && cap.isNativePlatform && cap.isNativePlatform() && cap.Plugins && cap.Plugins.VexTabs);
      if (native) {
        Tabs = cap.Plugins.VexTabs;
        Block = cap.Plugins.VexBlock || null;
        for (const event of ['loadStart', 'loadProgress', 'loadEnd', 'title', 'urlChange', 'icon',
          'newTab', 'download', 'error', 'blocked', 'findResult', 'permission', 'edgeSwipe', 'longPress']) {
          Tabs.addListener(event, data => emit(event, data));
        }
        if (Block) Block.addListener('blocked', data => emit('blocked', data));
      }
      return native;
    },

    on(event, fn) {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event).add(fn);
      return () => listeners.get(event).delete(fn);
    },

    // ── Tabs ───────────────────────────────────────────────────────────────
    createTab(url, opts = {}) { return call('create', { url: url || 'about:blank', incognito: !!opts.incognito }); },
    closeTab(id) { return call('close', { id }); },
    activateTab(id) { return call('activate', { id }); },
    setBounds(rect) { return call('setBounds', rect); },
    setVisible(visible) { return call('setVisible', { visible: !!visible }); },
    load(id, url) { return call('load', { id, url }); },
    back(id) { return call('back', { id }); },
    forward(id) { return call('forward', { id }); },
    reload(id, opts = {}) { return call('reload', { id, bypassCache: !!opts.bypassCache }); },
    stop(id) { return call('stop', { id }); },
    state(id) { return call('state', { id }); },
    snapshot(id) { return call('snapshot', { id }); },
    find(id, text) { return call('find', { id, text }); },
    findNext(id, forward) { return call('findNext', { id, forward: forward !== false }); },
    clearFind(id) { return call('clearFind', { id }); },
    setDesktopMode(id, enabled) { return call('setDesktopMode', { id, enabled: !!enabled }); },
    setDarkMode(id, enabled) { return call('setDarkMode', { id, enabled: !!enabled }); },
    setTextZoom(percent) { return call('setTextZoom', { percent }); },
    evaluate(id, code) { return call('evaluate', { id, code }); },
    clearData(opts = {}) { return call('clearData', opts); },
    setPrivacy(opts = {}) { return call('setPrivacy', opts); },

    // ── Blocking ───────────────────────────────────────────────────────────
    async setBlocking(enabled) { if (Block) await Block.setEnabled({ enabled: !!enabled }); },
    async setSiteAllowed(host, allowed) { if (Block) await Block.setSiteAllowed({ host, allowed: !!allowed }); },
    async blockStats() { return Block ? Block.stats() : { blocked: 0, rules: 0 }; },
    async loadRules(payload) { return Block ? Block.loadRules(payload) : {}; },

    // ── Platform odds and ends ─────────────────────────────────────────────
    async share(url, title) {
      const plugin = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Share;
      if (plugin) { try { await plugin.share({ title: title || url, url, dialogTitle: 'Share link' }); } catch {} return; }
      if (navigator.share) { try { await navigator.share({ title, url }); } catch {} }
    },
    async setStatusBarStyle(dark) {
      const plugin = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.StatusBar;
      if (!plugin) return;
      try {
        await plugin.setStyle({ style: dark ? 'DARK' : 'LIGHT' });
        await plugin.setBackgroundColor({ color: dark ? '#14161a' : '#faf6ee' });
      } catch {}
    },
    onAppEvent(name, fn) {
      const plugin = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.App;
      if (plugin) plugin.addListener(name, fn);
    }
  };

  return api;
})();

if (typeof window !== 'undefined') window.VexBridge = VexBridge;
if (typeof module !== 'undefined' && module.exports) module.exports = { VexBridge };

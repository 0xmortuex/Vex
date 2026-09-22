// === Vex Mobile — boot ===
//
// Order matters here: storage before anything reads a setting, the bridge
// before a tab is created, blocking rules before the first page loads (a rule
// that arrives late does not un-load the tracker it missed), then the chrome,
// then the session.

(async function boot() {
  await VexStore.init();

  // Every key the chrome reads synchronously after boot.
  await Promise.all([
    VexStore.prime('vex.history', []),
    VexStore.prime('vex.bookmarks', []),
    VexStore.prime('vex.downloads', []),
    VexStore.prime('vex.closedTabs', []),
    VexStore.prime('vex.openTabs', []),
    VexStore.prime('vex.activeTabUrl', ''),
    VexStore.prime('vex.searchEngine', 'duckduckgo'),
    VexStore.prime('vex.blockEnabled', true),
    VexStore.prime('vex.blockAllowed', []),
    VexStore.prime('vex.blockLists', VexBlock.DEFAULT_LISTS),
    VexStore.prime('vex.blockRules', null),
    VexStore.prime('vex.blockRulesAt', 0),
    VexStore.prime('vex.textZoom', 100),
    VexStore.prime('vex.darkPages', false),
    VexStore.prime('vex.desktopDefault', false),
    VexStore.prime('vex.dnt', true)
  ]);

  const native = await VexBridge.init();
  document.documentElement.dataset.native = native ? '1' : '0';

  applyTheme();
  wireNative();
  VexUI.bind();
  VexUI.renderStartTiles();
  VexUI.pushBounds();

  await VexBlock.apply();
  await VexBridge.setTextZoom(VexStore.get('vex.textZoom', 100));
  await VexBridge.setPrivacy({ httpsOnly: true, doNotTrack: VexStore.get('vex.dnt', true) !== false });

  const restored = await VexTabStore.restore();
  if (!restored) await VexTabStore.create('about:blank');
  VexUI.renderToolbar();

  // Text shared from another app, or a system "search the web" — MainActivity
  // forwards those as a window event because they are not URL intents.
  window.addEventListener('vexOpenText', event => {
    // Capacitor copies the payload onto the event itself; a plain CustomEvent
    // puts it in detail. Accept either.
    const detail = (event && event.detail) || event || {};
    if (detail.text) VexUI.openUrl(detail.text, { newTab: true });
  });

  // A link opened from another app arrives here.
  VexBridge.onAppEvent('appUrlOpen', data => {
    if (data && data.url) VexUI.openUrl(data.url, { newTab: true });
  });
  VexBridge.onAppEvent('backButton', async () => {
    const handled = await VexUI.handleBack();
    if (handled) return;
    const plugin = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.App;
    if (plugin) plugin.minimizeApp();
  });

  // Follow the system theme, and tell the status bar which one is up.
  const dark = window.matchMedia('(prefers-color-scheme: dark)');
  dark.addEventListener('change', applyTheme);

  function applyTheme() {
    const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    document.documentElement.dataset.theme = isDark ? 'midnight' : 'oxford';
    VexBridge.setStatusBarStyle(isDark);
  }

  function wireNative() {
    VexBridge.on('loadStart', data => {
      VexTabStore.update(data.id, { loading: true, progress: 5, pendingUrl: data.url || '', blocked: 0 });
    });

    VexBridge.on('loadProgress', data => {
      VexTabStore.update(data.id, { progress: Number(data.progress) || 0 });
    });

    VexBridge.on('loadEnd', data => {
      const tab = VexTabStore.update(data.id, {
        loading: false,
        progress: 100,
        url: data.url || '',
        title: data.title || '',
        canGoBack: !!data.canGoBack,
        canGoForward: !!data.canGoForward
      });
      if (!tab) return;
      VexTabStore.persist();
      recordHistory(tab);
      if (VexStore.get('vex.darkPages', false)) VexBridge.setDarkMode(tab.id, true);
    });

    VexBridge.on('title', data => VexTabStore.update(data.id, { title: data.title || '' }));
    VexBridge.on('urlChange', data => {
      const tab = VexTabStore.update(data.id, {
        url: data.url || '',
        canGoBack: !!data.canGoBack,
        canGoForward: !!data.canGoForward
      });
      if (tab) VexTabStore.persist();
    });

    // A target=_blank / window.open from the page.
    VexBridge.on('newTab', data => {
      const current = VexTabStore.active();
      VexTabStore.create(data.url, { incognito: !!(current && current.incognito), background: !!data.background });
    });

    VexBridge.on('download', async data => {
      await VexStore.push('vex.downloads', {
        url: data.url, filename: data.filename || '', at: Date.now()
      }, 200);
      VexUI.toast('Downloading ' + (data.filename || 'file'));
    });

    VexBridge.on('blocked', data => {
      const tab = VexTabStore.get(data.id);
      if (!tab) return;
      VexTabStore.update(data.id, { blocked: (tab.blocked || 0) + (Number(data.count) || 1) });
    });

    VexBridge.on('findResult', data => {
      const count = document.getElementById('find-count');
      const matches = Number(data.matches) || 0;
      count.textContent = matches ? ((Number(data.activeMatch) || 0) + 1) + '/' + matches : 'none';
    });

    // Left/right swipe from the screen edge, detected inside the page WebView.
    VexBridge.on('edgeSwipe', data => {
      const tab = VexTabStore.active();
      if (!tab) return;
      if (data.direction === 'right' && tab.canGoBack) VexBridge.back(tab.id);
      else if (data.direction === 'left' && tab.canGoForward) VexBridge.forward(tab.id);
    });

    VexBridge.on('error', data => {
      VexTabStore.update(data.id, { loading: false, progress: 100 });
      if (data.description) VexUI.toast(String(data.description).slice(0, 90));
    });
  }

  // Private tabs never reach history — that is the whole point of them.
  function recordHistory(tab) {
    if (tab.incognito || !tab.url || tab.url === 'about:blank') return;
    const history = VexStore.get('vex.history', []);
    if (history[0] && history[0].url === tab.url) {
      history[0].title = tab.title || history[0].title;
      history[0].at = Date.now();
      VexStore.set('vex.history', history);
      return;
    }
    VexStore.push('vex.history', { url: tab.url, title: tab.title || '', at: Date.now() }, 3000);
    VexUI.renderStartTiles();
  }
})();

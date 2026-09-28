// === Vex Mobile — boot ===
//
// Order matters: storage before anything reads a setting, the theme before the
// first paint, the bridge before a tab exists, the blocker and the shield
// before the first page loads — a rule or a shim that arrives late did not
// protect the request it missed — then the chrome, then the session.

(async function boot() {
  await VexStore.init();

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
    VexStore.prime('vex.blockedTotal', 0),
    VexStore.prime('vex.textZoom', 100),
    VexStore.prime('vex.darkPages', false),
    VexStore.prime('vex.desktopDefault', false),
    VexStore.prime('vex.dataSaver', false),
    VexStore.prime('vex.dnt', true),
    VexStore.prime('vex.httpsOnly', true),
    VexStore.prime('vex.shield', 'standard'),
    VexStore.prime('vex.siteRules', {}),
    VexStore.prime('vex.theme', 'auto'),
    VexStore.prime('vex.skin', 'none'),
    VexStore.prime('vex.skinStrength', 0.05),
    VexStore.prime('vex.corner', 'soft'),
    VexStore.prime('vex.shadow', 'soft'),
    VexStore.prime('vex.font', 'system'),
    VexStore.prime('vex.tintToolbar', true),
    VexStore.prime('vex.readerSize', 19),
    VexStore.prime('vex.aiWorkerUrl', '')
  ]);

  const native = await VexBridge.init();
  document.documentElement.dataset.native = native ? '1' : '0';

  VexTheme.watchSystem();
  VexTheme.apply();

  wireNative();
  VexUI.bind();
  VexUI.pushBounds();

  await VexBlock.apply();
  await VexShield.install();
  await VexBridge.setTextZoom(VexStore.get('vex.textZoom', 100));
  await VexBridge.setPrivacy({
    httpsOnly: VexStore.get('vex.httpsOnly', true) !== false,
    doNotTrack: VexStore.get('vex.dnt', true) !== false
  });

  const restored = await VexTabStore.restore();
  if (!restored) await VexTabStore.create('about:blank');
  VexUI.renderToolbar();

  // Text shared from another app, or a system "search the web" — MainActivity
  // forwards those as a window event because they are not URL intents.
  window.addEventListener('vexOpenText', event => {
    const detail = (event && event.detail) || event || {};
    if (detail.text) VexUI.openUrl(detail.text, { newTab: true });
  });

  VexBridge.onAppEvent('appUrlOpen', data => {
    if (data && data.url) VexUI.openUrl(data.url, { newTab: true });
  });
  VexBridge.onAppEvent('backButton', async () => {
    if (await VexUI.handleBack()) return;
    const plugin = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.App;
    if (plugin) plugin.minimizeApp();
  });
  // Leaving the app is the moment to write down where every tab was.
  VexBridge.onAppEvent('appStateChange', async state => {
    if (state && state.isActive === false) await rememberScroll();
  });

  function wireNative() {
    VexBridge.on('loadStart', data => {
      VexTabStore.update(data.id, {
        loading: true, progress: 6, pendingUrl: data.url || '', blocked: 0, themeColor: ''
      });
    });

    VexBridge.on('loadProgress', data => {
      VexTabStore.update(data.id, { progress: Number(data.progress) || 0 });
    });

    VexBridge.on('loadEnd', async data => {
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
      await VexSiteRules.applyTo(tab);
      readThemeColor(tab);
    });

    VexBridge.on('title', data => VexTabStore.update(data.id, { title: data.title || '' }));
    VexBridge.on('icon', data => {
      const tab = VexTabStore.update(data.id, { icon: data.icon || '' });
      if (!tab || tab.incognito || !tab.icon) return;
      // Keep the icon with the history entry so the start page and the omnibox
      // can show it long after the tab is gone.
      const history = VexStore.get('vex.history', []);
      const entry = history.find(item => item.url === tab.url);
      if (entry && !entry.icon) { entry.icon = tab.icon; VexStore.set('vex.history', history); }
    });

    VexBridge.on('urlChange', data => {
      const tab = VexTabStore.update(data.id, {
        url: data.url || '',
        canGoBack: !!data.canGoBack,
        canGoForward: !!data.canGoForward
      });
      if (tab) VexTabStore.persist();
    });

    VexBridge.on('newTab', data => {
      const current = VexTabStore.active();
      VexTabStore.create(data.url, {
        incognito: !!(current && current.incognito),
        background: !!data.background
      });
    });

    VexBridge.on('download', async data => {
      await VexStore.push('vex.downloads', {
        url: data.url, filename: data.filename || '', size: Number(data.size) || 0, at: Date.now()
      }, 200);
      VexUI.toast('Downloading ' + (data.filename || 'file'), 3000, {
        label: 'Downloads',
        run: () => VexPanels.downloads()
      });
    });

    VexBridge.on('blocked', async data => {
      const tab = VexTabStore.get(data.id);
      if (!tab) return;
      const count = Number(data.count) || 1;
      VexTabStore.update(data.id, { blocked: (tab.blocked || 0) + count });
      await VexStore.set('vex.blockedTotal', Number(VexStore.get('vex.blockedTotal', 0)) + count);
    });

    VexBridge.on('findResult', data => {
      const matches = Number(data.matches) || 0;
      document.getElementById('find-count').textContent =
        matches ? ((Number(data.activeMatch) || 0) + 1) + '/' + matches : 'none';
    });

    VexBridge.on('longPress', data => {
      if (data && (data.link || data.image)) VexSheets.link({ link: data.link, image: data.image });
    });

    VexBridge.on('edgeSwipe', data => {
      const tab = VexTabStore.active();
      if (!tab) return;
      if (data.direction === 'right' && tab.canGoBack) VexBridge.back(tab.id);
      else if (data.direction === 'left' && tab.canGoForward) VexBridge.forward(tab.id);
    });

    VexBridge.on('permission', data => {
      if (data && data.missing) {
        VexUI.toast('This site wants the ' + data.missing + '. Allow it for Vex in Android settings.', 4000);
      }
    });

    VexBridge.on('error', data => {
      VexTabStore.update(data.id, { loading: false, progress: 100 });
      if (data.description) VexUI.toast(String(data.description).slice(0, 110), 3500);
    });
  }

  // A page's <meta name="theme-color"> tints the toolbar.
  async function readThemeColor(tab) {
    if (!VexStore.get('vex.tintToolbar', true) || tab.incognito) return;
    try {
      const { result } = await VexBridge.evaluate(tab.id,
        "(function(){var m=document.querySelector('meta[name=\"theme-color\"]');return m?m.content:''})()");
      const color = String(result || '').replace(/^"|"$/g, '').trim();
      VexTabStore.update(tab.id, { themeColor: color });
      if (tab.id === VexTabStore.activeId()) VexUI.renderToolbar();
    } catch { /* a page that will not run script keeps the theme's own colour */ }
  }

  async function rememberScroll() {
    for (const tab of VexTabStore.normal()) {
      try {
        const position = await VexBridge.scrollPosition(tab.id);
        if (position && typeof position.y === 'number') tab.scrollY = position.y;
      } catch { /* a sleeping tab has no scroll to read */ }
    }
    VexTabStore.persist();
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
    VexStore.push('vex.history', {
      url: tab.url, title: tab.title || '', at: Date.now(), icon: tab.icon || ''
    }, 3000);
  }
})();

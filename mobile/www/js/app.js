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
    VexStore.prime('vex.bookmarkFolders', []),
    VexStore.prime('vex.readingList', []),
    VexStore.prime('vex.sessions', []),
    VexStore.prime('vex.quickAccess', []),
    VexStore.prime('vex.tabGroups', []),
    VexStore.prime('vex.closedTabs', []),
    VexStore.prime('vex.openTabs', []),
    VexStore.prime('vex.activeTabUrl', ''),
    VexStore.prime('vex.searchEngine', 'duckduckgo'),
    VexStore.prime('vex.homepage', ''),
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
    VexStore.prime('vex.sitePermissions', {}),
    VexStore.prime('vex.theme', 'auto'),
    VexStore.prime('vex.skin', 'none'),
    VexStore.prime('vex.skinStrength', 0.05),
    VexStore.prime('vex.corner', 'soft'),
    VexStore.prime('vex.shadow', 'soft'),
    VexStore.prime('vex.font', 'system'),
    VexStore.prime('vex.tintToolbar', true),
    VexStore.prime('vex.toolbarPosition', 'bottom'),
    VexStore.prime('vex.autoHideToolbar', true),
    VexStore.prime('vex.pullToRefresh', true),
    VexStore.prime('vex.readerSize', 19),
    VexStore.prime('vex.aiWorkerUrl', ''),
    VexStore.prime('vex.syncWorkerUrl', ''),
    VexStore.prime('vex.sync', null),
    VexStore.prime('vex.recall', true),
    VexStore.prime('vex.historyDays', 365),
    VexStore.prime('vex.mediaBar', true),
    VexStore.prime('vex.backgroundAudio', false),
    VexStore.prime('vex.keepAwake', false),
    VexStore.prime('vex.lockPrivate', false),
    VexStore.prime('vex.linksInNewTab', false),
    VexStore.prime('vex.restoreTabs', true),
    VexStore.prime('vex.closeTabsAfter', 0),
    VexStore.prime('vex.confirmCloseAll', true),
    VexStore.prime('vex.menuOrder', null),
    VexStore.prime('vex.menuHidden', []),
    VexStore.prime('vex.loginHosts', []),
    VexStore.prime('vex.translateTo', 'en'),
    VexStore.prime('vex.blockedByHost', {}),
    VexStore.prime('vex.forceZoom', true),
    VexStore.prime('vex.pageContrast', 1),
    VexStore.prime('vex.nightShade', 0),
    VexStore.prime('vex.blockPopups', true),
    VexStore.prime('vex.toolbarButtons', null),
    VexStore.prime('vex.profile', null)
  ]);

  const native = await VexBridge.init();
  document.documentElement.dataset.native = native ? '1' : '0';

  VexTheme.watchSystem();
  VexTheme.apply();

  await VexHistory.load();

  wireNative();
  VexUI.bind();
  VexUI.pushBounds();

  await VexBlock.apply();
  await VexShield.install();
  await VexBridge.setTextZoom(VexStore.get('vex.textZoom', 100));
  await VexBridge.setPullToRefresh(VexStore.get('vex.pullToRefresh', true) !== false);
  await VexBridge.setBackgroundAudio(VexStore.get('vex.backgroundAudio', false) === true);
  await VexBridge.setKeepAwake(VexStore.get('vex.keepAwake', false) === true);
  await VexBridge.setPrivacy({
    httpsOnly: VexStore.get('vex.httpsOnly', true) !== false,
    doNotTrack: VexStore.get('vex.dnt', true) !== false
  });

  const restored = VexStore.get('vex.restoreTabs', true) === false ? 0 : await VexTabStore.restore();
  if (!restored) await VexTabStore.create('about:blank');
  VexUI.renderToolbar();

  // Things that can wait until the first page is on screen.
  setTimeout(async () => {
    await VexHistory.prune({ historyDays: VexStore.get('vex.historyDays', 365) });
    await closeStaleTabs();
    if (await VexSync.restore()) {
      const result = await VexSync.syncNow();
      if (result.ok) { VexStart.render(); VexUI.renderToolbar(); }
    }
  }, 2500);

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
  VexBridge.onAppEvent('appStateChange', async state => {
    if (state && state.isActive === false) {
      await rememberScroll();
      VexVault.lock();                 // leaving the app re-locks the logins
      VexSync.schedulePush(500);
    }
  });

  // ── Native events ────────────────────────────────────────────────────────
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
      await recordHistory(tab);
      await VexSiteRules.applyTo(tab);
      readThemeColor(tab);
      if (tab.id === VexTabStore.activeId()) {
        VexUI.refreshMediaBar();
        // A saved login for this site is offered, never filled behind your back.
        setTimeout(() => VexUI.offerAutofill(tab).catch(() => {}), 700);
      }
      indexForRecall(tab);
    });

    VexBridge.on('title', data => VexTabStore.update(data.id, { title: data.title || '' }));

    VexBridge.on('icon', async data => {
      const tab = VexTabStore.update(data.id, { icon: data.icon || '' });
      if (!tab || tab.incognito || !tab.icon) return;
      await VexHistory.setIcon(tab.url, tab.icon);
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
      // `background` is set when the page opened this without a tap — which is
      // what a pop-up is. Blocking it still tells you, so a site that needs one
      // is not a mystery.
      if (data.background && VexStore.get('vex.blockPopups', true) !== false) {
        VexUI.toast('Blocked a pop-up', 3000, {
          label: 'Open it',
          run: () => VexUI.openUrl(data.url, { newTab: true })
        });
        return;
      }
      const current = VexTabStore.active();
      VexTabStore.create(data.url, {
        incognito: !!(current && current.incognito),
        background: !!data.background
      });
    });

    VexBridge.on('download', async data => {
      await VexDB.add('downloads', {
        url: data.url, filename: data.filename || '', size: Number(data.size) || 0, at: Date.now()
      });
      VexUI.toast('Downloading ' + (data.filename || 'file'), 3500, {
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
      if (!tab.incognito) await VexBlock.count(VexSearch.prettyHost(tab.url), count);
    });

    VexBridge.on('findResult', data => {
      const matches = Number(data.matches) || 0;
      document.getElementById('find-count').textContent =
        matches ? ((Number(data.activeMatch) || 0) + 1) + '/' + matches : 'none';
    });

    VexBridge.on('longPress', data => {
      if (data && (data.link || data.image)) VexSheets.link({ link: data.link, image: data.image });
    });

    VexBridge.on('scroll', data => VexUI.onPageScroll(data));

    VexBridge.on('edgeSwipe', data => {
      const tab = VexTabStore.active();
      if (!tab) return;
      if (data.direction === 'right' && tab.canGoBack) VexBridge.back(tab.id);
      else if (data.direction === 'left' && tab.canGoForward) VexBridge.forward(tab.id);
    });

    // A page asked for the camera, the microphone or a location. What it gets
    // is your answer for that site, remembered, and then Android's own.
    VexBridge.on('permission', async data => {
      const tab = VexTabStore.get(data.id) || VexTabStore.active();
      if (!tab) return;
      const host = VexSearch.prettyHost(tab.url);
      const kinds = String(data.missing || '').split(',').filter(Boolean);
      for (const kind of kinds) {
        const stored = VexPermissions.get(host, kind);
        if (stored === 'block') continue;
        const allow = stored === 'allow'
          || await VexUI.confirm(host + ' wants your ' + kind + '. Allow it?', 'Permission');
        await VexPermissions.set(host, kind, allow ? 'allow' : 'block');
        if (allow) {
          const granted = await VexBridge.requestPermission(kind);
          VexUI.toast(granted
            ? 'Allowed — reload the page to use it'
            : 'Android did not grant the ' + kind + ' to Vex', 3500);
        }
      }
    });

    VexBridge.on('fullscreen', data => {
      // A page playing video full screen should not have a toolbar over it.
      document.body.classList.toggle('toolbar-hidden', !!(data && data.fullscreen));
    });

    VexBridge.on('error', data => {
      VexTabStore.update(data.id, { loading: false, progress: 100 });
      if (data.description) VexUI.toast(String(data.description).slice(0, 110), 3500);
    });
  }

  // ── Page bookkeeping ─────────────────────────────────────────────────────
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

  // Private tabs never reach history — that is the whole point of them.
  async function recordHistory(tab) {
    if (tab.incognito || !tab.url || tab.url === 'about:blank') return;
    await VexHistory.add({ url: tab.url, title: tab.title, icon: tab.icon });
    VexStart.render();
  }

  // Recall: the page's readable text, kept on the device so it can be found
  // later by what it said. Never for a private tab, never for a site whose
  // rules say no, and only once the page has settled.
  function indexForRecall(tab) {
    if (tab.incognito || VexStore.get('vex.recall', true) === false) return;
    if (!tab.url || !/^https?:/.test(tab.url)) return;
    setTimeout(async () => {
      const current = VexTabStore.get(tab.id);
      if (!current || current.url !== tab.url) return;      // navigated away
      try {
        const text = await VexReader.pageText(tab.id, 12000);
        if (text) await VexHistory.index({ url: tab.url, title: tab.title, text });
      } catch { /* a page that refuses script is simply not indexed */ }
    }, 2500);
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

  // "Close tabs you have not opened in a month" — Samsung's setting, and the
  // phone's answer to the desktop's tab sleep.
  async function closeStaleTabs() {
    const days = Number(VexStore.get('vex.closeTabsAfter', 0));
    if (!days) return;
    const cutoff = Date.now() - days * 86400000;
    const stale = VexTabStore.normal().filter(tab => (tab.lastActiveAt || tab.createdAt || 0) < cutoff);
    if (!stale.length) return;
    for (const tab of stale) {
      if (VexTabStore.all().length <= 1) break;
      await VexTabStore.close(tab.id);
    }
    VexUI.toast('Closed ' + stale.length + ' tabs you had not opened in ' + days + ' days', 4000);
  }
})();

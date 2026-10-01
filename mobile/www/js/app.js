// === Vex Mobile — boot ===
//
// Order matters: storage before anything reads a setting, the theme before the
// first paint, the bridge before a tab exists, the blocker and the shield
// before the first page loads — a rule or a shim that arrives late did not
// protect the request it missed — then the chrome, then the session.

(async function boot() {
  // First, before anything that can fail: a recorder that starts late misses
  // exactly the failures worth recording, which are the ones during boot.
  VexReport.bind();

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
    // Typeface, measure, line spacing and paper: named once, in views.js, and
    // primed from that table so adding a fifth needs nothing here.
    ...VexViews.READER_LOOK.map(([key, , fallback]) => VexStore.prime(key, fallback)),
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
    VexStore.prime('vex.profile', null),
    VexStore.prime('vex.reminders', []),
    VexStore.prime('vex.noteCount', 0),
    VexStore.prime('vex.aiMemory', []),
    VexStore.prime('vex.onboarded', false),
    // Everything below was read with VexStore.get and never primed, which means
    // it was never read from the phone at all: get() only sees the cache, and
    // only prime() and set() fill it. The effect was a setting that reset on
    // every launch — including two that turn themselves back ON, which is the
    // wrong direction for a promise about what leaves the device.
    VexStore.prime('vex.searchSuggestions', true),
    VexStore.prime('vex.syncHistory', true),
    VexStore.prime('vex.localAI', 'off'),
    VexStore.prime('vex.localModel', ''),
    VexStore.prime('vex.localBackend', 'gpu'),
    VexStore.prime('vex.nanoAI', 'off'),
    VexStore.prime('vex.tabBar', 'auto'),
    VexStore.prime('vex.backupHistory', false),
    VexStore.prime('vex.speakRate', 1),
    VexStore.prime('vex.speakVoice', ''),
    VexStore.prime('vex.autoplay', false),
    VexStore.prime('vex.translateWifiOnly', true),
    VexStore.prime('vex.translateOnDevice', true),
    VexStore.prime('vex.customEngine', null),
    VexStore.prime('vex.clearItems', null),
    VexStore.prime('vex.clearOnExit', false),
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

  // Four questions, once, all of them skippable.
  await VexWelcome.maybeShow();

  // The on-device model's download reports progress through the plugin, and the
  // settings panel is not necessarily open when it finishes.
  VexLocalAI.bind();
  VexPdf.bind();
  VexSpeak.bind();

  // Things that can wait until the first page is on screen.
  setTimeout(async () => {
    await VexHistory.prune({ historyDays: VexStore.get('vex.historyDays', 365) });
    await closeStaleTabs();
    // Alarms do not survive a reboot; re-arming the ones still ahead is
    // cheaper than a boot receiver and does the same job.
    await VexRemind.rearm();
    // Only when it is switched on: asking the plugin wakes nothing, but asking
    // AICore for Nano's status on every cold start would be rude.
    if (VexLocalAI.mode() !== 'off') await VexLocalAI.refresh();
    if (VexLocalAI.nanoMode()) await VexLocalAI.refreshNano();
    if (await VexSync.restore()) {
      const result = await VexSync.syncNow();
      if (result.ok) { VexStart.render(); VexUI.renderToolbar(); }
    }
  }, 2500);

  // Text shared from another app, or a system "search the web" — MainActivity
  // forwards those as a window event because they are not URL intents.
  window.addEventListener('vexOpenText', event => {
    const detail = (event && event.detail) || event || {};
    if (detail.widget) runWidgetTap(detail.widget);
    else if (detail.text) VexUI.openUrl(detail.text, { newTab: true });
  });

  // A tap on the home-screen widget, or a launcher shortcut from long-pressing
  // the icon. Each target lands exactly where the same button in the chrome
  // would, which is the whole promise of a shortcut.
  async function runWidgetTap(target) {
    if (target === 'scan') { VexUI.openScanner(); return; }
    if (target === 'new-tab') { await VexUI.newTab(); return; }
    if (target === 'new-private-tab') { await VexUI.newTab({ incognito: true }); return; }
    VexUI.openOmnibox('');
    if (target === 'voice') VexUI.dictateIntoOmnibox();
  }

  // A cold start hands the intent over before any of this was listening, so the
  // first thing the chrome does is ask whether it was launched to do something.
  (async () => {
    const pending = await VexBridge.pendingIntent();
    if (pending.widget) runWidgetTap(pending.widget);
    else if (pending.text) VexUI.openUrl(pending.text, { newTab: true });
  })();

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
      // The plugin stops the speech engine rather than talking from an app you
      // have left; the bar has to say so, and offer to carry on.
      VexSpeak.noteStopped();
      VexSync.schedulePush(500);
      // "Clear when I leave Vex", if that is switched on. After the sync push
      // is scheduled, because what syncs is bookmarks and sessions rather than
      // anything on that list.
      const cleared = await VexClear.onLeaving();
      if (cleared.length) VexUI.renderToolbar();
    }
  });

  // ── Native events ────────────────────────────────────────────────────────
  function wireNative() {
    VexBridge.on('loadStart', data => {
      VexTabStore.update(data.id, {
        loading: true, progress: 6, pendingUrl: data.url || '', blocked: 0, themeColor: ''
      });
      // Reading aloud belongs to one article. Navigating away ends it rather
      // than leaving a voice reading a page that is no longer there.
      if (VexSpeak.state.loaded && VexSpeak.state.url && data.url
        && data.url !== VexSpeak.state.url) VexSpeak.stop();
      // The translated page's text nodes went with the document.
      VexTranslate.forget(data.id);
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
      // A .litertlm is an on-device model and nothing else. Vex is the browser
      // you downloaded it in, so offer the one thing you would do with it next.
      if (/\.litertlm$/i.test(data.filename || '')) {
        VexUI.toast('That is an on-device model', 6000, {
          label: 'Use it',
          run: () => VexPanels.localAI()
        });
        return;
      }
      VexUI.toast('Downloading ' + (data.filename || 'file'), 3500, {
        label: 'Downloads',
        run: () => VexPanels.downloads()
      });
    });

    // Android's WebView hands every PDF to the download manager because it
    // cannot draw one. Vex can, so this is a reader rather than a file.
    VexBridge.on('pdf', async data => {
      if (!data || !data.url) return;
      await VexPdf.open(data.url, data.filename || 'document.pdf');
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

    // "Ask Vex", "Translate", "Keep as a note" on selected text — the menu
    // Android shows when you select something, with Vex's own items added.
    VexBridge.on('selection', async data => {
      const text = String(data.text || '').trim();
      const tab = VexTabStore.get(data.id) || VexTabStore.active();
      if (!text || !tab) return;
      if (data.action === 'note') {
        await VexNotes.add({ url: tab.url, title: tab.title, text, kind: 'quote' });
        await VexStore.set('vex.noteCount', Number(VexStore.get('vex.noteCount', 0)) + 1);
        VexUI.toast('Kept', 3000, { label: 'Notes', run: () => VexPanels.notes() });
        return;
      }
      // Nano's three jobs, on the phone, with the result going back into the
      // field it came from where that is possible.
      if (data.action === 'polish') {
        await VexViews.polish(tab, text.slice(0, 4000));
        return;
      }
      // On-device can answer an explanation or a translation with no worker at
      // all, so the worker is only required when nothing local will take it.
      const action = data.action === 'translate' ? 'translate' : 'explain';
      if (tab.incognito && !VexAI.staysHere(action)) {
        VexUI.toast('A private selection is not sent to your worker — turn on on-device AI', 4500);
        return;
      }
      if (!VexAI.staysHere(action) && !(await VexAI.configured())) {
        VexUI.toast('Set up the assistant, or turn on on-device AI', 3500);
        return;
      }
      VexViews.openAI('ask');
      const question = data.action === 'translate'
        ? 'Translate this into ' + VexStore.get('vex.translateTo', 'en') + '.'
        : 'What does this mean?';
      VexViews.askAI(question, {
        action,
        // The selection belongs to the page it came from: if that page is
        // private, it goes to the model on this phone or nowhere.
        privateSelection: !!tab.incognito,
        selectedText: text.slice(0, 4000),
        targetLanguage: VexStore.get('vex.translateTo', 'en')
      });
    });

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
      VexUI.setFullscreen(!!(data && data.fullscreen));
    });

    VexBridge.on('error', async data => {
      const tab = VexTabStore.update(data.id, { loading: false, progress: 100 });
      if (!tab) return;
      // Vex's own error page, in your theme, offering the three things worth
      // offering — including the copy it saved, if there is one.
      const drawn = await VexErrors.show(tab, { code: data.code, description: data.description });
      if (!drawn && data.description) VexUI.toast(String(data.description).slice(0, 110), 3500);
    });

    // The buttons on that page are vex:// links, because a page cannot call
    // the chrome.
    VexBridge.on('command', data => {
      const tab = VexTabStore.get(data.id) || VexTabStore.active();
      VexErrors.handle(tab, data.command, data.value);
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
    // Only worth redrawing when it is on screen; otherwise this runs on every
    // page load for a page nobody is looking at.
    if (VexUI.startVisible()) VexStart.render();
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

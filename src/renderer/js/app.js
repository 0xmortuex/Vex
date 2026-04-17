// === Vex App — Main Entry Point ===

(async function () {
  // Hydrate localStorage from persistent file store BEFORE anything else reads it.
  // This makes every existing localStorage.getItem('vex.*') call survive reinstalls.
  if (window.PersistentStorage) {
    try { await PersistentStorage.init(); } catch (e) { console.error('PersistentStorage init:', e); }
  }

  // Load settings
  const settings = await VexStorage.loadSettings();

  // Apply settings
  if (!settings.tabsVisible) {
    document.getElementById('tabs-sidebar').classList.add('hidden');
  }

  // Expose TabManager globally for cross-module access
  window.Tabs = TabManager;

  // Init modules
  SidebarManager.init();
  VexTools.init();
  CommandBar.init();
  StartPageManager.init();
  SplitScreen.init();
  SessionManager.init();
  WorkspaceManager.init();
  Translator.init();
  await TabManager.init();

  // Init tab preview (deferred to avoid slowing startup)
  setTimeout(() => TabPreview.init(), 1000);

  // Check for restore prompt (deferred so it doesn't block startup)
  setTimeout(() => RestorePrompt.checkOnStartup(settings), 500);

  // Workspace switcher button
  document.getElementById('workspace-btn')?.addEventListener('click', () => WorkspaceManager.toggleDropdown());

  // PiP Manager (renderer side)
  window.PiPManager = {
    videoDetected: false,

    init() {
      // Listen for video detection messages from webviews
      window.addEventListener('message', (e) => {
        if (e.data && e.data.type === 'vex-video-detected') {
          this.videoDetected = e.data.hasVideo;
          const pipBtn = document.getElementById('pip-btn');
          if (pipBtn) {
            pipBtn.style.display = e.data.hasVideo ? 'flex' : 'none';
          }
        }
        if (e.data && e.data.type === 'vex-pip-fallback') {
          // Fallback: open in popup window via IPC
          const tab = TabManager.getActiveTab();
          if (tab) window.vex.openPipWindow(tab.url);
        }
      });

      // PiP button click
      const pipBtn = document.getElementById('pip-btn');
      if (pipBtn) {
        pipBtn.addEventListener('click', () => this.toggle());
      }
    },

    toggle() {
      const wv = WebviewManager.getActiveWebview();
      if (wv) {
        // Try native PiP first via message to webview content
        wv.contentWindow?.postMessage({ type: 'vex-request-pip' }, '*');
        // Fallback: open as popup window
        setTimeout(() => {
          if (!document.pictureInPictureElement) {
            const tab = TabManager.getActiveTab();
            if (tab && window.vex.openPipWindow) {
              window.vex.openPipWindow(tab.url);
            }
          }
        }, 500);
      }
    }
  };
  window.PiPManager.init();

  // === URL Bar ===
  const urlInput = document.getElementById('url-input');

  urlInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const val = urlInput.value.trim();
      if (!val) return;

      let url;
      if (/^https?:\/\//i.test(val)) {
        url = val;
      } else if (/^[a-z0-9]([a-z0-9-]*\.)+[a-z]{2,}/i.test(val)) {
        url = 'https://' + val;
      } else {
        // Search
        const engines = {
          google: 'https://www.google.com/search?q=',
          duckduckgo: 'https://duckduckgo.com/?q=',
          brave: 'https://search.brave.com/search?q='
        };
        const engine = engines[settings.searchEngine] || engines.google;
        url = engine + encodeURIComponent(val);
      }

      // If sidebar panel is open, close it first
      SidebarManager.hideActivePanel();

      const activeTab = TabManager.getActiveTab();
      if (activeTab) {
        WebviewManager.navigate(url);
      }

      urlInput.blur();
    } else if (e.key === 'Escape') {
      urlInput.blur();
      const tab = TabManager.getActiveTab();
      if (tab) TabManager.updateUrlBar(tab);
    }
  });

  urlInput.addEventListener('focus', () => {
    urlInput.select();
  });

  // === Navigation Buttons ===
  document.getElementById('btn-back').addEventListener('click', () => WebviewManager.goBack());
  document.getElementById('btn-forward').addEventListener('click', () => WebviewManager.goForward());
  document.getElementById('btn-reload').addEventListener('click', () => WebviewManager.reload());
  document.getElementById('btn-command').addEventListener('click', () => CommandBar.toggle());

  // === Window Controls ===
  document.getElementById('btn-minimize').addEventListener('click', () => window.vex.minimize());
  document.getElementById('btn-maximize').addEventListener('click', () => window.vex.maximize());
  document.getElementById('btn-close').addEventListener('click', () => window.vex.close());

  // === IPC Events from Main ===
  window.vex.onCommandBar(() => CommandBar.toggle());
  window.vex.onNewTab(() => TabManager.createTab(START_URL, true));
  window.vex.onCloseTab(() => {
    const tab = TabManager.getActiveTab();
    if (tab) TabManager.closeTab(tab.id);
  });
  window.vex.onReloadTab(() => WebviewManager.reload());
  window.vex.onNavigateBack(() => WebviewManager.goBack());
  window.vex.onNavigateForward(() => WebviewManager.goForward());
  window.vex.onZoomIn(() => WebviewManager.zoomIn());
  window.vex.onZoomOut(() => WebviewManager.zoomOut());
  window.vex.onZoomReset(() => WebviewManager.zoomReset());

  // === Find in Page ===
  window.vex.onFindInPage(() => toggleFindBar());

  const findBar = document.getElementById('find-bar');
  const findInput = document.getElementById('find-input');
  const findCount = document.getElementById('find-count');

  function toggleFindBar() {
    if (findBar.style.display === 'none') {
      findBar.style.display = 'flex';
      findInput.focus();
      findInput.select();
    } else {
      findBar.style.display = 'none';
      WebviewManager.stopFindInPage();
    }
  }

  findInput.addEventListener('input', () => {
    const text = findInput.value;
    if (text) {
      WebviewManager.findInPage(text);
    } else {
      WebviewManager.stopFindInPage();
      findCount.textContent = '';
    }
  });

  findInput.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      findBar.style.display = 'none';
      WebviewManager.stopFindInPage();
    } else if (e.key === 'Enter') {
      WebviewManager.findInPage(findInput.value);
    }
  });

  document.getElementById('find-prev').addEventListener('click', () => {
    const wv = WebviewManager.getActiveWebview();
    if (wv && findInput.value) wv.findInPage(findInput.value, { forward: false });
  });

  document.getElementById('find-next').addEventListener('click', () => {
    const wv = WebviewManager.getActiveWebview();
    if (wv && findInput.value) wv.findInPage(findInput.value, { forward: true });
  });

  document.getElementById('find-close').addEventListener('click', () => {
    findBar.style.display = 'none';
    WebviewManager.stopFindInPage();
  });

  // Listen for found-in-page results on active webview
  const observer = new MutationObserver(() => {
    const wv = WebviewManager.getActiveWebview();
    if (wv && !wv._findBound) {
      wv.addEventListener('found-in-page', (e) => {
        if (e.result) {
          findCount.textContent = `${e.result.activeMatchOrdinal}/${e.result.matches}`;
        }
      });
      wv._findBound = true;
    }
  });
  observer.observe(document.getElementById('webviews-container'), { childList: true });

  // === Settings Panel ===
  const searchEngineSelect = document.getElementById('setting-search-engine');
  const adBlockerToggle = document.getElementById('setting-adblocker');
  const tabsVisibleToggle = document.getElementById('setting-tabs-visible');

  searchEngineSelect.value = settings.searchEngine || 'google';
  adBlockerToggle.checked = settings.adBlocker !== false;
  tabsVisibleToggle.checked = settings.tabsVisible !== false;

  searchEngineSelect.addEventListener('change', () => {
    settings.searchEngine = searchEngineSelect.value;
    VexStorage.saveSettings(settings);
  });

  adBlockerToggle.addEventListener('change', () => {
    settings.adBlocker = adBlockerToggle.checked;
    VexStorage.saveSettings(settings);
    window.vex.setAdBlockerState(adBlockerToggle.checked);
  });

  tabsVisibleToggle.addEventListener('change', () => {
    settings.tabsVisible = tabsVisibleToggle.checked;
    VexStorage.saveSettings(settings);
    document.getElementById('tabs-sidebar').classList.toggle('hidden', !tabsVisibleToggle.checked);
  });

  // Accent color picker
  document.querySelectorAll('.accent-opt').forEach(opt => {
    opt.addEventListener('click', () => {
      document.querySelectorAll('.accent-opt').forEach(o => o.style.borderColor = 'transparent');
      opt.style.borderColor = 'var(--text)';
      const color = opt.dataset.color;
      document.documentElement.style.setProperty('--primary', color);
      settings.accentColor = color;
      VexStorage.saveSettings(settings);
    });
  });
  // Apply saved accent color
  if (settings.accentColor) {
    document.documentElement.style.setProperty('--primary', settings.accentColor);
    const activeOpt = document.querySelector(`.accent-opt[data-color="${settings.accentColor}"]`);
    if (activeOpt) activeOpt.style.borderColor = 'var(--text)';
  }

  // Clear data button
  document.getElementById('setting-clear-data')?.addEventListener('click', () => {
    if (confirm('Clear all browsing data? This cannot be undone.')) {
      localStorage.clear();
      showToast('Browsing data cleared. Restart for full effect.');
    }
  });

  // Auto-save sessions toggle
  const autosaveToggle = document.getElementById('setting-autosave');
  if (autosaveToggle) {
    autosaveToggle.checked = settings.autoSaveSessions || false;
    autosaveToggle.addEventListener('change', () => {
      settings.autoSaveSessions = autosaveToggle.checked;
      VexStorage.saveSettings(settings);
      if (autosaveToggle.checked) {
        window._autoSaveInterval = setInterval(() => {
          SessionManager.saveCurrentSession('Auto-saved ' + new Date().toLocaleString());
        }, 10 * 60 * 1000);
      } else {
        clearInterval(window._autoSaveInterval);
      }
    });
  }

  // Settings buttons
  document.getElementById('setting-open-sessions')?.addEventListener('click', () => SessionManager.showOverlay());
  document.getElementById('setting-open-workspaces')?.addEventListener('click', () => WorkspaceManager.showModal());
  document.getElementById('setting-github-link')?.addEventListener('click', (e) => {
    e.preventDefault();
    TabManager.createTab('https://github.com/0xmortuex/Vex', true);
    SidebarManager.hideActivePanel();
  });

  // Export all data
  document.getElementById('setting-export')?.addEventListener('click', () => {
    const data = {};
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key.startsWith('vex.')) data[key] = localStorage.getItem(key);
    }
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'vex-data-export.json';
    a.click();
    URL.revokeObjectURL(a.href);
    showToast('Data exported');
  });

  // Reset to defaults
  document.getElementById('setting-reset')?.addEventListener('click', () => {
    if (confirm('Reset all Vex settings to defaults? This cannot be undone.')) {
      const keys = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key.startsWith('vex.')) keys.push(key);
      }
      keys.forEach(k => localStorage.removeItem(k));
      showToast('Settings reset. Restart Vex.');
    }
  });

  // === Phase 12: AI History Indexing settings ===
  const aiIndexToggle = document.getElementById('setting-ai-indexing-enabled');
  if (aiIndexToggle) {
    aiIndexToggle.checked = HistoryIndexer?.isEnabled?.() !== false;
    aiIndexToggle.addEventListener('change', () => {
      HistoryIndexer?.setEnabled?.(aiIndexToggle.checked);
      showToast(aiIndexToggle.checked ? 'AI history indexing enabled' : 'AI history indexing disabled');
    });
  }
  document.getElementById('btn-reindex-open')?.addEventListener('click', () => {
    const n = HistoryIndexer?.reindexOpenTabs?.() || 0;
    showToast(n > 0 ? `Re-indexing ${n} tab${n === 1 ? '' : 's'}…` : 'No unindexed open tabs');
    setTimeout(updateIndexingStats, 500);
  });
  document.getElementById('btn-clear-summaries')?.addEventListener('click', () => {
    if (!confirm('Remove all AI summaries from history? Your browsing history itself stays; only the AI-generated descriptions are deleted.')) return;
    if (window.HistoryPanel && Array.isArray(HistoryPanel.entries)) {
      HistoryPanel.entries.forEach(e => {
        delete e.summary; delete e.tags; delete e.contentType;
        delete e.indexed; delete e.indexedAt;
      });
      HistoryPanel.save();
    }
    showToast('AI summaries cleared');
    updateIndexingStats();
  });
  function updateIndexingStats() {
    const el = document.getElementById('indexing-stats');
    if (!el) return;
    const s = HistoryIndexer?.getStats?.() || { total: 0, indexed: 0, queued: 0 };
    const pct = s.total > 0 ? Math.round(s.indexed / s.total * 100) : 0;
    el.textContent = `📊 ${s.indexed} of ${s.total} indexed (${pct}%)${s.queued ? ` · ${s.queued} queued` : ''}`;
  }
  updateIndexingStats();
  setInterval(updateIndexingStats, 5000);

  // === Phase 16: Smart Tab Grouping settings ===
  const groupSuggestToggle = document.getElementById('setting-auto-group-suggest');
  if (groupSuggestToggle) {
    try { groupSuggestToggle.checked = JSON.parse(localStorage.getItem('vex.autoGroupSuggest') ?? 'true'); } catch {}
    groupSuggestToggle.addEventListener('change', () => {
      localStorage.setItem('vex.autoGroupSuggest', JSON.stringify(groupSuggestToggle.checked));
    });
  }
  const autoAddToggle = document.getElementById('setting-auto-add-to-groups');
  if (autoAddToggle) {
    try { autoAddToggle.checked = JSON.parse(localStorage.getItem('vex.autoAddToGroups') ?? 'true'); } catch {}
    autoAddToggle.addEventListener('change', () => {
      localStorage.setItem('vex.autoAddToGroups', JSON.stringify(autoAddToggle.checked));
    });
  }
  document.getElementById('btn-group-tabs-now')?.addEventListener('click', () => {
    TabGrouper?.analyzeAndPropose();
  });
  document.getElementById('btn-clear-patterns')?.addEventListener('click', () => {
    if (!confirm('Clear all remembered group patterns? New tabs won\u2019t auto-join groups anymore.')) return;
    TabGrouper?.clearPatterns();
    showToast('Patterns cleared', 'success');
    updateGroupPatternsCount();
  });
  function updateGroupPatternsCount() {
    const el = document.getElementById('group-patterns-count');
    if (!el || !window.TabGrouper) return;
    const n = Object.keys(TabGrouper.getPatterns()).length;
    el.textContent = n === 0 ? '\ud83d\udcca No patterns yet' : `\ud83d\udcca ${n} pattern${n === 1 ? '' : 's'} active`;
  }
  updateGroupPatternsCount();
  setInterval(updateGroupPatternsCount, 5000);

  // === Startup behavior setting ===
  const restoreSelect = document.getElementById('setting-restore-startup');
  if (restoreSelect) {
    restoreSelect.value = settings.restoreOnStartup || 'ask';
    restoreSelect.addEventListener('change', () => {
      settings.restoreOnStartup = restoreSelect.value;
      VexStorage.saveSettings(settings);
    });
  }

  // === Auto-sleep settings ===
  const autosleepToggle = document.getElementById('setting-autosleep');
  const autosleepMinutes = document.getElementById('setting-autosleep-minutes');
  const autosleepExcludePinned = document.getElementById('setting-autosleep-exclude-pinned');
  if (autosleepToggle) {
    autosleepToggle.checked = settings.autoSleepEnabled || false;
    if (autosleepMinutes) autosleepMinutes.value = String(settings.autoSleepMinutes || 30);
    if (autosleepExcludePinned) autosleepExcludePinned.checked = settings.autoSleepExcludePinned !== false;

    const applyAutoSleep = () => {
      settings.autoSleepEnabled = autosleepToggle.checked;
      settings.autoSleepMinutes = parseInt(autosleepMinutes?.value || '30');
      settings.autoSleepExcludePinned = autosleepExcludePinned?.checked !== false;
      VexStorage.saveSettings(settings);
      if (settings.autoSleepEnabled) {
        TabManager.startAutoSleep(settings.autoSleepMinutes, settings.autoSleepExcludePinned);
      } else {
        TabManager.stopAutoSleep();
      }
    };
    autosleepToggle.addEventListener('change', applyAutoSleep);
    autosleepMinutes?.addEventListener('change', applyAutoSleep);
    autosleepExcludePinned?.addEventListener('change', applyAutoSleep);

    // Start auto-sleep if enabled
    if (settings.autoSleepEnabled) {
      TabManager.startAutoSleep(settings.autoSleepMinutes || 30, settings.autoSleepExcludePinned !== false);
    }
  }

  // === Split Screen ===
  window.vex.onToggleSplit(() => SplitScreen.toggle());
  window.vex.onTogglePip(() => { if (window.PiPManager) window.PiPManager.toggle(); });

  // === Notes & Sessions shortcuts ===
  window.vex.onToggleNotes?.(() => SidebarManager.togglePanel('notes'));
  window.vex.onToggleSessions?.(() => SessionManager.toggle());

  // === Phase 4 IPC events ===
  window.vex.onReopenLastClosed?.(() => TabManager.reopenLastClosed());
  window.vex.onToggleHistory?.(() => SidebarManager.togglePanel('history'));
  window.vex.onToggleHistoryAi?.(() => HistoryPanel.openInAIMode?.());
  window.vex.onToggleMemory?.(() => SidebarManager.togglePanel('memory'));
  window.vex.onSleepCurrentTab?.(() => {
    const tab = TabManager.getActiveTab();
    if (tab) { TabManager.sleepTab(tab.id); window.showToast?.('Tab sleeping'); }
  });
  window.vex.onSaveSessionBeforeQuit?.(() => RestorePrompt.saveBeforeQuit());

  // === Phase 5 IPC events ===
  window.vex.onToggleReadingMode?.(() => ReadingMode.activate());
  window.vex.onTakeScreenshot?.(() => ScreenshotTool.capture());

  // === Phase 9: Updates + Welcome ===
  UpdateNotifier.init();

  // === Phase 15: Personas ===
  if (typeof PersonasManager !== 'undefined') PersonasManager.init();

  // v1.9.0 cleanup — removed Phase 17A keys
  ['vex.memoryConsented', 'vex.memoryConsentedAt', 'vex.memoryAIEnabled',
   'vex.memoryPauseOnIdle', 'vex.memoryProcessedIds'].forEach(k => {
    try { localStorage.removeItem(k); } catch {}
  });

  // === Phase 17: Ask Vex AI quick prompt (Ctrl+J) ===
  if (typeof AskAIBar !== 'undefined') AskAIBar.init();

  // === Phase 17: Keyboard shortcut registry ===
  if (typeof ShortcutsRegistry !== 'undefined') {
    ShortcutsRegistry.init();
    // Register handlers for every shortcut we can reach from the renderer.
    // Main-process shortcuts in src/main.js keep firing as system-level
    // defaults (they're labelled "system" in the editor).
    ShortcutsRegistry.register('command-bar',    () => CommandBar?.open?.() ?? CommandBar?.toggle?.());
    ShortcutsRegistry.register('ask-ai-bar',     () => AskAIBar?.toggle?.());
    ShortcutsRegistry.register('ai-panel',       () => AIPanel?.toggle?.());
    ShortcutsRegistry.register('history-ai',     () => HistoryPanel?.openInAIMode?.());
    ShortcutsRegistry.register('history-panel',  () => SidebarManager?.togglePanel('history'));
    ShortcutsRegistry.register('memory-panel',   () => SidebarManager?.togglePanel('memory'));
    ShortcutsRegistry.register('schedules',      () => SidebarManager?.openPanel('schedules'));
    ShortcutsRegistry.register('tabs-sidebar',   () => window.toggleTabsSidebar?.());
    ShortcutsRegistry.register('split-screen',   () => SplitScreen?.toggle?.());
    ShortcutsRegistry.register('pip',            () => PiPManager?.toggle?.());
    ShortcutsRegistry.register('reading-mode',   () => ReadingMode?.activate?.());
    ShortcutsRegistry.register('screenshot',     () => ScreenshotTool?.capture?.());
    ShortcutsRegistry.register('group-tabs',     () => TabGrouper?.analyzeAndPropose?.());
    ShortcutsRegistry.register('mute-tab',       () => TabManager?.toggleMuteTab?.());
    ShortcutsRegistry.register('sleep-tab',      () => { const t = TabManager?.getActiveTab?.(); if (t) TabManager.sleepTab(t.id); });
    ShortcutsRegistry.register('reopen-tab',     () => TabManager?.reopenLastClosed?.());
    ShortcutsRegistry.register('new-tab',        () => TabManager?.createTab?.(typeof START_URL !== 'undefined' ? START_URL : 'vex://start', true));
    ShortcutsRegistry.register('close-tab',      () => { const t = TabManager?.getActiveTab?.(); if (t) TabManager.closeTab(t.id); });
    ShortcutsRegistry.register('reload',         () => WebviewManager?.reload?.());
    ShortcutsRegistry.register('zoom-reset',     () => WebviewManager?.zoomReset?.());
    ShortcutsRegistry.register('private-window', () => window.vex?.openPrivateWindow?.());
    ShortcutsRegistry.register('fullscreen',     () => window.vex?.toggleFullscreen?.());
    ShortcutsRegistry.register('focus-url',      () => document.getElementById('url-bar')?.focus());
    ShortcutsRegistry.register('find-in-page',   () => { const bar = document.getElementById('find-bar'); if (bar) { bar.style.display = 'flex'; document.getElementById('find-input')?.focus(); } });
  }

  // === Phase 16: Tab auto-grouping ===
  if (typeof TabGrouper !== 'undefined') TabGrouper.init();
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.shiftKey && (e.key === 'G' || e.key === 'g')) {
      e.preventDefault();
      TabGrouper?.analyzeAndPropose();
    }
  });

  // === Phase 14: AI Router — detect Ollama, load routing prefs ===
  if (typeof AIRouter !== 'undefined') {
    AIRouter.init().catch(err => console.error('[AIRouter] init failed:', err));
  }
  window.addEventListener('online', () => showToast('Back online', 'success'));
  window.addEventListener('offline', () => {
    if (typeof AIRouter !== 'undefined' && AIRouter.isOllamaAvailable()) {
      showToast('Offline — AI switching to local', 'info');
    } else {
      showToast('Offline — AI unavailable until connection returns', 'warn');
    }
  });

  // === Phase 13: Vex Sync — restore session if present & keep indicator in sync ===
  if (typeof SyncEngine !== 'undefined') {
    SyncEngine.initFromDisk().catch(err => console.error('[Sync] init failed:', err));
    setInterval(() => {
      const indicator = document.getElementById('sync-indicator');
      if (!indicator) return;
      const s = SyncEngine.getState();
      indicator.hidden = !s.enabled;
      indicator.classList.toggle('active', s.enabled && !s.syncing);
      indicator.classList.toggle('syncing', !!s.syncing);
      if (s.enabled) {
        const push = s.lastPushAt ? new Date(s.lastPushAt).toLocaleString() : 'never';
        const pull = s.lastPullAt ? new Date(s.lastPullAt).toLocaleString() : 'never';
        indicator.title = `Vex Sync — pushed ${push} · pulled ${pull}${s.lastError ? ' · error: ' + s.lastError : ''}`;
      }
    }, 1000);
    document.getElementById('sync-indicator')?.addEventListener('click', () => {
      if (typeof SidebarManager !== 'undefined') SidebarManager.openPanel('settings');
      setTimeout(() => {
        document.getElementById('sync-panel-content')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 100);
    });
  }
  // Show version + Electron/Chrome versions in settings
  window.vex.getAppVersion?.().then(v => {
    const el = document.getElementById('settings-version');
    if (el && v) el.textContent = 'Version ' + v;
  });
  const elVer = document.getElementById('about-electron-ver');
  const crVer = document.getElementById('about-chrome-ver');
  const ndVer = document.getElementById('about-node-ver');
  if (elVer) elVer.textContent = window.vex.electronVersion || window.vex.getElectronVersion?.() || '-';
  if (crVer) crVer.textContent = window.vex.chromeVersion || window.vex.getChromeVersion?.() || '-';
  if (ndVer) ndVer.textContent = window.vex.nodeVersion || window.vex.getNodeVersion?.() || '-';
  // Check-updates button
  document.getElementById('btn-check-updates')?.addEventListener('click', async () => {
    const status = document.getElementById('update-check-status');
    if (status) status.textContent = 'Checking...';
    const r = await UpdateNotifier.checkManually();
    localStorage.setItem('vex.lastUpdateCheck', Date.now().toString());
    if (status) status.textContent = (r?.ok && r.info?.version) ? 'Update: v' + r.info.version : 'Up to date \u2014 checked just now';
  });
  // Show last check time
  const lastCheck = localStorage.getItem('vex.lastUpdateCheck');
  if (lastCheck) {
    const el = document.getElementById('update-check-status');
    if (el) el.textContent = 'Last checked: ' + new Date(parseInt(lastCheck)).toLocaleString();
  }
  document.getElementById('setting-releases-link')?.addEventListener('click', (e) => {
    e.preventDefault(); TabManager.createTab('https://github.com/0xmortuex/Vex/releases', true); SidebarManager.hideActivePanel();
  });
  document.getElementById('setting-issues-link')?.addEventListener('click', (e) => {
    e.preventDefault(); TabManager.createTab('https://github.com/0xmortuex/Vex/issues', true); SidebarManager.hideActivePanel();
  });

  // === Default browser: handle incoming URLs from external apps ===
  window.vex.onOpenUrl?.((url) => {
    TabManager.createTab(url, true);
    window.showToast?.('Opened link: ' + url.substring(0, 50));
  });

  // Set as default browser button (in settings)
  document.getElementById('btn-set-default-browser')?.addEventListener('click', async () => {
    const ok = await window.vex.setAsDefaultBrowser?.();
    if (ok) {
      window.showToast?.('Opening Windows Default Apps settings...', 'info');
    } else {
      window.showToast?.('Could not open settings — try Windows Settings manually', 'warn');
    }
  });

  // Check and display current default browser status
  window.vex.isDefaultBrowser?.().then(isDefault => {
    const el = document.getElementById('default-browser-status');
    if (el) {
      el.textContent = isDefault ? 'Vex is your default browser' : 'Vex is not the default browser';
      el.style.color = isDefault ? '#22c55e' : 'var(--text-muted)';
    }
  });

  // === Phase 11: UX polish ===
  // Copy URL button
  document.getElementById('btn-copy-url')?.addEventListener('click', () => {
    const tab = TabManager.getActiveTab();
    if (tab?.url) {
      navigator.clipboard.writeText(tab.url).then(() => window.showToast?.('URL copied'));
    }
  });

  // Middle-click to close tabs
  document.getElementById('tabs-list')?.addEventListener('mousedown', (e) => {
    if (e.button === 1) {
      const item = e.target.closest('.tab-item');
      if (item) { e.preventDefault(); TabManager.closeTab(item.dataset.tabId); }
    }
  });

  // URL bar double-click selects all
  document.getElementById('url-input')?.addEventListener('dblclick', (e) => e.target.select());
  // First-run welcome
  if (!localStorage.getItem('vex.hasRunBefore')) {
    localStorage.setItem('vex.hasRunBefore', 'true');
    const overlay = document.createElement('div');
    overlay.className = 'welcome-overlay';
    overlay.innerHTML = `<div class="welcome-card">
      <div style="margin-bottom:12px"><svg width="60" height="60" viewBox="0 0 256 256"><rect width="256" height="256" rx="48" fill="#12141a"/><path d="M 64 64 L 128 192 L 192 64" stroke="#6366f1" stroke-width="28" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg></div>
      <h1>Welcome to Vex</h1>
      <p class="welcome-subtitle">A browser built just for you.</p>
      <div class="welcome-features">
        <div class="welcome-feature"><span class="feature-icon">&#128450;</span><div><strong>Vertical tabs + workspaces</strong><br><span>Stay organized with CUSA, Dev, School, Personal modes</span></div></div>
        <div class="welcome-feature"><span class="feature-icon">&#10024;</span><div><strong>Built-in AI agent</strong><br><span>Summarize pages, ask questions, automate tasks</span></div></div>
        <div class="welcome-feature"><span class="feature-icon">&#9200;</span><div><strong>Scheduled tasks</strong><br><span>Daily briefings and weekly check-ins</span></div></div>
        <div class="welcome-feature"><span class="feature-icon">&#9889;</span><div><strong>No bloat</strong><br><span>Only the features you actually use</span></div></div>
      </div>
      <div class="welcome-actions">
        <button class="btn-primary" id="welcome-start">Let's Go</button>
      </div>
    </div>`;
    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add('show'));
    document.getElementById('welcome-start')?.addEventListener('click', () => {
      overlay.classList.remove('show');
      setTimeout(() => overlay.remove(), 400);
    });
  }

  // === Phase 8: Scheduler ===
  Scheduler.start();

  // === Phase 10: Multi-Tab AI ===
  TabSelector.init();

  // === Phase 7A: AI Panel ===
  AIPanel.init();
  document.getElementById('btn-ai-summarize')?.addEventListener('click', () => {
    AIPanel.open();
    AIPanel.sendMessage('summarize');
  });

  // AI toggle button in top bar — syncs active state with panel
  // === Tabs sidebar toggle (Ctrl+B) ===
  const tabsToggleBtn = document.getElementById('btn-toggle-tabs');
  function toggleTabsSidebar() {
    document.body.classList.toggle('tabs-hidden');
    tabsToggleBtn?.classList.toggle('active', document.body.classList.contains('tabs-hidden'));
    localStorage.setItem('vex.tabsHidden', document.body.classList.contains('tabs-hidden'));
  }
  if (tabsToggleBtn) tabsToggleBtn.addEventListener('click', toggleTabsSidebar);
  // Restore on load
  if (localStorage.getItem('vex.tabsHidden') === 'true') {
    document.body.classList.add('tabs-hidden');
    tabsToggleBtn?.classList.add('active');
  }
  // Make toggleTabsSidebar available for command bar
  window.toggleTabsSidebar = toggleTabsSidebar;

  const aiToggleBtn = document.getElementById('btn-toggle-ai');
  if (aiToggleBtn) {
    aiToggleBtn.addEventListener('click', () => AIPanel.toggle());
    const aiPanel = document.getElementById('ai-panel');
    if (aiPanel) {
      new MutationObserver(() => {
        aiToggleBtn.classList.toggle('active', aiPanel.classList.contains('open'));
      }).observe(aiPanel, { attributes: true, attributeFilter: ['class'] });
    }
  }

  // === Phase 6: Fullscreen ===
  window.vex.onFullscreenChanged?.((isFs) => {
    document.body.classList.toggle('fullscreen', isFs);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && document.body.classList.contains('fullscreen')) {
      window.vex.toggleFullscreen?.();
    }
  });

  // === Phase 6: Mute ===
  window.vex.onToggleMuteTab?.(() => TabManager.toggleMuteTab());

  // === Tabs sidebar shortcut ===
  window.vex.onToggleTabsSidebar?.(() => window.toggleTabsSidebar?.());
  window.vex.onToggleSchedules?.(() => SidebarManager.togglePanel('schedules'));

  // === Phase 7A: AI shortcut ===
  window.vex.onToggleAiPanel?.(() => AIPanel.toggle());

  // === Private mode detection ===
  if (window.location.search.includes('private=true')) {
    document.body.classList.add('private-mode');
  }

  // Translate bar
  document.getElementById('translate-go')?.addEventListener('click', () => {
    const lang = document.getElementById('translate-lang')?.value || 'en';
    Translator.translate(lang);
    document.getElementById('translate-bar')?.classList.remove('visible');
  });
  document.getElementById('translate-close')?.addEventListener('click', () => {
    document.getElementById('translate-bar')?.classList.remove('visible');
  });

  // Save workspace state before window closes
  window.addEventListener('beforeunload', () => {
    WorkspaceManager.saveCurrentState();
    RestorePrompt.saveBeforeQuit();
  });

  const splitCloseRight = document.getElementById('split-close-right');
  if (splitCloseRight) {
    splitCloseRight.addEventListener('click', () => SplitScreen.deactivate());
  }

  // === Download Notifications ===
  window.vex.onDownloadStarted((event, data) => {
    showToast(`Downloading: ${data.fileName}`);
  });

  window.vex.onDownloadComplete((event, data) => {
    if (data.state === 'completed') {
      showToast(`Downloaded: ${data.fileName}`);
    } else {
      showToast(`Download failed: ${data.fileName}`);
    }
  });

  function showToast(message, type, duration) {
    type = type || 'info';
    duration = duration || 3000;
    let container = document.getElementById('toast-container');
    if (!container) {
      container = document.createElement('div');
      container.id = 'toast-container';
      document.body.appendChild(container);
    }
    const el = document.createElement('div');
    el.className = 'toast-item ' + type;
    el.textContent = message;
    container.appendChild(el);
    requestAnimationFrame(() => el.classList.add('show'));
    setTimeout(() => {
      el.classList.remove('show');
      setTimeout(() => el.remove(), 300);
    }, duration);
  }

  window.showToast = showToast;
})();

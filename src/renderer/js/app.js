// === Vex App — Main Entry Point ===

(async function () {
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
  // Show version in settings
  window.vex.getAppVersion?.().then(v => {
    const el = document.getElementById('settings-version');
    if (el && v) el.textContent = 'Version ' + v;
  });
  // Check-updates button
  document.getElementById('btn-check-updates')?.addEventListener('click', async () => {
    const status = document.getElementById('update-check-status');
    if (status) status.textContent = 'Checking...';
    const r = await UpdateNotifier.checkManually();
    if (status) status.textContent = (r?.ok && r.info?.version) ? 'Update: v' + r.info.version : 'Up to date';
  });
  document.getElementById('setting-releases-link')?.addEventListener('click', (e) => {
    e.preventDefault();
    TabManager.createTab('https://github.com/0xmortuex/Vex/releases', true);
    SidebarManager.hideActivePanel();
  });
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

  function showToast(message, duration = 3000) {
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.style.display = 'block';
    setTimeout(() => {
      toast.style.display = 'none';
    }, duration);
  }

  // Make showToast available globally
  window.showToast = showToast;
})();

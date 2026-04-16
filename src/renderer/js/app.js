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
  await TabManager.init();

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
  window.vex.onNewTab(() => TabManager.createTab('vex://start', true));
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

  // === Split Screen ===
  window.vex.onToggleSplit(() => SplitScreen.toggle());
  window.vex.onTogglePip(() => { if (window.PiPManager) window.PiPManager.toggle(); });

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

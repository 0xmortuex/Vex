// === Vex Webview Manager ===
//
// Creates and destroys <webview> elements per tab and wires their per-tab
// events: loading state, title, favicon, URL, navigation, audio, history
// capture, per-domain zoom, force-dark CSS injection, AI history indexing.
// Public API: WebviewManager (singleton). Depends on TabManager, VexStorage,
// HistoryPanel (optional), HistoryIndexer (optional), TabGrouper (optional).

// Strict start-page matcher for the privileged VEX_CMD console channel.
// Deliberately stricter than isStartPage() (which matches ANY url containing
// "start.html", so https://evil.com/start.html would pass): require the
// canonical vex://start origin OR a file: URL whose path ends in
// /renderer/start.html. Mirrors _isVexStartPage in preload-webview.js.
function _isTrustedStartPage(href) {
  if (typeof href !== 'string' || !href) return false;
  let u;
  try { u = new URL(href); } catch { return false; }
  if (u.protocol === 'vex:' && /^start$/i.test(u.host || '')) return true;
  if (u.protocol === 'file:') return /\/renderer\/start\.html$/i.test(u.pathname);
  return false;
}

const WebviewManager = {
  webviews: new Map(),

  createWebview(tab) {
    const container = document.getElementById('webviews-container');
    const webview = document.createElement('webview');
    webview.setAttribute('src', tab.url);
    webview.setAttribute('partition', tab.partition || 'persist:main');
    webview.setAttribute('allowpopups', '');
    // A kept-awake ("never sleep") tab opts out of background throttling so its
    // page keeps running full-speed while it's not the foreground tab — Gmail
    // keeps receiving mail in the background, so the email-code autofill reads a
    // current inbox instead of a frozen one.
    const keptAwake = !!(tab && tab.keepAwakeUntil && Date.now() < tab.keepAwakeUntil);
    webview.setAttribute('webpreferences', 'contextIsolation=yes' + (keptAwake ? ',backgroundThrottling=no' : ''));
    webview.dataset.tabId = tab.id;

    // Events
    webview.addEventListener('did-start-loading', () => {
      TabManager.updateTab(tab.id, { loading: true });
      container.classList.add('wv-loading');
    });

    webview.addEventListener('did-stop-loading', () => {
      TabManager.updateTab(tab.id, { loading: false });
      container.classList.remove('wv-loading');
    });

    webview.addEventListener('did-finish-load', () => {
      TabManager.updateTab(tab.id, { loading: false });
      container.classList.remove('wv-loading');

      // Leak Canary: warn if a saved email of yours is pre-filled on a site that
      // isn't where you saved it (a tracker leak). Best-effort, throttled inside.
      try { window.LeakCanary && window.LeakCanary.check(webview, webview.getURL && webview.getURL()); } catch {}

      // Detect page background color and apply to webview element
      try {
        webview.executeJavaScript(`getComputedStyle(document.body).backgroundColor`)
          .then(bg => { if (bg) webview.style.background = bg; })
          .catch(() => {});
      } catch {}

      // Apply saved zoom for this domain
      try {
        const url = webview.getURL();
        if (url && !url.startsWith('about:') && !url.startsWith('file:')) {
          const host = new URL(url).hostname;
          const zooms = JSON.parse(localStorage.getItem('vex.zooms') || '{}');
          if (zooms[host]) webview.setZoomFactor(zooms[host]);
        }
      } catch {}

      // Force dark mode — now per-site (the legacy 'vex.forceDarkSites'=true flag
      // still forces it everywhere for backward compat). Toggle per site from the
      // page right-click menu; the choice persists in 'vex.forceDarkHosts'.
      try {
        if (this._shouldForceDark(webview.getURL && webview.getURL())) this._applyForceDark(webview);
      } catch {}

      // Phase 12: Queue most-recent history entry for AI indexing
      // (wait 2s so dynamic content settles; the top entry in HistoryPanel.entries
      // is the most recent and typically corresponds to the page that just loaded)
      setTimeout(() => {
        try {
          if (!window.HistoryIndexer || !window.HistoryPanel) return;
          const url = webview.getURL && webview.getURL();
          if (!url) return;
          const entry = HistoryPanel.entries.find(e => e.url === url && !e.indexed);
          if (entry) HistoryIndexer.queueForIndexing(entry, webview);
        } catch (e) { /* best-effort */ }
      }, 2000);

      // Full-text recall: index the page's readable text locally so it can be
      // found later by content (waits for dynamic content to settle).
      setTimeout(() => {
        try {
          if (typeof Recall === 'undefined') return;
          const url = webview.getURL && webview.getURL();
          const t = TabManager.tabs.find(x => x.id === tab.id);
          if (url) Recall.indexPage(webview, url, t && t.title);
        } catch (e) { /* best-effort */ }
      }, 2500);
    });

    webview.addEventListener('page-title-updated', (e) => {
      TabManager.updateTab(tab.id, { title: e.title });
    });

    webview.addEventListener('dom-ready', () => {
      // Per-site Boosts (zapped elements / custom CSS / custom JS)
      try {
        const t = TabManager.tabs.find(x => x.id === tab.id);
        if (typeof VexBoosts !== 'undefined' && t && t.url) VexBoosts.applyTo(webview, t.url);
        if (typeof PasswordVault !== 'undefined' && t && t.url) PasswordVault.autofill(webview, t.url);
        if (typeof TotpAutofill !== 'undefined' && t && t.url) TotpAutofill.autofill(webview, t.url);
        if (typeof EmailCodeAutofill !== 'undefined' && t && t.url) EmailCodeAutofill.tryFill(webview, t.url);
        if (typeof ConsentBlock !== 'undefined') ConsentBlock.applyTo(webview);
        // Copy & right-click unlock (only when the global toggle is on)
        if (typeof CopyUnlock !== 'undefined') CopyUnlock.applyTo(webview);
        // Reading & accessibility pack (dyslexia font / CVD filter / ruler)
        if (typeof AccessibilityPack !== 'undefined') AccessibilityPack.applyTo(webview);
        // Re-apply persistent highlights for this page
        if (typeof Annotations !== 'undefined' && t && t.url) Annotations.applyTo(webview, t.url);
      } catch {}
    });

    // SPA route changes (History pushState) don't fire dom-ready — but a login
    // flow's "enter the code" screen often appears that way. Re-run the code
    // autofills on in-page navigation so they still trigger.
    webview.addEventListener('did-navigate-in-page', () => {
      try {
        const u = webview.getURL();
        if (typeof TotpAutofill !== 'undefined' && u) TotpAutofill.autofill(webview, u);
        if (typeof EmailCodeAutofill !== 'undefined' && u) EmailCodeAutofill.tryFill(webview, u);
      } catch {}
    });

    // Start page loads via file:// (bypassing main's HTML bake), so inject the
    // current GUI Style so the home page matches Classic/Glass.
    webview.addEventListener('dom-ready', () => {
      try {
        if (typeof isStartPage === 'function' && isStartPage(webview.getURL())) {
          const gs = (window.VexGuiStyle && VexGuiStyle.get()) || 'classic';
          webview.executeJavaScript(`document.documentElement.setAttribute('data-gui-style', ${JSON.stringify(gs)})`).catch(() => {});
        }
      } catch {}
    });

    // Keyboard link hints (press `f`): tell the guest whether the feature is on.
    // Default ON; toggle via the `vex.linkHints` setting. Injected each load so a
    // setting change applies on next navigation without restart.
    webview.addEventListener('dom-ready', () => {
      try {
        const on = localStorage.getItem('vex.linkHints') !== 'off';
        webview.executeJavaScript(`window.__vexLinkHintsEnabled = ${on};`).catch(() => {});
      } catch {}
    });

    // Media decode failures announced by preload-webview.js. Always logged
    // (with the page URL, so "video frozen on site X" reports are diagnosable
    // from the host console); the frozen-decode signature additionally gets
    // one toast per session — it's the actionable one (codec/GPU decode bug,
    // like TikTok's HEVC freeze) and a page can't spam it.
    webview.addEventListener('ipc-message', (e) => {
      // PiP video-detection from the guest preload (sent via sendToHost because a
      // guest window.postMessage can't cross to the host). Re-emit as a host
      // window message so PiPManager (app.js) handles it unchanged. Gate on the
      // active tab so a background tab's video doesn't toggle the toolbar button.
      // PiP "Back to tab": the guest left native PiP. Switch Vex to the tab that
      // owns the video and bring the window forward, since Chromium's native
      // "back to tab" can't do that in a webview browser.
      if (e.channel === 'vex-pip-left') {
        try {
          const id = webview.dataset.tabId;
          if (id && typeof TabManager !== 'undefined' && TabManager.switchTab) TabManager.switchTab(id);
          try { window.vex && window.vex.focusWindow && window.vex.focusWindow(); } catch {}
        } catch {}
        return;
      }
      if (e.channel === 'vex-video-detected' || e.channel === 'vex-pip-fallback') {
        try {
          if (typeof WebviewManager !== 'undefined' && WebviewManager.getActiveWebview && WebviewManager.getActiveWebview() !== webview && e.channel === 'vex-video-detected') return;
          window.postMessage(Object.assign({ type: e.channel }, (e.args && e.args[0]) || {}), '*');
        } catch {}
        return;
      }
      if (e.channel !== 'vex-media-error' && e.channel !== 'vex-media-frozen') return;
      const d = (e.args && e.args[0]) || {};
      console.warn(`[MediaHealth] ${e.channel} on ${webview.getURL()}`, d);
      if (e.channel === 'vex-media-frozen' && !window.__vexFrozenMediaToastShown) {
        window.__vexFrozenMediaToastShown = true;
        if (typeof window.showToast === 'function') {
          window.showToast('A video on this page is frozen (decoder failure) — see console for details', 'warning');
        }
      }
    });

    // Password capture (login-form submits announced by preload-webview.js)
    if (typeof PasswordVault !== 'undefined') PasswordVault.attach(webview);
    // Mouse gestures (right-drag strokes announced by preload-webview.js)
    if (typeof MouseGestures !== 'undefined') MouseGestures.attach(webview);
    // Floating Explain/Summarize/Translate bar on text selection
    if (typeof SelectionAIBar !== 'undefined') SelectionAIBar.attach(webview);
    // Apply the saved master-volume level to this page's media (and keep it
    // enforced as media loads). Re-checked per navigation; no-op at 100%.
    webview.addEventListener('dom-ready', () => {
      if (typeof MasterVolume !== 'undefined' && MasterVolume.level() !== 1) MasterVolume.applyToWebview(webview);
    });
    // Now Playing mini-bar (which tab is making noise)
    if (typeof NowPlaying !== 'undefined') NowPlaying.register(webview, tab);
    // Right-click an image → reverse-search it with Google Lens
    webview.addEventListener('context-menu', (e) => {
      const p = e.params || {};
      if (p.mediaType !== 'image' || !p.srcURL || !/^https?:/i.test(p.srcURL)) return;
      document.querySelectorAll('.vex-img-menu').forEach(m => m.remove());
      const menu = document.createElement('div');
      menu.className = 'tab-context-menu vex-img-menu';
      const r = webview.getBoundingClientRect();
      menu.style.left = (r.left + (p.x || 0)) + 'px';
      menu.style.top = (r.top + (p.y || 0)) + 'px';
      const items = [
        { label: '🔎 Zoom image', act: () => { if (typeof ImageZoom !== 'undefined') ImageZoom.open(p.srcURL); } },
        { label: '🔍 Search image with Lens', act: () => TabManager.createTab('https://lens.google.com/uploadbyurl?url=' + encodeURIComponent(p.srcURL), true) },
        { label: 'Copy image address', act: () => { navigator.clipboard?.writeText(p.srcURL); window.showToast?.('Image URL copied'); } },
        { label: 'Open image in new tab', act: () => TabManager.createTab(p.srcURL, true) },
      ];
      items.forEach(it => {
        const el = document.createElement('div');
        el.className = 'tab-context-item';
        el.textContent = it.label;
        // _dismissMenu (not bare menu.remove) so the dismissal overlay is torn
        // down with the menu — otherwise it orphans over the page and eats the
        // next click.
        el.addEventListener('click', () => { it.act(); if (window.Tabs?._dismissMenu) Tabs._dismissMenu(menu); else menu.remove(); });
        menu.appendChild(el);
      });
      document.body.appendChild(menu);
      if (window.Tabs?._clampMenuToViewport) TabManager._clampMenuToViewport(menu, parseInt(menu.style.left), parseInt(menu.style.top));
      if (window.Tabs?._attachMenuDismissal) TabManager._attachMenuDismissal(menu);
    });

    webview.addEventListener('did-navigate', (e) => {
      const url = e.url;
      // Focus-mode site blocker bounces distracting hosts back.
      if (typeof FocusMode !== 'undefined' && FocusMode.guard(webview, url)) return;
      // NEVER let a blank navigation erase the tab's real URL. Tab hibernation,
      // a renderer crash, or the OS suspending/killing the page on sleep can
      // navigate a webview to about:blank — if that overwrote tab.url there'd be
      // nothing to restore, and refresh would just reload about:blank (the exact
      // "tabs stuck on about:blank after wake, won't come back" bug). Keep the
      // last real URL in tab.url; reload()/render-process-gone recover from it.
      //
      // data: URLs get the same treatment. Reading mode loads the article as a
      // data:text/html snapshot; if that overwrote tab.url it'd be persisted and,
      // after a restart (when ReadingMode's in-memory original-URL map is gone),
      // the tab would be permanently stuck on the snapshot. It would also dump a
      // multi-KB data: URL into history. Reading mode is a transient view, not a
      // destination — leave tab.url on the real page and keep it out of history.
      if (/^about:blank\b/i.test(url) || /^data:/i.test(url)) return;
      TabManager.updateTab(tab.id, { url });
      this._updateFavicon(tab.id, url);
      if (typeof VexBoosts !== 'undefined') { try { VexBoosts.applyTo(webview, url); } catch {} }

      // Add to history (both legacy storage and new HistoryPanel) — but never
      // for Off-the-Record tabs (in-memory partition, no trace).
      if (!isStartPage(url) && !/^about:/i.test(url) && !(tab.partition && !tab.partition.startsWith('persist:'))) {
        const t = TabManager.tabs.find(t => t.id === tab.id);
        VexStorage.addHistory({ url, title: t?.title || url });
        if (typeof HistoryPanel !== 'undefined') {
          HistoryPanel.addEntry(url, t?.title || url, t?.favicon);
        }
        // Phase 16 auto-grouping: try to match against remembered patterns.
        // The call internally waits for the title to settle and uses purely
        // local pattern matching (domains + keywords) — no AI round-trip.
        if (typeof TabGrouper !== 'undefined') {
          TabGrouper.maybeAutoAssignToGroup?.(tab.id);
        }
      }
    });

    webview.addEventListener('did-navigate-in-page', (e) => {
      if (e.isMainFrame) {
        TabManager.updateTab(tab.id, { url: e.url });
      }
    });

    // OS sleep/resume (or a plain crash) can kill a webview's renderer process,
    // leaving it blank. Self-heal: reload the tab's real URL so the page comes
    // back on its own — no manual refresh needed. tab.url is preserved above;
    // hibernated tabs also stash the URL in dataset.hibernatedUrl.
    webview.addEventListener('render-process-gone', () => {
      try {
        const t = TabManager.tabs.find(t => t.id === tab.id);
        const real = webview.dataset.hibernatedUrl || (t && t.url);
        if (real && !/^about:blank\b/i.test(real)) {
          setTimeout(() => { try { delete webview.dataset.hibernated; webview.loadURL(real); } catch { try { webview.src = real; } catch {} } }, 400);
        }
      } catch {}
    });

    webview.addEventListener('new-window', (e) => {
      e.preventDefault();
      TabManager.createTab(e.url, true);
    });

    // Audio indicator
    webview.addEventListener('media-started-playing', () => {
      const t = TabManager.tabs.find(t => t.id === tab.id);
      if (t) { t.audible = true; TabManager.renderTabUpdate(t); }
    });
    webview.addEventListener('media-paused', () => {
      const t = TabManager.tabs.find(t => t.id === tab.id);
      if (t) { t.audible = false; TabManager.renderTabUpdate(t); }
    });

    webview.addEventListener('page-favicon-updated', (e) => {
      if (e.favicons && e.favicons.length > 0) {
        TabManager.updateTab(tab.id, { favicon: e.favicons[0] });
      }
    });

    // Listen for VEX_CMD messages from start page and other webview content
    webview.addEventListener('console-message', (e) => {
      if (e.message && e.message.startsWith('VEX_CMD:')) {
        // SECURITY: VEX_CMD is a privileged control channel (navigate the tab,
        // open chrome panels). console-message fires for EVERY guest page, so
        // without this gate any website could emit a `console.log("VEX_CMD:…")`
        // to force navigation (including file://) or open sidebar panels.
        // Only honour it from the trusted Vex start page.
        let emitterUrl = '';
        try { emitterUrl = webview.getURL(); } catch {}
        if (!_isTrustedStartPage(emitterUrl)) return;
        try {
          const cmd = JSON.parse(e.message.slice(8));
          if (cmd.type === 'navigate' && cmd.url) {
            // Navigate THIS webview (the start-page tab that emitted the command)
            // rather than spawning a new tab. Matches Chrome's new-tab page where
            // search submissions and shortcut clicks replace the current tab's
            // content. Callers can opt in to a new tab with { newTab: true }.
            if (cmd.newTab) {
              TabManager.createTab(cmd.url, true);
            } else {
              try { webview.loadURL(cmd.url); } catch { webview.src = cmd.url; }
            }
          } else if (cmd.type === 'open-panel' && cmd.panel) {
            SidebarManager.openPanel(cmd.panel);
          } else if (cmd.type === 'open-theme-picker') {
            if (typeof ThemePicker !== 'undefined') ThemePicker.open();
          } else if (cmd.type === 'exit-reading') {
            if (typeof ReadingMode !== 'undefined') ReadingMode.exitReadingMode(tab.id);
          }
        } catch (err) {
          console.error('VEX_CMD parse error:', err);
        }
      }
    });

    // Context menu — the Electron 'context-menu' event delivers params.x/y
    // already in host-viewport CSS pixels in the current Electron version
    // (empirically verified: a host-document mousedown listener on the same
    // right-click reported clientX/clientY identical to params.x/y). So
    // showContextMenu consumes params.x/y directly — no coordinate
    // translation, no webviewRect offset.
    webview.addEventListener('context-menu', (e) => {
      this.showContextMenu(e, webview);
    });

    webview._lastActive = Date.now();
    container.appendChild(webview);
    this.webviews.set(tab.id, webview);
    this._ensureHibernateSweep();
  },

  showWebview(tabId) {
    this.webviews.forEach((wv, id) => {
      const active = id === tabId;
      wv.classList.toggle('active', active);
      if (active) {
        wv._lastActive = Date.now(); this._wake(wv);
        // Refresh the PiP toolbar button for the newly-active page. The guest
        // only auto-emits video state on a count change (not on tab switch), so
        // hide the button now and ask this guest to re-report.
        try { const b = document.getElementById('pip-btn'); if (b) b.style.display = 'none'; } catch {}
        try { if (typeof wv.send === 'function') wv.send('vex-rescan-video'); } catch {}
      }
    });
    this._ensureHibernateSweep();
  },

  // === Tab hibernation ===
  // Background tabs idle longer than vex.tabHibernateMinutes (default 30; 0/blank
  // disables) are navigated to about:blank to free their page heap/DOM, and
  // reloaded from the remembered URL when next focused. The active tab, audible
  // tabs, pinned tabs, and local/start pages are never suspended.
  _hibernateMinutes() {
    try { const v = parseInt(localStorage.getItem('vex.tabHibernateMinutes'), 10); return Number.isFinite(v) ? v : 30; }
    catch { return 30; }
  },
  _ensureHibernateSweep() {
    if (this._hibTimer) return;
    this._hibTimer = setInterval(() => this._hibernateSweep(), 60 * 1000);
    this._startResumeWatch();
  },
  // System sleep/resume recovery (pure renderer — no IPC). A suspended machine
  // "skips" real time between our ticks; a big skip means the PC was asleep, so
  // on wake we reload any webview the OS blanked while suspended, from its real
  // URL. That's what makes tabs come back on their own after you wake the PC,
  // instead of sitting on about:blank.
  _startResumeWatch() {
    if (this._resumeTimer) return;
    let last = Date.now();
    const PERIOD = 30000;
    this._resumeTimer = setInterval(() => {
      const now = Date.now(), gap = now - last; last = now;
      if (gap > PERIOD + 90000) this._recoverBlankWebviews(); // >~2 min real-time skip ⇒ was asleep
    }, PERIOD);
  },
  _recoverBlankWebviews() {
    this.webviews.forEach((wv, id) => {
      try {
        if (wv.dataset && wv.dataset.hibernated === '1') return; // intentionally hibernated; wakes on focus
        let cur; try { cur = wv.getURL(); } catch { cur = ''; }
        if (cur && !/^about:blank\b/i.test(cur)) return; // still has real content
        const tab = TabManager.tabs.find(t => t.id === id);
        const real = (wv.dataset && wv.dataset.hibernatedUrl) || (tab && tab.url);
        if (real && !/^about:blank\b/i.test(real)) { try { delete wv.dataset.hibernated; wv.loadURL(real); } catch { try { wv.src = real; } catch {} } }
      } catch {}
    });
  },
  _wake(wv) {
    try {
      if (wv.dataset.hibernated !== '1') return;
      const url = wv.dataset.hibernatedUrl;
      delete wv.dataset.hibernated;
      if (url) { try { wv.loadURL(url); } catch { wv.src = url; } }
    } catch {}
  },
  _hibernateSweep() {
    try {
      const mins = this._hibernateMinutes();
      if (!mins || mins <= 0) return;
      const cutoff = Date.now() - mins * 60 * 1000;
      this.webviews.forEach((wv, id) => {
        if (id === TabManager.activeTabId) return;
        if (wv.dataset.hibernated === '1') return;
        if ((wv._lastActive || 0) > cutoff) return;
        const tab = TabManager.tabs.find(t => t.id === id);
        // Respect "Prevent from sleeping" — the manual sleepTab() honors it, but
        // this idle-hibernation sweep was ignoring it, so a kept-awake tab still
        // got navigated to about:blank.
        if (!tab || tab.audible || tab.pinned || (TabManager._isKeptAwake && TabManager._isKeptAwake(tab))) return;
        let url; try { url = wv.getURL(); } catch { return; }
        if (!url || /^about:/i.test(url) || url.startsWith('file:') || isStartPage(url)) return;
        wv.dataset.hibernatedUrl = url;
        wv.dataset.hibernated = '1';
        try { wv.loadURL('about:blank'); } catch { wv.src = 'about:blank'; }
      });
    } catch {}
  },

  // === Per-site dark mode ===
  DARK_CSS: 'html{filter:invert(1) hue-rotate(180deg);background:#0a0c10!important}img,video,iframe,[style*="background-image"]{filter:invert(1) hue-rotate(180deg)}',
  _forceDarkHosts() {
    try { return new Set(JSON.parse(localStorage.getItem('vex.forceDarkHosts') || '[]')); } catch { return new Set(); }
  },
  _hostOf(url) { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; } },
  _shouldForceDark(url) {
    try {
      if (localStorage.getItem('vex.forceDarkSites') === 'true') return true; // legacy global
      const host = this._hostOf(url);
      return !!host && this._forceDarkHosts().has(host);
    } catch { return false; }
  },
  _applyForceDark(wv) {
    try {
      if (wv._forceDarkKey || typeof wv.insertCSS !== 'function') return;
      const p = wv.insertCSS(this.DARK_CSS);
      if (p && typeof p.then === 'function') p.then(key => { wv._forceDarkKey = key; }).catch(() => {});
    } catch {}
  },
  _removeForceDark(wv) {
    try {
      if (wv._forceDarkKey && typeof wv.removeInsertedCSS === 'function') wv.removeInsertedCSS(wv._forceDarkKey).catch(() => {});
    } catch {}
    wv._forceDarkKey = null;
  },
  toggleForceDarkForSite(webview) {
    try {
      const host = this._hostOf(webview.getURL());
      if (!host) return;
      const hosts = this._forceDarkHosts();
      if (hosts.has(host)) { hosts.delete(host); this._removeForceDark(webview); window.showToast?.(`Dark mode off — ${host}`); }
      else { hosts.add(host); this._applyForceDark(webview); window.showToast?.(`Dark mode on — ${host}`); }
      localStorage.setItem('vex.forceDarkHosts', JSON.stringify([...hosts]));
    } catch {}
  },
  resetSite(webview) {
    try {
      const host = this._hostOf(webview.getURL());
      if (!host) return;
      const zooms = JSON.parse(localStorage.getItem('vex.zooms') || '{}'); delete zooms[host];
      localStorage.setItem('vex.zooms', JSON.stringify(zooms));
      try { webview.setZoomFactor(1); } catch {}
      const hosts = this._forceDarkHosts(); hosts.delete(host);
      localStorage.setItem('vex.forceDarkHosts', JSON.stringify([...hosts]));
      this._removeForceDark(webview);
      window.showToast?.(`Reset site settings — ${host}`);
    } catch {}
  },

  destroyWebview(tabId) {
    const wv = this.webviews.get(tabId);
    if (wv) {
      wv.remove();
      this.webviews.delete(tabId);
    }
  },

  getActiveWebview() {
    return this.webviews.get(TabManager.activeTabId);
  },

  navigate(url) {
    const wv = this.getActiveWebview();
    if (wv) {
      // Electron webview DOM element uses .src or .loadURL()
      // .loadURL() is the correct webview API method, but .src works as fallback
      if (typeof wv.loadURL === 'function') {
        // A navigation superseded by another rejects with ERR_ABORTED (-3);
        // that's expected (and the webview shows its own error UI for real
        // failures), so ignore the abort instead of leaking an uncaught rejection.
        wv.loadURL(url).catch(err => {
          const m = String((err && err.message) || err);
          if (!/ERR_ABORTED|\(-3\)/.test(m)) console.warn('[Vex] navigate failed:', m);
        });
      } else {
        wv.src = url;
      }
    }
  },

  goBack() {
    const wv = this.getActiveWebview();
    if (wv && wv.canGoBack()) wv.goBack();
  },

  goForward() {
    const wv = this.getActiveWebview();
    if (wv && wv.canGoForward()) wv.goForward();
  },

  // If the active webview is blank (hibernated / crashed / OS-sleep-killed) but
  // its tab still knows the real URL, return that URL so callers reload the page
  // instead of about:blank. Returns null when a plain reload is correct.
  _blankRecoveryUrl(wv) {
    let cur; try { cur = wv.getURL(); } catch { cur = ''; }
    if (cur && !/^about:blank\b/i.test(cur)) return null;
    const tab = TabManager.tabs.find(t => t.id === TabManager.activeTabId);
    const real = (wv.dataset && wv.dataset.hibernatedUrl) || (tab && tab.url);
    return (real && !/^about:blank\b/i.test(real)) ? real : null;
  },
  reload() {
    const wv = this.getActiveWebview();
    if (!wv) return;
    // A plain wv.reload() on a blanked tab just reloads about:blank, so the page
    // never comes back. Restore the real URL instead — this is the fix for
    // "tabs stuck on about:blank after wake, won't come back even on refresh".
    const real = this._blankRecoveryUrl(wv);
    if (real) { try { if (wv.dataset) delete wv.dataset.hibernated; wv.loadURL(real); } catch { try { wv.src = real; } catch {} } return; }
    wv.reload();
  },

  // Hard reload: clear the webview's HTTP cache in the main process, then
  // reloadIgnoringCache. Falls back to the renderer-side reloadIgnoringCache /
  // reload if the IPC bridge is unavailable (dev-reload edge cases).
  hardReload() {
    console.log('[Vex] hard reload triggered — renderer callback');
    const wv = this.getActiveWebview();
    if (!wv) return;
    // Blanked tab (hibernated/crashed/OS-sleep) → restore its real URL rather
    // than hard-reloading about:blank.
    const _real = this._blankRecoveryUrl(wv);
    if (_real) { try { if (wv.dataset) delete wv.dataset.hibernated; wv.loadURL(_real); } catch { try { wv.src = _real; } catch {} } return; }
    try {
      const id = typeof wv.getWebContentsId === 'function' ? wv.getWebContentsId() : null;
      if (id != null && window.vex?.hardReloadWebview) {
        window.vex.hardReloadWebview(id).then(res => {
          if (!res?.ok) {
            console.warn('[Vex] hard-reload IPC failed:', res?.error);
            if (typeof wv.reloadIgnoringCache === 'function') wv.reloadIgnoringCache();
            else wv.reload();
          }
        }).catch(err => {
          console.error('[Vex] hard-reload failed:', err);
          if (typeof wv.reloadIgnoringCache === 'function') wv.reloadIgnoringCache();
          else wv.reload();
        });
        window.showToast?.('Hard reload — clearing cache');
        return;
      }
    } catch (err) {
      console.error('[Vex] hard-reload error:', err);
    }
    if (typeof wv.reloadIgnoringCache === 'function') wv.reloadIgnoringCache();
    else wv.reload();
  },

  zoomIn() {
    const wv = this.getActiveWebview();
    if (wv) {
      const cur = wv.getZoomFactor ? wv.getZoomFactor() : 1;
      const next = Math.min(cur + 0.1, 5);
      wv.setZoomFactor(next);
      this._saveZoom(wv, next);
    }
  },

  zoomOut() {
    const wv = this.getActiveWebview();
    if (wv) {
      const cur = wv.getZoomFactor ? wv.getZoomFactor() : 1;
      const next = Math.max(cur - 0.1, 0.25);
      wv.setZoomFactor(next);
      this._saveZoom(wv, next);
    }
  },

  zoomReset() {
    const wv = this.getActiveWebview();
    if (wv) {
      wv.setZoomFactor(1);
      this._saveZoom(wv, 1);
    }
  },

  _saveZoom(wv, zoom) {
    try {
      const url = wv.getURL();
      if (!url || url.startsWith('about:') || url.startsWith('file:')) return;
      const host = new URL(url).hostname;
      const zooms = JSON.parse(localStorage.getItem('vex.zooms') || '{}');
      if (zoom === 1) { delete zooms[host]; } else { zooms[host] = zoom; }
      localStorage.setItem('vex.zooms', JSON.stringify(zooms));
    } catch {}
  },

  findInPage(text) {
    const wv = this.getActiveWebview();
    if (wv && text) {
      wv.findInPage(text);
    }
  },

  stopFindInPage() {
    const wv = this.getActiveWebview();
    if (wv) wv.stopFindInPage('clearSelection');
  },

  showContextMenu(e, webview) {
    // Clear any prior menu AND its dismissal overlay. Removing only the menu
    // (the old behaviour) leaked a stack of transparent .context-menu-overlay
    // divs across repeated right-clicks.
    document.querySelectorAll('.tab-context-menu, .context-menu-overlay').forEach(m => m.remove());

    const curUrl = (() => { try { return webview.getURL(); } catch { return ''; } })();

    const menu = document.createElement('div');
    menu.className = 'tab-context-menu';
    // params.x/y from the Electron 'context-menu' event are already in
    // host-viewport CSS pixels in the current Electron version — the menu is
    // position:fixed, so they are consumed directly. Adding webviewRect.left/
    // top here used to double-count the icon-rail width + top-bar height,
    // shifting the menu down-right of the cursor by a constant offset.
    const mx = e.params.x || 0;
    const my = e.params.y || 0;
    menu.style.left = mx + 'px';
    menu.style.top  = my + 'px';

    // Spellcheck — when the right-click landed on a misspelled word Chromium
    // populates e.params.misspelledWord and e.params.dictionarySuggestions.
    // Surface them at the TOP of the menu; clicking one swaps the word in
    // place via the <webview> tag's replaceMisspelling(). If the word was
    // flagged but Chromium offered nothing, show a disabled "No suggestions"
    // row so the user knows spellcheck DID see the word.
    const spellingItems = [];
    if (e.params.misspelledWord) {
      const suggestions = Array.isArray(e.params.dictionarySuggestions)
        ? e.params.dictionarySuggestions
        : [];
      if (suggestions.length > 0) {
        for (const suggestion of suggestions) {
          spellingItems.push({
            label: suggestion,
            action: () => {
              // Replace the misspelled word with the suggestion in two steps:
              // (1) select the word in the guest, then (2) TYPE the replacement
              // as trusted input via webview.sendInputEvent. execCommand and
              // webContents.replaceMisspelling both change the DOM but do NOT
              // update Slate.js's model (Discord), so the fix reverted on the
              // next keystroke — trusted input is the only thing that sticks.
              // See the inline notes on each step below (verified live 2026-08-27).
              if (typeof webview.executeJavaScript !== 'function') {
                console.warn('[Vex spell] webview.executeJavaScript unavailable');
                return;
              }
              try { if (typeof webview.focus === 'function') webview.focus(); } catch {}
              const word = e.params.misspelledWord || '';
              // Step 1 (in the GUEST): focus the editable and select the
              // misspelled word. Chromium selects it on right-click but drops
              // that selection when Vex's custom menu takes focus, so re-select.
              const selectJs = `(function(){try{
                var word=${JSON.stringify(word)};
                var sel=window.getSelection();
                var anchor=sel&&sel.anchorNode;
                var host=anchor?(anchor.nodeType===1?anchor:anchor.parentElement):null;
                while(host&&!(host.isContentEditable||host.tagName==='INPUT'||host.tagName==='TEXTAREA'))host=host.parentElement;
                if(!host)host=document.activeElement;
                if(host&&host.focus)host.focus();
                var curSel=window.getSelection();
                if(word&&(!curSel||curSel.toString()!==word)){
                  if(host&&(host.tagName==='INPUT'||host.tagName==='TEXTAREA')){
                    var v=host.value||'',p=host.selectionStart||0,i=v.lastIndexOf(word,p);if(i<0)i=v.indexOf(word);
                    if(i>=0)host.setSelectionRange(i,i+word.length);
                  } else if(host){
                    var wk=document.createTreeWalker(host,NodeFilter.SHOW_TEXT),tn;
                    while((tn=wk.nextNode())){var k=tn.data.indexOf(word);if(k>=0){var rg=document.createRange();rg.setStart(tn,k);rg.setEnd(tn,k+word.length);curSel.removeAllRanges();curSel.addRange(rg);break;}}
                  }
                }
                // Report selection success. <input>/<textarea> selections are NOT
                // reflected by window.getSelection(), so check them via value+range.
                if(host&&(host.tagName==='INPUT'||host.tagName==='TEXTAREA')){
                  try{return host.value.substring(host.selectionStart,host.selectionEnd)===word;}catch(_){return true;}
                }
                var s2=window.getSelection();
                return !!(s2&&s2.toString()===word);
              }catch(e){return false;}})();`;
              const repl = String(suggestion);
              // Step 2: type the replacement as TRUSTED char input via
              // webview.sendInputEvent. This is the crux — verified live against
              // Discord's Slate.js composer (2026-08-27): execCommand('insertText')
              // and webContents.replaceMisspelling both change the DOM but never
              // update Slate's internal model, so the next keystroke reconciles
              // back to the misspelled word (or corrupts it). Only trusted input
              // goes through Slate's model and sticks. The first char replaces the
              // selected word; the rest insert after it. ~25 ms/char lets Slate
              // process each. Non-Slate editors work with this too; the
              // execCommand fallback is only for platforms without sendInputEvent.
              const typeTrusted = () => {
                if (typeof webview.sendInputEvent !== 'function') {
                  try { webview.executeJavaScript(`try{document.execCommand('insertText',false,${JSON.stringify(repl)})}catch(_){}`); } catch {}
                  return;
                }
                let i = 0;
                const sendNext = () => {
                  if (i >= repl.length) return;
                  try { webview.sendInputEvent({ type: 'char', keyCode: repl[i] }); }
                  catch (err) { console.warn('[Vex spell] sendInputEvent failed:', err); }
                  i++;
                  setTimeout(sendNext, 25);
                };
                sendNext();
              };
              try {
                const r = webview.executeJavaScript(selectJs);
                if (r && typeof r.then === 'function') {
                  r.then((ok) => {
                    if (!ok) console.warn('[Vex spell] word not re-selected; typing anyway');
                    setTimeout(typeTrusted, 180);
                  }).catch((err) => { console.warn('[Vex spell] select failed:', err); setTimeout(typeTrusted, 180); });
                } else {
                  setTimeout(typeTrusted, 180);
                }
              } catch (err) {
                console.error('[Vex spell] replace error:', err);
              }
            }
          });
        }
      } else {
        spellingItems.push({ label: 'No suggestions', disabled: true });
      }
      spellingItems.push({ sep: true });
    }

    // Standard edit commands for editable contexts (message composers, inputs)
    // — what a normal browser menu offers there. Sites with fully custom menus
    // never reach here (they preventDefault), so this only shows where the
    // native menu would have. editFlags comes from Chromium and reflects the
    // current selection/clipboard state.
    const editItems = [];
    if (e.params.isEditable) {
      const f = e.params.editFlags || {};
      editItems.push({ label: 'Cut', action: () => webview.cut?.(), disabled: f.canCut === false });
      editItems.push({ label: 'Copy', action: () => webview.copy?.(), disabled: f.canCopy === false });
      editItems.push({ label: 'Paste', action: () => webview.paste?.(), disabled: f.canPaste === false });
      editItems.push({ label: 'Select All', action: () => webview.selectAll?.() });
      editItems.push({ sep: true });
    }

    const items = [
      ...spellingItems,
      ...editItems,
      { label: 'Back', action: () => webview.goBack(), disabled: !webview.canGoBack() },
      { label: 'Forward', action: () => webview.goForward(), disabled: !webview.canGoForward() },
      { label: 'Reload', action: () => webview.reload() },
      { sep: true },
      { label: 'Copy Page URL', action: () => navigator.clipboard.writeText(webview.getURL()) },
      { label: '\u{1F4DD} Copy as Markdown link', action: () => { try { const t = TabManager.getActiveTab(); const u = webview.getURL(); const title = (t && t.title) || u; navigator.clipboard.writeText(`[${String(title).replace(/[\[\]]/g, '')}](${u})`); window.showToast?.('Copied as Markdown'); } catch {} } },
      { label: 'Open in New Tab', action: () => TabManager.createTab(webview.getURL()) },
      { label: '\u{1FA9F} Open as App', action: () => { try { window.vex.openAsApp(webview.getURL(), (TabManager.getActiveTab() || {}).title); } catch {} } },
      { label: '⧉ Duplicate Tab', action: () => { try { const t = TabManager.getActiveTab(); if (t && t.url) TabManager.createTab(t.url, true); } catch {} } },
      { label: '\u{1F4F1} Send to Phone', action: () => { try { if (window.SendToPhone) SendToPhone.open(webview.getURL()); } catch {} } },
      { label: (typeof AutoReload !== 'undefined' && AutoReload.isOn(webview.dataset.tabId)) ? '⟳ Auto-refresh: on…' : '⟳ Auto-refresh…', action: () => { try { if (window.AutoReload) AutoReload.open(webview.dataset.tabId); } catch {} } },
      { sep: true },
      // Per-site controls (dark mode + reset). Zoom already has keyboard shortcuts;
      // "Reset this site" clears this host's saved zoom and dark-mode override.
      { label: this._shouldForceDark(curUrl) ? '\u{1F319} Dark mode: on for this site' : '\u{1F319} Dark mode for this site',
        action: () => this.toggleForceDarkForSite(webview) },
      { label: '\u{1F3AF} Zap element (hide it forever)', action: () => { try { if (typeof VexBoosts !== 'undefined') VexBoosts.startZapper(); } catch {} } },
      { label: 'Reset this site’s settings', action: () => this.resetSite(webview) }
    ];

    // Right-clicking an input (e.g. the verification-code box): offer to fill the
    // code from Gmail on demand, in case the automatic pass didn't catch it.
    if (e.params.isEditable && typeof EmailCodeAutofill !== 'undefined') {
      items.push({ sep: true });
      items.push({
        label: '\u{1F4E7} Fill code from email',
        action: () => { try { EmailCodeAutofill.tryFill(webview, webview.getURL()); window.showToast?.('📧 Looking for your code…'); } catch {} }
      });
    }

    if (e.params.selectionText) {
      items.push({ sep: true });
      items.push({
        label: `Search "${e.params.selectionText.substring(0, 20)}..."`,
        action: () => {
          const q = encodeURIComponent(e.params.selectionText);
          TabManager.createTab(`https://www.google.com/search?q=${q}`, true);
        }
      });
      // Editable contexts already got a Copy row in editItems above.
      if (!e.params.isEditable) {
        items.push({
          label: 'Copy',
          action: () => webview.copy()
        });
      }
      if (typeof Annotations !== 'undefined') {
        items.push({
          label: '🖍 Highlight',
          action: () => Annotations.highlight('yellow')
        });
      }
      // AI options for selected text
      if (typeof AIPanel !== 'undefined') {
        const sel = e.params.selectionText;
        items.push({ sep: true });
        items.push({
          label: `\u2728 Explain "${sel.substring(0, 25)}${sel.length > 25 ? '...' : ''}"`,
          action: () => { AIPanel.open(); AIPanel.sendMessage('explain', { selectedText: sel }); }
        });
        items.push({
          label: '\u{1F4DD} Summarize selection',
          // Route via chat (free-form reply) \u2014 the 'summarize' feature renders
          // only a structured {summary} card and comes back blank for a snippet.
          action: () => { AIPanel.open(); AIPanel.sendMessage('chat', { message: `Summarize the following text clearly and concisely:\n\n"""${sel}"""` }); }
        });
        items.push({
          label: '\u{1F310} Translate selection',
          action: () => { AIPanel.open(); AIPanel.sendMessage('translate', { selectedText: sel, targetLanguage: 'English' }); }
        });
      }
      items.push({
        label: '\u{1F50A} Read aloud',
        action: () => { try { window.speechSynthesis.cancel(); window.speechSynthesis.speak(new SpeechSynthesisUtterance(e.params.selectionText)); } catch {} }
      });
    }

    if (e.params.linkURL) {
      items.push({ sep: true });
      items.push({
        label: 'Open Link in New Tab',
        action: () => TabManager.createTab(e.params.linkURL, true)
      });
      items.push({
        label: 'Copy Link',
        action: () => navigator.clipboard.writeText(e.params.linkURL)
      });
      items.push({
        label: '\u{1F4F1} Send Link to Phone',
        action: () => { try { if (window.SendToPhone) SendToPhone.open(e.params.linkURL); } catch {} }
      });
      items.push({
        label: '\u{1F4DD} Copy Link as Markdown',
        action: () => { try { const txt = (e.params.linkText || e.params.selectionText || e.params.linkURL || '').replace(/[\[\]]/g, '').trim() || e.params.linkURL; navigator.clipboard.writeText(`[${txt}](${e.params.linkURL})`); window.showToast?.('Copied as Markdown'); } catch {} }
      });
      if (typeof ReadLater !== 'undefined' && /^https?:/i.test(e.params.linkURL)) {
        items.push({
          label: '\u{1F4DA} Read Later',
          action: () => { try { ReadLater.add(e.params.linkURL); window.showToast?.('Saved to Library'); } catch {} }
        });
      }
      if (typeof LinkRot !== 'undefined' && /^https?:/i.test(e.params.linkURL)) {
        items.push({
          label: '🕰 Open Archived Version',
          action: () => LinkRot.viewArchived(e.params.linkURL)
        });
      }
    }

    // Image-specific options when right-clicking an <img> or background-image
    // element. e.params.mediaType is set by Chromium for image/video/audio;
    // e.params.srcURL is the resource URL.
    if (e.params.mediaType === 'image' && e.params.srcURL) {
      items.push({ sep: true });
      items.push({
        label: 'Open Image in New Tab',
        action: () => TabManager.createTab(e.params.srcURL, true)
      });
      items.push({
        label: 'Copy Image',
        action: () => { try { webview.copyImageAt?.(e.params.x, e.params.y); } catch {} }
      });
      items.push({
        label: 'Copy Image Address',
        action: () => navigator.clipboard.writeText(e.params.srcURL)
      });
      items.push({
        label: 'Save Image As…',
        action: () => {
          // <webview>.downloadURL forwards to the underlying webContents,
          // which goes through Vex's existing will-download wiring (DownloadsPanel).
          try { webview.downloadURL(e.params.srcURL); } catch {}
        }
      });
    }

    // Inspect Element — opens DevTools detached for the right-clicked tab's
    // webContents. Round 5 silently failed because <webview>.getWebContentsId()
    // returns -1 when the guestInstance isn't fully attached yet, and our
    // gate `if (id != null)` let -1 through (only filters null/undefined).
    // Main then called webContents.fromId(-1), got null, returned a resolved
    // failure that the renderer's .catch() never saw — silent dead end.
    //
    // Fix: pass webview.getURL() as the IPC's fallback argument so main can
    // walk getAllWebContents() and find the right guest by URL when the ID
    // lookup fails. Also log the awaited result so future silent failures
    // surface in the host renderer's DevTools console.
    items.push({ sep: true });
    items.push({
      label: 'Inspect Element',
      action: () => {
        const id  = (typeof webview.getWebContentsId === 'function') ? webview.getWebContentsId() : null;
        const url = (typeof webview.getURL === 'function') ? webview.getURL() : null;
        console.log('[Vex Inspect] click — id:', id, 'url:', url);
        if (!window.vexDevTools?.openForWebContents) {
          console.warn('[Vex Inspect] vexDevTools.openForWebContents not available');
          return;
        }
        window.vexDevTools.openForWebContents(id, url).then(result => {
          console.log('[Vex Inspect] IPC result:', result);
          if (!result?.ok) {
            console.warn('[Vex Inspect] DevTools did not open. Error:', result?.error);
          }
        }).catch(err => {
          console.error('[Vex Inspect] IPC threw:', err);
        });
      }
    });

    items.forEach(item => {
      if (item.sep) {
        const sep = document.createElement('div');
        sep.className = 'tab-context-sep';
        menu.appendChild(sep);
      } else {
        const el = document.createElement('div');
        el.className = 'tab-context-item';
        el.textContent = item.label;
        if (item.disabled) {
          el.style.opacity = '0.4';
          el.style.pointerEvents = 'none';
        }
        // Activate on mousedown, not click: this menu is opened from a
        // <webview> guest right-click, so focus sits in the guest. The
        // guest↔host focus churn fires a host-window 'blur' that runs the
        // dismissal close() and removes the menu BETWEEN a left-click's
        // mousedown and mouseup — so the 'click' never materialises. Acting
        // on mousedown wins that race. button 0 only: ignore right/middle so
        // a right-click on a menu item doesn't trigger its action.
        el.addEventListener('mousedown', (e) => {
          if (e.button !== 0) return;
          item.action();
          menu.remove();
        });
        menu.appendChild(el);
      }
    });

    document.body.appendChild(menu);
    // Use the shared dismissal/clamp helpers so this menu closes on
    // outside-click (capture phase, immune to stopPropagation), right-click
    // elsewhere, Escape, and window blur — same as the tab/group menus.
    if (typeof TabManager !== 'undefined') {
      const x = parseInt(menu.style.left, 10) || 0;
      const y = parseInt(menu.style.top,  10) || 0;
      TabManager._clampMenuToViewport?.(menu, x, y);
      TabManager._attachMenuDismissal?.(menu);
    }
  },

  _updateFavicon(tabId, url) {
    try {
      const u = new URL(url);
      if (u.hostname && !isStartPage(url) && /^https?:$/.test(u.protocol)) {
        // Privacy: use the site's OWN first-party /favicon.ico rather than
        // Google's s2 favicon service (which would leak every domain you visit
        // to Google — at odds with Vex's tracker blocker + fingerprint farbling).
        // This is a provisional icon; the real one from the page's <link rel=icon>
        // arrives via the 'page-favicon-updated' event and overwrites it. The tab
        // UI's <img> onerror handles sites with no /favicon.ico.
        TabManager.updateTab(tabId, { favicon: `${u.origin}/favicon.ico` });
      }
    } catch {}
  }
};

// Publish on window too: the top-level `const` is visible to other classic
// scripts through the shared script scope, but it is NOT a window property —
// guards like `window.WebviewManager && ...` (gui-style.js, formerly
// sidebar.js) were always undefined and silently skipped their branch.
if (typeof window !== 'undefined') window.WebviewManager = WebviewManager;

// Renderer-safe export — the renderer loads this file via <script> tag where
// `module` is undefined, so the guard keeps the global WebviewManager surface
// unchanged. Used by tests/renderer/webviewContextMenu.test.js.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { WebviewManager, _isTrustedStartPage };
}

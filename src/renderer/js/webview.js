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
    if (window.VexTabPolicy) tab.partition = window.VexTabPolicy.partitionFor(tab.partition);
    const container = document.getElementById('webviews-container');
    const webview = document.createElement('webview');
    const lifecycle = window.VexLifecycle ? new window.VexLifecycle() : null;
    webview._lifecycle = lifecycle;
    // Register every listener below through the lifecycle so destroyWebview can
    // take them off again. Left attached, each handler closure captures
    // `webview`, and those closures keep the element alive for the life of the
    // window: closing a tab freed nothing, so a long session accumulated one
    // detached webview and ~28 listeners per closed tab.
    const onWebview = lifecycle
      ? (event, handler, options) => lifecycle.listen(webview, event, handler, options)
      : (event, handler, options) => webview.addEventListener(event, handler, options);
    let crashCount = 0, lastCrash = 0, cancelRecovery = null;
    webview._navigationGeneration = 0;
    onWebview('did-attach', () => { webview._attached = true; });
    onWebview('did-start-navigation', event => { if (event.isMainFrame !== false) webview._navigationGeneration++; });
    webview.setAttribute('src', tab.url);
    webview.setAttribute('partition', tab.partition || 'persist:main');
    webview.setAttribute('allowpopups', '');
    // Chromium's PDF viewer is the only plugin Electron has, and it runs only
    // where plugins are on: without this a PDF opened as a blank page
    // (found by a feature sweep, 2026-09-28).
    webview.setAttribute('plugins', '');
    // A kept-awake ("never sleep") tab opts out of background throttling so its
    // page keeps running full-speed while it's not the foreground tab — Gmail
    // keeps receiving mail in the background, so the email-code autofill reads a
    // current inbox instead of a frozen one.
    const keptAwake = !!(tab && tab.keepAwakeUntil && Date.now() < tab.keepAwakeUntil);
    // A site whose JavaScript is switched off (js/site-rules-ui.js): the tab
    // is built without it, because a page cannot be un-run once it has run.
    const noScripts = !!(window.SiteRulesUI && window.SiteRulesUI.scriptsOff(tab.url));
    webview._noScripts = noScripts;
    // A tab built again on leaving such a site names the guest it replaces,
    // and main gives the new one that guest's back list (session-security.js).
    const historyFrom = tab._historyFrom;
    delete tab._historyFrom;
    webview.setAttribute('webpreferences', 'contextIsolation=yes'
      + (keptAwake ? ',backgroundThrottling=no' : '')
      + (noScripts ? ',javascript=no' : '')
      + (Number.isInteger(historyFrom) ? ',vexHistoryFrom=' + historyFrom : ''));
    webview.dataset.tabId = tab.id;
    // Browsing on to such a site from here is held to it by main, on the
    // page's own response (script-src 'none'). The other way round cannot be:
    // a tab built without JavaScript keeps it off for every site after, so
    // leaving for a site that has it is done in a tab built again for that
    // site, which keeps the back list (it lost it until 2026-09-30).
    if (noScripts) {
      const leave = (event) => {
        if (event.isMainFrame === false || event.isInPlace || !/^https?:/i.test(event.url || '')) return;
        if (window.SiteRulesUI.scriptsOff(event.url)) return;
        try { webview.stop(); } catch { /* going anyway */ }
        tab.url = event.url;
        tab._historyFrom = webview.getWebContentsId();
        TabManager.rebuildTab(tab.id);
      };
      onWebview('did-start-navigation', leave);
      onWebview('did-redirect-navigation', leave);
    }

    // Events
    onWebview('did-start-loading', () => {
      TabManager.updateTab(tab.id, { loading: true });
      container.classList.add('wv-loading');
    });

    onWebview('did-stop-loading', () => {
      TabManager.updateTab(tab.id, { loading: false });
      container.classList.remove('wv-loading');
    });

    onWebview('did-finish-load', () => {
      TabManager.updateTab(tab.id, { loading: false });
      container.classList.remove('wv-loading');

      // Leak Canary: warn if a saved email of yours is pre-filled on a site that
      // isn't where you saved it (a tracker leak). Best-effort, throttled inside.
      try { window.LeakCanary && window.LeakCanary.check(webview, webview.getURL && webview.getURL()); } catch {}

      // === "Notifications are blocked" ====================================
      //
      // Electron's permission CHECK handler is a boolean: allowed or not. It
      // has no way to say "nobody has asked yet", so every site that had not
      // been granted notifications read as DENIED — `Notification.permission`
      // returned 'denied' and navigator.permissions agreed.
      //
      // Most sites check that before asking. Finding 'denied' they never ask
      // at all; they just say "Notifications are blocked. Allow them in your
      // browser or system settings, then try again." So Vex's prompt was
      // never reached, and there was no setting anywhere that would have
      // helped — the advice in that sentence was impossible to follow.
      //
      // A site the user really blocked keeps reading 'denied': requesting is
      // refused from the saved decision, so nothing is lost by letting it ask.
      // Async: a page with JavaScript switched off rejects it, which went
      // uncaught into Problems on every load (found 2026-09-29).
      this._letSitesAsk(webview).catch(err => console.warn('[Vex] notification state:', err && err.message));

      // === A base for a page that paints none ==============================
      //
      // Chromium's own viewers paint no background: open a JSON API and the
      // viewer leaves the page transparent and colours its text for the
      // scheme the browser reports — white, in dark mode. With nothing
      // behind it that is white text on Vex's own light surface: the body is
      // there, perfectly selectable, and completely invisible. The same URL
      // in Chrome reads fine. It hits every page that paints nothing — a
      // JSON response, a plain .txt, a directory listing.
      //
      // Only such a page is given anything. A background on <html> stops the
      // body's background propagating to the canvas, so a site that styles
      // only its body would get our colour showing through its margins —
      // which is why this is decided per page rather than applied to all of
      // them, and why `:where()` (zero specificity) is used even then.
      //
      // A page with JavaScript switched off refuses the question, and said so
      // in the console on every load (found 2026-09-30).
      if (!this.scriptsOffIn(webview)) try {
        webview.executeJavaScript(`(() => {
          const solid = (c) => {
            const flat = String(c || '').split(' ').join('');
            return (flat && flat !== 'transparent' && flat !== 'rgba(0,0,0,0)') ? c : '';
          };
          // A page that has not built a body yet is exactly the kind this is
          // for: asking for its background threw, the whole thing was
          // swallowed by a silent catch, and nothing was painted.
          const el = document.body || document.documentElement;
          return {
            body: el ? solid(getComputedStyle(el).backgroundColor) : '',
            html: document.documentElement ? solid(getComputedStyle(document.documentElement).backgroundColor) : '',
            dark: matchMedia('(prefers-color-scheme: dark)').matches,
          };
        })()`)
          .then(seen => {
            const want = this.baseColourFor(seen);
            if (!want) return;
            // The element behind the page, so there is no flash of the wrong
            // colour while it loads.
            webview.style.background = want.element;
            if (!want.inject) return;
            webview.insertCSS(want.inject)
              .catch(err => console.warn('[Vex] could not give the page a base colour:', err && err.message));
          })
          .catch(err => console.warn('[Vex] could not read the page background:', err && err.message));
      } catch (err) { console.warn('[Vex] page background check failed:', err && err.message); }

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

    onWebview('page-title-updated', (e) => {
      TabManager.updateTab(tab.id, { title: e.title });
      // The visit is recorded the moment the page starts loading, when its
      // title is still "Loading…" or the bare URL. Without this every history
      // entry keeps that placeholder.
      const current = TabManager.tabs.find(x => x.id === tab.id);
      if (current && current.url && typeof HistoryPanel !== 'undefined') HistoryPanel.updateTitle(current.url, e.title);
    });

    onWebview('dom-ready', () => {
      // Per-site Boosts (zapped elements / custom CSS / custom JS)
      try {
        const t = TabManager.tabs.find(x => x.id === tab.id);
        if (typeof VexBoosts !== 'undefined' && t && t.url) VexBoosts.applyTo(webview, t.url);
        if (typeof PasswordVault !== 'undefined' && t && t.url) PasswordVault.autofill(webview, t.url);
        if (typeof TotpAutofill !== 'undefined' && t && t.url) TotpAutofill.autofill(webview, t.url);
        if (typeof EmailCodeAutofill !== 'undefined' && t && t.url) EmailCodeAutofill.tryFill(webview, t.url);
        if (typeof ConsentBlock !== 'undefined') ConsentBlock.applyTo(webview);
        // Which speakers this site plays through (js/audio-output.js).
        if (typeof AudioOutput !== 'undefined' && t && t.url) AudioOutput.apply(webview, t.url);
        // …and how fast its videos play (js/page-tools.js).
        if (typeof PageTools !== 'undefined' && t && t.url) PageTools.applySpeed(webview, t.url);
        // The page has settled: skim its words so Ctrl+K can find this tab by
        // what is ON it, not only by its title (js/tab-content-index.js).
        document.dispatchEvent(new CustomEvent('vex:tab-settled', { detail: { tabId: tab.id } }));
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
    onWebview('did-navigate-in-page', () => {
      try {
        const u = webview.getURL();
        if (typeof TotpAutofill !== 'undefined' && u) TotpAutofill.autofill(webview, u);
        if (typeof EmailCodeAutofill !== 'undefined' && u) EmailCodeAutofill.tryFill(webview, u);
      } catch {}
    });

    // Start page loads via file:// (bypassing main's HTML bake), so inject the
    // current GUI Style so the home page matches Classic/Glass.
    onWebview('dom-ready', () => {
      try {
        if (typeof isStartPage === 'function' && isStartPage(webview.getURL())) {
          const gs = (window.VexGuiStyle && VexGuiStyle.get()) || 'classic';
          webview.executeJavaScript(`document.documentElement.setAttribute('data-gui-style', ${JSON.stringify(gs)})`).catch(() => {});
          // The Today block on the new tab page (js/today.js): the start page
          // runs in its own session and cannot read this renderer's storage,
          // so the snapshot is handed to it here, the same way the theme is.
          try { if (window.VexToday) VexToday.push(webview); } catch (err) { console.error('[Today] push failed:', err); }
          // A browser look in its own colours hands the page its palette.
          window.VexGuiStyle?.paintStartPage(webview).catch(err => console.error('[gui-style] start page palette failed:', err));
          // And the font Vex is wearing (js/fonts.js), for the same reason.
          try { window.VexFonts?.paintStartPages(); } catch (err) { console.error('[fonts] start page failed:', err); }
        }
      } catch {}
    });

    // Keyboard link hints (press `f`): tell the guest whether the feature is on.
    // Default ON; toggle via the `vex.linkHints` setting. Injected each load so a
    // setting change applies on next navigation without restart.
    onWebview('dom-ready', () => {
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
    onWebview('ipc-message', (e) => {
      if (e.channel === 'vex-ctx-image') { this.noteContextImage(webview, e.args && e.args[0]); return; }
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
      // Microphone / camera in use (preload-webview.js getUserMedia wrapper).
      if (e.channel === 'vex-media-capture') {
        const d = (e.args && e.args[0]) || {};
        if (typeof TabManager !== 'undefined' && TabManager.setCapturing) TabManager.setCapturing(webview.dataset.tabId, d.kind, d.active);
        return;
      }
      if (e.channel === 'vex-video-detected' || e.channel === 'vex-pip-fallback') {
        try {
          const payload = (e.args && e.args[0]) || null;
          if (e.channel === 'vex-pip-fallback') {
            // The payload here describes ONE video, so it travels whole rather
            // than being spread across the message.
            window.postMessage({ type: e.channel, media: payload }, '*');
            return;
          }
          if (typeof WebviewManager !== 'undefined' && WebviewManager.getActiveWebview && WebviewManager.getActiveWebview() !== webview) return;
          window.postMessage(Object.assign({ type: e.channel }, payload || {}), '*');
        } catch (err) { console.warn('[webview] could not relay ' + e.channel + ':', err && err.message); }
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
    // What you copied off this page (private and Tor tabs are refused inside)
    if (window.ClipboardHistory) window.ClipboardHistory.attach(webview);
    if (window.Dictionary) window.Dictionary.attach(webview);
    if (window.TeachMode) window.TeachMode.attach(webview);
    // Give this page the snippet list so Tab can expand an abbreviation in it
    if (window.Snippets) window.Snippets.attach(webview);
    // Note the price on product pages that publish one (private and Tor tabs are refused inside)
    if (window.PriceHistory) window.PriceHistory.attach(webview);
    // Apply the saved master-volume level to this page's media (and keep it
    // enforced as media loads). Re-checked per navigation; no-op at 100%.
    onWebview('dom-ready', () => {
      if (typeof MasterVolume !== 'undefined' && MasterVolume.level() !== 1) MasterVolume.applyToWebview(webview);
    });
    // Now Playing mini-bar (which tab is making noise)
    if (typeof NowPlaying !== 'undefined') NowPlaying.register(webview, tab);
    onWebview('did-navigate', (e) => {
      const url = e.url;
      // A fresh page starts with a clean count.
      if (tab.consoleErrors) { tab.consoleErrors = 0; tab.lastConsoleError = ''; TabManager.renderTabUpdate(tab); }
      // An address pretending to be a familiar one (js/link-safety.js). Said
      // once per host per session: a warning that cries wolf is ignored.
      if (typeof LinkSafety !== 'undefined') {
        try {
          const warn = LinkSafety.lookalike(new URL(url).hostname);
          if (warn) LinkSafety.warnOnce(warn, webview);
        } catch { /* not an address that can be parsed */ }
      }
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
      // A view-source: tab reports the page's own address; kept as it was
      // opened, or the tab, its restore and its copies showed the page
      // instead of its source (found 2026-09-29).
      const shown = TabManager.tabs.find(t => t.id === tab.id);
      if (shown && /^view-source:/i.test(shown.url || '') && shown.url.slice(12) === url) return;
      TabManager.updateTab(tab.id, { url });
      this._updateFavicon(tab.id, url);
      if (typeof VexBoosts !== 'undefined') { try { VexBoosts.applyTo(webview, url); } catch {} }
      // A site rule's "always muted" and "never let it sleep" apply to where
      // the tab has ARRIVED, which a link followed inside an existing tab
      // makes different from where it was made (js/site-routes.js).
      if (typeof SiteRoutes !== 'undefined') {
        try { SiteRoutes.applyTo(tab); } catch (err) { console.warn('[Vex] site rule skipped:', err.message); }
      }

      // Add to history (both legacy storage and new HistoryPanel) — but never
      // for Off-the-Record tabs (in-memory partition, no trace).
      // Only web pages: history takes http(s), and an extension's page or a
      // file:// one threw "Invalid payload for storage:history-add" on every
      // visit (found 2026-09-29).
      if (/^https?:/i.test(url) && !isStartPage(url) && !(tab.partition && !tab.partition.startsWith('persist:'))) {
        const t = TabManager.tabs.find(t => t.id === tab.id);
        Promise.resolve(VexStorage.addHistory({ url, title: t?.title || url }))
          .catch(err => window.VexProblems?.note('History', 'Could not add a visit to history', err));
        if (typeof HistoryPanel !== 'undefined') {
          // A visit from a tab in its own session (a container, a Tor or proxy
          // route) is marked, so no history list asks its site for an icon
          // through Vex's direct window (found 2026-09-30).
          HistoryPanel.addEntry(url, t?.title || url, t?.favicon, { ownSession: !TabManager.windowMayAsk(tab.partition) });
        }
        // Phase 16 auto-grouping: try to match against remembered patterns.
        // The call internally waits for the title to settle and uses purely
        // local pattern matching (domains + keywords) — no AI round-trip.
        if (typeof TabGrouper !== 'undefined') {
          TabGrouper.maybeAutoAssignToGroup?.(tab.id);
        }
      }
    });

    onWebview('did-navigate-in-page', (e) => {
      if (e.isMainFrame) {
        TabManager.updateTab(tab.id, { url: e.url });
        document.dispatchEvent(new CustomEvent('vex:tab-navigated', { detail: { tabId: tab.id, url: e.url } }));
      }
    });
    // A full load, once the page is there to be talked to (js/sponsor-skip.js).
    onWebview('did-finish-load', () => {
      try { document.dispatchEvent(new CustomEvent('vex:tab-navigated', { detail: { tabId: tab.id, url: webview.getURL() } })); }
      catch (err) { window.VexProblems?.note('Tabs', 'Could not announce a page load', err); }
    });

    // OS sleep/resume (or a plain crash) can kill a webview's renderer process,
    // leaving it blank. Self-heal: reload the tab's real URL so the page comes
    // back on its own — no manual refresh needed. tab.url is preserved above;
    // hibernated tabs also stash the URL in dataset.hibernatedUrl.
    onWebview('render-process-gone', () => {
      try {
        cancelRecovery?.();
        if (Date.now() - lastCrash > 120000) crashCount = 0;
        lastCrash = Date.now();
        if (++crashCount > 4) { window.showToast?.('This tab keeps crashing. Reload it manually to retry.'); return; }
        // The first crash was put right without a word (found 2026-09-29).
        if (crashCount === 1) window.showToast?.('This tab stopped working — Vex is reloading it', 'warn');
        const t = TabManager.tabs.find(t => t.id === tab.id);
        const real = webview.dataset.hibernatedUrl || (t && t.url);
        if (real && !/^about:blank\b/i.test(real)) {
          const recover = () => {
            if (this.webviews.get(tab.id) !== webview || !webview.isConnected) return;
            delete webview.dataset.hibernated;
            try { Promise.resolve(webview.loadURL(real)).catch(() => {}); } catch { webview.src = real; }
          };
          if (lifecycle) cancelRecovery = lifecycle.timeout(recover, 400 * 2 ** (crashCount - 1));
          else { const timer = setTimeout(recover, 400 * 2 ** (crashCount - 1)); cancelRecovery = () => clearTimeout(timer); }
        }
      } catch {}
    });

    onWebview('new-window', (e) => {
      e.preventDefault();
      TabManager.createTab(e.url, true, null, { partition: tab.partition });
    });

    // Audio indicator
    onWebview('media-started-playing', () => {
      const t = TabManager.tabs.find(t => t.id === tab.id);
      if (t) { t.audible = true; TabManager.renderTabUpdate(t); }
    });
    onWebview('media-paused', () => {
      const t = TabManager.tabs.find(t => t.id === tab.id);
      if (t) { t.audible = false; TabManager.renderTabUpdate(t); }
    });

    onWebview('page-favicon-updated', (e) => {
      if (e.favicons && e.favicons.length > 0) {
        this._setFavicon(tab.id, e.favicons[0]);
      }
    });

    // Listen for VEX_CMD messages from start page and other webview content
    onWebview('console-message', (e) => {
      // Errors on a page you are building (localhost, 127.0.0.1, *.local, a
      // file://) get a count on the tab — the console is not open while you
      // are looking at the page, so a thrown error was invisible until you
      // went looking. Only yours: a badge on every site would be noise.
      if (e.level >= 3 && TabManager.isLocalPage?.(tab.url)) {
        tab.consoleErrors = (tab.consoleErrors || 0) + 1;
        tab.lastConsoleError = String(e.message || '').slice(0, 300);
        TabManager.renderTabUpdate(tab);
      }
      if (e.message && e.message.startsWith('VEX_CMD:')) {
        // SECURITY: VEX_CMD is a privileged control channel (navigate the tab,
        // open chrome panels). console-message fires for EVERY guest page, so
        // without this gate any website could emit a `console.log("VEX_CMD:…")`
        // to force navigation (including file://) or open sidebar panels.
        // Only honour it from the trusted Vex start page.
        let emitterUrl = '';
        try { emitterUrl = webview.getURL(); } catch {}
        // Reading mode's own page (a data: page) may ask for one thing only:
        // to leave reading mode, on a tab that is in it. Its "Exit Reading
        // Mode" button did nothing (found 2026-09-29).
        if (/^data:text\/html/i.test(emitterUrl) && typeof ReadingMode !== 'undefined' && (ReadingMode._originalUrls.has(tab.id) || ReadingMode.sourceOf(emitterUrl))) {
          let asked = null;
          try { asked = JSON.parse(e.message.slice(8)); } catch (err) { console.error('VEX_CMD parse error:', err); return; }
          if (asked && asked.type === 'exit-reading') ReadingMode.exitReadingMode(tab.id);
          return;
        }
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
              // A shortcut saved as "example.com" failed with an uncaught
              // ERR_INVALID_URL and the tile did nothing (found 2026-09-29).
              try {
                Promise.resolve(webview.loadURL(cmd.url)).catch(err => {
                  const m = String((err && err.message) || err);
                  if (!/ERR_ABORTED|\(-3\)/.test(m)) window.showToast?.('Could not open ' + cmd.url + ': ' + m, 'error');
                });
              } catch { webview.src = cmd.url; }
            }
          } else if (cmd.type === 'open-panel' && cmd.panel) {
            SidebarManager.openPanel(cmd.panel);
          } else if (cmd.type === 'open-theme-picker') {
            if (typeof ThemePicker !== 'undefined') ThemePicker.open();
          } else if (cmd.type === 'set-engine' && typeof cmd.id === 'string') {
            // The New Tab page's engine menu changed only its own storage, and
            // the address bar kept the old engine (found 2026-09-29).
            if (typeof VexTypedAddress !== 'undefined' && VexTypedAddress.SEARCH_ENGINES[cmd.id] && typeof Onboarding !== 'undefined') Onboarding._setStart('vex.searchEngine', cmd.id);
          } else if (cmd.type === 'exit-reading') {
            if (typeof ReadingMode !== 'undefined') ReadingMode.exitReadingMode(tab.id);
          } else if (cmd.type === 'start-tiles') {
            this.saveStartTiles(cmd, webview);
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
    onWebview('context-menu', (e) => {
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
        if (real && !/^about:blank\b/i.test(real)) { try { delete wv.dataset.hibernated; this._loadUnwatched(wv, real, 'waking a blanked tab'); } catch { try { wv.src = real; } catch {} } }
      } catch {}
    });
  },
  _wake(wv) {
    try {
      if (wv.dataset.hibernated !== '1') return;
      const url = wv.dataset.hibernatedUrl;
      delete wv.dataset.hibernated;
      if (url) { try { this._loadUnwatched(wv, url, 'waking a sleeping tab'); } catch { wv.src = url; } }
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
        try { this._loadUnwatched(wv, 'about:blank', 'putting a tab to sleep'); } catch { wv.src = 'about:blank'; }
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
      wv.dispatchEvent(new Event('vex-disposed'));
      wv._lifecycle?.dispose();
      wv.remove();
      this.webviews.delete(tabId);
    }
  },

  // Print and View Page Source: Vex had neither — no command, no menu row,
  // and Ctrl+P / Ctrl+U did nothing (found 2026-09-29).
  printPage(wv = this.getActiveWebview()) {
    if (!wv || typeof wv.print !== 'function') { window.showToast?.('Open a page to print first'); return; }
    Promise.resolve(wv.print()).catch(err => window.showToast?.('Could not print: ' + ((err && err.message) || err), 'error'));
  },

  viewSource(wv = this.getActiveWebview()) {
    let url = '';
    try { url = wv ? wv.getURL() : ''; } catch (err) { console.error('[Vex] view source: no page address', err); }
    if (!/^(https?|file):/i.test(url)) { window.showToast?.('Open a web page first'); return; }
    TabManager.createTab('view-source:' + url, true);
  },

  getActiveWebview() {
    return this.webviews.get(TabManager.activeTabId);
  },

  // A load nobody waits for (a tab woken, put to sleep, or reloaded from its
  // remembered address). Its promise went unhandled, so a navigation that
  // superseded it put an uncaught "GUEST_VIEW_MANAGER_CALL … ERR_ABORTED (-3)"
  // into Problems (found 2026-09-30). Superseded is expected; anything else is
  // logged. A webview not attached yet still throws, for the caller's own
  // fallback.
  _loadUnwatched(wv, url, why) {
    wv.loadURL(url).catch((err) => {
      const m = String((err && err.message) || err);
      if (/ERR_ABORTED|\(-3\)/.test(m)) return;
      console.warn(`[Vex] ${why}: could not load ${url} —`, m);
    });
  },

  // Chromium's error code, in words. The proxy itself not answering (its port
  // refuses: Tor is not running) is PROXY_CONNECTION_FAILED; a site that
  // fails through a working Tor (down, refusing, no such address, an onion
  // service that is offline) is SOCKS_CONNECTION_FAILED, which said Tor was
  // not answering (found 2026-09-30, both checked live). A Tor tab or a Tor
  // site rule is known by its partition; a container or burner may go
  // through Tor or another proxy.
  _whyLoadFailed(message, partition) {
    const m = String(message || '');
    const tor = /^(tor-|persist:route-tor$)/.test(String(partition || ''));
    if (/PROXY_CONNECTION_FAILED/.test(m)) return tor ? 'Tor is not running' : 'the proxy or Tor it goes through is not answering';
    if (/SOCKS_CONNECTION_FAILED|SOCKS_CONNECTION_HOST_UNREACHABLE|TUNNEL_CONNECTION_FAILED/.test(m)) return tor ? 'the site did not answer through Tor' : 'the site did not answer through the proxy or Tor it goes through';
    if (/NAME_NOT_RESOLVED|NAME_RESOLUTION_FAILED/.test(m)) return 'no site has that address';
    if (/CONNECTION_REFUSED/.test(m)) return 'nothing is answering at that address';
    if (/INTERNET_DISCONNECTED/.test(m)) return 'you are offline';
    if (/TIMED_OUT/.test(m)) return 'it took too long to answer';
    if (/CERT|SSL/.test(m)) return 'its security certificate is not valid';
    if (/INVALID_URL/.test(m)) return 'that is not a valid address';
    return m;
  },

  // A Tor page that could not load because Tor is not running was a blank
  // page (found 2026-09-30). Main says which page and why (tor:page-down);
  // the words go into the page's empty error document.
  TOR_DOWN_TEXT: {
    starting: ['Tor is not running — starting it…', 'This page loads as soon as Tor is connected.'],
    failed: ['Tor could not start', 'Reload the page to try again.'],
    stopped: ['Tor stopped — reopen to start it again', 'Open a new Tor tab from the onion button. This one stays cut off from the internet.'],
  },
  showTorDown(pageId, state, error) {
    const text = this.TOR_DOWN_TEXT[state];
    if (!text) throw new Error(`Unknown Tor page state "${state}"`);
    const wv = [...this.webviews.values()].find((w) => {
      try { return w.getWebContentsId() === pageId; } catch { return false; } // not attached: not that page
    });
    if (!wv) return false;   // a page that is not a tab here
    wv.executeJavaScript(this._torDownScript(text[0], error ? `${text[1]} (${error})` : text[1]))
      .catch(err => console.error('[tor] could not say why the page is blank:', err));
    return true;
  },
  _torDownScript(title, detail) {
    const icon = VexIcons.svg('onion', { size: 40 });
    return `(() => {
      const d = document;
      const style = d.createElement('style');
      style.textContent = 'html,body{height:100%;margin:0}body{display:flex;align-items:center;justify-content:center;font:15px/1.5 system-ui,sans-serif;background:#f6f6f7;color:#222}@media (prefers-color-scheme:dark){body{background:#1b1b1f;color:#e8e8ea}}.vex-tor-down{max-width:460px;padding:24px;text-align:center}.vex-tor-down h1{font-size:20px;margin:12px 0 6px}.vex-tor-down p{margin:0;opacity:.75}';
      const box = d.createElement('div');
      box.className = 'vex-tor-down';
      box.innerHTML = ${JSON.stringify(icon)};
      const h = d.createElement('h1'); h.textContent = ${JSON.stringify(title)};
      const p = d.createElement('p'); p.textContent = ${JSON.stringify(detail)};
      box.append(h, p);
      d.head.replaceChildren(style);
      d.body.replaceChildren(box);
      return true;
    })()`;
  },

  // === The New Tab page's grid ============================================
  // The page keeps its tiles in its own storage, which this window cannot
  // read, so the grid synced nowhere (found 2026-09-30). The page hands its
  // list over on every change and when it opens (VEX_CMD start-tiles); the
  // window keeps it as vex.startTiles, which SyncEngine syncs item by item,
  // and hands the grid back to every open New Tab page after a sync.
  START_TILES: 'vex.startTiles',
  _startTilesValid(list) {
    return Array.isArray(list) && list.length <= 500
      && list.every(t => !!t && typeof t === 'object' && !Array.isArray(t) && typeof t.url === 'string' && typeof t.name === 'string');
  },
  startTiles() {
    const raw = localStorage.getItem(this.START_TILES);
    if (raw === null) return null;
    let list;
    try { list = JSON.parse(raw); } catch { list = null; }
    if (!this._startTilesValid(list)) throw new Error('The New Tab grid kept by Vex is unreadable');
    return list;
  },
  // A page's own tiles added to the window's, none lost: a tile is the same
  // tile by its address, and a second one with that address (Duplicate)
  // is a second tile, as sync counts them.
  _mergeStartTiles(have, own) {
    const count = new Map();
    for (const t of have) count.set(t.url, (count.get(t.url) || 0) + 1);
    const out = [...have];
    for (const t of own) {
      const n = count.get(t.url) || 0;
      if (n > 0) count.set(t.url, n - 1); else out.push(t);
    }
    return out;
  },
  saveStartTiles(cmd, from) {
    try {
      const tiles = cmd.tiles == null ? null : cmd.tiles;
      if (tiles !== null && !this._startTilesValid(tiles)) throw new Error('The New Tab page sent a grid Vex cannot read');
      const have = this.startTiles();
      let next;
      if (cmd.loading) {
        // A page opening shows the window's grid. The first time a page
        // opens, the grid it saved is added to the window's; a page that never
        // changed its built-in tiles takes the window's as they are.
        if (!have) { if (!tiles) return; next = tiles; }
        else next = !cmd.handed && tiles ? this._mergeStartTiles(have, tiles) : have;
      } else {
        if (!tiles) return;
        next = tiles;
      }
      if (!have || JSON.stringify(have) !== JSON.stringify(next)) localStorage.setItem(this.START_TILES, JSON.stringify(next));
      // The page itself too when opening, so it is marked handed over.
      this.pushStartTiles(cmd.loading ? null : from);
    } catch (err) {
      console.error('[New Tab] the grid could not be kept:', err);
      window.showToast?.('Your New Tab tiles could not be saved for sync — ' + err.message, 'error');
    }
  },
  // Every open New Tab page (but `except`) is handed the window's grid.
  pushStartTiles(except = null) {
    const list = this.startTiles();
    if (!list) return 0;
    let handed = 0;
    for (const wv of this.webviews.values()) {
      if (wv === except) continue;
      let url = '';
      try { url = wv.getURL(); } catch { continue; }   // not attached yet: it asks when it opens
      if (!_isTrustedStartPage(url)) continue;
      wv.executeJavaScript(`window.__vexSetStartTiles ? window.__vexSetStartTiles(${JSON.stringify(list)}) : false`)
        .catch(err => console.error('[New Tab] could not hand a New Tab page its tiles:', err));
      handed++;
    }
    return handed;
  },

  navigate(url) {
    // A site rule cannot move a tab that already exists — a webview's session
    // is fixed the moment it is attached — so the tab opens beside this one,
    // in the routed session, and this one stays where it was.
    if (typeof SiteRoutes !== 'undefined') {
      try {
        const tab = TabManager.getActiveTab();
        const routed = SiteRoutes.reroute(url, tab && tab.partition);
        if (routed && routed !== (tab && tab.partition || 'persist:main')) {
          TabManager.createTab(url, true, tab && tab.groupId, { partition: routed });
          window.showToast?.(SiteRoutes.describe({ partition: routed }) || 'Opened through your site rule');
          return;
        }
      } catch (err) { console.warn('[Vex] site rule skipped:', err.message); }
    }
    const wv = this.getActiveWebview();
    if (wv) {
      // Electron webview DOM element uses .src or .loadURL()
      // .loadURL() is the correct webview API method, but .src works as fallback
      if (typeof wv.loadURL === 'function') {
        // A navigation superseded by another rejects with ERR_ABORTED (-3);
        // that's expected. A real failure used to be only a console line: the
        // page went blank while the address bar still showed the old site
        // (found 2026-09-29). Show the address asked for, and say why.
        const tabId = TabManager.activeTabId;
        const load = () => wv.loadURL(url).catch(err => {
          const m = String((err && err.message) || err);
          if (/ERR_ABORTED|\(-3\)/.test(m)) return;
          console.warn('[Vex] navigate failed:', m);
          const tab = TabManager.tabs.find(t => t.id === tabId);
          if (tab) { tab.url = url; TabManager.renderTabUpdate?.(tab); }
          const input = document.getElementById('url-input');
          if (input && TabManager.activeTabId === tabId && document.activeElement !== input) input.value = url;
          window.showToast?.('Could not open ' + url + ' — ' + this._whyLoadFailed(m, tab && tab.partition), 'error');
        });
        // An address typed the moment a tab opens, before its page is
        // attached: loadURL threw "The WebView must be attached…" out of the
        // address bar and the address was dropped (found 2026-09-30). It is
        // loaded once the page is there; a changed src is not read then.
        if (!wv._attached) { wv.addEventListener('did-attach', load, { once: true }); return; }
        load();
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
    if (real) { try { if (wv.dataset) delete wv.dataset.hibernated; this._loadUnwatched(wv, real, 'reload'); } catch { try { wv.src = real; } catch {} } return; }
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
    if (_real) { try { if (wv.dataset) delete wv.dataset.hibernated; this._loadUnwatched(wv, _real, 'hard reload'); } catch { try { wv.src = _real; } catch {} } return; }
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

  // Save a picture from a page. As = the system Save dialog (name, folder,
  // type), through main's download handler so it is still one download in
  // the Downloads panel (src/main/downloads.js, askWhere).
  async saveImage(webview, src, as) {
    try {
      if (as) {
        if (!window.vex || typeof window.vex.downloadsAskWhere !== 'function') throw new Error('Save As is not available in this window');
        await window.vex.downloadsAskWhere(src);
      }
      webview.downloadURL(src);
    } catch (err) {
      window.VexProblems?.note('Images', 'Could not save the image', err);
      window.showToast?.('Could not save the image: ' + ((err && err.message) || ''), 'error');
    }
  },

  // Copy the picture itself. copyImageAt asks Chromium for the image at a
  // point, which is exactly what fails when the picture is under a link or
  // pointer-events:none, so a picture the page found is fetched by main in
  // this page's own session and put on the clipboard from there.
  async copyImage(webview, src, params) {
    const p = params || {};
    if (p.mediaType === 'image' && p.srcURL === src && typeof webview.copyImageAt === 'function') {
      try { webview.copyImageAt(p.x, p.y); window.showToast?.('Image copied'); return; } catch { /* fetch it instead */ }
    }
    try {
      if (!window.vex || typeof window.vex.copyImageFrom !== 'function') throw new Error('Copying images is not available in this window');
      const r = await window.vex.copyImageFrom(src, webview.getAttribute?.('partition') || '');
      if (!r || !r.ok) throw new Error((r && r.error) || 'the image could not be read');
      window.showToast?.('Image copied');
    } catch (err) {
      window.showToast?.('Could not copy the image: ' + ((err && err.message) || ''), 'error');
    }
  },

  // The picture the page itself found under the pointer (preload-webview.js,
  // "The picture under a right-click"). Kept for a moment only: it belongs
  // to one right-click.
  noteContextImage(webview, data) {
    if (!webview) return;
    const src = data && typeof data.src === 'string' ? data.src : '';
    webview._vexCtxImage = { src, at: Date.now() };
  },

  // Chromium's answer when it saw an image; otherwise the page's, if it
  // arrived for this right-click. Only addresses Vex can do something with.
  contextImage(params, webview) {
    const p = params || {};
    let src = (p.mediaType === 'image' && p.srcURL) ? p.srcURL : '';
    const found = webview && webview._vexCtxImage;
    if (webview) webview._vexCtxImage = null;
    if (!src && found && found.src && Date.now() - found.at < 2000) src = found.src;
    return /^(https?:|data:image\/|blob:)/i.test(src) ? src : '';
  },

  // The rows for what was clicked (a picture, a link, some text): the first
  // few stay in the menu, the rest open from "More for ...". No separator
  // leads a submenu, and a group with nothing extra gets no submenu.
  _pushGroup(items, group, isTop, moreLabel, icon) {
    const rows = group.filter(it => !it.sep);
    if (!rows.length) return;
    const top = rows.filter(isTop);
    const more = rows.filter(it => !top.includes(it));
    items.push({ sep: true }, ...top);
    if (more.length) items.push({ label: moreLabel, icon, sub: more });
  },

  // Draw the rows into the menu. A row with `sub` opens a submenu beside it on
  // hover (or at once on a click), removed with the menu; a row with
  // `buttons` is a row of icon buttons.
  // Every action closes the whole menu through the shared dismissal, which
  // also removes its click-catching overlay (a bare menu.remove() left that
  // overlay behind to eat the next click).
  _renderMenu(menu, items) {
    const closeAll = () => {
      closeSub();
      if (typeof TabManager !== 'undefined' && TabManager._dismissMenu) TabManager._dismissMenu(menu);
      else menu.remove();
    };
    const run = (fn) => { try { fn(); } finally { closeAll(); } };
    let openSub = null, openRow = null, timer = null;
    const closeSub = () => {
      if (openSub) openSub.remove();
      if (openRow) { openRow.classList.remove('open'); openRow.setAttribute('aria-expanded', 'false'); }
      openSub = openRow = null;
    };
    const showSub = (row, subItems) => {
      clearTimeout(timer);
      if (openRow === row) return;
      closeSub();
      const sub = document.createElement('div');
      sub.className = 'tab-context-menu ctx-submenu';
      sub.setAttribute('role', 'menu');
      subItems.forEach(it => sub.appendChild(draw(it, true)));
      // In the page, not in the menu: the menu scrolls when it is tall, and a
      // submenu inside it was clipped away, so every submenu of the page's
      // right-click menu (Page, This site, "More for this …") could not be
      // reached (found 2026-09-29). Removed with the menu (see `gone` below).
      sub.style.position = 'fixed';
      sub.style.right = 'auto';
      document.body.appendChild(sub);
      // Beside the row; flipped to the left, or lifted, to stay on screen.
      const rowBox = row.getBoundingClientRect(), menuBox = menu.getBoundingClientRect();
      let left = menuBox.right - 4, top = rowBox.top - 7;
      sub.style.left = left + 'px'; sub.style.top = top + 'px';
      const r = sub.getBoundingClientRect();
      if (r.right > window.innerWidth - 4) left = Math.max(4, menuBox.left - r.width + 4);
      if (r.bottom > window.innerHeight - 4) top = Math.max(4, window.innerHeight - r.height - 8);
      sub.style.left = left + 'px'; sub.style.top = top + 'px';
      sub.addEventListener('mouseenter', () => clearTimeout(timer));
      sub.addEventListener('mouseleave', () => { clearTimeout(timer); timer = setTimeout(closeSub, 350); });
      openSub = sub; openRow = row;
      row.classList.add('open');
      row.setAttribute('aria-expanded', 'true');
    };
    // The submenu lives beside the menu, so it goes when the menu goes, and
    // is put away if the menu is scrolled under it.
    const gone = new MutationObserver(() => { if (!menu.isConnected) { closeSub(); gone.disconnect(); } });
    gone.observe(document.body, { childList: true, subtree: true });
    menu.addEventListener('scroll', closeSub, { passive: true });
    const icon = (name) => (typeof VexIcons !== 'undefined' && name) ? VexIcons.svg(name, { size: 14, className: 'ctx-icon' }) : '';
    const draw = (item, inSub) => {
      if (item.sep) {
        const sep = document.createElement('div');
        sep.className = 'tab-context-sep';
        sep.setAttribute('role', 'separator');
        return sep;
      }
      if (item.buttons) {
        const bar = document.createElement('div');
        bar.className = 'ctx-button-row';
        for (const b of item.buttons) {
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'ctx-button';
          btn.title = b.label;
          btn.setAttribute('aria-label', b.label);
          btn.innerHTML = icon(b.icon);
          btn.disabled = !!b.disabled;
          btn.addEventListener('mousedown', (ev) => { if (ev.button !== 0 || b.disabled) return; ev.preventDefault(); run(b.action); });
          bar.appendChild(btn);
        }
        return bar;
      }
      const el = document.createElement('div');
      el.className = 'tab-context-item';
      el.setAttribute('role', 'menuitem');
      if (item.sub) el.innerHTML = icon(item.icon);
      el.appendChild(document.createTextNode(item.label));
      if (item.disabled) {
        el.style.opacity = '0.4';
        el.style.pointerEvents = 'none';
        el.setAttribute('aria-disabled', 'true');
      }
      if (item.sub) {
        el.classList.add('has-sub');
        el.setAttribute('aria-haspopup', 'menu');
        el.setAttribute('aria-expanded', 'false');
        el.insertAdjacentHTML('beforeend', '<span class="ctx-sub-chevron">' + icon('chevron-right') + '</span>');
        el.addEventListener('mouseenter', () => { clearTimeout(timer); timer = setTimeout(() => showSub(el, item.sub), 120); });
        el.addEventListener('mouseleave', () => { clearTimeout(timer); timer = setTimeout(() => { if (!(openSub && openSub.matches(':hover'))) closeSub(); }, 350); });
        el.addEventListener('mousedown', (ev) => { if (ev.button !== 0) return; ev.preventDefault(); showSub(el, item.sub); });
        return el;
      }
      // Moving onto another row of the menu puts an open submenu away.
      if (!inSub) el.addEventListener('mouseenter', () => { if (openSub) { clearTimeout(timer); timer = setTimeout(closeSub, 250); } });
      // Activate on mousedown, not click: this menu is opened from a
      // <webview> guest right-click, so focus sits in the guest. The
      // guest-host focus churn fires a host-window 'blur' that runs the
      // dismissal close() and removes the menu BETWEEN a left-click's
      // mousedown and mouseup, so the 'click' never materialises. Acting
      // on mousedown wins that race. button 0 only: ignore right/middle so
      // a right-click on a menu item doesn't trigger its action.
      el.addEventListener('mousedown', (ev) => { if (ev.button !== 0) return; run(item.action); });
      return el;
    };
    menu.setAttribute('role', 'menu');
    items.forEach(it => menu.appendChild(draw(it, false)));
  },

  showContextMenu(e, webview) {
    // Clear any prior menu AND its dismissal overlay. Removing only the menu
    // (the old behaviour) leaked a stack of transparent .context-menu-overlay
    // divs across repeated right-clicks.
    document.querySelectorAll('.tab-context-menu, .context-menu-overlay').forEach(m => m.remove());

    const curUrl = (() => { try { return webview.getURL(); } catch { return ''; } })();
    const isTab = !!(webview.dataset && webview.dataset.tabId);
    const imageSrc = this.contextImage(e.params, webview);

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
                    if (!ok) return; // Never insert into an unrelated caret/selection.
                    setTimeout(typeTrusted, 180);
                  }).catch((err) => { console.warn('[Vex spell] select failed:', err); });
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

    // What is on this page, and what is about this site, each in a submenu:
    // twenty-odd rows in one column was more than anyone reads (2026-09-27).
    const pageItems = [
      { label: 'Copy Page URL', action: () => navigator.clipboard.writeText(webview.getURL()) },
      { label: 'Copy as Markdown link', action: () => { try { const u = webview.getURL(); const title = (webview.getTitle && webview.getTitle()) || u; navigator.clipboard.writeText(`[${String(title).replace(/[\[\]]/g, '')}](${u})`); window.showToast?.('Copied as Markdown'); } catch {} } },
      { label: 'Open in New Tab', action: () => TabManager.createTab(webview.getURL(), true, null, { partition: webview.getAttribute?.("partition") }) },
      { label: 'Open as App', action: () => { try { window.vex.openAsApp(webview.getURL(), (webview.getTitle && webview.getTitle()) || ''); } catch {} } },
      // A tab's own rows. In a panel (Gemini, Claude, Discord...) "Duplicate
      // Tab" copied whatever TAB was active and Auto-refresh had no tab to
      // refresh, so a panel gets neither.
      ...(isTab ? [{ label: 'Duplicate Tab', action: () => { try { const t = TabManager.tabs.find(x => String(x.id) === String(webview.dataset.tabId)); if (t && t.url) TabManager.createTab(t.url, true, t.groupId, { ...(window.VexTabPolicy?.serialize(t) || t), allowDuplicate: true }); } catch (err) { window.showToast?.('Could not duplicate the tab: ' + err.message, 'error'); } } }] : []),
      { label: 'Send to Phone', action: () => { try { if (window.SendToPhone) SendToPhone.open(webview.getURL()); } catch {} } },
      { label: 'Print…', action: () => this.printPage(webview) },
      { label: 'View Page Source', action: () => this.viewSource(webview) },
      ...(isTab ? [{ label: (typeof AutoReload !== 'undefined' && AutoReload.isOn(webview.dataset.tabId)) ? 'Auto-refresh: on…' : 'Auto-refresh…', action: () => { try { if (window.AutoReload) AutoReload.open(webview.dataset.tabId); } catch {} } }] : []),
    ];
    const siteItems = [
      // Per-site controls (dark mode + reset). Zoom already has keyboard shortcuts;
      // "Reset this site" clears this host's saved zoom and dark-mode override.
      { label: this._shouldForceDark(curUrl) ? 'Dark mode: on for this site' : 'Dark mode for this site',
        action: () => this.toggleForceDarkForSite(webview) },
      { label: 'Zap element (hide it forever)', action: () => { try { if (typeof VexBoosts !== 'undefined') VexBoosts.startZapper(); } catch {} } },
      { label: 'Reset this site’s settings', action: () => this.resetSite(webview) }
    ];

    // Back / Forward / Reload as one row of buttons, like Edge and Chrome's
    // newer menus: first, after any spelling suggestions (those lead, as in
    // every browser, because they are about the word under the pointer).
    const items = [
      ...spellingItems,
      { buttons: [
        { label: 'Back', icon: 'arrow-left', action: () => webview.goBack(), disabled: !webview.canGoBack() },
        { label: 'Forward', icon: 'arrow-right', action: () => webview.goForward(), disabled: !webview.canGoForward() },
        { label: 'Reload', icon: 'refresh', action: () => webview.reload() },
      ] },
      ...editItems,
    ];

    // Right-clicking an input (e.g. the verification-code box): offer to fill the
    // code from Gmail on demand, in case the automatic pass didn't catch it.
    if (e.params.isEditable && typeof EmailCodeAutofill !== 'undefined') {
      items.push({ sep: true });
      items.push({
        label: 'Fill code from email',
        action: () => { try { EmailCodeAutofill.tryFill(webview, webview.getURL()); window.showToast?.('Looking for your code…'); } catch {} }
      });
    }

    // Pushed picture first, then link, then text: the thing under the pointer
    // leads (a picture inside a link is mostly about the picture).
    const groups = [];
    const textItems = [];
    if (e.params.selectionText) {
      textItems.push({ sep: true });
      textItems.push({
        label: `Search "${e.params.selectionText.substring(0, 20)}..."`,
        action: () => {
          // In the page's own session: from a Tor or burner tab this searched
          // from the real address (found 2026-09-29).
          TabManager.createTab(VexTypedAddress.searchUrl(e.params.selectionText), true, null, { partition: webview.getAttribute?.('partition') });
        }
      });
      // Editable contexts already got a Copy row in editItems above.
      if (!e.params.isEditable) {
        textItems.push({
          label: 'Copy',
          action: () => webview.copy()
        });
      }
      if (typeof Annotations !== 'undefined') {
        textItems.push({
          label: 'Highlight',
          action: () => Annotations.highlight('yellow')
        });
      }
      // Quick capture: what you selected becomes a reminder, a note, or a
      // question — without leaving the page or opening a panel first.
      {
        const sel = e.params.selectionText;
        const pageUrl = (() => { try { return webview.getURL(); } catch { return ''; } })();
        const pageTitle = (() => { try { return webview.getTitle(); } catch { return ''; } })();
        textItems.push({ sep: true });
        if (typeof VexQuickReminder !== 'undefined') {
          textItems.push({
            label: 'Remind me about this',
            action: () => VexQuickReminder.open(sel, { url: pageUrl, title: pageTitle }),
          });
        }
        if (typeof StickyNotes !== 'undefined') {
          textItems.push({
            label: 'Save as a note for this page',
            action: () => {
              const key = StickyNotes._norm(pageUrl);
              const existing = (StickyNotes._load()[key] || {}).text || '';
              const ok = StickyNotes.setText(key, existing ? existing + '\n\n' + sel : sel, { url: pageUrl, title: pageTitle });
              window.showToast?.(ok ? 'Saved to this page’s note' : 'Could not save the note', ok ? undefined : 'error');
            },
          });
        }
        if (typeof AIPanel !== 'undefined') {
          textItems.push({
            label: 'Ask Vex AI about this',
            action: () => { AIPanel.open(); AIPanel.sendMessage('chat', { message: `About this text from ${pageTitle || pageUrl}:\n\n"""${sel}"""\n\nWhat should I know?` }); },
          });
        }
      }
      // AI options for selected text
      if (typeof AIPanel !== 'undefined') {
        const sel = e.params.selectionText;
        textItems.push({ sep: true });
        textItems.push({
          label: `Explain "${sel.substring(0, 25)}${sel.length > 25 ? '...' : ''}"`,
          action: () => { AIPanel.open(); AIPanel.sendMessage('explain', { selectedText: sel }); }
        });
        textItems.push({
          label: 'Summarize selection',
          // Route via chat (free-form reply) \u2014 the 'summarize' feature renders
          // only a structured {summary} card and comes back blank for a snippet.
          action: () => { AIPanel.open(); AIPanel.sendMessage('chat', { message: `Summarize the following text clearly and concisely:\n\n"""${sel}"""` }); }
        });
        textItems.push({
          label: 'Translate selection',
          action: () => { AIPanel.open(); AIPanel.sendMessage('translate', { selectedText: sel, targetLanguage: 'English' }); }
        });
      }
      textItems.push({
        label: 'Read aloud',
        action: () => { try { window.speechSynthesis.cancel(); window.speechSynthesis.speak(new SpeechSynthesisUtterance(e.params.selectionText)); } catch {} }
      });
    }
    groups.push(() => this._pushGroup(items, textItems, (it) => it.label === 'Copy' || /^Search "/.test(it.label), 'More for this text', 'type'));

    const linkItems = [];
    if (e.params.linkURL) {
      linkItems.push({ sep: true });
      linkItems.push({
        label: 'Open Link in New Tab',
        action: () => TabManager.createTab(e.params.linkURL, true, null, { partition: webview.getAttribute?.("partition") })
      });
      linkItems.push({
        // Copy where it really GOES, without what identifies you: a wrapped
        // link otherwise copies the wrapper, and almost every site's links
        // carry campaign tags that follow whoever you send them to.
        label: 'Copy Link',
        action: () => {
          const out = (typeof LinkSafety !== 'undefined') ? LinkSafety.describe(e.params.linkURL) : { clean: e.params.linkURL, wrapped: false, tracked: false };
          navigator.clipboard.writeText(out.clean);
          if (out.wrapped || out.tracked) {
            window.showToast?.('Copied' + (out.wrapped ? ' the real address' : '') + (out.wrapped && out.tracked ? ', ' : '') + (out.tracked ? ' without its tracking tags' : ''));
          }
        }
      });
      linkItems.push({
        label: 'Copy Link Exactly',
        action: () => navigator.clipboard.writeText(e.params.linkURL)
      });
      linkItems.push({
        // Shorteners and redirects, followed before you click — never from a
        // private or Tor tab, where asking would contact the site outside it.
        label: 'Where Does This Link Go?',
        action: async () => {
          if (window.VexTabPolicy && !window.VexTabPolicy.canReadWebview(webview)) { window.showToast?.('Not in a private tab — following the link would contact the site from your real connection'); return; }
          try { await LinkSafety.whereItGoes(e.params.linkURL); }
          catch (err) { window.showToast?.((err && err.message) || 'Could not follow the link', 'error'); }
        }
      });
      linkItems.push({
        label: 'Send Link to Phone',
        action: () => { try { if (window.SendToPhone) SendToPhone.open(e.params.linkURL); } catch {} }
      });
      linkItems.push({
        label: 'Copy Link as Markdown',
        action: () => { try { const txt = (e.params.linkText || e.params.selectionText || e.params.linkURL || '').replace(/[\[\]]/g, '').trim() || e.params.linkURL; navigator.clipboard.writeText(`[${txt}](${e.params.linkURL})`); window.showToast?.('Copied as Markdown'); } catch {} }
      });
      if (typeof ReadLater !== 'undefined' && /^https?:/i.test(e.params.linkURL)) {
        linkItems.push({
          label: 'Read Later',
          action: () => ReadLater.add(e.params.linkURL, e.params.linkText || e.params.linkURL)
        });
      }
      if (typeof LinkRot !== 'undefined' && /^https?:/i.test(e.params.linkURL)) {
        linkItems.push({
          label: 'Open Archived Version',
          action: () => LinkRot.viewArchived(e.params.linkURL)
        });
      }
    }
    groups.push(() => this._pushGroup(items, linkItems, (it) => it.label === 'Open Link in New Tab' || it.label === 'Copy Link', 'More for this link', 'link'));

    const imageItems = [];
    // The picture under the pointer, whether Chromium saw it (an <img> on
    // top) or the page found it under a link, an overlay or a CSS background
    // (contextImage). Save goes straight to Downloads like every download;
    // Save As asks where and under what name.
    if (imageSrc) {
      const web = /^https?:/i.test(imageSrc);
      const partition = webview.getAttribute?.('partition');
      imageItems.push({ sep: true });
      imageItems.push({ label: 'Open Image in New Tab', action: () => TabManager.createTab(imageSrc, true, null, { partition }) });
      imageItems.push({ label: 'Save Image', action: () => this.saveImage(webview, imageSrc, false) });
      imageItems.push({ label: 'Save Image As…', action: () => this.saveImage(webview, imageSrc, true) });
      imageItems.push({ label: 'Copy Image', action: () => this.copyImage(webview, imageSrc, e.params) });
      imageItems.push({ label: 'Copy Image Address', action: () => { navigator.clipboard.writeText(imageSrc); window.showToast?.('Image address copied'); } });
      if (web) imageItems.push({ label: 'Search Image with Lens', action: () => TabManager.createTab('https://lens.google.com/uploadbyurl?url=' + encodeURIComponent(imageSrc), true, null, { partition }) });
      if (typeof ImageZoom !== 'undefined') imageItems.push({ label: 'Zoom Image', action: () => ImageZoom.open(imageSrc) });
      if (web && typeof AIPanel !== 'undefined' && AIPanel.askAboutImage) imageItems.push({ label: 'Ask Vex About This Image', action: () => AIPanel.askAboutImage(imageSrc) });
    }
    groups.push(() => this._pushGroup(items, imageItems, (it) => /^(Save Image|Save Image As…|Copy Image)$/.test(it.label), 'More for this image', 'image'));

    // A right-clicked video or sound offered nothing for it (found 2026-09-29).
    const media = (e.params.mediaType === 'video' || e.params.mediaType === 'audio') ? e.params : null;
    if (media) {
      const flags = media.mediaFlags || {};
      const noun = media.mediaType === 'video' ? 'video' : 'sound';
      // The element under the pointer, found again inside the page.
      // The element under the pointer, found again inside the page: through
      // shadow roots and same-origin frames, else by its address. A video in
      // a frame or shadow root was "not found", and a refused play() was not
      // reported (found 2026-09-29).
      // Electron gives the point in the window, not in the page: measured
      // at (612,183) for a click the page saw at (550,90). Into the page's
      // own coordinates, zoom included.
      const at = (() => {
        let box = { left: 0, top: 0 }, zoom = 1;
        try { box = webview.getBoundingClientRect(); } catch (err) { console.warn('[Vex] media menu: no webview box', err); }
        try { zoom = webview.getZoomFactor() || 1; } catch (err) { console.warn('[Vex] media menu: no zoom factor', err); }
        return { x: Math.round(((Number(media.x) || 0) - box.left) / zoom), y: Math.round(((Number(media.y) || 0) - box.top) / zoom) };
      })();
      const act = (js) => webview.executeJavaScript(
        `(async () => {
          const find = (doc, x, y) => {
            let hit = doc.elementFromPoint(x, y);
            while (hit && hit.shadowRoot) { const inner = hit.shadowRoot.elementFromPoint(x, y); if (!inner || inner === hit) break; hit = inner; }
            if (hit && hit.tagName === 'IFRAME') {
              let d = null; try { d = hit.contentDocument; } catch (e) { d = null; }
              if (!d) return 'frame';
              const b = hit.getBoundingClientRect();
              return find(d, x - b.left - hit.clientLeft, y - b.top - hit.clientTop);
            }
            return hit && ((hit.closest && hit.closest('video,audio')) || (hit.querySelector && hit.querySelector('video,audio')));
          };
          let el = find(document, ${at.x}, ${at.y});
          if (!el || el === 'frame') { const src = ${JSON.stringify(media.srcURL || '')}; const same = src && [...document.querySelectorAll('video,audio')].find(m => m.currentSrc === src || m.src === src); if (same) el = same; }
          if (el === 'frame') return 'frame';
          if (!el) return 'none';
          try { await (${js}); return 'ok'; } catch (e) { return 'error: ' + ((e && e.message) || e); }
        })()`, true
      ).then(res => {
        if (res === 'none') window.showToast?.(`Could not find that ${noun} on the page`, 'warn');
        else if (res === 'frame') window.showToast?.(`That ${noun} is inside another site's frame, which Vex cannot reach from here`, 'warn');
        else if (typeof res === 'string' && res.startsWith('error: ')) window.showToast?.('That did not work: ' + res.slice(7), 'error');
      }).catch(err => window.showToast?.('That did not work: ' + ((err && err.message) || err), 'error'));
      const src = /^https?:/i.test(media.srcURL || '') ? media.srcURL : '';
      const mediaItems = [
        { label: flags.isPaused ? 'Play' : 'Pause', action: () => act(flags.isPaused ? 'el.play()' : 'el.pause()') },
        { label: flags.isLooping ? 'Stop Looping' : 'Loop', action: () => act('el.loop = !el.loop') },
        ...(flags.canToggleControls ? [{ label: flags.isControlsVisible ? 'Hide Controls' : 'Show Controls', action: () => act('el.controls = !el.controls') }] : []),
        ...(media.mediaType === 'video' && typeof PiPManager !== 'undefined' ? [{ label: 'Picture-in-Picture', action: () => PiPManager.toggle() }] : []),
        ...(src ? [
          { label: `Open ${noun === 'video' ? 'Video' : 'Sound'} in New Tab`, action: () => TabManager.createTab(src, true, null, { partition: webview.getAttribute?.('partition') }) },
          { label: `Copy ${noun === 'video' ? 'Video' : 'Sound'} Address`, action: () => navigator.clipboard.writeText(src).then(() => window.showToast?.('Address copied'), err => window.showToast?.('Could not copy: ' + err.message, 'error')) },
        ] : []),
      ];
      groups.push(() => this._pushGroup(items, mediaItems, (it) => /^(Play|Pause)$/.test(it.label), 'More for this ' + noun, 'video'));
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
    groups.reverse().forEach(add => add());
    items.push({ sep: true });
    items.push({ label: 'Page', icon: 'file', sub: pageItems });
    items.push({ label: 'This site', icon: 'globe', sub: siteItems });
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

    this._renderMenu(menu, items);

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

  // Let a page discover that it may ASK for notifications or a location.
  //
  // Electron's permission check is a plain yes/no, so anything nobody has
  // decided on reads as 'denied' to navigator.permissions.query. Sites check
  // that before asking, find "denied", and show their own "allow it in your
  // settings" message instead of asking: notifications (v2.32.85), and a
  // cinema site's "Konuma izin vermeniz gerekiyor" for location (2026-09-27).
  // So an undecided permission reads 'prompt', one allowed in Vex reads
  // 'granted', and one blocked still reads 'denied'. Injected into the page's
  // own world, where the site's own check will see it.
  // Whether this webview's page runs no scripts of its own: built without
  // JavaScript, or on a site whose JavaScript is switched off. Vex's own
  // reads of such a page (executeJavaScript) are refused there.
  scriptsOffIn(webview) {
    if (webview && webview._noScripts) return true;
    let url = '';
    try { url = webview.getURL() || ''; } catch { return false; }
    return !!(window.SiteRulesUI && typeof SiteRulesUI.scriptsOff === 'function' && SiteRulesUI.scriptsOff(url));
  },

  async _letSitesAsk(webview) {
    if (!window.vex || typeof window.vex.permissionsListForPage !== 'function') return false;
    let url = '';
    try { url = webview.getURL() || ''; } catch { return false; }
    if (!/^https?:/i.test(url)) return false;
    // Nothing can be asked of a page whose scripts are switched off.
    if (window.SiteRulesUI && typeof SiteRulesUI.scriptsOff === 'function' && SiteRulesUI.scriptsOff(url)) return false;
    let origin = '';
    try { origin = new URL(url).origin; } catch { return false; }
    let decisions = {};
    // The page's own session's decisions: a container keeps its own, and a
    // container tab was told what persist:main had decided (found 2026-09-30).
    try { decisions = (await window.vex.permissionsListForPage(webview.getWebContentsId())) || {}; } catch { return false; }
    const states = {
      notifications: this.shouldOfferNotificationPrompt(decisions, origin) ? 'prompt' : null,
      geolocation: this.permissionStateFor(decisions, origin, 'geolocation'),
    };
    await webview.executeJavaScript(`(() => {
      try {
        if (window.__vexPermAsk) return;
        window.__vexPermAsk = true;
        const S = ${JSON.stringify(states)};
        const N = window.Notification;
        // Chromium reports 'denied' where Vex means 'nobody has asked'.
        if (N && S.notifications === 'prompt') Object.defineProperty(N, 'permission', { configurable: true, get: () => 'default' });
        const query = navigator.permissions && navigator.permissions.query;
        if (query) {
          navigator.permissions.query = function (d) {
            const state = d && S[d.name];
            if (state) {
              return Promise.resolve({ state, status: state, name: d.name, onchange: null,
                addEventListener() {}, removeEventListener() {}, dispatchEvent() { return true; } });
            }
            return query.call(this, d);
          };
        }
      } catch (err) { console.warn('[Vex] could not correct the permission state:', err && err.message); }
    })()`);
    return true;
  },

  // What navigator.permissions.query should say about one permission, from
  // what the user decided in Vex.
  permissionStateFor(decisions, origin, name) {
    const saved = (decisions || {})[origin + '::' + name];
    if (saved === 'allow') return 'granted';
    if (saved === 'deny') return 'denied';
    return 'prompt';
  },

  // Should this origin be told it may ask? Only when nobody has decided yet:
  // a site that was blocked keeps reading 'denied', and one already granted
  // needs nothing.
  shouldOfferNotificationPrompt(decisions, origin) {
    const saved = (decisions || {})[origin + '::notifications'];
    return saved !== 'deny' && saved !== 'allow';
  },

  // What to paint behind a page, given what the page paints itself.
  //
  // Only a page that paints NOTHING is given anything: a background on <html>
  // stops the body's background propagating to the canvas, so a site that
  // styles only its body would get our colour showing through its margins.
  // And even then at zero specificity, so anything the page adds later wins.
  baseColourFor(seen) {
    if (!seen) return null;
    const painted = seen.html || seen.body;
    if (painted) return { element: painted, inject: null };
    const base = seen.dark ? '#202124' : '#ffffff';
    return { element: base, inject: ':where(html){background-color:' + base + '}' };
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
        const guess = `${u.origin}/favicon.ico`;
        // A tab in a session of its own: the icon it wore belongs to the page
        // it left, so it goes now, and the new one comes through the tab's
        // own session (_setFavicon).
        const tab = TabManager.tabs.find(t => t.id === tabId);
        if (tab && !TabManager.windowMayAsk(tab.partition)) {
          if (!this._ownIcons.has(tab.partition + ' ' + guess)) TabManager.updateTab(tabId, { favicon: null });
          this._setFavicon(tabId, guess);
          return;
        }
        // One that has already failed this session is not worth asking for
        // again (js/tabs.js). The real icon still arrives from the page's own
        // <link rel=icon> through page-favicon-updated.
        if (TabManager.isDeadFavicon && TabManager.isDeadFavicon(guess)) return;
        TabManager.updateTab(tabId, { favicon: guess });
      }
    } catch {}
  },

  // Icons of tabs in a session of their own — a container, a Tor or proxy
  // route, a private or Tor tab. Vex's window draws every tab's icon through
  // its own session, which is direct, so a Tor tab's site was shown the real
  // address on every redraw (found 2026-09-30). These are fetched through the
  // tab's own session instead (src/main/favicon-fetch.js) and worn as a data:
  // URL. If that session refuses (Tor down), the tab has no icon. Kept for
  // the run, by session and address.
  _ownIcons: new Map(),
  _ownIconMisses: new Set(),
  _ownIconPending: new Map(),
  _ownIconAsked: new Map(),
  OWN_ICONS_KEPT: 300,

  _setFavicon(tabId, url) {
    const tab = TabManager.tabs.find(t => t.id === tabId);
    if (!tab) return;
    if (TabManager.windowMayAsk(tab.partition) || !/^https?:/i.test(String(url))) {
      TabManager.updateTab(tabId, { favicon: url });
      return;
    }
    const key = tab.partition + ' ' + url;
    this._ownIconAsked.set(tabId, url);
    const wear = (dataUrl) => {
      // Only the latest address asked for this tab: it may have moved on.
      if (this._ownIconAsked.get(tabId) !== url) return;
      TabManager.updateTab(tabId, { favicon: dataUrl });
    };
    if (this._ownIcons.has(key)) { wear(this._ownIcons.get(key)); return; }
    if (this._ownIconMisses.has(key)) return;
    let pending = this._ownIconPending.get(key);
    if (!pending) {
      const wv = this.webviews.get(tabId);
      let pageId = 0;
      try { pageId = wv ? wv.getWebContentsId() : 0; } catch (err) {
        console.warn('[Vex] the favicon of a tab in its own session waits for its page:', err.message);
        return;
      }
      if (!pageId) return;
      pending = Promise.resolve(window.vex.tabFavicon(pageId, url)).then((r) => {
        if (r && r.ok) {
          if (this._ownIcons.size >= this.OWN_ICONS_KEPT) this._ownIcons.delete(this._ownIcons.keys().next().value);
          this._ownIcons.set(key, r.dataUrl);
          return r.dataUrl;
        }
        // The site said there is none: not asked again this run. A request
        // that never got through (Tor starting or down) is asked again on
        // the next page.
        if (r && r.answered) this._ownIconMisses.add(key);
        console.warn('[Vex] no favicon for a tab in its own session (' + url.slice(0, 120) + '):', (r && r.error) || 'no answer');
        return null;
      }).finally(() => this._ownIconPending.delete(key));
      this._ownIconPending.set(key, pending);
    }
    pending.then((dataUrl) => { if (dataUrl) wear(dataUrl); })
      .catch(err => console.error('[Vex] the favicon of a tab in its own session could not be fetched:', err.message));
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

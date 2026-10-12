// === Vex Picture-in-Picture (renderer side) ================================
//
// Extracted from app.js so it can be tested: the control bar in the pop-out
// lives in a CLOSED shadow root, so nothing outside the window can click it,
// and the only way to check what happens when it is pressed is to exercise
// this module directly.
//
// Two ways a video ends up floating:
//   1. NATIVE PiP inside the guest page — the good path. Chromium pops the
//      video element itself; the page keeps its place and there is only ever
//      one player.
//   2. The POP-OUT window (src/pip.js) — the fallback for a page that refuses
//      native PiP. It loads the SAME PAGE again in a small always-on-top
//      window, which means a second copy of the player. The source tab is
//      therefore muted and paused while the pop-out is up, and restored when
//      it closes: without that you hear the video twice, out of sync.
//
// Only the renderer knows which tab a pop-out came from (main is handed a
// URL), so it remembers it here and main tells it when the window goes away.
//
// Which video. The guest preload only sees videos in the top document, and it
// took the first one playing — on a page with a small autoplaying preview
// that was the preview, while the real player sat in a shadow root (custom
// player elements) or in an embedded frame it could not see at all (found
// 2026-10-03). The toolbar button, Ctrl+Shift+P and the command now look in
// every frame of the tab (page:eval-all-frames) and into open shadow roots,
// and float the largest playing video. The script below runs in each frame.

// Runs INSIDE each frame of the page (stringified). mode: 'scan' reports the
// frame's best video and whether the frame is in PiP; 'enter' floats the video
// the scan picked (only the frame holding `token` acts); 'exit' leaves PiP.
function vexPipFrame(mode, token, override) {
  const KEY = '__vexPipPick';
  if (mode === 'exit') {
    if (!document.pictureInPictureElement) return { inPip: false };
    return document.exitPictureInPicture().then(() => ({ inPip: false, exited: true }), (e) => ({ inPip: true, error: String((e && e.message) || e) }));
  }
  if (mode === 'enter') {
    const pick = window[KEY];
    if (!pick || pick.token !== token || !pick.el || !pick.el.isConnected) return { mine: false };
    const v = pick.el;
    if (v.disablePictureInPicture) {
      if (!override) return { mine: true, error: 'disabled' };
      // Only because the user said so, for this one video.
      v.disablePictureInPicture = false;
      v.removeAttribute('disablepictureinpicture');
    }
    return v.requestPictureInPicture().then(() => ({ mine: true, ok: true }), (e) => ({ mine: true, error: String((e && e.message) || e), name: (e && e.name) || '' }));
  }
  const videos = [];
  const walk = (root, depth) => {
    for (const v of root.querySelectorAll('video')) videos.push(v);
    if (depth > 6) return;
    const tw = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
    let n, seen = 0;
    while ((n = tw.nextNode()) && seen++ < 40000) if (n.shadowRoot) walk(n.shadowRoot, depth + 1);
  };
  walk(document, 0);
  // Closed shadow roots cannot be reached from outside; preload-webview.js keeps
  // a weak list of the ones made with mode "closed".
  const closed = window.__vexClosedRoots;
  if (Array.isArray(closed)) {
    for (const w of closed) {
      const r = w && typeof w.deref === 'function' ? w.deref() : null;
      if (r && r.host && r.host.isConnected) walk(r, 1);
    }
  }
  const vw = window.innerWidth || 0, vh = window.innerHeight || 0;
  let best = null, bestScore = -1;
  for (const v of videos) {
    if (!v.currentSrc && !v.src && !v.srcObject) continue;
    const r = v.getBoundingClientRect();
    const area = Math.max(0, r.width) * Math.max(0, r.height);
    const w = Math.max(0, Math.min(r.right, vw) - Math.max(r.left, 0));
    const h = Math.max(0, Math.min(r.bottom, vh) - Math.max(r.top, 0));
    const playing = !v.paused && !v.ended && v.readyState > 2;
    // Playing beats paused, then what you can see, then the size, then sound.
    const score = (playing ? 4e12 : 0) + (v.currentTime > 0 ? 1e12 : 0) + w * h * 1000 + area + (v.muted || v.volume === 0 ? 0 : 1);
    if (area > 0 && score > bestScore) { best = v; bestScore = score; }
  }
  const inPip = !!document.pictureInPictureElement;
  if (!best) return { inPip, count: videos.length, best: null };
  const id = Math.random().toString(36).slice(2) + Date.now().toString(36);
  window[KEY] = { token: id, el: best };
  const src = best.currentSrc || best.src || '';
  return {
    inPip,
    count: videos.length,
    best: {
      token: id,
      score: bestScore,
      playing: !best.paused && !best.ended,
      disabled: !!best.disablePictureInPicture,
      enabled: !!document.pictureInPictureEnabled,
      media: /^https?:/i.test(src) ? {
        src, currentTime: Number.isFinite(best.currentTime) ? best.currentTime : 0, paused: !!best.paused, muted: !!best.muted,
        poster: /^https?:/i.test(best.poster || '') ? best.poster : '', width: best.videoWidth || 0, height: best.videoHeight || 0,
        title: String(document.title || '').slice(0, 120),
      } : null,
    },
  };
}

const PiPManager = {
  videoDetected: false,
  AUTO_KEY: 'vex.autoPip',
  // Tabs whose video was floated by switching away from them, so coming back
  // puts the video back in the page.
  _autoTabs: new Set(),
  _lastActive: null,
  // { tabId, wasMuted } while a pop-out is up, else null.
  _source: null,
  _onMessage: null,

  // ---- the button over a video ----
  // 'hover' (default): shown near the corner of a video while the pointer moves
  // over it, gone after IDLE_MS of stillness or when the pointer leaves.
  // 'always': shown on any video the page reports. 'never': not at all; Ctrl+
  // Shift+P and the command bar still float it. Per device, and synced with the
  // other settings (the keys are in the sync list in app.js).
  MODE_KEY: 'vex.pipButton',
  SITES_KEY: 'vex.pipButtonOff',
  IDLE_MS: 2500,
  // How long the button stays after the page says the pointer left the video:
  // time to cross the few pixels onto the button itself.
  GRACE_MS: 400,
  // A pointer report this soon after the window saw the pointer leave is one
  // the page queued before it left.
  STALE_MS: 250,
  SIZE: 32,
  // page webview -> { g: last report from the page, over, lastMove, leftAt }
  _geo: new Map(),
  _pillWv: null,
  _pillHover: false,
  _pillTimer: 0,

  // Idempotent: a second init() replaces its listener instead of adding one.
  // Two live copies would each mute the source tab and then fight over
  // restoring it.
  init() {
    if (this._onMessage) window.removeEventListener('message', this._onMessage);
    // Video detection, and the guest telling us native PiP is impossible.
    this._onMessage = (e) => {
      if (e.data && e.data.type === 'vex-video-detected') {
        this.videoDetected = e.data.hasVideo;
        this._showButton();
      }
      if (e.data && e.data.type === 'vex-pip-fallback') {
        // The guest couldn't do native PiP. It sends what it knows about the
        // video; main floats the video alone when the source is a direct file,
        // and falls back to the whole page when it is an MSE/blob stream.
        const tab = TabManager.getActiveTab();
        if (!tab) return;
        this._openPopout(tab, e.data.media || null);
      }
    };
    window.addEventListener('message', this._onMessage);

    // A video playing in an embedded frame or a shadow root is invisible to
    // the guest's own video count, so the toolbar button never showed for it.
    // Chromium tells each <webview> when its media starts and stops, in any
    // frame; these events do not bubble but do pass the document on the way
    // down, so one capturing listener hears every tab.
    if (!this._onMedia) {
      this._onMedia = (ev) => {
        const wv = ev.target;
        if (!wv || wv.tagName !== 'WEBVIEW') return;
        wv._vexMediaPlaying = ev.type === 'media-started-playing';
        this._showButton();
      };
      document.addEventListener('media-started-playing', this._onMedia, true);
      document.addEventListener('media-paused', this._onMedia, true);
    }

    // Float a playing video when you switch away from its tab (off unless
    // turned on in Settings), and put it back when you return.
    if (!this._onTabs) {
      this._onTabs = () => this._tabsChanged();
      window.addEventListener('vex-tabs-changed', this._onTabs);
    }
    // A panel opening or closing changes which page the button is for.
    if (!this._onPanel) {
      this._onPanel = () => { this._showButton(); this._syncSettings(); };
      document.addEventListener('vex:panel-changed', this._onPanel);
    }
    // The pointer going onto any part of Vex's own window (the toolbar, the
    // sidebar, a menu) means it has left the video. The page is not always told
    // when the pointer leaves it for the window around, so without this the
    // button would stay until the idle time ran out.
    if (!this._onHostPointer) {
      this._onHostPointer = (ev) => {
        const t = ev.target;
        if (!t || t.nodeType !== 1 || t.tagName === 'WEBVIEW' || (t.closest && t.closest('#pip-btn'))) return;
        const now = Date.now();
        let changed = false;
        for (const e of this._geo.values()) {
          // A report the page had already queued about the pointer on the
          // video arrives after this (it is throttled); hostLeftAt lets
          // noteGeometry() tell it from the pointer coming back.
          e.hostLeftAt = now;
          if (e.over) { e.over = false; e.leftAt = now; changed = true; }
        }
        if (changed) this._showButton();
      };
      document.addEventListener('mouseover', this._onHostPointer, true);
    }
    // The window changing size moves the page under the button; the page
    // reports its own new layout shortly after, but until then the button
    // would sit where the video was.
    if (!this._onResize) {
      this._onResize = () => this._showButton();
      window.addEventListener('resize', this._onResize);
    }
    const modeSel = document.getElementById('setting-pip-button');
    if (modeSel && !modeSel._vexWired) {
      modeSel._vexWired = true;
      modeSel.addEventListener('change', () => {
        try { this.setMode(modeSel.value); }
        catch (err) { window.showToast?.('The Picture-in-Picture button setting could not be saved: ' + (err && err.message), 'error'); }
      });
    }
    const sitesClear = document.getElementById('setting-pip-sites-clear');
    if (sitesClear && !sitesClear._vexWired) {
      sitesClear._vexWired = true;
      sitesClear.addEventListener('click', () => {
        try { this.clearHiddenSites(); }
        catch (err) { window.showToast?.('That could not be saved: ' + (err && err.message), 'error'); }
      });
    }
    this._syncSettings();
    const autoToggle = document.getElementById('setting-auto-pip');
    if (autoToggle && !autoToggle._vexWired) {
      autoToggle._vexWired = true;
      autoToggle.checked = this.autoEnabled();
      autoToggle.addEventListener('change', () => {
        try { this.setAutoEnabled(autoToggle.checked); }
        catch (err) { window.showToast?.('Changed for now, but the setting could not be saved: ' + (err && err.message), 'error'); }
      });
    }

    // The pop-out has gone: give the tab its sound back, and for "Back to
    // tab" actually go back to the tab the video came from — the button says
    // so, and it used only to focus the window, leaving you on whatever tab
    // you happened to be on.
    window.vex?.onPipClosed?.((reason, at) => {
      const source = this._source;
      this._restoreSource(at);
      if (reason === 'back-to-tab' && source && source.panel) {
        // The video came from a web panel: bring that panel back.
        if (typeof SidebarManager !== 'undefined' && typeof SidebarManager.showPanel === 'function') SidebarManager.showPanel(source.panel);
        else window.showToast?.('That panel is closed now');
      } else if (reason === 'back-to-tab' && source && typeof TabManager !== 'undefined') {
        const tab = TabManager.tabs.find(t => t.id === source.tabId);
        if (tab) TabManager.switchTab(tab.id);
        else window.showToast?.('That tab is closed now');
      }
    });

    // The button: it floats the video of the page it is drawn on. Only the
    // button takes the pointer; the page around it is untouched.
    const pipBtn = document.getElementById('pip-btn');
    if (pipBtn && !pipBtn._vexWired) {
      pipBtn._vexWired = true;
      pipBtn.addEventListener('click', () => this._pillClick());
      pipBtn.addEventListener('contextmenu', (ev) => { ev.preventDefault(); this._pillMenu(ev); });
      pipBtn.addEventListener('mouseenter', () => { this._pillHover = true; });
      pipBtn.addEventListener('mouseleave', () => {
        this._pillHover = false;
        const e = this._pillWv && this._geo.get(this._pillWv);
        if (e) e.leftAt = Date.now();
        this._showButton();
      });
    }
  },

  // ---- settings ----
  mode() {
    try { const v = localStorage.getItem(this.MODE_KEY); return v === 'always' || v === 'never' ? v : 'hover'; }
    catch { return 'hover'; }
  },
  setMode(m) {
    if (m !== 'hover' && m !== 'always' && m !== 'never') throw new Error('Unknown Picture-in-Picture button setting: ' + m);
    if (m === 'hover') localStorage.removeItem(this.MODE_KEY); else localStorage.setItem(this.MODE_KEY, m);
    this._showButton();
    this._syncSettings();
    return m;
  },
  hiddenSites() {
    try {
      const a = JSON.parse(localStorage.getItem(this.SITES_KEY) || '[]');
      return Array.isArray(a) ? a.filter(h => typeof h === 'string' && h) : [];
    } catch { return []; }
  },
  siteHidden(host) { return !!host && this.hiddenSites().includes(String(host).toLowerCase()); },
  hideSite(host) {
    const h = String(host || '').toLowerCase();
    if (!h) throw new Error('This page has no site name to hide the button on');
    const list = this.hiddenSites();
    if (!list.includes(h)) list.push(h);
    localStorage.setItem(this.SITES_KEY, JSON.stringify(list));
    this._showButton();
    this._syncSettings();
  },
  clearHiddenSites() {
    localStorage.removeItem(this.SITES_KEY);
    this._showButton();
    this._syncSettings();
  },
  // Settings shows the choice and, when there are any, the sites it is off on.
  _syncSettings() {
    const sel = document.getElementById('setting-pip-button');
    if (sel && sel.value !== this.mode()) sel.value = this.mode();
    const row = document.getElementById('setting-pip-sites-row');
    if (!row) return;
    const sites = this.hiddenSites();
    row.style.display = sites.length ? '' : 'none';
    const text = document.getElementById('setting-pip-sites-text');
    if (text) text.textContent = 'Picture-in-Picture button hidden for ' + sites.join(', ');
  },

  // Mute and pause the tab the pop-out is showing, so the same video isn't
  // playing twice. The mute is remembered so a tab you had already muted
  // yourself doesn't get un-muted on the way back.
  // `panel` names the web panel the page is in, when it is not a tab.
  _silenceSource(tabId, panelWv, panel) {
    const wv = panelWv || WebviewManager.webviews.get(tabId);
    // Remember the tab regardless: "Back to tab" has to work even for a tab
    // with no live webview (asleep, or discarded while the pop-out was up).
    if (!wv) { this._source = { tabId, wasMuted: true }; return; }
    let wasMuted = false;
    try { wasMuted = typeof wv.isAudioMuted === 'function' ? wv.isAudioMuted() : false; } catch { wasMuted = false; }
    this._source = { tabId, wasMuted, ...(panel ? { panel, wv } : {}) };
    try { wv.setAudioMuted(true); } catch (err) { console.warn('[PiP] could not mute the source tab:', err && err.message); }
    // Pause as well: muting alone leaves it running down the video, so
    // coming back would drop you minutes further on than you left off.
    try {
      wv.executeJavaScript('document.querySelectorAll("video,audio").forEach(m=>{try{m.pause()}catch(e){}})')
        .catch(err => console.warn('[PiP] could not pause the source tab:', err && err.message));
    } catch (err) { console.warn('[PiP] could not reach the source tab:', err && err.message); }
  },

  // `at` is where the floating player got to. Without it you would come back
  // to the tab paused at the moment you popped it out, having watched five
  // minutes in the little window.
  _restoreSource(at) {
    const source = this._source;
    this._source = null;
    if (!source) return;
    const wv = source.wv || WebviewManager.webviews.get(source.tabId);
    if (!wv) return;                       // the tab was closed meanwhile
    if (Number.isFinite(at) && at > 0) {
      try { wv.send('vex-pip-resume', at); }
      catch (err) { console.warn('[PiP] could not move the page video to where the pop-out got to:', err && err.message); }
    }
    if (source.wasMuted) return;           // it was muted before PiP; leave it
    try { wv.setAudioMuted(false); } catch (err) { console.warn('[PiP] could not un-mute the source tab:', err && err.message); }
  },

  // `opts.target` ({ wv, panel, tab }) floats that page's video only: the
  // button over a video means THAT video, not whichever scores best.
  async toggle(opts) {
    // If the pop-out PiP window is up, this press closes it. The button and
    // Ctrl+Shift+P are advertised as a toggle but previously had no way of
    // turning PiP back off at all.
    if (window.vex?.isPipOpen && await window.vex.isPipOpen()) {
      await window.vex.closePipWindow();
      return;
    }

    const wv = WebviewManager.getActiveWebview();
    const targets = opts && opts.target ? [opts.target] : this._targets();
    if (!targets.length && (!wv || typeof wv.send !== 'function')) {
      window.showToast?.('No page to put in Picture-in-Picture', 'error');
      return;
    }
    if (window.vex && typeof window.vex.evalAllFrames === 'function' && targets.length) {
      return this._floatFrom(targets, { interactive: true });
    }
    if (!wv || typeof wv.send !== 'function') {
      window.showToast?.('No page to put in Picture-in-Picture', 'error');
      return;
    }
    // Ask the guest to toggle native PiP over the webview IPC channel
    // (wv.contentWindow.postMessage doesn't reach the guest across processes).
    // If the guest can't, it answers 'vex-pip-fallback' and the handler above
    // opens the pop-out. There is deliberately no timer here: the old one
    // checked document.pictureInPictureElement on the HOST document, which is
    // always null because native PiP happens in the GUEST document — so the
    // pop-out opened on EVERY press, even when native PiP had just succeeded.
    wv.send('vex-request-pip');
  },

  // The pages the video you mean can be in: the web panels showing now (a pinned
  // site such as Disney+ in the sidebar) and the tab in front. The button and
  // Ctrl+Shift+P used to look only at the tab, so a video in a panel was "no
  // video on this page" (owner's report, 2026-10-12).
  _targets() {
    const out = [];
    if (typeof SidebarManager !== 'undefined' && SidebarManager && SidebarManager.panelWebviews) {
      for (const name of [SidebarManager.activePanel, SidebarManager.sidePanel]) {
        const w = name && SidebarManager.panelWebviews[name];
        if (!w || w.isConnected === false || typeof w.getWebContentsId !== 'function' || out.some(t => t.wv === w)) continue;
        out.push({ wv: w, panel: name, tab: null });
      }
    }
    let wv = null;
    try { wv = WebviewManager.getActiveWebview(); } catch (err) { console.warn('[PiP] no page in front:', err && err.message); }
    if (wv && typeof wv.getWebContentsId === 'function' && !out.some(t => t.wv === wv)) {
      out.push({ wv, panel: null, tab: typeof TabManager !== 'undefined' ? TabManager.getActiveTab() : null });
    }
    return out;
  },

  // What the pop-out and the silencing need to know about a page that is not a
  // tab: its address, its webview and the panel's name.
  _panelTab(t) {
    if (t.tab) return t.tab;
    let url = '';
    try { url = t.wv.getURL(); } catch (err) { console.warn('[PiP] the panel has no page yet:', err && err.message); }
    return { id: 'panel:' + t.panel, url, wv: t.wv, panel: t.panel };
  },

  // Float the best video among these pages: the one already floating (to bring
  // it back), else the one with the best score, the page you last clicked in
  // winning a tie.
  async _floatFrom(targets, o) {
    if (targets.length === 1) return this.floatTab(targets[0].wv, { ...o, tab: this._panelTab(targets[0]) });
    const scans = await Promise.all(targets.map(async (t) => {
      try { return { t, scan: await this._frames(t.wv, 'scan') }; }
      catch (err) { return { t, error: err }; }
    }));
    const reached = scans.filter(s => s.scan);
    if (!reached.length) {
      if (o.interactive) window.showToast?.('Picture-in-Picture could not reach this page: ' + scans[0].error.message, 'error');
      return 'failed';
    }
    const floating = reached.find(s => s.scan.some(f => f.inPip));
    let chosen = floating;
    if (!chosen) {
      const focused = document.activeElement;
      const scoreOf = (s) => Math.max(-1, ...s.scan.map(f => (f.best ? f.best.score : -1)));
      chosen = reached.slice().sort((a, b) => (scoreOf(b) - scoreOf(a)) || ((b.t.wv === focused) - (a.t.wv === focused)))[0];
    }
    return this.floatTab(chosen.t.wv, { ...o, tab: this._panelTab(chosen.t), scan: chosen.scan });
  },

  // A web panel's own PiP button (the overlay on its video) asked for the
  // pop-out. It used to be dropped, because only tabs relayed the message.
  popoutPanel(panel, wv, media) {
    return this._openPopout(this._panelTab({ wv, panel, tab: null }), media || null);
  },

  // A page told us where its video is and where the pointer is (guest
  // preload-webview.js, "vex-pip-geometry"). `panel` names the web panel the
  // page is in, null for a tab.
  noteGeometry(wv, g, panel) {
    if (!wv || !g || typeof g !== 'object') return;
    const now = Date.now();
    let e = this._geo.get(wv);
    if (!e) { e = { g: null, panel: null, over: false, lastMove: 0, leftAt: 0 }; this._geo.set(wv, e); }
    const wasOver = e.over;
    e.g = g;
    e.panel = panel || null;
    // A report that is not about the pointer (the page scrolled, a video
    // started) repeats where the pointer last was and says nothing new about
    // whether it is still there: the window around the page sees it leave
    // (the mouseover handler in init()), the page may not.
    if (g.ptr !== 0) {
      const stale = g.over && e.hostLeftAt && now - e.hostLeftAt < this.STALE_MS;
      e.over = !!g.over && !stale;
      if (e.over) e.lastMove = now; else if (wasOver) e.leftAt = now;
    }
    this._showButton();
  },

  // Where the button goes now, or null for nowhere. Pure of the DOM except for
  // the rect of the page and a check that nothing (a menu, a dialog, a panel)
  // is on top of it.
  _plan(now) {
    const mode = this.mode();
    if (mode === 'never') return null;
    let targets = [];
    try { targets = this._targets(); } catch (err) { console.warn('[PiP] no pages to place the button on:', err && err.message); }
    let best = null, bestScore = -1;
    for (const [wv, e] of [...this._geo]) {
      if (!wv || wv.isConnected === false) { this._geo.delete(wv); continue; }
      const g = e.g;
      if (!g || !g.rect || !g.btn || !(g.vw > 0)) continue;
      if (!targets.some(t => t.wv === wv)) continue;           // a page that is not showing
      if (this.siteHidden(g.host)) continue;
      // A video inside another site's frame: only believed while Chromium says
      // the page is playing something, or any ad frame would get the button.
      if (g.frame && !wv._vexMediaPlaying) continue;
      const onButton = this._pillHover && this._pillWv === wv;
      // A frame hides the pointer's movement from the page; being over it is all
      // there is to go on, so it stays while the pointer is.
      const moved = e.over && (g.frame || now - e.lastMove <= this.IDLE_MS);
      const justLeft = !e.over && e.leftAt && now - e.leftAt <= this.GRACE_MS;
      let show;
      if (g.fullscreen) show = moved || onButton;               // never over a fullscreen video at rest
      else if (mode === 'always') show = true;
      else show = moved || justLeft || onButton;
      if (!show) continue;
      const score = (onButton ? 4 : 0) + (moved ? 2 : 0) + (g.playing ? 1 : 0);
      if (score > bestScore) { best = { wv, e }; bestScore = score; }
    }
    if (!best) return null;
    const { wv, e } = best;
    let r;
    try { r = wv.getBoundingClientRect(); } catch (err) { console.warn('[PiP] could not measure the page:', err && err.message); return null; }
    if (!r || !(r.width > 0) || !(r.height > 0)) return null;
    const s = r.width / e.g.vw;
    const size = this.SIZE;
    const x = Math.min(Math.max(r.left + e.g.btn.x * s, r.left), r.right - size);
    const y = Math.min(Math.max(r.top + e.g.btn.y * s, r.top), r.bottom - size);
    // Hide rather than draw over a menu or a dialog (a panel on top of the page).
    if (typeof document.elementFromPoint === 'function') {
      const top = document.elementFromPoint(x + size / 2, y + size / 2);
      const pipBtn = document.getElementById('pip-btn');
      if (top && top !== wv && !(pipBtn && pipBtn.contains(top)) && !wv.contains(top)) return null;
    }
    // Come back to re-check when the idle period or the grace runs out; there
    // is nothing to wait for when it is shown regardless (Always show).
    let next = 0;
    if (mode !== 'always' || e.g.fullscreen) {
      let left = 0;
      if (!e.g.frame && e.over) left = this.IDLE_MS - (now - e.lastMove);
      else if (!e.over && e.leftAt) left = this.GRACE_MS - (now - e.leftAt);
      if (left > 0) next = left + 30;
    }
    return { wv, x, y, size, corner: e.g.btn.corner, next };
  },

  // Draw the button where _plan() says, or take it away.
  _showButton() {
    const pipBtn = document.getElementById('pip-btn');
    if (!pipBtn) return;
    if (this._pillTimer) { clearTimeout(this._pillTimer); this._pillTimer = 0; }
    const plan = this._plan(Date.now());
    if (!plan) {
      pipBtn.style.display = 'none';
      this._pillWv = null;
      this._pillHover = false;
      return;
    }
    this._pillWv = plan.wv;
    pipBtn.style.left = Math.round(plan.x) + 'px';
    pipBtn.style.top = Math.round(plan.y) + 'px';
    pipBtn.dataset.corner = plan.corner || '';
    pipBtn.style.display = 'flex';
    if (plan.next > 0) this._pillTimer = setTimeout(() => { this._pillTimer = 0; this._showButton(); }, plan.next);
  },

  _pillClick() {
    const wv = this._pillWv;
    const target = wv ? this._targets().find(t => t.wv === wv) : null;
    return this.toggle(target ? { target } : undefined);
  },

  // Right-click on the button: leave it off on this site, or change how it shows.
  _pillMenu(ev) {
    const e = this._pillWv && this._geo.get(this._pillWv);
    const host = e && e.g && e.g.host;
    const t = (s) => (typeof VexI18nUI !== 'undefined' && VexI18nUI.lookup ? VexI18nUI.lookup(s) : null) || s;
    const items = [];
    if (host) {
      items.push({ label: t("Don't show here"), action: () => {
        try {
          this.hideSite(host);
          window.showToast?.('The Picture-in-Picture button is hidden on ' + host + '. Settings brings it back.');
        } catch (err) { window.showToast?.('That could not be saved: ' + (err && err.message), 'error'); }
      } });
    }
    const mode = this.mode();
    const set = (m) => () => {
      try { this.setMode(m); } catch (err) { window.showToast?.('That could not be saved: ' + (err && err.message), 'error'); }
    };
    if (mode !== 'hover') items.push({ label: t('Show only when I hover a video'), action: set('hover') });
    if (mode !== 'always') items.push({ label: t('Always show on videos'), action: set('always') });
    items.push({ label: t('Never show (use Ctrl+Shift+P)'), action: set('never') });
    return this._openMenu(items, ev.clientX, ev.clientY);
  },

  _openMenu(items, x, y) {
    document.querySelectorAll('.tab-context-menu, .tab-group-context-menu, .context-menu-overlay').forEach(m => m.remove());
    const menu = document.createElement('div');
    menu.className = 'tab-context-menu';
    menu.style.left = x + 'px';
    menu.style.top = y + 'px';
    const dismiss = () => {
      if (typeof TabManager !== 'undefined' && typeof TabManager._dismissMenu === 'function') TabManager._dismissMenu(menu);
      else menu.remove();
    };
    for (const item of items) {
      const el = document.createElement('div');
      el.className = 'tab-context-item';
      el.textContent = item.label;
      el.addEventListener('click', () => { dismiss(); item.action(); });
      menu.appendChild(el);
    }
    document.body.appendChild(menu);
    if (typeof TabManager !== 'undefined' && typeof TabManager._clampMenuToViewport === 'function') TabManager._clampMenuToViewport(menu, x, y);
    if (typeof TabManager !== 'undefined' && typeof TabManager._attachMenuDismissal === 'function') TabManager._attachMenuDismissal(menu);
    else {
      const close = () => { menu.remove(); document.removeEventListener('click', onClick, true); document.removeEventListener('keydown', onKey, true); };
      const onClick = (ev) => { if (!menu.contains(ev.target)) close(); };
      const onKey = (ev) => { if (ev.key === 'Escape') close(); };
      setTimeout(() => { document.addEventListener('click', onClick, true); document.addEventListener('keydown', onKey, true); }, 0);
    }
    return menu;
  },

  // The pop-out window: for a frame that may not use native PiP (a site's
  // permissions policy) or a video Chromium will not float.
  _openPopout(tab, media) {
    if (!tab || !window.vex?.openPipWindow) return Promise.resolve(false);
    // The tab's page, so main opens the pop-out in the tab's own session: a
    // Tor or private tab's video is never fetched outside it.
    const wv = tab.wv || WebviewManager.webviews.get(tab.id);
    let pageId = 0;
    try { pageId = wv && typeof wv.getWebContentsId === 'function' ? wv.getWebContentsId() : 0; }
    catch (err) { console.warn('[PiP] the tab has no page yet:', err && err.message); }
    if (!(pageId > 0)) { window.showToast?.('Picture-in-Picture is not available for this page', 'error'); return Promise.resolve(false); }
    return Promise.resolve(window.vex.openPipWindow(tab.url, media || null, pageId)).then(result => {
      // main rejects non-http(s) URLs (safePipUrl) and returns false on a
      // creation failure; say so instead of silently doing nothing.
      if (!result || result.ok === false) { window.showToast?.('Picture-in-Picture is not available for this page', 'error'); return false; }
      this._silenceSource(tab.id, tab.panel ? wv : null, tab.panel || null);
      if (result.mode === 'page') {
        window.showToast?.('This site streams its video in pieces, so the whole page is floating instead');
      }
      return true;
    }).catch(err => {
      window.showToast?.('Picture-in-Picture failed: ' + ((err && err.message) || 'unknown'), 'error');
      return false;
    });
  },

  // Run the frame script in every frame of a tab. As a user gesture: Chromium
  // only floats a video in answer to one.
  async _frames(wv, mode, token, override) {
    const code = '(' + vexPipFrame.toString() + ')(' + JSON.stringify(mode) + ',' + JSON.stringify(token || '') + ',' + (override ? 'true' : 'false') + ')';
    if (wv.isConnected === false) throw new Error('The tab was closed');
    const r = await window.vex.evalAllFrames(wv.getWebContentsId(), code, true);
    if (!r || !r.ok) throw new Error((r && r.error) || 'The page did not answer');
    return (r.results || []).filter(x => x && x.ok && x.value).map(x => x.value);
  },

  // Float the main video of a tab, or bring it back if it is already floating.
  // → 'exited' | 'entered' | 'popout' | 'none' | 'declined' | 'disabled' | 'failed'
  async floatTab(wv, opts) {
    const o = opts || {};
    const say = (msg, type) => { if (o.interactive) window.showToast?.(msg, type); };
    let scan = o.scan;                // already taken, when several pages were compared
    if (!scan) {
      try { scan = await this._frames(wv, 'scan'); }
      catch (err) { say('Picture-in-Picture could not reach this page: ' + err.message, 'error'); return 'failed'; }
    }
    if (scan.some(f => f.inPip)) {
      if (o.auto === 'enter') return 'none';           // already floating
      try { await this._frames(wv, 'exit'); } catch (err) { say('Could not bring the video back: ' + err.message, 'error'); return 'failed'; }
      return 'exited';
    }
    if (o.auto === 'exit') return 'none';
    const best = scan.map(f => f.best).filter(Boolean).sort((a, b) => b.score - a.score)[0];
    if (!best) { say('There is no video on this page'); return 'none'; }
    if (o.auto && !best.playing) return 'none';
    let override = false;
    if (best.disabled) {
      if (!o.interactive) return 'disabled';
      const yes = typeof window.vexConfirm === 'function' && await window.vexConfirm({
        title: 'Picture-in-Picture is turned off here',
        message: 'This site has turned off Picture-in-Picture for this video. Float it anyway?',
        okLabel: 'Float it',
        cancelLabel: 'Leave it',
      });
      if (!yes) return 'declined';
      override = true;
    }
    if (!best.enabled) {
      if (!o.interactive) return 'none';
      return (await this._openPopout(o.tab, best.media)) ? 'popout' : 'failed';
    }
    let res;
    try { res = await this._frames(wv, 'enter', best.token, override); }
    catch (err) { say('Picture-in-Picture failed: ' + err.message, 'error'); return 'failed'; }
    const mine = res.find(r => r.mine);
    if (mine && mine.ok) return 'entered';
    if (!o.interactive) return 'failed';
    console.warn('[PiP] native Picture-in-Picture refused, using the pop-out:', mine ? mine.error : 'the video went away');
    return (await this._openPopout(o.tab, best.media)) ? 'popout' : 'failed';
  },

  // ---- float on tab switch ----
  autoEnabled() { try { return localStorage.getItem(this.AUTO_KEY) === 'on'; } catch { return false; } },
  setAutoEnabled(on) {
    if (on) localStorage.setItem(this.AUTO_KEY, 'on'); else localStorage.removeItem(this.AUTO_KEY);
    if (!on) this._autoTabs.clear();
    return !!on;
  },

  _tabsChanged() {
    if (typeof TabManager === 'undefined') return;
    const now = TabManager.activeTabId;
    const prev = this._lastActive;
    this._lastActive = now;
    if (!prev || prev === now) return;
    const views = (typeof WebviewManager !== 'undefined' && WebviewManager.webviews) ? WebviewManager.webviews : new Map();
    if (!window.vex || typeof window.vex.evalAllFrames !== 'function') return;
    // Coming back to a tab whose video we floated: put it back in the page.
    if (this._autoTabs.has(now)) {
      this._autoTabs.delete(now);
      const back = views.get(now);
      if (back) this.floatTab(back, { auto: 'exit' }).catch(err => console.warn('[PiP] could not bring the video back:', err && err.message));
    }
    if (!this.autoEnabled()) return;
    const left = views.get(prev);
    if (!left || !TabManager.tabs.some(t => t.id === prev)) return;
    this.floatTab(left, { auto: 'enter' }).then((r) => {
      if (r === 'entered') this._autoTabs.add(prev);
    }).catch(err => console.warn('[PiP] could not float the video of the tab you left:', err && err.message));
  },
};

if (typeof window !== "undefined") window.PiPManager = PiPManager;
if (typeof module !== "undefined" && module.exports) module.exports = { PiPManager, vexPipFrame };

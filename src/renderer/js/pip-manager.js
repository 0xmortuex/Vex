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
      if (reason === 'back-to-tab' && source && typeof TabManager !== 'undefined') {
        const tab = TabManager.tabs.find(t => t.id === source.tabId);
        if (tab) TabManager.switchTab(tab.id);
        else window.showToast?.('That tab is closed now');
      }
    });

    // PiP button click
    const pipBtn = document.getElementById('pip-btn');
    if (pipBtn) {
      pipBtn.addEventListener('click', () => this.toggle());
    }
  },

  // Mute and pause the tab the pop-out is showing, so the same video isn't
  // playing twice. The mute is remembered so a tab you had already muted
  // yourself doesn't get un-muted on the way back.
  _silenceSource(tabId) {
      const wv = WebviewManager.webviews.get(tabId);
    // Remember the tab regardless: "Back to tab" has to work even for a tab
    // with no live webview (asleep, or discarded while the pop-out was up).
    if (!wv) { this._source = { tabId, wasMuted: true }; return; }
    let wasMuted = false;
    try { wasMuted = typeof wv.isAudioMuted === 'function' ? wv.isAudioMuted() : false; } catch { wasMuted = false; }
    this._source = { tabId, wasMuted };
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
    const wv = WebviewManager.webviews.get(source.tabId);
    if (!wv) return;                       // the tab was closed meanwhile
    if (Number.isFinite(at) && at > 0) {
      try { wv.send('vex-pip-resume', at); }
      catch (err) { console.warn('[PiP] could not move the page video to where the pop-out got to:', err && err.message); }
    }
    if (source.wasMuted) return;           // it was muted before PiP; leave it
    try { wv.setAudioMuted(false); } catch (err) { console.warn('[PiP] could not un-mute the source tab:', err && err.message); }
  },

  async toggle() {
    // If the pop-out PiP window is up, this press closes it. The button and
    // Ctrl+Shift+P are advertised as a toggle but previously had no way of
    // turning PiP back off at all.
    if (window.vex?.isPipOpen && await window.vex.isPipOpen()) {
      await window.vex.closePipWindow();
      return;
    }

    const wv = WebviewManager.getActiveWebview();
    if (!wv || typeof wv.send !== 'function') {
      window.showToast?.('No page to put in Picture-in-Picture', 'error');
      return;
    }
    if (window.vex && typeof window.vex.evalAllFrames === 'function' && typeof wv.getWebContentsId === 'function') {
      const tab = TabManager.getActiveTab();
      return this.floatTab(wv, { interactive: true, tab });
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

  _showButton() {
    const pipBtn = document.getElementById('pip-btn');
    if (!pipBtn) return;
    let wv = null;
    try { wv = WebviewManager.getActiveWebview(); } catch { wv = null; }
    pipBtn.style.display = (this.videoDetected || (wv && wv._vexMediaPlaying)) ? 'flex' : 'none';
  },

  // The pop-out window: for a frame that may not use native PiP (a site's
  // permissions policy) or a video Chromium will not float.
  _openPopout(tab, media) {
    if (!tab || !window.vex?.openPipWindow) return Promise.resolve(false);
    return Promise.resolve(window.vex.openPipWindow(tab.url, media || null)).then(result => {
      // main rejects non-http(s) URLs (safePipUrl) and returns false on a
      // creation failure; say so instead of silently doing nothing.
      if (!result || result.ok === false) { window.showToast?.('Picture-in-Picture is not available for this page', 'error'); return false; }
      this._silenceSource(tab.id);
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
    let scan;
    try { scan = await this._frames(wv, 'scan'); }
    catch (err) { say('Picture-in-Picture could not reach this page: ' + err.message, 'error'); return 'failed'; }
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

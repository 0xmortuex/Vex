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
const PiPManager = {
  videoDetected: false,
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
        const pipBtn = document.getElementById('pip-btn');
        if (pipBtn) {
          pipBtn.style.display = e.data.hasVideo ? 'flex' : 'none';
        }
      }
      if (e.data && e.data.type === 'vex-pip-fallback') {
        // The guest couldn't do native PiP. It sends what it knows about the
        // video; main floats the video alone when the source is a direct file,
        // and falls back to the whole page when it is an MSE/blob stream.
        const tab = TabManager.getActiveTab();
        if (!tab || !window.vex?.openPipWindow) return;
        const media = e.data.media || null;
        Promise.resolve(window.vex.openPipWindow(tab.url, media)).then(result => {
          // main rejects non-http(s) URLs (safePipUrl) and returns false on a
          // creation failure; say so instead of silently doing nothing.
          if (!result || result.ok === false) { window.showToast?.('Picture-in-Picture is not available for this page', 'error'); return; }
          this._silenceSource(tab.id);
          if (result.mode === 'page') {
            window.showToast?.('This site streams its video in pieces, so the whole page is floating instead');
          }
        }).catch(err => {
          window.showToast?.('Picture-in-Picture failed: ' + ((err && err.message) || 'unknown'), 'error');
        });
      }
    };
    window.addEventListener('message', this._onMessage);

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
    // Ask the guest to toggle native PiP over the webview IPC channel
    // (wv.contentWindow.postMessage doesn't reach the guest across processes).
    // If the guest can't, it answers 'vex-pip-fallback' and the handler above
    // opens the pop-out. There is deliberately no timer here: the old one
    // checked document.pictureInPictureElement on the HOST document, which is
    // always null because native PiP happens in the GUEST document — so the
    // pop-out opened on EVERY press, even when native PiP had just succeeded.
    wv.send('vex-request-pip');
  }
};

if (typeof window !== "undefined") window.PiPManager = PiPManager;
if (typeof module !== "undefined" && module.exports) module.exports = { PiPManager };

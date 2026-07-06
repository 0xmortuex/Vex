// === Site tweaks: per-site main-world patches ===
//
// Dual-mode file:
//   - As a PRELOAD (registered via session.setPreloads alongside
//     preload-webview.js) it applies the matching tweaks itself. It must stay
//     self-contained: webview preloads run SANDBOXED (Electron ≥20 default),
//     where require() only resolves 'electron' — a local require from
//     preload-webview.js silently fails, which is why this is its own preload
//     (verified 2026-07-07: a require('./site-tweaks') from the main preload
//     never applied under default sandboxing).
//   - As a MODULE (require'd from tests / main process) it just exports the
//     registry; the applier is guarded by a DOM check so importing it in Node
//     is side-effect-free.
//
// Entry fields:
//   name      — identifier (logs/tests)
//   hosts     — RegExp matched against location.hostname
//   mechanism — how to reach the page's MAIN world (preloads run isolated):
//               'webFrame'   — webFrame.executeJavaScript. Not subject to page
//                              CSP; use this unless proven unnecessary.
//               'dom-script' — inject a <script> element. Subject to page CSP
//                              (TikTok's blocks it — verified 2026-07-07), but
//                              runs synchronously before any parser-created
//                              script, which the Discord visibility spoof
//                              relies on to win the race against Discord's own
//                              visibility listeners.
//   code      — self-contained main-world source. Must swallow its own errors:
//               it runs inside untrusted pages.
'use strict';

const SITE_TWEAKS = [
  {
    // Keep Discord (in the Vex panel) always "visible" to its own app logic.
    // The panel is display:none whenever you switch to another tab, which
    // flips the page's visibilityState to 'hidden'. Discord reacts by tearing
    // down its gateway WebSocket and, when it can't resume on return, does a
    // full reload — the "random disconnection → loading screen". Spoofing the
    // Page Visibility API stops the reconnect/reload. Scoped to Discord so
    // other sites' visibility behaviour (video auto-pause, etc.) is untouched.
    name: 'discord-always-visible',
    hosts: /(^|\.)(discord\.com|discordapp\.com)$/i,
    mechanism: 'dom-script',
    code: '(function(){try{' +
      'var vis=function(){return "visible";};' +
      'Object.defineProperty(document,"visibilityState",{get:vis,configurable:true});' +
      'Object.defineProperty(document,"webkitVisibilityState",{get:vis,configurable:true});' +
      'Object.defineProperty(document,"hidden",{get:function(){return false;},configurable:true});' +
      'Object.defineProperty(document,"webkitHidden",{get:function(){return false;},configurable:true});' +
      'var block=function(e){e.stopImmediatePropagation();};' +
      'window.addEventListener("visibilitychange",block,true);' +
      'document.addEventListener("visibilitychange",block,true);' +
      'window.addEventListener("webkitvisibilitychange",block,true);' +
      'document.addEventListener("webkitvisibilitychange",block,true);' +
      'try{Object.defineProperty(document,"hasFocus",{value:function(){return true;},configurable:true,writable:true});}catch(e){}' +
      '}catch(e){}})();',
  },
  {
    // Hide HEVC/H.265 support from short-video sites. They probe the browser
    // (MediaSource.isTypeSupported / canPlayType / mediaCapabilities) and
    // serve bytevc1 (H.265) streams when it says yes. Electron's codec probes
    // answer "yes" because the platform-HEVC path exists, but the actual
    // hardware decode fails on some GPU setups, leaving one frozen keyframe
    // while the audio track plays on (observed on TikTok, 2026-07-07; HEVC is
    // still advertised on Electron 42). Rejecting HEVC makes these sites fall
    // back to H.264 (avc1), which decodes everywhere. instagram.com is
    // included because Reels serve HEVC the same way with the same failure
    // mode; the fallback cost there is only slightly higher bitrate. Scoped
    // to these hosts so sites where HEVC playback works keep it.
    name: 'hevc-mask',
    hosts: /(^|\.)(tiktok\.com|instagram\.com)$/i,
    mechanism: 'webFrame',
    code: '(function(){try{' +
      'var bad=/hev1|hvc1|hevc/i;' +
      'if(window.MediaSource&&MediaSource.isTypeSupported){' +
        'var mso=MediaSource.isTypeSupported.bind(MediaSource);' +
        'MediaSource.isTypeSupported=function(t){return bad.test(String(t))?false:mso(t);};' +
      '}' +
      'var cpt=HTMLMediaElement.prototype.canPlayType;' +
      'HTMLMediaElement.prototype.canPlayType=function(t){return bad.test(String(t))?"":cpt.call(this,t);};' +
      'if(navigator.mediaCapabilities&&navigator.mediaCapabilities.decodingInfo){' +
        'var di=navigator.mediaCapabilities.decodingInfo.bind(navigator.mediaCapabilities);' +
        'navigator.mediaCapabilities.decodingInfo=function(cfg){' +
          'try{if(cfg&&cfg.video&&bad.test(String(cfg.video.contentType)))' +
            'return Promise.resolve({supported:false,smooth:false,powerEfficient:false,keySystemAccess:null});' +
          '}catch(e){}' +
          'return di(cfg);};' +
      '}' +
      '}catch(e){}})();',
  },
];

// Entries whose hosts pattern matches `hostname`.
function tweaksForHost(hostname) {
  return SITE_TWEAKS.filter((t) => {
    try { return t.hosts.test(hostname); } catch { return false; }
  });
}

// --- Applier: runs only when loaded as a preload (DOM present) ---
// The preload runs before the parser creates <html>, so the dom-script path
// waits for documentElement instead of a plain appendChild (which would
// silently no-op while documentElement is still null).
(function () {
  if (typeof document === 'undefined' || typeof location === 'undefined') return;
  let tweaks;
  try { tweaks = tweaksForHost(location.hostname); } catch { return; }
  if (!tweaks.length) return;

  function injectDomScript(code) {
    try {
      const root = document.documentElement || document.head || document.body;
      if (!root) return false;
      const s = document.createElement('script');
      s.textContent = code;
      root.appendChild(s);
      s.remove();
      return true;
    } catch { return false; }
  }

  tweaks.forEach((tweak) => {
    try {
      if (tweak.mechanism === 'webFrame') {
        require('electron').webFrame.executeJavaScript(tweak.code)
          .catch(() => { /* best-effort */ });
      } else if (!injectDomScript(tweak.code)) {
        const obs = new MutationObserver(() => {
          if (document.documentElement && injectDomScript(tweak.code)) obs.disconnect();
        });
        obs.observe(document, { childList: true, subtree: true });
        document.addEventListener('readystatechange', () => injectDomScript(tweak.code), true);
      }
    } catch { /* best-effort */ }
  });
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { SITE_TWEAKS, tweaksForHost };
}

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
      // "Discord rest mode" (js/discord-memory.js, off by default): while the
      // panel is hidden and not in a call the host calls window.__vexRest(true),
      // and the page then tells Discord the TRUTH (hidden), so it can go into
      // its own idle mode. __vexRest(false) puts the spoof back at once.
      'var rest=false,pass=false;' +
      'var D=(typeof Document!=="undefined")?Document.prototype:null;' +
      'var real=function(n){try{var d=D&&Object.getOwnPropertyDescriptor(D,n);return d&&d.get?d.get.call(document):undefined;}catch(e){return undefined;}};' +
      'var realFocus=D&&D.hasFocus;' +
      'var vis=function(){return rest?(real("visibilityState")||"hidden"):"visible";};' +
      'var hid=function(){if(!rest)return false;var h=real("hidden");return h===undefined?true:h;};' +
      'Object.defineProperty(document,"visibilityState",{get:vis,configurable:true});' +
      'Object.defineProperty(document,"webkitVisibilityState",{get:vis,configurable:true});' +
      'Object.defineProperty(document,"hidden",{get:hid,configurable:true});' +
      'Object.defineProperty(document,"webkitHidden",{get:hid,configurable:true});' +
      'var block=function(e){if(!rest&&!pass)e.stopImmediatePropagation();};' +
      'window.addEventListener("visibilitychange",block,true);' +
      'document.addEventListener("visibilitychange",block,true);' +
      'window.addEventListener("webkitvisibilitychange",block,true);' +
      'document.addEventListener("webkitvisibilitychange",block,true);' +
      'try{Object.defineProperty(document,"hasFocus",{value:function(){return (rest&&realFocus)?realFocus.call(document):true;},configurable:true,writable:true});}catch(e){}' +
      'try{Object.defineProperty(window,"__vexRest",{value:function(on){on=!!on;if(on===rest)return rest;rest=on;' +
        'try{pass=true;document.dispatchEvent(new Event("visibilitychange"));}catch(e){}finally{pass=false;}return rest;},configurable:true});}catch(e){}' +
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
  {
    // Web Push is unsupported in Electron: Chromium's push service (the FCM
    // registration client) lives in the //chrome layer and isn't compiled in,
    // so registration.pushManager.subscribe() ALWAYS rejects ("Registration
    // failed - push service error") — after the user has already granted the
    // notification permission. Sites surface that as "An unknown error
    // occurred while enabling push notifications for your browser." The
    // build still advertises the full Push API surface (verified 2026-08-25:
    // PushManager on window, pushManager on ServiceWorkerRegistration), so
    // feature detection walks sites straight into the failure.
    //
    // Fix: emulate a browser that genuinely lacks Web Push — like older
    // Safari, whose no-push state every major site (claude.ai included)
    // already handles gracefully. That means REMOVING the whole surface:
    // window.PushManager / PushSubscription / PushSubscriptionOptions AND
    // ServiceWorkerRegistration.prototype.pushManager. Sites then feature-
    // detect "no push" and hide/skip their push toggle; plain Notification
    // (which Vex supports) still works.
    //
    // Do NOT shim registration.pushManager to a rejecting object: a
    // present-but-broken pushManager is a state no real browser has, so
    // sites that detect push by its existence (claude.ai does) show their
    // toggle, call subscribe(), get the rejection, and surface it as the
    // SAME "unknown error" (root-caused live on the Claude panel,
    // 2026-08-26). Removal is what makes the toggle never appear. Applies to
    // every host — any site can attempt a push subscription.
    name: 'hide-web-push',
    hosts: /(?:)/,
    mechanism: 'webFrame',
    code: '(function(){try{' +
      'delete window.PushManager;' +
      'delete window.PushSubscription;' +
      'delete window.PushSubscriptionOptions;' +
      'if(window.ServiceWorkerRegistration)delete ServiceWorkerRegistration.prototype.pushManager;' +
      '}catch(e){}})();',
  },
  {
    // Notification-availability suppression for sites whose "enable
    // notifications" flow gates on the Notification API (not PushManager) and
    // then attempts a Web Push subscription that Electron can never service —
    // so hide-web-push (above) doesn't stop them, and clicking Enable shows
    // "An unknown error occurred while enabling push notifications" (observed
    // on claude.ai, confirmed 2026-08-26: the toggle is Notification-gated,
    // permission granted, then pushManager.subscribe fails). Since Web Push
    // is impossible in Electron regardless, present notifications as DENIED so
    // the site shows its normal "notifications blocked/unsupported" state
    // instead of an error. Forcing permission to "denied" (rather than
    // deleting Notification) is the gentle path: a site reading
    // Notification.permission gets a valid value and never reaches the failing
    // subscribe. TRADE-OFF: foreground notifications from these sites won't
    // fire either — accepted deliberately (user choice, 2026-08-26). Scoped to
    // a curated host list; extend `hosts` as more sites surface the error.
    name: 'notif-deny-broken-push',
    hosts: /(^|\.)claude\.ai$/i,
    mechanism: 'webFrame',
    code: '(function(){try{' +
      'if(!window.Notification)return;' +
      'try{Object.defineProperty(window.Notification,"permission",{get:function(){return "denied";},configurable:true});}catch(e){}' +
      'try{window.Notification.requestPermission=function(cb){try{if(typeof cb==="function")cb("denied");}catch(e){}return Promise.resolve("denied");};}catch(e){}' +
      '}catch(e){}})();',
  },
  {
    // Suppress the OS "Windows Security → Sign in with a passkey / Insert your
    // security key" dialog. That native prompt is triggered whenever a site asks
    // for a WebAuthn credential (navigator.credentials.get with a `publicKey`).
    // We reject those requests (as if the prompt were dismissed) so sign-in falls
    // back to password/other methods, and report no platform/conditional
    // authenticator so sites don't offer passkey autofill in the first place.
    // Password autofill via the Credential Management API (no publicKey) still
    // works; create()/registration is untouched. Applied everywhere.
    // A refused request the site really asked for (not the silent "conditional"
    // autofill probe) is told to Vex ('vex-passkey-refused', below), which
    // offers to allow passkeys on that site and reload (js/passwords.js).
    name: 'disable-webauthn-passkey-prompt',
    optIn: 'suppressPasskeys',
    hosts: /.*/,
    mechanism: 'webFrame',
    notifies: 'vex-passkey-refused',
    code: '(function(){try{' +
      'var nc=navigator.credentials;' +
      'if(nc&&typeof nc.get==="function"){var orig=nc.get.bind(nc);nc.get=function(opts){try{if(opts&&opts.publicKey){if(opts.mediation!=="conditional"){try{document.dispatchEvent(new CustomEvent("vex-passkey-refused"));}catch(e){}}return Promise.reject(new DOMException("Passkey sign-in is disabled in Vex","NotAllowedError"));}}catch(e){}return orig(opts);};}' +
      'if(window.PublicKeyCredential){' +
        'try{window.PublicKeyCredential.isConditionalMediationAvailable=function(){return Promise.resolve(false);};}catch(e){}' +
        'try{window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable=function(){return Promise.resolve(false);};}catch(e){}' +
      '}' +
      '}catch(e){}})();',
  },
  {
    // Spotify: "Spotify can't play this right now" on a SUBSET of tracks.
    // Spotify is audio, which normally negotiates Widevine at
    // SW_SECURE_CRYPTO (the level Electron's castLabs Widevine provides —
    // verified on the installed VMP-signed build, 2026-08-26: CDM 4.10.3050.0,
    // SW_SECURE_CRYPTO ok, SW_SECURE_DECODE unavailable). But Spotify requests
    // the HIGHER SW_SECURE_DECODE robustness for some tracks, and this CDM
    // can't satisfy it, so requestMediaKeySystemAccess rejects and those tracks
    // won't play while the rest do. Fix: try the request as-is first, and only
    // if it rejects, retry with any above-SW_SECURE_CRYPTO robustness dropped
    // to SW_SECURE_CRYPTO — the level actually available. This never weakens a
    // request that already works (retry runs only on failure) and never touches
    // video sites (scoped to spotify.com); audio content plays fine under
    // SW_SECURE_CRYPTO. If Spotify's license server were to hard-require the
    // higher level the track still won't play — no worse than today.
    name: 'spotify-drm-robustness-fallback',
    hosts: /(^|\.)spotify\.com$/i,
    mechanism: 'webFrame',
    code: '(function(){try{' +
      'if(!navigator.requestMediaKeySystemAccess)return;' +
      'var orig=navigator.requestMediaKeySystemAccess.bind(navigator);' +
      'var down=function(configs){return (configs||[]).map(function(cfg){' +
        'var c=Object.assign({},cfg);' +
        '["audioCapabilities","videoCapabilities"].forEach(function(k){' +
          'if(Array.isArray(c[k]))c[k]=c[k].map(function(cap){' +
            'var cc=Object.assign({},cap);' +
            'if(cc.robustness&&cc.robustness!==""&&cc.robustness!=="SW_SECURE_CRYPTO")cc.robustness="SW_SECURE_CRYPTO";' +
            'return cc;});' +
        '});' +
        'return c;});};' +
      'navigator.requestMediaKeySystemAccess=function(ks,configs){' +
        'return orig(ks,configs).catch(function(err){' +
          'try{return orig(ks,down(configs));}catch(e){return Promise.reject(err);}' +
        '});};' +
      '}catch(e){}})();',
  },
  {
    // Google sign-in rejects Vex ("Couldn't sign you in — this browser or app
    // may not be secure", /v3/signin/rejected) even though the session layer
    // spoofs the Chrome UA string and rewrites the Sec-CH-UA request headers.
    // Cause: those cover only the *headers* — the JS-visible
    // navigator.userAgentData still reports Electron's real brand list, which
    // is Chromium + GREASE with no "Google Chrome" entry (verified against
    // this Electron build, 2026-08-25). A UA string claiming Chrome whose
    // userAgentData lacks the "Google Chrome" brand is the contradiction
    // Google's embedded-browser detector trips on. Fix by wrapping the real
    // NavigatorUAData and grafting a "Google Chrome" brand (copying the
    // Chromium entry's version, so it tracks Electron upgrades) into brands
    // and fullVersionList; everything else (platformVersion, architecture,
    // full Chromium version) passes through from the real object so all
    // values stay self-consistent. Scoped to google.com — the detector runs
    // on accounts.google.com pages.
    name: 'google-uadata',
    hosts: /(^|\.)google\.com$/i,
    mechanism: 'webFrame',
    code: '(function(){try{' +
      'var G="Google Chrome";' +
      'var real=navigator.userAgentData;' +
      'if(!real||!real.brands)return;' +
      'if(real.brands.some(function(b){return b.brand===G;}))return;' +
      'var m=(navigator.userAgent.match(/Chrome\\/(\\d+)/)||[])[1]||"148";' +
      'var graft=function(list,fb){' +
        'var out=(list||[]).slice();' +
        'var cr=out.filter(function(b){return b.brand==="Chromium";})[0];' +
        'out.push({brand:G,version:(cr&&cr.version)||fb});' +
        'return out;};' +
      'var brands=graft(real.brands,m);' +
      'var base=function(){return {brands:brands,mobile:real.mobile,platform:real.platform};};' +
      'var uad={brands:brands,mobile:real.mobile,platform:real.platform,' +
        'getHighEntropyValues:function(hints){' +
          'return real.getHighEntropyValues.call(real,hints).then(function(r){' +
            'var o=Object.assign({},r,base());' +
            'if(r.fullVersionList)o.fullVersionList=graft(r.fullVersionList,m+".0.0.0");' +
            'return o;},function(){return base();});},' +
        'toJSON:function(){return base();}};' +
      'Object.defineProperty(Navigator.prototype,"userAgentData",{get:function(){return uad;},configurable:true});' +
      // Best-effort second signal: real Chrome exposes a populated window.chrome
      // (runtime/app/csi/loadTimes); Electron's is an empty {} (or absent),
      // which is a known "not a real browser" tell. Fill a minimal realistic
      // stub if it's empty. NOTE: this is hardening, not a guaranteed defeat of
      // Google's embedded-context block — that block uses server-side signals
      // too. Kept scoped to google.com.
      'try{var c=window.chrome;if(!c||Object.keys(c).length===0){var noop=function(){};var now=function(){return Date.now();};window.chrome={app:{isInstalled:false,InstallState:{DISABLED:"disabled",INSTALLED:"installed",NOT_INSTALLED:"not_installed"},RunningState:{CANNOT_RUN:"cannot_run",READY_TO_RUN:"ready_to_run",RUNNING:"running"}},runtime:{connect:noop,sendMessage:noop,onMessage:{addListener:noop,removeListener:noop},id:undefined},csi:function(){return {onloadT:now(),startE:now(),pageT:0,tran:15};},loadTimes:function(){return {requestTime:now()/1000,startLoadTime:now()/1000,commitLoadTime:now()/1000,finishDocumentLoadTime:0,finishLoadTime:0,firstPaintTime:0,firstPaintAfterLoadTime:0,navigationType:"Other",wasFetchedViaSpdy:true,wasNpnNegotiated:true,npnNegotiatedProtocol:"h2",wasAlternateProtocolAvailable:false,connectionInfo:"h2"};}};}}catch(e){}' +
      '}catch(e){}})();',
  },
];

// Entries whose hosts pattern matches `hostname`.
function tweaksForHost(hostname, options = {}) {
  return SITE_TWEAKS.filter((t) => {
    if (t.optIn && options[t.optIn] !== true) return false;
    try { return t.hosts.test(hostname); } catch { return false; }
  });
}

// === Streaming sites: Skip Intro / Skip Recap / Next Episode / "Still watching?" ===
//
// OFF by default, per site, and only when the person turned that site on (Ctrl+K
// "Skip intro and next episode"). All it does is press a button that is already
// on the page and in view, the way a person would: no network, nothing about the
// video, the player or its protection is touched, and nothing is played, seeked or
// paused. A button must stay in view for `delayMs` before it is pressed, so a
// player that is still drawing it, or a person who got there first, is never
// fought.
//
// THE SELECTORS BELOW ARE THE ONLY PLACE the buttons are described. They were
// written from how the sites are known to build these buttons and have NOT been
// verified against the live sites (they need a subscription and change often): a
// site that changes its page stops matching, and the settings dialog then shows
// "not matched yet" instead of pretending. When a site is fixed, edit this table
// and raise `version`.
//
// Per button:  kind  - what it is (intro | recap | next | continue)
//              css   - selectors for the real button (first visible one wins)
//              guard - optional: the button's text must also match one of these
//                      (so a generic class never presses "Skip ad")
//              text  - fallback: a visible <button>/role=button whose WHOLE text
//                      matches one of these (English and Turkish)
// Everything only runs while the page has a <video>.
const STREAMING_SKIP = {
  version: 1,
  updated: '2026-11-06',
  verified: false,
  delayMs: 700,
  cooldownMs: 4000,
  sites: {
    netflix: {
      label: 'Netflix',
      hosts: '(^|\\.)netflix\\.com$',
      buttons: [
        { kind: 'intro', css: ['button[data-uia="player-skip-intro"]'], text: ['^skip intro$', '^giriş(i)? atla$'] },
        { kind: 'recap', css: ['button[data-uia="player-skip-recap"]'], text: ['^skip recap$', '^özeti atla$'] },
        { kind: 'next', css: ['button[data-uia="next-episode-seamless-button"]', 'button[data-uia="next-episode-seamless-button-draining"]'], text: ['^next episode$', '^sonraki bölüm$'] },
        { kind: 'continue', css: ['[data-uia="interrupt-autoplay-continue"]'], text: ['^continue (watching|playing)$', '^izlemeye devam et$', '^oynatmaya devam et$'] },
      ],
    },
    prime: {
      label: 'Prime Video',
      hosts: '(^|\\.)(primevideo\\.com|amazon\\.(com|co\\.uk|de|fr|it|es|ca|in|com\\.tr|com\\.au|co\\.jp))$',
      // amazon.* is a shop too: only its video pages count.
      paths: '^/(gp/video/|Amazon-Video/|-/)|^/detail/|^/region/',
      buttons: [
        { kind: 'intro', css: ['.atvwebplayersdk-skipelement-button'], guard: ['intro', 'giriş'], text: ['^skip intro$', '^giriş(i)? atla$'] },
        { kind: 'recap', css: ['.atvwebplayersdk-skipelement-button'], guard: ['recap', 'özet'], text: ['^skip recap$', '^özeti atla$'] },
        { kind: 'next', css: ['.atvwebplayersdk-nextupcard-button'], text: ['^next episode$', '^sonraki bölüm$'] },
        { kind: 'continue', css: [], text: ['^continue watching$', '^i.?m still watching$', '^izlemeye devam et$'] },
      ],
    },
    disney: {
      label: 'Disney+',
      hosts: '(^|\\.)disneyplus\\.com$',
      buttons: [
        { kind: 'intro', css: ['button[data-testid="skip-intro-button"]', '[data-gv2elementkey="skipIntro"]'], text: ['^skip intro$', '^giriş(i)? atla$'] },
        { kind: 'recap', css: ['button[data-testid="skip-recap-button"]'], text: ['^skip recap$', '^özeti atla$'] },
        { kind: 'next', css: ['button[data-testid="up-next-play-button"]'], text: ['^next episode$', '^sonraki bölüm$'] },
        { kind: 'continue', css: [], text: ['^continue watching$', '^izlemeye devam et$'] },
      ],
    },
  },
};

// Which streaming site (a key of STREAMING_SKIP.sites) this address is, or ''.
function streamingSiteFor(hostname, pathname = '/', table = STREAMING_SKIP) {
  for (const [id, site] of Object.entries(table.sites)) {
    if (!new RegExp(site.hosts, 'i').test(String(hostname))) continue;
    if (site.paths && !new RegExp(site.paths).test(String(pathname || '/'))) continue;
    return id;
  }
  return '';
}

// The scanner. Everything it touches comes in as an argument so a test can drive it with a
// jsdom page and a fake clock. report({ site, kind }) is told each time a button was pressed.
function createStreamingSkipper({ doc, win, site, table = STREAMING_SKIP, report, isVisible, setTimer, clearTimer, now }) {
  const spec = table.sites[site];
  if (!spec) throw new Error('Unknown streaming site: ' + site);
  const delayMs = table.delayMs;
  const set = setTimer || ((fn, ms) => setTimeout(fn, ms));
  const clear = clearTimer || ((id) => clearTimeout(id));
  const clock = now || (() => Date.now());
  const visible = isVisible || ((el) => {
    if (!el.isConnected) return false;
    const r = el.getBoundingClientRect();
    if (!(r.width > 0 && r.height > 0)) return false;
    if (typeof el.checkVisibility === 'function') return el.checkVisibility({ opacityProperty: true, visibilityProperty: true });
    const cs = (win || doc.defaultView).getComputedStyle(el);
    return cs.visibility !== 'hidden' && cs.display !== 'none' && parseFloat(cs.opacity) !== 0;
  });
  const compiled = spec.buttons.map((b) => ({
    ...b,
    guardRe: (b.guard || []).map((g) => new RegExp(g, 'i')),
    textRe: (b.text || []).map((t) => new RegExp(t, 'i')),
  }));
  const textOf = (el) => String(el.textContent || el.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim();

  function find(b) {
    for (const sel of b.css || []) {
      let list;
      try { list = doc.querySelectorAll(sel); } catch (err) { console.error('[site-tweaks] bad selector in the streaming table:', sel, err && err.message); continue; }
      for (const el of list) {
        if (b.guardRe.length && !b.guardRe.some((re) => re.test(textOf(el)))) continue;
        if (visible(el)) return el;
      }
    }
    if (!b.textRe.length) return null;
    for (const el of doc.querySelectorAll('button, [role="button"]')) {
      const t = textOf(el);
      if (t.length > 40 || !b.textRe.some((re) => re.test(t))) continue;
      if (visible(el)) return el;
    }
    return null;
  }

  const pending = new Map();      // element -> { kind, timer }
  const lastPressed = new Map();  // kind -> time
  let stopped = false;

  function matches() {
    const out = [];
    if (!doc.querySelector('video')) return out;
    for (const b of compiled) { const el = find(b); if (el) out.push({ kind: b.kind, el, b }); }
    return out;
  }

  function press(el, b) {
    pending.delete(el);
    if (stopped) return;
    // Still there, still in view, still the same button: otherwise do nothing.
    if (!matches().some((m) => m.el === el)) return;
    const last = lastPressed.get(b.kind);
    if (last != null && clock() - last < table.cooldownMs) return;
    lastPressed.set(b.kind, clock());
    el.click();
    report({ site, kind: b.kind });
  }

  function scan() {
    if (stopped) return;
    const found = matches();
    for (const [el, p] of pending) {
      if (!found.some((m) => m.el === el)) { clear(p.timer); pending.delete(el); }
    }
    for (const m of found) {
      if (pending.has(m.el)) continue;
      const last = lastPressed.get(m.kind);
      if (last != null && clock() - last < table.cooldownMs) continue;
      pending.set(m.el, { kind: m.kind, timer: set(() => press(m.el, m.b), delayMs) });
    }
  }

  function stop() {
    stopped = true;
    for (const p of pending.values()) clear(p.timer);
    pending.clear();
  }
  return { scan, stop, pendingCount: () => pending.size };
}

// --- Applier: runs only when loaded as a preload (DOM present) ---
// The preload runs before the parser creates <html>, so the dom-script path
// waits for documentElement instead of a plain appendChild (which would
// silently no-op while documentElement is still null).
(function () {
  if (typeof document === 'undefined' || typeof location === 'undefined') return;
  // The built-in PDF viewer is an extension frame inside the page and gets this preload too; patching its world left a blank dark page.
  if (location.protocol === 'chrome-extension:' && location.host === 'mhjfbmdgcfjbbpaeojofohoefgiehjai') return;
  let tweaks;
  try {
    let options = {};
    try { options = require('electron').ipcRenderer.sendSync('compatibility:get') || {}; } catch {}
    tweaks = tweaksForHost(location.hostname, options);
  } catch { return; }
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
      // The page-world code says when it refused something; tell the tab's
      // host once per page, with this frame's own hostname (not the page's word).
      if (tweak.notifies) {
        let told = false;
        document.addEventListener(tweak.notifies, () => {
          if (told) return;
          told = true;
          try { require('electron').ipcRenderer.sendToHost(tweak.notifies, { host: location.hostname }); }
          catch (err) { console.error('[site-tweaks] could not tell Vex:', err && err.message); }
        });
      }
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

// --- Streaming-site buttons (opt-in per site; main says which sites are on) ---
(function () {
  if (typeof document === 'undefined' || typeof location === 'undefined') return;
  const site = streamingSiteFor(location.hostname, location.pathname);
  if (!site) return;
  let ipc;
  try { ipc = require('electron').ipcRenderer; } catch { return; /* vex-allow-empty-catch: not running as a preload, nothing to do */ }
  let on = false;
  try {
    const options = ipc.sendSync('compatibility:get') || {};
    on = Array.isArray(options.streamingSkip) && options.streamingSkip.includes(site);
  } catch (err) { console.error('[site-tweaks] could not ask Vex whether streaming skip is on:', err && err.message); return; }
  if (!on) return;
  const skipper = createStreamingSkipper({
    doc: document, win: window, site,
    report: (m) => { try { ipc.send('streamskip:matched', m.site, m.kind); } catch (err) { console.error('[site-tweaks] could not tell Vex a button was pressed:', err && err.message); } },
  });
  let queued = false;
  const later = () => { if (queued) return; queued = true; setTimeout(() => { queued = false; skipper.scan(); }, 250); };
  const start = () => {
    new MutationObserver(later).observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style', 'hidden', 'aria-hidden', 'disabled'] });
    skipper.scan();
  };
  if (document.documentElement) start();
  else document.addEventListener('DOMContentLoaded', start, { once: true });
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { SITE_TWEAKS, tweaksForHost, STREAMING_SKIP, streamingSiteFor, createStreamingSkipper };
}

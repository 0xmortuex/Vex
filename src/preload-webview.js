// === Preload script for webviews — video PiP + detection ===

(function () {
  'use strict';

  let lastVideoCount = 0;

  function checkForVideos() {
    const videos = document.querySelectorAll('video');
    if (videos.length !== lastVideoCount) {
      lastVideoCount = videos.length;
      window.postMessage({
        type: 'vex-video-detected',
        hasVideo: videos.length > 0,
        videoCount: videos.length
      }, '*');
    }
  }

  // Inject PiP button overlay on each video
  function setupVideoPipButtons() {
    const videos = document.querySelectorAll('video');
    videos.forEach(video => {
      if (video._vexPipSetup) return;
      video._vexPipSetup = true;

      const btn = document.createElement('button');
      btn.textContent = '\u29C9 PiP';
      btn.style.cssText = 'position:absolute;top:10px;right:10px;background:rgba(0,0,0,0.7);color:white;border:none;padding:6px 10px;border-radius:4px;cursor:pointer;font-size:12px;z-index:999999;opacity:0;transition:opacity 0.2s;pointer-events:auto;font-family:sans-serif';

      const wrapper = video.parentElement;
      if (wrapper && getComputedStyle(wrapper).position === 'static') {
        wrapper.style.position = 'relative';
      }
      if (wrapper) {
        wrapper.appendChild(btn);
        wrapper.addEventListener('mouseenter', () => btn.style.opacity = '1');
        wrapper.addEventListener('mouseleave', () => btn.style.opacity = '0');
      }

      btn.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        try {
          if (document.pictureInPictureElement) {
            await document.exitPictureInPicture();
          } else if (document.pictureInPictureEnabled) {
            await video.requestPictureInPicture();
          }
        } catch (err) {
          console.error('PiP failed:', err);
        }
      });
    });
    checkForVideos();
  }

  // Run on load and on DOM changes
  if (document.readyState === 'complete') {
    setupVideoPipButtons();
  } else {
    window.addEventListener('load', setupVideoPipButtons);
  }

  // Watch for dynamically added videos
  const obs = new MutationObserver(setupVideoPipButtons);
  if (document.body) {
    obs.observe(document.body, { childList: true, subtree: true });
  } else {
    window.addEventListener('DOMContentLoaded', () => {
      obs.observe(document.body, { childList: true, subtree: true });
    });
  }

  // Periodic fallback check
  setInterval(setupVideoPipButtons, 3000);

  // Listen for PiP request from parent
  window.addEventListener('message', (e) => {
    if (e.data && e.data.type === 'vex-request-pip') {
      const videos = document.querySelectorAll('video');
      const video = Array.from(videos).find(v => !v.paused) || videos[0];
      if (video && document.pictureInPictureEnabled) {
        video.requestPictureInPicture().catch(() => {
          window.postMessage({ type: 'vex-pip-fallback' }, '*');
        });
      } else {
        window.postMessage({ type: 'vex-pip-fallback' }, '*');
      }
    }
  });
})();

// === Geolocation polyfill ===
// Electron doesn't ship with a Google Network Location API key, so Chromium's
// native navigator.geolocation returns POSITION_UNAVAILABLE on Windows. We
// want to replace navigator.geolocation entirely and answer from Vex's
// Settings → Location (or IP). But <webview webpreferences="contextIsolation=yes">
// means this preload runs in an isolated world — Object.defineProperty(navigator,
// 'geolocation', …) there modifies the isolated-world navigator, not the page's.
// Two pieces therefore:
//   1. expose a narrow IPC bridge to the main world via contextBridge, so the
//      polyfill can ask Vex for the permission decision + coords
//   2. inject the polyfill as a <script> into document.documentElement so it
//      runs in the MAIN world where navigator.geolocation is the real one
(function () {
  let proto;
  try { proto = window.location.protocol; } catch { return; }
  if (proto === 'about:' || proto === 'chrome:' || proto === 'devtools:' ||
      proto === 'vex:' || proto === 'data:' || proto === 'file:') return;

  let contextBridge = null, ipcRenderer = null;
  try {
    const electron = require('electron');
    contextBridge = electron.contextBridge;
    ipcRenderer = electron.ipcRenderer;
  } catch { return; }
  if (!ipcRenderer) return;

  // === Geolocation bridge (security audit M-3 hardening) ===
  // The bridge used to expose `checkPermission` and `getPref` separately, which
  // let any guest page call `getPref()` to read the user's stored coordinates
  // WITHOUT going through the permission prompt — a complete bypass of the
  // navigator.geolocation gate.
  //
  // The new surface exposes a single atomic method, `resolveLocation(origin)`,
  // that does the permission check + the pref read + the coord coarsening in
  // ONE round-trip. Guest pages cannot read coords without permission for
  // their origin, and even with permission they only ever see lat/lng rounded
  // to 1 decimal place (~11 km, city-level). All extra fields the main
  // process might emit (ISP, ASN, IP, timezone, accuracy, timestamp, etc.)
  // are stripped by `coarsenLocation` before the response reaches this world.
  //
  // Returns one of (NO other shapes):
  //   { mode: 'denied' }                           — denied OR off
  //   { mode: 'manual', latitude, longitude }      — coarse coords (1 dp)
  //   { mode: 'ip' }                               — caller does IP fallback
  //
  // Inline copy of `coarsenLocation` from src/main-helpers.js — keeping the
  // preload self-contained avoids brittle relative-require resolution under
  // session.setPreloads. Tests in tests/main/geoBridge.test.js exercise the
  // helper version; this copy must stay in sync. Tiny enough that drift is
  // obvious in code review.
  function _coarsenLocationLocal(rawPref) {
    if (!rawPref || typeof rawPref !== 'object') return { mode: 'denied' };
    if (rawPref.mode === 'off') return { mode: 'denied' };
    if (rawPref.mode === 'manual') {
      const lat = (typeof rawPref.latitude  === 'number' && Number.isFinite(rawPref.latitude))  ? Math.round(rawPref.latitude  * 10) / 10 : null;
      const lng = (typeof rawPref.longitude === 'number' && Number.isFinite(rawPref.longitude)) ? Math.round(rawPref.longitude * 10) / 10 : null;
      if (lat == null || lng == null) return { mode: 'ip' };
      return { mode: 'manual', latitude: lat, longitude: lng };
    }
    if (rawPref.mode === 'ip') return { mode: 'ip' };
    return { mode: 'denied' };
  }

  const bridge = {
    resolveLocation: async (origin) => {
      let decision;
      try {
        decision = await ipcRenderer.invoke('geolocation:check-permission', { origin });
      } catch { return { mode: 'denied' }; }
      if (decision !== 'allow') return { mode: 'denied' };
      let raw;
      try { raw = await ipcRenderer.invoke('geolocation:get'); } catch { return { mode: 'denied' }; }
      return _coarsenLocationLocal(raw);
    }
  };

  // TODO(security): rename `__vexGeoBridge` to a randomised-per-launch key as
  // a follow-up for M-3 fingerprinting mitigation (audit's Option B). Out of
  // scope for the API-surface fix here.
  try {
    if (contextBridge && contextBridge.exposeInMainWorld) {
      contextBridge.exposeInMainWorld('__vexGeoBridge', bridge);
    } else {
      // contextIsolation disabled (unlikely in webviews); expose directly.
      try { window.__vexGeoBridge = bridge; } catch {}
    }
  } catch (err) {
    console.error('[Vex Geo] bridge expose failed:', err.message);
    return;
  }

  // Main-world polyfill. Template literal, serialized into a <script> tag.
  const polyfillSrc = `(function () {
    var bridge = window.__vexGeoBridge;
    if (!bridge) return;

    function _pos(lat, lng, accuracy) {
      return {
        coords: {
          latitude: lat, longitude: lng,
          accuracy: accuracy || 50000,
          altitude: null, altitudeAccuracy: null,
          heading: null, speed: null
        },
        timestamp: Date.now()
      };
    }
    function _deny(error, code, message) {
      if (!error) return;
      try { error({ code: code, message: message, PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 }); } catch (_) {}
    }
    async function fetchIPLocation() {
      try {
        var r = await fetch('https://ipapi.co/json/', { headers: { 'Accept': 'application/json' } });
        if (r.ok) {
          var d = await r.json();
          if (d && d.latitude && d.longitude) return _pos(parseFloat(d.latitude), parseFloat(d.longitude), 50000);
        }
      } catch (_) {}
      try {
        var r2 = await fetch('https://ipwho.is/');
        if (r2.ok) {
          var d2 = await r2.json();
          if (d2 && d2.success && d2.latitude && d2.longitude) return _pos(parseFloat(d2.latitude), parseFloat(d2.longitude), 50000);
        }
      } catch (_) {}
      return null;
    }
    async function resolve(success, error) {
      // Single atomic call: permission check + coarse-coord read. Returns
      // { mode: 'denied' | 'manual' | 'ip', latitude?, longitude? }. See the
      // bridge declaration in src/preload-webview.js for the contract.
      var loc = null;
      try { loc = await bridge.resolveLocation(window.location.origin); } catch (_) {}
      if (!loc || loc.mode === 'denied') { _deny(error, 1, 'Geolocation permission denied'); return; }
      if (loc.mode === 'manual' && loc.latitude != null && loc.longitude != null) {
        // Coords are already rounded to 1 dp upstream — accuracy reflects
        // that (~11 km city-level rather than the old 20 m manual-pin claim).
        try { success(_pos(loc.latitude, loc.longitude, 11000)); } catch (_) {}
        return;
      }
      // mode === 'ip' — caller does IP fallback. M-5 is tracked separately.
      var pos = await fetchIPLocation();
      if (pos) { try { success(pos); } catch (_) {} return; }
      _deny(error, 2, 'Unable to determine location');
    }

    var watches = new Map();
    var wrapped = {
      getCurrentPosition: function (success, error) {
        resolve(success, error).catch(function () { _deny(error, 2, 'Geolocation resolution crashed'); });
      },
      watchPosition: function (success, error, options) {
        var id = Math.floor(Math.random() * 1e9) + 1;
        wrapped.getCurrentPosition(success, error, options);
        var interval = setInterval(function () { wrapped.getCurrentPosition(success, error, options); }, 5 * 60 * 1000);
        watches.set(id, interval);
        return id;
      },
      clearWatch: function (id) {
        if (watches.has(id)) { clearInterval(watches.get(id)); watches.delete(id); }
      }
    };
    try {
      Object.defineProperty(navigator, 'geolocation', { value: wrapped, writable: false, configurable: true });
    } catch (err) {
      console.error('[Vex Geo] polyfill install failed:', err && err.message);
    }
  })();`;

  function inject() {
    try {
      const s = document.createElement('script');
      s.textContent = polyfillSrc;
      (document.head || document.documentElement).appendChild(s);
      s.remove();
    } catch (err) {
      console.error('[Vex Geo] inject failed:', err.message);
    }
  }
  if (document.documentElement) inject();
  else document.addEventListener('readystatechange', inject, { once: true });
})();

// === Smart Searchbar suggest bridge (start page only) ===
// The start page is a sandboxed webview guest with contextIsolation, so it
// cannot reach the main renderer's window.vex IPC. It needs Google Suggest
// predictions, but Google Suggest returns no CORS header so a direct guest
// fetch is blocked. We expose a tiny IPC bridge into the guest's MAIN world via
// contextBridge — ONLY for the Vex start page, so arbitrary web pages never
// receive it. Mirrors the __vexGeoBridge pattern above. Handler lives in main.js.
//
// IMPORTANT: at runtime the start page loads as a file:// URL
// (file:///…/renderer/start.html), NOT vex://start — get-start-page-url returns
// a file:// fallback deliberately (avoids the OS "open with" dialog). The guard
// therefore admits the real file:// origin AND keeps vex://start. It requires
// the file: scheme AND a pathname ending in /renderer/start.html so an http/
// https page (even one with "start.html" in its path or query) is refused.
function _isVexStartPage(href) {
  if (typeof href !== 'string') return false;
  let u;
  try { u = new URL(href); } catch { return false; }
  // Canonical vex://start origin (kept for safety / future-proofing).
  if (u.protocol === 'vex:' && /^start$/i.test(u.host || '')) return true;
  // Real runtime origin: start.html served as a LOCAL file. Require file:
  // scheme AND pathname ending /renderer/start.html — no remote page qualifies.
  if (u.protocol === 'file:') return /\/renderer\/start\.html$/i.test(u.pathname);
  return false;
}

(function () {
  let href;
  try { href = window.location.href; } catch { return; }
  // Restrict to the Vex start page only — do NOT hand this to normal web pages.
  if (!_isVexStartPage(href)) return;

  let ipcRenderer = null, contextBridge = null;
  try {
    const electron = require('electron');
    ipcRenderer = electron.ipcRenderer;
    contextBridge = electron.contextBridge;
  } catch { return; }
  if (!ipcRenderer) return;

  const bridge = {
    // Returns Promise<string[]> (fail-silent: [] on any error).
    suggest: async (query) => {
      try {
        return await ipcRenderer.invoke('web-suggest', query);
      } catch (e) {
        return [];
      }
    }
  };

  try {
    if (contextBridge && contextBridge.exposeInMainWorld) {
      contextBridge.exposeInMainWorld('__vexSuggestBridge', bridge);
    } else {
      try { window.__vexSuggestBridge = bridge; } catch {}
    }
  } catch (err) {
    console.error('[Vex Suggest] bridge expose failed:', err && err.message);
  }
})();


// === Password capture — offer to save credentials on login-form submit ===
// Runs in every guest page. On submit of a form containing a password field,
// sends {host, username, password} to the HOST renderer only (sendToHost —
// never to the page). The host shows a save prompt; nothing is stored here.
(function () {
  "use strict";
  let ipcRenderer = null;
  try { ipcRenderer = require("electron").ipcRenderer; } catch { return; }
  if (!ipcRenderer || !ipcRenderer.sendToHost) return;

  function extract(form) {
    try {
      const pw = form.querySelector("input[type=password]");
      if (!pw || !pw.value) return null;
      let user = "";
      const cands = form.querySelectorAll("input[type=text],input[type=email],input:not([type])");
      for (const c of cands) { if (c.value && c !== pw) { user = c.value; } }
      if (!user) return null;
      return { username: String(user).slice(0, 200), password: String(pw.value).slice(0, 500) };
    } catch { return null; }
  }

  document.addEventListener("submit", (e) => {
    try {
      if (location.protocol !== "https:") return; // never capture over plain HTTP
      const form = e.target;
      if (!form || form.nodeName !== "FORM") return;
      const creds = extract(form);
      if (!creds) return;
      ipcRenderer.sendToHost("vex-cred-submit", {
        host: location.hostname.replace(/^www./, ""),
        username: creds.username,
        password: creds.password
      });
    } catch {}
  }, true);
})();


// === Mouse-gesture tracker — right-button drag → direction(s) to host ===
(function () {
  "use strict";
  let ipcRenderer = null;
  try { ipcRenderer = require("electron").ipcRenderer; } catch { return; }
  if (!ipcRenderer || !ipcRenderer.sendToHost) return;
  let sx = 0, sy = 0, tracking = false, moves = [];
  const TH = 40; // px before a stroke counts
  function dirOf(dx, dy) {
    if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? "R" : "L";
    return dy > 0 ? "D" : "U";
  }
  document.addEventListener("mousedown", (e) => {
    if (e.button !== 2) return;
    tracking = true; sx = e.screenX; sy = e.screenY; moves = [];
  }, true);
  document.addEventListener("mousemove", (e) => {
    if (!tracking) return;
    const dx = e.screenX - sx, dy = e.screenY - sy;
    if (Math.abs(dx) < TH && Math.abs(dy) < TH) return;
    const d = dirOf(dx, dy);
    if (moves[moves.length - 1] !== d && moves.length < 2) moves.push(d);
    sx = e.screenX; sy = e.screenY;
  }, true);
  document.addEventListener("mouseup", (e) => {
    if (e.button !== 2) return;
    tracking = false;
  }, true);
  document.addEventListener("contextmenu", (e) => {
    if (moves.length) {
      e.preventDefault();
      e.stopImmediatePropagation();
      try { ipcRenderer.sendToHost("vex-gesture", moves.join("")); } catch {}
      moves = [];
    }
  }, true);
})();

// === Selection AI — report a page text selection (text + on-screen rect) to
// the HOST renderer so it can show a floating Explain/Summarize/Translate bar.
// Coordinates are relative to THIS guest's viewport; the host offsets them by
// the <webview>'s position. Only the host hears these (sendToHost), never the
// page. ===
(function () {
  "use strict";
  let ipcRenderer = null;
  try { ipcRenderer = require("electron").ipcRenderer; } catch { return; }
  if (!ipcRenderer || !ipcRenderer.sendToHost) return;

  let lastText = "";
  function clear() {
    if (lastText) { lastText = ""; try { ipcRenderer.sendToHost("vex-selection-clear"); } catch {} }
  }
  function report() {
    let sel;
    try { sel = window.getSelection(); } catch { return; }
    const text = sel ? String(sel.toString()).replace(/\s+/g, " ").trim() : "";
    if (!text || text.length < 2) { clear(); return; }
    // Skip selections inside editable fields — the bar would cover the caret and
    // is rarely wanted while typing.
    try {
      const a = document.activeElement;
      if (a && (a.isContentEditable || /^(input|textarea)$/i.test(a.nodeName))) return;
    } catch {}
    if (text === lastText) return;
    lastText = text;
    let rect = { x: 0, y: 0, w: 0, h: 0 };
    try {
      const r = sel.getRangeAt(0).getBoundingClientRect();
      rect = { x: r.left, y: r.top, w: r.width, h: r.height };
    } catch {}
    try { ipcRenderer.sendToHost("vex-selection", { text: text.slice(0, 8000), rect }); } catch {}
  }
  // mouseup = drag-selection done; keyup with Shift = keyboard selection.
  document.addEventListener("mouseup", () => setTimeout(report, 10), true);
  document.addEventListener("keyup", (e) => { if (e.shiftKey) setTimeout(report, 10); }, true);
  // Clears: empty selection, scroll (rect goes stale), or Escape.
  let clrT = null;
  document.addEventListener("selectionchange", () => {
    clearTimeout(clrT);
    clrT = setTimeout(() => { try { const s = window.getSelection(); if (!s || !String(s).trim()) clear(); } catch {} }, 250);
  }, true);
  document.addEventListener("scroll", clear, true);
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") clear(); }, true);
})();

// === Fingerprint farbling (Brave-style) — opt-in, default OFF ===
// When the user enables "Fingerprint protection", we inject tiny, per-session,
// deterministic noise into the readouts most used for canvas/WebGL/audio
// fingerprinting, and normalize a couple of navigator values. The noise is
// imperceptible (LSB-level) so pages still render correctly, but the hashes
// fingerprinting scripts compute differ from everyone else's AND change each
// session, so you can't be silently tracked across sites. Config is read
// synchronously from main BEFORE any page script runs (an async invoke would be
// too late — a page could read the canvas first).
(function () {
  let ipcRenderer = null;
  try { ipcRenderer = require('electron').ipcRenderer; } catch { return; }
  if (!ipcRenderer) return;
  let cfg;
  try { cfg = ipcRenderer.sendSync('privacy:config-sync'); } catch { return; }
  if (!cfg || !cfg.farble) return;

  // The injected source runs in the page's MAIN world. The seed is baked in so
  // the page can't read it back out of an IPC bridge.
  const src = `(function(){'use strict';
    var SEED=${(cfg.seed >>> 0)};
    function mulberry32(a){return function(){a|=0;a=a+0x6D2B79F5|0;var t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};}
    function rng(salt){return mulberry32((SEED^(salt>>>0))>>>0);}
    try{
      // --- Canvas readout farbling (does NOT mutate the visible canvas) ---
      function noisyCopy(canvas){
        try{
          var w=canvas.width,h=canvas.height;if(!w||!h||w*h>6000000)return null;
          var c=document.createElement('canvas');c.width=w;c.height=h;
          var g=c.getContext('2d');if(!g)return null;
          g.drawImage(canvas,0,0);
          var img=g.getImageData(0,0,w,h);var d=img.data;var r=rng(w*31+h);
          for(var i=0;i<d.length;i+=4){if(r()<0.05){var n=(r()*3|0)-1;d[i]=Math.max(0,Math.min(255,d[i]+n));d[i+1]=Math.max(0,Math.min(255,d[i+1]+n));d[i+2]=Math.max(0,Math.min(255,d[i+2]+n));}}
          g.putImageData(img,0,0);return c;
        }catch(e){return null;}
      }
      var origToDataURL=HTMLCanvasElement.prototype.toDataURL;
      HTMLCanvasElement.prototype.toDataURL=function(){var c=noisyCopy(this);try{return origToDataURL.apply(c||this,arguments);}catch(e){return origToDataURL.apply(this,arguments);}};
      var origToBlob=HTMLCanvasElement.prototype.toBlob;
      if(origToBlob){HTMLCanvasElement.prototype.toBlob=function(){var c=noisyCopy(this);try{return origToBlob.apply(c||this,arguments);}catch(e){return origToBlob.apply(this,arguments);}};}
      var origGID=CanvasRenderingContext2D.prototype.getImageData;
      CanvasRenderingContext2D.prototype.getImageData=function(){var res=origGID.apply(this,arguments);try{var d=res.data;var r=rng(d.length);for(var i=0;i<d.length;i+=4){if(r()<0.05){var n=(r()*3|0)-1;d[i]=Math.max(0,Math.min(255,d[i]+n));}}}catch(e){}return res;};

      // --- WebGL: mask the GPU vendor/renderer strings used to fingerprint ---
      function patchGL(proto){if(!proto)return;var gp=proto.getParameter;proto.getParameter=function(p){if(p===37445)return 'Google Inc.';if(p===37446)return 'ANGLE (Generic GPU, Direct3D11)';return gp.apply(this,arguments);};}
      if(window.WebGLRenderingContext)patchGL(WebGLRenderingContext.prototype);
      if(window.WebGL2RenderingContext)patchGL(WebGL2RenderingContext.prototype);

      // --- Audio: perturb time/frequency readouts at the LSB level ---
      if(window.AnalyserNode){
        var gffd=AnalyserNode.prototype.getFloatFrequencyData;
        AnalyserNode.prototype.getFloatFrequencyData=function(a){gffd.apply(this,arguments);try{var r=rng(a.length);for(var i=0;i<a.length;i++)a[i]=a[i]+(r()-0.5)*0.0002;}catch(e){}};
      }
      if(window.AudioBuffer){
        var gcd=AudioBuffer.prototype.getChannelData;
        AudioBuffer.prototype.getChannelData=function(){var a=gcd.apply(this,arguments);try{var r=rng(a.length|0);for(var i=0;i<a.length;i+=137)a[i]=a[i]+(r()-0.5)*1e-7;}catch(e){}return a;};
      }

      // --- Normalize a couple of high-entropy navigator values ---
      try{Object.defineProperty(navigator,'hardwareConcurrency',{get:function(){return 8;},configurable:true});}catch(e){}
      try{Object.defineProperty(navigator,'deviceMemory',{get:function(){return 8;},configurable:true});}catch(e){}
    }catch(e){}
  })();`;

  try {
    const s = document.createElement('script');
    s.textContent = src;
    (document.head || document.documentElement).appendChild(s);
    s.remove();
  } catch (err) { /* best-effort */ }
})();

// Export the pure origin matcher for unit tests (renderer loads this file as a
// preload where module is undefined, so this guard keeps runtime unchanged).
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { _isVexStartPage };
}

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

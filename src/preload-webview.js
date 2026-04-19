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
// native navigator.geolocation returns POSITION_UNAVAILABLE on Windows even
// after the user grants permission. Replacing navigator.geolocation also
// bypasses Chromium's setPermissionRequestHandler for `geolocation`, so we
// gate ourselves via an IPC round-trip to main (`geolocation:check-permission`)
// which reuses Vex's existing prompt + persisted-decisions store.
// Flow per call: permission check → Settings → Location / IP fallback.
(function () {
  let proto;
  try { proto = window.location.protocol; } catch { return; }
  if (proto === 'about:' || proto === 'chrome:' || proto === 'devtools:' ||
      proto === 'vex:' || proto === 'data:' || proto === 'file:') return;

  let ipcRenderer = null;
  try { ipcRenderer = require('electron').ipcRenderer; } catch {}

  const native = navigator.geolocation;

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

  async function getPrefFromMain() {
    if (!ipcRenderer) return null;
    try { return await ipcRenderer.invoke('geolocation:get'); }
    catch { return null; }
  }

  async function checkPermission() {
    if (!ipcRenderer) return 'deny';
    let origin = '';
    try { origin = window.location.origin; } catch {}
    try {
      return await ipcRenderer.invoke('geolocation:check-permission', { origin });
    } catch { return 'deny'; }
  }

  async function fetchIPLocation() {
    try {
      const r = await fetch('https://ipapi.co/json/', { headers: { 'Accept': 'application/json' } });
      if (r.ok) {
        const d = await r.json();
        if (d && d.latitude && d.longitude) return _pos(parseFloat(d.latitude), parseFloat(d.longitude), 50000);
      }
    } catch (err) { console.warn('[Vex Geo] ipapi.co failed:', err.message); }
    try {
      const r = await fetch('https://ipwho.is/');
      if (r.ok) {
        const d = await r.json();
        if (d && d.success && d.latitude && d.longitude) return _pos(parseFloat(d.latitude), parseFloat(d.longitude), 50000);
      }
    } catch (err) { console.warn('[Vex Geo] ipwho.is failed:', err.message); }
    return null;
  }

  function _deny(error, code, message) {
    if (!error) return;
    try {
      error({
        code,
        message,
        PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3
      });
    } catch {}
  }

  async function resolve(success, error) {
    const decision = await checkPermission();
    if (decision !== 'allow') {
      _deny(error, 1, 'Geolocation permission denied');
      return;
    }

    const pref = await getPrefFromMain();
    if (pref && pref.mode === 'off') {
      _deny(error, 1, 'Location access disabled in Vex settings');
      return;
    }
    if (pref && pref.mode === 'manual' && pref.latitude != null && pref.longitude != null) {
      try { success(_pos(pref.latitude, pref.longitude, 20)); } catch {}
      return;
    }
    // mode === 'ip' or pref missing → IP lookup
    const pos = await fetchIPLocation();
    if (pos) { try { success(pos); } catch {} return; }
    _deny(error, 2, 'Unable to determine location (IP fallback also failed)');
  }

  const watches = new Map();
  const wrapped = {
    getCurrentPosition(success, error /*, options */) {
      resolve(success, error).catch(() => _deny(error, 2, 'Geolocation resolution crashed'));
    },
    watchPosition(success, error, options) {
      const id = Math.floor(Math.random() * 1e9) + 1;
      wrapped.getCurrentPosition(success, error, options);
      const interval = setInterval(() => wrapped.getCurrentPosition(success, error, options), 5 * 60 * 1000);
      watches.set(id, interval);
      return id;
    },
    clearWatch(id) {
      if (watches.has(id)) { clearInterval(watches.get(id)); watches.delete(id); }
    }
  };
  void native;

  try {
    Object.defineProperty(navigator, 'geolocation', { value: wrapped, writable: false, configurable: true });
  } catch (err) {
    console.error('[Vex Geo] polyfill install failed:', err.message);
  }
})();

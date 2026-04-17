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
// after the user grants permission. We wrap it with an IP-based fallback
// (ipapi.co with ipwho.is as backup) — ~50 km accuracy, good enough for most
// "weather / local news" style use cases.
(function () {
  try {
    const proto = window.location.protocol;
    if (proto === 'about:' || proto === 'chrome:' || proto === 'devtools:' ||
        proto === 'vex:' || proto === 'data:' || proto === 'file:') return;
  } catch { return; }

  const native = navigator.geolocation;

  function _pos(lat, lng) {
    return {
      coords: {
        latitude: lat, longitude: lng,
        accuracy: 50000,
        altitude: null, altitudeAccuracy: null,
        heading: null, speed: null
      },
      timestamp: Date.now()
    };
  }

  async function fetchIPLocation() {
    try {
      const r = await fetch('https://ipapi.co/json/', { headers: { 'Accept': 'application/json' } });
      if (r.ok) {
        const d = await r.json();
        if (d && d.latitude && d.longitude) return _pos(parseFloat(d.latitude), parseFloat(d.longitude));
      }
    } catch (err) { console.warn('[Vex Geo] ipapi.co failed:', err.message); }
    try {
      const r = await fetch('https://ipwho.is/');
      if (r.ok) {
        const d = await r.json();
        if (d && d.success && d.latitude && d.longitude) return _pos(parseFloat(d.latitude), parseFloat(d.longitude));
      }
    } catch (err) { console.warn('[Vex Geo] ipwho.is failed:', err.message); }
    return null;
  }

  async function ipFallback(success, error) {
    const pos = await fetchIPLocation();
    if (pos) { try { success(pos); } catch {} return; }
    if (error) {
      try {
        error({
          code: 2,
          message: 'Unable to determine location (IP fallback also failed)',
          PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3
        });
      } catch {}
    }
  }

  const watches = new Map();
  const wrapped = {
    getCurrentPosition(success, error, options) {
      const timeoutMs = (options && options.timeout) || 5000;
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return; settled = true;
        console.log('[Vex Geo] native timeout, using IP fallback');
        ipFallback(success, error);
      }, timeoutMs);

      if (!native) { clearTimeout(timer); settled = true; return ipFallback(success, error); }
      try {
        native.getCurrentPosition(
          (p) => { if (settled) return; settled = true; clearTimeout(timer); try { success(p); } catch {} },
          (e) => {
            if (settled) return; settled = true; clearTimeout(timer);
            console.log('[Vex Geo] native error, using IP fallback:', e && e.message);
            ipFallback(success, error);
          },
          options
        );
      } catch (e) {
        if (!settled) { settled = true; clearTimeout(timer); ipFallback(success, error); }
      }
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

  try {
    Object.defineProperty(navigator, 'geolocation', { value: wrapped, writable: false, configurable: true });
    console.log('[Vex Geo] Geolocation polyfill installed (IP fallback: ipapi.co / ipwho.is)');
  } catch (err) {
    console.error('[Vex Geo] polyfill install failed:', err.message);
  }
})();

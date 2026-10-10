// === "<site> is full screen — press Esc to exit" ===
// A page that went full screen (a video, a game, or a page pretending to be
// your desktop or a login window) covered the whole screen with nothing to say
// whose it was or how to leave (security finding SE9). As in Chrome, a short
// notice names the site for a few seconds.
//
// The page's <webview> is the fullscreen element of this document; the
// notice is a manual popover, so it is drawn in the top layer above it (an
// ordinary element would be under the fullscreen page, whatever its z-index).
(function () {
  'use strict';

  const SHOW_MS = 4000;
  let bubble = null;
  let open = false;
  let timer = null;

  function siteOf(wv) {
    let url = '';
    try { url = wv.getURL(); } catch { url = wv.getAttribute('src') || ''; }
    try {
      const u = new URL(url);
      if (/^https?:$/.test(u.protocol)) return u.hostname.replace(/^www\./, '');
      if (u.protocol === 'file:') return 'A file on this computer';
    } catch { /* no address: said as "This page" */ }
    return 'This page';
  }

  function textFor(wv) { return siteOf(wv) + ' is full screen — press Esc to exit'; }

  function hide() {
    clearTimeout(timer);
    timer = null;
    if (bubble && open) { open = false; bubble.hidePopover(); }
  }

  function show(wv) {
    if (!bubble) {
      bubble = document.createElement('div');
      bubble.id = 'vex-fullscreen-notice';
      bubble.setAttribute('popover', 'manual');
      bubble.setAttribute('role', 'status');
      document.body.appendChild(bubble);
    }
    bubble.textContent = textFor(wv);
    hide();
    bubble.showPopover();
    open = true;
    timer = setTimeout(hide, SHOW_MS);
  }

  function onChange() {
    const el = document.fullscreenElement;
    if (el && el.tagName === 'WEBVIEW') show(el);
    else hide();
  }

  const api = { onChange, textFor, SHOW_MS, get bubble() { return bubble; }, get open() { return open; } };
  if (typeof window !== 'undefined') window.FullscreenNotice = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof document !== 'undefined') document.addEventListener('fullscreenchange', onChange);
})();

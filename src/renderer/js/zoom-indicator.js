// === Page zoom in the address bar ===
// At 120% page zoom nothing on screen said so (walkthrough L11, 2026-10-07).
// A small "120%" pill sits in the address bar whenever the page in front is
// not at 100%; clicking it puts the page back to 100%. Zoom changes from
// several places (Ctrl+= / Ctrl+wheel, the command bar, a site profile, the
// saved zoom of a site), so the pill reads the page's zoom on a light timer
// rather than trusting any one of them to say so.
(function () {
  'use strict';

  let pill = null;
  let shown = 100;

  function activeWebview() {
    return (typeof WebviewManager !== 'undefined' && typeof WebviewManager.getActiveWebview === 'function')
      ? WebviewManager.getActiveWebview() : null;
  }

  // The zoom of the page in front, in percent; 100 when there is no page.
  function currentPercent() {
    const wv = activeWebview();
    if (!wv || typeof wv.getZoomFactor !== 'function' || !wv.isConnected) return 100;
    let z;
    // A <webview> throws from getZoomFactor until its page is attached; that
    // page has no zoom of its own yet, so 100% is the truth, not a fallback.
    try { z = wv.getZoomFactor(); } catch { return 100; }
    return Number.isFinite(z) && z > 0 ? Math.round(z * 100) : 100;
  }

  function update() {
    if (!pill) return;
    const pct = currentPercent();
    if (pct === shown && pill.hidden === (pct === 100)) return;
    shown = pct;
    pill.hidden = pct === 100;
    pill.textContent = pct + '%';
    pill.title = 'Page zoom ' + pct + '% — click to go back to 100% (Ctrl+0)';
    pill.setAttribute('aria-label', 'Page zoom ' + pct + ' percent. Reset to 100 percent');
  }

  function init() {
    const bar = document.getElementById('url-bar');
    if (!bar) throw new Error('[ZoomIndicator] #url-bar missing');
    pill = document.createElement('button');
    pill.id = 'url-zoom';
    pill.type = 'button';
    pill.hidden = true;
    pill.addEventListener('click', () => {
      if (typeof WebviewManager === 'undefined') throw new Error('[ZoomIndicator] WebviewManager missing');
      WebviewManager.zoomReset();
      update();
    });
    const before = document.getElementById('btn-copy-url');
    if (before && before.parentElement === bar) bar.insertBefore(pill, before);
    else bar.appendChild(pill);
    VexJobs.every('Zoom indicator', 1000, update);
    update();
  }

  const api = { init, update, currentPercent };
  if (typeof window !== 'undefined') window.ZoomIndicator = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof document !== 'undefined' && document.getElementById) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
    else if (document.getElementById('url-bar')) init();
  }
})();

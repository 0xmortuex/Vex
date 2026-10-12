// === "Pop-up blocked" in the address bar ===
// Vex's pop-up blocker (src/main/popup-blocker.js) refuses a window a page
// opens without your click. The tab it happened in says so: a pill in the
// address bar, like Chrome's, that opens the site panel at Permissions, where
// the Pop-ups row has "Allow for this site" (js/site-panel.js). A page with
// no address bar (an app panel such as Discord) says it in a toast.
(function () {
  'use strict';

  const blocked = new Map();   // page (webContents) id -> { origin, pageUrl, urls: [] }
  const toldPanel = new Map(); // page id -> when its toast was last shown
  let pill = null;

  function tabWebviews() {
    return (typeof WebviewManager !== 'undefined' && WebviewManager.webviews) ? [...WebviewManager.webviews.entries()] : [];
  }
  function pageIdOf(wv) {
    try { return wv && typeof wv.getWebContentsId === 'function' ? wv.getWebContentsId() : null; } catch { return null; }
  }
  function urlOf(wv) {
    try { return wv.getURL() || ''; } catch { return ''; }
  }
  function tabOfPage(pageId) {
    for (const [tabId, wv] of tabWebviews()) if (pageIdOf(wv) === pageId) return { tabId, wv };
    return null;
  }
  function activePageId() {
    const wv = (typeof WebviewManager !== 'undefined' && typeof WebviewManager.getActiveWebview === 'function') ? WebviewManager.getActiveWebview() : null;
    return pageIdOf(wv);
  }

  function hostOf(origin) {
    try { return new URL(origin).hostname.replace(/^www\./, ''); } catch { return 'This page'; }
  }

  function update() {
    if (!pill) return;
    const rec = blocked.get(activePageId());
    pill.hidden = !rec;
    if (!rec) return;
    const n = rec.urls.length;
    const label = n === 1 ? 'Pop-up blocked' : n + ' pop-ups blocked';
    pill.querySelector('.url-popups-text').textContent = label;
    const what = `${label} on ${hostOf(rec.origin)}: windows it opened without your click. Click to allow pop-ups for this site.`;
    pill.title = what;
    pill.setAttribute('aria-label', what);
  }

  function onBlocked(data) {
    const { pageId, origin, url } = data || {};
    if (!Number.isInteger(pageId)) throw new Error('[PopupBlocked] a blocked pop-up came with no page');
    const tab = tabOfPage(pageId);
    if (!tab) {
      // An app panel: no address bar to show it in.
      if (Date.now() - (toldPanel.get(pageId) || 0) > 10000) {
        toldPanel.set(pageId, Date.now());
        window.showToast?.(`Blocked a pop-up from ${hostOf(origin)} — it opened without your click`, 'info', 4000);
      }
      return;
    }
    const pageUrl = urlOf(tab.wv);
    let rec = blocked.get(pageId);
    if (!rec || rec.pageUrl !== pageUrl) blocked.set(pageId, rec = { origin, pageUrl, urls: [] });
    rec.urls.push(String(url || 'about:blank'));
    if (rec.urls.length > 20) rec.urls.shift();
    update();
  }

  // The page went somewhere else: what was blocked on the last one is old news.
  function onUrlChanged(e) {
    const { tabId, url } = (e && e.detail) || {};
    for (const [tid, wv] of tabWebviews()) {
      if (tid !== tabId) continue;
      const id = pageIdOf(wv);
      const rec = blocked.get(id);
      if (rec && rec.pageUrl !== url) blocked.delete(id);
    }
    update();
  }

  function forPage(pageId) { return blocked.get(pageId) || null; }
  function clear(pageId) { blocked.delete(pageId); update(); }

  function init() {
    const bar = document.getElementById('url-bar');
    if (!bar) throw new Error('[PopupBlocked] #url-bar missing');
    pill = document.createElement('button');
    pill.id = 'url-popups';
    pill.type = 'button';
    pill.hidden = true;
    pill.innerHTML = `${VexIcons.svg('window', { size: 12 })}<span class="url-popups-text">Pop-up blocked</span>`;
    pill.addEventListener('click', (e) => {
      if (typeof SitePanel === 'undefined') throw new Error('[PopupBlocked] SitePanel missing');
      SitePanel.open({ section: 'permissions', pointer: e.detail > 0 });
    });
    const before = document.getElementById('btn-copy-url');
    if (before && before.parentElement === bar) bar.insertBefore(pill, before);
    else bar.appendChild(pill);
    if (!window.vex || typeof window.vex.onPopupBlocked !== 'function') throw new Error('[PopupBlocked] window.vex.onPopupBlocked missing');
    window.vex.onPopupBlocked((data) => {
      try { onBlocked(data); } catch (err) { console.error(err); }
    });
    window.addEventListener('vex:tab-url-changed', onUrlChanged);
    window.addEventListener('vex-tabs-changed', update);
    update();
  }

  const api = { init, update, onBlocked, onUrlChanged, forPage, clear };
  if (typeof window !== 'undefined') window.PopupBlocked = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof document !== 'undefined' && document.getElementById && typeof window !== 'undefined' && window.vex) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
    else if (document.getElementById('url-bar')) init();
  }
})();

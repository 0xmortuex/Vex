// === Turn off the microphone and camera in one press ==========================
//
// Ctrl+K "Turn Off Mic and Camera (This Tab)" and "(All Tabs)", and, when the person switched it on, a click on the microphone or
// camera icon on a tab. It does what the "Stop" button in Settings > Site Permissions > In use right now already does, from where
// you are, without leaving the call page: Vex's page-side hook (preload-webview.js, 'vex-stop-capture') ends every microphone and
// camera track that page opened through getUserMedia. The call page itself stays open.
//
// What this is NOT: a mute switch that can be flipped back. The tracks are ended, so the page sees its microphone or camera stop
// (a call site usually shows it as off or unplugged); pressing the page's own mic or camera button asks for the device again and,
// because the permission is still granted, it comes back. To stop a site for good, block it in Site Permissions. A screen share is
// not touched. A private or Tor tab is handled like any other: stopping a recording needs no data from the page.
//
//   VexCaptureMute.entries(scope, live, activeId)   pure: which live captures a scope covers
//   VexCaptureMute.stop(scope)                      -> number of pages asked to stop
//   VexCaptureMute.stopTab(tabId)                   -> true when that tab was asked
const VexCaptureMute = {
  BADGE_KEY: 'vex.captureMute.badge',        // 'on': a click on a tab's microphone or camera icon turns it off

  _t(text) { return (typeof VexI18nUI !== 'undefined' && VexI18nUI.lookup(text)) || text; },

  badgeOn() {
    try { return localStorage.getItem(this.BADGE_KEY) === 'on'; }
    catch (err) { console.error('[CaptureMute] the switch could not be read:', err.message); return false; }
  },
  setBadge(on) { localStorage.setItem(this.BADGE_KEY, on ? 'on' : 'off'); },

  // live: PermissionsSettings.liveCaptures() -> [{ where: 'tab'|'panel', id, label, mic, camera }]
  entries(scope, live, activeId) {
    const using = (Array.isArray(live) ? live : []).filter(e => e && (e.mic || e.camera));
    if (scope === 'tab') return using.filter(e => e.where === 'tab' && e.id === activeId);
    if (scope === 'all') return using;
    throw new Error('Choose this tab or all tabs');
  },

  _webview(entry) {
    if (entry.where === 'tab') return typeof WebviewManager !== 'undefined' ? WebviewManager.webviews.get(entry.id) : null;
    return typeof SidebarManager !== 'undefined' && SidebarManager.panelWebviews ? SidebarManager.panelWebviews[entry.id] : null;
  },

  _ask(entries) {
    let n = 0;
    for (const e of entries) {
      const wv = this._webview(e);
      if (!wv || typeof wv.send !== 'function') continue;
      wv.send('vex-stop-capture', 'all');
      n++;
    }
    return n;
  },

  stop(scope) {
    if (typeof PermissionsSettings === 'undefined' || typeof PermissionsSettings.liveCaptures !== 'function') throw new Error('The list of what is using the microphone or camera is not available');
    if (typeof VexUsage !== 'undefined') VexUsage.touch('capture-mute');
    const active = typeof TabManager !== 'undefined' ? TabManager.activeTabId : null;
    const list = this.entries(scope, PermissionsSettings.liveCaptures(), active);
    if (!list.length) { window.showToast?.(this._t(scope === 'tab' ? 'Nothing on this tab is using the microphone or camera.' : 'Nothing is using the microphone or camera.')); return 0; }
    const n = this._ask(list);
    if (!n) throw new Error('Those pages are not loaded any more');
    window.showToast?.(this._t('Asked the page to turn off the microphone and camera. If it asks again, block it in Site Permissions.'));
    return n;
  },

  // A click on the icon of one tab.
  stopTab(tabId) {
    if (typeof PermissionsSettings === 'undefined' || typeof PermissionsSettings.liveCaptures !== 'function') throw new Error('The list of what is using the microphone or camera is not available');
    const list = this.entries('all', PermissionsSettings.liveCaptures()).filter(e => e.where === 'tab' && e.id === tabId);
    if (!list.length) return false;
    const n = this._ask(list);
    if (n) window.showToast?.(this._t('Asked the page to turn off the microphone and camera. If it asks again, block it in Site Permissions.'));
    return n > 0;
  },
};

if (typeof window !== 'undefined') window.VexCaptureMute = VexCaptureMute;
if (typeof module !== 'undefined' && module.exports) module.exports = { VexCaptureMute };

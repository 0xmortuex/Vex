// === Forget a site when I close it (the window's side) =========================
//
// A site with the "Forget this site when I close it" rule (site panel; src/main/site-rules.js 'forget') is cleared when its LAST tab
// closes: main clears its cookies and storage in the tab's session (src/main/site-forget.js, the same code as "Clear this site's
// data"). This signs the person out of it each time; the switch says so. Vex quitting does the same from main.
//
// What this file decides, and main checks again:
//   - a tab that is closed on purpose, not one that is put away: workspace switches close tabs in bulk and bring them back, and
//     sleeping a tab destroys its page without closing the tab, so neither forgets anything;
//   - not in a private window, and not for a tab that keeps nothing (burner, off the record, Tor): those store nothing to forget;
//   - not while another tab of the same site (by the rule's own key, so a subdomain counts) is still open here;
//   - the site's rule was saved, and it is not one of the video, music and chat sites that cannot have it.
const VexForgetSite = {
  _bound: false,
  _note(msg, err) { if (window.VexProblems) window.VexProblems.note('Forget a site', msg, err); else console.error('[ForgetSite] ' + msg, err); },
  _t(text) { return (typeof VexI18nUI !== 'undefined' && VexI18nUI.lookup(text)) || text; },

  // What should be asked of main for a tab that is closing, or null. Pure apart from reading the tab list.
  planFor(tab, tabs, { privateWindow = false, bulk = false } = {}) {
    if (!tab || bulk || privateWindow) return null;
    const url = String(tab.url || '');
    if (!/^https?:/i.test(url)) return null;
    const partition = tab.partition || 'persist:main';
    if (!String(partition).startsWith('persist:') || partition === 'persist:route-tor') return null;
    if (!SiteRulesUI.forgetOn(url) || SiteRulesUI.forgetProtected(url)) return null;
    const key = SiteRulesUI.ruleKey(url);
    if (!key) return null;
    const stillOpen = tabs.some(t => t.id !== tab.id && /^https?:/i.test(String(t.url || '')) && SiteRulesUI.ruleKey(t.url) === key && (t.partition || 'persist:main') === partition);
    if (stillOpen) return null;
    return { url, partition };
  },

  async forget(plan, pageId) {
    const res = await window.vex.siteForget({ url: plan.url, partition: plan.partition, exceptPageId: Number.isInteger(pageId) ? pageId : undefined });
    if (!res || !res.ok) throw new Error((res && res.error) || 'The site could not be forgotten');
    if (res.cleared) window.showToast?.(this._t('Forgot {1}: its cookies and stored data were cleared.').replace('{1}', res.host || SiteRulesUI.host(plan.url)));
    return res;
  },

  init() {
    if (this._bound) return this;
    this._bound = true;
    // vex:tab-closed fires before the tab leaves the list, so what the tab was is read now and the others are counted after it left.
    this._onClosed = (e) => {
      const id = e.detail && e.detail.tabId;
      const tab = TabManager.tabs.find(t => t.id === id);
      if (!tab) return;
      const wv = WebviewManager.webviews.get(id);
      let pageId = null;
      try { pageId = wv && wv.getWebContentsId ? wv.getWebContentsId() : null; } catch { pageId = null; }
      // Read now: a bulk close (a workspace switch) is over by the time the timer fires.
      const bulk = !!TabManager._bulkClosing;
      const snapshot = { id: tab.id, url: (wv && wv.getURL && (() => { try { return wv.getURL(); } catch { return ''; } })()) || tab.url, partition: tab.partition };
      setTimeout(() => {
        const plan = this.planFor(snapshot, TabManager.tabs, { privateWindow: !!(window.VexTabPolicy && window.VexTabPolicy.isPrivateWindow), bulk });
        if (!plan) return;
        this.forget(plan, pageId).catch(err => { this._note('Could not forget ' + SiteRulesUI.host(plan.url), err); window.showToast?.(err.message, 'error'); });
      }, 0);
    };
    document.addEventListener('vex:tab-closed', this._onClosed);
    return this;
  },

  destroy() {
    if (this._onClosed) document.removeEventListener('vex:tab-closed', this._onClosed);
    this._onClosed = null;
    this._bound = false;
  },
};

if (typeof window !== 'undefined') {
  window.VexForgetSite = VexForgetSite;
  if (typeof document !== 'undefined' && window.vex && typeof window.vex.siteForget === 'function') VexForgetSite.init();
}
if (typeof module !== 'undefined' && module.exports) module.exports = { VexForgetSite };

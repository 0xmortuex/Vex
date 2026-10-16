// === A pinned tab's home page (T3-048) ==========================================
//
// A pinned tab is a place you keep (mail, chat, a calendar). Clicking a link in
// it moved the pin to someone else's page, and getting back meant retyping the
// address. Now a pinned tab has a HOME, the address it was pinned on, and:
//
//   * a link in that site that leaves the site opens in a new tab, so the pin
//     stays where it is. Only a plain click on a link: typing an address, a
//     redirect, a sign-in step that the site does by itself, and links inside
//     the site are untouched. If you take the pin elsewhere on purpose, links
//     there are left alone too (the rule applies while the page is on the home
//     site);
//   * a small "Back to <home>" button over the corner of the page when the pin
//     has been taken away from its home, and the same in the tab's right-click
//     menu and in Ctrl+K ("Back to pinned page");
//   * "Make this page the pinned page" in the tab's menu, to move the home.
//
// The home is kept with the tab (js/tab-policy.js). Pinned private and Tor tabs
// are never written down, so they have none.
//
// Page-side: a click handler stringified into the page (see js/autoscroll.js for
// the way). It only calls window.open() for a link you clicked.

// Runs INSIDE the page (stringified). cfg = { host: 'mail.example.com' } or { host: '' } to stop.
function vexPinnedHomeGuest(cfg) {
  window.__vexPinHomeHost = String((cfg && cfg.host) || '');
  if (window.__vexPinHomeOn) return 'updated';
  window.__vexPinHomeOn = true;
  const bare = (h) => String(h || '').toLowerCase().replace(/^www\./, '');
  const sameSite = (a, b) => !!a && !!b && (a === b || a.endsWith('.' + b) || b.endsWith('.' + a));
  window.addEventListener('click', (e) => {
    const home = bare(window.__vexPinHomeHost);
    if (!home || !e.isTrusted || e.defaultPrevented || e.button !== 0) return;
    if (e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
    if (!sameSite(bare(location.hostname), home)) return;          // taken elsewhere on purpose
    const a = e.target && e.target.closest ? e.target.closest('a[href]') : null;
    if (!a || a.hasAttribute('download')) return;
    if (a.target && a.target !== '_self') return;                  // opens somewhere else already
    let url;
    try { url = new URL(a.href, location.href); } catch { return; }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return;
    if (sameSite(bare(url.hostname), home)) return;
    e.preventDefault();
    e.stopPropagation();
    window.open(url.href, '_blank', 'noopener');
  }, true);
  return 'installed';
}

const VexPinnedHome = {
  KEY: 'vex.pinnedHome',               // '0' = off
  LINKS_KEY: 'vex.pinnedHome.links',   // '0' = leaving links stay in the pin
  _pill: null,

  enabled() { return localStorage.getItem(this.KEY) !== '0'; },
  setEnabled(on) {
    localStorage.setItem(this.KEY, on ? '1' : '0');
    if (!on) this._hidePill();
    this._allPages();
    this.sync();
  },
  linksEnabled() { return localStorage.getItem(this.LINKS_KEY) !== '0'; },
  setLinksEnabled(on) { localStorage.setItem(this.LINKS_KEY, on ? '1' : '0'); this._allPages(); },

  hostOf(url) { try { return new URL(url).hostname; } catch { return ''; } },
  _web(url) { return /^https?:\/\//i.test(String(url || '')); },
  _key(url) {
    try { const u = new URL(url); return u.origin + u.pathname.replace(/\/+$/, ''); } catch { return String(url || ''); }
  },

  // ---- the tab's home ------------------------------------------------------------
  onPin(tab) {
    if (!this.enabled() || tab.homeUrl || !this._web(tab.url)) return;
    tab.homeUrl = tab.url;
  },
  onUnpin(tab) { tab.homeUrl = null; this.sync(); },

  setHome(tabId, url) {
    const tab = TabManager.tabs.find(t => t.id === tabId);
    if (!tab) throw new Error('That tab is gone');
    if (!tab.pinned) throw new Error('Only a pinned tab has a home page');
    const target = url == null ? tab.url : url;
    if (!this._web(target)) throw new Error('A home page has to be a web address');
    tab.homeUrl = target;
    TabManager.persistTabs();
    this._pagesOf([tab]);
    this.sync();
    return tab;
  },

  isAway(tab) {
    return !!tab && tab.pinned === true && this._web(tab.homeUrl) && this._web(tab.url) && this._key(tab.homeUrl) !== this._key(tab.url);
  },

  goHome(tabId) {
    const tab = TabManager.tabs.find(t => t.id === tabId);
    if (!tab || !this._web(tab.homeUrl)) throw new Error('This tab has no home page');
    if (TabManager.activeTabId !== tab.id) TabManager.switchTab(tab.id);
    WebviewManager.navigate(tab.homeUrl);
  },

  menuItems(tab) {
    if (!this.enabled() || !tab || !tab.pinned) return [];
    const fail = (err) => window.showToast?.((err && err.message) || String(err), 'error');
    const items = [];
    if (this._web(tab.homeUrl) && this.isAway(tab)) items.push({ label: 'Back to the pinned page', action: () => { try { this.goHome(tab.id); } catch (err) { fail(err); } } });
    if (this._web(tab.url) && this._key(tab.url) !== this._key(tab.homeUrl)) {
      items.push({ label: 'Make this the pinned page', action: () => { try { this.setHome(tab.id); window.showToast?.('This is now the pinned page'); } catch (err) { fail(err); } } });
    }
    return items;
  },

  // ---- the page side ---------------------------------------------------------------
  _script(tab) {
    const host = this.enabled() && this.linksEnabled() && tab.pinned && this._web(tab.homeUrl) ? this.hostOf(tab.homeUrl) : '';
    return '(' + vexPinnedHomeGuest.toString() + ')(' + JSON.stringify({ host }) + ')';
  },

  async _pagesOf(tabs) {
    if (typeof WebviewManager === 'undefined') return;
    for (const tab of tabs) {
      const wv = WebviewManager.webviews.get(tab.id);
      if (!wv || wv.isConnected === false || !this._web(tab.url)) continue;
      try { await window.vexGuestEval(wv, this._script(tab), false, 3000); }
      catch (err) { if (typeof VexProblems !== 'undefined') VexProblems.note('Pinned home', 'Could not set a pinned page up', err); }
    }
  },
  _allPages() { if (typeof TabManager !== 'undefined') this._pagesOf(TabManager.tabs.filter(t => t.pinned || t.homeUrl)); },

  // ---- the button ------------------------------------------------------------------
  _hidePill() { if (this._pill) { this._pill.remove(); this._pill = null; } },

  sync() {
    if (typeof TabManager === 'undefined') return;
    const tab = TabManager.getActiveTab ? TabManager.getActiveTab() : null;
    if (!this.enabled() || !this.isAway(tab)) { this._hidePill(); return; }
    const host = document.getElementById('webviews-container');
    if (!host) return;
    if (!this._pill) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'vph-pill';
      b.addEventListener('click', () => {
        const t = TabManager.getActiveTab();
        try { this.goHome(t.id); } catch (err) { window.showToast?.((err && err.message) || String(err), 'error'); }
      });
      host.appendChild(b);
      this._pill = b;
    }
    const name = this.hostOf(tab.homeUrl).replace(/^www\./, '');
    this._pill.textContent = '';
    if (typeof VexIcons !== 'undefined' && VexIcons.has('home')) this._pill.insertAdjacentHTML('beforeend', VexIcons.svg('home', { size: 13 }));
    this._pill.appendChild(document.createTextNode('Back to ' + name));
    this._pill.title = 'Go back to the page this tab is pinned on: ' + tab.homeUrl;
    this._pill.setAttribute('aria-label', 'Back to the pinned page, ' + name);
  },

  init() {
    if (this._inited) return false;
    this._inited = true;
    const sync = () => this.sync();
    window.addEventListener('vex:tab-activated', sync);
    window.addEventListener('vex:tab-url-changed', sync);
    document.addEventListener('vex:tab-navigated', sync);
    document.addEventListener('vex:tab-closed', () => setTimeout(sync, 0));
    // A pinned tab's page gets the link rule once it has loaded.
    document.addEventListener('vex:tab-settled', (e) => {
      const tab = TabManager.tabs.find(t => t.id === (e.detail && e.detail.tabId));
      if (tab && this.enabled() && tab.pinned) this._pagesOf([tab]);
    });
    sync();
    return true;
  },
};

if (typeof window !== 'undefined') window.VexPinnedHome = VexPinnedHome;
if (typeof module !== 'undefined' && module.exports) module.exports = { VexPinnedHome, vexPinnedHomeGuest };

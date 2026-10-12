// === A web panel's page, as a tab ==========================================
//
// "add an option next to Roblox Hub saying that it can open the current tab
// as a tab (website), so people who need links or IDs would find it easier"
// (owner, 2026-10-12). A panel has no address bar: a game's ID or a server
// link could only be dug out of the page. Every web panel (Roblox Hub,
// Discord, WhatsApp, Spotify, the AI panel, Prime/Netflix, pinned sites) can
// now hand the page it is SHOWING — not the one it started on — to a normal
// tab next to the one in front, where the address is in the address bar; or
// put that address on the clipboard.
//
// The tab opens in the panel's own session (persist:roblox, persist:discord…;
// a pinned site's is persist:main, the same as any tab), so you are still
// signed in there. Those sessions are full browsing sessions: Discord as a
// tab (js/discord-memory.js) has used persist:discord for a tab all along,
// and main sets every partition up the same way when a webview asks for it
// (main/session-security.js). In a private window the panel and the tab both
// get the window's own in-memory session — main forces it on every webview
// there, and VexTabPolicy.partitionFor gives the tab the same one — so
// nothing leaves the private window and nothing is kept.
//
// Where it is offered: a button on the panel's own bar (beside back, forward
// and reload — in the browser looks that bar sits in the sidebar header),
// the right-click menu of the panel's sidebar icon, and Ctrl+K.
const PanelToTab = {
  // The words, in the language Vex is set to (js/i18n-ui.js table).
  t(en) {
    const hit = typeof VexI18nUI !== 'undefined' ? VexI18nUI.lookup(en) : null;
    return hit || en;
  },

  _sidebar() {
    if (typeof SidebarManager === 'undefined') throw new Error('The sidebar is not available in this window');
    return SidebarManager;
  },

  // A panel that shows a web page (not Notes, History, Settings…).
  isWebPanel(name) {
    if (!name || typeof SidebarManager === 'undefined') return false;
    return SidebarManager.isWebPanel(name);
  },

  // The web panel in front: the main one, or the one beside it.
  frontWebPanel() {
    if (typeof SidebarManager === 'undefined') return null;
    for (const name of [SidebarManager.activePanel, SidebarManager.sidePanel]) {
      if (this.isWebPanel(name)) return name;
    }
    return null;
  },

  // The address the panel is showing now. A panel that is not loaded (never
  // opened, or asleep) shows its own link the moment it is opened, so that
  // link is what it is showing.
  currentUrl(name) {
    const sb = this._sidebar();
    if (!this.isWebPanel(name)) throw new Error(this.t('This panel does not show a web page'));
    const wv = sb.panelWebviews[name];
    let url = '';
    if (wv) {
      try { url = typeof wv.getURL === 'function' ? wv.getURL() : ''; } catch { url = ''; }
      if (!url || /^about:blank/i.test(url)) url = (wv.dataset && wv.dataset.liveUrl) || '';
    } else {
      url = (sb.panelConfigs[name] && sb.panelConfigs[name].url) || '';
    }
    if (!/^https?:\/\//i.test(url)) throw new Error(sb.panelLabel(name) + ' ' + this.t('has no page to open yet'));
    return url;
  },

  // The panel's session. A pinned site has persist:main, like a tab.
  partitionOf(name) {
    const cfg = this._sidebar().panelConfigs[name];
    return (cfg && cfg.partition) || 'persist:main';
  },

  // Opens the panel's page as a tab beside the one in front, in the panel's
  // session (a private window's own, there). Opening the tab brings it to the
  // front, which closes the panel (TabManager.switchTab).
  openInTab(name) {
    const url = this.currentUrl(name);
    if (typeof TabManager === 'undefined') throw new Error('Tabs are not available in this window');
    const active = TabManager.getActiveTab();
    const opts = { partition: this.partitionOf(name) };
    if (active) { opts.openerTabId = active.id; opts.rightAfterOpener = true; }
    return TabManager.createTab(url, true, active ? (active.groupId || null) : null, opts);
  },

  async copyLink(name) {
    const url = this.currentUrl(name);
    await navigator.clipboard.writeText(url);
    window.showToast?.(this.t('Page link copied') + ': ' + url);
    return url;
  },

  // The same, with what went wrong said out loud.
  run(what, name) {
    try {
      const r = what === 'copy' ? this.copyLink(name) : this.openInTab(name);
      if (r && typeof r.then === 'function') r.catch(err => window.showToast?.(this.t('Could not copy the link') + ': ' + ((err && err.message) || err), 'error'));
    } catch (err) {
      window.showToast?.((err && err.message) || String(err), 'error');
    }
  },

  // Items for the right-click menu of a web panel's sidebar icon.
  menuItems(name) {
    if (!this.isWebPanel(name)) return [];
    return [
      { label: this.t('Open in a tab'), action: () => this.run('open', name) },
      { label: this.t('Copy page link'), action: () => this.run('copy', name) },
    ];
  },

  // The button on a web panel's bar (sidebar.js _addPanelNav).
  decorateNav(nav, name) {
    if (!nav || !this.isWebPanel(name) || nav.querySelector('.pnav-tab')) return null;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'pnav-btn pnav-tab';
    btn.title = 'Open in a tab';
    btn.setAttribute('aria-label', 'Open in a tab');
    btn.innerHTML = typeof VexIcons !== 'undefined' ? VexIcons.svg('external', { size: 13 }) : '';
    if (typeof VexI18nUI !== 'undefined') VexI18nUI.translateEl(btn);
    btn.addEventListener('click', () => this.run('open', name));
    nav.appendChild(btn);
    return btn;
  },

  // Ctrl+K: Roblox Hub by name, and whichever web panel is in front.
  commands() {
    const self = this;
    return [
      {
        id: 'roblox-page-tab', icon: 'external',
        get label() { return self.t('Open Roblox Hub page in a tab'); },
        get hint() { return self.t('The page Roblox Hub is showing, as a tab with its address — still signed in'); },
        when: () => self.isWebPanel('roblox'),
        action: () => self.run('open', 'roblox'),
      },
      {
        id: 'panel-page-tab', icon: 'external',
        get label() { return self.t('Open side panel page in a tab'); },
        get hint() { return self.t('The page the open side panel is showing, as a tab with its address — still signed in'); },
        when: () => !!self.frontWebPanel(),
        action: () => { const name = self.frontWebPanel(); if (!name) { window.showToast?.(self.t('Open a web panel first'), 'error'); return; } self.run('open', name); },
      },
    ];
  },
};

if (typeof window !== 'undefined') {
  window.PanelToTab = PanelToTab;
  // The bar's button keeps up with a language change (js/i18n-ui.js reverts
  // and re-translates its own scopes first; the bar is not one of them).
  window.addEventListener('vex-lang-changed', () => {
    setTimeout(() => {
      if (typeof VexI18nUI === 'undefined') return;
      document.querySelectorAll('.pnav-tab').forEach(b => VexI18nUI.translateEl(b));
    }, 0);
  });
}
if (typeof module !== 'undefined' && module.exports) module.exports = { PanelToTab };

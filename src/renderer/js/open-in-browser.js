// === Open this page or link in another browser ================================================================
//
// For the sites that turn an Electron browser away (some banks, e-Devlet, DRM players): hand the address to the
// default browser, or to Edge, Chrome, Firefox or Brave when one is installed. The page menu, the link menu and
// Ctrl+K use this. The work is in main (main/open-in-browser.js: http(s) only, one argument, no shell).
//
// A private, Tor, burner or routed tab, or any tab of a private window, is protected by where it connects from. The
// other browser would load the address from the real connection with its own cookies, so those ask first.
//
// The installed list is asked for once, after start-up; until it answers, only "default browser" is offered.
const VexOpenIn = {
  DEFAULT: { id: 'default', label: 'Open in default browser' },
  BROWSERS: { edge: 'Open in Microsoft Edge', chrome: 'Open in Google Chrome', firefox: 'Open in Mozilla Firefox', brave: 'Open in Brave' },
  installed: [],     // [{ id, name }] from main

  // The choices to offer, from the installed list: the default first, then the known browsers that are installed.
  choices(installed = this.installed) {
    const out = [this.DEFAULT];
    for (const b of installed || []) if (Object.prototype.hasOwnProperty.call(this.BROWSERS, b.id)) out.push({ id: b.id, label: this.BROWSERS[b.id] });
    return out;
  },
  // Does the address have the form that can leave?
  canOpen(url) {
    return typeof url === 'string' && /^https?:\/\//i.test(url) && url.length <= 8192;
  },
  // Does opening it elsewhere leave the protection the tab gives?
  leavesProtection(webview) {
    const policy = window.VexTabPolicy;
    if (!policy) return false;
    if (policy.isPrivateWindow) return true;
    return !!webview && !policy.canReadWebview(webview);
  },

  async open(url, browser, webview) {
    if (!this.canOpen(url)) { window.showToast?.('Only a web address (http or https) can be opened in another browser', 'error'); return false; }
    if (this.leavesProtection(webview)) {
      const ok = await window.vexConfirm({
        title: 'Open this outside the protected tab?',
        message: 'This tab is private, routed or disposable. Another browser loads the address from your real connection and with its own cookies, so what this tab hides would not be hidden there.',
        okLabel: 'Open it anyway',
      });
      if (!ok) return false;
    }
    try {
      const r = await window.vex.openInBrowser(url, browser);
      if (!r || !r.ok) { window.showToast?.((r && r.error) || 'Could not open it in that browser', 'error'); return false; }
      return true;
    } catch (err) {
      window.VexProblems?.note('Open in another browser', 'the browser could not be started', err);
      window.showToast?.('Could not open it in that browser: ' + err.message, 'error');
      return false;
    }
  },

  // Rows for a context menu: one per choice.
  menuItems(url, webview) {
    if (!this.canOpen(url)) return [];
    return this.choices().map(c => ({ label: c.label, action: () => { this.open(url, c.id, webview); } }));
  },

  activePage() {
    const wv = typeof WebviewManager !== 'undefined' && WebviewManager.getActiveWebview ? WebviewManager.getActiveWebview() : null;
    let url = '';
    try { url = (wv && wv.getURL && wv.getURL()) || ''; } catch (err) { window.VexProblems?.note('Open in another browser', 'could not read the page address', err); }
    return { wv, url };
  },
  runOnPage(browser) {
    const { wv, url } = this.activePage();
    if (!url) { window.showToast?.('There is no page open to hand over', 'error'); return; }
    this.open(url, browser, wv);
  },

  async init() {
    if (this._started) return this;
    this._started = true;
    if (typeof VexExtras !== 'undefined') {
      VexExtras.registerCommand({ id: 'open-in-default-browser', label: 'Open this page in my default browser', icon: 'globe', hint: 'For a site that does not work here: a bank, e-Devlet or a streaming service', keywords: 'default browser external chrome edge another browser site does not work open outside', action: () => this.runOnPage('default') });
    }
    try {
      this.installed = (await window.vex.listBrowsers()) || [];
    } catch (err) {
      window.VexProblems?.note('Open in another browser', 'the installed browsers could not be listed', err);
      return this;
    }
    if (typeof VexExtras !== 'undefined') {
      const cmds = {
        edge: { id: 'open-in-edge', label: 'Open this page in Microsoft Edge' },
        chrome: { id: 'open-in-chrome', label: 'Open this page in Google Chrome' },
        firefox: { id: 'open-in-firefox', label: 'Open this page in Mozilla Firefox' },
        brave: { id: 'open-in-brave', label: 'Open this page in Brave' },
      };
      for (const b of this.installed) {
        const c = cmds[b.id];
        if (c) VexExtras.registerCommand({ ...c, icon: 'globe', hint: 'For a site that does not work here', keywords: 'external another browser open outside ' + b.id, action: () => this.runOnPage(b.id) });
      }
    }
    return this;
  },
};

if (typeof window !== 'undefined') {
  window.VexOpenIn = VexOpenIn;
  if (typeof document !== 'undefined' && window.vex && typeof window.vex.listBrowsers === 'function') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => VexOpenIn.init(), { once: true });
    else VexOpenIn.init();
  }
}
if (typeof module !== 'undefined' && module.exports) module.exports = { VexOpenIn };

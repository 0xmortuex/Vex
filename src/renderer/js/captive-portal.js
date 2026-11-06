// === Does this network want a sign-in? (the window's side) ======================
//
// Café, school and airport Wi-Fi hold you at their own sign-in page, and in Vex that looks like a page that did not load
// (HTTPS-only upgrades the portal's plain-http page, strict secure DNS never asks the portal's resolver). Two places ask:
//
//   - the "page did not load" screen (js/load-failure.js) shows "Is this a Wi-Fi sign-in?" for the errors a portal causes
//   - Ctrl+K "Check If This Network Needs A Sign-In"
//
// Nothing here starts by itself. The check is one plain-http request to a page whose answer is known (main/captive-portal.js,
// recorded in the egress ledger). If the network is holding you, "Open the sign-in page" lets HTTPS-only leave the portal's own
// hosts alone until Vex closes and opens it in a tab. If strict secure DNS is on, "Pause secure DNS" turns it off for ten
// minutes and main puts it back. Neither changes a saved setting.
const VexCaptivePortal = {
  // The errors a portal causes: the name did not resolve, the connection was reset, closed, refused to finish or timed out.
  CODES: new Set([-105, -106, -101, -100, -104, -109, -118, -7, -324, -21, -137]),
  PAUSE_MINUTES: 10,

  offers(code) { return this.CODES.has(Number(code)); },

  _t(text) { return (typeof VexI18nUI !== 'undefined' && VexI18nUI.lookup(text)) || text; },

  _api() {
    const v = typeof window !== 'undefined' ? window.vex : null;
    if (!v || typeof v.captiveCheck !== 'function' || typeof v.captiveAllowHttp !== 'function' || typeof v.captivePauseSecureDns !== 'function') {
      throw new Error('The sign-in check is not available in this build');
    }
    return v;
  },

  async check() { return this._api().captiveCheck(); },

  // What a result says, in a sentence or two. state: checking | error | open | portal | offline | unknown.
  describe(r) {
    if (!r) return '';
    if (r.state === 'checking') return this._t('Checking the network…');
    if (r.state === 'error') return this._t('The check did not work: {1}').replace('{1}', r.note || '');
    const parts = [];
    if (r.state === 'open') parts.push(this._t('This network is not asking you to sign in. If the page still does not load, the problem is the site or your connection.'));
    else if (r.state === 'portal') parts.push(this._t('This network wants you to sign in first.'));
    else if (r.state === 'offline') parts.push(this._t('The check page could not be reached at all, so the network may be down, or Vex may be sent through Tor or a proxy that is not answering.'));
    else parts.push(this._t('The check was not conclusive.'));
    if (r.secureDns === 'strict' && r.state !== 'open') {
      parts.push(this._t('Strict secure DNS is on and never asks the network’s own DNS, which is how a sign-in page finds you. You can pause it for a few minutes.'));
    }
    return parts.join(' ');
  },

  // The buttons a result offers. Each is a press; none runs by itself.
  actions(r) {
    const out = [];
    if (!r) return out;
    if (r.state === 'portal' && r.loginUrl) out.push({ label: 'Open the sign-in page', primary: true, title: 'Opens the network’s own page in a new tab', run: () => this.signIn(r) });
    if (r.state !== 'open' && r.state !== 'checking' && r.state !== 'error' && r.secureDns === 'strict') {
      out.push({ label: 'Pause secure DNS for 10 minutes', primary: false, title: 'Put back by itself afterwards; your saved setting is not changed', run: () => this.pauseSecureDns() });
    }
    return out;
  },

  async signIn(r) {
    const api = this._api();
    if (!r || r.state !== 'portal' || !r.loginUrl || !Array.isArray(r.hosts) || !r.hosts.length) throw new Error('There is no sign-in page to open');
    const yes = typeof window.vexConfirm === 'function' && await window.vexConfirm({
      title: this._t('Sign in to this network?'),
      message: this._t('Wi-Fi sign-in pages are usually not encrypted (http://). Until you close Vex, HTTPS-only will leave these addresses alone: {1}. Only sign in to the Wi-Fi itself, and do not type a password you use anywhere else.').replace('{1}', r.hosts.join(', ')),
      okLabel: this._t('Open the sign-in page'),
      cancelLabel: this._t('Not now'),
    });
    if (!yes) return false;
    const res = await api.captiveAllowHttp(r.hosts);
    if (!res || !res.ok) throw new Error('Vex could not allow the sign-in page');
    if (typeof TabManager === 'undefined' || typeof TabManager.createTab !== 'function') throw new Error('Tabs are not loaded');
    TabManager.createTab(r.loginUrl, true);
    window.showToast?.(this._t('Sign in on the page that opened, then reload the page that did not load.'));
    return true;
  },

  async pauseSecureDns() {
    const res = await this._api().captivePauseSecureDns(this.PAUSE_MINUTES);
    if (!res || !res.ok) throw new Error('Secure DNS could not be paused');
    window.showToast?.(this._t('Secure DNS is paused for {1} minutes.').replace('{1}', String(this.PAUSE_MINUTES)));
    return true;
  },

  // From the "page did not load" screen: ask, show the answer on that screen.
  async checkFor(tabId) {
    const tab = typeof TabManager !== 'undefined' ? TabManager.tabs.find(t => t.id === tabId) : null;
    const failed = tab && tab._failedPage;
    if (!failed) return false;
    failed.captive = { state: 'checking' };
    VexLoadFailure.render();
    let result;
    try { result = await this.check(); }
    catch (err) { result = { state: 'error', note: (err && err.message) || String(err) }; }
    if (tab._failedPage === failed) { failed.captive = result; VexLoadFailure.render(); }
    return true;
  },

  // Ctrl+K "Check If This Network Needs A Sign-In": ask, then say, and offer what the answer allows.
  async runCommand() {
    window.showToast?.(this._t('Checking the network…'));
    const r = await this.check();
    const act = this.actions(r);
    if (r.state === 'portal' && r.loginUrl) { await this.signIn(r); return r; }
    if (act.length && typeof window.vexConfirm === 'function') {
      const yes = await window.vexConfirm({ title: this._t('Network check'), message: this.describe(r), okLabel: this._t(act[0].label), cancelLabel: this._t('Not now') });
      if (yes) await act[0].run();
    } else {
      window.showToast?.(this.describe(r));
    }
    return r;
  },
};

if (typeof window !== 'undefined') window.VexCaptivePortal = VexCaptivePortal;
if (typeof module !== 'undefined' && module.exports) module.exports = { VexCaptivePortal };

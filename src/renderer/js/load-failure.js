// === The page that did not load (T3-055) =======================================
//
// A page that could not be reached showed Chromium's own error page: a grey
// sad-face and a code such as ERR_NAME_NOT_RESOLVED, in a different font, with
// one button. This is Vex's own, over the tab:
//
//   what happened in a sentence, what to try, and the buttons that help:
//     Try again · Try the secure address again (hard reload) · Try http://
//     (only for a https address, and only after you confirm that it is not
//     encrypted) · Open your saved copy (only if you archived this page) ·
//     Look in the Wayback Machine (archive.org) · Copy the address.
//
// Nothing is retried, bypassed, rerouted or started by itself. Every button is a
// press, and none changes a setting or starts or stops a bypass, Tor or a proxy:
// the "try via" choices are the ones Vex already has as plain pages (the saved
// copy, the Wayback Machine). A certificate problem keeps the page main draws
// for it (main/https-only.js), and a page the ad blocker stopped is its own
// notice, so neither gets this.
//
// The reload/stop toggle on the toolbar already exists (js/nav-lock.js); the
// failure is cleared when the next navigation starts.
const VexLoadFailure = {
  KEY: 'vex.loadFailure',              // '0' = off: Chromium's own page is left showing
  DELAY_MS: 250,                       // main may be about to show its own page (https-only, Tor down)
  _el: null,
  _timers: new Map(),

  enabled() { return localStorage.getItem(this.KEY) !== '0'; },
  setEnabled(on) {
    localStorage.setItem(this.KEY, on ? '1' : '0');
    if (!on) this.hide();
    else this.render();
  },

  // What each error means, in plain words. code → [name, what happened, what to try]
  WORDS: {
    '-105': ['ERR_NAME_NOT_RESOLVED', 'The address could not be found.', 'Check it for a typo. If it is right, the site may be down, or your connection or DNS may be.'],
    '-106': ['ERR_INTERNET_DISCONNECTED', 'You are not connected to the internet.', 'Check your Wi-Fi or cable, then try again.'],
    '-102': ['ERR_CONNECTION_REFUSED', 'The site refused the connection.', 'It may be down, or not listening on that address.'],
    '-101': ['ERR_CONNECTION_RESET', 'The connection was reset.', 'Something between you and the site dropped it. Trying again often works.'],
    '-100': ['ERR_CONNECTION_CLOSED', 'The connection was closed.', 'Trying again often works.'],
    '-104': ['ERR_CONNECTION_FAILED', 'The connection failed.', 'Check your connection, then try again.'],
    '-109': ['ERR_ADDRESS_UNREACHABLE', 'That address cannot be reached from here.', 'Your network may have no route to it.'],
    '-118': ['ERR_CONNECTION_TIMED_OUT', 'The site took too long to answer.', 'It may be busy or down. Try again in a moment.'],
    '-7': ['ERR_TIMED_OUT', 'The site took too long to answer.', 'It may be busy or down. Try again in a moment.'],
    '-324': ['ERR_EMPTY_RESPONSE', 'The site sent nothing back.', 'It may be having trouble. Try again in a moment.'],
    '-501': ['ERR_INSECURE_RESPONSE', 'The site\'s secure connection could not be trusted.', 'Vex did not load it.'],
    '-310': ['ERR_TOO_MANY_REDIRECTS', 'The site keeps sending you in circles.', 'Clearing this site\'s cookies often fixes it.'],
    '-21': ['ERR_NETWORK_CHANGED', 'Your network changed while the page loaded.', 'Try again.'],
    '-137': ['ERR_NAME_RESOLUTION_FAILED', 'The address could not be looked up.', 'Check your connection or DNS, then try again.'],
    '-130': ['ERR_PROXY_CONNECTION_FAILED', 'The proxy could not be reached.', 'The proxy this tab uses is not answering.'],
  },

  // Nothing to say for these: an aborted load, a certificate error (main shows its own page), a request the
  // ad blocker or a site rule stopped, and a file the browser handed to the download manager.
  skip(code) {
    return code === -3 || code === -20 || code === -27 || code === -26 || (code <= -200 && code >= -299);
  },

  describe(code) {
    const w = this.WORDS[String(code)];
    return w ? { name: w[0], what: w[1], tip: w[2] } : { name: 'Error ' + code, what: 'The page could not be loaded.', tip: 'Try again in a moment.' };
  },

  // The webview reported a failed main-frame load (js/webview.js did-fail-load).
  note(tabId, e) {
    if (!this.enabled() || !e || e.isMainFrame === false || this.skip(e.errorCode)) return false;
    const url = String(e.validatedURL || '');
    if (!/^https?:\/\//i.test(url)) return false;
    const tab = TabManager.tabs.find(t => t.id === tabId);
    if (!tab) return false;
    clearTimeout(this._timers.get(tabId));
    this._timers.set(tabId, setTimeout(() => {
      this._timers.delete(tabId);
      // Still the failure that is current (a new navigation clears it)?
      if (!tab._loadFailed || tab._loadFailed.url !== url) return;
      tab._failedPage = { code: e.errorCode, url, copy: undefined };
      this.render();
      this._findCopy(tab);
    }, this.DELAY_MS));
    return true;
  },

  // A new navigation began in this tab.
  clear(tabId) {
    clearTimeout(this._timers.get(tabId));
    this._timers.delete(tabId);
    const tab = typeof TabManager !== 'undefined' ? TabManager.tabs.find(t => t.id === tabId) : null;
    if (tab && tab._failedPage) { tab._failedPage = null; this.render(); }
  },

  async _findCopy(tab) {
    const failed = tab._failedPage;
    if (!failed || typeof ArchiveLibrary === 'undefined' || !ArchiveLibrary.offerEnabled()) return;
    if (window.VexTabPolicy && window.VexTabPolicy.isPrivateWindow) return;
    const api = ArchiveLibrary._api();
    if (!api || typeof api.pageArchiveFind !== 'function') return;
    try {
      const r = await api.pageArchiveFind(failed.url);
      if (tab._failedPage === failed && r && r.ok && r.entry) { failed.copy = r.entry; this.render(); }
    } catch (err) {
      if (typeof VexProblems !== 'undefined') VexProblems.note('Failed page', 'Could not look for your saved copy of this page', err);
    }
  },

  hide() { if (this._el) { this._el.remove(); this._el = null; } },

  render() {
    const tab = typeof TabManager !== 'undefined' && TabManager.getActiveTab ? TabManager.getActiveTab() : null;
    const failed = tab && tab._failedPage;
    if (!this.enabled() || !failed) { this.hide(); return; }
    const host = document.getElementById('webviews-container');
    if (!host) return;
    this.hide();
    const d = this.describe(failed.code);
    let site = failed.url;
    try { site = new URL(failed.url).host; } catch { site = failed.url; }   // a malformed address is shown whole
    const el = document.createElement('div');
    el.id = 'vex-load-failure';
    el.className = 'vlf';
    el.setAttribute('role', 'alert');
    const box = document.createElement('div');
    box.className = 'vlf-card';
    const h = document.createElement('h2'); h.className = 'vlf-title'; h.textContent = site + ' did not load';
    const p = document.createElement('p'); p.className = 'vlf-what'; p.textContent = d.what;
    const t = document.createElement('p'); t.className = 'vlf-tip'; t.textContent = d.tip;
    const u = document.createElement('p'); u.className = 'vlf-url'; u.textContent = failed.url + '  ·  ' + d.name;
    const row = document.createElement('div'); row.className = 'vlf-actions';
    const add = (label, primary, run, title) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'vlf-btn' + (primary ? ' vlf-primary' : '');
      b.textContent = label;
      if (title) b.title = title;
      b.addEventListener('click', () => { Promise.resolve().then(run).catch(err => { console.error('[LoadFailure] ' + label + ' failed:', err); window.showToast?.(label + ' did not work: ' + ((err && err.message) || err), 'error'); }); });
      row.appendChild(b);
    };
    add('Try again', true, () => this.retry(tab.id, false));
    if (/^https:/i.test(failed.url)) add('Reload from the server', false, () => this.retry(tab.id, true), 'Ignore anything kept from before');
    if (/^https:/i.test(failed.url) && !this._local(failed.url)) add('Try http:// instead', false, () => this.tryHttp(tab.id), 'Not encrypted: you will be asked to confirm');
    if (failed.copy) add('Open your saved copy', false, () => ArchiveLibrary.openCopy(failed.copy.id), 'Saved ' + new Date(failed.copy.at).toLocaleString());
    if (typeof LinkRot !== 'undefined') add('Look in the Wayback Machine', false, () => LinkRot.viewArchived(failed.url), 'Opens archive.org in a new tab');
    add('Copy the address', false, () => navigator.clipboard.writeText(failed.url).then(() => window.showToast?.('Address copied')));
    box.append(h, p, t, row, u);
    el.appendChild(box);
    host.appendChild(el);
    this._el = el;
  },

  _local(url) {
    try { const h = new URL(url).hostname; return h === 'localhost' || /^\d{1,3}(\.\d{1,3}){3}$/.test(h) || h.includes(':') || h.endsWith('.local'); } catch { return true; }
  },

  retry(tabId, ignoreCache) {
    const tab = TabManager.tabs.find(t => t.id === tabId);
    const failed = tab && tab._failedPage;
    if (!failed) return false;
    if (TabManager.activeTabId !== tabId) TabManager.switchTab(tabId);
    const wv = WebviewManager.webviews.get(tabId);
    if (ignoreCache && wv && typeof wv.reloadIgnoringCache === 'function') { this.clear(tabId); wv.reloadIgnoringCache(); return true; }
    this.clear(tabId);
    WebviewManager.navigate(failed.url);
    return true;
  },

  async tryHttp(tabId) {
    const tab = TabManager.tabs.find(t => t.id === tabId);
    const failed = tab && tab._failedPage;
    if (!failed || !/^https:/i.test(failed.url)) return false;
    const http = 'http:' + failed.url.slice('https:'.length);
    const yes = typeof window.vexConfirm === 'function' && await window.vexConfirm({
      title: 'Try without encryption?',
      message: 'http:// sends everything in the clear: anyone on your network can read it and change the page. Only continue for a site you would not mind being read, and never sign in there.',
      okLabel: 'Try http://',
      cancelLabel: 'Not now',
    });
    if (!yes) return false;
    this.clear(tabId);
    WebviewManager.navigate(http);
    return true;
  },

  init() {
    if (this._inited) return false;
    this._inited = true;
    window.addEventListener('vex:tab-activated', () => this.render());
    document.addEventListener('vex:tab-closed', (e) => { this.clear(e.detail && e.detail.tabId); setTimeout(() => this.render(), 0); });
    return true;
  },
};

if (typeof window !== 'undefined') window.VexLoadFailure = VexLoadFailure;
if (typeof module !== 'undefined' && module.exports) module.exports = { VexLoadFailure };

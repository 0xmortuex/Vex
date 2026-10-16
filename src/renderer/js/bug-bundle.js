// === Copy bug report ===========================================================
//
// One markdown block for an issue or a message to whoever owns the site: the page
// address, Vex and browser versions, the last console errors, and the requests
// that failed. You read it, you copy it, you paste it where you choose. Vex never
// sends it anywhere.
//
// What is left out on purpose: headers, cookies, request and response bodies,
// anything typed in a form. Addresses lose credentials, fragments and secret-looking
// query values (js/redact.js); console messages lose tokens, keys, e-mail addresses
// and the user name in a Windows path. Not built: a screenshot path (take the
// screenshot yourself; a path to your disk is not something to paste into an issue).
//
// Console errors are collected while this tool is on (js/webview.js tells it about
// each console message of a page that is not private, Tor or routed); failed
// requests come from main (src/main/request-log.js).
const VexBugBundle = {
  ENABLED_KEY: 'vex.bugBundle.enabled',
  MAX_ERRORS: 20,
  _errors: new Map(),          // tab id -> [{ t, message, where }]

  enabled() { return VexBench.flag(this.ENABLED_KEY); },
  setEnabled(on) {
    VexBench.setFlag(this.ENABLED_KEY, on);
    if (!on) this._errors.clear();
    this.registerCommands();
  },

  // Called by js/webview.js for every console message of a page.
  note(tabId, e, webview) {
    if (!this.enabled() || !e || e.level < 3) return;
    if (webview && !VexBench.canRead(webview)) return;
    let list = this._errors.get(tabId);
    if (!list) { list = []; this._errors.set(tabId, list); }
    const where = e.sourceId ? VexRedact.redactUrl(e.sourceId) + (e.line ? ':' + e.line : '') : '';
    list.push({ t: Date.now(), message: VexRedact.redactText(e.message, 400), where });
    if (list.length > this.MAX_ERRORS) list.shift();
  },
  // A fresh page starts with a clean list.
  reset(tabId) { this._errors.delete(tabId); },
  errorsFor(tabId) { return (this._errors.get(tabId) || []).slice(); },

  // Pure: the markdown for what was collected.
  format({ url, appVersion, userAgent, platform, errors, requests, now }) {
    const fence = (s) => '`' + String(s).replace(/`/g, "'").replace(/[\r\n]+/g, ' ') + '`';
    const lines = ['## Bug report', ''];
    lines.push('- **Page:** ' + fence(VexRedact.redactUrl(url || '')));
    lines.push('- **When:** ' + new Date(now == null ? Date.now() : now).toISOString());
    lines.push('- **Vex:** ' + fence(appVersion || 'unknown'));
    lines.push('- **Browser:** ' + fence((userAgent || 'unknown').slice(0, 200)));
    lines.push('- **System:** ' + fence(platform || 'unknown'));
    lines.push('', '### Console errors (' + errors.length + ', newest last)');
    if (!errors.length) lines.push('', 'None were recorded since the page loaded.');
    else { lines.push(''); for (const er of errors) lines.push('- ' + fence(er.message) + (er.where ? ' at ' + fence(er.where) : '')); }
    lines.push('', '### Failed requests (' + requests.length + ')', '', '_Addresses only. Credentials, fragments and secret-looking values are removed; no headers, cookies or bodies are kept._');
    if (!requests.length) lines.push('', 'None were recorded since the page loaded.');
    else { lines.push(''); for (const r of requests) lines.push('- ' + r.method + ' ' + (r.status ? r.status : fence(r.error || 'failed')) + ' ' + fence(r.url) + (r.type ? ' (' + r.type + ')' : '')); }
    lines.push('', '### What I did / what I expected', '', '_(fill in)_', '');
    return lines.join('\n');
  },

  async build(webview) {
    if (!webview) throw new Error('There is no page to report on');
    if (!VexBench.canRead(webview)) throw new Error('A private, Tor or routed tab is never read for a report');
    const tab = TabManager.tabs.find(t => t.id === webview.dataset.tabId) || TabManager.tabs.find(t => t.id === TabManager.activeTabId);
    const res = await window.vex.devbenchRequests(webview.getWebContentsId());
    if (!res || !res.ok) throw new Error((res && res.error) || 'The failed requests could not be read');
    let appVersion = 'unknown';
    try { appVersion = await window.vex.getAppVersion(); }
    catch (err) { console.error('[BugBundle] the Vex version could not be read:', err); }
    return this.format({
      url: VexBench.pageUrl(webview), appVersion, userAgent: navigator.userAgent, platform: navigator.platform,
      errors: this.errorsFor(tab ? tab.id : null), requests: res.requests,
    });
  },

  async copy(webview) {
    const md = await this.build(webview);
    await VexBench.copy(md, 'Bug report copied');
    return md;
  },

  // Dev bench ---------------------------------------------------------------
  pageItems(webview) {
    return [{ label: 'Copy bug report', action: VexBench.safe(() => this.copy(webview)) }];
  },
  registerCommands() {
    if (typeof VexModuleCommands === 'undefined') return false;
    VexModuleCommands.set('bugbundle:', this.enabled() ? [{
      id: 'bugbundle:copy', label: 'Copy bug report', icon: 'code',
      hint: 'Console errors, failed requests and versions of this page as markdown. Nothing is sent.',
      action: VexBench.safe(() => this.copy(VexBench.activeWebview())),
    }] : []);
    return true;
  },
  settingsRows(box) {
    box.appendChild(VexSettingsGroup.note('Right-click a page > Copy bug report, or Ctrl+K > Copy bug report. Errors are collected from the moment this is on.'));
  },
};

if (typeof window !== 'undefined') {
  window.VexBugBundle = VexBugBundle;
  VexBench.register({
    id: 'bug-bundle', title: 'Copy bug report', hint: 'console errors + failed requests', enabled: () => VexBugBundle.enabled(), setEnabled: (on) => VexBugBundle.setEnabled(on),
    settingsRows: (box) => VexBugBundle.settingsRows(box), pageItems: (wv) => VexBugBundle.pageItems(wv),
  });
  VexBugBundle.registerCommands();
}
if (typeof module !== 'undefined' && module.exports) module.exports = { VexBugBundle };

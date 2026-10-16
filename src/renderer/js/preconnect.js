// === Connect ahead to a link you rest on (T3-075, the window's half) ============
//
// The page (preload-webview.js "Resting on a link") reports a link the pointer has
// rested on for 150 ms; this hands it to main (src/main/preconnect.js), which
// opens the connection to that site in the tab's own session if, and only if, it
// is the same site as the page or one you put on the allow list, and the tab is
// not private or Tor. The rules are in main; the checks here only save a trip.
//
// Settings › Links and windows: the switch, and the sites that may be connected
// to from any page. The record, vex.preconnect = { on, allow: [hostnames] }, is
// also read by main, which refuses when it says off.
const VexPreconnect = {
  KEY: 'vex.preconnect',
  DEFAULTS: { on: true, allow: [] },
  MAX_ALLOW: 50,

  prefs() {
    const raw = localStorage.getItem(this.KEY);
    if (raw === null) return { on: this.DEFAULTS.on, allow: [] };
    let v;
    try { v = JSON.parse(raw); }
    catch (err) { console.error('[Preconnect] the saved choices are damaged and start again:', err); return { on: this.DEFAULTS.on, allow: [] }; }
    if (!v || typeof v !== 'object' || Array.isArray(v)) return { on: this.DEFAULTS.on, allow: [] };
    return { on: typeof v.on === 'boolean' ? v.on : this.DEFAULTS.on, allow: Array.isArray(v.allow) ? v.allow.filter(h => typeof h === 'string').slice(0, this.MAX_ALLOW) : [] };
  },
  save(patch) {
    const next = { ...this.prefs(), ...patch };
    if (typeof next.on !== 'boolean') throw new Error('Preconnect is on or off');
    next.allow = this.cleanList(next.allow);
    localStorage.setItem(this.KEY, JSON.stringify(next));
    this._armAll();
    return next;
  },
  enabled() { return this.prefs().on; },
  setEnabled(on) { this.save({ on: !!on }); },

  // Hostnames only: "example.com", not an address, not a path, not a bare TLD.
  cleanList(list) {
    const out = [];
    for (const item of Array.isArray(list) ? list : []) {
      const h = String(item || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/^\*\./, '');
      if (!h) continue;
      if (!/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{0,61}[a-z0-9]$/.test(h)) throw new Error('"' + item + '" is not a site name such as example.com');
      if (!out.includes(h)) out.push(h);
    }
    if (out.length > this.MAX_ALLOW) throw new Error('At most ' + this.MAX_ALLOW + ' sites');
    return out;
  },

  // A tab in a session that outlives the window; never a Tor, private or other session-only one.
  _eligible(tab) {
    return !!tab && (!tab.partition || String(tab.partition).startsWith('persist:'));
  },

  attach(webview) {
    const on = (webview && webview._lifecycle)
      ? (ev, fn) => webview._lifecycle.listen(webview, ev, fn)
      : (ev, fn) => webview.addEventListener(ev, fn);
    on('dom-ready', () => this._arm(webview));
    on('ipc-message', (e) => {
      if (e.channel !== 'vex-link-hover') return;
      this.onHover(webview, e.args && e.args[0]).catch(err => {
        if (typeof VexProblems !== 'undefined') VexProblems.note('Links', 'Connecting ahead to a link failed', err);
        else console.error('[Preconnect]', err);
      });
    });
  },
  _tabOf(webview) {
    if (typeof WebviewManager === 'undefined' || typeof TabManager === 'undefined') return null;
    for (const [id, wv] of WebviewManager.webviews.entries()) if (wv === webview) return TabManager.tabs.find(t => t.id === id) || null;
    return null;
  },
  _arm(webview) {
    if (!webview || typeof webview.send !== 'function') return;
    webview.send('vex-preconnect-arm', this.enabled() && this._eligible(this._tabOf(webview)));
  },
  _armAll() {
    if (typeof WebviewManager === 'undefined' || !WebviewManager.webviews) return;
    for (const wv of WebviewManager.webviews.values()) {
      try { if (wv._attached) this._arm(wv); } catch (err) { console.warn('[Preconnect] could not tell a page about the switch:', err.message); }
    }
  },

  async onHover(webview, href) {
    if (!this.enabled() || typeof href !== 'string' || href.length > 4096) return null;
    // Only the page in front: a page in the background has no pointer on it.
    if (typeof WebviewManager !== 'undefined' && WebviewManager.getActiveWebview && WebviewManager.getActiveWebview() !== webview) return null;
    if (!this._eligible(this._tabOf(webview))) return null;
    if (typeof window.vex?.tabPreconnect !== 'function') throw new Error('The window cannot reach the preconnect service');
    return window.vex.tabPreconnect(webview.getWebContentsId(), href);
  },
};

if (typeof window !== 'undefined') window.VexPreconnect = VexPreconnect;
if (typeof module !== 'undefined' && module.exports) module.exports = { VexPreconnect };

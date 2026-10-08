// === Switches for one site =================================================
//
// The three switches a site can be held to: JavaScript, cookies, and content
// from other hosts. Each one is normally on; turning it off is a decision
// about that site and nothing else.
//
// The rules live in the main process, which is the only side that sees
// requests (src/main/site-rules.js); a copy is kept here so a tab can be built
// with JavaScript already off rather than having to reload for it.
const SiteRulesUI = {
  KEY: 'vex.siteRules',
  WHAT: [
    { id: 'js', name: 'JavaScript', note: 'Off makes a page plain text and pictures. The tab reopens with it off.' },
    { id: 'cookies', name: 'Cookies', note: 'Off means none are sent to this site and none it sends back are kept, and any it already had are removed — it will not remember you.' },
    { id: 'thirdParty', name: 'Content from other sites', note: 'Off refuses anything this page loads from another host: adverts, trackers, embeds, some fonts.' },
  ],

  // A private window's storage starts empty, so it holds a copy of the rules
  // main keeps (loaded below) — without it every switch did nothing there,
  // JavaScript-off included (found 2026-09-29).
  _mirror: null,
  rules() {
    if (this._mirror) return this._mirror;
    try { const o = JSON.parse(localStorage.getItem(this.KEY) || '{}'); return o && typeof o === 'object' ? o : {}; } catch { return {}; }
  },
  _isPrivate() { return typeof window !== 'undefined' && !!window.VexTabPolicy?.isPrivateWindow; },
  async loadMirror() {
    const res = await window.vex.siteRulesGet();
    if (!res || !res.ok || !res.rules || typeof res.rules !== 'object') throw new Error((res && res.error) || 'Could not read the per-site switches');
    this._mirror = res.rules;
    return this._mirror;
  },
  save(rules) { try { localStorage.setItem(this.KEY, JSON.stringify(rules)); } catch {} },

  host(url) { try { return new URL(url).hostname.replace(/^www\./, '').toLowerCase(); } catch { return ''; } },

  // The rule that applies to a page: the host's own, or a parent domain's.
  forUrl(url, rules = this.rules()) {
    const h = this.host(url);
    if (!h) return null;
    let best = null, bestLen = -1;
    for (const [key, rule] of Object.entries(rules)) {
      if (!(h === key || h.endsWith('.' + key))) continue;
      if (key.length > bestLen) { best = rule; bestLen = key.length; }
    }
    return best;
  },

  isOff(url, what) { const rule = this.forUrl(url); return !!(rule && rule[what] === 'off'); },
  scriptsOff(url) { return this.isOff(url, 'js'); },
  // The site panel's "Block ads and trackers on this site": stored as the
  // 'ads' switch beside the three above (main/site-rules.js), but not one of
  // WHAT — a site the blocker leaves alone is not being held back.
  adsAllowed(url) { return this.isOff(url, 'ads'); },

  // Main is told on every change, and once at startup — it is the side that
  // actually refuses the requests.
  async push() {
    const res = await window.vex.siteRulesSet(this.rules());
    if (!res || !res.ok) throw new Error((res && res.error) || 'Could not save these switches');
    return res.rules;
  },

  async set(url, what, off) {
    // The switches live in the normal window's storage; one changed here was
    // pushed from this window's empty copy and wiped every other site's
    // (found 2026-09-29). Same as the ad blocker switch in a private window.
    if (this._isPrivate()) throw new Error('Change this in a normal window — it applies to every window');
    const h = this.host(url);
    if (!h) throw new Error('That is not a web page');
    const rules = this.rules();
    const rule = { ...(rules[h] || {}) };
    if (off) rule[what] = 'off'; else delete rule[what];
    if (Object.keys(rule).length) rules[h] = rule; else delete rules[h];
    this.save(rules);
    await this.push();
    // Switching cookies off takes away the ones the site already has, which
    // is the part a person can actually see.
    if (off && what === 'cookies') {
      const tab = typeof TabManager !== 'undefined' ? TabManager.getActiveTab() : null;
      await this.sweep(url, tab && tab.partition);
    }
    this._mark(url);
    return rule;
  },

  // A page can still set a cookie in its own script, which no header rule can
  // stop — so a site whose cookies are off has them taken away again on every
  // load. "Off" then means off, not "off except the ones it writes itself".
  async sweep(url, partition) {
    if (!this.isOff(url, 'cookies')) return 0;
    const res = await window.vex.cookiesList({ url, partition: partition || 'persist:main' });
    if (!res || !res.ok) return 0;
    let gone = 0;
    for (const c of res.cookies) {
      const out = await window.vex.cookiesRemove({ url, partition: partition || 'persist:main', name: c.name, domain: c.domain, path: c.path, secure: c.secure });
      if (out && out.ok) gone++;
    }
    return gone;
  },

  // What is switched off here, in words: for the marker's tooltip and for the
  // toast that says why a site stopped working.
  describe(url) {
    const rule = this.forUrl(url) || {};
    const names = this.WHAT.filter(w => rule[w.id] === 'off').map(w => w.name.toLowerCase());
    if (!names.length) return '';
    const host = this.host(url);
    return host + ': ' + (names.length === 1 ? names[0] : names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1]) + ' switched off';
  },

  // A site with something switched off says so in the toolbar, every time you
  // are on it. Before this the only sign was the site quietly not working —
  // YouTube with "content from other sites" off serves its video from another
  // host, so the player was simply black with nothing to explain it.
  _mark(url) {
    const btn = document.getElementById('btn-site-rules');
    if (!btn) return '';
    const said = this.describe(url);
    btn.hidden = !said;
    if (said) btn.title = said + ' — click to change';
    return said;
  },

  init() {
    // The stored rules are the truth; this only makes main agree with them.
    // Not from a private window: its storage starts empty, and pushing that
    // wiped every per-site rule in site-rules.json (found 2026-09-29).
    if (!window.VexTabPolicy?.isPrivateWindow) this.push().catch(err => window.VexProblems?.note('Site switches', 'Could not tell Vex about your per-site switches', err));
    document.getElementById('btn-site-rules')?.addEventListener('click', () => {
      try { this.open(); } catch (err) { window.showToast?.(err.message, 'error'); }
    });
    // The marker follows the tab you are looking at, whichever way you got there.
    const follow = () => {
      try { this._mark(this._tab().url); } catch { this._mark(''); }
    };
    document.addEventListener('vex:tab-navigated', follow);
    // Switching tabs announces itself as vex-tabs-changed, so that is the one
    // to listen to; there is no separate "switched" event.
    window.addEventListener('vex-tabs-changed', follow);
    follow();

    document.addEventListener('vex:tab-navigated', (e) => {
      const { tabId, url } = e.detail || {};
      if (!this.isOff(url || '', 'cookies')) return;
      const tab = typeof TabManager !== 'undefined' ? TabManager.tabs.find(t => t.id === tabId) : null;
      this.sweep(url, tab && tab.partition)
        .catch(err => window.VexProblems?.note('Site switches', 'Could not clear cookies for a site you switched them off for', err));
    });
    return this;
  },

  _tab() {
    const tab = typeof TabManager !== 'undefined' ? TabManager.getActiveTab() : null;
    const wv = typeof WebviewManager !== 'undefined' ? WebviewManager.webviews.get(TabManager.activeTabId) : null;
    let url = '';
    try { url = (wv && wv.getURL && wv.getURL()) || (tab && tab.url) || ''; } catch { url = (tab && tab.url) || ''; }
    if (!/^https?:/i.test(url)) throw new Error('Open a website first');
    return { url, wv, tab };
  },

  // The switches are shown and changed in the site panel (js/site-panel.js),
  // the one place for everything about the site in front; this used to be a
  // dialog of its own. The toolbar marker and Ctrl+K › "What This Site Is
  // Allowed" open the panel at its switches.
  open() {
    this._tab();
    if (typeof SitePanel === 'undefined') throw new Error('The site panel is not loaded');
    return SitePanel.open({ section: 'switches' });
  },
};

if (typeof window !== 'undefined') window.SiteRulesUI = SiteRulesUI;
// Asked for as soon as this file loads, before the window builds its tabs,
// so a private tab opened at once is already built with JavaScript off.
if (typeof window !== 'undefined' && SiteRulesUI._isPrivate()) {
  const reload = () => SiteRulesUI.loadMirror().catch(err => {
    console.error('[SiteRules] private window could not read the switches:', err);
    window.VexProblems?.note('Site switches', 'This private window could not read your per-site switches', err);
  });
  reload();
  // Read once, the copy went stale: JavaScript switched off for a site in the
  // normal window still ran in a private window that was already open. Main
  // now sends the switches to every window the moment they change, so the
  // copy is replaced at once; it used to be read again every three seconds,
  // which left that long for a site to run (both found 2026-09-29). Coming
  // back to the window reads it once more, for a word that was missed.
  window.vex.onSiteRulesChanged((rules) => {
    if (!rules || typeof rules !== 'object') {
      console.error('[SiteRules] private window was sent switches it cannot read:', rules);
      return;
    }
    SiteRulesUI._mirror = rules;
  });
  window.addEventListener('focus', reload);
}
if (typeof module !== 'undefined' && module.exports) module.exports = { SiteRulesUI };

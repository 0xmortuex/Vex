// === "You searched this on ..." =============================================
//
// You search for the same thing twice and find the same pages, because you
// did not remember the answer was in the third result. When a search results
// page opens and the same search is already in your browsing history, Vex says
// when, and links to the page you opened from it that time.
//
// Local history only: it reads the History panel's own list (vex.history) and
// nothing else, asks no one, and keeps nothing of its own except the setting.
// Searches are read off the address of the results page (Google, Bing,
// DuckDuckGo, Brave, Ecosia, Startpage, Yandex, YouTube, GitHub, Wikipedia,
// Amazon, Reddit and the search engine of your own, by the shape of the
// address). A private or Tor tab is never read.
//
// Limit, said plainly: History folds a page you open again the same day into
// one row, so a search repeated within a day of itself leaves no earlier row to
// find; the hint comes from a different day, or a different address for the
// same words.
const VexSearchAgain = {
  KEY: 'vex.searchAgain',
  MIN_AGE_MS: 120000,          // a visit this new is the search that just opened
  OPENED_WITHIN_MS: 30 * 60000, // the page opened from a search is within this of it
  DAY_MS: 86400000,
  DEFAULT_PREFS: { enabled: true, days: 90 },    // days 0 = any age

  // host (no www.) -> the parameters that carry the words
  ENGINES: [
    [/(^|\.)google\.[a-z.]+$/, ['q']],
    [/(^|\.)bing\.com$/, ['q']],
    [/(^|\.)duckduckgo\.com$/, ['q']],
    [/(^|\.)search\.brave\.com$/, ['q']],
    [/(^|\.)ecosia\.org$/, ['q']],
    [/(^|\.)startpage\.com$/, ['query', 'q']],
    [/(^|\.)yandex\.[a-z.]+$/, ['text']],
    [/(^|\.)search\.yahoo\.com$/, ['p']],
    [/(^|\.)youtube\.com$/, ['search_query']],
    [/(^|\.)github\.com$/, ['q']],
    [/(^|\.)wikipedia\.org$/, ['search']],
    [/(^|\.)amazon\.[a-z.]+$/, ['k']],
    [/(^|\.)reddit\.com$/, ['q']],
  ],

  cleanPrefs(p) {
    const o = (p && typeof p === 'object') ? p : {};
    const d = Math.round(Number(o.days));
    return {
      enabled: o.enabled === undefined ? this.DEFAULT_PREFS.enabled : o.enabled === true,
      days: Number.isFinite(d) ? Math.min(3650, Math.max(0, d)) : this.DEFAULT_PREFS.days,
    };
  },
  prefs() {
    let raw = null;
    try { raw = JSON.parse(localStorage.getItem(this.KEY) || 'null'); } catch { raw = null; }
    return this.cleanPrefs(raw);
  },
  savePrefs(patch) {
    const next = this.cleanPrefs({ ...this.prefs(), ...patch });
    localStorage.setItem(this.KEY, JSON.stringify(next));
    return next;
  },

  // The words searched for, lower-cased and tidied, or '' if the address is
  // not a results page. `extraTemplate` is the address of the user's own engine
  // with %s in it, if there is one.
  queryOf(url, extraTemplate) {
    let u;
    try { u = new URL(String(url || '')); } catch { return ''; }
    if (!/^https?:$/.test(u.protocol)) return '';
    const host = u.hostname.toLowerCase().replace(/^www\./, '');
    let params = null;
    for (const [re, ps] of this.ENGINES) if (re.test(host)) { params = ps; break; }
    if (params) {
      // Only the results page of those sites, not every page that has a ?q=.
      const results = /search|results|\/s$|^\/$/.test(u.pathname) || host.includes('duckduckgo') || host.includes('wikipedia');
      if (!results) return '';
    } else if (extraTemplate) {
      try {
        const t = new URL(String(extraTemplate).split('%s').join('VEXQUERY'));
        if (t.hostname.toLowerCase().replace(/^www\./, '') === host) {
          for (const [k, v] of t.searchParams) if (v === 'VEXQUERY') params = [k];
        }
      } catch { return ''; }
    }
    if (!params) return '';
    for (const k of params) {
      const v = u.searchParams.get(k);
      if (v) return this.normalize(v);
    }
    return '';
  },

  normalize(q) {
    const s = String(q || '').toLowerCase().replace(/[\s+]+/g, ' ').replace(/^[\s"'.,;:!?-]+|[\s"'.,;:!?-]+$/g, '').trim();
    return s.length >= 2 ? s.slice(0, 200) : '';
  },

  _time(e) {
    const t = Date.parse(e && (e.visitedAt || (Number.isFinite(e.time) ? new Date(e.time).toISOString() : '')));
    return Number.isFinite(t) ? t : 0;
  },

  // Look the words up in history. Pure: `entries` are history rows
  // ({ url, title, visitedAt }), any order.
  //   { query, now, template, days }  → { query, at, url, count, opened } or null
  find(entries, { query, now = Date.now(), template, days = 0 } = {}) {
    const q = this.normalize(query);
    if (!q || !Array.isArray(entries)) return null;
    const rows = entries.map(e => ({ e, t: this._time(e) })).filter(r => r.t > 0).sort((a, b) => a.t - b.t);
    const same = rows.filter(r => this.queryOf(r.e.url, template) === q);
    // Earlier visits only: the newest row may be the search that just opened.
    const earlier = same.filter(r => r.t <= now - this.MIN_AGE_MS && (!days || r.t >= now - days * this.DAY_MS));
    if (!earlier.length) return null;
    const hit = earlier[earlier.length - 1];
    const host = (() => { try { return new URL(hit.e.url).hostname.replace(/^www\./, ''); } catch { return ''; } })();
    // The page opened from it: the next ordinary page, soon after, that is not
    // another search and not the search site itself.
    const after = rows.find(r => r.t > hit.t && r.t <= hit.t + this.OPENED_WITHIN_MS && r.e !== hit.e
      && !this.queryOf(r.e.url, template)
      && (() => { try { return new URL(r.e.url).hostname.replace(/^www\./, '') !== host; } catch { return false; } })());
    return {
      query: q,
      at: new Date(hit.t).toISOString(),
      url: hit.e.url,
      count: earlier.length,
      opened: after ? { url: after.e.url, title: String(after.e.title || after.e.url) } : null,
    };
  },

  describe(found, now = Date.now()) {
    const d = new Date(found.at);
    const days = Math.floor((now - d.getTime()) / this.DAY_MS);
    const when = days <= 0 ? 'earlier today' : days === 1 ? 'yesterday' : 'on ' + d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
    const title = found.opened ? found.opened.title : '';
    const short = title.length > 60 ? title.slice(0, 59) + '…' : title;
    return 'You searched this ' + when + (found.opened ? ' — you opened “' + short + '”' : '');
  },

  // ---- the page ----
  _shown: new Map(),            // tab + words -> when it was said
  _list() {
    return (typeof HistoryPanel !== 'undefined' && HistoryPanel.list) ? HistoryPanel.list() : [];
  },
  _template() {
    try {
      if (typeof window !== 'undefined' && window.VexTypedAddress && window.VexTypedAddress.customEngine) {
        const c = window.VexTypedAddress.customEngine();
        return c ? c.q : '';
      }
    } catch { /* no engine of your own */ }
    return '';
  },

  // A results page opened (or changed). `tabId` keeps one tab from being told
  // the same thing twice in ten minutes.
  check(url, tabId, now = Date.now()) {
    const p = this.prefs();
    if (!p.enabled) return null;
    const template = this._template();
    const q = this.queryOf(url, template);
    if (!q) return null;
    const key = tabId + '|' + q;
    const said = this._shown.get(key);
    if (said && now - said < 600000) return null;
    const found = this.find(this._list(), { query: q, now, template, days: p.days });
    if (!found) return null;
    this._shown.set(key, now);
    if (this._shown.size > 200) this._shown.delete(this._shown.keys().next().value);
    return found;
  },

  say(found) {
    if (typeof window === 'undefined' || typeof window.showToast !== 'function') return null;
    const actions = [];
    if (found.opened) actions.push({ label: 'Open it', title: found.opened.url, run: () => TabManager.createTab(found.opened.url, true) });
    actions.push({ label: 'Show that search', title: found.url, run: () => TabManager.createTab(found.url, true) });
    // An offer nobody asked for, so it goes through the attention gate.
    if (typeof VexAttention !== 'undefined') return VexAttention.toast({ feature: 'search-again', urgency: 'useful', id: found.url, title: this.describe(found) }, this.describe(found), 'info', 12000, { actions });
    return window.showToast(this.describe(found), 'info', 12000, { actions });
  },

  attach(webview, tabId) {
    const on = (webview && webview._lifecycle) ? (ev, fn) => webview._lifecycle.listen(webview, ev, fn) : (ev, fn) => webview.addEventListener(ev, fn);
    const run = (e) => {
      try {
        if (e && e.isMainFrame === false) return;
        if (window.VexTabPolicy && !window.VexTabPolicy.canReadWebview(webview)) return;
        const url = (e && e.url) || window.vexGuestUrl(webview);
        // The visit is written to History as the page loads; look after it.
        setTimeout(() => {
          try {
            const found = this.check(url, tabId || 'tab');
            if (found) this.say(found);
          } catch (err) { console.warn('[SearchAgain]', (err && err.message) || err); }
        }, 1500);
      } catch (err) { console.warn('[SearchAgain]', (err && err.message) || err); }
    };
    on('did-navigate', run);
    on('did-navigate-in-page', run);
  },

  // Ctrl+K › Have I Searched This Before: the active page's search, or words typed.
  async ask() {
    let q = '';
    const tab = typeof TabManager !== 'undefined' ? TabManager.getActiveTab() : null;
    if (tab) q = this.queryOf(tab.url, this._template());
    const typed = await window.vexPrompt({ title: 'Have I searched this before?', message: 'The words to look for in your history.', label: 'Search words', value: q, okLabel: 'Look' });
    if (typed == null) return null;
    const found = this.find(this._list(), { query: typed, template: this._template(), now: Date.now() + this.MIN_AGE_MS, days: 0 });
    if (!found) { window.showToast?.('Nothing in your history for “' + String(typed).trim() + '”', 'info'); return null; }
    this.say(found);
    return found;
  },

  buildSettings(body) {
    const G = window.VexSettingsGroup;
    const p = this.prefs();
    body.append(G.toggle('Tell me when I searched the same thing before', p.enabled, (on) => { this.savePrefs({ enabled: on }); }, 'from your history only'));
    const days = document.createElement('select');
    days.className = 'set-input';
    for (const [v, l] of [[7, 'Last week'], [30, 'Last 30 days'], [90, 'Last 90 days'], [365, 'Last year'], [0, 'Any time']]) {
      const o = document.createElement('option');
      o.value = String(v); o.textContent = l; o.selected = v === p.days;
      days.append(o);
    }
    days.addEventListener('change', () => { this.savePrefs({ days: Number(days.value) }); });
    body.append(G.field('Look back', days));
    body.append(G.note('Reads the History panel and nothing else. A private or Tor tab is never looked at, and clearing your history clears this.'));
  },

  mount() {
    if (window.VexSettingsGroup) {
      window.VexSettingsGroup.add({ id: 'settings-searchagain', title: 'Repeated searches', info: 'When a search results page opens and you ran the same search before, Vex says when and links to the page you opened from it.', build: (body) => this.buildSettings(body) });
    }
    if (typeof CommandBar !== 'undefined' && CommandBar.commands && !CommandBar.commands.some(c => c.id === 'search-again')) {
      CommandBar.commands.push({ id: 'search-again', label: 'Have I Searched This Before?', hint: 'Looks your history for the same search — when, and which page you opened from it', icon: 'history',
        action: async () => { try { await this.ask(); } catch (err) { window.showToast?.(err.message, 'error'); } } });
    }
  },
};

if (typeof window !== 'undefined') {
  window.VexSearchAgain = VexSearchAgain;
  if (typeof document !== 'undefined' && document.getElementById('command-overlay')) VexSearchAgain.mount();
}
if (typeof module !== 'undefined' && module.exports) module.exports = { VexSearchAgain };

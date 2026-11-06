// === Search this site =========================================================================================
//
// Ctrl+K "Search This Site", the key (Ctrl+Alt+Shift+F, rebindable), the page menu, or "@site words" in the
// address bar: ask for some words and search the site in front with the search engine you chose, as
// `site:<host> words`.
//
//   * The host is the one the browser writes (an international name such as çağrı.com.tr goes as xn--...), without a
//     leading www. and without the port (site: has no port). A subdomain is kept: on docs.python.org the search stays
//     in docs.python.org.
//   * The engine is the one in Settings, your own included (js/typed-address.js). Of the built-in engines every one
//     understands site:. An engine of your own is trusted only when its address is a known search engine; otherwise
//     it may ignore site:, so the built-in engine chosen before it is used for this search, and a note says so.
//   * A bang in the words (!w) is refused: DuckDuckGo would send the search to another site and drop site:. The
//     address-bar prefix "@site" gives way to a search keyword of your own with that name.
//   * Only a public web page has a site to search: not Vex's own pages, files, localhost, an address by number, a
//     name with no dot, or an onion address (that name must never reach a search engine).
// The words and the host go only to the search engine, in a tab of the same container as the page.
const VexSiteSearch = {
  // Engines of your own whose address is one of these are known to understand site:.
  KNOWN_SITE_ENGINES: /(^|\.)(google|bing|duckduckgo|brave|startpage|ecosia|yahoo|yandex|kagi|qwant|baidu)\./i,
  MAX_WORDS: 300,

  // { host, port } for a public website address, or throws an Error that says why not.
  hostOf(pageUrl) {
    let u;
    try { u = new URL(String(pageUrl || '')); } catch { throw new Error('There is no web page here to search'); }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('Search This Site works on web pages (http or https), not on this kind of page');
    let host = u.hostname.toLowerCase().replace(/\.$/, '');
    if (host.startsWith('[') || /^\d{1,3}(\.\d{1,3}){3}$/.test(host)) throw new Error('This page is at a numbered address, not a website name, so there is no site to search');
    if (host.endsWith('.onion')) throw new Error('An onion address is never sent to a search engine, so this site cannot be searched this way');
    if (!host.includes('.') || /(^|\.)(localhost|local|internal|lan|home\.arpa|test|invalid)$/.test(host)) throw new Error('This page is on a private or local address, not a public website, so there is nothing to search with site:');
    host = host.replace(/^www\./, '');
    if (!host.includes('.')) throw new Error('This page is on a private or local address, not a public website, so there is nothing to search with site:');
    return { host, port: u.port || '' };
  },

  // The words as they will be searched: trimmed, one space between, no control characters, not too long.
  cleanWords(words) {
    const w = String(words == null ? '' : words).replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
    if (!w) throw new Error('Type the words to look for on this site');
    if (w.length > this.MAX_WORDS) throw new Error('Use at most 300 characters');
    // A DuckDuckGo bang would send the search to another site and drop site:.
    if (/(^|\s)![a-z0-9+._-]+/i.test(w)) throw new Error('A bang (!w) sends the search to another site, so it cannot be used to search this one');
    return w;
  },

  // Does this engine understand site:? A built-in one does; one of your own only if its address is a known engine's.
  understandsSite(engine) {
    if (!engine || typeof engine.q !== 'string') return false;
    if (!engine.own) return true;
    let h = '';
    try { h = new URL(engine.q.split('%s').join('x')).hostname; } catch { return false; }
    return this.KNOWN_SITE_ENGINES.test(h);
  },

  // → { url, host, words, usedFallback, note }. engine / fallback: { name, q, own? } (js/typed-address.js engineInfo).
  build(pageUrl, words, engine, fallback) {
    const { host, port } = this.hostOf(pageUrl);
    const w = this.cleanWords(words);
    let use = engine, usedFallback = false;
    if (!this.understandsSite(engine)) {
      if (!fallback || !this.understandsSite(fallback)) throw new Error('Your search engine may not understand site: and there is no other engine to use for it');
      use = fallback; usedFallback = true;
    }
    const text = 'site:' + host + ' ' + w;
    const url = use.q.split('%s').join(encodeURIComponent(text));
    let note = '';
    if (usedFallback) note = 'Your search engine may not understand site:, so the engine you chose before it was used for this search';
    else if (port) note = 'Ports are not part of site:, so the whole site was searched';
    return { url, host, words: w, usedFallback, note };
  },

  // "@site words" / "@here words" (or the bare word, which asks for the words). A keyword of your own with that name wins.
  parsePrefix(text) {
    const m = /^@(site|here)(?:\s+([\s\S]*))?$/i.exec(String(text == null ? '' : text).trim());
    if (!m) return null;
    const kw = typeof SearchShortcuts !== 'undefined' ? SearchShortcuts.userKeywords() : {};
    if (Object.prototype.hasOwnProperty.call(kw, m[1].toLowerCase())) return null;
    return { words: (m[2] || '').trim() };
  },

  // The engines as the address bar uses them.
  _engines() {
    const TA = VexTypedAddress;
    const id = TA.currentEngine();
    const info = TA.engineInfo(id);
    const engine = { name: info.name, q: info.q, own: id === TA.CUSTOM_ID };
    const prev = engine.own ? TA.SEARCH_ENGINES[info.previous] : null;
    return { engine, fallback: prev ? { name: prev.name, q: prev.q, own: false } : null };
  },

  _page() {
    const tab = typeof TabManager !== 'undefined' ? TabManager.getActiveTab() : null;
    if (!tab) throw new Error('Open a web page first');
    const wv = typeof WebviewManager !== 'undefined' && WebviewManager.webviews ? WebviewManager.webviews.get(tab.id) : null;
    let url = tab.url;
    try { if (wv && wv.getURL) url = wv.getURL() || url; } catch (err) { window.VexProblems?.note('Search this site', 'could not read the page address', err); }
    return { tab, url };
  },

  // words: given (the address-bar prefix) or asked for. inNewTab: false navigates the tab in front instead.
  async run(words, inNewTab = true) {
    const { tab, url } = this._page();
    const { host } = this.hostOf(url);   // refuse before asking for words on a page that has no site
    let w = words;
    if (!w) {
      w = await window.vexPrompt({ title: 'Search this site', message: host, label: 'Words to look for', placeholder: 'e.g. refund policy', okLabel: 'Search' });
      if (w == null) return false;
    }
    const { engine, fallback } = this._engines();
    const r = this.build(url, w, engine, fallback);
    if (inNewTab) TabManager.createTab(r.url, true, tab.groupId || null, { partition: tab.partition || undefined, openerTabId: tab.id });
    else WebviewManager.navigate(r.url);
    if (r.note) window.showToast?.(r.note, 'info', 6000);
    return true;
  },

  init() {
    if (this._started) return this;
    this._started = true;
    if (typeof VexExtras !== 'undefined') {
      VexExtras.registerCommand({
        id: 'search-this-site', label: 'Search This Site', icon: 'search', isPrimary: true,
        hint: 'Type some words and search only the site in front (as site:host words) with your search engine',
        keywords: 'search this site site search find on this website only within site: sitesinde ara bu sitede ara',
        action: () => { this.run('', true).catch(err => window.showToast?.(err.message, 'error')); },
      });
    }
    return this;
  },
};

if (typeof window !== 'undefined') {
  window.VexSiteSearch = VexSiteSearch;
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => VexSiteSearch.init(), { once: true });
    else VexSiteSearch.init();
  }
}
if (typeof module !== 'undefined' && module.exports) module.exports = { VexSiteSearch };

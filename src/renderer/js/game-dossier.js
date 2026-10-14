// === Game dossier: what you looked at while you played, kept for next time ===
//
// The automatic side of a game's guide (js/game-session.js). The guide is the
// short list of pages you chose by hand; the dossier is everything you opened
// and searched for while that game ran, so the build you found at 2 a.m. is
// still there a week later and can be promoted into the guide with one click.
//
// Off until the user turns it on (once for all games, or per game), with one
// plain explanation the first time. It records only while Game mode says a
// listed game is running, only for the game that is running, and only for
// pages Vex is already allowed to read: never a private window, a Tor, routed
// or burner tab, a sign-in / payment / bank / mail page, a site on the user's
// "never remember" list or Recall's exclusion list.
//
// What is kept per page: address, title, how long it was in front, how often
// it was opened and, when Recall is on and already knows the page, a short
// snippet from Recall. Nothing new is read from any page. It is stored in its
// own versioned local file (vex.gameDossier, file-backed like notes and
// history), bounded to 1,000 pages and 200 searches per game and 5 MB in all,
// included in the backup's browsing-history group, and never part of Vex Sync
// (a game's program name is a fact about this PC).
const GameDossier = {
  VERSION: 1,
  KEYS: {
    data: 'vex.gameDossier',
    on: 'vex.gameDossier.on',            // 'on' | 'off'  (all games; default off)
    games: 'vex.gameDossier.games',      // { gameId: 'on' | 'off' }
    never: 'vex.gameDossier.never',      // hosts the user never wants remembered
    asked: 'vex.gameDossier.asked',      // the one-time explanation was shown
    suggest: 'vex.gameDossier.suggest',  // 'on' | 'off' (default off)
  },
  MAX_ENTRIES: 1000,       // pages per game
  MAX_SEARCHES: 200,       // searches per game
  MAX_PINNED: 100,
  MAX_BYTES: 5 * 1024 * 1024,
  MAX_SUGGESTIONS: 3,
  MAX_STRETCH_MS: 20 * 60 * 1000,   // one stretch in front counts for at most this long
  SNIPPET_CHARS: 280,

  _data: null,
  _timer: null,
  _visits: new Map(),      // tabId -> { gameId, url }
  _fg: null,               // { tabId, since } the recorded tab in front
  _watching: false,

  _t(s) { try { return (typeof VexI18nUI !== 'undefined' && VexI18nUI.lookup(s)) || s; } catch { return s; } },
  _note(what, err) { window.VexProblems?.note('Game dossier', what, err); },

  // ---- the user's choices ------------------------------------------------------
  _get(key) { try { return localStorage.getItem(key); } catch { return null; } },
  _set(key, value) {
    try { localStorage.setItem(key, value); }
    catch (err) { this._note('Could not save a Game dossier choice', err); throw new Error('Could not save: ' + err.message); }
  },
  _list(key, fallback) {
    const raw = this._get(key);
    if (raw == null || raw === '') return fallback;
    try { return JSON.parse(raw); }
    catch (err) { this._note('A saved Game dossier list could not be read and was ignored', err); return fallback; }
  },

  perGame() {
    const o = this._list(this.KEYS.games, {});
    return o && typeof o === 'object' && !Array.isArray(o) ? o : {};
  },
  globalOn() { return this._get(this.KEYS.on) === 'on'; },
  // The per-game choice wins; a game with none follows the global switch.
  enabledFor(gameId) {
    const o = this.perGame()[gameId];
    if (o === 'on') return true;
    if (o === 'off') return false;
    return this.globalOn();
  },
  suggestEnabled() { return this._get(this.KEYS.suggest) === 'on'; },
  setSuggest(on) { this._set(this.KEYS.suggest, on ? 'on' : 'off'); return !!on; },
  explained() { return this._get(this.KEYS.asked) === '1'; },

  EXPLANATION: 'While one of your listed games runs, Vex will remember the web pages you open and the searches you make, so you can find that guide or build again. It keeps the address, title, time spent and, if Recall is on and already knows the page, a short snippet. It never records private windows, Tor or burner tabs, sign-in, payment, bank or mail pages, or sites on your never-remember list. It is stored only on this PC, is not synced, and you can delete one page or everything at any time.',

  // Turning it on asks once, in plain words. Turning it off never asks.
  async setEnabled(gameId, on) {
    if (on && !this.explained()) {
      const yes = await window.vexConfirm({
        title: this._t('Remember what you look at while you play?'),
        message: this._t(this.EXPLANATION),
        okLabel: this._t('Turn on'),
        cancelLabel: this._t('Not now'),
      });
      if (!yes) return false;
      this._set(this.KEYS.asked, '1');
    }
    if (gameId) {
      const o = this.perGame();
      o[gameId] = on ? 'on' : 'off';
      this._set(this.KEYS.games, JSON.stringify(o));
    } else {
      this._set(this.KEYS.on, on ? 'on' : 'off');
    }
    if (!on) this.flushVisits();
    return true;
  },

  never() {
    const l = this._list(this.KEYS.never, []);
    return Array.isArray(l) ? l.filter(h => typeof h === 'string' && h) : [];
  },
  hostOf(url) { try { return new URL(url).hostname.replace(/^www\./, '').toLowerCase(); } catch { return ''; } },
  _hostMatch(host, list) { return !!host && list.some(h => host === h || host.endsWith('.' + h)); },
  addNever(host) {
    const clean = String(host || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/^www\./, '');
    if (!/^[a-z0-9.-]+\.[a-z]{2,}$|^localhost$/.test(clean)) throw new Error('Type a site like example.com');
    const list = this.never();
    if (!list.includes(clean)) list.push(clean);
    this._set(this.KEYS.never, JSON.stringify(list.sort()));
    // Never remember it means what is already kept goes too.
    let removed = 0;
    const d = this._load();
    for (const g of Object.values(d.games)) {
      const before = g.entries.length;
      g.entries = g.entries.filter(e => !(e.host === clean || e.host.endsWith('.' + clean)));
      removed += before - g.entries.length;
    }
    if (removed) this._save(true);
    return removed;
  },
  removeNever(host) {
    this._set(this.KEYS.never, JSON.stringify(this.never().filter(h => h !== host)));
  },

  // ---- what is skipped ----------------------------------------------------------
  // Vex had no shared "sensitive site" test, so this is the one: a sign-in,
  // payment, bank, wallet, mail or account page is never remembered, by its
  // address or its title.
  SENSITIVE_HOST: /(^|\.)(paypal|stripe|venmo|wise|revolut|klarna|coinbase|binance|kraken|chase|wellsfargo|bankofamerica|citi|hsbc|barclays|santander|capitalone|americanexpress|mastercard|visa|1password|lastpass|bitwarden|dashlane|proton|protonmail|outlook|hotmail|gmail|yahoo|icloud|fastmail|tutanota)\.[a-z.]+$|(^|[.-])(bank|banking|ebank|netbank|secure|login|signin|sso|accounts?|auth|id|pay|payments?|checkout|billing|wallet|mail|webmail)\.|(bank|banking|bankasi|bankası)/i,
  SENSITIVE_PATH: /\/(log-?in|sign-?in|sign-?up|logon|auth(?:orize|enticate)?|oauth2?|sso|2fa|mfa|verify|password|passwd|reset|checkout|cart|payment|pay|billing|wallet|account|myaccount|settings\/security|identity|consent)(?:[/?#._-]|$)/i,
  SENSITIVE_TITLE: /\b(sign[ -]?in|log[ -]?in|sign[ -]?up|checkout|payment|your account|password|verification|one[- ]time|2-?step|inbox|banking)\b/i,
  isSensitive(url, title) {
    let u;
    try { u = new URL(url); } catch { return true; }
    if (this.SENSITIVE_HOST.test(u.hostname)) return true;
    if (this.SENSITIVE_PATH.test(u.pathname)) return true;
    if (/[?&](?:token|access_token|id_token|code|session|sid|otp|password)=/i.test(u.search)) return true;
    if (title && this.SENSITIVE_TITLE.test(String(title))) return true;
    return false;
  },

  // Why this page is not remembered, or null when it is. Order matters only
  // for the message; every reason stops the record.
  skipReason(tab, title) {
    const s = typeof GameSession !== 'undefined' ? GameSession : null;
    if (!s || !s.active || !s.gameId) return 'no-game';
    if (!this.enabledFor(s.gameId)) return 'off';
    if (window.VexTabPolicy) {
      if (window.VexTabPolicy.isPrivateWindow) return 'private';
      if (typeof window.VexTabPolicy.canShareTab === 'function' && !window.VexTabPolicy.canShareTab(tab)) return 'private-tab';
    }
    const url = String((tab && tab.url) || '');
    if (!/^https?:\/\//i.test(url)) return 'not-web';
    if (typeof isStartPage === 'function' && isStartPage(url)) return 'start-page';
    const host = this.hostOf(url);
    if (this._hostMatch(host, this.never())) return 'never';
    if (window.Recall && typeof Recall.isExcluded === 'function' && Recall.isExcluded(url)) return 'recall-excluded';
    if (this.isSensitive(url, title != null ? title : tab.title)) return 'sensitive';
    return null;
  },

  // ---- the store ----------------------------------------------------------------
  _blank() { return { v: this.VERSION, games: {} }; },
  _game(d, id) { return d.games[id] || (d.games[id] = { entries: [], searches: [] }); },

  // Shape check for what is read from disk: a list of well-formed entries.
  _clean(raw) {
    const out = this._blank();
    const games = raw && typeof raw.games === 'object' && raw.games && !Array.isArray(raw.games) ? raw.games : {};
    for (const [id, g] of Object.entries(games)) {
      if (!g || typeof g !== 'object') continue;
      const entries = (Array.isArray(g.entries) ? g.entries : []).filter(e => e && typeof e.url === 'string' && /^https?:\/\//i.test(e.url)).map(e => ({
        url: e.url, title: String(e.title || '').slice(0, 160), host: this.hostOf(e.url),
        first: Number(e.first) || 0, last: Number(e.last) || 0,
        visits: Math.max(1, Math.floor(Number(e.visits) || 1)), seconds: Math.max(0, Math.floor(Number(e.seconds) || 0)),
        snippet: String(e.snippet || '').slice(0, this.SNIPPET_CHARS), pinned: !!e.pinned, promoted: !!e.promoted,
      }));
      const searches = (Array.isArray(g.searches) ? g.searches : []).filter(s => s && typeof s.q === 'string' && s.q).map(s => ({
        q: s.q.slice(0, 200), at: Number(s.at) || 0, n: Math.max(1, Math.floor(Number(s.n) || 1)),
      }));
      out.games[id] = { entries: entries.slice(0, this.MAX_ENTRIES), searches: searches.slice(0, this.MAX_SEARCHES) };
    }
    return out;
  },

  _load() {
    if (this._data) return this._data;
    const raw = this._get(this.KEYS.data);
    let d = null;
    if (raw != null && raw !== '') {
      try { d = this._clean(JSON.parse(raw)); }
      catch (err) { this._note('The saved Game dossier could not be read and was ignored', err); }
    }
    this._data = d || this._blank();
    return this._data;
  },

  // Called once at start. A file from before versions (no v) is upgraded in
  // place; an unreadable one is dropped and said in Problems; a file written by
  // a newer Vex (v above ours) is left exactly as it is and not used.
  migrate() {
    const raw = this._get(this.KEYS.data);
    if (raw == null || raw === '') return 'none';
    let parsed;
    try { parsed = JSON.parse(raw); }
    catch (err) {
      this._note('The saved Game dossier was unreadable and was dropped', err);
      try { localStorage.removeItem(this.KEYS.data); } catch (e) { this._note('Could not drop the unreadable Game dossier', e); }
      this._data = null;
      return 'dropped';
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      try { localStorage.removeItem(this.KEYS.data); } catch (e) { this._note('Could not drop the unreadable Game dossier', e); }
      this._data = null;
      return 'dropped';
    }
    if (typeof parsed.v === 'number' && parsed.v > this.VERSION) { this._data = this._blank(); this._frozen = true; return 'newer'; }
    this._frozen = false;
    if (parsed.v === this.VERSION) return 'current';
    this._data = null;
    this._load();
    this._save(true);
    return 'upgraded';
  },

  _bytes() { return JSON.stringify(this._load()).length; },

  // Oldest unpinned pages go first, across games, until it fits.
  _enforce() {
    const d = this._load();
    for (const g of Object.values(d.games)) {
      if (g.entries.length > this.MAX_ENTRIES) {
        const keep = g.entries.filter(e => e.pinned);
        const rest = g.entries.filter(e => !e.pinned).sort((a, b) => b.last - a.last).slice(0, Math.max(0, this.MAX_ENTRIES - keep.length));
        g.entries = keep.concat(rest);
      }
      if (g.searches.length > this.MAX_SEARCHES) g.searches = g.searches.sort((a, b) => b.at - a.at).slice(0, this.MAX_SEARCHES);
    }
    while (this._bytes() > this.MAX_BYTES) {
      let oldest = null, from = null;
      for (const g of Object.values(d.games)) for (const e of g.entries) if (!e.pinned && (!oldest || e.last < oldest.last)) { oldest = e; from = g; }
      if (!oldest) {
        // Only searches are left to give up.
        let s = null, sg = null;
        for (const g of Object.values(d.games)) for (const x of g.searches) if (!s || x.at < s.at) { s = x; sg = g; }
        if (!s) throw new Error('The Game dossier is full of pinned pages; unpin or delete some');
        sg.searches.splice(sg.searches.indexOf(s), 1);
        continue;
      }
      from.entries.splice(from.entries.indexOf(oldest), 1);
    }
  },

  _save(now) {
    if (this._frozen) return;
    clearTimeout(this._timer);
    this._timer = null;
    const write = () => {
      this._timer = null;
      try { this._enforce(); this._set(this.KEYS.data, JSON.stringify(this._load())); }
      catch (err) { this._note('Could not save the Game dossier', err); }
    };
    if (now) write(); else this._timer = setTimeout(write, 1500);
  },
  flush() { if (this._timer) this._save(true); },

  // ---- recording ----------------------------------------------------------------
  // One page opened while the game ran. `title` and `snippet` are what the
  // caller already had; nothing is read from the page here.
  record(gameId, { url, title, snippet }, now = Date.now()) {
    if (this._frozen) return null;
    const clean = String(url || '');
    if (clean.length > 2048) return null;
    const d = this._load();
    const g = this._game(d, gameId);
    let e = g.entries.find(x => x.url === clean);
    if (e) {
      e.visits++; e.last = now;
      if (title) e.title = String(title).slice(0, 160);
    } else {
      e = { url: clean, title: String(title || '').trim().slice(0, 160) || this.hostOf(clean), host: this.hostOf(clean), first: now, last: now, visits: 1, seconds: 0, snippet: '', pinned: false, promoted: false };
      g.entries.push(e);
    }
    if (snippet && !e.snippet) e.snippet = String(snippet).replace(/\s+/g, ' ').trim().slice(0, this.SNIPPET_CHARS);
    this._save();
    return e;
  },

  recordSearch(gameId, q, now = Date.now()) {
    if (this._frozen) return null;
    const text = String(q || '').replace(/\s+/g, ' ').trim().slice(0, 200);
    if (!text) return null;
    const g = this._game(this._load(), gameId);
    let s = g.searches.find(x => x.q.toLowerCase() === text.toLowerCase());
    if (s) { s.n++; s.at = now; } else { s = { q: text, at: now, n: 1 }; g.searches.push(s); }
    this._save();
    return s;
  },

  addTime(gameId, url, ms) {
    if (!(ms > 0)) return;
    const g = this._load().games[gameId];
    const e = g && g.entries.find(x => x.url === url);
    if (!e) return;
    e.seconds += Math.round(Math.min(ms, this.MAX_STRETCH_MS) / 1000);
    this._save();
  },

  // The words someone typed, read from the address of a results page of a
  // search engine they use. Typed into the omnibox or the engine's own box, it
  // lands in the same address.
  ENGINES: [
    { host: /(^|\.)google\.[a-z.]+$/, path: /^\/search$/, param: 'q' },
    { host: /(^|\.)bing\.com$/, path: /^\/search$/, param: 'q' },
    { host: /(^|\.)duckduckgo\.com$/, path: /^\/$/, param: 'q' },
    { host: /(^|\.)brave\.com$/, path: /^\/search$/, param: 'q' },
    { host: /(^|\.)yahoo\.com$/, path: /^\/search/, param: 'p' },
    { host: /(^|\.)ecosia\.org$/, path: /^\/search$/, param: 'q' },
    { host: /(^|\.)startpage\.com$/, path: /search/, param: 'query' },
    { host: /(^|\.)yandex\.[a-z.]+$/, path: /^\/search/, param: 'text' },
    { host: /(^|\.)youtube\.com$/, path: /^\/results$/, param: 'search_query' },
    { host: /(^|\.)wikipedia\.org$/, path: /^\/w\/index\.php$/, param: 'search' },
    { host: /(^|\.)fandom\.com$/, path: /^\/(?:[a-z-]+\/)?wiki\/Special:Search$/i, param: 'query' },
    { host: /(^|\.)reddit\.com$/, path: /^\/search/, param: 'q' },
  ],
  searchQueryOf(url) {
    let u;
    try { u = new URL(url); } catch { return ''; }
    for (const e of this.ENGINES) {
      if (e.host.test(u.hostname) && e.path.test(u.pathname)) return (u.searchParams.get(e.param) || '').trim();
    }
    return '';
  },

  // ---- watching the tabs --------------------------------------------------------
  _tab(id) { return typeof TabManager !== 'undefined' ? TabManager.tabs.find(t => t.id === id) : null; },

  _stopFg(now = Date.now()) {
    const fg = this._fg;
    this._fg = null;
    if (!fg) return;
    const v = this._visits.get(fg.tabId);
    if (v) this.addTime(v.gameId, v.url, now - fg.since);
  },

  // A page finished loading in a tab.
  onSettled(tabId, now = Date.now()) {
    this._stopFg(now);
    this._visits.delete(tabId);
    const tab = this._tab(tabId);
    if (!tab) return 'gone';
    const why = this.skipReason(tab, tab.title);
    if (why) return why;
    const gameId = GameSession.gameId;
    const q = this.searchQueryOf(tab.url);
    if (q) this.recordSearch(gameId, q, now);
    const e = this.record(gameId, { url: tab.url, title: tab.title }, now);
    if (!e) return 'full';
    this._visits.set(tabId, { gameId, url: tab.url });
    if (typeof TabManager !== 'undefined' && TabManager.activeTabId === tabId) this._fg = { tabId, since: now };
    if (!e.snippet) this._snippetLater(gameId, e.url, e.title);
    return 'recorded';
  },

  onActivated(tabId, now = Date.now()) {
    this._stopFg(now);
    if (this._visits.has(tabId)) this._fg = { tabId, since: now };
  },

  onClosed(tabId, now = Date.now()) {
    if (this._fg && this._fg.tabId === tabId) this._stopFg(now);
    this._visits.delete(tabId);
  },

  flushVisits(now = Date.now()) {
    this._stopFg(now);
    this._visits.clear();
    this.flush();
  },

  // A snippet only from Recall's own index, only when Recall is on and
  // already knows this exact page. During a game Recall reads no new pages
  // (Game mode holds it), so this is what was indexed before.
  async _snippetLater(gameId, url, title) {
    try {
      if (!window.Recall || !Recall.enabled() || !window.vex || typeof window.vex.recallSearch !== 'function') return;
      const host = this.hostOf(url);
      const res = await window.vex.recallSearch(String(title || host).slice(0, 120), { site: host, limit: 8 });
      const hit = res && Array.isArray(res.hits) ? res.hits.find(h => h.url === url) : null;
      if (!hit || !Array.isArray(hit.snippet)) return;
      const text = hit.snippet.map(p => (Array.isArray(p) ? p[0] : String(p))).join('').replace(/\s+/g, ' ').trim();
      if (!text) return;
      const e = (this._load().games[gameId] || { entries: [] }).entries.find(x => x.url === url);
      if (e && !e.snippet) { e.snippet = text.slice(0, this.SNIPPET_CHARS); this._save(); }
    } catch (err) { this._note('Could not read a snippet from Recall', err); }
  },

  watch() {
    if (this._watching) return false;
    this._watching = true;
    document.addEventListener('vex:tab-settled', (e) => {
      try { this.onSettled((e.detail || {}).tabId); } catch (err) { this._note('Could not record a page', err); }
    });
    window.addEventListener('vex:tab-activated', (e) => {
      try { this.onActivated((e.detail || {}).tabId); } catch (err) { this._note('Could not time a page', err); }
    });
    document.addEventListener('vex:tab-closed', (e) => {
      try { this.onClosed((e.detail || {}).tabId); } catch (err) { this._note('Could not close a visit', err); }
    });
    // Game over (or Game mode turned off for now): the open visit is timed and
    // everything is written.
    document.addEventListener('vex:game-mode', (e) => {
      if (!(e.detail && e.detail.active)) { try { this.flushVisits(); } catch (err) { this._note('Could not save the dossier', err); } }
    });
    window.addEventListener('beforeunload', () => { try { this.flushVisits(); } catch { /* closing */ } });
    return true;
  },

  init() {
    try { this.migrate(); } catch (err) { this._note('Could not check the saved Game dossier', err); }
    return this.watch();
  },

  // ---- reading ------------------------------------------------------------------
  entries(gameId) { const g = this._load().games[gameId]; return g ? g.entries.slice() : []; },
  searches(gameId) { const g = this._load().games[gameId]; return g ? g.searches.slice().sort((a, b) => b.at - a.at) : []; },
  count(gameId) { return this.entries(gameId).length; },

  _day(ms) {
    const d = new Date(ms);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  },
  _matches(e, words) {
    const hay = (e.title + ' ' + e.url + ' ' + e.snippet).toLowerCase();
    return words.every(w => hay.includes(w));
  },
  // [{ day: '2026-10-14', entries: [...] }], newest day first.
  byDay(gameId, query = '') {
    const words = String(query || '').toLowerCase().split(/\s+/).filter(Boolean);
    const days = new Map();
    for (const e of this.entries(gameId).filter(x => this._matches(x, words)).sort((a, b) => b.last - a.last)) {
      const key = this._day(e.last);
      if (!days.has(key)) days.set(key, []);
      days.get(key).push(e);
    }
    return [...days].map(([day, entries]) => ({ day, entries }));
  },
  mostUsed(gameId, n = 10) {
    return this.entries(gameId).sort((a, b) => (b.seconds + b.visits * 30) - (a.seconds + a.visits * 30)).slice(0, n);
  },
  // What opens beside the guide when "recently used pages" is on: the most
  // used pages of the last two weeks that are not already in the guide.
  suggestions(gameId, now = Date.now()) {
    if (!this.suggestEnabled() || !this.enabledFor(gameId)) return [];
    const inGuide = new Set(typeof GameSession !== 'undefined' ? GameSession.pages(gameId).map(p => p.url) : []);
    const since = now - 14 * 86400000;
    return this.mostUsed(gameId, 50)
      .filter(e => e.last >= since && !inGuide.has(e.url) && !this.isSensitive(e.url, e.title))
      .slice(0, this.MAX_SUGGESTIONS)
      .map(e => ({ url: e.url, title: e.title }));
  },

  // ---- changing -----------------------------------------------------------------
  _find(gameId, url) {
    const g = this._load().games[gameId];
    const e = g && g.entries.find(x => x.url === url);
    if (!e) throw new Error('That page is not in the dossier');
    return e;
  },
  pin(gameId, url, on = true) {
    const e = this._find(gameId, url);
    if (on && !e.pinned && this.entries(gameId).filter(x => x.pinned).length >= this.MAX_PINNED) throw new Error('You can pin up to ' + this.MAX_PINNED + ' pages per game');
    e.pinned = !!on;
    this._save(true);
    return e;
  },
  remove(gameId, url) {
    const g = this._load().games[gameId];
    if (!g) throw new Error('That game has no dossier');
    const before = g.entries.length;
    g.entries = g.entries.filter(x => x.url !== url);
    if (g.entries.length === before) throw new Error('That page is not in the dossier');
    this._save(true);
  },
  removeSearch(gameId, q) {
    const g = this._load().games[gameId];
    if (g) { g.searches = g.searches.filter(s => s.q !== q); this._save(true); }
  },
  clear(gameId) {
    const d = this._load();
    delete d.games[gameId];
    this._save(true);
  },
  forgetGame(gameId) { this.clear(gameId); const o = this.perGame(); if (o[gameId]) { delete o[gameId]; this._set(this.KEYS.games, JSON.stringify(o)); } },
  clearAll() { this._data = this._blank(); this._save(true); },

  // Into the game's guide (the hand-picked list). Its own limits apply: a
  // duplicate or a full guide is an error the user is told.
  promote(gameId, url) {
    const e = this._find(gameId, url);
    const r = GameSession.addPage(gameId, { url: e.url, title: e.title });
    e.promoted = true;
    this._save(true);
    return r;
  },

  // ---- export -------------------------------------------------------------------
  toMarkdown(gameId, now = Date.now()) {
    const game = typeof GameSession !== 'undefined' ? GameSession.games().find(g => g.id === gameId) : null;
    const name = game ? game.name : gameId;
    const clean = (s) => String(s).replace(/[\[\]\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();
    const mins = (e) => (e.seconds >= 60 ? Math.round(e.seconds / 60) + ' min' : e.seconds + ' s');
    const line = (e) => '- [' + clean(e.title || e.url) + '](' + e.url.replace(/\)/g, '%29') + ') — ' + mins(e) + ', ' + e.visits + (e.visits === 1 ? ' visit' : ' visits') + (e.snippet ? '\n  > ' + clean(e.snippet) : '');
    const out = ['# ' + clean(name) + ' dossier', '', '_Exported from Vex on ' + this._day(now) + '. Everything here was opened while the game ran._', ''];
    const pinned = this.entries(gameId).filter(e => e.pinned).sort((a, b) => b.last - a.last);
    if (pinned.length) { out.push('## Pinned', ''); pinned.forEach(e => out.push(line(e))); out.push(''); }
    const used = this.mostUsed(gameId, 10);
    if (used.length) { out.push('## Most used', ''); used.forEach(e => out.push(line(e))); out.push(''); }
    const s = this.searches(gameId);
    if (s.length) { out.push('## Searches', ''); s.forEach(x => out.push('- ' + clean(x.q) + (x.n > 1 ? ' (' + x.n + '×)' : ''))); out.push(''); }
    for (const day of this.byDay(gameId)) { out.push('## ' + day.day, ''); day.entries.forEach(e => out.push(line(e))); out.push(''); }
    return out.join('\n');
  },
  exportMarkdown(gameId) {
    if (!this.count(gameId) && !this.searches(gameId).length) throw new Error('There is nothing in this dossier to export yet');
    const text = this.toMarkdown(gameId);
    const url = URL.createObjectURL(new Blob([text], { type: 'text/markdown' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = gameId.replace(/[^a-z0-9_-]+/gi, '_') + '-dossier.md';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    return text;
  },

  // ---- the local helper ---------------------------------------------------------
  // One call to the user's own local Ollama over what is stored. Never the
  // cloud, whatever the AI settings say.
  async summarise(gameId) {
    if (typeof Ollama === 'undefined' || typeof AIRouter === 'undefined') throw new Error('Local AI is not available in this window');
    const st = AIRouter.getOllamaStatus();
    if (!st || !st.available || !st.model) throw new Error('Local AI (Ollama) is not set up, so there is nothing to summarise with');
    const used = this.mostUsed(gameId, 40).filter(e => e.title);
    const searches = this.searches(gameId).slice(0, 30);
    if (!used.length && !searches.length) throw new Error('There is nothing in this dossier to summarise yet');
    const game = GameSession.games().find(g => g.id === gameId);
    const body = used.map(e => '- ' + e.title + (e.snippet ? ': ' + e.snippet : '')).join('\n') + (searches.length ? '\nSearched for: ' + searches.map(s => s.q).join('; ') : '');
    const prompt = 'These are pages and searches from one player\'s sessions of ' + (game ? game.name : 'a game') + '.\n' + body + '\n\nIn at most 8 short bullet points, say what this player seems to have been learning or trying to do, and which pages mattered most. Do not invent facts that are not in the list.';
    const text = await Ollama.generate(st.model, prompt, { systemPrompt: 'You summarise a personal browsing list for a player. Be brief and plain.', temperature: 0.3, maxTokens: 600 });
    return String(text || '').trim();
  },

  // ---- Ctrl+K -------------------------------------------------------------------
  openLabel() {
    const g = typeof GameSession !== 'undefined' ? GameSession.defaultGame() : null;
    return g ? 'Open ' + g.name + '’s dossier' : 'Open a game’s dossier';
  },
  async openFromCommand() {
    const games = GameSession.games();
    if (!games.length) throw new Error('Add a game first — Settings › Privacy Hardening › Gaming and streaming › Game mode');
    let game = GameSession.defaultGame();
    if (!game) {
      const answer = await window.vexPrompt({ title: this._t('Open which game’s dossier?'), message: games.map(g => g.name).join(', '), okLabel: this._t('Open') });
      if (answer == null) return null;
      const key = GameSession.exeKey(answer);
      game = games.find(g => GameSession.exeKey(g.name) === key || GameSession.exeKey(g.exe) === key);
      if (!game) throw new Error('No game called “' + String(answer).trim() + '” in your list');
    }
    return this.openView(game.id);
  },

  // ---- the view -----------------------------------------------------------------
  openView(gameId) {
    const game = GameSession.games().find(g => g.id === gameId);
    if (!game) throw new Error('That game is not in the list');
    document.querySelectorAll('.vex-dialog-overlay').forEach(o => o._vexCancel?.());
    const t = (s) => this._t(s);
    const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
    const btn = (label, fn, cls) => { const b = el('button', cls || 'btn-secondary', label); b.type = 'button'; b.addEventListener('click', fn); return b; };
    const failed = (err) => window.showToast?.((err && err.message) || String(err), 'error');

    const overlay = el('div', 'vex-dialog-overlay');
    const dlg = el('div', 'vex-dialog vex-dialog-wide gd-dialog');
    dlg.setAttribute('role', 'dialog');
    dlg.setAttribute('aria-modal', 'true');
    dlg.setAttribute('aria-label', game.name + ' ' + t('dossier'));
    const close = () => { document.removeEventListener('keydown', onKey, true); overlay.remove(); };
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
    overlay._vexCancel = close;
    document.addEventListener('keydown', onKey, true);
    overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) close(); });

    dlg.appendChild(el('div', 'vex-dialog-title', game.name + ' — ' + t('Dossier')));
    const status = el('p', 'setting-info muted');
    const bar = el('div', 'gd-bar');
    const search = el('input', 'vex-dialog-input');
    search.type = 'search';
    search.placeholder = t('Search this dossier');
    search.setAttribute('aria-label', t('Search this dossier'));
    const list = el('div', 'gd-list');
    const aiOut = el('pre', 'gd-ai');
    aiOut.hidden = true;

    const row = (e) => {
      const r = el('div', 'gd-row');
      const a = el('a', 'gd-link', e.title);
      a.href = e.url;
      if (e.pinned) {
        const star = el('span', 'gd-pin');
        star.setAttribute('role', 'img');
        star.setAttribute('aria-label', t('Pinned'));
        if (window.VexIcons) star.innerHTML = VexIcons.svg('star', { size: 12 });
        a.prepend(star);
      }
      a.addEventListener('click', (ev) => {
        ev.preventDefault();
        try { if (typeof TabManager === 'undefined') throw new Error('Tabs are not available'); TabManager.createTab(e.url, true); close(); } catch (err) { failed(err); }
      });
      const meta = el('div', 'gd-meta muted', e.host + ' · ' + (e.seconds >= 60 ? Math.round(e.seconds / 60) + ' min' : e.seconds + ' s') + ' · ' + e.visits + '×' + (e.promoted ? ' · ' + t('in your guide') : ''));
      r.append(a, meta);
      if (e.snippet) r.appendChild(el('div', 'gd-snippet muted', e.snippet));
      const acts = el('div', 'gd-acts');
      acts.append(
        btn(e.pinned ? t('Unpin') : t('Pin'), () => { try { this.pin(gameId, e.url, !e.pinned); } catch (err) { failed(err); } paint(); }),
        btn(t('Add to my guide'), () => {
          try { this.promote(gameId, e.url); window.showToast?.(t('Added to') + ' ' + game.name + '’s ' + t('guide')); } catch (err) { failed(err); }
          paint();
        }),
        btn(t('Delete'), () => { try { this.remove(gameId, e.url); } catch (err) { failed(err); } paint(); }),
        btn(t('Never remember this site'), async () => {
          const ok = await window.vexConfirm({ title: t('Never remember this site?'), message: e.host + ' — ' + t('what is kept about it is deleted too.'), okLabel: t('Never remember') });
          if (!ok) return;
          try { this.addNever(e.host); } catch (err) { failed(err); }
          paint();
        }),
      );
      r.appendChild(acts);
      return r;
    };

    const paint = () => {
      list.textContent = '';
      const n = this.count(gameId);
      status.textContent = this.enabledFor(gameId)
        ? t('Remembering what you look at while this game runs.') + ' ' + n + ' ' + t('pages')
        : t('Not remembering right now — turn it on under Settings › Privacy Hardening › Gaming and streaming › Game mode.') + ' ' + n + ' ' + t('pages kept');
      const q = search.value;
      if (!q) {
        const used = this.mostUsed(gameId, 5);
        if (used.length) { list.appendChild(el('h4', 'gd-h', t('Most used'))); used.forEach(e => list.appendChild(row(e))); }
        const s = this.searches(gameId).slice(0, 8);
        if (s.length) {
          list.appendChild(el('h4', 'gd-h', t('Searches')));
          for (const x of s) {
            const r = el('div', 'gd-row gd-search');
            r.appendChild(el('span', null, x.q + (x.n > 1 ? '  (' + x.n + '×)' : '')));
            r.appendChild(btn(t('Delete'), () => { this.removeSearch(gameId, x.q); paint(); }));
            list.appendChild(r);
          }
        }
      }
      const days = this.byDay(gameId, q);
      if (!days.length) list.appendChild(el('p', 'setting-info muted', q ? t('Nothing matches.') : t('Nothing yet.')));
      for (const d of days) {
        list.appendChild(el('h4', 'gd-h', d.day));
        d.entries.forEach(e => list.appendChild(row(e)));
      }
    };
    search.addEventListener('input', paint);

    bar.append(
      btn(t('Export as Markdown'), () => { try { this.exportMarkdown(gameId); } catch (err) { failed(err); } }),
      btn(t('Summarise what I learned'), async () => {
        aiOut.hidden = false;
        aiOut.textContent = t('Asking your local AI…');
        try { aiOut.textContent = (await this.summarise(gameId)) || t('The local AI returned nothing.'); }
        catch (err) { aiOut.hidden = true; failed(err); }
      }),
      btn(t('Clear everything'), async () => {
        const ok = await window.vexConfirm({ title: t('Clear this dossier?'), message: game.name + ' — ' + t('every remembered page and search is deleted. Your guide pages stay.'), okLabel: t('Clear'), danger: true });
        if (!ok) return;
        try { this.clear(gameId); } catch (err) { failed(err); }
        paint();
      }),
      btn(t('Close'), close, 'vex-dialog-btn'),
    );
    dlg.append(status, search, bar, aiOut, list);
    overlay.appendChild(dlg);
    document.body.appendChild(overlay);
    paint();
    search.focus();
    return overlay;
  },

  // ---- Settings -----------------------------------------------------------------
  // The two switches and the never-remember list, above My games.
  renderGlobal(host) {
    const t = (s) => this._t(s);
    const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
    const failed = (err) => window.showToast?.((err && err.message) || String(err), 'error');
    const again = () => { if (typeof GameSession !== 'undefined') GameSession.renderSettings(host); };
    const toggle = (label, checked, onChange) => {
      const r = el('div', 'setting-toggle-row');
      r.appendChild(el('span', null, label));
      const sw = document.createElement('label');
      sw.className = 'toggle';
      sw.innerHTML = '<input type="checkbox"><span class="toggle-slider"></span>';
      const box = sw.querySelector('input');
      box.checked = checked;
      box.setAttribute('aria-label', label);
      box.addEventListener('change', () => onChange(box));
      r.appendChild(sw);
      return r;
    };
    const head = el('div', 'setting-label');
    head.appendChild(el('strong', null, t('Game dossier')));
    head.appendChild(el('span', 'setting-hint', t('Vex can remember the pages you open and the searches you make while a game runs, so you can find them again.')));
    host.appendChild(head);
    host.appendChild(toggle(t('Remember what I look at while I play'), this.globalOn(), async (box) => {
      try { const ok = await this.setEnabled(null, box.checked); if (!ok) box.checked = !box.checked; }
      catch (err) { box.checked = !box.checked; failed(err); }
      again();
    }));
    host.appendChild(toggle(t('Open recently used pages with the guide'), this.suggestEnabled(), (box) => {
      try { this.setSuggest(box.checked); } catch (err) { box.checked = !box.checked; failed(err); }
    }));
    host.appendChild(el('p', 'setting-info muted', t('Never recorded: private windows, Tor and burner tabs, sign-in, payment, bank and mail pages, and these sites.')));
    const never = this.never();
    for (const h of never) {
      const r = el('div', 'setting-toggle-row');
      r.appendChild(el('span', null, h));
      const x = el('button', 'btn-secondary', t('Remove'));
      x.type = 'button';
      x.addEventListener('click', () => { try { this.removeNever(h); } catch (err) { failed(err); } again(); });
      r.appendChild(x);
      host.appendChild(r);
    }
    const add = el('button', 'btn-secondary', t('Never remember a site…'));
    add.type = 'button';
    add.addEventListener('click', async () => {
      try {
        const v = await window.vexPrompt({ title: t('Never remember a site'), label: t('Website'), message: t('For example example.com — its subdomains are covered too.'), okLabel: t('Add') });
        if (v == null) return;
        this.addNever(v);
      } catch (err) { failed(err); }
      again();
    });
    host.appendChild(add);
  },

  // One row inside a game's block: its own switch and the way in.
  renderGame(wrap, game, repaint) {
    const t = (s) => this._t(s);
    const failed = (err) => window.showToast?.((err && err.message) || String(err), 'error');
    const row = document.createElement('div');
    row.className = 'setting-toggle-row';
    const label = document.createElement('span');
    label.textContent = t('Dossier for this game') + ' (' + this.count(game.id) + ')';
    const sw = document.createElement('label');
    sw.className = 'toggle';
    sw.innerHTML = '<input type="checkbox"><span class="toggle-slider"></span>';
    const box = sw.querySelector('input');
    box.checked = this.enabledFor(game.id);
    box.setAttribute('aria-label', t('Remember what I look at while I play') + ' — ' + game.name);
    box.addEventListener('change', async () => {
      try { const ok = await this.setEnabled(game.id, box.checked); if (!ok) box.checked = !box.checked; }
      catch (err) { box.checked = !box.checked; failed(err); }
      repaint();
    });
    const open = document.createElement('button');
    open.type = 'button';
    open.className = 'btn-secondary';
    open.textContent = t('Open dossier');
    open.addEventListener('click', () => { try { this.openView(game.id); } catch (err) { failed(err); } });
    const right = document.createElement('span');
    right.className = 'gs-btns';
    right.append(open, sw);
    row.append(label, right);
    wrap.appendChild(row);
  },
};

if (typeof window !== 'undefined') window.GameDossier = GameDossier;
if (typeof module !== 'undefined' && module.exports) module.exports = { GameDossier };

// === Scroll position across restart and Reopen Closed Tab (T3-003) ============
//
// A tab asleep (and a tab whose page crashed) already came back where you were
// reading it. A tab closed and reopened with Ctrl+Shift+T, or the whole window
// closed and opened again, came back at the top: the position was only ever
// read when a tab went to sleep.
//
// This reads where the tab in front is scrolled to every few seconds and when
// you leave it, keeps it with the tab ({ x, y, url, anchor, off }), and puts the
// page back there the first time that page has loaded:
//   * `anchor` is the first words of the paragraph at the top of the view and
//     `off` how far past its top the view was. A page whose layout moved (a
//     single-page app, an article that loads pictures) is put back by that text;
//     a page that has no such paragraph by the number of pixels.
//   * a long page that has not grown tall enough yet is waited for, up to six
//     seconds, before giving up on the exact place (the nearest it can reach is
//     used and the person is not told twice).
//   * nothing is scrolled if the person has already scrolled themselves, or if
//     the page is not the one the position was taken on (the address differs).
// The position is kept in the tab's own record (so it follows the existing
// session file), never read from a private or Tor tab, and never sent anywhere.
//
// Two more parts (Wave 5), each its own switch under "Remember where I was on a page":
//   * a per-article place that outlives the tab: for a long page (three screens or more) the place is
//     also kept by address (vex.scrollMemory.articles, 200 addresses, 60 days), so an article you closed
//     weeks ago and open again from History or a link comes back where you stopped. A place within a
//     screen of the end is forgotten, since you finished it. On by default with the module.
//   * a thin reading-progress bar along the top of the page area for a long page: how far down you are,
//     read every two seconds for the tab in front only. Off until chosen.

// Runs INSIDE the page (stringified): where is the view, and what text is at its top.
function vexScrollSample() {
  const BLOCK = 'h1,h2,h3,h4,h5,h6,p,li,pre,blockquote,td,dd,dt,figcaption';
  const se = document.scrollingElement || document.documentElement;
  const y = Math.round(window.scrollY || se.scrollTop || 0);
  const x = Math.round(window.scrollX || 0);
  const out = { x, y, h: se.scrollHeight || 0, vh: window.innerHeight || 0, anchor: '', off: 0 };
  if (y <= 0) return out;
  let el = document.elementFromPoint(Math.max(1, Math.floor((window.innerWidth || 2) / 2)), 12);
  for (let i = 0; el && i < 8; i++, el = el.parentElement) {
    if (!el.matches || !el.matches(BLOCK)) continue;
    const text = (el.textContent || '').replace(/\s+/g, ' ').trim();
    if (text.length < 12) continue;
    out.anchor = text.slice(0, 80);
    out.off = Math.round(-el.getBoundingClientRect().top);
    break;
  }
  return out;
}

// Runs INSIDE the page (stringified): put the view back. → 'moved' | 'anchor' | 'offset' | 'short'
function vexScrollRestore(pos) {
  const BLOCK = 'h1,h2,h3,h4,h5,h6,p,li,pre,blockquote,td,dd,dt,figcaption';
  const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim();
  return new Promise((resolve) => {
    let tries = 0;
    const find = () => {
      if (!pos.anchor) return null;
      const els = document.querySelectorAll(BLOCK);
      for (let i = 0; i < els.length && i < 6000; i++) {
        if (norm(els[i].textContent).slice(0, 80) === pos.anchor) return els[i];
      }
      return null;
    };
    const step = () => {
      if ((window.scrollY || 0) >= 20) return resolve('moved');       // already scrolled by hand
      const el = find();
      if (el) {
        window.scrollTo(pos.x || 0, Math.max(0, Math.round(window.scrollY + el.getBoundingClientRect().top + (pos.off || 0))));
        return resolve('anchor');
      }
      const se = document.scrollingElement || document.documentElement;
      const room = (se.scrollHeight || 0) - (window.innerHeight || 0);
      if (room >= pos.y) { window.scrollTo(pos.x || 0, pos.y); return resolve('offset'); }
      if (++tries > 12) { window.scrollTo(pos.x || 0, Math.max(0, room)); return resolve('short'); }
      setTimeout(step, 500);
    };
    step();
  });
}

const VexScrollMemory = {
  KEY: 'vex.scrollMemory',           // '0' = off
  ARTICLES_KEY: 'vex.scrollMemory.articles',   // { [address]: { y, anchor, off, at } }
  ARTICLES_PREF: 'vex.scrollMemory.articlesOn', // '0' = the per-article place is off
  BAR_PREF: 'vex.scrollMemory.bar',            // '1' = the progress bar is on
  MAX_ARTICLES: 200,
  ARTICLE_DAYS: 60,
  LONG_PAGES: 3,                     // a page is an article from this many screens
  BAR_MS: 2000,
  SAMPLE_MS: 8000,
  MIN_MOVE: 60,                      // px of change before the session file is written again
  _handled: new WeakSet(),           // webviews whose first page has been dealt with
  _lastActive: null,
  _job: null,

  enabled() { return localStorage.getItem(this.KEY) !== '0'; },
  setEnabled(on) {
    localStorage.setItem(this.KEY, on ? '1' : '0');
    if (!on && this._job) { this._job.stop(); this._job = null; }
    if (on) this._startJob();
  },

  articlesEnabled() { return this.enabled() && localStorage.getItem(this.ARTICLES_PREF) !== '0'; },
  setArticlesEnabled(on) { localStorage.setItem(this.ARTICLES_PREF, on ? '1' : '0'); },
  barEnabled() { return this.enabled() && localStorage.getItem(this.BAR_PREF) === '1'; },
  setBarEnabled(on) {
    localStorage.setItem(this.BAR_PREF, on ? '1' : '0');
    if (!on) this._drawBar(null);
    else this._startBarJob();
  },

  // ---- the place of an article, by address ------------------------------------------------------------
  // The address a place belongs to: no #fragment.
  _articleKey(url) {
    try { const u = new URL(url); if (u.protocol !== 'http:' && u.protocol !== 'https:') return ''; u.hash = ''; return u.href; } catch { return ''; }
  },
  articles() {
    const raw = localStorage.getItem(this.ARTICLES_KEY);
    if (raw == null) return {};
    let o;
    try { o = JSON.parse(raw); } catch (err) { throw new Error('The places kept for articles could not be read', { cause: err }); }
    return o && typeof o === 'object' && !Array.isArray(o) ? o : {};
  },
  // A place found while reading: kept for a long page, forgotten within a screen of its end.
  rememberArticle(url, s, now = Date.now()) {
    if (!this.articlesEnabled()) return false;
    const key = this._articleKey(url);
    if (!key || !s || !(s.vh > 0) || !(s.h >= this.LONG_PAGES * s.vh)) return false;
    const all = this.articles();
    if (s.y + s.vh >= s.h - s.vh) { if (key in all) { delete all[key]; localStorage.setItem(this.ARTICLES_KEY, JSON.stringify(all)); return true; } return false; }
    if (!(s.y > 20)) return false;
    all[key] = { x: s.x || 0, y: s.y, anchor: String(s.anchor || ''), off: Number.isFinite(s.off) ? s.off : 0, at: now };
    const keys = Object.keys(all);
    const stale = now - this.ARTICLE_DAYS * 86400000;
    for (const k of keys) if (all[k].at < stale) delete all[k];
    const left = Object.keys(all);
    if (left.length > this.MAX_ARTICLES) left.sort((a, b) => all[a].at - all[b].at).slice(0, left.length - this.MAX_ARTICLES).forEach(k => { delete all[k]; });
    localStorage.setItem(this.ARTICLES_KEY, JSON.stringify(all));
    return true;
  },
  articlePlace(url, now = Date.now()) {
    if (!this.articlesEnabled()) return null;
    const key = this._articleKey(url);
    const p = key ? this.articles()[key] : null;
    return p && now - p.at < this.ARTICLE_DAYS * 86400000 ? p : null;
  },

  // ---- the reading-progress bar ------------------------------------------------------------------------
  // How far down the page is: 0..1, or null for a page that is not long enough to need a bar.
  progress(s) {
    if (!s || !(s.vh > 0) || !(s.h >= this.LONG_PAGES * s.vh)) return null;
    const room = s.h - s.vh;
    return room > 0 ? Math.max(0, Math.min(1, s.y / room)) : null;
  },
  _drawBar(fraction) {
    if (typeof document === 'undefined') return;
    let bar = document.getElementById('vex-read-progress');
    if (fraction == null) { if (bar) bar.hidden = true; return; }
    if (!bar) {
      const host = document.getElementById('content-area') || document.body;
      bar = document.createElement('div');
      bar.id = 'vex-read-progress';
      bar.setAttribute('role', 'progressbar');
      bar.setAttribute('aria-label', 'How far down this page you are');
      bar.setAttribute('aria-valuemin', '0'); bar.setAttribute('aria-valuemax', '100');
      bar.appendChild(document.createElement('div'));
      host.appendChild(bar);
    }
    bar.hidden = false;
    const pct = Math.round(fraction * 100);
    bar.setAttribute('aria-valuenow', String(pct));
    bar.firstChild.style.width = pct + '%';
  },
  async updateBar() {
    if (!this.barEnabled() || typeof TabManager === 'undefined' || !TabManager.activeTabId) { this._drawBar(null); return null; }
    const id = TabManager.activeTabId;
    const wv = typeof WebviewManager !== 'undefined' ? WebviewManager.webviews.get(id) : null;
    const tab = TabManager.tabs.find(t => t.id === id);
    if (!tab || !wv || !/^https?:/i.test(tab.url || '') || !this._handled.has(wv) || !this._canRead(wv) || tab.sleeping) { this._drawBar(null); return null; }
    const s = await window.vexGuestEval(wv, this._call(vexScrollSample), false, 3000);
    const f = this.progress(s);
    this._drawBar(f);
    return f;
  },
  _startBarJob() {
    if (this._barJob || typeof VexJobs === 'undefined') return;
    this._barJob = VexJobs.every('Reading progress bar', this.BAR_MS, () => this.updateBar().catch(err => {
      if (typeof VexProblems !== 'undefined') VexProblems.note('Scroll memory', 'Could not read how far down the page is', err);
    }), { when: 'ui', feature: 'scroll-memory' });
  },

  _call(fn, ...args) { return '(' + fn.toString() + ')(' + args.map(a => JSON.stringify(a)).join(',') + ')'; },

  // Same page? Address without the #fragment.
  _samePage(a, b) {
    try {
      const x = new URL(a), y = new URL(b);
      return x.origin === y.origin && x.pathname === y.pathname && x.search === y.search;
    } catch { return false; }
  },

  _canRead(wv) {
    return !!wv && wv.isConnected !== false && (!window.VexTabPolicy || window.VexTabPolicy.canReadWebview(wv));
  },

  // The position of a tab's page, now. → null when it cannot be read.
  async read(tabId) {
    const tab = TabManager.tabs.find(t => t.id === tabId);
    const wv = typeof WebviewManager !== 'undefined' ? WebviewManager.webviews.get(tabId) : null;
    if (!tab || !tab.url || !/^https?:/i.test(tab.url) || !this._handled.has(wv) || !this._canRead(wv)) return null;
    return window.vexGuestEval(wv, this._call(vexScrollSample), false, 3000);
  },

  // Keep what read() found with the tab.
  note(tab, s) {
    if (!s || !Number.isFinite(s.y) || !Number.isFinite(s.x)) return false;
    // The article's place outlives the tab (kept by address; see rememberArticle).
    try { this.rememberArticle(tab.url, s); }
    catch (err) { if (typeof VexProblems !== 'undefined') VexProblems.note('Scroll memory', 'Could not keep the place in an article', err); }
    const before = tab.scrollPosition;
    if (s.y <= 0) {
      if (!before) return false;
      tab.scrollPosition = null;
      return true;
    }
    const next = { x: s.x, y: s.y, url: tab.url, anchor: String(s.anchor || ''), off: Number.isFinite(s.off) ? s.off : 0 };
    if (before && before.url === next.url && before.anchor === next.anchor && Math.abs((before.y || 0) - next.y) < this.MIN_MOVE) return false;
    tab.scrollPosition = next;
    return true;
  },

  async sample(tabId) {
    const tab = TabManager.tabs.find(t => t.id === tabId);
    if (!tab || tab.sleeping) return false;
    let s;
    try { s = await this.read(tabId); }
    catch (err) {
      // A page that will not answer keeps the position it had.
      if (typeof VexProblems !== 'undefined') VexProblems.note('Scroll memory', 'Could not read where a page is scrolled to', err);
      return false;
    }
    if (!this.note(tab, s)) return false;
    TabManager.persistTabs();
    return true;
  },

  // The first time a tab's page has settled: put it back where it was.
  async restoreOnce(tabId) {
    const tab = TabManager.tabs.find(t => t.id === tabId);
    const wv = typeof WebviewManager !== 'undefined' ? WebviewManager.webviews.get(tabId) : null;
    if (!tab || !wv || this._handled.has(wv)) return null;
    this._handled.add(wv);
    let pos = tab.scrollPosition;
    // A position without the address it was taken on is a sleep's (js/tabs.js wakeTab puts that one back).
    if (pos && (!pos.url || !(pos.y > 0) || !this._samePage(pos.url, tab.url))) pos = null;
    // A tab with no place of its own: the one kept for this article by address, if there is one.
    if (!pos && this._canRead(wv) && /^https?:/i.test(tab.url || '')) {
      const kept = this.articlePlace(tab.url);
      if (kept) pos = { ...kept, url: tab.url };
    }
    if (!pos || !(pos.y > 0) || !this._canRead(wv)) return null;
    try { return await window.vexGuestEval(wv, this._call(vexScrollRestore, { x: pos.x || 0, y: pos.y, anchor: pos.anchor || '', off: pos.off || 0 }), false, 9000); }
    catch (err) {
      if (typeof VexProblems !== 'undefined') VexProblems.note('Scroll memory', 'Could not put a page back where it was', err);
      return null;
    }
  },

  _startJob() {
    if (this._job || typeof VexJobs === 'undefined') return;
    this._job = VexJobs.every('Scroll memory', this.SAMPLE_MS, () => {
      if (!this.enabled() || typeof TabManager === 'undefined' || !TabManager.activeTabId) return;
      return this.sample(TabManager.activeTabId);
    }, { when: 'ui', feature: 'scroll-memory' });
  },

  init() {
    if (this._inited) return false;
    this._inited = true;
    document.addEventListener('vex:tab-settled', (e) => {
      if (!this.enabled()) return;
      const id = e.detail && e.detail.tabId;
      if (id) this.restoreOnce(id);
    });
    // Leaving a tab: read it once more before it goes to the background.
    window.addEventListener('vex:tab-activated', (e) => {
      const prev = this._lastActive;
      this._lastActive = e.detail && e.detail.tabId;
      if (this.enabled() && prev && prev !== this._lastActive) this.sample(prev);
    });
    if (this.enabled()) this._startJob();
    if (this.barEnabled()) this._startBarJob();
    // A tab change or a settled page moves the bar at once instead of waiting for the next look.
    window.addEventListener('vex:tab-activated', () => { if (this.barEnabled()) this.updateBar().catch(err => { if (typeof VexProblems !== 'undefined') VexProblems.note('Scroll memory', 'Could not read how far down the page is', err); }); });
    return true;
  },
};

if (typeof window !== 'undefined') window.VexScrollMemory = VexScrollMemory;
if (typeof module !== 'undefined' && module.exports) module.exports = { VexScrollMemory, vexScrollSample, vexScrollRestore };

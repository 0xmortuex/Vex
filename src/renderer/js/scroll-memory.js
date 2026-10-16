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
// Not built: a thin reading-progress bar and a per-article position that
// outlives the tab (see the Wave 3 report).

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
    const pos = tab.scrollPosition;
    // A position without the address it was taken on is a sleep's (js/tabs.js wakeTab puts that one back).
    if (!pos || !pos.url || !(pos.y > 0) || !this._canRead(wv) || !this._samePage(pos.url, tab.url)) return null;
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
    return true;
  },
};

if (typeof window !== 'undefined') window.VexScrollMemory = VexScrollMemory;
if (typeof module !== 'undefined' && module.exports) module.exports = { VexScrollMemory, vexScrollSample, vexScrollRestore };

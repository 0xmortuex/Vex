// === What is new on a page since you were last on it =======================
//
// A thread you keep coming back to, a changelog, a wiki page, a status page:
// you have read it once, and on the next visit you are looking for the part
// you have not. "Watch this page" (PageMonitor) answers a different question —
// it tells you a page changed while you were away from it. This one is for
// pages you go back to yourself, and it shows you where the new parts are.
//
// What is kept is a short hash per paragraph, never the text: enough to say
// "this paragraph was not here last time", not enough to reconstruct what the
// page said. And only for pages you asked about — nothing is recorded for a
// page you have not asked Vex to remember.
const WhatsNew = {
  KEY: 'vex.whatsNew',
  MAX_PAGES: 200,
  MAX_BLOCKS: 800,
  MIN_TEXT: 25,            // a paragraph shorter than this is furniture

  all() { try { const o = JSON.parse(localStorage.getItem(this.KEY) || '{}'); return o && typeof o === 'object' ? o : {}; } catch { return {}; } },
  save(all) { try { localStorage.setItem(this.KEY, JSON.stringify(all)); } catch {} },

  // The fragment is a place on the page, not a different page.
  key(url) {
    try {
      const u = new URL(url);
      if (u.protocol !== 'http:' && u.protocol !== 'https:') return '';
      u.hash = '';
      return u.toString();
    } catch { return ''; }
  },

  known(url) { return this.all()[this.key(url)] || null; },
  isRemembered(url) { return !!this.known(url); },

  remember(url, hashes, title) {
    const key = this.key(url);
    if (!key) throw new Error('That is not a web page');
    const all = this.all();
    all[key] = { at: Date.now(), title: String(title || ''), hashes: (hashes || []).slice(0, this.MAX_BLOCKS) };
    // Oldest out first, so this never grows without end.
    const keys = Object.keys(all);
    if (keys.length > this.MAX_PAGES) {
      keys.sort((a, b) => (all[a].at || 0) - (all[b].at || 0));
      for (const k of keys.slice(0, keys.length - this.MAX_PAGES)) delete all[k];
    }
    this.save(all);
    return all[key];
  },

  forget(url) { const all = this.all(); delete all[this.key(url)]; this.save(all); },

  // --- in the page ---------------------------------------------------------

  // One expression, used for reading and for marking, so the two always agree
  // about what counts as a paragraph.
  _blocks() {
    return `(() => {
      const SEL = 'p, li, h1, h2, h3, h4, h5, h6, blockquote, pre, dd, td, figcaption';
      const hash = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(36); };
      const out = [];
      for (const el of document.querySelectorAll(SEL)) {
        if (el.querySelector(SEL)) continue;                    // the innermost one only
        const text = (el.innerText || el.textContent || '').replace(/\\s+/g, ' ').trim();
        if (text.length < ${this.MIN_TEXT}) continue;
        out.push({ el, h: hash(text.slice(0, 400)) });
      }
      return out;
    })()`;
  },

  scanScript() {
    return `(() => {
      const blocks = ${this._blocks()};
      return blocks.slice(0, ${this.MAX_BLOCKS}).map(b => b.h);
    })()`;
  },

  // Marks every paragraph whose hash is not one we saw last time, and scrolls
  // to the first. A <style> tag and one attribute, so clearing it puts the
  // page back exactly as it was — no inline styles of the page's own touched.
  markScript(knownHashes) {
    return `(() => {
      const known = new Set(${JSON.stringify(knownHashes || [])});
      document.querySelectorAll('[data-vex-new]').forEach(el => el.removeAttribute('data-vex-new'));
      let style = document.getElementById('vex-new-style');
      if (!style) {
        style = document.createElement('style');
        style.id = 'vex-new-style';
        style.textContent = '[data-vex-new]{box-shadow:inset 3px 0 0 #3b82f6;background:rgba(59,130,246,0.10)}';
        (document.head || document.documentElement).appendChild(style);
      }
      const blocks = ${this._blocks()};
      let first = null, n = 0;
      for (const b of blocks) {
        if (known.has(b.h)) continue;
        b.el.setAttribute('data-vex-new', '1');
        if (!first) first = b.el;
        n++;
      }
      if (first) first.scrollIntoView({ block: 'center', behavior: 'smooth' });
      return n;
    })()`;
  },

  clearScript() {
    return `(() => {
      document.querySelectorAll('[data-vex-new]').forEach(el => el.removeAttribute('data-vex-new'));
      document.getElementById('vex-new-style')?.remove();
      return true;
    })()`;
  },

  // --- wording -------------------------------------------------------------

  since(at, now = Date.now()) {
    const mins = Math.round((now - at) / 60000);
    if (mins < 2) return 'a moment ago';
    if (mins < 60) return mins + ' minutes ago';
    const hours = Math.round(mins / 60);
    if (hours < 24) return hours === 1 ? 'an hour ago' : hours + ' hours ago';
    const days = Math.round(hours / 24);
    if (days === 1) return 'yesterday';
    if (days < 30) return days + ' days ago';
    return new Date(at).toLocaleDateString();
  },

  summary(count, at, now = Date.now()) {
    const when = 'since your last visit, ' + this.since(at, now);
    if (!count) return 'Nothing new ' + when;
    return count === 1 ? 'One new paragraph ' + when : count + ' new paragraphs ' + when;
  },

  // --- the two things it does ----------------------------------------------

  _tab() {
    const tab = typeof TabManager !== 'undefined' ? TabManager.getActiveTab() : null;
    const wv = typeof WebviewManager !== 'undefined' ? WebviewManager.webviews.get(TabManager.activeTabId) : null;
    let url = '';
    try { url = (wv && wv.getURL && wv.getURL()) || (tab && tab.url) || ''; } catch { url = (tab && tab.url) || ''; }
    if (!/^https?:/i.test(url) || !wv) throw new Error('Open a web page first');
    return { url, wv, title: (tab && tab.title) || '' };
  },

  // The command: remembers the page the first time, shows what is new after.
  async run() {
    const t = this._tab();
    const seen = this.known(t.url);
    if (!seen) {
      const hashes = await window.vexGuestEval(t.wv, this.scanScript(), false, 8000);
      this.remember(t.url, hashes, t.title);
      window.showToast?.('Remembered this page — next time you come back, what is new will be marked');
      return { remembered: true, count: 0 };
    }
    const count = await window.vexGuestEval(t.wv, this.markScript(seen.hashes), false, 8000);
    window.showToast?.(this.summary(count, seen.at));
    // Now this visit is the one to compare against next time.
    const hashes = await window.vexGuestEval(t.wv, this.scanScript(), false, 8000);
    this.remember(t.url, hashes, t.title);
    return { remembered: false, count };
  },

  async clear() {
    const t = this._tab();
    return window.vexGuestEval(t.wv, this.clearScript(), false, 6000);
  },

  async stop() {
    const t = this._tab();
    this.forget(t.url);
    try { await this.clear(); } catch { /* the page may already be gone */ }
    window.showToast?.('Vex will stop noticing changes on this page');
    return true;
  },

  // A remembered page marks itself on arrival: that is the whole point of
  // having asked for it. Pages you never asked about are left alone.
  init() {
    document.addEventListener('vex:tab-navigated', async (e) => {
      const { tabId, url } = e.detail || {};
      const seen = this.known(url || '');
      if (!seen) return;
      const wv = typeof WebviewManager !== 'undefined' ? WebviewManager.webviews.get(tabId) : null;
      if (!wv) return;
      try {
        const count = await window.vexGuestEval(wv, this.markScript(seen.hashes), false, 8000);
        if (count) window.showToast?.(this.summary(count, seen.at));
        const hashes = await window.vexGuestEval(wv, this.scanScript(), false, 8000);
        this.remember(url, hashes, seen.title);
      } catch (err) {
        window.VexProblems?.note('What is new', 'Could not compare this page with your last visit', err);
      }
    });
    return this;
  },
};

if (typeof window !== 'undefined') window.WhatsNew = WhatsNew;
if (typeof module !== 'undefined' && module.exports) module.exports = { WhatsNew };

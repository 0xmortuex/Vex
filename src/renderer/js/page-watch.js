// === Tell me when this changes =============================================
//
// Auto-refresh reloads a page on a timer, which is half the job: you still have
// to look at it. The thing people actually want is "tell me when the price
// drops", "when the tickets open", "when the build finishes" — and today that
// means leaving a tab open and remembering to check it.
//
// A watch reloads quietly in the background, compares what came back with what
// was there before, and says so when it is different. What "different" means is
// the user's choice: the whole page, one part of it, or a number in it.
const PageWatch = {
  KEY: 'vex.pageWatches',
  EVERY: [
    { ms: 5 * 60000, label: 'every 5 minutes' },
    { ms: 15 * 60000, label: 'every 15 minutes' },
    { ms: 60 * 60000, label: 'every hour' },
    { ms: 6 * 3600000, label: 'every 6 hours' },
    { ms: 24 * 3600000, label: 'once a day' },
  ],

  list() { try { const a = JSON.parse(localStorage.getItem(this.KEY) || '[]'); return Array.isArray(a) ? a : []; } catch { return []; } },
  _save(list) {
    try { localStorage.setItem(this.KEY, JSON.stringify(list)); return true; }
    catch (err) { VexProblems?.note('Page watch', 'Could not save the watches', err); return false; }
  },

  // What is being compared. A selector narrows it to one part of the page,
  // which is the difference between "the article changed" and "the navigation
  // bar rotated its advert".
  //   kind 'text'   — the words changed at all
  //   kind 'number' — the first number in it went up, down, or past a figure
  add({ url, title, selector, kind = 'text', every = 15 * 60000, direction = 'any', target = null }) {
    if (!/^https?:/i.test(String(url || ''))) throw new Error('Only a web page can be watched');
    const list = this.list();
    if (list.some(w => w.url === url && (w.selector || '') === (selector || ''))) throw new Error('That is already being watched');
    const watch = {
      id: 'w_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      url: String(url), title: String(title || url), selector: String(selector || '').slice(0, 200),
      kind: kind === 'number' ? 'number' : 'text',
      direction: ['up', 'down', 'any', 'below', 'above'].includes(direction) ? direction : 'any',
      target: target == null ? null : Number(target),
      every: Number(every) || 15 * 60000,
      addedAt: Date.now(), lastCheckedAt: 0, lastValue: null, lastChangedAt: 0, failures: 0,
    };
    list.push(watch);
    if (!this._save(list)) throw new Error('The watch could not be saved');
    return watch;
  },

  remove(id) { this._save(this.list().filter(w => w.id !== id)); },

  // The first number in a piece of text, as a person would read it: "£1,299.99"
  // is 1299.99, and "4 of 12 left" is 4.
  firstNumber(text) {
    const m = String(text || '').replace(/[  ]/g, ' ').match(/-?\d[\d,. ]*/);
    if (!m) return null;
    // Thousands separators go; the last dot or comma with 1-2 digits after it
    // is the decimal point.
    let raw = m[0].trim().replace(/\s/g, '');
    const dec = raw.match(/[.,](\d{1,2})$/);
    if (dec) raw = raw.slice(0, dec.index).replace(/[.,]/g, '') + '.' + dec[1];
    else raw = raw.replace(/[.,]/g, '');
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  },

  // Is this worth telling the user about?
  // → { changed, from, to, why } — `why` is the sentence they see.
  judge(watch, value) {
    const before = watch.lastValue;
    if (before == null) return { changed: false, from: null, to: value, why: 'first look' };
    if (watch.kind === 'number') {
      const a = Number(before), b = Number(value);
      if (!Number.isFinite(a) || !Number.isFinite(b) || a === b) return { changed: false, from: a, to: b, why: 'no change' };
      const dir = b > a ? 'up' : 'down';
      if (watch.direction === 'up' && dir !== 'up') return { changed: false, from: a, to: b, why: 'went down' };
      if (watch.direction === 'down' && dir !== 'down') return { changed: false, from: a, to: b, why: 'went up' };
      if (watch.direction === 'below') {
        if (!(b <= watch.target)) return { changed: false, from: a, to: b, why: 'still above ' + watch.target };
        return { changed: true, from: a, to: b, why: `is ${b}, at or below ${watch.target}` };
      }
      if (watch.direction === 'above') {
        if (!(b >= watch.target)) return { changed: false, from: a, to: b, why: 'still below ' + watch.target };
        return { changed: true, from: a, to: b, why: `is ${b}, at or above ${watch.target}` };
      }
      return { changed: true, from: a, to: b, why: `went ${dir} from ${a} to ${b}` };
    }
    const same = String(before).replace(/\s+/g, ' ').trim() === String(value).replace(/\s+/g, ' ').trim();
    return same ? { changed: false, from: before, to: value, why: 'no change' } : { changed: true, from: before, to: value, why: 'changed' };
  },

  // Read the watched value out of a page, without disturbing the user's tabs:
  // the page is fetched, not opened.
  async readValue(watch) {
    if (typeof AgentTools === 'undefined') throw new Error('Page reading is not available');
    const page = await AgentTools.readUrl(watch.url);
    let text = String(page.text || '');
    if (watch.selector) {
      // A selector needs the real document, so this path uses the page's
      // markup rather than the readable text.
      const raw = await AgentTools._get(watch.url);
      const doc = new DOMParser().parseFromString(String(raw.body || ''), 'text/html');
      const el = doc.querySelector(watch.selector);
      if (!el) throw new Error('Nothing on that page matches "' + watch.selector + '" any more');
      text = (el.textContent || '').replace(/\s+/g, ' ').trim();
    }
    return watch.kind === 'number' ? this.firstNumber(text) : text.slice(0, 4000);
  },

  async checkOne(id, now = Date.now()) {
    const list = this.list();
    const watch = list.find(w => w.id === id);
    if (!watch) throw new Error('That watch is gone');
    let value;
    try {
      value = await this.readValue(watch);
      watch.failures = 0;
    } catch (err) {
      // A page that fails once is a blip; one that fails five times running is
      // gone, and a watch that cannot be checked must say so rather than sit
      // there looking healthy.
      watch.failures = (watch.failures || 0) + 1;
      watch.lastCheckedAt = now;
      watch.lastError = (err && err.message) || 'could not be read';
      this._save(list);
      if (watch.failures === 5) {
        window.showToast?.('Cannot check "' + watch.title + '" — ' + watch.lastError, 'error');
        VexProblems?.note('Page watch', 'Gave up checking ' + watch.url, err);
      }
      return { ok: false, error: watch.lastError };
    }
    if (watch.kind === 'number' && value == null) {
      watch.lastCheckedAt = now;
      this._save(list);
      return { ok: false, error: 'no number found on that page' };
    }
    const verdict = this.judge(watch, value);
    watch.lastCheckedAt = now;
    watch.lastError = null;
    if (verdict.changed) watch.lastChangedAt = now;
    watch.lastValue = value;
    this._save(list);
    if (verdict.changed) this.announce(watch, verdict);
    return { ok: true, ...verdict };
  },

  announce(watch, verdict) {
    const what = watch.kind === 'number' ? `${watch.title} ${verdict.why}` : `${watch.title} changed`;
    window.showToast?.(what, 'info', 8000);
    // A desktop notification as well: the point of a watch is that you are not
    // looking at Vex (js/notify goes through the main process).
    try { window.vex?.notify?.('Vex — a page changed', what); } catch {}
    document.dispatchEvent(new CustomEvent('vex:page-watch', { detail: { watch, verdict } }));
  },

  // Whatever is due, one at a time so a dozen watches do not all fetch at once.
  async checkDue(now = Date.now()) {
    const due = this.list().filter(w => now - (w.lastCheckedAt || 0) >= w.every);
    const out = [];
    for (const w of due) {
      try { out.push({ id: w.id, ...(await this.checkOne(w.id, now)) }); }
      catch (err) { VexProblems?.note('Page watch', 'A check failed', err); }
    }
    return out;
  },

  start() {
    if (this._timer) return;
    // The first look sets the baseline; nothing is announced from it.
    setTimeout(() => this.checkDue(), 20000);
    this._timer = setInterval(() => this.checkDue(), 60000);
  },
};

if (typeof window !== 'undefined') window.PageWatch = PageWatch;
if (typeof module !== 'undefined' && module.exports) module.exports = { PageWatch };

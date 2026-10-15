// === Page Watcher: what "changed" means ====================================
//
// Pure functions, no DOM and no storage, so every rule here is unit-tested on
// real page text (tests/renderer/pageWatchDiff.test.js). js/page-watch.js is
// the part that fetches, schedules and speaks; this is the part that decides.
//
//   normalizeText   a page's text -> steady lines (no clock times, "5 minutes
//                   ago", cookie banners, whitespace)
//   lineDiff        which lines were added and which removed
//   change          is that worth telling anyone (the sensitivity setting)
//   summarize       the plain-English version of a diff
//   extract         "the price / version / number" out of text with a pattern
//   pushSnapshot    bounded history: per watch and in total
const PageWatchDiff = {
  // What is kept. The history lives in localStorage next to everything else of
  // Vex's, so it is bounded three ways: snapshots per watch, characters per
  // snapshot, characters in all.
  LIMITS: { perWatch: 20, snapChars: 30000, totalChars: 1500000, lineChars: 400 },

  // low: three lines or more must differ, so a headline swapping is not news
  // but a page that was rewritten is. normal: any line. high: any line, and
  // the clock times and "5 minutes ago" are kept as well, so a page that
  // prints the time is reported on every look (what it asks for).
  SENSITIVITY: {
    low: { minLines: 3, steady: true },
    normal: { minLines: 1, steady: true },
    high: { minLines: 1, steady: false },
  },

  PRESETS: {
    price: { label: 'A price', pattern: '([$£€₺¥]\\s?\\d[\\d.,]*|\\d[\\d.,]*\\s?(?:USD|EUR|GBP|TRY|TL|\\$|€|£|₺))' },
    version: { label: 'A version number', pattern: '\\bv?(\\d+(?:\\.\\d+){1,3}(?:[-+][0-9A-Za-z.]+)?)\\b' },
    stock: { label: 'Stock status', pattern: '\\b(back in stock|in stock|out of stock|sold out|currently unavailable|unavailable|pre-?order|only \\d+ left|low stock|add to (?:cart|basket|bag))\\b' },
    number: { label: 'The first number', pattern: '(-?\\d[\\d.,]*)' },
  },

  // What a page prints that differs on every load by itself.
  _volatile: [
    /\b(?:\d+|an?|one)\s+(?:sec(?:ond)?s?|min(?:ute)?s?|hours?|hrs?|days?|weeks?)\s+ago\b/gi,
    /\b(?:just now|moments? ago)\b/gi,
    /\b\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?/g,
    /\b\d{1,2}:\d{2}(?::\d{2})?\s*(?:[ap]\.?m\.?)?(?=\W|$)/gi,
    /\b1[5-9]\d{8}(?:\d{3})?\b/g,
  ],

  // Lines that are the page's furniture, not its content.
  _noiseLine: /^(?:skip to (?:main )?content|accept (?:all )?cookies?|reject (?:all )?cookies?|we use cookies\b.*|this (?:site|website) uses cookies\b.*|cookie (?:settings|preferences|policy)|advertisement|advertisements?|sponsored(?: content| links?)?|ad choices|ads? by .*|(?:sign up for|subscribe to) our newsletter.*|back to top)$/i,

  // The words of a page as steady lines. `text` has a line break after each
  // block (AgentTools.htmlToText, or an element's innerText).
  normalizeText(text, { steady = true } = {}) {
    const max = this.LIMITS.lineChars;
    const out = [];
    for (const raw of String(text == null ? '' : text).split(/\r?\n/)) {
      let line = raw.replace(/[ ​-‍﻿]/g, ' ');
      if (steady) for (const re of this._volatile) line = line.replace(re, ' ');
      line = line.replace(/\s+/g, ' ').trim();
      if (!line || this._noiseLine.test(line)) continue;
      out.push(line.length > max ? line.slice(0, max) : line);
    }
    return out;
  },

  // A short stable fingerprint of every line (not only the stored ones), so a
  // change at the bottom of a long page is seen.
  fingerprint(lines) {
    let h = 0x811c9dc5, g = 0x01000193, n = 0;
    for (const line of lines) {
      for (let i = 0; i < line.length; i++) {
        const c = line.charCodeAt(i);
        h = Math.imul(h ^ c, 0x01000193);
        g = Math.imul(g ^ c, 0x5bd1e995);
      }
      h = Math.imul(h ^ 10, 0x01000193); g = Math.imul(g ^ 10, 0x5bd1e995);
      n += line.length + 1;
    }
    return (h >>> 0).toString(16) + (g >>> 0).toString(16) + '-' + n;
  },

  // Lines added and lines removed, in page order. Common head and tail are
  // trimmed first, which is nearly everything on a page that changed in one
  // place; the middle is a longest-common-subsequence, or, past a size where
  // that would be slow, a plain count of which lines appeared or went.
  lineDiff(before, after) {
    const a = Array.isArray(before) ? before : [], b = Array.isArray(after) ? after : [];
    let s = 0;
    while (s < a.length && s < b.length && a[s] === b[s]) s++;
    let ea = a.length, eb = b.length;
    while (ea > s && eb > s && a[ea - 1] === b[eb - 1]) { ea--; eb--; }
    const A = a.slice(s, ea), B = b.slice(s, eb);
    if (!A.length || !B.length) return { added: B, removed: A };
    if (A.length * B.length > 4000000) {
      const left = new Map();
      for (const l of A) left.set(l, (left.get(l) || 0) + 1);
      const added = [];
      for (const l of B) {
        const c = left.get(l);
        if (c) left.set(l, c - 1); else added.push(l);
      }
      const gone = new Map();
      for (const l of B) gone.set(l, (gone.get(l) || 0) + 1);
      const removed = [];
      for (const l of A) {
        const c = gone.get(l);
        if (c) gone.set(l, c - 1); else removed.push(l);
      }
      return { added, removed };
    }
    const n = A.length, m = B.length, w = m + 1;
    const dp = new Uint16Array((n + 1) * w);
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        dp[i * w + j] = A[i] === B[j] ? dp[(i + 1) * w + j + 1] + 1 : Math.max(dp[(i + 1) * w + j], dp[i * w + j + 1]);
      }
    }
    const added = [], removed = [];
    let i = 0, j = 0;
    while (i < n && j < m) {
      if (A[i] === B[j]) { i++; j++; }
      else if (dp[(i + 1) * w + j] >= dp[i * w + j + 1]) removed.push(A[i++]);
      else added.push(B[j++]);
    }
    while (i < n) removed.push(A[i++]);
    while (j < m) added.push(B[j++]);
    return { added, removed };
  },

  // Is this difference worth a notification at the chosen sensitivity?
  change(before, after, { sensitivity = 'normal' } = {}) {
    const rule = this.SENSITIVITY[sensitivity] || this.SENSITIVITY.normal;
    const { added, removed } = this.lineDiff(before, after);
    // A line that was reworded is one change (one removed, one added), not two.
    const lines = Math.max(added.length, removed.length);
    return { added, removed, lines, significant: lines >= rule.minLines && (added.length + removed.length) > 0 };
  },

  // "2 lines added, 1 removed" and the lines themselves, a few of them.
  summarize({ added = [], removed = [] }, { maxLines = 4, lineChars = 140 } = {}) {
    const cut = (s) => (s.length > lineChars ? s.slice(0, lineChars - 1) + '…' : s);
    const plural = (n) => n + (n === 1 ? ' line' : ' lines');
    let headline;
    if (added.length && removed.length && added.length === removed.length) headline = plural(added.length) + ' changed';
    else if (added.length && !removed.length) headline = plural(added.length) + ' added';
    else if (!added.length && removed.length) headline = plural(removed.length) + ' removed';
    else headline = plural(added.length) + ' added, ' + removed.length + ' removed';
    const items = [];
    // A reworded line reads best as old then new.
    for (let i = 0; i < Math.max(added.length, removed.length); i++) {
      if (i < removed.length) items.push({ sign: '-', text: cut(removed[i]) });
      if (i < added.length) items.push({ sign: '+', text: cut(added[i]) });
    }
    const shown = items.slice(0, maxLines);
    return {
      headline, items: shown, more: Math.max(0, items.length - shown.length),
      text: headline + (shown.length ? ':\n' + shown.map(x => x.sign + ' ' + x.text).join('\n') : '') + (items.length > shown.length ? '\n… and ' + (items.length - shown.length) + ' more' : ''),
    };
  },

  // A pattern the user (or a preset) gave, compiled; a bad one says so.
  compile(pattern) {
    const p = String(pattern == null ? '' : pattern);
    if (!p.trim()) throw new Error('Give a pattern to look for');
    if (p.length > 200) throw new Error('That pattern is too long (200 characters at most)');
    try { return new RegExp(p, 'i'); }
    catch (err) { throw new Error('That pattern is not valid: ' + err.message); }
  },

  // The first capture group of the first match (or the whole match when the
  // pattern has none). null when it is not on the page.
  extract(text, pattern) {
    const re = typeof pattern === 'string' ? this.compile(pattern) : pattern;
    const m = re.exec(String(text == null ? '' : text).slice(0, 300000));
    if (!m) return null;
    const v = m[1] != null ? m[1] : m[0];
    return String(v).replace(/\s+/g, ' ').trim().slice(0, 200);
  },

  // History, bounded. `store` is { [watchId]: [{ at, text, hash, truncated }] },
  // oldest first. Returns the store (changed in place): a snapshot equal to the
  // newest one is not added; each watch keeps `perWatch`; and past `totalChars`
  // the oldest snapshots of any watch go, never a watch's newest.
  pushSnapshot(store, id, { at, text, hash }, limits = this.LIMITS) {
    const body = String(text == null ? '' : text);
    const truncated = body.length > limits.snapChars;
    const list = store[id] || (store[id] = []);
    if (list.length && list[list.length - 1].hash === hash) return store;
    list.push({ at, text: truncated ? body.slice(0, limits.snapChars) : body, hash, truncated });
    while (list.length > limits.perWatch) list.shift();
    let total = 0;
    for (const l of Object.values(store)) for (const s of l) total += s.text.length;
    while (total > limits.totalChars) {
      let victim = null;
      for (const [wid, l] of Object.entries(store)) {
        if (l.length < 2) continue;
        if (!victim || l[0].at < victim.l[0].at) victim = { wid, l };
      }
      if (!victim) break;
      total -= victim.l.shift().text.length;
    }
    return store;
  },

  sizeOf(store) {
    let n = 0;
    for (const l of Object.values(store || {})) for (const s of l) n += s.text.length;
    return n;
  },
};

if (typeof window !== 'undefined') window.PageWatchDiff = PageWatchDiff;
if (typeof module !== 'undefined' && module.exports) module.exports = { PageWatchDiff };

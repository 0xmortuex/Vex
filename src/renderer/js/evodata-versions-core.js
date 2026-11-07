// === Text versions of a page: the pure part ====================================
//
// For a page the person marked "keep versions of this page": a text-only snapshot (the readable words, never the
// HTML, never a picture) and a word-level diff between two snapshots. Nothing here touches the disk, the DOM or the
// network. Main (src/main/evodata-versions-store.js) keeps the files; the window (js/page-versions.js) draws them.
//
//   100 pages, 20 versions per page (the OLDEST version goes when a 21st comes), 200 KB of text per version.
//   A 101st page is refused, never swapped for an older one: the person chose these pages.
(function (root) {
  'use strict';

  const LIMITS = { pages: 100, versionsPerPage: 20, versionChars: 200 * 1024, diffTokens: 20000, diffCells: 4000000 };

  const str = (v) => String(v == null ? '' : v);
  const clipTo = (v, n) => str(v).slice(0, n);

  // ---- word diff -------------------------------------------------------------------
  const tokens = (text) => str(text).match(/\S+|\n/g) || [];

  // A word-level diff of two texts. Line breaks are tokens too (they show as '\n' in `words`).
  // -> { ops: [{ t: 'eq'|'add'|'del', words }], added, removed, coarse, cut }
  // Bounded, so a big page can not freeze the window: more than diffTokens words a side is cut off (cut: true), and a
  // changed middle too big for the comparison table (diffCells) is shown as one removed block and one added block
  // (coarse: true). The unchanged start and end are always trimmed off first, so a small edit in a big page is exact.
  function wordDiff(a, b) {
    let x = tokens(a), y = tokens(b);
    const cut = x.length > LIMITS.diffTokens || y.length > LIMITS.diffTokens;
    if (x.length > LIMITS.diffTokens) x = x.slice(0, LIMITS.diffTokens);
    if (y.length > LIMITS.diffTokens) y = y.slice(0, LIMITS.diffTokens);
    let head = 0;
    while (head < x.length && head < y.length && x[head] === y[head]) head++;
    let tail = 0;
    while (tail < x.length - head && tail < y.length - head && x[x.length - 1 - tail] === y[y.length - 1 - tail]) tail++;
    const mx = x.slice(head, x.length - tail), my = y.slice(head, y.length - tail);
    const ops = [];
    const push = (t, words) => {
      if (!words.length) return;
      const last = ops[ops.length - 1];
      if (last && last.t === t) last.words.push(...words); else ops.push({ t, words: words.slice() });
    };
    push('eq', x.slice(0, head));
    let coarse = false;
    if (!mx.length || !my.length) { push('del', mx); push('add', my); }
    else if ((mx.length + 1) * (my.length + 1) > LIMITS.diffCells) { coarse = true; push('del', mx); push('add', my); }
    else {
      const n = mx.length, m = my.length, w = m + 1;
      // lcs[i * w + j]: the length of the longest common subsequence of mx[i..] and my[j..]. At most diffCells
      // (4,000,000) entries, 16 MB.
      const lcs = new Uint32Array((n + 1) * w);
      for (let i = n - 1; i >= 0; i--) {
        for (let j = m - 1; j >= 0; j--) {
          lcs[i * w + j] = mx[i] === my[j] ? lcs[(i + 1) * w + j + 1] + 1 : Math.max(lcs[(i + 1) * w + j], lcs[i * w + j + 1]);
        }
      }
      let i = 0, j = 0;
      while (i < n && j < m) {
        if (mx[i] === my[j]) { push('eq', [mx[i]]); i++; j++; }
        else if (lcs[(i + 1) * w + j] >= lcs[i * w + j + 1]) { push('del', [mx[i]]); i++; }
        else { push('add', [my[j]]); j++; }
      }
      push('del', mx.slice(i)); push('add', my.slice(j));
    }
    push('eq', x.slice(x.length - tail));
    const count = (t) => ops.filter(o => o.t === t).reduce((s, o) => s + o.words.filter(wd => wd !== '\n').length, 0);
    return { ops, added: count('add'), removed: count('del'), coarse, cut };
  }

  // For showing a diff: long unchanged stretches are cut down to `context` words at each edge with a { t: 'gap' } between,
  // and the unchanged start and end of the page keep only the words next to a change.
  function foldContext(ops, context = 12) {
    const out = [];
    ops.forEach((op, i) => {
      if (op.t !== 'eq') { out.push(op); return; }
      const w = op.words, first = i === 0, last = i === ops.length - 1;
      if (first && last) { out.push(op); return; }
      if (first) {
        if (w.length > context) { out.push({ t: 'gap', words: [] }, { t: 'eq', words: w.slice(-context) }); } else out.push(op);
      } else if (last) {
        if (w.length > context) { out.push({ t: 'eq', words: w.slice(0, context) }, { t: 'gap', words: [] }); } else out.push(op);
      } else if (w.length > 2 * context + 1) {
        out.push({ t: 'eq', words: w.slice(0, context) }, { t: 'gap', words: [] }, { t: 'eq', words: w.slice(-context) });
      } else out.push(op);
    });
    return out;
  }

  // Words (and the line-break token) back to text: one space between words, none around a line break.
  function joinWords(words) {
    const NL = String.fromCharCode(10);
    let out = '', atLineStart = true;
    for (const w of words) {
      if (w === NL) { out += NL; atLineStart = true; } else { out += (atLineStart ? '' : ' ') + w; atLineStart = false; }
    }
    return out;
  }

  // ---- kept pages -------------------------------------------------------------------
  // The address a page is kept under: no sign-in part, no #fragment. Only a web address.
  function pageKey(url) {
    let u;
    try { u = new URL(str(url)); } catch { throw new Error('That is not a web address'); }
    if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error('Only a web page can have versions kept');
    u.username = ''; u.password = ''; u.hash = '';
    return u.href.slice(0, 1000);
  }
  function fnv(s, seed) {
    let h = seed >>> 0;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
    return h.toString(16).padStart(8, '0');
  }
  // A file name for a page: one letter and hex digits only, so an address can never name a path.
  function pageId(url) { const k = pageKey(url); return 'p' + fnv(k, 2166136261) + fnv(k, 3735928559); }

  // The readable text, steady: line ends LF, no trailing spaces, no control characters, no more than one blank line in a row.
  function cleanVersionText(text) {
    return str(text).replace(/\r\n?/g, '\n').replace(/[^\S\n]+$/gm, '').replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '').replace(/\n{3,}/g, '\n\n').trim();
  }

  function newPage(url, title, now = Date.now()) {
    return { v: 1, id: pageId(url), url: pageKey(url), title: clipTo(title || url, 200), keptAt: now, versions: [] };
  }

  // Add a text version to a kept page. Pure: returns a new page. Same text as the newest version: nothing is added.
  // Over the cap: the oldest version goes. -> { page, saved, truncated, change: { added, removed } | null }
  function addVersion(page, text, { now = Date.now(), via = 'page' } = {}) {
    let t = cleanVersionText(text);
    if (!t) throw new Error('There is no readable text on that page to keep');
    const truncated = t.length > LIMITS.versionChars;
    if (truncated) t = t.slice(0, LIMITS.versionChars);
    const last = page.versions[page.versions.length - 1];
    if (last && last.text === t) return { page, saved: false, truncated, change: { added: 0, removed: 0 } };
    // The time is strictly after the version before it, so a version can be named by its time.
    const at = last ? Math.max(now, last.at + 1) : now;
    // What changed since the version before it is worked out once, here, and kept with the version, so the list can
    // say "12 words added, 3 removed" without reading the texts again. The first version has no earlier one: null.
    let change = null;
    if (last) { const d = wordDiff(last.text, t); change = { added: d.added, removed: d.removed }; }
    // via: how the text was read, 'page' (the open page) or 'watch' (the page watch's own reader). The two read a page a little
    // differently, so a comparison across them says so.
    const versions = page.versions.concat([{ at, text: t, truncated, change, via: via === 'watch' ? 'watch' : 'page' }]);
    while (versions.length > LIMITS.versionsPerPage) versions.shift();
    return { page: { ...page, versions }, saved: true, truncated, change };
  }

  const api = { LIMITS, tokens, wordDiff, foldContext, joinWords, pageKey, pageId, cleanVersionText, newPage, addVersion };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.VexVersionsCore = api;
})(typeof window !== 'undefined' ? window : null);

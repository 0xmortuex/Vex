// === Whole-word find in the page (Ctrl+F option "ab") ==========================
//
// Chromium's findInPage (what the find bar uses) cannot match whole words only. This is the option beside it:
// the "ab" button in the find bar (Settings > Tabs and navigation, "Find bar" switch, remembered as the pref
// findWholeWord in js/tabs-nav.js) searches the page's TEXT with a word boundary on both sides and draws the
// matches with the CSS Custom Highlight API (no change to the page's own markup, no selection taken from the
// page). It has its own Next / Previous and its own count, shown in the same "3/12" place.
//
//   "cat" does not match in "category" or "concat"; it matches "Cat", "cat." and "the cat".
//   A word boundary is "not a letter, a digit or an underscore" (Unicode aware: Turkish letters count as letters).
//
// What it reads: the visible text nodes of the page in front, in the page itself (one script run through
// webview.executeJavaScript, nothing leaves the page, nothing is stored). Limits, said plainly: a word split over
// two elements (<b>wo</b>rd) is two text nodes and is not found; text inside a closed shadow root, an iframe or a
// canvas is not seen (Chromium's find does not see a canvas either); at most 5000 matches are drawn; letter case is
// folded the simple way, so the Turkish dotted capital I is not matched by a plain i (turn on Match case to be exact).
// Pages whose own Ctrl+F is handed through (Google Docs) are not affected: Vex's bar is not opened there.
const VexWholeWordFind = {
  MAX_MATCHES: 5000,
  CSS: '::highlight(vex-ww){background-color:#ffe066;color:#000}::highlight(vex-ww-active){background-color:#ff9632;color:#000}',

  // The whole of this function runs INSIDE the page (it is turned into text), so it uses nothing from outside.
  // op: 'find' | 'clear'. -> { total, active (1-based, 0 when none), capped }
  pageFn: function (op, a) {
    var NAME = 'vex-ww', ACTIVE = 'vex-ww-active';
    var S = window.__vexWW || (window.__vexWW = { ranges: [], i: -1, q: '', mc: false, capped: false });
    function clearHighlights() {
      if (window.CSS && CSS.highlights) { CSS.highlights.delete(NAME); CSS.highlights.delete(ACTIVE); }
    }
    if (op === 'clear') { clearHighlights(); S.ranges = []; S.i = -1; S.q = ''; return { total: 0, active: 0, capped: false }; }
    if (!window.CSS || !CSS.highlights || !window.Highlight) throw new Error('This page cannot show highlights');
    var SKIP = { SCRIPT: 1, STYLE: 1, NOSCRIPT: 1, TEMPLATE: 1, TEXTAREA: 1, OPTION: 1, SELECT: 1 };
    function collect() {
      var esc = a.query.replace(/[.*+?^${}()|[\]\\\/]/g, '\\$&');
      var re = new RegExp('(?<![\\p{L}\\p{N}_])' + esc + '(?![\\p{L}\\p{N}_])', 'gu' + (a.matchCase ? '' : 'i'));
      var out = [], capped = false;
      var w = document.createTreeWalker(document.body || document.documentElement, NodeFilter.SHOW_TEXT, {
        acceptNode: function (n) {
          var p = n.parentElement;
          if (!p || SKIP[p.tagName] || !n.nodeValue || !n.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
          if (typeof p.checkVisibility === 'function' && !p.checkVisibility({ checkVisibilityCSS: true })) return NodeFilter.FILTER_REJECT;
          return NodeFilter.FILTER_ACCEPT;
        }
      });
      var node, m;
      while ((node = w.nextNode())) {
        re.lastIndex = 0;
        while ((m = re.exec(node.nodeValue))) {
          if (!m[0]) { re.lastIndex++; continue; }
          if (out.length >= a.max) { capped = true; break; }
          var r = document.createRange();
          r.setStart(node, m.index); r.setEnd(node, m.index + m[0].length);
          out.push(r);
        }
        if (capped) break;
      }
      S.capped = capped;
      return out;
    }
    var same = S.q === a.query && S.mc === !!a.matchCase && S.ranges.length > 0 && S.ranges.every(function (r) { return !r.collapsed && r.startContainer.isConnected; });
    var step = same;
    if (!same) { S.ranges = collect(); S.q = a.query; S.mc = !!a.matchCase; S.i = -1; }
    var n = S.ranges.length;
    if (!n) { clearHighlights(); S.i = -1; return { total: 0, active: 0, capped: S.capped }; }
    if (step) S.i = (S.i + (a.forward === false ? -1 : 1) + n) % n;
    else S.i = a.forward === false ? n - 1 : 0;
    CSS.highlights.set(NAME, new window.Highlight(...S.ranges));
    CSS.highlights.set(ACTIVE, new window.Highlight(S.ranges[S.i]));
    var el = S.ranges[S.i].startContainer.parentElement;
    if (el && el.scrollIntoView) el.scrollIntoView({ block: 'center', inline: 'nearest' });
    return { total: n, active: S.i + 1, capped: S.capped };
  },

  _script(op, args) {
    return '(' + this.pageFn.toString() + ')(' + JSON.stringify(op) + ',' + JSON.stringify(args || {}) + ')';
  },

  // Whether the find bar's "ab" option is switched on (Settings > Tabs and navigation, Find bar).
  on() {
    return typeof VexTabsNav !== 'undefined' && VexTabsNav.on('findOptions') && VexTabsNav.prefs().findWholeWord === true;
  },

  async _styles(wv) {
    if (typeof wv.insertCSS !== 'function') throw new Error('This page cannot be given the highlight colours');
    if (!wv._vexWwBound) {
      // A reload drops what was inserted, so it is inserted again on the next search.
      wv.addEventListener('dom-ready', () => { wv._vexWwCss = false; });
      wv._vexWwBound = true;
    }
    if (wv._vexWwCss) return;
    await wv.insertCSS(this.CSS);
    wv._vexWwCss = true;
  },

  // Search the page of a webview. -> { total, active, capped }. Throws what is wrong (a page that cannot be searched).
  async find(wv, query, { matchCase = false, forward = true } = {}) {
    if (!wv || typeof wv.executeJavaScript !== 'function') throw new Error('There is no page to search');
    const q = String(query == null ? '' : query);
    if (!q.trim()) { await this.clear(wv); return { total: 0, active: 0, capped: false }; }
    if (q.length > 200) throw new Error('A word to find is at most 200 characters');
    await this._styles(wv);
    wv._vexWwUsed = true;
    return wv.executeJavaScript(this._script('find', { query: q, matchCase: !!matchCase, forward: forward !== false, max: this.MAX_MATCHES }));
  },

  async clear(wv) {
    if (!wv || typeof wv.executeJavaScript !== 'function') return;
    await wv.executeJavaScript(this._script('clear', {}));
  },

  countText(r) { return r.total ? r.active + '/' + r.total + (r.capped ? '+' : '') : '0/0'; },
};

if (typeof window !== 'undefined') window.VexWholeWordFind = VexWholeWordFind;
if (typeof module !== 'undefined' && module.exports) module.exports = { VexWholeWordFind };

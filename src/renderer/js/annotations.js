// === Vex Annotations: persistent web highlighting ===
//
// Highlight any selection on any page; the highlight is stored locally keyed by
// URL and re-applied every time you revisit (host → guest on dom-ready, like
// Boosts/Accessibility). Optional per-highlight note. A sidebar panel lists all
// highlights across every page. Storage: localStorage 'vex.annotations' =
//   { [url]: [ { id, text, quote, color, note, at, title, url } ] }
// Highlights are matched back onto the page by a text-quote anchor
// ({ exact, prefix, suffix }, whitespace removed) over the page's text as a
// whole, so a highlight that crosses bold, a link or a paragraph comes back
// (it used to be looked for inside ONE text node and never was; found
// 2026-10-10). Each text node it covers gets its own <mark>.

// Runs inside the page (injected as source, like vexReaderPageLib), so it uses
// only the DOM. Kept a real function so tests can run it under jsdom.
function vexHighlightPageLib() {
  var SKIP = /^(SCRIPT|STYLE|NOSCRIPT|TEXTAREA)$/;
  var CTX = 32;
  var WS = /\s/;
  // The page's text with all whitespace left out, and for each character the
  // text node and offset it came from. Whitespace-free so a selection's own
  // newlines between paragraphs and the page's markup indentation cannot
  // stop a match.
  function textMap(root) {
    var chars = [], nodes = [], offs = [];
    var w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, { acceptNode: function (n) {
      var p = n.parentNode; return p && !SKIP.test(p.nodeName) ? 1 : 2;
    } });
    var n;
    while ((n = w.nextNode())) {
      var v = n.nodeValue;
      for (var i = 0; i < v.length; i++) if (!WS.test(v[i])) { chars.push(v[i]); nodes.push(n); offs.push(i); }
    }
    return { text: chars.join(''), nodes: nodes, offs: offs };
  }
  // The anchor of a live selection range: which characters of the map it covers.
  function anchorOf(map, range) {
    var start = -1, end = -1, inside = new Map();
    for (var i = 0; i < map.nodes.length; i++) {
      var node = map.nodes[i];
      if (!inside.has(node)) inside.set(node, range.intersectsNode(node));
      if (!inside.get(node)) continue;
      var off = map.offs[i];
      if (range.comparePoint(node, off) === 0 && range.comparePoint(node, off + 1) === 0) { if (start < 0) start = i; end = i; }
    }
    if (start < 0) return null;
    return {
      start: start, end: end,
      quote: {
        exact: map.text.slice(start, end + 1),
        prefix: map.text.slice(Math.max(0, start - CTX), start),
        suffix: map.text.slice(end + 1, end + 1 + CTX),
      },
    };
  }
  function inMark(node) { var p = node.parentNode; return !!(p && p.closest && p.closest('mark.vexhl')); }
  // Where a stored anchor lands now: the occurrence of exact whose
  // surroundings agree best with prefix/suffix, skipping text another
  // highlight already covers.
  function find(map, quote) {
    var exact = String((quote && quote.exact) || '').replace(/\s+/g, '');
    if (exact.length < 2) return null;
    var prefix = String(quote.prefix || '').replace(/\s+/g, '');
    var suffix = String(quote.suffix || '').replace(/\s+/g, '');
    var full = prefix.length + suffix.length;
    var best = -1, bestScore = -1;
    for (var at = map.text.indexOf(exact); at >= 0; at = map.text.indexOf(exact, at + 1)) {
      if (inMark(map.nodes[at])) continue;
      var score = 0, k;
      for (k = 1; k <= prefix.length && at - k >= 0 && map.text[at - k] === prefix[prefix.length - k]; k++) score++;
      var after = at + exact.length;
      for (k = 0; k < suffix.length && after + k < map.text.length && map.text[after + k] === suffix[k]; k++) score++;
      if (score > bestScore) { best = at; bestScore = score; if (score === full) break; }
    }
    return best < 0 ? null : { start: best, end: best + exact.length - 1 };
  }
  function style(m, h) {
    m.style.cssText = 'background:' + h.color + ';color:inherit;border-radius:2px;padding:0 1px;box-decoration-break:clone';
    if (h.note) { m.title = 'Note: ' + h.note; m.style.cursor = 'help'; m.style.boxShadow = 'inset 0 -2px 0 rgba(0,0,0,0.35)'; } else m.removeAttribute('title');
  }
  // Wraps characters start..end of the map, one <mark> per text node.
  function wrap(map, start, end, h) {
    var segs = [];
    for (var i = start; i <= end; i++) {
      var last = segs[segs.length - 1];
      if (last && last.node === map.nodes[i]) last.b = map.offs[i] + 1;
      else segs.push({ node: map.nodes[i], a: map.offs[i], b: map.offs[i] + 1 });
    }
    segs.forEach(function (s) {
      var mid = s.node;
      if (s.a > 0) mid = mid.splitText(s.a);
      if (s.b - s.a < mid.nodeValue.length) mid.splitText(s.b - s.a);
      var m = document.createElement('mark');
      m.className = 'vexhl'; m.setAttribute('data-vexhl', h.id); style(m, h);
      mid.parentNode.insertBefore(m, mid); m.appendChild(mid);
    });
    return segs.length;
  }
  function marks(id) { return Array.prototype.filter.call(document.querySelectorAll('mark.vexhl'), function (el) { return el.getAttribute('data-vexhl') === id; }); }
  function unwrap(id) {
    marks(id).forEach(function (m) { var p = m.parentNode; while (m.firstChild) p.insertBefore(m.firstChild, m); p.removeChild(m); if (p.normalize) p.normalize(); });
  }
  return { textMap: textMap, anchorOf: anchorOf, find: find, wrap: wrap, style: style, marks: marks, unwrap: unwrap };
}

const Annotations = {
  KEY: 'vex.annotations',
  store: {},
  COLORS: { yellow: '#ffe066', green: '#9be29b', pink: '#ffadc6', blue: '#9bd1ff' },

  init() {
    try { const s = JSON.parse(localStorage.getItem(this.KEY) || '{}'); if (s && typeof s === 'object') this.store = s; } catch { this.store = {}; }
    this._baseline = window.CollectionStore.snapshotMap(this.store);
    if (this._migrate()) this.save();
    this._badge();
  },

  // Whitespace-free text-quote anchor for a highlight saved before anchors
  // existed: its whole text is the exact quote.
  _quoteOf(h) {
    if (h && h.quote && h.quote.exact) return h.quote;
    return { exact: String((h && h.text) || '').replace(/\s+/g, ''), prefix: '', suffix: '' };
  },

  // One-time repairs, true when anything changed:
  //  - a highlight made in reading mode was keyed on the reader's whole
  //    data: page (tens of KB per key, and never re-applied); it moves to the
  //    page the reader was made from, or goes if that cannot be read.
  //  - a highlight without a text-quote anchor gets one from its text.
  _migrate() {
    let changed = false;
    const isReaderKey = (k) => /^(data:|nulltext\/html)/i.test(k);
    for (const k of Object.keys(this.store)) {
      const list = Array.isArray(this.store[k]) ? this.store[k] : [];
      if (isReaderKey(k)) {
        delete this.store[k];
        changed = true;
        for (const h of list) {
          const src = window.ReadingMode ? window.ReadingMode.sourceOf(h && h.url) : '';
          if (!src) continue;
          const dest = this._key(src);
          if (!this.store[dest]) this.store[dest] = [];
          if (!this.store[dest].some(x => x.id === h.id)) this.store[dest].push({ ...h, url: src });
        }
      }
    }
    for (const list of Object.values(this.store)) {
      if (!Array.isArray(list)) continue;
      for (const h of list) if (h && !(h.quote && h.quote.exact)) { h.quote = this._quoteOf(h); changed = true; }
    }
    return changed;
  },

  // The address a highlight belongs to: the page itself, or for a Vex reader
  // page the page it was made from (its own data: address is the whole
  // article, and changes with every reader setting).
  _pageUrl(loc) {
    const src = window.ReadingMode ? window.ReadingMode.sourceOf(loc) : '';
    return src || loc;
  },
  // The location.href the page must have for a highlight on `url` to be
  // applied: the reader page's own address when the tab is reading `url`.
  _liveLocation(webview, url) {
    let loc = '';
    try { loc = (webview && webview.getURL && webview.getURL()) || ''; } catch { loc = ''; }
    const src = window.ReadingMode && loc ? window.ReadingMode.sourceOf(loc) : '';
    return src && this._key(src) === this._key(url) ? loc : url;
  },
  _lib() { return '(' + vexHighlightPageLib.toString() + ')()'; },
  // Delta-merged per page so a second window's highlights are not erased by our
  // in-memory snapshot (see collection-store.js).
  save() {
    this.store = window.CollectionStore.saveMap(this.KEY, this._baseline, this.store);
    this._baseline = window.CollectionStore.snapshotMap(this.store);
    this._badge();
  },

  // The page key used to be origin+pathname only, which meant every
  // youtube.com/watch?v=… (and every other query-driven page) shared ONE bucket:
  // highlights made on one video were listed under, and re-applied to, all the
  // others. The query string is part of the page's identity, so it belongs in
  // the key.
  _key(url) { try { const u = new URL(url); return (u.origin + u.pathname).replace(/\/$/, '') + (u.search || ''); } catch { return url || ''; } },
  // Highlights saved before that fix live under the old key. Fall back to it so
  // nothing the user made disappears; new highlights are written to _key.
  _legacyKey(url) { try { const u = new URL(url); return (u.origin + u.pathname).replace(/\/$/, ''); } catch { return url || ''; } },
  forUrl(url) {
    const list = this.store[this._key(url)];
    if (list && list.length) return list;
    const legacy = this.store[this._legacyKey(url)];
    return (legacy && legacy.length) ? legacy : [];
  },
  count() { return Object.values(this.store).reduce((n, a) => n + (a ? a.length : 0), 0); },

  // --- Apply all stored highlights for a page (called on dom-ready) ---
  applyTo(webview, url) {
    if (window.VexTabPolicy && !window.VexTabPolicy.canFillWebview(webview)) return;
    const list = this.forUrl(url);
    if (!list.length) return;
    const loc = this._liveLocation(webview, url);
    const data = list.map(h => ({ id: h.id, quote: this._quoteOf(h), color: this.COLORS[h.color] || this.COLORS.yellow, note: h.note || '' }));
    // A highlight already on the page is restyled rather than skipped, so a
    // note added from the panel shows on it at once (it used to need a reload).
    const js = `(function(){try{
      if(location.href!==${JSON.stringify(loc)})return;
      var L=${this._lib()};
      var hs=${JSON.stringify(data)};
      hs.forEach(function(h){
        var have=L.marks(h.id);
        if(have.length){have.forEach(function(m){L.style(m,h);});return;}
        var map=L.textMap(document.body);var r=L.find(map,h.quote);
        if(r)L.wrap(map,r.start,r.end,h);
      });
    }catch(e){}})();`;
    try { webview.executeJavaScript(js).catch(() => {}); } catch {}
  },

  reapply(url) {
    if (typeof WebviewManager === 'undefined') return;
    const wv = WebviewManager.getActiveWebview();
    const t = TabManager.getActiveTab();
    if (wv && t && t.url === url) this.applyTo(wv, url);
  },

  // --- Highlight the current selection ---
  async highlight(color) {
    color = color && this.COLORS[color] ? color : 'yellow';
    const wv = WebviewManager.getActiveWebview();
    const t = TabManager.getActiveTab();
    if (!wv || !t || !t.url) { window.showToast?.('Open a page first'); return; }
    // In reading mode the tab shows a data: page; the highlight belongs to the
    // page the reader was made from (it used to be keyed on the whole data:
    // page, tens of KB, and never came back).
    const loc = wv.getURL?.() || t.url;
    const url = this._pageUrl(loc);
    const generation = wv._navigationGeneration;
    const persist = !window.VexTabPolicy || window.VexTabPolicy.canFillWebview(wv);
    const id = 'hl' + Date.now().toString(36) + Math.floor(performance.now() % 1000);
    const hex = this.COLORS[color];
    const js = `(function(){try{
      if(location.href!==${JSON.stringify(loc)})return '';
      var s=getSelection();if(!s||s.isCollapsed||!s.rangeCount)return '';
      var rng=s.getRangeAt(0);var text=s.toString();if(!text.trim())return '';
      var L=${this._lib()};
      var map=L.textMap(document.body);var a=L.anchorOf(map,rng);if(!a)return '';
      L.wrap(map,a.start,a.end,{id:${JSON.stringify(id)},color:${JSON.stringify(hex)},note:''});
      s.removeAllRanges();return JSON.stringify({text:text.substring(0,2000),quote:a.quote});
    }catch(e){return ''}})();`;
    let out = '';
    try { out = await wv.executeJavaScript(js); } catch {}
    if (wv._navigationGeneration !== generation || (wv.getURL && wv.getURL() !== loc)) return;
    if (!out) { window.showToast?.('Select some text first'); return; }
    const { text, quote } = JSON.parse(out);
    if (!persist) { window.showToast?.('Highlighted for this private page only'); return; }
    const k = this._key(url);
    if (!this.store[k]) this.store[k] = [];
    // Keep the real page URL alongside the key: the key is normalized (trailing
    // slash dropped) and the panel should reopen exactly what was highlighted.
    this.store[k].push({ id, text, quote, color, note: '', at: Date.now(), title: t.title || url, url });
    this.save();
    window.showToast?.('Highlighted (' + this.forUrl(url).length + ' on this page)');
  },

  // Which stored bucket actually holds this highlight — the current key, or the
  // pre-query-string one. Without this, deleting or annotating an old highlight
  // looked like it worked and then reappeared on the next repaint.
  _bucketFor(url, id) {
    for (const key of [this._key(url), this._legacyKey(url)]) {
      if (Array.isArray(this.store[key]) && this.store[key].some(h => h.id === id)) return key;
    }
    return null;
  },

  async remove(url, id) {
    const k = this._bucketFor(url, id);
    if (k && this.store[k]) { this.store[k] = this.store[k].filter(h => h.id !== id); if (!this.store[k].length) delete this.store[k]; this.save(); }
    const wv = WebviewManager.getActiveWebview();
    const t = TabManager.getActiveTab();
    if (wv && t && t.url === url) {
      // Every mark of it: a highlight across bold or paragraphs is one mark per text node.
      try { await wv.executeJavaScript(`(function(){if(location.href!==${JSON.stringify(this._liveLocation(wv, url))})return;${this._lib()}.unwrap(${JSON.stringify(id)});})();`); } catch {}
    }
  },

  async addNote(url, id) {
    const cur = (this.forUrl(url).find(h => h.id === id) || {}).note || '';
    // Native prompt() is disabled in Electron's renderer, so a missing
    // vexPromptModal must be reported rather than silently doing nothing.
    if (typeof vexPromptModal !== 'function') { window.showToast?.('The note dialog is unavailable', 'error'); return; }
    const v = await vexPromptModal('Note for this highlight', cur);
    if (v === null || v === undefined) return;
    const k = this._bucketFor(url, id);
    const h = k ? (this.store[k] || []).find(x => x.id === id) : null;
    if (h) { h.note = String(v).trim(); this.save(); this.reapply(url); window.showToast?.('Note saved'); }
  },

  _badge() {
    const btn = document.querySelector('.sidebar-icon[data-panel="annotations"]');
    if (!btn) return;
    let dot = btn.querySelector('.an-dot');
    const n = this.count();
    if (!n) { dot?.remove(); return; }
    if (!dot) {
      dot = document.createElement('span');
      dot.className = 'an-dot';
      dot.style.cssText = 'position:absolute;top:4px;right:4px;min-width:14px;height:14px;border-radius:7px;background:var(--primary);color:var(--on-primary,#fff);font-size:9px;font-weight:700;display:grid;place-items:center;padding:0 3px';
      btn.style.position = 'relative';
      btn.appendChild(dot);
    }
    dot.textContent = n > 99 ? '99+' : String(n);
  },

  renderPanel(container) {
    if (!container) return;
    const esc = (s) => window.escapeHtml(s);
    container.innerHTML = `<div class="panel-header"><h2>Highlights</h2></div>
      <p class="setting-info muted" style="padding:0 12px">Select text on any page, then <strong>Ctrl+K → Highlight</strong> (or right-click). Highlights reappear when you revisit the page.</p>
      <div id="an-body" style="padding:4px 10px 24px;overflow-y:auto;max-height:calc(100vh - 130px)"></div>`;
    const body = container.querySelector('#an-body');
    const pages = Object.keys(this.store).filter(k => this.store[k] && this.store[k].length);
    if (!pages.length) { body.innerHTML = window.VexUI ? VexUI.emptyState('highlight', 'No highlights yet', 'Select text on a page, then Ctrl+K → Highlight') : '<div style="font-size:12px;color:var(--text-muted);padding:10px 8px">No highlights yet.</div>'; return; }
    // Most recently annotated page first.
    // reduce, not Math.max(...spread): a page with thousands of highlights blows
    // the argument limit and throws mid-render.
    const newest = (key) => this.store[key].reduce((max, h) => Math.max(max, h.at || 0), 0);
    pages.sort((a, b) => newest(b) - newest(a));
    pages.forEach(k => {
      const list = this.store[k];
      const title = list[0].title || k;
      let host = k; try { host = new URL(list[0].url || k).hostname.replace(/^www\./, ''); } catch { try { host = new URL(k).hostname.replace(/^www\./, ''); } catch {} }
      const h = document.createElement('div');
      h.style.cssText = 'display:flex;align-items:center;gap:8px;padding:10px 6px 4px;cursor:pointer';
      h.innerHTML = `<img src="${typeof TabManager === 'undefined' || TabManager.mayAskSiteForIcon(list[0].url || k) ? `https://${encodeURIComponent(host)}/favicon.ico` : ''}" style="width:15px;height:15px;border-radius:3px" data-image-fallback="hide"><div style="flex:1;min-width:0;font-size:12.5px;font-weight:600;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(title)}</div><span style="font-size:10.5px;color:var(--text-muted)">${list.length}</span>`;
      h.addEventListener('click', () => { SidebarManager.hideActivePanel?.(); TabManager.createTab(k, true); });
      body.appendChild(h);
      list.forEach(a => {
        const r = document.createElement('div');
        r.style.cssText = 'display:flex;gap:8px;padding:5px 6px 5px 10px;border-radius:7px';
        r.addEventListener('mouseenter', () => r.style.background = 'var(--surface)');
        r.addEventListener('mouseleave', () => r.style.background = '');
        r.innerHTML = `<span style="width:5px;border-radius:3px;background:${this.COLORS[a.color] || this.COLORS.yellow};flex:none"></span>
          <div style="flex:1;min-width:0"><div style="font-size:12px;color:var(--text);display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden">${esc(a.text)}</div>${a.note ? `<div style="font-size:11px;color:var(--text-muted);margin-top:2px;display:flex;gap:5px;align-items:flex-start"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex:none;margin-top:2px"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z"/></svg><span>${esc(a.note)}</span></div>` : ''}</div>
          <button data-note title="Add/edit note" style="width:22px;height:22px;border:none;background:none;color:var(--text-muted);cursor:pointer;display:inline-flex;align-items:center;justify-content:center"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z"/></svg></button>
          <button data-x title="Delete" style="width:22px;height:22px;border:none;background:none;color:var(--text-muted);cursor:pointer;display:inline-flex;align-items:center;justify-content:center"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>`;
        r.querySelector('[data-note]').addEventListener('click', (e) => { e.stopPropagation(); this.addNote(list[0].url || k, a.id).then(() => this.renderPanel(container)); });
        r.querySelector('[data-x]').addEventListener('click', (e) => { e.stopPropagation(); this.remove(list[0].url || k, a.id).then(() => this.renderPanel(container)); });
        body.appendChild(r);
      });
    });
  },
};

if (typeof window !== 'undefined') window.Annotations = Annotations;
if (typeof module !== 'undefined' && module.exports) module.exports = { Annotations, vexHighlightPageLib };

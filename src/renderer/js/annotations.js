// === Vex Annotations: persistent web highlighting ===
//
// Highlight any selection on any page; the highlight is stored locally keyed by
// URL and re-applied every time you revisit (host → guest on dom-ready, like
// Boosts/Accessibility). Optional per-highlight note. A sidebar panel lists all
// highlights across every page. Storage: localStorage 'vex.annotations' =
//   { [url]: [ { id, text, color, note, at } ] }
// Highlights are matched back onto the page by their exact text (first unmarked
// occurrence within a text node) — robust enough for articles without needing
// fragile DOM offsets.

const Annotations = {
  KEY: 'vex.annotations',
  store: {},
  COLORS: { yellow: '#ffe066', green: '#9be29b', pink: '#ffadc6', blue: '#9bd1ff' },

  init() {
    try { const s = JSON.parse(localStorage.getItem(this.KEY) || '{}'); if (s && typeof s === 'object') this.store = s; } catch { this.store = {}; }
    this._baseline = window.CollectionStore.snapshotMap(this.store);
    this._badge();
  },
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
    if (window.VexTabPolicy && !window.VexTabPolicy.canReadWebview(webview)) return;
    const list = this.forUrl(url);
    if (!list.length) return;
    const data = list.map(h => ({ id: h.id, text: h.text, color: this.COLORS[h.color] || this.COLORS.yellow, note: h.note || '' }));
    const js = `(function(){try{
      if(location.href!==${JSON.stringify(url)})return;
      var hs=${JSON.stringify(data)};
      function wrap(node,start,len,h){
        var rng=document.createRange();rng.setStart(node,start);rng.setEnd(node,start+len);
        var m=document.createElement('mark');m.className='vexhl';m.setAttribute('data-vexhl',h.id);
        m.style.cssText='background:'+h.color+';color:inherit;border-radius:2px;padding:0 1px;box-decoration-break:clone';
        if(h.note){m.title='Note: '+h.note;m.style.cursor='help';m.style.boxShadow='inset 0 -2px 0 rgba(0,0,0,0.35)';}
        try{m.appendChild(rng.extractContents());rng.insertNode(m);return true;}catch(e){return false;}
      }
      hs.forEach(function(h){
        if(!h.text||document.querySelector('mark.vexhl[data-vexhl="'+h.id+'"]'))return;
        var t=h.text.trim();if(t.length<2)return;
        var w=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT,{acceptNode:function(n){
          var p=n.parentNode;if(!p)return 2;if(p.closest&&p.closest('mark.vexhl'))return 2;
          if(/SCRIPT|STYLE|NOSCRIPT|TEXTAREA/.test(p.nodeName))return 2;
          return n.nodeValue.indexOf(t)>=0?1:2;}});
        var node=w.nextNode();if(node){wrap(node,node.nodeValue.indexOf(t),t.length,h);}
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
    const url = wv.getURL?.() || t.url;
    const generation = wv._navigationGeneration;
    const persist = !window.VexTabPolicy || window.VexTabPolicy.canReadWebview(wv);
    const id = 'hl' + Date.now().toString(36) + Math.floor(performance.now() % 1000);
    const hex = this.COLORS[color];
    const js = `(function(){try{
      if(location.href!==${JSON.stringify(url)})return '';
      var s=getSelection();if(!s||s.isCollapsed||!s.rangeCount)return '';
      var rng=s.getRangeAt(0);var text=s.toString();if(!text.trim())return '';
      var m=document.createElement('mark');m.className='vexhl';m.setAttribute('data-vexhl',${JSON.stringify(id)});
      m.style.cssText='background:${hex};color:inherit;border-radius:2px;padding:0 1px;box-decoration-break:clone';
      try{m.appendChild(rng.extractContents());rng.insertNode(m);}catch(e){return '';}
      s.removeAllRanges();return text.substring(0,2000);
    }catch(e){return ''}})();`;
    let text = '';
    try { text = await wv.executeJavaScript(js); } catch {}
    if (wv._navigationGeneration !== generation || (wv.getURL && wv.getURL() !== url)) return;
    if (!text) { window.showToast?.('Select some text first'); return; }
    if (!persist) { window.showToast?.('Highlighted for this private page only'); return; }
    const k = this._key(url);
    if (!this.store[k]) this.store[k] = [];
    // Keep the real page URL alongside the key: the key is normalized (trailing
    // slash dropped) and the panel should reopen exactly what was highlighted.
    this.store[k].push({ id, text, color, note: '', at: Date.now(), title: t.title || t.url, url });
    this.save();
    window.showToast?.('Highlighted (' + this.forUrl(t.url).length + ' on this page)');
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
      try { await wv.executeJavaScript(`(function(){if(location.href!==${JSON.stringify(url)})return;var id=${JSON.stringify(id)};var m=Array.from(document.querySelectorAll('mark.vexhl')).find(el=>el.getAttribute('data-vexhl')===id);if(m){var p=m.parentNode;while(m.firstChild)p.insertBefore(m.firstChild,m);p.removeChild(m);p.normalize&&p.normalize();}})();`); } catch {}
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
      dot.style.cssText = 'position:absolute;top:4px;right:4px;min-width:14px;height:14px;border-radius:7px;background:var(--primary);color:#fff;font-size:9px;font-weight:700;display:grid;place-items:center;padding:0 3px';
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
      h.innerHTML = `<img src="https://${encodeURIComponent(host)}/favicon.ico" style="width:15px;height:15px;border-radius:3px" data-image-fallback="hide"><div style="flex:1;min-width:0;font-size:12.5px;font-weight:600;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(title)}</div><span style="font-size:10.5px;color:var(--text-muted)">${list.length}</span>`;
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
if (typeof module !== 'undefined' && module.exports) module.exports = { Annotations };

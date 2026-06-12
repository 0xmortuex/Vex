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
    this._badge();
  },
  save() { try { localStorage.setItem(this.KEY, JSON.stringify(this.store)); } catch {} this._badge(); },

  _key(url) { try { const u = new URL(url); return (u.origin + u.pathname).replace(/\/$/, ''); } catch { return url || ''; } },
  forUrl(url) { return this.store[this._key(url)] || []; },
  count() { return Object.values(this.store).reduce((n, a) => n + (a ? a.length : 0), 0); },

  // --- Apply all stored highlights for a page (called on dom-ready) ---
  applyTo(webview, url) {
    const list = this.forUrl(url);
    if (!list.length) return;
    const data = list.map(h => ({ id: h.id, text: h.text, color: this.COLORS[h.color] || this.COLORS.yellow, note: h.note || '' }));
    const js = `(function(){try{
      var hs=${JSON.stringify(data)};
      function wrap(node,start,len,h){
        var rng=document.createRange();rng.setStart(node,start);rng.setEnd(node,start+len);
        var m=document.createElement('mark');m.className='vexhl';m.setAttribute('data-vexhl',h.id);
        m.style.cssText='background:'+h.color+';color:inherit;border-radius:2px;padding:0 1px;box-decoration-break:clone';
        if(h.note){m.title='📝 '+h.note;m.style.cursor='help';m.style.boxShadow='inset 0 -2px 0 rgba(0,0,0,0.35)';}
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
    const id = 'hl' + Date.now().toString(36) + Math.floor(performance.now() % 1000);
    const hex = this.COLORS[color];
    const js = `(function(){try{
      var s=getSelection();if(!s||s.isCollapsed||!s.rangeCount)return '';
      var rng=s.getRangeAt(0);var text=s.toString();if(!text.trim())return '';
      var m=document.createElement('mark');m.className='vexhl';m.setAttribute('data-vexhl',${JSON.stringify(id)});
      m.style.cssText='background:${hex};color:inherit;border-radius:2px;padding:0 1px;box-decoration-break:clone';
      try{m.appendChild(rng.extractContents());rng.insertNode(m);}catch(e){return '';}
      s.removeAllRanges();return text.substring(0,2000);
    }catch(e){return ''}})();`;
    let text = '';
    try { text = await wv.executeJavaScript(js); } catch {}
    if (!text) { window.showToast?.('Select some text first'); return; }
    const k = this._key(t.url);
    if (!this.store[k]) this.store[k] = [];
    this.store[k].push({ id, text, color, note: '', at: Date.now(), title: t.title || t.url });
    this.save();
    window.showToast?.('🖍 Highlighted (' + this.forUrl(t.url).length + ' on this page)');
  },

  async remove(url, id) {
    const k = this._key(url);
    if (this.store[k]) { this.store[k] = this.store[k].filter(h => h.id !== id); if (!this.store[k].length) delete this.store[k]; this.save(); }
    const wv = WebviewManager.getActiveWebview();
    const t = TabManager.getActiveTab();
    if (wv && t && t.url === url) {
      try { await wv.executeJavaScript(`(function(){var m=document.querySelector('mark.vexhl[data-vexhl=${JSON.stringify(id)}]');if(m){var p=m.parentNode;while(m.firstChild)p.insertBefore(m.firstChild,m);p.removeChild(m);p.normalize&&p.normalize();}})();`); } catch {}
    }
  },

  async addNote(url, id) {
    const cur = (this.forUrl(url).find(h => h.id === id) || {}).note || '';
    const v = typeof vexPromptModal === 'function' ? await vexPromptModal('Note for this highlight', cur) : prompt('Note', cur);
    if (v === null) return;
    const k = this._key(url);
    const h = (this.store[k] || []).find(x => x.id === id);
    if (h) { h.note = v.trim(); this.save(); this.reapply(url); window.showToast?.('Note saved'); }
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
    const esc = (s) => { const d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML; };
    container.innerHTML = `<div class="panel-header"><h2>Highlights</h2></div>
      <p class="setting-info muted" style="padding:0 12px">Select text on any page, then <strong>Ctrl+K → Highlight</strong> (or right-click). Highlights reappear when you revisit the page.</p>
      <div id="an-body" style="padding:4px 10px 24px;overflow-y:auto;max-height:calc(100vh - 130px)"></div>`;
    const body = container.querySelector('#an-body');
    const pages = Object.keys(this.store).filter(k => this.store[k] && this.store[k].length);
    if (!pages.length) { body.innerHTML = '<div style="font-size:12px;color:var(--text-muted);padding:10px 8px">No highlights yet.</div>'; return; }
    // Most recently annotated page first.
    pages.sort((a, b) => Math.max(...this.store[b].map(h => h.at || 0)) - Math.max(...this.store[a].map(h => h.at || 0)));
    pages.forEach(k => {
      const list = this.store[k];
      const title = list[0].title || k;
      let host = k; try { host = new URL(list[0].url || k).hostname.replace(/^www\./, ''); } catch { try { host = new URL(k).hostname.replace(/^www\./, ''); } catch {} }
      const h = document.createElement('div');
      h.style.cssText = 'display:flex;align-items:center;gap:8px;padding:10px 6px 4px;cursor:pointer';
      h.innerHTML = `<img src="https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=32" style="width:15px;height:15px;border-radius:3px" onerror="this.style.visibility='hidden'"><div style="flex:1;min-width:0;font-size:12.5px;font-weight:600;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(title)}</div><span style="font-size:10.5px;color:var(--text-muted)">${list.length}</span>`;
      h.addEventListener('click', () => { SidebarManager.hideActivePanel?.(); TabManager.createTab(k, true); });
      body.appendChild(h);
      list.forEach(a => {
        const r = document.createElement('div');
        r.style.cssText = 'display:flex;gap:8px;padding:5px 6px 5px 10px;border-radius:7px';
        r.addEventListener('mouseenter', () => r.style.background = 'var(--surface)');
        r.addEventListener('mouseleave', () => r.style.background = '');
        r.innerHTML = `<span style="width:5px;border-radius:3px;background:${this.COLORS[a.color] || this.COLORS.yellow};flex:none"></span>
          <div style="flex:1;min-width:0"><div style="font-size:12px;color:var(--text);display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden">${esc(a.text)}</div>${a.note ? `<div style="font-size:11px;color:var(--text-muted);margin-top:2px">📝 ${esc(a.note)}</div>` : ''}</div>
          <button data-note title="Add/edit note" style="width:22px;height:22px;border:none;background:none;color:var(--text-muted);cursor:pointer;font-size:12px">📝</button>
          <button data-x title="Delete" style="width:22px;height:22px;border:none;background:none;color:var(--text-muted);cursor:pointer;font-size:13px">✕</button>`;
        r.querySelector('[data-note]').addEventListener('click', (e) => { e.stopPropagation(); this.addNote(list[0].url || k, a.id).then(() => this.renderPanel(container)); });
        r.querySelector('[data-x]').addEventListener('click', (e) => { e.stopPropagation(); this.remove(list[0].url || k, a.id).then(() => this.renderPanel(container)); });
        body.appendChild(r);
      });
    });
  },
};

if (typeof window !== 'undefined') window.Annotations = Annotations;
if (typeof module !== 'undefined' && module.exports) module.exports = { Annotations };

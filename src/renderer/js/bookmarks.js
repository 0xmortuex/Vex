// === Vex Bookmarks — star button + sidebar panel with folders ===
//
// Stored in localStorage 'vex.bookmarks' (synced via SyncEngine if its key
// list includes it). A ☆ button is injected into the URL bar; the Bookmarks
// sidebar panel lists entries grouped by folder with search, open, and delete.

const Bookmarks = {
  KEY: 'vex.bookmarks',
  items: [],

  init() {
    try { const a = JSON.parse(localStorage.getItem(this.KEY) || '[]'); this.items = Array.isArray(a) ? a : []; } catch { this.items = []; }
    this._injectStar();
  },
  save() { try { localStorage.setItem(this.KEY, JSON.stringify(this.items)); } catch {} this._syncStar(); },

  has(url) { return this.items.some(b => b.url === url); },

  toggle(url, title) {
    if (!url) return;
    if (this.has(url)) {
      this.items = this.items.filter(b => b.url !== url);
      window.showToast?.('Bookmark removed');
    } else {
      const folder = prompt('Save bookmark to folder (blank = Unsorted):', '') || '';
      this.items.unshift({ id: 'bm' + Date.now(), url, title: title || url, folder: folder.trim(), at: Date.now() });
      window.showToast?.('★ Bookmarked');
    }
    this.save();
  },

  _injectStar() {
    if (document.getElementById('btn-bookmark')) return;
    const anchor = document.getElementById('btn-copy-url');
    if (!anchor || !anchor.parentElement) return;
    const btn = document.createElement('button');
    btn.id = 'btn-bookmark';
    btn.className = 'nav-btn';
    btn.title = 'Bookmark this page';
    btn.style.cssText = 'width:24px;height:24px;flex-shrink:0';
    btn.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>';
    btn.addEventListener('click', () => {
      const t = TabManager.getActiveTab();
      if (t && t.url) this.toggle(t.url, t.title);
    });
    anchor.parentElement.insertBefore(btn, anchor);
    // Reflect starred state as the active tab changes.
    setInterval(() => this._syncStar(), 1500);
  },

  _syncStar() {
    const btn = document.getElementById('btn-bookmark');
    if (!btn) return;
    const t = typeof TabManager !== 'undefined' ? TabManager.getActiveTab() : null;
    const starred = !!(t && t.url && this.has(t.url));
    btn.style.color = starred ? 'var(--primary)' : '';
    btn.querySelector('svg').style.fill = starred ? 'currentColor' : 'none';
  },

  renderPanel(container) {
    if (!container) return;
    const esc = (s) => { const d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML; };
    container.innerHTML = `
      <div class="panel-header"><h2>Bookmarks</h2></div>
      <div style="padding:0 16px 10px"><input id="bm-search" type="text" placeholder="Search bookmarks…" style="width:100%;box-sizing:border-box;padding:9px 12px;background:var(--bg);border:1px solid var(--border);border-radius:8px;color:var(--text);font-size:13px;outline:none;font-family:'Outfit',sans-serif"></div>
      <div id="bm-list" style="padding:0 10px 20px;overflow-y:auto;max-height:calc(100vh - 160px)"></div>`;
    const list = container.querySelector('#bm-list');
    const paint = (q) => {
      q = (q || '').toLowerCase();
      list.innerHTML = '';
      const items = this.items.filter(b => !q || (b.title + ' ' + b.url + ' ' + b.folder).toLowerCase().includes(q));
      if (!items.length) { list.innerHTML = '<div style="text-align:center;color:var(--text-muted);font-size:13px;padding:30px 10px">No bookmarks yet — hit the ☆ in the URL bar.</div>'; return; }
      const folders = {};
      items.forEach(b => { const f = b.folder || 'Unsorted'; (folders[f] = folders[f] || []).push(b); });
      Object.keys(folders).sort().forEach(f => {
        const head = document.createElement('div');
        head.style.cssText = 'font-size:11px;text-transform:uppercase;letter-spacing:0.05em;color:var(--text-muted);font-weight:700;padding:12px 8px 4px';
        head.textContent = '📁 ' + f;
        list.appendChild(head);
        folders[f].forEach(b => {
          const row = document.createElement('div');
          row.style.cssText = 'display:flex;align-items:center;gap:9px;padding:7px 8px;border-radius:8px;cursor:pointer';
          row.addEventListener('mouseenter', () => row.style.background = 'var(--surface)');
          row.addEventListener('mouseleave', () => row.style.background = '');
          let hostTxt = b.url; try { hostTxt = new URL(b.url).hostname.replace(/^www\./, ''); } catch {}
          row.innerHTML = `
            <img src="https://www.google.com/s2/favicons?domain=${encodeURIComponent(hostTxt)}&sz=32" style="width:16px;height:16px;border-radius:4px" onerror="this.style.visibility='hidden'">
            <div style="flex:1;min-width:0"><div style="font-size:12.5px;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(b.title)}</div><div style="font-size:10.5px;color:var(--text-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(hostTxt)}</div></div>
            <button data-del style="width:22px;height:22px;border:none;background:none;color:var(--text-muted);cursor:pointer;border-radius:5px;font-size:13px">✕</button>`;
          row.addEventListener('click', (e) => { if (e.target.closest('[data-del]')) return; SidebarManager.hideActivePanel?.(); TabManager.createTab(b.url, true); });
          row.querySelector('[data-del]').addEventListener('click', (e) => { e.stopPropagation(); this.items = this.items.filter(x => x.id !== b.id); this.save(); paint(q); });
          list.appendChild(row);
        });
      });
    };
    paint('');
    container.querySelector('#bm-search').addEventListener('input', (e) => paint(e.target.value));
  },
};

if (typeof window !== 'undefined') window.Bookmarks = Bookmarks;
if (typeof module !== 'undefined' && module.exports) module.exports = { Bookmarks };

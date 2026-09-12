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
    this._baseline = this.items.slice();
    this._injectStar();
  },
  // Write only what THIS window changed, so a second window's bookmarks are
  // not erased by our stale in-memory snapshot (see collection-store.js).
  save() {
    this.items = window.CollectionStore.save(this.KEY, this._baseline, this.items);
    this._baseline = this.items.slice();
    this._syncStar();
  },

  has(url) { return this.items.some(b => b.url === url); },

  async toggle(url, title) {
    if (!url) return;
    if (this.has(url)) {
      this.items = this.items.filter(b => b.url !== url);
      window.showToast?.('Bookmark removed');
    } else {
      // Native prompt() is disabled in Electron's renderer (always returned
      // null here, silently skipping the folder question) — use the in-app
      // prompt. Cancel still bookmarks, just into Unsorted.
      const folder = await vexPrompt({ title: 'Bookmark this page', label: 'Folder (blank = Unsorted)', okLabel: 'Bookmark' }) || '';
      this.items.unshift({ id: vexId('bm'), url, title: title || url, folder: folder.trim(), at: Date.now() });
      window.showToast?.('Bookmarked');
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
    // Reflect starred state as the active tab changes. The old code polled every
    // 1.5s forever; react to the events that can change it instead, with a slow
    // backstop for anything that changes the URL without firing one.
    window.addEventListener('vex-tabs-changed', () => this._syncStar());
    if (!this._starTimer) this._starTimer = setInterval(() => this._syncStar(), 5000);
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
    const esc = (s) => window.escapeHtml(s);
    container.innerHTML = `
      <div class="panel-header"><h2>Bookmarks</h2></div>
      <div style="padding:0 16px 10px"><input id="bm-search" type="text" placeholder="Search bookmarks…" style="width:100%;box-sizing:border-box;padding:9px 12px;background:var(--bg);border:1px solid var(--border);border-radius:8px;color:var(--text);font-size:13px;outline:none;font-family:'Outfit',sans-serif"></div>
      <div id="bm-list" style="padding:0 10px 20px;overflow-y:auto;max-height:calc(100vh - 160px)"></div>`;
    const list = container.querySelector('#bm-list');
    const paint = (q) => {
      list._virtualDispose?.();
      q = (q || '').toLowerCase();
      list.innerHTML = '';
      const items = this.items.filter(b => !q || (b.title + ' ' + b.url + ' ' + b.folder).toLowerCase().includes(q));
      if (items.length > 150 && window.VexVirtualList) {
        window.VexVirtualList.mount(list, items, item => {
          const row = document.createElement('div'); row.style.cssText = 'display:flex;align-items:center;gap:8px;padding:8px';
          const link = document.createElement('button'); link.style.cssText = 'flex:1;min-width:0;text-align:left;background:none;color:var(--text);border:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
          link.textContent = (item.folder || 'Unsorted') + ' · ' + (item.title || item.url); link.title = item.url;
          link.addEventListener('click', () => { SidebarManager.hideActivePanel?.(); TabManager.createTab(item.url, true); });
          const remove = document.createElement('button'); remove.textContent = '×'; remove.setAttribute('aria-label', 'Delete bookmark');
          remove.addEventListener('click', () => { this.items = this.items.filter(b => b.id !== item.id); this.save(); paint(q); });
          row.append(link, remove); return row;
        });
        return;
      }
      if (!items.length) { list.innerHTML = window.VexUI ? VexUI.emptyState('bookmark', 'No bookmarks yet', 'Use the bookmark button in the URL bar to save a page') : '<div style="text-align:center;color:var(--text-muted);font-size:13px;padding:30px 10px">No bookmarks yet — use the bookmark button in the URL bar.</div>'; return; }
      const folders = {};
      items.forEach(b => { const f = b.folder || 'Unsorted'; (folders[f] = folders[f] || []).push(b); });
      Object.keys(folders).sort().forEach(f => {
        const head = document.createElement('div');
        head.style.cssText = 'font-size:11px;text-transform:uppercase;letter-spacing:0.05em;color:var(--text-muted);font-weight:700;padding:12px 8px 4px;display:flex;align-items:center;gap:6px';
        head.innerHTML = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" style="flex:none"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>';
        head.appendChild(document.createTextNode(f));
        list.appendChild(head);
        folders[f].forEach(b => {
          const row = document.createElement('div');
          row.style.cssText = 'display:flex;align-items:center;gap:9px;padding:7px 8px;border-radius:8px;cursor:pointer';
          row.addEventListener('mouseenter', () => row.style.background = 'var(--surface)');
          row.addEventListener('mouseleave', () => row.style.background = '');
          let hostTxt = b.url; try { hostTxt = new URL(b.url).hostname.replace(/^www\./, ''); } catch {}
          row.innerHTML = `
            <img src="https://${encodeURIComponent(hostTxt)}/favicon.ico" style="width:16px;height:16px;border-radius:4px" data-image-fallback="hide">
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
if (typeof window !== 'undefined') window.addEventListener('vex-sync-data-applied', () => {
  // Corrupt storage here used to throw straight out of the sync listener and
  // abort the rest of the post-sync refresh.
  let saved = [];
  try { saved = JSON.parse(localStorage.getItem(Bookmarks.KEY) || '[]'); }
  catch (err) { console.error('[Bookmarks] stored list was unreadable after sync:', err.message); }
  Bookmarks.items = Array.isArray(saved) ? saved : [];
  Bookmarks._baseline = Bookmarks.items.slice();
  Bookmarks._syncStar();
  const list = document.getElementById('bm-list');
  if (list) {
    list._virtualDispose?.();
    Bookmarks.renderPanel(list.parentElement);
  }
});
if (typeof module !== 'undefined' && module.exports) module.exports = { Bookmarks };

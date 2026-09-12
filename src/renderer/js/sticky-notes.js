// === Vex Sticky Notes: a freeform notepad pinned to a page ===
//
// Distinct from Annotations (which highlights selected TEXT inside the page and
// re-applies it on revisit). A Sticky Note is a small draggable notepad card
// that floats over the Vex UI and is tied to the CURRENT page's URL (host+path,
// normalized — query/hash/trailing-slash stripped). Autosaves, debounced.
//
// Storage: localStorage 'vex.stickyNotes' = { [normUrl]: { text, updated, url, title } }
// `url`/`title` were added so "open the page again" can use the REAL address
// (a file:// or http:// sticky used to be reopened as 'https://' + key, which
// navigated somewhere that does not exist). Legacy entries without them still
// work — pageUrlFor() falls back to the old behaviour.
//
// The Notes panel (js/notes-panel.js) is the primary UI for browsing and
// editing these; it reads getAll() and listens for 'vex-sticky-notes-changed'.
const StickyNotes = {
  KEY: 'vex.stickyNotes',

  _load() { try { const s = JSON.parse(localStorage.getItem(this.KEY) || '{}'); return (s && typeof s === 'object' && !Array.isArray(s)) ? s : {}; } catch { return {}; } },
  _save(store) {
    try { localStorage.setItem(this.KEY, JSON.stringify(store)); } catch {}
    try { window.dispatchEvent(new CustomEvent('vex-sticky-notes-changed')); } catch {}
  },

  _esc(s) { return (typeof window !== 'undefined' && window.escapeHtml) ? window.escapeHtml(s) : String(s ?? ''); },

  // Small stroke icons — no emoji anywhere in the UI.
  _icon(name, size = 13) {
    const p = {
      sticky: '<path d="M14 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h8l6-6V5a2 2 0 0 0-2-2z"/><path d="M19 15h-4a2 2 0 0 0-2 2v4"/>',
      list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
      close: '<path d="M18 6 6 18M6 6l12 12"/>',
      trash: '<path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>',
      open: '<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><path d="M15 3h6v6"/><path d="M10 14 21 3"/>',
    }[name] || '';
    return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`;
  },

  // host+path only, so ?utm=… / #frag / a trailing slash don't fork the note.
  _norm(url) {
    const raw = String(url || '').trim();
    if (!raw) return '';
    try {
      const u = new URL(raw);
      if (u.protocol === 'file:') return 'file:' + u.pathname.replace(/\/+$/, '');
      if (u.protocol !== 'http:' && u.protocol !== 'https:') {
        return (u.protocol + (u.hostname || '') + u.pathname).replace(/\/+$/, '') || raw;
      }
      const host = u.hostname.replace(/^www\./, '');
      const p = (host + u.pathname).replace(/\/+$/, '');
      return p || host;
    } catch { return raw; }
  },

  _activeUrl() { try { return (TabManager.getActiveTab() || {}).url || ''; } catch { return ''; } },
  _activeTitle() { try { return (TabManager.getActiveTab() || {}).title || ''; } catch { return ''; } },

  hasNote(url) {
    const key = this._norm(url || this._activeUrl());
    const n = this._load()[key];
    return !!(n && n.text && n.text.trim());
  },

  // --- Read/write API used by the Notes panel -----------------------------

  // Every page that has a sticky note, newest first.
  getAll() {
    const store = this._load();
    return Object.keys(store)
      .filter(k => store[k] && typeof store[k].text === 'string' && store[k].text.trim())
      .map(k => ({
        key: k,
        text: store[k].text,
        updated: Number(store[k].updated) || 0,
        url: typeof store[k].url === 'string' ? store[k].url : '',
        title: typeof store[k].title === 'string' ? store[k].title : '',
      }))
      .sort((a, b) => b.updated - a.updated);
  },

  get(key) { return this.getAll().find(n => n.key === key) || null; },

  // Writing an empty string deletes the note — an empty sticky is no sticky.
  setText(key, text, meta) {
    if (!key) return false;
    const store = this._load();
    if (String(text || '').trim()) {
      const prev = store[key] || {};
      store[key] = {
        text: String(text),
        updated: Date.now(),
        url: (meta && meta.url) || prev.url || '',
        title: (meta && meta.title) || prev.title || '',
      };
    } else if (!store[key]) {
      return false;
    } else {
      delete store[key];
    }
    this._save(store);
    return true;
  },

  remove(key) {
    const store = this._load();
    if (!(key in store)) return false;
    delete store[key];
    this._save(store);
    return true;
  },

  // The address to revisit. Prefer the URL we recorded; fall back to the
  // pre-2.31 behaviour of assuming https for bare host+path keys.
  pageUrlFor(entry) {
    if (entry && entry.url) return entry.url;
    const key = typeof entry === 'string' ? entry : (entry && entry.key) || '';
    if (!key) return '';
    if (/^[a-z][a-z0-9+.-]*:/i.test(key)) return key;
    return 'https://' + key;
  },

  // --- The floating sticky card for the current page ---
  open(explicitKey) {
    const url = this._activeUrl();
    const key = explicitKey || this._norm(url);
    if (!key) { try { window.showToast?.('Open a page to add a note'); } catch {} return; }

    // Re-opening must not throw away what is sitting in the open card: flush
    // its pending debounce before the old card is destroyed.
    this.flush();
    document.getElementById('vex-sticky')?.remove();
    this._injectStyles();
    const store = this._load();
    const existing = store[key] || { text: '' };
    const meta = explicitKey ? { url: (store[key] || {}).url || '', title: (store[key] || {}).title || '' }
      : { url, title: this._activeTitle() };

    const card = document.createElement('div');
    card.id = 'vex-sticky';
    card.className = 'vex-sticky-card';
    card.innerHTML = `
      <div class="vsn-bar">
        <span class="vsn-ico">${this._icon('sticky', 13)}</span>
        <span class="vsn-title" title="${this._esc(key)}">${this._esc(key.slice(0, 34))}</span>
        <button class="vsn-btn vsn-list" title="All sticky notes">${this._icon('list', 13)}</button>
        <button class="vsn-btn vsn-close" title="Close">${this._icon('close', 13)}</button>
      </div>
      <textarea class="vsn-text" placeholder="Note for this page…" spellcheck="false">${this._esc(existing.text || '')}</textarea>
      <div class="vsn-foot"><span class="vsn-status"></span></div>`;
    document.body.appendChild(card);

    // Restore last position (per-session convenience), else default corner.
    let pos = null; try { pos = JSON.parse(localStorage.getItem('vex.stickyPos') || 'null'); } catch {}
    if (pos && Number.isFinite(pos.x) && Number.isFinite(pos.y)) { card.style.left = pos.x + 'px'; card.style.top = pos.y + 'px'; card.style.right = 'auto'; card.style.bottom = 'auto'; }

    const ta = card.querySelector('.vsn-text');
    const status = card.querySelector('.vsn-status');
    ta.focus();

    const persist = () => {
      clearTimeout(this._timer);
      this._timer = null;
      this.setText(key, ta.value, meta);
      try { if (status && status.isConnected) { status.textContent = 'Saved'; setTimeout(() => { if (status.isConnected) status.textContent = ''; }, 900); } } catch {}
    };
    this._pendingPersist = persist;
    ta.addEventListener('input', () => { clearTimeout(this._timer); this._timer = setTimeout(persist, 500); });

    const closeCard = (then) => { persist(); this._pendingPersist = null; card.remove(); if (then) then(); };
    card.querySelector('.vsn-close').addEventListener('click', () => closeCard());
    card.querySelector('.vsn-list').addEventListener('click', () => closeCard(() => this.list()));

    // Drag by the title bar.
    const bar = card.querySelector('.vsn-bar');
    let drag = null;
    bar.addEventListener('mousedown', (e) => {
      if (e.target.closest('.vsn-btn')) return;
      const r = card.getBoundingClientRect();
      drag = { dx: e.clientX - r.left, dy: e.clientY - r.top };
      e.preventDefault();
    });
    const onMove = (e) => {
      if (!drag) return;
      const x = Math.max(0, Math.min(window.innerWidth - 80, e.clientX - drag.dx));
      const y = Math.max(0, Math.min(window.innerHeight - 40, e.clientY - drag.dy));
      card.style.left = x + 'px'; card.style.top = y + 'px'; card.style.right = 'auto'; card.style.bottom = 'auto';
    };
    const onUp = () => { if (drag) { try { const r = card.getBoundingClientRect(); localStorage.setItem('vex.stickyPos', JSON.stringify({ x: r.left, y: r.top })); } catch {} } drag = null; };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    card._cleanup = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      if (this._pendingPersist === persist) this._pendingPersist = null;
    };
    const origRemove = card.remove.bind(card);
    card.remove = () => { try { card._cleanup(); } catch {} origRemove(); };
    return card;
  },

  // Write out whatever the open card is holding. Safe to call any time.
  flush() {
    const p = this._pendingPersist;
    clearTimeout(this._timer);
    this._timer = null;
    if (typeof p === 'function') { try { p(); } catch {} }
  },

  // --- Every page with a sticky note ---
  // The Notes panel owns this view now; the modal remains as the fallback for
  // contexts where the panel is unavailable.
  list() {
    if (typeof window !== 'undefined' && window.NotesPanel && typeof window.NotesPanel.openStickySection === 'function') {
      if (window.NotesPanel.openStickySection()) return;
    }
    this._listModal();
  },

  _listModal() {
    document.getElementById('vex-sticky-list')?.remove();
    this._injectStyles();
    const esc = (s) => this._esc(s);
    const rows = this.getAll();

    const m = document.createElement('div');
    m.id = 'vex-sticky-list';
    m.style.cssText = 'position:fixed;inset:0;z-index:100050;background:rgba(0,0,0,0.55);display:flex;align-items:center;justify-content:center';
    m.innerHTML = `<div style="width:520px;max-width:95vw;max-height:82vh;display:flex;flex-direction:column;background:var(--surface);border:1px solid var(--border);border-radius:14px;box-shadow:0 24px 60px rgba(0,0,0,0.5)">
      <div style="display:flex;align-items:center;gap:8px;padding:16px 20px 10px">
        <span style="display:flex;align-items:center;gap:7px;font-size:15px;font-weight:700;color:var(--text);flex:1">${this._icon('sticky', 15)} Sticky Notes <span style="font-size:11px;color:var(--text-muted);font-weight:400">· ${rows.length}</span></span>
        <button id="vsl-close" title="Close" style="display:flex;align-items:center;padding:6px 10px;background:var(--bg);color:var(--text);border:1px solid var(--border);border-radius:7px;cursor:pointer">${this._icon('close', 13)}</button>
      </div>
      <div id="vsl-body" style="overflow-y:auto;padding:4px 20px 20px;font-size:12.5px;color:var(--text)">${rows.length ? rows.map(n => `
        <div data-key="${esc(n.key)}" style="display:flex;align-items:center;gap:10px;padding:9px 10px;border:1px solid var(--border);border-radius:9px;margin-bottom:6px;background:var(--bg)">
          <span style="flex:1;min-width:0">
            <span style="display:block;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(n.title || n.key)}</span>
            <span style="display:block;color:var(--text-muted);font-size:11.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(n.text.replace(/\s+/g, ' ').slice(0, 70))}</span>
          </span>
          <button data-act="open" title="Open the page" style="display:flex;align-items:center;padding:5px 9px;background:var(--surface);color:var(--text);border:1px solid var(--border);border-radius:7px;cursor:pointer">${this._icon('open', 12)}</button>
          <button data-act="del" title="Delete" style="display:flex;align-items:center;padding:5px 9px;background:var(--surface);color:var(--text);border:1px solid var(--border);border-radius:7px;cursor:pointer">${this._icon('trash', 12)}</button>
        </div>`).join('') : '<div style="color:var(--text-muted);padding:12px 0">No sticky notes yet. Open a page and add one.</div>'}</div></div>`;
    document.body.appendChild(m);
    m.addEventListener('click', (e) => { if (e.target === m) m.remove(); });
    m.querySelector('#vsl-close').addEventListener('click', () => m.remove());
    m.querySelectorAll('#vsl-body [data-key]').forEach(row => {
      const key = row.dataset.key;
      row.querySelector('[data-act="open"]').addEventListener('click', () => {
        m.remove();
        this.openPage(key);
      });
      row.querySelector('[data-act="del"]').addEventListener('click', () => {
        this.remove(key);
        row.remove();
        try { window.showToast?.('Note deleted'); } catch {}
      });
    });
  },

  // Navigate to the page a sticky belongs to, then show its card.
  openPage(key) {
    const entry = this.get(key);
    const url = this.pageUrlFor(entry || key);
    if (!url) return;
    try { TabManager.createTab(url, true); } catch {}
    // Open the note a beat after the tab activates so it targets the new page.
    setTimeout(() => { try { this.open(key); } catch {} }, 700);
  },

  _injectStyles() {
    if (document.getElementById('vex-sticky-styles')) return;
    const st = document.createElement('style');
    st.id = 'vex-sticky-styles';
    st.textContent = `
      .vex-sticky-card{position:fixed;right:22px;bottom:22px;width:260px;height:220px;z-index:100060;display:flex;flex-direction:column;
        background:#fff7cc;color:#2b2b1e;border:1px solid #e6d98a;border-radius:12px;box-shadow:0 16px 44px rgba(0,0,0,0.4);overflow:hidden;font-family:'Outfit',sans-serif;}
      .vex-sticky-card .vsn-bar{display:flex;align-items:center;gap:6px;padding:7px 9px;background:#ffec99;border-bottom:1px solid #e6d98a;cursor:move;}
      .vex-sticky-card .vsn-ico{display:flex;align-items:center;color:#5a5326;}
      .vex-sticky-card .vsn-title{flex:1;font-size:11.5px;font-weight:700;color:#5a5326;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;}
      .vex-sticky-card .vsn-btn{display:flex;align-items:center;justify-content:center;border:none;background:transparent;color:#5a5326;cursor:pointer;width:20px;height:20px;border-radius:5px;line-height:1;padding:0;}
      .vex-sticky-card .vsn-btn:hover{background:rgba(0,0,0,0.08);}
      .vex-sticky-card .vsn-text{flex:1;border:none;outline:none;resize:none;background:transparent;color:#2b2b1e;font-size:13px;line-height:1.45;padding:10px 11px;font-family:'Outfit',sans-serif;}
      .vex-sticky-card .vsn-text::placeholder{color:#9a915a;}
      .vex-sticky-card .vsn-foot{padding:2px 11px 7px;min-height:14px;}
      .vex-sticky-card .vsn-status{font-size:10.5px;color:#8a8250;}
    `;
    document.head.appendChild(st);
  },
};

if (typeof window !== 'undefined') {
  window.StickyNotes = StickyNotes;
  // A sticky left half-typed when the window goes away is still a lost note.
  window.addEventListener('beforeunload', () => StickyNotes.flush());
}
if (typeof module !== 'undefined' && module.exports) module.exports = { StickyNotes };

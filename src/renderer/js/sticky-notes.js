// === Vex Sticky Notes: a freeform notepad pinned to a page ===
//
// Distinct from Annotations (which highlights selected TEXT inside the page and
// re-applies it on revisit). A Sticky Note is a small draggable notepad card
// that floats over the Vex UI and is tied to the CURRENT page's URL (host+path,
// normalized — query/hash/trailing-slash stripped). Autosaves, debounced.
// Storage: localStorage 'vex.stickyNotes' = { [normUrl]: { text, updated } }.
const StickyNotes = {
  KEY: 'vex.stickyNotes',

  _load() { try { const s = JSON.parse(localStorage.getItem(this.KEY) || '{}'); return (s && typeof s === 'object') ? s : {}; } catch { return {}; } },
  _save(store) { try { localStorage.setItem(this.KEY, JSON.stringify(store)); } catch {} },

  // host+path only, so ?utm=… / #frag / a trailing slash don't fork the note.
  _norm(url) {
    try {
      const u = new URL(url);
      let p = (u.hostname.replace(/^www\./, '') + u.pathname).replace(/\/+$/, '');
      return p || u.hostname.replace(/^www\./, '');
    } catch { return String(url || '').trim(); }
  },

  _activeUrl() { try { const t = TabManager.getActiveTab(); return (t && t.url) || ''; } catch { return ''; } },

  hasNote(url) {
    const key = this._norm(url || this._activeUrl());
    const n = this._load()[key];
    return !!(n && n.text && n.text.trim());
  },

  // --- The floating sticky card for the current page ---
  open() {
    const url = this._activeUrl();
    if (!/^https?:/i.test(url) && !/^file:/i.test(url) && !/^vex:/i.test(url)) {
      // Still allow it, but a real page is the normal case.
    }
    const key = this._norm(url);
    if (!key) { try { window.showToast?.('Open a page to add a note'); } catch {} return; }

    document.getElementById('vex-sticky')?.remove();
    this._injectStyles();
    const store = this._load();
    const existing = store[key] || { text: '', updated: 0 };

    const card = document.createElement('div');
    card.id = 'vex-sticky';
    card.className = 'vex-sticky-card';
    card.innerHTML = `
      <div class="vsn-bar">
        <span class="vsn-title" title="${window.escapeHtml ? window.escapeHtml(key) : key}">📝 ${window.escapeHtml ? window.escapeHtml(key.slice(0, 30)) : key.slice(0, 30)}</span>
        <button class="vsn-btn vsn-list" title="All sticky notes">≡</button>
        <button class="vsn-btn vsn-close" title="Close">✕</button>
      </div>
      <textarea class="vsn-text" placeholder="Note for this page…" spellcheck="false">${window.escapeHtml ? window.escapeHtml(existing.text || '') : (existing.text || '')}</textarea>
      <div class="vsn-foot"><span class="vsn-status"></span></div>`;
    document.body.appendChild(card);

    // Restore last position (per-session convenience), else default corner.
    let pos = null; try { pos = JSON.parse(localStorage.getItem('vex.stickyPos') || 'null'); } catch {}
    if (pos && Number.isFinite(pos.x) && Number.isFinite(pos.y)) { card.style.left = pos.x + 'px'; card.style.top = pos.y + 'px'; card.style.right = 'auto'; card.style.bottom = 'auto'; }

    const ta = card.querySelector('.vsn-text');
    const status = card.querySelector('.vsn-status');
    ta.focus();

    let timer = null;
    const persist = () => {
      const s = this._load();
      const text = ta.value;
      if (text.trim()) { s[key] = { text, updated: Date.now() }; }
      else { delete s[key]; }               // empty note = no note
      this._save(s);
      try { if (status) { status.textContent = 'Saved'; setTimeout(() => { if (status) status.textContent = ''; }, 900); } } catch {}
    };
    ta.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(persist, 500); });

    card.querySelector('.vsn-close').addEventListener('click', () => { clearTimeout(timer); persist(); card.remove(); });
    card.querySelector('.vsn-list').addEventListener('click', () => { clearTimeout(timer); persist(); card.remove(); this.list(); });

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
    card._cleanup = () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); };
    const origRemove = card.remove.bind(card);
    card.remove = () => { try { card._cleanup(); } catch {} origRemove(); };
  },

  // --- Modal listing every page that has a sticky note ---
  list() {
    document.getElementById('vex-sticky-list')?.remove();
    this._injectStyles();
    const esc = (s) => window.escapeHtml ? window.escapeHtml(String(s || '')) : String(s || '');
    const store = this._load();
    const rows = Object.keys(store)
      .filter(k => store[k] && store[k].text && store[k].text.trim())
      .sort((a, b) => (store[b].updated || 0) - (store[a].updated || 0));

    const m = document.createElement('div');
    m.id = 'vex-sticky-list';
    m.style.cssText = 'position:fixed;inset:0;z-index:100050;background:rgba(0,0,0,0.55);display:flex;align-items:center;justify-content:center';
    m.innerHTML = `<div style="width:520px;max-width:95vw;max-height:82vh;display:flex;flex-direction:column;background:var(--surface);border:1px solid var(--border);border-radius:14px;box-shadow:0 24px 60px rgba(0,0,0,0.5)">
      <div style="display:flex;align-items:center;gap:8px;padding:16px 20px 10px">
        <span style="font-size:15px;font-weight:700;color:var(--text);flex:1">📝 Sticky Notes <span style="font-size:11px;color:var(--text-muted);font-weight:400">· ${rows.length}</span></span>
        <button id="vsl-close" style="padding:6px 10px;background:var(--bg);color:var(--text);border:1px solid var(--border);border-radius:7px;cursor:pointer;font-size:12px;font-family:'Outfit',sans-serif">✕</button>
      </div>
      <div id="vsl-body" style="overflow-y:auto;padding:4px 20px 20px;font-size:12.5px;color:var(--text)">${rows.length ? rows.map(k => `
        <div data-key="${esc(k)}" style="display:flex;align-items:center;gap:10px;padding:9px 10px;border:1px solid var(--border);border-radius:9px;margin-bottom:6px;background:var(--bg)">
          <span style="flex:1;min-width:0">
            <span style="display:block;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(k)}</span>
            <span style="display:block;color:var(--text-muted);font-size:11.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc((store[k].text || '').replace(/\s+/g, ' ').slice(0, 70))}</span>
          </span>
          <button data-act="open" style="padding:5px 9px;background:var(--surface);color:var(--text);border:1px solid var(--border);border-radius:7px;cursor:pointer;font-size:11.5px;font-family:'Outfit',sans-serif">Open</button>
          <button data-act="del" title="Delete" style="padding:5px 9px;background:var(--surface);color:var(--text);border:1px solid var(--border);border-radius:7px;cursor:pointer;font-size:11.5px;font-family:'Outfit',sans-serif">🗑</button>
        </div>`).join('') : '<div style="color:var(--text-muted);padding:12px 0">No sticky notes yet. Open a page and add one.</div>'}</div></div>`;
    document.body.appendChild(m);
    m.addEventListener('click', (e) => { if (e.target === m) m.remove(); });
    m.querySelector('#vsl-close').addEventListener('click', () => m.remove());
    m.querySelectorAll('#vsl-body [data-key]').forEach(row => {
      const key = row.dataset.key;
      row.querySelector('[data-act="open"]').addEventListener('click', () => {
        m.remove();
        try { TabManager.createTab('https://' + key, true); } catch {}
        // Open the note a beat after the tab activates so it targets the new page.
        setTimeout(() => { try { this.open(); } catch {} }, 700);
      });
      row.querySelector('[data-act="del"]').addEventListener('click', () => {
        const s = this._load(); delete s[key]; this._save(s);
        row.remove();
        try { window.showToast?.('Note deleted'); } catch {}
      });
    });
  },

  _injectStyles() {
    if (document.getElementById('vex-sticky-styles')) return;
    const st = document.createElement('style');
    st.id = 'vex-sticky-styles';
    st.textContent = `
      .vex-sticky-card{position:fixed;right:22px;bottom:22px;width:260px;height:220px;z-index:100060;display:flex;flex-direction:column;
        background:#fff7cc;color:#2b2b1e;border:1px solid #e6d98a;border-radius:12px;box-shadow:0 16px 44px rgba(0,0,0,0.4);overflow:hidden;font-family:'Outfit',sans-serif;}
      .vex-sticky-card .vsn-bar{display:flex;align-items:center;gap:6px;padding:7px 9px;background:#ffec99;border-bottom:1px solid #e6d98a;cursor:move;}
      .vex-sticky-card .vsn-title{flex:1;font-size:11.5px;font-weight:700;color:#5a5326;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;}
      .vex-sticky-card .vsn-btn{border:none;background:transparent;color:#5a5326;font-size:12px;cursor:pointer;width:20px;height:20px;border-radius:5px;line-height:1;}
      .vex-sticky-card .vsn-btn:hover{background:rgba(0,0,0,0.08);}
      .vex-sticky-card .vsn-text{flex:1;border:none;outline:none;resize:none;background:transparent;color:#2b2b1e;font-size:13px;line-height:1.45;padding:10px 11px;font-family:'Outfit',sans-serif;}
      .vex-sticky-card .vsn-text::placeholder{color:#9a915a;}
      .vex-sticky-card .vsn-foot{padding:2px 11px 7px;min-height:14px;}
      .vex-sticky-card .vsn-status{font-size:10.5px;color:#8a8250;}
    `;
    document.head.appendChild(st);
  },
};

if (typeof window !== 'undefined') window.StickyNotes = StickyNotes;
if (typeof module !== 'undefined' && module.exports) module.exports = { StickyNotes };

// === Search the open tabs (T1-004) ============================================
//
// Ctrl+K searches everything and is not a list of tabs. This is one: every
// open tab, the one you used last first, narrowed as you type by title and
// address. Enter goes to it, Delete closes it (with nothing typed, or with
// Shift), arrows move, Escape puts you back where you were. Pinned, sleeping,
// playing and muted tabs and the group a tab is in are marked.
//
// Ctrl+Alt+Z (Ctrl+Shift+A, the key Chrome uses, is the AI panel here). Also
// "Search open tabs" in Ctrl+K. Matching is Turkish-correct (js/vex-tr.js):
// "istanbul" finds "İstanbul", "sisli" finds "Şişli".
const VexTabSearch = {
  KEY: 'vex.tabSearch',            // '0' = off
  _el: null,
  _state: null,                    // { all, shown, idx, back }

  enabled() { return localStorage.getItem(this.KEY) !== '0'; },
  setEnabled(on) {
    localStorage.setItem(this.KEY, on ? '1' : '0');
    if (!on) this.close();
  },

  // ---- ranking (pure) ----------------------------------------------------------
  // `rows`: VexTabMru.describe() results, most recently used first.
  // → the rows that match, best first; equal scores keep the recency order.
  rank(rows, query) {
    const q = String(query == null ? '' : query).trim();
    if (!q) return rows.slice();
    const tr = globalThis.VexTr || require('./vex-tr.js').VexTr;
    const scored = [];
    rows.forEach((row, at) => {
      const s = Math.max(
        tr.score(q, row.title),
        tr.score(q, row.host) * 0.9,
        tr.score(q, row.title + ' ' + row.url, { fuzzy: false }) * 0.8,
        row.group ? tr.score(q, row.group) * 0.5 : 0,
      );
      if (s > 0) scored.push({ row, s, at });
    });
    scored.sort((a, b) => (b.s - a.s) || (a.at - b.at));
    return scored.map(e => e.row);
  },

  // ---- the popover -------------------------------------------------------------
  isOpen() { return !!this._el; },

  open() {
    if (!this.enabled()) { window.showToast?.('Tab search is switched off in Settings', 'info', 3000); return false; }
    if (this._el) { this._el.querySelector('input').focus(); return true; }
    const tabMru = typeof VexTabMru !== 'undefined' ? VexTabMru : require('./tab-mru.js').VexTabMru;
    const all = tabMru.list().map(t => tabMru.describe(t));
    const active = document.activeElement;
    this._state = { all, shown: all, idx: 0, back: active && active !== document.body ? active : null };
    const el = document.createElement('div');
    el.id = 'tab-search';
    el.className = 'tt-overlay tt-search';
    el.innerHTML = '<div class="tt-card" role="dialog" aria-modal="true" aria-label="Search open tabs">'
      + '<input class="tt-input" type="text" role="combobox" aria-expanded="true" aria-controls="tab-search-list" aria-autocomplete="list" placeholder="Search open tabs" spellcheck="false" autocomplete="off" aria-label="Search open tabs">'
      + '<ul class="tt-list" id="tab-search-list" role="listbox" aria-label="Open tabs"></ul>'
      + '<div class="tt-hint">Enter to go, Delete to close the tab, Esc to cancel</div>'
      + '<div class="tt-sr" role="status" aria-live="polite"></div></div>';
    document.body.appendChild(el);
    this._el = el;
    const input = el.querySelector('input');
    input.addEventListener('input', () => this._filter(input.value));
    el.addEventListener('keydown', (e) => this._key(e));
    el.addEventListener('mousedown', (e) => { if (e.target === el) { e.preventDefault(); this.close(); } });
    this._draw();
    input.focus();
    return true;
  },

  close() {
    const el = this._el, st = this._state;
    this._el = null; this._state = null;
    if (el) el.remove();
    if (st && st.back && st.back.isConnected) { try { st.back.focus(); } catch (err) { console.error('[TabSearch] could not give the focus back:', err); } }
  },

  _filter(text) {
    const st = this._state;
    st.shown = this.rank(st.all, text);
    st.idx = 0;
    this._draw();
  },

  _go(row) {
    this.close();
    if (row && typeof TabManager !== 'undefined' && TabManager.tabs.some(t => t.id === row.id)) TabManager.switchTab(row.id);
  },

  _closeRow() {
    const st = this._state;
    const row = st.shown[st.idx];
    if (!row) return;
    TabManager.closeTab(row.id);
    st.all = st.all.filter(r => r.id !== row.id);
    st.shown = st.shown.filter(r => r.id !== row.id);
    st.idx = Math.min(st.idx, Math.max(0, st.shown.length - 1));
    this._draw();
  },

  _key(e) {
    const st = this._state;
    if (!st) return;
    const input = this._el.querySelector('input');
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); this.close(); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); if (st.shown.length) st.idx = (st.idx + 1) % st.shown.length; this._draw(); return; }
    if (e.key === 'ArrowUp') { e.preventDefault(); if (st.shown.length) st.idx = (st.idx - 1 + st.shown.length) % st.shown.length; this._draw(); return; }
    if (e.key === 'Enter') { e.preventDefault(); this._go(st.shown[st.idx]); return; }
    if (e.key === 'Delete' && (e.shiftKey || input.value === '')) { e.preventDefault(); this._closeRow(); return; }
  },

  _icon(name) { return typeof VexIcons !== 'undefined' && VexIcons.has(name) ? VexIcons.svg(name, { size: 13 }) : ''; },

  _draw() {
    const st = this._state;
    if (!st || !this._el) return;
    const list = this._el.querySelector('.tt-list');
    const input = this._el.querySelector('input');
    list.textContent = '';
    if (!st.shown.length) {
      const li = document.createElement('li');
      li.className = 'tt-empty';
      li.textContent = 'No open tab matches';
      list.appendChild(li);
      input.removeAttribute('aria-activedescendant');
      this._el.querySelector('.tt-sr').textContent = 'No open tab matches';
      return;
    }
    st.shown.forEach((d, i) => {
      const li = document.createElement('li');
      li.className = 'tt-row' + (i === st.idx ? ' selected' : '');
      li.id = 'tab-search-row-' + i;
      li.setAttribute('role', 'option');
      li.setAttribute('aria-selected', i === st.idx ? 'true' : 'false');
      const fav = document.createElement('span');
      fav.className = 'tt-fav';
      if (d.favicon && /^(https?:|data:image\/)/i.test(d.favicon)) {
        const img = document.createElement('img');
        img.src = d.favicon; img.alt = ''; img.width = 16; img.height = 16;
        fav.appendChild(img);
      }
      const text = document.createElement('span');
      text.className = 'tt-text';
      const title = document.createElement('span'); title.className = 'tt-title'; title.textContent = d.title;
      const sub = document.createElement('span'); sub.className = 'tt-sub'; sub.textContent = (d.group ? d.group + ' · ' : '') + (d.host || d.url);
      text.append(title, sub);
      const flags = document.createElement('span');
      flags.className = 'tt-flags';
      flags.innerHTML = (d.pinned ? this._icon('pin') : '') + (d.sleeping ? this._icon('sleep') : '') + (d.audible ? this._icon('volume') : '') + (d.muted ? this._icon('mute') : '');
      li.append(fav, text, flags);
      li.addEventListener('mousedown', (e) => { e.preventDefault(); this._go(d); });
      list.appendChild(li);
    });
    input.setAttribute('aria-activedescendant', 'tab-search-row-' + st.idx);
    const sel = list.children[st.idx];
    if (sel && typeof sel.scrollIntoView === 'function') sel.scrollIntoView({ block: 'nearest' });
    this._el.querySelector('.tt-sr').textContent = st.shown[st.idx].title + ', ' + (st.idx + 1) + ' of ' + st.shown.length;
  },
};

if (typeof window !== 'undefined') window.VexTabSearch = VexTabSearch;
if (typeof module !== 'undefined' && module.exports) module.exports = { VexTabSearch };

// === A small "type to narrow, Enter to go" list =================================
//
// The overlay that Search open tabs (js/tab-search.js) draws, as a helper for
// the lists that follow it: Essential tabs (js/essentials.js) and Find text in
// all tabs (js/tab-text-find.js). It uses the same .tt-* look (css/tab-tools.css)
// and keys: arrows move, Enter picks, Escape puts the focus back where it was.
//
//   VexPickList.open({
//     label: 'Find text in all tabs',          // the dialog's name
//     placeholder: 'Type the exact words',
//     hint: 'Enter to go, Esc to cancel',
//     empty: 'Nothing found',                   // shown when source() gives no rows
//     source: (query) => [{ id, title, sub, flags: ['pin'] }],   // called on every key
//     onPick: (row) => {},
//   })
const VexPickList = {
  _el: null,
  _state: null,

  isOpen() { return !!this._el; },

  open(spec) {
    if (!spec || typeof spec.source !== 'function' || typeof spec.onPick !== 'function') throw new Error('VexPickList.open needs source() and onPick()');
    this.close();
    const active = document.activeElement;
    this._state = { spec, rows: [], idx: 0, back: active && active !== document.body ? active : null };
    const el = document.createElement('div');
    el.id = 'vex-pick-list';
    el.className = 'tt-overlay tt-search';
    const card = document.createElement('div');
    card.className = 'tt-card';
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-modal', 'true');
    card.setAttribute('aria-label', spec.label || 'Choose');
    const input = document.createElement('input');
    input.className = 'tt-input';
    input.type = 'text';
    input.setAttribute('role', 'combobox');
    input.setAttribute('aria-expanded', 'true');
    input.setAttribute('aria-controls', 'vex-pick-list-rows');
    input.setAttribute('aria-autocomplete', 'list');
    input.setAttribute('aria-label', spec.label || 'Choose');
    input.placeholder = spec.placeholder || '';
    input.spellcheck = false;
    input.autocomplete = 'off';
    const list = document.createElement('ul');
    list.className = 'tt-list';
    list.id = 'vex-pick-list-rows';
    list.setAttribute('role', 'listbox');
    list.setAttribute('aria-label', spec.label || 'Choose');
    const hint = document.createElement('div');
    hint.className = 'tt-hint';
    hint.textContent = spec.hint || 'Enter to choose, Esc to cancel';
    const sr = document.createElement('div');
    sr.className = 'tt-sr';
    sr.setAttribute('role', 'status');
    sr.setAttribute('aria-live', 'polite');
    card.append(input, list, hint, sr);
    el.appendChild(card);
    document.body.appendChild(el);
    this._el = el;
    input.addEventListener('input', () => this._refresh(input.value));
    el.addEventListener('keydown', (e) => this._key(e));
    el.addEventListener('mousedown', (e) => { if (e.target === el) { e.preventDefault(); this.close(); } });
    this._refresh('');
    input.focus();
    return el;
  },

  close() {
    const el = this._el, st = this._state;
    this._el = null; this._state = null;
    if (el) el.remove();
    if (st && st.back && st.back.isConnected) {
      try { st.back.focus(); } catch (err) { console.error('[PickList] could not give the focus back:', err); }
    }
  },

  _refresh(query) {
    const st = this._state;
    if (!st) return;
    st.rows = st.spec.source(String(query || '')) || [];
    st.idx = 0;
    this._draw();
  },

  _pick(row) {
    const st = this._state;
    if (!st || !row) return;
    const { onPick } = st.spec;
    this.close();
    onPick(row);
  },

  _key(e) {
    const st = this._state;
    if (!st) return;
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); this.close(); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); if (st.rows.length) st.idx = (st.idx + 1) % st.rows.length; this._draw(); return; }
    if (e.key === 'ArrowUp') { e.preventDefault(); if (st.rows.length) st.idx = (st.idx - 1 + st.rows.length) % st.rows.length; this._draw(); return; }
    if (e.key === 'Enter') { e.preventDefault(); this._pick(st.rows[st.idx]); }
  },

  _icon(name) { return typeof VexIcons !== 'undefined' && VexIcons.has(name) ? VexIcons.svg(name, { size: 13 }) : ''; },

  _draw() {
    const st = this._state;
    if (!st || !this._el) return;
    const list = this._el.querySelector('.tt-list');
    const input = this._el.querySelector('input');
    const sr = this._el.querySelector('.tt-sr');
    list.textContent = '';
    if (!st.rows.length) {
      const li = document.createElement('li');
      li.className = 'tt-empty';
      li.textContent = st.spec.empty || 'Nothing matches';
      list.appendChild(li);
      input.removeAttribute('aria-activedescendant');
      sr.textContent = li.textContent;
      return;
    }
    st.rows.forEach((row, i) => {
      const li = document.createElement('li');
      li.className = 'tt-row' + (i === st.idx ? ' selected' : '');
      li.id = 'vex-pick-row-' + i;
      li.setAttribute('role', 'option');
      li.setAttribute('aria-selected', i === st.idx ? 'true' : 'false');
      const fav = document.createElement('span');
      fav.className = 'tt-fav';
      if (row.favicon && /^(https?:|data:image\/)/i.test(row.favicon)) {
        const img = document.createElement('img');
        img.src = row.favicon; img.alt = ''; img.width = 16; img.height = 16;
        fav.appendChild(img);
      }
      const text = document.createElement('span');
      text.className = 'tt-text';
      const title = document.createElement('span'); title.className = 'tt-title'; title.textContent = row.title || '';
      const sub = document.createElement('span'); sub.className = 'tt-sub'; sub.textContent = row.sub || '';
      text.append(title, sub);
      const flags = document.createElement('span');
      flags.className = 'tt-flags';
      flags.innerHTML = (row.flags || []).map(f => this._icon(f)).join('');
      li.append(fav, text, flags);
      li.addEventListener('mousedown', (e) => { e.preventDefault(); this._pick(row); });
      list.appendChild(li);
    });
    input.setAttribute('aria-activedescendant', 'vex-pick-row-' + st.idx);
    const sel = list.children[st.idx];
    if (sel && typeof sel.scrollIntoView === 'function') sel.scrollIntoView({ block: 'nearest' });
    sr.textContent = (st.rows[st.idx].title || '') + ', ' + (st.idx + 1) + ' of ' + st.rows.length;
  },
};

if (typeof window !== 'undefined') window.VexPickList = VexPickList;
if (typeof module !== 'undefined' && module.exports) module.exports = { VexPickList };

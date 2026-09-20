// === Naming a tab in the AI box ============================================
//
// Asking about two tabs meant going up to the tab-selector pill, switching it
// to Custom, and ticking boxes — away from the sentence you were writing. This
// is the other way round: type @ and the tabs are there by name, next to what
// you are typing.
//
// @ already meant "switch persona" (js/personas.js), so the list holds both:
// the personas whose name matches, and the open tabs. Picking a persona types
// its name, which the old handler still acts on; picking a tab adds that tab
// to what the AI is given (TabSelector's Custom set), which the pill above the
// box then shows.
const TabMentions = {
  MAX: 8,
  MAX_QUERY: 40,

  // The @ being typed at the caret, or null. An email address is not a
  // mention, so @ must start a word.
  queryAt(text, caret) {
    const s = String(text == null ? '' : text);
    const at = Math.max(0, Math.min(Number(caret) || 0, s.length));
    const start = s.lastIndexOf('@', at - 1);
    if (start < 0) return null;
    if (start > 0 && !/[\s(]/.test(s[start - 1])) return null;
    const query = s.slice(start + 1, at);
    if (query.length > this.MAX_QUERY || /[\n\r]/.test(query)) return null;
    return { start, query };
  },

  _host(url) { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; } },

  // Tabs and personas that match what has been typed so far. A tab matches on
  // its title or its site, so "@git" finds a GitHub tab called anything.
  //
  // Order matters, because the list is short: a persona whose name starts with
  // what you typed is almost certainly who you meant, so it goes first. After
  // that come the tabs — naming a tab is what @ is for here — and the personas
  // that only matched somewhere in the middle come last.
  candidates(tabs, personas, query) {
    const q = String(query || '').trim().toLowerCase();
    const starts = [], rest = [], hits = [];
    for (const p of personas || []) {
      // The old @handler matches on the name with its spaces taken out, so
      // that is what gets typed.
      const name = String(p.name || '').replace(/^@/, '').replace(/\s+/g, '');
      if (!name) continue;
      const lower = name.toLowerCase();
      if (q && !lower.includes(q)) continue;
      const entry = { kind: 'persona', id: p.id, label: name, sub: 'persona' };
      if (q && lower.startsWith(q)) starts.push(entry); else rest.push(entry);
    }
    for (const t of tabs || []) {
      const title = String(t.title || '').trim();
      const host = this._host(t.url);
      if (!title && !host) continue;
      const hay = (title + ' ' + host).toLowerCase();
      if (q && !hay.includes(q)) continue;
      hits.push({ kind: 'tab', id: t.id, label: title || host, sub: host || 'tab' });
    }
    return [...starts, ...hits, ...rest].slice(0, this.MAX);
  },

  // The text with the mention finished off, and where the caret goes after.
  apply(text, caret, start, entry) {
    const s = String(text == null ? '' : text);
    const at = Math.max(0, Math.min(Number(caret) || 0, s.length));
    const rest = s.slice(at);
    // One space after the name, unless the sentence already had one there.
    const inserted = '@' + String(entry.label).replace(/\s+/g, ' ').trim() + (/^\s/.test(rest) ? '' : ' ');
    return { text: s.slice(0, start) + inserted + rest, caret: start + inserted.length };
  },

  // A chosen tab is added to what the AI is given. The pill above the box
  // shows the count, so the choice is never invisible.
  choose(entry) {
    if (entry.kind !== 'tab') return false;
    if (typeof TabSelector === 'undefined') return false;
    TabSelector._customIds.add(entry.id);
    TabSelector.setMode('custom');
    return true;
  },

  // --- the list under the box ----------------------------------------------

  _el: null,
  _items: [],
  _index: 0,
  _at: null,

  close() {
    this._el?.remove();
    this._el = null;
    this._items = [];
    this._at = null;
  },

  isOpen() { return !!this._el; },

  _draw(input) {
    const esc = (s) => window.escapeHtml(String(s == null ? '' : s));
    if (!this._el) {
      this._el = document.createElement('div');
      this._el.className = 'vex-mention-list';
      this._el.setAttribute('role', 'listbox');
      this._el.style.cssText = 'position:absolute;z-index:60;max-height:216px;overflow-y:auto;min-width:220px;' +
        'background:var(--bg);border:1px solid var(--border);border-radius:9px;box-shadow:0 10px 30px var(--vex-shadow-color,rgba(0,0,0,0.38));padding:4px';
      (input.closest('.ai-input-wrapper') || document.body).appendChild(this._el);
      const wrap = input.closest('.ai-input-wrapper');
      if (wrap && getComputedStyle(wrap).position === 'static') wrap.style.position = 'relative';
      this._el.style.left = '6px';
      this._el.style.bottom = 'calc(100% + 6px)';
    }
    this._el.innerHTML = this._items.map((item, i) => `
      <div role="option" data-i="${i}" aria-selected="${i === this._index}"
           style="display:flex;align-items:center;gap:8px;padding:6px 8px;border-radius:6px;cursor:pointer;background:${i === this._index ? 'var(--vex-hover-fill,var(--surface))' : 'transparent'}">
        <div style="flex:1;min-width:0">
          <div style="font-size:12.5px;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(item.label)}</div>
          <div style="font-size:10px;color:var(--text-muted)">${esc(item.sub)}</div>
        </div>
      </div>`).join('');
    this._el.querySelectorAll('[data-i]').forEach(row => {
      row.addEventListener('mousedown', (e) => { e.preventDefault(); this.pick(input, Number(row.dataset.i)); });
    });
  },

  pick(input, index) {
    const item = this._items[Math.max(0, Math.min(index, this._items.length - 1))];
    const at = this._at;
    if (!item || !at) return false;
    const next = this.apply(input.value, input.selectionStart, at.start, item);
    input.value = next.text;
    input.setSelectionRange(next.caret, next.caret);
    this.choose(item);
    this.close();
    input.focus();
    return true;
  },

  refresh(input) {
    const at = this.queryAt(input.value, input.selectionStart);
    if (!at) { this.close(); return; }
    const tabs = typeof TabManager !== 'undefined' ? TabManager.tabs : [];
    const personas = (typeof PersonasManager !== 'undefined' && PersonasManager.getAll) ? PersonasManager.getAll() : [];
    this._items = this.candidates(tabs, personas, at.query);
    if (!this._items.length) { this.close(); return; }
    this._at = at;
    this._index = 0;
    this._draw(input);
  },

  // Keys while the list is open: up and down move, Enter and Tab take the one
  // highlighted, Escape closes it. Everything else falls through to the box.
  onKeyDown(input, e) {
    if (!this.isOpen()) return false;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      this._index = (this._index + (e.key === 'ArrowDown' ? 1 : this._items.length - 1)) % this._items.length;
      this._draw(input);
      return true;
    }
    if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); this.pick(input, this._index); return true; }
    if (e.key === 'Escape') { e.preventDefault(); this.close(); return true; }
    return false;
  },

  init() {
    const input = document.getElementById('ai-input');
    if (!input) return this;
    input.addEventListener('input', () => this.refresh(input));
    input.addEventListener('click', () => this.refresh(input));
    input.addEventListener('blur', () => setTimeout(() => this.close(), 120));
    // Before the panel's own Enter handler, so Enter takes the highlighted
    // tab instead of sending a half-typed mention.
    input.addEventListener('keydown', (e) => {
      if (this.onKeyDown(input, e)) e.stopImmediatePropagation();
    }, true);
    return this;
  },
};

if (typeof window !== 'undefined') window.TabMentions = TabMentions;
if (typeof module !== 'undefined' && module.exports) module.exports = { TabMentions };

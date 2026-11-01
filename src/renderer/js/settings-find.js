// === Settings search: a list of the settings found ===========================
//
// The owner (2026-11-01): "settings search is still terrible". Typing used to hide the cards that did not match and
// leave whole unrelated cards in view, and "theme packs" listed one setting twice and sections that only mention a
// pack somewhere. Now typing replaces the category view with a LIST OF SETTINGS, one row each:
//
//   Theme packs…                     [ Open ]
//   Appearance › Personalization
//
// * a setting appears once (the same name in two sections is one row; the section that is about it wins);
// * the order is: the exact name, then the name as whole words, then the words as the start of words in the name,
//   then the keywords and the description (a name always beats a body text);
// * what is searched is what js/settings-ui.js indexes (js/smart-search.js reads both languages, so the English
//   "theme packs" and the Turkish "tema paketleri" find the same row whatever language Vex is shown in);
// * "What each feature touches" lists every feature of Vex, so a word in it says nothing about a setting: its rows are
//   not results, and the section itself is one only when its own name fits;
// * ten rows, then "Show more"; Up and Down move along the rows, Enter opens one, Esc clears the search.
//
// A switch or a menu is shown live in the row (it drives the real control); anything else is an Open button.
const SettingsFind = {
  PAGE: 10,

  // Sections (by the start of their English heading) whose rows are no answer to a search for a setting.
  EXCLUDED: ['what each feature touches'],

  // The English heading of a section, lower case.
  headingOf(g) {
    const el = g && g.querySelector ? g.querySelector('.setting-label') : null;
    if (!el) return '';
    const text = typeof VexI18nUI !== 'undefined' && VexI18nUI.english ? VexI18nUI.english(el) : el.textContent;
    return String(text || '').trim().toLowerCase();
  },
  isExcluded(g) {
    const h = this.headingOf(g);
    return this.EXCLUDED.some(p => h.startsWith(p));
  },

  // 4 the name is the query, 3 the query is in the name as whole words, 2 every word of the query starts a word of the name,
  // 1 it was found in the keywords or the explanation only.
  // "Wallpapers (New)" is the setting "Wallpapers": a badge is not part of the name.
  plain(title) { return String(title || '').replace(/\s*[(\[]?\b(new|beta|yeni)\b[)\]]?\s*$/i, '').trim(); },
  // A section's own name: the bold part of its heading, not the sentence written under it.
  sectionName(g) {
    const l = g.querySelector('.setting-label');
    if (!l) return 'Settings';
    const s = l.querySelector('strong');
    const t = String((s || l).textContent || '').split('\n')[0].replace(/\s+/g, ' ').trim();
    return this.plain(t.length > 60 ? t.slice(0, 57) + '…' : t) || 'Settings';
  },
  tierOf(S, parsed, rawTitle) {
    const title = this.plain(rawTitle);
    const words = S.cachedWords(title);
    const own = S.words(title);
    const qw = S.words(parsed.query);
    const norm = (list) => ' ' + list.map(w => (w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w)).join(' ') + ' ';
    const t = norm(own);
    const q = norm(qw);
    if (own.length && t === q) return 4;
    if (qw.length && t.includes(q)) return 3;
    // Only the words as typed (a plural or an ending allowed), not a synonym: "wallpaper" is not "Sleep background tabs".
    const starts = parsed.tokens.every(tok => words.some(w => S.fit(tok.raw, w, true) >= 0.85));
    return starts ? 2 : 1;
  },

  // hits: [{ g, el, title, section, rank }] from SettingsUI._rankGroups. Returns the rows to show: once each, best first.
  collect(S, parsed, hits) {
    const best = new Map();
    hits.forEach((h, order) => {
      const excluded = this.isExcluded(h.g);
      const tier = this.tierOf(S, parsed, h.title);
      // An excluded section is a result only by its own name, and only as the section.
      if (excluded && (h.el || tier < 2)) return;
      const key = S.words(this.plain(h.title)).join(' ') + '|' + (h.g.dataset.navKey || '');
      if (!key.trim()) return;
      const row = { g: h.g, el: h.el, title: this.plain(h.title), section: this.sectionName(h.g), tier, rank: h.rank, order };
      const have = best.get(key);
      // The same setting twice: the better fit stays; on a tie the setting itself beats the section named like it.
      if (!have || row.tier > have.tier || (row.tier === have.tier && (row.rank > have.rank || (row.rank === have.rank && !row.el && !!have.el)))) best.set(key, row);
    });
    let rows = Array.from(best.values()).sort((a, b) => (b.tier - a.tier) || (b.rank - a.rank) || (a.order - b.order));
    // A section that only has the word among its keywords is noise once real names fit.
    if (rows.some(r => r.tier >= 3)) rows = rows.filter(r => r.el || r.tier >= 2);
    return rows;
  },

  // ---- the page -----------------------------------------------------------------------------------
  _t(text) {
    if (typeof VexI18nUI === 'undefined' || VexI18nUI.locale() === 'en') return text;
    const hit = VexI18nUI.lookup(text);
    return hit == null ? text : hit;
  },

  // Where a row's setting lives: "Appearance › Wallpapers".
  breadcrumb(g, section) {
    const key = g.dataset.navKey || '';
    const top = key ? this._t(key) : '';
    let sec = String(section || '').replace(/\s+/g, ' ').trim();
    // A section named like its category: the card it is in says where.
    if (top && sec && top.toLowerCase() === sec.toLowerCase() && g.dataset.card && typeof SettingsPane !== 'undefined') sec = SettingsPane._t(g.dataset.card);
    return top && sec && top.toLowerCase() !== sec.toLowerCase() ? top + ' › ' + sec : (top || sec);
  },

  // The one real control a row could be driven from: a switch or a menu that is alone in its row.
  controlOf(row) {
    const el = row.el;
    if (!el || !el.isConnected) return null;
    const own = el.matches('input[type="checkbox"], select') ? el : null;
    if (own) return own;
    const host = el.closest('.setting-toggle-row, .setting-row');
    if (!host) return null;
    const list = host.querySelectorAll('input[type="checkbox"], select');
    return list.length === 1 && !host.querySelector('input:not([type="checkbox"]):not([type="hidden"]), textarea') ? list[0] : null;
  },

  // A proxy for the real control: it shows the real state and does its work through the real control.
  proxyFor(real, label) {
    if (real.tagName === 'SELECT') {
      const sel = document.createElement('select');
      sel.className = 'set-result-control';
      sel.setAttribute('aria-label', label);
      for (const o of real.options) {
        const c = document.createElement('option');
        c.value = o.value;
        c.textContent = o.textContent;
        sel.appendChild(c);
      }
      sel.value = real.value;
      sel.disabled = real.disabled;
      sel.addEventListener('change', () => {
        real.value = sel.value;
        real.dispatchEvent(new Event('input', { bubbles: true }));
        real.dispatchEvent(new Event('change', { bubbles: true }));
      });
      return sel;
    }
    const wrap = document.createElement('label');
    wrap.className = 'toggle set-result-control';
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = real.checked;
    box.disabled = real.disabled;
    box.setAttribute('aria-label', label);
    const slider = document.createElement('span');
    slider.className = 'toggle-slider';
    wrap.append(box, slider);
    box.addEventListener('change', () => {
      // The real switch does its own work on a click (its listeners, its saved value).
      if (real.checked !== box.checked) real.click();
      box.checked = real.checked;
    });
    return wrap;
  },

  _row(row, onOpen) {
    const el = document.createElement('div');
    el.className = 'set-result-row';
    el.setAttribute('role', 'option');
    el.tabIndex = -1;
    const text = document.createElement('div');
    text.className = 'set-result-text';
    const name = document.createElement('div');
    name.className = 'set-result-name';
    name.textContent = row.title;
    const crumb = document.createElement('div');
    crumb.className = 'set-result-crumb';
    crumb.textContent = this.breadcrumb(row.g, row.section);
    text.append(name, crumb);
    el.appendChild(text);
    if (row.g.dataset.tier === 'advanced' && document.body.dataset.uiMode === 'simple') {
      const tag = document.createElement('span');
      tag.className = 'set-result-tag';
      tag.textContent = this._t('Developer mode');
      el.appendChild(tag);
    }
    const real = this.controlOf(row);
    if (real && real.type !== 'radio') el.appendChild(this.proxyFor(real, row.title));
    const open = document.createElement('button');
    open.type = 'button';
    open.className = 'set-result-open btn-secondary';
    open.textContent = this._t('Open');
    open.setAttribute('aria-label', this._t('Open') + ': ' + row.title);
    open.tabIndex = -1;
    open.addEventListener('click', (e) => { e.stopPropagation(); onOpen(row); });
    el.appendChild(open);
    el.addEventListener('click', (e) => {
      // A click on the live control only drives it.
      if (e.target.closest('.set-result-control')) return;
      onOpen(row);
    });
    return el;
  },

  // Draw the list into `host` (an element at the top of the settings area).
  render(host, rows, query, onOpen) {
    host.hidden = false;
    host.replaceChildren();
    const q = String(query || '').trim();
    const head = document.createElement('div');
    head.className = 'set-results-head';
    head.setAttribute('role', 'status');
    host.appendChild(head);
    if (!rows.length) {
      head.textContent = '';
      const empty = document.createElement('div');
      empty.className = 'set-results-empty';
      const t = document.createElement('div');
      t.className = 'set-results-empty-title';
      t.textContent = this._t('No settings match') + ' “' + q + '”';
      const hint = document.createElement('div');
      hint.className = 'set-results-empty-hint';
      hint.textContent = this._t('Try Ctrl+K for commands and features.');
      empty.append(t, hint);
      host.appendChild(empty);
      return 0;
    }
    const list = document.createElement('div');
    list.className = 'set-results-list';
    list.setAttribute('role', 'listbox');
    list.setAttribute('aria-label', this._t('Search results'));
    host.appendChild(list);
    let shown = 0;
    const draw = (upTo) => {
      for (; shown < Math.min(upTo, rows.length); shown++) list.appendChild(this._row(rows[shown], onOpen));
      head.textContent = rows.length === 1 ? this._t('1 result') : rows.length + ' ' + this._t('results');
      more.hidden = shown >= rows.length;
      more.textContent = this._t('Show more') + ' (' + (rows.length - shown) + ')';
    };
    const more = document.createElement('button');
    more.type = 'button';
    more.className = 'set-results-more btn-secondary';
    more.addEventListener('click', () => { const was = shown; draw(shown + this.PAGE); const next = list.children[was]; if (next) next.focus(); });
    host.appendChild(more);
    draw(this.PAGE);
    return rows.length;
  },

  // Up and Down along the rows, Enter opens the one in focus.
  rows(host) { return Array.from(host.querySelectorAll('.set-result-row')); },
  move(host, from, delta) {
    const rows = this.rows(host);
    if (!rows.length) return null;
    let i = rows.indexOf(from);
    i = i < 0 ? (delta > 0 ? 0 : rows.length - 1) : Math.max(0, Math.min(rows.length - 1, i + delta));
    rows.forEach((r, k) => r.setAttribute('aria-selected', k === i ? 'true' : 'false'));
    rows[i].focus({ preventScroll: false });
    return rows[i];
  },
};

if (typeof window !== 'undefined') window.SettingsFind = SettingsFind;
if (typeof module !== 'undefined' && module.exports) module.exports = { SettingsFind };

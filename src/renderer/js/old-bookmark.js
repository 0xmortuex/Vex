// === A forgotten bookmark, once a day =========================================
//
// One old bookmark a day, with three answers: "Still good" (keep it, ask again
// in half a year), "Archive" (move it to the Archive folder and stop picking
// it) and "Open". It is never more than one, there is no streak and no count
// of what is left; skipping a day costs nothing.
//
// The pick is the same all day, stored under 'vex.oldBookmark' with the
// bookmarks you answered. Nothing leaves this PC.
//
// Off until switched on in Settings > Little surprises (js/delights.js).
const VexOldBookmark = {
  KEY: 'vex.oldBookmark',
  MIN_AGE_DAYS: 90,
  REASK_DAYS: 180,
  DAY: 24 * 3600 * 1000,
  ARCHIVE_FOLDER: 'Archive',

  dayKey(ms) {
    const d = new Date(ms);
    const p = (n) => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  },
  _hash(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; },

  _read() {
    const raw = localStorage.getItem(this.KEY);
    if (raw == null) return { day: '', id: '', reviewed: {} };
    let m;
    try { m = JSON.parse(raw); } catch (err) { throw new Error('The old-bookmark state could not be read', { cause: err }); }
    return { day: typeof m.day === 'string' ? m.day : '', id: typeof m.id === 'string' ? m.id : '', reviewed: m.reviewed && typeof m.reviewed === 'object' ? m.reviewed : {} };
  },
  _write(m) { localStorage.setItem(this.KEY, JSON.stringify(m)); },
  reset() { localStorage.removeItem(this.KEY); },

  // Pure: the eligible bookmarks. items: bookmark list, reviewed: { id: ms }.
  eligible(items, reviewed, now) {
    return (items || []).filter(b => {
      if (!b || typeof b.id !== 'string' || typeof b.url !== 'string' || !/^https?:\/\//i.test(b.url)) return false;
      if (b.archived || b.ownSession) return false;
      const at = Number(b.at) || 0;
      if (at && now - at < this.MIN_AGE_DAYS * this.DAY) return false;
      const r = Number(reviewed[b.id]) || 0;
      if (r && now - r < this.REASK_DAYS * this.DAY) return false;
      return true;
    });
  },

  // Pure: today's pick, stable for the day. -> bookmark or null.
  choose(items, state, now) {
    const today = this.dayKey(now);
    if (state.day === today && state.id) {
      const kept = (items || []).find(b => b && b.id === state.id && !b.archived);
      if (kept) return kept;
    }
    const list = this.eligible(items, state.reviewed, now).sort((a, b) => a.id.localeCompare(b.id));
    if (!list.length) return null;
    return list[this._hash(today) % list.length];
  },

  _items() { return (typeof Bookmarks !== 'undefined' && Array.isArray(Bookmarks.items)) ? Bookmarks.items : []; },

  // Today's bookmark (and remember it), or null.
  today(now = Date.now()) {
    const state = this._read();
    const pick = this.choose(this._items(), state, now);
    if (pick && (state.day !== this.dayKey(now) || state.id !== pick.id)) { state.day = this.dayKey(now); state.id = pick.id; this._write(state); }
    return pick;
  },

  _find(id) {
    const i = this._items().findIndex(b => b && b.id === id);
    if (i < 0) throw new Error('That bookmark is gone');
    return i;
  },
  _signal(id) {
    try { document.dispatchEvent(new CustomEvent('vex:medal-signal', { detail: { id } })); } catch (err) { console.error('[OldBookmark] medal signal failed:', err.message); }
  },

  stillGood(id, now = Date.now()) {
    this._find(id);
    const s = this._read();
    s.reviewed[id] = now;
    this._write(s);
    this._signal('old-bookmark-reviewed');
  },
  archive(id, now = Date.now()) {
    const i = this._find(id);
    const items = this._items();
    items[i] = { ...items[i], archived: true, folder: this.ARCHIVE_FOLDER };
    if (typeof Bookmarks.save === 'function') Bookmarks.save();
    if (typeof Bookmarks._repaint === 'function') Bookmarks._repaint();
    const s = this._read();
    s.reviewed[id] = now;
    this._write(s);
    this._signal('old-bookmark-reviewed');
  },
  open(id) {
    const b = this._items()[this._find(id)];
    if (typeof TabManager === 'undefined' || typeof TabManager.createTab !== 'function') throw new Error('Tabs are not available in this window');
    TabManager.createTab(b.url, true);
  },

  // A small card with the three answers.
  show() {
    const b = this.today();
    if (!b) { window.showToast?.('No forgotten bookmarks today. They need to be ' + this.MIN_AGE_DAYS + ' days old.', 'info'); return null; }
    document.querySelector('.vex-oldbm-overlay')?.remove();
    const mk = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
    const overlay = mk('div', 'vex-delight-overlay vex-oldbm-overlay');
    const box = mk('div', 'vex-delight-card');
    box.setAttribute('role', 'dialog'); box.setAttribute('aria-modal', 'true'); box.setAttribute('aria-label', 'A forgotten bookmark');
    box.appendChild(mk('h2', 'vex-delight-title', 'A bookmark you may have forgotten'));
    box.appendChild(mk('div', 'vex-delight-text', b.title || b.url));
    const sub = mk('div', 'vex-delight-sub', b.url + (b.at ? ' · saved ' + new Date(b.at).toLocaleDateString() : ''));
    box.appendChild(sub);
    const row = mk('div', 'vex-delight-actions');
    const btn = (text, icon, cls, fn) => {
      const e = mk('button', cls + ' vex-delight-btn');
      e.type = 'button';
      if (typeof VexIcons !== 'undefined') e.innerHTML = VexIcons.svg(icon, { size: 14 });
      e.appendChild(mk('span', '', text));
      e.addEventListener('click', () => { try { fn(); } catch (err) { window.showToast?.(err.message, 'error'); } });
      return e;
    };
    row.append(
      btn('Open', 'external', 'btn-primary', () => { this.open(b.id); overlay.remove(); }),
      btn('Still good', 'check', 'btn-secondary', () => { this.stillGood(b.id); overlay.remove(); window.showToast?.('Kept. It will not come up for ' + Math.round(this.REASK_DAYS / 30) + ' months.', 'info', 2500); }),
      btn('Archive', 'archive', 'btn-secondary', () => { this.archive(b.id); overlay.remove(); window.showToast?.('Moved to the Archive folder', 'info', 2500); }),
      btn('Not now', 'x', 'btn-secondary', () => overlay.remove()),
    );
    box.appendChild(row);
    overlay.addEventListener('keydown', (e) => { if (e.key === 'Escape') overlay.remove(); });
    overlay.appendChild(box);
    document.body.appendChild(overlay);
    row.querySelector('button')?.focus();
    return overlay;
  },

  section: {
    id: 'old-bookmark',
    title: 'A forgotten bookmark',
    icon: 'bookmark',
    order: 97,
    defaultOn: false,
    isEnabled() { return typeof VexDelights !== 'undefined' && VexDelights.isOn('oldBookmark'); },
    build() {
      const b = VexOldBookmark.today();
      if (!b) return null;
      return {
        summary: 'Saved ' + (b.at ? new Date(b.at).toLocaleDateString() : 'a while ago') + '. Still good?',
        items: [{ text: b.title || b.url, sub: b.url, url: b.url }],
        note: 'Answer it from Command Bar > A Forgotten Bookmark: Still good, Archive or Open.',
      };
    },
  },

  command: {
    id: 'old-bookmark',
    label: 'A Forgotten Bookmark',
    hint: 'One old bookmark a day: still good, archive, or open',
    icon: 'bookmark',
    action: () => {
      try {
        if (typeof VexDelights !== 'undefined' && !VexDelights.isOn('oldBookmark')) throw new Error('Turn on A forgotten bookmark in Settings > Little surprises first');
        VexOldBookmark.show();
      } catch (err) { window.showToast?.(err.message, 'error'); }
    },
  },
};

if (typeof window !== 'undefined') window.VexOldBookmark = VexOldBookmark;
if (typeof module !== 'undefined' && module.exports) module.exports = { VexOldBookmark };

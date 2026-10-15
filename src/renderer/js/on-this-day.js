// === On this day ============================================================
//
// What you read, saved, wrote and recorded on today's date in earlier years.
// It is a look through lists Vex already keeps on this PC: history, notes,
// bookmarks, Read Later and the clips folder (if you picked one). Nothing is
// sent anywhere and nothing is stored, the answer is built on demand.
//
// Private and Tor pages are never in these lists (they are not saved), and
// anything saved from a session of its own (ownSession) is skipped here too.
//
// Off until switched on in Settings > Little surprises (js/delights.js).
const VexOnThisDay = {
  MAX_PER_YEAR: 5,
  MAX_YEARS: 8,

  _ms(v) {
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    if (typeof v === 'string' && v) { const t = Date.parse(v); return Number.isNaN(t) ? 0 : t; }
    return 0;
  },

  // Same month and day, an earlier year. A Feb 29 only shows on a Feb 29.
  sameDay(ms, now) {
    if (!ms) return null;
    const d = new Date(ms), n = new Date(now);
    if (d.getMonth() !== n.getMonth() || d.getDate() !== n.getDate()) return null;
    if (d.getFullYear() >= n.getFullYear()) return null;
    return d.getFullYear();
  },

  // sources: { history, notes, bookmarks, readLater, clips } (each optional).
  // -> [{ year, items: [{ kind, text, url?, at }] }], newest year first.
  collect(sources, now = Date.now()) {
    const years = new Map();
    const add = (year, item) => {
      if (!years.has(year)) years.set(year, []);
      years.get(year).push(item);
    };
    for (const h of (sources.history || [])) {
      if (!h || h.ownSession || !h.url) continue;
      const at = this._ms(h.visitedAt) || this._ms(h.time);
      const y = this.sameDay(at, now);
      if (y != null) add(y, { kind: 'read', text: h.title || h.url, url: h.url, at });
    }
    for (const n of (sources.notes || [])) {
      if (!n || typeof n !== 'object') continue;
      const at = this._ms(n.createdAt);
      const y = this.sameDay(at, now);
      if (y == null) continue;
      add(y, { kind: 'wrote', text: (n.title || String(n.content || '').split('\n')[0] || 'Untitled note').slice(0, 120), url: n.sourceUrl || undefined, at });
    }
    for (const b of (sources.bookmarks || [])) {
      if (!b || b.ownSession || !b.url) continue;
      const at = this._ms(b.at);
      const y = this.sameDay(at, now);
      if (y != null) add(y, { kind: 'saved', text: b.title || b.url, url: b.url, at });
    }
    for (const r of (sources.readLater || [])) {
      if (!r || r.ownSession || !r.url) continue;
      const at = this._ms(r.at);
      const y = this.sameDay(at, now);
      if (y != null) add(y, { kind: 'saved', text: r.title || r.url, url: r.url, at });
    }
    for (const c of (sources.clips || [])) {
      if (!c) continue;
      const at = this._ms(c.at);
      const y = this.sameDay(at, now);
      if (y != null) add(y, { kind: 'recorded', text: String(c.name || 'A recording').replace(/\.[a-z0-9]+$/i, '').replace(/[_-]+/g, ' ').trim(), at });
    }
    const out = [...years.entries()]
      .sort((a, b) => b[0] - a[0])
      .slice(0, this.MAX_YEARS)
      .map(([year, items]) => ({ year, items: items.sort((a, b) => a.at - b.at).slice(0, this.MAX_PER_YEAR), total: items.length }));
    return out;
  },

  // The live lists. Failures are returned, not hidden: { sources, errors }.
  async gather() {
    const errors = [];
    const sources = {};
    try { sources.history = (typeof HistoryPanel !== 'undefined' && HistoryPanel.list) ? HistoryPanel.list() : []; } catch (err) { errors.push('history: ' + err.message); }
    try {
      const raw = localStorage.getItem('vex.notes');
      sources.notes = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(sources.notes)) sources.notes = [];
    } catch (err) { errors.push('notes: ' + err.message); }
    sources.bookmarks = (typeof Bookmarks !== 'undefined' && Array.isArray(Bookmarks.items)) ? Bookmarks.items : [];
    sources.readLater = (typeof ReadLater !== 'undefined' && Array.isArray(ReadLater.items)) ? ReadLater.items : [];
    // Clips only when a folder was already chosen: this never opens a picker.
    try {
      if (typeof ClipsInbox !== 'undefined' && window.vex && typeof window.vex.clipsFolder === 'function') {
        const dir = await ClipsInbox.folder(false);
        if (dir) { const res = await ClipsInbox.list(dir); sources.clips = res.clips || []; }
      }
    } catch (err) { errors.push('clips: ' + err.message); }
    return { sources, errors };
  },

  async today(now = Date.now()) {
    const { sources, errors } = await this.gather();
    return { groups: this.collect(sources, now), errors };
  },

  _plural(n, one, many) { return n + ' ' + (n === 1 ? one : (many || one + 's')); },
  _kindWord: { read: 'read', wrote: 'wrote', saved: 'saved', recorded: 'recorded' },

  // One line per year for the brief: "2024: you read X and wrote Y".
  describe(group) {
    const by = {};
    for (const i of group.items) (by[i.kind] = by[i.kind] || []).push(i);
    const parts = Object.keys(by).map(k => this._kindWord[k] + ' ' + (by[k].length === 1 ? '"' + by[k][0].text + '"' : this._plural(by[k].length, 'thing')));
    return 'You ' + parts.join(', ') + '.';
  },

  section: {
    id: 'on-this-day',
    title: 'On this day',
    icon: 'calendar',
    order: 96,
    defaultOn: false,
    isEnabled() { return typeof VexDelights !== 'undefined' && VexDelights.isOn('onThisDay'); },
    async build() {
      const { groups, errors } = await VexOnThisDay.today();
      if (errors.length) console.error('[OnThisDay]', errors.join('; '));
      if (!groups.length) return null;
      const items = [];
      for (const g of groups) {
        const first = g.items.find(i => i.url) || g.items[0];
        items.push({ text: String(g.year), sub: VexOnThisDay.describe(g), url: first.url, when: String(new Date().getFullYear() - g.year) + ' y ago' });
      }
      return { summary: groups.length === 1 ? 'One earlier year has something from today.' : groups.length + ' earlier years have something from today.', items, note: 'Built from your own history, notes and saves on this PC, when you open the brief.' };
    },
  },

  command: {
    id: 'on-this-day',
    label: 'On This Day',
    hint: 'What you read, saved and wrote on this date in earlier years, from your own lists',
    icon: 'calendar',
    action: async () => {
      try {
        if (typeof VexDelights !== 'undefined' && !VexDelights.isOn('onThisDay')) throw new Error('Turn on On this day in Settings > Little surprises first');
        const { groups, errors } = await VexOnThisDay.today();
        if (errors.length) window.showToast?.('Some lists could not be read: ' + errors.join('; '), 'error');
        if (!groups.length) { window.showToast?.('Nothing from earlier years on this date', 'info'); return; }
        VexOnThisDay.show(groups);
        try { document.dispatchEvent(new CustomEvent('vex:medal-signal', { detail: { id: 'on-this-day-seen' } })); } catch (err) { console.error('[OnThisDay] medal signal failed:', err.message); }
      } catch (err) { window.showToast?.(err.message, 'error'); }
    },
  },

  // A plain dialog: years, what you did, each page one click away.
  show(groups) {
    document.querySelector('.vex-otd-overlay')?.remove();
    const mk = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
    const overlay = mk('div', 'vex-delight-overlay vex-otd-overlay');
    const box = mk('div', 'vex-delight-card');
    box.setAttribute('role', 'dialog'); box.setAttribute('aria-modal', 'true'); box.setAttribute('aria-label', 'On this day');
    box.appendChild(mk('h2', 'vex-delight-title', 'On this day'));
    for (const g of groups) {
      box.appendChild(mk('h3', 'vex-delight-sub', String(g.year)));
      for (const i of g.items) {
        const row = mk('div', 'vex-delight-row');
        row.appendChild(mk('span', 'vex-delight-kind', i.kind));
        if (i.url) {
          const a = mk('button', 'vex-delight-link', i.text);
          a.type = 'button'; a.title = i.url;
          a.addEventListener('click', () => { if (typeof TabManager !== 'undefined') TabManager.createTab(i.url, true); overlay.remove(); });
          row.appendChild(a);
        } else row.appendChild(mk('span', 'vex-delight-text', i.text));
        box.appendChild(row);
      }
    }
    const close = mk('button', 'btn-secondary', 'Close');
    close.type = 'button';
    close.addEventListener('click', () => overlay.remove());
    overlay.addEventListener('keydown', (e) => { if (e.key === 'Escape') overlay.remove(); });
    box.appendChild(close);
    overlay.appendChild(box);
    document.body.appendChild(overlay);
    close.focus();
    return overlay;
  },
};

if (typeof window !== 'undefined') window.VexOnThisDay = VexOnThisDay;
if (typeof module !== 'undefined' && module.exports) module.exports = { VexOnThisDay };

// === Time-scoped and natural-language re-find (T2-016) ===========================
//
// "That page about DPI last week" already works in the lost-tab finder
// (js/lost-tab-finder.js: history titles and the text of pages you read). This
// extends it in the three ways it fell short, and widens what it looks through:
//
//   Time      "in the last 2 hours: cookies", "past 30 min", "since monday",
//             "since 3pm", plus everything the finder already read (yesterday,
//             last week, 3 days ago...)
//   Anchor    "that XSS article from around the Discord fix": the words after
//             "around" are looked up first (history, notes) and the search is
//             scoped to two days either side of what was found
//   Site      "github issues on stackoverflow.com", "from reddit": a host you
//             have actually visited
//   Where     history, the text of pages you read (Recall, by meaning too when you
//             set a local embedding model), your notes, read-later, highlights and
//             the quick-capture clips. Each row says where it came from.
//
//   Ctrl+K   h: cookies last 2 hours      (the prefix h: asks only this)
//   Ctrl+K   "Find by time and topic"     the dialog
//
// Local first, and only local: nothing here calls a cloud model or sends a
// word of the query anywhere (it does not use Recall's AI "smart search").
// Private and Tor tabs never reach history or Recall; LostTabFinder.allowed
// keeps hosts you excluded and .onion addresses out of every web row.

const VexRefind = {
  PREF: 'vex.refind.enabled',
  PREFIX: /^h:\s*/i,
  MAX_ROWS: 30,
  ANCHOR_SPREAD_MS: 2 * 24 * 3600 * 1000,
  NUM: { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, ten: 10, twelve: 12 },
  DAYS: { sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6 },

  enabled() { return VexPlanKit.flag(this.PREF); },
  setEnabled(on) {
    VexPlanKit.setFlag(this.PREF, on);
    this._syncProvider();
    return !!on;
  },

  // ---- the parser (pure) -------------------------------------------------------------------
  // -> { terms, since, until, label, site, anchor } ; anchor is the phrase after "around", or ''.
  parse(text, now = Date.now()) {
    if (typeof LostTabFinder === 'undefined') throw new Error('The lost-tab finder is not loaded');
    let s = String(text == null ? '' : text).toLowerCase().replace(this.PREFIX, '').replace(/\s+/g, ' ').trim();
    let since = 0, until = 0, label = '', site = '', anchor = '';
    const cut = (re) => { const m = re.exec(s); if (m) s = (s.slice(0, m.index) + ' ' + s.slice(m.index + m[0].length)).replace(/\s+/g, ' ').trim(); return m; };
    let m;

    // "from around the Discord fix"
    if ((m = cut(/\b(?:from |at |near )?around (?:the time of |the time |when i |when we |when )?(.+)$/))) anchor = m[1].replace(/^the\s+/, '').trim();

    // "in the last 2 hours", "past 30 min", "last 3 days" (hours and minutes here; the finder does calendar days)
    if ((m = cut(/\b(?:in |over |within |during )?(?:the )?(?:last|past) (\d+|an?|one|two|three|four|five|six|seven|eight|ten|twelve) (minute|min|hour|hr|day)s?\b:?/))) {
      const n = /^\d+$/.test(m[1]) ? Number(m[1]) : this.NUM[m[1]];
      const unit = /^m/.test(m[2]) ? 60000 : /^h/.test(m[2]) ? 3600000 : 86400000;
      if (!(n > 0) || n > 1000) throw new Error('"' + m[0].trim() + '" is not a span of time I can use');
      since = now - n * unit; label = 'the last ' + n + ' ' + m[2].replace(/^min$/, 'minute').replace(/^hr$/, 'hour') + (n === 1 ? '' : 's');
    } else if ((m = cut(/\b(?:in |over )?(?:the )?(?:last|past) hour\b:?/))) {
      since = now - 3600000; label = 'the last hour';
    } else if ((m = cut(/\bsince (monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b:?/))) {
      const d = new Date(VexPlanKit.startOfDay(now));
      for (let i = 0; i < 7; i++) { if (d.getDay() === this.DAYS[m[1]]) break; d.setDate(d.getDate() - 1); }
      since = d.getTime(); label = 'since ' + m[1];
    } else if ((m = cut(/\bsince (\d{1,2})(?::(\d{2}))? ?(am|pm)?\b:?/))) {
      let h = Number(m[1]); const mi = m[2] ? Number(m[2]) : 0;
      if (m[3] === 'pm' && h < 12) h += 12;
      if (m[3] === 'am' && h === 12) h = 0;
      if (h > 23 || mi > 59) throw new Error('"since ' + m[1] + '" is not a time of day');
      const d = new Date(VexPlanKit.startOfDay(now)); d.setHours(h, mi, 0, 0);
      if (d.getTime() > now) d.setDate(d.getDate() - 1);
      since = d.getTime(); label = 'since ' + VexPlanKit.hhmm(since);
    }

    // A host: "on stackoverflow.com", "from github.com".
    if ((m = cut(/\b(?:on|from|at|in) ((?:[a-z0-9-]+\.)+[a-z]{2,})\b/))) site = m[1].replace(/^www\./, '');

    // What is left is read by the finder (yesterday, last week, 3 days ago, the filler words).
    const rest = LostTabFinder.parse(s.replace(/:/g, ' '), now);
    if (!since && rest.since) { since = rest.since; until = rest.until || 0; label = rest.label; }
    return { terms: rest.terms, since, until, label, site, anchor };
  },

  // ---- searching (each store isolated; a store that cannot be read is named) ------------------------
  _src() {
    return {
      history: () => (typeof HistoryPanel !== 'undefined' && typeof HistoryPanel.list === 'function' ? HistoryPanel.list() : []),
      recall: async (query, opts) => {
        if (typeof Recall === 'undefined' || !Recall.enabled()) return { hits: [], off: true };
        return (typeof Recall.meaningOn === 'function' && Recall.meaningOn()) ? Recall.searchByMeaning(query, opts) : Recall.search(query, opts);
      },
      notes: () => VexPlanKit.readJson('vex.notes', []),
      readLater: () => VexPlanKit.readJson('vex.readLater', []),
      highlights: () => VexPlanKit.readJson('vex.annotations', {}),
      clips: async () => {
        if (!window.vex || typeof window.vex.clipsInboxList !== 'function') return [];
        const r = await window.vex.clipsInboxList();
        if (!r || !r.ok) throw new Error('the capture inbox did not answer');
        return r.items || [];
      },
    };
  },

  _hit(hay, terms) { const h = String(hay || '').toLowerCase(); return terms.length === 0 || terms.every(t => h.includes(t)); },
  _inWindow(at, p) { return !(p.since && at && at < p.since) && !(p.until && at && at > p.until); },
  _snippet(text, terms) {
    const t = String(text || '').replace(/\s+/g, ' ');
    const i = terms.length ? t.toLowerCase().indexOf(terms[0]) : 0;
    const from = Math.max(0, i - 40);
    return (from ? '…' : '') + t.slice(from, from + 120) + (t.length > from + 120 ? '…' : '');
  },

  // Rows from every local store for a parsed query (the anchor, if any, is already resolved into since/until).
  async search(p, src = this._src()) {
    const rows = [];
    const errors = [];
    const guard = async (name, fn) => { try { await fn(); } catch (err) { errors.push(name + ': ' + ((err && err.message) || 'unavailable')); } };
    const host = (u) => LostTabFinder._host(u);
    const siteOk = (u) => !p.site || host(u) === p.site || host(u).endsWith('.' + p.site);
    await guard('history', async () => {
      for (const r of LostTabFinder.searchHistory(p, await src.history())) if (siteOk(r.url)) rows.push({ ...r, kind: 'page', where: 'History' });
    });
    await guard('page text', async () => {
      if (!p.terms.length) return;
      const res = await src.recall(p.terms.join(' '), { since: p.since || undefined, until: p.until || undefined, site: p.site || undefined, limit: 40 });
      if (res && res.off) { errors.push('page text: Recall is off, so the text of pages was not searched'); return; }
      for (const r of LostTabFinder._fromRecall(res, p)) if (siteOk(r.url)) rows.push({ ...r, kind: 'page', where: 'Page text' });
    });
    if (!p.site) {
      await guard('notes', async () => {
        for (const n of await src.notes()) {
          if (!n || !n.id) continue;
          const at = Date.parse(n.updatedAt || n.createdAt || '') || 0;
          if (!this._inWindow(at, p) || !this._hit((n.title || '') + ' ' + (n.content || ''), p.terms)) continue;
          rows.push({ kind: 'note', noteId: n.id, title: n.title || 'Untitled note', at, snippet: this._snippet(n.content, p.terms), where: 'Note', score: 1.5 });
        }
      });
      await guard('read later', async () => {
        for (const i of await src.readLater()) {
          if (!i || !i.url || !this._inWindow(i.at, p) || !this._hit((i.title || '') + ' ' + i.url, p.terms)) continue;
          if (!LostTabFinder.allowed(i.url)) continue;
          rows.push({ kind: 'page', url: i.url, title: i.title || i.url, at: i.at || 0, where: 'Read later', score: 1.5 });
        }
      });
      await guard('highlights', async () => {
        const store = await src.highlights();
        for (const list of Object.values(store && typeof store === 'object' ? store : {})) {
          for (const h of Array.isArray(list) ? list : []) {
            if (!h || !h.text || !this._inWindow(h.at, p) || !this._hit(h.text + ' ' + (h.title || ''), p.terms)) continue;
            if (h.url && !LostTabFinder.allowed(h.url)) continue;
            rows.push({ kind: 'page', url: h.url || '', title: h.title || h.url || 'Highlight', at: h.at || 0, snippet: this._snippet(h.text, p.terms), where: 'Highlight', score: 1.5 });
          }
        }
      });
      await guard('clips', async () => {
        for (const c of await src.clips()) {
          if (!c || !c.text || !this._inWindow(c.at, p) || !this._hit(c.text, p.terms)) continue;
          rows.push({ kind: 'clip', title: VexPlanKit.line(c.text, 70), at: c.at || 0, snippet: this._snippet(c.text, p.terms), where: 'Clip', score: 1.2, full: String(c.text) });
        }
      });
    }
    return { rows: this.rank(rows), errors };
  },

  // Same page from two stores once (the first, best-scored wins); best score, then newest.
  rank(rows) {
    const by = new Map();
    for (const r of rows) {
      const key = r.url ? 'u:' + r.url : r.noteId ? 'n:' + r.noteId : 'c:' + r.title + r.at;
      const cur = by.get(key);
      if (!cur) by.set(key, { ...r, wheres: [r.where] });
      else { cur.score = (cur.score || 0) + (r.score || 0); if (!cur.wheres.includes(r.where)) cur.wheres.push(r.where); cur.snippet = cur.snippet || r.snippet; cur.at = Math.max(cur.at || 0, r.at || 0); }
    }
    return [...by.values()].sort((a, b) => (b.score || 0) - (a.score || 0) || (b.at || 0) - (a.at || 0)).slice(0, this.MAX_ROWS);
  },

  // The moment the words after "around" refer to: the best match in history or notes.
  async resolveAnchor(phrase, now, src = this._src()) {
    const words = LostTabFinder.parse(phrase, now).terms;
    if (!words.length) throw new Error('"around ' + phrase + '" has no words to look up');
    let best = null;
    const consider = (title, at, source) => { if (at && (!best || at > best.at)) best = { at, title, source }; };
    for (const e of await src.history()) {
      if (!LostTabFinder.allowed(e.url, e)) continue;
      if (this._hit((e.title || '') + ' ' + e.url, words)) consider(e.title || e.url, LostTabFinder._when(e), 'History');
    }
    for (const n of await src.notes()) {
      if (n && this._hit((n.title || '') + ' ' + (n.content || ''), words)) consider(n.title || 'a note', Date.parse(n.updatedAt || n.createdAt || '') || 0, 'Note');
    }
    if (!best) throw new Error('Could not find "' + phrase + '" in your history or notes to anchor on');
    return best;
  },

  async find(text, { now = Date.now(), src } = {}) {
    if (!this.enabled()) throw new Error('Find by time and topic is switched off in Settings');
    const source = src || this._src();
    const p = this.parse(text, now);
    let anchored = null;
    if (p.anchor) {
      anchored = await this.resolveAnchor(p.anchor, now, source);
      p.since = anchored.at - this.ANCHOR_SPREAD_MS; p.until = anchored.at + this.ANCHOR_SPREAD_MS;
      p.label = 'around "' + VexPlanKit.line(anchored.title, 40) + '" (' + anchored.source + ')';
    }
    if (!p.terms.length && !p.since) throw new Error('Say what you are after, or when: "cookies in the last 2 hours", "the XSS article around the Discord fix"');
    const r = await this.search(p, source);
    return { parsed: p, anchored, rows: r.rows, errors: r.errors };
  },

  // ---- opening a row -------------------------------------------------------------------------------------
  openRow(r) {
    if (r.kind === 'page' && r.url) { if (typeof TabManager === 'undefined') throw new Error('Tabs are not loaded'); TabManager.createTab(r.url, true); return; }
    if (r.kind === 'note') {
      if (typeof SidebarManager === 'undefined' || typeof NotesPanel === 'undefined') throw new Error('Notes are not loaded');
      SidebarManager.openPanel('notes'); NotesPanel.selectNote(r.noteId); return;
    }
    if (r.kind === 'clip') { if (!navigator.clipboard) throw new Error('The clipboard is not available'); navigator.clipboard.writeText(r.full || r.title); window.showToast?.('Copied', 'info'); return; }
    throw new Error('Nothing to open for this row');
  },

  // ---- Ctrl+K: the h: prefix -------------------------------------------------------------------------------
  provider() {
    return {
      id: 'refind', label: 'Find by time and topic',
      search: (q) => {
        if (!this.enabled() || !this.PREFIX.test(String(q || ''))) return [];
        // h: alone, or still typing: one row that says how.
        const query = String(q).replace(this.PREFIX, '').trim();
        if (!query) return [{ id: 'refind-hint', label: 'h: what you are after, and when', hint: 'for example  h: cookies in the last 2 hours', icon: 'search', action: () => {} }];
        return this.find(query).then(({ rows, parsed, errors }) => {
          const out = rows.slice(0, 8).map((r, i) => ({
            id: 'refind-' + i, label: VexPlanKit.line(r.title || r.url, 70),
            hint: (r.wheres || [r.where]).join(' + ') + (r.at ? ' · ' + new Date(r.at).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : ''),
            icon: r.kind === 'note' ? 'note' : 'search',
            action: () => { try { this.openRow(r); } catch (err) { window.showToast?.(err.message, 'error'); } },
          }));
          if (!out.length) out.push({ id: 'refind-none', label: 'Nothing found' + (parsed.label ? ' for ' + parsed.label : ''), hint: errors[0] || 'Try fewer words', icon: 'search', action: () => {} });
          return out;
        }).catch(err => [{ id: 'refind-err', label: err.message, hint: 'Find by time and topic', icon: 'search', action: () => {} }]);
      },
    };
  },
  _unprovide: null,
  _syncProvider() {
    if (typeof CommandBar === 'undefined' || typeof CommandBar.registerProvider !== 'function') return;
    if (this._unprovide) { this._unprovide(); this._unprovide = null; }
    if (this.enabled()) this._unprovide = CommandBar.registerProvider(this.provider());
  },

  // ---- the dialog ------------------------------------------------------------------------------------------------
  open(initial = '') {
    if (!this.enabled()) { window.showToast?.('Find by time and topic is switched off in Settings', 'info'); return; }
    if (typeof VexUsage !== 'undefined') VexUsage.touch('refind');
    const { body } = VexSettingsGroups.dialog({ id: 'vex-refind', title: 'Find by time and topic', sub: 'Searches history, page text, notes, read-later, highlights and clips on this PC. Nothing is sent anywhere.' });
    const form = document.createElement('form');
    form.style.cssText = 'display:flex;gap:8px';
    const input = document.createElement('input');
    input.type = 'text'; input.className = 'set-input'; input.style.flex = '1'; input.value = initial;
    input.placeholder = 'cookies in the last 2 hours'; input.setAttribute('aria-label', 'What and when');
    form.append(input, VexSettingsGroups.button('Find', () => form.requestSubmit(), { primary: true }));
    const out = document.createElement('div');
    out.setAttribute('aria-live', 'polite');
    body.append(form, out);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      out.textContent = '';
      let res;
      try { res = await this.find(input.value); } catch (err) { out.appendChild(VexSettingsGroups.note(err.message)); return; }
      out.appendChild(VexSettingsGroups.note('Read as: ' + (res.parsed.terms.join(' ') || 'anything') + (res.parsed.label ? ' · ' + res.parsed.label : '') + (res.parsed.site ? ' · on ' + res.parsed.site : '')));
      if (!res.rows.length) out.appendChild(VexSettingsGroups.note('Nothing found.'));
      const list = document.createElement('div'); list.className = 'vexsr-list';
      for (const r of res.rows) {
        const { row } = VexPlanKit.listRow((r.wheres || [r.where]).join('+'), VexPlanKit.line(r.title || r.url, 80) + (r.snippet ? '  - ' + r.snippet : ''));
        row.style.cursor = 'pointer'; row.tabIndex = 0; row.setAttribute('role', 'button');
        const go = () => { try { this.openRow(r); } catch (err) { window.showToast?.(err.message, 'error'); } };
        row.addEventListener('click', go);
        row.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') go(); });
        list.appendChild(row);
      }
      out.appendChild(list);
      if (res.errors.length) out.appendChild(VexSettingsGroups.note('Could not read: ' + res.errors.join('; ')));
    });
    input.focus();
    if (initial) form.requestSubmit();
  },

  init() { this._syncProvider(); return true; },

  group(el) {
    el.appendChild(VexSettingsGroups.note('Extends the lost-tab finder: "in the last 2 hours", "since monday", "around the Discord fix", a site, and your notes, read-later, highlights and clips as well as history and page text. In Ctrl+K start with h:. Local only.'));
    el.appendChild(VexSettingsGroups.button('Find by time and topic', () => this.open(), { primary: true }));
  },
};

if (typeof window !== 'undefined') {
  window.VexRefind = VexRefind;
  if (typeof VexSettingsGroups !== 'undefined') {
    VexSettingsGroups.register({ id: 'refind', title: 'Find by time and topic', keywords: 'find lost page history last hours since around natural language search recall notes', before: 'about', build: (el) => VexRefind.group(el) });
  }
  if (typeof VexExtras !== 'undefined' && typeof VexExtras.registerCommand === 'function') {
    VexExtras.registerCommand({ id: 'refind', label: 'Find by time and topic', hint: 'In the last 2 hours, since monday, around the Discord fix...', icon: 'search', action: () => VexRefind.open() });
  }
}
if (typeof module !== 'undefined' && module.exports) module.exports = { VexRefind };

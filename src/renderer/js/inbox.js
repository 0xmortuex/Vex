// === One inbox over the many places things are kept ===========================
//
// A saved page, a highlight, a sticky note, a line from the quick-capture box
// and a note all land in a different store, and the Notes panel (307 bytes on
// the measured profile) is the one nobody opens. This is ONE READER over all
// of them: a single list, newest first, each row tagged with where it lives,
// and a single count of what arrived since the inbox was last opened.
//
//   VexInbox.collect(now, sources)   async: read every store; a store that cannot
//                                    be read is named in `errors`, the rest answer
//   VexInbox.rank(items)             pure: newest first, deduplicated
//   VexInbox.count()                 how many arrived since you last looked
//   Ctrl+K "Inbox"                   the list, with a filter per source
//   Morning Brief section "Inbox"    the count and the newest few
//
// It migrates and deletes NOTHING: every item stays in the store that holds it
// (the stores keep their own panels and sync). Opening a row goes to the page
// or the note it came from. The quick-capture box and the highlighter write
// where they always did; nothing is redirected until the owner decides that
// (see the report).

const VexInbox = {
  PREF: 'vex.inbox.enabled',     // 'off' hides the command and the brief section
  SEEN: 'vex.inbox.seen',        // when the inbox was last opened (ms)
  RECENT_DAYS: 30,
  LIMIT: 200,
  SOURCES: {
    note: 'Note', 'read-later': 'Read later', highlight: 'Highlight', sticky: 'Sticky note', capture: 'Quick capture',
    // The Notes-based capture features all write into the Notes list; the inbox tells them apart by what they leave
    // on the note, so a clipped line, a highlight note, a screenshot note and the weekly note each have their own filter.
    'clip-note': 'Clip or capture note', 'highlight-note': 'Highlights note', 'screenshot-note': 'Screenshot note', 'weekly-note': 'Weekly note',
    journal: 'Journal',
  },

  // Where a note came from. Tags are what those features already set: the weekly note ('weekly'), screenshot to note
  // ('screenshot'), clip-to-note and quick capture (AgentTools.saveNote: 'agent'); the Highlights note is found by its title.
  noteSource(n) {
    const tags = Array.isArray(n && n.tags) ? n.tags : [];
    if (tags.includes('weekly')) return 'weekly-note';
    if (tags.includes('screenshot')) return 'screenshot-note';
    if (n && n.title === 'Highlights') return 'highlight-note';
    if (tags.includes('agent')) return 'clip-note';
    return 'note';
  },

  enabled() { try { return localStorage.getItem(this.PREF) !== 'off'; } catch { return true; } },
  setEnabled(on) {
    try { localStorage.setItem(this.PREF, on ? 'on' : 'off'); }
    catch (err) { throw new Error('Could not save that setting: ' + err.message); }
    return !!on;
  },

  _json(key, fallback) {
    const raw = localStorage.getItem(key);
    if (raw == null) return fallback;
    try { return JSON.parse(raw); } catch (err) { throw new Error('"' + key + '" is not readable: ' + err.message); }
  },
  _line(text, n = 140) { const t = String(text == null ? '' : text).replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1) + '…' : t; },

  // ---- the stores (each one isolated) ----------------------------------------------
  _sources() {
    return {
      notes: () => this._json('vex.notes', []),
      readLater: () => this._json('vex.readLater', []),
      highlights: () => this._json('vex.annotations', {}),
      sticky: () => this._json('vex.stickyNotes', {}),
      journal: () => this._json('vex.journal', {}),
      captures: async () => {
        if (!window.vex || typeof window.vex.clipsInboxList !== 'function') return [];
        const r = await window.vex.clipsInboxList();
        if (!r || !r.ok) throw new Error('the capture inbox did not answer');
        return r.items || [];
      },
    };
  },

  // -> { items (unranked), errors }
  async collect(now = Date.now(), src = this._sources()) {
    const items = [];
    const errors = [];
    const since = now - this.RECENT_DAYS * 86400000;
    const guard = async (name, fn) => { try { await fn(); } catch (err) { errors.push(name + ': ' + ((err && err.message) || 'unavailable')); } };
    await guard('notes', async () => {
      for (const n of await src.notes()) {
        if (!n || !n.id) continue;
        const at = Date.parse(n.updatedAt || n.createdAt || '') || 0;
        if (at < since) continue;
        items.push({ id: 'note:' + n.id, source: this.noteSource(n), text: this._line(n.title || n.content || 'Untitled note'), sub: this._line(n.content, 90), at, noteId: n.id });
      }
    });
    // The daily journal (js/memory-tools.js) keeps one entry per day, not a list of notes.
    if (typeof src.journal === 'function') {
      await guard('journal', async () => {
        const j = await src.journal();
        for (const [day, e] of Object.entries(j && typeof j === 'object' && !Array.isArray(j) ? j : {})) {
          if (!e || !e.text || !(e.at >= since)) continue;
          items.push({ id: 'jr:' + day, source: 'journal', text: this._line('Journal ' + day), sub: this._line(String(e.text).replace(/^#.*\n+/, ''), 90), at: e.at, day });
        }
      });
    }
    await guard('read later', async () => {
      for (const i of await src.readLater()) {
        if (!i || !i.url || i.read || !(i.at >= since)) continue;
        items.push({ id: 'rl:' + (i.id || i.url), source: 'read-later', text: this._line(i.title || i.url), sub: i.url, at: i.at, url: i.url });
      }
    });
    await guard('highlights', async () => {
      const store = await src.highlights();
      for (const list of Object.values(store && typeof store === 'object' ? store : {})) {
        for (const h of Array.isArray(list) ? list : []) {
          if (!h || !h.text || !(h.at >= since)) continue;
          items.push({ id: 'hl:' + (h.id || h.at), source: 'highlight', text: this._line(h.text), sub: this._line(h.title || h.url, 90), at: h.at, url: h.url || '' });
        }
      }
    });
    await guard('sticky notes', async () => {
      for (const s of Object.values(await src.sticky() || {})) {
        if (!s || !s.text || !(s.updated >= since)) continue;
        items.push({ id: 'st:' + (s.url || s.updated), source: 'sticky', text: this._line(s.text), sub: this._line(s.title || s.url, 90), at: s.updated, url: s.url || '' });
      }
    });
    await guard('quick capture', async () => {
      for (const c of await src.captures()) {
        if (!c || !c.text || !(c.at >= since)) continue;
        items.push({ id: 'cp:' + c.id, source: 'capture', text: this._line(c.text), sub: '', at: c.at, full: String(c.text) });
      }
    });
    return { items, errors };
  },

  // Newest first; the same id once.
  rank(items, { limit = this.LIMIT, source = '' } = {}) {
    const seen = new Set();
    return (Array.isArray(items) ? items : [])
      .filter(i => i && i.id && (!source || i.source === source) && !seen.has(i.id) && seen.add(i.id))
      .sort((a, b) => b.at - a.at || a.id.localeCompare(b.id))
      .slice(0, limit);
  },

  // ---- the one count ------------------------------------------------------------------
  seenAt() { try { return Number(localStorage.getItem(this.SEEN)) || 0; } catch { return 0; } },
  markSeen(now = Date.now()) {
    try { localStorage.setItem(this.SEEN, String(now)); } catch (err) { throw new Error('Could not remember when you looked: ' + err.message); }
  },
  unseen(items, seenAt = this.seenAt()) { return (items || []).filter(i => i.at > seenAt).length; },
  async count(now = Date.now(), src) {
    const { items, errors } = await this.collect(now, src);
    return { total: items.length, unseen: this.unseen(items), errors };
  },

  // ---- opening a row -------------------------------------------------------------------
  openItem(item) {
    if (item.url && /^https?:\/\//i.test(item.url)) {
      if (typeof TabManager === 'undefined') throw new Error('Tabs are not loaded');
      TabManager.createTab(item.url, true);
      return 'tab';
    }
    if (item.source === 'journal') {
      if (typeof VexMemoryTools === 'undefined') throw new Error('The journal is not loaded');
      VexMemoryTools.openJournal();
      return 'journal';
    }
    if (item.source === 'note' || item.source === 'sticky' || /-note$/.test(item.source)) {
      if (typeof SidebarManager === 'undefined') throw new Error('Panels are not loaded');
      SidebarManager.openPanel('notes');
      if (item.noteId && typeof NotesPanel !== 'undefined' && NotesPanel.selectNote) NotesPanel.selectNote(item.noteId);
      return 'notes';
    }
    if (item.full) {
      if (!navigator.clipboard) throw new Error('The clipboard is not available');
      navigator.clipboard.writeText(item.full).then(() => window.showToast?.('Copied'), (err) => window.showToast?.('Could not copy: ' + err.message, 'error'));
      return 'copied';
    }
    throw new Error('There is nowhere to open that from');
  },

  // ---- Morning Brief section ------------------------------------------------------------
  section() {
    return {
      id: 'inbox', title: 'Inbox', icon: 'download', order: 55, defaultOn: true, maxItems: 4, ttlMs: 60000,
      build: async (ctx = {}) => {
        if (!this.enabled()) return null;
        const { items, errors } = await this.collect(ctx.now || Date.now());
        const n = this.unseen(items);
        if (!items.length && !errors.length) return null;
        return {
          summary: n ? n + ' new since you last looked' : 'Nothing new since you last looked',
          items: this.rank(items, { limit: 4 }).map(i => ({ text: i.text, sub: this.SOURCES[i.source], when: '', url: /^https?:\/\//i.test(i.url || '') ? i.url : '' })),
          note: errors.length ? 'Could not read: ' + errors.join('; ') : '',
        };
      },
    };
  },

  // ---- the list --------------------------------------------------------------------------------
  async open() {
    if (!this.enabled()) { window.showToast?.('The inbox is switched off in Settings', 'info'); return; }
    if (typeof VexUsage !== 'undefined') VexUsage.touch('inbox-unified');
    const { body } = VexSettingsGroups.dialog({ id: 'vex-inbox', title: 'Inbox', sub: 'Saved pages, highlights, sticky notes, quick captures and notes from the last ' + this.RECENT_DAYS + ' days, in one list. Nothing here is moved: each row opens where it lives.' });
    let res;
    try { res = await this.collect(); } catch (err) { body.appendChild(VexSettingsGroups.note('Could not read the inbox: ' + err.message)); return; }
    const seen = this.seenAt();
    const bar = document.createElement('div');
    bar.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px';
    const list = document.createElement('div');
    list.className = 'vexsr-list';
    let filter = '';
    const draw = () => {
      list.textContent = '';
      const rows = this.rank(res.items, { source: filter });
      if (!rows.length) list.appendChild(VexSettingsGroups.note('Nothing here.'));
      for (const it of rows) {
        const row = document.createElement('div');
        row.className = 'vexsr-rule';
        const chip = document.createElement('span');
        chip.className = 'vexsr-mode';
        chip.textContent = this.SOURCES[it.source] + (it.at > seen ? ' · new' : '');
        chip.style.minWidth = '120px';
        const text = document.createElement('span');
        text.className = 'vexsr-host';
        text.style.wordBreak = 'normal';
        text.textContent = it.text;
        const go = VexSettingsGroups.button(it.url ? 'Open' : (it.full ? 'Copy' : 'Open'), () => {
          try { this.openItem(it); } catch (err) { window.showToast?.(err.message, 'error'); }
        }, { label: 'Open ' + it.text });
        row.append(chip, text, go);
        list.appendChild(row);
      }
    };
    const chips = [['', 'All'], ...Object.entries(this.SOURCES)];
    for (const [key, label] of chips) {
      const n = key ? res.items.filter(i => i.source === key).length : res.items.length;
      bar.appendChild(VexSettingsGroups.button(label + ' ' + n, () => { filter = key; draw(); }, { label: 'Show ' + label }));
    }
    body.append(bar, list);
    if (res.errors.length) body.appendChild(VexSettingsGroups.note('Could not read: ' + res.errors.join('; ')));
    draw();
    try { this.markSeen(); } catch (err) { window.VexProblems?.note('Inbox', 'Could not remember that you looked', err); }
  },

  group(el) {
    el.appendChild(VexSettingsGroups.note('One list over your notes, saved pages, highlights, sticky notes and quick captures, with one count of what is new. It reads them where they are and moves nothing.'));
    el.appendChild(VexSettingsGroups.button('Open the inbox', () => this.open(), { primary: true }));
  },
};

if (typeof window !== 'undefined') {
  window.VexInbox = VexInbox;
  if (typeof VexBrief !== 'undefined') VexBrief.register(VexInbox.section());
  if (typeof VexSettingsGroups !== 'undefined') {
    VexSettingsGroups.register({ id: 'inbox-unified', title: 'Inbox', keywords: 'inbox captures notes read later highlights sticky quick capture one list count', before: 'about', build: (el) => VexInbox.group(el) });
  }
  if (typeof VexExtras !== 'undefined' && typeof VexExtras.registerCommand === 'function') {
    VexExtras.registerCommand({ id: 'inbox-open', label: 'Inbox', hint: 'Everything you captured, in one list', icon: 'download', action: () => VexInbox.open() });
  }
}
if (typeof module !== 'undefined' && module.exports) module.exports = { VexInbox };

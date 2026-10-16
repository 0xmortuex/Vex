// === Universal search ======================================================
//
// One box over everything you have kept: history, notes, text clips, mail
// subjects, read-later and bookmarks. Each of those has its own panel and its
// own search, and nobody remembers which one the thing was in.
//
// Nothing here is a new copy of your data. It reads the stores the panels
// already write (vex.history, vex.notes, vex.readLater, vex.bookmarks), the
// clips inbox that main keeps, and a small memo of mail HEADERS — sender,
// subject, date, never a body — made on this PC when you open the mail panel.
// Nothing is sent anywhere; the search runs here.
//
// Type filters are chips, or a prefix in the query: "mail: invoice",
// "notes: boiler", "history: github".
//
// The pure parts (parseQuery, score, search) take plain arrays, so they are
// tested without a window. `snapshot()` is the data hook for other surfaces
// (the start page, the command bar) — it returns data, it draws nothing.

const UniversalSearch = {
  MAIL_KEY: 'vex.mailHeaders',
  MAIL_ENABLED_KEY: 'vex.search.mailHeaders',
  MAIL_MAX: 500,
  DEFAULT_LIMIT: 40,

  TYPES: {
    history:  { label: 'History',    icon: 'history' },
    note:     { label: 'Notes',      icon: 'note' },
    clip:     { label: 'Clips',      icon: 'clipboard' },
    mail:     { label: 'Mail',       icon: 'mail' },
    readlater: { label: 'Read later', icon: 'book' },
    bookmark: { label: 'Bookmarks',  icon: 'bookmark' },
  },
  ALIASES: {
    history: 'history', h: 'history', visited: 'history',
    note: 'note', notes: 'note', n: 'note',
    clip: 'clip', clips: 'clip', c: 'clip',
    mail: 'mail', email: 'mail', m: 'mail',
    readlater: 'readlater', later: 'readlater', read: 'readlater', rl: 'readlater',
    bookmark: 'bookmark', bookmarks: 'bookmark', bm: 'bookmark',
  },

  // "mail: invoice" -> { types: ['mail'], text: 'invoice' }. Several prefixes
  // may be stacked: "notes: mail: boiler". An unknown prefix stays in the text
  // ("https://x" and "re: this" are searches, not filters).
  parseQuery(raw) {
    let text = String(raw == null ? '' : raw).trim();
    const types = [];
    for (;;) {
      const m = /^([a-z]+)\s*:\s*/i.exec(text);
      if (!m) break;
      const type = this.ALIASES[m[1].toLowerCase()];
      if (!type) break;
      if (!types.includes(type)) types.push(type);
      text = text.slice(m[0].length);
    }
    return { types, text: text.trim() };
  },

  _terms(text) {
    // Folded, so "istanbul" finds "İstanbul" (js/vex-tr.js); score() folds the items the same way.
    return (globalThis.VexTr || require('./vex-tr.js').VexTr).fold(text).split(/\s+/).filter(Boolean);
  },

  // Every term must be found somewhere (AND), so adding a word narrows the
  // list, as it does everywhere else. The title counts most, a match at the
  // start of a word beats the middle of one, and the exact phrase wins.
  // → 0 when something is missing.
  score(item, terms, phrase) {
    if (!terms.length) return 0;
    const tr = globalThis.VexTr || require('./vex-tr.js').VexTr;
    const title = tr.fold(item.title);
    const sub = tr.fold(item.subtitle);
    const body = tr.fold(item.body);
    let total = 0;
    for (const term of terms) {
      let s = 0;
      const ti = title.indexOf(term);
      if (ti >= 0) s += 6 + (ti === 0 || /\W/.test(title[ti - 1]) ? 3 : 0);
      const si = sub.indexOf(term);
      if (si >= 0) s += 3 + (si === 0 || /\W/.test(sub[si - 1]) ? 1 : 0);
      if (body.indexOf(term) >= 0) s += 1;
      if (!s) return 0;
      total += s;
    }
    if (phrase && terms.length > 1) {
      if (title.includes(phrase)) total += 8;
      else if (sub.includes(phrase) || body.includes(phrase)) total += 3;
    }
    return total;
  },

  // items: [{ type, id, title, subtitle?, body?, url?, at? }]
  // → the matches, best first; newer first among equals.
  search(query, items, { types = null, limit = this.DEFAULT_LIMIT } = {}) {
    const q = typeof query === 'string' ? this.parseQuery(query) : query;
    const want = new Set([...(q.types || []), ...(types || [])]);
    const terms = this._terms(q.text);
    if (!terms.length) return [];
    const phrase = terms.join(' ');
    const out = [];
    for (const item of items) {
      if (want.size && !want.has(item.type)) continue;
      const s = this.score(item, terms, phrase);
      if (s > 0) out.push({ ...item, score: s });
    }
    out.sort((a, b) => b.score - a.score || (b.at || 0) - (a.at || 0));
    return out.slice(0, limit);
  },

  // --- the sources ---------------------------------------------------------
  _json(key, fallback) {
    let raw;
    try { raw = localStorage.getItem(key); } catch (err) { throw new Error('Could not read ' + key + ': ' + err.message); }
    if (!raw) return fallback;
    try { return JSON.parse(raw); }
    catch (err) { throw new Error(key + ' is not valid JSON: ' + err.message); }
  },

  _host(url) { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; } },

  fromHistory(list) {
    return (Array.isArray(list) ? list : []).filter(e => e && e.url).map((e, i) => ({
      type: 'history', id: 'h' + (e.id || i), title: e.title || e.url, subtitle: this._host(e.url) || e.url,
      body: e.summary || e.url, url: e.url, at: e.visitedAt ? Date.parse(e.visitedAt) || 0 : (Number.isFinite(e.time) ? e.time : 0),
    }));
  },

  fromNotes(list) {
    return (Array.isArray(list) ? list : []).filter(n => n && n.id).map(n => ({
      type: 'note', id: n.id, title: n.title || 'Untitled', subtitle: (Array.isArray(n.tags) ? n.tags.map(t => '#' + t).join(' ') : ''),
      body: String(n.content || '').slice(0, 20000), at: Date.parse(n.updatedAt || n.createdAt || '') || 0,
    }));
  },

  fromClips(list) {
    return (Array.isArray(list) ? list : []).filter(c => c && c.id).map(c => ({
      type: 'clip', id: c.id, title: String(c.text).split('\n')[0].slice(0, 100), subtitle: 'Clip', body: String(c.text), at: c.at || 0,
    }));
  },

  fromMail(list) {
    return (Array.isArray(list) ? list : []).filter(m => m && m.subject != null).map(m => ({
      type: 'mail', id: 'm' + m.accountId + ':' + m.uid, title: m.subject || '(no subject)', subtitle: m.from || '',
      body: '', at: m.date || 0, accountId: m.accountId, uid: m.uid,
    }));
  },

  fromReadLater(list) {
    return (Array.isArray(list) ? list : []).filter(i => i && i.url).map(i => ({
      type: 'readlater', id: i.id || i.url, title: i.title || i.url, subtitle: this._host(i.url) + (i.read ? ' · read' : ''),
      body: i.url, url: i.url, at: i.at || 0,
    }));
  },

  fromBookmarks(list) {
    return (Array.isArray(list) ? list : []).filter(b => b && b.url).map(b => ({
      type: 'bookmark', id: b.id || b.url, title: b.title || b.url, subtitle: (b.folder ? b.folder + ' · ' : '') + this._host(b.url),
      body: b.url, url: b.url, at: b.at || 0,
    }));
  },

  // The mail memo. Headers only; capped; newest first. Off until the person
  // turns it on in Settings > Workflow and chains > Daily tools.
  mailEnabled() { try { return localStorage.getItem(this.MAIL_ENABLED_KEY) === 'on'; } catch { return false; } },
  setMailEnabled(on) {
    localStorage.setItem(this.MAIL_ENABLED_KEY, on ? 'on' : 'off');
    if (!on) this.forgetMail();
  },
  forgetMail() { localStorage.removeItem(this.MAIL_KEY); },

  // Called by the mail panel with what main sent (src/renderer/js/mail.js).
  rememberMail(accountId, inbox) {
    if (!this.mailEnabled()) return 0;
    const messages = inbox && Array.isArray(inbox.messages) ? inbox.messages : [];
    if (!messages.length) return 0;
    const known = this._json(this.MAIL_KEY, []);
    const byKey = new Map((Array.isArray(known) ? known : []).map(m => [m.accountId + ':' + m.uid, m]));
    for (const m of messages) {
      if (!Number.isInteger(m.uid)) continue;
      const from = m.from && (m.from.name || m.from.address) ? (m.from.name || m.from.address) : '';
      byKey.set(accountId + ':' + m.uid, { accountId, uid: m.uid, subject: String(m.subject || '').slice(0, 300), from: String(from).slice(0, 120), date: m.date || 0 });
    }
    const next = [...byKey.values()].sort((a, b) => (b.date || 0) - (a.date || 0)).slice(0, this.MAIL_MAX);
    localStorage.setItem(this.MAIL_KEY, JSON.stringify(next));
    return next.length;
  },

  _clips: [],
  async refreshClips() {
    if (!window.vex || typeof window.vex.clipsInboxList !== 'function') { this._clips = []; return this._clips; }
    const r = await window.vex.clipsInboxList();
    if (!r || !r.ok) throw new Error('Could not read the clips inbox');
    this._clips = r.items || [];
    return this._clips;
  },

  // Every item, from every source. Cheap enough to rebuild per search: the
  // biggest store (history) is capped at 5000 entries.
  gather() {
    return [
      ...this.fromHistory(this._json('vex.history', [])),
      ...this.fromNotes(this._json('vex.notes', [])),
      ...this.fromClips(this._clips),
      ...this.fromMail(this._json(this.MAIL_KEY, [])),
      ...this.fromReadLater(this._json('vex.readLater', [])),
      ...this.fromBookmarks(this._json('vex.bookmarks', [])),
    ];
  },

  // --- the shared index (js/search-index.js, T3-108) -----------------------------
  // Each source is rebuilt into the index only when its stored text changed; a search
  // then scores just the candidates the index names. The results are the same as
  // search(gather()): the index only narrows what is scored. A source the index
  // dropped for size is read and scanned as before.
  _indexSources() {
    const raw = (key) => { try { return localStorage.getItem(key) || ''; } catch (err) { throw new Error('Could not read ' + key + ': ' + err.message); } };
    const parse = (key, text) => {
      if (!text) return [];
      try { return JSON.parse(text); } catch (err) { throw new Error(key + ' is not valid JSON: ' + err.message); }
    };
    const stored = (name, key, from) => ({ name, text: raw(key), build: (text) => from.call(this, parse(key, text)) });
    return [
      stored('history', 'vex.history', this.fromHistory),
      stored('notes', 'vex.notes', this.fromNotes),
      stored('readlater', 'vex.readLater', this.fromReadLater),
      stored('bookmarks', 'vex.bookmarks', this.fromBookmarks),
      stored('mail', this.MAIL_KEY, this.fromMail),
      { name: 'clips', text: JSON.stringify(this._clips.map(c => [c.id, c.at, String(c.text).length])), build: () => this.fromClips(this._clips) },
    ];
  },

  // -> { counts by type, results } for a query, through the shared index.
  searchIndexed(query, { types = null, limit = this.DEFAULT_LIMIT } = {}) {
    if (typeof VexSearchIndex === 'undefined') throw new Error('The search index is not loaded (js/search-index.js)');
    const idx = VexSearchIndex.shared();
    const counts = {};
    for (const t of Object.keys(this.TYPES)) counts[t] = 0;
    const perSource = [];
    for (const s of this._indexSources()) {
      const sig = idx.signature(s.text);
      let items = null;
      if (!idx.isCurrent('universal:' + s.name, sig)) {
        items = s.build(s.text);
        idx.replace('universal:' + s.name, items, sig);
      }
      perSource.push({ s, items });
    }
    const q = typeof query === 'string' ? this.parseQuery(query) : query;
    const want = new Set([...(q.types || []), ...(types || [])]);
    const terms = this._terms(q.text);
    const phrase = terms.join(' ');
    const out = [];
    for (const { s, items } of perSource) {
      const name = 'universal:' + s.name;
      let pool = idx.isIndexed(name) ? idx.all(name) : (items || s.build(s.text));
      for (const it of pool) counts[it.type]++;
      if (!terms.length) continue;
      let cand = idx.isIndexed(name) ? idx.candidates(name, terms) : pool;
      for (const item of cand) {
        if (want.size && !want.has(item.type)) continue;
        const sc = this.score(item, terms, phrase);
        if (sc > 0) out.push({ ...item, score: sc });
      }
    }
    out.sort((a, b) => b.score - a.score || (b.at || 0) - (a.at || 0));
    return { counts, results: out.slice(0, limit) };
  },

  // Data hook: how many things each type holds, for a surface that wants to
  // say "searching 4,812 items" without owning any of this.
  snapshot() {
    const counts = {};
    for (const t of Object.keys(this.TYPES)) counts[t] = 0;
    for (const item of this.gather()) counts[item.type]++;
    return { counts, total: Object.values(counts).reduce((a, b) => a + b, 0), mailMemo: this.mailEnabled() };
  },

  // --- opening a result ----------------------------------------------------
  openResult(r) {
    if (r.url) {
      if (typeof TabManager === 'undefined') throw new Error('Tabs are not available');
      TabManager.createTab(r.url, true);
      return;
    }
    if (r.type === 'note') {
      if (typeof SidebarManager === 'undefined' || typeof NotesPanel === 'undefined') throw new Error('Notes are not available');
      SidebarManager.openPanel('notes');
      NotesPanel.selectNote(r.id);
      return;
    }
    if (r.type === 'clip') {
      if (!window.TextClips) throw new Error('The clips inbox is not available');
      window.TextClips.open();
      return;
    }
    if (r.type === 'mail') {
      if (!window.VexMail) throw new Error('Mail is not available');
      window.VexMail.open();
      return;
    }
    throw new Error('Do not know how to open a ' + r.type);
  },

  // --- the sheet -----------------------------------------------------------
  async open(initial = '') {
    const esc = (s) => window.escapeHtml(String(s == null ? '' : s));
    const { overlay, head, body, close } = window.PageExport._sheet('Search everything', 'vex-usearch-overlay');
    const chip = 'font-size:11.5px;border:1px solid var(--border);border-radius:999px;padding:2px 9px;cursor:pointer;background:none;color:var(--text)';
    const active = new Set();
    let results = [], selected = 0;
    try { await this.refreshClips(); }
    catch (err) { window.VexProblems?.note('Search', 'Could not read the clips inbox', err); }

    head.insertAdjacentHTML('beforeend', '<button data-close type="button" aria-label="Close" style="display:inline-flex;background:none;border:none;color:var(--text-muted);cursor:pointer"></button>');
    head.querySelector('[data-close]').innerHTML = window.VexIcons.svg('x', { size: 14 });
    head.querySelector('[data-close]').addEventListener('click', close);
    body.innerHTML = `
      <div style="padding:10px 14px 6px">
        <input data-q type="search" autocomplete="off" spellcheck="false" aria-label="Search history, notes, clips, mail, read later and bookmarks"
               placeholder="Search history, notes, clips, mail, read later, bookmarks" class="set-input" style="width:100%;box-sizing:border-box">
        <div data-chips style="display:flex;flex-wrap:wrap;gap:6px;margin-top:8px"></div>
      </div>
      <div data-list role="listbox" aria-label="Results" style="padding:4px 8px 10px"></div>
      <div data-foot style="padding:8px 14px;border-top:1px solid var(--border);font-size:11px;color:var(--text-muted)"></div>`;
    const input = body.querySelector('[data-q]');
    const chips = body.querySelector('[data-chips]');
    const list = body.querySelector('[data-list]');
    const foot = body.querySelector('[data-foot]');
    input.value = initial;

    const drawChips = (counts) => {
      chips.innerHTML = Object.entries(this.TYPES).map(([t, d]) =>
        `<button type="button" data-type="${t}" aria-pressed="${active.has(t)}" style="${chip};${active.has(t) ? 'border-color:var(--primary);color:var(--primary)' : ''}">${esc(d.label)} <span style="color:var(--text-muted)">${counts[t]}</span></button>`).join('');
      chips.querySelectorAll('[data-type]').forEach(b => b.addEventListener('click', () => {
        const t = b.dataset.type;
        if (active.has(t)) active.delete(t); else active.add(t);
        run();
      }));
    };

    const draw = () => {
      if (!results.length) {
        list.innerHTML = window.VexUI.emptyState('history', input.value.trim() ? 'Nothing matches' : 'Search everything you have kept', input.value.trim() ? 'Try fewer words, or clear a filter.' : 'History, notes, clips, mail subjects, read later and bookmarks — in one place.');
        return;
      }
      list.innerHTML = results.map((r, i) => `
        <button type="button" role="option" data-i="${i}" aria-selected="${i === selected}"
          style="display:flex;align-items:center;gap:10px;width:100%;text-align:left;font:inherit;padding:7px 8px;border:none;border-radius:8px;cursor:pointer;color:var(--text);background:${i === selected ? 'var(--vex-hover-fill,var(--surface))' : 'none'}">
          <span style="display:inline-flex;color:var(--text-muted)">${window.VexIcons.svg(this.TYPES[r.type].icon, { size: 15 })}</span>
          <span style="flex:1;min-width:0">
            <span style="display:block;font-size:12.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(r.title)}</span>
            <span style="display:block;font-size:10.5px;color:var(--text-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(this.TYPES[r.type].label)}${r.subtitle ? ' · ' + esc(r.subtitle) : ''}</span>
          </span>
        </button>`).join('');
      list.querySelectorAll('[data-i]').forEach(b => {
        b.addEventListener('click', () => choose(Number(b.dataset.i)));
        b.addEventListener('mouseenter', () => { selected = Number(b.dataset.i); mark(); });
      });
    };
    const mark = () => list.querySelectorAll('[data-i]').forEach(b => {
      const on = Number(b.dataset.i) === selected;
      b.setAttribute('aria-selected', String(on));
      b.style.background = on ? 'var(--vex-hover-fill,var(--surface))' : 'none';
    });
    const choose = (i) => {
      const r = results[i];
      if (!r) return;
      try { this.openResult(r); close(); }
      catch (err) { window.showToast?.(err.message, 'error'); }
    };
    const run = () => {
      let found;
      try { found = this.searchIndexed(input.value, { types: [...active] }); }
      catch (err) { list.textContent = err.message; return; }
      const counts = found.counts;
      drawChips(counts);
      results = found.results;
      selected = 0;
      draw();
      foot.textContent = Object.values(counts).reduce((a, b) => a + b, 0) + ' items searched on this PC' + (this.mailEnabled() ? '' : ' · mail subjects are off');
    };

    input.addEventListener('input', run);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') { e.preventDefault(); selected = Math.min(results.length - 1, selected + 1); mark(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); selected = Math.max(0, selected - 1); mark(); }
      else if (e.key === 'Enter') { e.preventDefault(); choose(selected); }
    });
    run();
    input.focus();
    return overlay;
  },
};

if (typeof window !== 'undefined') window.UniversalSearch = UniversalSearch;
if (typeof module !== 'undefined' && module.exports) module.exports = { UniversalSearch };

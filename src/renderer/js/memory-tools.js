// === Memory tools: journal, link memory, mini dashboards, clipboard actions,
// === game log, backup nudge ===================================================
//
// Six small things that remember or watch for the user, all local:
//
//   1. Daily journal   an end-of-day summary of what was read, done and saved.
//                      Editable, exportable as markdown.
//   2. Link memory     links that appear in notes and AI chats, searchable by
//                      title and a short summary. A local index; page titles
//                      are fetched only if the user ticks that box.
//   3. Mini dashboards GitHub Actions status, an HTTP endpoint check and a
//                      server reachability check. Only addresses the user typed,
//                      short timeouts, no credentials anywhere.
//   4. Clipboard       when a page copy looks like a tracking number, a date or
//      actions         an address, OFFER track / add reminder / open map.
//                      Opt-in. It never reads the clipboard: it is told about
//                      copies by ClipboardHistory (page copies only) and stays
//                      silent during a game or while Vex is not in front.
//   5. Game log        one line per finished game: when, how long, tabs slept
//                      and closed. Shown in Settings and the weekly review.
//   6. Backup nudge    a weekly offer to export notes, bookmarks and settings
//                      through VexBackup (which never includes secrets).
//
// Brief-ready modules: this file pushes { id, title, build(), isEnabled() }
// objects onto window.VexBriefModules (and keeps them on
// VexMemoryTools.briefModules). build() resolves to
//   { id, title, items: [{ text, detail?, url?, state? }], empty? }
// where state is 'ok' | 'warn' | 'down' for dashboard rows.
//
// Everything is stored in localStorage under vex.* keys, so the ordinary
// backup carries it and none of it is a secret.
const VexMemoryTools = {
  KEYS: {
    settings: 'vex.memtools.settings',
    journal: 'vex.journal',
    links: 'vex.linkMemory',
    widgets: 'vex.dash.widgets',
    gameLog: 'vex.gameLog',
    lastBackup: 'vex.backup.lastAt',
    lastNudge: 'vex.memtools.lastNudge',
    firstSeen: 'vex.memtools.firstSeen',
  },
  // feature on/off, and whether it also shows in the brief. The clipboard
  // actions and the title fetch are the two that contact or watch something, so
  // they are off until asked for.
  DEFAULTS: {
    journal: true, links: true, dashboards: true, clipboard: false, gameLog: true, backup: true,
    fetchTitles: false,
    brief: { journal: true, links: true, dashboards: true, gameLog: true, backup: true },
  },
  MAX_JOURNAL_DAYS: 120,
  MAX_LINKS: 500,
  MAX_WIDGETS: 8,
  MAX_GAME_LOG: 200,
  MIN_GAME_MS: 30000,
  CHECK_TIMEOUT_MS: 4000,
  BACKUP_EVERY_MS: 7 * 24 * 3600000,

  _wired: false,
  _timers: [],
  _game: null,            // { app, start, report, closed, poll }
  _offered: new Map(),    // text -> time, so the same copy is not offered twice
  _lastOffer: 0,
  _dashCache: new Map(),  // widget id -> { at, result }

  _note(what, err) { try { window.VexProblems?.note('Memory tools', what, err); } catch { /* nothing to tell */ } },

  // ---- storage ---------------------------------------------------------------
  _read(key, fallback) {
    let raw = null;
    try { raw = localStorage.getItem(key); } catch { return fallback; }
    if (raw == null || raw === '') return fallback;
    try { return JSON.parse(raw); }
    catch (err) { this._note('A saved list could not be read and was ignored: ' + key, err); return fallback; }
  },
  _write(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); }
    catch (err) { this._note('Could not save ' + key, err); throw new Error('Could not save: ' + err.message); }
  },

  settings() {
    const s = this._read(this.KEYS.settings, {});
    const d = this.DEFAULTS;
    const o = s && typeof s === 'object' && !Array.isArray(s) ? s : {};
    const brief = o.brief && typeof o.brief === 'object' ? o.brief : {};
    const out = { brief: {} };
    for (const k of ['journal', 'links', 'dashboards', 'clipboard', 'gameLog', 'backup', 'fetchTitles']) out[k] = typeof o[k] === 'boolean' ? o[k] : d[k];
    for (const k of Object.keys(d.brief)) out.brief[k] = typeof brief[k] === 'boolean' ? brief[k] : d.brief[k];
    return out;
  },
  setSetting(name, on, inBrief) {
    const s = this.settings();
    if (inBrief) {
      if (!(name in this.DEFAULTS.brief)) throw new Error('Unknown brief section ' + name);
      s.brief[name] = !!on;
    } else {
      if (!(name in this.DEFAULTS) || name === 'brief') throw new Error('Unknown setting ' + name);
      s[name] = !!on;
    }
    this._write(this.KEYS.settings, s);
    return s;
  },

  // ---- small helpers ---------------------------------------------------------
  _pad(n) { return String(n).padStart(2, '0'); },
  dayKey(ms) { const d = new Date(ms); return d.getFullYear() + '-' + this._pad(d.getMonth() + 1) + '-' + this._pad(d.getDate()); },
  dayBounds(key) {
    const [y, m, d] = key.split('-').map(Number);
    const from = new Date(y, m - 1, d, 0, 0, 0, 0).getTime();
    return { from, to: from + 24 * 3600000 };
  },
  dayLabel(key) { const b = this.dayBounds(key); return new Date(b.from).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' }); },
  _hostOf(url) { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; } },
  _clip(s, n) { const t = String(s == null ? '' : s).replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1) + '…' : t; },
  _mdText(s) { return String(s == null ? '' : s).replace(/\s+/g, ' ').replace(/([[\]])/g, '\\$1').trim(); },
  _duration(ms) {
    const m = Math.max(1, Math.round(ms / 60000));
    if (m < 60) return m + ' min';
    const h = Math.floor(m / 60), r = m % 60;
    return h + ' h' + (r ? ' ' + r + ' min' : '');
  },
  _gameActive() {
    try { if (typeof GameSession !== 'undefined' && GameSession.active) return true; } catch { /* treated as not active */ }
    try { if (typeof GameMode !== 'undefined' && GameMode.gaming) return true; } catch { /* treated as not active */ }
    return !!this._game;
  },
  // Only when somebody is looking at Vex.
  _inFront() {
    return document.visibilityState === 'visible' && (typeof document.hasFocus !== 'function' || document.hasFocus());
  },
  _openTab(url) {
    if (!/^https?:\/\//i.test(url)) throw new Error('Only a web address can be opened');
    if (typeof TabManager === 'undefined') throw new Error('Tabs are not available');
    TabManager.createTab(url, true);
  },
  _download(text, name, type) {
    const url = URL.createObjectURL(new Blob([text], { type: type || 'text/markdown' }));
    const a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  },
  _icon(name, size) { return (window.VexIcons && VexIcons.has && VexIcons.has(name)) ? VexIcons.svg(name, { size: size || 14 }) : ''; },

  // ============================================================================
  // 1. Daily journal
  // ============================================================================
  journal() {
    const j = this._read(this.KEYS.journal, {});
    return j && typeof j === 'object' && !Array.isArray(j) ? j : {};
  },
  _saveJournal(j) {
    const keys = Object.keys(j).sort();
    while (keys.length > this.MAX_JOURNAL_DAYS) delete j[keys.shift()];
    this._write(this.KEYS.journal, j);
  },

  // What happened on one local day, from data Vex already holds.
  async gather(key) {
    const { from, to } = this.dayBounds(key);
    const inDay = (ms) => Number.isFinite(ms) && ms >= from && ms < to;
    const out = { read: [], done: [], saved: [], games: [], errors: [] };
    try {
      const hist = this._read('vex.history', []);
      const seen = new Set();
      for (const e of Array.isArray(hist) ? hist : []) {
        if (!e || !/^https?:\/\//i.test(String(e.url || ''))) continue;
        const at = e.visitedAt ? Date.parse(e.visitedAt) : e.time;
        if (!inDay(at) || seen.has(e.url)) continue;
        seen.add(e.url);
        out.read.push({ title: this._clip(e.title && e.title !== e.url ? e.title : this._hostOf(e.url), 120), url: e.url, at });
      }
      out.read.sort((a, b) => a.at - b.at);
    } catch (err) { out.errors.push('history'); this._note('Journal could not read the history', err); }
    try {
      const b = window.vex && window.vex.reminders;
      if (b && typeof b.list === 'function') {
        for (const r of await b.list()) {
          if (!r || r.kind === 'review') continue;
          const at = r.firedAt || r.lastFiredAt;
          if (inDay(at)) out.done.push({ text: 'Reminder: ' + this._clip(r.message, 140), at });
        }
      }
    } catch (err) { out.errors.push('reminders'); this._note('Journal could not read the reminders', err); }
    try {
      const notes = this._read('vex.notes', []);
      for (const n of Array.isArray(notes) ? notes : []) {
        if (!n) continue;
        const title = this._clip(n.title || 'Untitled note', 100);
        if (inDay(n.createdAt)) out.done.push({ text: 'Wrote a note: ' + title, at: n.createdAt });
        else if (inDay(n.updatedAt)) out.done.push({ text: 'Edited a note: ' + title, at: n.updatedAt });
      }
    } catch (err) { out.errors.push('notes'); this._note('Journal could not read the notes', err); }
    try {
      const rl = this._read('vex.readLater', []);
      for (const i of Array.isArray(rl) ? rl : []) {
        if (i && inDay(i.at)) out.saved.push({ title: this._clip(i.title || i.url, 120), url: i.url, at: i.at });
      }
    } catch (err) { out.errors.push('read later'); this._note('Journal could not read the reading list', err); }
    try {
      for (const g of this.gameLog()) if (inDay(g.start)) out.games.push(g);
    } catch (err) { out.errors.push('games'); this._note('Journal could not read the game log', err); }
    out.done.sort((a, b) => a.at - b.at);
    return out;
  },

  _link(title, url) { return url ? '[' + this._mdText(title) + '](' + url.replace(/\)/g, '%29') + ')' : this._mdText(title); },

  compose(key, data) {
    const lines = ['# Journal — ' + this.dayLabel(key), ''];
    const MAX = 15;
    const section = (title, rows, render) => {
      if (!rows.length) return;
      lines.push('## ' + title, '');
      for (const r of rows.slice(0, MAX)) lines.push('- ' + render(r));
      if (rows.length > MAX) lines.push('- …and ' + (rows.length - MAX) + ' more');
      lines.push('');
    };
    section('Read', data.read, (r) => this._link(r.title, r.url));
    section('Done', data.done, (r) => this._mdText(r.text));
    section('Saved', data.saved, (r) => this._link(r.title, r.url));
    section('Games', data.games, (g) => this._mdText(this.gameLine(g)));
    if (lines.length === 2) lines.push('Nothing was recorded.', '');
    return lines.join('\n').replace(/\n+$/, '\n');
  },

  _hasContent(d) { return !!(d.read.length || d.done.length || d.saved.length || d.games.length); },

  // Write one day's entry unless one is there already. Returns the entry, or
  // null when there was nothing to write.
  async ensureDay(key, { force = false } = {}) {
    const j = this.journal();
    if (j[key] && !force) return j[key];
    if (j[key] && j[key].edited && force !== 'overwrite') return j[key];
    const data = await this.gather(key);
    if (!this._hasContent(data) && !force) return null;
    const entry = { text: this.compose(key, data), at: Date.now(), edited: false };
    const fresh = this.journal();
    fresh[key] = entry;
    this._saveJournal(fresh);
    return entry;
  },

  // Today's entry once it is evening; earlier days that have none yet.
  async tickJournal() {
    if (!this.settings().journal) return;
    const now = new Date();
    const keys = [];
    for (let i = 1; i <= 7; i++) keys.push(this.dayKey(now.getTime() - i * 24 * 3600000));
    for (const key of keys) {
      try { await this.ensureDay(key); } catch (err) { this._note('Could not write the journal for ' + key, err); }
    }
    if (now.getHours() >= 21) {
      try { await this.ensureDay(this.dayKey(now.getTime())); } catch (err) { this._note('Could not write today’s journal', err); }
    }
  },

  saveEntry(key, text) {
    const j = this.journal();
    j[key] = { text: String(text), at: Date.now(), edited: true };
    this._saveJournal(j);
    return j[key];
  },
  deleteEntry(key) {
    const j = this.journal();
    if (!j[key]) throw new Error('There is no journal entry for that day');
    delete j[key];
    this._write(this.KEYS.journal, j);
  },
  exportMarkdown(keys) {
    const j = this.journal();
    const days = (keys && keys.length ? keys : Object.keys(j)).filter(k => j[k]).sort();
    if (!days.length) throw new Error('There is no journal to export yet');
    const text = days.map(k => j[k].text.replace(/\s+$/, '')).join('\n\n---\n\n') + '\n';
    this._download(text, days.length === 1 ? 'vex-journal-' + days[0] + '.md' : 'vex-journal-' + days[0] + '-to-' + days[days.length - 1] + '.md');
    return days.length;
  },

  // ---- overlay chrome shared by the three screens ----------------------------
  _overlay(id, title) {
    document.getElementById(id)?.remove();
    const wrap = document.createElement('div');
    wrap.id = id;
    wrap.className = 'vex-clip-overlay';
    wrap.style.cssText = 'position:fixed;inset:0;z-index:10000;background:rgba(0,0,0,0.38);display:grid;place-items:start center;padding-top:8vh';
    const box = document.createElement('div');
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');
    box.setAttribute('aria-label', title);
    box.style.cssText = 'width:min(760px,94vw);max-height:80vh;display:flex;flex-direction:column;background:var(--bg);color:var(--text);border:1px solid var(--border);border-radius:12px;box-shadow:0 18px 50px var(--vex-shadow-color,rgba(0,0,0,0.45));overflow:hidden';
    const head = document.createElement('div');
    head.style.cssText = 'display:flex;align-items:center;gap:8px;padding:12px 14px;border-bottom:1px solid var(--border)';
    const h = document.createElement('div');
    h.style.cssText = 'flex:1;font-size:13.5px;font-weight:650';
    h.textContent = title;
    const x = document.createElement('button');
    x.type = 'button'; x.title = 'Close'; x.setAttribute('aria-label', 'Close');
    x.style.cssText = 'background:none;border:none;cursor:pointer;padding:4px;color:var(--text-muted)';
    x.innerHTML = this._icon('x', 14);
    head.append(h, x);
    const body = document.createElement('div');
    body.style.cssText = 'overflow:auto;padding:10px 14px;display:flex;flex-direction:column;gap:8px';
    box.append(head, body);
    wrap.appendChild(box);
    const onKey = (e) => {
      if (!wrap.isConnected) { document.removeEventListener('keydown', onKey, true); return; }
      if (e.key === 'Escape' && !document.querySelector('.vex-dialog-overlay')) { e.preventDefault(); e.stopPropagation(); close(); }
    };
    const close = () => { document.removeEventListener('keydown', onKey, true); wrap.remove(); };
    document.addEventListener('keydown', onKey, true);
    wrap.addEventListener('mousedown', (e) => { if (e.target === wrap) close(); });
    x.addEventListener('click', close);
    document.body.appendChild(wrap);
    if (typeof VexLayer !== 'undefined') VexLayer.track(wrap, { tier: 'dialog', id: 'memory-tools' });
    return { wrap, box, body, close };
  },
  _btn(label, onClick, { primary = false, title } = {}) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    if (title) b.title = title;
    b.style.cssText = 'font-size:12px;border:1px solid var(--border);border-radius:6px;padding:4px 10px;cursor:pointer;color:' + (primary ? 'var(--text-on-primary,#fff)' : 'var(--text)') + ';background:' + (primary ? 'var(--primary)' : 'none');
    b.addEventListener('click', onClick);
    return b;
  },
  _fail(err) { window.showToast?.((err && err.message) || String(err), 'error'); },

  async openJournal() {
    try { await this.tickJournal(); } catch (err) { this._fail(err); }
    const ui = this._overlay('vex-journal', 'Journal');
    const grid = document.createElement('div');
    grid.style.cssText = 'display:grid;grid-template-columns:170px 1fr;gap:10px;min-height:320px';
    const list = document.createElement('div');
    list.style.cssText = 'display:flex;flex-direction:column;gap:4px;overflow:auto;max-height:56vh';
    const pane = document.createElement('div');
    pane.style.cssText = 'display:flex;flex-direction:column;gap:8px;min-width:0';
    grid.append(list, pane);
    ui.body.appendChild(grid);
    const note = document.createElement('div');
    note.style.cssText = 'font-size:11px;color:var(--text-muted)';
    note.textContent = 'Written by Vex at the end of each day from your history, reminders, notes and saved pages. It stays on this computer. Edit it freely; an edited day is never rewritten unless you ask.';
    ui.body.appendChild(note);

    let current = null;
    const show = (key) => {
      current = key;
      const j = this.journal();
      pane.textContent = '';
      const entry = j[key];
      if (!entry) {
        const p = document.createElement('div');
        p.style.cssText = 'font-size:12.5px;color:var(--text-muted)';
        p.textContent = 'No entry for ' + this.dayLabel(key) + '.';
        pane.appendChild(p);
        pane.appendChild(this._btn('Write it now', async () => { try { const e = await this.ensureDay(key, { force: true }); if (!e) throw new Error('Nothing to write'); draw(); show(key); } catch (err) { this._fail(err); } }));
        return;
      }
      const ta = document.createElement('textarea');
      ta.value = entry.text;
      ta.setAttribute('aria-label', 'Journal for ' + this.dayLabel(key));
      ta.style.cssText = 'flex:1;min-height:260px;resize:vertical;font:12.5px/1.5 var(--font-mono,monospace);background:var(--surface);color:var(--text);border:1px solid var(--border);border-radius:8px;padding:8px';
      const bar = document.createElement('div');
      bar.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap;align-items:center';
      const status = document.createElement('span');
      status.style.cssText = 'font-size:11px;color:var(--text-muted);margin-left:auto';
      status.textContent = entry.edited ? 'Edited by you' : 'Written by Vex';
      bar.append(
        this._btn('Save', () => { try { this.saveEntry(key, ta.value); status.textContent = 'Saved'; draw(); } catch (err) { this._fail(err); } }, { primary: true }),
        this._btn('Export this day', () => { try { this.saveEntry(key, ta.value); this.exportMarkdown([key]); } catch (err) { this._fail(err); } }),
        this._btn('Export all', () => { try { const n = this.exportMarkdown(); window.showToast?.('Exported ' + n + ' day' + (n === 1 ? '' : 's') + ' to Downloads'); } catch (err) { this._fail(err); } }),
        this._btn('Write it again', async () => {
          try {
            const j2 = this.journal();
            if (j2[key] && (j2[key].edited || ta.value !== j2[key].text)) {
              const ok = await window.vexConfirm({ title: 'Write this day again?', message: 'Your edits to ' + this.dayLabel(key) + ' are replaced by a fresh summary.', okLabel: 'Replace', danger: true });
              if (!ok) return;
            }
            await this.ensureDay(key, { force: 'overwrite' });
            show(key); draw();
          } catch (err) { this._fail(err); }
        }),
        this._btn('Delete', async () => {
          try {
            const ok = await window.vexConfirm({ title: 'Delete this day?', message: this.dayLabel(key) + ' is removed from the journal.', okLabel: 'Delete', danger: true });
            if (!ok) return;
            this.deleteEntry(key); current = null; draw(); pane.textContent = '';
          } catch (err) { this._fail(err); }
        }),
        status);
      pane.append(ta, bar);
    };
    const draw = () => {
      list.textContent = '';
      const keys = Object.keys(this.journal()).sort().reverse();
      if (!keys.length) {
        const e = document.createElement('div');
        e.style.cssText = 'font-size:12px;color:var(--text-muted)';
        e.textContent = 'Nothing yet. The first entry is written this evening.';
        list.appendChild(e);
      }
      for (const k of keys) {
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = this.dayLabel(k).replace(/,? \d{4}$/, '');
        b.style.cssText = 'text-align:left;font-size:12px;padding:6px 8px;border-radius:6px;border:1px solid ' + (k === current ? 'var(--primary)' : 'transparent') + ';background:' + (k === current ? 'var(--vex-hover-fill,var(--surface))' : 'none') + ';color:var(--text);cursor:pointer';
        b.addEventListener('click', () => { show(k); draw(); });
        list.appendChild(b);
      }
      const t = this.dayKey(Date.now());
      if (!this.journal()[t]) {
        list.appendChild(this._btn('Write today now', async () => { try { const e = await this.ensureDay(t, { force: true }); if (e) { current = t; show(t); draw(); } } catch (err) { this._fail(err); } }));
      }
    };
    const first = Object.keys(this.journal()).sort().reverse()[0];
    if (first) current = first;
    draw();
    if (first) show(first);
    return ui;
  },

  // ============================================================================
  // 2. Link memory
  // ============================================================================
  linkIndex() {
    const o = this._read(this.KEYS.links, { items: [], ignored: [] });
    const items = o && Array.isArray(o.items) ? o.items.filter(i => i && typeof i.url === 'string') : [];
    const ignored = o && Array.isArray(o.ignored) ? o.ignored.filter(s => typeof s === 'string') : [];
    return { items, ignored };
  },
  _saveLinks(idx) {
    idx.items = idx.items.slice(0, this.MAX_LINKS);
    idx.ignored = idx.ignored.slice(0, this.MAX_LINKS);
    this._write(this.KEYS.links, idx);
  },

  // A link that carries something secret in it is not indexed at all.
  _urlSafe(raw) {
    let u;
    try { u = new URL(raw); } catch { return null; }
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    if (u.username || u.password) return null;
    for (const [k, v] of u.searchParams) {
      if (/token|secret|passw|auth|sig(nature)?$|session|credential|api[_-]?key|^key$|code$/i.test(k)) return null;
      if (/^[A-Za-z0-9_\-+/=]{40,}$/.test(v)) return null;
    }
    u.hash = '';
    return u.href;
  },

  // Every link in a piece of text with the words around it.
  extractLinks(text, fallbackTitle) {
    const out = [];
    const src = String(text || '');
    const md = /\[([^\]\n]{1,200})\]\((https?:\/\/[^\s)]+)\)/g;
    let m;
    const taken = new Set();
    while ((m = md.exec(src))) {
      const url = this._urlSafe(m[2]);
      if (url && !taken.has(url)) { taken.add(url); out.push({ url, title: this._clip(m[1], 140), context: this._contextOf(src, m.index, m[0].length, fallbackTitle) }); }
    }
    const re = /https?:\/\/[^\s<>"'`)\]]+/g;
    while ((m = re.exec(src))) {
      const cleaned = m[0].replace(/[.,;:!?]+$/, '');
      const url = this._urlSafe(cleaned);
      if (url && !taken.has(url)) { taken.add(url); out.push({ url, title: '', context: this._contextOf(src, m.index, cleaned.length, fallbackTitle) }); }
    }
    return out;
  },
  _contextOf(src, at, len, fallback) {
    const s = src.lastIndexOf('\n', at - 1) + 1;
    let e = src.indexOf('\n', at + len);
    if (e < 0) e = src.length;
    const line = src.slice(s, e).replace(/\[([^\]]*)\]\(https?:\/\/[^)]*\)/g, '$1').replace(/https?:\/\/\S+/g, '').replace(/^[\s>#*\-\d.)]+/, '');
    return this._clip(line || fallback || '', 160);
  },

  // Look through notes and saved AI chats. Private chats are not on disk, so
  // they are not here either.
  scanLinks() {
    if (!this.settings().links) return 0;
    const idx = this.linkIndex();
    const known = new Set(idx.items.map(i => i.url));
    const ignored = new Set(idx.ignored);
    const found = [];
    const add = (list, source, at) => { for (const l of list) if (!known.has(l.url) && !ignored.has(l.url)) { known.add(l.url); found.push({ ...l, source, at }); } };
    try {
      const notes = this._read('vex.notes', []);
      for (const n of Array.isArray(notes) ? notes : []) {
        if (!n || typeof n.content !== 'string') continue;
        const t = this._clip(n.title || 'Untitled note', 60);
        add(this.extractLinks((n.title || '') + '\n' + n.content, n.title || ''), 'Note: ' + t, n.updatedAt || n.createdAt || Date.now());
      }
    } catch (err) { this._note('Link memory could not read the notes', err); }
    try {
      const chats = this._read('vex.aiConversations', {});
      for (const msgs of Object.values(chats && typeof chats === 'object' ? chats : {})) {
        if (!Array.isArray(msgs)) continue;
        for (const m of msgs) if (m && typeof m.content === 'string') add(this.extractLinks(m.content, ''), 'AI chat', m.at || Date.now());
      }
    } catch (err) { this._note('Link memory could not read the chats', err); }
    for (const f of found) {
      idx.items.unshift({ url: f.url, title: f.title || this._shortUrl(f.url), summary: f.context || '', host: this._hostOf(f.url), source: f.source, at: f.at || Date.now(), titled: !!f.title });
    }
    if (found.length) { idx.items.sort((a, b) => (b.at || 0) - (a.at || 0)); this._saveLinks(idx); }
    if (this.settings().fetchTitles) this.fetchTitles().catch(err => this._note('Link titles could not be fetched', err));
    return found.length;
  },
  _shortUrl(url) { try { const u = new URL(url); return this._clip(u.hostname.replace(/^www\./, '') + (u.pathname === '/' ? '' : u.pathname), 90); } catch { return this._clip(url, 90); } },

  // Opt-in: contacts the linked site once per link, three at a time at most,
  // without cookies or a referrer.
  async fetchTitles(limit = 3) {
    const fetcher = window.VexNet && window.VexNet.fetch;
    if (!fetcher) throw new Error('The network helper is not available');
    if (this._gameActive() || !this._inFront()) return 0;
    const idx = this.linkIndex();
    const todo = idx.items.filter(i => !i.titled && !i.fetchedAt && /^https:/i.test(i.url) && !this._isPrivateHost(i.url)).slice(0, limit);
    let n = 0;
    for (const item of todo) {
      item.fetchedAt = Date.now();
      try {
        const r = await fetcher(item.url, { credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store', timeoutMs: 6000, maxBytes: 400000, headers: { Accept: 'text/html' } });
        if (!r.ok || !/html/i.test(r.headers.get('content-type') || '')) continue;
        const html = (await r.text()).slice(0, 200000);
        const doc = new DOMParser().parseFromString(html, 'text/html');
        const title = this._clip(doc.querySelector('title')?.textContent || '', 140);
        const desc = this._clip(doc.querySelector('meta[name="description"],meta[property="og:description"]')?.getAttribute('content') || '', 200);
        if (title) { item.title = title; item.titled = true; }
        if (desc) item.summary = desc;
        n++;
      } catch (err) { this._note('Could not read the title of ' + item.host, err); }
    }
    this._saveLinks(idx);
    return n;
  },
  _isPrivateHost(url) {
    let h = '';
    try { h = new URL(url).hostname.toLowerCase(); } catch { return true; }
    if (h === 'localhost' || h.endsWith('.local') || h.endsWith('.internal') || !h.includes('.')) return true;
    if (/^\d+\.\d+\.\d+\.\d+$/.test(h)) {
      const [a, b] = h.split('.').map(Number);
      return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
    }
    return h.startsWith('[') || h.includes(':');
  },

  searchLinks(query) {
    const q = String(query || '').toLowerCase().split(/\s+/).filter(Boolean);
    const items = this.linkIndex().items;
    if (!q.length) return items;
    return items.filter(i => { const hay = (i.title + ' ' + i.summary + ' ' + i.url + ' ' + i.source).toLowerCase(); return q.every(t => hay.includes(t)); });
  },
  forgetLink(url) {
    const idx = this.linkIndex();
    idx.items = idx.items.filter(i => i.url !== url);
    if (!idx.ignored.includes(url)) idx.ignored.unshift(url);
    this._saveLinks(idx);
  },
  clearLinks() {
    const idx = this.linkIndex();
    idx.ignored = idx.items.map(i => i.url).concat(idx.ignored);
    idx.items = [];
    this._saveLinks(idx);
  },

  openLinks() {
    this.scanLinks();
    const ui = this._overlay('vex-link-memory', 'Link memory');
    const input = document.createElement('input');
    input.type = 'search';
    input.placeholder = 'Search links by title, words around them, or address';
    input.setAttribute('aria-label', 'Search links');
    input.style.cssText = 'padding:8px 10px;border:1px solid var(--border);border-radius:8px;background:var(--surface);color:var(--text);font-size:13px';
    const list = document.createElement('div');
    list.style.cssText = 'display:flex;flex-direction:column;gap:4px';
    const foot = document.createElement('div');
    foot.style.cssText = 'font-size:11px;color:var(--text-muted)';
    foot.textContent = 'Links found in your notes and saved AI chats, kept on this computer. Pages are not downloaded unless you turn on title lookup in Settings.';
    ui.body.append(input, list, foot);
    const draw = () => {
      list.textContent = '';
      const rows = this.searchLinks(input.value).slice(0, 80);
      if (!rows.length) {
        const e = document.createElement('div');
        e.style.cssText = 'font-size:12.5px;color:var(--text-muted);padding:14px 4px';
        e.textContent = input.value ? 'No saved link matches.' : 'No links yet. Links you put in notes or AI chats appear here.';
        list.appendChild(e);
        return;
      }
      for (const it of rows) {
        const row = document.createElement('div');
        row.style.cssText = 'display:flex;align-items:center;gap:8px;padding:7px 8px;border-radius:8px;cursor:pointer';
        row.addEventListener('mouseenter', () => { row.style.background = 'var(--vex-hover-fill,var(--surface))'; });
        row.addEventListener('mouseleave', () => { row.style.background = ''; });
        const txt = document.createElement('div');
        txt.style.cssText = 'flex:1;min-width:0';
        const t = document.createElement('div');
        t.style.cssText = 'font-size:12.5px;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
        t.textContent = it.title;
        const s = document.createElement('div');
        s.style.cssText = 'font-size:11px;color:var(--text-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
        s.textContent = [it.summary, it.host, it.source].filter(Boolean).join(' · ');
        txt.append(t, s);
        const rm = document.createElement('button');
        rm.type = 'button'; rm.title = 'Forget this link'; rm.setAttribute('aria-label', 'Forget this link');
        rm.style.cssText = 'background:none;border:none;cursor:pointer;padding:4px;color:var(--text-muted)';
        rm.innerHTML = this._icon('x', 13);
        rm.addEventListener('click', (e) => { e.stopPropagation(); this.forgetLink(it.url); draw(); });
        row.addEventListener('click', () => { try { this._openTab(it.url); ui.close(); } catch (err) { this._fail(err); } });
        row.append(txt, rm);
        list.appendChild(row);
      }
    };
    input.addEventListener('input', draw);
    draw();
    setTimeout(() => input.focus(), 30);
    return ui;
  },

  // ============================================================================
  // 3. Mini dashboards
  // ============================================================================
  widgets() {
    const w = this._read(this.KEYS.widgets, []);
    return Array.isArray(w) ? w.filter(x => x && typeof x.id === 'string' && ['github', 'http', 'ping'].includes(x.type) && typeof x.target === 'string') : [];
  },

  // One checked place for what may be monitored. Throws with a plain reason.
  validateTarget(type, target) {
    const t = String(target || '').trim();
    if (type === 'github') {
      if (!/^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/.test(t)) throw new Error('Give the repository as owner/name, for example vercel/next.js');
      return t;
    }
    let u;
    try { u = new URL(/^https?:\/\//i.test(t) ? t : 'https://' + t); } catch { throw new Error('That is not a web address'); }
    const local = u.hostname === 'localhost' || u.hostname === '127.0.0.1';
    if (u.protocol !== 'https:' && !(u.protocol === 'http:' && local)) throw new Error('Only https:// addresses (or http://localhost) can be checked');
    if (u.username || u.password) throw new Error('Do not put a user name or password in the address');
    for (const [k, v] of u.searchParams) {
      if (/token|secret|passw|auth|sig(nature)?$|session|credential|api[_-]?key|^key$/i.test(k) || /^[A-Za-z0-9_\-+/=]{40,}$/.test(v)) {
        throw new Error('The address carries what looks like a secret (' + k + '). Use an address that works without one.');
      }
    }
    if (type === 'ping') { u.pathname = '/'; u.search = ''; }
    u.hash = '';
    return u.href;
  },
  addWidget({ type, target, label }) {
    const list = this.widgets();
    if (list.length >= this.MAX_WIDGETS) throw new Error('A dashboard holds ' + this.MAX_WIDGETS + ' widgets at most');
    const clean = this.validateTarget(type, target);
    if (list.some(w => w.type === type && w.target === clean)) throw new Error('That is already on the dashboard');
    const w = { id: 'w_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), type, target: clean, label: this._clip(label || (type === 'github' ? clean : this._hostOf(clean)), 60) };
    list.push(w);
    this._write(this.KEYS.widgets, list);
    return w;
  },
  removeWidget(id) {
    const list = this.widgets();
    if (!list.some(w => w.id === id)) throw new Error('That widget is not on the dashboard');
    this._write(this.KEYS.widgets, list.filter(w => w.id !== id));
    this._dashCache.delete(id);
  },

  // -> { state: 'ok'|'warn'|'down', detail }
  async check(w) {
    const fetcher = window.VexNet && window.VexNet.fetch;
    if (!fetcher) throw new Error('The network helper is not available');
    const base = { credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store', timeoutMs: this.CHECK_TIMEOUT_MS, maxBytes: 262144 };
    if (w.type === 'github') {
      let r;
      try { r = await (typeof GitHubVault !== 'undefined' ? GitHubVault.fetch.bind(GitHubVault) : fetcher)('https://api.github.com/repos/' + w.target + '/actions/runs?per_page=1', { ...base, headers: { Accept: 'application/vnd.github+json' } }); }
      catch (err) { return { state: 'down', detail: 'GitHub could not be reached: ' + ((err && err.message) || 'unknown') }; }
      if (r.status === 404) return { state: 'warn', detail: 'No such public repository' };
      if (r.status === 403 || r.status === 429) return { state: 'warn', detail: 'GitHub asked Vex to slow down' };
      if (!r.ok) return { state: 'warn', detail: 'GitHub answered ' + r.status };
      const run = ((await r.json()).workflow_runs || [])[0];
      if (!run) return { state: 'warn', detail: 'No workflow runs yet' };
      const ago = this._ago(Date.parse(run.updated_at || run.created_at));
      if (run.status !== 'completed') return { state: 'warn', detail: (run.name || 'Workflow') + ' is ' + run.status.replace('_', ' ') + ' · ' + ago, url: run.html_url };
      const ok = run.conclusion === 'success';
      return { state: ok ? 'ok' : (run.conclusion === 'cancelled' || run.conclusion === 'skipped' ? 'warn' : 'down'), detail: (run.name || 'Workflow') + ' ' + run.conclusion + ' · ' + ago, url: run.html_url };
    }
    const started = performance.now();
    const ms = () => Math.round(performance.now() - started) + ' ms';
    try {
      const r = await fetcher(w.target, { ...base, method: 'GET' });
      if (w.type === 'ping') return { state: 'ok', detail: 'Reachable · ' + ms() };
      return { state: r.ok ? 'ok' : (r.status >= 500 ? 'down' : 'warn'), detail: 'HTTP ' + r.status + ' · ' + ms() };
    } catch (err) {
      const msg = (err && err.message) || '';
      if (/too large/i.test(msg)) return { state: 'ok', detail: 'Reachable · ' + ms() };
      if (/timed out/i.test(msg)) return { state: 'down', detail: 'No answer in ' + Math.round(this.CHECK_TIMEOUT_MS / 1000) + ' s' };
      // Blocked by the site's cross-origin rules looks the same as unreachable;
      // a second attempt that does not read the answer tells them apart.
      try {
        const t0 = performance.now();
        await fetcher(w.target, { ...base, method: 'GET', mode: 'no-cors' });
        return { state: 'ok', detail: 'Reachable (status hidden by the site) · ' + Math.round(performance.now() - t0) + ' ms' };
      } catch { return { state: 'down', detail: 'Not reachable' }; }
    }
  },
  _ago(ms) {
    if (!Number.isFinite(ms)) return '';
    const m = Math.max(0, Math.round((Date.now() - ms) / 60000));
    if (m < 1) return 'just now';
    if (m < 60) return m + ' min ago';
    if (m < 2880) return Math.round(m / 60) + ' h ago';
    return Math.round(m / 1440) + ' days ago';
  },

  async checkAll({ fresh = false } = {}) {
    const ttl = (w) => w.type === 'github' ? 300000 : 60000;
    return Promise.all(this.widgets().map(async (w) => {
      const c = this._dashCache.get(w.id);
      if (!fresh && c && Date.now() - c.at < ttl(w)) return { widget: w, ...c.result };
      let result;
      try { result = await this.check(w); }
      catch (err) { result = { state: 'warn', detail: (err && err.message) || 'Could not check' }; }
      this._dashCache.set(w.id, { at: Date.now(), result });
      return { widget: w, ...result };
    }));
  },

  async openDashboards() {
    const ui = this._overlay('vex-mini-dash', 'Mini dashboards');
    const list = document.createElement('div');
    list.style.cssText = 'display:flex;flex-direction:column;gap:6px';
    const foot = document.createElement('div');
    foot.style.cssText = 'font-size:11px;color:var(--text-muted)';
    foot.textContent = 'Only the addresses you added are contacted, once each time this opens (GitHub every five minutes at most), without cookies. Add or remove them in Settings › Memory tools.';
    ui.body.append(list, foot);
    const draw = async (fresh) => {
      list.textContent = '';
      if (!this.widgets().length) {
        const e = document.createElement('div');
        e.style.cssText = 'font-size:12.5px;color:var(--text-muted);padding:14px 4px';
        e.textContent = 'No widgets yet. Add a GitHub repository, a web address or a server in Settings › Memory tools.';
        list.appendChild(e);
        return;
      }
      const rows = await this.checkAll({ fresh });
      if (!ui.wrap.isConnected) return;
      list.textContent = '';
      for (const r of rows) list.appendChild(this._dashRow(r));
    };
    ui.body.insertBefore(this._btn('Check again', () => draw(true)), list);
    await draw(false);
    return ui;
  },
  _dashRow(r) {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:center;gap:10px;padding:8px 10px;border:1px solid var(--border);border-radius:8px';
    const dot = document.createElement('span');
    const color = r.state === 'ok' ? 'var(--success,#22c55e)' : (r.state === 'down' ? 'var(--danger,#ef4444)' : 'var(--warning,#f59e0b)');
    dot.style.cssText = 'width:10px;height:10px;border-radius:50%;flex:none;background:' + color;
    dot.setAttribute('role', 'img');
    dot.setAttribute('aria-label', r.state === 'ok' ? 'Working' : (r.state === 'down' ? 'Down' : 'Needs a look'));
    const txt = document.createElement('div');
    txt.style.cssText = 'flex:1;min-width:0';
    const t = document.createElement('div');
    t.style.cssText = 'font-size:12.5px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
    t.textContent = r.widget.label;
    const s = document.createElement('div');
    s.style.cssText = 'font-size:11px;color:var(--text-muted)';
    s.textContent = (r.widget.type === 'github' ? 'GitHub Actions · ' : r.widget.type === 'ping' ? 'Server · ' : 'Web address · ') + r.detail;
    txt.append(t, s);
    row.append(dot, txt);
    const url = r.url || (r.widget.type === 'github' ? 'https://github.com/' + r.widget.target + '/actions' : r.widget.target);
    if (/^https?:\/\//i.test(url)) row.appendChild(this._btn('Open', () => { try { this._openTab(url); } catch (err) { this._fail(err); } }));
    return row;
  },

  // ============================================================================
  // 4. Clipboard actions (offer only)
  // ============================================================================
  detectClip(raw) {
    const text = String(raw == null ? '' : raw).trim();
    if (!text || text.length > 200 || /https?:\/\//i.test(text)) return null;
    const lines = text.split(/\r?\n/).filter(l => l.trim());
    const squeezed = text.replace(/[\s-]+/g, '');
    if (lines.length === 1) {
      const up = squeezed.toUpperCase();
      let carrier = null;
      if (/^1Z[0-9A-Z]{16}$/.test(up)) carrier = 'UPS';
      else if (/^9[2345]\d{18,20}$/.test(up)) carrier = 'USPS';
      else if (/^[A-Z]{2}\d{9}[A-Z]{2}$/.test(up)) carrier = 'Post';
      else if (/^(\d{12}|\d{15})$/.test(up)) carrier = 'FedEx';
      else if (/^JD\d{18}$/.test(up)) carrier = 'DHL';
      if (carrier) return { kind: 'tracking', carrier, value: up };
    }
    const date = this.parseDate(text);
    if (date) return { kind: 'date', at: date };
    if (lines.length <= 3 && this.looksLikeAddress(text)) return { kind: 'address', value: lines.join(', ') };
    return null;
  },
  trackingUrl(t) {
    const n = encodeURIComponent(t.value);
    if (t.carrier === 'UPS') return 'https://www.ups.com/track?tracknum=' + n;
    if (t.carrier === 'USPS') return 'https://tools.usps.com/go/TrackConfirmation?tLabels=' + n;
    if (t.carrier === 'FedEx') return 'https://www.fedex.com/fedextrack/?trknbr=' + n;
    return 'https://parcelsapp.com/en/tracking/' + n;
  },
  mapUrl(address) { return 'https://www.openstreetmap.org/search?query=' + encodeURIComponent(address); },
  looksLikeAddress(text) {
    const suf = '(?:street|st|avenue|ave|road|rd|boulevard|blvd|lane|ln|drive|dr|court|ct|way|place|pl|square|sq|strasse|straße|str|platz|allee|weg|rue|via|calle|sokak|sk|sok|cadde|cd|cad|mahallesi|mah)';
    const a = new RegExp('\\b\\d{1,5}[a-z]?\\s+[\\p{L}.\' -]{2,40}?\\s' + suf + '\\b', 'iu');
    const b = new RegExp('\\b[\\p{L}.\' -]{2,40}?' + suf + '\\.?,?\\s+(?:no[:. ]*)?\\d{1,5}[a-z]?\\b', 'iu');
    return a.test(text) || b.test(text);
  },
  // A date that is most of what was copied, in the future. Day first for the
  // ambiguous 03/04/2026 (and the page shows the parsed date before anything
  // is added). Time defaults to 09:00. -> epoch ms or null.
  parseDate(text) {
    const t = String(text).trim();
    const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
    const tm = /(?:\bat\s+|[ T,]\s*)(\d{1,2}):(\d{2})\b/;
    let y, mo, d, covered = 0, m;
    if ((m = t.match(/\b(\d{4})-(\d{2})-(\d{2})\b/))) { y = +m[1]; mo = +m[2] - 1; d = +m[3]; covered = m[0].length; }
    else if ((m = t.match(/\b(\d{1,2})[./](\d{1,2})[./](\d{4})\b/))) {
      y = +m[3]; d = +m[1]; mo = +m[2] - 1;
      if (mo > 11 && d <= 12) { const x = d; d = mo + 1; mo = x - 1; }
      covered = m[0].length;
    } else if ((m = t.match(/\b(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]{3,9})\.?,?\s+(\d{4})\b/))) {
      mo = MONTHS.indexOf(m[2].slice(0, 3).toLowerCase()); y = +m[3]; d = +m[1]; covered = m[0].length;
      if (mo < 0) return null;
    } else if ((m = t.match(/\b([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})\b/))) {
      mo = MONTHS.indexOf(m[1].slice(0, 3).toLowerCase()); y = +m[3]; d = +m[2]; covered = m[0].length;
      if (mo < 0) return null;
    } else return null;
    if (mo < 0 || mo > 11 || d < 1 || d > 31 || y < 2000 || y > 2100) return null;
    let h = 9, mi = 0;
    const tt = t.match(tm);
    if (tt) { h = +tt[1]; mi = +tt[2]; covered += tt[0].length; if (h > 23 || mi > 59) return null; }
    // "Due: 2026-10-20" is fine; a paragraph that happens to hold a date is not.
    if (t.length - covered > 24) return null;
    const at = new Date(y, mo, d, h, mi, 0, 0);
    if (at.getMonth() !== mo || at.getTime() <= Date.now()) return null;
    return at.getTime();
  },

  // Called with a page copy that ClipboardHistory has just recorded.
  onCopy(detail) {
    if (!this.settings().clipboard) return null;
    // Nothing is offered over a game or while Vex is not the window in front.
    if (this._gameActive() || !this._inFront()) return null;
    if (window.ClipboardHistory && typeof ClipboardHistory.enabled === 'function' && !ClipboardHistory.enabled()) return null;
    const text = detail && detail.text;
    const hit = this.detectClip(text);
    if (!hit) return null;
    const now = Date.now();
    const key = String(text).trim();
    if (now - this._lastOffer < 20000 || (this._offered.get(key) || 0) > now - 600000) return null;
    this._offered.set(key, now);
    this._lastOffer = now;
    if (this._offered.size > 50) this._offered.delete(this._offered.keys().next().value);
    let message, label, run;
    if (hit.kind === 'tracking') {
      message = 'This looks like a ' + hit.carrier + ' tracking number: ' + hit.value;
      label = 'Track it';
      run = () => this._openTab(this.trackingUrl(hit));
    } else if (hit.kind === 'date') {
      const when = new Date(hit.at).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
      message = 'Add ' + when + ' as a reminder?';
      label = 'Add reminder';
      run = async () => {
        const b = window.vex && window.vex.reminders;
        if (!b || typeof b.create !== 'function') throw new Error('Reminders are not available in this window');
        await b.create(this._clip(key, 120), hit.at, { kind: 'reminder' });
        window.showToast?.('Reminder added for ' + when, 'success');
      };
    } else {
      message = 'Show this address on a map?  ' + this._clip(hit.value, 80);
      label = 'Open map';
      run = () => this._openTab(this.mapUrl(hit.value));
    }
    window.showToast?.(message, 'info', 12000, { action: { label, run: () => { Promise.resolve().then(run).catch(err => this._fail(err)); } } });
    return hit;
  },

  // ============================================================================
  // 5. Game session log
  // ============================================================================
  gameLog() {
    const l = this._read(this.KEYS.gameLog, []);
    return Array.isArray(l) ? l.filter(g => g && Number.isFinite(g.start) && Number.isFinite(g.end)) : [];
  },
  gameLine(g) {
    const when = new Date(g.start).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
    const n = (k, w) => k + ' ' + w + (k === 1 ? '' : 's');
    return when + ' — ' + (g.app || 'A game') + ', ' + this._duration(g.end - g.start) + ', ' + n(g.slept || 0, 'tab') + ' slept, ' + n(g.closed || 0, 'tab') + ' closed';
  },
  gameLogSince(ms) { return this.gameLog().filter(g => g.end >= ms).sort((a, b) => b.start - a.start); },
  clearGameLog() { this._write(this.KEYS.gameLog, []); },

  _onGameState(s) {
    const on = !!(s && s.game);
    if (on && !this._game) {
      const g = { app: String((s && s.app) || ''), start: Date.now(), report: null, closed: 0, poll: null };
      // GameMode keeps the sleep count on its report; the object is kept so the
      // number is still there after GameMode has put everything back.
      const grab = () => { try { if (typeof GameMode !== 'undefined' && GameMode._gamingReport) g.report = GameMode._gamingReport; } catch { /* no report */ } };
      g.poll = VexJobs.every('Game report grab', 3000, grab, { when: 'background', feature: 'memory-tools' });
      grab();
      this._game = g;
    } else if (on && this._game) {
      if (s.app && !this._game.app) this._game.app = String(s.app);
    } else if (!on && this._game) {
      const g = this._game;
      this._game = null;
      g.poll.stop();
      try { if (!g.report && typeof GameMode !== 'undefined' && GameMode._gamingReport) g.report = GameMode._gamingReport; } catch { /* no report */ }
      const end = Date.now();
      if (end - g.start < this.MIN_GAME_MS) return null;
      if (!this.settings().gameLog) return null;
      const entry = { app: g.app, start: g.start, end, slept: (g.report && g.report.slept) || 0, closed: g.closed };
      const list = this.gameLog();
      list.unshift(entry);
      try { this._write(this.KEYS.gameLog, list.slice(0, this.MAX_GAME_LOG)); }
      catch (err) { this._fail(err); }
      return entry;
    }
    return null;
  },

  // ============================================================================
  // 6. Backup nudge
  // ============================================================================
  lastBackupAt() {
    try { const v = Number(localStorage.getItem(this.KEYS.lastBackup)); return Number.isFinite(v) && v > 0 ? v : 0; } catch { return 0; }
  },
  backupDue(now = Date.now()) {
    if (!this.settings().backup) return false;
    let base = this.lastBackupAt();
    if (!base) {
      try {
        const seen = Number(localStorage.getItem(this.KEYS.firstSeen));
        if (Number.isFinite(seen) && seen > 0) base = seen;
        else localStorage.setItem(this.KEYS.firstSeen, String(now));
      } catch { /* without storage it is never due */ }
      if (!base) return false;
    }
    return now - base >= this.BACKUP_EVERY_MS;
  },
  // The existing backup (js/backup.js): notes, bookmarks, sessions, settings.
  // It never contains saved logins, authenticator codes or tokens.
  async exportNow() {
    if (typeof VexBackup === 'undefined' || typeof VexBackup.save !== 'function') throw new Error('The backup feature is not loaded');
    const d = await VexBackup.save([]);
    try { localStorage.setItem(this.KEYS.lastBackup, String(Date.now())); } catch { /* the nudge may come again early */ }
    const n = Object.keys(d.items || {}).length + Object.keys(d.stores || {}).length;
    window.showToast?.('Saved a backup of ' + n + ' things to your Downloads folder', 'success');
    return n;
  },
  maybeNudge() {
    if (!this.backupDue() || this._gameActive() || !this._inFront()) return false;
    let last = 0;
    try { last = Number(localStorage.getItem(this.KEYS.lastNudge)) || 0; } catch { /* ask */ }
    if (Date.now() - last < 24 * 3600000) return false;
    try { localStorage.setItem(this.KEYS.lastNudge, String(Date.now())); } catch { /* may ask again */ }
    const at = this.lastBackupAt();
    const text = at ? 'Your last backup was ' + this._ago(at) + '. Save your notes, bookmarks and settings now?' : 'You have not backed up your notes, bookmarks and settings yet. Save a copy now?';
    // A backup reminder is never urgent: it waits in the Attention Inbox (js/attention-inbox.js).
    if (typeof VexAttention !== 'undefined') return VexAttention.suggest({ feature: 'backup', label: 'Backup reminder', id: 'due', title: text, action: { label: 'Export now', key: 'export' } });
    window.showToast?.(text, 'info', 20000, {
      action: { label: 'Export now', run: () => { this.exportNow().catch(err => this._fail(err)); } },
    });
    return true;
  },

  // ============================================================================
  // Brief-ready modules
  // ============================================================================
  _briefOn(id, feature) { const s = this.settings(); return !!(s[feature || id] && s.brief[id]); },
  briefModules: [],
  _makeBrief() {
    const self = this;
    const mod = (id, title, feature, build) => ({
      id, title,
      isEnabled() { return self._briefOn(id, feature); },
      async build() {
        const r = await build();
        return { id, title, items: r.items || [], empty: r.empty || '' };
      },
    });
    return [
      mod('journal', 'Journal', 'journal', async () => {
        const j = self.journal();
        const key = Object.keys(j).sort().reverse()[0];
        if (!key) return { items: [], empty: 'No journal entries yet.' };
        const body = j[key].text.split('\n').filter(l => /^- /.test(l)).slice(0, 5).map(l => l.slice(2).replace(/\[([^\]]*)\]\([^)]*\)/g, '$1'));
        return { items: [{ text: self.dayLabel(key), detail: body.join(' · ') }] };
      }),
      mod('link-memory', 'Saved links', 'links', async () => {
        self.scanLinks();
        const items = self.linkIndex().items.slice(0, 5).map(i => ({ text: i.title, detail: i.summary || i.host, url: i.url }));
        return { items, empty: 'No links saved from notes or chats yet.' };
      }),
      mod('dashboards', 'Dashboards', 'dashboards', async () => {
        const rows = await self.checkAll();
        return { items: rows.map(r => ({ text: r.widget.label, detail: r.detail, url: r.url || (r.widget.type === 'github' ? 'https://github.com/' + r.widget.target + '/actions' : r.widget.target), state: r.state })), empty: 'No widgets configured.' };
      }),
      mod('game-log', 'Games this week', 'gameLog', async () => {
        const rows = self.gameLogSince(Date.now() - 7 * 24 * 3600000);
        return { items: rows.slice(0, 5).map(g => ({ text: self.gameLine(g) })), empty: 'No games this week.' };
      }),
      mod('backup', 'Backup', 'backup', async () => {
        if (!self.backupDue()) return { items: [], empty: '' };
        const at = self.lastBackupAt();
        return { items: [{ text: at ? 'Last backup ' + self._ago(at) : 'No backup yet', detail: 'Export your notes, bookmarks and settings from Settings › Memory tools' }] };
      }),
    ];
  },

  // ============================================================================
  // Settings
  // ============================================================================
  renderSettings(host) {
    host = host || document.getElementById('memtools-settings');
    if (!host) return;
    host.textContent = '';
    const s = this.settings();
    const add = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
    const toggle = (label, hint, checked, onChange, id) => {
      const row = add('div', 'setting-toggle-row');
      const left = add('span');
      left.appendChild(add('span', null, label));
      if (hint) { left.appendChild(document.createTextNode(' ')); const h = add('span', null, '· ' + hint); h.style.cssText = 'color:var(--text-muted);font-size:11px'; left.appendChild(h); }
      const sw = document.createElement('label');
      sw.className = 'toggle';
      sw.innerHTML = '<input type="checkbox"><span class="toggle-slider"></span>';
      const box = sw.querySelector('input');
      box.setAttribute('aria-label', label);
      if (id) box.id = id;
      box.checked = !!checked;
      box.addEventListener('change', () => {
        try { onChange(box.checked); }
        catch (err) { box.checked = !box.checked; this._fail(err); }
        this.renderSettings(host);
      });
      row.append(left, sw);
      return row;
    };
    const feature = (name, label, hint, hasBrief) => {
      host.appendChild(toggle(label, hint, s[name], (v) => { this.setSetting(name, v); if (v) this.start(); }, 'setting-memtools-' + name));
      if (hasBrief && s[name]) {
        const r = toggle('Show it in the morning brief', '', s.brief[hasBrief], (v) => this.setSetting(hasBrief, v, true));
        r.style.marginLeft = '18px';
        host.appendChild(r);
      }
    };
    const act = (label, fn) => { const b = add('button', 'btn-secondary', label); b.type = 'button'; b.addEventListener('click', async () => { try { await fn(); } catch (err) { this._fail(err); } }); return b; };
    const actions = (...btns) => { const d = add('div'); d.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap;margin:6px 0 12px'; d.append(...btns); host.appendChild(d); };

    feature('journal', 'Daily journal', 'written each evening from your history, reminders, notes and saved pages', 'journal');
    actions(act('Open the journal', () => this.openJournal()));
    feature('links', 'Link memory', 'links in your notes and AI chats, searchable', 'links');
    if (s.links) {
      host.appendChild(toggle('Look up page titles', 'contacts each linked site once, without cookies', s.fetchTitles, (v) => this.setSetting('fetchTitles', v)));
      actions(act('Search saved links', () => this.openLinks()), act('Forget all saved links', async () => {
        const ok = await window.vexConfirm({ title: 'Forget all saved links?', message: 'The link index is emptied. Your notes and chats are not touched, and these links are not collected again.', okLabel: 'Forget', danger: true });
        if (ok) { this.clearLinks(); this.renderSettings(host); }
      }));
    }
    feature('dashboards', 'Mini dashboards', 'GitHub Actions, a web address, a server', 'dashboards');
    if (s.dashboards) this._renderWidgetEditor(host);
    feature('clipboard', 'Clipboard actions', 'offers Track, Add reminder or Open map for a copied tracking number, date or address; off during games', null);
    feature('gameLog', 'Game log', 'a line for each finished game', 'gameLog');
    if (s.gameLog) {
      const rows = this.gameLog().sort((a, b) => b.start - a.start).slice(0, 10);
      const box = add('div');
      box.style.cssText = 'margin:4px 0 8px;font-size:12px;color:var(--text-muted)';
      if (!rows.length) box.textContent = 'No finished games logged yet.';
      for (const g of rows) box.appendChild(add('div', null, this.gameLine(g)));
      host.appendChild(box);
      if (rows.length) actions(act('Clear the game log', async () => {
        const ok = await window.vexConfirm({ title: 'Clear the game log?', message: 'Every logged game is removed.', okLabel: 'Clear', danger: true });
        if (ok) { this.clearGameLog(); this.renderSettings(host); }
      }));
    }
    feature('backup', 'Weekly backup reminder', 'offers to export your notes, bookmarks and settings (never saved logins or codes)', 'backup');
    const at = this.lastBackupAt();
    host.appendChild(add('p', 'setting-info muted', at ? 'Last backup: ' + new Date(at).toLocaleString() : 'No backup made from here yet.'));
    actions(act('Export now', async () => { await this.exportNow(); this.renderSettings(host); }), act('Back up or restore…', () => { if (typeof VexBackup !== 'undefined') VexBackup.open(); }));
    if (typeof VexI18nUI !== 'undefined' && VexI18nUI.translateEl) { try { VexI18nUI.translateEl(host); } catch { /* English stays */ } }
  },
  _renderWidgetEditor(host) {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'margin:4px 0 12px;display:flex;flex-direction:column;gap:6px';
    for (const w of this.widgets()) {
      const row = document.createElement('div');
      row.className = 'setting-toggle-row';
      const label = document.createElement('span');
      label.textContent = w.label + ' — ' + (w.type === 'github' ? 'GitHub Actions ' : w.type === 'ping' ? 'server ' : 'web ') + w.target;
      const rm = document.createElement('button');
      rm.type = 'button'; rm.className = 'btn-secondary'; rm.textContent = 'Remove';
      rm.addEventListener('click', () => { try { this.removeWidget(w.id); } catch (err) { this._fail(err); } this.renderSettings(host); });
      row.append(label, rm);
      wrap.appendChild(row);
    }
    const form = document.createElement('div');
    form.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap;align-items:center';
    const type = document.createElement('select');
    type.setAttribute('aria-label', 'Widget type');
    for (const [v, t] of [['github', 'GitHub Actions (owner/repo)'], ['http', 'Web address'], ['ping', 'Server (host name)']]) { const o = document.createElement('option'); o.value = v; o.textContent = t; type.appendChild(o); }
    const target = document.createElement('input');
    target.type = 'text'; target.placeholder = 'owner/repo or https://example.com/health'; target.setAttribute('aria-label', 'Widget address');
    target.style.cssText = 'flex:1;min-width:180px';
    const name = document.createElement('input');
    name.type = 'text'; name.placeholder = 'Name (optional)'; name.setAttribute('aria-label', 'Widget name');
    const addBtn = document.createElement('button');
    addBtn.type = 'button'; addBtn.className = 'btn-secondary'; addBtn.textContent = 'Add widget';
    addBtn.addEventListener('click', () => {
      try { this.addWidget({ type: type.value, target: target.value, label: name.value }); this.renderSettings(host); }
      catch (err) { this._fail(err); }
    });
    const open = document.createElement('button');
    open.type = 'button'; open.className = 'btn-secondary'; open.textContent = 'Open dashboard';
    open.addEventListener('click', () => this.openDashboards().catch(err => this._fail(err)));
    form.append(type, target, name, addBtn, open);
    wrap.appendChild(form);
    host.appendChild(wrap);
  },

  // ============================================================================
  // Start
  // ============================================================================
  start() {
    const later = (fn, ms) => this._timers.push(setTimeout(fn, ms));
    const every = (fn, ms, name) => this._timers.push(VexJobs.every(name, ms, fn, { when: 'background', feature: 'memory-tools' }));
    if (this._started) return false;
    this._started = true;
    const guard = (what, fn) => () => { try { const r = fn(); if (r && typeof r.catch === 'function') r.catch(err => this._note(what, err)); } catch (err) { this._note(what, err); } };
    // Writing the journal and reading link text are heavy: they wait for a quiet moment and are
    // refused in Game mode or when memory is low (VexJobs.heavy); the next timer asks again.
    const journal = () => VexJobs.heavy('Journal', () => this.tickJournal(), { kind: 'summary', feature: 'memory-tools' });
    const links = () => VexJobs.heavy('Link memory', () => this.scanLinks(), { kind: 'index', feature: 'memory-tools' });
    later(guard('journal', journal), 15000);
    every(guard('journal', journal), 15 * 60000, 'Memory journal');
    later(guard('links', links), 25000);
    every(guard('links', links), 10 * 60000, 'Memory links');
    later(guard('backup', () => this.maybeNudge()), 60000);
    every(guard('backup', () => this.maybeNudge()), 60 * 60000, 'Memory backup nudge');
    return true;
  },

  init() {
    if (this._wired) return false;
    this._wired = true;
    this.briefModules = this._makeBrief();
    if (typeof AttentionInbox !== 'undefined') AttentionInbox.handle('backup', (key) => { if (key === 'export') return this.exportNow().catch(err => this._fail(err)); throw new Error('Unknown backup action ' + key); });
    const reg = (window.VexBriefModules = window.VexBriefModules || []);
    for (const m of this.briefModules) if (!reg.some(x => x && x.id === m.id)) reg.push(m);
    // Page copies, as ClipboardHistory records them.
    document.addEventListener('vex:clipboard-copy', (e) => { try { this.onCopy(e.detail || {}); } catch (err) { this._note('Clipboard actions failed', err); } });
    document.addEventListener('vex:tab-closed', () => { if (this._game) this._game.closed++; });
    const b = window.vex;
    if (b && typeof b.onGameState === 'function') {
      b.onGameState((s) => { try { this._onGameState(s); } catch (err) { this._note('Game log failed', err); } });
      if (typeof b.gameState === 'function') {
        Promise.resolve(b.gameState()).then((s) => { if (s && s.game) this._onGameState(s); }).catch(err => this._note('Could not read whether a game is running', err));
      }
    }
    this.start();
    return true;
  },
};

if (typeof window !== 'undefined') window.VexMemoryTools = VexMemoryTools;
if (typeof module !== 'undefined' && module.exports) module.exports = { VexMemoryTools };

// === Log reader: a CI or raw log you can actually read =======================
//
// A GitHub Actions raw log is thousands of lines of "2026-10-15T12:00:00.0000000Z
// ##[group]Run npm test". This turns one into something you can read:
//
//   - ##[group] ... ##[endgroup] sections fold (the one holding the first error opens);
//   - "First error" / "Next error" / "Next warning" jump between the lines that matter;
//   - ANSI colours are drawn, time stamps can be hidden;
//   - a search box (plain text, not a pattern) finds lines; "Copy section" copies one section;
//   - a line with a file path in a stack trace gets "Open" when the Developer desk's
//     open-in-editor is on (js/dev-desk.js).
//
// LOCAL ONLY. The text comes from a file you pick, or from the page in front (read in
// this window, never from a private or Tor tab), and goes nowhere: not to the AI, not
// to sync, not into storage. Text is drawn with textContent, never as HTML. Off until
// switched on. Size limits: 8 MB and 150,000 lines (a bigger log is cut with a note).
const LogReader = {
  FEATURE: 'log-reader',
  MAX_BYTES: 8 * 1024 * 1024,
  MAX_LINES: 150000,
  CHUNK: 1500,
  ...DevDeskUtil.switchFor('vex.logReader.enabled'),

  // ---- pure parts (tested) ------------------------------------------------------------
  TS: /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z)\s?/,
  ANSI: /\u001b\[([0-9;]*)m/g,
  PALETTE: { 30: '#6b6b76', 31: 'var(--danger, #e5484d)', 32: 'var(--success, #30a46c)', 33: 'var(--warning, #f5a524)', 34: 'var(--accent, #4c8dff)', 35: '#a78bfa', 36: '#22d3ee', 37: 'inherit',
    90: '#8b8b95', 91: 'var(--danger, #e5484d)', 92: 'var(--success, #30a46c)', 93: 'var(--warning, #f5a524)', 94: 'var(--accent, #4c8dff)', 95: '#a78bfa', 96: '#22d3ee', 97: 'inherit' },
  ERROR_WORDS: /^(?:error|fatal|panic|FAIL)\b|\berror:|\bFAILED\b|Traceback \(most recent call last\)|npm ERR!|^\s*(?:thread '.*' )?panicked at/i,
  WARN_WORDS: /\bwarn(?:ing)?\b\s*[:\]]/i,

  // "\u001b[31mred\u001b[0m text" -> [{ text:'red', fg:'…', bold:false }, { text:' text' }]
  segments(line) {
    const segs = [];
    let fg = '', bold = false, last = 0, m;
    this.ANSI.lastIndex = 0;
    const push = (t) => { if (t) segs.push({ text: t, fg, bold }); };
    while ((m = this.ANSI.exec(line))) {
      push(line.slice(last, m.index));
      last = m.index + m[0].length;
      const codes = m[1] === '' ? [0] : m[1].split(';').map(Number);
      for (const c of codes) {
        if (c === 0) { fg = ''; bold = false; }
        else if (c === 1) bold = true;
        else if (c === 22) bold = false;
        else if (c === 39) fg = '';
        else if (this.PALETTE[c]) fg = this.PALETTE[c];
      }
    }
    push(line.slice(last));
    return segs.length ? segs : [{ text: '', fg: '', bold: false }];
  },
  strip(line) { return String(line).replace(/\u001b\[[0-9;?]*[A-Za-z]/g, ''); },

  // text -> { lines, groups, errors, warnings, truncated }
  //   line:  { n, ts, segs, plain, level: 'error'|'warning'|'info', group: id|-1, kind: 'line'|'start'|'end' }
  //   group: { id, title, start, end, hasError }
  parse(text) {
    const src = String(text == null ? '' : text);
    if (src.length > this.MAX_BYTES) throw new Error('That log is over ' + Math.round(this.MAX_BYTES / 1048576) + ' MB - cut it down first');
    const raw = src.split(/\r?\n/);
    let truncated = false;
    if (raw.length > this.MAX_LINES) { raw.length = this.MAX_LINES; truncated = true; }
    const lines = [], groups = [], errors = [], warnings = [];
    let open = -1;
    raw.forEach((rawLine, i) => {
      let body = rawLine;
      let ts = '';
      const t = this.TS.exec(body.replace(/^﻿/, ''));
      if (t) { ts = t[1]; body = body.replace(/^﻿/, '').slice(t[0].length); }
      let kind = 'line', level = 'info';
      const plain0 = this.strip(body);
      let m;
      if ((m = /^##\[group\](.*)$/.exec(plain0))) {
        kind = 'start';
        const g = { id: groups.length, title: m[1].trim() || 'section', start: i, end: i, hasError: false };
        groups.push(g);
        open = g.id;
        body = m[1];
      } else if (/^##\[endgroup\]/.test(plain0)) {
        kind = 'end';
        if (open >= 0) groups[open].end = i;
      } else if ((m = /^##\[(error|warning|debug|command|notice)\](.*)$/.exec(plain0))) {
        if (m[1] === 'error') level = 'error'; else if (m[1] === 'warning') level = 'warning';
        body = m[2] || m[0];
      }
      const plain = this.strip(body);
      if (kind === 'line' && level === 'info') {
        if (this.ERROR_WORDS.test(plain)) level = 'error';
        else if (this.WARN_WORDS.test(plain)) level = 'warning';
      }
      const line = { n: i + 1, ts, segs: this.segments(body), plain, level, group: open, kind };
      lines.push(line);
      if (level === 'error') { errors.push(i); if (open >= 0) groups[open].hasError = true; }
      else if (level === 'warning') warnings.push(i);
      if (kind === 'end') open = -1;
    });
    return { lines, groups, errors, warnings, truncated };
  },

  // Lines containing the words (plain text, case-insensitive; no pattern, so nothing to blow up).
  search(parsed, query) {
    const q = String(query == null ? '' : query).trim().toLowerCase();
    if (!q) return [];
    const out = [];
    parsed.lines.forEach((l, i) => { if (l.plain.toLowerCase().includes(q)) out.push(i); });
    return out;
  },
  // The next index in `list` after `from` (wrapping), or -1.
  nextIn(list, from) {
    if (!list.length) return -1;
    return list.find(i => i > from) ?? list[0];
  },
  sectionText(parsed, id) {
    const g = parsed.groups[id];
    if (!g) throw new Error('That section does not exist');
    return parsed.lines.slice(g.start, g.end + 1).map(l => l.plain).join('\n');
  },

  // ---- reading the text -----------------------------------------------------------------------
  async fromFile() {
    return new Promise((resolve, reject) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.log,.txt,text/plain';
      input.addEventListener('change', () => {
        const f = input.files && input.files[0];
        if (!f) { resolve(null); return; }
        if (f.size > this.MAX_BYTES) { reject(new Error('That file is over ' + Math.round(this.MAX_BYTES / 1048576) + ' MB')); return; }
        f.text().then(text => resolve({ title: f.name, text }), reject);
      });
      input.addEventListener('cancel', () => resolve(null));
      input.click();
    });
  },
  // The page in front, read in this window. Not a private, Tor or routed tab.
  async fromTab() {
    if (typeof TabManager === 'undefined' || typeof WebviewManager === 'undefined') throw new Error('Tabs are not available');
    const tab = TabManager.getActiveTab();
    const wv = tab ? WebviewManager.webviews.get(tab.id) : null;
    if (!wv) throw new Error('Open the log in a tab first');
    if (window.VexTabPolicy && !window.VexTabPolicy.canReadWebview(wv)) throw new Error('This tab is private or routed, so Vex does not read it');
    const text = await wv.executeJavaScript('document.body ? document.body.innerText : ""');
    if (typeof text !== 'string' || !text.trim()) throw new Error('This page has no text to read');
    return { title: tab.title || tab.url, text };
  },

  // ---- the screen -------------------------------------------------------------------------------
  open({ title, text }) {
    if (!this.enabled()) throw new Error('The log reader is switched off (Settings > Developer desk)');
    DevDeskUtil.touch(this.FEATURE);
    const parsed = this.parse(text);
    const { body } = VexSettingsGroups.dialog({ id: 'vex-log-reader', title: 'Log: ' + String(title || 'untitled').slice(0, 80),
      sub: parsed.lines.length + ' lines - ' + parsed.errors.length + ' errors - ' + parsed.warnings.length + ' warnings' + (parsed.truncated ? ' (cut at ' + this.MAX_LINES + ' lines)' : '') + '. Read here only; nothing is sent anywhere.' });
    const view = { parsed, shown: new Set(), showTs: true, cursor: -1, matches: [], rows: new Map(), body };
    this._draw(view);
    const first = parsed.errors[0];
    if (first != null) this._jump(view, first);
    return view;
  },

  _draw(view) {
    const S = VexSettingsGroups;
    const { parsed, body } = view;
    body.textContent = '';
    const bar = DevDeskUtil.el('div');
    bar.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-bottom:8px;position:sticky;top:0;background:var(--surface, var(--bg));padding:4px 0;z-index:1';
    const search = DevDeskUtil.el('input');
    search.type = 'search'; search.className = 'set-input'; search.placeholder = 'Find in log'; search.setAttribute('aria-label', 'Find in log');
    search.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); this._searchNext(view, search.value); } });
    bar.append(search,
      S.button('Find next', () => this._searchNext(view, search.value)),
      S.button('First error', () => this._jumpList(view, parsed.errors, -1, 'errors')),
      S.button('Next error', () => this._jumpList(view, parsed.errors, view.cursor, 'errors')),
      S.button('Next warning', () => this._jumpList(view, parsed.warnings, view.cursor, 'warnings')),
      S.button(view.showTs ? 'Hide times' : 'Show times', () => { view.showTs = !view.showTs; this._draw(view); }),
      S.button('Fold all', () => { view.shown.clear(); this._draw(view); }),
    );
    body.appendChild(bar);
    const list = DevDeskUtil.el('div');
    list.style.cssText = 'font-family:var(--font-mono, Consolas, monospace);font-size:12px;line-height:1.5;white-space:pre-wrap;word-break:break-word';
    view.list = list;
    view.rows.clear();
    body.appendChild(list);
    view.limit = view.limit || this.CHUNK;
    this._rows(view);
  },

  _rows(view) {
    const { parsed, list } = view;
    list.textContent = '';
    view.rows.clear();
    let count = 0;
    for (let i = 0; i < parsed.lines.length; i++) {
      const l = parsed.lines[i];
      const g = l.group >= 0 ? parsed.groups[l.group] : null;
      // Inside a folded section only its header shows.
      if (g && l.kind !== 'start' && !view.shown.has(g.id) && i > g.start && i <= g.end) continue;
      if (l.kind === 'end') continue;
      if (++count > view.limit) {
        const more = VexSettingsGroups.button('Show ' + this.CHUNK + ' more lines', () => { view.limit += this.CHUNK; this._rows(view); });
        list.appendChild(more);
        break;
      }
      const row = this._row(view, l, i, g);
      view.rows.set(i, row);
      list.appendChild(row);
    }
  },

  _row(view, l, i, g) {
    const row = DevDeskUtil.el('div');
    row.dataset.line = String(i);
    if (l.level === 'error') row.style.background = 'color-mix(in srgb, var(--danger, #e5484d) 14%, transparent)';
    else if (l.level === 'warning') row.style.background = 'color-mix(in srgb, var(--warning, #f5a524) 12%, transparent)';
    if (view.matches.includes(i)) row.style.outline = '1px solid var(--accent, #4c8dff)';
    if (l.kind === 'start') {
      const open = view.shown.has(g.id);
      const head = DevDeskUtil.el('button', 'btn-secondary', (open ? 'v ' : '> ') + g.title + (g.hasError ? '  (has errors)' : ''));
      head.type = 'button';
      head.setAttribute('aria-expanded', String(open));
      head.style.cssText = 'display:block;width:100%;text-align:left;margin:2px 0';
      head.addEventListener('click', () => { if (open) view.shown.delete(g.id); else view.shown.add(g.id); this._rows(view); });
      const copy = VexSettingsGroups.button('Copy section', async () => {
        try { await navigator.clipboard.writeText(this.sectionText(view.parsed, g.id)); window.showToast?.('Section copied'); }
        catch (err) { DevDeskUtil.fail('Copy section', err); }
      });
      row.append(head, copy);
      return row;
    }
    if (view.showTs && l.ts) { const t = DevDeskUtil.el('span', '', l.ts.slice(11, 19) + ' '); t.style.opacity = '0.55'; row.appendChild(t); }
    for (const s of l.segs) {
      const span = DevDeskUtil.el('span', '', s.text);
      if (s.fg) span.style.color = s.fg;
      if (s.bold) span.style.fontWeight = '700';
      row.appendChild(span);
    }
    if (typeof DevDesk !== 'undefined' && DevDesk.enabled() && DevDesk.parseTrace(l.plain).length) {
      row.appendChild(document.createTextNode(' '));
      row.appendChild(VexSettingsGroups.button('Open', () => DevDesk.openFirstRef(l.plain).catch(err => DevDeskUtil.fail('Open in editor', err))));
    }
    return row;
  },

  _jumpList(view, list, from, what) {
    const idx = this.nextIn(list, from);
    if (idx < 0) { window.showToast?.('No ' + what + ' in this log'); return; }
    this._jump(view, idx);
  },
  _searchNext(view, query) {
    view.matches = this.search(view.parsed, query);
    if (!view.matches.length) { window.showToast?.('Not found'); this._rows(view); return; }
    this._jump(view, this.nextIn(view.matches, view.cursor));
  },
  // Open the section the line is in, make sure it is drawn, scroll to it.
  _jump(view, idx) {
    const l = view.parsed.lines[idx];
    if (l.group >= 0) view.shown.add(l.group);
    if (idx >= view.limit) view.limit = idx + this.CHUNK;
    view.cursor = idx;
    this._rows(view);
    const row = view.rows.get(idx);
    if (row) { row.scrollIntoView({ block: 'center' }); row.style.outline = '2px solid var(--accent, #4c8dff)'; }
  },

  // ---- commands and Settings -----------------------------------------------------------------------
  async readTab() { this.open(await this.fromTab()); },
  async readFile() { const r = await this.fromFile(); if (r) this.open(r); },

  registerCommands() {
    if (typeof VexModuleCommands === 'undefined') return false;
    const run = (fn) => () => { Promise.resolve().then(fn).catch(err => DevDeskUtil.fail('Log reader', err)); };
    VexModuleCommands.set('logreader:', this.enabled() ? [
      { id: 'logreader:tab', label: 'Read this page as a log', icon: 'code', hint: 'Fold sections, jump to errors, search, colours - local only', action: run(() => this.readTab()) },
      { id: 'logreader:file', label: 'Open a log file...', icon: 'code', hint: 'Pick a .log or .txt file to read here', action: run(() => this.readFile()) },
    ] : []);
    return true;
  },
  settingsRows(body) {
    const S = VexSettingsGroup;
    body.appendChild(S.note('Log reader: Ctrl+K > "Read this page as a log" (a CI raw log, a .log file) folds sections, jumps to the first error, searches and shows colours. The text stays in this window.'));
    body.appendChild(S.toggle('Log reader', this.enabled(), (on) => { this.setEnabled(on); this.registerCommands(); }));
  },
};

if (typeof window !== 'undefined') {
  window.LogReader = LogReader;
  LogReader.registerCommands();
  document.addEventListener('DOMContentLoaded', () => LogReader.registerCommands());
}
if (typeof module !== 'undefined' && module.exports) module.exports = { LogReader };

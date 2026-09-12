// === Vex Notes & Scratchpad ===
//
// Two kinds of note live here, in one panel:
//   • Notes      — freeform markdown documents (localStorage 'vex.notes')
//   • Page notes — the per-URL sticky notes owned by js/sticky-notes.js
//                  (localStorage 'vex.stickyNotes'), browsable and editable
//                  from the "Page notes" section instead of only through the
//                  command bar.
//
// Editing model: the textarea is created ONCE and never re-created by
// innerHTML, and every handler resolves the note by id through getActive()
// rather than closing over a note object. That is what keeps edits alive when
// something else (a sync pull, ClipToNotes) swaps this.notes for a fresh array.

const NotesPanel = {
  STORAGE_KEY: 'vex.notes',
  PREFS_KEY: 'vex.notes.prefs',
  NARROW_AT: 560,

  notes: [],
  activeNoteId: null,
  activeStickyKey: null,
  section: 'notes',      // 'notes' | 'sticky'
  query: '',
  sort: 'edited',        // 'edited' | 'created' | 'title'
  tagFilter: '',
  saveTimer: null,
  previewMode: false,

  // ---------------------------------------------------------------- icons --
  // No emoji anywhere: small stroke icons that inherit the theme colour.
  _icon(name, size = 14) {
    const p = {
      plus: '<path d="M12 5v14M5 12h14"/>',
      sticky: '<path d="M14 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h8l6-6V5a2 2 0 0 0-2-2z"/><path d="M19 15h-4a2 2 0 0 0-2 2v4"/>',
      clip: '<circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M20 4 8.12 15.88M14.47 14.48 20 20M8.12 8.12 12 12"/>',
      search: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.35-4.35"/>',
      back: '<path d="M19 12H5M12 19l-7-7 7-7"/>',
      bold: '<path d="M6 4h7a4 4 0 0 1 0 8H6z"/><path d="M6 12h8a4 4 0 0 1 0 8H6z"/>',
      italic: '<path d="M19 4h-9M14 20H5M15 4 9 20"/>',
      heading: '<path d="M6 4v16M18 4v16M6 12h12"/>',
      list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
      task: '<path d="m3 7 2 2 4-4"/><path d="m3 17 2 2 4-4"/><path d="M13 7h8M13 17h8"/>',
      code: '<path d="m16 18 6-6-6-6M8 6l-6 6 6 6"/>',
      link: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
      eye: '<path d="M2 12s3.64-7 10-7 10 7 10 7-3.64 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/>',
      pencil: '<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z"/>',
      pin: '<path d="M12 17v5"/><path d="M9 3h6l-1 6 3 3v2H7v-2l3-3z"/>',
      more: '<circle cx="12" cy="5" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="12" cy="19" r="1"/>',
      trash: '<path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>',
      copy: '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
      download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/><path d="M12 15V3"/>',
      external: '<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><path d="M15 3h6v6"/><path d="M10 14 21 3"/>',
      close: '<path d="M18 6 6 18M6 6l12 12"/>',
      tag: '<path d="M20.59 13.41 12 22l-9-9V3h10l7.59 7.59a2 2 0 0 1 0 2.82z"/><path d="M7 7h.01"/>',
      duplicate: '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
    }[name] || '';
    return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`;
  },

  // ----------------------------------------------------------- pure logic --
  // Kept side-effect free and exported on the module so they can be unit
  // tested without a DOM.

  // Stored notes come from three writers (this panel, ClipToNotes, a sync
  // pull) and older versions wrote fewer fields. Read through this instead of
  // touching note.title/note.content directly — a record missing `title` used
  // to throw out of renderList() and leave the list blank.
  normalize(note) {
    const n = note && typeof note === 'object' ? note : {};
    return {
      id: typeof n.id === 'string' && n.id ? n.id : '',
      title: typeof n.title === 'string' ? n.title : '',
      content: typeof n.content === 'string' ? n.content : '',
      pinned: !!n.pinned,
      tags: Array.isArray(n.tags) ? n.tags.filter(t => typeof t === 'string' && t.trim()).map(t => t.trim()) : [],
      sourceUrl: typeof n.sourceUrl === 'string' ? n.sourceUrl : '',
      sourceTitle: typeof n.sourceTitle === 'string' ? n.sourceTitle : '',
      createdAt: typeof n.createdAt === 'string' ? n.createdAt : '',
      updatedAt: typeof n.updatedAt === 'string' ? n.updatedAt : '',
    };
  },

  matches(note, query) {
    const q = String(query || '').trim().toLowerCase();
    if (!q) return true;
    const n = this.normalize(note);
    return n.title.toLowerCase().includes(q) ||
      n.content.toLowerCase().includes(q) ||
      n.tags.some(t => t.toLowerCase().includes(q)) ||
      n.sourceTitle.toLowerCase().includes(q) ||
      n.sourceUrl.toLowerCase().includes(q);
  },

  // Pinned notes always lead; the chosen key orders the rest.
  sortNotes(list, sort) {
    const time = (s) => { const t = Date.parse(s || ''); return Number.isFinite(t) ? t : 0; };
    const key = sort || 'edited';
    return [...(list || [])].sort((a, b) => {
      const A = this.normalize(a), B = this.normalize(b);
      if (A.pinned !== B.pinned) return A.pinned ? -1 : 1;
      if (key === 'title') return (A.title || 'Untitled').localeCompare(B.title || 'Untitled', undefined, { sensitivity: 'base' });
      if (key === 'created') return time(B.createdAt) - time(A.createdAt);
      return time(B.updatedAt) - time(A.updatedAt);
    });
  },

  allTags(list) {
    const seen = new Map();
    for (const note of list || []) {
      for (const tag of this.normalize(note).tags) {
        const k = tag.toLowerCase();
        if (!seen.has(k)) seen.set(k, tag);
      }
    }
    return [...seen.values()].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
  },

  // One-line summary for the list: markdown syntax stripped so a note that
  // starts with "# " doesn't read as "# " in the sidebar.
  previewText(content, max = 90) {
    const flat = String(content || '')
      .replace(/```[\s\S]*?```/g, ' ')
      .replace(/^\s{0,3}#{1,6}\s+/gm, '')
      .replace(/^\s*[-*+]\s+\[[ xX]\]\s+/gm, '')
      .replace(/^\s*[-*+]\s+/gm, '')
      .replace(/^\s*>\s?/gm, '')
      .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/[*_`~]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    return flat.length > max ? flat.slice(0, max - 1) + '…' : flat;
  },

  wordStats(content) {
    const text = String(content || '');
    const words = text.trim() ? text.trim().split(/\s+/).filter(Boolean).length : 0;
    return { words, chars: text.length, minutes: Math.max(1, Math.round(words / 200)) };
  },

  // Flip the nth "- [ ]" / "- [x]" line. The nth checkbox in the rendered
  // preview is the nth task line in the source, so the index lines up.
  toggleTask(content, index) {
    const lines = String(content || '').split('\n');
    let seen = -1;
    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(/^(\s*(?:[-*+]|\d+[.)])\s+)\[([ xX])\](.*)$/);
      if (!m) continue;
      seen++;
      if (seen !== index) continue;
      lines[i] = m[1] + (m[2] === ' ' ? '[x]' : '[ ]') + m[3];
      return lines.join('\n');
    }
    return String(content || '');
  },

  // Markdown toolbar. Returns the new text plus where the caret should land,
  // so the caller can restore the selection.
  applyFormat(text, start, end, kind) {
    const src = String(text || '');
    const s = Math.max(0, Math.min(src.length, start | 0));
    const e = Math.max(s, Math.min(src.length, end | 0));
    const sel = src.slice(s, e);

    const WRAP = { bold: '**', italic: '*', code: '`' };
    if (WRAP[kind]) {
      const mark = WRAP[kind];
      const before = src.slice(Math.max(0, s - mark.length), s);
      const after = src.slice(e, e + mark.length);
      if (sel && before === mark && after === mark) {            // already wrapped -> unwrap
        return { text: src.slice(0, s - mark.length) + sel + src.slice(e + mark.length), start: s - mark.length, end: e - mark.length };
      }
      const body = sel || (kind === 'code' ? 'code' : kind);
      return { text: src.slice(0, s) + mark + body + mark + src.slice(e), start: s + mark.length, end: s + mark.length + body.length };
    }

    if (kind === 'link') {
      const label = sel || 'link';
      const out = `[${label}](url)`;
      return { text: src.slice(0, s) + out + src.slice(e), start: s + label.length + 3, end: s + label.length + 6 };
    }

    const PREFIX = { heading: '## ', list: '- ', task: '- [ ] ', quote: '> ' };
    const prefix = PREFIX[kind];
    if (!prefix) return { text: src, start: s, end: e };

    // Line-level prefixes apply to every line the selection touches.
    const lineStart = src.lastIndexOf('\n', s - 1) + 1;
    const lineEndIdx = src.indexOf('\n', e);
    const lineEnd = lineEndIdx === -1 ? src.length : lineEndIdx;
    const block = src.slice(lineStart, lineEnd);
    const lines = block.split('\n');
    const allHave = lines.every(l => l.startsWith(prefix));
    const next = lines.map(l => allHave ? l.slice(prefix.length) : prefix + l).join('\n');
    const delta = next.length - block.length;
    return { text: src.slice(0, lineStart) + next + src.slice(lineEnd), start: lineStart, end: lineEnd + delta };
  },

  noteToMarkdown(note) {
    const n = this.normalize(note);
    const head = [`# ${n.title || 'Untitled'}`];
    if (n.tags.length) head.push(`Tags: ${n.tags.map(t => '#' + t).join(' ')}`);
    if (n.sourceUrl) head.push(`Source: [${n.sourceTitle || n.sourceUrl}](${n.sourceUrl})`);
    return head.join('\n') + '\n\n' + n.content + '\n';
  },

  formatDate(iso) {
    const t = Date.parse(iso || '');
    if (!Number.isFinite(t)) return '';
    const d = new Date(t);
    const now = new Date();
    const sameDay = d.toDateString() === now.toDateString();
    if (sameDay) return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
    const sameYear = d.getFullYear() === now.getFullYear();
    return d.toLocaleDateString(undefined, sameYear ? { month: 'short', day: 'numeric' } : { year: 'numeric', month: 'short', day: 'numeric' });
  },

  // Markdown -> HTML. Delegates to the sanitized shared renderer (the old
  // hand-rolled regex chain emitted broken markup like "</p><p>" before any
  // <p> was opened) and then upgrades "- [ ]" items into real checkboxes.
  renderMarkdown(text) {
    const src = String(text || '');
    if (!src.trim()) return `<div class="notes-preview-empty">Nothing to preview yet</div>`;
    const md = (typeof window !== 'undefined' && window.VexMarkdown) ? window.VexMarkdown : null;
    let html = md ? md.render(src) : `<p>${this._esc(src).replace(/\n/g, '<br>')}</p>`;
    let i = 0;
    html = html.replace(/<li>\[([ xX])\]\s?/g, (_, mark) => {
      const checked = mark !== ' ';
      return `<li class="notes-task${checked ? ' done' : ''}"><input type="checkbox" class="notes-task-box" data-task="${i++}"${checked ? ' checked' : ''}> `;
    });
    return html;
  },

  // ----------------------------------------------------------- persistence --
  reloadSyncedState(repaint = true) {
    try {
      const saved = localStorage.getItem(this.STORAGE_KEY);
      const parsed = saved ? JSON.parse(saved) : [];
      if (Array.isArray(parsed)) this.notes = parsed;
    } catch {}
    if (!this.notes.some(note => note && note.id === this.activeNoteId)) this.activeNoteId = null;
    if (repaint && this._el('notes-list')) {
      this.renderList();
      if (this.activeNoteId) this._fillEditor(); else this._showEmpty();
    }
  },

  save() {
    this._captureEditor();
    clearTimeout(this.saveTimer);
    this.saveTimer = null;
    try { localStorage.setItem(this.STORAGE_KEY, JSON.stringify(this.notes)); } catch {}
    this._setSaveState('Saved');
  },

  debounceSave() {
    this._setSaveState('Saving…');
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.save(), 600);
  },

  // Write whatever is in the editor straight to disk. Called when the note
  // changes, the panel closes and the window goes away — a 600ms debounce used
  // to be enough to lose the last sentence you typed.
  flush() {
    if (this.saveTimer || this._editorDirty()) this.save();
  },

  _prefs() {
    try {
      const p = JSON.parse(localStorage.getItem(this.PREFS_KEY) || '{}');
      return (p && typeof p === 'object') ? p : {};
    } catch { return {}; }
  },
  _savePrefs() {
    try { localStorage.setItem(this.PREFS_KEY, JSON.stringify({ sort: this.sort, section: this.section })); } catch {}
  },

  // Pull the live editor values back into this.notes. Anything that replaces
  // the array wholesale (ClipToNotes) calls renderList() straight after, so
  // doing this first keeps in-flight typing from being dropped.
  _captureEditor() {
    const note = this.notes.find(n => n && n.id === this.activeNoteId);
    if (!note) return;
    const ta = this._el('notes-content-area');
    const ti = this._el('notes-title-input');
    if (!ta || !ti) return;
    let changed = false;
    if (typeof ta.value === 'string' && ta.value !== note.content) { note.content = ta.value; changed = true; }
    if (typeof ti.value === 'string' && ti.value !== note.title) { note.title = ti.value; changed = true; }
    if (changed) note.updatedAt = new Date().toISOString();
  },

  _editorDirty() {
    const note = this.notes.find(n => n && n.id === this.activeNoteId);
    const ta = this._el('notes-content-area');
    const ti = this._el('notes-title-input');
    if (!note || !ta || !ti) return false;
    return ta.value !== note.content || ti.value !== note.title;
  },

  // ------------------------------------------------------------- rendering --
  init() {
    const panel = document.getElementById('panel-notes');
    if (!panel) return;
    if (panel.dataset.rendered) {
      // Re-opening must show what is on disk now: a clip, a sync pull or a
      // second window may have changed it while the panel was hidden.
      this.reloadSyncedState();
      this.renderStickyList();
      this._measure();
      return;
    }
    panel.dataset.rendered = 'true';

    const prefs = this._prefs();
    if (prefs.sort === 'edited' || prefs.sort === 'created' || prefs.sort === 'title') this.sort = prefs.sort;
    if (prefs.section === 'sticky') this.section = 'sticky';

    this.reloadSyncedState(false);

    panel.innerHTML = `
      <div class="notes-container" id="notes-container">
        <div class="notes-sidebar">
          <div class="notes-sidebar-header">
            <h3>Notes</h3>
            <button class="notes-icon-btn" id="notes-clip-btn" title="Clip this page into Notes">${this._icon('clip')}</button>
            <button class="notes-icon-btn" id="notes-sticky-btn" title="Sticky note for this page">${this._icon('sticky')}</button>
            <button class="notes-icon-btn" id="notes-add-btn" title="New note">${this._icon('plus')}</button>
          </div>
          <div class="notes-sections" role="tablist">
            <button class="notes-section-tab" data-section="notes" role="tab">Notes <span class="notes-count" id="notes-count-notes">0</span></button>
            <button class="notes-section-tab" data-section="sticky" role="tab">Page notes <span class="notes-count" id="notes-count-sticky">0</span></button>
          </div>
          <div class="notes-search">
            <span class="notes-search-icon">${this._icon('search', 13)}</span>
            <input type="text" id="notes-search-input" placeholder="Search notes..." autocomplete="off" spellcheck="false">
            <select id="notes-sort" title="Sort notes" aria-label="Sort notes">
              <option value="edited">Edited</option>
              <option value="created">Created</option>
              <option value="title">Title</option>
            </select>
          </div>
          <div class="notes-tagbar" id="notes-tagbar"></div>
          <div class="notes-list" id="notes-list"></div>
        </div>

        <div class="notes-detail" id="notes-detail">
          <div class="notes-editor" id="notes-editor" hidden>
            <div class="notes-editor-header">
              <button class="notes-icon-btn notes-back-btn" id="notes-back-btn" title="Back to the list">${this._icon('back')}</button>
              <input type="text" id="notes-title-input" placeholder="Note title...">
            </div>
            <div class="notes-meta-row" id="notes-meta-row"></div>
            <div class="notes-toolbar">
              <button class="notes-fmt" data-fmt="bold" title="Bold (Ctrl+B)">${this._icon('bold', 13)}</button>
              <button class="notes-fmt" data-fmt="italic" title="Italic (Ctrl+I)">${this._icon('italic', 13)}</button>
              <button class="notes-fmt" data-fmt="heading" title="Heading">${this._icon('heading', 13)}</button>
              <button class="notes-fmt" data-fmt="list" title="Bullet list">${this._icon('list', 13)}</button>
              <button class="notes-fmt" data-fmt="task" title="Checklist item">${this._icon('task', 13)}</button>
              <button class="notes-fmt" data-fmt="code" title="Inline code">${this._icon('code', 13)}</button>
              <button class="notes-fmt" data-fmt="link" title="Link">${this._icon('link', 13)}</button>
              <span class="notes-toolbar-sep"></span>
              <button id="notes-preview-btn" title="Preview markdown">${this._icon('eye', 13)}</button>
              <button id="notes-pin-btn" title="Pin note">${this._icon('pin', 13)}</button>
              <button id="notes-tag-btn" title="Add a tag">${this._icon('tag', 13)}</button>
              <div class="spacer"></div>
              <button id="notes-more-btn" title="More actions">${this._icon('more', 13)}</button>
            </div>
            <div class="notes-editor-area" id="notes-editor-area">
              <textarea id="notes-content-area" placeholder="Start writing... markdown works, and &quot;- [ ] thing&quot; makes a checklist" spellcheck="false"></textarea>
              <div class="notes-preview vex-md" id="notes-preview" hidden></div>
            </div>
            <div class="notes-statusbar">
              <span class="notes-word-count" id="notes-word-count">0 words</span>
              <span class="spacer"></span>
              <span class="notes-save-state" id="notes-save-state"></span>
            </div>
          </div>

          <div class="notes-sticky-view" id="notes-sticky-view" hidden>
            <div class="notes-editor-header">
              <button class="notes-icon-btn notes-back-btn" id="notes-sticky-back" title="Back to the list">${this._icon('back')}</button>
              <div class="notes-sticky-heading">
                <div class="notes-sticky-title" id="notes-sticky-title"></div>
                <div class="notes-sticky-url" id="notes-sticky-url"></div>
              </div>
            </div>
            <div class="notes-toolbar">
              <button id="notes-sticky-open" title="Open this page">${this._icon('external', 13)}<span>Open page</span></button>
              <button id="notes-sticky-show" title="Show the sticky card on screen">${this._icon('sticky', 13)}<span>Show card</span></button>
              <button id="notes-sticky-convert" title="Turn this into a full note">${this._icon('pencil', 13)}<span>To note</span></button>
              <div class="spacer"></div>
              <button id="notes-sticky-delete" class="danger" title="Delete this page note">${this._icon('trash', 13)}</button>
            </div>
            <div class="notes-editor-area">
              <textarea id="notes-sticky-text" placeholder="Note for this page…" spellcheck="false"></textarea>
            </div>
            <div class="notes-statusbar">
              <span class="notes-word-count" id="notes-sticky-count">0 words</span>
              <span class="spacer"></span>
              <span class="notes-save-state" id="notes-sticky-state"></span>
            </div>
          </div>

          <div class="notes-empty" id="notes-empty-state"></div>
        </div>
      </div>
    `;

    this.bindEvents();
    this._syncSectionTabs();
    this.renderList();
    this.renderStickyList();
    this._showEmpty();
    this._measure();
  },

  _el(id) { return document.getElementById(id); },
  _esc(s) { return (typeof window !== 'undefined' && window.escapeHtml) ? window.escapeHtml(s) : String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'); },

  bindEvents() {
    this._el('notes-add-btn')?.addEventListener('click', () => this.createNote());
    this._el('notes-sticky-btn')?.addEventListener('click', () => this.newStickyForPage());
    this._el('notes-clip-btn')?.addEventListener('click', () => this.clipCurrentPage());
    this._el('notes-back-btn')?.addEventListener('click', () => this._backToList());
    this._el('notes-sticky-back')?.addEventListener('click', () => this._backToList());

    document.querySelectorAll('#panel-notes .notes-section-tab').forEach(tab => {
      tab.addEventListener('click', () => this.setSection(tab.dataset.section));
    });

    this._el('notes-search-input')?.addEventListener('input', (e) => {
      this.query = e.target.value;
      this.section === 'sticky' ? this.renderStickyList() : this.renderList();
    });

    this._el('notes-sort')?.addEventListener('change', (e) => {
      this.sort = e.target.value;
      this._savePrefs();
      this.renderList();
    });

    this._el('notes-title-input')?.addEventListener('input', () => {
      const note = this.getActive();
      if (!note) return;
      note.title = this._el('notes-title-input').value;
      note.updatedAt = new Date().toISOString();
      this.debounceSave();
      this.renderList();
    });

    const ta = this._el('notes-content-area');
    ta?.addEventListener('input', () => {
      const note = this.getActive();
      if (!note) return;
      note.content = ta.value;
      note.updatedAt = new Date().toISOString();
      this.debounceSave();
      this.updateWordCount();
    });
    ta?.addEventListener('keydown', (e) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      const k = e.key.toLowerCase();
      const kind = k === 'b' ? 'bold' : k === 'i' ? 'italic' : k === 'e' ? 'code' : '';
      if (!kind) return;
      e.preventDefault();
      this.format(kind);
    });

    document.querySelectorAll('#panel-notes .notes-fmt').forEach(btn => {
      btn.addEventListener('click', () => this.format(btn.dataset.fmt));
    });

    this._el('notes-preview-btn')?.addEventListener('click', () => this.togglePreview());
    this._el('notes-pin-btn')?.addEventListener('click', () => this.togglePin());
    this._el('notes-tag-btn')?.addEventListener('click', () => this.addTag());
    this._el('notes-more-btn')?.addEventListener('click', (e) => this._openMoreMenu(e));

    // Note list — delegated, so re-rendering never leaves dangling handlers.
    this._el('notes-list')?.addEventListener('click', (e) => {
      const sticky = e.target.closest('.sticky-list-item');
      if (sticky) { this.selectSticky(sticky.dataset.key); return; }
      const item = e.target.closest('.note-list-item');
      if (item) this.selectNote(item.dataset.id);
    });

    this._el('notes-tagbar')?.addEventListener('click', (e) => {
      const chip = e.target.closest('[data-tag]');
      if (!chip) return;
      this.tagFilter = this.tagFilter === chip.dataset.tag ? '' : chip.dataset.tag;
      this.renderList();
    });

    this._el('notes-meta-row')?.addEventListener('click', (e) => {
      const remove = e.target.closest('[data-remove-tag]');
      if (remove) { this.removeTag(remove.dataset.removeTag); return; }
      const src = e.target.closest('[data-source-url]');
      if (src) { try { TabManager.createTab(src.dataset.sourceUrl, true); } catch {} }
    });

    // Preview: checkbox toggles write back to the markdown; links open tabs
    // rather than navigating the chrome window out from under the app.
    const preview = this._el('notes-preview');
    preview?.addEventListener('change', (e) => {
      const box = e.target.closest('.notes-task-box');
      if (!box) return;
      const note = this.getActive();
      if (!note) return;
      note.content = this.toggleTask(note.content, Number(box.dataset.task));
      note.updatedAt = new Date().toISOString();
      const area = this._el('notes-content-area');
      if (area) area.value = note.content;
      this.save();
      this._renderPreview();
      this.updateWordCount();
      this.renderList();
    });
    const openMdLink = (e) => {
      const a = e.target?.closest?.('a.vex-md-link');
      if (!a) return;
      e.preventDefault();
      if (e.button !== 0 && e.button !== 1) return;
      try { TabManager.createTab(a.href, true); } catch {}
    };
    preview?.addEventListener('click', openMdLink);
    preview?.addEventListener('auxclick', openMdLink);

    // Sticky editor
    const sta = this._el('notes-sticky-text');
    sta?.addEventListener('input', () => this._debounceStickySave());
    this._el('notes-sticky-open')?.addEventListener('click', () => {
      if (this.activeStickyKey && window.StickyNotes) StickyNotes.openPage(this.activeStickyKey);
    });
    this._el('notes-sticky-show')?.addEventListener('click', () => {
      this._flushSticky();
      if (this.activeStickyKey && window.StickyNotes) StickyNotes.open(this.activeStickyKey);
    });
    this._el('notes-sticky-convert')?.addEventListener('click', () => this.convertStickyToNote());
    this._el('notes-sticky-delete')?.addEventListener('click', () => this.deleteSticky());

    if (typeof window !== 'undefined') {
      window.addEventListener('vex-sticky-notes-changed', () => {
        if (this._el('notes-list')) this.renderStickyList();
      });
      // A panel switch or a closing window must not eat the last edit.
      document.addEventListener('vex:panel-changed', () => { this.flush(); this._flushSticky(); });
      window.addEventListener('beforeunload', () => { this.flush(); this._flushSticky(); });
    }

    // 420px docked sidebar: fall back to one column and swap list/detail.
    const container = this._el('notes-container');
    if (container && typeof ResizeObserver !== 'undefined') {
      this._ro = new ResizeObserver(() => this._measure());
      this._ro.observe(container);
    }
  },

  _measure() {
    const c = this._el('notes-container');
    if (!c) return;
    const w = c.getBoundingClientRect().width || c.clientWidth || 0;
    if (w > 0) c.classList.toggle('narrow', w < this.NARROW_AT);
    c.classList.toggle('detail-open', !!(this.activeNoteId || this.activeStickyKey));
  },

  _backToList() {
    this.flush(); this._flushSticky();
    this.activeNoteId = null;
    this.activeStickyKey = null;
    this._showEmpty();
    this.section === 'sticky' ? this.renderStickyList() : this.renderList();
    this._measure();
  },

  setSection(section) {
    if (section !== 'notes' && section !== 'sticky') return;
    this.flush(); this._flushSticky();
    this.section = section;
    this.activeNoteId = null;
    this.activeStickyKey = null;
    this._savePrefs();
    this._syncSectionTabs();
    this._showEmpty();
    section === 'sticky' ? this.renderStickyList() : this.renderList();
    this._measure();
  },

  // Entry point used by StickyNotes.list() and the command bar.
  openStickySection() {
    const panel = document.getElementById('panel-notes');
    if (!panel) return false;
    // Bare identifier, not window.*: see above.
    const sidebar = (typeof SidebarManager !== 'undefined' && SidebarManager)
      || (typeof window !== 'undefined' && window.SidebarManager) || null;
    if (!sidebar || typeof sidebar.showPanel !== 'function') return false;
    sidebar.showPanel('notes');
    this.init();
    this.setSection('sticky');
    // Only claim success if the panel is really on screen, so the caller's
    // fallback still runs when it is not.
    return getComputedStyle(panel).display !== 'none';
  },

  _syncSectionTabs() {
    document.querySelectorAll('#panel-notes .notes-section-tab').forEach(tab => {
      tab.classList.toggle('active', tab.dataset.section === this.section);
      tab.setAttribute('aria-selected', tab.dataset.section === this.section ? 'true' : 'false');
    });
    const sortSel = this._el('notes-sort');
    if (sortSel) { sortSel.hidden = this.section !== 'notes'; sortSel.value = this.sort; }
    const tagbar = this._el('notes-tagbar');
    if (tagbar) tagbar.hidden = this.section !== 'notes';
    const search = this._el('notes-search-input');
    if (search) search.placeholder = this.section === 'sticky' ? 'Search page notes...' : 'Search notes...';
  },

  // ---------------------------------------------------------------- notes --
  createNote() {
    this.flush();
    const now = new Date().toISOString();
    const note = { id: 'note_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7), title: '', content: '', pinned: false, tags: [], sourceUrl: '', sourceTitle: '', createdAt: now, updatedAt: now };
    this.notes.unshift(note);
    this.query = '';
    this.tagFilter = '';
    const search = this._el('notes-search-input');
    if (search) search.value = '';
    if (this.section !== 'notes') { this.section = 'notes'; this._savePrefs(); this._syncSectionTabs(); }
    this.save();
    this.selectNote(note.id);
    const ti = this._el('notes-title-input');
    ti?.focus();
    ti?.select();
  },

  selectNote(id) {
    this.flush(); this._flushSticky();
    const note = this.notes.find(n => n && n.id === id);
    if (!note) {                              // deleted or never existed
      this.activeNoteId = null;
      this._showEmpty();
      this.renderList();
      return;
    }
    this.activeNoteId = id;
    this.activeStickyKey = null;
    this.previewMode = false;
    this._fillEditor();
    this.renderList();
    this._measure();
  },

  _fillEditor() {
    const note = this.getActive();
    if (!note) { this._showEmpty(); return; }
    const n = this.normalize(note);

    this._el('notes-editor').hidden = false;
    this._el('notes-sticky-view').hidden = true;
    this._el('notes-empty-state').hidden = true;

    this._el('notes-title-input').value = n.title;
    const ta = this._el('notes-content-area');
    if (ta && !(document.activeElement === ta && ta.value === n.content)) ta.value = n.content;

    this._applyPreviewMode();
    this._renderMetaRow();
    const pin = this._el('notes-pin-btn');
    if (pin) { pin.classList.toggle('active', n.pinned); pin.title = n.pinned ? 'Unpin note' : 'Pin note'; }
    this.updateWordCount();
    this._setSaveState('');
  },

  _showEmpty() {
    const editor = this._el('notes-editor');
    const sticky = this._el('notes-sticky-view');
    const empty = this._el('notes-empty-state');
    if (!empty) return;
    if (editor) editor.hidden = true;
    if (sticky) sticky.hidden = true;
    empty.hidden = false;
    const ui = (typeof window !== 'undefined' && window.VexUI) ? window.VexUI : null;
    empty.innerHTML = this.section === 'sticky'
      ? (ui ? ui.emptyState('note', 'No page note selected', 'Pick a page on the left, or add one for the page you are on') : 'No page note selected')
      : (ui ? ui.emptyState('note', 'Select or create a note', 'Markdown, checklists and tags — synced across your devices') : 'Select or create a note');
  },

  getActive() { return this.notes.find(n => n && n.id === this.activeNoteId); },

  async deleteActive() {
    const note = this.getActive();
    if (!note) return;
    const title = this.normalize(note).title || 'Untitled';
    const ok = (typeof window !== 'undefined' && window.vexConfirm)
      ? await window.vexConfirm({ title: 'Delete note', message: `Delete "${title}"? This cannot be undone.`, okLabel: 'Delete', danger: true })
      : true;
    if (!ok) return;
    clearTimeout(this.saveTimer);
    this.saveTimer = null;
    this.notes = this.notes.filter(n => n && n.id !== note.id);
    this.activeNoteId = null;
    try { localStorage.setItem(this.STORAGE_KEY, JSON.stringify(this.notes)); } catch {}
    this._showEmpty();
    this.renderList();
    this._measure();
    try { window.showToast?.('Note deleted'); } catch {}
  },

  duplicateActive() {
    const note = this.getActive();
    if (!note) return;
    this.flush();
    const n = this.normalize(note);
    const now = new Date().toISOString();
    const copy = { ...n, id: 'note_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7), title: (n.title || 'Untitled') + ' copy', pinned: false, createdAt: now, updatedAt: now };
    this.notes.unshift(copy);
    this.save();
    this.selectNote(copy.id);
  },

  togglePin() {
    const note = this.getActive();
    if (!note) return;
    note.pinned = !note.pinned;
    note.updatedAt = new Date().toISOString();
    this.save();
    const pin = this._el('notes-pin-btn');
    if (pin) { pin.classList.toggle('active', !!note.pinned); pin.title = note.pinned ? 'Unpin note' : 'Pin note'; }
    this.renderList();
  },

  togglePreview() {
    if (!this.getActive()) return;
    this.previewMode = !this.previewMode;
    this._applyPreviewMode();
  },

  _applyPreviewMode() {
    const btn = this._el('notes-preview-btn');
    const ta = this._el('notes-content-area');
    const pv = this._el('notes-preview');
    if (!btn || !ta || !pv) return;
    btn.classList.toggle('active', this.previewMode);
    btn.title = this.previewMode ? 'Back to editing' : 'Preview markdown';
    btn.innerHTML = this.previewMode ? this._icon('pencil', 13) : this._icon('eye', 13);
    ta.hidden = this.previewMode;
    pv.hidden = !this.previewMode;
    document.querySelectorAll('#panel-notes .notes-fmt').forEach(b => { b.disabled = this.previewMode; });
    if (this.previewMode) this._renderPreview();
  },

  _renderPreview() {
    const pv = this._el('notes-preview');
    const note = this.getActive();
    if (pv) pv.innerHTML = this.renderMarkdown(note ? this.normalize(note).content : '');
  },

  format(kind) {
    const ta = this._el('notes-content-area');
    const note = this.getActive();
    if (!ta || !note || this.previewMode) return;
    const out = this.applyFormat(ta.value, ta.selectionStart, ta.selectionEnd, kind);
    ta.value = out.text;
    ta.setSelectionRange(out.start, out.end);
    ta.focus();
    note.content = out.text;
    note.updatedAt = new Date().toISOString();
    this.debounceSave();
    this.updateWordCount();
  },

  async addTag() {
    const note = this.getActive();
    if (!note) return;
    const raw = (typeof window !== 'undefined' && window.vexPrompt)
      ? await window.vexPrompt({ title: 'Add a tag', placeholder: 'research, todo, recipes…', okLabel: 'Add' })
      : null;
    const tag = String(raw || '').trim().replace(/^#/, '').slice(0, 32);
    if (!tag) return;
    const tags = this.normalize(note).tags;
    if (!tags.some(t => t.toLowerCase() === tag.toLowerCase())) tags.push(tag);
    note.tags = tags;
    note.updatedAt = new Date().toISOString();
    this.save();
    this._renderMetaRow();
    this.renderList();
  },

  removeTag(tag) {
    const note = this.getActive();
    if (!note) return;
    note.tags = this.normalize(note).tags.filter(t => t.toLowerCase() !== String(tag).toLowerCase());
    note.updatedAt = new Date().toISOString();
    if (this.tagFilter && this.tagFilter.toLowerCase() === String(tag).toLowerCase() && !this.allTags(this.notes).some(t => t.toLowerCase() === this.tagFilter.toLowerCase())) this.tagFilter = '';
    this.save();
    this._renderMetaRow();
    this.renderList();
  },

  // Remember which page a note came from, so a research note can get you back.
  attachCurrentPage() {
    const note = this.getActive();
    if (!note) return;
    let tab = null;
    try { tab = TabManager.getActiveTab(); } catch {}
    if (!tab || !tab.url) { try { window.showToast?.('Open a page first'); } catch {} return; }
    note.sourceUrl = tab.url;
    note.sourceTitle = tab.title || tab.url;
    note.updatedAt = new Date().toISOString();
    this.save();
    this._renderMetaRow();
    try { window.showToast?.('Page linked to this note'); } catch {}
  },

  _renderMetaRow() {
    const row = this._el('notes-meta-row');
    const note = this.getActive();
    if (!row) return;
    if (!note) { row.innerHTML = ''; row.hidden = true; return; }
    const n = this.normalize(note);
    const chips = n.tags.map(t => `<span class="notes-tag-chip">#${this._esc(t)}<button data-remove-tag="${this._esc(t)}" title="Remove tag" aria-label="Remove tag ${this._esc(t)}">${this._icon('close', 10)}</button></span>`).join('');
    const source = n.sourceUrl
      ? `<button class="notes-source-chip" data-source-url="${this._esc(n.sourceUrl)}" title="${this._esc(n.sourceUrl)}">${this._icon('external', 11)}<span>${this._esc(this.previewText(n.sourceTitle || n.sourceUrl, 40))}</span></button>`
      : '';
    row.innerHTML = chips + source;
    row.hidden = !chips && !source;
  },

  updateWordCount() {
    const note = this.getActive();
    const ta = this._el('notes-content-area');
    const text = ta && !ta.hidden ? ta.value : (note ? this.normalize(note).content : '');
    const s = this.wordStats(text);
    const el = this._el('notes-word-count');
    if (el) el.textContent = `${s.words} word${s.words === 1 ? '' : 's'} · ${s.chars} char${s.chars === 1 ? '' : 's'}${s.words > 40 ? ' · ~' + s.minutes + ' min' : ''}`;
  },

  _setSaveState(text) {
    const el = this._el('notes-save-state');
    if (!el) return;
    el.textContent = text;
    if (text === 'Saved') {
      clearTimeout(this._saveStateTimer);
      this._saveStateTimer = setTimeout(() => { if (el.textContent === 'Saved') el.textContent = ''; }, 1400);
    }
  },

  // ----------------------------------------------------------- more menu ---
  _openMoreMenu(e) {
    document.getElementById('notes-more-menu')?.remove();
    const note = this.getActive();
    if (!note) return;
    const btn = e.currentTarget;
    const r = btn.getBoundingClientRect();
    const menu = document.createElement('div');
    menu.id = 'notes-more-menu';
    menu.className = 'notes-menu';
    menu.innerHTML = [
      ['copy', 'copy', 'Copy as markdown'],
      ['export', 'download', 'Export as .md'],
      ['attach', 'link', 'Link to the current page'],
      ['duplicate', 'duplicate', 'Duplicate note'],
      ['delete', 'trash', 'Delete note'],
    ].map(([act, icon, label]) => `<button data-act="${act}"${act === 'delete' ? ' class="danger"' : ''}>${this._icon(icon, 13)}<span>${label}</span></button>`).join('');
    document.body.appendChild(menu);
    menu.style.top = Math.round(r.bottom + 6) + 'px';
    menu.style.left = Math.round(Math.max(8, Math.min(window.innerWidth - menu.offsetWidth - 8, r.right - menu.offsetWidth))) + 'px';

    const close = () => { menu.remove(); document.removeEventListener('mousedown', outside, true); };
    const outside = (ev) => { if (!menu.contains(ev.target) && ev.target !== btn) close(); };
    setTimeout(() => document.addEventListener('mousedown', outside, true), 0);
    menu.addEventListener('click', (ev) => {
      const b = ev.target.closest('[data-act]');
      if (!b) return;
      close();
      const act = b.dataset.act;
      if (act === 'copy') this.copyMarkdown();
      else if (act === 'export') this.exportNote();
      else if (act === 'attach') this.attachCurrentPage();
      else if (act === 'duplicate') this.duplicateActive();
      else if (act === 'delete') this.deleteActive();
    });
  },

  async copyMarkdown() {
    const note = this.getActive();
    if (!note) return;
    this.flush();
    try {
      await navigator.clipboard.writeText(this.noteToMarkdown(this.getActive() || note));
      window.showToast?.('Note copied as markdown');
    } catch { try { window.showToast?.('Copy failed'); } catch {} }
  },

  exportNote() {
    const note = this.getActive();
    if (!note) return;
    this.flush();
    const n = this.normalize(this.getActive() || note);
    const name = (n.title || 'note').replace(/[\\/:*?"<>|]+/g, '-').slice(0, 60) || 'note';
    const blob = new Blob([this.noteToMarkdown(n)], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name + '.md';
    document.body.appendChild(a);
    a.click();
    // Revoking in the same tick can cancel the download before it starts.
    setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 4000);
  },

  clipCurrentPage() {
    if (typeof window === 'undefined' || !window.ClipToNotes) { try { window.showToast?.('Clipping is unavailable'); } catch {} return; }
    this.flush();
    Promise.resolve(window.ClipToNotes.clip()).then(() => {
      this.reloadSyncedState();
      this.setSection('notes');
      const clip = this.notes.find(n => this.normalize(n).title === 'Clippings');
      if (clip) this.selectNote(clip.id);
    }).catch(() => {});
  },

  renderList(filter) {
    if (typeof filter === 'string') this.query = filter;
    const list = this._el('notes-list');
    if (!list) return;
    if (this.section === 'sticky') return this.renderStickyList();
    this._captureEditor();

    const counts = this._el('notes-count-notes');
    if (counts) counts.textContent = String(this.notes.length);

    this._renderTagbar();

    let notes = this.notes.filter(n => n && this.matches(n, this.query));
    if (this.tagFilter) {
      const t = this.tagFilter.toLowerCase();
      notes = notes.filter(n => this.normalize(n).tags.some(x => x.toLowerCase() === t));
    }
    notes = this.sortNotes(notes, this.sort);

    if (notes.length === 0) {
      const why = this.notes.length === 0 ? 'No notes yet' : 'Nothing matches';
      const hint = this.notes.length === 0 ? 'Use the + button to start one' : 'Try a different search or tag';
      list.innerHTML = `<div class="notes-list-empty"><div>${why}</div><div class="hint">${hint}</div></div>`;
      return;
    }

    list.innerHTML = notes.map(raw => {
      const n = this.normalize(raw);
      const date = this.formatDate(n.updatedAt) || this.formatDate(n.createdAt);
      const tags = n.tags.slice(0, 3).map(t => `<span class="note-list-tag">#${this._esc(t)}</span>`).join('');
      return `
        <div class="note-list-item${n.id === this.activeNoteId ? ' active' : ''}${n.pinned ? ' pinned' : ''}" data-id="${this._esc(n.id)}" role="button" tabindex="0">
          <div class="note-list-item-row">
            <div class="note-list-item-title">${this._esc(n.title || 'Untitled')}</div>
            ${n.pinned ? `<span class="note-list-pin" title="Pinned">${this._icon('pin', 11)}</span>` : ''}
          </div>
          <div class="note-list-item-preview">${this._esc(this.previewText(n.content)) || '<span class="dim">Empty note</span>'}</div>
          <div class="note-list-item-foot"><span class="note-list-item-date">${this._esc(date)}</span>${tags}${n.sourceUrl ? `<span class="note-list-src" title="Linked to a page">${this._icon('link', 10)}</span>` : ''}</div>
        </div>`;
    }).join('');
  },

  _renderTagbar() {
    const bar = this._el('notes-tagbar');
    if (!bar) return;
    const tags = this.allTags(this.notes);
    if (!tags.length) { bar.innerHTML = ''; bar.hidden = true; return; }
    bar.hidden = this.section !== 'notes';
    bar.innerHTML = tags.map(t => `<button class="notes-tag-filter${this.tagFilter.toLowerCase() === t.toLowerCase() ? ' active' : ''}" data-tag="${this._esc(t)}">#${this._esc(t)}</button>`).join('');
  },

  // ---------------------------------------------------------- page notes ---
  _stickyAll() {
    try { return (window.StickyNotes && window.StickyNotes.getAll()) || []; } catch { return []; }
  },

  renderStickyList() {
    const entries = this._stickyAll();
    const counts = this._el('notes-count-sticky');
    if (counts) counts.textContent = String(entries.length);
    const notesCount = this._el('notes-count-notes');
    if (notesCount) notesCount.textContent = String(this.notes.length);
    const list = this._el('notes-list');
    if (!list || this.section !== 'sticky') return;

    const q = String(this.query || '').trim().toLowerCase();
    const rows = entries.filter(n => !q || n.key.toLowerCase().includes(q) || n.text.toLowerCase().includes(q) || (n.title || '').toLowerCase().includes(q));

    if (!rows.length) {
      list.innerHTML = `<div class="notes-list-empty"><div>${entries.length ? 'Nothing matches' : 'No page notes yet'}</div><div class="hint">${entries.length ? 'Try a different search' : 'Use the sticky button above to add one for the page you are on'}</div></div>`;
      return;
    }

    list.innerHTML = rows.map(n => `
      <div class="note-list-item sticky-list-item${n.key === this.activeStickyKey ? ' active' : ''}" data-key="${this._esc(n.key)}" role="button" tabindex="0">
        <div class="note-list-item-row">
          <span class="sticky-dot" aria-hidden="true"></span>
          <div class="note-list-item-title">${this._esc(n.title || n.key)}</div>
        </div>
        <div class="note-list-item-preview">${this._esc(this.previewText(n.text))}</div>
        <div class="note-list-item-foot"><span class="note-list-item-date">${this._esc(n.updated ? this.formatDate(new Date(n.updated).toISOString()) : '')}</span><span class="note-list-host">${this._esc(n.key.slice(0, 46))}</span></div>
      </div>`).join('');
  },

  selectSticky(key) {
    this.flush(); this._flushSticky();
    const entry = this._stickyAll().find(n => n.key === key);
    if (!entry) { this.activeStickyKey = null; this._showEmpty(); this.renderStickyList(); return; }
    this.activeStickyKey = key;
    this.activeNoteId = null;

    this._el('notes-editor').hidden = true;
    this._el('notes-sticky-view').hidden = false;
    this._el('notes-empty-state').hidden = true;
    this._el('notes-sticky-title').textContent = entry.title || entry.key;
    this._el('notes-sticky-url').textContent = window.StickyNotes ? StickyNotes.pageUrlFor(entry) : entry.key;
    this._el('notes-sticky-text').value = entry.text;
    this._updateStickyCount();
    const st = this._el('notes-sticky-state');
    if (st) st.textContent = '';
    this.renderStickyList();
    this._measure();
  },

  _updateStickyCount() {
    const ta = this._el('notes-sticky-text');
    const el = this._el('notes-sticky-count');
    if (!ta || !el) return;
    const s = this.wordStats(ta.value);
    el.textContent = `${s.words} word${s.words === 1 ? '' : 's'} · ${s.chars} char${s.chars === 1 ? '' : 's'}`;
  },

  _debounceStickySave() {
    this._updateStickyCount();
    const st = this._el('notes-sticky-state');
    if (st) st.textContent = 'Saving…';
    clearTimeout(this._stickyTimer);
    this._stickyTimer = setTimeout(() => this._flushSticky(), 600);
  },

  _flushSticky() {
    clearTimeout(this._stickyTimer);
    this._stickyTimer = null;
    const ta = this._el('notes-sticky-text');
    if (!ta || !this.activeStickyKey || !window.StickyNotes) return;
    const view = this._el('notes-sticky-view');
    if (view && view.hidden) return;
    const entry = this._stickyAll().find(n => n.key === this.activeStickyKey);
    if (entry && entry.text === ta.value) return;
    StickyNotes.setText(this.activeStickyKey, ta.value, entry ? { url: entry.url, title: entry.title } : undefined);
    const st = this._el('notes-sticky-state');
    if (st) { st.textContent = 'Saved'; setTimeout(() => { if (st.textContent === 'Saved') st.textContent = ''; }, 1400); }
    if (!String(ta.value || '').trim()) { this.activeStickyKey = null; this._showEmpty(); this._measure(); }
    this.renderStickyList();
  },

  newStickyForPage() {
    if (!window.StickyNotes) return;
    StickyNotes.open();
    this.setSection('sticky');
  },

  async deleteSticky() {
    if (!this.activeStickyKey || !window.StickyNotes) return;
    const key = this.activeStickyKey;
    const ok = (typeof window !== 'undefined' && window.vexConfirm)
      ? await window.vexConfirm({ title: 'Delete page note', message: `Delete the note on ${key}?`, okLabel: 'Delete', danger: true })
      : true;
    if (!ok) return;
    clearTimeout(this._stickyTimer);
    this._stickyTimer = null;
    this.activeStickyKey = null;
    StickyNotes.remove(key);
    this._showEmpty();
    this.renderStickyList();
    this._measure();
    try { window.showToast?.('Page note deleted'); } catch {}
  },

  // A sticky that outgrew the card becomes a real note, source link included.
  convertStickyToNote() {
    if (!this.activeStickyKey || !window.StickyNotes) return;
    this._flushSticky();
    const key = this.activeStickyKey;
    const entry = this._stickyAll().find(n => n.key === key);
    if (!entry) return;
    const now = new Date().toISOString();
    const note = {
      id: 'note_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
      title: entry.title || entry.key,
      content: entry.text,
      pinned: false,
      tags: [],
      sourceUrl: StickyNotes.pageUrlFor(entry),
      sourceTitle: entry.title || entry.key,
      createdAt: now,
      updatedAt: now,
    };
    this.notes.unshift(note);
    StickyNotes.remove(key);
    this.activeStickyKey = null;
    this.save();
    this.setSection('notes');
    this.selectNote(note.id);
    try { window.showToast?.('Page note moved into Notes'); } catch {}
  },
};

if (typeof window !== 'undefined') {
  window.NotesPanel = NotesPanel;
  window.addEventListener('vex-sync-data-applied', () => NotesPanel.reloadSyncedState());
}
if (typeof module !== 'undefined' && module.exports) module.exports = { NotesPanel };

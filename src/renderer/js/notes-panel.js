// === Vex Notes & Scratchpad ===

const NotesPanel = {
  STORAGE_KEY: 'vex.notes',
  notes: [],
  activeNoteId: null,
  saveTimer: null,
  previewMode: false,

  init() {
    const panel = document.getElementById('panel-notes');
    if (!panel || panel.dataset.rendered) return;
    panel.dataset.rendered = 'true';

    const saved = localStorage.getItem(this.STORAGE_KEY);
    if (saved) { try { this.notes = JSON.parse(saved); } catch {} }

    panel.innerHTML = `
      <div class="notes-container">
        <div class="notes-sidebar">
          <div class="notes-sidebar-header">
            <h3>Notes</h3>
            <button class="notes-add-btn" id="notes-add-btn" title="New Note">
              <svg width="14" height="14" viewBox="0 0 14 14"><path d="M7 2V12M2 7H12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
            </button>
          </div>
          <div class="notes-search">
            <input type="text" id="notes-search-input" placeholder="Search notes...">
          </div>
          <div class="notes-list" id="notes-list"></div>
        </div>
        <div class="notes-editor" id="notes-editor" style="display:none">
          <div class="notes-editor-header">
            <input type="text" id="notes-title-input" placeholder="Note title...">
          </div>
          <div class="notes-toolbar">
            <button id="notes-preview-btn">Preview</button>
            <button id="notes-pin-btn">Pin</button>
            <button id="notes-export-btn">Export</button>
            <button id="notes-delete-btn" style="color:var(--danger)">Delete</button>
            <div class="spacer"></div>
            <span class="notes-word-count" id="notes-word-count">0 words</span>
          </div>
          <div class="notes-editor-area">
            <textarea id="notes-content-area" placeholder="Start writing..."></textarea>
          </div>
        </div>
        <div class="notes-empty" id="notes-empty-state">Select or create a note</div>
      </div>
    `;

    this.bindEvents();
    this.renderList();
  },

  save() {
    localStorage.setItem(this.STORAGE_KEY, JSON.stringify(this.notes));
  },

  bindEvents() {
    document.getElementById('notes-add-btn')?.addEventListener('click', () => this.createNote());

    document.getElementById('notes-search-input')?.addEventListener('input', (e) => {
      this.renderList(e.target.value);
    });

    document.getElementById('notes-title-input')?.addEventListener('input', (e) => {
      const note = this.getActive();
      if (note) { note.title = e.target.value; note.updatedAt = new Date().toISOString(); this.debounceSave(); this.renderList(); }
    });

    document.getElementById('notes-content-area')?.addEventListener('input', (e) => {
      const note = this.getActive();
      if (note) {
        note.content = e.target.value;
        note.updatedAt = new Date().toISOString();
        this.debounceSave();
        this.updateWordCount();
      }
    });

    document.getElementById('notes-preview-btn')?.addEventListener('click', () => this.togglePreview());
    document.getElementById('notes-pin-btn')?.addEventListener('click', () => this.togglePin());
    document.getElementById('notes-export-btn')?.addEventListener('click', () => this.exportNote());
    document.getElementById('notes-delete-btn')?.addEventListener('click', () => this.deleteActive());
  },

  debounceSave() {
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.save(), 1000);
  },

  createNote() {
    const note = {
      id: 'note_' + Date.now(),
      title: 'Untitled',
      content: '',
      pinned: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    this.notes.unshift(note);
    this.save();
    this.selectNote(note.id);
    this.renderList();
    document.getElementById('notes-title-input')?.focus();
    document.getElementById('notes-title-input')?.select();
  },

  selectNote(id) {
    this.activeNoteId = id;
    this.previewMode = false;
    const note = this.getActive();
    if (!note) return;

    document.getElementById('notes-editor').style.display = 'flex';
    document.getElementById('notes-empty-state').style.display = 'none';
    document.getElementById('notes-title-input').value = note.title;

    const area = document.getElementById('notes-editor-area');
    area.innerHTML = `<textarea id="notes-content-area" placeholder="Start writing...">${this._esc(note.content)}</textarea>`;
    document.getElementById('notes-content-area').addEventListener('input', (e) => {
      note.content = e.target.value;
      note.updatedAt = new Date().toISOString();
      this.debounceSave();
      this.updateWordCount();
    });

    document.getElementById('notes-pin-btn').textContent = note.pinned ? 'Unpin' : 'Pin';
    this.updateWordCount();
    this.renderList();
  },

  getActive() {
    return this.notes.find(n => n.id === this.activeNoteId);
  },

  deleteActive() {
    if (!this.activeNoteId) return;
    this.notes = this.notes.filter(n => n.id !== this.activeNoteId);
    this.activeNoteId = null;
    this.save();
    document.getElementById('notes-editor').style.display = 'none';
    document.getElementById('notes-empty-state').style.display = 'flex';
    this.renderList();
  },

  togglePin() {
    const note = this.getActive();
    if (!note) return;
    note.pinned = !note.pinned;
    this.save();
    document.getElementById('notes-pin-btn').textContent = note.pinned ? 'Unpin' : 'Pin';
    this.renderList();
  },

  togglePreview() {
    this.previewMode = !this.previewMode;
    const note = this.getActive();
    if (!note) return;

    const area = document.getElementById('notes-editor-area');
    const btn = document.getElementById('notes-preview-btn');

    if (this.previewMode) {
      btn.classList.add('active');
      btn.textContent = 'Edit';
      area.innerHTML = `<div class="markdown-preview">${this.renderMarkdown(note.content)}</div>`;
    } else {
      btn.classList.remove('active');
      btn.textContent = 'Preview';
      area.innerHTML = `<textarea id="notes-content-area" placeholder="Start writing...">${this._esc(note.content)}</textarea>`;
      document.getElementById('notes-content-area').addEventListener('input', (e) => {
        note.content = e.target.value;
        note.updatedAt = new Date().toISOString();
        this.debounceSave();
        this.updateWordCount();
      });
    }
  },

  exportNote() {
    const note = this.getActive();
    if (!note) return;
    const blob = new Blob([note.content], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = (note.title || 'note') + '.md'; a.click();
    URL.revokeObjectURL(url);
  },

  updateWordCount() {
    const note = this.getActive();
    const count = note?.content ? note.content.trim().split(/\s+/).filter(Boolean).length : 0;
    const el = document.getElementById('notes-word-count');
    if (el) el.textContent = count + ' word' + (count !== 1 ? 's' : '');
  },

  renderList(filter) {
    const list = document.getElementById('notes-list');
    if (!list) return;

    let notes = [...this.notes];
    if (filter) {
      const q = filter.toLowerCase();
      notes = notes.filter(n => n.title.toLowerCase().includes(q) || n.content.toLowerCase().includes(q));
    }
    // Pinned first
    notes.sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0));

    if (notes.length === 0) {
      list.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text-muted);font-size:13px">No notes</div>';
      return;
    }

    list.innerHTML = notes.map(n => {
      const date = new Date(n.updatedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      const preview = (n.content || '').substring(0, 60);
      return `
        <div class="note-list-item${n.id === this.activeNoteId ? ' active' : ''}${n.pinned ? ' pinned' : ''}" data-id="${n.id}">
          <div class="note-list-item-title">${this._esc(n.title || 'Untitled')}</div>
          <div class="note-list-item-date">${date}</div>
          <div class="note-list-item-preview">${this._esc(preview)}</div>
        </div>
      `;
    }).join('');

    list.querySelectorAll('.note-list-item').forEach(el => {
      el.addEventListener('click', () => this.selectNote(el.dataset.id));
    });
  },

  renderMarkdown(text) {
    if (!text) return '<p style="color:var(--text-muted)">Nothing to preview</p>';
    return text
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/^### (.+)$/gm, '<h3>$1</h3>')
      .replace(/^## (.+)$/gm, '<h2>$1</h2>')
      .replace(/^# (.+)$/gm, '<h1>$1</h1>')
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.+?)\*/g, '<em>$1</em>')
      .replace(/`(.+?)`/g, '<code>$1</code>')
      .replace(/^- (.+)$/gm, '<li>$1</li>')
      .replace(/(<li>.*<\/li>)/s, '<ul>$1</ul>')
      .replace(/\n\n/g, '</p><p>')
      .replace(/\n/g, '<br>')
      .replace(/^(.+)$/gm, (m) => m.startsWith('<') ? m : `<p>${m}</p>`);
  },

  _esc(s) { const d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML; }
};

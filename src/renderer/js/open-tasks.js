// === Every open task, from every note, in one list ==========================
//
// Notes already make checklists: "- [ ] thing" becomes a real checkbox. What
// they did not do is show the checklists TOGETHER. A task written in the
// middle of a note about a boiler quote is a task you find again only by
// opening that note — so it is not found.
//
// This is not a second to-do system beside Notes. Every task stays a line in
// the note it was written in; this view reads them all, ticks them where they
// live, and adds new ones to a note called "To-do". One source of truth.
//
// A date on a task — "@2026-10-03", "@today", "@tomorrow" — makes it due, and
// the list sorts by it and says what is overdue.

const OpenTasks = {
  INBOX_TITLE: 'To-do',
  LINE: /^(\s*(?:[-*+]|\d+[.)])\s+)\[([ xX])\](.*)$/,

  // Notes, fresh from storage (another window may have changed them).
  _notes() {
    if (typeof NotesPanel !== 'undefined' && NotesPanel.reloadSyncedState) {
      try { NotesPanel.flush && NotesPanel.flush(); } catch { /* nothing open */ }
      NotesPanel.reloadSyncedState(false);
      return NotesPanel.notes || [];
    }
    try { const a = JSON.parse(localStorage.getItem('vex.notes') || '[]'); return Array.isArray(a) ? a : []; } catch { return []; }
  },

  // "@2026-10-03", "@today", "@tomorrow" → a local date at midnight, or null.
  dueOf(text, now = new Date()) {
    const m = /(?:^|\s)@(\d{4}-\d{2}-\d{2}|today|tomorrow)\b/i.exec(String(text || ''));
    if (!m) return null;
    const day = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const v = m[1].toLowerCase();
    if (v === 'today') return day(now);
    if (v === 'tomorrow') { const t = day(now); t.setDate(t.getDate() + 1); return t; }
    const [y, mo, d] = v.split('-').map(Number);
    const date = new Date(y, mo - 1, d);
    return (date.getFullYear() === y && date.getMonth() === mo - 1 && date.getDate() === d) ? date : null;
  },

  // Every task in every note: open ones by default.
  collect(notes, { includeDone = false, now = new Date() } = {}) {
    const out = [];
    for (const note of notes || []) {
      if (!note || typeof note.content !== 'string') continue;
      let index = -1;
      for (const line of note.content.split('\n')) {
        const m = this.LINE.exec(line);
        if (!m) continue;
        index++;
        const done = m[2] !== ' ';
        if (done && !includeDone) continue;
        const text = m[3].trim();
        if (!text) continue;
        const due = this.dueOf(text, now);
        out.push({ noteId: note.id, noteTitle: (note.title || '').trim() || 'Untitled note', index, text, done, due: due ? due.getTime() : null });
      }
    }
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    // Overdue first, then due soonest, then undated in note order.
    out.sort((a, b) => (a.due == null) - (b.due == null) || (a.due || 0) - (b.due || 0));
    for (const t of out) t.overdue = t.due != null && t.due < today;
    return out;
  },

  // Tick (or untick) a task where it lives, without letting the note editor
  // overwrite the change with the text it was showing.
  toggle(noteId, index) {
    const notes = this._notes();
    const note = notes.find(n => n && n.id === noteId);
    if (!note) throw new Error('That note is gone');
    const before = note.content;
    const after = (typeof NotesPanel !== 'undefined' && NotesPanel.toggleTask) ? NotesPanel.toggleTask(before, index) : this._toggle(before, index);
    if (after === before) throw new Error('That task has changed since the list was drawn');
    note.content = after;
    note.updatedAt = new Date().toISOString();
    this._write(notes, noteId);
    return note;
  },

  _toggle(content, index) {
    const lines = String(content || '').split('\n');
    let seen = -1;
    for (let i = 0; i < lines.length; i++) {
      const m = this.LINE.exec(lines[i]);
      if (!m) continue;
      if (++seen !== index) continue;
      lines[i] = m[1] + (m[2] === ' ' ? '[x]' : '[ ]') + m[3];
      return lines.join('\n');
    }
    return String(content || '');
  },

  // A new task goes into the "To-do" note, made if it does not exist.
  add(text) {
    const t = String(text == null ? '' : text).replace(/\s+/g, ' ').trim();
    if (!t) throw new Error('Write the task first');
    if (t.length > 500) throw new Error('That is a long task — put it in a note');
    const notes = this._notes();
    let inbox = notes.find(n => n && (n.title || '').trim().toLowerCase() === this.INBOX_TITLE.toLowerCase());
    const now = new Date().toISOString();
    if (!inbox) {
      inbox = { id: 'note_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7), title: this.INBOX_TITLE, content: '', pinned: true, tags: [], sourceUrl: '', sourceTitle: '', createdAt: now, updatedAt: now };
      notes.unshift(inbox);
    }
    inbox.content = (inbox.content.replace(/\s+$/, '') + (inbox.content.trim() ? '\n' : '') + '- [ ] ' + t).replace(/^\n+/, '');
    inbox.updatedAt = now;
    this._write(notes, inbox.id);
    return inbox;
  },

  _write(notes, changedId) {
    if (typeof NotesPanel !== 'undefined' && NotesPanel.notes) {
      NotesPanel.notes = notes;
      try { localStorage.setItem(NotesPanel.STORAGE_KEY || 'vex.notes', JSON.stringify(notes)); } catch {}
      // The editor may be showing this very note: show it the new text, or
      // its next save would put the old text back.
      try {
        if (NotesPanel.activeNoteId === changedId && NotesPanel._fillEditor && NotesPanel._el && NotesPanel._el('notes-content-area')) NotesPanel._fillEditor();
        if (NotesPanel.renderList && NotesPanel._el && NotesPanel._el('notes-list')) NotesPanel.renderList();
      } catch { /* the panel is not open */ }
    } else {
      try { localStorage.setItem('vex.notes', JSON.stringify(notes)); } catch {}
    }
    try { document.dispatchEvent(new CustomEvent('vex:tasks-changed')); } catch {}
  },

  count() { return this.collect(this._notes()).length; },

  // --- the list ------------------------------------------------------------------
  open() {
    const esc = (s) => window.escapeHtml(String(s == null ? '' : s));
    const { head, body, close } = window.PageExport._sheet('To-do', 'vex-tasks-overlay');
    const dayName = (ms) => {
      const d = new Date(ms), now = new Date();
      const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
      const diff = Math.round((ms - today) / 86400000);
      if (diff === 0) return 'today';
      if (diff === 1) return 'tomorrow';
      if (diff === -1) return 'yesterday';
      if (diff < 0) return (-diff) + ' days ago';
      if (diff < 7) return d.toLocaleDateString(undefined, { weekday: 'long' });
      return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
    };

    body.innerHTML = `
      <form data-add style="display:flex;gap:8px;padding:10px 12px;border-bottom:1px solid var(--border)">
        <input data-new type="text" maxlength="500" placeholder="Add a task — end with @tomorrow or @2026-10-03 to give it a date" aria-label="New task"
               style="flex:1;font:inherit;font-size:13px;padding:7px 9px;border-radius:7px;border:1px solid var(--border);background:var(--surface);color:var(--text)">
        <button type="submit" style="font:inherit;font-size:12px;padding:6px 12px;border-radius:7px;border:none;background:var(--primary);color:#fff;cursor:pointer">Add</button>
      </form>
      <div data-rows style="padding:6px"></div>`;
    const input = body.querySelector('[data-new]');
    const rows = body.querySelector('[data-rows]');

    const draw = () => {
      const tasks = this.collect(this._notes());
      rows.innerHTML = '';
      if (!tasks.length) {
        rows.innerHTML = window.VexUI
          ? VexUI.emptyState('check', 'Nothing to do', 'Add one above, or write "- [ ] something" in any note')
          : '<div style="padding:24px;text-align:center;font-size:12.5px;color:var(--text-muted)">Nothing to do.</div>';
        return;
      }
      let lastNote = null;
      for (const t of tasks) {
        const heading = t.due != null ? (t.overdue ? 'Overdue' : 'Coming up') : t.noteTitle;
        if (heading !== lastNote) {
          rows.insertAdjacentHTML('beforeend', `<div style="padding:10px 8px 3px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;color:${heading === 'Overdue' ? 'var(--danger,#e5534b)' : 'var(--text-muted)'}">${esc(heading)}</div>`);
          lastNote = heading;
        }
        const row = document.createElement('label');
        row.style.cssText = 'display:flex;align-items:center;gap:9px;padding:6px 8px;border-radius:8px;cursor:pointer';
        const shown = t.text.replace(/(?:^|\s)@(\d{4}-\d{2}-\d{2}|today|tomorrow)\b/i, '').trim() || t.text;
        row.innerHTML = `
          <input type="checkbox" style="flex:0 0 auto;width:15px;height:15px;cursor:pointer" aria-label="Done">
          <div style="flex:1;min-width:0">
            <div data-text style="font-size:13px;color:var(--text)">${esc(shown)}</div>
            <div style="font-size:10.5px;color:${t.overdue ? 'var(--danger,#e5534b)' : 'var(--text-muted)'}">${t.due != null ? esc('Due ' + dayName(t.due)) + ' · ' : ''}${esc(t.noteTitle)}</div>
          </div>
          <button data-open type="button" style="flex:0 0 auto;font-size:11px;background:none;border:1px solid var(--border);border-radius:6px;padding:2px 7px;cursor:pointer;color:var(--text)">Open note</button>`;
        const box = row.querySelector('input');
        box.addEventListener('change', () => {
          try {
            this.toggle(t.noteId, t.index);
            row.querySelector('[data-text]').style.textDecoration = box.checked ? 'line-through' : '';
            row.style.opacity = box.checked ? '0.5' : '';
            // Leave it visible a moment so the tick is seen, then redraw.
            setTimeout(() => { if (rows.isConnected) draw(); }, 900);
          } catch (err) { window.showToast?.(err.message, 'error'); box.checked = !box.checked; draw(); }
        });
        row.querySelector('[data-open]').addEventListener('click', (e) => {
          e.preventDefault();
          close();
          try { SidebarManager.openPanel('notes'); NotesPanel.selectNote(t.noteId); } catch { window.showToast?.('Could not open the note', 'error'); }
        });
        rows.appendChild(row);
      }
    };

    body.querySelector('[data-add]').addEventListener('submit', (e) => {
      e.preventDefault();
      try { this.add(input.value); input.value = ''; draw(); }
      catch (err) { window.showToast?.(err.message, 'error'); }
      input.focus();
    });
    draw();
    input.focus();
    return head;
  },

  async quickAdd() {
    const text = await vexPrompt({ title: 'Add a task', message: 'It goes in your "To-do" note. End it with @tomorrow or @2026-10-03 to give it a date.', label: 'Task', placeholder: 'Call the plumber @tomorrow', okLabel: 'Add' });
    if (text == null) return null;
    const note = this.add(text);
    window.showToast?.('Added to “' + note.title + '”');
    return note;
  },
};

if (typeof window !== 'undefined') window.OpenTasks = OpenTasks;
if (typeof module !== 'undefined' && module.exports) module.exports = { OpenTasks };

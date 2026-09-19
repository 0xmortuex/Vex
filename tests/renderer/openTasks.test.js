// @vitest-environment jsdom
//
// Every open task from every note, in one list — and ticked where it lives.

import { beforeEach, describe, expect, it, vi } from 'vitest';
require('../../src/renderer/js/page-export.js');
const { OpenTasks } = require('../../src/renderer/js/open-tasks.js');
const { NotesPanel: RealNotes } = (() => { try { return { NotesPanel: require('../../src/renderer/js/notes-panel.js').NotesPanel }; } catch { return {}; } })();

const NOW = new Date(2026, 8, 19, 10, 0);    // Sat 19 Sep 2026
const note = (id, title, content) => ({ id, title, content, updatedAt: '' });

// A stand-in for the Notes panel that behaves like the real one where it
// matters: save() copies whatever the editor shows back into the note.
function notesPanel(notes) {
  document.body.innerHTML = '<div id="notes-list"></div><textarea id="notes-content-area"></textarea>';
  const panel = {
    STORAGE_KEY: 'vex.notes', notes, activeNoteId: null,
    toggleTask: RealNotes ? RealNotes.toggleTask.bind(RealNotes) : undefined,
    _el: (id) => document.getElementById(id),
    reloadSyncedState() { this.notes = JSON.parse(localStorage.getItem('vex.notes') || '[]'); },
    flush: vi.fn(),
    _fillEditor() { const n = this.notes.find(x => x.id === this.activeNoteId); document.getElementById('notes-content-area').value = n ? n.content : ''; },
    _captureEditor() { const n = this.notes.find(x => x.id === this.activeNoteId); if (n) n.content = document.getElementById('notes-content-area').value; },
    save() { this._captureEditor(); localStorage.setItem('vex.notes', JSON.stringify(this.notes)); },
    renderList: vi.fn(),
  };
  localStorage.setItem('vex.notes', JSON.stringify(notes));
  globalThis.NotesPanel = panel;
  return panel;
}

beforeEach(() => { localStorage.clear(); delete globalThis.NotesPanel; });

describe('reading tasks out of notes', () => {
  const NOTES = [
    note('a', 'Boiler', 'Quotes so far\n- [ ] Call Worcester @tomorrow\n- [x] Get Vaillant quote\n* [ ] Check the flue @2026-09-15'),
    note('b', '', '1. [ ] Undated thing\n- [ ]   \nnot a task [ ]'),
  ];

  it('finds the open ones, with their note, and leaves done and empty ones out', () => {
    const tasks = OpenTasks.collect(NOTES, { now: NOW });
    expect(tasks.map(t => t.text)).toEqual(['Check the flue @2026-09-15', 'Call Worcester @tomorrow', 'Undated thing']);
    expect(tasks[2].noteTitle).toBe('Untitled note');
  });

  it('sorts overdue first, then soonest, then undated — and marks overdue', () => {
    const tasks = OpenTasks.collect(NOTES, { now: NOW });
    expect(tasks.map(t => t.overdue)).toEqual([true, false, false]);
    expect(new Date(tasks[1].due).getDate()).toBe(20);
  });

  it('knows each task\'s position in its note, counting done ones too', () => {
    const t = OpenTasks.collect(NOTES, { now: NOW }).find(x => x.text.startsWith('Check the flue'));
    expect(t.index).toBe(2);                         // third checkbox in note "a"
  });

  it('reads dates the way people write them, and refuses impossible ones', () => {
    expect(OpenTasks.dueOf('pay @today', NOW).getDate()).toBe(19);
    expect(OpenTasks.dueOf('pay @Tomorrow', NOW).getDate()).toBe(20);
    expect(OpenTasks.dueOf('pay @2026-02-30', NOW)).toBe(null);
    expect(OpenTasks.dueOf('email me@today.com', NOW)).toBe(null);   // not a date
    expect(OpenTasks.dueOf('nothing', NOW)).toBe(null);
  });
});

describe('ticking one', () => {
  it('ticks the right line in the right note, and nothing else', () => {
    const panel = notesPanel([note('a', 'Boiler', '- [ ] one\n- [x] two\n- [ ] three')]);
    OpenTasks.toggle('a', 2);
    expect(panel.notes[0].content).toBe('- [ ] one\n- [x] two\n- [x] three');
    expect(JSON.parse(localStorage.getItem('vex.notes'))[0].content).toContain('- [x] three');
  });

  it('a note open in the editor is refreshed, so its next save cannot undo the tick', () => {
    const panel = notesPanel([note('a', 'Boiler', '- [ ] one')]);
    panel.activeNoteId = 'a';
    panel._fillEditor();                           // the editor is showing the old text
    OpenTasks.toggle('a', 0);
    panel.save();                                  // what the editor would do next
    expect(panel.notes[0].content).toBe('- [x] one');
  });

  it('says so when the note has gone, or the task moved', () => {
    notesPanel([note('a', 'Boiler', '- [ ] one')]);
    expect(() => OpenTasks.toggle('zzz', 0)).toThrow(/note is gone/);
    expect(() => OpenTasks.toggle('a', 5)).toThrow(/has changed/);
  });
});

describe('adding one', () => {
  it('goes in a pinned "To-do" note, made the first time', () => {
    const panel = notesPanel([note('a', 'Boiler', '')]);
    OpenTasks.add('  Call   the plumber @tomorrow ');
    const inbox = panel.notes.find(n => n.title === 'To-do');
    expect(inbox).toMatchObject({ content: '- [ ] Call the plumber @tomorrow', pinned: true });
    OpenTasks.add('Buy filters');
    // Each add re-reads notes from storage (another window may have written),
    // so look the note up again rather than trusting the old object.
    const inboxes = panel.notes.filter(n => n.title === 'To-do');
    expect(inboxes).toHaveLength(1);
    expect(inboxes[0].content).toBe('- [ ] Call the plumber @tomorrow\n- [ ] Buy filters');
  });

  it('refuses nothing, and an essay', () => {
    notesPanel([]);
    expect(() => OpenTasks.add('   ')).toThrow(/Write the task first/);
    expect(() => OpenTasks.add('x'.repeat(501))).toThrow(/long task/);
  });
});

describe('the list', () => {
  beforeEach(() => {
    window.escapeHtml = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    window.showToast = vi.fn();
  });

  it('shows open tasks, hides the date tag, and ticking writes back to the note', () => {
    vi.useFakeTimers();
    const panel = notesPanel([note('a', 'Boiler', '- [ ] Call Worcester @2099-01-01\n- [ ] Undated')]);
    OpenTasks.open();
    const overlay = document.querySelector('.vex-tasks-overlay');
    expect(overlay.textContent).toContain('Call Worcester');
    expect(overlay.textContent).not.toContain('@2099-01-01');
    expect(overlay.textContent).toMatch(/Due .*Boiler/);
    const box = overlay.querySelector('[data-rows] input[type=checkbox]');
    box.checked = true; box.dispatchEvent(new Event('change'));
    expect(panel.notes[0].content).toContain('- [x] Call Worcester');
    vi.advanceTimersByTime(1000);
    expect(overlay.textContent).not.toContain('Call Worcester');
    vi.useRealTimers();
  });

  it('adding from the box puts it in the list straight away', () => {
    notesPanel([]);
    OpenTasks.open();
    const input = document.querySelector('.vex-tasks-overlay [data-new]');
    input.value = 'New task';
    document.querySelector('.vex-tasks-overlay [data-add]').dispatchEvent(new Event('submit', { cancelable: true }));
    expect(document.querySelector('.vex-tasks-overlay').textContent).toContain('New task');
  });

  it('a task\'s text cannot become markup', () => {
    notesPanel([note('a', 'X', '- [ ] <img src=x onerror=alert(1)>')]);
    OpenTasks.open();
    expect(document.querySelector('.vex-tasks-overlay img')).toBe(null);
  });

  it('says plainly when there is nothing to do', () => {
    notesPanel([]);
    OpenTasks.open();
    expect(document.querySelector('.vex-tasks-overlay').textContent).toMatch(/Nothing to do/);
  });
});

// @vitest-environment jsdom
// Logic tests for the Notes panel: the pure helpers that drive the list,
// the markdown/checklist editing, and the bugs that used to lose text.
import { beforeEach, describe, expect, it, vi } from 'vitest';

let NotesPanel;

beforeEach(async () => {
  localStorage.clear();
  document.body.innerHTML = '';
  ({ NotesPanel } = await import('../../src/renderer/js/notes-panel.js'));
  NotesPanel.notes = [];
  NotesPanel.activeNoteId = null;
  NotesPanel.activeStickyKey = null;
  NotesPanel.section = 'notes';
  NotesPanel.query = '';
  NotesPanel.sort = 'edited';
  NotesPanel.tagFilter = '';
  NotesPanel.previewMode = false;
});

describe('normalize', () => {
  it('fills in every field a partial record is missing', () => {
    // A note written by an older build (or a half-applied sync pull) used to
    // throw out of renderList on `note.title.toLowerCase()`.
    const n = NotesPanel.normalize({ id: 'x' });
    expect(n).toEqual({ id: 'x', title: '', content: '', pinned: false, tags: [], sourceUrl: '', sourceTitle: '', createdAt: '', updatedAt: '' });
  });

  it('does not mutate the stored note', () => {
    const stored = { id: 'x' };
    NotesPanel.normalize(stored);
    expect(stored).toEqual({ id: 'x' });
  });

  it('drops junk tags', () => {
    expect(NotesPanel.normalize({ id: 'a', tags: ['ok', '', 3, null, ' pad '] }).tags).toEqual(['ok', 'pad']);
  });
});

describe('search', () => {
  const note = { id: 'a', title: 'Grocery list', content: 'milk and bread', tags: ['home'], sourceUrl: 'https://example.com/x', sourceTitle: 'Example' };

  it('matches title, content, tags and source', () => {
    for (const q of ['grocery', 'BREAD', 'home', 'example.com', 'Example']) {
      expect(NotesPanel.matches(note, q), q).toBe(true);
    }
    expect(NotesPanel.matches(note, 'zebra')).toBe(false);
  });

  it('treats an empty query as "everything"', () => {
    expect(NotesPanel.matches({ id: 'a' }, '')).toBe(true);
    expect(NotesPanel.matches({ id: 'a' }, '   ')).toBe(true);
  });

  it('does not throw on a note with no title or content', () => {
    expect(() => NotesPanel.matches({ id: 'a' }, 'q')).not.toThrow();
    expect(NotesPanel.matches({ id: 'a' }, 'q')).toBe(false);
  });
});

describe('sortNotes', () => {
  const mk = (id, opts) => ({ id, title: id, content: '', createdAt: '2024-01-01T00:00:00.000Z', updatedAt: '2024-01-01T00:00:00.000Z', ...opts });

  it('puts pinned notes first regardless of the sort key', () => {
    const list = [mk('a', { updatedAt: '2025-01-01T00:00:00.000Z' }), mk('b', { pinned: true })];
    for (const key of ['edited', 'created', 'title']) {
      expect(NotesPanel.sortNotes(list, key).map(n => n.id), key).toEqual(['b', 'a']);
    }
  });

  it('sorts by last edited, newest first', () => {
    const list = [mk('old', { updatedAt: '2024-01-01T00:00:00.000Z' }), mk('new', { updatedAt: '2026-01-01T00:00:00.000Z' })];
    expect(NotesPanel.sortNotes(list, 'edited').map(n => n.id)).toEqual(['new', 'old']);
  });

  it('sorts by created date and by title', () => {
    const list = [mk('b', { createdAt: '2024-01-01T00:00:00.000Z' }), mk('a', { createdAt: '2026-01-01T00:00:00.000Z' })];
    expect(NotesPanel.sortNotes(list, 'created').map(n => n.id)).toEqual(['a', 'b']);
    expect(NotesPanel.sortNotes(list, 'title').map(n => n.id)).toEqual(['a', 'b']);
  });

  it('does not reorder the source array', () => {
    const list = [mk('a'), mk('b', { pinned: true })];
    NotesPanel.sortNotes(list, 'edited');
    expect(list.map(n => n.id)).toEqual(['a', 'b']);
  });

  it('survives notes with an unparseable date', () => {
    const list = [mk('a', { updatedAt: 'nonsense' }), mk('b')];
    expect(() => NotesPanel.sortNotes(list, 'edited')).not.toThrow();
  });
});

describe('allTags', () => {
  it('collects tags once, case-insensitively, sorted', () => {
    const list = [{ id: 'a', tags: ['Work', 'zeta'] }, { id: 'b', tags: ['work', 'alpha'] }];
    expect(NotesPanel.allTags(list)).toEqual(['alpha', 'Work', 'zeta']);
  });
});

describe('previewText', () => {
  it('strips markdown so the list line reads as prose', () => {
    expect(NotesPanel.previewText('# Title\n\n- [ ] buy **milk**\n- two')).toBe('Title buy milk two');
  });
  it('keeps link labels and drops the target', () => {
    expect(NotesPanel.previewText('see [the docs](https://example.com)')).toBe('see the docs');
  });
  it('truncates with an ellipsis', () => {
    expect(NotesPanel.previewText('x'.repeat(200), 10)).toBe('xxxxxxxxx…');
  });
});

describe('wordStats', () => {
  it('counts words and characters', () => {
    expect(NotesPanel.wordStats('one two  three')).toEqual({ words: 3, chars: 14, minutes: 1 });
  });
  it('reports zero for an empty note', () => {
    expect(NotesPanel.wordStats('').words).toBe(0);
    expect(NotesPanel.wordStats('   ').words).toBe(0);
  });
});

describe('toggleTask', () => {
  const src = '- [ ] one\nsome prose\n- [x] two\n1. [ ] three';

  it('ticks the nth unchecked box', () => {
    expect(NotesPanel.toggleTask(src, 0)).toBe('- [x] one\nsome prose\n- [x] two\n1. [ ] three');
  });
  it('unticks a checked box', () => {
    expect(NotesPanel.toggleTask(src, 1)).toBe('- [ ] one\nsome prose\n- [ ] two\n1. [ ] three');
  });
  it('handles ordered-list tasks', () => {
    expect(NotesPanel.toggleTask(src, 2)).toContain('1. [x] three');
  });
  it('leaves the text alone when the index is out of range', () => {
    expect(NotesPanel.toggleTask(src, 9)).toBe(src);
  });
});

describe('applyFormat', () => {
  it('wraps the selection in bold and reports the new selection', () => {
    const r = NotesPanel.applyFormat('hello world', 6, 11, 'bold');
    expect(r.text).toBe('hello **world**');
    expect(r.text.slice(r.start, r.end)).toBe('world');
  });

  it('unwraps a selection that is already bold', () => {
    const r = NotesPanel.applyFormat('hello **world**', 8, 13, 'bold');
    expect(r.text).toBe('hello world');
  });

  it('inserts a placeholder when nothing is selected', () => {
    const r = NotesPanel.applyFormat('', 0, 0, 'italic');
    expect(r.text).toBe('*italic*');
  });

  it('prefixes every line the selection touches', () => {
    const r = NotesPanel.applyFormat('one\ntwo\nthree', 0, 7, 'task');
    expect(r.text).toBe('- [ ] one\n- [ ] two\nthree');
  });

  it('toggles a line prefix off when every line already has it', () => {
    const r = NotesPanel.applyFormat('- one\n- two', 0, 11, 'list');
    expect(r.text).toBe('one\ntwo');
  });

  it('builds a link with the selection as the label', () => {
    const r = NotesPanel.applyFormat('read the docs', 9, 13, 'link');
    expect(r.text).toBe('read the [docs](url)');
    expect(r.text.slice(r.start, r.end)).toBe('url');
  });

  it('clamps out-of-range offsets instead of producing junk', () => {
    const r = NotesPanel.applyFormat('abc', -5, 99, 'bold');
    expect(r.text).toBe('**abc**');
  });

  it('returns the text unchanged for an unknown format', () => {
    expect(NotesPanel.applyFormat('abc', 0, 3, 'nope').text).toBe('abc');
  });
});

describe('renderMarkdown', () => {
  beforeEach(async () => { await import('../../src/renderer/js/vex-markdown.js'); });

  it('turns task items into real checkboxes, indexed in source order', () => {
    const html = NotesPanel.renderMarkdown('- [ ] one\n- [x] two');
    expect(html).toContain('data-task="0"');
    expect(html).toContain('data-task="1"');
    expect(html.match(/checked/g)).toHaveLength(1);
    expect(html).toContain('notes-task done');
  });

  it('never lets raw HTML through', () => {
    const html = NotesPanel.renderMarkdown('<img src=x onerror=alert(1)>');
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img');
  });

  it('renders headings as headings, not as broken paragraphs', () => {
    const html = NotesPanel.renderMarkdown('# Head\n\nbody');
    expect(html).toContain('<h1');
    expect(html).not.toContain('</p><p>body');
  });

  it('shows a placeholder for an empty note', () => {
    expect(NotesPanel.renderMarkdown('')).toContain('Nothing to preview');
  });
});

describe('noteToMarkdown', () => {
  it('includes the title, tags and the linked page', () => {
    const md = NotesPanel.noteToMarkdown({ id: 'a', title: 'Trip', content: 'body', tags: ['travel'], sourceUrl: 'https://example.com', sourceTitle: 'Example' });
    expect(md).toContain('# Trip');
    expect(md).toContain('#travel');
    expect(md).toContain('[Example](https://example.com)');
    expect(md).toContain('body');
  });
  it('falls back to Untitled', () => {
    expect(NotesPanel.noteToMarkdown({ id: 'a' })).toContain('# Untitled');
  });
});

describe('formatDate', () => {
  it('returns an empty string rather than "Invalid Date"', () => {
    expect(NotesPanel.formatDate(undefined)).toBe('');
    expect(NotesPanel.formatDate('not a date')).toBe('');
  });
  it('formats a real date', () => {
    expect(NotesPanel.formatDate('2024-03-05T10:00:00.000Z')).not.toBe('');
  });
});

describe('persistence against concurrent writers', () => {
  it('captures in-flight editor text before anything re-reads the array', () => {
    // ClipToNotes swaps NotesPanel.notes for a fresh array and calls
    // renderList(); typing that had not yet hit the 600ms debounce used to be
    // dropped on the floor with the old array.
    document.body.innerHTML = '<input id="notes-title-input"><textarea id="notes-content-area"></textarea><div id="notes-list"></div>';
    NotesPanel.notes = [{ id: 'a', title: 'A', content: 'stored', updatedAt: '2024-01-01T00:00:00.000Z' }];
    NotesPanel.activeNoteId = 'a';
    document.getElementById('notes-title-input').value = 'A';
    document.getElementById('notes-content-area').value = 'typed but not saved';

    NotesPanel.notes = JSON.parse(JSON.stringify(NotesPanel.notes));  // the swap
    NotesPanel.renderList();

    expect(NotesPanel.notes[0].content).toBe('typed but not saved');
  });

  it('flush() writes the editor straight to storage', () => {
    document.body.innerHTML = '<input id="notes-title-input"><textarea id="notes-content-area"></textarea>';
    NotesPanel.notes = [{ id: 'a', title: 'A', content: '' }];
    NotesPanel.activeNoteId = 'a';
    document.getElementById('notes-title-input').value = 'A';
    document.getElementById('notes-content-area').value = 'last sentence';

    NotesPanel.flush();

    expect(JSON.parse(localStorage.getItem('vex.notes'))[0].content).toBe('last sentence');
  });

  it('does nothing when there is no editor on screen', () => {
    NotesPanel.notes = [{ id: 'a', title: 'A', content: 'x' }];
    NotesPanel.activeNoteId = 'a';
    expect(() => NotesPanel.flush()).not.toThrow();
  });
});

describe('sort preference', () => {
  it('is restored from storage on init', () => {
    localStorage.setItem('vex.notes.prefs', JSON.stringify({ sort: 'title', section: 'sticky' }));
    document.body.innerHTML = '<div id="panel-notes"></div>';
    window.StickyNotes = { getAll: () => [], pageUrlFor: () => '' };
    NotesPanel.init();
    expect(NotesPanel.sort).toBe('title');
    expect(NotesPanel.section).toBe('sticky');
    delete window.StickyNotes;
  });

  it('ignores a nonsense stored preference', () => {
    localStorage.setItem('vex.notes.prefs', '{not json');
    expect(NotesPanel._prefs()).toEqual({});
  });
});

describe('panel wiring', () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="panel-notes"></div>';
    window.StickyNotes = {
      _store: [],
      getAll() { return this._store; },
      pageUrlFor(e) { return (e && e.url) || 'https://' + ((e && e.key) || e); },
      setText: vi.fn(),
      remove: vi.fn(),
      open: vi.fn(),
      openPage: vi.fn(),
    };
  });

  it('renders both sections and keeps the search box working while the title is edited', () => {
    NotesPanel.init();
    NotesPanel.notes = [
      { id: 'a', title: 'Alpha', content: 'apple', updatedAt: '2024-01-02T00:00:00.000Z' },
      { id: 'b', title: 'Beta', content: 'banana', updatedAt: '2024-01-01T00:00:00.000Z' },
    ];
    const search = document.getElementById('notes-search-input');
    search.value = 'Alpha';
    search.dispatchEvent(new Event('input', { bubbles: true }));
    expect(document.querySelectorAll('.note-list-item')).toHaveLength(1);

    NotesPanel.selectNote('a');
    const title = document.getElementById('notes-title-input');
    title.value = 'Alpha renamed';
    title.dispatchEvent(new Event('input', { bubbles: true }));

    // The old panel called renderList() with no argument here, which silently
    // cleared the filter even though the search box still showed the query.
    expect(document.querySelectorAll('.note-list-item')).toHaveLength(1);
    expect(NotesPanel.query).toBe('Alpha');
  });

  it('clears preview mode and its button when another note is opened', () => {
    NotesPanel.init();
    NotesPanel.notes = [{ id: 'a', title: 'A', content: 'a' }, { id: 'b', title: 'B', content: 'b' }];
    NotesPanel.selectNote('a');
    NotesPanel.togglePreview();
    expect(NotesPanel.previewMode).toBe(true);

    NotesPanel.selectNote('b');
    expect(NotesPanel.previewMode).toBe(false);
    expect(document.getElementById('notes-preview-btn').classList.contains('active')).toBe(false);
    expect(document.getElementById('notes-preview').hidden).toBe(true);
    expect(document.getElementById('notes-content-area').hidden).toBe(false);
  });

  it('keeps an edit made just before switching notes', () => {
    NotesPanel.init();
    NotesPanel.notes = [{ id: 'a', title: 'A', content: '' }, { id: 'b', title: 'B', content: '' }];
    NotesPanel.selectNote('a');
    const ta = document.getElementById('notes-content-area');
    ta.value = 'draft text';
    ta.dispatchEvent(new Event('input', { bubbles: true }));

    NotesPanel.selectNote('b');

    expect(NotesPanel.notes.find(n => n.id === 'a').content).toBe('draft text');
    expect(JSON.parse(localStorage.getItem('vex.notes')).find(n => n.id === 'a').content).toBe('draft text');
    expect(ta.value).toBe('');
  });

  it('shows the empty state instead of a stale note when the id is gone', () => {
    NotesPanel.init();
    NotesPanel.notes = [{ id: 'a', title: 'A', content: 'a' }];
    NotesPanel.selectNote('a');
    NotesPanel.selectNote('deleted-id');
    expect(NotesPanel.activeNoteId).toBe(null);
    expect(document.getElementById('notes-editor').hidden).toBe(true);
    expect(document.getElementById('notes-empty-state').hidden).toBe(false);
  });

  it('renders a list row for a note that is missing fields', () => {
    NotesPanel.init();
    NotesPanel.notes = [{ id: 'broken' }];
    expect(() => NotesPanel.renderList('q')).not.toThrow();
    NotesPanel.renderList('');
    expect(document.querySelector('.note-list-item-title').textContent).toBe('Untitled');
    expect(document.querySelector('.note-list-item-date').textContent).toBe('');
  });

  it('lists sticky notes in the page-notes section and opens one for editing', () => {
    window.StickyNotes._store = [{ key: 'example.com/a', text: 'sticky body', updated: Date.now(), url: 'https://example.com/a', title: 'Example A' }];
    NotesPanel.init();
    NotesPanel.setSection('sticky');
    expect(document.getElementById('notes-count-sticky').textContent).toBe('1');
    const row = document.querySelector('.sticky-list-item');
    expect(row).toBeTruthy();
    row.click();
    expect(NotesPanel.activeStickyKey).toBe('example.com/a');
    expect(document.getElementById('notes-sticky-text').value).toBe('sticky body');
    expect(document.getElementById('notes-sticky-view').hidden).toBe(false);
  });

  it('saves an edited sticky note through StickyNotes.setText', () => {
    window.StickyNotes._store = [{ key: 'example.com/a', text: 'old', updated: 1, url: 'https://example.com/a', title: '' }];
    NotesPanel.init();
    NotesPanel.setSection('sticky');
    NotesPanel.selectSticky('example.com/a');
    const ta = document.getElementById('notes-sticky-text');
    ta.value = 'new body';
    NotesPanel._flushSticky();
    expect(window.StickyNotes.setText).toHaveBeenCalledWith('example.com/a', 'new body', { url: 'https://example.com/a', title: '' });
  });

  it('converts a sticky note into a full note that links back to the page', () => {
    window.StickyNotes._store = [{ key: 'example.com/a', text: 'sticky body', updated: 1, url: 'https://example.com/a', title: 'Example A' }];
    NotesPanel.init();
    NotesPanel.setSection('sticky');
    NotesPanel.selectSticky('example.com/a');
    NotesPanel.convertStickyToNote();

    expect(window.StickyNotes.remove).toHaveBeenCalledWith('example.com/a');
    const created = NotesPanel.notes[0];
    expect(created.content).toBe('sticky body');
    expect(created.sourceUrl).toBe('https://example.com/a');
    expect(NotesPanel.section).toBe('notes');
    expect(NotesPanel.activeNoteId).toBe(created.id);
  });

  it('openStickySection switches the panel to page notes', () => {
    window.SidebarManager = { showPanel: vi.fn() };
    NotesPanel.init();
    expect(NotesPanel.openStickySection()).toBe(true);
    expect(window.SidebarManager.showPanel).toHaveBeenCalledWith('notes');
    expect(NotesPanel.section).toBe('sticky');
    delete window.SidebarManager;
  });

  // The caller falls back to its own modal when this returns false, so saying
  // "opened" while the panel is nowhere on screen is the bug this guards.
  it('openStickySection reports failure when the sidebar cannot show the panel', () => {
    delete window.SidebarManager;
    NotesPanel.init();
    expect(NotesPanel.openStickySection()).toBe(false);
  });

  it('openStickySection reports failure when the panel stays hidden', () => {
    window.SidebarManager = { showPanel: vi.fn() };
    document.getElementById('panel-notes').style.display = 'none';
    NotesPanel.init();
    expect(NotesPanel.openStickySection()).toBe(false);
    delete window.SidebarManager;
  });

  it('toggling a preview checkbox rewrites the markdown and persists it', () => {
    NotesPanel.init();
    NotesPanel.notes = [{ id: 'a', title: 'A', content: '- [ ] one\n- [ ] two' }];
    NotesPanel.selectNote('a');
    NotesPanel.togglePreview();
    const box = document.querySelectorAll('.notes-task-box')[1];
    box.checked = true;
    box.dispatchEvent(new Event('change', { bubbles: true }));

    expect(NotesPanel.notes[0].content).toBe('- [ ] one\n- [x] two');
    expect(document.getElementById('notes-content-area').value).toBe('- [ ] one\n- [x] two');
    expect(JSON.parse(localStorage.getItem('vex.notes'))[0].content).toBe('- [ ] one\n- [x] two');
  });

  it('filters the list by a tag chip', () => {
    NotesPanel.init();
    NotesPanel.notes = [
      { id: 'a', title: 'A', content: '', tags: ['work'] },
      { id: 'b', title: 'B', content: '', tags: ['home'] },
    ];
    NotesPanel.renderList();
    document.querySelector('.notes-tag-filter[data-tag="work"]').click();
    expect(NotesPanel.tagFilter).toBe('work');
    expect([...document.querySelectorAll('.note-list-item')].map(e => e.dataset.id)).toEqual(['a']);
    // The bar is re-rendered, so click the fresh chip, not the detached one.
    const active = document.querySelector('.notes-tag-filter.active');
    expect(active.dataset.tag).toBe('work');
    active.click();
    expect(NotesPanel.tagFilter).toBe('');
  });

  it('re-reads storage when the panel is reopened', () => {
    NotesPanel.init();
    // Something else writes while the panel is hidden.
    localStorage.setItem('vex.notes', JSON.stringify([{ id: 'clipped', title: 'Clippings', content: 'x', updatedAt: new Date().toISOString() }]));
    NotesPanel.init();   // sidebar.js calls init() on every open
    expect(NotesPanel.notes.map(n => n.id)).toEqual(['clipped']);
    expect(document.querySelector('.note-list-item').dataset.id).toBe('clipped');
  });

  it('does not delete without a confirmation', async () => {
    NotesPanel.init();
    NotesPanel.notes = [{ id: 'a', title: 'A', content: 'a' }];
    NotesPanel.selectNote('a');
    window.vexConfirm = vi.fn().mockResolvedValue(false);
    await NotesPanel.deleteActive();
    expect(window.vexConfirm).toHaveBeenCalled();
    expect(NotesPanel.notes).toHaveLength(1);

    window.vexConfirm = vi.fn().mockResolvedValue(true);
    await NotesPanel.deleteActive();
    expect(NotesPanel.notes).toHaveLength(0);
    expect(JSON.parse(localStorage.getItem('vex.notes'))).toEqual([]);
    delete window.vexConfirm;
  });

  it('collapses to one column below the narrow breakpoint', () => {
    NotesPanel.init();
    const c = document.getElementById('notes-container');
    Object.defineProperty(c, 'clientWidth', { value: 420, configurable: true });
    NotesPanel._measure();
    expect(c.classList.contains('narrow')).toBe(true);

    Object.defineProperty(c, 'clientWidth', { value: 900, configurable: true });
    NotesPanel._measure();
    expect(c.classList.contains('narrow')).toBe(false);
  });
});

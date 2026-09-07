// @vitest-environment jsdom
import { beforeEach, expect, it } from 'vitest';

beforeEach(() => { localStorage.clear(); document.body.innerHTML = ''; });

it('re-reads notes after a sync pull instead of overwriting them', async () => {
  const { NotesPanel } = await import('../../src/renderer/js/notes-panel.js');
  NotesPanel.notes = [{ id: 'local', title: 'Local', content: 'a' }];
  NotesPanel.activeNoteId = 'local';

  // A pull replaces the stored notes with what the other device had.
  const pulled = [{ id: 'remote', title: 'Remote', content: 'b' }];
  localStorage.setItem('vex.notes', JSON.stringify(pulled));
  window.dispatchEvent(new CustomEvent('vex-sync-data-applied'));

  expect(NotesPanel.notes).toEqual(pulled);
  // The stale active id must not survive, or the next edit targets a note that
  // no longer exists.
  expect(NotesPanel.activeNoteId).toBe(null);

  // The next save must preserve what the pull brought in.
  NotesPanel.save();
  expect(JSON.parse(localStorage.getItem('vex.notes'))).toEqual(pulled);
});

it('keeps the active note when the pull still contains it', async () => {
  const { NotesPanel } = await import('../../src/renderer/js/notes-panel.js');
  NotesPanel.notes = [{ id: 'keep', title: 'Old', content: 'a' }];
  NotesPanel.activeNoteId = 'keep';
  localStorage.setItem('vex.notes', JSON.stringify([{ id: 'keep', title: 'New', content: 'b' }]));
  window.dispatchEvent(new CustomEvent('vex-sync-data-applied'));
  expect(NotesPanel.activeNoteId).toBe('keep');
  expect(NotesPanel.notes[0].title).toBe('New');
});

it('ignores a malformed stored value rather than dropping notes', async () => {
  const { NotesPanel } = await import('../../src/renderer/js/notes-panel.js');
  const good = [{ id: 'a', title: 'A', content: '' }];
  NotesPanel.notes = good;
  localStorage.setItem('vex.notes', '{not json');
  window.dispatchEvent(new CustomEvent('vex-sync-data-applied'));
  expect(NotesPanel.notes).toEqual(good);
});

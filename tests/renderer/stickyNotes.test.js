// @vitest-environment jsdom
// Sticky notes: URL normalization, the store API the Notes panel reads, and
// the "reopen throws away what you typed" bug.
import { beforeEach, describe, expect, it, vi } from 'vitest';

let StickyNotes;

beforeEach(async () => {
  localStorage.clear();
  document.body.innerHTML = '';
  document.getElementById('vex-sticky-styles')?.remove();
  ({ StickyNotes } = await import('../../src/renderer/js/sticky-notes.js'));
  StickyNotes._pendingPersist = null;
  clearTimeout(StickyNotes._timer);
});

describe('_norm', () => {
  it('ignores www, query, hash and a trailing slash', () => {
    const keys = [
      'https://www.example.com/page/?utm=1#frag',
      'https://example.com/page',
      'http://example.com/page/',
    ].map(u => StickyNotes._norm(u));
    expect(new Set(keys).size).toBe(1);
    expect(keys[0]).toBe('example.com/page');
  });

  it('keeps a bare host when there is no path', () => {
    expect(StickyNotes._norm('https://example.com/')).toBe('example.com');
  });

  it('keeps file: and vex: URLs distinguishable from web ones', () => {
    expect(StickyNotes._norm('file:///C:/tmp/a.html')).toBe('file:/C:/tmp/a.html');
    expect(StickyNotes._norm('vex://start')).toMatch(/^vex:/);
  });

  it('returns an empty key for an empty URL so open() can refuse', () => {
    expect(StickyNotes._norm('')).toBe('');
    expect(StickyNotes._norm(null)).toBe('');
  });

  it('falls back to the raw string for something unparseable', () => {
    expect(StickyNotes._norm('not a url')).toBe('not a url');
  });
});

describe('store API', () => {
  it('round-trips a note with its real URL and title', () => {
    StickyNotes.setText('example.com/a', 'body', { url: 'https://example.com/a?x=1', title: 'Example' });
    const all = StickyNotes.getAll();
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ key: 'example.com/a', text: 'body', url: 'https://example.com/a?x=1', title: 'Example' });
    expect(all[0].updated).toBeGreaterThan(0);
  });

  it('keeps the recorded URL when only the text is updated', () => {
    StickyNotes.setText('example.com/a', 'body', { url: 'https://example.com/a', title: 'Example' });
    StickyNotes.setText('example.com/a', 'body 2');
    expect(StickyNotes.get('example.com/a')).toMatchObject({ url: 'https://example.com/a', title: 'Example', text: 'body 2' });
  });

  it('treats an emptied note as a deleted note', () => {
    StickyNotes.setText('example.com/a', 'body');
    StickyNotes.setText('example.com/a', '   ');
    expect(StickyNotes.getAll()).toEqual([]);
  });

  it('sorts newest first', () => {
    StickyNotes.setText('a.com', 'one');
    const store = JSON.parse(localStorage.getItem('vex.stickyNotes'));
    store['a.com'].updated = 1;
    localStorage.setItem('vex.stickyNotes', JSON.stringify(store));
    StickyNotes.setText('b.com', 'two');
    expect(StickyNotes.getAll().map(n => n.key)).toEqual(['b.com', 'a.com']);
  });

  it('ignores a corrupt store instead of throwing', () => {
    localStorage.setItem('vex.stickyNotes', '{not json');
    expect(StickyNotes.getAll()).toEqual([]);
    localStorage.setItem('vex.stickyNotes', '[1,2,3]');
    expect(StickyNotes.getAll()).toEqual([]);
  });

  it('skips entries with no usable text', () => {
    localStorage.setItem('vex.stickyNotes', JSON.stringify({ a: { text: '   ' }, b: { text: 5 }, c: { text: 'ok' } }));
    expect(StickyNotes.getAll().map(n => n.key)).toEqual(['c']);
  });

  it('remove() reports whether anything went', () => {
    StickyNotes.setText('a.com', 'x');
    expect(StickyNotes.remove('a.com')).toBe(true);
    expect(StickyNotes.remove('a.com')).toBe(false);
  });

  it('announces changes so the Notes panel can repaint', () => {
    const seen = vi.fn();
    window.addEventListener('vex-sticky-notes-changed', seen);
    StickyNotes.setText('a.com', 'x');
    StickyNotes.remove('a.com');
    expect(seen).toHaveBeenCalledTimes(2);
    window.removeEventListener('vex-sticky-notes-changed', seen);
  });

  it('hasNote only counts a note with real text', () => {
    expect(StickyNotes.hasNote('https://example.com/a')).toBe(false);
    StickyNotes.setText('example.com/a', 'x');
    expect(StickyNotes.hasNote('https://www.example.com/a?q=1')).toBe(true);
  });
});

describe('pageUrlFor', () => {
  it('prefers the URL that was recorded with the note', () => {
    expect(StickyNotes.pageUrlFor({ key: 'example.com/a', url: 'http://example.com/a?x=1' })).toBe('http://example.com/a?x=1');
  });
  it('assumes https for a legacy bare key', () => {
    expect(StickyNotes.pageUrlFor({ key: 'example.com/a', url: '' })).toBe('https://example.com/a');
    expect(StickyNotes.pageUrlFor('example.com/a')).toBe('https://example.com/a');
  });
  it('does not prepend https to a key that already has a scheme', () => {
    // 'https://file:/C:/x' was a real navigation the old list() produced.
    expect(StickyNotes.pageUrlFor('file:/C:/x.html')).toBe('file:/C:/x.html');
  });
  it('returns an empty string when there is nothing to open', () => {
    expect(StickyNotes.pageUrlFor(null)).toBe('');
  });
});

describe('the open card', () => {
  beforeEach(() => {
    globalThis.TabManager = { getActiveTab: () => ({ url: 'https://example.com/page?x=1', title: 'Example page' }) };
  });

  it('records the real URL and title alongside the text', () => {
    StickyNotes.open();
    const ta = document.querySelector('#vex-sticky .vsn-text');
    ta.value = 'typed';
    StickyNotes.flush();
    expect(StickyNotes.get('example.com/page')).toMatchObject({ text: 'typed', url: 'https://example.com/page?x=1', title: 'Example page' });
  });

  it('does not lose unsaved text when the card is reopened', () => {
    StickyNotes.open();
    const ta = document.querySelector('#vex-sticky .vsn-text');
    ta.value = 'half typed';
    ta.dispatchEvent(new Event('input', { bubbles: true }));   // debounce armed, not fired

    StickyNotes.open();                                        // second open

    expect(StickyNotes.get('example.com/page').text).toBe('half typed');
    expect(document.querySelector('#vex-sticky .vsn-text').value).toBe('half typed');
  });

  it('flush() is a no-op with no card open', () => {
    expect(() => StickyNotes.flush()).not.toThrow();
  });

  it('refuses to open with no page', () => {
    globalThis.TabManager = { getActiveTab: () => ({ url: '' }) };
    window.showToast = vi.fn();
    StickyNotes.open();
    expect(document.getElementById('vex-sticky')).toBe(null);
    expect(window.showToast).toHaveBeenCalled();
    delete window.showToast;
  });

  it('uses SVG icons, never emoji', () => {
    StickyNotes.open();
    const html = document.getElementById('vex-sticky').innerHTML;
    expect(html).toContain('<svg');
    expect(html).not.toMatch(/[\u{1F300}-\u{1FAFF}\u{2700}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}]/u);
  });
});

describe('list()', () => {
  it('hands off to the Notes panel when it is available', () => {
    const openStickySection = vi.fn().mockReturnValue(true);
    window.NotesPanel = { openStickySection };
    StickyNotes.list();
    expect(openStickySection).toHaveBeenCalled();
    expect(document.getElementById('vex-sticky-list')).toBe(null);
    delete window.NotesPanel;
  });

  it('falls back to the modal when the panel is not there', () => {
    StickyNotes.setText('example.com/a', 'body');
    StickyNotes.list();
    const modal = document.getElementById('vex-sticky-list');
    expect(modal).toBeTruthy();
    expect(modal.textContent).toContain('example.com/a');
    expect(modal.innerHTML).not.toMatch(/[\u{1F300}-\u{1FAFF}\u{2700}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}]/u);
    modal.remove();
  });
});

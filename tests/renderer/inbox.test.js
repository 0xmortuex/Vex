// @vitest-environment jsdom
//
// T1-009: one read-only inbox over notes, saved pages, highlights, sticky notes
// and quick captures (js/inbox.js). Nothing is moved or deleted.
import { describe, it, expect, beforeEach, vi } from 'vitest';

const JS = '../../src/renderer/js/';
const fresh = (p) => { delete require.cache[require.resolve(p)]; return require(p); };

let I;
const NOW = new Date(2026, 9, 14, 12, 0).getTime();
const DAY = 86400000;

beforeEach(() => {
  localStorage.clear();
  vi.resetModules();
  ({ VexInbox: I } = fresh(JS + 'inbox.js'));
});

const sources = (over = {}) => ({
  notes: () => [
    { id: 'n1', title: 'Trip plan', content: 'Book the train\nand the hotel', updatedAt: new Date(NOW - DAY).toISOString() },
    { id: 'n2', title: 'Ancient', content: 'old', updatedAt: new Date(NOW - 90 * DAY).toISOString() },
  ],
  readLater: () => [
    { id: 'r1', title: 'A long read', url: 'https://example.com/a', at: NOW - 2 * DAY, read: false },
    { id: 'r2', title: 'Read already', url: 'https://example.com/b', at: NOW - DAY, read: true },
  ],
  highlights: () => ({ 'example.com/a': [{ id: 'h1', text: 'a highlighted sentence', title: 'A long read', url: 'https://example.com/a', at: NOW - 3600000 }] }),
  sticky: () => ({ k: { text: 'remember the form', updated: NOW - 5 * 3600000, url: 'https://example.com/form', title: 'Form' } }),
  captures: async () => [{ id: 'c1', text: 'idea: try the other build flag', at: NOW - 60000 }],
  ...over,
});

describe('collect()', () => {
  it('reads all five stores, skips old, read and empty entries, and tags each with its source', async () => {
    const { items, errors } = await I.collect(NOW, sources());
    expect(errors).toEqual([]);
    expect(items.map(i => i.source).sort()).toEqual(['capture', 'highlight', 'note', 'read-later', 'sticky']);
    expect(items.find(i => i.id === 'n2')).toBeUndefined();
    expect(items.find(i => i.id === 'rl:r2')).toBeUndefined();
  });

  it('names a store it cannot read and still answers with the rest', async () => {
    const { items, errors } = await I.collect(NOW, sources({ notes: () => { throw new Error('"vex.notes" is not readable'); } }));
    expect(errors).toEqual(['notes: "vex.notes" is not readable']);
    expect(items).toHaveLength(4);
  });

  it('reads the real localStorage stores, and says so when one is corrupt', async () => {
    localStorage.setItem('vex.notes', JSON.stringify([{ id: 'x', title: 'T', content: 'c', updatedAt: new Date(NOW - 1000).toISOString() }]));
    localStorage.setItem('vex.readLater', '{broken');
    const { items, errors } = await I.collect(NOW, { ...I._sources(), captures: async () => [] });
    expect(items.map(i => i.id)).toEqual(['note:x']);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/^read later: "vex.readLater" is not readable/);
  });
});

describe('rank()', () => {
  it('lists newest first, one of each id, filtered by source', async () => {
    const { items } = await I.collect(NOW, sources());
    const all = I.rank([...items, items[0]]);
    expect(all.map(i => i.source)).toEqual(['capture', 'highlight', 'sticky', 'note', 'read-later']);
    expect(I.rank(items, { source: 'note' }).map(i => i.id)).toEqual(['note:n1']);
    expect(I.rank(items, { limit: 2 })).toHaveLength(2);
  });
});

describe('the one count', () => {
  it('counts what arrived since the inbox was last opened', async () => {
    const src = sources();
    expect((await I.count(NOW, src)).unseen).toBe(5);
    I.markSeen(NOW - 2 * 3600000);
    expect((await I.count(NOW, src)).unseen).toBe(2);       // the highlight and the capture
    I.markSeen(NOW);
    expect((await I.count(NOW, src)).unseen).toBe(0);
  });
});

describe('openItem()', () => {
  it('opens a web address in a tab and copies a capture', () => {
    const createTab = vi.fn();
    globalThis.TabManager = { createTab };
    expect(I.openItem({ source: 'read-later', url: 'https://example.com/a' })).toBe('tab');
    expect(createTab).toHaveBeenCalledWith('https://example.com/a', true);
    delete globalThis.TabManager;
    expect(() => I.openItem({ source: 'read-later', url: 'https://example.com/a' })).toThrow(/Tabs are not loaded/);
    expect(() => I.openItem({ source: 'highlight', text: 'x' })).toThrow(/nowhere to open/);
  });
});

describe('the brief section', () => {
  it('is null when switched off', async () => {
    I.setEnabled(false);
    expect(await I.section().build({ now: NOW })).toBe(null);
    I.setEnabled(true);
    expect(I.enabled()).toBe(true);
  });
});

describe('the Notes-based capture features land in the inbox, each under its own filter (Wave 4)', () => {
  const at = new Date(NOW - 3600000).toISOString();
  it('tells a clipped line, a highlights note, a screenshot note and the weekly note apart', async () => {
    const notes = [
      { id: 'a', title: 'clip', content: 'x', tags: ['agent'], createdAt: at },
      { id: 'b', title: 'Highlights', content: 'y', tags: [], createdAt: at },
      { id: 'c', title: 'Screenshot: page', content: 'z', tags: ['screenshot'], createdAt: at },
      { id: 'd', title: 'Week 42', content: 'w', tags: ['weekly'], createdAt: at },
      { id: 'e', title: 'Plain', content: 'p', createdAt: at },
    ];
    const { items } = await I.collect(NOW, sources({ notes: () => notes }));
    const by = (id) => items.find(i => i.id === 'note:' + id).source;
    expect([by('a'), by('b'), by('c'), by('d'), by('e')]).toEqual(['clip-note', 'highlight-note', 'screenshot-note', 'weekly-note', 'note']);
    for (const s of ['clip-note', 'highlight-note', 'screenshot-note', 'weekly-note']) expect(I.SOURCES[s]).toBeTruthy();
  });

  it('reads the daily journal, one row per day', async () => {
    const journal = () => ({ '2026-10-13': { text: '# Journal\n\nRead three pages', at: NOW - 3600000, edited: false }, '2026-08-01': { text: 'old', at: NOW - 90 * DAY } });
    const { items, errors } = await I.collect(NOW, sources({ journal }));
    expect(errors).toEqual([]);
    const j = items.filter(i => i.source === 'journal');
    expect(j).toHaveLength(1);
    expect(j[0].sub).toBe('Read three pages');
  });

  it('opens a journal row in the journal and a weekly note in Notes', () => {
    globalThis.VexMemoryTools = { openJournal: vi.fn() };
    expect(I.openItem({ source: 'journal' })).toBe('journal');
    globalThis.SidebarManager = { openPanel: vi.fn() };
    expect(I.openItem({ source: 'weekly-note', noteId: 'd' })).toBe('notes');
    delete globalThis.VexMemoryTools; delete globalThis.SidebarManager;
  });
});

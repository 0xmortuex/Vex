// Research board: quotes keep their source, order is the user's, and the
// markdown brief follows the board's order.
import { describe, it, expect, beforeEach, vi } from 'vitest';
const store = {};
beforeEach(() => {
  for (const k of Object.keys(store)) delete store[k];
  globalThis.localStorage = { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } };
  globalThis.window = { escapeHtml: (s) => String(s), showToast: vi.fn() };
  globalThis.NotesPanel = { notes: [], save: vi.fn(), renderList: vi.fn() };
});
const { ResearchBoard: B } = require('../../src/renderer/js/research-board.js');
const fresh = () => { B.items = []; };

describe('board', () => {
  it('keeps quotes with their page and drops an exact repeat', () => {
    fresh();
    expect(B.add({ text: 'Alpha  beta', url: 'https://a.test/x', title: 'A' }).added).toBe(true);
    expect(B.add({ text: 'Alpha beta', url: 'https://a.test/x', title: 'A' }).added).toBe(false);
    expect(B.list()).toHaveLength(1);
    expect(B.list()[0]).toMatchObject({ text: 'Alpha beta', url: 'https://a.test/x' });
  });

  it('refuses an empty quote', () => {
    fresh();
    expect(() => B.add({ text: '   ' })).toThrow(/no text/);
  });

  it('reorders and stops at the ends', () => {
    fresh();
    const a = B.add({ text: 'one one one', url: 'https://a.test' }).item;
    const b = B.add({ text: 'two two two', url: 'https://b.test' }).item;
    expect(B.move(b.id, -1)).toBe(0);
    expect(B.list().map(q => q.id)).toEqual([b.id, a.id]);
    expect(B.move(b.id, -1)).toBe(-1);
  });

  it('persists to storage', () => {
    fresh();
    B.add({ text: 'kept quote', url: 'https://a.test' });
    expect(JSON.parse(store['vex.researchBoard'])).toHaveLength(1);
  });

  it('markdown groups by source in board order, with a source list', () => {
    fresh();
    B.add({ text: 'first from B', url: 'https://b.test', title: 'Page B' });
    B.add({ text: 'from A', url: 'https://a.test', title: 'Page A' });
    B.add({ text: 'second from B', url: 'https://b.test', title: 'Page B' });
    const md = B.toMarkdown('Brief');
    expect(md.startsWith('# Brief')).toBe(true);
    expect(md.indexOf('Page B')).toBeLessThan(md.indexOf('Page A'));
    expect(md).toContain('> first from B');
    expect(md).toContain('> second from B');
    expect(md).toContain('1. [Page B](https://b.test)');
    expect(md).toContain('2. [Page A](https://a.test)');
  });

  it('export puts a new note into Notes, and refuses an empty board', () => {
    fresh();
    expect(() => B.exportToNotes('x')).toThrow(/empty/);
    B.add({ text: 'quote text', url: 'https://a.test', title: 'A' });
    const note = B.exportToNotes('My brief');
    expect(NotesPanel.notes[0]).toBe(note);
    expect(note.title).toBe('My brief');
    expect(note.content).toContain('> quote text');
    expect(NotesPanel.save).toHaveBeenCalled();
  });

  it('never reads a private tab', async () => {
    globalThis.window.VexTabPolicy = { canReadWebview: () => false, canPersist: () => false };
    globalThis.window.vexGuestEval = vi.fn(async () => 'secret');
    const t = await B._selectionOf({ url: 'https://a.test' }, {});
    expect(t).toBe('');
    expect(window.vexGuestEval).not.toHaveBeenCalled();
  });

  it('pulls a selection from each tab that has one', async () => {
    fresh();
    globalThis.window.vexGuestEval = vi.fn(async (wv) => wv.sel);
    globalThis.TabManager = { tabs: [{ id: 1, url: 'https://a.test', title: 'A' }, { id: 2, url: 'https://b.test', title: 'B' }, { id: 3, url: 'https://c.test', title: 'C' }] };
    globalThis.WebviewManager = { webviews: new Map([[1, { sel: 'from tab one' }], [2, { sel: '' }], [3, { sel: 'from tab three' }]]) };
    const r = await B.pullFromAllTabs();
    expect(r).toEqual({ added: 2, tabsWithSelection: 2 });
    expect(B.list().map(q => q.url)).toEqual(['https://a.test', 'https://c.test']);
  });
});

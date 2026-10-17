// @vitest-environment jsdom
// T2-040: subject tags across notes, downloads, read-later and clips; term > course > unit; clip pre-tagging; last page.
import { describe, it, expect, beforeEach, vi } from 'vitest';
const JS = '../../src/renderer/js/';
const fresh = (p) => { delete require.cache[require.resolve(p)]; return require(p); };

let C, a, b, spaces;
beforeEach(async () => {
  localStorage.clear(); vi.resetModules();
  delete globalThis.VexLedger; delete globalThis.TabManager;
  ({ VexCourseSpaces: C } = fresh(JS + 'course-spaces.js'));
  spaces = { s1: { id: 's1', noteIds: ['n3'] }, s2: { id: 's2', noteIds: [] } };
  globalThis.ProjectSpaces = { get: (id) => spaces[id] || null, create: async (name) => spaces[name === 'Calculus II' ? 's1' : 's2'], active: () => globalThis.__active || null, switchTo: vi.fn(async () => {}) };
  a = await C.add({ name: 'Calculus II', term: 'Autumn 2026', units: 'Week 1, Week 2, Week 1' });
  b = await C.add({ name: 'History', term: 'Autumn 2026' });
  localStorage.setItem('vex.notes', JSON.stringify([{ id: 'n1', title: 'Limits' }, { id: 'n2', title: 'Wars' }, { id: 'n3', title: 'In the space' }]));
  localStorage.setItem('vex.readLater', JSON.stringify([{ id: 'r1', url: 'https://a.com', title: 'A', at: 1 }, { id: 'r2', url: 'https://b.com', title: 'B', at: 2 }]));
  localStorage.setItem('vex.downloads', JSON.stringify([{ id: 'd1', filename: 'slides.pdf', startedAt: '2026-10-01T10:00:00Z' }, { id: 'd2', filename: 'secret.pdf', ephemeral: true }]));
});

describe('units and the term tree', () => {
  it('keeps unique units, trimmed, in order', () => {
    expect(a.units).toEqual(['Week 1', 'Week 2']);
    expect(C.clean({ name: 'x', units: ['  A ', 'A', '', 'B'] }).units).toEqual(['A', 'B']);
  });
  it('groups by term and counts by unit', () => {
    C.tag('readLater', 'r1', a.id, 'Week 2');
    C.tag('note', 'n1', a.id);
    C.tag('download', 'd1', b.id);
    const t = C.tree();
    expect(t.map(x => x.term)).toEqual(['Autumn 2026']);
    const calc = t[0].courses.find(x => x.course.id === a.id);
    expect(calc.count).toBe(2);
    expect(calc.units).toEqual([{ name: 'Week 1', count: 0 }, { name: 'Week 2', count: 1 }]);
    expect(t[0].courses.find(x => x.course.id === b.id).count).toBe(1);
  });
});

describe('tags', () => {
  it('tag, read back, retag and untag; refuses an unknown unit, course or kind', () => {
    expect(C.tag('readLater', 'r1', a.id, 'Week 1')).toEqual({ c: a.id, u: 'Week 1' });
    expect(C.tagOf('readLater', 'r1')).toEqual({ c: a.id, u: 'Week 1' });
    C.tag('readLater', 'r1', b.id);
    expect(C.tagOf('readLater', 'r1')).toEqual({ c: b.id });
    expect(C.untag('readLater', 'r1')).toBe(true);
    expect(C.tagOf('readLater', 'r1')).toBe(null);
    expect(() => C.tag('readLater', 'r1', a.id, 'Week 9')).toThrow(/no unit called/);
    expect(() => C.tag('readLater', 'r1', 'nope')).toThrow(/course is gone/);
    expect(() => C.tag('video', 'x', a.id)).toThrow(/Unknown kind/);
  });
  it('reports a damaged tag store instead of replacing it', () => {
    localStorage.setItem(C.TAGS_KEY, '{nope');
    expect(() => C.tag('note', 'n1', a.id)).toThrow(/damaged/);
    expect(localStorage.getItem(C.TAGS_KEY)).toBe('{nope');
  });
  it('does not touch the notes, downloads or read-later stores', () => {
    const before = ['vex.notes', 'vex.readLater', 'vex.downloads'].map(k => localStorage.getItem(k));
    C.tag('note', 'n1', a.id); C.tag('readLater', 'r1', a.id); C.tag('download', 'd1', a.id);
    expect(['vex.notes', 'vex.readLater', 'vex.downloads'].map(k => localStorage.getItem(k))).toEqual(before);
  });
});

describe('the subject filter', () => {
  it('lists each store by course, with untagged, and counts a note in the course space', () => {
    C.tag('note', 'n1', a.id); C.tag('readLater', 'r2', b.id); C.tag('download', 'd1', a.id);
    const names = (kind, who) => C.filterBy(C.sourceItems(kind), kind, who).map(i => i.key);
    expect(names('note', a.id).sort()).toEqual(['n1', 'n3']);
    expect(names('note', 'untagged').sort()).toEqual(['n2', 'n3']);
    expect(names('readLater', b.id)).toEqual(['r2']);
    expect(names('readLater', 'all')).toEqual(['r1', 'r2']);
    expect(names('download', a.id)).toEqual(['d1']);
    expect(C.sourceItems('download').map(d => d.key)).toEqual(['d1']);
    expect(C.counts(a.id)).toEqual({ note: 2, download: 1, readLater: 0, clip: 0 });
  });
});

describe('clip pre-tagging', () => {
  const clips = [{ id: 'c1', text: 'old', at: 1 }, { id: 'c2', text: 'later', at: 2 }];
  beforeEach(() => {
    window.vex = { clipsInboxList: vi.fn(async () => ({ ok: true, items: clips.slice() })) };
    globalThis.__active = { id: 's1' };
    globalThis.VexLedger = { note: vi.fn(), registerUndo: vi.fn() };
  });
  it('is off by default: nothing is tagged', async () => {
    expect(C.pretagging()).toBe(false);
    expect(await C.pretagClips()).toBe(0);
    expect(C.tagOf('clip', 'c1')).toBe(null);
  });
  it('leaves the clips already there alone, tags the ones that arrive, and writes it to the ledger with an undo', async () => {
    await C.setPretag(true);
    expect(await C.pretagClips()).toBe(0);
    clips.push({ id: 'c3', text: 'new one', at: 3 });
    expect(await C.pretagClips()).toBe(1);
    expect(C.tagOf('clip', 'c3')).toEqual({ c: a.id });
    expect(C.tagOf('clip', 'c1')).toBe(null);
    expect(globalThis.VexLedger.note.mock.calls[0][0]).toMatchObject({ feature: 'course-spaces', undo: { kind: 'course-untag-clips', keys: ['c3'] } });
    expect(await C.pretagClips()).toBe(0);
    clips.pop();
  });
  it('does nothing when no course is current', async () => {
    await C.setPretag(true);
    globalThis.__active = null;
    clips.push({ id: 'c9', text: 'x', at: 9 });
    expect(await C.pretagClips()).toBe(0);
    clips.pop();
  });
  it('the undo untags', async () => {
    const reg = {};
    globalThis.VexLedger = { note: vi.fn(), registerUndo: (k, fn) => { reg[k] = fn; } };
    C._wired = false; C.init();
    C.tag('clip', 'c3', a.id);
    await reg['course-untag-clips']({ keys: ['c3'] });
    expect(C.tagOf('clip', 'c3')).toBe(null);
  });
});

describe('last page of a course', () => {
  beforeEach(() => {
    globalThis.__active = { id: 's1' };
    globalThis.TabManager = { activeTabId: 't1', tabs: [{ id: 't1', title: 'Chapter 3', partition: 'persist:main' }], createTab: vi.fn() };
  });
  it('remembers the page of the active tab for the current course and resumes it', () => {
    expect(C.noteLastPage('t1', 'https://book.example.com/ch3')).toBe(true);
    expect(C.noteLastPage('t1', 'https://book.example.com/ch3')).toBe(false);
    expect(C.lastPage(a.id)).toMatchObject({ url: 'https://book.example.com/ch3', title: 'Chapter 3' });
    expect(C.lastPage(b.id)).toBe(null);
    C.resume(a.id);
    expect(TabManager.createTab).toHaveBeenCalledWith('https://book.example.com/ch3', true);
    expect(() => C.resume(b.id)).toThrow(/No page has been remembered/);
  });
  it('ignores a background tab, a private tab, a non-web page, and no current course', () => {
    expect(C.noteLastPage('t2', 'https://x.com/')).toBe(false);
    expect(C.noteLastPage('t1', 'file:///c.html')).toBe(false);
    window.VexTabPolicy = { canRestore: () => false };
    expect(C.noteLastPage('t1', 'https://x.com/')).toBe(false);
    delete window.VexTabPolicy;
    globalThis.__active = null;
    expect(C.noteLastPage('t1', 'https://x.com/')).toBe(false);
  });
});

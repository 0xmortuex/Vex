// @vitest-environment jsdom
//
// Notes, and taking them with you. The export is Markdown because a note is
// text with a link attached and that is exactly what a Markdown list is: it
// opens in anything, and it is still readable if nothing opens it.
import { describe, it, expect, beforeEach, vi } from 'vitest';

const rows = { notes: [] };
let nextId = 1;
window.VexDB = {
  add: vi.fn(async (store, record) => { const id = nextId++; rows[store].push({ ...record, id }); return id; }),
  scan: vi.fn(async (store, { limit = 100, match } = {}) =>
    rows[store].slice().sort((a, b) => (b.at || 0) - (a.at || 0)).filter(row => !match || match(row)).slice(0, limit)),
  delete: vi.fn(async (store, id) => { rows[store] = rows[store].filter(row => row.id !== id); }),
  clear: vi.fn(async store => { rows[store] = []; })
};
window.VexSearch = {
  prettyHost: url => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; } }
};

const { VexNotes } = require('../../mobile/www/js/notes.js');

beforeEach(() => { rows.notes = []; nextId = 1; });

describe('keeping one', () => {
  it('attaches it to the page, with its host', async () => {
    const note = await VexNotes.add({ url: 'https://www.bbc.co.uk/news/1', title: 'A story', text: '  worth keeping  ' });
    expect(note).toMatchObject({ host: 'bbc.co.uk', text: 'worth keeping', kind: 'note' });
  });

  it('refuses an empty one', async () => {
    expect(await VexNotes.add({ url: 'https://a.example/', text: '   ' })).toBe(null);
    expect(rows.notes).toHaveLength(0);
  });

  it('caps an enormous one rather than storing a book', async () => {
    const note = await VexNotes.add({ url: 'https://a.example/', text: 'x'.repeat(30000) });
    expect(note.text.length).toBe(20000);
  });
});

describe('exporting them', () => {
  it('writes a note as a line and a quote as a block quote', async () => {
    await VexNotes.add({ url: 'https://a.example/one', title: 'One', text: 'a plain note' });
    await VexNotes.add({ url: 'https://b.example/two', title: 'Two', text: 'what the page said', kind: 'quote' });
    const text = await VexNotes.exportMarkdown();

    expect(text).toContain('# Notes from Vex');
    expect(text).toContain('2 notes');
    expect(text).toContain('- a plain note · [One](https://a.example/one)');
    expect(text).toContain('> what the page said');
    expect(text).toContain('— [Two](https://b.example/two)');
  });

  it('groups them by the day they were kept', async () => {
    const yesterday = Date.now() - 86400000;
    await VexNotes.add({ url: '', text: 'today' });
    rows.notes.push({ id: 99, url: '', text: 'yesterday', kind: 'note', at: yesterday });
    const text = await VexNotes.exportMarkdown();
    const days = text.match(/^## \d{4}-\d{2}-\d{2}$/gm);
    expect(days).toHaveLength(2);
  });

  it('keeps a note with nowhere to link to', async () => {
    await VexNotes.add({ url: '', text: 'just a thought' });
    const text = await VexNotes.exportMarkdown();
    expect(text).toContain('- just a thought');
    expect(text).not.toContain('·');
  });

  it('folds a multi-line note onto one line, and does not fold a quote', async () => {
    await VexNotes.add({ url: '', text: 'first\nsecond' });
    await VexNotes.add({ url: '', text: 'said\nover two lines', kind: 'quote' });
    const text = await VexNotes.exportMarkdown();
    expect(text).toContain('- first second');
    expect(text).toContain('> said');
    expect(text).toContain('> over two lines');
  });

  it('says so when there are none', async () => {
    const text = await VexNotes.exportMarkdown();
    expect(text).toContain('0 notes');
  });
});

describe('deleting one', () => {
  it('can be undone, with the note coming back under its own id and date', async () => {
    window.VexDB.put = vi.fn(async (store, record) => {
      rows[store] = rows[store].filter(row => row.id !== record.id).concat([record]);
      return record.id;
    });
    const note = await VexNotes.add({ url: 'https://a.example/', text: 'worth keeping' });
    const kept = rows.notes[0];
    await VexNotes.remove(note.id);
    expect(rows.notes).toHaveLength(0);
    await VexNotes.restore(kept);
    expect(rows.notes).toEqual([kept]);
  });

  it('restores nothing that never had an id', () => {
    expect(VexNotes.restore({ text: 'loose' })).toBe(null);
    expect(VexNotes.restore(null)).toBe(null);
  });
});

describe('finding one again', () => {
  it('searches the text, the title and the host', async () => {
    await VexNotes.add({ url: 'https://a.example/', title: 'Annual report', text: 'the figures' });
    await VexNotes.add({ url: 'https://b.example/', title: 'Something', text: 'else' });
    expect((await VexNotes.search('figures'))).toHaveLength(1);
    expect((await VexNotes.search('annual'))).toHaveLength(1);
    expect((await VexNotes.search('a.example'))).toHaveLength(1);
    expect((await VexNotes.search(''))).toHaveLength(2);
  });

  it('counts the ones kept on one site', async () => {
    await VexNotes.add({ url: 'https://a.example/1', text: 'one' });
    await VexNotes.add({ url: 'https://a.example/2', text: 'two' });
    await VexNotes.add({ url: 'https://b.example/', text: 'other' });
    expect(await VexNotes.count('a.example')).toBe(2);
  });
});

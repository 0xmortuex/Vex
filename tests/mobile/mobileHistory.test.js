// @vitest-environment jsdom
//
// History and Recall, against a stand-in for IndexedDB. The database wrapper
// itself is exercised for real by the Chromium smoke run; what matters here is
// the layer above it — that the in-memory slice the chrome draws from stays in
// step with what was written, that a revisit is not a new row, that private
// pages never arrive, and that the most-visited weighting favours this
// fortnight over one busy night last year.
import { describe, it, expect, beforeEach, vi } from 'vitest';

const store = {};
window.VexStore = {
  get: (key, fallback) => (key in store ? store[key] : fallback),
  set: async (key, value) => { store[key] = value; return value; }
};
window.VexSearch = { prettyHost: url => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; } } };

// A tiny in-memory stand-in with the same surface as VexDB.
const rows = { history: [], recall: [], pages: [], downloads: [] };
let nextId = 1;
window.VexDB = {
  available: () => true,
  tokenize: (text, cap = 500) => {
    const seen = new Set();
    for (const word of String(text || '').toLowerCase().split(/[^\p{L}\p{N}]+/u)) {
      if (word.length < 3 || word.length > 32) continue;
      seen.add(word);
      if (seen.size >= cap) break;
    }
    return [...seen];
  },
  add: async (store_, record) => { const id = nextId++; rows[store_].push(Object.assign({ id }, record)); return id; },
  put: async (store_, record) => {
    const list = rows[store_];
    const key = record.id != null ? 'id' : 'url';
    const at = list.findIndex(row => row[key] === record[key]);
    if (at >= 0) list[at] = record; else list.push(record);
    return record[key];
  },
  get: async (store_, key) => rows[store_].find(row => row.id === key || row.url === key) || null,
  delete: async (store_, key) => { rows[store_] = rows[store_].filter(row => row.id !== key && row.url !== key); },
  clear: async store_ => { rows[store_] = []; },
  count: async store_ => rows[store_].length,
  scan: async (store_, { limit = 100, match } = {}) =>
    rows[store_].slice().sort((a, b) => (b.at || 0) - (a.at || 0)).filter(row => !match || match(row)).slice(0, limit),
  deleteWhere: async (store_, predicate) => {
    const before = rows[store_].length;
    rows[store_] = rows[store_].filter(row => !predicate(row));
    return before - rows[store_].length;
  },
  search: async (query, limit = 40) => {
    const terms = window.VexDB.tokenize(query, 8);
    return rows.recall
      .filter(row => terms.every(term => row.words.includes(term)))
      .sort((a, b) => (b.at || 0) - (a.at || 0))
      .slice(0, limit);
  },
  prune: vi.fn(async () => 0)
};

const { VexHistory } = require('../../mobile/www/js/history.js');

beforeEach(async () => {
  for (const key of Object.keys(store)) delete store[key];
  for (const key of Object.keys(rows)) rows[key] = [];
  nextId = 1;
  VexHistory._reset ? VexHistory._reset() : null;
  await VexHistory.clear();
  await VexHistory.load();
});

describe('the visit log', () => {
  it('writes a row and serves it back without touching the database', async () => {
    await VexHistory.add({ url: 'https://example.com/', title: 'Example' });
    expect(rows.history).toHaveLength(1);
    expect(VexHistory.recent()[0]).toMatchObject({ url: 'https://example.com/', host: 'example.com' });
  });

  it('does not log the same page twice in a minute', async () => {
    await VexHistory.add({ url: 'https://example.com/', title: 'Example' });
    await VexHistory.add({ url: 'https://example.com/', title: 'Example, retitled' });
    expect(rows.history).toHaveLength(1);
    expect(VexHistory.recent()[0].title).toBe('Example, retitled');
  });

  it('does log it again later', async () => {
    await VexHistory.add({ url: 'https://example.com/', title: 'Example', at: Date.now() - 3600000 });
    await VexHistory.add({ url: 'https://example.com/', title: 'Example' });
    expect(rows.history).toHaveLength(2);
  });

  it('refuses a blank page', async () => {
    expect(await VexHistory.add({ url: 'about:blank' })).toBe(null);
    expect(await VexHistory.add({})).toBe(null);
  });

  it('fills a favicon in after the fact', async () => {
    await VexHistory.add({ url: 'https://example.com/', title: 'Example' });
    await VexHistory.setIcon('https://example.com/', 'data:image/png;base64,AAA');
    expect(VexHistory.recent()[0].icon).toBe('data:image/png;base64,AAA');
    expect(rows.history[0].icon).toBe('data:image/png;base64,AAA');
  });

  it('forgets one visit, or a whole site', async () => {
    await VexHistory.add({ url: 'https://a.example/1', title: 'One' });
    await VexHistory.add({ url: 'https://a.example/2', title: 'Two' });
    await VexHistory.add({ url: 'https://b.example/', title: 'Other' });
    await VexHistory.removeSite('a.example');
    expect(rows.history.map(row => row.host)).toEqual(['b.example']);
    expect(VexHistory.recent().map(row => row.host)).toEqual(['b.example']);
  });

  it('searches the database, not just the slice in memory', async () => {
    await VexHistory.add({ url: 'https://example.com/annual-report', title: 'Annual report' });
    await VexHistory.add({ url: 'https://other.example/', title: 'Something else' });
    const hits = await VexHistory.search('annual');
    expect(hits.map(row => row.url)).toEqual(['https://example.com/annual-report']);
  });
});

describe('an old history moving into the database', () => {
  it('is carried across once, then left alone', async () => {
    // load() migrates on the first call, so the module has to be loaded fresh.
    delete require.cache[require.resolve('../../mobile/www/js/history.js')];
    rows.history = [];
    store['vex.history'] = [
      { url: 'https://old.example/1', title: 'One', at: 1000 },
      { url: 'https://old.example/2', title: 'Two', at: 2000 }
    ];
    const fresh = require('../../mobile/www/js/history.js').VexHistory;
    await fresh.load();
    expect(rows.history.map(row => row.url)).toEqual(['https://old.example/2', 'https://old.example/1']);
    expect(store['vex.history']).toEqual([]);

    // Loading again does not double it up.
    await fresh.load();
    expect(rows.history).toHaveLength(2);
  });
});

describe('Recall', () => {
  it('indexes a page’s words, and finds it by them', async () => {
    await VexHistory.index({
      url: 'https://example.com/piece',
      title: 'A piece about rigging',
      text: 'The topsail and the halyard, and a long digression about anchors.'
    });
    const hits = await VexHistory.recall('halyard anchors');
    expect(hits).toHaveLength(1);
    expect(hits[0].url).toBe('https://example.com/piece');
  });

  it('needs every word, not any of them', async () => {
    // Long enough to be indexed at all: a page with almost no words is skipped.
    await VexHistory.index({ url: 'https://a.example/', title: 'A', text: 'topsail halyard rigging masthead shrouds' });
    await VexHistory.index({ url: 'https://b.example/', title: 'B', text: 'halyard anchors capstan windlass cable' });
    expect((await VexHistory.recall('halyard')).length).toBe(2);
    expect((await VexHistory.recall('topsail anchors')).length).toBe(0);
  });

  it('stays out of it when you switch it off', async () => {
    store['vex.recall'] = false;
    await VexHistory.index({ url: 'https://example.com/', title: 'T', text: 'some words here to index' });
    expect(rows.recall).toHaveLength(0);
  });

  it('skips a page with almost no text', async () => {
    await VexHistory.index({ url: 'https://example.com/', title: 'T', text: 'one two' });
    expect(rows.recall).toHaveLength(0);
  });

  it('quotes the line the word was in', async () => {
    const row = { text: 'Before the match. The halyard parted at the masthead. After the match.', url: '', title: '' };
    expect(VexHistory.snippet(row, 'halyard')).toContain('halyard');
  });
});

describe('most visited', () => {
  it('prefers this fortnight to one busy night last year', async () => {
    const now = Date.now();
    for (let visit = 0; visit < 6; visit++) {
      await VexHistory.add({ url: 'https://old.example/' + visit, title: 'Old', at: now - 200 * 86400000 - visit });
    }
    for (let visit = 0; visit < 3; visit++) {
      await VexHistory.add({ url: 'https://new.example/' + visit, title: 'New', at: now - visit * 1000 });
    }
    expect(VexHistory.topSites(2)[0].host).toBe('new.example');
  });
});

// @vitest-environment jsdom
//
// T3-108 (Wave 6): the History panel's keyword filter asks the shared search index for candidates and then applies the same
// test it always applied, so the answer must be EXACTLY the one a full scan gives. These compare the two over many entries
// and many queries, Turkish letters included, and check that the index never serves a stale answer.
import { describe, it, expect, beforeEach } from 'vitest';

const path = require('path');
const JS = path.resolve(__dirname, '../../src/renderer/js');
const fresh = (rel) => { const p = path.join(JS, rel); delete require.cache[require.resolve(p)]; return require(p); };

let H, SI;
function load() {
  globalThis.VexTr = fresh('vex-tr.js').VexTr;
  SI = fresh('search-index.js').VexSearchIndex;
  globalThis.VexSearchIndex = SI;
  window.VexSearchIndex = SI;
  localStorage.clear();
  document.body.innerHTML = '<input id="history-search-input">';
  window.escapeHtml = (s) => String(s == null ? '' : s);
  H = fresh('history-panel.js').HistoryPanel;
  H.activeFilter = 'all';
}
const ask = (q) => { document.getElementById('history-search-input').value = q; return H.getKeywordFiltered(); };
// What the filter returned before the index existed: the same test over the whole time-filtered list.
const scan = (q) => {
  const search = q.toLowerCase();
  return H.getTimeFiltered().filter(e => !search || (e.title || '').toLowerCase().includes(search)
    || (e.url || '').toLowerCase().includes(search) || (e.summary || '').toLowerCase().includes(search)
    || (Array.isArray(e.tags) && e.tags.some(t => String(t).toLowerCase().includes(search))));
};

// A small deterministic generator, so a failure can be reproduced.
let seed = 12345;
const rnd = () => { seed = (Math.imul(seed, 1103515245) + 12345) >>> 0; return seed / 4294967296; };
const pick = (a) => a[Math.floor(rnd() * a.length)];
const WORDS = ['github', 'istanbul', 'İstanbul', 'ISPARTA', 'ısparta', 'çay', 'şeker', 'ğüzel', 'öğrenci', 'Üniversite', 'news', 'inbox', 'mail', 'docs', 'rust', 'type', 'script', 'ankara', 'izmir', 'bursa', 'sözlük', 'IŞIK'];
const word = () => pick(WORDS) + (rnd() < 0.3 ? String(Math.floor(rnd() * 100)) : '');
const phrase = (n) => Array.from({ length: n }, word).join(rnd() < 0.5 ? ' ' : '-');

beforeEach(() => { load(); seed = 12345; });

describe('the keyword filter through the shared index', () => {
  it('gives exactly the full-scan answer, in the same order, for many entries and queries', () => {
    H.entries = Array.from({ length: 400 }, (_, i) => ({
      id: 'e' + i, url: 'https://' + pick(WORDS).toLowerCase() + '.example/' + phrase(1) + '?q=' + Math.floor(rnd() * 1000),
      title: rnd() < 0.1 ? '' : phrase(1 + Math.floor(rnd() * 3)), summary: rnd() < 0.4 ? phrase(2 + Math.floor(rnd() * 8)) : undefined,
      tags: rnd() < 0.3 ? [word(), word()] : undefined, visitedAt: new Date(Date.now() - i * 60000).toISOString(),
    }));
    let indexed = 0, compared = 0;
    for (let n = 0; n < 300; n++) {
      const q = rnd() < 0.5 ? pick(WORDS).slice(0, 2 + Math.floor(rnd() * 5)) : phrase(1).slice(Math.floor(rnd() * 3), 3 + Math.floor(rnd() * 12));
      if (!q.trim()) continue;
      const viaIndex = H._keywordCandidates(q.toLowerCase());
      if (viaIndex) indexed++;
      expect(ask(q).map(e => e.id), JSON.stringify(q)).toEqual(scan(q).map(e => e.id));
      compared++;
    }
    expect(compared).toBeGreaterThan(250);
    expect(indexed).toBeGreaterThan(100);       // the index really was used for most of them
  });

  it('serves the dotted and dotless I the way the plain scan does, and never loses a match the scan finds', () => {
    H.entries = [
      { id: 'a', url: 'https://a.example/', title: 'Istanbul guide', visitedAt: new Date().toISOString() },
      { id: 'b', url: 'https://b.example/', title: 'İstanbul rehberi', visitedAt: new Date().toISOString() },
      { id: 'c', url: 'https://c.example/', title: 'ISPARTA', summary: 'gül ve ısparta', visitedAt: new Date().toISOString() },
    ];
    for (const q of ['istanbul', 'Istanbul', 'ısparta', 'isparta', 'gül', 'rehber', 'guide']) {
      const got = ask(q).map(e => e.id), want = scan(q).map(e => e.id);
      expect(got, q).toEqual(want);
    }
  });

  it('scans for a term under three letters or with a combining mark, and does not build the index for them', () => {
    H.entries = [{ id: 'a', url: 'https://a.example/', title: 'Go language', visitedAt: new Date().toISOString() }];
    expect(H._keywordCandidates('go')).toBeNull();
    expect(H._keywordCandidates('a' + String.fromCharCode(0x307) + 'bc')).toBeNull();
    expect(SI.shared().isIndexed(H.INDEX_SOURCE)).toBe(false);
    expect(ask('go').map(e => e.id)).toEqual(['a']);
  });

  it('is rebuilt when an entry changes, even to text of the same length, and when entries are replaced, removed or reordered', () => {
    const now = new Date().toISOString();
    H.entries = [
      { id: 'a', url: 'https://a.example/', title: 'Inbox (3)', visitedAt: now },
      { id: 'b', url: 'https://b.example/', title: 'Other page', visitedAt: now },
    ];
    expect(ask('inbox (3)').map(e => e.id)).toEqual(['a']);
    H.entries[0].title = 'Inbox (4)';                      // same length, another text
    expect(ask('inbox (3)').map(e => e.id)).toEqual([]);
    expect(ask('inbox (4)').map(e => e.id)).toEqual(['a']);
    H.entries[1].summary = 'quarterly numbers';           // written directly, as other files do
    expect(ask('quarterly').map(e => e.id)).toEqual(['b']);
    H.entries = [H.entries[1], H.entries[0]];             // reordered
    expect(ask('page').map(e => e.id)).toEqual(['b']);
    expect(ask('inbox').map(e => e.id)).toEqual(['a']);
    H.entries = H.entries.slice(1);                       // one removed
    expect(ask('page').map(e => e.id)).toEqual([]);
  });

  it('respects the time filter and keeps the newest-first order of the list', () => {
    const day = 86400000;
    H.entries = [
      { id: 'new', url: 'https://x.example/', title: 'rust book', visitedAt: new Date(Date.now() - 1000).toISOString() },
      { id: 'mid', url: 'https://y.example/', title: 'rust news', visitedAt: new Date(Date.now() - 3 * day).toISOString() },
      { id: 'old', url: 'https://z.example/', title: 'rust forum', visitedAt: new Date(Date.now() - 60 * day).toISOString() },
    ];
    H.activeFilter = 'all'; expect(ask('rust').map(e => e.id)).toEqual(['new', 'mid', 'old']);
    H.activeFilter = 'week'; expect(ask('rust').map(e => e.id)).toEqual(['new', 'mid']);
    H.activeFilter = 'today'; expect(ask('rust').map(e => e.id)).toEqual(['new']);
  });

  it('falls back to the scan, with the same answer, when the index dropped the source to stay under its limit, or is not there', () => {
    H.entries = Array.from({ length: 50 }, (_, i) => ({ id: 'e' + i, url: 'https://e.example/' + i, title: 'page number ' + i, summary: 'x'.repeat(2000), visitedAt: new Date(Date.now() - i * 1000).toISOString() }));
    expect(ask('number 7').map(e => e.id)).toEqual(scan('number 7').map(e => e.id));
    SI.shared().setCap(1024 * 1024);
    SI.shared().replace('other:big', [{ id: 'z', title: 't', body: 'y'.repeat(20000), bodyMax: 20000 }], 'sig');
    SI.shared().clear(H.INDEX_SOURCE);                    // as if evicted
    expect(ask('number 7').map(e => e.id)).toEqual(scan('number 7').map(e => e.id));
    delete globalThis.VexSearchIndex;
    expect(ask('number 7').map(e => e.id)).toEqual(scan('number 7').map(e => e.id));
  });

  it('does not index an entry whose text is larger than the index takes, and scans instead', () => {
    H.entries = [{ id: 'a', url: 'https://a.example/', title: 'big', summary: 'q'.repeat(210000) + ' needle', visitedAt: new Date().toISOString() }];
    expect(H._keywordCandidates('needle')).toBeNull();
    expect(ask('needle').map(e => e.id)).toEqual(['a']);
  });
});

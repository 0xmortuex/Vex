// Unit coverage for the Recall search engine (src/main/recall-index.js).
//
// The engine is deliberately free of Electron so the ranking, tokenizing,
// pruning and snippeting rules can be pinned down here rather than only being
// observable by driving the app.

import { describe, it, expect } from 'vitest';

const { RecallIndex, tokenize, stem, parseQuery, snippet, hostMatches } =
  require('../../src/main/recall-index.js');

const pad = (words, n = 140) => {
  const out = [];
  for (let i = 0; i < n; i++) out.push(words[i % words.length]);
  return out.join(' ');
};

describe('tokenize / stem', () => {
  it('folds case and diacritics', () => {
    expect(tokenize('Résumé CAFÉ')).toEqual(tokenize('resume cafe'));
    expect(tokenize('  Hello,  World! ')).toEqual(tokenize('hello world'));
  });

  it('collapses plurals and common verb endings onto one key', () => {
    for (const family of [
      ['browser', 'browsers'],
      ['throttle', 'throttles', 'throttling', 'throttled'],
      ['index', 'indexes', 'indexed'],
      ['query', 'queries'],
      ['box', 'boxes'],
      ['search', 'searches', 'searching', 'searched'],
      ['filter', 'filters', 'filtering', 'filtered'],
    ]) {
      const keys = new Set(family.map(stem));
      expect([...keys], family.join('/')).toHaveLength(1);
    }
  });

  it('leaves short words, acronyms and vowel-less stems alone', () => {
    expect(stem('dns')).toBe('dns');
    expect(stem('css')).toBe('css');
    expect(stem('is')).toBe('is');
    expect(stem('string')).toBe('string');
    expect(stem('thing')).toBe('thing');
  });

  it('drops hash-like blobs instead of indexing them as words', () => {
    const long = 'a'.repeat(64);
    expect(tokenize('hello ' + long)).toEqual(['hello']);
  });
});

describe('parseQuery', () => {
  it('splits phrases, exclusions and field filters', () => {
    const q = parseQuery('"deep packet" throttling -advert site:Wikipedia.org');
    expect(q.phrases).toEqual(['deep packet']);
    expect(q.site).toBe('wikipedia.org');
    expect(q.excludes).toContain(stem('advert'));
    expect(q.terms.some(t => t.stem === stem('throttling'))).toBe(true);
  });

  it('marks only the trailing bare word as a prefix match', () => {
    const q = parseQuery('deep pack');
    expect(q.terms.map(t => t.prefix)).toEqual([false, true]);
    // A trailing space means the user finished the word.
    expect(parseQuery('deep pack ').terms.every(t => !t.prefix)).toBe(true);
  });

  it('understands relative after: offsets', () => {
    const q = parseQuery('notes after:7d');
    expect(q.since).toBeGreaterThan(Date.now() - 8 * 86400e3);
    expect(q.since).toBeLessThan(Date.now());
  });
});

describe('RecallIndex search', () => {
  const now = Date.now();
  const build = () => new RecallIndex([
    { url: 'https://en.wikipedia.org/wiki/Deep_packet_inspection', title: 'Deep packet inspection',
      text: 'Deep packet inspection is a form of packet filtering. ' + pad(['packet', 'inspection', 'network', 'filtering']), at: now - 86400e3 },
    { url: 'https://example.com/throttle', title: 'How ISPs throttle traffic',
      text: 'Throttling happens when a provider throttles your connection. ' + pad(['throttle', 'traffic', 'provider']), at: now - 2 * 86400e3 },
    { url: 'https://blog.example.com/cats', title: 'Concatenation in JavaScript',
      text: 'String concatenation concatenates values. ' + pad(['concatenate', 'string', 'value']), at: now - 30 * 86400e3 },
  ]);

  it('finds a page by a word from its body, not just its title', () => {
    const r = build().search('filtering');
    expect(r.hits[0].url).toContain('Deep_packet_inspection');
  });

  it('matches word stems, so "throttled" finds "throttling"', () => {
    expect(build().search('throttled').hits[0].url).toContain('example.com/throttle');
  });

  it('does NOT match a word fragment inside another word', () => {
    // The old substring scan scored "Concatenation" for the query "cat".
    const r = build().search('cat ', { prefixLastTerm: false });
    expect(r.hits.map(h => h.url)).not.toContain('https://blog.example.com/cats');
  });

  it('matches a prefix while the user is still typing the last word', () => {
    expect(build().search('throttl').hits.length).toBeGreaterThan(0);
    expect(build().search('inspec').hits[0].url).toContain('Deep_packet_inspection');
  });

  it('requires every term (AND), not any of them', () => {
    expect(build().search('packet zzzznotaword').total).toBe(0);
  });

  it('ranks a title hit above a body-only hit', () => {
    const idx = new RecallIndex([
      { url: 'https://a.test/', title: 'Nothing to see', text: 'widget ' + pad(['widget', 'filler']), at: now },
      { url: 'https://b.test/', title: 'The widget guide', text: pad(['guide', 'filler']) + ' widget', at: now },
    ]);
    expect(idx.search('widget').hits[0].url).toBe('https://b.test/');
  });

  it('honours quoted phrases', () => {
    const idx = build();
    expect(idx.search('"deep packet"').total).toBe(1);
    expect(idx.search('"packet deep"').total).toBe(0);
  });

  it('honours -exclusions and site: filters', () => {
    const idx = build();
    expect(idx.search('packet -filtering').total).toBe(0);
    expect(idx.search('site:example.com').total).toBe(2); // example.com + blog.example.com
    expect(idx.search('site:blog.example.com').total).toBe(1);
  });

  it('filters by date range and sorts on demand', () => {
    const idx = build();
    expect(idx.search('a', { since: now - 3 * 86400e3, prefixLastTerm: false }).hits
      .every(h => h.at >= now - 3 * 86400e3)).toBe(true);
    const newest = idx.search('e ', { sort: 'newest', prefixLastTerm: false }).hits;
    for (let i = 1; i < newest.length; i++) expect(newest[i - 1].at).toBeGreaterThanOrEqual(newest[i].at);
    const oldest = idx.search('e ', { sort: 'oldest', prefixLastTerm: false }).hits;
    for (let i = 1; i < oldest.length; i++) expect(oldest[i - 1].at).toBeLessThanOrEqual(oldest[i].at);
  });

  it('reports the true total and pages through it', () => {
    const idx = new RecallIndex(Array.from({ length: 30 }, (_, i) => ({
      url: 'https://n.test/' + i, title: 'Page ' + i, text: 'shared word here ' + pad(['shared', 'word']), at: now - i * 1000,
    })));
    const first = idx.search('shared', { limit: 10 });
    expect(first.total).toBe(30);
    expect(first.hits.length).toBe(10);
    const second = idx.search('shared', { limit: 10, offset: 10 });
    expect(second.hits.length).toBe(10);
    expect(second.hits[0].url).not.toBe(first.hits[0].url);
  });

  it('returns nothing for an empty query', () => {
    expect(build().search('').total).toBe(0);
    expect(build().search('   ').total).toBe(0);
  });
});

describe('RecallIndex maintenance', () => {
  it('replaces a page on re-index instead of duplicating it, keeping first-seen', () => {
    const idx = new RecallIndex();
    idx.put({ url: 'https://x.test/', title: 'v1', text: pad(['alpha']), at: 1000 });
    idx.put({ url: 'https://x.test/', title: 'v2', text: pad(['beta']), at: 2000 });
    expect(idx.size).toBe(1);
    expect(idx.records[0].title).toBe('v2');
    expect(idx.records[0].first).toBe(1000);
    expect(idx.records[0].visits).toBe(2);
    expect(idx.search('alpha').total).toBe(0);
    expect(idx.search('beta').total).toBe(1);
  });

  it('caps the index by record count, dropping the oldest', () => {
    const idx = new RecallIndex([], { maxRecords: 5 });
    for (let i = 0; i < 20; i++) idx.put({ url: 'https://c.test/' + i, title: 'p' + i, text: pad(['common', 'word' + i]), at: 1000 + i });
    expect(idx.size).toBe(5);
    expect(idx.search('common').total).toBe(5);
    expect(idx.search('word0').total).toBe(0);
    expect(idx.search('word19').total).toBe(1);
  });

  it('caps the index by stored bytes even when the record count is fine', () => {
    const idx = new RecallIndex([], { maxRecords: 1000, maxBytes: 4000 });
    for (let i = 0; i < 20; i++) idx.put({ url: 'https://b.test/' + i, title: 't', text: 'x'.repeat(1000) + ' word' + i, at: 1000 + i });
    expect(idx.bytes).toBeLessThanOrEqual(4000);
    expect(idx.size).toBeLessThan(20);
  });

  it('truncates page text to the configured cap', () => {
    const idx = new RecallIndex([], { maxTextChars: 500 });
    idx.put({ url: 'https://t.test/', title: 't', text: 'y'.repeat(9000) });
    expect(idx.records[0].text.length).toBe(500);
  });

  it('forgets a single page and a whole host (including subdomains)', () => {
    const idx = new RecallIndex();
    idx.put({ url: 'https://a.io/1', title: 'one', text: pad(['token']) });
    idx.put({ url: 'https://news.a.io/2', title: 'two', text: pad(['token']) });
    idx.put({ url: 'https://b.io/3', title: 'three', text: pad(['token']) });
    expect(idx.forget({ url: 'https://b.io/3' })).toBe(1);
    expect(idx.search('token').total).toBe(2);
    expect(idx.forget({ host: 'a.io' })).toBe(2);
    expect(idx.search('token').total).toBe(0);
    expect(idx.size).toBe(0);
  });

  it('stays correct when pages arrive after the first search (incremental path)', () => {
    const idx = new RecallIndex();
    idx.put({ url: 'https://i.test/1', title: 'one', text: pad(['alpha']) });
    expect(idx.search('alpha').total).toBe(1); // forces the deferred build
    idx.put({ url: 'https://i.test/2', title: 'two', text: pad(['alpha', 'beta']) });
    expect(idx.search('alpha').total).toBe(2);
    expect(idx.search('beta').total).toBe(1);
    idx.forget({ url: 'https://i.test/1' });
    expect(idx.search('alpha').total).toBe(1);
    idx.put({ url: 'https://i.test/2', title: 'two', text: pad(['gamma']) });
    expect(idx.search('beta').total).toBe(0);
    expect(idx.search('gamma').total).toBe(1);
  });

  it('clears everything, including the inverted index', () => {
    const idx = new RecallIndex();
    idx.put({ url: 'https://z.test/', title: 'z', text: pad(['zeta']) });
    idx.clear();
    expect(idx.size).toBe(0);
    expect(idx.search('zeta').total).toBe(0);
    expect(idx.stats().pages).toBe(0);
    expect(idx.stats().terms).toBe(0);
  });

  it('round-trips through toJSON without losing or duplicating anything', () => {
    const idx = new RecallIndex();
    for (let i = 0; i < 5; i++) idx.put({ url: 'https://r.test/' + i, title: 'r' + i, text: pad(['roundtrip', 'w' + i]), at: 1000 + i });
    const again = new RecallIndex(JSON.parse(JSON.stringify(idx.toJSON())));
    expect(again.size).toBe(5);
    expect(again.search('roundtrip').total).toBe(5);
    expect(again.records[0].url).toBe(idx.records[0].url);
    again.put({ url: 'https://r.test/0', title: 'again', text: pad(['roundtrip']) });
    expect(again.size).toBe(5);
  });

  it('reports honest stats', () => {
    const idx = new RecallIndex();
    idx.put({ url: 'https://s.test/a', title: 'a', text: pad(['stat']), at: 500 });
    idx.put({ url: 'https://s.test/b', title: 'b', text: pad(['stat']), at: 900 });
    const s = idx.stats();
    expect(s.pages).toBe(2);
    expect(s.oldest).toBe(500);
    expect(s.newest).toBe(900);
    expect(s.bytes).toBeGreaterThan(0);
    expect(s.hosts[0]).toEqual({ host: 's.test', count: 2 });
  });
});

describe('snippet', () => {
  it('centres on the matched words and marks them', () => {
    const text = 'Padding '.repeat(60) + 'the throttling behaviour of ISPs ' + 'tail '.repeat(60);
    const parts = snippet(text, ['throttling']);
    const marked = parts.filter(p => p[1]).map(p => p[0].toLowerCase());
    expect(marked).toContain('throttling');
    expect(parts.map(p => p[0]).join('')).toContain('behaviour');
  });

  it('prefers the window covering the most distinct query words', () => {
    const text = 'alpha ' + 'x '.repeat(300) + 'alpha beta gamma together here';
    const joined = snippet(text, ['alpha', 'beta', 'gamma']).map(p => p[0]).join('');
    expect(joined).toContain('together');
  });

  it('never highlights a fragment inside a longer unrelated word', () => {
    const text = 'Concatenation is not a cat. ' + 'filler '.repeat(40);
    const marked = snippet(text, ['cat']).filter(p => p[1]).map(p => p[0]);
    expect(marked).toEqual(['cat']);
  });

  it('returns plain text when nothing matches', () => {
    const parts = snippet('nothing relevant in here at all', ['zebra']);
    expect(parts.every(p => !p[1])).toBe(true);
  });

  it('keeps offsets aligned on text with accents and emoji', () => {
    const text = 'Voilà — a café ☕ serving throttling notes ' + 'filler '.repeat(40);
    const parts = snippet(text, ['throttling']);
    const joined = parts.map(p => p[0]).join('').replace(/…/g, '');
    expect(text).toContain(joined);
    expect(parts.filter(p => p[1]).map(p => p[0])).toEqual(['throttling']);
  });
});

describe('hostMatches', () => {
  it('matches a host and its subdomains only', () => {
    expect(hostMatches('en.wikipedia.org', 'wikipedia.org')).toBe(true);
    expect(hostMatches('wikipedia.org', 'wikipedia.org')).toBe(true);
    expect(hostMatches('notwikipedia.org', 'wikipedia.org')).toBe(false);
  });
});

describe('performance at scale', () => {
  it('searches a 3000-page index in a few milliseconds', () => {
    const vocab = ('alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu xi omicron pi rho sigma ' +
      'tau upsilon packet inspection throttling browser electron render index search recall memory storage network ' +
      'protocol encryption privacy tracker cookie session token header request response').split(' ');
    const records = [];
    for (let i = 0; i < 3000; i++) {
      const words = [];
      for (let k = 0; k < 900; k++) words.push(vocab[(i * 7 + k * 13) % vocab.length]);
      words.push('needle' + i);
      records.push({ url: 'https://perf.test/' + i, title: 'Perf page ' + i, text: words.join(' '), at: Date.now() - i * 1000 });
    }
    const t0 = Date.now();
    const idx = new RecallIndex(records);
    const buildMs = Date.now() - t0;

    const time = (fn) => { const s = Date.now(); for (let i = 0; i < 20; i++) fn(); return (Date.now() - s) / 20; };
    const rare = time(() => idx.search('needle1234'));
    const common = time(() => idx.search('packet inspection'));
    const miss = time(() => idx.search('zzzznotindexed'));

    expect(idx.size).toBe(3000);
    expect(idx.search('needle1234').total).toBe(1);
    // Very generous ceilings — CI machines are loaded and this is a regression
    // tripwire, not a benchmark. The scan-every-page engine this replaced was
    // already ~25 ms at 400 pages, so it would blow through these at 3000.
    expect(rare).toBeLessThan(120);
    expect(common).toBeLessThan(400);
    expect(miss).toBeLessThan(120);
    expect(buildMs).toBeLessThan(20000);
    if (process.env.RECALL_PERF) console.log({ buildMs, rare, common, miss });
  }, 60000);
});

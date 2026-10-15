// Knowledge base (src/main/knowledge-base.js): the tokenizer on a question,
// BM25 ranking, ranking by meaning with a fake embedder, incremental updates,
// the exclusion rules, the size cap, and that nothing but this PC is ever asked.
import { describe, expect, it, vi, afterEach } from 'vitest';

const kbm = require('../../src/main/knowledge-base.js');
const rv = require('../../src/main/recall-vectors.js');
const { KnowledgeBase, createKnowledgeService, toStems, parseWhen, fuse, KINDS } = kbm;
const { VectorStore, createOllamaEmbedder } = rv;

const DAY = 86400000;
const NOW = Date.UTC(2026, 9, 16);

// One axis per concept: cosine ranking is then exactly shared concepts, with
// no words in common required.
const CONCEPTS = [
  ['sourdough', 'starter', 'bread', 'loaf', 'yeast', 'flour', 'ferment'],
  ['gpu', 'graphics', 'driver', 'nvidia', 'vram', 'card'],
  ['tax', 'invoice', 'vat', 'accounting', 'receipt'],
  ['hiking', 'trail', 'mountain', 'summit', 'trek'],
];
function fakeVector(text) {
  const v = CONCEPTS.map(() => 0.001);
  for (const w of String(text).toLowerCase().split(/[^a-z]+/)) CONCEPTS.forEach((words, i) => { if (words.includes(w)) v[i] += 1; });
  return v;
}
function fakeEmbedder({ installed = ['nomic-embed-text:latest'] } = {}) {
  const calls = [];
  return {
    calls,
    installed: vi.fn(async () => installed),
    embed: vi.fn(async (base, model, text) => { calls.push({ base, model, text }); return fakeVector(text); }),
  };
}
const item = (id, kind, title, text, extra = {}) => ({ id, kind, title, text, at: NOW - 30 * DAY, ...extra });

function build(list, opts) {
  const kb = new KnowledgeBase(opts);
  for (const it of list) kb.put(it);
  return kb;
}

describe('the question tokenizer', () => {
  it('drops question words and time words and stems the rest', () => {
    expect(toStems('What did I read about throttling browsers last year?')).toEqual(['throttl', 'browser']);
    expect(toStems('the')).toEqual([]);
  });
  it('finds a time window in the question', () => {
    expect(parseWhen('what did I read about gpu drivers last year', NOW).since).toBe(NOW - 365 * DAY);
    expect(parseWhen('notes from the past 3 months', NOW).since).toBe(NOW - 90 * DAY);
    const y = parseWhen('things in 2024', NOW);
    expect(y.since).toBe(Date.UTC(2024, 0, 1));
    expect(y.until).toBe(Date.UTC(2025, 0, 1) - 1);
    expect(parseWhen('gpu drivers', NOW)).toBeNull();
  });
});

describe('keyword ranking (BM25 with stemming)', () => {
  const kb = build([
    item('note:1', 'note', 'Sourdough notes', 'My starter needs feeding every day. The loaf rose well with whole wheat flour.'),
    item('bookmark:2', 'bookmark', 'GPU driver release notes', 'Graphics driver update for the card fixes crashes.', { url: 'https://example.com/gpu' }),
    item('highlight:3', 'highlight', 'Trail guide', 'The summit trail takes four hours. Bring water.', { url: 'https://hike.example/trail' }),
    item('readlater:4', 'readlater', 'Why browsers throttle timers', 'Background tabs have their timers throttled to save power.', { url: 'https://example.org/timers' }),
  ]);
  it('answers a plain sentence, not only keywords', () => {
    const r = kb.searchKeywords('what did I read about throttling browsers', { now: NOW });
    expect(r.hits[0].id).toBe('readlater:4');
  });
  it('stems both sides: "loaves" would not, "loaf" and "feeding" do', () => {
    expect(kb.searchKeywords('feed the starter', { now: NOW }).hits[0].id).toBe('note:1');
  });
  it('ranks a title match above a passing mention', () => {
    const k = build([
      item('note:a', 'note', 'Recipes', 'a long list; one line mentions kubernetes once among many other words about food and cooking'),
      item('note:b', 'note', 'Kubernetes notes', 'short'),
    ]);
    expect(k.searchKeywords('kubernetes', { now: NOW }).hits[0].id).toBe('note:b');
  });
  it('applies the time window from the question', () => {
    const k = build([
      item('note:old', 'note', 'Old gpu note', 'gpu driver', { at: NOW - 800 * DAY }),
      item('note:new', 'note', 'New gpu note', 'gpu driver', { at: NOW - 20 * DAY }),
    ]);
    const r = k.searchKeywords('gpu driver last year', { now: NOW });
    expect(r.hits.map(h => h.id)).toEqual(['note:new']);
  });
  it('restricts to kinds', () => {
    expect(kb.searchKeywords('driver trail timers', { kinds: ['highlight'], now: NOW }).hits.map(h => h.id)).toEqual(['highlight:3']);
  });
  it('returns the passage that holds the words', () => {
    const long = 'Intro about nothing in particular. '.repeat(30) + 'The VAT invoice must list the supplier number. ' + 'More filler text here. '.repeat(30);
    const k = build([item('note:p', 'note', 'Accounting', long)]);
    expect(k.passages('note:p', toStems('vat invoice supplier'), 1)[0].text).toMatch(/VAT invoice/);
  });
});

describe('ranking by meaning (fake embedder)', () => {
  async function setup(list, embedderOpts) {
    const kb = build(list);
    const store = new VectorStore();
    const embedder = fakeEmbedder(embedderOpts);
    const svc = createKnowledgeService({ kb, store, embedder, minGapMs: 0, now: () => NOW });
    return { kb, store, embedder, svc };
  }
  const corpus = [
    item('note:1', 'note', 'Bread', 'Feeding the starter and baking a loaf with yeast and flour.'),
    item('note:2', 'note', 'Video card', 'Installing the nvidia driver and checking vram use.'),
    item('note:3', 'note', 'Accounting', 'Filing the vat invoice and the receipt.'),
  ];
  it('finds an item sharing no words with the question, by concept', async () => {
    const { svc } = await setup(corpus);
    await svc.step({ model: 'nomic-embed-text', batch: 5 });
    // "ferment" and "culture"-style words never appear in the note; the concept does.
    const r = await svc.search('ferment sourdough', { model: 'nomic-embed-text' });
    expect(r.mode).toBe('meaning');
    expect(r.hits[0].id).toBe('note:1');
    const g = await svc.search('graphics', { model: 'nomic-embed-text' });
    expect(g.hits[0].id).toBe('note:2');
    expect(g.hits[0].byMeaning).toBe(true);
  });
  it('says why meaning was not used and still answers by words', async () => {
    const { svc, embedder } = await setup(corpus);
    embedder.embed.mockRejectedValueOnce(new Error('Ollama is not running. Start Ollama to build the meaning index.'));
    await svc.step({ model: 'nomic-embed-text', batch: 5 }).catch(() => {});
    const { embedder: e2, svc: s2 } = await setup(corpus);
    await s2.step({ model: 'nomic-embed-text', batch: 5 });
    e2.embed.mockRejectedValue(new Error('Ollama is not running. Start Ollama to build the meaning index.'));
    const r = await s2.search('vat invoice', { model: 'nomic-embed-text' });
    expect(r.mode).toBe('keywords');
    expect(r.semanticError).toMatch(/not running/);
    expect(r.hits[0].id).toBe('note:3');
  });
  it('relates items by meaning, and by words when there is no vector', async () => {
    const { svc, kb } = await setup([...corpus, item('note:4', 'note', 'More baking', 'Sourdough bread, starter and yeast again.')]);
    expect(svc.related('note:1').how).toBe('words');
    await svc.step({ model: 'nomic-embed-text', batch: 8 });
    const r = svc.related('note:1', { limit: 2 });
    expect(r.how).toBe('meaning');
    expect(r.hits[0].id).toBe('note:4');
    expect(r.hits.some(h => h.id === 'note:1')).toBe(false);
    expect(kb.size).toBe(4);
  });
  it('is brief-ready: related to a page being read, leaving that page out', async () => {
    const { svc } = await setup([
      item('bookmark:1', 'bookmark', 'Sourdough starter guide', 'feeding a starter', { url: 'https://a.example/starter' }),
      item('bookmark:2', 'bookmark', 'Tax invoices', 'vat invoice rules', { url: 'https://b.example/tax' }),
    ]);
    const r = svc.relatedToPage({ title: 'My starter journal', url: 'https://c.example/j', text: 'Today the starter doubled. I fed the starter again.' });
    expect(r.hits.map(h => h.id)).toEqual(['bookmark:1']);
    const self = svc.relatedToPage({ title: 'Sourdough starter guide', url: 'https://a.example/starter', text: 'feeding a starter' });
    expect(self.hits.some(h => h.url === 'https://a.example/starter')).toBe(false);
  });
  it('fuses lists by reciprocal rank', () => {
    const f = fuse([[{ id: 'a' }, { id: 'b' }], [{ id: 'b' }, { id: 'c' }]]);
    expect(f[0].id).toBe('b');
  });
});

describe('incremental updates', () => {
  it('plans only what is new or changed, and what is gone', () => {
    const kb = build([item('note:1', 'note', 'One', 'alpha', { h: 'a' }), item('note:2', 'note', 'Two', 'beta', { h: 'b' }), item('bookmark:3', 'bookmark', 'B', '', { url: 'https://x.example/', h: 'c' })]);
    const plan = kb.plan([{ id: 'note:1', kind: 'note', h: 'a' }, { id: 'note:2', kind: 'note', h: 'CHANGED' }, { id: 'note:9', kind: 'note', h: 'n' }], ['note']);
    expect(plan.need.sort()).toEqual(['note:2', 'note:9']);
    expect(plan.gone).toEqual([]);
    const plan2 = kb.plan([{ id: 'note:1', kind: 'note', h: 'a' }], ['note']);
    expect(plan2.gone).toEqual(['note:2']);      // the note was deleted at its source
    expect(plan2.need).toEqual([]);
    // bookmarks were not covered by that plan: they are not "gone"
    expect(plan2.gone).not.toContain('bookmark:3');
  });
  it('re-indexes a changed item without leaving the old words behind', () => {
    const kb = build([item('note:1', 'note', 'Plan', 'we will use postgres for storage')]);
    expect(kb.searchKeywords('postgres', { now: NOW }).hits).toHaveLength(1);
    kb.put(item('note:1', 'note', 'Plan', 'we will use sqlite for storage'));
    expect(kb.size).toBe(1);
    expect(kb.searchKeywords('postgres', { now: NOW }).hits).toHaveLength(0);
    expect(kb.searchKeywords('sqlite', { now: NOW }).hits).toHaveLength(1);
    expect(kb.remove('note:1')).toBe(true);
    expect(kb.searchKeywords('sqlite', { now: NOW }).hits).toHaveLength(0);
    expect(kb.stats().terms).toBe(0);
  });
  it('embeds only items without a current vector', async () => {
    const kb = build([item('note:1', 'note', 'Bread', 'sourdough starter and yeast baking at home'), item('note:2', 'note', 'Cards', 'nvidia graphics driver and vram on the card')]);
    const embedder = fakeEmbedder();
    const svc = createKnowledgeService({ kb, store: new VectorStore(), embedder, minGapMs: 0 });
    await svc.step({ model: 'nomic-embed-text', batch: 8 });
    expect(embedder.embed).toHaveBeenCalledTimes(2);
    await svc.step({ model: 'nomic-embed-text', batch: 8 });
    expect(embedder.embed).toHaveBeenCalledTimes(2);          // nothing new
    kb.put(item('note:2', 'note', 'Cards', 'nvidia graphics driver changed again and vram on the card'));
    await svc.step({ model: 'nomic-embed-text', batch: 8 });
    expect(embedder.embed).toHaveBeenCalledTimes(3);          // only the changed one
    kb.remove('note:1');
    await svc.step({ model: 'nomic-embed-text', batch: 8 });
    expect(svc.counts().vectors).toBe(1);                      // the removed item's numbers went too
  });
  it('waits while a game runs or battery saving is on, unless asked by hand', async () => {
    const kb = build([item('note:1', 'note', 'Bread', 'sourdough starter and yeast baking at home')]);
    const embedder = fakeEmbedder();
    let why = 'a game is running';
    const svc = createKnowledgeService({ kb, store: new VectorStore(), embedder, minGapMs: 0, isHeld: () => why });
    const held = await svc.step({ model: 'nomic-embed-text' });
    expect(held.state).toBe('held');
    expect(held.message).toMatch(/game/);
    expect(embedder.embed).not.toHaveBeenCalled();
    why = '';
    expect((await svc.step({ model: 'nomic-embed-text' })).embedded).toBe(1);
  });
  it('round-trips through its file and distrusts a bad one', () => {
    const kb = build([item('note:1', 'note', 'One', 'alpha text here')]);
    kb.markPrivate('note:9');
    const copy = KnowledgeBase.fromJSON(JSON.parse(JSON.stringify(kb.toJSON())));
    expect(copy.size).toBe(1);
    expect(copy.isPrivate('note:9')).toBe(true);
    expect(() => KnowledgeBase.fromJSON({ version: 99, items: [] })).toThrow(/version/);
    expect(() => KnowledgeBase.fromJSON({ version: 1, items: [{ id: 5 }] })).toThrow(/bad item/);
  });
});

describe('what is never indexed', () => {
  const base = { kind: 'bookmark', title: 'T', text: 'something worth keeping in a bookmark', at: NOW };
  it('refuses private, Tor, routed and container tabs', () => {
    const kb = new KnowledgeBase();
    expect(kb.put({ ...base, id: 'bookmark:1', url: 'https://a.example/', private: true }).ok).toBe(false);
    expect(kb.put({ ...base, id: 'bookmark:2', url: 'https://a.example/', partition: 'private-1234' }).reason).toMatch(/private or Tor/);
    expect(kb.put({ ...base, id: 'bookmark:3', url: 'https://a.example/', partition: 'persist:route-tor-1' }).reason).toMatch(/routed/);
    expect(kb.put({ ...base, id: 'bookmark:4', url: 'https://a.example/', partition: 'persist:container-tor-work' }).reason).toMatch(/routed/);
    expect(kb.put({ ...base, id: 'bookmark:5', url: 'https://a.example/', partition: 'persist:container-work' }).ok).toBe(false);
    expect(kb.put({ ...base, id: 'bookmark:6', url: 'https://a.example/', partition: 'persist:container-work', routed: false }).ok).toBe(true);
    expect(kb.put({ ...base, id: 'bookmark:7', url: 'https://a.example/', partition: 'persist:main' }).ok).toBe(true);
    expect(kb.size).toBe(2);
  });
  it('refuses sites on the exclusion list (and their subdomains) and sign-in or bank pages', () => {
    const kb = new KnowledgeBase();
    const o = { excludedHosts: ['example.com'] };
    expect(kb.put({ ...base, id: 'bookmark:1', url: 'https://www.example.com/a' }, o).ok).toBe(false);
    expect(kb.put({ ...base, id: 'bookmark:2', url: 'https://docs.example.com/a' }, o).ok).toBe(false);
    expect(kb.put({ ...base, id: 'bookmark:3', url: 'https://example.org/a' }, o).ok).toBe(true);
    expect(kb.put({ ...base, id: 'bookmark:4', url: 'https://mybank.example/accounts' }).ok).toBe(false);
    expect(kb.put({ ...base, id: 'bookmark:5', url: 'https://x.example/login?next=/' }).ok).toBe(false);
    expect(kb.put({ ...base, id: 'bookmark:6', url: 'https://x.example/page?token=abc' }).reason).toMatch(/never indexed/);
    expect(kb.put({ ...base, id: 'bookmark:7', url: 'file:///C:/secret.txt' }).ok).toBe(false);
    expect(kb.size).toBe(1);
  });
  it('removes an item that later becomes refused, and drops hosts added to the list afterwards', () => {
    const kb = new KnowledgeBase();
    kb.put({ ...base, id: 'bookmark:1', url: 'https://news.example/a' });
    kb.put({ ...base, id: 'bookmark:2', url: 'https://keep.example/a' });
    expect(kb.put({ ...base, id: 'bookmark:1', url: 'https://news.example/a', private: true }).ok).toBe(false);
    expect(kb.has('bookmark:1')).toBe(false);
    kb.put({ ...base, id: 'bookmark:3', url: 'https://news.example/b' });
    expect(kb.dropHosts(['news.example'])).toBe(1);
    expect(kb.items().map(i => i.id)).toEqual(['bookmark:2']);
  });
  it('keeps what the person marked private out, across Forget and a reload', () => {
    const kb = new KnowledgeBase();
    kb.put({ ...base, id: 'note:1', kind: 'note', url: '' });
    expect(kb.markPrivate('note:1')).toBe(true);
    expect(kb.has('note:1')).toBe(false);
    expect(kb.put({ ...base, id: 'note:1', kind: 'note', url: '' }).reason).toMatch(/kept out/);
    kb.clear();
    expect(kb.isPrivate('note:1')).toBe(true);
    const copy = KnowledgeBase.fromJSON(kb.toJSON());
    expect(copy.put({ ...base, id: 'note:1', kind: 'note', url: '' }).ok).toBe(false);
    expect(kb.markPrivate('note:1', false)).toBe(true);
    expect(kb.put({ ...base, id: 'note:1', kind: 'note', url: '' }).ok).toBe(true);
  });
  it('never plans a kept-out item as needed', () => {
    const kb = new KnowledgeBase();
    kb.markPrivate('note:1');
    expect(kb.plan([{ id: 'note:1', kind: 'note', h: 'x' }], ['note']).need).toEqual([]);
  });
  it('ignores unknown kinds', () => {
    expect(new KnowledgeBase().put({ id: 'x:1', kind: 'clipboard', title: 'T', text: 'text' }).ok).toBe(false);
    expect(KINDS).not.toContain('clipboard');
  });
});

describe('the size cap', () => {
  it('keeps at most maxItems and drops the oldest first, and says how many', () => {
    const kb = new KnowledgeBase({ maxItems: 50 });
    for (let i = 0; i < 120; i++) kb.put({ id: 'note:' + i, kind: 'note', title: 'N' + i, text: 'word' + i + ' filler text', at: NOW - (120 - i) * DAY });
    expect(kb.size).toBe(50);
    expect(kb.has('note:0')).toBe(false);
    expect(kb.has('note:119')).toBe(true);
    expect(kb.stats().evicted).toBe(70);
    expect(kb.searchKeywords('word0', { now: NOW }).hits).toHaveLength(0);
  });
  it('keeps text under maxBytes and trims each item to maxTextChars', () => {
    const kb = new KnowledgeBase({ maxBytes: 5000, maxTextChars: 400 });
    for (let i = 0; i < 40; i++) kb.put({ id: 'note:' + i, kind: 'note', title: 'T', text: 'x'.repeat(2000), at: NOW - (40 - i) * DAY });
    expect(kb.get('note:39').text.length).toBe(400);
    expect(kb.bytes).toBeLessThanOrEqual(5000);
    expect(kb.size).toBeGreaterThan(0);
  });
  it('reports a size that includes the meaning numbers', async () => {
    const kb = build([item('note:1', 'note', 'Bread', 'sourdough starter and yeast baking at home')]);
    const svc = createKnowledgeService({ kb, store: new VectorStore(), embedder: fakeEmbedder(), minGapMs: 0 });
    await svc.step({ model: 'nomic-embed-text' });
    const s = await svc.status({ model: 'nomic-embed-text' });
    expect(s.sizeBytes).toBeGreaterThan(s.bytes);
    expect(s.mode).toBe('meaning');
    const off = await svc.status({});
    expect(off.state).toBe('keywords');
    expect(off.message).toMatch(/keyword/i);
  });
});

describe('nothing leaves this PC', () => {
  const realFetch = globalThis.fetch;
  afterEach(() => { globalThis.fetch = realFetch; });

  it('every request the embedder makes goes to 127.0.0.1', async () => {
    const urls = [];
    const fetchImpl = vi.fn(async (url, init) => {
      urls.push(String(url));
      if (String(url).endsWith('/api/tags')) return { ok: true, status: 200, json: async () => ({ models: [{ name: 'nomic-embed-text:latest' }] }) };
      return { ok: true, status: 200, json: async () => ({ embeddings: [fakeVector(JSON.parse(init.body).input)] }), text: async () => '' };
    });
    const kb = build([item('note:1', 'note', 'Bread', 'sourdough starter and yeast baking at home'), item('note:2', 'note', 'Cards', 'nvidia graphics driver and vram on the card')]);
    const svc = createKnowledgeService({ kb, store: new VectorStore(), embedder: createOllamaEmbedder({ fetchImpl }), minGapMs: 0 });
    await svc.step({ model: 'nomic-embed-text', baseUrl: 'http://localhost:11434', batch: 8 });
    await svc.search('graphics card', { model: 'nomic-embed-text', baseUrl: 'http://localhost:11434' });
    await svc.status({ model: 'nomic-embed-text', baseUrl: 'http://localhost:11434' });
    expect(urls.length).toBeGreaterThan(3);
    for (const u of urls) expect(new URL(u).hostname).toBe('127.0.0.1');
  });

  it('refuses an address that is not this PC before sending a byte', async () => {
    const fetchImpl = vi.fn();
    const kb = build([item('note:1', 'note', 'Bread', 'sourdough starter and yeast baking at home')]);
    const svc = createKnowledgeService({ kb, store: new VectorStore(), embedder: createOllamaEmbedder({ fetchImpl }), minGapMs: 0 });
    await expect(svc.step({ model: 'nomic-embed-text', baseUrl: 'http://192.168.1.20:11434' })).rejects.toThrow(/only talks to Ollama on this PC/);
    await expect(svc.search('bread', { model: 'nomic-embed-text', baseUrl: 'https://api.example.com' })).rejects.toThrow();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('keyword search, planning, related and context make no network call at all', async () => {
    globalThis.fetch = vi.fn(() => { throw new Error('network used'); });
    const kb = build([item('note:1', 'note', 'Bread', 'sourdough starter and yeast baking at home'), item('bookmark:2', 'bookmark', 'Cards', 'nvidia driver', { url: 'https://a.example/' })]);
    const svc = createKnowledgeService({ kb, store: new VectorStore(), embedder: createOllamaEmbedder({ fetchImpl: globalThis.fetch }), minGapMs: 0 });
    const r = await svc.search('sourdough bread', {});
    expect(r.hits[0].id).toBe('note:1');
    expect(svc.related('note:1').how).toBe('words');
    expect((await svc.context('nvidia', {})).sources[0].url).toBe('https://a.example/');
    kb.plan([], []);
    await svc.status({});
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('the module never requires a network library', () => {
    const fs = require('node:fs');
    for (const f of ['knowledge-base.js', 'knowledge-ipc.js']) {
      const src = fs.readFileSync(require('node:path').join(__dirname, '../../src/main', f), 'utf8');
      expect(src).not.toMatch(/require\(['"](?:https?|net|dgram|node-fetch|electron)['"]\)/);
      expect(src).not.toMatch(/\bfetch\(/);
    }
  });
});

// Recall by meaning (src/main/recall-vectors.js): the vector store's bounds
// and invalidation, cosine ranking, exclusion/forget propagation, batching and
// idle gating, and that page text can only ever go to this PC.
import { describe, expect, it, vi } from 'vitest';
import http from 'node:http';

const rv = require('../../src/main/recall-vectors.js');
const { RecallIndex } = require('../../src/main/recall-index.js');
const { VectorStore, createMeaningIndex, createOllamaEmbedder, loopbackBase } = rv;

// A tiny deterministic "model": each concept owns one axis, so ranking by
// cosine is exactly ranking by shared concepts, with no words in common.
const CONCEPTS = [
  ['sourdough', 'starter', 'bread', 'culture', 'loaf', 'yeast', 'flour', 'ferment'],
  ['gpu', 'graphics', 'driver', 'nvidia', 'vram', 'card'],
  ['tax', 'invoice', 'vat', 'accounting', 'receipt'],
  ['hiking', 'trail', 'mountain', 'summit', 'trek'],
];
function fakeVector(text) {
  const v = CONCEPTS.map(() => 0.001);
  for (const w of String(text).toLowerCase().split(/[^a-z]+/)) {
    CONCEPTS.forEach((words, i) => { if (words.includes(w)) v[i] += 1; });
  }
  return v;
}
function fakeEmbedder({ installed = ['nomic-embed-text:latest'], dim = CONCEPTS.length } = {}) {
  const calls = [];
  return {
    calls,
    installed: vi.fn(async () => installed),
    embed: vi.fn(async (base, model, text) => { calls.push({ base, model, text }); return fakeVector(text).slice(0, dim); }),
  };
}

const long = (s) => (s + ' ').repeat(12);
function makeRecords(list) {
  return new RecallIndex(list.map((r, i) => ({ url: r.url, title: r.title || '', text: long(r.text), at: 1000 + i })));
}
function setup(list, embedderOpts, extra = {}) {
  const recall = makeRecords(list);
  const store = new VectorStore();
  const embedder = fakeEmbedder(embedderOpts);
  let clock = 1_000_000;
  const changed = vi.fn();
  const meaning = createMeaningIndex({
    store, embedder, now: () => clock, onChange: changed, minGapMs: 20000,
    records: () => recall.records, get: (u) => recall.get(u), ...extra,
  });
  return { recall, store, embedder, meaning, changed, tick: (ms) => { clock += ms; } };
}

const PAGES = [
  { url: 'https://bakery.example/starter', title: 'Feeding your starter', text: 'flour water yeast ferment bread' },
  { url: 'https://news.example/gpu', title: 'Driver update', text: 'nvidia graphics driver vram card' },
  { url: 'https://money.example/vat', title: 'VAT guide', text: 'tax invoice vat accounting receipt' },
  { url: 'https://trails.example/summit', title: 'Summit day', text: 'hiking trail mountain summit trek' },
];
const args = { model: 'nomic-embed-text', baseUrl: 'http://127.0.0.1:11434' };

describe('only this PC is ever asked', () => {
  it('accepts 127.0.0.1, localhost and ::1 and asks by number', () => {
    expect(loopbackBase('http://127.0.0.1:11434')).toBe('http://127.0.0.1:11434');
    expect(loopbackBase('http://localhost:11434/')).toBe('http://127.0.0.1:11434');
    expect(loopbackBase('http://[::1]:9999')).toBe('http://[::1]:9999');
    expect(loopbackBase(undefined)).toBe('http://127.0.0.1:11434');
  });

  it.each([
    'https://api.openai.com',
    'http://192.168.1.20:11434',
    'http://10.0.0.5:11434',
    'http://127.0.0.1.evil.com:11434',
    'http://evil.localhost:11434',
    'http://user:pw@127.0.0.1:11434',
    'https://127.0.0.1:11434',
    'ftp://127.0.0.1',
    'not a url',
    'http://127.0.0.1:11434/some/path',
  ])('refuses %s', (url) => {
    expect(() => loopbackBase(url)).toThrow();
  });

  it('makes no request at all for a non-loopback address', async () => {
    const fetchImpl = vi.fn();
    const embedder = createOllamaEmbedder({ fetchImpl });
    await expect(embedder.embed('http://example.com:11434', 'nomic-embed-text', 'secret page text')).rejects.toThrow(/this PC/);
    await expect(embedder.installed('http://203.0.113.9:11434')).rejects.toThrow(/this PC/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('sends only to loopback URLs, /api/embed first and /api/embeddings on a 404', async () => {
    const urls = [];
    const fetchImpl = vi.fn(async (url, init) => {
      urls.push(url);
      if (url.endsWith('/api/embed')) return { ok: false, status: 404, text: async () => 'page not found' };
      return { ok: true, status: 200, json: async () => ({ embedding: [0.1, 0.2, 0.3] }) };
    });
    const v = await createOllamaEmbedder({ fetchImpl }).embed('http://localhost:11434', 'nomic-embed-text', 'hello');
    expect(v).toEqual([0.1, 0.2, 0.3]);
    expect(urls).toEqual(['http://127.0.0.1:11434/api/embed', 'http://127.0.0.1:11434/api/embeddings']);
    expect(JSON.parse(fetchImpl.mock.calls[1][1].body)).toEqual({ model: 'nomic-embed-text', prompt: 'hello' });
  });

  it('says a missing model, not a missing route', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 404, text: async () => '{"error":"model \\"x\\" not found, try pulling it first"}' }));
    await expect(createOllamaEmbedder({ fetchImpl }).embed(undefined, 'x', 'hi')).rejects.toThrow(/ollama pull x/);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('says Ollama is not running when the connection is refused', async () => {
    const fetchImpl = vi.fn(async () => { throw new TypeError('fetch failed'); });
    await expect(createOllamaEmbedder({ fetchImpl }).installed()).rejects.toThrow(/Ollama is not running/);
  });
});

describe('vector store bounds and invalidation', () => {
  it('evicts the oldest vectors past the count cap', () => {
    const s = new VectorStore({ maxVectors: 3 });
    s.useModel('m');
    for (let i = 0; i < 5; i++) s.put('https://a.example/' + i, 'h', [1, i + 1, 0.5]);
    expect(s.size).toBe(3);
    expect(s.has('https://a.example/0')).toBe(false);
    expect(s.has('https://a.example/1')).toBe(false);
    expect(s.has('https://a.example/4')).toBe(true);
  });

  it('holds a hard byte budget too', () => {
    const s = new VectorStore({ maxVectors: 5000, maxBytes: 10 * (100 + 48) });
    s.useModel('m');
    const v = Array.from({ length: 100 }, (_, i) => i + 1);
    for (let i = 0; i < 40; i++) s.put('https://a.example/' + i, 'h', v);
    expect(s.size).toBe(10);
    expect(s.bytes).toBeLessThanOrEqual(10 * 148);
  });

  it('empties itself when the model changes, and not when it stays', () => {
    const s = new VectorStore();
    expect(s.useModel('a')).toBe(false);
    s.put('https://a.example/', 'h', [1, 2, 3]);
    expect(s.useModel('a')).toBe(false);
    expect(s.size).toBe(1);
    expect(s.useModel('b')).toBe(true);
    expect(s.size).toBe(0);
    expect(s.dim).toBe(0);
  });

  it('refuses a vector of another length instead of mixing them', () => {
    const s = new VectorStore();
    s.useModel('m');
    s.put('https://a.example/', 'h', [1, 2, 3]);
    expect(() => s.put('https://b.example/', 'h', [1, 2])).toThrow(/returned 2/);
    expect(() => s.put('https://b.example/', 'h', [])).toThrow();
    expect(() => s.put('https://b.example/', 'h', [0, 0, 0])).toThrow(/zeros/);
    expect(() => s.put('https://b.example/', 'h', [1, NaN, 0])).toThrow(/not a number/);
  });

  it('round-trips through JSON with the model and length recorded', () => {
    const s = new VectorStore();
    s.useModel('nomic-embed-text');
    s.put('https://a.example/', 'h1', [0.1, 0.9, -0.4]);
    s.put('https://b.example/', 'h2', [0.9, 0.1, 0.4]);
    const json = JSON.parse(JSON.stringify(s.toJSON()));
    expect(json.model).toBe('nomic-embed-text');
    expect(json.dim).toBe(3);
    const back = VectorStore.fromJSON(json);
    expect(back.size).toBe(2);
    expect(back.model).toBe('nomic-embed-text');
    expect(back.search([0.1, 0.9, -0.4], { min: 0 })[0].url).toBe('https://a.example/');
  });

  it('refuses a damaged file instead of loading half of it', () => {
    expect(() => VectorStore.fromJSON(null)).toThrow();
    expect(() => VectorStore.fromJSON({ version: 99, model: 'm', dim: 3, entries: [] })).toThrow();
    expect(() => VectorStore.fromJSON({ version: 1, model: 'm', dim: 3, entries: [{ u: 'x', h: 'h', v: Buffer.from([1, 2]).toString('base64') }] })).toThrow(/length/);
    expect(() => VectorStore.fromJSON({ version: 1, model: 'm', dim: 999999, entries: [] })).toThrow();
  });

  it('applies the caps to a file that holds more than they allow', () => {
    const s = new VectorStore();
    s.useModel('m');
    for (let i = 0; i < 6; i++) s.put('https://a.example/' + i, 'h', [1, i + 1, 2]);
    const back = VectorStore.fromJSON(JSON.parse(JSON.stringify(s.toJSON())), { maxVectors: 2 });
    expect(back.size).toBe(2);
    expect(back.has('https://a.example/5')).toBe(true);
  });
});

describe('ranking by meaning', () => {
  it('finds the page with no words in common with the question', async () => {
    const t = setup(PAGES);
    await t.meaning.step({ ...args, batch: 8 });
    expect(t.store.size).toBe(4);
    const res = await t.meaning.search('keeping the culture of my loaf alive', args);
    expect(res.hits[0].url).toBe('https://bakery.example/starter');
    expect(res.hits[0].score).toBeGreaterThan(0.9);
    // the other three are unrelated: below the floor, not listed
    expect(res.hits.map(h => h.url)).toEqual(['https://bakery.example/starter']);
  });

  it('puts the closer concept first and caps the list', async () => {
    const pages = [
      { url: 'https://a.example/1', text: 'bread flour gpu' },
      { url: 'https://a.example/2', text: 'bread flour yeast starter' },
      { url: 'https://a.example/3', text: 'tax invoice' },
    ];
    const t = setup(pages);
    await t.meaning.step({ ...args, batch: 8 });
    const res = await t.meaning.search('sourdough starter yeast', { ...args, limit: 1 });
    expect(res.hits).toHaveLength(1);
    expect(res.hits[0].url).toBe('https://a.example/2');
  });

  it('never returns a page Recall no longer holds', async () => {
    const t = setup(PAGES);
    await t.meaning.step({ ...args, batch: 8 });
    t.recall.forget({ url: 'https://bakery.example/starter' });
    const res = await t.meaning.search('sourdough starter', args);
    expect(res.hits.some(h => h.url === 'https://bakery.example/starter')).toBe(false);
  });

  it('uses the document and query prefixes nomic-embed-text was trained with', async () => {
    const t = setup(PAGES);
    await t.meaning.step({ ...args, batch: 1 });
    expect(t.embedder.calls[0].text.startsWith('search_document: ')).toBe(true);
    await t.meaning.search('hello', args);
    expect(t.embedder.calls.at(-1).text).toBe('search_query: hello');
  });

  it('embeds the title and at most the first 2000 characters of the text Recall holds', async () => {
    const t = setup([{ url: 'https://a.example/', title: 'A title', text: 'x'.repeat(9000) }]);
    await t.meaning.step({ ...args, batch: 1 });
    const sent = t.embedder.calls[0].text.replace('search_document: ', '');
    expect(sent.startsWith('A title\n')).toBe(true);
    expect(sent.length).toBeLessThanOrEqual(rv.TEXT_CHARS + 'A title\n'.length);
  });
});

describe('exclusion and forget propagate', () => {
  it('never embeds an excluded site, subdomains included', async () => {
    const t = setup([
      ...PAGES,
      { url: 'https://news.bank.example/statement', text: 'tax invoice receipt accounting' },
    ]);
    await t.meaning.step({ ...args, excluded: ['bank.example'], batch: 8 });
    expect(t.store.has('https://news.bank.example/statement')).toBe(false);
    expect(t.embedder.calls.some(c => c.text.includes('statement'))).toBe(false);
    expect(t.store.size).toBe(4);
  });

  it('drops the vectors of a site excluded after they were built', async () => {
    const t = setup(PAGES);
    await t.meaning.step({ ...args, batch: 8 });
    expect(t.store.has('https://money.example/vat')).toBe(true);
    t.tick(30000);
    await t.meaning.step({ ...args, excluded: ['money.example'] });
    expect(t.store.has('https://money.example/vat')).toBe(false);
    const res = await t.meaning.search('tax invoice', { ...args, excluded: ['money.example'] });
    expect(res.hits).toEqual([]);
  });

  it('drops a page removed from Recall at the next step', async () => {
    const t = setup(PAGES);
    await t.meaning.step({ ...args, batch: 8 });
    t.recall.forget({ host: 'trails.example' });
    t.tick(30000);
    await t.meaning.step(args);
    expect(t.store.has('https://trails.example/summit')).toBe(false);
    expect(t.store.size).toBe(3);
  });

  it('forget empties the store and the model so nothing rebuilds by itself', async () => {
    const t = setup(PAGES);
    await t.meaning.step({ ...args, batch: 8 });
    expect(t.meaning.forget()).toBe(4);
    expect(t.store.size).toBe(0);
    expect(t.store.model).toBe('');
    const s = await t.meaning.status({});
    expect(s.state).toBe('off');
  });

  it('VectorStore.remove / removeHost take the vectors of a forgotten page or site', () => {
    const s = new VectorStore();
    s.useModel('m');
    s.put('https://a.example/1', 'h', [1, 2]);
    s.put('https://www.a.example/2', 'h', [1, 3]);
    s.put('https://sub.a.example/3', 'h', [2, 1]);
    s.put('https://b.example/', 'h', [3, 1]);
    expect(s.remove('https://a.example/1')).toBe(true);
    expect(s.removeHost('a.example')).toBe(2);
    expect(s.size).toBe(1);
  });
});

describe('batching and idle gating', () => {
  it('embeds at most the batch per step, newest page first', async () => {
    const pages = Array.from({ length: 12 }, (_, i) => ({ url: 'https://a.example/' + i, text: 'bread flour ' + i }));
    const t = setup(pages);
    const r = await t.meaning.step({ ...args, batch: 5 });
    expect(r.embedded).toBe(5);
    expect(r.pending).toBe(7);
    expect(r.understood).toBe(5);
    // Recall.records is newest first; the newest page was embedded first
    expect(t.embedder.calls[0].text).toContain('bread flour 0');
  });

  it('caps the batch no matter what the caller asks for', async () => {
    const pages = Array.from({ length: 30 }, (_, i) => ({ url: 'https://a.example/' + i, text: 'bread ' + i }));
    const t = setup(pages);
    const r = await t.meaning.step({ ...args, batch: 20 });
    expect(r.embedded).toBe(8);
  });

  it('does nothing when asked again too soon, and again when the gap has passed', async () => {
    const pages = Array.from({ length: 12 }, (_, i) => ({ url: 'https://a.example/' + i, text: 'bread ' + i }));
    const t = setup(pages);
    await t.meaning.step({ ...args, batch: 3 });
    const soon = await t.meaning.step({ ...args, batch: 3 });
    expect(soon.skipped).toBe(true);
    expect(t.store.size).toBe(3);
    t.tick(21000);
    await t.meaning.step({ ...args, batch: 3 });
    expect(t.store.size).toBe(6);
  });

  it('does not embed the same page twice, and re-embeds a page whose text changed', async () => {
    const t = setup(PAGES);
    await t.meaning.step({ ...args, batch: 8 });
    const first = t.embedder.embed.mock.calls.length;
    t.tick(30000);
    await t.meaning.step({ ...args, batch: 8 });
    expect(t.embedder.embed.mock.calls.length).toBe(first);
    t.recall.put({ url: 'https://money.example/vat', title: 'VAT guide', text: long('a completely new text about tax and invoice rules') });
    t.tick(30000);
    await t.meaning.step({ ...args, batch: 8 });
    expect(t.embedder.embed.mock.calls.length).toBe(first + 1);
  });

  it('is off for a model that has not been named', async () => {
    const t = setup(PAGES);
    await expect(t.meaning.step({ baseUrl: args.baseUrl })).rejects.toThrow(/embedding model/);
    expect(t.embedder.embed).not.toHaveBeenCalled();
  });
});

describe('honest status', () => {
  it('says Ollama is not running', async () => {
    const t = setup(PAGES);
    t.embedder.installed = vi.fn(async () => { throw new Error('Ollama is not running. Start Ollama to build the meaning index.'); });
    const r = await t.meaning.step({ ...args });
    expect(r.ok).toBe(false);
    expect(r.state).toBe('ollama-down');
    const s = await t.meaning.status(args);
    expect(s.state).toBe('ollama-down');
    expect(s.message).toMatch(/not running/);
  });

  it('says the model is not installed and how to get it', async () => {
    const t = setup(PAGES, { installed: ['llama3:latest'] });
    const r = await t.meaning.step(args);
    expect(r.state).toBe('model-missing');
    expect(r.message).toBe('Model not installed. Run: ollama pull nomic-embed-text');
    expect(t.store.size).toBe(0);
  });

  it('reports progress as understood of total pages', async () => {
    const pages = Array.from({ length: 10 }, (_, i) => ({ url: 'https://a.example/' + i, text: 'bread ' + i }));
    const t = setup(pages);
    await t.meaning.step({ ...args, batch: 4 });
    const s = await t.meaning.status(args);
    expect(s.understood).toBe(4);
    expect(s.pages).toBe(10);
    expect(s.pending).toBe(6);
    expect(s.state).toBe('building');
    expect(s.dim).toBe(4);
  });

  it('keeps what was embedded when a later page fails, and says why', async () => {
    const t = setup(PAGES);
    let n = 0;
    t.embedder.embed = vi.fn(async (b, m, text) => { if (++n === 3) throw new Error('Ollama did not answer in 30 seconds.'); return fakeVector(text); });
    const r = await t.meaning.step({ ...args, batch: 8 });
    expect(r.ok).toBe(false);
    expect(r.embedded).toBe(2);
    expect(t.store.size).toBe(2);
    expect(r.state).toBe('ollama-down');
  });

  it('changing the model empties the vectors before anything is searched', async () => {
    const t = setup(PAGES);
    await t.meaning.step({ ...args, batch: 8 });
    expect(t.store.size).toBe(4);
    t.tick(30000);
    t.embedder.installed = vi.fn(async () => ['mxbai-embed-large:latest']);
    const r = await t.meaning.step({ model: 'mxbai-embed-large', baseUrl: args.baseUrl, batch: 1 });
    expect(t.store.model).toBe('mxbai-embed-large');
    expect(t.store.size).toBe(1);
    expect(r.embedded).toBe(1);
  });
});

describe('against a stub embeddings server on 127.0.0.1', () => {
  it('builds, ranks and forgets over real HTTP, and sends nothing elsewhere', async () => {
    const seen = [];
    const server = http.createServer((req, res) => {
      let body = '';
      req.on('data', c => { body += c; });
      req.on('end', () => {
        seen.push({ method: req.method, url: req.url, host: req.headers.host, body });
        res.setHeader('Content-Type', 'application/json');
        if (req.url === '/api/tags') { res.end(JSON.stringify({ models: [{ name: 'nomic-embed-text:latest' }] })); return; }
        if (req.url === '/api/embed') {
          const { input } = JSON.parse(body);
          res.end(JSON.stringify({ embeddings: [fakeVector(input)] }));
          return;
        }
        res.statusCode = 404; res.end('{}');
      });
    });
    await new Promise(r => server.listen(0, '127.0.0.1', r));
    const port = server.address().port;
    try {
      const recall = makeRecords(PAGES);
      const store = new VectorStore();
      const meaning = createMeaningIndex({
        store, embedder: createOllamaEmbedder(), records: () => recall.records, get: (u) => recall.get(u), minGapMs: 0,
      });
      const a = { model: 'nomic-embed-text', baseUrl: 'http://127.0.0.1:' + port };
      const step = await meaning.step({ ...a, batch: 8 });
      expect(step.ok).toBe(true);
      expect(step.understood).toBe(4);
      const res = await meaning.search('how do I keep my sourdough culture going', a);
      expect(res.hits[0].url).toBe('https://bakery.example/starter');
      // every request went to the stub on loopback; page text is in /api/embed bodies only
      expect(seen.every(r => /^127\.0\.0\.1:\d+$/.test(r.host))).toBe(true);
      expect(seen.some(r => r.url === '/api/embed' && r.body.includes('flour water yeast'))).toBe(true);
      meaning.forget();
      expect(store.size).toBe(0);
    } finally {
      await new Promise(r => server.close(r));
    }
  });
});

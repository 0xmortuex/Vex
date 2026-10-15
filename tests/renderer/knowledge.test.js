// @vitest-environment jsdom
// js/knowledge.js: what is collected from the stores, the prompt the local
// model gets, and that asking is local-only, read-only and cites its sources.
import { describe, it, expect, beforeEach, vi } from 'vitest';

const { KnowledgeAsk: K, Knowledge } = require('../../src/renderer/js/knowledge.js');

const NOW = Date.UTC(2026, 9, 16);

beforeEach(() => {
  localStorage.clear();
  // Indexing is opt-in: these tests are about a knowledge base that was turned on.
  localStorage.setItem('vex.kb.enabled', 'true');
  delete window.vex;
  delete window.VexTabPolicy;
  delete globalThis.AIRouter;
  delete globalThis.Recall;
  delete globalThis.WebviewManager;
  delete globalThis.PageContext;
  delete globalThis.TabManager;
  delete globalThis.MultiTabContext;
});

describe('collectItems', () => {
  const sources = {
    bookmarks: [
      { id: 'bm1', url: 'https://a.example/', title: 'A', folder: 'Dev', at: NOW },
      { id: 'bm2', url: 'https://b.example/', title: 'Own session', ownSession: true },
    ],
    notes: [
      { id: 'n1', title: 'Plan', content: 'Use sqlite.\n\nThen ship.', updatedAt: '2026-10-01T10:00:00Z' },
      { id: 'n2', title: 'Locked', content: 'secret', locked: true },
    ],
    sticky: { 'https://c.example/': { text: 'remember the coupon', updated: NOW, url: 'https://c.example/', title: 'C' } },
    readLater: [{ id: 'rl1', url: 'https://d.example/', title: 'D', at: NOW }, { id: 'rl2', url: 'https://e.example/', ownSession: true }],
    annotations: { 'https://f.example/': [{ id: 'h1', text: 'a highlighted sentence', note: 'check this', at: NOW, title: 'F', url: 'https://f.example/' }, { id: 'h2' }] },
  };
  it('gathers every kept kind with stable ids and a hash', () => {
    const items = K.collectItems(sources, { now: NOW });
    expect(items.map(i => i.id).sort()).toEqual(['bookmark:bm1', 'highlight:h1', 'note:n1', 'readlater:rl1', 'sticky:https://c.example/']);
    const note = items.find(i => i.id === 'note:n1');
    expect(note.text).toBe('Use sqlite. Then ship.');
    expect(note.h).toMatch(/^[0-9a-z]+$/);
    expect(items.find(i => i.id === 'highlight:h1').text).toBe('a highlighted sentence Note: check this');
  });
  it('leaves out items from a session of their own, and locked or private notes', () => {
    const ids = K.collectItems(sources, { now: NOW }).map(i => i.id);
    expect(ids).not.toContain('bookmark:bm2');
    expect(ids).not.toContain('readlater:rl2');
    expect(ids).not.toContain('note:n2');
  });
  it('changes the hash when the text changes and not otherwise', () => {
    const a = K.collectItems(sources, { now: NOW }).find(i => i.id === 'note:n1').h;
    const same = K.collectItems(JSON.parse(JSON.stringify(sources)), { now: NOW }).find(i => i.id === 'note:n1').h;
    const edited = K.collectItems({ ...sources, notes: [{ ...sources.notes[0], content: 'Use postgres.' }] }, { now: NOW }).find(i => i.id === 'note:n1').h;
    expect(same).toBe(a);
    expect(edited).not.toBe(a);
  });
});

describe('the prompt', () => {
  it('numbers the sources, keeps them in budget and asks for read-only, cited answers', () => {
    const big = 'filler sentence about nothing. '.repeat(2000) + 'The renewal date is 14 March. ' + 'more filler. '.repeat(500);
    const built = K.buildAskPrompt({
      question: 'When is the renewal date?',
      page: { title: 'Contract', url: 'https://x.example/c', text: big },
      library: [{ kind: 'note', title: 'Renewals', url: '', at: NOW, text: 'Renewal is on 14 March, remind me in February.' }],
    });
    expect(built.sources.map(s => s.n)).toEqual([1, 2]);
    expect(built.message).toMatch(/\[1\] This page: Contract/);
    expect(built.message).toMatch(/\[2\] Library: note: Renewals/);
    expect(built.message).toMatch(/ONLY the numbered sources/);
    expect(built.message).toMatch(/read-only/);
    expect(built.message).toMatch(/renewal date is 14 March/);   // the passage that matters survived trimming
    expect(built.message.length).toBeLessThan(K.PROMPT_BUDGET + 1500);
  });
  it('refuses an empty question and an empty source set in plain words', () => {
    expect(() => K.buildAskPrompt({ question: '  ', page: { text: 'x' } })).toThrow(/Type a question/);
    expect(() => K.buildAskPrompt({ question: 'what?' })).toThrow(/nothing to answer from/);
  });
  it('reads the reply and the numbers it cites', () => {
    expect(K.parseReply('{"reply":"It is 14 March [2]."}')).toBe('It is 14 March [2].');
    expect(K.parseReply('plain words [1][3]')).toBe('plain words [1][3]');
    expect(() => K.parseReply(null)).toThrow();
    expect(K.citedNumbers('a [2] b [1][2] c [9]', 3)).toEqual([1, 2]);
  });
});

describe('asking', () => {
  function wire({ result = '{"reply":"It is 14 March [1]."}', callOn, sees = false } = {}) {
    const calls = { callOn: [], callAI: vi.fn() };
    globalThis.AIRouter = {
      callOn: callOn || (async (backend, feature, req) => { calls.callOn.push({ backend, feature, req }); return { result, backend: 'local', model: 'llama3' }; }),
      callAI: calls.callAI,
      getModel: () => 'llama3',
      localVision: async () => sees,
    };
    window.vex = {
      kbContext: vi.fn(async () => ({ ok: true, sources: [{ n: 1, kind: 'note', title: 'Renewals', url: '', at: NOW, text: 'Renewal is on 14 March.' }], mode: 'keywords' })),
    };
    return calls;
  }

  it('answers from the library with the local model only', async () => {
    const calls = wire();
    const r = await Knowledge.ask('when is the renewal?', { scope: 'library' });
    expect(calls.callOn).toHaveLength(1);
    expect(calls.callOn[0].backend).toBe('local');
    expect(calls.callOn[0].req.message).toMatch(/Renewal is on 14 March/);
    expect(calls.callOn[0].req.image).toBeUndefined();
    expect(calls.callAI).not.toHaveBeenCalled();
    expect(r.answer).toBe('It is 14 March [1].');
    expect(r.cited).toEqual([1]);
    expect(r.sources[0].title).toBe('Renewals');
  });

  it('says plainly that Ollama is down and sends nothing to the cloud', async () => {
    const calls = wire({ callOn: async () => { throw new Error('Ollama is not running. Start it and try again.'); } });
    await expect(Knowledge.ask('when?', { scope: 'library' })).rejects.toThrow(/could not answer: Ollama is not running[\s\S]*Nothing was sent to the cloud/);
    expect(calls.callAI).not.toHaveBeenCalled();
  });

  it('will not read a private, Tor or routed tab', async () => {
    wire();
    window.VexTabPolicy = { canReadWebview: () => false };
    globalThis.WebviewManager = { getActiveWebview: () => ({ getURL: () => 'https://x.example/' }) };
    globalThis.PageContext = { extractPageContext: vi.fn() };
    await expect(Knowledge.ask('what is this?', { scope: 'page' })).rejects.toThrow(/private, Tor or routed/);
    expect(PageContext.extractPageContext).not.toHaveBeenCalled();
  });

  it('adds the page text, and a screenshot only when the local model can see', async () => {
    const calls = wire({ sees: false });
    const wv = { getURL: () => 'https://x.example/p', capturePage: async () => ({ toDataURL: () => 'data:image/png;base64,AAAA' }) };
    globalThis.WebviewManager = { getActiveWebview: () => wv };
    globalThis.PageContext = { extractPageContext: async () => ({ title: 'P', url: 'https://x.example/p', text: 'The page says the deadline is Friday.' }) };
    await expect(Knowledge.ask('deadline?', { scope: 'page', screenshot: true })).rejects.toThrow(/cannot see images/);
    expect(calls.callOn).toHaveLength(0);
    const ok = await Knowledge.ask('deadline?', { scope: 'page', useLibrary: false });
    expect(calls.callOn[0].req.message).toMatch(/deadline is Friday/);
    expect(ok.sources[0].label).toBe('This page');
    wire({ sees: true });
    const withImage = wire({ sees: true });
    await Knowledge.ask('deadline?', { scope: 'page', screenshot: true });
    expect(withImage.callOn[0].req.image).toBe('data:image/png;base64,AAAA');
    expect(withImage.callOn[0].backend).toBe('local');
  });

  it('is unavailable in a private window', async () => {
    wire();
    window.VexTabPolicy = { isPrivateWindow: true };
    await expect(Knowledge.ask('x', { scope: 'library' })).rejects.toThrow(/private window/);
  });

  it('reads no page text without a model call that is local', () => {
    const src = require('node:fs').readFileSync(require('node:path').join(__dirname, '../../src/renderer/js/knowledge.js'), 'utf8');
    expect(src).not.toMatch(/callAI\(/);
    expect(src).not.toMatch(/\bfetch\(/);
    expect(src).toMatch(/callOn\('local'/);
  });
});

describe('related block (brief-ready)', () => {
  it('returns a heading and plain items, and nothing when switched off', async () => {
    window.vex = { kbRelatedPage: vi.fn(async () => ({ ok: true, hits: [{ id: 'note:1', kind: 'note', title: 'Starter notes', url: '', at: NOW, passages: ['feeding daily'] }] })) };
    const r = await Knowledge.relatedBlock({ title: 'Sourdough', url: 'https://x.example/', text: 'starter' });
    expect(r.heading).toBe('Related to what you are reading');
    expect(r.items[0]).toMatchObject({ title: 'Starter notes', kindLabel: 'Note', snippet: 'feeding daily' });
    localStorage.setItem('vex.kb.enabled', 'false');
    expect((await Knowledge.relatedBlock({ title: 'x' })).items).toEqual([]);
    expect(window.vex.kbRelatedPage).toHaveBeenCalledTimes(1);
  });
});

describe('opt-in', () => {
  it('is off until it is switched on, and nothing is indexed or asked while off', async () => {
    localStorage.clear();
    expect(Knowledge.enabled()).toBe(false);
    window.vex = { kbPlan: vi.fn(), kbRelatedPage: vi.fn() };
    expect(await Knowledge.tick()).toBeNull();
    expect((await Knowledge.relatedBlock({ title: 'x' })).items).toEqual([]);
    expect(window.vex.kbPlan).not.toHaveBeenCalled();
    expect(window.vex.kbRelatedPage).not.toHaveBeenCalled();
    localStorage.setItem('vex.kb.enabled', 'true');
    expect(Knowledge.enabled()).toBe(true);
  });
});

describe('the indexing slice', () => {
  it('sends only what the plan asks for, in batches, with the exclusion list', async () => {
    localStorage.setItem('vex.notes', JSON.stringify([{ id: 'n1', title: 'A', content: 'alpha words', updatedAt: '2026-10-01T00:00:00Z' }, { id: 'n2', title: 'B', content: 'beta words', updatedAt: '2026-10-02T00:00:00Z' }]));
    globalThis.Recall = { meaningModel: () => '', excluded: () => ['bank.example'], _meaningArgs: () => ({ baseUrl: undefined }) };
    window.vex = {
      kbPlan: vi.fn(async (entries) => ({ ok: true, need: ['note:n2'], removed: 0, seen: entries.length })),
      kbPut: vi.fn(async () => ({ ok: true, accepted: 1, refused: [] })),
      kbSyncArchive: vi.fn(async () => ({ ok: true })),
      kbStep: vi.fn(),
    };
    const r = await Knowledge.tick();
    expect(window.vex.kbPlan.mock.calls[0][0].map(e => e.id).sort()).toEqual(['note:n1', 'note:n2']);
    expect(window.vex.kbPut).toHaveBeenCalledTimes(1);
    expect(window.vex.kbPut.mock.calls[0][0].map(i => i.id)).toEqual(['note:n2']);
    expect(window.vex.kbPut.mock.calls[0][1]).toEqual({ excluded: ['bank.example'] });
    expect(window.vex.kbStep).not.toHaveBeenCalled();     // no embedding model: keywords only
    expect(r.sent).toBe(1);
  });
  it('does nothing when switched off or in a private window', async () => {
    window.vex = { kbPlan: vi.fn() };
    localStorage.setItem('vex.kb.enabled', 'false');
    expect(await Knowledge.tick()).toBeNull();
    localStorage.setItem('vex.kb.enabled', 'true');
    window.VexTabPolicy = { isPrivateWindow: true };
    expect(await Knowledge.tick()).toBeNull();
    expect(window.vex.kbPlan).not.toHaveBeenCalled();
  });
});

describe('source provider for Sources into a document', () => {
  it('offers what is kept when the base is on, nothing when it is off, and registers itself', async () => {
    localStorage.setItem('vex.notes', JSON.stringify([{ id: 'n1', title: 'Plan', content: 'ship on friday', updatedAt: '2026-10-01T00:00:00Z' }]));
    const p = Knowledge.sourceProvider();
    expect(p.id).toBe('knowledge');
    const list = await p.list();
    expect(list.map(i => i.id)).toContain('note:n1');
    expect(await p.read('note:n1')).toContain('ship on friday');
    await expect(p.read('note:missing')).rejects.toThrow(/no longer/);
    localStorage.setItem('vex.kb.enabled', 'false');
    expect(await p.list()).toEqual([]);
    await expect(p.read('note:n1')).rejects.toThrow(/off/);
    const seen = [];
    globalThis.ProjectCompiler = { registerProvider: (x) => seen.push(x.id) };
    Knowledge._inited = false;
    Knowledge.init();
    expect(seen).toEqual(['knowledge']);
    delete globalThis.ProjectCompiler;
  });
});

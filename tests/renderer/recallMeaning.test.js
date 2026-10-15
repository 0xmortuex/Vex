// @vitest-environment jsdom
//
// Recall by meaning, renderer side (js/recall.js): off until a model is named,
// the job is registered with VexJobs only then, hits are fused and labelled,
// exclusions travel with every call, and a failure is said, not hidden.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { Recall } = require('../../src/renderer/js/recall.js');

function hit(url, at = 1000, extra = {}) { return { url, title: url, host: new URL(url).hostname, at, snippet: [], ...extra }; }

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('vex.recall.enabled', 'true');
  delete globalThis.VexJobs;
  delete globalThis.GameSession;
  globalThis.window = globalThis.window || globalThis;
  globalThis.window.vex = undefined;
  Recall._meaningJob = null;
});

describe('off by default', () => {
  it('has no model, is not on, and does not register a job', () => {
    globalThis.window.vex = { recallMeaningSearch: vi.fn(), recallMeaningStep: vi.fn() };
    const every = vi.fn(() => ({ stop() {} }));
    globalThis.VexJobs = { every, stop: vi.fn() };
    expect(Recall.meaningModel()).toBe('');
    expect(Recall.meaningOn()).toBe(false);
    Recall._syncMeaningJob();
    expect(every).not.toHaveBeenCalled();
  });

  it('starts the idle job once a model is chosen, on the ui schedule, and stops it when cleared', () => {
    globalThis.window.vex = { recallMeaningSearch: vi.fn(), recallMeaningStep: vi.fn() };
    const every = vi.fn(() => ({ stop() {} }));
    const stop = vi.fn();
    globalThis.VexJobs = { every, stop };
    Recall.setMeaningModel('nomic-embed-text');
    expect(every).toHaveBeenCalledTimes(1);
    expect(every.mock.calls[0][1]).toBe(60000);
    expect(every.mock.calls[0][3]).toEqual({ when: 'ui' });
    Recall.setMeaningModel('nomic-embed-text');
    expect(every).toHaveBeenCalledTimes(1);
    Recall.setMeaningModel('');
    expect(stop).toHaveBeenCalledWith('Recall by meaning');
  });

  it('does no work while Recall indexing is off or a game holds Recall', async () => {
    const step = vi.fn(async () => ({ ok: true }));
    globalThis.window.vex = { recallMeaningSearch: vi.fn(), recallMeaningStep: step };
    Recall.setMeaningModel('nomic-embed-text');
    localStorage.setItem('vex.recall.enabled', 'false');
    await Recall.meaningStep();
    expect(step).not.toHaveBeenCalled();
    localStorage.setItem('vex.recall.enabled', 'true');
    globalThis.window.GameSession = { holds: (k) => k === 'recall' };
    await Recall.meaningStep();
    expect(step).not.toHaveBeenCalled();
    globalThis.window.GameSession = { holds: () => false };
    await Recall.meaningStep();
    expect(step).toHaveBeenCalledTimes(1);
  });

  it('sends the exclusion list, the model and a small batch with every step', async () => {
    const step = vi.fn(async () => ({ ok: true }));
    globalThis.window.vex = { recallMeaningSearch: vi.fn(), recallMeaningStep: step };
    Recall.setMeaningModel('nomic-embed-text');
    Recall.setExcluded(['bank.example', 'mail.example']);
    await Recall.meaningStep();
    const a = step.mock.calls[0][0];
    expect(a.model).toBe('nomic-embed-text');
    expect(a.excluded).toEqual(['bank.example', 'mail.example']);
    expect(a.batch).toBe(5);
  });
});

describe('fusing and labelling', () => {
  it('labels only the pages the words did not find', () => {
    const text = [hit('https://a.example/1'), hit('https://a.example/2')];
    const meaning = [hit('https://a.example/2'), hit('https://b.example/starter')];
    const fused = Recall.fuse(text, meaning);
    const by = Object.fromEntries(fused.map(h => [h.url, !!h.byMeaning]));
    expect(by['https://a.example/1']).toBe(false);
    expect(by['https://a.example/2']).toBe(false);
    expect(by['https://b.example/starter']).toBe(true);
    expect(fused).toHaveLength(3);
    // found by both lists: ranked first
    expect(fused[0].url).toBe('https://a.example/2');
  });

  it('keeps the full-text result and adds meaning-only pages after it', async () => {
    globalThis.window.vex = {
      recallSearch: vi.fn(async () => ({ total: 1, hits: [hit('https://w.example/words', 5)], terms: ['sourdough'], took: 1 })),
      recallMeaningSearch: vi.fn(async () => ({ ok: true, hits: [hit('https://m.example/meaning', 6, { byMeaning: true })] })),
    };
    Recall.setMeaningModel('nomic-embed-text');
    const res = await Recall.searchByMeaning('sourdough starter', { limit: 30, offset: 0 });
    expect(res.hits.map(h => h.url)).toEqual(['https://w.example/words', 'https://m.example/meaning']);
    expect(res.hits[0].byMeaning).toBeUndefined();
    expect(res.hits[1].byMeaning).toBe(true);
    expect(res.meaningError).toBe('');
  });

  it('applies the site and time filters to meaning hits', async () => {
    globalThis.window.vex = {
      recallSearch: vi.fn(async () => ({ total: 0, hits: [], terms: [], took: 0 })),
      recallMeaningSearch: vi.fn(async () => ({ ok: true, hits: [hit('https://old.example/a', 10), hit('https://new.example/b', 5000), hit('https://sub.new.example/c', 6000)] })),
    };
    Recall.setMeaningModel('nomic-embed-text');
    const res = await Recall.searchByMeaning('x', { since: 100, site: 'new.example' });
    expect(res.hits.map(h => h.url).sort()).toEqual(['https://new.example/b', 'https://sub.new.example/c']);
  });

  it('says so when meaning search fails, and still returns the word matches', async () => {
    globalThis.window.vex = {
      recallSearch: vi.fn(async () => ({ total: 1, hits: [hit('https://w.example/words')], terms: [], took: 1 })),
      recallMeaningSearch: vi.fn(async () => ({ ok: false, message: 'Ollama is not running. Start Ollama to build the meaning index.', hits: [] })),
    };
    Recall.setMeaningModel('nomic-embed-text');
    const res = await Recall.searchByMeaning('words', {});
    expect(res.hits).toHaveLength(1);
    expect(res.meaningError).toMatch(/not running/);
  });

  it('pages through the fused list with offset and limit', async () => {
    const many = Array.from({ length: 50 }, (_, i) => hit('https://w.example/' + i, i));
    globalThis.window.vex = {
      recallSearch: vi.fn(async () => ({ total: 50, hits: many, terms: [], took: 1 })),
      recallMeaningSearch: vi.fn(async () => ({ ok: true, hits: [] })),
    };
    Recall.setMeaningModel('nomic-embed-text');
    const page2 = await Recall.searchByMeaning('x', { offset: 30, limit: 30 });
    expect(page2.total).toBe(50);
    expect(page2.hits).toHaveLength(20);
  });
});

describe('the status line', () => {
  it('says progress plainly', () => {
    expect(Recall.meaningLine({ configured: true, state: 'building', understood: 1240, pages: 3000 }))
      .toBe('1,240 of 3,000 pages understood · building in the background while Vex is idle');
    expect(Recall.meaningLine({ configured: true, state: 'model-missing', understood: 0, pages: 12, message: 'Model not installed. Run: ollama pull nomic-embed-text' }))
      .toBe('0 of 12 pages understood · Model not installed. Run: ollama pull nomic-embed-text');
    expect(Recall.meaningLine({ configured: false })).toMatch(/off/i);
  });
});

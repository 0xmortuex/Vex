// @vitest-environment jsdom
//
// T3-087: the summary cache keyed by the page text (js/summary-cache.js).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const JS = '../../src/renderer/js/';
const fresh = (p) => { delete require.cache[require.resolve(p)]; return require(p); };

let VexSummaryCache, router, calls;
const PAGE = 'The quick brown fox jumps over the lazy dog. '.repeat(10);
const req = (over = {}, pageOver = {}) => ({ message: '', pageContext: { url: 'https://example.com/article?id=3#top', title: 'Article', text: PAGE, ...pageOver }, ...over });

beforeEach(() => {
  localStorage.clear();
  vi.resetModules();
  window.showToast = vi.fn();
  Object.defineProperty(globalThis, 'crypto', { value: require('node:crypto').webcrypto, configurable: true });
  globalThis.VexSensitivity = fresh(JS + 'ai-sensitivity.js').VexSensitivity;
  ({ VexSummaryCache } = fresh(JS + 'summary-cache.js'));
  calls = 0;
  router = {
    callAI: vi.fn(async (feature) => { calls++; return { result: JSON.stringify({ summary: 'answer ' + calls }), backend: 'local', model: 'm1' }; }),
    getOllamaStatus: () => ({ forceCloud: false, preferLocal: false, model: 'm1' }),
  };
  globalThis.AIRouter = router;
  delete window.VexTabPolicy;
});
afterEach(() => { delete globalThis.AIRouter; delete globalThis.VexSensitivity; });

describe('the summary cache', () => {
  it('answers the same page from the cache without calling the AI again', async () => {
    VexSummaryCache.wrap();
    const a = await AIRouter.callAI('summarize', req());
    const b = await AIRouter.callAI('summarize', req());
    expect(calls).toBe(1);
    expect(b.cached).toBe(true);
    expect(b.result).toBe(a.result);
    expect(window.showToast.mock.calls.some(c => /from the cache/.test(c[0]))).toBe(true);
  });

  it('ignores the fragment, so an in-page link does not make a new summary', async () => {
    VexSummaryCache.wrap();
    await AIRouter.callAI('summarize', req());
    await AIRouter.callAI('summarize', req({}, { url: 'https://example.com/article?id=3#other' }));
    expect(calls).toBe(1);
  });

  it('summarises again, and says the page changed, when the text is different', async () => {
    VexSummaryCache.wrap();
    await AIRouter.callAI('summarize', req());
    const out = await AIRouter.callAI('summarize', req({}, { text: PAGE + ' A new paragraph appeared.' }));
    expect(calls).toBe(2);
    expect(out.pageChanged).toBe(true);
    expect(window.showToast.mock.calls.some(c => /page changed since you last summarised/.test(c[0]))).toBe(true);
    // The old text's entry is replaced, not kept beside the new one.
    expect(VexSummaryCache.count()).toBe(1);
  });

  it('keys on the persona and the model', async () => {
    VexSummaryCache.wrap();
    await AIRouter.callAI('summarize', req());
    await AIRouter.callAI('summarize', req({ persona: { id: 'terse' } }));
    expect(calls).toBe(2);
    router.getOllamaStatus = () => ({ forceCloud: true, preferLocal: false, model: 'm1' });
    await AIRouter.callAI('summarize', req());
    expect(calls).toBe(3);
  });

  it('never caches what is not a plain page summary', async () => {
    VexSummaryCache.wrap();
    await AIRouter.callAI('chat', req());
    await AIRouter.callAI('chat', req());
    expect(calls).toBe(2);
    await AIRouter.callAI('summarize', req({ selectedText: 'a part' }));
    await AIRouter.callAI('summarize', req({ selectedText: 'a part' }));
    expect(calls).toBe(4);
    expect(VexSummaryCache.count()).toBe(0);
  });

  it('never caches a page the sensitivity gate has an opinion about', async () => {
    VexSummaryCache.wrap();
    const mail = req({}, { url: 'https://mail.google.com/mail/u/0/#inbox' });
    await AIRouter.callAI('summarize', mail);
    await AIRouter.callAI('summarize', mail);
    expect(calls).toBe(2);
    const secret = req({}, { text: PAGE + ' password: hunter2hunter2' });
    await AIRouter.callAI('summarize', secret);
    await AIRouter.callAI('summarize', secret);
    expect(calls).toBe(4);
    expect(VexSummaryCache.count()).toBe(0);
  });

  it('never caches in a private window or a private tab', async () => {
    VexSummaryCache.wrap();
    await AIRouter.callAI('summarize', req({ private: true }));
    await AIRouter.callAI('summarize', req({ private: true }));
    expect(calls).toBe(2);
    window.VexTabPolicy = { isPrivateWindow: true };
    await AIRouter.callAI('summarize', req());
    await AIRouter.callAI('summarize', req());
    expect(calls).toBe(4);
    expect(VexSummaryCache.count()).toBe(0);
  });

  it('does nothing while switched off, and wrapping twice wraps once', async () => {
    VexSummaryCache.setEnabled(false);
    expect(VexSummaryCache.wrap()).toBe(true);
    expect(VexSummaryCache.wrap()).toBe(false);
    await AIRouter.callAI('summarize', req());
    await AIRouter.callAI('summarize', req());
    expect(calls).toBe(2);
  });

  it('keeps at most 40 summaries and drops entries older than 30 days', async () => {
    VexSummaryCache.wrap();
    for (let i = 0; i < 45; i++) await AIRouter.callAI('summarize', req({}, { url: 'https://example.com/p' + i, text: PAGE + i }));
    expect(VexSummaryCache.count()).toBe(40);
    const list = JSON.parse(localStorage.getItem('vex.summaryCache'));
    list[0].at = Date.now() - 31 * 24 * 3600 * 1000;
    localStorage.setItem('vex.summaryCache', JSON.stringify(list));
    const before = calls;
    await AIRouter.callAI('summarize', req({}, { url: 'https://example.com/p44', text: PAGE + 44 }));
    expect(calls).toBe(before + 1);
  });

  it('does not cache an empty answer', async () => {
    router.callAI = vi.fn(async () => { calls++; return { result: '  ', backend: 'local' }; });
    VexSummaryCache.wrap();
    await AIRouter.callAI('summarize', req());
    await AIRouter.callAI('summarize', req());
    expect(calls).toBe(2);
  });

  it('raises when the cache is unreadable instead of pretending it is empty', async () => {
    localStorage.setItem('vex.summaryCache', '{broken');
    VexSummaryCache.wrap();
    await expect(AIRouter.callAI('summarize', req())).rejects.toThrow(/summary cache is not readable/);
  });
});

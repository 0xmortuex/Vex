// @vitest-environment jsdom
// T3-037: "Have I seen this before?" gets a semantic Recall match on demand and an optional prompt after a dwell.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
const JS = '../../src/renderer/js/';
const fresh = (p) => { delete require.cache[require.resolve(p)]; return require(p); };

let SB;
const page = { url: 'https://docs.example.com/guide/', title: 'Guide to the kernel scheduler', text: 'The kernel scheduler picks the next thread to run.' };
beforeEach(() => {
  localStorage.clear(); vi.resetModules(); vi.useFakeTimers();
  delete globalThis.Recall; delete globalThis.VexAttention;
  ({ SeenBefore: SB } = fresh(JS + 'ai-judgement.js'));
  SB._wired = false; SB._prompted = new Set();
  window.VexTabPolicy = { isPrivateWindow: false, canRestore: () => true };
});
afterEach(() => { vi.useRealTimers(); });

describe('by meaning, on demand', () => {
  it('refuses when meaning search is not set up, so nothing is sent', async () => {
    await expect(SB.meaningMatches(page)).rejects.toThrow(/not set up/);
    globalThis.Recall = { meaningOn: () => false };
    await expect(SB.meaningMatches(page)).rejects.toThrow(/not set up/);
  });
  it('asks Recall (the local embedding model) with the title and first words, and leaves this page out', async () => {
    window.vex = { recallMeaningSearch: vi.fn(async () => ({ ok: true, hits: [
      { url: 'https://docs.example.com/guide', title: 'The same page', at: 1 },
      { url: 'https://other.example.org/threads', title: 'How threads are scheduled', at: 5 },
    ] })) };
    globalThis.Recall = { meaningOn: () => true, _meaningArgs: (x) => ({ model: 'nomic-embed-text', ...x }) };
    const found = await SB.meaningMatches(page);
    expect(found).toEqual([{ where: 'recall', title: 'How threads are scheduled', url: 'https://other.example.org/threads', at: 5, score: 0, label: 'matches by meaning' }]);
    const [q, args] = window.vex.recallMeaningSearch.mock.calls[0];
    expect(q).toContain('Guide to the kernel scheduler');
    expect(q.length).toBeLessThanOrEqual(500);
    expect(args).toMatchObject({ model: 'nomic-embed-text', limit: 12 });
  });
  it('reports a failed meaning search', async () => {
    window.vex = { recallMeaningSearch: async () => ({ ok: false, message: 'Ollama is not running' }) };
    globalThis.Recall = { meaningOn: () => true, _meaningArgs: () => ({}) };
    await expect(SB.meaningMatches(page)).rejects.toThrow(/Ollama is not running/);
  });
});

describe('the prompt after a dwell', () => {
  beforeEach(() => {
    globalThis.VexAttention = { suggest: vi.fn(() => true) };
    SB.setEnabled(true);
    vi.spyOn(SB, '_pageText').mockResolvedValue(page);
  });
  it('is off by default: nothing is armed and nothing is read', async () => {
    expect(SB.dwellEnabled()).toBe(false);
    SB._wire();
    document.dispatchEvent(new CustomEvent('vex:tab-settled', { detail: { tabId: 't' } }));
    vi.advanceTimersByTime(60000);
    expect(SB._pageText).not.toHaveBeenCalled();
    expect(await SB.dwellCheck()).toBe(null);
    expect(VexAttention.suggest).not.toHaveBeenCalled();
  });
  it('after the dwell, a page seen before is suggested to the Attention Inbox, once', async () => {
    SB.setDwell(true);
    vi.spyOn(SB, 'corpus').mockReturnValue([{ where: 'history', title: 'Guide', url: page.url, at: Date.now() - 3 * 86400000, key: SB.canonical(page.url), text: 'Guide' }, { where: 'history', title: 'Guide', url: page.url, at: Date.now() - 86400000, key: SB.canonical(page.url), text: 'Guide' }]);
    document.dispatchEvent(new CustomEvent('vex:tab-settled', { detail: { tabId: 't' } }));
    vi.advanceTimersByTime(SB.DWELL_MS - 1);
    expect(VexAttention.suggest).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2);
    expect(VexAttention.suggest).toHaveBeenCalledTimes(1);
    expect(VexAttention.suggest.mock.calls[0][0]).toMatchObject({ feature: 'seen-before', title: 'You may have seen this page before' });
    expect(VexAttention.suggest.mock.calls[0][0].body).toMatch(/You opened this page/);
    expect(await SB.dwellCheck()).toBe(null);
    expect(VexAttention.suggest).toHaveBeenCalledTimes(1);
  });
  it('says nothing for a page that matches nothing, and leaving the page cancels it', async () => {
    SB.setDwell(true);
    vi.spyOn(SB, 'corpus').mockReturnValue([]);
    expect(await SB.dwellCheck()).toBe(null);
    expect(VexAttention.suggest).not.toHaveBeenCalled();
    SB._arm();
    document.dispatchEvent(new CustomEvent('vex:tab-navigated', { detail: {} }));
    vi.advanceTimersByTime(SB.DWELL_MS * 2);
    expect(SB._pageText).toHaveBeenCalledTimes(1);
  });
  it('turning "Seen before" off turns the prompt off too', async () => {
    SB.setDwell(true);
    SB.setEnabled(false);
    expect(SB.dwellEnabled()).toBe(false);
    expect(await SB.dwellCheck()).toBe(null);
  });
});

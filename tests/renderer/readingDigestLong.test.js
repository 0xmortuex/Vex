// @vitest-environment jsdom
//
// T2-025 (Wave 6): the reading digest reads a long article in parts through the long-document engine when the local
// model answers, instead of summarising its first 6000 characters as if that were all of it.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const fresh = (p) => { delete require.cache[require.resolve(p)]; return require(p); };
let D, run, callAI, backend;

beforeEach(() => {
  localStorage.clear();
  globalThis.Scheduler = fresh('../../src/renderer/js/scheduler.js');
  globalThis.VexJobs = { every: () => ({ stop: () => {} }), heavyOrThrow: (_name, fn) => fn() };
  D = fresh('../../src/renderer/js/reading-digest.js').ReadingDigest;
  backend = 'local';
  callAI = vi.fn(async () => ({ result: '{"summary":"It says things.","why":"w","topic":"t"}', backend, model: 'm' }));
  run = vi.fn(async () => ({ summary: 'CONDENSED: the claims, the numbers and the conclusion.', coverage: 100 }));
  globalThis.AIRouter = { callAI, resolveBackend: vi.fn(async () => backend) };
  globalThis.VexLongDoc = { enabled: () => true, run };
});
afterEach(() => { for (const k of ['AIRouter', 'VexLongDoc', 'VexJobs', 'Scheduler']) delete globalThis[k]; });

const long = 'A paragraph of the article. '.repeat(600);          // about 16,800 characters

describe('a long article', () => {
  it('is condensed in parts by the local engine and the summary is made from that', async () => {
    const out = await D.summarise({ title: 'T', url: 'https://a.example/', text: long });
    expect(run).toHaveBeenCalledTimes(1);
    expect(run.mock.calls[0][0]).toBe(long);
    expect(run.mock.calls[0][1]).toMatchObject({ maxChunks: 8 });
    expect(callAI.mock.calls[0][1].message).toContain('CONDENSED: the claims');
    expect(callAI.mock.calls[0][1].message).not.toContain('A paragraph of the article.');
    expect(out).toMatchObject({ summary: 'It says things.', covered: 100 });
  });
  it('keeps the single call for a short article, for the cloud, and when the engine is off', async () => {
    await D.summarise({ title: 'T', url: 'u', text: 'short text '.repeat(20) });
    backend = 'cloud';
    await D.summarise({ title: 'T', url: 'u', text: long });
    backend = 'local';
    globalThis.VexLongDoc = { enabled: () => false, run };
    const out = await D.summarise({ title: 'T', url: 'u', text: long });
    expect(run).not.toHaveBeenCalled();
    expect(out.covered).toBeUndefined();
    expect(callAI.mock.calls[2][1].message).toContain('A paragraph of the article.');
    expect(callAI.mock.calls[2][1].message.length).toBeLessThan(7000);            // still cut to the budget
  });
  it('a failed or stopped engine run is an error for that article, not a quiet cut', async () => {
    run.mockRejectedValueOnce(new Error('Your local model could not answer: busy. Nothing was sent to the cloud.'));
    await expect(D.summarise({ title: 'T', url: 'u', text: long })).rejects.toThrow(/local model could not answer/);
    expect(callAI).not.toHaveBeenCalled();
  });
});

// @vitest-environment node
//
// T0-007 (Wave 6): a model that runs on this machine goes through the heavy-job queue as an 'ai-ask'.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

async function loadRouter() {
  vi.resetModules();
  return (await import('../../src/renderer/js/ai-router.js')).AIRouter;
}
let saved;
beforeEach(() => {
  saved = { Ollama: globalThis.Ollama, VexJobs: globalThis.VexJobs, GameMode: globalThis.GameMode };
  globalThis.Ollama = { ping: vi.fn(async () => true), chat: vi.fn(async () => 'hello'), generate: vi.fn(async () => 'hello') };
});
afterEach(() => { for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete globalThis[k]; else globalThis[k] = v; } vi.restoreAllMocks(); });

describe('local AI through VexJobs.heavy', () => {
  it('queues a local ask as an ai-ask, and does not let its failure feed the breaker', async () => {
    const calls = [];
    globalThis.VexJobs = { heavy() {}, inHeavy: () => false, heavyOrThrow: vi.fn(async (name, fn, opts) => { calls.push({ name, opts }); return fn(); }) };
    const AIRouter = await loadRouter();
    const out = await AIRouter.callOn('local', 'chat', { message: 'hi' });
    expect(out.backend).toBe('local');
    expect(calls).toHaveLength(1);
    expect(calls[0].name).toBe('Local AI: chat');
    expect(calls[0].opts).toMatchObject({ kind: 'ai-ask', breaker: false });
  });

  it('runs at once when it is started from inside a heavy job, so an indexer cannot queue behind itself', async () => {
    globalThis.VexJobs = { heavy() {}, inHeavy: () => true, heavyOrThrow: vi.fn() };
    const AIRouter = await loadRouter();
    const out = await AIRouter.callOn('local', 'chat', { message: 'hi' });
    expect(out.backend).toBe('local');
    expect(globalThis.VexJobs.heavyOrThrow).not.toHaveBeenCalled();
  });

  it('does not touch the cloud path', async () => {
    globalThis.VexJobs = { heavy() {}, inHeavy: () => false, heavyOrThrow: vi.fn(async (n, fn) => fn()) };
    const AIRouter = await loadRouter();
    await AIRouter.callOn('cloud', 'chat', { message: 'hi' }).catch(() => {});
    expect(globalThis.VexJobs.heavyOrThrow).not.toHaveBeenCalled();
  });
});

describe('the real queue', () => {
  it('breaker:false keeps a failed ask out of the breaker, and inHeavy() is true only while a job holds the slot', async () => {
    vi.resetModules();
    const { VexJobs } = await import('../../src/renderer/js/jobs.js');
    globalThis.GameMode = { gaming: false };
    const fail = vi.fn();
    globalThis.VexBreaker = { fail, ok: vi.fn(), isTripped: () => false };
    globalThis.window = globalThis.window || globalThis;
    let during;
    await expect(VexJobs.heavyOrThrow('ask', async () => { during = VexJobs.inHeavy(); throw new Error('boom'); }, { kind: 'ai-ask', feature: 'ai-router', breaker: false })).rejects.toThrow('boom');
    expect(during).toBe(true);
    expect(VexJobs.inHeavy()).toBe(false);
    expect(fail).not.toHaveBeenCalled();
    await expect(VexJobs.heavyOrThrow('job', async () => { throw new Error('boom'); }, { kind: 'ai-ask', feature: 'ai-router' })).rejects.toThrow('boom');
    expect(fail).toHaveBeenCalledTimes(1);
    delete globalThis.VexBreaker;
  });
});

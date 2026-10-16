// @vitest-environment jsdom
//
// Audit (2026-10): the cap was checked before a cloud call and counted after it, so requests running at
// the same time all passed the check and overshot the cap. A slot is now reserved first and given back on failure.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const JS = '../../src/renderer/js/';
const fresh = (p) => { delete require.cache[require.resolve(p)]; return require(p); };

let AIRouter, VexAISpend, fetchAI, ledger;

function cloudOk(result = '{"reply":"from the cloud"}') {
  return vi.fn(async () => ({ ok: true, json: async () => ({ result }) }));
}

beforeEach(async () => {
  localStorage.clear();
  document.body.innerHTML = '';
  vi.resetModules();
  window.showToast = vi.fn();
  ledger = { note: vi.fn() };
  globalThis.VexLedger = ledger;
  globalThis.VexSensitivity = fresh(JS + 'ai-sensitivity.js').VexSensitivity;
  ({ VexAISpend } = fresh(JS + 'ai-spend-cap.js'));
  globalThis.VexAISpend = VexAISpend;
  fetchAI = cloudOk();
  window.VexConfig = { aiWorkerUrl: () => 'https://worker.example/ai', fetchAI: (...a) => fetchAI(...a) };
  globalThis.VexJobs = { every: () => ({ stop() {} }) };
  globalThis.Ollama = { ping: vi.fn(async () => false), generate: vi.fn(async () => '{"reply":"from local"}'), chat: vi.fn(async () => '{"reply":"from local"}'), getBaseUrl: () => 'http://127.0.0.1:11434' };
  ({ AIRouter } = fresh(JS + 'ai-router.js'));
});
afterEach(() => { delete globalThis.VexAISpend; delete globalThis.VexSensitivity; delete globalThis.VexLedger; delete globalThis.Ollama; delete globalThis.VexJobs; delete window.VexConfig; vi.useRealTimers(); });

describe('the cap holds under parallel requests', () => {
  it('reserve() hands out exactly the cap and then refuses; release() gives one back', () => {
    VexAISpend.setCap(2);
    const a = VexAISpend.reserve('chat');
    const b = VexAISpend.reserve('chat');
    expect(a && b).toBeTruthy();
    expect(VexAISpend.reserve('chat')).toBe(null);
    expect(VexAISpend.used()).toBe(2);
    VexAISpend.release(a);
    expect(VexAISpend.used()).toBe(1);
    expect(VexAISpend.byFeature()).toEqual({ chat: 1 });
    expect(VexAISpend.reserve('chat')).toBeTruthy();
  });

  it('with no cap every reserve succeeds and is counted', () => {
    for (let i = 0; i < 5; i++) expect(VexAISpend.reserve('chat')).toBeTruthy();
    expect(VexAISpend.used()).toBe(5);
  });

  it('release needs the token', () => {
    expect(() => VexAISpend.release(undefined)).toThrow(/token/);
  });

  it('five requests at once with a cap of 2 send two to the cloud and fail the rest plainly', async () => {
    VexAISpend.setCap(2);
    const results = await Promise.allSettled(Array.from({ length: 5 }, () => AIRouter.callOn('cloud', 'chat', { message: 'hello' })));
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(2);
    expect(results.filter(r => r.status === 'rejected' && r.reason.code === 'vex-spend-cap')).toHaveLength(3);
    expect(fetchAI).toHaveBeenCalledTimes(2);
    expect(VexAISpend.used()).toBe(2);
  });

  it('a cloud call that fails gives its slot back', async () => {
    VexAISpend.setCap(1);
    fetchAI = vi.fn(async () => { throw new Error('Failed to fetch'); });
    await expect(AIRouter.callOn('cloud', 'chat', { message: 'hello' })).rejects.toThrow();
    expect(VexAISpend.used()).toBe(0);
    expect(VexAISpend.reached()).toBe(false);
  });
});

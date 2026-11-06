// @vitest-environment node
//
// What the router does for Research mode: the local model is asked through /api/chat with a context window that
// fits the pages (the default 4,096 tokens would drop the rules at the START of the prompt), the brief's own system
// prompt is used on every backend, your own key gets room for a long answer, and the cloud still passes the
// sensitivity gate and the spend cap.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

async function loadRouter() {
  vi.resetModules();
  globalThis.window = { VexConfig: { aiWorkerUrl: () => '' } };
  const mod = await import('../../src/renderer/js/ai-router.js');
  return mod.AIRouter;
}
let saved;
beforeEach(() => {
  saved = { Ollama: globalThis.Ollama, AIKeys: globalThis.AIKeys, VexAISpend: globalThis.VexAISpend, VexSensitivity: globalThis.VexSensitivity };
  vi.stubGlobal('navigator', { onLine: true });
});
afterEach(() => { Object.assign(globalThis, saved); delete globalThis.window; vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('Research mode on a local model', () => {
  it('asks /api/chat in JSON mode with the context window and the room the brief needs', async () => {
    const r = await loadRouter();
    const chat = vi.fn(async () => '{"summary":[]}');
    globalThis.Ollama = { ping: vi.fn(async () => true), chat, generate: vi.fn(async () => { throw new Error('wrong endpoint'); }) };
    const out = await r.callOn('local', 'research', { message: 'TASK ... <<<SOURCE S1 | t | u>>> body <<<END S1>>>', maxTokens: 2600, numCtx: 16384 });
    expect(out).toMatchObject({ result: '{"summary":[]}', backend: 'local' });
    const [model, msgs, opts] = chat.mock.calls[0];
    expect(model).toBe(r.getModel());
    expect(msgs[0].role).toBe('system');
    expect(msgs[0].content).toMatch(/untrusted DATA/);
    expect(msgs[1]).toEqual({ role: 'user', content: 'TASK ... <<<SOURCE S1 | t | u>>> body <<<END S1>>>' });
    expect(opts).toMatchObject({ format: 'json', numCtx: 16384, maxTokens: 2600, temperature: 0.1 });
  });
  it('falls back to a 16K window and 3000 tokens when the caller names none', async () => {
    const r = await loadRouter();
    const chat = vi.fn(async () => '{}');
    globalThis.Ollama = { ping: vi.fn(async () => true), chat };
    await r.callOn('local', 'research', { message: 'x' });
    expect(chat.mock.calls[0][2]).toMatchObject({ numCtx: 16384, maxTokens: 3000 });
  });
});

describe('Research mode behind your own key', () => {
  it('uses the brief\'s system prompt, the best model tier and room for a long answer', async () => {
    const r = await loadRouter();
    const chat = vi.fn(async () => ({ text: '{"summary":[]}', model: 'claude-sonnet-5-5', usage: { input: 9, output: 4 } }));
    globalThis.AIKeys = {
      available: () => true, provider: (id) => ({ id, short: 'Claude', saved: true, models: {} }), hasAny: () => true, active: () => 'anthropic', source: () => 'auto', modelFor: () => 'm', chat,
    };
    globalThis.VexAISpend = { reserve: vi.fn(() => ({ id: 1 })), release: vi.fn(), routing: () => false, reached: () => false };
    globalThis.VexSensitivity = { gate: async (_f, req) => ({ action: 'send', request: req }), decide: () => ({ verdict: 'send' }) };
    const out = await r.callOn('cloud', 'research', { message: 'TASK and SOURCES' });
    expect(out).toMatchObject({ backend: 'cloud', via: 'key', provider: 'anthropic' });
    expect(globalThis.VexAISpend.reserve).toHaveBeenCalledWith('research');
    const call = chat.mock.calls[0][0];
    expect(call).toMatchObject({ feature: 'research', maxTokens: 3500 });
    expect(call.messages[0].content).toMatch(/untrusted DATA/);
    expect(call.messages.at(-1).content).toContain('TASK and SOURCES');
  });
  it('the cloud request is stopped by the sensitivity gate, and nothing is sent', async () => {
    const r = await loadRouter();
    const chat = vi.fn();
    globalThis.AIKeys = { available: () => true, provider: () => ({ id: 'a', short: 'Claude', saved: true, models: {} }), hasAny: () => true, active: () => 'a', source: () => 'auto', modelFor: () => 'm', chat };
    const refusal = Object.assign(new Error('This request holds a private window or tab, which never goes to the cloud.'), { code: 'vex-sensitive' });
    globalThis.VexSensitivity = { gate: async () => { throw refusal; }, decide: () => ({ verdict: 'refuse' }) };
    await expect(r.callOn('cloud', 'research', { message: 'x' })).rejects.toBe(refusal);
    expect(chat).not.toHaveBeenCalled();
  });
  it('the spend cap stops the cloud call when no local model is running', async () => {
    const r = await loadRouter();
    const chat = vi.fn();
    globalThis.Ollama = { ping: vi.fn(async () => false) };
    globalThis.AIKeys = { available: () => true, provider: () => ({ id: 'a', short: 'Claude', saved: true, models: {} }), hasAny: () => true, active: () => 'a', source: () => 'auto', modelFor: () => 'm', chat };
    globalThis.VexSensitivity = { gate: async (_f, req) => ({ action: 'send', request: req }), decide: () => ({ verdict: 'send' }) };
    globalThis.VexAISpend = { reserve: () => null, release: vi.fn(), routing: () => false, reached: () => true, limitText: () => "Today's cloud limit of 20 calls is used up", noteDowngrade: vi.fn() };
    await expect(r.callOn('cloud', 'research', { message: 'x' })).rejects.toMatchObject({ code: 'vex-spend-cap', message: expect.stringMatching(/used up, and no local model is running/) });
    expect(chat).not.toHaveBeenCalled();
  });
});

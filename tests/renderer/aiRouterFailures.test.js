// @vitest-environment node
//
// How AIRouter behaves when a backend is missing or misbehaving.
//
// Regressions pinned here:
//   1. resolveBackend() returns 'skip' for a feature routed to local when Ollama
//      is down. callAI then returned NULL, and every caller did `result.result`
//      on it — the user saw "Cannot read properties of null (reading 'result')"
//      instead of an explanation. Only genuinely background features (history
//      indexing) may resolve to null.
//   2. Errors thrown by the main process arrive wrapped as
//      "Error invoking remote method 'cloud:request': Error: <real message>",
//      which was shown verbatim in the chat.
//   3. On-device (WebGPU) is a privacy choice: a failure there must NOT quietly
//      re-send the prompt (and any page text) to the cloud worker.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

async function loadRouter() {
  vi.resetModules();
  const mod = await import('../../src/renderer/js/ai-router.js');
  return mod.AIRouter;
}
function stubOllama(up) { globalThis.Ollama = { ping: vi.fn(async () => up) }; }

let savedOllama, savedWebLLM;
beforeEach(() => { savedOllama = globalThis.Ollama; savedWebLLM = globalThis.WebLLM; });
afterEach(() => { globalThis.Ollama = savedOllama; globalThis.WebLLM = savedWebLLM; vi.restoreAllMocks(); });

describe('callAI when a local-only feature has no local backend', () => {
  it('throws a readable error for a user-facing feature instead of returning null', async () => {
    const AIRouter = await loadRouter();
    stubOllama(false);
    AIRouter.setRoutingPrefs({ chat: 'local' });
    expect(await AIRouter.resolveBackend('chat')).toBe('skip');
    await expect(AIRouter.callAI('chat', { message: 'hi' }))
      .rejects.toThrow(/Ollama isn't running/i);
  });

  it('still returns null for background history indexing (fire and forget)', async () => {
    const AIRouter = await loadRouter();
    stubOllama(false);                       // historyIndex defaults to 'local'
    expect(await AIRouter.resolveBackend('historyIndex')).toBe('skip');
    expect(await AIRouter.callAI('historyIndex', { pageContext: {} })).toBeNull();
  });

  it('throws for the agent when it is routed local and Ollama is down', async () => {
    const AIRouter = await loadRouter();
    stubOllama(false);
    AIRouter.setRoutingPrefs({ agent: 'local' });
    await expect(AIRouter.callAI('agent', {})).rejects.toThrow(/Ollama isn't running/i);
  });
});

describe('_cleanIpcError', () => {
  const cases = [
    ["Error invoking remote method 'cloud:request': Error: Set your AI access token in Cloud Services",
      'Set your AI access token in Cloud Services'],
    ["Error invoking remote method 'cloud:request': Error: Configure an HTTPS AI Worker URL",
      'Configure an HTTPS AI Worker URL'],
    ['Failed to fetch', 'Failed to fetch'],
  ];
  it.each(cases)('unwraps %j', async (raw, expected) => {
    const AIRouter = await loadRouter();
    expect(AIRouter._cleanIpcError(new Error(raw))).toBe(expected);
  });

  it('never returns an empty message', async () => {
    const AIRouter = await loadRouter();
    expect(AIRouter._cleanIpcError(new Error(''))).toBe('Cloud request failed');
  });
});

describe('on-device failures do not silently fall back to the cloud', () => {
  it('throws and names the reason instead of re-sending the prompt', async () => {
    const AIRouter = await loadRouter();
    stubOllama(false);
    globalThis.WebLLM = {
      preferred: () => true,
      isLoaded: () => true,
      loadedModel: () => 'test-model',
      chat: vi.fn(async () => { throw new Error('WebGPU device lost'); }),
    };
    expect(await AIRouter.resolveBackend('chat')).toBe('ondevice');
    await expect(AIRouter.callAI('chat', { message: 'secret question' }))
      .rejects.toThrow(/on-device ai failed.*not falling back to the cloud/is);
  });

  it('uses the on-device backend and tags the reply with it', async () => {
    const AIRouter = await loadRouter();
    globalThis.WebLLM = {
      preferred: () => true,
      isLoaded: () => true,
      loadedModel: () => 'test-model',
      chat: vi.fn(async () => 'local answer'),
    };
    const out = await AIRouter.callAI('chat', { message: 'hello' });
    expect(out).toEqual({ result: 'local answer', backend: 'ondevice', model: 'test-model' });
  });

  it('keeps the AI-memory system message when trimming a long history', async () => {
    const AIRouter = await loadRouter();
    let seen = null;
    globalThis.WebLLM = {
      preferred: () => true, isLoaded: () => true, loadedModel: () => 'm',
      chat: vi.fn(async (msgs) => { seen = msgs; return 'ok'; }),
    };
    const history = [{ role: 'system', content: 'REMEMBER: user is a TypeScript dev' }];
    for (let i = 0; i < 20; i++) history.push({ role: 'user', content: 'turn ' + i });

    await AIRouter.callAI('chat', { message: 'and now?', conversationHistory: history });
    const systems = seen.filter(m => m.role === 'system').map(m => m.content);
    expect(systems.some(c => /REMEMBER: user is a TypeScript dev/.test(c))).toBe(true);
  });
});

describe('refreshOllamaStatus is throw-proof', () => {
  it('reports unavailable rather than rejecting when ping blows up', async () => {
    const AIRouter = await loadRouter();
    globalThis.Ollama = { ping: vi.fn(async () => { throw new Error('socket hang up'); }) };
    await expect(AIRouter.refreshOllamaStatus()).resolves.toBe(false);
    expect(AIRouter.isOllamaAvailable()).toBe(false);
  });
});

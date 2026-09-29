// @vitest-environment node
//
// Router fixes from the 2026-09-29 sweep (area ai4). With no Worker URL (the
// node environment has no VexConfig, so there is none), every cloud-preferring
// feature goes straight to the local model; and a persona prompt that asks for
// no JSON gets the reply format added, since format:'json' is still forced.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

async function loadRouter() {
  vi.resetModules();
  return (await import('../../src/renderer/js/ai-router.js')).AIRouter;
}

let saved;
beforeEach(() => {
  saved = globalThis.Ollama;
  globalThis.Ollama = {
    ping: vi.fn(async () => true),
    generate: vi.fn(async () => '{"reply":"ok"}'),
    chat: vi.fn(async () => '{"reply":"ok"}'),
    getBaseUrl: () => 'http://127.0.0.1:11434',
  };
});
afterEach(() => { globalThis.Ollama = saved; vi.restoreAllMocks(); });

describe('no Worker URL', () => {
  for (const feature of ['multiTab', 'translate', 'historySearch', 'agent']) {
    it(feature + ' goes local directly', async () => {
      const AIRouter = await loadRouter();
      expect(await AIRouter.resolveBackend(feature)).toBe('local');
    });
  }
});

describe('a custom persona on the local model', () => {
  it('gets the reply format when its prompt asks for no JSON', async () => {
    const AIRouter = await loadRouter();
    await AIRouter.callOn('local', 'chat', { message: 'hi', persona: { systemPrompt: 'You are a pirate.' } });
    const sys = globalThis.Ollama.generate.mock.calls[0][2].systemPrompt;
    expect(sys).toMatch(/^You are a pirate\./);
    expect(sys).toContain('{"reply"');
  });

  it('the multi-turn chat too', async () => {
    const AIRouter = await loadRouter();
    await AIRouter.callOn('local', 'chat', { message: 'hi', conversationHistory: [{ role: 'user', content: 'earlier' }], persona: { systemPrompt: 'You are a pirate.' } });
    const sys = globalThis.Ollama.chat.mock.calls[0][1][0].content;
    expect(sys).toContain('{"reply"');
  });

  it('is left alone when it asks for JSON of its own (the tab command)', async () => {
    const AIRouter = await loadRouter();
    const own = 'You manage tabs. Return ONLY JSON: {"close":[]}';
    await AIRouter.callOn('local', 'chat', { message: 'close youtube', persona: { systemPrompt: own } });
    expect(globalThis.Ollama.generate.mock.calls[0][2].systemPrompt).toBe(own);
  });
});

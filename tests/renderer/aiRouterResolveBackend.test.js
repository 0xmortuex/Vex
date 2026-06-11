// @vitest-environment node
//
// Regression for the bug where Ctrl+Shift+G (groupTabs, routing pref 'auto')
// failed with "Cloud AI is not configured" instead of falling back to local
// Ollama. resolveBackend() must ping Ollama live when the cloud Worker URL is
// unconfigured, and only choose cloud (→ the config error) when Ollama is also
// unavailable. Explicit/forced cloud behavior is unchanged.
//
// In the Node test environment there is no `window`, so VexConfig is absent and
// cloudWorkerUrl() === '' — i.e. "no Worker URL configured" for every case here.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

async function loadRouter() {
  vi.resetModules();                       // fresh module state per test
  const mod = await import('../../src/renderer/js/ai-router.js');
  return mod.AIRouter;
}

// Stub the module's `Ollama` global with a controllable ping().
function stubOllama(up) {
  globalThis.Ollama = { ping: vi.fn(async () => up) };
}

let savedOllama;
beforeEach(() => { savedOllama = globalThis.Ollama; });
afterEach(() => { globalThis.Ollama = savedOllama; vi.restoreAllMocks(); });

describe('AIRouter.resolveBackend — Ollama fallback when cloud is unconfigured', () => {
  it('explicit cloud pref + no Worker URL → cloud (unchanged)', async () => {
    const AIRouter = await loadRouter();
    AIRouter.setRoutingPrefs({ groupTabs: 'cloud' });
    stubOllama(true); // even with Ollama up, an explicit cloud pref stays cloud
    expect(await AIRouter.resolveBackend('groupTabs')).toBe('cloud');
  });

  it('forced cloud + no Worker URL → cloud (unchanged)', async () => {
    const AIRouter = await loadRouter();
    AIRouter.setForceCloud(true);
    stubOllama(true);
    expect(await AIRouter.resolveBackend('groupTabs')).toBe('cloud');
  });

  it('auto + no Worker URL + Ollama up → local (live ping)', async () => {
    const AIRouter = await loadRouter();
    stubOllama(true); // groupTabs defaults to 'auto'
    expect(await AIRouter.resolveBackend('groupTabs')).toBe('local');
    expect(globalThis.Ollama.ping).toHaveBeenCalled();
  });

  it('auto + no Worker URL + Ollama down → cloud', async () => {
    const AIRouter = await loadRouter();
    stubOllama(false);
    expect(await AIRouter.resolveBackend('groupTabs')).toBe('cloud');
  });

  it('callAI auto + no Worker URL + Ollama down → surfaces "not configured"', async () => {
    const AIRouter = await loadRouter();
    stubOllama(false);
    await expect(AIRouter.callAI('groupTabs', { tabs: [] })).rejects.toThrow(/not configured/i);
  });
});

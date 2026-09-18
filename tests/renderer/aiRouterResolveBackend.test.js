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

let savedOllama, savedWebLLM;
beforeEach(() => { savedOllama = globalThis.Ollama; savedWebLLM = globalThis.WebLLM; });
afterEach(() => { globalThis.Ollama = savedOllama; globalThis.WebLLM = savedWebLLM; vi.restoreAllMocks(); });

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

describe('AIRouter.resolveBackend — on-device (WebLLM) routing', () => {
  function stubWebLLM({ preferred, loaded }) {
    globalThis.WebLLM = { preferred: () => preferred, isLoaded: () => loaded };
  }

  it('chat → ondevice when WebLLM is preferred AND a model is loaded', async () => {
    const AIRouter = await loadRouter();
    stubOllama(true);
    stubWebLLM({ preferred: true, loaded: true });
    expect(await AIRouter.resolveBackend('chat')).toBe('ondevice');
  });

  it('does NOT route to ondevice when no model is loaded', async () => {
    const AIRouter = await loadRouter();
    stubOllama(true);
    stubWebLLM({ preferred: true, loaded: false });
    expect(await AIRouter.resolveBackend('chat')).not.toBe('ondevice');
  });

  it('does NOT route agent to ondevice even when loaded (small models stay off agent)', async () => {
    const AIRouter = await loadRouter();
    stubOllama(true);
    stubWebLLM({ preferred: true, loaded: true });
    expect(await AIRouter.resolveBackend('agent')).not.toBe('ondevice');
  });

  it('ignored entirely when preference is off', async () => {
    const AIRouter = await loadRouter();
    stubOllama(true);
    stubWebLLM({ preferred: false, loaded: true });
    expect(await AIRouter.resolveBackend('chat')).not.toBe('ondevice');
  });
});

// The agent prefers the cloud model, but it used to be cloud-ONLY: with no AI
// Worker URL it answered "Cloud AI is not configured" even with a capable
// local model running.
describe('AIRouter.resolveBackend — the agent without a cloud worker', () => {
  it('no Worker URL + Ollama up → the local model drives the agent', async () => {
    const AIRouter = await loadRouter();
    stubOllama(true);
    expect(await AIRouter.resolveBackend('agent')).toBe('local');
  });

  it('no Worker URL + no Ollama → cloud, which says it is not configured', async () => {
    const AIRouter = await loadRouter();
    stubOllama(false);
    expect(await AIRouter.resolveBackend('agent')).toBe('cloud');
  });

  it('asks the local model with a large context window, the tools, and the page state', async () => {
    const AIRouter = await loadRouter();
    const chat = vi.fn(async () => '{"tool":"finish","parameters":{"summary":"ok"}}');
    globalThis.Ollama = { ping: vi.fn(async () => true), chat };
    const out = await AIRouter.callAI('agent', {
      userGoal: 'research vex', availableTools: [{ name: 'web_search' }], lastToolResult: { ok: true, result: 'x' },
      conversationHistory: [{ role: 'user', content: 'GUIDE' }], pageContext: null,
    });
    expect(out).toMatchObject({ backend: 'local' });
    const [, msgs, opts] = chat.mock.calls[0];
    expect(opts).toMatchObject({ format: 'json', numCtx: 16384, temperature: 0.2 });
    expect(msgs[0].role).toBe('system');
    expect(msgs[0].content).toMatch(/Reply with ONLY one JSON object/);
    expect(msgs[0].content).toContain('"web_search"');
    expect(msgs[1]).toEqual({ role: 'user', content: 'GUIDE' });
    expect(msgs.at(-1).content).toMatch(/User's goal: research vex[\s\S]*Current page: none loaded[\s\S]*Last tool result/);
  });
});

// A screenshot the agent asked for, Stop, and the Settings model test.
describe('AIRouter — the local agent: images, Stop, a named model', () => {
  const ask = { userGoal: 'look', availableTools: [], conversationHistory: [], pageContext: null, image: 'data:image/jpeg;base64,PIXELS' };

  it('a model with vision gets the image as bare base64 on the last message', async () => {
    const AIRouter = await loadRouter();
    const chat = vi.fn(async () => '{"tool":"finish","parameters":{"summary":"ok"}}');
    const show = vi.fn(async () => ({ capabilities: ['completion', 'vision'] }));
    globalThis.Ollama = { ping: vi.fn(async () => true), chat, show };
    await AIRouter.callAI('agent', ask);
    await AIRouter.callAI('agent', ask);
    const [, msgs] = chat.mock.calls[0];
    expect(msgs.at(-1).images).toEqual(['PIXELS']);
    expect(msgs.at(-1).content).toMatch(/A screenshot of the current page is attached/);
    expect(show).toHaveBeenCalledTimes(1);          // asked once per model
  });

  it('a model without vision is told it cannot see, and gets no image', async () => {
    const AIRouter = await loadRouter();
    const chat = vi.fn(async () => '{"tool":"finish","parameters":{"summary":"ok"}}');
    globalThis.Ollama = { ping: vi.fn(async () => true), chat, show: vi.fn(async () => ({ capabilities: ['completion'] })) };
    await AIRouter.callAI('agent', ask);
    const [, msgs] = chat.mock.calls[0];
    expect('images' in msgs.at(-1)).toBe(false);
    expect(msgs.at(-1).content).toMatch(/cannot see images. Use extract_text and extract_elements/);
  });

  it('Stop travels to Ollama, and a stopped call is not retried on another backend', async () => {
    const AIRouter = await loadRouter();
    const ctl = new AbortController();
    const chat = vi.fn(async (_m, _msgs, opts) => { expect(opts.signal).toBe(ctl.signal); ctl.abort(new Error('Stopped by you')); throw new Error('aborted'); });
    globalThis.Ollama = { ping: vi.fn(async () => true), chat };
    const fetchSpy = globalThis.fetch = vi.fn();
    await expect(AIRouter.callAI('agent', { ...ask, image: null, signal: ctl.signal })).rejects.toThrow('aborted');
    expect(chat).toHaveBeenCalledTimes(1);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('localAgent asks a NAMED model, with the context size from Settings', async () => {
    const AIRouter = await loadRouter();
    const chat = vi.fn(async () => '{"tool":"web_search","parameters":{"query":"x"}}');
    globalThis.Ollama = { ping: vi.fn(async () => true), chat };
    expect(AIRouter.agentNumCtx()).toBe(16384);
    const store = new Map();
    globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)) };
    localStorage.setItem('vex.agentNumCtx', '32768');
    expect(AIRouter.agentNumCtx()).toBe(32768);
    const onMeta = vi.fn();
    const out = await AIRouter.localAgent({ userGoal: 'x', availableTools: [], conversationHistory: [], onMeta }, 'gemma3:4b');
    expect(out).toMatchObject({ backend: 'local', model: 'gemma3:4b' });
    expect(chat.mock.calls[0][0]).toBe('gemma3:4b');
    expect(chat.mock.calls[0][2]).toMatchObject({ numCtx: 32768, onMeta });
    localStorage.setItem('vex.agentNumCtx', '12345');
    expect(AIRouter.agentNumCtx()).toBe(16384);      // not one of the offered sizes
    delete globalThis.localStorage;
  });
});

// After a reboot Ollama is not running. With no AI Worker set, every request
// then failed as "Cloud AI is not configured" until the user opened Ollama by
// hand. The router now asks main to start it (src/main/ollama-launcher.js).
describe('AIRouter — starting Ollama when the local model is wanted', () => {
  let up;
  function setup({ ensure, baseUrl = 'http://localhost:11434' } = {}) {
    up = false;
    globalThis.Ollama = { ping: vi.fn(async () => up), getBaseUrl: () => baseUrl };
    const ollamaEnsure = vi.fn(ensure || (async () => { up = true; return { running: true, started: true }; }));
    globalThis.window = { vex: { ollamaEnsure } };
    return ollamaEnsure;
  }
  afterEach(() => { delete globalThis.window; delete globalThis.localStorage; });

  it('Ollama down + no cloud → it is started, and the request goes local', async () => {
    const AIRouter = await loadRouter();
    const ensure = setup();
    expect(await AIRouter.resolveBackend('chat')).toBe('local');
    expect(await AIRouter.resolveBackend('agent')).toBe('local');
    expect(ensure).toHaveBeenCalledTimes(1);
    expect(ensure).toHaveBeenCalledWith();               // no path, no arguments
  });

  it('when it cannot be started, the old answer stands — and it is not retried for a minute', async () => {
    const AIRouter = await loadRouter();
    const ensure = setup({ ensure: async () => ({ running: false, started: false, error: 'Ollama is not installed' }) });
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(await AIRouter.resolveBackend('chat')).toBe('cloud');
    expect(await AIRouter.resolveBackend('chat')).toBe('cloud');
    expect(ensure).toHaveBeenCalledTimes(1);
  });

  it('switched off in Settings, or pointed at another machine: nothing is started', async () => {
    const store = new Map([['vex.ollamaAutoStart', 'false']]);
    globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)) };
    let AIRouter = await loadRouter();
    let ensure = setup();
    expect(AIRouter.ollamaAutoStart()).toBe(false);
    expect(await AIRouter.resolveBackend('chat')).toBe('cloud');
    expect(ensure).not.toHaveBeenCalled();
    AIRouter.setOllamaAutoStart(true);
    expect(store.get('vex.ollamaAutoStart')).toBe('true');

    AIRouter = await loadRouter();
    ensure = setup({ baseUrl: 'http://192.168.1.20:11434' });
    expect(await AIRouter.resolveBackend('chat')).toBe('cloud');
    expect(ensure).not.toHaveBeenCalled();
  });

  it('a background feature never starts it; a request pinned to local does', async () => {
    const AIRouter = await loadRouter();
    const ensure = setup();
    AIRouter.setRoutingPrefs({ historyIndex: 'local', summarize: 'local' });
    expect(await AIRouter.resolveBackend('historyIndex')).toBe('skip');
    expect(ensure).not.toHaveBeenCalled();
    expect(await AIRouter.resolveBackend('summarize')).toBe('local');
    expect(ensure).toHaveBeenCalledTimes(1);
  });
});

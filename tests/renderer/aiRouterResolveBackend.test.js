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
  // With no Worker URL there is no cloud to prefer: a cloud-preferring feature
  // failed on it first and logged a problem before falling back (2026-09-29).
  it('explicit cloud pref + no Worker URL + Ollama up → local', async () => {
    const AIRouter = await loadRouter();
    AIRouter.setRoutingPrefs({ groupTabs: 'cloud' });
    stubOllama(true);
    expect(await AIRouter.resolveBackend('groupTabs')).toBe('local');
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

  it('callAI auto + no Worker URL + Ollama down → says neither backend is there', async () => {
    const AIRouter = await loadRouter();
    stubOllama(false);
    // Not "switch to local Ollama": the user may be on local already (found 2026-09-29).
    await expect(AIRouter.callAI('groupTabs', { tabs: [] })).rejects.toThrow(/Ollama at http:\/\/127\.0\.0\.1:11434 is not running, and no cloud AI is connected/);
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

  // After a restart no model is in memory: chat still stays on the device
  // (the model is loaded for it) instead of going to the cloud without a word
  // (AI audit 2026-10-10). The background digest does not load one.
  it('chat stays on the device when the switch is on but no model is loaded yet; the digest does not', async () => {
    const AIRouter = await loadRouter();
    stubOllama(true);
    stubWebLLM({ preferred: true, loaded: false });
    expect(await AIRouter.resolveBackend('chat')).toBe('ondevice');
    expect(await AIRouter.resolveBackend('digest')).not.toBe('ondevice');
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

// After a reboot Ollama is not running. Vex never starts it by itself (owner
// rule, 2026-11-07): it asks first, unless "Start Ollama without asking" was
// ticked. The main process refuses a start the window does not mark approved.
describe('AIRouter — Ollama is only started with a person saying so', () => {
  let up, store, confirms;
  function setup({ ensure, baseUrl = 'http://localhost:11434', answer = true, neverClicked = false, stored } = {}) {
    up = false;
    store = new Map(stored || []);
    globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)) };
    globalThis.Ollama = { ping: vi.fn(async () => up), getBaseUrl: () => baseUrl };
    const ollamaEnsure = vi.fn(ensure || (async () => { up = true; return { running: true, started: true }; }));
    confirms = vi.fn(async (o) => { if (neverClicked) o.extra.run(); return neverClicked ? false : answer; });
    globalThis.window = { vex: { ollamaEnsure }, vexConfirm: confirms };
    return ollamaEnsure;
  }
  afterEach(() => { delete globalThis.window; delete globalThis.localStorage; });

  it('the default is off: nothing stored means ask', async () => {
    const AIRouter = await loadRouter();
    setup();
    expect(AIRouter.ollamaAutoStart()).toBe(false);
    expect(AIRouter.ollamaNeverAsk()).toBe(false);
  });

  it('Ollama down + setting off: the person is asked and ensure is NOT called until they say yes', async () => {
    const AIRouter = await loadRouter();
    let release;
    const ensure = setup();
    confirms.mockImplementation(() => new Promise(r => { release = r; }));
    const pending = AIRouter.ollamaUp();
    for (let i = 0; i < 20; i++) await Promise.resolve();
    expect(confirms).toHaveBeenCalledTimes(1);
    expect(confirms.mock.calls[0][0]).toMatchObject({ message: 'Local AI needs Ollama, which is not running. Start it now?', okLabel: 'Start Ollama', cancelLabel: 'Not now' });
    expect(confirms.mock.calls[0][0].extra.label).toBe('Never ask again');
    expect(ensure).not.toHaveBeenCalled();
    release(true);
    expect(await pending).toBe(true);
    expect(ensure).toHaveBeenCalledTimes(1);
    expect(ensure).toHaveBeenCalledWith({ approved: true, reason: 'person-pressed-start' });
  });

  it('Start Ollama: the request goes local, ensure was called once with approved:true', async () => {
    const AIRouter = await loadRouter();
    const ensure = setup();
    expect(await AIRouter.resolveBackend('chat')).toBe('local');
    expect(ensure).toHaveBeenCalledTimes(1);
    expect(ensure).toHaveBeenCalledWith({ approved: true, reason: 'person-pressed-start' });
  });

  it('Not now: ensure is never called, the old answer stands, and it is not asked again at once', async () => {
    const AIRouter = await loadRouter();
    const ensure = setup({ answer: false });
    expect(await AIRouter.resolveBackend('chat')).toBe('cloud');
    expect(await AIRouter.resolveBackend('chat')).toBe('cloud');
    expect(confirms).toHaveBeenCalledTimes(1);
    expect(ensure).not.toHaveBeenCalled();
  });

  it('Never ask again: stored, nothing started, and never asked again', async () => {
    const AIRouter = await loadRouter();
    const ensure = setup({ neverClicked: true });
    expect(await AIRouter.ollamaUp()).toBe(false);
    expect(store.get('vex.ollamaAutoStart')).toBe('"never"');
    expect(AIRouter.ollamaNeverAsk()).toBe(true);
    expect(AIRouter.ollamaAutoStart()).toBe(false);
    expect(ensure).not.toHaveBeenCalled();
    expect(await AIRouter.ollamaUp()).toBe(false);
    expect(confirms).toHaveBeenCalledTimes(1);
    expect(ensure).not.toHaveBeenCalled();
  });

  it('an explicit stored true is honoured: started without asking, reason setting-on', async () => {
    const AIRouter = await loadRouter();
    const ensure = setup({ stored: [['vex.ollamaAutoStart', 'true']] });
    expect(AIRouter.ollamaAutoStart()).toBe(true);
    expect(await AIRouter.resolveBackend('chat')).toBe('local');
    expect(confirms).not.toHaveBeenCalled();
    expect(ensure).toHaveBeenCalledWith({ approved: true, reason: 'setting-on' });
  });

  it('when it cannot be started, the old answer stands — and it is not retried for a minute', async () => {
    const AIRouter = await loadRouter();
    const ensure = setup({ stored: [['vex.ollamaAutoStart', 'true']], ensure: async () => ({ running: false, started: false, error: 'Ollama is not installed' }) });
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(await AIRouter.resolveBackend('chat')).toBe('cloud');
    expect(await AIRouter.resolveBackend('chat')).toBe('cloud');
    expect(ensure).toHaveBeenCalledTimes(1);
  });

  it('pointed at another machine: nothing is asked or started', async () => {
    const AIRouter = await loadRouter();
    const ensure = setup({ baseUrl: 'http://192.168.1.20:11434', stored: [['vex.ollamaAutoStart', 'true']] });
    expect(await AIRouter.resolveBackend('chat')).toBe('cloud');
    expect(ensure).not.toHaveBeenCalled();
    expect(confirms).not.toHaveBeenCalled();
  });

  it('a background feature never opens a dialog or starts it; a request pinned to local asks', async () => {
    const AIRouter = await loadRouter();
    const ensure = setup();
    AIRouter.setRoutingPrefs({ historyIndex: 'local', summarize: 'local' });
    expect(await AIRouter.resolveBackend('historyIndex')).toBe('skip');
    expect(ensure).not.toHaveBeenCalled();
    expect(confirms).not.toHaveBeenCalled();
    expect(await AIRouter.resolveBackend('summarize')).toBe('local');
    expect(confirms).toHaveBeenCalledTimes(1);
    expect(ensure).toHaveBeenCalledTimes(1);
  });

  it('setOllamaAutoStart(true) stores an explicit true', async () => {
    const AIRouter = await loadRouter();
    setup();
    AIRouter.setOllamaAutoStart(true);
    expect(store.get('vex.ollamaAutoStart')).toBe('true');
  });
});

// "Prefer local (privacy-first)" sent translate, history search, multi-tab and
// the agent to the AI Worker anyway: they are routed to the cloud by default,
// and preferLocal was only read on the Auto path.
describe('AIRouter.resolveBackend — Prefer local and Always cloud mean what they say', () => {
  let savedWindow;
  beforeEach(() => {
    savedWindow = globalThis.window;
    globalThis.window = { VexConfig: { aiWorkerUrl: () => 'https://vex-ai.example.workers.dev' } };
  });
  afterEach(() => { globalThis.window = savedWindow; });

  it('with a Worker URL, the cloud-routed features stay local while Ollama runs', async () => {
    const AIRouter = await loadRouter();
    stubOllama(true);
    expect(await AIRouter.resolveBackend('translate')).toBe('cloud');   // not preferring local: as before
    AIRouter.setPreferLocal(true);
    for (const f of ['translate', 'historySearch', 'multiTab', 'agent']) expect(await AIRouter.resolveBackend(f)).toBe('local');
  });

  it('with no local model running they still use the cloud (the setting says so)', async () => {
    const AIRouter = await loadRouter();
    stubOllama(false);
    AIRouter.setPreferLocal(true);
    expect(await AIRouter.resolveBackend('translate')).toBe('cloud');
  });

  it('Always cloud wins over on-device AI', async () => {
    const AIRouter = await loadRouter();
    stubOllama(true);
    globalThis.WebLLM = { preferred: () => true, isLoaded: () => true };
    AIRouter.setForceCloud(true);
    expect(await AIRouter.resolveBackend('chat')).toBe('cloud');
  });
});

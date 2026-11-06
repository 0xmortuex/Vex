// @vitest-environment node
//
// Where "cloud" goes now that there are two clouds (your own key, your Worker): the router's cloud target,
// what each pin means, what planFor() says will answer, and that a request behind your key carries the same
// prompts the local model gets and comes back in the shape the panel renders.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

async function loadRouter(withWorker = false) {
  vi.resetModules();
  globalThis.window = withWorker ? { VexConfig: { aiWorkerUrl: () => 'https://w.example' } } : undefined;
  if (!withWorker) delete globalThis.window;
  const mod = await import('../../src/renderer/js/ai-router.js');
  return mod.AIRouter;
}
const prov = (id, short, over = {}) => ({ id, short, saved: true, models: { default: '', fast: '', best: '' }, ...over });
function stubKeys({ saved = [], source = 'auto', active = '', chat } = {}) {
  const list = saved.map(s => (typeof s === 'string' ? prov(s, s) : s));
  globalThis.AIKeys = {
    available: () => true,
    provider: (id) => list.find(p => p.id === id) || null,
    hasAny: () => list.length > 0,
    active: () => active || (list[0] && list[0].id) || '',
    source: () => source,
    modelFor: () => 'm',
    chat: chat || vi.fn(async () => ({ text: '{"reply":"hi"}', model: 'claude-sonnet-5-5', usage: { input: 5, output: 3 } })),
  };
}
let savedGlobals;
beforeEach(() => {
  savedGlobals = { Ollama: globalThis.Ollama, AIKeys: globalThis.AIKeys, VexAISpend: globalThis.VexAISpend, VexSensitivity: globalThis.VexSensitivity };
  globalThis.Ollama = { ping: vi.fn(async () => false) };
  delete globalThis.AIKeys;
  vi.stubGlobal('navigator', { onLine: true });
});
afterEach(() => { Object.assign(globalThis, savedGlobals); delete globalThis.window; vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('cloudTarget', () => {
  it('nothing connected: no cloud', async () => {
    const r = await loadRouter();
    expect(r.cloudTarget('chat')).toBeNull();
    expect(r.cloudConfigured('chat')).toBe(false);
  });
  it('a saved key is the cloud in Auto, ahead of a Worker', async () => {
    const r = await loadRouter(true);
    stubKeys({ saved: ['anthropic'] });
    expect(r.cloudTarget('chat')).toEqual({ kind: 'key', provider: 'anthropic' });
  });
  it('only a Worker: the Worker, exactly as before', async () => {
    const r = await loadRouter(true);
    stubKeys({ saved: [] });
    expect(r.cloudTarget('chat')).toEqual({ kind: 'worker' });
  });
  it('the cloud source setting can force one or the other', async () => {
    const r = await loadRouter(true);
    stubKeys({ saved: ['anthropic', 'openai'], source: 'worker' });
    expect(r.cloudTarget('chat')).toEqual({ kind: 'worker' });
    stubKeys({ saved: ['anthropic', 'openai'], source: 'key', active: 'openai' });
    expect(r.cloudTarget('chat')).toEqual({ kind: 'key', provider: 'openai' });
    stubKeys({ saved: [], source: 'key' });
    expect(r.cloudTarget('chat')).toBeNull();
  });
  it('a per-feature pin names its cloud: key:<provider> or worker', async () => {
    const r = await loadRouter(true);
    stubKeys({ saved: ['anthropic', 'gemini'] });
    r.setRoutingPrefs({ summarize: 'key:gemini', agent: 'worker', chat: 'key:openai' });
    expect(r.cloudTarget('summarize')).toEqual({ kind: 'key', provider: 'gemini' });
    expect(r.cloudTarget('agent')).toEqual({ kind: 'worker' });
    // A pin to a key that is not saved here (it came with a sync) is said, not quietly rerouted.
    expect(r.cloudTarget('chat')).toEqual({ kind: 'missing-key', provider: 'openai' });
  });
  it('the pins count as "cloud" for the routing decision', async () => {
    const r = await loadRouter();
    stubKeys({ saved: ['anthropic'] });
    r.setRoutingPrefs({ summarize: 'key:anthropic' });
    expect(await r.resolveBackend('summarize')).toBe('cloud');
    expect(await r.resolveBackend('chat')).toBe('cloud');
  });
  it('with no cloud and no Ollama, Auto still points at cloud (the error says how to connect one)', async () => {
    const r = await loadRouter();
    expect(await r.resolveBackend('chat')).toBe('cloud');
    stubKeys({ saved: [] });
    await expect(r.callAI('chat', { message: 'hi' })).rejects.toThrow(/Connect an AI/);
  });
});

describe('planFor: what answers right now', () => {
  it('your key for chat, Ollama for the background jobs pinned to local', async () => {
    const r = await loadRouter();
    stubKeys({ saved: ['anthropic'] });
    globalThis.Ollama = { ping: vi.fn(async () => true) };
    await r.refreshOllamaStatus().catch(() => {});
    expect(r.planFor('chat')).toEqual({ backend: 'cloud', via: 'key', provider: 'anthropic' });
    expect(r.planFor('historyIndex')).toEqual({ backend: 'local' });
  });
  it('a local-pinned feature with Ollama off has nothing; nothing at all says none', async () => {
    const r = await loadRouter();
    expect(r.planFor('historyIndex')).toEqual({ backend: 'none' });
    expect(r.planFor('chat')).toEqual({ backend: 'none' });
  });
  it('Always cloud and Prefer local are respected', async () => {
    const r = await loadRouter(true);
    stubKeys({ saved: ['openai'] });
    r.setForceCloud(true);
    expect(r.planFor('historyIndex')).toEqual({ backend: 'cloud', via: 'key', provider: 'openai' });
  });
});

describe('a request behind your key', () => {
  it('goes through the sensitivity gate and the spend reservation like the Worker, and carries the local prompts', async () => {
    const r = await loadRouter();
    const chat = vi.fn(async () => ({ text: '{"reply":"ok"}', model: 'claude-sonnet-5-5', usage: { input: 5, output: 3 } }));
    stubKeys({ saved: ['anthropic'], chat });
    const reserve = vi.fn(() => ({ id: 1 }));
    globalThis.VexAISpend = { reserve, release: vi.fn(), routing: () => false, reached: () => false };
    const out = await r.callOn('cloud', 'chat', { message: 'what is this', pageContext: { title: 'T', url: 'https://x.example', text: 'body' }, conversationHistory: [{ role: 'user', content: 'before' }, { role: 'assistant', content: 'earlier' }] });
    expect(out).toMatchObject({ result: '{"reply":"ok"}', backend: 'cloud', via: 'key', provider: 'anthropic', model: 'claude-sonnet-5-5', usage: { input: 5, output: 3 } });
    expect(reserve).toHaveBeenCalledWith('chat');
    const call = chat.mock.calls[0][0];
    expect(call).toMatchObject({ provider: 'anthropic', feature: 'chat' });
    expect(call.messages[0].role).toBe('system');
    expect(call.messages[0].content).toMatch(/Vex AI/);
    expect(call.messages.at(-1).content).toMatch(/Page title: T[\s\S]*User: what is this/);
    expect(call.messages.map(m => m.role)).toEqual(['system', 'user', 'assistant', 'user']);
  });
  it('the agent gets the tool list in its prompt and answers as one JSON object, as for Ollama and the Worker', async () => {
    const r = await loadRouter();
    const chat = vi.fn(async () => ({ text: '{"tool":"finish"}', model: 'm', usage: {} }));
    stubKeys({ saved: ['openai'], chat });
    await r.callOn('cloud', 'agent', { userGoal: 'open example.com', availableTools: [{ name: 'navigate' }], pageContext: { url: 'u', title: 't' }, lastToolResult: { ok: true } });
    const msgs = chat.mock.calls[0][0].messages;
    expect(msgs[0].content).toMatch(/Available tools:\n\[\{"name":"navigate"\}\]/);
    expect(msgs.at(-1).content).toMatch(/User's goal: open example\.com[\s\S]*Reply with ONE JSON object/);
    expect(chat.mock.calls[0][0].maxTokens).toBe(3000);
  });
  it('a feature the provider cannot serve says so plainly: a picture question needs a vision model', async () => {
    const r = await loadRouter();
    stubKeys({ saved: [prov('gemini', 'Gemini')] });
    // The sensitivity gate (tested elsewhere) has let the picture through: the provider itself cannot take it.
    globalThis.VexSensitivity = { gate: async (_f, req) => ({ action: 'send', request: req }), decide: () => ({ verdict: 'send' }) };
    await expect(r.callOn('cloud', 'chat', { message: 'what is in this', image: 'data:image/png;base64,AAAA' })).rejects.toThrow(/picture does not work with your Gemini key/);
  });
  it('a pin to a key that is not saved here raises a clear error instead of sending anywhere', async () => {
    const r = await loadRouter();
    stubKeys({ saved: ['anthropic'] });
    r.setRoutingPrefs({ chat: 'key:openai' });
    await expect(r.callOn('cloud', 'chat', { message: 'hi' })).rejects.toThrow(/no key is saved on this computer/);
  });
  it('a provider failure carries its explanation up to the panel', async () => {
    const r = await loadRouter();
    const err = Object.assign(new Error('Claude did not accept your API key.'), { byok: { code: 'invalid-key', fix: 'settings' } });
    stubKeys({ saved: ['anthropic'], chat: vi.fn(async () => { throw err; }) });
    await expect(r.callAI('chat', { message: 'hi' })).rejects.toMatchObject({ byok: { code: 'invalid-key' } });
  });
});

// @vitest-environment jsdom
//
// The window's side of "bring your own key": js/ai-keys.js (status, tiers, errors in plain words, streamed chat, the
// session meter), the Settings section (js/ai-connect.js) and the AI panel's bar (js/ai-bar.js). The window never holds
// a key: these tests give it a fake bridge and check what it sends and what it shows.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const KEY = 'sk-ant-api03-SECRETSECRETSECRET1234';
const status = (over = {}) => ({
  testHost: false,
  prices: { asOf: '2026-10-06', note: 'Estimates from public list prices as of 2026-10-06. A price you write in Settings wins. Not a bill.', rows: [{ model: 'claude-sonnet-5-5', inPerM: 2, outPerM: 10 }, { model: 'claude-haiku-5-5', inPerM: 0.1, outPerM: 0.5 }] },
  providers: ['anthropic', 'openai', 'gemini', 'openrouter', 'custom'].map(id => ({ id, name: id, short: { anthropic: 'Claude', openai: 'OpenAI', gemini: 'Gemini', openrouter: 'OpenRouter', custom: 'Custom' }[id], keyUrl: 'https://keys.example/' + id, keyHint: 'sk-...', needsBaseUrl: id === 'custom', defaultBaseUrl: '', saved: false, last4: '', hasKey: false, savedAt: 0, baseUrl: '', models: { default: '', fast: '', best: '' }, ...((over[id]) || {}) })),
});
const saved = (o = {}) => ({ saved: true, hasKey: true, last4: '1234', models: { default: 'claude-sonnet-5-5', fast: 'claude-haiku-5-5', best: 'claude-opus-5-5' }, ...o });

let listeners, bridge;
function setBridge(st) {
  listeners = [];
  bridge = {
    aiKeyStatus: vi.fn(async () => st),
    aiKeySet: vi.fn(async () => ({ ok: true })),
    aiKeyClear: vi.fn(async () => ({ ok: true })),
    aiKeySetModels: vi.fn(async () => ({ ok: true })),
    aiKeyModels: vi.fn(async () => ({ ok: true, source: 'live', note: '', models: [{ id: 'claude-sonnet-5-5', name: 'Claude Sonnet 5.5' }, { id: 'claude-opus-5-5', name: 'Claude Opus 5.5' }, { id: 'claude-haiku-5-5', name: 'Claude Haiku 5.5' }], recommended: { best: 'claude-opus-5-5', default: 'claude-sonnet-5-5', fast: 'claude-haiku-5-5' } })),
    aiKeyTest: vi.fn(async () => ({ ok: true, count: 3, ms: 120 })),
    aiKeyChat: vi.fn(async () => ({ ok: true, text: 'Hello', model: 'claude-sonnet-5-5', usage: { input: 1000, output: 500 } })),
    aiKeyCancel: vi.fn(async () => true),
    onAiKeyEvent: vi.fn((cb) => { listeners.push(cb); return () => {}; }),
  };
  window.vex = bridge;
}
async function load() {
  vi.resetModules();
  const { AIKeys } = await import('../../src/renderer/js/ai-keys.js');
  globalThis.AIKeys = AIKeys;
  return AIKeys;
}
beforeEach(() => { localStorage.clear(); document.body.innerHTML = ''; });
afterEach(() => { delete globalThis.AIKeys; delete globalThis.AIRouter; delete globalThis.VexAIMoney; delete window.vex; vi.restoreAllMocks(); });

describe('AIKeys: status and choices', () => {
  it('lists what is saved, picks the active provider, and never holds a key', async () => {
    setBridge(status({ anthropic: saved(), openai: saved({ last4: '9999', models: { default: 'gpt-5', fast: '', best: '' } }) }));
    const K = await load();
    expect(K.hasAny()).toBe(false);
    await K.refresh();
    expect(K.saved().map(p => p.id)).toEqual(['anthropic', 'openai']);
    expect(K.active()).toBe('anthropic');
    K.setActive('openai');
    expect(K.active()).toBe('openai');
    expect(JSON.stringify(K.status())).not.toContain('SECRET');
    expect(() => K.setActive('nope')).toThrow(/Unknown/);
  });
  it('the cloud source is auto, key or worker and nothing else', async () => {
    setBridge(status());
    const K = await load();
    expect(K.source()).toBe('auto');
    K.setSource('worker');
    expect(K.source()).toBe('worker');
    expect(() => K.setSource('both')).toThrow();
    localStorage.setItem('vex.aiCloudSource', 'junk');
    expect(() => K.source()).toThrow(/not auto, key or worker/);
  });
  it('features map to the best, balanced and fast model of the provider', async () => {
    setBridge(status({ anthropic: saved() }));
    const K = await load();
    await K.refresh();
    expect(K.modelFor('anthropic', 'agent')).toBe('claude-opus-5-5');
    expect(K.modelFor('anthropic', 'multiTab')).toBe('claude-opus-5-5');
    expect(K.modelFor('anthropic', 'chat')).toBe('claude-sonnet-5-5');
    expect(K.modelFor('anthropic', 'historyIndex')).toBe('claude-haiku-5-5');
    expect(K.modelFor('anthropic', 'groupTabs')).toBe('claude-haiku-5-5');
  });
  it('an empty slot uses the recommended model once the list is known', async () => {
    setBridge(status({ anthropic: saved({ models: { default: '', fast: '', best: '' } }) }));
    const K = await load();
    await K.refresh();
    expect(K.modelFor('anthropic', 'chat')).toBe('');
    await K.models('anthropic');
    expect(K.modelFor('anthropic', 'chat')).toBe('claude-sonnet-5-5');
    expect(K.prettyModel('anthropic', 'claude-sonnet-5-5')).toBe('Claude Sonnet 5.5');
  });
  it('built-in prices are estimates by model and prefix; unknown models have none', async () => {
    setBridge(status());
    const K = await load();
    await K.refresh();
    expect(K.builtinRate('claude-sonnet-5-5')).toMatchObject({ inPerM: 2 });
    expect(K.builtinRate('claude-haiku-5-5-20261001')).toMatchObject({ inPerM: 0.1 });
    expect(K.builtinRate('gpt-5')).toBeNull();
    expect(K.pricesNote()).toMatch(/Estimates/);
  });
});

describe('AIKeys: failures in plain words, with the fix', () => {
  it.each([
    [{ code: 'invalid-key', provider: 'anthropic', detail: 'invalid x-api-key' }, /did not accept your API key.*invalid x-api-key/, 'settings'],
    [{ code: 'rate-limit', provider: 'openai', retryAfter: 17 }, /too many requests\. Try again in 17 seconds/, 'retry'],
    [{ code: 'quota', provider: 'openai' }, /credit or quota is used up/, 'settings'],
    [{ code: 'model', provider: 'gemini' }, /does not offer the chosen model/, 'settings'],
    [{ code: 'overloaded', provider: 'anthropic', status: 529 }, /busy or down right now \(error 529\)/, 'retry'],
    [{ code: 'network', provider: 'anthropic' }, /could not reach Claude/, 'retry'],
    [{ code: 'no-model', provider: 'anthropic' }, /No model is chosen/, 'settings'],
  ])('%j', async (info, text, fix) => {
    setBridge(status({ anthropic: saved(), openai: saved(), gemini: saved() }));
    const K = await load();
    await K.refresh();
    const x = K.explain(info);
    expect(x.text).toMatch(text);
    expect(x.fix).toBe(fix);
  });
  it('is said in Turkish when the table has the sentence', async () => {
    setBridge(status({ anthropic: saved() }));
    const K = await load();
    await K.refresh();
    window.vexTr = (t) => (t === 'Vex could not reach {1}. Check your internet connection.' ? '{1} sunucusuna ulaşılamadı. İnternet bağlantınızı kontrol edin.' : t);
    expect(K.explain({ code: 'network', provider: 'anthropic' }).text).toBe('Claude sunucusuna ulaşılamadı. İnternet bağlantınızı kontrol edin.');
    delete window.vexTr;
  });
});

describe('AIKeys.chat', () => {
  it('sends the tier, streams pieces to onToken, returns the answer and counts the session with a price estimate', async () => {
    setBridge(status({ anthropic: saved() }));
    const K = await load();
    await K.refresh();
    bridge.aiKeyChat.mockImplementation(async (req) => {
      listeners.forEach(l => l({ id: req.id, type: 'delta', text: 'Hel' }));
      listeners.forEach(l => l({ id: req.id, type: 'delta', text: 'lo' }));
      listeners.forEach(l => l({ id: 'someone-else', type: 'delta', text: 'NO' }));
      return { ok: true, text: 'Hello', model: 'claude-sonnet-5-5', usage: { input: 1000, output: 500 } };
    });
    const got = [];
    const out = await K.chat({ provider: 'anthropic', feature: 'agent', messages: [{ role: 'user', content: 'hi' }], onToken: (piece, full) => got.push([piece, full]) });
    expect(out).toMatchObject({ text: 'Hello', model: 'claude-sonnet-5-5', provider: 'anthropic' });
    expect(got).toEqual([['Hel', 'Hel'], ['lo', 'Hello']]);
    expect(bridge.aiKeyChat.mock.calls[0][0]).toMatchObject({ provider: 'anthropic', tier: 'best' });
    const s = K.session();
    expect(s).toMatchObject({ calls: 1, tokensIn: 1000, tokensOut: 500, unknown: 0 });
    expect(s.money).toBeCloseTo((1000 * 2 + 500 * 10) / 1e6, 8);
  });
  it('a model with no price counts as cost unknown, not as zero', async () => {
    setBridge(status({ anthropic: saved() }));
    const K = await load();
    await K.refresh();
    bridge.aiKeyChat.mockResolvedValue({ ok: true, text: 'x', model: 'some-new-model', usage: { input: 10, output: 10 } });
    await K.chat({ provider: 'anthropic', feature: 'chat', messages: [{ role: 'user', content: 'hi' }] });
    expect(K.session()).toMatchObject({ calls: 1, money: 0, unknown: 1 });
  });
  it('a failure becomes an Error that carries its explanation; Stop cancels in main and throws "Stopped"', async () => {
    setBridge(status({ anthropic: saved() }));
    const K = await load();
    await K.refresh();
    bridge.aiKeyChat.mockResolvedValue({ ok: false, error: { code: 'rate-limit', provider: 'anthropic', retryAfter: 9 } });
    const err = await K.chat({ provider: 'anthropic', feature: 'chat', messages: [{ role: 'user', content: 'x' }] }).catch(e => e);
    expect(err.byok).toMatchObject({ code: 'rate-limit', retryAfter: 9, fix: 'retry' });
    expect(err.message).toMatch(/9 seconds/);
    const ctl = new AbortController();
    bridge.aiKeyChat.mockImplementation(() => new Promise(resolve => { ctl.signal.addEventListener('abort', () => resolve({ ok: false, stopped: true })); }));
    const p = K.chat({ provider: 'anthropic', feature: 'chat', messages: [{ role: 'user', content: 'x' }], signal: ctl.signal });
    ctl.abort();
    await expect(p).rejects.toThrow('Stopped');
    expect(bridge.aiKeyCancel).toHaveBeenCalledTimes(1);
    await expect(K.chat({ provider: 'anthropic', feature: 'chat', messages: [], signal: ctl.signal })).rejects.toThrow('Stopped');
  });
});

describe('Settings > Connect an AI', () => {
  async function build(st) {
    setBridge(st);
    const K = await load();
    await K.refresh();
    globalThis.AIRouter = {
      planFor: (f) => (K.hasAny() ? { backend: 'cloud', via: 'key', provider: K.active() } : { backend: 'none' }),
      getOllamaStatus: () => ({ available: false, model: '' }), getModel: () => '', modelFor: () => '', cloudWorkerUrl: () => '', ollamaUp: async () => false,
    };
    globalThis.VexSettingsGroups = { register: vi.fn(), follow: vi.fn() };
    globalThis.window.vexConfirm = vi.fn(async () => true);
    const { AIConnect } = await import('../../src/renderer/js/ai-connect.js');
    const el = document.createElement('div');
    el.id = 'vex-sg-ai-connect';
    document.body.appendChild(el);
    AIConnect.group(el);
    return { AIConnect, el, K };
  }
  it('with no key: the three cards, the overview says nothing is connected, and the key box is a password field', async () => {
    const { el } = await build(status());
    expect([...el.querySelectorAll('[data-card]')].map(c => c.dataset.card)).toEqual(['ollama', 'key', 'worker']);
    expect(el.querySelector('.aic-overview').textContent).toMatch(/nothing is connected/);
    const input = el.querySelector('#aic-key-input');
    expect(input.type).toBe('password');
    expect(input.autocomplete).toBe('new-password');
    expect(el.querySelectorAll('.aic-tab').length).toBe(5);
    expect(el.querySelector('details[data-card="worker"]')).toBeTruthy();
  });
  it('Save key sends the key once, clears the field, tests it and chooses the recommended models', async () => {
    const st = status();
    const { el } = await build(st);
    el.querySelector('#aic-key-input').value = KEY;
    bridge.aiKeySet.mockImplementation(async () => { st.providers[0] = { ...st.providers[0], ...saved({ models: { default: '', fast: '', best: '' } }) }; return { ok: true }; });
    [...el.querySelectorAll('button')].find(b => b.textContent === 'Save key').click();
    await vi.waitFor(() => expect(bridge.aiKeySetModels).toHaveBeenCalled());
    expect(bridge.aiKeySet).toHaveBeenCalledWith({ provider: 'anthropic', key: KEY, baseUrl: undefined });
    expect(bridge.aiKeyTest).toHaveBeenCalledWith('anthropic');
    expect(bridge.aiKeySetModels.mock.calls[0][0]).toEqual({ provider: 'anthropic', models: { default: 'claude-sonnet-5-5', fast: 'claude-haiku-5-5', best: 'claude-opus-5-5' } });
    await vi.waitFor(() => expect(el.textContent).toMatch(/Key saved/));
    // After saving the page shows how the key ends and never the key.
    expect(el.textContent).toContain('...1234');
    expect(el.textContent).not.toContain('SECRET');
    expect(el.querySelector('#aic-key-input')).toBeNull();
  });
  it('a refused key (the main process throws) is shown beside the field, with the field kept', async () => {
    const { el } = await build(status());
    bridge.aiKeySet.mockRejectedValue(new Error("Error invoking remote method 'aikey:set-key': Error: That is too short to be a Claude API key."));
    el.querySelector('#aic-key-input').value = 'abc';
    [...el.querySelectorAll('button')].find(b => b.textContent === 'Save key').click();
    await vi.waitFor(() => expect(el.querySelector('.aic-error:not([hidden])')).toBeTruthy());
    expect(el.querySelector('.aic-error').textContent).toBe('That is too short to be a Claude API key.');
    expect(el.querySelector('#aic-key-input').value).toBe('abc');
  });
  it('a saved key shows Test key, Replace, Remove, the models with price estimates, and the monthly limit', async () => {
    globalThis.VexAIMoney = { rateFor: (m) => (m === 'claude-sonnet-5-5' ? { model: m, inPerM: 2, outPerM: 10 } : null), currency: () => 'USD', moneyCap: () => 5, setMoneyCap: vi.fn(), line: () => 'About 0 USD spent', _fmt: String, spent: () => 0 };
    const { el } = await build(status({ anthropic: saved() }));
    await vi.waitFor(() => expect(el.querySelector('#aic-model-anthropic-best')).toBeTruthy());
    const labels = [...el.querySelectorAll('button')].map(b => b.textContent);
    expect(labels).toEqual(expect.arrayContaining(['Test key', 'Replace key', 'Remove key']));
    expect(el.querySelector('#aic-model-anthropic-default').value).toBe('claude-sonnet-5-5');
    expect(el.querySelector('#aic-model-anthropic-default').closest('.aic-model-row').textContent).toMatch(/about 2 in \/ 10 out per million tokens \(an estimate\)/);
    expect(el.querySelector('#aic-model-anthropic-best').closest('.aic-model-row').textContent).toMatch(/cost unknown/);
    expect(el.querySelector('#aic-cap-input').value).toBe('5');
    expect(el.textContent).toContain('Claude Sonnet 5.5 with your key');
  });
  it('Remove key asks first, then removes it in main', async () => {
    const st = status({ anthropic: saved() });
    const { el } = await build(st);
    bridge.aiKeyClear.mockImplementation(async () => { st.providers[0] = { ...st.providers[0], saved: false, hasKey: false, last4: '' }; return { ok: true }; });
    [...el.querySelectorAll('button')].find(b => b.textContent === 'Remove key').click();
    await vi.waitFor(() => expect(bridge.aiKeyClear).toHaveBeenCalledWith('anthropic'));
    expect(window.vexConfirm).toHaveBeenCalled();
  });
  it('a list that could not be fetched says so plainly', async () => {
    const { el } = await build(status({ anthropic: saved() }));
    await vi.waitFor(() => expect([...el.querySelectorAll('button')].some(b => b.textContent === 'Refresh the list')).toBe(true));
    bridge.aiKeyModels.mockClear();
    bridge.aiKeyModels.mockResolvedValue({ ok: false, source: 'fallback', note: 'list unavailable, showing known models', models: [{ id: 'claude-opus-5-5', name: 'Claude Opus 5.5' }], recommended: {}, error: { code: 'network' } });
    [...el.querySelectorAll('button')].find(b => b.textContent === 'Refresh the list').click();
    await vi.waitFor(() => expect(bridge.aiKeyModels).toHaveBeenCalledWith('anthropic', true));
    await vi.waitFor(() => expect(el.textContent).toMatch(/list unavailable, showing known models/));
  });
  it('test mode shows a banner so nobody mistakes the stand-in server for the provider', async () => {
    const { el } = await build({ ...status(), testHost: true });
    expect(el.textContent).toMatch(/Test mode: requests go to a stand-in server/);
  });
});

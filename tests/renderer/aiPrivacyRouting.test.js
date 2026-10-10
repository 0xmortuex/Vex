// @vitest-environment jsdom
// AI audit (2026-10-10): private tabs sent to the AI by "Organize tabs" and
// "AI Tab Command".
import { beforeEach, describe, expect, it, vi } from 'vitest';

require('../../src/renderer/js/vex-utils.js');
require('../../src/renderer/js/data-contracts.js');
require('../../src/renderer/js/tab-policy.js');

beforeEach(() => { localStorage.clear(); document.body.innerHTML = ''; window.showToast = vi.fn(); });

function tabsWithATorTab() {
  return [
    { id: 'a', url: 'https://github.com/x', title: 'GitHub repo' },
    { id: 'b', url: 'https://docs.github.com/y', title: 'GitHub docs' },
    { id: 'c', url: 'https://news.example/z', title: 'News' },
    { id: 'tor', url: 'https://secretforum.example/thread/42', title: 'My secret Tor tab', partition: 'tor-1' },
    { id: 'otr', url: 'https://bank.example/statements', title: 'Off the record tab', partition: 'otr-1' },
  ];
}

describe('Tab grouping with AI', () => {
  it('"Organize Tabs with AI" does not send Tor / off-the-record tabs to the AI', async () => {
    globalThis.TabManager = { tabs: tabsWithATorTab(), groups: [], activeTabId: 'a', mayAskSiteForIcon: () => false };
    let sent = null;
    globalThis.AIRouter = { callAI: vi.fn(async (_f, req) => { sent = req; return { result: JSON.stringify({ groups: [], ungrouped: [], reasoning: 'none' }) }; }) };
    const { TabGrouper } = require('../../src/renderer/js/tab-grouper.js');
    await TabGrouper.analyzeAndPropose();
    const titles = sent.tabs.map(t => t.title);
    expect(titles).toContain('GitHub repo');
    expect(titles).not.toContain('My secret Tor tab');
    expect(titles).not.toContain('Off the record tab');
  });

  it('"AI Tab Command" does not send Tor / off-the-record tab URLs to the AI', async () => {
    globalThis.TabManager = { tabs: tabsWithATorTab(), groups: [], activeTabId: 'a' };
    let sent = null;
    globalThis.AIRouter = { callAI: vi.fn(async (_f, req) => { sent = req; return { result: '{"close":["tor"],"groups":[],"explanation":"x"}' }; }) };
    const { TabAI } = require('../../src/renderer/js/tab-ai-media.js');
    TabAI.open();
    document.getElementById('tai-q').value = 'close my forum tabs';
    const m = document.getElementById('vex-tabai-modal');
    await TabAI._plan(m);
    expect(sent.message).toContain('github.com');
    expect(sent.message).not.toContain('secretforum.example');
    expect(sent.message).not.toContain('bank.example');
    // A guessed id of a private tab is not acted on either.
    expect(m._applyPlan).toBeFalsy();
  });
});

describe('On-device AI after a restart', () => {
  function freshRouter() {
    vi.resetModules();
    window.VexConfig = { aiWorkerUrl: () => 'https://my-worker.example.workers.dev' };
    globalThis.VexJobs = { every: () => ({ stop() {} }) };
    globalThis.Ollama = { ping: async () => false, getBaseUrl: () => 'http://localhost:11434' };
    return require('../../src/renderer/js/ai-router.js').AIRouter;
  }

  it('"Use on-device AI for chat" on, model not loaded yet: chat is not sent to the cloud', async () => {
    localStorage.setItem('vex.preferOnDeviceAI', 'true');
    const { WebLLM } = require('../../src/renderer/js/webllm.js');
    globalThis.WebLLM = WebLLM;
    const AIRouter = freshRouter();
    await AIRouter.init();
    expect(WebLLM.isLoaded()).toBe(false);
    expect(await AIRouter.resolveBackend('chat')).toBe('ondevice');
    // The background digest does not load a model by itself.
    expect(await AIRouter.resolveBackend('digest')).not.toBe('ondevice');
  });

  it('loads the chosen model for the question and answers on the device', async () => {
    localStorage.setItem('vex.preferOnDeviceAI', 'true');
    let loaded = false;
    globalThis.WebLLM = {
      preferred: () => true, isLoaded: () => loaded, chosenModel: () => 'tiny-model', loadedModel: () => 'tiny-model',
      load: vi.fn(async () => { loaded = true; return 'tiny-model'; }),
      chat: vi.fn(async () => 'hello from the device'),
    };
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy;
    const AIRouter = freshRouter();
    const out = await AIRouter.callAI('chat', { message: 'hi', conversationHistory: [] });
    expect(WebLLM.load).toHaveBeenCalledTimes(1);
    expect(out).toMatchObject({ result: 'hello from the device', backend: 'ondevice' });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('a model that cannot load says so instead of going to the cloud', async () => {
    localStorage.setItem('vex.preferOnDeviceAI', 'true');
    globalThis.WebLLM = {
      preferred: () => true, isLoaded: () => false, chosenModel: () => 'tiny-model', loadedModel: () => null,
      load: vi.fn(async () => { throw new Error('WebGPU is not available on this device/build.'); }),
      chat: vi.fn(),
    };
    const AIRouter = freshRouter();
    await expect(AIRouter.callAI('chat', { message: 'hi', conversationHistory: [] })).rejects.toThrow(/On-device AI failed: WebGPU.*Not falling back to the cloud/);
  });
});

describe('Two models on a private tab', () => {
  it('asks the cloud without the private page, and the local model with it', async () => {
    const tab = { id: 'tor', url: 'https://secretforum.example/thread/42', title: 'My secret Tor tab', partition: 'tor-1' };
    globalThis.TabManager = { tabs: [tab], getActiveTab: () => tab };
    globalThis.WebviewManager = { getActiveWebview: () => ({}) };
    globalThis.PageContext = { extractPageContext: vi.fn(async () => ({ url: tab.url, title: tab.title, text: 'secret text' })) };
    const calls = {};
    globalThis.AIRouter = { callOn: vi.fn(async (backend, _f, req) => { calls[backend] = req; return { result: 'answer from ' + backend }; }) };
    const { TwoModels } = require('../../src/renderer/js/two-models.js');
    await TwoModels.ask('what is this', await TwoModels._context());
    expect(calls.cloud.pageContext).toBe(null);
    expect(JSON.stringify(calls.cloud)).not.toContain('secretforum');
    expect(calls.local.pageContext).toEqual({ url: tab.url, title: tab.title, text: 'secret text' });
  });

  it('an ordinary tab still goes to both', async () => {
    const tab = { id: 'a', url: 'https://github.com/x', title: 'GitHub repo' };
    globalThis.TabManager = { tabs: [tab], getActiveTab: () => tab };
    globalThis.WebviewManager = { getActiveWebview: () => null };
    const calls = {};
    globalThis.AIRouter = { callOn: vi.fn(async (backend, _f, req) => { calls[backend] = req; return { result: 'ok' }; }) };
    const { TwoModels } = require('../../src/renderer/js/two-models.js');
    await TwoModels.ask('what is this', await TwoModels._context());
    expect(calls.cloud.pageContext).toEqual({ url: tab.url, title: tab.title });
  });
});

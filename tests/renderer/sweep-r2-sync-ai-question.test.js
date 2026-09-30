// @vitest-environment jsdom
//
// The question was sent to the model twice (found 2026-09-30): the panel puts
// it in the chat before building the history, and the router (local) or the
// worker (cloud) adds it again as the last message with the page or the tabs.
// Checked end to end here: the real panel, the real router, and — for the
// cloud — the real AI worker with OpenRouter stubbed, so the messages list the
// model would get is the thing asserted.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const { VexIcons } = require('../../src/renderer/js/vex-icons.js');
globalThis.VexIcons = VexIcons; global.window.VexIcons = VexIcons;
const { AIPanel } = require('../../src/renderer/js/ai-panel.js');

const flush = () => new Promise(r => setTimeout(r, 0));
const TOKEN = 'test-token-with-at-least-24-characters';

function kv() {
  const raw = new Map();
  return { async get(k) { return raw.has(k) ? raw.get(k) : null; }, async put(k, v) { raw.set(k, String(v)); }, async delete(k) { raw.delete(k); } };
}

let router, modelCalls;
beforeEach(async () => {
  document.body.innerHTML = '<div id="ai-panel" class="open"><div id="ai-messages"></div><textarea id="ai-input"></textarea><button id="ai-send"></button><button id="ai-stop-agent"></button></div>';
  localStorage.clear();
  window.showToast = vi.fn();
  window.escapeHtml = (v) => String(v == null ? '' : v);
  const tabs = [{ id: 'tab-1', title: 'One', url: 'https://one.example/' }, { id: 'tab-2', title: 'Two', url: 'https://two.example/' }];
  globalThis.TabManager = { activeTabId: 'tab-1', tabs, getActiveTab: () => tabs[0] };
  globalThis.WebviewManager = { getActiveWebview: () => null };
  globalThis.PageContext = { extractPageContext: async () => null };
  globalThis.VideoChat = { contextFor: async (c) => c, linkify: (h) => h };
  globalThis.VexMarkdown = { render: (t) => '<p>' + t + '</p>' };
  globalThis.MultiTabContext = {
    extractContextFromTabs: async (ts) => ts.map(t => ({ tabId: t.id, title: t.title, url: t.url, text: 'text of ' + t.title })),
    formatForAI: (cs) => cs.map(c => c.title + ': ' + c.text).join('\n'),
  };
  AIPanel._conversations = {};
  AIPanel._convPrivate = {};
  AIPanel._sending = false;
  AIPanel._chat = null;
  AIPanel._viewingId = null;
  vi.resetModules();
  router = (await import('../../src/renderer/js/ai-router.js')).AIRouter;
  modelCalls = [];
  globalThis.Ollama = {
    ping: vi.fn(async () => true), getBaseUrl: () => 'http://127.0.0.1:11434',
    chat: vi.fn(async (model, msgs) => { modelCalls.push(msgs); return '{"reply":"ok"}'; }),
    generate: vi.fn(async (model, prompt, o) => { modelCalls.push([{ role: 'system', content: o.systemPrompt }, { role: 'user', content: prompt }]); return '{"reply":"ok"}'; }),
  };
  vi.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => {
  delete globalThis.AIRouter; delete globalThis.Ollama; delete globalThis.MultiTabContext; delete window.VexConfig;
  vi.restoreAllMocks();
});

// How many messages the model got that carry the question.
const carrying = (msgs, q) => msgs.filter(m => typeof m.content === 'string' && m.content.includes(q)).length;

function viaLocal() { globalThis.AIRouter = { callAI: (feature, req) => router.callOn('local', feature, req) }; }

// The cloud path: the router posts to the AI worker, which is run for real;
// the worker's own call to OpenRouter is the one stubbed.
async function viaCloud() {
  const { aiHandler } = await import('../../workers/vex-ai-worker/worker.js');
  const env = { VEX_AI_KV: kv(), VEX_CLIENT_TOKENS: JSON.stringify({ test: TOKEN }) };
  window.VexConfig = {
    aiWorkerUrl: () => 'https://ai.test/',
    fetchAI: async (url, opts) => aiHandler.fetch(new Request(url, { method: 'POST', headers: { ...opts.headers, Authorization: 'Bearer ' + TOKEN }, body: opts.body }), env),
  };
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, opts) => {
    modelCalls.push(JSON.parse(opts.body).messages);
    return new Response(JSON.stringify({ choices: [{ message: { content: '{"reply":"ok"}' } }] }), { status: 200 });
  });
  globalThis.AIRouter = { callAI: (feature, req) => router.callOn('cloud', feature, req) };
}

const earlier = [{ role: 'user', content: 'first question', at: 1 }, { role: 'assistant', content: 'first answer', at: 2 }];

describe.each([['local', viaLocal], ['cloud', viaCloud]])('the %s path sends the question once', (name, setup) => {
  it('a chat question', async () => {
    await setup();
    AIPanel._conversations['tab-1'] = earlier.slice();
    await AIPanel.sendMessage('chat', { message: 'how tall is it?' });
    expect(modelCalls).toHaveLength(1);
    const msgs = modelCalls[0];
    expect(carrying(msgs, 'how tall is it?')).toBe(1);
    expect(msgs[msgs.length - 1].content).toContain('how tall is it?');
    expect(carrying(msgs, 'first answer')).toBe(1);   // the earlier turns still go
    expect(AIPanel._conversations['tab-1'].map(m => m.content)).toEqual(['first question', 'first answer', 'how tall is it?', 'ok']);
  });

  it('a multi-tab question', async () => {
    await setup();
    AIPanel._conversations['tab-1'] = earlier.slice();
    await AIPanel._sendMultiTab('which is newer?', TabManager.tabs);
    expect(modelCalls).toHaveLength(1);
    const msgs = modelCalls[0];
    expect(carrying(msgs, 'which is newer?')).toBe(1);
    expect(msgs[msgs.length - 1].content).toContain('text of Two');
    expect(carrying(msgs, 'first answer')).toBe(1);
  });

  it('a Retry asks the question once, with only the chat before it', async () => {
    await setup();
    AIPanel._conversations['tab-1'] = [...earlier, { role: 'user', content: 'why?', at: 3 }, { role: 'assistant', content: 'because', at: 4 }, { role: 'user', content: 'later', at: 5 }, { role: 'assistant', content: 'later answer', at: 6 }];
    AIPanel._renderMessages();
    // copy, note, retry on the answer to "why?"
    document.querySelectorAll('.ai-msg.assistant')[1].querySelectorAll('.ai-msg-act')[2].click();
    for (let i = 0; i < 30 && modelCalls.length === 0; i++) await flush();
    for (let i = 0; i < 30 && AIPanel._sending !== false; i++) await flush();
    const msgs = modelCalls[0];
    expect(carrying(msgs, 'why?')).toBe(1);
    expect(carrying(msgs, 'later')).toBe(0);
    expect(carrying(msgs, 'first answer')).toBe(1);
    expect(AIPanel._conversations['tab-1'].map(m => m.content)).toEqual(['first question', 'first answer', 'why?', 'ok', 'later', 'later answer']);
  });

  it('a failed send retried from the error sends it once', async () => {
    await setup();
    AIPanel._conversations['tab-1'] = earlier.slice();
    const real = globalThis.AIRouter.callAI;
    globalThis.AIRouter.callAI = async () => { throw new Error('offline'); };
    await AIPanel.sendMessage('chat', { message: 'try again?' });
    globalThis.AIRouter.callAI = real;
    document.querySelector('.ai-retry-btn').click();
    for (let i = 0; i < 30 && modelCalls.length === 0; i++) await flush();
    for (let i = 0; i < 30 && AIPanel._sending !== false; i++) await flush();
    expect(carrying(modelCalls[0], 'try again?')).toBe(1);
  });
});

describe('the AI worker', () => {
  it('keeps ten turns of a multi-tab conversation, as a one-page chat does', async () => {
    await viaCloud();
    const turns = Array.from({ length: 14 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: 'turn ' + i }));
    const res = await window.VexConfig.fetchAI('https://ai.test/', { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'multi-tab-chat', message: 'q', tabContexts: [], conversationHistory: turns }) });
    expect(res.status).toBe(200);
    const msgs = modelCalls[0];
    expect(msgs.slice(1, -1).map(m => m.content)).toEqual(turns.slice(-10).map(m => m.content));
  });
});

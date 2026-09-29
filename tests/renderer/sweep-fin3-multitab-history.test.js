// @vitest-environment jsdom
//
// A multi-tab question on the local model went through Ollama.generate with no
// earlier turns, so a follow-up ("and which one is taller?") lost the answer it
// followed (found 2026-09-29). It now gets the conversation the way a one-page
// chat does, with the tabs in the last message.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const { VexIcons } = require('../../src/renderer/js/vex-icons.js');
globalThis.VexIcons = VexIcons; global.window.VexIcons = VexIcons;
const { AIPanel } = require('../../src/renderer/js/ai-panel.js');

const TABS = [{ title: 'Eiffel Tower', url: 'file:///eiffel.html', text: 'The Eiffel Tower is 330 metres tall.' },
  { title: 'Tokyo Tower', url: 'file:///tokyo.html', text: 'Tokyo Tower is 333 metres tall.' }];

describe('the local router', () => {
  let AIRouter;
  beforeEach(async () => {
    vi.resetModules();
    AIRouter = (await import('../../src/renderer/js/ai-router.js')).AIRouter;
    globalThis.MultiTabContext = { formatForAI: (cs) => cs.map(c => c.title + ': ' + c.text).join('\n') };
    globalThis.Ollama = { ping: vi.fn(async () => true), generate: vi.fn(async () => '{"reply":"ok"}'), chat: vi.fn(async () => '{"reply":"ok"}'), getBaseUrl: () => 'http://127.0.0.1:11434' };
  });
  afterEach(() => { delete globalThis.Ollama; delete globalThis.MultiTabContext; });

  it('sends a multi-tab follow-up with the earlier turns, and the tabs last', async () => {
    const conversationHistory = [
      { role: 'user', content: 'compare these two towers' },
      { role: 'assistant', content: 'Eiffel Tower is 330 m, Tokyo Tower is 333 m.' },
      { role: 'user', content: 'and which one is taller?' },
    ];
    await AIRouter.callOn('local', 'multiTab', { message: 'and which one is taller?', tabContexts: TABS, conversationHistory });
    expect(globalThis.Ollama.generate).not.toHaveBeenCalled();
    const msgs = globalThis.Ollama.chat.mock.calls[0][1];
    expect(msgs[0].role).toBe('system');
    expect(msgs[0].content).toMatch(/^You are Vex AI/);
    expect(msgs.map(m => m.content)).toContain('Eiffel Tower is 330 m, Tokyo Tower is 333 m.');
    const last = msgs[msgs.length - 1];
    expect(last.role).toBe('user');
    expect(last.content).toContain('Tokyo Tower: Tokyo Tower is 333 metres tall.');
    expect(last.content).toContain('User: and which one is taller?');
  });

  it('keeps a system message at the front and trims turns as chat does', async () => {
    const turns = Array.from({ length: 14 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: 'turn ' + i }));
    await AIRouter.callOn('local', 'multiTab', { message: 'q', tabContexts: TABS, conversationHistory: [{ role: 'system', content: 'MEMORY' }, ...turns] });
    const msgs = globalThis.Ollama.chat.mock.calls[0][1];
    expect(msgs[1].content).toBe('MEMORY');
    expect(msgs.slice(2, -1).map(m => m.content)).toEqual(turns.slice(-10).map(m => m.content));
  });

  it('a first question with no history still goes through generate with the tabs', async () => {
    await AIRouter.callOn('local', 'multiTab', { message: 'compare', tabContexts: TABS });
    expect(globalThis.Ollama.chat).not.toHaveBeenCalled();
    expect(globalThis.Ollama.generate.mock.calls[0][1]).toContain('Eiffel Tower');
  });
});

describe('the panel', () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="ai-panel" class="open"><div id="ai-messages"></div><textarea id="ai-input"></textarea><button id="ai-stop-agent"></button></div>';
    localStorage.clear();
    window.showToast = vi.fn();
    window.escapeHtml = (v) => String(v == null ? '' : v);
    const tabs = [{ id: 'tab-1', title: 'One', url: 'https://one.example/' }, { id: 'tab-2', title: 'Two', url: 'https://two.example/' }];
    globalThis.TabManager = { activeTabId: 'tab-1', tabs, getActiveTab: () => tabs[0] };
    globalThis.VexMarkdown = { render: (t) => '<p>' + t + '</p>' };
    globalThis.VideoChat = { linkify: (h) => h };
    globalThis.MultiTabContext = { extractContextFromTabs: async (ts) => ts.map(t => ({ tabId: t.id, title: t.title, url: t.url, text: 'x' })) };
    AIPanel._conversations = {};
    AIPanel._convPrivate = {};
    AIPanel._sending = false;
    AIPanel._chat = null;
    AIPanel._viewingId = null;
  });
  afterEach(() => { delete globalThis.AIRouter; delete globalThis.MultiTabContext; vi.restoreAllMocks(); });

  it('sends a multi-tab question as many turns as a one-page chat', async () => {
    const earlier = Array.from({ length: 12 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: 'turn ' + i, at: i }));
    AIPanel._conversations['tab-1'] = earlier.slice();
    globalThis.AIRouter = { callAI: vi.fn(async () => ({ result: '{"reply":"Tokyo Tower"}' })) };
    await AIPanel._sendMultiTab('and which one is taller?', TabManager.tabs);
    const hist = globalThis.AIRouter.callAI.mock.calls[0][1].conversationHistory;
    expect(hist.length).toBe(AIPanel.HISTORY_SENT);
    expect(hist[hist.length - 1].content).toBe('and which one is taller?');
    expect(hist[hist.length - 2].content).toBe('turn 11');
  });
});

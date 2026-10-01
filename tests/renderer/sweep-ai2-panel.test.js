// @vitest-environment jsdom
//
// AI panel leftovers from the 2026-09-29 sweep: multi-tab questions can be
// stopped, the panel follows the active tab while open, and Retry on an
// answer without an action does the right thing.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const { VexIcons } = require('../../src/renderer/js/vex-icons.js');
globalThis.VexIcons = VexIcons; global.window.VexIcons = VexIcons;
const { AIPanel } = require('../../src/renderer/js/ai-panel.js');
const { ChatFile } = require('../../src/renderer/js/chat-file.js');

const flush = () => new Promise(r => setTimeout(r, 0));
const settle = async () => { for (let i = 0; i < 30 && AIPanel._sending; i++) await flush(); await flush(); };

beforeEach(() => {
  document.body.innerHTML = `
    <button id="btn-toggle-ai"></button>
    <div id="ai-panel" class="open">
      <div id="ai-current-tab"></div>
      <div id="ai-messages"></div>
      <textarea id="ai-input"></textarea>
      <button id="ai-send"></button><button id="ai-stop-agent"></button><button id="ai-pause-agent"></button>
    </div>`;
  localStorage.clear();
  window.showToast = vi.fn();
  window.escapeHtml = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const tabs = [{ id: 'tab-1', title: 'One', url: 'https://one.example/' }, { id: 'tab-2', title: 'Two', url: 'https://two.example/' }, { id: 'tab-3', title: 'Three', url: 'https://three.example/' }];
  globalThis.TabManager = { activeTabId: 'tab-1', tabs, getActiveTab: () => tabs.find(t => t.id === globalThis.TabManager.activeTabId) };
  globalThis.WebviewManager = { getActiveWebview: () => null };
  globalThis.PageContext = { extractPageContext: async () => ({ url: 'https://one.example/', title: 'One', text: 'text' }) };
  globalThis.VideoChat = { contextFor: async (c) => c, linkify: (h) => h };
  globalThis.VexMarkdown = { render: (t) => '<p>' + t + '</p>' };
  globalThis.MultiTabContext = { extractContextFromTabs: async (ts) => ts.map(t => ({ tabId: t.id, title: t.title, url: t.url, text: 'x' })) };
  globalThis.AIPanel = AIPanel;
  AIPanel._conversations = {};
  AIPanel._convPrivate = {};
  AIPanel._sending = false;
  AIPanel._chat = null;
  AIPanel._viewingId = null;
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  delete globalThis.AIRouter; delete globalThis.MultiTabContext;
  ChatFile.attached = null;
  vi.restoreAllMocks();
});

describe('a multi-tab question', () => {
  it('shows Stop, and Stop cancels it: the signal reaches the router and the chat says "Stopped."', async () => {
    let signal;
    globalThis.AIRouter = { callAI: vi.fn((f, req) => { signal = req.signal; return new Promise((_, rej) => req.signal.addEventListener('abort', () => rej(new Error('aborted')))); }) };
    AIPanel.init();   // binds the Stop button
    const sent = AIPanel._sendMultiTab('Compare these tabs', TabManager.tabs.slice(0, 2));
    for (let i = 0; i < 20 && !signal; i++) await flush();
    expect(globalThis.AIRouter.callAI.mock.calls[0][0]).toBe('multiTab');
    expect(document.getElementById('ai-stop-agent').classList.contains('visible')).toBe(true);
    document.getElementById('ai-stop-agent').click();
    await sent;
    expect(signal.aborted).toBe(true);
    expect(AIPanel._conversations['tab-1'].map(m => m.content)).toEqual(['Compare these tabs', 'Stopped.']);
    expect(document.getElementById('ai-stop-agent').classList.contains('visible')).toBe(false);
    expect(AIPanel._chat).toBe(null);
  });

  it('typing "stop" stops it too', async () => {
    let signal;
    globalThis.AIRouter = { callAI: vi.fn((f, req) => { signal = req.signal; return new Promise((_, rej) => req.signal.addEventListener('abort', () => rej(new Error('aborted')))); }) };
    const sent = AIPanel._sendMultiTab('Summarize all tabs', TabManager.tabs);
    for (let i = 0; i < 20 && !signal; i++) await flush();
    document.getElementById('ai-input').value = 'stop';
    await AIPanel._sendChat();
    await sent;
    expect(signal.aborted).toBe(true);
    expect(AIPanel._conversations['tab-1'].map(m => m.content)).toEqual(['Summarize all tabs', 'Stopped.']);
  });

  it('Retry on its answer asks the same tabs again, not one page', async () => {
    globalThis.AIRouter = { callAI: vi.fn(async () => ({ result: '{"reply":"first"}' })) };
    await AIPanel._sendMultiTab('Compare these tabs', TabManager.tabs.slice(0, 2));
    // Survives a save and reload with the tabs it was about.
    AIPanel._conversations = {};
    AIPanel._loadConversations();
    expect(AIPanel._conversations['tab-1'][1].tabs).toEqual(['tab-1', 'tab-2']);
    globalThis.AIRouter.callAI = vi.fn(async () => ({ result: '{"reply":"again"}' }));
    AIPanel._renderMessages();
    document.querySelectorAll('.ai-msg.assistant .ai-msg-act')[2].click();   // copy, note, retry
    await settle();
    expect(globalThis.AIRouter.callAI.mock.calls[0][0]).toBe('multiTab');
    expect(globalThis.AIRouter.callAI.mock.calls[0][1].tabContexts.map(c => c.tabId)).toEqual(['tab-1', 'tab-2']);
    expect(AIPanel._conversations['tab-1'].map(m => m.content)).toEqual(['Compare these tabs', 'again']);
  });
});

describe('Retry on an answer with no action', () => {
  const retry = () => document.querySelectorAll('.ai-msg.assistant .ai-msg-act')[2].click();

  it('asks the question right above it as a chat', async () => {
    globalThis.AIRouter = { callAI: vi.fn(async () => ({ result: '{"reply":"again"}' })) };
    AIPanel._conversations['tab-1'] = [{ role: 'user', content: 'why?' }, { role: 'assistant', content: 'because' }];
    AIPanel._renderMessages();
    retry();
    await settle();
    expect(globalThis.AIRouter.callAI.mock.calls[0][1].message).toBe('why?');
    expect(AIPanel._conversations['tab-1'].map(m => m.content)).toEqual(['why?', 'again']);
  });

  it('with no question right above it, says it cannot be retried and sends nothing', () => {
    globalThis.AIRouter = { callAI: vi.fn() };
    AIPanel._conversations['tab-1'] = [{ role: 'user', content: 'why?' }, { role: 'assistant', content: 'because' }, { role: 'assistant', content: 'an older answer' }];
    AIPanel._renderMessages();
    document.querySelectorAll('.ai-msg.assistant')[1].querySelectorAll('.ai-msg-act')[2].click();
    expect(globalThis.AIRouter.callAI).not.toHaveBeenCalled();
    expect(window.showToast).toHaveBeenCalledWith(expect.stringMatching(/cannot be retried/), 'info');
    expect(AIPanel._conversations['tab-1']).toHaveLength(3);
  });

  it('does not send a typed "stop" to the model', () => {
    globalThis.AIRouter = { callAI: vi.fn() };
    AIPanel._conversations['tab-1'] = [{ role: 'user', content: 'stop' }, { role: 'assistant', content: 'There was nothing running to stop.' }];
    AIPanel._renderMessages();
    retry();
    expect(globalThis.AIRouter.callAI).not.toHaveBeenCalled();
    expect(window.showToast).toHaveBeenCalledWith(expect.stringMatching(/cannot be retried/), 'info');
  });

  it('an agent answer is not re-asked as a chat', () => {
    globalThis.AIRouter = { callAI: vi.fn() };
    AIPanel._conversations['tab-1'] = [{ role: 'user', content: 'book a table' }, { role: 'assistant', content: 'Booked.', agentRun: 'run-1' }];
    AIPanel._renderMessages();
    retry();
    expect(globalThis.AIRouter.callAI).not.toHaveBeenCalled();
    expect(window.showToast).toHaveBeenCalledWith(expect.stringMatching(/agent/), 'info');
  });
});

describe('the panel follows the active tab while open', () => {
  it('switching tab redraws the chat, the tab name and the attached-file chip', async () => {
    AIPanel.init();
    AIPanel._conversations['tab-1'] = [{ role: 'user', content: 'about one' }, { role: 'assistant', content: 'one answer' }];
    AIPanel._conversations['tab-2'] = [{ role: 'user', content: 'about two' }, { role: 'assistant', content: 'two answer' }];
    ChatFile.attached = { name: 'notes.txt', text: 'x', chars: 1, truncated: false, tabId: 'tab-1' };
    ChatFile._chip(ChatFile.attached);
    AIPanel.open();
    expect(document.getElementById('ai-messages').textContent).toContain('one answer');
    expect(document.getElementById('ai-current-tab').textContent).toBe('One');
    expect(document.getElementById('ai-file-attach').hidden).toBe(false);

    TabManager.activeTabId = 'tab-2';
    window.dispatchEvent(new CustomEvent('vex-tabs-changed'));
    expect(document.getElementById('ai-messages').textContent).toContain('two answer');
    expect(document.getElementById('ai-current-tab').textContent).toBe('Two');
    expect(document.getElementById('ai-file-attach').hidden).toBe(true);

    TabManager.activeTabId = 'tab-1';
    window.dispatchEvent(new CustomEvent('vex-tabs-changed'));
    expect(document.getElementById('ai-file-attach').hidden).toBe(false);
  });

  it('an answer that lands after you switched tab is saved with its own chat, not drawn in the other', async () => {
    let finish;
    globalThis.AIRouter = { callAI: vi.fn(() => new Promise(r => { finish = r; })) };
    AIPanel._conversations['tab-2'] = [{ role: 'user', content: 'about two' }, { role: 'assistant', content: 'two answer' }];
    const sent = AIPanel.sendMessage('chat', { message: 'about one' });
    for (let i = 0; i < 20 && !finish; i++) await flush();
    TabManager.activeTabId = 'tab-2';
    AIPanel._renderMessages();
    finish({ result: '{"reply":"one answer"}' });
    await sent;
    expect(document.getElementById('ai-messages').textContent).not.toContain('one answer');
    expect(AIPanel._conversations['tab-1'].map(m => m.content)).toEqual(['about one', 'one answer']);
  });
});

// @vitest-environment jsdom
//
// AI panel fixes from the 2026-09-29 sweep (area ai4): Stop keeps what was
// written and leaves no bubble behind, a stopped agent run cannot upset the
// next one, Retry answers in place, chats keep their times across a restart,
// a new question goes to this tab's chat, and a new answer has its buttons.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const { VexIcons } = require('../../src/renderer/js/vex-icons.js');
globalThis.VexIcons = VexIcons; global.window.VexIcons = VexIcons;
const { AIPanel } = require('../../src/renderer/js/ai-panel.js');
const { ChatFile } = require('../../src/renderer/js/chat-file.js');

const flush = () => new Promise(r => setTimeout(r, 0));
const settle = async () => { for (let i = 0; i < 40 && AIPanel._sending; i++) await flush(); await flush(); };
const msgs = () => document.getElementById('ai-messages');
const texts = (id) => AIPanel._conversations[id].map(m => m.content);

beforeEach(() => {
  document.body.innerHTML = `
    <button id="btn-toggle-ai"></button>
    <div id="ai-panel" class="open">
      <div class="ai-body"></div>
      <div id="ai-current-tab"></div>
      <div id="ai-messages"></div>
      <textarea id="ai-input"></textarea>
      <button id="ai-send"></button><button id="ai-stop-agent"></button><button id="ai-pause-agent"></button>
    </div>`;
  localStorage.clear();
  window.showToast = vi.fn();
  window.escapeHtml = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const tabs = [{ id: 'tab-1', title: 'One', url: 'https://one.example/' }, { id: 'tab-2', title: 'Two', url: 'https://two.example/' }];
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
  AIPanel._live = null;
  AIPanel._viewingId = null;
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  delete globalThis.AIRouter; delete globalThis.AgentLoop;
  ChatFile.attached = null;
  vi.restoreAllMocks();
});

// A router whose answer only ends when Stop aborts it, after writing `partial`.
function stoppableRouter(partialJson) {
  let signal;
  globalThis.AIRouter = {
    callAI: vi.fn((f, req) => {
      signal = req.signal;
      if (partialJson && req.onToken) req.onToken(partialJson, partialJson);
      return new Promise((_, rej) => req.signal.addEventListener('abort', () => rej(new Error('aborted'))));
    }),
  };
  return () => signal;
}

describe('Stop on a chat answer', () => {
  it('keeps the half answer with "Stopped." and leaves no live bubble behind', async () => {
    const signal = stoppableRouter('{"reply":"Half an ans');
    AIPanel.init();
    const sent = AIPanel.sendMessage('chat', { message: 'tell me' });
    for (let i = 0; i < 20 && !signal(); i++) await flush();
    document.getElementById('ai-stop-agent').click();
    await sent;
    expect(texts('tab-1')).toEqual(['tell me', 'Half an ans\n\n*Stopped.*']);
    // Every bubble on screen is a saved message: no spinner, no caret.
    expect(msgs().querySelectorAll('.ai-msg:not([data-index])').length).toBe(0);
    expect(msgs().querySelectorAll('.ai-msg').length).toBe(2);
  });

  it('with nothing written yet just says "Stopped." — and no Thinking bubble stays', async () => {
    const signal = stoppableRouter(null);
    AIPanel.init();
    const sent = AIPanel.sendMessage('chat', { message: 'tell me' });
    for (let i = 0; i < 20 && !signal(); i++) await flush();
    document.getElementById('ai-stop-agent').click();
    await sent;
    expect(texts('tab-1')).toEqual(['tell me', 'Stopped.']);
    expect(msgs().querySelector('.loading')).toBe(null);
  });
});

describe('an agent run stopped and replaced at once', () => {
  it('its late end leaves the new run alone and files its answer under its own question', async () => {
    localStorage.setItem('vex.agentModeChosen', '1');
    const ends = [];
    globalThis.AgentLoop = { start: vi.fn(() => new Promise(r => ends.push(r))), isRunning: () => false, lastRun: null, runs: () => [] };
    const input = document.getElementById('ai-input');
    input.value = 'task one';
    AIPanel._sendAgent();
    input.value = 'task two';
    AIPanel._sendAgent();
    ends[0]();            // the first (stopped) run finally returns
    await flush();
    expect(document.getElementById('ai-stop-agent').classList.contains('visible')).toBe(true);
    expect(AIPanel._agentTabId).toBe('tab-1');
    expect(texts('tab-1')).toEqual(['task one', '*The agent stopped without an answer.*', 'task two']);
    ends[1]();
    await flush();
    expect(document.getElementById('ai-stop-agent').classList.contains('visible')).toBe(false);
    expect(AIPanel._agentTabId).toBe(null);
    expect(texts('tab-1')[3]).toBe('*The agent stopped without an answer.*');
  });
});

describe('Retry on an older answer', () => {
  it('puts the new answer where the old one was, asked with only the chat before it', async () => {
    let hist;
    globalThis.AIRouter = { callAI: vi.fn(async (f, req) => { hist = req.conversationHistory; return { result: '{"reply":"better one"}' }; }) };
    AIPanel._conversations['tab-1'] = [
      { role: 'user', content: 'q one', at: 1 }, { role: 'assistant', content: 'a one', at: 2 },
      { role: 'user', content: 'q two', at: 3 }, { role: 'assistant', content: 'a two', at: 4 },
    ];
    AIPanel._renderMessages();
    msgs().querySelector('.ai-msg[data-index="1"] .ai-msg-act[title="Try this answer again"]').click();
    await settle();
    expect(texts('tab-1')).toEqual(['q one', 'better one', 'q two', 'a two']);
    expect(hist.map(m => m.content)).toEqual(['q one']);
    expect([...msgs().querySelectorAll('.ai-msg')].map(e => e.textContent)).toEqual(expect.arrayContaining([expect.stringContaining('better one')]));
    expect(msgs().querySelectorAll('.ai-msg')[1].textContent).toContain('better one');
  });

  it('asks a selection Explain about the same selection, not the page', async () => {
    const reqs = [];
    globalThis.AIRouter = { callAI: vi.fn(async (f, req) => { reqs.push(req); return { result: '{"explanation":"it means x"}' }; }) };
    await AIPanel.sendMessage('explain', { selectedText: 'the selected words' });
    const saved = AIPanel._conversations['tab-1'][0];
    expect(saved.selectedText).toBe('the selected words');
    // Survives a restart.
    AIPanel._persistConversations();
    AIPanel._conversations = {};
    AIPanel._loadConversations();
    expect(AIPanel._conversations['tab-1'][0].selectedText).toBe('the selected words');
    AIPanel._renderMessages();
    msgs().querySelector('.ai-msg[data-index="0"] .ai-msg-act[title="Try this answer again"]').click();
    await settle();
    expect(reqs[1].selectedText).toBe('the selected words');
    expect(AIPanel._conversations['tab-1'].length).toBe(1);
  });
});

describe('saved chats', () => {
  it('keep `at` and `didIt` across a restart', () => {
    AIPanel._conversations['tab-1'] = [{ role: 'user', content: 'set a timer', at: 111 }, { role: 'assistant', content: 'Timer: 10:00', at: 112, didIt: true }];
    AIPanel._persistConversations();
    AIPanel._conversations = {};
    AIPanel._loadConversations();
    expect(AIPanel._conversations['tab-1']).toEqual([{ role: 'user', content: 'set a timer', at: 111 }, { role: 'assistant', content: 'Timer: 10:00', at: 112, didIt: true }]);
  });

  it('the cap drops the oldest chats, however many times it is saved and loaded', () => {
    for (let i = 0; i < 25; i++) AIPanel._conversations['t' + i] = [{ role: 'user', content: 'q' + i, at: 1000 + i }];
    for (let round = 0; round < 3; round++) {
      AIPanel._persistConversations();
      AIPanel._conversations = {};
      AIPanel._loadConversations();
    }
    const kept = Object.keys(AIPanel._conversations).sort();
    expect(kept.length).toBe(20);
    expect(kept).not.toContain('t0');
    expect(kept).not.toContain('t4');
    expect(kept).toContain('t24');
    expect(kept).toContain('t5');
  });
});

describe('sending while an earlier chat is open', () => {
  beforeEach(() => {
    AIPanel._conversations['tab-2'] = [{ role: 'user', content: 'old question', at: 1 }, { role: 'assistant', content: 'old answer', at: 2 }];
    AIPanel._viewingId = 'tab-2';
    AIPanel._renderMessages();
  });

  it('a chat question goes back to this tab and is drawn there', async () => {
    globalThis.AIRouter = { callAI: vi.fn(async () => ({ result: '{"reply":"new answer"}' })) };
    await AIPanel.sendMessage('chat', { message: 'new question' });
    expect(AIPanel._viewingId).toBe(null);
    expect(texts('tab-1')).toEqual(['new question', 'new answer']);
    expect(texts('tab-2')).toEqual(['old question', 'old answer']);
    expect(msgs().textContent).not.toContain('old answer');
    expect(msgs().textContent).toContain('new answer');
  });

  it('a multi-tab question does the same, rather than landing in the earlier chat', async () => {
    globalThis.AIRouter = { callAI: vi.fn(async () => ({ result: '{"reply":"compared"}' })) };
    await AIPanel._sendMultiTab('compare them', TabManager.tabs);
    expect(AIPanel._viewingId).toBe(null);
    expect(texts('tab-1')).toEqual(['compare them', 'compared']);
    expect(texts('tab-2')).toEqual(['old question', 'old answer']);
  });
});

describe('a new answer', () => {
  it('has the same buttons and next-step chips as a redrawn one', async () => {
    globalThis.AIRouter = { callAI: vi.fn(async () => ({ result: '{"reply":"see https://example.com/a"}' })) };
    await AIPanel.sendMessage('chat', { message: 'q' });
    const last = [...msgs().querySelectorAll('.ai-msg.assistant')].pop();
    expect(last.querySelector('.ai-msg-act[title="Try this answer again"]')).not.toBe(null);
    expect(last.querySelector('.ai-msg-act[title="Save as note"]')).not.toBe(null);
    expect(last.querySelector('.ai-next-chips')).not.toBe(null);
    expect(msgs().querySelectorAll('.ai-next-chips').length).toBe(1);
  });

  it('a multi-tab one too', async () => {
    globalThis.AIRouter = { callAI: vi.fn(async () => ({ result: '{"reply":"compared"}' })) };
    await AIPanel._sendMultiTab('compare them', TabManager.tabs);
    const last = [...msgs().querySelectorAll('.ai-msg.assistant')].pop();
    expect(last.querySelector('.ai-msg-act[title="Try this answer again"]')).not.toBe(null);
  });
});

describe('a multi-tab question while you switch tab and back', () => {
  it('keeps its Reading/Thinking bubble', async () => {
    let finish;
    globalThis.AIRouter = { callAI: vi.fn(() => new Promise(r => { finish = r; })) };
    const sent = AIPanel._sendMultiTab('compare them', TabManager.tabs);
    for (let i = 0; i < 20 && !finish; i++) await flush();
    TabManager.activeTabId = 'tab-2'; AIPanel._renderMessages();
    TabManager.activeTabId = 'tab-1'; AIPanel._renderMessages();
    expect(msgs().querySelector('.ai-msg.loading')).not.toBe(null);
    finish({ result: '{"reply":"compared"}' });
    await sent;
    expect(msgs().querySelector('.ai-msg.loading')).toBe(null);
  });
});

describe('a reply that is not a string', () => {
  it('a list becomes bullets, anything else text', () => {
    expect(AIPanel._parseResponse('{"reply":["one","two"]}').reply).toBe('- one\n- two');
    expect(AIPanel._parseResponse('["one","two"]').reply).toBe('- one\n- two');
    expect(typeof AIPanel._parseResponse('{"reply":{"a":1}}').reply).toBe('string');
    expect(AIPanel._parseResponse('{"reply":42}').reply).toBe('42');
  });
});

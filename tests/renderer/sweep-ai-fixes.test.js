// @vitest-environment jsdom
//
// The AI sweep of 2026-09-29: each block pins one bug found driving the AI
// features against a local qwen3.5 model.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const { VexIcons } = require('../../src/renderer/js/vex-icons.js');
globalThis.VexIcons = VexIcons; global.window.VexIcons = VexIcons;
const { AgentLoop } = require('../../src/renderer/js/agent-loop.js');
const { AIPanel } = require('../../src/renderer/js/ai-panel.js');
const { ChatFile } = require('../../src/renderer/js/chat-file.js');
const { GuideTemplates } = require('../../src/renderer/js/guide-templates.js');
const { TeachMode } = require('../../src/renderer/js/teach-mode.js');
const { AIHealth } = require('../../src/renderer/js/ai-health.js');
const { CatchMeUp } = require('../../src/renderer/js/catch-me-up.js');
const { TwoModels } = require('../../src/renderer/js/two-models.js');

const flush = () => new Promise(r => setTimeout(r, 0));

function panelDom() {
  document.body.innerHTML = `
    <button id="btn-toggle-ai"></button>
    <div id="ai-panel" class="open">
      <div id="ai-messages"></div>
      <textarea id="ai-input"></textarea>
      <button id="ai-send"></button><button id="ai-stop-agent"></button><button id="ai-pause-agent"></button>
    </div>`;
}

beforeEach(() => {
  panelDom();
  localStorage.clear();
  window.showToast = vi.fn();
  window.escapeHtml = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  globalThis.TabManager = { activeTabId: 'tab-1', tabs: [{ id: 'tab-1' }, { id: 'tab-2' }], getActiveTab: () => ({ id: globalThis.TabManager.activeTabId, url: 'https://example.com/', title: 'Example' }) };
  globalThis.WebviewManager = { getActiveWebview: () => null };
  globalThis.PageContext = { extractPageContext: async () => ({ url: 'https://example.com/', title: 'Example', text: 'The page text.' }) };
  globalThis.VideoChat = { contextFor: async (c) => c, linkify: (h) => h };
  globalThis.VexMarkdown = { render: (t) => '<p>' + t + '</p>' };
  globalThis.AIPanel = AIPanel;
  AIPanel._conversations = {};
  AIPanel._convPrivate = {};
  AIPanel._sending = false;
  AIPanel._chat = null;
  AIPanel._viewingId = null;
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  delete globalThis.AIRouter; delete globalThis.AgentExecutor; delete globalThis.DOMExtractor;
  delete globalThis.AIMemory; delete globalThis.vexConfirm;
  ChatFile.attached = null;
  vi.restoreAllMocks();
});

// ---- 1: Stop while an approval card is open -------------------------------
describe('Stop with an approval card open', () => {
  beforeEach(() => {
    globalThis.DOMExtractor = { extractInteractiveElements: async () => ({ url: 'about:blank', title: '', elements: [] }) };
    globalThis.AgentExecutor = { executeTool: vi.fn(async () => ({ ok: true, result: 'done' })) };
    globalThis.AIRouter = { callAI: vi.fn(async () => ({ result: JSON.stringify({ tool: 'click', parameters: { selector: '#buy' }, intent: 'action' }) })) };
  });

  it('ends the run, marks the card, and a later Approve on it does nothing', async () => {
    const run = AgentLoop.start('press buy', 'ask');
    for (let i = 0; i < 20 && !document.querySelector('.agent-approve'); i++) await flush();
    const approve = document.querySelector('.agent-approve');
    expect(approve).not.toBe(null);
    AgentLoop.stop();
    await run;                                          // used to never settle
    expect(AgentLoop.isRunning()).toBe(false);
    expect(document.getElementById('ai-messages').textContent).toMatch(/Stopped/);
    expect(document.getElementById('ai-messages').textContent).not.toMatch(/denied by user/);

    // A new run starts; the old card's Approve must not carry out anything.
    globalThis.AIRouter.callAI = vi.fn(async () => ({ result: JSON.stringify({ tool: 'finish', parameters: { summary: 'ok' } }) }));
    const second = AgentLoop.start('something else', 'ask');
    approve.click();
    await second;
    expect(globalThis.AgentExecutor.executeTool).not.toHaveBeenCalled();
  });

  it('a run replaced by a newer one does not finish it off', async () => {
    let release;
    globalThis.AIRouter.callAI = vi.fn(() => new Promise(r => { release = r; }));
    const first = AgentLoop.start('first', 'auto');
    for (let i = 0; i < 20 && !release; i++) await flush();
    AgentLoop.stop();
    const firstRelease = release; release = null;
    globalThis.AIRouter.callAI = vi.fn(() => new Promise(r => { release = r; }));
    const second = AgentLoop.start('second', 'auto');
    for (let i = 0; i < 20 && !release; i++) await flush();
    firstRelease({ result: JSON.stringify({ tool: 'click', parameters: { selector: '#x' }, intent: 'action' }) });
    await first;
    expect(AgentLoop.isRunning()).toBe(true);           // the first run's ending did not end the second
    release({ result: JSON.stringify({ tool: 'finish', parameters: { summary: 'ok' } }) });
    await second;
    expect(globalThis.AgentExecutor.executeTool).not.toHaveBeenCalled();
  });
});

// ---- 14: Repeat a task shows Stop ------------------------------------------
describe('Repeat a task', () => {
  it('shows Stop and Pause while it replays', async () => {
    globalThis.AgentExecutor = { executeTool: vi.fn(async () => { seen = document.getElementById('ai-stop-agent').classList.contains('visible'); return { ok: true, result: 'done' }; }) };
    let seen = false;
    localStorage.setItem(AgentLoop.MACROS_KEY, JSON.stringify([{ id: 'm1', name: 'Scroll', goal: 'scroll', calls: [{ tool: 'scroll', parameters: { direction: 'down' } }] }]));
    await AgentLoop.runMacro('m1', 'auto');
    expect(seen).toBe(true);
    expect(document.getElementById('ai-stop-agent').classList.contains('visible')).toBe(false);
  });
});

// ---- 2, 3, 6, 9: the chat send -----------------------------------------------
describe('a chat answer', () => {
  it('can be stopped: the signal reaches the router and the chat says "Stopped."', async () => {
    let signal;
    globalThis.AIRouter = { callAI: vi.fn((f, req) => { signal = req.signal; return new Promise((_, rej) => req.signal.addEventListener('abort', () => rej(new Error('aborted')))); }) };
    const sent = AIPanel.sendMessage('chat', { message: 'long question' });
    for (let i = 0; i < 20 && !signal; i++) await flush();
    expect(document.getElementById('ai-stop-agent').classList.contains('visible')).toBe(true);
    // Typed "stop" while it is being written.
    document.getElementById('ai-input').value = 'stop';
    await AIPanel._sendChat();
    await sent;
    expect(signal.aborted).toBe(true);
    const conv = AIPanel._conversations['tab-1'];
    expect(conv.map(m => m.content)).toEqual(['long question', 'Stopped.']);   // "stop" is not kept as a question
    expect(document.getElementById('ai-stop-agent').classList.contains('visible')).toBe(false);
  });

  it('Retry asks the same question once, not twice', async () => {
    globalThis.AIRouter = { callAI: vi.fn(async () => ({ result: '{"reply":"again"}' })) };
    AIPanel._conversations['tab-1'] = [{ role: 'user', content: 'why?' }, { role: 'assistant', content: 'because' }];
    AIPanel._renderMessages();
    document.querySelectorAll('.ai-msg.assistant .ai-msg-act')[2].click();   // copy, note, retry
    for (let i = 0; i < 20 && AIPanel._sending !== false; i++) await flush();
    await flush(); await flush();
    expect(AIPanel._conversations['tab-1'].map(m => m.content)).toEqual(['why?', 'again']);
  });

  it('a summary is kept in the chat, so a redraw does not take it away', async () => {
    globalThis.AIRouter = { callAI: vi.fn(async () => ({ result: '{"title":"T","summary":"Short.","keyPoints":["a","b"]}' })) };
    await AIPanel.sendMessage('summarize');
    const saved = AIPanel._conversations['tab-1'];
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ role: 'assistant', action: 'summarize' });
    expect(saved[0].content).toContain('Short.');
    expect(saved[0].content).toContain('- a');
    AIPanel._renderMessages();
    expect(document.getElementById('ai-messages').textContent).toContain('Short.');
    // And it survives a reload of the store with its action.
    AIPanel._conversations = {};
    AIPanel._loadConversations();
    expect(AIPanel._conversations['tab-1'][0].action).toBe('summarize');
  });

  it('keeps the remembered facts with a file attached and a long chat', async () => {
    let history;
    globalThis.AIRouter = { callAI: vi.fn(async (f, req) => { history = req.conversationHistory; return { result: '{"reply":"ok"}' }; }) };
    globalThis.AIMemory = { historyMessage: () => ({ role: 'system', content: 'MEMORY' }) };
    ChatFile.attached = { name: 'f.txt', text: 'FILE', chars: 4, truncated: false, tabId: 'tab-1' };
    AIPanel._conversations['tab-1'] = Array.from({ length: 12 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: 'm' + i }));
    await AIPanel.sendMessage('chat', { message: 'q' });
    expect(history.length).toBeLessThanOrEqual(AIPanel.HISTORY_SENT);
    expect(history.some(m => m.content === 'MEMORY')).toBe(true);
    expect(history.some(m => /FILE/.test(m.content))).toBe(true);
    // The question rides as the message itself, not in the history too.
    expect(history[history.length - 1].content).toBe('m11');
  });
});

// ---- 4: an answer that starts with a code block ------------------------------
describe('_parseResponse and code blocks', () => {
  it('leaves a leading non-JSON code block alone', () => {
    const raw = '```python\nprint(1)\n```\nThat prints 1.';
    expect(AIPanel._parseResponse(raw).reply).toBe(raw);
  });
  it('still unwraps fenced JSON, closed or cut off', () => {
    expect(AIPanel._parseResponse('```json\n{"reply":"hi"}\n```').reply).toBe('hi');
    expect(AIPanel._parseResponse('```\n{"reply":"hi"}\n```').reply).toBe('hi');
    expect(AIPanel._parseResponse('```json\n{"reply": "half a sen').reply).toBe('half a sen');
  });
});

// ---- 7: "/agent …" is not a guide question -----------------------------------
describe('/agent and the guide', () => {
  it('the agent template needs more than the bare word', () => {
    expect(GuideTemplates.match('/agent book me a table')).toBe(null);
    expect(GuideTemplates.match('automate the export')).toBe(null);
    expect(GuideTemplates.match('what is the agent?').id).toBe('agent');
  });
  it('a /agent message goes to the agent even when the guide would claim it', async () => {
    globalThis.VexGuide = { isAbout: () => true, answer: () => ({ found: true }) };
    const guide = vi.spyOn(AIPanel, '_renderGuide').mockImplementation(() => {});
    const agent = vi.spyOn(AIPanel, '_sendAgent').mockImplementation(() => {});
    globalThis.AgentLoop = { start: () => {}, isRunning: () => false };
    document.getElementById('ai-input').value = '/agent how do I automate this';
    await AIPanel._sendChat();
    expect(guide).not.toHaveBeenCalled();
    expect(agent).toHaveBeenCalled();
    delete globalThis.VexGuide; delete globalThis.AgentLoop;
  });
});

// ---- 8: an attached file belongs to its tab and its chat ---------------------
describe('an attached file', () => {
  it('goes only with questions in its own tab, and New chat takes it off', () => {
    ChatFile.attached = { name: 'a.txt', text: 'x', chars: 1, truncated: false, tabId: 'tab-1' };
    expect(ChatFile.historyMessage('tab-2')).toBe(null);
    expect(ChatFile.historyMessage('tab-1')).not.toBe(null);
    globalThis.TabManager.activeTabId = 'tab-2';
    AIPanel.newChat();
    expect(ChatFile.attached).not.toBe(null);          // New chat elsewhere leaves it
    globalThis.TabManager.activeTabId = 'tab-1';
    AIPanel.newChat();
    expect(ChatFile.attached).toBe(null);
  });
});

// ---- 5, 11, 16: the local route ---------------------------------------------
describe('the local model is told everything the cloud is', () => {
  let AIRouter;
  beforeEach(async () => {
    vi.resetModules();
    AIRouter = (await import('../../src/renderer/js/ai-router.js')).AIRouter;
    globalThis.MultiTabContext = { formatForAI: (cs) => cs.map(c => c.title + ' ' + c.text).join(' | ') };
    globalThis.Ollama = { ping: vi.fn(async () => true), generate: vi.fn(async () => '{"reply":"ok"}'), chat: vi.fn(async () => '{"reply":"ok"}'), getBaseUrl: () => 'http://127.0.0.1:11434' };
  });
  afterEach(() => { delete globalThis.Ollama; delete globalThis.MultiTabContext; });

  it('Translate says which language', async () => {
    await AIRouter.callOn('local', 'translate', { selectedText: 'hallo', targetLanguage: 'Turkish' });
    expect(globalThis.Ollama.generate.mock.calls[0][1]).toContain('Target language: Turkish');
  });
  it('a multi-tab question carries the tabs', async () => {
    await AIRouter.callOn('local', 'multiTab', { message: 'compare', tabContexts: [{ title: 'Tab A', url: 'https://a', text: 'alpha' }, { title: 'Tab B', url: 'https://b', text: 'beta' }] });
    const prompt = globalThis.Ollama.generate.mock.calls[0][1];
    expect(prompt).toContain('Tab A'); expect(prompt).toContain('beta');
  });
  it('the chat passes Stop to the model call', async () => {
    const ctl = new AbortController();
    await AIRouter.callOn('local', 'chat', { message: 'q', signal: ctl.signal });
    expect(globalThis.Ollama.generate.mock.calls[0][2].signal).toBe(ctl.signal);
  });
  it('the tab command prompt reaches the local model', async () => {
    await AIRouter.callOn('local', 'chat', { message: 'close youtube', persona: { systemPrompt: 'TAB MANAGER' } });
    // A prompt that asks for no JSON gets the reply format added (2026-09-29).
    expect(globalThis.Ollama.generate.mock.calls[0][2].systemPrompt).toMatch(/^TAB MANAGER/);
  });
});

describe('TabAI', () => {
  it('sends its prompt as a persona, the shape every backend reads', async () => {
    const { TabAI } = require('../../src/renderer/js/tab-ai-media.js');
    let req;
    globalThis.AIRouter = { callAI: vi.fn(async (f, r) => { req = r; return { result: '{"close":[],"groups":[],"explanation":"none"}' }; }) };
    const m = document.createElement('div');
    m.innerHTML = '<div id="tai-out"></div><button id="tai-go"></button><input id="tai-q" value="close youtube">';
    await TabAI._plan(m);
    expect(req.persona.systemPrompt).toBe(TabAI.PROMPT);
    expect(req.personaSystemPrompt).toBeUndefined();
  });
});

// ---- 10: Catch Me Up ----------------------------------------------------------
describe('Catch Me Up', () => {
  beforeEach(() => {
    globalThis.ReadLater = { items: [{ title: 'An article', url: 'https://x', read: false }] };
    globalThis.VexFeeds = { feeds: [{ url: 'u' }], fetchAll: async () => ({ items: [{ title: 'Feed item', link: 'https://f', src: 'Feed' }], errors: [] }) };
  });
  afterEach(() => { delete globalThis.ReadLater; delete globalThis.VexFeeds; CatchMeUp._close(); });

  it('shows the reply, not the JSON around it, and lists feed items too', async () => {
    globalThis.AIRouter = { callAI: vi.fn(async () => ({ result: '{"reply":"- Two things to read"}' })) };
    await CatchMeUp.open();
    const text = document.getElementById('vex-catchup').textContent;
    expect(text).toContain('Two things to read');
    expect(text).not.toContain('"reply"');
    expect(text).toContain('Feed item');
  });
  it('says why a summary failed, and Escape closes it', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    globalThis.AIRouter = { callAI: vi.fn(async () => { throw new Error('Ollama is not running'); }) };
    await CatchMeUp.open();
    expect(document.getElementById('cmu-summary').textContent).toContain('Ollama is not running');
    expect(document.querySelector('#cmu-close svg')).not.toBe(null);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(document.getElementById('vex-catchup')).toBe(null);
  });
});

// ---- 12: Two Models sends the page ------------------------------------------
describe('Two Models', () => {
  it('asks about the page with its text', async () => {
    globalThis.WebviewManager = { getActiveWebview: () => ({}) };
    const ctx = await TwoModels._context();
    expect(ctx.text).toBe('The page text.');
  });
});

// ---- 13: teach mode and dropdowns --------------------------------------------
describe('Teach mode', () => {
  it('replays a dropdown choice as choosing an option', () => {
    expect(TeachMode.toCall({ kind: 'select', selector: '#size', value: 'L' })).toEqual({ tool: 'select_option', parameters: { selector: '#size', value: 'L' } });
    expect(TeachMode.fold([{ kind: 'select', selector: '#s', value: 'a' }, { kind: 'select', selector: '#s', value: 'b' }])).toEqual([{ kind: 'select', selector: '#s', value: 'b' }]);
  });
});

// ---- 15: partly on the graphics card is not "on the processor" ----------------
describe('where the model runs', () => {
  const state = (live) => ({ ollama: true, model: 'qwen3.5', loaded: [{ name: 'qwen3.5', ...live }], gpu: null });
  it('84% on the card is no warning', () => {
    expect(AIHealth.slowReasonFrom(state({ onGpu: true, gpuPercent: 84 }))).toBe(null);
  });
  it('mostly on the processor says how much is on the card', () => {
    expect(AIHealth.slowReasonFrom(state({ onGpu: false, gpuPercent: 30 }))).toMatch(/mostly on the processor.*only 30% of the model is on the card/);
  });
  it('Ollama.running reports the share and calls 84% on the card', async () => {
    const { Ollama } = require('../../src/renderer/js/ollama.js');
    const fetchSpy = vi.fn(async () => ({ ok: true, json: async () => ({ models: [{ name: 'qwen3.5', size: 100, size_vram: 84 }] }) }));
    window.VexNet = { fetch: fetchSpy };
    const [m] = await Ollama.running();
    expect(m.gpuPercent).toBe(84);
    expect(m.onGpu).toBe(true);
    delete window.VexNet;
  });
});

// ---- 17: Ask AI keeps a draft; removing an MCP server asks --------------------
describe('Ask AI bar', () => {
  it('does not overwrite a draft in the panel', async () => {
    document.body.insertAdjacentHTML('beforeend', '<div id="ask-ai-bar"><input id="ask-ai-input"></div>');
    const input = document.getElementById('ai-input');
    input.value = 'my half-written thought';
    let asked = null;
    vi.spyOn(AIPanel, '_sendChat').mockImplementation(() => { asked = input.value; input.value = ''; return Promise.resolve(); });
    vi.spyOn(AIPanel, 'open').mockImplementation(() => {});
    require('../../src/renderer/js/ask-ai-bar.js');
    window.AskAIBar.init();
    const q = document.getElementById('ask-ai-input');
    q.value = 'hello';
    q.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    await new Promise(r => setTimeout(r, 120));
    expect(asked).toBe('hello');
    expect(input.value).toBe('my half-written thought');
  });
});

describe('MCP servers', () => {
  it('asks before removing one, and keeps it on No', async () => {
    require('../../src/renderer/js/vex-utils.js');
    const { McpClient } = require('../../src/renderer/js/mcp-client.js');
    McpClient.load();
    McpClient.addServer('Mine', 'https://mcp.example.com/mcp', '');
    const box = document.createElement('div');
    document.body.appendChild(box);
    McpClient.renderSettings(box);
    expect(box.querySelector('[data-x] svg')).not.toBe(null);
    globalThis.vexConfirm = vi.fn(async () => false);
    box.querySelector('[data-x]').click();
    await flush();
    expect(globalThis.vexConfirm).toHaveBeenCalled();
    expect(McpClient.list()).toHaveLength(1);
    globalThis.vexConfirm = vi.fn(async () => true);
    box.querySelector('[data-x]').click();
    await flush();
    expect(McpClient.list()).toHaveLength(0);
  });
});

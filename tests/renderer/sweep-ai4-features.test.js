// @vitest-environment jsdom
//
// Smaller AI features from the 2026-09-29 sweep (area ai4): Restyle saves only
// CSS, the tab command never claims a close it will not do, Escape closes the
// three AI dialogs, a file dropped in one tab leaves another tab's alone, and
// Stop closes the agent's own dialogs.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const { VexIcons } = require('../../src/renderer/js/vex-icons.js');
globalThis.VexIcons = VexIcons; global.window.VexIcons = VexIcons;
require('../../src/renderer/js/vex-dialog.js');
const { AIRestyle } = require('../../src/renderer/js/ai-restyle.js');
const { TabAI } = require('../../src/renderer/js/tab-ai-media.js');
const { ScreenshotToCode } = require('../../src/renderer/js/screenshot-to-code.js');
const { ChatFile } = require('../../src/renderer/js/chat-file.js');
const { AgentLoop } = require('../../src/renderer/js/agent-loop.js');

const esc = (e) => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

beforeEach(() => {
  document.body.innerHTML = '<div id="ai-panel"><div id="ai-messages"></div><textarea id="ai-input"></textarea></div><button id="ai-send"></button><button id="ai-stop-agent"></button>';
  window.showToast = vi.fn();
  window.escapeHtml = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const tabs = [{ id: 'tab-1', title: 'One', url: 'https://one.example/' }, { id: 'tab-2', title: 'YouTube', url: 'https://youtube.com/' }];
  globalThis.TabManager = { activeTabId: 'tab-2', tabs, getActiveTab: () => tabs.find(t => t.id === globalThis.TabManager.activeTabId), closeTab: vi.fn() };
  globalThis.WebviewManager = { getActiveWebview: () => null };
  globalThis.vexConfirm = window.vexConfirm;
  globalThis.vexPrompt = window.vexPrompt;
});

afterEach(() => {
  delete globalThis.AIRouter; delete globalThis.VexBoosts;
  ChatFile.attached = null;
  vi.restoreAllMocks();
});

describe('AI Restyle', () => {
  it('only takes something CSS-shaped', () => {
    expect(AIRestyle._looksLikeCss("I'm sorry, but I can't help restyle that website.")).toBe(false);
    expect(AIRestyle._looksLikeCss('Here is a darker look for you, enjoy it!')).toBe(false);
    expect(AIRestyle._looksLikeCss('body { background: #111 !important; }')).toBe(true);
    expect(AIRestyle._looksLikeCss('html,body{color:#eee}')).toBe(true);
  });

  it('a refusal is not saved and not called "Restyled"', async () => {
    globalThis.VexBoosts = { boosts: {}, save: vi.fn(), applyTo: vi.fn() };
    globalThis.AIRouter = { callAI: vi.fn(async () => ({ result: "I'm sorry, I can't help with restyling that site." })) };
    AIRestyle.open();
    document.getElementById('ar-text').value = 'make it dark';
    document.getElementById('ar-apply').click();
    await vi.waitFor(() => expect(document.getElementById('ar-msg').textContent).toMatch(/did not return usable CSS/));
    expect(VexBoosts.save).not.toHaveBeenCalled();
    expect(window.showToast).not.toHaveBeenCalledWith(expect.stringMatching(/^Restyled/));
  });
});

describe('AI Tab Command', () => {
  const plan = async (json) => {
    globalThis.AIRouter = { callAI: vi.fn(async () => ({ result: JSON.stringify(json) })) };
    const m = document.createElement('div');
    m.innerHTML = '<div id="tai-out"></div><button id="tai-go"></button><input id="tai-q" value="close youtube">';
    await TabAI._plan(m);
    return m.querySelector('#tai-out').textContent;
  };

  it('says the tab you are on stays open, instead of the model\'s "Closed it"', async () => {
    const said = await plan({ close: ['tab-2'], groups: [], explanation: 'Closed the YouTube tab.' });
    expect(said).not.toMatch(/Closed/);
    expect(said).toMatch(/tab you are on/);
  });

  it('nothing to do is said as that, not as the model\'s explanation', async () => {
    const said = await plan({ close: [], groups: [], explanation: 'Closed 3 tabs.' });
    expect(said).not.toMatch(/Closed/);
    expect(said).toMatch(/Nothing to do/);
  });

  it('a plan that closes another tab still offers it', async () => {
    const said = await plan({ close: ['tab-1', 'tab-2'], groups: [], explanation: 'x' });
    expect(said).toMatch(/close 1 tab/);
    expect(said).toMatch(/stays open/);
  });
});

describe('Escape closes the AI dialogs', () => {
  it('AI Tab Command', () => {
    TabAI.open();
    expect(document.getElementById('vex-tabai-modal')).not.toBe(null);
    esc();
    expect(document.getElementById('vex-tabai-modal')).toBe(null);
  });

  it('AI Restyle', () => {
    globalThis.VexBoosts = { boosts: {}, save: vi.fn(), applyTo: vi.fn() };
    AIRestyle.open();
    esc();
    expect(document.getElementById('vex-airestyle')).toBe(null);
  });

  it('Screenshot → Code', () => {
    ScreenshotToCode.openModal('data:image/png;base64,' + 'A'.repeat(200));
    esc();
    expect(document.getElementById('vex-s2c')).toBe(null);
  });

  it('but not while a Vex dialog sits on top of it', async () => {
    TabAI.open();
    const asked = window.vexConfirm('Sure?');
    esc();   // reaches the document first (capture), and the dialog is open
    expect(document.getElementById('vex-tabai-modal')).not.toBe(null);
    document.querySelector('.vex-dialog-overlay [data-cancel]').click();
    await asked;
  });
});

describe('an attached file per tab', () => {
  it('dropping one in tab B keeps tab A\'s', () => {
    ChatFile.attached = { name: 'a.txt', text: 'A', chars: 1, truncated: false, tabId: 'tab-1' };
    ChatFile.attached = { name: 'b.txt', text: 'B', chars: 1, truncated: false, tabId: 'tab-2' };
    expect(ChatFile.historyMessage('tab-1').content).toContain('a.txt');
    expect(ChatFile.historyMessage('tab-2').content).toContain('b.txt');
    ChatFile.clear('tab-2');
    expect(ChatFile.historyMessage('tab-2')).toBe(null);
    expect(ChatFile.historyMessage('tab-1').content).toContain('a.txt');
  });

  it('the chip follows the tab on screen', () => {
    ChatFile.attached = { name: 'a.txt', text: 'A', chars: 1, truncated: false, tabId: 'tab-1' };
    ChatFile.attached = { name: 'b.txt', text: 'B', chars: 1, truncated: false, tabId: 'tab-2' };
    ChatFile.showFor('tab-1');
    expect(document.getElementById('ai-file-attach').textContent).toContain('a.txt');
    ChatFile.showFor('tab-2');
    expect(document.getElementById('ai-file-attach').textContent).toContain('b.txt');
  });
});

describe('the agent and its dialogs', () => {
  beforeEach(() => {
    globalThis.DOMExtractor = { extractInteractiveElements: async () => ({ url: 'about:blank', title: '', elements: [] }) };
    globalThis.PageContext = { extractPageContext: async () => ({ text: '' }) };
    globalThis.AgentExecutor = { executeTool: vi.fn(async () => ({ ok: true, result: 'done' })) };
    globalThis.AIPanel = { _esc: (s) => String(s == null ? '' : s) };
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => { delete globalThis.AgentExecutor; delete globalThis.DOMExtractor; delete globalThis.PageContext; delete globalThis.AIPanel; });

  const script = (steps) => {
    let i = 0;
    globalThis.AIRouter = { callAI: vi.fn(async () => ({ result: JSON.stringify(steps[Math.min(i++, steps.length - 1)]) })) };
  };
  const text = () => document.getElementById('ai-messages').textContent;

  it('Stop closes the "Risky agent action" dialog', async () => {
    script([{ tool: 'close_tab', parameters: { tabId: 't1' }, intent: 'risky' }, { tool: 'finish', parameters: { summary: 'x' } }]);
    const run = AgentLoop.start('close it', 'auto');
    await vi.waitFor(() => expect(document.querySelector('.vex-dialog-overlay')).not.toBe(null));
    AgentLoop.stop();
    await run;
    expect(document.querySelector('.vex-dialog-overlay')).toBe(null);
    expect(AgentExecutor.executeTool).not.toHaveBeenCalled();
  });

  it('a cancelled question ends the run', async () => {
    script([{ tool: 'ask_user', parameters: { question: 'Which one?' } }, { tool: 'scroll', parameters: {}, intent: 'safe' }]);
    const run = AgentLoop.start('pick one', 'auto');
    await vi.waitFor(() => expect(document.querySelector('.vex-dialog-overlay [data-cancel]')).not.toBe(null));
    document.querySelector('.vex-dialog-overlay [data-cancel]').click();
    await run;
    expect(AIRouter.callAI).toHaveBeenCalledTimes(1);
    expect(text()).toMatch(/question was cancelled/);
    expect(text()).not.toMatch(/Asked:/);
  });

  it('Stop while the question is open closes it and writes no "Asked:" after "Stopped"', async () => {
    script([{ tool: 'ask_user', parameters: { question: 'Which one?' } }, { tool: 'scroll', parameters: {}, intent: 'safe' }]);
    const run = AgentLoop.start('pick one', 'auto');
    await vi.waitFor(() => expect(document.querySelector('.vex-dialog-overlay')).not.toBe(null));
    AgentLoop.stop();
    await run;
    expect(document.querySelector('.vex-dialog-overlay')).toBe(null);
    expect(text()).toMatch(/Stopped by you/);
    expect(text()).not.toMatch(/Asked:/);
  });
});

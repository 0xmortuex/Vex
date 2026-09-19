// @vitest-environment jsdom
//
// An agent that acts on its own needs a way back. "Which of these six notes
// did it write?" is not one — so each run records what it MADE, and one button
// unmakes it. Only Vex's own things: what it did on a web page is the page's
// business and cannot be taken back from here.

import { describe, it, expect, vi, beforeEach } from 'vitest';
require('../../src/renderer/js/vex-utils.js');
const { AgentTools } = require('../../src/renderer/js/agent-tools.js');
const { AgentExecutor } = require('../../src/renderer/js/agent-executor.js');
const { AgentLoop } = require('../../src/renderer/js/agent-loop.js');

beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = '<div id="ai-messages"></div>';
  globalThis.AgentTools = AgentTools;
  // The loop looks AgentExecutor up as a global, not as an import.
  globalThis.AgentExecutor = AgentExecutor;
  globalThis.WebviewManager = { getActiveWebview: () => null, webviews: new Map() };
  globalThis.TabManager = {
    tabs: [{ id: 't1', url: 'https://a.example/' }, { id: 't2', url: 'https://b.example/' }],
    groups: [], activeTabId: 't1',
    _setTabGroup: (id, g) => { const t = TabManager.tabs.find(x => x.id === id); if (t) t.groupId = g; },
    _themeGroupPalette: () => [{ ref: '#5b8def' }],
    rebuildAllTabs: vi.fn(), persistTabs: vi.fn(),
  };
  globalThis.VexStorage = { saveGroups: vi.fn() };
  globalThis.Bookmarks = { items: [], has(u) { return this.items.some(b => b.url === u); }, save: vi.fn() };
  globalThis.VexClock = { _timers: [], parseDuration: () => 45000, fmtLeft: () => '0:45', addTimer: vi.fn(async (d, l) => { const t = { id: 'tm1', label: l || 'Timer', endAt: Date.now() + 45000, total: 45000 }; VexClock._timers.push(t); return t; }), removeTimer: vi.fn(async (id) => { VexClock._timers = VexClock._timers.filter(t => t.id !== id); }) };
  window.showToast = vi.fn();
  window.vex = {};
});

describe('what a run made', () => {
  it('each thing it created is recorded, with a name a person would recognise', async () => {
    const note = await AgentExecutor.executeTool('save_note', { title: 'Findings', content: 'x' });
    expect(note.undo).toEqual({ kind: 'note', id: expect.any(String), label: 'the note "Findings"' });

    globalThis.TabManager.tabs[0].url = 'https://keep.example/';
    const mark = await AgentExecutor.executeTool('add_bookmark', {});
    expect(mark.undo).toEqual({ kind: 'bookmark', id: 'https://keep.example/', label: 'the bookmark for https://keep.example/' });

    const group = await AgentExecutor.executeTool('group_tabs', { name: 'Work', tabIds: ['t1', 't2'] });
    expect(group.undo).toMatchObject({ kind: 'group', label: 'the tab group "Work"' });

    const timer = await AgentExecutor.executeTool('start_timer', { duration: '45s', label: 'Tea' });
    expect(timer.undo).toEqual({ kind: 'timer', id: 'tm1', label: 'the timer "Tea"' });
  });

  it('a bookmark that was already there is not claimed as something it made', async () => {
    globalThis.Bookmarks.items = [{ url: 'https://keep.example/', title: 'x' }];
    globalThis.TabManager.tabs[0].url = 'https://keep.example/';
    const mark = await AgentExecutor.executeTool('add_bookmark', {});
    expect(mark.ok).toBe(true);
    expect(mark.undo).toBeUndefined();
  });

  it('reading something makes nothing, so there is nothing to undo', async () => {
    const r = await AgentExecutor.executeTool('search_notes', { query: 'x' });
    expect(r.undo).toBeUndefined();
  });
});

describe('undoing it', () => {
  async function runThatMadeThings() {
    const queue = [
      { tool: 'save_note', parameters: { title: 'Findings', content: 'body' }, intent: 'action' },
      { tool: 'start_timer', parameters: { duration: '45s', label: 'Tea' }, intent: 'action' },
      { tool: 'finish', parameters: { summary: 'done' } },
    ];
    globalThis.AIRouter = { callAI: vi.fn(async () => ({ result: JSON.stringify(queue.shift()) })) };
    globalThis.DOMExtractor = { extractInteractiveElements: vi.fn() };
    globalThis.PageContext = { extractPageContext: vi.fn() };
    window.vexConfirm = globalThis.vexConfirm = vi.fn(async () => true);
    await AgentLoop.start('note the findings and set a timer', 'auto');
    return AgentLoop.runs()[0];
  }

  it('records both, then removes both, newest first', async () => {
    const run = await runThatMadeThings();
    expect(run.undo.map(u => u.kind)).toEqual(['note', 'timer']);
    expect(JSON.parse(localStorage.getItem('vex.notes'))).toHaveLength(1);
    expect(VexClock._timers).toHaveLength(1);

    const r = await AgentLoop.undoRun(run.id);
    expect(r.undone).toEqual(['the timer "Tea"', 'the note "Findings"']);
    expect(r.failed).toEqual([]);
    expect(JSON.parse(localStorage.getItem('vex.notes'))).toEqual([]);
    expect(VexClock._timers).toEqual([]);
    expect(AgentLoop.runs()[0].undo).toEqual([]);          // nothing left to undo
  });

  it('something already gone is reported, and does not stop the rest', async () => {
    const run = await runThatMadeThings();
    localStorage.setItem('vex.notes', '[]');                // the user deleted it themselves
    const r = await AgentLoop.undoRun(run.id);
    expect(r.undone).toEqual(['the timer "Tea"']);
    expect(r.failed).toEqual(['the note "Findings" (already gone)']);
    // The one that failed stays on the list, so a second attempt can finish.
    expect(AgentLoop.runs()[0].undo.map(u => u.kind)).toEqual(['note']);
  });

  it('a run that only read things says so plainly', async () => {
    globalThis.AIRouter = { callAI: vi.fn(async () => ({ result: JSON.stringify({ tool: 'finish', parameters: { summary: 'nothing to do' } }) })) };
    globalThis.DOMExtractor = { extractInteractiveElements: vi.fn() };
    globalThis.PageContext = { extractPageContext: vi.fn() };
    await AgentLoop.start('what is 2+2', 'auto');
    await expect(AgentLoop.undoRun(AgentLoop.runs()[0].id)).rejects.toThrow(/did not make anything Vex can take back/);
    await expect(AgentLoop.undoRun('nope')).rejects.toThrow(/no longer saved/);
  });

  it('only Vex’s own things are undoable — a click on a page is not', () => {
    expect(AgentLoop.UNDOABLE).toEqual(['note', 'bookmark', 'group', 'timer', 'reminder', 'watch', 'github-watch', 'setting']);
    for (const t of ['click', 'type_text', 'navigate']) expect(AgentLoop.UNDOABLE).not.toContain(t);
  });
});

describe('what a run cost', () => {
  it('each step says its seconds and tokens; the end adds them up', () => {
    document.body.innerHTML = '<div id="ai-messages"></div>';
    AgentLoop._run = { steps: [] };
    AgentLoop._noteCost(4210, { promptTokens: 1203, replyTokens: 88 });
    AgentLoop._noteCost(1800, { promptTokens: 1500, replyTokens: 40 });
    const lines = [...document.querySelectorAll('.agent-step-cost')].map(e => e.textContent.trim());
    expect(lines[0]).toMatch(/4\.2 s · 1,203 → 88 tokens/);
    expect(AgentLoop._costTotal()).toBe(' — 2 steps, 6.0 s thinking, 2,703 tokens in, 128 out');
  });

  it('the cloud reports no tokens: seconds only', () => {
    document.body.innerHTML = '<div id="ai-messages"></div>';
    AgentLoop._run = { steps: [] };
    AgentLoop._noteCost(2500, null);
    expect(AgentLoop._costTotal()).toBe(' — 1 step, 2.5 s thinking');
    AgentLoop._run = null;
  });
});

describe('sites the agent may always act on', () => {
  it('"Always on" is remembered across runs, and can be removed', () => {
    localStorage.removeItem(AgentLoop.TRUST_KEY);
    AgentLoop._allowedSites = new Set();
    AgentLoop._currentSite = 'https://github.com';
    const click = { tool: 'click_text', parameters: { text: 'Merge' } };
    expect(AgentLoop._offTask(click)).toBe('https://github.com');
    AgentLoop.trustSite('https://github.com/some/page');
    expect(AgentLoop.trustedSites()).toEqual(['https://github.com']);
    AgentLoop._allowedSites = new Set();                       // a new run
    expect(AgentLoop._offTask(click)).toBeNull();
    AgentLoop.untrustSite('https://github.com');
    expect(AgentLoop._offTask(click)).toBe('https://github.com');
  });

  it('the question offers it, and choosing it allows this step and remembers the site', async () => {
    localStorage.removeItem(AgentLoop.TRUST_KEY);
    document.body.innerHTML = '<div id="ai-messages"></div>';
    AgentLoop._allowedSites = new Set();
    AgentLoop._currentSite = 'https://shop.example';
    AgentLoop._mode = 'auto';
    const answer = AgentLoop._checkPermission({ tool: 'click_text', parameters: { text: 'Add' }, intent: 'action' });
    await new Promise(r => setTimeout(r, 0));
    const always = document.querySelector('.agent-always');
    expect(always.textContent).toBe('Always on shop.example');
    always.click();
    expect(await answer).toBe(true);
    expect(AgentLoop.trustedSites()).toEqual(['https://shop.example']);
  });
});

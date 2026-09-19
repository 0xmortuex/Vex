// @vitest-environment jsdom
//
// A run that worked is a recipe. Doing it again through the model costs thirty
// seconds, a model load and a slightly different answer each time — when what
// the user wants is the same six steps. A macro is those steps, replayed
// directly, under the same permission rules as the agent itself.

import { describe, it, expect, vi, beforeEach } from 'vitest';
require('../../src/renderer/js/vex-utils.js');
const { AgentLoop, SAFE_TOOLS } = require('../../src/renderer/js/agent-loop.js');

let exec;
function script(decisions) {
  const queue = decisions.slice();
  globalThis.AIRouter = { callAI: vi.fn(async () => ({ result: JSON.stringify(queue.shift() || { tool: 'finish', parameters: { summary: 'done' } }) })) };
}

beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = '<div id="ai-messages"></div><button id="ai-send"></button><button id="ai-stop-agent"></button>';
  exec = { executeTool: vi.fn(async (tool) => ({ ok: true, result: tool + ' ok' })) };
  globalThis.AgentExecutor = exec;
  globalThis.WebviewManager = { getActiveWebview: () => ({ getURL: () => 'https://shop.example/orders' }) };
  globalThis.TabManager = { tabs: [], groups: [], activeTabId: null };
  globalThis.DOMExtractor = { extractInteractiveElements: vi.fn(async () => ({ url: 'https://shop.example/orders', title: 'Orders', elements: [] })) };
  globalThis.PageContext = { extractPageContext: vi.fn(async () => ({ text: '' })) };
  globalThis.VexProblems = { note: vi.fn() };
  delete globalThis.AIPanel;
  window.vexConfirm = globalThis.vexConfirm = vi.fn(async () => true);
  window.showToast = vi.fn();
});

async function aRunThatWorked() {
  script([
    { tool: 'click_text', parameters: { text: 'Orders' }, intent: 'action' },
    { tool: 'extract_text', parameters: {}, intent: 'safe' },
    { tool: 'save_note', parameters: { title: 'Orders', content: 'x' }, intent: 'action' },
    { tool: 'finish', parameters: { summary: 'done' } },
  ]);
  await AgentLoop.start('check my orders on shop.example', 'auto');
  return AgentLoop.runs()[0];
}

describe('keeping a run', () => {
  it('records the calls it made, in order, without the conversation ones', async () => {
    const run = await aRunThatWorked();
    expect(run.calls.map(c => c.tool)).toEqual(['click_text', 'extract_text', 'save_note']);
    const macro = AgentLoop.saveAsMacro(run.id, 'Check my orders');
    expect(macro).toMatchObject({ name: 'Check my orders', goal: 'check my orders on shop.example' });
    expect(macro.calls.map(c => c.tool)).toEqual(['click_text', 'extract_text', 'save_note']);
    expect(AgentLoop.macros()).toHaveLength(1);
  });

  it('a run that only answered a question is not a recipe', async () => {
    script([{ tool: 'finish', parameters: { summary: '4' } }]);
    await AgentLoop.start('what is 2+2', 'auto');
    expect(() => AgentLoop.saveAsMacro(AgentLoop.runs()[0].id, 'x')).toThrow(/did nothing that can be repeated/);
    expect(() => AgentLoop.saveAsMacro('nope', 'x')).toThrow(/no longer saved/);
  });

  it('can be removed', async () => {
    const macro = AgentLoop.saveAsMacro((await aRunThatWorked()).id, 'x');
    AgentLoop.deleteMacro(macro.id);
    expect(AgentLoop.macros()).toEqual([]);
  });
});

describe('repeating it', () => {
  it('does the same steps with no AI at all, and counts the run', async () => {
    const macro = AgentLoop.saveAsMacro((await aRunThatWorked()).id, 'Check my orders');
    exec.executeTool.mockClear();
    globalThis.AIRouter.callAI.mockClear();

    const out = await AgentLoop.runMacro(macro.id, 'auto');
    expect(out.failed).toBe(null);
    expect(out.done).toEqual(['click_text', 'extract_text', 'save_note']);
    expect(exec.executeTool.mock.calls.map(c => c[0])).toEqual(['click_text', 'extract_text', 'save_note']);
    expect(AIRouter.callAI).not.toHaveBeenCalled();                 // the whole point
    expect(AgentLoop.macros()[0].runs).toBe(1);
    expect(document.getElementById('ai-messages').textContent).toMatch(/Repeated 3 steps, without the AI/);
  });

  it('when the page has changed, the AI takes over from the step that failed', async () => {
    const macro = AgentLoop.saveAsMacro((await aRunThatWorked()).id, 'Check my orders');
    exec.executeTool = vi.fn(async (tool) => (tool === 'extract_text' ? { ok: false, error: 'No element matches "Orders"' } : { ok: true, result: 'ok' }));
    const start = vi.spyOn(AgentLoop, 'start').mockResolvedValue();
    const out = await AgentLoop.runMacro(macro.id, 'auto');
    expect(out.done).toEqual(['click_text']);
    expect(out.failed).toEqual({ tool: 'extract_text', error: 'No element matches "Orders"' });
    expect(out.handedOver).toBe(true);
    const said = document.getElementById('ai-messages').textContent;
    expect(said).toMatch(/Stopped at extract_text: No element matches/);
    expect(said).toMatch(/the AI is taking over from here/);
    const [goal, mode] = start.mock.calls[0];
    expect(goal).toMatch(/already did: click_text\. It then failed at extract_text/);
    expect(mode).toBe('auto');
    expect(AgentLoop.macros()[0].runs).toBe(0);                     // a failed run is not a run
    start.mockRestore();
  });

  it('not when you stopped it yourself', async () => {
    const macro = AgentLoop.saveAsMacro((await aRunThatWorked()).id, 'Check my orders');
    exec.executeTool = vi.fn(async () => { AgentLoop._running = false; return { ok: true, result: 'ok' }; });
    const start = vi.spyOn(AgentLoop, 'start').mockResolvedValue();
    const out = await AgentLoop.runMacro(macro.id, 'auto');
    expect(out.handedOver).toBe(false);
    expect(start).not.toHaveBeenCalled();
    start.mockRestore();
  });

  it('still asks before acting on a site the task never mentioned', async () => {
    const run = await aRunThatWorked();
    // A recorded step that navigates somewhere else entirely.
    const list = AgentLoop.runs().map(r => (r.id === run.id ? { ...r, calls: [{ tool: 'navigate', parameters: { url: 'https://elsewhere.example/pay' } }] } : r));
    localStorage.setItem(AgentLoop.RUNS_KEY, JSON.stringify(list));
    const macro = AgentLoop.saveAsMacro(run.id, 'Sneaky');
    exec.executeTool.mockClear();

    const running = AgentLoop.runMacro(macro.id, 'auto');
    await vi.waitFor(() => expect(document.querySelector('.agent-approve')).not.toBe(null));
    expect(document.querySelector('.agent-plan-heading').textContent).toMatch(/elsewhere\.example, which you did not ask about/);
    document.querySelector('.agent-deny').click();
    const out = await running;
    expect(out.failed).toEqual({ tool: 'navigate', error: 'You did not allow it' });
    expect(exec.executeTool).not.toHaveBeenCalled();
  });

  it('will not start while the agent is running, and says so', async () => {
    const macro = AgentLoop.saveAsMacro((await aRunThatWorked()).id, 'x');
    AgentLoop._running = true;
    expect(await AgentLoop.runMacro(macro.id)).toBe(null);
    expect(window.showToast).toHaveBeenCalledWith('The agent is running — stop it first');
    AgentLoop._running = false;
    await expect(AgentLoop.runMacro('gone')).rejects.toThrow(/macro is gone/);
  });

  it('a read-only step needs no permission, an acting one does', async () => {
    for (const t of ['extract_text', 'read_url', 'search_notes']) expect(SAFE_TOOLS).toContain(t);
    for (const t of ['click_text', 'save_note', 'navigate']) expect(SAFE_TOOLS).not.toContain(t);
  });
});

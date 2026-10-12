// @vitest-environment jsdom
// AI audit (2026-10-10): agent permission modes, downloads in Auto-approve,
// Undo of a run that made a schedule.
import { beforeEach, describe, expect, it, vi } from 'vitest';

require('../../src/renderer/js/vex-utils.js');
const { AgentLoop } = require('../../src/renderer/js/agent-loop.js');

let exec;
const tick = (ms = 0) => new Promise(r => setTimeout(r, ms));
function script(decisions) {
  const queue = decisions.slice();
  globalThis.AIRouter = { callAI: vi.fn(async () => ({ result: JSON.stringify(queue.shift() || { tool: 'finish', parameters: { summary: 'done' } }) })) };
}

beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = '<div id="ai-messages"></div><button id="ai-send"></button><button id="ai-stop-agent"></button><button id="ai-pause-agent"></button>';
  exec = { executeTool: vi.fn(async (tool) => ({ ok: true, result: tool + ' ok' })) };
  globalThis.AgentExecutor = exec;
  globalThis.WebviewManager = { getActiveWebview: () => ({ getURL: () => 'https://shop.example/orders' }) };
  globalThis.TabManager = { tabs: [], groups: [], activeTabId: null };
  globalThis.DOMExtractor = { extractInteractiveElements: vi.fn(async () => ({ url: 'https://shop.example/orders', title: 'Orders', elements: [] })) };
  globalThis.PageContext = { extractPageContext: vi.fn(async () => ({ text: '' })) };
  globalThis.VexProblems = { note: vi.fn() };
  delete globalThis.AIPanel;
  delete globalThis.AgentRunCard;
  window.vexConfirm = globalThis.vexConfirm = vi.fn(async () => true);
  window.showToast = vi.fn();
  AgentLoop._running = false; AgentLoop._mode = 'ask'; AgentLoop._planApproved = false;
});

describe('Undo of a run that made a schedule', () => {
  it('removes the schedule create_schedule recorded (undo kind "schedule")', async () => {
    globalThis.Scheduler = { getTask: vi.fn(() => ({ id: 's1' })), deleteTask: vi.fn() };
    localStorage.setItem('vex.agentRuns', JSON.stringify([{ id: 'run1', goal: 'every morning check x', steps: [{}], undo: [{ kind: 'schedule', id: 's1', label: 'the schedule "Check x"' }], calls: [] }]));
    const r = await AgentLoop.undoRun('run1');
    expect(r.undone).toEqual(['the schedule "Check x"']);
    expect(Scheduler.deleteTask).toHaveBeenCalledWith('s1');
    delete globalThis.Scheduler;
  });
});

describe('Repeat a task (Ctrl+K) permission mode', () => {
  it('asks before each step when the chosen mode is "Approve manually", even after an auto-approve run', async () => {
    script([{ tool: 'finish', parameters: { summary: 'done' } }]);
    await AgentLoop.start('look at my orders on shop.example', 'auto');
    localStorage.setItem('vex.agentMode', 'ask');
    const macro = AgentLoop.saveMacroFromSteps('Open orders', [{ tool: 'click_text', parameters: { text: 'Orders' } }]);
    const p = AgentLoop.runMacro(macro.id);
    await tick(50);
    const asked = document.querySelectorAll('.agent-approve').length > 0;
    const ran = exec.executeTool.mock.calls.length;
    AgentLoop.stop(); await p.catch(() => {});
    expect({ asked, ran }).toEqual({ asked: true, ran: 0 });
  });

  it('a plan approved in an earlier Plan-first run does not pre-approve a later replay', async () => {
    localStorage.setItem('vex.agentMode', 'plan');
    AgentLoop._mode = 'plan'; AgentLoop._planApproved = true;
    const macro = AgentLoop.saveMacroFromSteps('Open orders', [{ tool: 'click_text', parameters: { text: 'Orders' } }]);
    const p = AgentLoop.runMacro(macro.id);
    await tick(50);
    const asked = document.querySelectorAll('.agent-approve').length > 0;
    const ran = exec.executeTool.mock.calls.length;
    AgentLoop.stop(); await p.catch(() => {});
    expect({ asked, ran }).toEqual({ asked: true, ran: 0 });
  });

  it('Auto-approve chosen in the panel replays without asking', async () => {
    localStorage.setItem('vex.agentMode', 'auto');
    const macro = AgentLoop.saveMacroFromSteps('Open orders', [{ tool: 'click_text', parameters: { text: 'Orders' } }]);
    await AgentLoop.runMacro(macro.id);
    expect(exec.executeTool).toHaveBeenCalledTimes(1);
  });
});

describe('Auto-approve and MCP tools', () => {
  it('asks before an MCP server tool runs', async () => {
    AgentLoop._mode = 'auto'; AgentLoop._allowedSites = new Set(['https://shop.example']); AgentLoop._currentSite = 'https://shop.example';
    const p = AgentLoop._checkPermission({ tool: 'mcp__mcp_a__write_file', parameters: { path: 'x' }, intent: 'action', thought: 'write it' });
    await tick(20);
    const asked = vexConfirm.mock.calls.length > 0 || document.querySelectorAll('.agent-approve').length > 0;
    expect(asked).toBe(true);
    AgentLoop.stop();
    await Promise.race([p, tick(50)]);
  });
});

describe('Auto-approve and download_file', () => {
  it('asks before downloading a file (the tool description promises "The user is asked first")', async () => {
    AgentLoop._mode = 'auto'; AgentLoop._allowedSites = new Set(['https://shop.example']); AgentLoop._currentSite = 'https://shop.example';
    const p = AgentLoop._checkPermission({ tool: 'download_file', parameters: { url: 'https://files.example/setup.exe' }, intent: 'action', thought: 'get the installer' });
    await tick(20);
    const asked = vexConfirm.mock.calls.length > 0 || document.querySelectorAll('.agent-approve').length > 0;
    expect(asked).toBe(true);
    document.querySelectorAll('.agent-approve button').forEach(b => { if (/deny|no|cancel/i.test(b.textContent)) b.click(); });
    AgentLoop.stop();
    await Promise.race([p, tick(50)]);
  });
});


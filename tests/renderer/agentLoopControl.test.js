// @vitest-environment jsdom
//
// Control-flow regressions in the agent loop:
//
//   Stop        _running was only checked at the top of the while loop, so a Stop
//               pressed while the model was thinking still let that iteration run
//               its tool — the agent took one more action AFTER the user said stop.
//   Max iters   "Max iterations reached" (plus a failure summary) was printed
//               whenever the loop ended on the last step, including a successful
//               finish and a user Stop.
//   Plan mode   _checkPermission returned true for every action in 'plan' mode,
//               so choosing Plan silently removed all approval — less safe than
//               Ask, and no plan was ever shown.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const { AgentLoop } = require('../../src/renderer/js/agent-loop.js');

function panelText() {
  return document.getElementById('ai-messages').textContent;
}

let executed;

beforeEach(() => {
  document.body.innerHTML = '<div id="ai-messages"></div><button id="ai-send-agent"></button><button id="ai-stop-agent"></button>';
  executed = [];
  globalThis.window.showToast = vi.fn();
  globalThis.WebviewManager = { getActiveWebview: () => null };
  globalThis.DOMExtractor = { extractInteractiveElements: async () => ({ url: 'about:blank', title: '', elements: [] }) };
  globalThis.PageContext = { extractPageContext: async () => ({ text: '' }) };
  globalThis.AgentExecutor = {
    executeTool: vi.fn(async (tool, params) => { executed.push({ tool, params }); return { ok: true, result: 'done' }; }),
  };
  globalThis.AIPanel = { _esc: (s) => String(s == null ? '' : s) };
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  delete globalThis.AIRouter; delete globalThis.AgentExecutor; delete globalThis.WebviewManager;
  delete globalThis.DOMExtractor; delete globalThis.PageContext; delete globalThis.AIPanel;
  delete globalThis.vexConfirm;
  vi.restoreAllMocks();
});

// Answers a scripted sequence of tool calls.
function scriptRouter(steps) {
  let i = 0;
  globalThis.AIRouter = {
    callAI: vi.fn(async () => {
      const step = steps[Math.min(i++, steps.length - 1)];
      if (typeof step === 'function') return { result: JSON.stringify(await step()) };
      return { result: JSON.stringify(step) };
    }),
  };
}

describe('Stop', () => {
  it('does not run one more tool after the user stops mid-request', async () => {
    globalThis.AIRouter = {
      callAI: vi.fn(async () => {
        AgentLoop.stop();                       // user hits Stop while "thinking"
        return { result: JSON.stringify({ tool: 'click', parameters: { selector: '#buy' }, intent: 'action' }) };
      }),
    };
    await AgentLoop.start('buy the thing', 'auto');
    expect(executed).toEqual([]);
    expect(panelText()).toMatch(/Stopped by you/);
  });
});

describe('max iterations', () => {
  it('is not reported when the agent finishes on the final step', async () => {
    AgentLoop._maxIter = 2;
    scriptRouter([
      { tool: 'scroll', parameters: { direction: 'down' }, intent: 'action' },
      { tool: 'finish', parameters: { summary: 'All done' } },
    ]);
    await AgentLoop.start('scroll then finish', 'auto');
    expect(panelText()).toMatch(/All done/);
    expect(panelText()).not.toMatch(/Max iterations reached/);
    AgentLoop._maxIter = 15;
  });

  it('is reported when the agent really runs out of steps', async () => {
    AgentLoop._maxIter = 2;
    scriptRouter([{ tool: 'scroll', parameters: { direction: 'down' }, intent: 'action' }]);
    await AgentLoop.start('scroll forever', 'auto');
    expect(panelText()).toMatch(/Max iterations reached/);
    AgentLoop._maxIter = 15;
  });
});

describe('plan mode', () => {
  it('asks once before the first non-safe action, then continues', async () => {
    AgentLoop._maxIter = 3;
    scriptRouter([
      { tool: 'click', parameters: { selector: '#a' }, intent: 'action', thought: 'click a' },
      { tool: 'click', parameters: { selector: '#b' }, intent: 'action', thought: 'click b' },
      { tool: 'finish', parameters: { summary: 'ok' } },
    ]);
    const run = AgentLoop.start('do a then b', 'plan');

    // The approval card must appear — plan mode used to execute with no prompt.
    await vi.waitFor(() => {
      const btn = document.querySelector('.agent-approve');
      expect(btn).toBeTruthy();
      btn.click();
    });
    await run;

    expect(document.querySelector('.agent-plan-heading')).toBeTruthy();
    expect(executed.map(e => e.params.selector)).toEqual(['#a', '#b']);
    AgentLoop._maxIter = 15;
  });

  it('stops the run when the plan is denied', async () => {
    scriptRouter([{ tool: 'click', parameters: { selector: '#a' }, intent: 'action' }]);
    const run = AgentLoop.start('do a', 'plan');
    await vi.waitFor(() => {
      const btn = document.querySelector('.agent-deny');
      expect(btn).toBeTruthy();
      btn.click();
    });
    await run;
    expect(executed).toEqual([]);
    expect(panelText()).toMatch(/denied/i);
  });

  it('still confirms an action the model flags risky after the plan is approved', async () => {
    AgentLoop._maxIter = 3;
    globalThis.vexConfirm = vi.fn(async () => false);   // user says no to the risky one
    scriptRouter([
      { tool: 'click', parameters: { selector: '#a' }, intent: 'action' },  // approves the plan
      { tool: 'close_tab', parameters: { tabId: 't1' }, intent: 'risky' },
      { tool: 'finish', parameters: { summary: 'ok' } },
    ]);
    const run = AgentLoop.start('tidy up', 'plan');
    await vi.waitFor(() => {
      const btn = document.querySelector('.agent-approve');
      expect(btn).toBeTruthy();
      btn.click();
    });
    await run;

    expect(globalThis.vexConfirm).toHaveBeenCalled();
    expect(executed.map(e => e.tool)).toEqual(['click']);   // close_tab was refused
    AgentLoop._maxIter = 15;
  });
});

describe('backend returning nothing', () => {
  it('explains instead of throwing a TypeError', async () => {
    globalThis.AIRouter = { callAI: vi.fn(async () => null) };
    await AgentLoop.start('do something', 'auto');
    expect(panelText()).toMatch(/returned nothing/i);
    expect(panelText()).not.toMatch(/Cannot read/);
  });
});

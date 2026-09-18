// @vitest-environment jsdom
//
// Four things about a run, beyond choosing tools:
//   Stop cancels the model call IN FLIGHT (it used to set a flag, and a local
//     model carried on generating for 10-20 s before anything happened);
//   a screenshot reaches the model as an image, once, never as base64 text;
//   the run is saved, and can be put back in the chat;
//   the final answer can be kept as a note.
// And a scheduled run is offered research and notes, with the guide.

import { describe, it, expect, vi, beforeEach } from 'vitest';

require('../../src/renderer/js/vex-utils.js');
const { AgentTools } = require('../../src/renderer/js/agent-tools.js');
const { AgentLoop, AGENT_TOOLS, HEADLESS_TOOLS, SAFE_TOOLS, agentGuide } = require('../../src/renderer/js/agent-loop.js');
const { SCHEDULED_TOOLS } = require('../../src/renderer/js/agent-executor.js');

let calls;
function script(decisions) {
  calls = [];
  const queue = decisions.slice();
  globalThis.AIRouter = { callAI: vi.fn(async (feature, req) => { calls.push(req); return { result: JSON.stringify(queue.shift() || { tool: 'finish', parameters: { summary: 'ran out' } }), backend: 'local', model: 'qwen-test' }; }) };
}

beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = '<div id="ai-messages"></div>';
  globalThis.WebviewManager = { getActiveWebview: () => null };
  globalThis.DOMExtractor = { extractInteractiveElements: vi.fn() };
  globalThis.PageContext = { extractPageContext: vi.fn() };
  globalThis.AgentExecutor = { executeTool: vi.fn(async (tool) => ({ ok: true, result: tool + ' ok' })) };
  globalThis.AgentTools = AgentTools;
  delete globalThis.AIPanel; delete globalThis.McpClient;
  window.vexConfirm = globalThis.vexConfirm = vi.fn(async () => true);
  window.showToast = vi.fn();
});

describe('Stop', () => {
  it('aborts the request in flight and ends as "Stopped by you", not as an error', async () => {
    let seen;
    globalThis.AIRouter = { callAI: vi.fn((feature, req) => new Promise((resolve, reject) => {
      seen = req.signal;
      req.signal.addEventListener('abort', () => reject(req.signal.reason));
    })) };
    const run = AgentLoop.start('long research', 'auto');
    await vi.waitFor(() => expect(seen).toBeTruthy());
    expect(seen.aborted).toBe(false);
    AgentLoop.stop();
    await run;
    expect(seen.aborted).toBe(true);
    const text = document.getElementById('ai-messages').textContent;
    expect(text).toContain('Stopped by you.');
    expect(text).not.toMatch(/Error:/);
    expect(AgentExecutor.executeTool).not.toHaveBeenCalled();
  });

  it('every run gets a fresh signal', async () => {
    script([{ tool: 'finish', parameters: { summary: 'one' } }]);
    await AgentLoop.start('a', 'auto');
    const first = calls[0].signal;
    script([{ tool: 'finish', parameters: { summary: 'two' } }]);
    await AgentLoop.start('b', 'auto');
    expect(calls[0].signal).not.toBe(first);
    expect(calls[0].signal.aborted).toBe(false);
  });
});

describe('a screenshot', () => {
  it('is shown to the model on the next turn only, and never enters the text', async () => {
    globalThis.AgentExecutor = { executeTool: vi.fn(async (tool) => tool === 'screenshot'
      ? { ok: true, result: { hasScreenshot: true, width: 1024, height: 576 }, image: 'data:image/jpeg;base64,PIXELS' }
      : { ok: true, result: 'ok' }) };
    script([{ tool: 'screenshot', parameters: {}, intent: 'safe' }, { tool: 'scroll', parameters: { direction: 'down' }, intent: 'safe' }, { tool: 'finish', parameters: { summary: 'a chart' } }]);
    await AgentLoop.start('what does the chart show', 'auto');
    expect(calls.map(c => c.image)).toEqual([null, 'data:image/jpeg;base64,PIXELS', null]);
    expect(document.getElementById('ai-messages').textContent).toContain('Looked at the page (1024 × 576)');
    expect(JSON.stringify(calls[1].lastToolResult)).not.toContain('PIXELS');
    expect(JSON.stringify(calls[2].conversationHistory)).not.toContain('PIXELS');
    expect(localStorage.getItem('vex.agentRuns')).not.toContain('PIXELS');
  });
});

describe('saved runs', () => {
  it('keeps the goal, mode, backend, steps and answer, newest first, 30 at most', async () => {
    script([{ tool: 'web_search', parameters: { query: 'x' }, intent: 'safe', thought: 'look it up' }, { tool: 'finish', parameters: { summary: 'The **answer**' } }]);
    await AgentLoop.start('find x', 'auto');
    const [run] = AgentLoop.runs();
    expect(run).toMatchObject({ goal: 'find x', mode: 'auto', backend: 'local · qwen-test', final: 'The **answer**' });
    expect(run.steps.map(s => s.type)).toEqual(['agent-start', 'action', 'result', 'end']);
    expect(run.steps.some(s => s.type === 'thinking')).toBe(false);
    expect(typeof run.seconds).toBe('number');

    localStorage.setItem('vex.agentRuns', JSON.stringify(Array.from({ length: 30 }, (_, i) => ({ id: 'old' + i, goal: 'g', steps: [{}], startedAt: 1 }))));
    script([{ tool: 'finish', parameters: { summary: 'newest' } }]);
    await AgentLoop.start('again', 'ask');
    expect(AgentLoop.runs()).toHaveLength(30);
    expect(AgentLoop.runs()[0].final).toBe('newest');
    expect(AgentLoop.runs().at(-1).id).toBe('old28');
  });

  it('a run that ended without an answer is saved too', async () => {
    globalThis.AIRouter = { callAI: vi.fn(async () => { throw new Error('Ollama is not running'); }) };
    await AgentLoop.start('doomed', 'auto');
    expect(AgentLoop.runs()[0]).toMatchObject({ goal: 'doomed', final: null });
    expect(AgentLoop.runs()[0].steps.map(s => s.text).join(' ')).toContain('Ollama is not running');
  });

  it('showRun puts it back in the chat without recording a second copy', async () => {
    script([{ tool: 'web_search', parameters: { query: 'x' }, intent: 'safe' }, { tool: 'finish', parameters: { summary: 'kept answer' } }]);
    await AgentLoop.start('find x', 'auto');
    document.getElementById('ai-messages').innerHTML = '<div>something else</div>';
    AgentLoop.showRun(AgentLoop.runs()[0].id);
    const text = document.getElementById('ai-messages').textContent;
    expect(text).toContain('Agent started: find x');
    expect(text).toContain('kept answer');
    expect(text).not.toContain('something else');
    expect(AgentLoop.runs()).toHaveLength(1);
    expect(() => AgentLoop.showRun('gone')).toThrow(/no longer saved/);
    AgentLoop.deleteRun(AgentLoop.runs()[0].id);
    expect(AgentLoop.runs()).toEqual([]);
  });
});

describe('the final answer', () => {
  it('Save as note writes it to Notes under the goal; Copy copies it', async () => {
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    script([{ tool: 'finish', parameters: { summary: 'Canberra [1]\n\nSources\n1. https://a.example' } }]);
    await AgentLoop.start('capital of Australia?', 'auto');
    const [note, copy] = document.querySelectorAll('.agent-final .agent-final-btn');
    note.click();
    const saved = JSON.parse(localStorage.getItem('vex.notes'))[0];
    expect(saved).toMatchObject({ title: 'capital of Australia?', tags: ['agent'] });
    expect(saved.content).toContain('https://a.example');
    expect(note.disabled).toBe(true);
    expect(note.textContent).toBe('Saved to Notes');
    copy.click();
    await vi.waitFor(() => expect(copy.textContent).toBe('Copied'));
    expect(writeText).toHaveBeenCalledWith('Canberra [1]\n\nSources\n1. https://a.example');
  });
});

describe('what the agent knows about Vex', () => {
  it('has the timer, feature and command tools; only the read-only ones are safe', () => {
    const names = AGENT_TOOLS.map(t => t.name);
    for (const t of ['start_timer', 'list_timers', 'cancel_timer', 'vex_features', 'vex_command']) expect(names).toContain(t);
    for (const t of ['list_timers', 'vex_features']) expect(SAFE_TOOLS).toContain(t);
    for (const t of ['start_timer', 'cancel_timer', 'vex_command']) expect(SAFE_TOOLS).not.toContain(t);
    expect(AGENT_TOOLS.find(t => t.name === 'start_timer').description).toMatch(/NEVER open a timer website/);
  });

  it('the guide says Vex does it itself, and carries the catalogue when it is loaded', () => {
    expect(agentGuide('auto')).toMatch(/A timer is start_timer, never a timer website/);
    expect(agentGuide('auto')).not.toMatch(/WHAT VEX HAS BUILT IN/);        // no catalogue loaded here
    const { VexFeatures } = require('../../src/renderer/js/feature-catalog.js');
    globalThis.VexFeatures = VexFeatures;
    try { expect(agentGuide('auto')).toMatch(/WHAT VEX HAS BUILT IN .* Tabs & windows: /); }
    finally { delete globalThis.VexFeatures; }
  });

  it('a Vex command that wipes or signs out is asked about even in auto-approve', async () => {
    expect(AgentLoop._looksRisky({ tool: 'vex_command', parameters: { command: 'clear browsing data' } })).toBe(true);
    expect(AgentLoop._looksRisky({ tool: 'vex_command', parameters: { command: 'alarm 7am weekdays' } })).toBe(false);
    script([{ tool: 'vex_command', parameters: { command: 'reset settings' }, intent: 'action' }, { tool: 'finish', parameters: { summary: 'x' } }]);
    window.vexConfirm = globalThis.vexConfirm = vi.fn(async () => false);
    await AgentLoop.start('reset everything', 'auto');
    expect(vexConfirm).toHaveBeenCalledTimes(1);
    expect(AgentExecutor.executeTool).not.toHaveBeenCalled();
  });
});

describe('a scheduled (unattended) run', () => {
  const wv = () => ({ isConnected: true, getURL: () => 'https://news.example/', _navigationGeneration: 1 });

  it('is offered research and notes, with the guide, and the executor allows exactly what is offered', async () => {
    expect(HEADLESS_TOOLS).toEqual(SCHEDULED_TOOLS);
    script([{ tool: 'web_search', parameters: { query: 'gpu prices' }, intent: 'safe' }, { tool: 'save_note', parameters: { title: 'GPU', content: '499' }, intent: 'action' }, { tool: 'finish', parameters: { summary: 'saved' } }]);
    const out = await AgentLoop.startHeadless('track gpu prices', 'auto', { webview: wv() });
    expect(out).toEqual({ summary: 'saved', iterations: 3 });
    expect(calls[0].availableTools.map(t => t.name).sort()).toEqual(HEADLESS_TOOLS.filter(t => AGENT_TOOLS.some(a => a.name === t)).sort());
    expect(calls[0].conversationHistory[0].content).toMatch(/This run is UNATTENDED/);
    expect(AgentExecutor.executeTool).toHaveBeenCalledWith('save_note', { title: 'GPU', content: '499' }, expect.objectContaining({ scheduled: true }));
  });

  it('works around a read that failed, but a failure in its own tab still ends it', async () => {
    globalThis.AgentExecutor = { executeTool: vi.fn(async (tool) => tool === 'read_url' ? { ok: false, error: 'HTTP 403' } : tool === 'navigate' ? { ok: false, error: 'Navigation failed' } : { ok: true, result: 'ok' }) };
    script([{ tool: 'read_url', parameters: { url: 'https://a.example' }, intent: 'safe' }, { tool: 'finish', parameters: { summary: 'used another source' } }]);
    expect((await AgentLoop.startHeadless('x', 'auto', { webview: wv() })).summary).toBe('used another source');
    expect(calls[1].lastToolResult).toEqual({ ok: false, error: 'HTTP 403' });
    script([{ tool: 'navigate', parameters: { url: 'https://a.example' }, intent: 'action' }]);
    await expect(AgentLoop.startHeadless('x', 'auto', { webview: wv() })).rejects.toThrow('Navigation failed');
  });
});

// A local model takes tens of seconds to answer, and "Thinking…" for a minute
// is indistinguishable from a hang — which is exactly what it looked like when
// a game had the graphics card. The reply is shown as it is written, and the
// reason for the slowness is said out loud.
describe('a slow model explains itself', () => {
  it('the live row shows the thought and the tool as they arrive', async () => {
    script([{ tool: 'finish', parameters: { summary: 'done' } }]);
    const run = AgentLoop.start('research something', 'auto');
    const req = await vi.waitFor(() => { expect(calls[0]).toBeTruthy(); return calls[0]; });
    const row = () => document.querySelector('.agent-step-thinking')?.textContent.trim();
    expect(row()).toMatch(/^Thinking\.\.\. \(step 1\)/);
    req.onToken('{', '{"thought":"I will look this up on the');
    expect(row()).toBe('I will look this up on the');
    req.onToken('x', '{"thought":"I will look this up on the web","tool":"web_search","para');
    expect(row()).toBe('I will look this up on the web → web_search');
    await run;
  });

  it('says why it is going to be slow, once per run', async () => {
    script([{ tool: 'finish', parameters: { summary: 'done' } }]);
    const run = AgentLoop.start('x', 'auto');
    const req = await vi.waitFor(() => { expect(calls[0]).toBeTruthy(); return calls[0]; });
    req.onSlow('qwen3.5:latest is running on the processor, not the graphics card');
    req.onSlow('qwen3.5:latest is running on the processor, not the graphics card');
    await run;
    const warnings = [...document.querySelectorAll('.agent-step-warn')].map(e => e.textContent.trim());
    expect(warnings).toEqual(['qwen3.5:latest is running on the processor, not the graphics card']);
  });
});

// @vitest-environment jsdom
//
// A research run went round twenty times on the same search, worded slightly
// differently each time to slip past exact-argument loop detection, hit its
// step limit after eight minutes and 448,000 tokens, and printed "Couldn't
// complete". It had read six good sources by the sixth step and threw every
// word of them away.
//
// Three things were wrong, and this pins all three: rewording a search is
// still the same search, being refused three times means the nudge is not
// working, and running out of steps is not the same as having nothing to say.

import { describe, it, expect, vi, beforeEach } from 'vitest';

require('../../src/renderer/js/vex-utils.js');
const { AgentLoop, ToolCallHistory } = require('../../src/renderer/js/agent-loop.js');

let asked;
function script(decisions, chat) {
  asked = [];
  const queue = decisions.slice();
  globalThis.AIRouter = {
    callAI: vi.fn(async (feature, req) => {
      asked.push({ feature, req });
      if (feature === 'chat') return { result: chat != null ? chat : 'Here is what I found. [1]\n\nSources:\n- https://a.test' };
      // Something different every time, so the run reaches its step limit
      // rather than being refused for going round in circles.
      return { result: JSON.stringify(queue.shift() || { tool: 'scroll', parameters: { direction: 'down', amount: asked.length }, intent: 'safe' }) };
    }),
  };
}
const steps = () => [...document.querySelectorAll('#ai-messages .ai-msg')].map(e => e.textContent.replace(/\s+/g, ' ').trim()).join(' | ');

beforeEach(() => {
  document.body.innerHTML = '<div id="ai-messages"></div>';
  globalThis.WebviewManager = { getActiveWebview: () => null };
  globalThis.DOMExtractor = { extractInteractiveElements: vi.fn() };
  globalThis.PageContext = { extractPageContext: vi.fn() };
  globalThis.AgentExecutor = { executeTool: vi.fn(async (tool) => ({ ok: true, result: tool + ' ok' })) };
  delete globalThis.AIPanel; delete globalThis.McpClient;
  window.vexConfirm = vi.fn(async () => true);
  globalThis.vexConfirm = window.vexConfirm;
  window.showToast = vi.fn();
  AgentLoop._running = false;
  AgentLoop._maxIter = 40;
});

describe('rewording a search is still the same search', () => {
  const h = () => new ToolCallHistory();

  it('catches the same words in another order, or with one more bolted on', () => {
    const t = h();
    t.add('web_search', { query: 'list of specific scientific historical errors in bible examples' }, { ok: true });
    expect(t.isStuckInLoop('web_search', { query: 'list of specific scientific historical errors in bible examples list' })).toBe(true);
    expect(t.isStuckInLoop('web_search', { query: 'examples of specific historical scientific errors in the bible list' })).toBe(true);
  });

  it('but lets a genuinely different search through', () => {
    const t = h();
    t.add('web_search', { query: 'errors in bible' }, { ok: true });
    expect(t.isStuckInLoop('web_search', { query: 'dead sea scrolls dating carbon' })).toBe(false);
  });

  // Six searches is plenty; a seventh finds what the first six did.
  it('stops after a budget of searches however they are worded', () => {
    const t = h();
    for (let i = 0; i < t.MAX_SEARCHES; i++) t.add('web_search', { query: 'quite different question number ' + i }, { ok: true });
    expect(t.isStuckInLoop('web_search', { query: 'something else entirely now' })).toBe(true);
    expect(t.loopReason('web_search', { query: 'x' })).toMatch(/searched 6 times/);
    // Reading is never rationed — it is the part that gathers anything.
    expect(t.isStuckInLoop('read_url', { url: 'https://new.test' })).toBe(false);
  });

  it('says what to do instead, not just "stop"', () => {
    const t = h();
    t.add('web_search', { query: 'errors in bible examples' }, { ok: true });
    const g = t.loopGuidance('web_search', { query: 'examples of errors in bible' });
    expect(g.ok).toBe(false);
    expect(g.error).toMatch(/STOP SEARCHING/);
    expect(g.error).toMatch(/finish/);
  });
});

describe('running out of steps', () => {
  it('writes the answer from what it read instead of "couldn\\u2019t complete"', async () => {
    script([{ tool: 'read_url', parameters: { url: 'https://a.test' }, intent: 'safe' }]);
    AgentLoop._maxIter = 3;
    await AgentLoop.start('research the errors in the bible', 'auto');
    const said = steps();
    expect(said).toMatch(/Out of steps/);
    expect(said).toMatch(/Here is what I found/);
    expect(said).not.toMatch(/Couldn.t complete/);
    // Asked as prose, with the history, and with no tools to get lost in.
    const final = asked.filter(a => a.feature === 'chat');
    expect(final).toHaveLength(1);
    expect(final[0].req.message).toMatch(/ran out of steps/i);
    expect(final[0].req.conversationHistory.length).toBeGreaterThan(0);
    expect(final[0].req.availableTools).toBeUndefined();
  });

  it('keeps the answer as the run\\u2019s result, so it lands in the chat', async () => {
    script([{ tool: 'read_url', parameters: { url: 'https://a.test' }, intent: 'safe' }]);
    AgentLoop._maxIter = 2;
    await AgentLoop.start('research x', 'auto');
    expect(AgentLoop.lastRun.final).toMatch(/Here is what I found/);
  });

  // If even that fails there is nothing to show, and the old summary is
  // better than silence.
  it('falls back to the summary when the model will not write one either', async () => {
    script([{ tool: 'read_url', parameters: { url: 'https://a.test' }, intent: 'safe' }], '');
    AgentLoop._maxIter = 2;
    await AgentLoop.start('research x', 'auto');
    expect(steps()).toMatch(/Couldn.t complete/);
  });
});

describe('being refused over and over', () => {
  it('stops and answers rather than nudging for ever', async () => {
    // Every decision is the same search, reworded: refused, refused, refused.
    script([
      { tool: 'web_search', parameters: { query: 'errors in bible examples' }, intent: 'safe' },
      { tool: 'web_search', parameters: { query: 'errors in bible examples list' }, intent: 'safe' },
      { tool: 'web_search', parameters: { query: 'examples errors in bible list' }, intent: 'safe' },
      { tool: 'web_search', parameters: { query: 'list examples errors bible in' }, intent: 'safe' },
      { tool: 'web_search', parameters: { query: 'in bible errors examples list' }, intent: 'safe' },
    ]);
    AgentLoop._maxIter = 12;
    await AgentLoop.start('research the errors in the bible', 'auto');
    const said = steps();
    expect(said).toMatch(/going round in circles/);
    expect(said).toMatch(/Here is what I found/);
    // It gave up long before the twelve steps it was allowed.
    expect(AgentExecutor.executeTool.mock.calls.length).toBeLessThan(5);
  });
});

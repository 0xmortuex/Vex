// @vitest-environment jsdom
//
// Settings › AI › "Test this model as an agent": four canned agent turns — the
// real guide, the real tool list — checked for the right tool call. Nothing is
// executed; the model is only asked.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const loop = require('../../src/renderer/js/agent-loop.js');
const { AgentModelTest } = require('../../src/renderer/js/agent-model-test.js');

const GOOD = [
  { tool: 'web_search', parameters: { query: 'tallest mountain in Europe' } },
  { tool: 'start_timer', parameters: { duration: '20 min' } },
  { tool: 'click', parameters: { selector: '[data-vex-id="vex-2"]' } },
  { tool: 'finish', parameters: { summary: 'The capital is **Canberra**.' } },
];

function model(replies, tokens = 5000) {
  const queue = replies.slice();
  const localAgent = vi.fn(async (req, name) => { req.onMeta({ promptTokens: tokens }); const r = queue.shift(); if (r instanceof Error) throw r; return { result: typeof r === 'string' ? r : JSON.stringify(r), backend: 'local', model: name }; });
  globalThis.AIRouter = { localAgent, agentNumCtx: () => 16384 };
  return localAgent;
}

beforeEach(() => {
  Object.assign(globalThis, { AGENT_TOOLS: loop.AGENT_TOOLS, agentGuide: loop.agentGuide, parseAgentResponse: loop.parseAgentResponse });
  globalThis.Ollama = { show: vi.fn(async () => ({ capabilities: ['completion', 'vision'], contextLength: 40960 })) };
});

describe('AgentModelTest', () => {
  it('a model that picks the right tool every time is good for agent work', async () => {
    const localAgent = model(GOOD);
    const progress = vi.fn();
    const r = await AgentModelTest.run('qwen3.5:latest', progress);
    expect(r).toMatchObject({ model: 'qwen3.5:latest', vision: true, contextLength: 40960, numCtx: 16384, passed: 4, verdict: 'Good for agent work', warning: '' });
    expect(r.cases.map(c => c.tool)).toEqual(['web_search', 'start_timer', 'click', 'finish']);
    expect(progress).toHaveBeenCalledTimes(4);
    // The same request a real run sends: the guide first, every tool, the named model.
    const [req, name] = localAgent.mock.calls[0];
    expect(name).toBe('qwen3.5:latest');
    expect(req.conversationHistory[0].content).toBe(loop.agentGuide('auto'));
    expect(req.availableTools).toBe(loop.AGENT_TOOLS);
    expect(localAgent.mock.calls[3][0].lastToolResult.result.text).toMatch(/Canberra/);
  });

  it('says what went wrong per case: a timer website, prose, a model error', async () => {
    model([GOOD[0], { tool: 'navigate', parameters: { url: 'https://online-stopwatch.example/' } }, 'Sure! I would click Pricing.', new Error('Ollama: out of memory')]);
    const r = await AgentModelTest.run('tiny:1b');
    expect(r.passed).toBe(1);
    expect(r.verdict).toBe('Not reliable as an agent — pick a larger model');
    expect(r.cases[1]).toMatchObject({ ok: false, tool: 'navigate' });
    expect(r.cases[1].error).toMatch(/^Chose navigate/);
    expect(r.cases[2].error).toBe('The reply was not a tool call');
    expect(r.cases[3].error).toBe('Ollama: out of memory');
  });

  it('accepts click_text for the click case, and three of four is "usable"', async () => {
    model([GOOD[0], GOOD[1], { tool: 'click_text', parameters: { text: 'Pricing' } }, { tool: 'finish', parameters: { summary: 'Sydney' } }]);
    const r = await AgentModelTest.run('m');
    expect(r.cases.map(c => c.ok)).toEqual([true, true, true, false]);
    expect(r.verdict).toBe('Usable — expect the odd retry');
  });

  it('warns when the instructions alone nearly fill the context window', async () => {
    model(GOOD, 11000);
    expect((await AgentModelTest.run('m')).warning).toMatch(/fill 67% of the 16,384-token context/);
  });

  it('warns when the agent asks for more context than the model has', async () => {
    model(GOOD, 3000);
    globalThis.Ollama.show = vi.fn(async () => ({ capabilities: ['completion'], contextLength: 8192 }));
    const r = await AgentModelTest.run('m');
    expect(r.vision).toBe(false);
    expect(r.warning).toMatch(/built for 8,192 tokens of context; the agent asks for 16,384/);
  });

  it('needs a model, and a model Ollama does not have fails up front', async () => {
    await expect(AgentModelTest.run('')).rejects.toThrow('Pick a local model first');
    globalThis.Ollama.show = vi.fn(async () => { throw new Error('Ollama: model "x" not found'); });
    await expect(AgentModelTest.run('x')).rejects.toThrow('not found');
  });
});

describe('comparing every installed model', () => {
  it('tests each chat model in turn, unloads it after, and ranks by turns passed then speed', async () => {
    const BAD = [GOOD[0], GOOD[1], { tool: 'finish', parameters: { summary: 'x' } }, GOOD[3]];
    const queue = [...GOOD, ...BAD, ...GOOD];
    model(queue);
    globalThis.Ollama.listModels = vi.fn(async () => [{ name: 'a:1' }, { name: 'nomic-embed-text' }, { name: 'b:2' }, { name: 'c:3' }]);
    globalThis.Ollama.unload = vi.fn(async () => {});
    globalThis.GameMode = { gaming: false };
    const rows = await AgentModelTest.runAll();
    expect(Ollama.unload.mock.calls.map(c => c[0])).toEqual(['a:1', 'b:2', 'c:3']);    // the embedder is never asked
    expect(rows.map(r => [r.model, r.passed])).toEqual([['a:1', 4], ['c:3', 4], ['b:2', 3]]);
  });

  it('a model that cannot be tested is listed last, with why', () => {
    const rows = AgentModelTest.rank([{ model: 'x', passed: 0, seconds: 0, error: 'not found' }, { model: 'y', passed: 1, seconds: 9, error: '' }]);
    expect(rows.map(r => r.model)).toEqual(['y', 'x']);
  });

  it('is refused while a game is running', async () => {
    globalThis.GameMode = { gaming: true };
    await expect(AgentModelTest.runAll()).rejects.toThrow(/Not while a game is running/);
    globalThis.GameMode = { gaming: false };
  });
});

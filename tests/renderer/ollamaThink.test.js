// @vitest-environment jsdom
//
// A reasoning model (qwen3, deepseek-r1…) asked for format:'json' spent its
// whole turn in Ollama's separate `thinking` field and returned an EMPTY
// response — measured on qwen3.5: 1,700 chars of thinking, 0 of answer — so
// every structured feature failed as "malformed response". JSON requests now
// carry think:false, and an empty reply is an error that says so.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { Ollama } = require('../../src/renderer/js/ollama.js');

let sent;
function reply(data, ok = true) {
  globalThis.fetch = vi.fn(async (_url, init) => { sent = JSON.parse(init.body); return { ok, status: ok ? 200 : 500, json: async () => data, text: async () => JSON.stringify(data) }; });
}

beforeEach(() => { sent = null; delete window.VexNet; });

describe('JSON requests to a local model', () => {
  it('generate asks for JSON without thinking', async () => {
    reply({ response: '{"groups":[]}' });
    expect(await Ollama.generate('qwen3.5:latest', 'tabs…', { format: 'json', systemPrompt: 'cluster' })).toBe('{"groups":[]}');
    expect(sent.format).toBe('json');
    expect(sent.think).toBe(false);
    expect(sent.system).toBe('cluster');
  });

  it('chat does the same', async () => {
    reply({ message: { content: '{"reply":"hi"}' } });
    expect(await Ollama.chat('qwen3.5:latest', [{ role: 'user', content: 'hi' }], { format: 'json' })).toBe('{"reply":"hi"}');
    expect(sent.think).toBe(false);
  });

  it('a plain-text request is left alone', async () => {
    reply({ response: 'hello' });
    await Ollama.generate('llama3.2:3b', 'hi', {});
    expect('think' in sent).toBe(false);
    expect('format' in sent).toBe(false);
  });
});

describe('an empty reply is an error, not an empty string', () => {
  it('says the model only reasoned when that is what happened', async () => {
    reply({ response: '', thinking: 'Let me cluster these by host…' });
    await expect(Ollama.generate('qwen3.5:latest', 'x', { format: 'json' })).rejects.toThrow(/qwen3\.5:latest only produced reasoning and no answer/);
    reply({ message: { content: '', thinking: 'hmm' } });
    await expect(Ollama.chat('qwen3.5:latest', [], { format: 'json' })).rejects.toThrow(/only produced reasoning/);
  });

  it('and plainly empty otherwise', async () => {
    reply({ response: '   ' });
    await expect(Ollama.generate('llama3.2:3b', 'x', {})).rejects.toThrow(/llama3\.2:3b returned an empty reply/);
  });
});

// Ollama's default context window (4,096 tokens) silently drops the START of a
// longer prompt — the system prompt. The agent asks for room; nothing else does.
describe('context window', () => {
  it('chat passes numCtx through as num_ctx, and leaves it out otherwise', async () => {
    reply({ message: { content: '{"tool":"finish"}' } });
    await Ollama.chat('qwen3.5:latest', [{ role: 'user', content: 'x' }], { format: 'json', numCtx: 16384 });
    expect(sent.options.num_ctx).toBe(16384);
    await Ollama.chat('qwen3.5:latest', [{ role: 'user', content: 'x' }], { format: 'json' });
    expect('num_ctx' in sent.options).toBe(false);
  });
});

describe('what Ollama knows about a model, and what a call cost', () => {
  it('show reports capabilities and the context the model was built for', async () => {
    reply({ capabilities: ['completion', 'vision'], details: { family: 'qwen3', parameter_size: '8B' }, model_info: { 'general.architecture': 'qwen3', 'qwen3.context_length': 40960 } });
    expect(await Ollama.show('qwen3.5:latest')).toEqual({ capabilities: ['completion', 'vision'], contextLength: 40960, family: 'qwen3', parameterSize: '8B' });
    expect(sent).toEqual({ model: 'qwen3.5:latest' });
  });

  it('show of a model that is not installed says so', async () => {
    reply({ error: 'model "nope" not found' }, false);
    await expect(Ollama.show('nope')).rejects.toThrow('Ollama: model "nope" not found');
  });

  it('chat hands the token counts to onMeta', async () => {
    reply({ message: { content: '{"a":1}' }, prompt_eval_count: 5200, eval_count: 40, total_duration: 3.2e9, load_duration: 1e8 });
    const onMeta = vi.fn();
    await Ollama.chat('qwen3.5:latest', [{ role: 'user', content: 'x' }], { format: 'json', onMeta });
    expect(onMeta).toHaveBeenCalledWith({ promptTokens: 5200, replyTokens: 40, totalMs: 3200, loadMs: 100 });
  });
});

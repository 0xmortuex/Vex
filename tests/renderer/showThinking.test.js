// @vitest-environment jsdom
//
// Show thinking: watch a reasoning model think, as a live subtitle line.
//
// Measured on this machine's qwen3.5 (Ollama 0.34): with thinking OFF a chat
// reply takes ~3 s; ON, 16–39 s, the first thought arriving after ~0.15 s.
// think:true + format:'json' returned a valid answer 6 times out of 6 — the
// old empty-answer failure did not recur. So it is a switch, off by default,
// and OFF must mean exactly what it meant before: no thinking requested.

import { describe, it, expect, vi, beforeEach } from 'vitest';
const { Ollama } = require('../../src/renderer/js/ollama.js');

// An Ollama NDJSON stream: thoughts first, then the answer, then the summary.
function streamOf(events) {
  const lines = events.map(e => JSON.stringify(e) + '\n');
  let i = 0;
  const enc = new TextEncoder();
  return {
    ok: true, status: 200,
    body: { getReader: () => ({
      read: async () => (i < lines.length ? { done: false, value: enc.encode(lines[i++]) } : { done: true }),
      cancel: async () => {}, releaseLock: () => {},
    }) },
  };
}
let sent;
function serve(events) {
  globalThis.fetch = vi.fn(async (_url, init) => { sent = JSON.parse(init.body); return streamOf(events); });
}
const THINKING_CHAT = [
  { message: { thinking: 'The user asks about boilers.\n' } },
  { message: { thinking: '**Two bathrooms** means simultaneous demand.' } },
  { message: { content: '{"reply":"A system boiler' } },
  { message: { content: ' suits two bathrooms."}' } },
  { done: true, eval_count: 50 },
];

beforeEach(() => { sent = null; delete window.VexNet; localStorage.clear(); });

describe('Ollama: thoughts stream separately from the answer', () => {
  it('asks for thinking only when told to, even with a JSON answer', async () => {
    serve(THINKING_CHAT);
    await Ollama.chat('qwen3.5:latest', [], { format: 'json', think: true, onToken: () => {} });
    expect(sent).toMatchObject({ think: true, format: 'json', stream: true });
  });

  it('hands every thought to onThinking, accumulated, and returns only the answer', async () => {
    serve(THINKING_CHAT);
    const seen = [];
    const answer = await Ollama.chat('qwen3.5:latest', [], {
      format: 'json', think: true, onToken: () => {},
      onThinking: (piece, full) => seen.push([piece, full]),
    });
    expect(answer).toBe('{"reply":"A system boiler suits two bathrooms."}');
    expect(seen).toHaveLength(2);
    expect(seen[1][1]).toBe('The user asks about boilers.\n**Two bathrooms** means simultaneous demand.');
  });

  it('streams for a thought listener alone, with no token listener', async () => {
    serve(THINKING_CHAT);
    const onThinking = vi.fn();
    await Ollama.chat('qwen3.5:latest', [], { format: 'json', think: true, onThinking });
    expect(sent.stream).toBe(true);
    expect(onThinking).toHaveBeenCalled();
  });

  it('/api/generate carries thoughts at the top level, and is read too', async () => {
    serve([{ thinking: 'hmm, ' }, { thinking: 'yes' }, { response: '{"reply":"ok"}' }, { done: true }]);
    const onThinking = vi.fn();
    expect(await Ollama.generate('qwen3.5:latest', 'q', { format: 'json', think: true, onThinking })).toBe('{"reply":"ok"}');
    expect(onThinking).toHaveBeenLastCalledWith('yes', 'hmm, yes');
  });

  it('only thoughts and no answer is an error that says so, and names the switch', async () => {
    serve([{ message: { thinking: 'I keep thinking…' } }, { done: true }]);
    await expect(Ollama.chat('qwen3.5:latest', [], { format: 'json', think: true, onThinking: () => {} }))
      .rejects.toThrow(/only produced reasoning and no answer — try again, or turn off Show thinking/);
  });

  it('a plain request that asks to think says so too', async () => {
    serve([{ message: { content: 'hi' } }, { done: true }]);
    await Ollama.chat('qwen3.5:latest', [], { think: true, onToken: () => {} });
    expect(sent.think).toBe(true);
    expect('format' in sent).toBe(false);
  });

  it('off is exactly what it was: JSON calls still say think:false', async () => {
    serve([{ message: { content: '{"reply":"hi"}' } }, { done: true }]);
    await Ollama.chat('qwen3.5:latest', [], { format: 'json', onToken: () => {} });
    expect(sent.think).toBe(false);
  });
});

describe('the router: the switch, and who gets thoughts', () => {
  async function router(ollamaChat) {
    vi.resetModules();
    globalThis.Ollama = { ping: vi.fn(async () => true), chat: ollamaChat, generate: ollamaChat };
    const { AIRouter } = await import('../../src/renderer/js/ai-router.js');
    AIRouter.setRoutingPrefs({ chat: 'local', agent: 'local' });
    await AIRouter.refreshOllamaStatus?.();
    return AIRouter;
  }

  it('is off by default', async () => {
    const R = await router(vi.fn(async () => '{"reply":"hi"}'));
    expect(R.showThinking()).toBe(false);
  });

  it('off: a chat asks for no thinking, even with a listener attached', async () => {
    const chat = vi.fn(async () => '{"reply":"hi"}');
    const R = await router(chat);
    await R.callAI('chat', { message: 'hi', conversationHistory: [{ role: 'user', content: 'before' }], onToken: () => {}, onThinking: () => {} });
    const opts = chat.mock.calls[0][2];
    expect(opts.think).toBeUndefined();
    expect(opts.onThinking).toBeUndefined();
  });

  it('on: a chat asks to think and the thoughts go to the listener', async () => {
    const chat = vi.fn(async () => '{"reply":"hi"}');
    const R = await router(chat);
    R.setShowThinking(true);
    const onThinking = () => {};
    await R.callAI('chat', { message: 'hi', conversationHistory: [{ role: 'user', content: 'before' }], onToken: () => {}, onThinking });
    expect(chat.mock.calls[0][2]).toMatchObject({ think: true, onThinking, format: 'json' });
  });

  it('on, but nobody listening (a scheduled agent run): no thinking, so no slowdown', async () => {
    const chat = vi.fn(async () => '{"tool":"finish","parameters":{}}');
    const R = await router(chat);
    R.setShowThinking(true);
    await R.callAI('agent', { userGoal: 'x', availableTools: [], conversationHistory: [] });
    expect(chat.mock.calls[0][2].think).toBeUndefined();
  });

  it('on: the interactive agent thinks too', async () => {
    const chat = vi.fn(async () => '{"tool":"finish","parameters":{}}');
    const R = await router(chat);
    R.setShowThinking(true);
    await R.callAI('agent', { userGoal: 'x', availableTools: [], conversationHistory: [], onToken: () => {}, onThinking: () => {} });
    expect(chat.mock.calls[0][2].think).toBe(true);
  });

  it('flipping the switch is remembered and announced', async () => {
    const R = await router(vi.fn());
    const heard = vi.fn();
    document.addEventListener('vex:show-thinking', heard);
    R.setShowThinking(true);
    expect(localStorage.getItem('vex.ai.showThinking')).toBe('on');
    expect(heard.mock.calls[0][0].detail).toEqual({ on: true });
    R.setShowThinking(false);
    expect(R.showThinking()).toBe(false);
    document.removeEventListener('vex:show-thinking', heard);
  });
});

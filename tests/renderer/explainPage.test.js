// Explain (local): the prompt carries the sentence, only the local backend is
// ever asked, and a dead Ollama is said plainly with nothing else tried.
import { describe, it, expect, beforeEach, vi } from 'vitest';
const { ExplainPage: E } = require('../../src/renderer/js/explain-page.js');

beforeEach(() => {
  globalThis.window = { escapeHtml: (s) => String(s), showToast: vi.fn() };
  globalThis.AIRouter = { callOn: vi.fn(async () => ({ result: 'It means X.', model: 'qwen' })), callAI: vi.fn() };
  delete globalThis.AIPanel;
});

describe('explain, local only', () => {
  it('asks only the local backend, never callAI', async () => {
    const r = await E.ask({ text: 'a passage', sentence: 'The sentence a passage sits in.', title: 'T' });
    expect(AIRouter.callOn).toHaveBeenCalledTimes(1);
    expect(AIRouter.callOn.mock.calls[0][0]).toBe('local');
    expect(AIRouter.callAI).not.toHaveBeenCalled();
    expect(r).toEqual({ text: 'It means X.', model: 'qwen' });
  });

  it('sends no page context along', async () => {
    await E.ask({ text: 'p', sentence: '', title: '' });
    expect(AIRouter.callOn.mock.calls[0][2].pageContext).toBeNull();
  });

  it('puts the sentence and passage in the prompt', () => {
    const p = E.buildPrompt({ text: 'quantum thing', sentence: 'The quantum thing is odd.', title: 'Physics' });
    expect(p).toContain('quantum thing');
    expect(p).toContain('The quantum thing is odd.');
    expect(p).toContain('Physics');
  });

  it('says plainly that Ollama is down and tries nothing else', async () => {
    AIRouter.callOn = vi.fn(async () => { throw new Error('connect ECONNREFUSED'); });
    await expect(E.ask({ text: 'p' })).rejects.toThrow(/only the model on this machine.*Ollama did not answer.*ECONNREFUSED/);
    expect(AIRouter.callOn).toHaveBeenCalledTimes(1);
    expect(AIRouter.callAI).not.toHaveBeenCalled();
  });

  it('an empty answer is an error, not a blank card', async () => {
    AIRouter.callOn = vi.fn(async () => ({ result: '  ' }));
    await expect(E.ask({ text: 'p' })).rejects.toThrow(/answered with nothing/);
  });

  it('unwraps the chat JSON envelope when the panel can parse it', () => {
    globalThis.AIPanel = { _parseResponse: (t) => JSON.parse(t) };
    expect(E.reply('{"reply":"plain words"}')).toBe('plain words');
  });
});

describe('the page script', () => {
  it('is valid JavaScript', () => {
    expect(() => new Function('return ' + E.sentenceScript())).not.toThrow();
  });
});

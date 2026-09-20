// The same question, asked of two models. What matters: both are asked at
// once, one failing does not take the other down, neither answering is said
// plainly, and keeping one puts it into the conversation properly.
import { describe, it, expect, beforeEach, vi } from 'vitest';
const { TwoModels: T } = require('../../src/renderer/js/two-models.js');

beforeEach(() => {
  globalThis.window = { escapeHtml: (s) => String(s), showToast: vi.fn() };
  globalThis.AIRouter = {
    callOn: vi.fn(async (backend) => ({ result: backend + ' says hello', model: backend + '-model' })),
  };
});

describe('asking both', () => {
  it('asks each backend once, with the same question', async () => {
    const out = await T.ask('why is the sky blue?');
    expect(AIRouter.callOn).toHaveBeenCalledTimes(2);
    expect(AIRouter.callOn.mock.calls.map(c => c[0]).sort()).toEqual(['cloud', 'local']);
    expect(AIRouter.callOn.mock.calls.every(c => c[2].message === 'why is the sky blue?')).toBe(true);
    expect(out.map(a => a.text)).toEqual(['cloud says hello', 'local says hello']);
  });

  it('both at once, not one after the other', async () => {
    let live = 0, most = 0;
    AIRouter.callOn = vi.fn(async () => {
      most = Math.max(most, ++live);
      await new Promise(r => setTimeout(r, 20));
      live--;
      return { result: 'ok' };
    });
    await T.ask('q');
    expect(most).toBe(2);
  });

  it('one backend failing leaves the other answer standing', async () => {
    AIRouter.callOn = vi.fn(async (backend) => {
      if (backend === 'local') throw new Error('Ollama is not running');
      return { result: 'the cloud answer' };
    });
    const out = await T.ask('q');
    expect(out.find(a => a.backend === 'cloud')).toMatchObject({ ok: true, text: 'the cloud answer' });
    expect(out.find(a => a.backend === 'local')).toMatchObject({ ok: false, error: 'Ollama is not running' });
  });

  it('an empty answer counts as no answer, and says so', async () => {
    AIRouter.callOn = vi.fn(async () => ({ result: '   ' }));
    await expect(T.ask('q')).rejects.toThrow(/Neither model answered/);
  });

  it('neither answering names both reasons', async () => {
    AIRouter.callOn = vi.fn(async (backend) => { throw new Error(backend + ' is off'); });
    await expect(T.ask('q')).rejects.toThrow(/cloud is off.*local is off/);
  });

  it('an empty question is refused before anything is asked', async () => {
    await expect(T.ask('   ')).rejects.toThrow(/Write the question/);
    expect(AIRouter.callOn).not.toHaveBeenCalled();
  });
});

describe('what a column shows', () => {
  it('the reply a person reads, not the envelope it came in', () => {
    globalThis.AIPanel = { _parseResponse: (raw) => JSON.parse(raw) };
    expect(T.reply('{"reply":"banana","citations":[]}')).toBe('banana');
  });

  it('an answer that is not the envelope is shown as it came', () => {
    globalThis.AIPanel = { _parseResponse: () => { throw new Error('not JSON'); } };
    expect(T.reply('just words')).toBe('just words');
  });
});

describe('keeping one', () => {
  it('puts the question and that answer into the conversation', () => {
    const conv = [];
    globalThis.AIPanel = {
      _getConv: () => conv,
      _getTabId: () => 1,
      _persistConversations: vi.fn(),
      _renderMessages: vi.fn(),
    };
    T.keep('the question', { backend: 'local', name: 'On this machine', text: 'the answer' });
    expect(conv).toEqual([
      { role: 'user', content: 'the question' },
      { role: 'assistant', content: 'the answer' },
    ]);
    expect(AIPanel._persistConversations).toHaveBeenCalled();
    expect(AIPanel._renderMessages).toHaveBeenCalled();
  });
});

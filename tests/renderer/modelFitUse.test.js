// @vitest-environment jsdom
//
// T-time-travel (Wave 6): the model-fit advice can be acted on. "Use this model for chat" and "for routine jobs" set
// the model on AIRouter for an installed model only, write a Ledger line with an Undo, and the Undo puts the old one back.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const JS = '../../src/renderer/js/';
const fresh = (p) => { delete require.cache[require.resolve(JS + p)]; return require(JS + p); };

let M, router, ledger, undos;

beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = '';
  window.showToast = vi.fn();
  undos = {};
  ledger = { note: vi.fn(), registerUndo: vi.fn((kind, fn) => { undos[kind] = fn; }) };
  globalThis.VexLedger = ledger;
  router = { chat: 'llama3.2:3b', small: '', getModel() { return this.chat; }, setModel(n) { this.chat = n; }, getSmallModel() { return this.small; }, setSmallModel(n) { this.small = n; } };
  globalThis.AIRouter = router;
  globalThis.Ollama = { listModels: vi.fn(async () => [{ name: 'llama3.2:3b' }, { name: 'qwen3:8b' }, { name: 'nomic-embed-text' }]) };
  ({ ModelFit: M } = fresh('local-model-tools.js'));
});
afterEach(() => { for (const k of ['VexLedger', 'AIRouter', 'Ollama']) delete globalThis[k]; });

describe('using the advised model', () => {
  it('sets the chat model, records it, and the Undo puts the earlier one back', async () => {
    const r = await M.use('qwen3:8b', 'chat');
    expect(r).toEqual({ changed: true, previous: 'llama3.2:3b' });
    expect(router.chat).toBe('qwen3:8b');
    expect(ledger.note).toHaveBeenCalledWith(expect.objectContaining({ feature: 'local-model-tools', what: expect.stringMatching(/qwen3:8b as the model for chat and the agent/), undo: { kind: 'modelfit-restore', role: 'chat', previous: 'llama3.2:3b' } }));
    await undos['modelfit-restore']({ role: 'chat', previous: 'llama3.2:3b' });
    expect(router.chat).toBe('llama3.2:3b');
  });

  it('sets the routine-jobs model, and the Undo can go back to none', async () => {
    await M.use('llama3.2:3b', 'routine');
    expect(router.small).toBe('llama3.2:3b');
    await undos['modelfit-restore']({ role: 'routine', previous: '' });
    expect(router.small).toBe('');
  });

  it('changes nothing and writes nothing when it already is that model', async () => {
    expect(await M.use('llama3.2:3b', 'chat')).toEqual({ changed: false, previous: 'llama3.2:3b' });
    expect(ledger.note).not.toHaveBeenCalled();
  });

  it('refuses a model that is not installed, an unknown role and an empty name', async () => {
    await expect(M.use('gpt-9', 'chat')).rejects.toThrow(/gpt-9 is not installed/);
    await expect(M.use('qwen3:8b', 'cloud')).rejects.toThrow(/chat or for routine jobs/);
    await expect(M.use('  ', 'chat')).rejects.toThrow(/Pick a model/);
    expect(router.chat).toBe('llama3.2:3b');
    expect(ledger.note).not.toHaveBeenCalled();
  });

  it('cannot undo chat back to "nothing": the chat model always has one', () => {
    expect(() => M.restore('chat', '')).toThrow(/no earlier choice/);
    expect(() => M.restore('x', 'a')).toThrow(/Unknown model role/);
  });
});

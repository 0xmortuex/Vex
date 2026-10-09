// @vitest-environment jsdom
//
// Local AI says what is wrong instead of a two-minute wait (found 2026-10-09).
// The owner's problem log had "Ollama did not answer within 120s (model
// "qwen3.5:latest" may still be loading)." and "Ollama: llama-server process
// has terminated: exit status 1". Before a local request the router now asks
// Ollama (/api/tags, /api/ps): not running and not installed are said at
// once, a model still loading gets a longer wait and a line saying so, and a
// crashed model process is explained in plain words.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const fresh = (p) => { delete require.cache[require.resolve(p)]; return require(p); };
const MODEL = 'qwen3.5:latest';

// A fake Ollama on the other end of fetch. `up` false: nothing listens.
let calls, server;
function fakeOllama({ up = true, installed = [MODEL], loaded = [MODEL], answer = null } = {}) {
  calls = [];
  server = { up, installed, loaded, answer };
  globalThis.fetch = vi.fn((url, init = {}) => {
    const path = new URL(url).pathname;
    calls.push(path);
    if (!server.up) return Promise.reject(new TypeError('Failed to fetch'));
    const json = (data, status = 200) => Promise.resolve({ ok: status < 400, status, json: async () => data, text: async () => JSON.stringify(data), body: null });
    if (path === '/api/tags') return json({ models: server.installed.map(name => ({ name, size: 1 })) });
    if (path === '/api/ps') return json({ models: server.loaded.map(name => ({ name, size: 1, size_vram: 1 })) });
    if (server.answer) return server.answer(path, init);
    // Never answers on its own: only the caller's deadline ends it.
    return new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true }));
  });
}
const Ollama = () => fresh('../../src/renderer/js/ollama.js').Ollama;

beforeEach(() => { delete window.VexNet; localStorage.clear(); vi.spyOn(console, 'warn').mockImplementation(() => {}); });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); delete globalThis.Ollama; delete window.VexConfig; });

describe('the check before a local request', () => {
  it('Ollama not running is said at once, and nothing is sent to it', async () => {
    fakeOllama({ up: false });
    await expect(Ollama().chat(MODEL, [], { checkFirst: true }))
      .rejects.toThrow('Ollama is not running. Start Ollama, or switch to cloud AI.');
    expect(calls).toEqual(['/api/tags']);
  });

  it('a model that is not installed is named', async () => {
    fakeOllama({ installed: ['llama3.2:3b'] });
    await expect(Ollama().generate(MODEL, 'hi', { checkFirst: true }))
      .rejects.toThrow('The model "qwen3.5:latest" is not installed in Ollama. Pick another one in Settings › AI, or run: ollama pull qwen3.5:latest');
    expect(calls).not.toContain('/api/generate');
  });

  it('"qwen3.5" matches the installed "qwen3.5:latest"', async () => {
    fakeOllama({ answer: async () => ({ ok: true, status: 200, json: async () => ({ message: { content: 'hi' } }) }) });
    expect(await Ollama().chat('qwen3.5', [], { checkFirst: true })).toBe('hi');
  });

  it('a model still loading is said, and waited for past two minutes', async () => {
    vi.useFakeTimers();
    fakeOllama({ loaded: [] });
    const onLoading = vi.fn();
    const p = Ollama().chat(MODEL, [], { checkFirst: true, onLoading });
    let failed = null;
    p.catch((err) => { failed = err; });
    await vi.advanceTimersByTimeAsync(0);
    expect(onLoading).toHaveBeenCalledWith(MODEL);
    await vi.advanceTimersByTimeAsync(3 * 60 * 1000);
    expect(failed).toBeNull();
    await vi.advanceTimersByTimeAsync(8 * 60 * 1000);
    expect(failed && failed.message).toBe('qwen3.5 did not finish loading within 10 minutes. Restart Ollama, or pick a smaller model in Settings › AI.');
  });

  it('a model already in memory keeps the two-minute limit, and is not said to be loading', async () => {
    vi.useFakeTimers();
    fakeOllama();
    const onLoading = vi.fn();
    const p = Ollama().chat(MODEL, [], { checkFirst: true, onLoading, onToken: () => {} });
    let failed = null;
    p.catch((err) => { failed = err; });
    await vi.advanceTimersByTimeAsync(121 * 1000);
    expect(onLoading).not.toHaveBeenCalled();
    expect(failed && failed.message).toMatch(/did not answer within 120s/);
  });

  it('a model found in memory is remembered for a while: the next message does not ask again', async () => {
    fakeOllama({ answer: async () => ({ ok: true, status: 200, json: async () => ({ response: 'ok' }) }) });
    const O = Ollama();
    await O.generate(MODEL, 'one', { checkFirst: true });
    await O.generate(MODEL, 'two', { checkFirst: true });
    expect(calls.filter(c => c === '/api/tags')).toHaveLength(1);
    expect(calls.filter(c => c === '/api/generate')).toHaveLength(2);
  });

  it('without checkFirst nothing extra is asked (Settings and the model manager call it directly)', async () => {
    fakeOllama({ answer: async () => ({ ok: true, status: 200, json: async () => ({ response: 'ok' }) }) });
    await Ollama().generate(MODEL, 'one', {});
    expect(calls).toEqual(['/api/generate']);
  });
});

describe('a crashed model process', () => {
  const CRASH = 'llama-server process has terminated: exit status 1';
  const SAID = 'qwen3.5 crashed in Ollama (its process stopped). This usually means the graphics card or the computer ran out of memory, for example because a game is running. Close what is using the memory, or pick a smaller model in Settings › AI, then try again.';

  it('is explained in plain words', async () => {
    fakeOllama({ loaded: [], answer: async () => ({ ok: false, status: 500, json: async () => ({ error: CRASH }) }) });
    await expect(Ollama().chat(MODEL, [], { checkFirst: true })).rejects.toThrow(SAID);
  });

  it('also when it arrives in the middle of a stream', async () => {
    const enc = new TextEncoder();
    fakeOllama({ answer: async () => ({ ok: true, status: 200, body: new ReadableStream({ start(c) { c.enqueue(enc.encode(JSON.stringify({ error: CRASH }) + '\n')); c.close(); } }) }) });
    await expect(Ollama().chat(MODEL, [], { checkFirst: true, onToken: () => {} })).rejects.toThrow(SAID);
  });
});

describe('through the AI router', () => {
  function router() {
    globalThis.Ollama = Ollama();
    window.VexConfig = { aiWorkerUrl: () => 'https://worker.example', fetchAI: vi.fn() };
    const R = fresh('../../src/renderer/js/ai-router.js').AIRouter;
    R.setModel(MODEL);
    R.setRoutingPrefs({ chat: 'local' });
    return R;
  }

  it('a missing model fails at once with its name, and still does not fall back to the cloud', async () => {
    fakeOllama({ installed: ['llama3.2:3b'] });
    const R = router();
    const err = await R.callAI('chat', { message: 'hi' }).catch(e => e);
    expect(err.message).toBe('Local AI failed: The model "qwen3.5:latest" is not installed in Ollama. Pick another one in Settings › AI, or run: ollama pull qwen3.5:latest. (Not falling back to cloud because you selected local mode.)');
    expect(window.VexConfig.fetchAI).not.toHaveBeenCalled();
  });

  it('a model still loading is said in the request\'s own line ("qwen3.5 is loading…")', async () => {
    fakeOllama({ loaded: [], answer: async () => ({ ok: true, status: 200, json: async () => ({ response: '{"reply":"hi"}' }) }) });
    const R = router();
    const onSlow = vi.fn();
    const out = await R.callAI('chat', { message: 'hi', onSlow });
    expect(out.result).toBe('{"reply":"hi"}');
    expect(onSlow).toHaveBeenCalledWith('qwen3.5 is loading…', null);
  });
});

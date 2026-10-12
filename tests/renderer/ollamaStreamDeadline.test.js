// A streamed local answer that keeps arriving is not cut off after 120 s in
// total (AI audit 2026-10-10): VexNet's bounded fetch aborted the whole stream
// at its own fixed timeoutMs, whatever Ollama._stream's own deadline said.
import { afterEach, describe, expect, it, vi } from 'vitest';

globalThis.window = globalThis;
const { createBoundedFetch } = require('../../src/renderer/js/network.js');
const { Ollama } = require('../../src/renderer/js/ollama.js');

// A token every `everySec` seconds; after `totalSec` it ends, or (stallAfter) goes quiet for good.
function slowStream(totalSec, everySec, { stallAfter = null } = {}) {
  let sent = 0, cancelled = false;
  const enc = new TextEncoder();
  return new ReadableStream({
    cancel() { cancelled = true; },
    pull(ctrl) {
      if (stallAfter != null && sent >= stallAfter) return new Promise(() => {});
      return new Promise(res => setTimeout(() => {
        if (cancelled) return res();
        sent += everySec;
        if (sent > totalSec) { ctrl.enqueue(enc.encode(JSON.stringify({ message: { content: '' }, done: true }) + '\n')); ctrl.close(); }
        else ctrl.enqueue(enc.encode(JSON.stringify({ message: { content: 'w' + sent + ' ' }, done: false }) + '\n'));
        res();
      }, everySec * 1000));
    },
  });
}

async function run(stream) {
  const fakeFetch = async () => new Response(stream, { status: 200, headers: { 'content-type': 'application/x-ndjson' } });
  window.VexNet = { fetch: createBoundedFetch(fakeFetch) };
  let tokens = 0;
  const p = Ollama.chat('llama3.2:3b', [{ role: 'user', content: 'hi' }], { onToken: () => { tokens++; } });
  let outcome = null;
  p.then(v => { outcome = { ok: true, v }; }, e => { outcome = { ok: false, e: e.message }; });
  for (let i = 0; i < 40 && !outcome; i++) await vi.advanceTimersByTimeAsync(10000);
  return { outcome, tokens };
}

describe('Ollama streaming deadline', () => {
  afterEach(() => { vi.useRealTimers(); delete window.VexNet; });

  it('a model that keeps writing a token every 10 s for 150 s is not cut off', async () => {
    vi.useFakeTimers();
    const { outcome, tokens } = await run(slowStream(150, 10));
    expect(outcome).toMatchObject({ ok: true });
    expect(tokens).toBe(15);
  });

  it('a model that goes quiet in the middle is stopped, and told it stopped writing (not "may still be loading")', async () => {
    vi.useFakeTimers();
    const { outcome, tokens } = await run(slowStream(1000, 10, { stallAfter: 30 }));
    expect(tokens).toBe(3);
    expect(outcome.ok).toBe(false);
    expect(outcome.e).toMatch(/stopped writing for 120s in the middle of the answer/);
    expect(outcome.e).not.toMatch(/may still be loading/);
  });
});

describe('bounded fetch idle deadline', () => {
  afterEach(() => vi.useRealTimers());

  it('without idleTimeoutMs a stream still ends at timeoutMs in total', async () => {
    vi.useFakeTimers();
    const bf = createBoundedFetch(async () => new Response(slowStream(100, 10), { status: 200 }));
    const res = await bf('http://x/', { stream: true, timeoutMs: 25000 });
    const reader = res.body.getReader();
    let err = null;
    const reading = (async () => { try { for (;;) { const p = await reader.read(); if (p.done) break; } } catch (e) { err = e; } })();
    await vi.advanceTimersByTimeAsync(40000);
    await reading;
    expect(err && err.message).toBe('Request timed out');
  });
});

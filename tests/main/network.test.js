import { afterEach, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
const { createBoundedFetch } = createRequire(import.meta.url)('../../src/main/network.js');
afterEach(() => vi.useRealTimers());
it('bounds actual response bytes without Content-Length', async () => {
  const cancel = vi.fn();
  const fetch = createBoundedFetch(async () => new Response(new ReadableStream({ start(c) { c.enqueue(new Uint8Array(20)); }, cancel })));
  await expect(fetch('https://test', { maxBytes: 10 })).rejects.toThrow('too large');
  expect(cancel).toHaveBeenCalled();
});
it('times out a body reader that never resolves and releases its resources', async () => {
  vi.useFakeTimers();
  const cancel = vi.fn();
  const fetch = createBoundedFetch(async () => new Response(new ReadableStream({ cancel })));
  const pending = expect(fetch('https://test', { timeoutMs: 10 })).rejects.toThrow('timed out');
  await vi.advanceTimersByTimeAsync(11); await pending;
  expect(cancel).toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
});
it('preserves redirect metadata and handles a bodyless 204 response', async () => {
  const response = new Response('ok');
  Object.defineProperty(response, 'url', { value: 'https://final.test' });
  const result = await createBoundedFetch(async () => response)('https://initial.test');
  expect(result.url).toBe('https://final.test'); expect(await result.text()).toBe('ok');
  expect((await createBoundedFetch(async () => new Response(null, { status: 204 }))('https://test')).status).toBe(204);
});
it('rejects oversized uploads and cancelled requests before invoking transport', async () => {
  const transport = vi.fn(); const fetch = createBoundedFetch(transport);
  await expect(fetch('https://test', { body: 'abcd', maxRequestBytes: 2 })).rejects.toThrow('too large');
  const controller = new AbortController(); controller.abort(new Error('cancelled'));
  await expect(fetch('https://test', { signal: controller.signal })).rejects.toThrow('cancelled');
  expect(transport).not.toHaveBeenCalled();
});
it('streams bounded responses and cleans up after consumption', async () => {
  vi.useFakeTimers();
  const fetch = createBoundedFetch(async () => new Response('progress'));
  const result = await fetch('https://test', { stream: true });
  expect(await result.text()).toBe('progress'); expect(vi.getTimerCount()).toBe(0);
});

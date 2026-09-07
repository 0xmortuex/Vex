// The geolocation IP fallback is the only remote call src/preload-webview.js
// makes, and it runs for any page that asks for a position. Unbounded, a slow
// endpoint hangs the position callback forever and an endless body grows guest
// memory. The helper lives inside a template literal that is serialized into a
// <script> tag, so it is extracted and exercised here rather than asserted on
// as source text.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';

function loadBoundedJson() {
  const source = readFileSync(process.cwd() + '/src/preload-webview.js', 'utf8');
  const start = source.indexOf('var IP_LOOKUP_TIMEOUT_MS');
  const end = source.indexOf('async function fetchIPLocation()');
  if (start < 0 || end < 0 || end < start) throw new Error('bounded lookup helper not found in preload');
  // eslint-disable-next-line no-new-func
  return new Function(source.slice(start, end) + '\nreturn { _boundedJson, IP_LOOKUP_TIMEOUT_MS, IP_LOOKUP_MAX_BYTES };')();
}

function bodyOf(bytes) {
  let sent = false;
  const cancel = vi.fn();
  return {
    cancel,
    getReader: () => ({
      cancel,
      read: async () => (sent ? { done: true } : ((sent = true), { done: false, value: bytes })),
    }),
  };
}

function response({ ok = true, length = null, bytes = new Uint8Array() } = {}) {
  const body = bodyOf(bytes);
  return { ok, headers: { get: () => (length === null ? null : String(length)) }, body, _body: body };
}

let helper;
beforeEach(() => { helper = loadBoundedJson(); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('bounded geolocation lookup', () => {
  it('parses a small successful response', async () => {
    const payload = new TextEncoder().encode(JSON.stringify({ latitude: 1.5, longitude: 2.5 }));
    vi.stubGlobal('fetch', vi.fn(async () => response({ bytes: payload, length: payload.length })));
    await expect(helper._boundedJson('https://example.test/')).resolves.toEqual({ latitude: 1.5, longitude: 2.5 });
  });

  it('returns null for a non-ok status', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response({ ok: false })));
    await expect(helper._boundedJson('https://example.test/')).resolves.toBeNull();
  });

  it('rejects a response that declares more than the byte ceiling', async () => {
    const fetchMock = vi.fn(async () => response({ length: helper.IP_LOOKUP_MAX_BYTES + 1 }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(helper._boundedJson('https://example.test/')).resolves.toBeNull();
  });

  it('stops reading a body that exceeds the ceiling despite an honest-looking header', async () => {
    const oversized = new Uint8Array(helper.IP_LOOKUP_MAX_BYTES + 10);
    const res = response({ bytes: oversized, length: 10 });   // Content-Length lies
    vi.stubGlobal('fetch', vi.fn(async () => res));
    await expect(helper._boundedJson('https://example.test/')).resolves.toBeNull();
    expect(res._body.cancel).toHaveBeenCalled();
  });

  it('aborts once the deadline passes instead of hanging', async () => {
    vi.useFakeTimers();
    let abortSignal;
    vi.stubGlobal('fetch', vi.fn((_url, options) => new Promise((_resolve, reject) => {
      abortSignal = options.signal;
      options.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
    })));
    const pending = helper._boundedJson('https://example.test/');
    await vi.advanceTimersByTimeAsync(helper.IP_LOOKUP_TIMEOUT_MS + 1);
    await expect(pending).resolves.toBeNull();
    expect(abortSignal.aborted).toBe(true);
  });

  it('passes a signal and disables caching on every request', async () => {
    const fetchMock = vi.fn(async () => response({ bytes: new TextEncoder().encode('{}') }));
    vi.stubGlobal('fetch', fetchMock);
    await helper._boundedJson('https://example.test/', { Accept: 'application/json' });
    const [, options] = fetchMock.mock.calls[0];
    expect(options.signal).toBeInstanceOf(AbortSignal);
    expect(options.cache).toBe('no-store');
    expect(options.headers).toEqual({ Accept: 'application/json' });
  });
});

// @vitest-environment node
//
// "Bring your own AI key" in the main process (src/main/ai-byok.js): the key is sealed by the secret store, never
// returned to the window, never in an error or a log; every request is made here and streamed back; failures are
// result objects with the provider's real reason.
import { describe, it, expect, vi } from 'vitest';

const { createByok, registerByokIpc } = require('../../src/main/ai-byok.js');

const KEY = 'sk-ant-api03-SECRETSECRETSECRET1234';

// A secret store that keeps what it was given, so the test can look for the key in it (a real one seals it).
function fakeStore() {
  const files = new Map();
  return {
    files,
    read: async (f, fb) => (files.has(f) ? JSON.parse(files.get(f)) : (typeof fb === 'function' ? fb() : fb)),
    write: async (f, v) => { files.set(f, JSON.stringify(v)); },
    clear: async (f) => { files.delete(f); },
  };
}
const enc = new TextEncoder();
function streamOf(text, chunk = 40) {
  let i = 0;
  return new ReadableStream({ pull(c) { if (i >= text.length) { c.close(); return; } c.enqueue(enc.encode(text.slice(i, i + chunk))); i += chunk; } });
}
const sseAnthropic = (...parts) => [
  'event: message_start\ndata: ' + JSON.stringify({ type: 'message_start', message: { usage: { input_tokens: 11, output_tokens: 1 } } }) + '\n\n',
  ...parts.map(t => 'event: content_block_delta\ndata: ' + JSON.stringify({ type: 'content_block_delta', delta: { type: 'text_delta', text: t } }) + '\n\n'),
  'event: message_delta\ndata: ' + JSON.stringify({ type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 7 } }) + '\n\n',
].join('');
const json = (obj, status = 200, headers = {}) => new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json', ...headers } });

function make(fetchImpl, extra = {}) {
  const store = fakeStore();
  const fetch = vi.fn(fetchImpl);
  const byok = createByok({ secretStore: store, file: 'ai-keys.enc', fetch, now: (() => { let t = 1000; return () => (t += 5); })(), log: () => {}, ...extra });
  return { store, fetch, byok };
}
const MODELS = { data: [{ id: 'claude-sonnet-5-5', display_name: 'Claude Sonnet 5.5', created_at: '2026-09-02T00:00:00Z' }, { id: 'claude-haiku-5-5', display_name: 'Claude Haiku 5.5', created_at: '2026-09-03T00:00:00Z' }, { id: 'claude-opus-5-5', display_name: 'Claude Opus 5.5', created_at: '2026-09-01T00:00:00Z' }] };

describe('keeping the key', () => {
  it('seals the key and tells the window only that it is saved and how it ends', async () => {
    const { store, byok } = make(async () => json(MODELS));
    const r = await byok.setKey('anthropic', '  ' + KEY + ' ');
    expect(r.ok).toBe(true);
    expect(JSON.stringify(r)).not.toContain('SECRETSECRET');
    const s = await byok.status();
    expect(JSON.stringify(s)).not.toContain('SECRETSECRET');
    const a = s.providers.find(p => p.id === 'anthropic');
    expect(a).toMatchObject({ saved: true, hasKey: true, last4: '1234' });
    expect(s.providers.find(p => p.id === 'openai')).toMatchObject({ saved: false, last4: '' });
    // It is in the sealed file (the real store encrypts it) and nowhere else.
    expect(store.files.get('ai-keys.enc')).toContain(KEY);
    expect([...store.files.keys()]).toEqual(['ai-keys.enc']);
  });
  it('shows no last four for a short key, and the price table is marked as an estimate', async () => {
    const { byok } = make(async () => json(MODELS));
    await byok.setKey('custom', 'lm-studio', { baseUrl: 'http://localhost:1234/v1' });
    const s = await byok.status();
    expect(s.providers.find(p => p.id === 'custom')).toMatchObject({ saved: true, last4: '', baseUrl: 'http://localhost:1234/v1' });
    expect(s.prices.note).toMatch(/Estimates/);
    expect(s.prices.rows.length).toBeGreaterThan(5);
    expect(s.testHost).toBe(false);
  });
  it('Remove key deletes the file when it was the last one', async () => {
    const { store, byok } = make(async () => json(MODELS));
    await byok.setKey('anthropic', KEY);
    await byok.setKey('openai', 'sk-openai-ABCDEFGHIJKLMNOP');
    await byok.clearKey('anthropic');
    expect(store.files.get('ai-keys.enc')).not.toContain('SECRETSECRET');
    expect((await byok.status()).providers.filter(p => p.saved).map(p => p.id)).toEqual(['openai']);
    await byok.clearKey('openai');
    expect(store.files.size).toBe(0);
  });
  it('refuses a bad key or address before saving anything', async () => {
    const { store, byok } = make(async () => json(MODELS));
    await expect(byok.setKey('anthropic', 'too short')).rejects.toThrow();
    await expect(byok.setKey('custom', 'k', { baseUrl: 'http://evil.example/v1' })).rejects.toThrow(/https/);
    await expect(byok.setKey('nope', KEY)).rejects.toThrow(/Unknown/);
    expect(store.files.size).toBe(0);
  });
  it('the chosen models are kept per provider, and need a saved key', async () => {
    const { byok } = make(async () => json(MODELS));
    await expect(byok.setModels('anthropic', { default: 'x' })).rejects.toThrow(/Save a key/);
    await byok.setKey('anthropic', KEY);
    await byok.setModels('anthropic', { default: 'claude-sonnet-5-5', fast: 'claude-haiku-5-5', best: 'claude-opus-5-5' });
    expect((await byok.status()).providers.find(p => p.id === 'anthropic').models).toEqual({ default: 'claude-sonnet-5-5', fast: 'claude-haiku-5-5', best: 'claude-opus-5-5' });
    await expect(byok.setModels('anthropic', { default: 'has space' })).rejects.toThrow(/not a model id/);
    // Replacing the key keeps the model choices.
    await byok.setKey('anthropic', KEY.replace('1234', '9999'));
    expect((await byok.status()).providers.find(p => p.id === 'anthropic').models.best).toBe('claude-opus-5-5');
  });
});

describe('the model list and Test key', () => {
  it('asks the provider with the key in a header, sorts newest first and recommends', async () => {
    const { byok, fetch } = make(async () => json(MODELS));
    await byok.setKey('anthropic', KEY);
    const r = await byok.listModels('anthropic');
    expect(r).toMatchObject({ ok: true, source: 'live', note: '' });
    expect(r.models.map(m => m.id)).toEqual(['claude-haiku-5-5', 'claude-sonnet-5-5', 'claude-opus-5-5']);
    expect(r.recommended).toEqual({ best: 'claude-opus-5-5', default: 'claude-sonnet-5-5', fast: 'claude-haiku-5-5' });
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe('https://api.anthropic.com/v1/models?limit=1000');
    expect(init.headers['x-api-key']).toBe(KEY);
    expect(init.redirect).toBe('error');
    expect(init.credentials).toBe('omit');
    expect(init.egress.kind).toBe('ai');
    // Cached for the session; refresh asks again.
    await byok.listModels('anthropic');
    expect(fetch).toHaveBeenCalledTimes(1);
    await byok.listModels('anthropic', { refresh: true });
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it('Test key: count and time on success', async () => {
    const { byok } = make(async () => json(MODELS));
    await byok.setKey('anthropic', KEY);
    const t = await byok.test('anthropic');
    expect(t).toMatchObject({ ok: true, count: 3 });
    expect(t.ms).toBeGreaterThan(0);
  });
  it('Test key: the exact error on a refused key, with the key removed from the words', async () => {
    const { byok } = make(async () => json({ type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key ' + KEY } }, 401));
    await byok.setKey('anthropic', KEY);
    const t = await byok.test('anthropic');
    expect(t.ok).toBe(false);
    expect(t.error).toMatchObject({ code: 'invalid-key', status: 401, provider: 'anthropic' });
    expect(t.error.detail).toContain('invalid x-api-key');
    expect(JSON.stringify(t)).not.toContain('SECRETSECRET');
  });
  it('when listing fails, Claude shows the known models with the plain note; other providers show none', async () => {
    const { byok } = make(async () => { throw new Error('getaddrinfo ENOTFOUND'); });
    await byok.setKey('anthropic', KEY);
    await byok.setKey('openai', 'sk-openai-ABCDEFGHIJKLMNOP');
    const a = await byok.listModels('anthropic');
    expect(a).toMatchObject({ ok: false, source: 'fallback', note: 'list unavailable, showing known models' });
    expect(a.models[0].id).toBe('claude-fable-5-1');
    expect(a.error.code).toBe('network');
    const o = await byok.listModels('openai');
    expect(o.models).toEqual([]);
  });
  it('no key saved is said, not guessed', async () => {
    const { byok } = make(async () => json(MODELS));
    expect((await byok.listModels('gemini')).error.code).toBe('no-key');
  });
});

describe('a chat request', () => {
  const messages = [{ role: 'system', content: 'sys' }, { role: 'user', content: 'hello' }];
  async function ready(fetchImpl) {
    const m = make(fetchImpl);
    await m.byok.setKey('anthropic', KEY);
    await m.byok.setModels('anthropic', { default: 'claude-sonnet-5-5', fast: 'claude-haiku-5-5', best: 'claude-opus-5-5' });
    return m;
  }
  it('streams the pieces, returns the text, the usage and the model; the key only travels in the header', async () => {
    const { byok, fetch } = await ready(async () => new Response(streamOf(sseAnthropic('Hel', 'lo ', 'there')), { status: 200, headers: { 'content-type': 'text/event-stream' } }));
    const seen = [];
    const r = await byok.chat('r1', 'anthropic', { tier: 'best', messages, maxTokens: 300 }, (e) => seen.push(e));
    expect(r).toMatchObject({ ok: true, text: 'Hello there', model: 'claude-opus-5-5', usage: { input: 11, output: 7 }, provider: 'anthropic' });
    expect(seen.map(e => e.text)).toEqual(['Hel', 'lo ', 'there']);
    const [url, init] = fetch.mock.calls.at(-1);
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    expect(JSON.parse(init.body)).toMatchObject({ model: 'claude-opus-5-5', max_tokens: 300, stream: true, system: 'sys' });
    expect(init.body).not.toContain('SECRETSECRET');
    expect(init.headers['x-api-key']).toBe(KEY);
  });
  it('the tier picks the model: fast, default, or the request\'s own', async () => {
    const { byok, fetch } = await ready(async () => new Response(streamOf(sseAnthropic('x'))));
    await byok.chat('a', 'anthropic', { tier: 'fast', messages }, () => {});
    await byok.chat('b', 'anthropic', { messages }, () => {});
    await byok.chat('c', 'anthropic', { model: 'claude-fable-5-1', messages }, () => {});
    expect(fetch.mock.calls.map(c => JSON.parse(c[1].body).model)).toEqual(['claude-haiku-5-5', 'claude-sonnet-5-5', 'claude-fable-5-1']);
  });
  it('with no model chosen it uses the recommended one from the provider\'s own list', async () => {
    const { byok, fetch } = make(async (url) => (String(url).includes('/v1/models') ? json(MODELS) : new Response(streamOf(sseAnthropic('ok')))));
    await byok.setKey('anthropic', KEY);
    const r = await byok.chat('a', 'anthropic', { tier: 'best', messages }, () => {});
    expect(r.model).toBe('claude-opus-5-5');
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it('401, 429 with Retry-After, 402 and 500 come back as result objects, not exceptions', async () => {
    const cases = [
      [401, { error: { message: 'bad key' } }, {}, 'invalid-key'],
      [429, { error: { message: 'slow down' } }, { 'retry-after': '12' }, 'rate-limit'],
      [402, { error: { message: 'no credit' } }, {}, 'quota'],
      [500, { error: { message: 'oops' } }, {}, 'overloaded'],
    ];
    for (const [status, body, headers, code] of cases) {
      const { byok } = await ready(async () => json(body, status, headers));
      const r = await byok.chat('x', 'anthropic', { messages }, () => {});
      expect(r.ok).toBe(false);
      expect(r.error).toMatchObject({ code, status });
      if (code === 'rate-limit') expect(r.error.retryAfter).toBe(12);
    }
  });
  it('an error event in the middle of the stream is an error with the provider\'s words', async () => {
    const body = sseAnthropic('partial') + 'event: error\ndata: ' + JSON.stringify({ type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } }) + '\n\n';
    const { byok } = await ready(async () => new Response(streamOf(body)));
    const r = await byok.chat('x', 'anthropic', { messages }, () => {});
    expect(r.error).toMatchObject({ code: 'overloaded', detail: 'Overloaded' });
  });
  it('a network failure says so, and an answer with no text is an error', async () => {
    const a = await ready(async () => { throw new Error('connect ECONNREFUSED'); });
    expect((await a.byok.chat('x', 'anthropic', { messages }, () => {})).error.code).toBe('network');
    const b = await ready(async () => new Response(streamOf('event: ping\ndata: {"type":"ping"}\n\n')));
    expect((await b.byok.chat('x', 'anthropic', { messages }, () => {})).error.detail).toMatch(/no text/);
  });
  it('Stop cancels the request and reports a stop, not a failure', async () => {
    let signal;
    const { byok } = await ready(async (_u, init) => {
      signal = init.signal;
      return new Response(new ReadableStream({
        start(c) { c.enqueue(enc.encode(sseAnthropic('first'))); init.signal.addEventListener('abort', () => c.error(new Error('aborted'))); },
      }));
    });
    const seen = [];
    const run = byok.chat('stopme', 'anthropic', { messages }, (e) => { seen.push(e.text); if (byok.cancel('stopme')) seen.push('cancelled'); });
    const r = await run;
    expect(r).toEqual({ ok: false, stopped: true });
    expect(signal.aborted).toBe(true);
    expect(byok.cancel('stopme')).toBe(false);
  });
  it('a missing key or model is told, with where to fix it', async () => {
    const { byok } = make(async () => json(MODELS));
    expect((await byok.chat('x', 'openai', { messages }, () => {})).error.code).toBe('no-key');
    await byok.setKey('custom', '', { baseUrl: 'http://localhost:1234/v1' });
    const r = await byok.chat('x', 'custom', { messages }, () => {});
    expect(r.error.code).toBe('no-model');
  });
  it('the key is scrubbed from any message, and so is anything shaped like one', () => {
    const { byok } = make(async () => json(MODELS));
    expect(byok._scrub('failed with ' + KEY + ' and Bearer abcdefghijklmnopqrstuv', KEY)).toBe('failed with [key] and [key]');
  });
});

describe('the test-only provider host', () => {
  it('sends every provider to the stand-in server and says so in the status', async () => {
    const { byok, fetch } = make(async () => json(MODELS), { testHost: 'http://127.0.0.1:4555' });
    await byok.setKey('anthropic', KEY);
    expect((await byok.status()).testHost).toBe(true);
    await byok.listModels('anthropic');
    expect(fetch.mock.calls[0][0]).toBe('http://127.0.0.1:4555/anthropic/v1/models?limit=1000');
  });
  it('refuses any host that is not a loopback address with a port', () => {
    for (const bad of ['https://api.anthropic.com', 'http://192.168.0.5:80', 'http://127.0.0.1', 'http://localhost:4555']) {
      expect(() => createByok({ secretStore: fakeStore(), file: 'f', fetch: async () => {}, testHost: bad, log: () => {} })).toThrow(/VEX_TEST_PROVIDER_HOST/);
    }
  });
});

describe('the IPC side', () => {
  it('registers the channels and streams events only to the asking window', async () => {
    const handlers = new Map();
    const ipcMain = { handle: (c, fn) => handlers.set(c, fn) };
    const { byok } = make(async () => new Response(streamOf(sseAnthropic('a', 'b'))));
    registerByokIpc({ ipcMain, byok });
    expect([...handlers.keys()].sort()).toEqual(['aikey:cancel', 'aikey:chat', 'aikey:clear-key', 'aikey:models', 'aikey:set-key', 'aikey:set-models', 'aikey:status', 'aikey:test']);
    await handlers.get('aikey:set-key')({}, { provider: 'anthropic', key: KEY });
    await handlers.get('aikey:set-models')({}, { provider: 'anthropic', models: { default: 'claude-sonnet-5-5' } });
    const sent = [];
    const sender = { isDestroyed: () => false, send: (ch, ev) => sent.push([ch, ev]) };
    const res = await handlers.get('aikey:chat')({ sender }, { id: 'q1', provider: 'anthropic', messages: [{ role: 'user', content: 'hi' }] });
    expect(res.ok).toBe(true);
    expect(sent).toEqual([['aikey:event', { id: 'q1', type: 'delta', text: 'a' }], ['aikey:event', { id: 'q1', type: 'delta', text: 'b' }]]);
    const gone = { isDestroyed: () => true, send: () => { throw new Error('must not send'); } };
    expect((await handlers.get('aikey:chat')({ sender: gone }, { id: 'q2', provider: 'anthropic', messages: [{ role: 'user', content: 'hi' }] })).ok).toBe(true);
  });
});

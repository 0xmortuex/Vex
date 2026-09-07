import { describe, it, expect, vi, afterEach } from 'vitest';
import syncWorker, { syncHandler, VexSyncState } from '../../workers/vex-sync-worker/worker.js';
import aiWorker, { VexAIState } from '../../workers/vex-ai-worker/worker.js';
import { boundedJson } from '../../workers/shared/security.js';
function state() {
  const records = new Map(); let queue = Promise.resolve();
  return { storage: { get: async k => records.get(k), put: async (k,v) => { records.set(k,v); }, delete: async k => records.delete(k) },
    blockConcurrencyWhile(fn) { const result = queue.then(fn); queue = result.catch(() => {}); return result; } };
}
const token = 'secret-test-client-token-0123456789';
const post = (url, body, auth = '') => new Request(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: auth }, body: JSON.stringify(body) });
afterEach(() => vi.unstubAllGlobals());
describe('production worker boundaries', () => {
  it('requires durable state in both deployments', async () => {
    expect((await syncWorker.fetch(post('https://sync.test/auth/request-code', {}), {})).status).toBe(503);
    expect((await aiWorker.fetch(post('https://ai.test', {}), {})).status).toBe(503);
  });
  it('never enables development codes on a public host', async () => {
    const response = await syncHandler.fetch(post('https://sync.test/auth/request-code', { email: 'a@example.com' }), { DEVELOPMENT_MODE: 'true' });
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain('devCode');
  });
  it('serializes concurrent issuance so exactly three requests succeed', async () => {
    const object = new VexSyncState(state(), { DEVELOPMENT_MODE: 'true' });
    const responses = await Promise.all(Array.from({ length: 8 }, () => object.fetch(post('http://localhost/auth/request-code', { email: 'a@example.com' }))));
    expect(responses.filter(r => r.status === 200)).toHaveLength(3);
    expect(responses.filter(r => r.status === 429)).toHaveLength(5);
  });
  it('rejects unauthenticated AI and enforces a per-client daily ceiling', async () => {
    const upstream = vi.fn(async () => Response.json({ choices: [{ message: { content: 'ok' } }] }));
    vi.stubGlobal('fetch', upstream);
    const object = new VexAIState(state(), { VEX_CLIENT_TOKENS: JSON.stringify({ alice: token }), DAILY_REQUEST_LIMIT: '2', OPENROUTER_API_KEY: 'test' });
    expect((await object.fetch(post('https://ai.test', { action: 'chat', message: 'hi' }))).status).toBe(401);
    const responses = await Promise.all(Array.from({ length: 6 }, () => object.fetch(post('https://ai.test', { action: 'chat', message: 'hi' }, 'Bearer ' + token))));
    expect(responses.filter(r => r.status === 200)).toHaveLength(2);
    expect(responses.filter(r => r.status === 429)).toHaveLength(4);
    expect(upstream).toHaveBeenCalledTimes(2);
  });
  it('bounds actual streamed bytes without trusting Content-Length', async () => {
    const request = post('https://test', { data: 'x'.repeat(200) });
    await expect(boundedJson(request, 100)).rejects.toMatchObject({ status: 413 });
  });
  it('releases the quota lock before waiting for the model response', async () => {
    let release, entered;
    const started = new Promise(resolve => { entered = resolve; });
    vi.stubGlobal('fetch', vi.fn(() => { entered(); return new Promise(resolve => { release = resolve; }); }));
    const object = new VexAIState(state(), { VEX_CLIENT_TOKENS: JSON.stringify({ alice: token }), DAILY_REQUEST_LIMIT: '1', OPENROUTER_API_KEY: 'test' });
    const first = object.fetch(post('https://ai.test', { action: 'chat', message: 'hi' }, 'Bearer ' + token));
    await started;
    // This must resolve while the first model request is still blocked.
    const second = await object.fetch(post('https://ai.test', { action: 'chat', message: 'hi' }, 'Bearer ' + token));
    expect(second.status).toBe(429);
    release(Response.json({ choices: [{ message: { content: 'ok' } }] }));
    expect((await first).status).toBe(200);
  });
  it('rejects an oversized upstream response as a gateway failure', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ choices: [{ message: { content: 'x'.repeat(1024 * 1024) } }] })));
    const object = new VexAIState(state(), { VEX_CLIENT_TOKENS: JSON.stringify({ alice: token }), OPENROUTER_API_KEY: 'test' });
    const response = await object.fetch(post('https://ai.test', { action: 'chat', message: 'hi' }, 'Bearer ' + token));
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: 'Invalid or oversized model response' });
  });
});

// The GitHub read-only token vault (src/main/github-vault.js), tested against a
// local stand-in for api.github.com. The real GitHub is never called.
import { describe, it, expect, beforeEach } from 'vitest';

const { createGithubVault, apiUrl } = require('../../src/main/github-vault');

const TOKEN = 'github_pat_11ABCDEFG0abcdefghijklmnopqrst_UVWXYZ0123456789abcdefghijklmnopqrstuvwxyz01234567';

function memoryStore() {
  const files = new Map();
  return {
    files,
    read: async (f, legacy) => (files.has(f) ? JSON.parse(files.get(f)) : null),
    write: async (f, v) => { files.set(f, JSON.stringify(v)); return true; },
    clear: async (f) => { files.delete(f); return true; },
  };
}

// A stand-in for api.github.com: records every request, answers from a table.
function standIn(routes) {
  const calls = [];
  const fn = async (url, init = {}) => {
    calls.push({ url, init });
    const u = new URL(url);
    const key = u.host + u.pathname;
    const r = routes[key];
    if (r instanceof Error) throw r;
    if (!r) return new Response('{"message":"Not Found"}', { status: 404 });
    return new Response(r.body == null ? '' : r.body, { status: r.status || 200, headers: r.headers || {} });
  };
  fn.calls = calls;
  return fn;
}

const QUOTA = { 'x-ratelimit-limit': '5000', 'x-ratelimit-remaining': '4990', 'x-ratelimit-used': '10', 'x-ratelimit-reset': '1800000000', 'x-ratelimit-resource': 'core' };

let store, vault, fetchStub;
function make(routes) {
  store = memoryStore();
  fetchStub = standIn(routes);
  vault = createGithubVault({ secretStore: store, file: 'github-token.enc', fetch: fetchStub });
}

describe('saving the token', () => {
  beforeEach(() => make({}));
  it('keeps a fine-grained token and says only that there is one', async () => {
    expect((await vault.status()).has).toBe(false);
    await vault.set(TOKEN);
    const s = await vault.status();
    expect(s.has).toBe(true);
    expect(JSON.stringify(s)).not.toContain('github_pat');
    expect(store.files.get('github-token.enc')).toContain(TOKEN);   // it is in the (sealed) store and nowhere else
  });
  it('refuses a classic token, which cannot be read-only', async () => {
    await expect(vault.set('ghp_' + 'a'.repeat(36))).rejects.toThrow(/classic token/);
    expect((await vault.status()).has).toBe(false);
  });
  it('refuses something that is not a token', async () => {
    await expect(vault.set('hunter2')).rejects.toThrow(/fine-grained/);
    await expect(vault.set('')).rejects.toThrow();
  });
  it('is revoked with one call', async () => {
    await vault.set(TOKEN);
    await vault.clear();
    expect((await vault.status()).has).toBe(false);
    expect(store.files.size).toBe(0);
  });
});

describe('testing the token and the quota', () => {
  it('reports scopes and the remaining quota, never the token', async () => {
    make({ 'api.github.com/rate_limit': { headers: { ...QUOTA, 'x-oauth-scopes': 'repo, read:org', 'github-authentication-token-expiration': '2026-12-01 00:00:00 UTC' }, body: JSON.stringify({ resources: { core: { limit: 5000, remaining: 4990, used: 10, reset: 1800000000 } } }) } });
    await vault.set(TOKEN);
    const r = await vault.test();
    expect(r.ok).toBe(true);
    expect(r.scopes).toEqual(['repo', 'read:org']);
    expect(r.quota).toMatchObject({ limit: 5000, remaining: 4990 });
    expect(JSON.stringify(r)).not.toContain('github_pat');
    expect((await vault.status()).quota.remaining).toBe(4990);
  });
  it('says so when GitHub rejects the token', async () => {
    make({ 'api.github.com/rate_limit': { status: 401, body: '{}' } });
    await vault.set(TOKEN);
    await expect(vault.test()).rejects.toThrow(/rejected the token/);
  });
  it('has nothing to test without a token', async () => {
    make({});
    await expect(vault.test()).rejects.toThrow(/no token/);
  });
});

describe('where the token may go', () => {
  beforeEach(() => make({ 'api.github.com/repos/o/r/actions/runs': { headers: QUOTA, body: '{"workflow_runs":[]}' } }));
  it('sends it to api.github.com over https, by GET, with no cookies', async () => {
    await vault.set(TOKEN);
    const r = await vault.get('/repos/o/r/actions/runs?status=failure&per_page=5');
    expect(r.ok).toBe(true);
    expect(r.authed).toBe(true);
    expect(r.quota.remaining).toBe(4990);
    const c = fetchStub.calls[0];
    expect(c.url.startsWith('https://api.github.com/')).toBe(true);
    expect(c.init.method).toBe('GET');
    expect(c.init.credentials).toBe('omit');
    expect(c.init.headers.Authorization).toBe('Bearer ' + TOKEN);
    expect(c.init.egress).toMatchObject({ feature: 'GitHub (read-only)' });
  });
  it('asks without it for public data when told to', async () => {
    await vault.set(TOKEN);
    const r = await vault.get('/repos/o/r/actions/runs', { authed: false });
    expect(r.authed).toBe(false);
    expect(fetchStub.calls[0].init.headers.Authorization).toBeUndefined();
  });
  it('works unauthenticated when there is no token (public data)', async () => {
    const r = await vault.get('/repos/o/r/actions/runs');
    expect(r.authed).toBe(false);
  });
  it('refuses every address that is not a read endpoint on api.github.com', async () => {
    await vault.set(TOKEN);
    for (const p of ['//evil.example/repos/o/r', 'https://evil.example/x', '/repos/o/r/git/refs', '/repos/o/r/issues', '/repos/../admin', '/repos/o/r/commits?access_token=1', '/repos/o/r/commits?since=a b', '/orgs/x/members', '/user/keys', '/repos/o/r/actions/runs#frag', 'repos/o/r', '/repos/o/r/contents/..%2f..%2fx']) {
      await expect(vault.get(p), p).rejects.toThrow();
    }
    expect(fetchStub.calls.length).toBe(0);
  });
  it('builds the address itself, on api.github.com only', () => {
    expect(apiUrl('/rate_limit')).toBe('https://api.github.com/rate_limit');
    expect(() => apiUrl('/@evil.example/')).toThrow();
  });
  it('never puts the token in an error', async () => {
    make({ 'api.github.com/rate_limit': new Error('socket hung up while sending Bearer ' + TOKEN) });
    await vault.set(TOKEN);
    const err = await vault.test().catch(e => e);
    expect(err.message).toContain('GitHub could not be reached');
    expect(err.message).not.toContain(TOKEN);
    expect(err.message).not.toContain('github_pat');
  });
});

describe('a job log', () => {
  const SIGNED = 'https://pipelines.actions.githubusercontent.com/abc/log?sig=xyz';
  it('is followed to GitHub storage without the token', async () => {
    make({
      'api.github.com/repos/o/r/actions/jobs/42/logs': { status: 302, headers: { location: SIGNED } },
      'pipelines.actions.githubusercontent.com/abc/log': { body: '2026-10-16T10:00:00Z ##[error]boom' },
    });
    await vault.set(TOKEN);
    const r = await vault.get('/repos/o/r/actions/jobs/42/logs');
    expect(r.text).toContain('boom');
    expect(fetchStub.calls[0].init.headers.Authorization).toBe('Bearer ' + TOKEN);
    expect(fetchStub.calls[1].init.headers.Authorization).toBeUndefined();
    expect(fetchStub.calls[1].init.redirect).toBe('error');
  });
  it('is not followed to any other host or to http', async () => {
    for (const loc of ['https://evil.example/log', 'http://pipelines.actions.githubusercontent.com/log', 'https://user:pw@x.githubusercontent.com/log', 'https://githubusercontent.com.evil.example/log']) {
      make({ 'api.github.com/repos/o/r/actions/jobs/42/logs': { status: 302, headers: { location: loc } } });
      await vault.set(TOKEN);
      await expect(vault.get('/repos/o/r/actions/jobs/42/logs'), loc).rejects.toThrow(/will not follow|could not read/);
      expect(fetchStub.calls.length).toBe(1);
    }
  });
});

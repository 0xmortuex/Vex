// Package versions, advisories and endpoint pings for the developer features
// (src/main/dev-feeds.js), against local stand-ins. No real service is called.
import { describe, it, expect } from 'vitest';

const { createDevFeeds, checkEndpointUrl } = require('../../src/main/dev-feeds');

function stub(routes) {
  const calls = [];
  const fn = async (url, init = {}) => {
    calls.push({ url, init });
    const u = new URL(url);
    const r = routes[u.host + u.pathname];
    if (r instanceof Error) throw r;
    if (!r) return new Response('nope', { status: 404 });
    return new Response(typeof r.body === 'string' ? r.body : JSON.stringify(r.body ?? {}), { status: r.status || 200 });
  };
  fn.calls = calls;
  return fn;
}

describe('latest versions', () => {
  it('asks npm and PyPI by name and sends nothing else', async () => {
    const f = stub({ 'registry.npmjs.org/vitest/latest': { body: { version: '3.2.4' } }, 'registry.npmjs.org/@scope%2Fpkg/latest': { body: { version: '1.0.0' } }, 'pypi.org/pypi/requests/json': { body: { info: { version: '2.32.0' } } } });
    const d = createDevFeeds({ fetch: f, publicFetch: stub({}) });
    expect(await d.latest('npm', 'vitest')).toEqual({ name: 'vitest', version: '3.2.4' });
    expect(await d.latest('npm', '@scope/pkg')).toMatchObject({ version: '1.0.0' });
    expect(await d.latest('pypi', 'requests')).toMatchObject({ version: '2.32.0' });
    for (const c of f.calls) { expect(c.init.headers.Authorization).toBeUndefined(); expect(c.init.credentials).toBe('omit'); }
  });
  it('refuses a name that is not a package name and an unknown ecosystem', async () => {
    const d = createDevFeeds({ fetch: stub({}), publicFetch: stub({}) });
    await expect(d.latest('npm', '../etc/passwd')).rejects.toThrow(/package name/);
    await expect(d.latest('npm', 'a b')).rejects.toThrow();
    await expect(d.latest('cargo', 'serde')).rejects.toThrow(/ecosystem/);
  });
  it('says so when a package does not exist', async () => {
    const d = createDevFeeds({ fetch: stub({}), publicFetch: stub({}) });
    await expect(d.latest('npm', 'no-such-thing-1')).rejects.toThrow(/not on npm/);
  });
});

describe('advisories', () => {
  it('counts what the advisory database knows for one version', async () => {
    const f = stub({ 'api.osv.dev/v1/query': { body: { vulns: [{ id: 'GHSA-1', summary: 'bad' }, { id: 'GHSA-2' }] } } });
    const d = createDevFeeds({ fetch: f, publicFetch: stub({}) });
    const r = await d.advisories('npm', 'electron', '30.0.0');
    expect(r.count).toBe(2);
    expect(JSON.parse(f.calls[0].init.body)).toEqual({ version: '30.0.0', package: { name: 'electron', ecosystem: 'npm' } });
  });
  it('refuses a version that is not one', async () => {
    const d = createDevFeeds({ fetch: stub({}), publicFetch: stub({}) });
    await expect(d.advisories('npm', 'x', '1.0 || rm')).rejects.toThrow(/version/);
  });
});

describe('pinging an endpoint', () => {
  it('refuses credentials in the address, secret query keys, http and private networks', () => {
    for (const bad of ['http://worker.example.com/health', 'https://user:pw@worker.example.com/', 'https://worker.example.com/?token=abc', 'https://worker.example.com/?api_key=1', 'https://localhost/health', 'https://127.0.0.1/', 'https://192.168.1.5/x', 'https://10.0.0.2/', 'https://[::1]/', 'https://intranet/', 'https://printer.local/', 'not a url']) {
      expect(() => checkEndpointUrl(bad), bad).toThrow();
    }
    expect(checkEndpointUrl('https://vex-sync.example.workers.dev/health?x=1').hostname).toBe('vex-sync.example.workers.dev');
  });
  it('sends one GET without credentials and brings back status, time and the start of the answer', async () => {
    const pf = stub({ 'vex-sync.example.workers.dev/health': { body: { status: 'ok', version: '1.2.3' } } });
    const d = createDevFeeds({ fetch: stub({}), publicFetch: pf });
    const r = await d.ping('https://vex-sync.example.workers.dev/health');
    expect(r).toMatchObject({ ok: true, status: 200 });
    expect(JSON.parse(r.text).version).toBe('1.2.3');
    expect(pf.calls[0].init.method).toBe('GET');
    expect(pf.calls[0].init.headers.Authorization).toBeUndefined();
    expect(pf.calls[0].init.credentials).toBe('omit');
  });
  it('reports a network failure as an answer, not a crash', async () => {
    const d = createDevFeeds({ fetch: stub({}), publicFetch: stub({ 'down.example.com/': new Error('connect ECONNREFUSED') }) });
    expect(await d.ping('https://down.example.com/')).toMatchObject({ ok: false, status: 0, error: expect.stringContaining('ECONNREFUSED') });
  });
  it('does not ping a refused address at all', async () => {
    const pf = stub({});
    const d = createDevFeeds({ fetch: stub({}), publicFetch: pf });
    await expect(d.ping('https://localhost/')).rejects.toThrow(/local network/);
    expect(pf.calls.length).toBe(0);
  });
});

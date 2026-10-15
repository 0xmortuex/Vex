// The API playground sends one request from the main process. What is tested
// here is where it may go (public addresses; localhost only when asked; never
// the local network), what it may carry, and that its IPC contract is closed to
// pages. No real request is made: both transports are fakes.
import { describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';

const { createApiPlayground, isLoopbackHost, cleanHeaders } = require('../../src/main/api-playground.js');
const { createPublicFetch } = require('../../src/main/public-fetch.js');
const { createBoundedFetch } = require('../../src/renderer/js/network.js');
const { validate } = require('../../src/main/ipc-schemas.js');
const { validatePayload, UI_ONLY_CHANNELS } = require('../../src/main/ipc-policy.js');

function response(body = '{"ok":true}', { status = 200, type = 'application/json' } = {}) {
  return new Response(body, { status, headers: { 'content-type': type } });
}

function make({ pub, local } = {}) {
  const publicFetch = vi.fn(pub || (async () => response()));
  const localFetch = vi.fn(local || (async () => response('{"local":1}')));
  const pg = createApiPlayground({ publicFetch, localFetch, boundedFactory: createBoundedFetch, timeoutMs: 500 });
  return { pg, publicFetch, localFetch };
}

describe('API playground: where a request may go', () => {
  it('sends to a public address and returns status, headers and body', async () => {
    const { pg, publicFetch } = make();
    const r = await pg.send({ method: 'POST', url: 'https://api.example.com/v1/items', headers: { 'Content-Type': 'application/json' }, body: '{"a":1}' });
    expect(r.ok).toBe(true);
    expect(r.status).toBe(200);
    expect(r.body).toBe('{"ok":true}');
    expect(r.local).toBe(false);
    expect(publicFetch).toHaveBeenCalledTimes(1);
    const [url, init] = publicFetch.mock.calls[0];
    expect(url).toBe('https://api.example.com/v1/items');
    expect(init.method).toBe('POST');
    expect(init.body).toBe('{"a":1}');
  });

  it.each([
    'http://localhost:3000/', 'http://127.0.0.1/', 'http://[::1]:8080/', 'http://api.localhost/', 'http://[::ffff:127.0.0.1]/', 'http://[::ffff:7f00:1]/', 'http://2130706433/',
  ])('refuses %s unless "Allow localhost" is on', async (url) => {
    const { pg, localFetch, publicFetch } = make();
    await expect(pg.send({ method: 'GET', url })).rejects.toThrow(/localhost/i);
    expect(localFetch).not.toHaveBeenCalled();
    expect(publicFetch).not.toHaveBeenCalled();
  });

  it('sends to localhost through the local transport when allowed', async () => {
    const { pg, localFetch, publicFetch } = make();
    const r = await pg.send({ method: 'GET', url: 'http://localhost:3000/health', allowLocal: true });
    expect(r.ok).toBe(true);
    expect(r.local).toBe(true);
    expect(localFetch).toHaveBeenCalledTimes(1);
    expect(publicFetch).not.toHaveBeenCalled();
  });

  it.each(['http://192.168.1.1/', 'http://10.0.0.5/admin', 'http://169.254.169.254/latest', 'http://[fe80::1]/', 'http://0.0.0.0/', 'http://[fc00::1]/', 'http://172.16.0.1/'])(
    'refuses the local network address %s even with localhost allowed', async (url) => {
      const { pg, localFetch, publicFetch } = make();
      await expect(pg.send({ method: 'GET', url, allowLocal: true })).rejects.toThrow(/local network/i);
      expect(localFetch).not.toHaveBeenCalled();
      expect(publicFetch).not.toHaveBeenCalled();
    });

  it('a name that resolves to a private address, and a redirect to one, are refused by the public transport', async () => {
    const request = vi.fn(() => { throw new Error('must not be requested'); });
    const resolveHost = vi.fn(async () => ({ endpoints: [{ address: '192.168.0.9' }] }));
    const pub = createPublicFetch({ request, resolveHost });
    const { pg } = make({ pub });
    await expect(pg.send({ method: 'GET', url: 'https://sneaky.example.com/' })).rejects.toThrow(/local network|this machine/i);
    expect(request).not.toHaveBeenCalled();
  });

  it('refuses non-http schemes, embedded credentials and a body on GET', async () => {
    const { pg } = make();
    await expect(pg.send({ method: 'GET', url: 'file:///C:/Windows/win.ini' })).rejects.toThrow(/http/i);
    await expect(pg.send({ method: 'GET', url: 'https://user:pw@example.com/' })).rejects.toThrow(/credentials/i);
    await expect(pg.send({ method: 'GET', url: 'https://example.com/', body: 'x' })).rejects.toThrow(/no body/i);
    await expect(pg.send({ method: 'TRACE', url: 'https://example.com/' })).rejects.toThrow(/Method/);
  });

  it('times out instead of hanging', async () => {
    const { pg } = make({ pub: () => new Promise(() => {}) });
    await expect(pg.send({ method: 'GET', url: 'https://slow.example.com/' })).rejects.toThrow(/timed out/i);
  });

  it('does not show the bytes of a binary answer', async () => {
    const { pg } = make({ pub: async () => response('\x89PNG....', { type: 'image/png' }) });
    const r = await pg.send({ method: 'GET', url: 'https://example.com/a.png' });
    expect(r.binary).toBe(true);
    expect(r.body).toBe('');
  });
});

describe('API playground: headers', () => {
  it('knows loopback hosts', () => {
    expect(isLoopbackHost('localhost')).toBe(true);
    expect(isLoopbackHost('127.0.0.1')).toBe(true);
    expect(isLoopbackHost('[::1]')).toBe(true);
    expect(isLoopbackHost('example.com')).toBe(false);
    expect(isLoopbackHost('192.168.1.1')).toBe(false);
  });

  it('refuses headers the network stack owns and header injection', () => {
    expect(() => cleanHeaders({ Host: 'evil' })).toThrow(/set by Vex/);
    expect(() => cleanHeaders({ 'Content-Length': '1' })).toThrow();
    expect(() => cleanHeaders({ 'X-A': 'a\r\nX-B: b' })).toThrow(/valid value/);
    expect(() => cleanHeaders({ 'Bad Name': 'a' })).toThrow(/valid header name/);
    expect(cleanHeaders({ Authorization: 'Bearer x' })).toEqual({ Authorization: 'Bearer x' });
  });
});

describe('API playground: IPC contract', () => {
  const ok = { method: 'GET', url: 'https://example.com/' };
  it('has a schema that accepts a request and refuses junk', () => {
    expect(() => validate('playground:send', [ok])).not.toThrow();
    expect(() => validate('playground:send', [{ ...ok, headers: { A: 'b' }, body: 'x', allowLocal: true }])).not.toThrow();
    expect(() => validate('playground:send', [{ ...ok, method: 'TRACE' }])).toThrow();
    expect(() => validate('playground:send', [{ ...ok, url: 'file:///etc/passwd' }])).toThrow();
    expect(() => validate('playground:send', [{ ...ok, allowLocal: 'yes' }])).toThrow();
    expect(() => validate('playground:send', [])).toThrow();
  });
  it('is a UI-only channel: never a page or an extension', () => {
    expect(UI_ONLY_CHANNELS.has('playground:send')).toBe(true);
    expect(() => validatePayload('playground:send', [ok])).not.toThrow();
  });
  it('is closed in private windows', () => {
    const src = require('node:fs').readFileSync(require('node:path').join(__dirname, '../../src/main/ipc-policy.js'), 'utf8');
    expect(src).toMatch(/PRIVATE_DISABLED = [^\n]*playground:/);
  });
  it('is exposed by the preload and handled in main', () => {
    const fs = require('node:fs'), path = require('node:path');
    expect(fs.readFileSync(path.join(__dirname, '../../src/preload.js'), 'utf8')).toMatch(/playgroundSend:\s*\(req\)\s*=>\s*ipcRenderer\.invoke\('playground:send'/);
    expect(fs.readFileSync(path.join(__dirname, '../../src/main.js'), 'utf8')).toMatch(/ipcMain\.handle\('playground:send'/);
  });
});

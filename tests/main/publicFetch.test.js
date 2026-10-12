// The AI agent's page reads reach only the public internet (audit AI1,
// 2026-10-10): [::ffff:127.0.0.1], the machine's own name and a redirect to
// this machine all used to get through.
import { describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';

const { createPublicFetch, REFUSED } = require('../../src/main/public-fetch.js');
const PA = require('../../src/renderer/js/private-address.js');

// A stand-in for Electron's net.request: routes[url] = { status, headers, body } or { redirect }.
function fakeNet(routes, dns) {
  const requested = [];
  const request = vi.fn((opts) => {
    const req = new EventEmitter();
    req.setHeader = vi.fn();
    req.abort = vi.fn();
    req.write = vi.fn();
    req.end = () => {
      requested.push(opts.url);
      expect(opts.redirect).toBe('manual');
      const r = routes[opts.url];
      setTimeout(() => {
        if (!r) { req.emit('error', new Error('net::ERR_CONNECTION_REFUSED')); return; }
        if (r.redirect) { req.emit('redirect', r.status || 302, 'GET', r.redirect, {}); return; }
        const res = new EventEmitter();
        res.statusCode = r.status || 200; res.statusMessage = 'OK'; res.headers = r.headers || { 'content-type': ['text/html'] };
        req.emit('response', res);
        setTimeout(() => { res.emit('data', Buffer.from(r.body || '')); res.emit('end'); }, 0);
      }, 0);
    };
    return req;
  });
  const resolveHost = vi.fn(async (host) => {
    if (!(host in dns)) throw new Error('net::ERR_NAME_NOT_RESOLVED');
    return { endpoints: dns[host].map(address => ({ address, family: address.includes(':') ? 'ipv6' : 'ipv4' })) };
  });
  return { request, resolveHost, requested };
}

describe('private addresses', () => {
  it.each([
    '127.0.0.1', '::1', '[::1]', '::ffff:127.0.0.1', '::ffff:7f00:1', '[::ffff:192.168.1.1]', '::', '0.0.0.0',
    '10.1.2.3', '100.64.0.1', '100.127.255.254', '169.254.169.254', '172.16.0.1', '192.168.0.1', '224.0.0.1', '255.255.255.255',
    'fd00::1', 'fe80::1', 'fe80::1%eth0', '64:ff9b::7f00:1', '2002:c0a8:101::1', '::127.0.0.1',
  ])('%s is private', (ip) => {
    expect(PA.isPrivateIp(ip)).toBe(true);
  });

  it.each(['8.8.8.8', '1.1.1.1', '100.63.0.1', '100.128.0.1', '172.32.0.1', '2606:4700::1111', '::ffff:8.8.8.8'])('%s is public', (ip) => {
    expect(PA.isPrivateIp(ip)).toBe(false);
  });

  it('a name with no dot (a machine on the network), localhost and local suffixes are private hosts', () => {
    for (const h of ['DESKTOP-L4CC18H', 'desktop-l4cc18h', 'router', 'localhost', 'localhost.', 'a.localhost', 'nas.local', 'x.internal', 'x.lan', 'printer.home.arpa', '']) {
      expect(PA.isPrivateHost(h), h).toBe(true);
    }
    for (const h of ['example.com', 'example.com.', 'docs.github.com', '[2606:4700::1111]']) expect(PA.isPrivateHost(h), h).toBe(false);
  });
});

describe('publicFetch', () => {
  it('reads a public page', async () => {
    const n = fakeNet({ 'https://example.com/': { body: 'hello' } }, { 'example.com': ['93.184.216.34'] });
    const res = await createPublicFetch(n)('https://example.com/', { headers: { 'User-Agent': 'x' } });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('hello');
  });

  it.each([
    'http://[::ffff:127.0.0.1]:9878/secret', 'http://[::ffff:7f00:1]/', 'http://[::]:11434/', 'http://0.0.0.0:11434/',
    'http://DESKTOP-L4CC18H:9878/secret', 'http://100.64.1.1/', 'http://localhost./',
  ])('refuses %s without sending anything', async (url) => {
    const n = fakeNet({}, {});
    await expect(createPublicFetch(n)(url)).rejects.toThrow(REFUSED);
    expect(n.request).not.toHaveBeenCalled();
  });

  it('refuses a public-looking name that resolves to this machine or the network', async () => {
    for (const addr of ['127.0.0.1', '192.168.1.100', '::1', '::ffff:10.0.0.1']) {
      const n = fakeNet({}, { 'evil.example': ['93.184.216.34', addr] });
      await expect(createPublicFetch(n)('http://evil.example/'), addr).rejects.toThrow(REFUSED);
      expect(n.request).not.toHaveBeenCalled();
    }
  });

  it('checks every redirect hop, and refuses one that leads to this machine', async () => {
    const n = fakeNet({
      'https://example.com/r': { redirect: 'http://127.0.0.1:9878/secret' },
      'http://127.0.0.1:9878/secret': { body: 'SECRET' },
    }, { 'example.com': ['93.184.216.34'] });
    await expect(createPublicFetch(n)('https://example.com/r')).rejects.toThrow(REFUSED);
    expect(n.requested).toEqual(['https://example.com/r']);
  });

  it('refuses a redirect to a name that resolves privately, and follows a public one', async () => {
    const dns = { 'example.com': ['93.184.216.34'], 'rebind.example': ['10.0.0.8'], 'other.example': ['93.184.216.35'] };
    const bad = fakeNet({ 'https://example.com/r': { redirect: 'http://rebind.example/admin' } }, dns);
    await expect(createPublicFetch(bad)('https://example.com/r')).rejects.toThrow(REFUSED);
    const good = fakeNet({ 'https://example.com/r': { redirect: '/next' }, 'https://example.com/next': { redirect: 'https://other.example/end', status: 301 }, 'https://other.example/end': { body: 'end' } }, dns);
    const res = await createPublicFetch(good)('https://example.com/r');
    expect(await res.text()).toBe('end');
    expect(good.requested).toEqual(['https://example.com/r', 'https://example.com/next', 'https://other.example/end']);
  });

  it('stops after too many redirects', async () => {
    const routes = {};
    for (let i = 0; i < 10; i++) routes['https://example.com/' + i] = { redirect: 'https://example.com/' + (i + 1) };
    await expect(createPublicFetch(fakeNet(routes, { 'example.com': ['93.184.216.34'] }))('https://example.com/0')).rejects.toThrow(/Too many redirects/);
  });

  it('says so when a name does not resolve, and refuses non-web schemes', async () => {
    await expect(createPublicFetch(fakeNet({}, {}))('https://nowhere.example/')).rejects.toThrow(/ERR_NAME_NOT_RESOLVED/);
    await expect(createPublicFetch(fakeNet({}, {}))('file:///C:/x')).rejects.toThrow(/Only http and https/);
  });
});

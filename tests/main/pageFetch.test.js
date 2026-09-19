// One page for the site crawler: HTML only, size-limited, redirects followed
// and reported, from the empty session.

import { describe, expect, it } from 'vitest';
const { EventEmitter } = require('events');
const { createPageFetch } = require('../../src/main/page-fetch.js');

// A stand-in for Electron's net.request. `script` decides what happens.
function fakeNet(script) {
  const made = [];
  const net = {
    request(opts) {
      const req = new EventEmitter();
      req.opts = opts; req.headers = {}; req.aborted = false; req.followed = 0;
      req.setHeader = (k, v) => { req.headers[k] = v; };
      req.abort = () => { req.aborted = true; };
      req.followRedirect = () => { req.followed++; script.onFollow && script.onFollow(req); };
      req.end = () => setImmediate(() => script.start(req));
      made.push(req);
      return req;
    },
  };
  return { net, made };
}
const respond = (req, status, headers, chunks = []) => {
  const res = new EventEmitter();
  res.statusCode = status; res.headers = headers;
  req.emit('response', res);
  for (const c of chunks) res.emit('data', Buffer.from(c));
  res.emit('end');
};

describe('fetching a page', () => {
  it('reads an HTML page from the given session without cookies', async () => {
    const { net, made } = fakeNet({ start: (req) => respond(req, 200, { 'content-type': ['text/html; charset=utf-8'] }, ['<title>A', '</title>']) });
    const f = createPageFetch({ net, getSession: () => 'SESSION' });
    const r = await f.fetchPage('https://example.com/a');
    expect(r).toMatchObject({ status: 200, finalUrl: 'https://example.com/a', text: '<title>A</title>', truncated: false, redirects: [] });
    expect(made[0].opts).toMatchObject({ session: 'SESSION', credentials: 'omit', useSessionCookies: false, redirect: 'manual' });
  });

  it('does not read anything that is not a page', async () => {
    const { net, made } = fakeNet({ start: (req) => respond(req, 200, { 'content-type': 'application/zip' }, ['PK']) });
    const r = await createPageFetch({ net, getSession: () => null }).fetchPage('https://example.com/big.zip');
    expect(r).toMatchObject({ status: 200, text: null });
    expect(made[0].aborted).toBe(true);
  });

  it('robots.txt may be any kind of text', async () => {
    const { net } = fakeNet({ start: (req) => respond(req, 200, { 'content-type': 'text/html' }, ['User-agent: *']) });
    const r = await createPageFetch({ net, getSession: () => null }).fetchPage('https://example.com/robots.txt', { accept: 'text/plain' });
    expect(r.text).toBe('User-agent: *');
  });

  it('stops reading at the size limit', async () => {
    const { net, made } = fakeNet({ start: (req) => respond(req, 200, { 'content-type': 'text/html' }, ['12345', '67890', 'abc']) });
    const r = await createPageFetch({ net, getSession: () => null, maxBytes: 7 }).fetchPage('https://example.com/');
    expect(r).toMatchObject({ text: '1234567', truncated: true });
    expect(made[0].aborted).toBe(true);
  });

  it('follows redirects hop by hop and says where it ended', async () => {
    const { net } = fakeNet({
      start: (req) => req.emit('redirect', 301, 'GET', 'https://example.com/b'),
      onFollow: (req) => (req.followed === 1 ? req.emit('redirect', 302, 'GET', 'https://example.com/c') : respond(req, 200, { 'content-type': 'text/html' }, ['ok'])),
    });
    const r = await createPageFetch({ net, getSession: () => null }).fetchPage('https://example.com/a');
    expect(r.finalUrl).toBe('https://example.com/c');
    expect(r.redirects).toEqual([{ status: 301, url: 'https://example.com/b' }, { status: 302, url: 'https://example.com/c' }]);
  });

  it('gives up on a redirect loop, and on a redirect off the web', async () => {
    const loop = fakeNet({ start: (req) => req.emit('redirect', 302, 'GET', 'https://example.com/x'), onFollow: (req) => req.emit('redirect', 302, 'GET', 'https://example.com/x') });
    await expect(createPageFetch({ net: loop.net, getSession: () => null }).fetchPage('https://example.com/x')).rejects.toThrow(/too many redirects/);
    const away = fakeNet({ start: (req) => req.emit('redirect', 302, 'GET', 'file:///C:/secret') });
    await expect(createPageFetch({ net: away.net, getSession: () => null }).fetchPage('https://example.com/')).rejects.toThrow(/away from the web/);
  });

  it('refuses anything but a web address', async () => {
    const { net } = fakeNet({ start: () => {} });
    const f = createPageFetch({ net, getSession: () => null });
    await expect(f.fetchPage('file:///C:/x')).rejects.toThrow(/Only web pages/);
    await expect(f.fetchPage('not a url')).rejects.toThrow(/Not a web address/);
  });

  it('has a deadline', async () => {
    const { net, made } = fakeNet({ start: () => {} });
    await expect(createPageFetch({ net, getSession: () => null, timeoutMs: 20 }).fetchPage('https://example.com/')).rejects.toThrow(/timeout/);
    expect(made[0].aborted).toBe(true);
  });
});

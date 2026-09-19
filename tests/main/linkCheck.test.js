// src/main/link-check.js — which links still answer, asked politely and
// anonymously.

import { describe, it, expect, vi } from 'vitest';
const { createLinkCheck, classify, MAX_LINKS } = require('../../src/main/link-check.js');

function server(table) {
  // table: url -> { HEAD?: status | Error, GET?: status | Error, to?: url (a 301 there) }
  const calls = [];
  const fetchIn = vi.fn(async (url, init) => {
    calls.push([init.method, url]);
    expect(init.redirect).toBe('manual');
    const entry = table[url] || { HEAD: 200 };
    const headers = { get: (h) => (h === 'location' && entry.to ? entry.to : null) };
    if (entry.to) return { status: 301, url, headers, body: { cancel: vi.fn(async () => {}) } };
    const outcome = entry[init.method] ?? entry.HEAD;
    if (outcome instanceof Error) throw outcome;
    return { status: outcome, url, headers, body: { cancel: vi.fn(async () => {}) } };
  });
  return { fetchIn, calls };
}

describe('what an answer means', () => {
  it('2xx and 3xx work; 404 and 410 are broken; 5xx is the site failing', () => {
    expect(classify(200)).toBe('ok');
    expect(classify(304)).toBe('ok');
    expect(classify(404)).toBe('broken');
    expect(classify(410)).toBe('broken');
    expect(classify(503)).toBe('error');
  });
  it('a login wall, a bot wall or a rate limit is not a dead link', () => {
    for (const s of [401, 403, 429, 999]) expect(classify(s), String(s)).toBe('blocked');
  });
  it('no answer in time is slow; a failed connection is broken', () => {
    expect(classify(0, 'timeout')).toBe('slow');
    expect(classify(0, 'net::ERR_NAME_NOT_RESOLVED')).toBe('broken');
  });
});

describe('checking', () => {
  it('asks with HEAD, so no page is downloaded', async () => {
    const { fetchIn, calls } = server({});
    const lc = createLinkCheck({ fetchIn });
    const r = await lc.check(['https://a.example/']);
    expect(calls).toEqual([['HEAD', 'https://a.example/']]);
    expect(r.results[0]).toMatchObject({ status: 200, verdict: 'ok', redirected: false });
  });

  it('retries with GET where a server refuses or misanswers HEAD, and never reads the body', async () => {
    const { fetchIn, calls } = server({ 'https://a.example/x': { HEAD: 405, GET: 200 } });
    const r = await createLinkCheck({ fetchIn }).one('https://a.example/x');
    expect(calls.map(c => c[0])).toEqual(['HEAD', 'GET']);
    expect(r.verdict).toBe('ok');
    const getResponse = await fetchIn.mock.results[1].value;
    expect(getResponse.body.cancel).toHaveBeenCalled();
  });

  it('a HEAD 404 is confirmed with GET before it is called broken', async () => {
    const { fetchIn } = server({ 'https://a.example/y': { HEAD: 404, GET: 200 } });
    expect((await createLinkCheck({ fetchIn }).one('https://a.example/y')).verdict).toBe('ok');
  });

  it('follows redirects itself, hop by hop, and reports where a link ends up', async () => {
    // Electron's session fetch followed redirects but reported the ORIGINAL
    // address as final, so a moved link looked untouched (seen live).
    const { fetchIn, calls } = server({
      'https://old.example/p': { to: '/q' },
      'https://old.example/q': { to: 'https://new.example/p' },
    });
    const r = await createLinkCheck({ fetchIn }).one('https://old.example/p');
    expect(r).toMatchObject({ status: 200, verdict: 'ok', redirected: true, finalUrl: 'https://new.example/p' });
    expect(calls.map(c => c[1])).toEqual(['https://old.example/p', 'https://old.example/q', 'https://new.example/p']);
  });

  it('a redirect loop is reported, not followed for ever', async () => {
    const { fetchIn } = server({ 'https://a.example/1': { to: 'https://a.example/2' }, 'https://a.example/2': { to: 'https://a.example/1' } });
    const r = await createLinkCheck({ fetchIn }).one('https://a.example/1');
    expect(r).toMatchObject({ verdict: 'broken', error: 'too many redirects' });
  });

  it('a redirect to somewhere that is not the web stops there', async () => {
    const { fetchIn } = server({ 'https://a.example/app': { to: 'myapp://open' } });
    const r = await createLinkCheck({ fetchIn }).one('https://a.example/app');
    expect(r).toMatchObject({ status: 301, redirected: false });
  });

  it('a connection failure is reported with its reason', async () => {
    const { fetchIn } = server({ 'https://gone.example/': { HEAD: new Error('net::ERR_NAME_NOT_RESOLVED') } });
    const r = await createLinkCheck({ fetchIn }).one('https://gone.example/');
    expect(r).toMatchObject({ status: 0, verdict: 'broken', error: 'net::ERR_NAME_NOT_RESOLVED' });
  });

  it('gives up on a site that never answers', async () => {
    const fetchIn = (_u, init) => new Promise((_res, rej) => init.signal.addEventListener('abort', () => rej(init.signal.reason)));
    const r = await createLinkCheck({ fetchIn, timeoutMs: 20 }).one('https://slow.example/');
    expect(r.verdict).toBe('slow');
  });

  it('only a few at a time — it must not hammer anyone', async () => {
    let live = 0, peak = 0;
    const fetchIn = async () => { live++; peak = Math.max(peak, live); await new Promise(r => setTimeout(r, 5)); live--; return { status: 200, url: '', headers: { get: () => null } }; };
    const urls = Array.from({ length: 30 }, (_, i) => 'https://s' + i + '.example/');
    const r = await createLinkCheck({ fetchIn, concurrency: 4 }).check(urls);
    expect(r.results).toHaveLength(30);
    expect(peak).toBeLessThanOrEqual(4);
  });

  it('keeps results in the order the links appear', async () => {
    const fetchIn = async (u) => { await new Promise(r => setTimeout(r, u.includes('slow') ? 15 : 1)); return { status: 200, url: u, headers: { get: () => null } }; };
    const r = await createLinkCheck({ fetchIn }).check(['https://slow.example/', 'https://fast.example/']);
    expect(r.results.map(x => x.url)).toEqual(['https://slow.example/', 'https://fast.example/']);
  });

  it('only http(s), no duplicates, and a ceiling', async () => {
    const { fetchIn, calls } = server({});
    const lc = createLinkCheck({ fetchIn });
    await lc.check(['https://a.example/', 'https://a.example/', 'javascript:alert(1)', 'file:///C:/x', 'mailto:a@b.c']);
    expect(calls).toHaveLength(1);
    const many = Array.from({ length: MAX_LINKS + 25 }, (_, i) => 'https://m' + i + '.example/');
    const r = await lc.check(many);
    expect(r.results).toHaveLength(MAX_LINKS);
    expect(r.skipped).toBe(25);
    await expect(lc.check(['mailto:x@y.z'])).rejects.toThrow(/no web links/);
  });
});

// Electron's session fetch could not report redirects (it either hid the
// final address or aborted with "Redirect was cancelled"). The adapter over
// net.request turns its 'redirect' event into a 3xx + Location.
describe('the net.request adapter', () => {
  const { netRequestFetch } = require('../../src/main/link-check.js');
  const { EventEmitter } = require('events');

  function fakeNet(behaviour) {
    const made = [];
    return {
      made,
      request(opts) {
        const req = new EventEmitter();
        req.headers = {};
        req.setHeader = (k, v) => { req.headers[k] = v; };
        req.abort = vi.fn();
        req.end = () => setTimeout(() => behaviour(req), 0);
        made.push({ opts, req });
        return req;
      },
    };
  }

  it('asks with no cookies, in the given session, and hands back a redirect as 3xx + Location', async () => {
    const net = fakeNet((req) => req.emit('redirect', 301, 'HEAD', 'https://new.example/'));
    const ses = { name: 'vex-linkcheck' };
    const r = await netRequestFetch(net, () => ses)('https://old.example/', { method: 'HEAD', headers: { Accept: 'text/html' } });
    expect(r.status).toBe(301);
    expect(r.headers.get('Location')).toBe('https://new.example/');
    expect(net.made[0].opts).toMatchObject({ method: 'HEAD', session: ses, redirect: 'manual', credentials: 'omit', useSessionCookies: false });
    expect(net.made[0].req.abort).toHaveBeenCalled();
  });

  it('reports a status and drops the request without reading the page', async () => {
    const net = fakeNet((req) => req.emit('response', { statusCode: 404, headers: { 'content-type': ['text/html'] } }));
    const r = await netRequestFetch(net, () => ({}))('https://a.example/x', { method: 'GET' });
    expect(r.status).toBe(404);
    expect(r.headers.get('Content-Type')).toBe('text/html');
    expect(net.made[0].req.abort).toHaveBeenCalled();
  });

  it('passes a network error through, and a deadline aborts the request', async () => {
    const failing = fakeNet((req) => req.emit('error', new Error('net::ERR_NAME_NOT_RESOLVED')));
    await expect(netRequestFetch(failing, () => ({}))('https://x.example/', {})).rejects.toThrow(/ERR_NAME_NOT_RESOLVED/);
    const hanging = fakeNet(() => {});
    const ctl = new AbortController();
    const p = netRequestFetch(hanging, () => ({}))('https://slow.example/', { signal: ctl.signal });
    ctl.abort(new Error('timeout'));
    await expect(p).rejects.toThrow(/timeout/);
    expect(hanging.made[0].req.abort).toHaveBeenCalled();
  });
});

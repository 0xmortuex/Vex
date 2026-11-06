// "Does this network want a sign-in?" (src/main/captive-portal.js).
//
// The classifier, the redirect chain and the request are driven against a local server that answers like each kind of
// portal. Electron's net.request is replaced by a stand-in built on node:http that fires the same events the real one
// does; that those events are what a portal's 302 / 511 / in-place page produce was measured in real Electron 42
// (2026-11-06): net.fetch with redirect:'manual' throws "Redirect was cancelled", net.request's 'redirect' event
// carries the Location.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import http from 'node:http';
import { EventEmitter } from 'node:events';

const portal = require('../../src/main/captive-portal.js');

function fakeNet() {
  return {
    request({ url }) {
      const em = new EventEmitter();
      em.abort = () => {};
      em.end = () => {
        const u = new URL(url);
        const r = http.request({ hostname: u.hostname, port: u.port, path: u.pathname + u.search }, (res) => {
          if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            res.resume();
            em.emit('redirect', res.statusCode, 'GET', res.headers.location, res.headers);
            return;
          }
          const wrap = new EventEmitter();
          wrap.statusCode = res.statusCode;
          wrap.headers = res.headers;
          res.on('data', d => wrap.emit('data', d));
          res.on('end', () => wrap.emit('end'));
          res.on('error', e => wrap.emit('error', e));
          em.emit('response', wrap);
        });
        r.on('error', e => em.emit('error', e));
        r.end();
      };
      return em;
    },
  };
}

let server; let port; let base; let closedPort;
beforeAll(async () => {
  server = http.createServer((req, res) => {
    const p = req.url;
    if (p === '/open') { res.writeHead(200, { 'content-type': 'text/plain' }); res.end('success\n'); }
    else if (p === '/redirect') { res.writeHead(302, { location: 'http://localhost:' + port + '/hop2' }); res.end(); }
    else if (p === '/hop2') { res.writeHead(302, { location: 'http://127.0.0.1:' + port + '/form' }); res.end(); }
    else if (p === '/form') { res.writeHead(200); res.end('<html>sign in</html>'); }
    else if (p === '/inplace') { res.writeHead(200, { 'content-type': 'text/html' }); res.end('<html>Please sign in to Guest Wi-Fi</html>'); }
    else if (p === '/511') { res.writeHead(511, { location: 'http://localhost:' + port + '/form' }); res.end('login first'); }
    else if (p === '/self-redirect') { res.writeHead(301, { location: 'http://127.0.0.1:' + port + '/open' }); res.end(); }
    else if (p === '/evil-redirect') { res.writeHead(302, { location: 'javascript:alert(1)' }); res.end(); }
    else if (p === '/slow') { /* never answers */ }
    else { res.writeHead(404); res.end('no'); }
  });
  await new Promise(r => server.listen(0, r));
  port = server.address().port;
  base = 'http://127.0.0.1:' + port;
  const spare = http.createServer();
  await new Promise(r => spare.listen(0, r));
  closedPort = spare.address().port;
  await new Promise(r => spare.close(r));
});
afterAll(() => new Promise(r => { server.closeAllConnections?.(); server.close(r); }));

describe('classify', () => {
  const probe = 'http://detectportal.firefox.com/canonical.html';
  it('an ordinary answer is an open network', () => {
    expect(portal.classify({ status: 200, headers: {}, body: 'success\n' }, probe).state).toBe('open');
  });
  it('a redirect to another site is a portal, and says where the sign-in is', () => {
    const r = portal.classify({ status: 302, headers: { location: 'http://login.wifi.example/start?x=1' }, body: '' }, probe);
    expect(r).toMatchObject({ state: 'portal', loginUrl: 'http://login.wifi.example/start?x=1' });
  });
  it('a relative Location is read against the probe address', () => {
    expect(portal.classify({ status: 302, headers: { location: '/login' }, body: '' }, probe).state).toBe('unknown'); // same host: not a portal
  });
  it('a page answered in place is a portal, at the probe address', () => {
    expect(portal.classify({ status: 200, headers: {}, body: '<html>Sign in</html>' }, probe)).toMatchObject({ state: 'portal', loginUrl: probe });
  });
  it('HTTP 511 is a portal', () => {
    expect(portal.classify({ status: 511, headers: {}, body: 'login' }, probe)).toMatchObject({ state: 'portal', loginUrl: probe });
  });
  it('the probe host upgrading itself to https is not a portal', () => {
    expect(portal.classify({ status: 301, headers: { location: 'https://detectportal.firefox.com/canonical.html' }, body: '' }, probe).state).toBe('unknown');
  });
  it('a 404, a 5xx, an empty 200 and nothing at all say nothing about a portal', () => {
    for (const status of [404, 500, 503]) expect(portal.classify({ status, headers: {}, body: '' }, probe).state).toBe('unknown');
    expect(portal.classify({ status: 200, headers: {}, body: '  ' }, probe).state).toBe('unknown');
    expect(portal.classify(null, probe).state).toBe('unknown');
    expect(portal.classify({ status: 'x' }, probe).state).toBe('unknown');
  });
  it('never offers an address that is not http(s), or has credentials, or is absurdly long', () => {
    for (const bad of ['javascript:alert(1)', 'file:///C:/Windows/win.ini', 'data:text/html,hi', 'http://user:pw@login.example/', 'http://login.example/' + 'a'.repeat(3000)]) {
      expect(portal.classify({ status: 302, headers: { location: bad }, body: '' }, probe).state, bad.slice(0, 40)).toBe('unknown');
    }
  });
});

describe('the request, against a local server that behaves like each kind of portal', () => {
  const request = portal.createRequest(fakeNet(), 300);

  it('an open network: 200 and "success"', async () => {
    const r = await portal.check(request, base + '/open');
    expect(r).toMatchObject({ state: 'open', status: 200 });
    expect(r.hosts).toBeUndefined();
  });

  it('a redirecting portal: the sign-in address and every host on the way are found', async () => {
    const r = await portal.check(request, base + '/redirect');
    expect(r.state).toBe('portal');
    expect(r.loginUrl).toBe('http://localhost:' + port + '/hop2');
    expect(r.hosts.sort()).toEqual(['127.0.0.1', 'localhost']);
  });

  it('a portal that answers in place', async () => {
    expect(await portal.check(request, base + '/inplace')).toMatchObject({ state: 'portal', loginUrl: base + '/inplace' });
  });

  it('an HTTP 511 portal', async () => {
    expect(await portal.check(request, base + '/511')).toMatchObject({ state: 'portal', status: 511 });
  });

  it('a site redirecting within itself is not a portal', async () => {
    expect((await portal.check(request, base + '/self-redirect')).state).toBe('unknown');
  });

  it('a redirect to a script address is refused, not followed or offered', async () => {
    const r = await portal.check(request, base + '/evil-redirect');
    expect(r.state).toBe('unknown');
    expect(r.loginUrl).toBeUndefined();
  });

  it('nothing answering in time is "offline", with the reason, and does not hang', async () => {
    const t = Date.now();
    const r = await portal.check(request, base + '/slow');
    expect(r.state).toBe('offline');
    expect(r.note).toContain('timed out');
    expect(Date.now() - t).toBeLessThan(3000);
  });

  it('a refused connection is "offline"', async () => {
    expect((await portal.check(request, 'http://127.0.0.1:' + closedPort + '/')).state).toBe('offline');
  });

  it('collects every host of a gateway -> vendor login -> form chain, so none of them is upgraded to https mid sign-in', async () => {
    // Three different hosts after the probe's own; a scripted request, so it does not depend on the machine's loopback aliases.
    const script = {
      'http://probe.example/': { status: 302, headers: { location: 'http://gateway.wifi.example/start' } },
      'http://gateway.wifi.example/start': { status: 302, headers: { location: 'http://login.vendor.example/auth?t=1' } },
      'http://login.vendor.example/auth?t=1': { status: 302, headers: { location: 'http://cdn.vendor.example/form' } },
      'http://cdn.vendor.example/form': { status: 200, headers: {}, body: '<html>sign in</html>' },
    };
    const seen = [];
    const r = await portal.check(async (url) => { seen.push(url); return { body: '', ...script[url] }; }, 'http://probe.example/');
    expect(r.state).toBe('portal');
    expect(r.loginUrl).toBe('http://gateway.wifi.example/start');   // what the tab opens: the first hop, the browser follows the rest
    expect(r.hosts).toEqual(['probe.example', 'gateway.wifi.example', 'login.vendor.example', 'cdn.vendor.example']);
    expect(seen).toHaveLength(4);
  });

  it('follows at most MAX_HOPS redirects and collects at most 4 hosts', async () => {
    let calls = 0;
    const loop = async (url) => { calls++; return { status: 302, headers: { location: 'http://h' + calls + '.example/x' }, body: '' }; };
    const r = await portal.check(loop, 'http://probe.example/');
    expect(r.state).toBe('portal');
    expect(calls).toBeLessThanOrEqual(1 + portal.MAX_HOPS);
    expect(r.hosts.length).toBeLessThanOrEqual(4);
  });
});

describe('what the window may ask main for', () => {
  it('allow-http takes a short list of host names and nothing else', () => {
    expect(portal.cleanHosts(['Detectportal.Firefox.com', 'www.login.wifi.example', '192.168.1.1'])).toEqual(['detectportal.firefox.com', 'login.wifi.example', '192.168.1.1']);
    expect(portal.cleanHosts(['a.example', 'a.example'])).toEqual(['a.example']);
    for (const bad of [[], 'a.example', null, ['a.example/path'], ['a b'], ['http://a.example'], ['a.example', 'b.example', 'c.example', 'd.example', 'e.example'], ['x'.repeat(300)], [''], [';rm']]) {
      expect(() => portal.cleanHosts(bad), JSON.stringify(bad).slice(0, 40)).toThrow(/captive/);
    }
  });
  it('the DNS pause is 1 to 15 whole minutes', () => {
    expect(portal.cleanPause(10)).toBe(10);
    expect(portal.cleanPause(1)).toBe(1);
    expect(portal.cleanPause(15)).toBe(15);
    for (const bad of [0, 16, -1, NaN, 'x', null, Infinity]) expect(() => portal.cleanPause(bad)).toThrow(/captive/);
  });
});

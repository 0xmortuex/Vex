// src/main/mcp-server.js: the front door of "Vex as an MCP server". Everything is driven with fake
// requests, a fake clock and a fake http module: no socket is opened and no real time is used.
import { describe, it, expect, vi } from 'vitest';
const { EventEmitter } = require('events');
const crypto = require('crypto');
const M = require('../../src/main/mcp-server.js');

const TOKEN = 'A'.repeat(43);
const PORT = 40123;

// ---- fakes ------------------------------------------------------------------------
function fakeHttp({ busyPorts = [] } = {}) {
  const made = [];
  return {
    made,
    createServer(handler) {
      const s = new EventEmitter();
      s.handler = handler;
      s.listen = (port, host) => {
        s.listenArgs = [port, host];
        setImmediate(() => {
          if (busyPorts.includes(port)) s.emit('error', Object.assign(new Error('in use'), { code: 'EADDRINUSE' }));
          else { s.port = port || PORT + made.indexOf(s); s.emit('listening'); }
        });
      };
      s.address = () => ({ port: s.port });
      s.close = (cb) => { s.closed = true; if (cb) cb(); };
      s.closeAllConnections = () => { s.killed = true; };
      made.push(s);
      return s;
    },
  };
}

function fakeReq({ method = 'POST', url = '/mcp', headers = {} } = {}) {
  const req = new EventEmitter();
  req.method = method; req.url = url; req.headers = headers; req.resumed = false;
  req.resume = () => { req.resumed = true; };
  return req;
}
function fakeRes() {
  const res = { status: null, headers: null, text: null };
  res.writeHead = (status, headers) => { res.status = status; res.headers = headers; };
  res.end = (text) => { res.text = text; };
  return res;
}
const goodHeaders = (over = {}) => ({ host: '127.0.0.1:' + PORT, authorization: 'Bearer ' + TOKEN, 'content-type': 'application/json', ...over });

async function setup({ handleTool, onRejected, getToken = () => TOKEN, now, allowedOrigins } = {}) {
  const http = fakeHttp();
  const calls = [];
  const server = M.createMcpServer({
    http, getToken,
    handleTool: handleTool || (async (name, args, ctx) => { calls.push({ name, args, ctx }); return { isError: false, text: JSON.stringify({ ok: name }) }; }),
    onRejected: onRejected || (() => {}),
    version: '9.9.9', now: now || (() => 1000), allowedOrigins: allowedOrigins ? () => allowedOrigins : undefined,
  });
  // The fake picks PORT for the first server.
  await server.start();
  const send = async ({ body, headers, method, url, raw } = {}) => {
    const req = fakeReq({ method, url, headers: headers || goodHeaders() });
    const res = fakeRes();
    const p = server.handler(req, res);
    const text = raw !== undefined ? raw : (body === undefined ? undefined : JSON.stringify(body));
    if (text !== undefined) req.emit('data', Buffer.from(text));
    req.emit('end');
    await p;
    let json = null;
    try { json = res.text ? JSON.parse(res.text) : null; } catch { json = null; }
    return { status: res.status, headers: res.headers, json, text: res.text, req };
  };
  const rpc = (method, params, id = 1) => ({ jsonrpc: '2.0', id, method, ...(params ? { params } : {}) });
  return { server, http, calls, send, rpc };
}

// ---- token ----------------------------------------------------------------------
describe('the access token', () => {
  it.each([
    ['Bearer ' + TOKEN, TOKEN, true],
    [undefined, TOKEN, false],
    ['', TOKEN, false],
    ['Bearer ', TOKEN, false],
    ['Bearer ' + 'B'.repeat(43), TOKEN, false],
    ['Bearer ' + TOKEN + 'x', TOKEN, false],
    ['bearer ' + TOKEN, TOKEN, false],
    ['Basic ' + TOKEN, TOKEN, false],
    ['Bearer  ' + TOKEN, TOKEN, false],
    [TOKEN, TOKEN, false],
    ['Bearer short', 'short', false],
    ['Bearer ' + TOKEN, null, false],
    ['Bearer ' + TOKEN, '', false],
  ])('%j against %j -> %s', (header, expected, answer) => { expect(M.tokenOk(header, expected)).toBe(answer); });

  it('compares through crypto.timingSafeEqual on equal-length digests', () => {
    const spy = vi.spyOn(crypto, 'timingSafeEqual');
    expect(M.constantTimeEqual('abc', 'abc')).toBe(true);
    expect(M.constantTimeEqual('abc', 'abcd')).toBe(false);
    expect(M.constantTimeEqual('', 'x')).toBe(false);
    expect(spy).toHaveBeenCalledTimes(3);
    for (const call of spy.mock.calls) expect(call[0].length).toBe(call[1].length);
    spy.mockRestore();
  });
});

// ---- Host and Origin ----------------------------------------------------------------
describe('the Host header (DNS rebinding)', () => {
  it.each([
    ['127.0.0.1:40123', true],
    ['localhost:40123', true],
    ['LocalHost:40123', true],
    ['evil.com', false],
    ['evil.com:40123', false],
    ['127.0.0.1.evil.com', false],
    ['127.0.0.1.evil.com:40123', false],
    ['localhost.evil.com:40123', false],
    ['127.0.0.1:40123.evil.com', false],
    ['127.0.0.1:40123@evil.com', false],
    ['evil.com@127.0.0.1:40123', false],
    ['127.0.0.1', false],
    ['localhost', false],
    ['127.0.0.1:40124', false],
    ['0.0.0.0:40123', false],
    ['[::1]:40123', false],
    ['127.0.0.2:40123', false],
    ['', false],
    [undefined, false],
    [null, false],
    [['127.0.0.1:40123'], false],
  ])('%j -> %s', (host, answer) => { expect(M.hostHeaderOk(host, PORT)).toBe(answer); });

  it('is false whenever the port is not a real port', () => {
    expect(M.hostHeaderOk('127.0.0.1:0', 0)).toBe(false);
    expect(M.hostHeaderOk('127.0.0.1:undefined', undefined)).toBe(false);
  });
});

describe('the Origin header (browser-originated requests)', () => {
  it('a request with no Origin and no fetch metadata (a program) is fine', () => {
    expect(M.originOk({ host: 'x' }, [])).toBe(true);
  });
  it.each(['https://evil.com', 'http://127.0.0.1:40123', 'http://localhost:40123', 'null', '', 'https://evil.com:40123'])('Origin %j is refused when nothing is allow-listed', (origin) => {
    expect(M.originOk({ origin }, [])).toBe(false);
  });
  it('an exact allow-listed origin passes; a near miss does not', () => {
    expect(M.originOk({ origin: 'https://claude.example' }, ['https://claude.example'])).toBe(true);
    expect(M.originOk({ origin: 'https://claude.example.evil.com' }, ['https://claude.example'])).toBe(false);
    expect(M.originOk({ origin: 'https://claude.example/' }, ['https://claude.example'])).toBe(false);
  });
  it('fetch-metadata headers mean a browser sent it, even without an Origin', () => {
    expect(M.originOk({ 'sec-fetch-site': 'cross-site' }, [])).toBe(false);
    expect(M.originOk({ 'sec-fetch-mode': 'no-cors' }, [])).toBe(false);
    expect(M.originOk({ 'sec-fetch-dest': 'empty' }, [])).toBe(false);
  });
});

// ---- rate limiter ---------------------------------------------------------------------
describe('the rate limiter (fake clock)', () => {
  it('lets `limit` through in a window, then says how long to wait, then lets more through', () => {
    let t = 1000;
    const r = M.createRateLimiter({ now: () => t, limit: 3, windowMs: 60000 });
    expect(r.take().ok).toBe(true); t += 10;
    expect(r.take().ok).toBe(true); t += 10;
    expect(r.take().ok).toBe(true); t += 10;
    const denied = r.take();
    expect(denied.ok).toBe(false);
    expect(denied.retryAfterMs).toBe(1000 + 60000 - t);
    t = 1000 + 60000;                       // the first hit has just left the window
    expect(r.take().ok).toBe(true);
    expect(r.take().ok).toBe(false);
  });
  it('full() looks without counting; add() counts without asking', () => {
    const r = M.createRateLimiter({ now: () => 5, limit: 2 });
    expect(r.full()).toBe(false);
    r.add(); r.add();
    expect(r.full()).toBe(true);
    expect(r.take().ok).toBe(false);
  });
});

// ---- the listener ----------------------------------------------------------------------
describe('the listener', () => {
  it('listens on 127.0.0.1 only, never 0.0.0.0, on a port the system picks', async () => {
    const { server, http } = await setup();
    expect(http.made).toHaveLength(1);
    expect(http.made[0].listenArgs).toEqual([0, '127.0.0.1']);
    expect(server.status()).toEqual({ running: true, port: PORT });
    expect(JSON.stringify(http.made.map(s => s.listenArgs))).not.toContain('0.0.0.0');
  });
  it('tries the port used last time first, and falls back to a free one when it is taken', async () => {
    const http = fakeHttp({ busyPorts: [50000] });
    const s = M.createMcpServer({ http, getToken: () => TOKEN, handleTool: async () => ({ text: '' }) });
    const port = await s.start({ preferredPort: 50000 });
    expect(http.made.map(x => x.listenArgs)).toEqual([[50000, '127.0.0.1'], [0, '127.0.0.1']]);
    expect(port).toBe(PORT + 1);
  });
  it('a preferred port below 1024 is ignored', async () => {
    const http = fakeHttp();
    const s = M.createMcpServer({ http, getToken: () => TOKEN, handleTool: async () => ({ text: '' }) });
    await s.start({ preferredPort: 80 });
    expect(http.made.map(x => x.listenArgs)).toEqual([[0, '127.0.0.1']]);
  });
  it('sets connection and time limits on the server', async () => {
    const { http } = await setup();
    const s = http.made[0];
    expect(s.maxConnections).toBe(M.MAX_CONNECTIONS);
    expect(s.requestTimeout).toBeGreaterThan(0);
    expect(s.headersTimeout).toBeGreaterThan(0);
  });
  it('stop closes the server and every connection, and the port is no longer answered for', async () => {
    const { server, http } = await setup();
    expect(await server.stop()).toBe(true);
    expect(http.made[0].closed).toBe(true);
    expect(http.made[0].killed).toBe(true);
    expect(server.status()).toEqual({ running: false, port: 0 });
    expect(await server.stop()).toBe(false);
  });
  it('a second start while running does not open a second listener', async () => {
    const { server, http } = await setup();
    await server.start();
    expect(http.made).toHaveLength(1);
  });
});

// ---- the request handler ---------------------------------------------------------------
describe('the request handler: refusals come before anything else', () => {
  it('a wrong or missing Host is 421 and the token is never even read (DNS rebinding)', async () => {
    const getToken = vi.fn(() => TOKEN);
    const { send, calls } = await setup({ getToken });
    for (const host of ['evil.com', '127.0.0.1.evil.com', 'evil.com:' + PORT, undefined]) {
      const headers = goodHeaders(); if (host === undefined) delete headers.host; else headers.host = host;
      const r = await send({ headers, body: { jsonrpc: '2.0', id: 1, method: 'ping' } });
      expect(r.status, String(host)).toBe(421);
    }
    expect(getToken).not.toHaveBeenCalled();
    expect(calls).toHaveLength(0);
  });

  it('a request that carries an Origin is 403 even with the right token and Host', async () => {
    const { send } = await setup();
    const r = await send({ headers: goodHeaders({ origin: 'https://evil.com' }), body: { jsonrpc: '2.0', id: 1, method: 'ping' } });
    expect(r.status).toBe(403);
    expect(r.headers['Access-Control-Allow-Origin']).toBeUndefined();
  });

  it('an allow-listed origin passes the Origin check (and still needs the token)', async () => {
    const { send } = await setup({ allowedOrigins: ['https://claude.example'] });
    const ok = await send({ headers: goodHeaders({ origin: 'https://claude.example' }), body: { jsonrpc: '2.0', id: 1, method: 'ping' } });
    expect(ok.status).toBe(200);
    const noToken = goodHeaders({ origin: 'https://claude.example' }); delete noToken.authorization;
    expect((await send({ headers: noToken, body: { jsonrpc: '2.0', id: 1, method: 'ping' } })).status).toBe(401);
  });

  it('only POST (and DELETE for a session) on exactly /mcp; no CORS headers are ever sent', async () => {
    const { send } = await setup();
    for (const method of ['GET', 'PUT', 'OPTIONS', 'PATCH', 'HEAD']) expect((await send({ method })).status, method).toBe(405);
    for (const url of ['/', '/mcp/', '/mcp?x=1', '/MCP', '/mcp/../mcp', 'http://127.0.0.1:' + PORT + '/mcp']) expect((await send({ url })).status, url).toBe(404);
    const r = await send({ body: { jsonrpc: '2.0', id: 1, method: 'ping' } });
    expect(Object.keys(r.headers).some(k => k.toLowerCase().startsWith('access-control'))).toBe(false);
    expect(r.headers['Cache-Control']).toBe('no-store');
  });

  it('a missing, malformed or wrong token is 401 with a Bearer challenge', async () => {
    const { send, calls } = await setup();
    const body = { jsonrpc: '2.0', id: 1, method: 'ping' };
    for (const authorization of [undefined, '', 'Bearer', 'Bearer nope', 'Bearer ' + 'B'.repeat(43), 'Basic ' + TOKEN]) {
      const headers = goodHeaders(); if (authorization === undefined) delete headers.authorization; else headers.authorization = authorization;
      const r = await send({ headers, body });
      expect(r.status, String(authorization)).toBe(401);
      expect(r.headers['WWW-Authenticate']).toBe('Bearer');
    }
    expect(calls).toHaveLength(0);
  });

  it('with no token set at all, nothing is accepted', async () => {
    const { send } = await setup({ getToken: () => null });
    expect((await send({ body: { jsonrpc: '2.0', id: 1, method: 'ping' } })).status).toBe(401);
  });

  it('ten failed attempts in a minute lock everyone out (429) until the minute is over', async () => {
    let t = 1000;
    const { send } = await setup({ now: () => t });
    const bad = goodHeaders({ authorization: 'Bearer ' + 'B'.repeat(43) });
    for (let i = 0; i < M.BAD_AUTH_PER_MINUTE; i++) expect((await send({ headers: bad, body: {} })).status).toBe(401);
    const locked = await send({ body: { jsonrpc: '2.0', id: 1, method: 'ping' } });
    expect(locked.status).toBe(429);
    expect(locked.headers['Retry-After']).toBe('60');
    t += 61000;
    expect((await send({ body: { jsonrpc: '2.0', id: 1, method: 'ping' } })).status).toBe(200);
  });

  it('more than 60 requests in a minute get 429, and the limit lifts as the window moves', async () => {
    let t = 1000;
    const { send } = await setup({ now: () => t });
    const body = { jsonrpc: '2.0', id: 1, method: 'ping' };
    for (let i = 0; i < M.RATE_PER_MINUTE; i++) { t += 10; expect((await send({ body })).status).toBe(200); }
    const over = await send({ body });
    expect(over.status).toBe(429);
    expect(Number(over.headers['Retry-After'])).toBeGreaterThan(0);
    t += 61000;
    expect((await send({ body })).status).toBe(200);
  });

  it('only application/json is read', async () => {
    const { send } = await setup();
    expect((await send({ headers: goodHeaders({ 'content-type': 'text/plain' }), raw: '{}' })).status).toBe(415);
    expect((await send({ headers: goodHeaders({ 'content-type': 'application/json; charset=utf-8' }), body: { jsonrpc: '2.0', id: 1, method: 'ping' } })).status).toBe(200);
  });

  it('a body over 64 KiB is 413, whether it says so up front or just keeps coming', async () => {
    const { send, calls } = await setup();
    const declared = await send({ headers: goodHeaders({ 'content-length': String(M.MAX_BODY + 1) }), raw: '{}' });
    expect(declared.status).toBe(413);
    const streamed = await send({ raw: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'list_tabs', pad: 'x'.repeat(M.MAX_BODY) } }) });
    expect(streamed.status).toBe(413);
    expect(calls).toHaveLength(0);
  });

  it('bad JSON is a parse error; a batch is refused', async () => {
    const { send } = await setup();
    const bad = await send({ raw: '{nope' });
    expect(bad.status).toBe(400);
    expect(bad.json.error.code).toBe(-32700);
    const batch = await send({ body: [{ jsonrpc: '2.0', id: 1, method: 'ping' }] });
    expect(batch.status).toBe(400);
    expect(batch.json.error.code).toBe(-32600);
  });

  it('a server error never shows its cause', async () => {
    const { send } = await setup({ getToken: () => { throw new Error('secret internals'); } });
    const r = await send({ body: { jsonrpc: '2.0', id: 1, method: 'ping' } });
    expect(r.status).toBe(500);
    expect(r.text).not.toContain('secret internals');
  });
});

describe('the protocol', () => {
  it('initialize answers with the version asked (if known), the tools capability, and a session id', async () => {
    const { send, rpc } = await setup();
    const r = await send({ body: rpc('initialize', { protocolVersion: '2025-03-26', clientInfo: { name: 'Claude', version: '1' }, capabilities: {} }) });
    expect(r.status).toBe(200);
    expect(r.json.result.protocolVersion).toBe('2025-03-26');
    expect(r.json.result.capabilities).toEqual({ tools: { listChanged: false } });
    expect(r.json.result.serverInfo).toEqual({ name: 'vex', version: '9.9.9' });
    expect(r.headers['Mcp-Session-Id']).toMatch(/^[0-9a-f]{32}$/);
    const unknown = await send({ body: rpc('initialize', { protocolVersion: '1999-01-01' }) });
    expect(unknown.json.result.protocolVersion).toBe(M.PROTOCOL_VERSIONS[0]);
  });

  it('a notification is accepted with no body; ping answers {}', async () => {
    const { send } = await setup();
    const n = await send({ body: { jsonrpc: '2.0', method: 'notifications/initialized' } });
    expect(n.status).toBe(202);
    expect(n.text).toBe('');
    const p = await send({ body: { jsonrpc: '2.0', id: 7, method: 'ping' } });
    expect(p.json).toEqual({ jsonrpc: '2.0', id: 7, result: {} });
  });

  it('tools/list names exactly the four tools; none can type, click or read secrets', async () => {
    const { send, rpc } = await setup();
    const r = await send({ body: rpc('tools/list') });
    expect(r.json.result.tools.map(t => t.name)).toEqual(['list_tabs', 'read_page_text', 'open_url', 'search_history']);
    for (const t of r.json.result.tools) expect(t.inputSchema.additionalProperties).toBe(false);
    expect(r.json.result.tools.find(t => t.name === 'open_url').annotations.readOnlyHint).toBe(false);
  });

  it('an unknown method, a bad id and bad params are JSON-RPC errors', async () => {
    const { send } = await setup();
    expect((await send({ body: { jsonrpc: '2.0', id: 1, method: 'resources/list' } })).json.error.code).toBe(-32601);
    expect((await send({ body: { jsonrpc: '2.0', id: null, method: 'ping' } })).status).toBe(400);
    expect((await send({ body: { jsonrpc: '2.0', id: {}, method: 'ping' } })).status).toBe(400);
    expect((await send({ body: { jsonrpc: '1.0', id: 1, method: 'ping' } })).status).toBe(400);
    expect((await send({ body: { jsonrpc: '2.0', id: 1, method: 'ping', params: [1] } })).json.error.code).toBe(-32602);
  });

  it('sessions: a session id Vex did not issue is 404; DELETE ends one', async () => {
    const { send, rpc } = await setup();
    const init = await send({ body: rpc('initialize', { clientInfo: { name: 'Claude' } }) });
    const sid = init.headers['Mcp-Session-Id'];
    expect((await send({ headers: goodHeaders({ 'mcp-session-id': sid }), body: rpc('ping') })).status).toBe(200);
    expect((await send({ headers: goodHeaders({ 'mcp-session-id': 'f'.repeat(32) }), body: rpc('ping') })).status).toBe(404);
    expect((await send({ headers: goodHeaders({ 'mcp-session-id': 'not hex' }), body: rpc('ping') })).status).toBe(404);
    expect((await send({ method: 'DELETE', headers: goodHeaders({ 'mcp-session-id': sid }) })).status).toBe(200);
    expect((await send({ headers: goodHeaders({ 'mcp-session-id': sid }), body: rpc('ping') })).status).toBe(404);
  });

  it('only 16 sessions are kept; the oldest goes first', async () => {
    const { send, rpc, server } = await setup();
    for (let i = 0; i < M.MAX_SESSIONS + 4; i++) await send({ body: rpc('initialize', { clientInfo: { name: 'c' + i } }, i + 1) });
    expect(server.dispatcher.sessionCount()).toBe(M.MAX_SESSIONS);
  });
});

describe('tools/call: strict input checks before anything runs', () => {
  it('a valid call reaches the tool with the checked arguments and the client name from its session', async () => {
    const { send, rpc, calls } = await setup();
    const init = await send({ body: rpc('initialize', { clientInfo: { name: 'Claude Desktop' } }) });
    const headers = goodHeaders({ 'mcp-session-id': init.headers['Mcp-Session-Id'] });
    const r = await send({ headers, body: rpc('tools/call', { name: 'read_page_text', arguments: { maxChars: 500 } }, 2) });
    expect(r.status).toBe(200);
    expect(r.json.result).toEqual({ content: [{ type: 'text', text: '{"ok":"read_page_text"}' }], isError: false });
    expect(calls).toHaveLength(1);
    expect(calls[0].name).toBe('read_page_text');
    expect(calls[0].args).toEqual({ tabId: null, maxChars: 500 });
    expect(calls[0].ctx.client).toBe('Claude Desktop');
  });

  it('defaults are filled in by the check, not by the client', async () => {
    const { send, rpc, calls } = await setup();
    await send({ body: rpc('tools/call', { name: 'search_history', arguments: { query: '  cats  ' } }) });
    expect(calls[0].args).toEqual({ query: 'cats', limit: 10 });
    await send({ body: rpc('tools/call', { name: 'list_tabs' }) });
    expect(calls[1].args).toEqual({});
  });

  it.each([
    ['an unknown tool', { name: 'type_text', arguments: { text: 'x' } }],
    ['a tool that reads cookies', { name: 'read_cookies', arguments: {} }],
    ['a prototype name', { name: 'constructor', arguments: {} }],
    ['a prototype name 2', { name: '__proto__', arguments: {} }],
    ['no name', { arguments: {} }],
    ['a name that is not a string', { name: 5 }],
    ['arguments that are not an object', { name: 'list_tabs', arguments: [] }],
    ['arguments for a tool that takes none', { name: 'list_tabs', arguments: { x: 1 } }],
    ['an extra argument', { name: 'read_page_text', arguments: { maxChars: 500, evil: true } }],
    ['maxChars too small', { name: 'read_page_text', arguments: { maxChars: 10 } }],
    ['maxChars too large', { name: 'read_page_text', arguments: { maxChars: 20001 } }],
    ['maxChars as text', { name: 'read_page_text', arguments: { maxChars: '500' } }],
    ['tabId zero', { name: 'read_page_text', arguments: { tabId: 0 } }],
    ['tabId as text', { name: 'read_page_text', arguments: { tabId: '1' } }],
    ['no url', { name: 'open_url', arguments: {} }],
    ['an empty url', { name: 'open_url', arguments: { url: '' } }],
    ['a url that is not one', { name: 'open_url', arguments: { url: 'not a url' } }],
    ['a file url', { name: 'open_url', arguments: { url: 'file:///C:/Windows/win.ini' } }],
    ['a javascript url', { name: 'open_url', arguments: { url: 'javascript:alert(1)' } }],
    ['a data url', { name: 'open_url', arguments: { url: 'data:text/html,<script>1</script>' } }],
    ['an address on this computer', { name: 'open_url', arguments: { url: 'http://127.0.0.1:8080/' } }],
    ['localhost', { name: 'open_url', arguments: { url: 'http://localhost/admin' } }],
    ['the router', { name: 'open_url', arguments: { url: 'http://192.168.1.1/' } }],
    ['a single-label name', { name: 'open_url', arguments: { url: 'http://intranet/' } }],
    ['credentials in the url', { name: 'open_url', arguments: { url: 'https://user:pw@example.com/' } }],
    ['a url over 2048 characters', { name: 'open_url', arguments: { url: 'https://example.com/' + 'a'.repeat(2050) } }],
    ['an empty query', { name: 'search_history', arguments: { query: '   ' } }],
    ['a query over 200 characters', { name: 'search_history', arguments: { query: 'q'.repeat(201) } }],
    ['limit 0', { name: 'search_history', arguments: { query: 'x', limit: 0 } }],
    ['limit 26', { name: 'search_history', arguments: { query: 'x', limit: 26 } }],
    ['limit 1.5', { name: 'search_history', arguments: { query: 'x', limit: 1.5 } }],
  ])('refuses %s with -32602 and never runs a tool', async (_label, params) => {
    const rejected = [];
    const { send, rpc, calls } = await setup({ onRejected: (r) => rejected.push(r) });
    const r = await send({ body: rpc('tools/call', params) });
    expect(r.json.error.code).toBe(-32602);
    expect(calls).toHaveLength(0);
    // The refusal is reported for the audit log with a code, never the text that was sent.
    expect(rejected.length).toBeLessThanOrEqual(1);
    for (const x of rejected) { expect(x.result).toBe('invalid'); expect(/^[a-z][a-z0-9_]*$/.test(x.tool)).toBe(true); }
  });

  it('an https address is normalised and passed on', async () => {
    const { send, rpc, calls } = await setup();
    await send({ body: rpc('tools/call', { name: 'open_url', arguments: { url: 'https://Example.com/a b?x=1' } }) });
    expect(calls[0].args.url).toBe('https://example.com/a%20b?x=1');
  });

  it('a tool that throws gives an error result without the cause', async () => {
    const { send, rpc } = await setup({ handleTool: async () => { throw new Error('boom: C:\\secret\\path'); } });
    const r = await send({ body: rpc('tools/call', { name: 'list_tabs' }) });
    expect(r.json.result.isError).toBe(true);
    expect(r.text).not.toContain('boom');
    expect(r.text).not.toContain('secret');
  });

  it('a very long answer is cut', async () => {
    const { send, rpc } = await setup({ handleTool: async () => ({ isError: false, text: 'x'.repeat(M.MAX_RESPONSE_TEXT * 2) }) });
    const r = await send({ body: rpc('tools/call', { name: 'list_tabs' }) });
    expect(r.json.result.content[0].text.length).toBe(M.MAX_RESPONSE_TEXT);
  });
});

describe('the call deadline (fake timer)', () => {
  it('a tool that never answers is cut off, and is told it is stale so it cannot act later', async () => {
    let fire;
    let stale;
    const dispatcher = M.createDispatcher({
      handleTool: (name, args, ctx) => new Promise(() => { stale = ctx.isStale; }),
      callTimeoutMs: 5000,
      setTimer: (fn, ms) => { expect(ms).toBe(5000); fire = fn; return 1; },
      clearTimer: () => {},
    });
    const pending = dispatcher.dispatch({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'list_tabs' } });
    await Promise.resolve();
    expect(stale()).toBe(false);
    fire();
    const out = await pending;
    expect(stale()).toBe(true);
    expect(out.response.result.isError).toBe(true);
    expect(out.response.result.content[0].text).toMatch(/Nothing was done/);
  });
});

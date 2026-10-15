// An in-process stand-in for the co-op timer relay, for tests ONLY.
//
// It runs workers/coop-timer/worker.js against in-memory fakes of the two
// Durable Object namespaces and (optionally) puts a Node http server on
// 127.0.0.1 in front of it, so the Vex client can be driven through real fetch
// calls with no Cloudflare and no outside network.

import http from 'node:http';

export function fakeStorage() {
  const m = new Map();
  let alarm = null;
  return {
    async get(k) { return m.has(k) ? structuredClone(m.get(k)) : undefined; },
    async put(k, v) { m.set(k, structuredClone(v)); },
    async deleteAll() { m.clear(); alarm = null; },
    async setAlarm(t) { alarm = t; },
    async getAlarm() { return alarm; },
    _map: m,
  };
}

export function fakeNamespace(Cls) {
  const objs = new Map();
  return {
    objs,
    idFromName: (n) => n,
    get(id) {
      return {
        async fetch(url, init) {
          if (!objs.has(id)) objs.set(id, new Cls({ storage: fakeStorage() }, {}));
          return objs.get(id).fetch(new Request(url, init));
        },
      };
    },
  };
}

export async function makeEnv(extra = {}) {
  const { CoopRoom, CoopGate } = await import('../../workers/coop-timer/worker.js');
  return { ALLOWED_ORIGINS: 'null', COOP_ROOMS: fakeNamespace(CoopRoom), COOP_GATE: fakeNamespace(CoopGate), ...extra };
}

// Returns { url, env, close, requests } — `requests` records method + path
// (never bodies) so a test can assert what a client did and did not send.
export async function startCoopRelay(extraEnv = {}) {
  const { handle } = await import('../../workers/coop-timer/worker.js');
  const env = await makeEnv(extraEnv);
  const requests = [];
  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const body = Buffer.concat(chunks);
    requests.push({ method: req.method, path: req.url, bodyBytes: body.length, body: body.toString('utf8'), headers: { ...req.headers } });
    const headers = new Headers();
    for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string' && k !== 'host') headers.set(k, v);
    headers.set('CF-Connecting-IP', '127.0.0.1');
    const init = { method: req.method, headers };
    if (!['GET', 'HEAD'].includes(req.method)) init.body = body;
    const out = await handle(new Request('http://relay.test' + req.url, init), env);
    res.writeHead(out.status, Object.fromEntries(out.headers));
    res.end(Buffer.from(await out.arrayBuffer()));
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const url = 'http://127.0.0.1:' + server.address().port;
  return { url, env, requests, close: () => new Promise(r => server.close(r)) };
}

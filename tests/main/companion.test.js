// The phone-browser companion, end to end on this computer only: the desktop
// module (src/main/companion.js), the relay worker source (workers/companion/
// worker.js) behind a plain Node http server with an in-memory KV, and the
// static page's logic (companion/app.js). No Cloudflare, no real address.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import http from 'node:http';
import crypto from 'node:crypto';
import { JSDOM } from 'jsdom';

const companionModule = require('../../src/main/companion.js');
const page = require('../../companion/app.js');
let relay;

// An in-memory KV with expirationTtl on a clock the tests move.
function memoryKv(clock) {
  const map = new Map();
  return {
    map,
    async get(key) { const e = map.get(key); if (!e) return null; if (e.expires && clock.now >= e.expires) { map.delete(key); return null; } return e.value; },
    async put(key, value, opts = {}) { map.set(key, { value, expires: opts.expirationTtl ? clock.now + opts.expirationTtl * 1000 : 0 }); },
    async delete(key) { map.delete(key); },
  };
}
async function startRelay(clock) {
  relay = await import('../../workers/companion/worker.js');
  const env = { COMPANION_KV: memoryKv(clock) };
  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const body = Buffer.concat(chunks);
    const r = await relay.handle(new Request('http://relay.local' + req.url, { method: req.method, headers: { ...req.headers, 'cf-connecting-ip': '203.0.113.9' }, body: ['GET', 'HEAD'].includes(req.method) ? undefined : body }), env, clock.now);
    res.writeHead(r.status, Object.fromEntries(r.headers));
    res.end(Buffer.from(await r.arrayBuffer()));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return { server, env, url: 'http://127.0.0.1:' + server.address().port };
}

const view = {
  devices: [
    { deviceId: 'a'.repeat(32), name: 'Desk PC', kind: 'computer', self: true, lastSeen: 1000, lastActive: 900, tabs: [
      { url: 'https://news.test/a', title: 'News', favicon: 'https://news.test/f.ico', group: 'Read', pinned: true, lastActive: 900 },
      { url: 'https://mail.google.com/mail', title: 'Mail' },
      { url: 'javascript:alert(1)', title: 'x' },
      { url: 'https://x.test/?token=abc', title: 'x' },
    ] },
    { deviceId: 'b'.repeat(32), name: 'Pixel 9', kind: 'phone', self: false, lastSeen: 500, lastActive: 400, tabs: [{ url: 'https://p.test/', title: 'Phone' }] },
  ],
  readingQueue: [{ url: 'https://blog.test/1', title: 'Later' }, { url: 'https://paypal.com/x', title: 'Pay' }],
};

let clock, local;
beforeEach(async () => { clock = { now: Date.UTC(2026, 9, 16, 12, 0, 0) }; local = await startRelay(clock); });
afterEach(async () => { await new Promise(r => local.server.close(r)); vi.restoreAllMocks(); });

describe('pairing code and keys', () => {
  it('is 12 Crockford characters, typed forgivingly', () => {
    const code = companionModule.generateCode();
    expect(code).toMatch(/^[0-9A-HJKMNP-TV-Z]{12}$/);
    expect(companionModule.formatCode(code)).toMatch(/^[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}$/);
    expect(companionModule.normalizeCode(' abcd-efgh-jkmn ')).toBe('ABCDEFGHJKMN');
    expect(companionModule.normalizeCode('0O1IL')).toBe('00111');
  });

  it('the desktop and the page derive the same lookup and key, and the page opens what the desktop sealed', async () => {
    const code = 'ABCD-EFGH-JKMN';
    const main = companionModule.deriveKeys(code);
    const web = await page.deriveKeys(code);
    expect(web.lookup).toBe(main.lookup);
    const blob = companionModule.seal(main.key, { v: 1, hello: 'phone' });
    expect(await page.open(blob, web.key)).toEqual({ v: 1, hello: 'phone' });
    // A sync-protocol blob (no AAD) or another key does not open.
    const other = companionModule.deriveKeys('ZZZZ-ZZZZ-ZZZZ');
    await expect(page.open(companionModule.seal(other.key, { v: 1 }), web.key)).rejects.toThrow();
  });
});

describe('what the desktop publishes', () => {
  it('re-checks every address, whatever the window sent', () => {
    const clean = companionModule.cleanSnapshot(view, 5);
    expect(clean.devices[0].tabs.map(t => t.url)).toEqual(['https://news.test/a']);
    expect(clean.devices[0].tabCount).toBe(1);
    expect(clean.readingQueue.map(i => i.url)).toEqual(['https://blog.test/1']);
    expect(() => companionModule.cleanSnapshot({ devices: 'x' }, 5)).toThrow();
    const huge = { devices: [{ deviceId: 'a', name: 'n', tabs: Array.from({ length: 100 }, (_, i) => ({ url: 'https://h' + i + '.test/' + 'p'.repeat(1900), title: 't'.repeat(300) })) }, ...Array.from({ length: 5 }, () => ({ deviceId: 'b', name: 'n', tabs: Array.from({ length: 100 }, (_, i) => ({ url: 'https://h' + i + '.test/' + 'p'.repeat(1900), title: 't' })) }))] };
    expect(() => companionModule.cleanSnapshot(huge, 5)).toThrow(/too large/);
  });

  it('talks only to https relays, or one on this computer', () => {
    expect(companionModule.relayBase('https://r.example.workers.dev/')).toBe('https://r.example.workers.dev');
    expect(companionModule.relayBase('http://127.0.0.1:8787')).toBe('http://127.0.0.1:8787');
    expect(() => companionModule.relayBase('http://r.example.com')).toThrow(/https/);
    expect(() => companionModule.relayBase('https://u:p@r.example.com')).toThrow(/password/);
    expect(() => companionModule.relayBase('')).toThrow(/relay address/);
  });
});

describe('desktop, relay and phone page end to end', () => {
  const desktop = () => companionModule.createCompanion({ fetch: (u, o) => fetch(u, o), now: () => clock.now });

  it('pairs once, shows the devices read only, follows a refresh, and ends on request', async () => {
    const c = desktop();
    const started = await c.start({ relayUrl: local.url, devices: view });
    expect(started.code).toMatch(/^[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}$/);
    expect(c.status()).toMatchObject({ paired: true, pairingOpen: true });
    // The relay holds ciphertext only: no address, title or code in what it stored.
    const stored = [...local.env.COMPANION_KV.map.values()].map(e => e.value).join('\n');
    expect(stored).not.toMatch(/news\.test|Desk PC|Pixel/);
    expect(stored).not.toContain(companionModule.normalizeCode(started.code));

    const session = await page.pair(local.url, started.code);
    expect(session.snapshot.devices.map(d => d.name)).toEqual(['Desk PC', 'Pixel 9']);
    expect(session.snapshot.devices[0].tabs.map(t => t.url)).toEqual(['https://news.test/a']);

    // The code works once.
    await expect(page.pair(local.url, started.code)).rejects.toMatchObject({ status: 404 });

    // A refresh from the desktop reaches the phone (publishing is rate limited by the desktop).
    clock.now += 10000;
    await c.publish({ ...view, devices: [view.devices[1]] });
    expect((await page.refresh(session)).devices.map(d => d.name)).toEqual(['Pixel 9']);
    clock.now += 1000;
    expect(await c.publish(view)).toEqual({ ok: true, skipped: true });

    await c.stop();
    expect(c.status().paired).toBe(false);
    await expect(page.refresh(session)).rejects.toMatchObject({ status: 401 });
  });

  it('a pairing code that is not redeemed in five minutes is dead', async () => {
    const c = desktop();
    const { code } = await c.start({ relayUrl: local.url, devices: view });
    clock.now += companionModule.PAIR_WINDOW_MS + 1000;
    expect(c.status().pairingOpen).toBe(false);
    await expect(page.pair(local.url, code)).rejects.toMatchObject({ status: 404 });
  });

  it('a read session ends at its time to live', async () => {
    const c = desktop();
    const { code } = await c.start({ relayUrl: local.url, devices: view });
    const session = await page.pair(local.url, code);
    clock.now += 3600 * 1000 + 61000;
    await expect(page.refresh(session)).rejects.toMatchObject({ status: 401 });
  });

  it('a wrong code or an unknown relay answer the same, and the page never sees a stranger\'s data', async () => {
    const c = desktop();
    await c.start({ relayUrl: local.url, devices: view });
    await expect(page.pair(local.url, 'ZZZZ-ZZZZ-ZZZZ')).rejects.toMatchObject({ status: 404, message: 'Unknown or expired code' });
    await expect(page.pair(local.url, 'short')).rejects.toThrow(/not a pairing code/);
  });
});

describe('relay: rate limits, auth and silence', () => {
  const post = (path, body, headers = {}) => fetch(local.url + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
  const hex = n => crypto.randomBytes(n).toString('hex');

  it('answers preflight and refuses unknown paths', async () => {
    const pre = await fetch(local.url + '/companion/v1/snapshot', { method: 'OPTIONS' });
    expect(pre.status).toBe(204);
    expect(pre.headers.get('access-control-allow-headers')).toContain('X-Vex-Publish');
    expect((await fetch(local.url + '/nope')).status).toBe(404);
  });

  it('limits openings and redeems per client, and does not tell a used code from an unknown one', async () => {
    const statuses = [];
    for (let i = 0; i < 12; i++) statuses.push((await post('/companion/v1/pair', { lookup: hex(32), publishHash: hex(32), blob: 'AAAA' })).status);
    expect(statuses.filter(s => s === 200).length).toBe(10);
    expect(statuses.slice(10)).toEqual([429, 429]);
    clock.now += 16 * 60 * 1000;                          // the next window
    const redeems = [];
    for (let i = 0; i < 22; i++) redeems.push((await post('/companion/v1/redeem', { lookup: hex(32) })).status);
    expect(redeems.filter(s => s === 404).length).toBe(20);
    expect(redeems.slice(20)).toEqual([429, 429]);
  });

  it('publishing and revoking need the publish token; the read token cannot publish', async () => {
    const lookup = hex(32), token = hex(32), hash = crypto.createHash('sha256').update(token).digest('hex');
    expect((await post('/companion/v1/pair', { lookup, publishHash: hash, blob: 'AAAA' })).status).toBe(200);
    const put = (headers, blob = 'BBBB') => fetch(local.url + '/companion/v1/snapshot', { method: 'PUT', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify({ lookup, blob }) });
    expect((await put({})).status).toBe(401);
    expect((await put({ 'X-Vex-Publish': hex(32) })).status).toBe(401);
    const redeemed = await (await post('/companion/v1/redeem', { lookup })).json();
    expect((await put({ 'X-Vex-Publish': redeemed.readToken })).status).toBe(401);
    expect((await put({ 'X-Vex-Publish': token })).status).toBe(200);
    expect((await fetch(local.url + '/companion/v1/pair', { method: 'DELETE', headers: { 'Content-Type': 'application/json', 'X-Vex-Publish': token }, body: JSON.stringify({ lookup }) })).status).toBe(200);
    expect((await fetch(local.url + '/companion/v1/snapshot', { headers: { Authorization: 'Bearer ' + redeemed.readToken } })).status).toBe(401);
  });

  it('refuses an oversize snapshot and a body that is not JSON, and writes no log', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect((await post('/companion/v1/pair', { lookup: hex(32), publishHash: hex(32), blob: 'A'.repeat(100 * 1024) })).status).toBe(400);
    expect((await fetch(local.url + '/companion/v1/pair', { method: 'POST', body: 'not json' })).status).toBe(400);
    expect(log).not.toHaveBeenCalled();
    expect(err).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
    const source = require('node:fs').readFileSync(require('node:path').join(__dirname, '../../workers/companion/worker.js'), 'utf8');
    expect(source).not.toMatch(/console\./);
  });
});

describe('the page', () => {
  it('draws links as http(s) anchors only, with text and no markup from the snapshot', () => {
    const dom = new JSDOM('<div id="out"></div>');
    const root = dom.window.document.getElementById('out');
    page.render({ devices: [{ name: '<img src=x onerror=1>', tabs: [
      { url: 'https://ok.test/a', title: '<b>Bold</b>' }, { url: 'javascript:alert(1)', title: 'bad' }, { url: 'data:text/html,hi', title: 'bad' },
    ] }], readingQueue: [{ url: 'https://q.test/', title: 'Q' }] }, root);
    expect(root.querySelectorAll('a').length).toBe(2);
    expect(root.querySelector('a').href).toBe('https://ok.test/a');
    expect(root.querySelector('a').rel).toBe('noopener noreferrer');
    expect(root.querySelector('a').textContent).toBe('<b>Bold</b>');
    expect(root.querySelector('img')).toBeNull();
  });
});

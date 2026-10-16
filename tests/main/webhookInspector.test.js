// src/main/webhook-inspector.js (T3-058): a loopback receiver the owner starts, size-capped,
// self-stopping, never forwarding. These tests talk to a real listener on 127.0.0.1 (this computer).
import { describe, it, expect, afterEach } from 'vitest';
const http = require('http');
const net = require('net');
const { createWebhookInspector, MAX_BODY, MAX_REQUESTS } = require('../../src/main/webhook-inspector.js');

let inspector;
afterEach(async () => { if (inspector) await inspector.stop(); inspector = null; });

const freePort = () => new Promise((resolve, reject) => {
  const s = net.createServer();
  s.once('error', reject);
  s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); });
});

function send({ port, method = 'POST', path = '/hook?x=1', headers = {}, body = '' }) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method, path, headers }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => resolve({ status: res.statusCode, body: data, headers: res.headers }));
    });
    req.on('error', reject);
    req.end(body);
  });
}

function make(over = {}) {
  const timers = [];
  inspector = createWebhookInspector({
    http,
    setTimeout: (fn, ms) => { const t = { fn, ms, unref() {} }; timers.push(t); return t; },
    clearTimeout: (t) => { const i = timers.indexOf(t); if (i >= 0) timers.splice(i, 1); },
    ...over,
  });
  return { timers };
}

describe('starting', () => {
  it('listens on 127.0.0.1 only, on the port asked for', async () => {
    make();
    const port = await freePort();
    const st = await inspector.start({ port, minutes: 5 });
    expect(st).toMatchObject({ running: true, port, host: '127.0.0.1' });
    await new Promise((resolve, reject) => {
      const s = net.connect(port, '127.0.0.1', () => { s.destroy(); resolve(); });
      s.on('error', reject);
    });
  });

  it('refuses a port outside 1024-65535 and minutes outside 1-60, with the reason', async () => {
    make();
    await expect(inspector.start({ port: 80, minutes: 5 })).rejects.toThrow(/1024 to 65535/);
    await expect(inspector.start({ port: 8788.5, minutes: 5 })).rejects.toThrow(/1024 to 65535/);
    await expect(inspector.start({ port: 8788, minutes: 0 })).rejects.toThrow(/between 1 and 60/);
    await expect(inspector.start({ port: 8788, minutes: 61 })).rejects.toThrow(/between 1 and 60/);
    expect(inspector.status().running).toBe(false);
  });

  it('says so when the port is taken, and when it is already running', async () => {
    make();
    const port = await freePort();
    const hog = net.createServer();
    await new Promise(r => hog.listen(port, '127.0.0.1', r));
    await expect(inspector.start({ port, minutes: 5 })).rejects.toThrow(/already in use/);
    await new Promise(r => hog.close(r));
    await inspector.start({ port, minutes: 5 });
    await expect(inspector.start({ port, minutes: 5 })).rejects.toThrow(/already listening/);
  });

  it('stops by itself when its minutes are up', async () => {
    const { timers } = make();
    const port = await freePort();
    await inspector.start({ port, minutes: 7 });
    expect(timers.length).toBe(1);
    expect(timers[0].ms).toBe(7 * 60000);
    timers[0].fn();
    await new Promise(r => setTimeout(r, 50));
    expect(inspector.status().running).toBe(false);
    await expect(send({ port })).rejects.toThrow();
  });
});

describe('what it keeps', () => {
  it('lists method, path, headers and body, and answers the same small JSON', async () => {
    make();
    const port = await freePort();
    await inspector.start({ port, minutes: 5 });
    const res = await send({ port, headers: { 'Content-Type': 'application/json', 'X-Signature': 'abc' }, body: '{"event":"paid"}' });
    expect(res.status).toBe(200);
    expect(res.body).toBe('{"ok":true}');
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
    const [row] = inspector.list();
    expect(row).toMatchObject({ id: 1, method: 'POST', path: '/hook?x=1', size: 16, tooLarge: false, binary: false });
    const full = inspector.get(row.id);
    expect(full.body).toBe('{"event":"paid"}');
    expect(full.headers.find(([n]) => n.toLowerCase() === 'x-signature')[1]).toBe('abc');
    expect(full.from).toMatch(/127\.0\.0\.1/);
  });

  it('keeps any method, and list(since) returns only what is newer', async () => {
    make();
    const port = await freePort();
    await inspector.start({ port, minutes: 5 });
    await send({ port, method: 'GET', path: '/a' });
    await send({ port, method: 'PUT', path: '/b', body: 'x' });
    expect(inspector.list().map(r => r.method)).toEqual(['GET', 'PUT']);
    expect(inspector.list(1).map(r => r.path)).toEqual(['/b']);
  });

  it('does not keep a body over 1 MiB, answers 413 and lists it as too large', async () => {
    make();
    const port = await freePort();
    await inspector.start({ port, minutes: 5 });
    const res = await send({ port, body: 'a'.repeat(MAX_BODY + 10) });
    expect(res.status).toBe(413);
    const [row] = inspector.list();
    expect(row.tooLarge).toBe(true);
    expect(inspector.get(row.id).body).toBe('');
  });

  it('does not show a body that is not text as text', async () => {
    make();
    const port = await freePort();
    await inspector.start({ port, minutes: 5 });
    await send({ port, body: Buffer.from([0xff, 0xfe, 0x00, 0x80]) });
    const [row] = inspector.list();
    expect(row.binary).toBe(true);
    expect(inspector.get(row.id).body).toBe('');
  });

  it('holds at most 100 requests, dropping the oldest', async () => {
    make();
    const port = await freePort();
    await inspector.start({ port, minutes: 5 });
    for (let i = 0; i < MAX_REQUESTS + 5; i++) await send({ port, path: '/n' + i });
    const rows = inspector.list();
    expect(rows.length).toBe(MAX_REQUESTS);
    expect(rows[0].path).toBe('/n5');
    expect(() => inspector.get(1)).toThrow(/gone/);
  });

  it('clear forgets everything', async () => {
    make();
    const port = await freePort();
    await inspector.start({ port, minutes: 5 });
    await send({ port });
    inspector.clear();
    expect(inspector.list()).toEqual([]);
  });
});

describe('who may talk to it', () => {
  it('answers 421 and lists nothing for a Host header that is not this address (DNS rebinding)', async () => {
    make();
    const port = await freePort();
    await inspector.start({ port, minutes: 5 });
    const res = await send({ port, headers: { Host: 'evil.example:' + port }, body: 'x' });
    expect(res.status).toBe(421);
    expect(inspector.list()).toEqual([]);
    const ok = await send({ port, headers: { Host: 'localhost:' + port } });
    expect(ok.status).toBe(200);
  });

  it('has no way to forward: the module requires nothing that sends', () => {
    const src = require('fs').readFileSync(require('path').resolve(__dirname, '../../src/main/webhook-inspector.js'), 'utf8');
    expect(src).not.toMatch(/\bhttp\.request\b|\bfetch\(|net\.connect|child_process|\.request\(/);
    expect(src).toMatch(/listen\(wanted, '127\.0\.0\.1'/);
  });
});

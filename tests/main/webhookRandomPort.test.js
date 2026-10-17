// T3-058, Wave 5: the webhook inspector can ask the system for a free port (port 0), still on 127.0.0.1 only.
import { describe, it, expect, afterEach } from 'vitest';
const http = require('http');
const net = require('net');
const { createWebhookInspector } = require('../../src/main/webhook-inspector.js');
const { validate } = require('../../src/main/ipc-schemas.js');

let inspector;
afterEach(async () => { if (inspector) await inspector.stop(); inspector = null; });

const make = () => { inspector = createWebhookInspector({ http, setTimeout: () => ({ unref() {} }), clearTimeout() {} }); return inspector; };

function post(port, body = 'x') {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method: 'POST', path: '/hook' }, (res) => { res.resume(); res.on('end', () => resolve(res.statusCode)); });
    req.on('error', reject);
    req.end(body);
  });
}

describe('a free port picked by the system', () => {
  it('port 0 listens on a real port and reports it, on 127.0.0.1 only', async () => {
    const st = await make().start({ port: 0, minutes: 5 });
    expect(st.running).toBe(true);
    expect(st.host).toBe('127.0.0.1');
    expect(st.port).toBeGreaterThanOrEqual(1024);
    expect(st.port).toBeLessThanOrEqual(65535);
    await new Promise((resolve, reject) => { const s = net.connect(st.port, '127.0.0.1', () => { s.destroy(); resolve(); }); s.on('error', reject); });
  });
  it('receives a request on that port, and the host check uses the real port', async () => {
    const i = make();
    const st = await i.start({ port: 0, minutes: 5 });
    expect(await post(st.port)).toBe(200);
    expect(i.list().length).toBe(1);
    // A request that names another port in its Host header is refused as before.
    const status = await new Promise((resolve, reject) => {
      const req = http.request({ host: '127.0.0.1', port: st.port, method: 'GET', path: '/', headers: { Host: 'evil.example:' + st.port } }, (res) => { res.resume(); res.on('end', () => resolve(res.statusCode)); });
      req.on('error', reject); req.end();
    });
    expect(status).toBe(421);
  });
  it('two inspectors on port 0 never collide', async () => {
    const a = make();
    const b = createWebhookInspector({ http, setTimeout: () => ({ unref() {} }), clearTimeout() {} });
    const sa = await a.start({ port: 0, minutes: 5 });
    const sb = await b.start({ port: 0, minutes: 5 });
    expect(sa.port).not.toBe(sb.port);
    await b.stop();
  });
  it('still refuses ports below 1024 and above 65535, and anything that is not a whole number', async () => {
    const i = make();
    await expect(i.start({ port: 80, minutes: 5 })).rejects.toThrow(/1024 to 65535/);
    await expect(i.start({ port: 70000, minutes: 5 })).rejects.toThrow(/1024 to 65535/);
    await expect(i.start({ port: -1, minutes: 5 })).rejects.toThrow(/1024 to 65535/);
    await expect(i.start({ port: 1.5, minutes: 5 })).rejects.toThrow(/1024 to 65535/);
  });
  it('the channel accepts 0 and still refuses a negative, a fraction and a string', () => {
    expect(() => validate('webhook:start', [{ port: 0, minutes: 5 }])).not.toThrow();
    expect(() => validate('webhook:start', [{ port: 8788, minutes: 5 }])).not.toThrow();
    expect(() => validate('webhook:start', [{ port: -1, minutes: 5 }])).toThrow();
    expect(() => validate('webhook:start', [{ port: 1.5, minutes: 5 }])).toThrow();
    expect(() => validate('webhook:start', [{ port: '0', minutes: 5 }])).toThrow();
    expect(() => validate('webhook:start', [{ port: 70000, minutes: 5 }])).toThrow();
  });
});

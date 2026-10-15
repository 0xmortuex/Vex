// The older API client (JsonApiViewer in js/devtools-pack.js) goes through
// api:request. It follows the playground's rules: public addresses, and
// localhost only when "Allow localhost" was ticked for this open; the local
// network is never sent to.
import { describe, it, expect } from 'vitest';

const fs = require('fs');
const path = require('path');
const read = (...p) => fs.readFileSync(path.resolve(__dirname, '../..', ...p), 'utf8').replace(/\r\n/g, '\n');
const { validate } = require('../../src/main/ipc-schemas');
const { createApiPlayground } = require('../../src/main/api-playground');

describe('the API viewer and private addresses', () => {
  it('the viewer asks main for the playground path, with the tick as the only way to localhost', () => {
    const view = read('src', 'renderer', 'js', 'devtools-pack.js');
    expect(view).toContain('viewer: true, allowLocal');
    expect(view).toContain('id="api-allow-local"');
    const main = read('src', 'main.js');
    const at = main.indexOf("ipcMain.handle('api:request'");
    const body = main.slice(at, at + 2600);
    expect(body).toContain('if (viewer === true)');
    expect(body).toContain('_apiPlayground.send({');
    expect(body).toContain('allowLocal: allowLocal === true');
  });

  it('the schema takes viewer and allowLocal, and nothing else new', () => {
    expect(() => validate('api:request', [{ url: 'https://a.test/', viewer: true, allowLocal: false }])).not.toThrow();
    expect(() => validate('api:request', [{ url: 'https://a.test/', viewer: 'yes' }])).toThrow();
  });

  it('the shared rules refuse the local network and need the tick for localhost', async () => {
    const ok = async () => new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
    const pg = createApiPlayground({ publicFetch: ok, localFetch: ok, boundedFactory: (f) => f });
    await expect(pg.send({ url: 'http://192.168.1.1/', method: 'GET', allowLocal: true })).rejects.toThrow(/local network/);
    await expect(pg.send({ url: 'http://10.0.0.5/', method: 'GET', allowLocal: true })).rejects.toThrow(/local network/);
    await expect(pg.send({ url: 'http://127.0.0.1:8080/', method: 'GET' })).rejects.toThrow(/localhost/);
    const r = await pg.send({ url: 'http://127.0.0.1:8080/', method: 'GET', allowLocal: true });
    expect(r.local).toBe(true);
  });
});

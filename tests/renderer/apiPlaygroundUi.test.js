// @vitest-environment jsdom
//
// API playground (renderer side): saved requests, environments with
// variables, history, and the rule that sensitive values stay out of the saved
// request, out of history, out of sync and out of backups.
import { beforeEach, describe, expect, it, vi } from 'vitest';
require('../../src/renderer/js/vex-utils.js');
globalThis.VexIcons = require('../../src/renderer/js/vex-icons.js').VexIcons;
const { VexModuleCommands } = require('../../src/renderer/js/settings-groups.js');
globalThis.VexModuleCommands = VexModuleCommands;
const { ApiPlayground: PG } = require('../../src/renderer/js/api-playground.js');
const { VexBackup } = require('../../src/renderer/js/backup.js');

beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = '';
  window.showToast = vi.fn();
  window.VexTabPolicy = { isPrivateWindow: false };
  window.vex = { playgroundSend: vi.fn(async () => ({ ok: true, status: 200, statusText: 'OK', timeMs: 12, size: 5, headers: [], body: '{"a":1}', contentType: 'application/json' })) };
  globalThis.vexConfirm = vi.fn(async () => true);
});

describe('variables and requests', () => {
  it('fills {{variables}} and refuses an undefined one', () => {
    expect(PG.interpolate('https://{{host}}/v1/{{ id }}', { host: 'api.example.com', id: '7' })).toBe('https://api.example.com/v1/7');
    expect(() => PG.interpolate('{{missing}}', {})).toThrow(/not defined/);
  });

  it('builds the request that will be sent, skipping disabled and unnamed headers', () => {
    const req = PG.buildRequest({
      method: 'post', url: '{{base}}/items', body: '{"k":"{{k}}"}', allowLocal: false,
      headers: [{ name: 'Authorization', value: 'Bearer {{tok}}', enabled: true }, { name: 'X-Off', value: '1', enabled: false }, { name: '', value: 'x' }],
    }, { base: 'https://api.example.com', k: 'v', tok: 'T0KEN' });
    expect(req).toEqual({ url: 'https://api.example.com/items', method: 'POST', headers: { Authorization: 'Bearer T0KEN' }, body: '{"k":"v"}' });
  });

  it('refuses a non-http address and sends no body on GET', () => {
    expect(() => PG.buildRequest({ method: 'GET', url: 'ftp://x' }, {})).toThrow(/http/);
    expect(PG.buildRequest({ method: 'GET', url: 'https://a.com', body: 'x' }, {})).not.toHaveProperty('body');
  });

  it('marks authorization-like headers sensitive', () => {
    for (const n of ['Authorization', 'Cookie', 'X-API-Key', 'X-Auth-Token', 'Proxy-Authorization', 'X-Session-Id', 'Api-Key']) expect(PG.isSensitiveHeader(n), n).toBe(true);
    for (const n of ['Content-Type', 'Accept', 'User-Agent']) expect(PG.isSensitiveHeader(n), n).toBe(false);
  });
});

describe('what is kept where', () => {
  it('keeps a sensitive header value only in the secret store', () => {
    const id = PG.saveRequest({ name: 'List', method: 'GET', url: 'https://a.com/x', body: '', headers: [
      { name: 'Authorization', value: 'Bearer TOP-SECRET', sensitive: true, enabled: true },
      { name: 'Accept', value: 'application/json', sensitive: false, enabled: true },
    ] });
    expect(localStorage.getItem(PG.KEY)).not.toContain('TOP-SECRET');
    expect(localStorage.getItem(PG.SECRET_KEY)).toContain('TOP-SECRET');
    const back = PG.hydrateRequest(PG.load().requests.find(r => r.id === id));
    expect(back.headers.find(h => h.name === 'Authorization').value).toBe('Bearer TOP-SECRET');
    expect(back.headers.find(h => h.name === 'Accept').value).toBe('application/json');
  });

  it('keeps a secret environment variable only in the secret store', () => {
    const id = PG.saveEnv({ name: 'Prod', vars: [{ name: 'base', value: 'https://a.com', secret: false }, { name: 'tok', value: 'S3CRET', secret: true }] });
    expect(localStorage.getItem(PG.KEY)).not.toContain('S3CRET');
    const env = PG.load().envs.find(e => e.id === id);
    expect(PG.envVars(env)).toEqual({ base: 'https://a.com', tok: 'S3CRET' });
  });

  it('deleting a request or an environment deletes its secrets', () => {
    const r = PG.saveRequest({ name: 'R', method: 'GET', url: 'https://a.com', headers: [{ name: 'Cookie', value: 'sid=1', sensitive: true }] });
    const e = PG.saveEnv({ name: 'E', vars: [{ name: 'k', value: 'v', secret: true }] });
    expect(Object.keys(PG.secrets())).toHaveLength(2);
    PG.deleteRequest(r); PG.deleteEnv(e);
    expect(PG.secrets()).toEqual({});
  });

  it('history keeps method, address without its query, status and time only', async () => {
    await PG.send({ method: 'POST', url: 'https://a.com/path?token=ABC#frag', body: 'BODY-TEXT', headers: [{ name: 'Authorization', value: 'Bearer HDR-SECRET', sensitive: true }] });
    const stored = localStorage.getItem(PG.KEY);
    expect(PG.load().history[0]).toMatchObject({ method: 'POST', url: 'https://a.com/path?…', status: 200 });
    for (const leak of ['ABC', 'BODY-TEXT', 'HDR-SECRET', 'frag']) expect(stored).not.toContain(leak);
  });

  it('a failed request is explained, and logged without detail', async () => {
    window.vex.playgroundSend = vi.fn(async () => ({ ok: false, error: 'Addresses on the local network are not sent to' }));
    const res = await PG.send({ method: 'GET', url: 'http://192.168.1.1/' });
    expect(res.ok).toBe(false);
    expect(PG.load().history[0].error).toMatch(/local network/);
  });

  it('is never in Vex Sync, and backups and exports always leave the secrets out', () => {
    const sync = require('node:fs').readFileSync(require('node:path').join(__dirname, '../../src/renderer/js/sync-engine.js'), 'utf8');
    expect(sync).not.toMatch(/vex\.playground/);
    expect(VexBackup._blocked(PG.SECRET_KEY)).toBeTruthy();
    expect(VexBackup._blocked(PG.KEY)).toBeFalsy();
  });

  it('sends the saved environment’s variables to main, not to the page', async () => {
    const id = PG.saveEnv({ name: 'Stage', vars: [{ name: 'base', value: 'https://stage.example.com', secret: false }] });
    PG.setActiveEnv(id);
    await PG.send({ method: 'GET', url: '{{base}}/ping', headers: [], allowLocal: false });
    expect(window.vex.playgroundSend).toHaveBeenCalledWith({ url: 'https://stage.example.com/ping', method: 'GET', headers: {} });
  });
});

describe('the panel', () => {
  it('opens, sends from the form and shows the status and a formatted body', async () => {
    PG.open('https://a.com/v1');
    expect(document.querySelector('#pg-url').value).toBe('https://a.com/v1');
    document.querySelector('#pg-send').click();
    await new Promise(r => setTimeout(r, 5));
    expect(window.vex.playgroundSend).toHaveBeenCalledTimes(1);
    expect(document.querySelector('#pg-status').textContent).toContain('200 OK');
    expect(document.querySelector('#pg-response').textContent).toContain('"a": 1');
  });

  it('"Allow localhost" starts off every time and is passed to main only when ticked', async () => {
    PG.open('http://localhost:3000/');
    expect(document.querySelector('#pg-local').checked).toBe(false);
    document.querySelector('#pg-send').click();
    await new Promise(r => setTimeout(r, 5));
    expect(window.vex.playgroundSend.mock.calls[0][0]).not.toHaveProperty('allowLocal');
    document.querySelector('#pg-local').checked = true;
    document.querySelector('#pg-send').click();
    await new Promise(r => setTimeout(r, 5));
    expect(window.vex.playgroundSend.mock.calls[1][0].allowLocal).toBe(true);
    PG.open('http://localhost:3000/');
    expect(document.querySelector('#pg-local').checked).toBe(false);
  });

  it('is not available in a private window', () => {
    window.VexTabPolicy.isPrivateWindow = true;
    expect(PG.open('https://a.com')).toBeNull();
    expect(document.getElementById('vex-playground')).toBeNull();
  });

  it('masks a sensitive header value in the form', () => {
    const id = PG.saveRequest({ name: 'R', method: 'GET', url: 'https://a.com', headers: [{ name: 'Authorization', value: 'Bearer X', sensitive: true }] });
    PG.open();
    document.querySelector('#pg-saved [data-open]').click();
    const val = document.querySelector('#pg-headers [data-h-value]');
    expect(val.type).toBe('password');
    expect(val.value).toBe('Bearer X');
    expect(id).toBeTruthy();
  });
});

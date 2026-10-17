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

// A stand-in for the main process's secret vault: values are kept here, and only key names go back to the window.
let vault, answer;
beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = '';
  window.showToast = vi.fn();
  window.VexTabPolicy = { isPrivateWindow: false };
  vault = new Map();
  answer = { ok: true, status: 200, statusText: 'OK', timeMs: 12, size: 5, headers: [], body: '{"a":1}', contentType: 'application/json' };
  window.vex = {
    playgroundSend: vi.fn(async () => answer),
    playgroundSendForm: vi.fn(async () => answer),
    playgroundSecretsKeys: vi.fn(async () => [...vault.keys()]),
    playgroundSecretsApply: vi.fn(async ({ set = {}, clear = [] }) => { for (const k of clear) vault.delete(k); for (const [k, v] of Object.entries(set)) vault.set(k, v); return { count: vault.size }; }),
    playgroundSecretsMigrate: vi.fn(async (legacy) => { let imported = 0, kept = 0; for (const [k, v] of Object.entries(legacy)) { if (vault.has(k)) kept++; else { vault.set(k, v); imported++; } } return { imported, kept, refused: 0 }; }),
  };
  PG._vaultKeys = null;
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
  it('keeps a sensitive header value only in the main-process vault, and never hands it back', async () => {
    const id = await PG.saveRequest({ name: 'List', method: 'GET', url: 'https://a.com/x', body: '', headers: [
      { name: 'Authorization', value: 'Bearer TOP-SECRET', sensitive: true, enabled: true },
      { name: 'Accept', value: 'application/json', sensitive: false, enabled: true },
    ] });
    expect(localStorage.getItem(PG.KEY)).not.toContain('TOP-SECRET');
    expect(localStorage.getItem(PG.SECRET_KEY)).toBeNull();
    expect(vault.get('req:' + id + ':Authorization')).toBe('Bearer TOP-SECRET');
    const back = PG.hydrateRequest(PG.load().requests.find(r => r.id === id));
    expect(back.headers.find(h => h.name === 'Authorization')).toMatchObject({ value: '', saved: true, ref: 'req:' + id + ':Authorization' });
    expect(JSON.stringify(back)).not.toContain('TOP-SECRET');
    expect(back.headers.find(h => h.name === 'Accept').value).toBe('application/json');
  });

  it('keeps a secret environment variable only in the vault; the window gets the plain ones and the vault key of the secret one', async () => {
    const id = await PG.saveEnv({ name: 'Prod', vars: [{ name: 'base', value: 'https://a.com', secret: false }, { name: 'tok', value: 'S3CRET', secret: true }] });
    expect(localStorage.getItem(PG.KEY)).not.toContain('S3CRET');
    const env = PG.load().envs.find(e => e.id === id);
    expect(PG.envVars(env)).toEqual({ base: 'https://a.com' });
    expect(PG.envPlan(env)).toEqual({ vars: { base: 'https://a.com' }, secretVars: { tok: 'env:' + id + ':tok' } });
    expect(vault.get('env:' + id + ':tok')).toBe('S3CRET');
  });

  it('a secret left empty on save keeps the saved one; typing a new one replaces it; clearing the flag removes it', async () => {
    const id = await PG.saveEnv({ name: 'Prod', vars: [{ name: 'tok', value: 'ONE', secret: true }] });
    await PG.saveEnv({ id, name: 'Prod', vars: [{ name: 'tok', value: '', secret: true }] });
    expect(vault.get('env:' + id + ':tok')).toBe('ONE');
    await PG.saveEnv({ id, name: 'Prod', vars: [{ name: 'tok', value: 'TWO', secret: true }] });
    expect(vault.get('env:' + id + ':tok')).toBe('TWO');
    await PG.saveEnv({ id, name: 'Prod', vars: [{ name: 'tok', value: 'plain', secret: false }] });
    expect(vault.has('env:' + id + ':tok')).toBe(false);
  });

  it('deleting a request or an environment deletes its secrets', async () => {
    const r = await PG.saveRequest({ name: 'R', method: 'GET', url: 'https://a.com', headers: [{ name: 'Cookie', value: 'sid=1', sensitive: true }] });
    const e = await PG.saveEnv({ name: 'E', vars: [{ name: 'k', value: 'v', secret: true }] });
    expect(vault.size).toBe(2);
    await PG.deleteRequest(r); await PG.deleteEnv(e);
    expect(vault.size).toBe(0);
  });

  it('refuses to save a secret when this build has no vault, instead of keeping it in the window', async () => {
    delete window.vex.playgroundSecretsKeys;
    await expect(PG.saveRequest({ name: 'R', method: 'GET', url: 'https://a.com', headers: [{ name: 'Authorization', value: 'X', sensitive: true }] })).rejects.toThrow(/no secret vault/);
    expect(localStorage.getItem(PG.SECRET_KEY)).toBeNull();
    expect(PG.load().requests).toEqual([]);
  });

  it('history keeps method, address without its query, status and time only', async () => {
    await PG.send({ method: 'POST', url: 'https://a.com/path?token=ABC#frag', body: 'BODY-TEXT', headers: [{ name: 'Authorization', value: 'Bearer HDR-SECRET', sensitive: true }] });
    expect(window.vex.playgroundSendForm).toHaveBeenCalledTimes(1);
    const stored = localStorage.getItem(PG.KEY);
    expect(PG.load().history[0]).toMatchObject({ method: 'POST', url: 'https://a.com/path?…', status: 200 });
    for (const leak of ['ABC', 'BODY-TEXT', 'HDR-SECRET', 'frag']) expect(stored).not.toContain(leak);
  });

  it('a failed request is explained, and logged without detail', async () => {
    answer = { ok: false, error: 'Addresses on the local network are not sent to' };
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

  it('sends the form with its {{variables}} unfilled to main, which fills them in; a secret goes as a vault key, never as a value', async () => {
    const id = await PG.saveEnv({ name: 'Stage', vars: [{ name: 'base', value: 'https://stage.example.com', secret: false }, { name: 'tok', value: 'S3CRET', secret: true }] });
    PG.setActiveEnv(id);
    await PG.send({ method: 'GET', url: '{{base}}/ping', headers: [{ name: 'Authorization', value: 'Bearer {{tok}}', sensitive: true, enabled: true }], allowLocal: false });
    const sent = window.vex.playgroundSendForm.mock.calls[0][0];
    expect(sent.form.url).toBe('{{base}}/ping');
    expect(sent.vars).toEqual({ base: 'https://stage.example.com' });
    expect(sent.secretVars).toEqual({ tok: 'env:' + id + ':tok' });
    expect(JSON.stringify(sent)).not.toContain('S3CRET');
    expect(window.vex.playgroundSend).not.toHaveBeenCalled();
  });

  it('a saved sensitive header left empty is sent as a reference to the vault', async () => {
    const rid = await PG.saveRequest({ name: 'R', method: 'GET', url: 'https://a.com', headers: [{ name: 'Authorization', value: 'Bearer KEEP', sensitive: true }] });
    const form = PG.hydrateRequest(PG.load().requests.find(r => r.id === rid));
    await PG.send(form);
    const sent = window.vex.playgroundSendForm.mock.calls[0][0];
    expect(sent.form.headers[0]).toMatchObject({ name: 'Authorization', value: '', sensitive: true, ref: 'req:' + rid + ':Authorization' });
    expect(JSON.stringify(sent)).not.toContain('KEEP');
  });

  it('moves the old window-side secrets into the vault once, then removes the old key', async () => {
    localStorage.setItem(PG.SECRET_KEY, JSON.stringify({ 'req:rq_abcd1234:Authorization': 'Bearer OLD', 'env:ev_abcd1234:tok': 'OLDTOK' }));
    expect(await PG.ready()).toBe(true);
    expect(localStorage.getItem(PG.SECRET_KEY)).toBeNull();
    expect(vault.get('req:rq_abcd1234:Authorization')).toBe('Bearer OLD');
    expect(PG.secretKeys().has('env:ev_abcd1234:tok')).toBe(true);
    await PG.ready();
    expect(window.vex.playgroundSecretsMigrate).toHaveBeenCalledTimes(1);
  });

  it('keeps the old secrets where they are, and says so, when the vault does not take them all', async () => {
    localStorage.setItem(PG.SECRET_KEY, JSON.stringify({ 'req:rq_abcd1234:Authorization': 'Bearer OLD' }));
    window.vex.playgroundSecretsMigrate = vi.fn(async () => ({ imported: 0, kept: 0, refused: 0 }));
    await expect(PG.ready()).rejects.toThrow(/did not take in all/);
    expect(localStorage.getItem(PG.SECRET_KEY)).not.toBeNull();
    localStorage.setItem(PG.SECRET_KEY, '{not json');
    await expect(PG.ready()).rejects.toThrow(/not readable/);
    expect(localStorage.getItem(PG.SECRET_KEY)).toBe('{not json');
  });
});

describe('the panel', () => {
  it('opens, sends from the form and shows the status and a formatted body', async () => {
    PG.open('https://a.com/v1');
    expect(document.querySelector('#pg-url').value).toBe('https://a.com/v1');
    document.querySelector('#pg-send').click();
    await new Promise(r => setTimeout(r, 5));
    expect(window.vex.playgroundSendForm).toHaveBeenCalledTimes(1);
    expect(document.querySelector('#pg-status').textContent).toContain('200 OK');
    expect(document.querySelector('#pg-response').textContent).toContain('"a": 1');
  });

  it('"Allow localhost" starts off every time and is passed to main only when ticked', async () => {
    PG.open('http://localhost:3000/');
    expect(document.querySelector('#pg-local').checked).toBe(false);
    document.querySelector('#pg-send').click();
    await new Promise(r => setTimeout(r, 5));
    expect(window.vex.playgroundSendForm.mock.calls[0][0].form.allowLocal).toBe(false);
    document.querySelector('#pg-local').checked = true;
    document.querySelector('#pg-send').click();
    await new Promise(r => setTimeout(r, 5));
    expect(window.vex.playgroundSendForm.mock.calls[1][0].form.allowLocal).toBe(true);
    PG.open('http://localhost:3000/');
    expect(document.querySelector('#pg-local').checked).toBe(false);
  });

  it('is not available in a private window', () => {
    window.VexTabPolicy.isPrivateWindow = true;
    expect(PG.open('https://a.com')).toBeNull();
    expect(document.getElementById('vex-playground')).toBeNull();
  });

  it('does not put a saved sensitive header value into the form: it is masked, empty, and says it is saved', async () => {
    const id = await PG.saveRequest({ name: 'R', method: 'GET', url: 'https://a.com', headers: [{ name: 'Authorization', value: 'Bearer X', sensitive: true }] });
    PG.open();
    await PG.ready();
    document.querySelector('#pg-saved [data-open]').click();
    const val = document.querySelector('#pg-headers [data-h-value]');
    expect(val.type).toBe('password');
    expect(val.value).toBe('');
    expect(val.placeholder).toMatch(/Saved/);
    expect(document.documentElement.innerHTML).not.toContain('Bearer X');
    expect(id).toBeTruthy();
  });
});

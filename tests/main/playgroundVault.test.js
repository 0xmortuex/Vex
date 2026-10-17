// The API playground's secret vault and the variable filling done in the main process
// (src/main/playground-vault.js), against a stand-in secret store and a stand-in sender.
import { describe, it, expect, beforeEach, vi } from 'vitest';

const { createPlaygroundVault } = require('../../src/main/playground-vault');

function memoryStore() {
  const files = new Map();
  return {
    files,
    read: async (f) => (files.has(f) ? JSON.parse(files.get(f)) : null),
    write: async (f, v) => { files.set(f, JSON.stringify(v)); return true; },
    clear: async (f) => { files.delete(f); return true; },
  };
}

let store, sent, vault, reply;
beforeEach(() => {
  store = memoryStore();
  sent = [];
  reply = { ok: true, status: 200, statusText: 'OK', headers: [['content-type', 'text/plain']], body: 'fine' };
  vault = createPlaygroundVault({ secretStore: store, file: 'playground-secrets.enc', send: async (req) => { sent.push(req); return JSON.parse(JSON.stringify(reply)); } });
});

const K_REQ = 'req:rq_abcd1234:Authorization', K_ENV = 'env:ev_abcd1234:tok';

describe('keeping secrets', () => {
  it('lists key names only, and writes, replaces and clears', async () => {
    expect(await vault.keys()).toEqual([]);
    await vault.apply({ set: { [K_REQ]: 'Bearer ONE', [K_ENV]: 'TWO' } });
    expect(await vault.keys()).toEqual([K_ENV, K_REQ]);
    await vault.apply({ set: { [K_REQ]: 'Bearer NEW' }, clear: [K_ENV] });
    expect(await vault.keys()).toEqual([K_REQ]);
    await vault.apply({ clear: ['req:rq_abcd1234:*'] });
    expect(await vault.keys()).toEqual([]);
  });
  it('refuses a bad key, an empty or huge value, and a prefix that is not a request or environment', async () => {
    await expect(vault.apply({ set: { 'evil:x': 'v' } })).rejects.toThrow(/Not a valid secret name/);
    await expect(vault.apply({ set: { [K_REQ]: '' } })).rejects.toThrow(/1 to/);
    await expect(vault.apply({ set: { [K_REQ]: 'x'.repeat(9000) } })).rejects.toThrow(/1 to/);
    await expect(vault.apply({ clear: ['*'] })).rejects.toThrow(/prefix/);
    await expect(vault.apply({ set: [] })).rejects.toThrow(/valid change/);
  });
  it('moves old secrets in once and never overwrites a key that is already there', async () => {
    await vault.apply({ set: { [K_REQ]: 'KEEP-ME' } });
    const r = await vault.migrate({ [K_REQ]: 'OLD', [K_ENV]: 'TOKEN', 'bad key': 'x', 'req:rq_abcd1234:Empty': '' });
    expect(r).toEqual({ imported: 1, kept: 1, refused: 2 });
    expect((await store.read('playground-secrets.enc')).map[K_REQ]).toBe('KEEP-ME');
    await expect(vault.migrate([])).rejects.toThrow(/expected form/);
  });
});

describe('filling in variables in the main process', () => {
  it('fills plain variables, secret variables (from the vault) and a saved sensitive header', async () => {
    await vault.apply({ set: { [K_ENV]: 'S3CRET', [K_REQ]: 'Bearer SAVED' } });
    const res = await vault.sendForm({
      form: { method: 'post', url: '{{base}}/items?k={{tok}}', body: '{"t":"{{tok}}"}', allowLocal: false, headers: [
        { name: 'Authorization', value: '', sensitive: true, ref: K_REQ, enabled: true },
        { name: 'X-Token', value: 'Bearer {{tok}}', sensitive: true, enabled: true },
        { name: 'X-Off', value: 'no', enabled: false },
      ] },
      vars: { base: 'https://api.example.com' }, secretVars: { tok: K_ENV },
    });
    expect(res.ok).toBe(true);
    expect(sent[0]).toEqual({ url: 'https://api.example.com/items?k=S3CRET', method: 'POST', headers: { Authorization: 'Bearer SAVED', 'X-Token': 'Bearer S3CRET' }, body: '{"t":"S3CRET"}' });
  });
  it('an undefined variable is an error naming it, and a secret with no value is not turned into an empty string', async () => {
    await expect(vault.sendForm({ form: { method: 'GET', url: 'https://a.example/{{missing}}', headers: [] } })).rejects.toThrow(/\{\{missing\}\} is not defined/);
    await expect(vault.sendForm({ form: { method: 'GET', url: 'https://a.example/{{tok}}', headers: [] }, secretVars: { tok: K_ENV } })).rejects.toThrow(/\{\{tok\}\} is not defined/);
    expect(sent).toEqual([]);
  });
  it('a saved header whose value is not in the vault is an error, not an empty header', async () => {
    await expect(vault.sendForm({ form: { method: 'GET', url: 'https://a.example/', headers: [{ name: 'Authorization', value: '', sensitive: true, ref: K_REQ }] } })).rejects.toThrow(/type it again/);
  });
  it('a secret echoed by the server is hidden in the answer, and never appears in an error', async () => {
    await vault.apply({ set: { [K_ENV]: 'S3CRET-VALUE' } });
    reply = { ok: true, status: 200, headers: [['x-echo', 'got S3CRET-VALUE']], body: 'you sent S3CRET-VALUE' };
    const res = await vault.sendForm({ form: { method: 'GET', url: 'https://a.example/{{tok}}', headers: [] }, secretVars: { tok: K_ENV } });
    expect(JSON.stringify(res)).not.toContain('S3CRET-VALUE');
    expect(res.body).toBe('you sent [secret]');
    const failing = createPlaygroundVault({ secretStore: store, file: 'playground-secrets.enc', send: async () => { throw new Error('refused https://a.example/S3CRET-VALUE'); } });
    await expect(failing.sendForm({ form: { method: 'GET', url: 'https://a.example/{{tok}}', headers: [] }, secretVars: { tok: K_ENV } })).rejects.toThrow(/refused https:\/\/a\.example\/\[secret\]/);
  });
  it('refuses a bad variable name and a bad method', async () => {
    await expect(vault.sendForm({ form: { method: 'GET', url: 'https://a.example/', headers: [] }, secretVars: { 'a b': K_ENV } })).rejects.toThrow(/valid variable name/);
    await expect(vault.sendForm({})).rejects.toThrow(/No request/);
  });
});

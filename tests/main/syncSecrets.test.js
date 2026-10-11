// Saved passwords and authenticator accounts in Vex Sync are sealed and opened
// in the main process (src/main/sync-secrets.js): the window, the record
// document on disk and the server only ever see sealed items.
import { describe, it, expect } from 'vitest';

const { createSyncSecrets } = require('../../src/main/sync-secrets.js');

const KEY = '000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f';
const OTHER_KEY = 'ff'.repeat(32);
const login = (over = {}) => ({ host: 'example.com', username: 'alice@example.com', password: 'correct horse battery', updatedAt: '2026-10-01T10:00:00.000Z', ...over });
const account = (over = {}) => ({ id: 'uuid-1', label: 'alice', issuer: 'GitHub', secret: 'JBSWY3DPEHPK3PXP', algorithm: 'sha1', digits: 6, period: 30, created: '2026-10-01T10:00:00.000Z', ...over });

function device({ key = KEY, passwords = [], authenticator = [], locked = false } = {}) {
  const held = { passwords: structuredClone(passwords), authenticator: structuredClone(authenticator), locked };
  const store = kind => ({ load: () => structuredClone(held[kind]), save: async (list) => { held[kind] = structuredClone(list); } });
  const secrets = createSyncSecrets({
    readKeyHex: async () => key,
    isLocked: () => held.locked,
    stores: { passwords: store('passwords'), authenticator: { ...store('authenticator'), validate: (e) => { if (!/^[A-Z2-7]+=*$/i.test(e.secret)) throw new Error('Invalid secret'); } } },
  });
  return { held, secrets };
}

describe('sync secrets (main process)', () => {
  it('seals each item: no password, username, site or 2FA secret in what leaves main', async () => {
    const a = device({ passwords: [login()], authenticator: [account()] });
    const sealed = await a.secrets.sealKinds(['passwords', 'authenticator']);
    const text = JSON.stringify(sealed);
    for (const plain of ['correct horse battery', 'alice@example.com', 'example.com', 'JBSWY3DPEHPK3PXP', 'GitHub']) expect(text).not.toContain(plain);
    expect(sealed.passwords).toHaveLength(1);
    expect(sealed.passwords[0]).toEqual({ id: expect.stringMatching(/^[a-f0-9]{32}$/), t: Date.parse('2026-10-01T10:00:00.000Z'), s: expect.any(String) });
  });

  it('the same item seals to the same text, on any device with the sync key', async () => {
    const a = device({ passwords: [login()] });
    const b = device({ passwords: [login()] });
    const first = await a.secrets.sealKinds(['passwords']);
    expect(await a.secrets.sealKinds(['passwords'])).toEqual(first);
    expect(await b.secrets.sealKinds(['passwords'])).toEqual(first);
    // A changed password is a new text under the same id.
    const c = device({ passwords: [login({ password: 'other', updatedAt: '2026-10-02T00:00:00.000Z' })] });
    const changed = (await c.secrets.sealKinds(['passwords'])).passwords[0];
    expect(changed.id).toBe(first.passwords[0].id);
    expect(changed.s).not.toBe(first.passwords[0].s);
  });

  it('applies what arrived: adds, changes and removes, item by item', async () => {
    const a = device({ passwords: [login(), login({ host: 'gone.test' })], authenticator: [] });
    const b = device({ passwords: [login({ password: 'newer', updatedAt: '2026-10-05T00:00:00.000Z' }), login({ host: 'new.test' })], authenticator: [account()] });
    const theirs = await b.secrets.sealKinds(['passwords', 'authenticator']);
    await a.secrets.sealKinds(['passwords', 'authenticator']);
    expect(await a.secrets.applyKinds(theirs)).toEqual({ changed: 4 });
    expect(a.held.passwords.map(e => [e.host, e.password]).sort()).toEqual([['example.com', 'newer'], ['new.test', 'correct horse battery']]);
    expect(a.held.authenticator).toEqual([account()]);
  });

  it('a login saved or changed here after sync read the vault is never overwritten or removed by that sync', async () => {
    const a = device({ passwords: [login()] });
    await a.secrets.sealKinds(['passwords']);
    // Changed here while the pull was under way...
    a.held.passwords = [login({ password: 'typed just now', updatedAt: '2026-10-06T00:00:00.000Z' }), login({ host: 'added.test' })];
    // ...and the merge says the login is deleted.
    await a.secrets.applyKinds({ passwords: [] });
    expect(a.held.passwords.map(e => e.password)).toEqual(['typed just now', 'correct horse battery']);
  });

  it('refuses to apply without first reading this device, and a list sealed with another key', async () => {
    const a = device({ passwords: [login()] });
    await expect(a.secrets.applyKinds({ passwords: [] })).rejects.toThrow(/must read/);
    const stranger = device({ key: OTHER_KEY, passwords: [login({ host: 'x.test' })] });
    const foreign = await stranger.secrets.sealKinds(['passwords']);
    await a.secrets.sealKinds(['passwords']);
    await expect(a.secrets.applyKinds(foreign)).rejects.toThrow(/could not be opened/);
    expect(a.held.passwords).toEqual([login()]);
  });

  it('an item moved to another id is refused', async () => {
    const a = device({ passwords: [login(), login({ host: 'b.test' })] });
    const [one, two] = (await a.secrets.sealKinds(['passwords'])).passwords;
    const b = device();
    await b.secrets.sealKinds(['passwords']);
    await expect(b.secrets.applyKinds({ passwords: [{ ...one, s: two.s }] })).rejects.toThrow();
    expect(b.held.passwords).toEqual([]);
  });

  it('refuses everything while Vex is locked', async () => {
    const a = device({ passwords: [login()], locked: true });
    await expect(a.secrets.sealKinds(['passwords'])).rejects.toThrow(/locked/);
    await expect(a.secrets.applyKinds({ passwords: [] })).rejects.toThrow(/locked/);
    await expect(a.secrets.describe([])).rejects.toThrow(/locked/);
    await expect(a.secrets.putBack({ kind: 'passwords', id: 'a'.repeat(32), item: null })).rejects.toThrow(/locked/);
    expect(a.held.passwords).toEqual([login()]);
  });

  it('names a version for Sync conflicts without its password, and puts one back', async () => {
    const a = device({ passwords: [login()], authenticator: [account()] });
    const sealed = await a.secrets.sealKinds(['passwords', 'authenticator']);
    const named = await a.secrets.describe([{ kind: 'passwords', ...sealed.passwords[0] }, { kind: 'authenticator', ...sealed.authenticator[0] }]);
    expect(named).toEqual([{ label: 'alice@example.com on example.com' }, { label: 'GitHub (alice)' }]);
    const old = device({ passwords: [login({ password: 'old one', updatedAt: '2026-09-01T00:00:00.000Z' })] });
    const version = (await old.secrets.sealKinds(['passwords'])).passwords[0];
    await a.secrets.putBack({ kind: 'passwords', id: version.id, item: version });
    expect(a.held.passwords.map(e => e.password)).toEqual(['old one']);
    await a.secrets.putBack({ kind: 'passwords', id: version.id, item: null });
    expect(a.held.passwords).toEqual([]);
  });

  it('an authenticator account arriving under a local id another account has gets a new one', async () => {
    const a = device({ authenticator: [account({ id: 'same', label: 'mine', secret: 'MZXW6YTBOI' })] });
    const b = device({ authenticator: [account({ id: 'same' })] });
    const theirs = await b.secrets.sealKinds(['authenticator']);
    const mine = await a.secrets.sealKinds(['authenticator']);
    await a.secrets.applyKinds({ authenticator: [...mine.authenticator, ...theirs.authenticator] });
    expect(a.held.authenticator).toHaveLength(2);
    expect(new Set(a.held.authenticator.map(e => e.id)).size).toBe(2);
  });
});

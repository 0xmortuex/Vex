// @vitest-environment node
//
// The password vault. It had no tests of its own, and it is the single most
// sensitive thing Vex stores.
//
// What these pin is mostly about what must NOT happen: passwords must not
// leave the main process except on the one channel meant for it, a vault that
// cannot be encrypted must refuse to save rather than fall back to plaintext,
// and the popup autofill must not hand a credential to a look-alike host.

import { describe, it, expect, beforeEach, vi } from 'vitest';

const os = require('os');
const path = require('path');
const fs = require('fs');
const { createVaultService } = require('../../src/main/vault.js');

let dir;
let handlers;
let encryptionAvailable;
let encryptFails;

function build() {
  handlers = {};
  const ipcMain = {
    handle: (channel, fn) => { handlers[channel] = fn; },
    on: () => {},
  };
  const safeStorage = {
    isEncryptionAvailable: () => encryptionAvailable,
    // Reversible stand-in for the OS keychain, so the round trip is real.
    encryptString: (s) => {
      if (encryptFails) throw new Error('keychain locked');
      return Buffer.from('enc:' + s, 'utf8');
    },
    decryptString: (buf) => {
      const s = buf.toString('utf8');
      if (!s.startsWith('enc:')) throw new Error('not encrypted by us');
      return s.slice(4);
    },
  };
  const app = { getPath: () => dir };
  return createVaultService({ app, safeStorage, ipcMain });
}

const call = (channel, ...args) => handlers[channel]({ sender: {} }, ...args);

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vex-vault-'));
  encryptionAvailable = true;
  encryptFails = false;
  build();
});

describe('what crosses the IPC boundary', () => {
  beforeEach(async () => {
    await call('vault:save', { host: 'github.com', username: 'me', password: 'correct horse battery' });
    await call('vault:save', { host: 'gitlab.com', username: 'me', password: 'correct horse battery' });
    await call('vault:save', { host: 'weak.example', username: 'me', password: '123456' });
  });

  it('vault:list gives metadata and no passwords at all', () => {
    const list = call('vault:list');
    expect(list).toHaveLength(3);
    for (const entry of list) {
      expect(Object.keys(entry).sort()).toEqual(['host', 'updatedAt', 'username']);
    }
    expect(JSON.stringify(list)).not.toContain('correct horse battery');
    expect(JSON.stringify(list)).not.toContain('123456');
  });

  it('vault:health reports the problem without ever naming the password', () => {
    const health = call('vault:health');
    expect(health.total).toBe(3);
    expect(health.reused[0].count).toBe(2);
    expect(health.weak.map(w => w.host)).toContain('weak.example');
    const serialized = JSON.stringify(health);
    expect(serialized).not.toContain('correct horse battery');
    expect(serialized).not.toContain('123456');
  });

  it('vault:get is the one channel that returns a password, and only for that host', () => {
    expect(call('vault:get', 'github.com')[0].password).toBe('correct horse battery');
    expect(call('vault:get', 'gitlab.com')).toHaveLength(1);
    expect(call('vault:get', 'nothing-saved.example')).toEqual([]);
    expect(call('vault:get', '')).toEqual([]);
    expect(call('vault:get', null)).toEqual([]);
  });

  it('does not match a host by prefix or suffix', () => {
    // "github.com.evil.test" and "ithub.com" must not collect github's login.
    expect(call('vault:get', 'github.com.evil.test')).toEqual([]);
    expect(call('vault:get', 'ithub.com')).toEqual([]);
    expect(call('vault:get', 'GITHUB.COM')).toEqual([]);
  });
});

describe('refusing to write plaintext', () => {
  it('will not save when the OS cannot encrypt', async () => {
    encryptionAvailable = false;
    const r = await call('vault:save', { host: 'a.example', username: 'u', password: 'p' });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/encryption unavailable/i);
    expect(fs.existsSync(path.join(dir, 'vault.dat'))).toBe(false);
  });

  it('never writes the password in readable form', async () => {
    await call('vault:save', { host: 'a.example', username: 'u', password: 'plaintext-marker' });
    const onDisk = fs.readFileSync(path.join(dir, 'vault.dat'));
    // Our stand-in prefixes rather than truly encrypting, so this checks the
    // bytes went through safeStorage at all rather than straight to disk.
    expect(onDisk.toString('utf8').startsWith('enc:')).toBe(true);
  });

  it('reports an encryption failure rather than half-saving', async () => {
    encryptFails = true;
    const r = await call('vault:save', { host: 'a.example', username: 'u', password: 'p' });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/keychain locked/);
  });
});

describe('saving and updating', () => {
  it('updates the existing login instead of storing a second copy', async () => {
    await call('vault:save', { host: 'a.example', username: 'u', password: 'first' });
    const r = await call('vault:save', { host: 'a.example', username: 'u', password: 'second' });
    expect(r.updated).toBe(true);
    const entries = call('vault:get', 'a.example');
    expect(entries).toHaveLength(1);
    expect(entries[0].password).toBe('second');
  });

  it('keeps two accounts on the same site apart', async () => {
    await call('vault:save', { host: 'a.example', username: 'one', password: 'p1' });
    await call('vault:save', { host: 'a.example', username: 'two', password: 'p2' });
    expect(call('vault:get', 'a.example')).toHaveLength(2);
  });

  it('refuses an incomplete entry', async () => {
    for (const entry of [{}, { host: 'a' }, { host: 'a', username: 'u' }, null]) {
      expect((await call('vault:save', entry)).ok, JSON.stringify(entry)).toBe(false);
    }
  });

  it('deletes only the login asked for', async () => {
    await call('vault:save', { host: 'a.example', username: 'one', password: 'p1' });
    await call('vault:save', { host: 'a.example', username: 'two', password: 'p2' });
    await call('vault:delete', { host: 'a.example', username: 'one' });
    const left = call('vault:get', 'a.example');
    expect(left).toHaveLength(1);
    expect(left[0].username).toBe('two');
  });

  it('survives a restart — the vault is read back from disk', async () => {
    await call('vault:save', { host: 'a.example', username: 'u', password: 'kept' });
    build();                                   // a fresh service, empty cache
    expect(call('vault:get', 'a.example')[0].password).toBe('kept');
  });
});

describe('a vault that cannot be read', () => {
  it('says so rather than reporting an empty vault', async () => {
    await call('vault:save', { host: 'a.example', username: 'u', password: 'p' });
    fs.writeFileSync(path.join(dir, 'vault.dat'), Buffer.from('not ours', 'utf8'));
    build();
    // Silently returning [] would look exactly like "you have no passwords",
    // and the next save would write over the file that still holds them.
    expect(() => call('vault:list')).toThrow(/Cannot read encrypted vault/);
  });

  it('an empty vault is not an error', () => {
    expect(call('vault:list')).toEqual([]);
    expect(call('vault:health').total).toBe(0);
  });
});

describe('what counts as weak', () => {
  const weakFor = async (password) => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vex-vault-'));
    build();
    await call('vault:save', { host: 'a.example', username: 'u', password });
    return call('vault:health').weak[0]?.reasons || [];
  };

  it('flags short, digits-only and well-known passwords', async () => {
    expect(await weakFor('abc')).toContain('too short');
    expect(await weakFor('1234567890')).toContain('digits only');
    expect(await weakFor('Password')).toContain('common password');
  });

  it('leaves a decent password alone', async () => {
    expect(await weakFor('7Gq!vex-longer-phrase')).toEqual([]);
  });
});

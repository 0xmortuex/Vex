// @vitest-environment node
// The breach check is rate limited: one run per cooldown, failed runs included.
// The range API is a stand-in; it is never called live from a test.
import { describe, it, expect, vi } from 'vitest';

const os = require('os');
const path = require('path');
const fs = require('fs');
const { createVaultService } = require('../../src/main/vault.js');

function build({ fetchRange, t }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vex-vault-cool-'));
  const handlers = {};
  const ipcMain = { handle: (c, fn) => { handlers[c] = fn; }, on: () => {} };
  const safeStorage = { isEncryptionAvailable: () => true, encryptString: (s) => Buffer.from('enc:' + s), decryptString: (b) => b.toString('utf8').slice(4) };
  createVaultService({ app: { getPath: () => dir }, safeStorage, ipcMain, breachCheckOn: () => true, fetchRange, breachCooldownMs: 60000, breachNow: () => t.now });
  return (c, ...a) => handlers[c]({ sender: {} }, ...a);
}

describe('breach check rate limit', () => {
  it('refuses a second run inside the cooldown without asking the API again', async () => {
    const t = { now: 1_000_000 };
    const fetchRange = vi.fn(async () => '');
    const call = build({ fetchRange, t });
    await call('vault:save', { host: 'a.example', username: 'me', password: 'pw-one' });
    await call('vault:breach-check');
    expect(fetchRange).toHaveBeenCalledTimes(1);
    t.now += 10000;
    await expect(call('vault:breach-check')).rejects.toThrow(/Wait 50 seconds/);
    expect(fetchRange).toHaveBeenCalledTimes(1);
    t.now += 60000;
    await call('vault:breach-check');
    expect(fetchRange).toHaveBeenCalledTimes(2);
  });

  it('counts a failed run too', async () => {
    const t = { now: 5_000 };
    const fetchRange = vi.fn(async () => { throw new Error('Have I Been Pwned answered 503'); });
    const call = build({ fetchRange, t });
    await call('vault:save', { host: 'a.example', username: 'me', password: 'pw-one' });
    await expect(call('vault:breach-check')).rejects.toThrow('503');
    await expect(call('vault:breach-check')).rejects.toThrow(/Wait/);
    expect(fetchRange).toHaveBeenCalledTimes(1);
  });
});

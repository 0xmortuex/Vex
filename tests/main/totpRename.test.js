// @vitest-environment node
//
// totp:rename (main/totp-transfer.js): changes the name and account an
// authenticator entry shows, never its secret, and only when unlocked.

import { describe, it, expect, beforeEach } from 'vitest';
const { registerTotpTransfer } = require('../../src/main/totp-transfer.js');
const { validate } = require('../../src/main/ipc-schemas.js');

let handlers; let store; let locked; let saved;
beforeEach(() => {
  handlers = {}; locked = false; saved = 0;
  store = [{ id: 'a1', label: 'Account', issuer: '', secret: 'JBSWY3DPEHPK3PXP', algorithm: 'sha1', digits: 6, period: 30 }];
  registerTotpTransfer({
    ipcMain: { handle: (c, fn) => { handlers[c] = fn; } }, dialog: null, app: null, windowFor: () => null,
    load: () => structuredClone(store), save: async (arr) => { saved++; store = arr; }, validate: () => {}, isLocked: () => locked,
  });
});
const rename = (...a) => handlers['totp:rename']({}, ...a);

describe('totp:rename', () => {
  it('changes the name and account and leaves the secret alone', async () => {
    expect(await rename('a1', '  GitHub ', 'me@x.test')).toEqual({ ok: true });
    expect(store[0]).toMatchObject({ issuer: 'GitHub', label: 'me@x.test', secret: 'JBSWY3DPEHPK3PXP' });
  });
  it('an empty account falls back to the service name', async () => {
    await rename('a1', 'GitHub', '');
    expect(store[0]).toMatchObject({ issuer: 'GitHub', label: 'GitHub' });
  });
  it('refuses an empty name, an unknown account, and a locked Vex', async () => {
    expect((await rename('a1', ' ', ' ')).ok).toBe(false);
    expect((await rename('nope', 'X', 'Y')).ok).toBe(false);
    expect(saved).toBe(0);
    locked = true;
    await expect(rename('a1', 'X', 'Y')).rejects.toThrow(/locked/);
  });
  it('the channel has a schema', () => {
    expect(() => validate('totp:rename', ['a1', 'GitHub', 'me'])).not.toThrow();
    expect(() => validate('totp:rename', ['a1', 'GitHub'])).toThrow(/Invalid payload/);
    expect(() => validate('totp:rename', ['a1', 5, 'me'])).toThrow(/Invalid payload/);
  });
});

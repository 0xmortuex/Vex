// @vitest-environment node
//
// Password Health's pattern checks (src/main/password-strength.js) and the
// "not changed in a year" list that vault:health returns. Worked out in main;
// only reasons and hosts ever leave it, never a password.

import { describe, it, expect, beforeEach } from 'vitest';

const os = require('os');
const path = require('path');
const fs = require('fs');
const { weakReasons, ageDays } = require('../../src/main/password-strength.js');
const { createVaultService } = require('../../src/main/vault.js');

describe('weakReasons', () => {
  const r = (password, host = 'example.org', username = 'someone@mail.test') => weakReasons({ password, host, username });

  it('keeps flagging what it always did', () => {
    expect(r('abc')).toContain('too short');
    expect(r('1234567890')).toContain('digits only');
    expect(r('Password')).toContain('common password');
  });

  it('catches a common password with a number or symbol added', () => {
    expect(r('Password99!')).toContain('a common password with a small change');
    expect(r('Sunshine2024')).toContain('a common password with a small change');
    expect(r('Dr4gon!!')).toContain('a common password with a small change');
  });

  it('catches repeats and simple sequences', () => {
    expect(r('aaaaaaaaaa')).toContain('one character repeated');
    expect(r('abababababab')).toContain('only two different characters');
    expect(r('abcdefghij')).toContain('a simple sequence');
    expect(r('987654321')).toContain('a simple sequence');
    expect(r('asdfghjkl')).toContain('a simple sequence');
  });

  it('catches the username and the site name inside a short password', () => {
    expect(r('someone', 'example.org', 'someone@mail.test')).toContain('same as the username');
    expect(r('someone@mail.test', 'example.org', 'someone@mail.test')).toContain('same as the username');
    expect(r('someone!2024', 'example.org', 'someone@mail.test')).toContain('contains the username');
    expect(r('Github-2024-x', 'www.github.com', 'u')).toContain('contains the site name');
  });

  it('does not flag a long or varied password for containing a name', () => {
    expect(r('correct-horse-github-staple-battery', 'github.com', 'u')).toEqual([]);
    expect(r('7Gq!vex-longer-phrase')).toEqual([]);
    expect(r('')).toEqual([]);
  });
});

describe('ageDays', () => {
  it('counts whole days, and says null when the date is unknown', () => {
    const now = Date.parse('2026-10-12T00:00:00Z');
    expect(ageDays('2026-10-10T00:00:00Z', now)).toBe(2);
    expect(ageDays(undefined, now)).toBeNull();
    expect(ageDays('not a date', now)).toBeNull();
    expect(ageDays('2027-01-01T00:00:00Z', now)).toBe(0);
  });
});

describe('vault:health old passwords', () => {
  let dir; let handlers;
  const call = (channel, ...args) => handlers[channel]({ sender: {} }, ...args);
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vex-vault-age-'));
    handlers = {};
    const ipcMain = { handle: (c, fn) => { handlers[c] = fn; }, on: () => {} };
    const safeStorage = {
      isEncryptionAvailable: () => true,
      encryptString: (s) => Buffer.from('enc:' + s, 'utf8'),
      decryptString: (b) => b.toString('utf8').slice(4),
    };
    createVaultService({ app: { getPath: () => dir }, safeStorage, ipcMain });
  });

  it('lists a password unchanged for a year, oldest first, without the password', async () => {
    await call('vault:save', { host: 'fresh.example', username: 'me', password: 'N3w-long-unique-secret' });
    await call('vault:save', { host: 'stale.example', username: 'me', password: 'Another-long-unique-secret' });
    await call('vault:save', { host: 'ancient.example', username: 'me', password: 'Third-long-unique-secret!' });
    const file = path.join(dir, 'vault.dat');
    const arr = JSON.parse(fs.readFileSync(file, 'utf8').slice(4));
    const daysAgo = (n) => new Date(Date.now() - n * 86400000).toISOString();
    arr.find(e => e.host === 'stale.example').updatedAt = daysAgo(400);
    arr.find(e => e.host === 'ancient.example').updatedAt = daysAgo(1200);
    fs.writeFileSync(file, Buffer.from('enc:' + JSON.stringify(arr), 'utf8'));
    createVaultService({
      app: { getPath: () => dir },
      safeStorage: { isEncryptionAvailable: () => true, encryptString: (s) => Buffer.from('enc:' + s), decryptString: (b) => b.toString('utf8').slice(4) },
      ipcMain: { handle: (c, fn) => { handlers[c] = fn; }, on: () => {} },
    });
    const health = call('vault:health');
    expect(health.old.map(o => o.host)).toEqual(['ancient.example', 'stale.example']);
    expect(health.old[0].days).toBeGreaterThanOrEqual(1200);
    expect(JSON.stringify(health)).not.toContain('unique-secret');
  });
});

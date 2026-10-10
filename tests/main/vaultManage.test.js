// @vitest-environment node
// Settings › Passwords basics, main side: a note saved with a login, editing a
// login (username, password, note), and the CSV export in Chrome's format,
// written by main after the person picks where.
import { describe, it, expect, beforeEach } from 'vitest';

const os = require('os');
const path = require('path');
const fs = require('fs');
const { createVaultService } = require('../../src/main/vault.js');

let dir, handlers, picked, service;
function build() {
  handlers = {};
  const ipcMain = { handle: (channel, fn) => { handlers[channel] = fn; }, on: () => {} };
  const safeStorage = {
    isEncryptionAvailable: () => true,
    encryptString: (s) => Buffer.from('enc:' + s, 'utf8'),
    decryptString: (b) => b.toString('utf8').slice(4),
  };
  const app = { getPath: () => dir };
  const dialog = { showSaveDialog: async (_win, opts) => { picked = opts; return { canceled: false, filePath: path.join(dir, 'out.csv') }; } };
  return createVaultService({ app, safeStorage, ipcMain, dialog, windowFor: () => ({}) });
}
const call = (channel, ...args) => handlers[channel]({ sender: {} }, ...args);

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vex-vault-manage-'));
  picked = null;
  service = build();
});

describe('notes and edits', () => {
  it('keeps a note given with a new login; vault:get returns it, vault:list does not', async () => {
    expect(await call('vault:save', { host: 'a.example', username: 'me', password: 'p1', note: 'recovery: 1234' })).toEqual({ ok: true, updated: false });
    expect((await call('vault:get', 'a.example'))[0]).toMatchObject({ username: 'me', password: 'p1', note: 'recovery: 1234' });
    expect(Object.keys((await call('vault:list'))[0]).sort()).toEqual(['host', 'updatedAt', 'username']);
  });

  it('edits the username, the password and the note; an empty password keeps the old one; an empty note removes it', async () => {
    await call('vault:save', { host: 'a.example', username: 'me', password: 'p1', note: 'n' });
    expect(await call('vault:update', { host: 'a.example', username: 'me', newUsername: 'me2', password: '', note: 'n2' })).toEqual({ ok: true });
    expect(await call('vault:get', 'a.example')).toMatchObject([{ username: 'me2', password: 'p1', note: 'n2' }]);
    expect(await call('vault:update', { host: 'a.example', username: 'me2', newUsername: 'me2', password: 'p2', note: '' })).toEqual({ ok: true });
    const [e] = await call('vault:get', 'a.example');
    expect(e.password).toBe('p2');
    expect('note' in e).toBe(false);
  });

  it('refuses to rename onto another saved login, or to edit one that is gone', async () => {
    await call('vault:save', { host: 'a.example', username: 'one', password: 'p1' });
    await call('vault:save', { host: 'a.example', username: 'two', password: 'p2' });
    expect(await call('vault:update', { host: 'a.example', username: 'one', newUsername: 'two' })).toEqual({ ok: false, error: 'There is already a saved login for two on a.example' });
    expect(await call('vault:update', { host: 'a.example', username: 'zzz', newUsername: 'zzz' })).toEqual({ ok: false, error: 'That saved login is no longer in the vault' });
    expect((await call('vault:get', 'a.example')).map(e => e.password)).toEqual(['p1', 'p2']);
  });
});

describe('CSV export', () => {
  it('writes Chrome\'s format, quoting what needs it, where the person picked', async () => {
    await call('vault:save', { host: 'a.example', username: 'me', password: 'p,1"x', note: 'line1\nline2' });
    await call('vault:save', { host: 'b.example', username: 'you', password: 'plain' });
    const r = await call('vault:export-csv');
    expect(r).toEqual({ ok: true, count: 2, path: path.join(dir, 'out.csv') });
    expect(picked.filters).toEqual([{ name: 'CSV', extensions: ['csv'] }]);
    expect(fs.readFileSync(path.join(dir, 'out.csv'), 'utf8')).toBe(
      'name,url,username,password,note\r\n' +
      'a.example,https://a.example/,me,"p,1""x","line1\nline2"\r\n' +
      'b.example,https://b.example/,you,plain,\r\n');
  });

  it('the export reads back through Vex\'s own CSV import unchanged', async () => {
    await call('vault:save', { host: 'a.example', username: 'me', password: 'p,1"x' });
    await call('vault:export-csv');
    const { credentialsFromCsv } = require('../../src/main/browser-import.js');
    const parsed = credentialsFromCsv(fs.readFileSync(path.join(dir, 'out.csv'), 'utf8'));
    expect(parsed.entries).toEqual([{ host: 'a.example', username: 'me', password: 'p,1"x' }]);
  });

  it('says so when there is nothing to export, and writes nothing when the dialog is cancelled', async () => {
    expect(await call('vault:export-csv')).toEqual({ ok: false, error: 'There are no saved passwords to export' });
    await call('vault:save', { host: 'a.example', username: 'me', password: 'p' });
    service = (() => {
      handlers = {};
      const ipcMain = { handle: (c, fn) => { handlers[c] = fn; }, on: () => {} };
      return createVaultService({ app: { getPath: () => dir }, ipcMain,
        safeStorage: { isEncryptionAvailable: () => true, encryptString: (s) => Buffer.from('enc:' + s), decryptString: (b) => b.toString('utf8').slice(4) },
        dialog: { showSaveDialog: async () => ({ canceled: true }) }, windowFor: () => ({}) });
    })();
    expect(await call('vault:export-csv')).toEqual({ ok: false, canceled: true });
    expect(fs.existsSync(path.join(dir, 'out.csv'))).toBe(false);
  });
});

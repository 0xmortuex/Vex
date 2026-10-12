// @vitest-environment node
//
// Password CSVs from other password managers: Bitwarden's several addresses
// in one cell and its login_totp, a note column, KeePass's "Login Name",
// Firefox's password-changed date, and 2FA keys going to the Authenticator.

import { describe, it, expect, vi, beforeEach } from 'vitest';
const fs = require('fs'), os = require('os'), path = require('path');
const bi = require('../../src/main/browser-import.js');
const { createVaultService } = require('../../src/main/vault.js');

describe('credentialsFromCsv, other managers', () => {
  it('takes the first website of a Bitwarden cell that lists several addresses', () => {
    const csv = 'folder,favorite,type,name,notes,fields,reprompt,login_uri,login_username,login_password,login_totp\n'
      + ',,login,Bank,"remember: blue card",,0,"androidapp://com.bank\nhttps://www.bank.test/login\nhttps://bank.test/other",me,pw1,\n';
    const r = bi.credentialsFromCsv(csv);
    expect(r.entries).toEqual([{ host: 'bank.test', username: 'me', password: 'pw1', note: 'remember: blue card' }]);
    expect(r.notWeb).toBe(0);
  });

  it('reads KeePass "Login Name" and a Chrome note', () => {
    const kp = bi.credentialsFromCsv('"Account","Login Name","Password","Web Site","Comments"\n"A","kate","kp-pass","https://a.test/","hi"\n');
    expect(kp.entries).toEqual([{ host: 'a.test', username: 'kate', password: 'kp-pass', note: 'hi' }]);
    const ch = bi.credentialsFromCsv('name,url,username,password,note\nx,https://b.test/,u,p,"two\nlines"\n');
    expect(ch.entries[0].note).toBe('two\nlines');
  });

  it('keeps Firefox\'s password-changed date, and ignores one that is not believable', () => {
    const when = Date.UTC(2022, 2, 4, 5, 6, 7);
    const csv = '"url","username","password","timePasswordChanged"\n'
      + `"https://old.test","u","p","${when}"\n`
      + '"https://zero.test","u","p","0"\n'
      + `"https://future.test","u","p","${Date.now() + 86400000 * 400}"\n`;
    const r = bi.credentialsFromCsv(csv);
    expect(r.entries[0].updatedAt).toBe('2022-03-04T05:06:07.000Z');
    expect(r.entries[1].updatedAt).toBeUndefined();
    expect(r.entries[2].updatedAt).toBeUndefined();
  });

  it('collects 2FA keys: otpauth links and bare secrets; counts what it cannot use', () => {
    const csv = 'name,login_uri,login_username,login_password,login_totp\n'
      + 'a,https://a.test/,ann,p1,"otpauth://totp/A%20Corp:ann@a.test?secret=jbsw y3dp-ehpk3pxp&issuer=A%20Corp&digits=8&period=60&algorithm=SHA256"\n'
      + 'b,https://b.test/,bob,p2,JBSWY3DPEHPK3PXP\n'
      + 'c,https://c.test/,cy,p3,steam://ABCDEFGH\n'
      + 'd,https://d.test/,di,p4,otpauth://hotp/D?secret=JBSWY3DPEHPK3PXP&counter=1\n'
      + 'e,https://e.test/,ed,p5,\n';
    const r = bi.credentialsFromCsv(csv);
    expect(r.entries).toHaveLength(5);
    expect(r.totp).toEqual([
      { label: 'ann@a.test', issuer: 'A Corp', secret: 'JBSWY3DPEHPK3PXP', algorithm: 'sha256', digits: 8, period: 60 },
      { label: 'bob', issuer: 'b.test', secret: 'JBSWY3DPEHPK3PXP', algorithm: 'sha1', digits: 6, period: 30 },
    ]);
    expect(r.totpUnsupported).toBe(2);
  });
});

describe('importPasswordCsv with 2FA keys', () => {
  let file;
  beforeEach(() => {
    file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'vex-csv-totp-')), 'bitwarden.csv');
    fs.writeFileSync(file, 'name,login_uri,login_username,login_password,login_totp\nb,https://b.test/,bob,p2,JBSWY3DPEHPK3PXP\n');
  });
  const dialog = () => ({ showOpenDialog: async () => ({ canceled: false, filePaths: [file] }) });

  it('sends the keys to the authenticator and returns only counts', async () => {
    const addToVault = vi.fn(async () => ({ added: [{ host: 'b.test', username: 'bob' }], duplicates: 0 }));
    const addAuthenticator = vi.fn(async () => ({ added: 1, duplicates: 0, invalid: 0 }));
    const r = await bi.importPasswordCsv({ dialog: dialog(), win: null, addToVault, addAuthenticator });
    expect(addAuthenticator).toHaveBeenCalledOnce();
    expect(r.totp).toEqual({ added: 1, duplicates: 0, invalid: 0, unsupported: 0 });
    expect(JSON.stringify(r)).not.toContain('JBSWY3DPEHPK3PXP');
  });

  it('reports a failure inside the result so the logins can still be undone', async () => {
    const addToVault = vi.fn(async () => ({ added: [{ host: 'b.test', username: 'bob' }], duplicates: 0 }));
    const addAuthenticator = vi.fn(async () => { throw new Error('Vex is locked'); });
    const r = await bi.importPasswordCsv({ dialog: dialog(), win: null, addToVault, addAuthenticator });
    expect(r.added).toHaveLength(1);
    expect(r.totp.error).toBe('Vex is locked');
  });
});

describe('vault addMissing keeps the note and the file\'s date', () => {
  it('stores them and reports the same date for Undo', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vex-vault-imp-'));
    const handlers = {};
    const svc = createVaultService({
      app: { getPath: () => dir },
      safeStorage: { isEncryptionAvailable: () => true, encryptString: (s) => Buffer.from('enc:' + s), decryptString: (b) => b.toString('utf8').slice(4) },
      ipcMain: { handle: (c, fn) => { handlers[c] = fn; }, on: () => {} },
    });
    const r = await svc.addMissing([{ host: 'a.test', username: 'u', password: 'p', note: 'a note', updatedAt: '2021-01-02T00:00:00.000Z' }]);
    expect(r.added).toEqual([{ host: 'a.test', username: 'u', updatedAt: '2021-01-02T00:00:00.000Z' }]);
    const saved = svc.load();
    expect(saved[0]).toMatchObject({ note: 'a note', updatedAt: '2021-01-02T00:00:00.000Z' });
    expect(handlers['vault:list']({})[0].updatedAt).toBe('2021-01-02T00:00:00.000Z');
  });
});

// @vitest-environment node
//
// Saved passwords and 2FA codes between the phone and the computer (spec
// §4.9), on a real account: the shipping worker, the desktop engine with its
// own main-process sealing (src/main/sync-secrets.js), and the phone's vault
// and sync. Off until turned on, sealed item by item, the newer change wins,
// a join never removes a password, and a phone whose logins are locked
// neither loses nor overwrites anything.
import { describe, it, expect, beforeEach } from 'vitest';
import { standIn, desktop, phone, codeFor, accountDocument } from './sync-harness.mjs';

const EMAIL = 'keys@example.com';
const SECRET = 'JBSWY3DPEHPK3PXP';
let stand, pc, recovery;

const iso = ms => new Date(ms).toISOString();

async function desktopWithPasswords() {
  pc = desktop(stand);
  pc.local.set('vex.syncChoices', JSON.stringify({ passwords: true, authenticator: true }));
  pc.vault.passwords = [
    { host: 'github.com', username: 'octo', password: 'pc-pass-1', updatedAt: iso(Date.now() - 86400000) },
    { host: 'mail.example', username: 'me', password: 'mail-pass', updatedAt: iso(Date.now() - 86400000) }
  ];
  pc.vault.authenticator = [
    { id: 'acc-1', label: 'octo', issuer: 'GitHub', secret: SECRET, algorithm: 'sha1', digits: 6, period: 30, created: iso(Date.now() - 86400000) }
  ];
  const made = await pc.engine.verifyCode(EMAIL, await codeFor(pc, EMAIL), 'PC');
  recovery = made.recoveryCode;
  expect((await pc.engine.pushNow()).ok).toBe(true);
}

async function phoneWithPasswords({ before } = {}) {
  const mobile = phone(stand);
  await mobile.sync.setWorkerUrl(stand.base);
  if (before) await before(mobile);
  expect((await mobile.sync.signIn(EMAIL, await codeFor(mobile, EMAIL), recovery)).ok).toBe(true);
  await mobile.sync.setSecretKind('passwords', true);
  await mobile.sync.setSecretKind('authenticator', true);
  await mobile.logins.unlock();
  expect((await mobile.sync.syncNow()).ok).toBe(true);
  return mobile;
}

const byHost = (mobile, host) => mobile.logins.all().filter(entry => entry.host === host);

beforeEach(() => { stand = standIn(); });

describe('from the computer to the phone', () => {
  it('brings the logins and the 2FA account, the code on the login it belongs to', async () => {
    await desktopWithPasswords();
    const mobile = await phoneWithPasswords();
    const github = byHost(mobile, 'github.com');
    expect(github).toHaveLength(1);
    expect(github[0]).toMatchObject({ username: 'octo', password: 'pc-pass-1', secret: SECRET, digits: 6, period: 30 });
    expect(byHost(mobile, 'mail.example')[0].password).toBe('mail-pass');
    expect(await mobile.logins.totp(github[0].secret, mobile.logins.codeOptions(github[0])))
      .toBe(await mobile.logins.totp(SECRET));
  });

  it('never puts a password or a 2FA secret in the document in readable form', async () => {
    await desktopWithPasswords();
    await phoneWithPasswords();
    const { text } = await accountDocument(stand, recovery);
    expect(text).not.toContain('pc-pass-1');
    expect(text).not.toContain(SECRET);
    expect(text).not.toContain('github.com');
  });

  it('nothing moves until the kind is turned on, and the account’s sealed records go round untouched', async () => {
    await desktopWithPasswords();
    const mobile = phone(stand);
    await mobile.sync.setWorkerUrl(stand.base);
    expect((await mobile.sync.signIn(EMAIL, await codeFor(mobile, EMAIL), recovery)).ok).toBe(true);
    await mobile.logins.unlock();
    const before = (await accountDocument(stand, recovery)).doc;
    await mobile.bookmarks.add({ url: 'https://phone.example/', title: 'P' });
    expect((await mobile.sync.syncNow()).ok).toBe(true);
    expect(mobile.logins.all()).toHaveLength(0);
    const after = (await accountDocument(stand, recovery)).doc;
    for (const [key, record] of Object.entries(before.records)) {
      if (key.startsWith('["secret:')) expect(JSON.stringify(after.records[key])).toBe(JSON.stringify(record));
    }
  });
});

describe('from the phone to the computer', () => {
  it('a changed password, a new login and a deleted one all reach the computer', async () => {
    await desktopWithPasswords();
    const mobile = await phoneWithPasswords();
    const github = byHost(mobile, 'github.com')[0];
    await mobile.logins.update(github.id, { password: 'phone-pass-2' });
    await mobile.logins.save({ host: 'shop.example', username: 'buyer', password: 'shop-pass' });
    await mobile.logins.remove(byHost(mobile, 'mail.example')[0].id);
    expect((await mobile.sync.syncNow()).ok).toBe(true);
    expect((await pc.engine.pullNow()).ok).toBe(true);
    const hosts = Object.fromEntries(pc.vault.passwords.map(entry => [entry.host, entry.password]));
    expect(hosts).toEqual({ 'github.com': 'phone-pass-2', 'shop.example': 'shop-pass' });
    // The 2FA account stays as it was on the computer.
    expect(pc.vault.authenticator).toHaveLength(1);
    expect(pc.vault.authenticator[0]).toMatchObject({ id: 'acc-1', secret: SECRET });
  });

  it('a 2FA secret added on the phone becomes an authenticator account on the computer', async () => {
    await desktopWithPasswords();
    const mobile = await phoneWithPasswords();
    await mobile.logins.save({ host: 'bank.example', username: 'me', password: 'bank-pass', secret: 'GEZDGNBVGY3TQOJQ' });
    expect((await mobile.sync.syncNow()).ok).toBe(true);
    expect((await pc.engine.pullNow()).ok).toBe(true);
    const account = pc.vault.authenticator.find(item => item.secret === 'GEZDGNBVGY3TQOJQ');
    expect(account).toMatchObject({ label: 'me', issuer: 'bank.example', algorithm: 'sha1', digits: 6, period: 30 });
    // And back again, nothing changes: the same items, sealed the same way.
    const revision = stand.blob().revision;
    expect((await pc.engine.pushNow()).ok).toBe(true);
    expect((await mobile.sync.syncNow()).ok).toBe(true);
    expect(byHost(mobile, 'bank.example')).toHaveLength(1);
    expect(stand.blob().revision - revision).toBeLessThanOrEqual(1);
  });
});

describe('deleted on the computer', () => {
  it('goes from the phone too — a login with a 2FA code keeps its code', async () => {
    await desktopWithPasswords();
    const mobile = await phoneWithPasswords();
    pc.vault.passwords = pc.vault.passwords.filter(entry => entry.host !== 'github.com' && entry.host !== 'mail.example');
    expect((await pc.engine.pushNow()).ok).toBe(true);
    expect((await mobile.sync.syncNow()).ok).toBe(true);
    expect(byHost(mobile, 'mail.example')).toHaveLength(0);
    const github = byHost(mobile, 'github.com');
    expect(github).toHaveLength(1);
    expect(github[0]).toMatchObject({ password: '', secret: SECRET });
  });
});

describe('with the phone’s logins locked', () => {
  it('syncs everything else, carries the sealed records through, and then takes the computer’s newer change instead of its stale copy', async () => {
    await desktopWithPasswords();
    const mobile = await phoneWithPasswords();
    mobile.logins.lock();
    pc.vault.passwords = pc.vault.passwords.map(entry => entry.host === 'github.com'
      ? { ...entry, password: 'pc-pass-NEW', updatedAt: iso(Date.now()) } : entry);
    expect((await pc.engine.pushNow()).ok).toBe(true);
    await mobile.bookmarks.add({ url: 'https://while-locked.example/', title: 'W' });
    expect((await mobile.sync.syncNow()).ok).toBe(true);           // locked: bookmarks still go
    expect((await pc.engine.pullNow()).ok).toBe(true);
    expect(JSON.parse(pc.local.get('vex.bookmarks')).some(item => item.url === 'https://while-locked.example/')).toBe(true);
    expect(pc.vault.passwords.find(entry => entry.host === 'github.com').password).toBe('pc-pass-NEW');
    await mobile.logins.unlock();
    expect((await mobile.sync.syncNow()).ok).toBe(true);
    expect(byHost(mobile, 'github.com')[0].password).toBe('pc-pass-NEW');
    expect((await pc.engine.pullNow()).ok).toBe(true);
    expect(pc.vault.passwords.find(entry => entry.host === 'github.com').password).toBe('pc-pass-NEW');
  });
});

describe('turning it on is a join', () => {
  it('the newer of two versions of one login wins, and a login only the phone has is kept and sent', async () => {
    await desktopWithPasswords();
    const mobile = await phoneWithPasswords({
      before: async m => {
        await m.logins.unlock();
        await m.logins.save({ host: 'github.com', username: 'octo', password: 'phone-newer' });
        await m.logins.save({ host: 'only-phone.example', username: 'x', password: 'mine' });
      }
    });
    expect(byHost(mobile, 'github.com')[0].password).toBe('phone-newer');
    expect((await pc.engine.pullNow()).ok).toBe(true);
    const hosts = Object.fromEntries(pc.vault.passwords.map(entry => [entry.host, entry.password]));
    expect(hosts['github.com']).toBe('phone-newer');
    expect(hosts['only-phone.example']).toBe('mine');
  });
});

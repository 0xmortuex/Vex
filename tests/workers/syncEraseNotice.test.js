// After POST /sync/reset (start over without the key) or DELETE /sync/all,
// the worker emails the account's address (SYNC_PROTOCOL.md §2.9): plain text,
// when and from which device, what to do if it was not them. Sent the way the
// sign-in code is (Resend), limited like it, with no data or keys in it, and
// only to an address whose HMAC is the account. The worker never stores it.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { syncSystem } from './syncHarness.js';

const enc = new TextEncoder();
const toHex = buf => Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
const fromHex = h => new Uint8Array(h.match(/../g).map(b => parseInt(b, 16)));
async function authKeyOf(syncKeyHex) {
  const ikm = await crypto.subtle.importKey('raw', fromHex(syncKeyHex), 'HKDF', false, ['deriveBits']);
  return toHex(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: enc.encode('vex-sync auth key v1') }, ikm, 256));
}
async function mac(keyHex, message) {
  const key = await crypto.subtle.importKey('raw', fromHex(keyHex), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return toHex(await crypto.subtle.sign('HMAC', key, enc.encode(message)));
}
const sha = async text => toHex(await crypto.subtle.digest('SHA-256', enc.encode(text)));
const KEY = '000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f';

async function proof(sys, session, action, details) {
  const c = (await sys.call('GET', '/sync/challenge', undefined, session.sessionToken)).body;
  const k = await authKeyOf(KEY);
  const h = { 'X-Vex-Proof': c.nonce + '.' + await mac(k, `vex-sync-proof/1\n${c.nonce}\n${session.deviceId}\n${action}\n${details}`) };
  if (!c.keyCheck) h['X-Vex-Auth-Key'] = k;
  return h;
}
const push = async (sys, s, rev, blob) => sys.call('POST', '/sync/push', { encryptedBlob: blob, baseRevision: rev }, s.sessionToken, await proof(sys, s, 'push', `${rev}\n${await sha(blob)}`));
const wipe = async (sys, s, body) => sys.call('DELETE', '/sync/all', body, s.sessionToken, await proof(sys, s, 'wipe', ''));
const reset = (sys, s, email) => sys.call('POST', '/sync/reset', { confirm: 'erase my synced data', email }, s.sessionToken);

let sent;
let realFetch;
beforeEach(() => {
  sent = [];
  realFetch = globalThis.fetch;
  globalThis.fetch = vi.fn(async (url, init) => {
    sent.push({ url: String(url), headers: init.headers, body: JSON.parse(init.body) });
    return new Response('{}', { status: 200 });
  });
});
afterEach(() => { globalThis.fetch = realFetch; });

// Signs in with the dev code, then turns email on: what a deployed worker does.
async function accountWithData(email, deviceName = 'Owner PC') {
  const sys = syncSystem();
  const owner = await sys.signIn(email, deviceName);
  expect((await push(sys, owner, 0, 'OWNER-CIPHERTEXT')).status).toBe(200);
  return { sys, owner };
}
const emailOn = sys => { sys.env.RESEND_API_KEY = 're_test'; sys.env.RESEND_FROM = 'Vex Sync <sync@vex.test>'; };

describe('the email after starting over', () => {
  it('goes to the address, in plain text, with the time in UTC and the device that did it', async () => {
    const email = 'Owner@Erase.test';
    const { sys } = await accountWithData(email);
    const lost = await sys.signIn(email, 'Kitchen PC');
    emailOn(sys);
    const r = await reset(sys, lost, email);
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ ok: true, notice: 'sent' });
    expect(sent).toHaveLength(1);
    const [mail] = sent;
    // The same way out as the sign-in code.
    expect(mail.url).toBe('https://api.resend.com/emails');
    expect(mail.headers.Authorization).toBe('Bearer re_test');
    expect(mail.body).toMatchObject({ from: 'Vex Sync <sync@vex.test>', to: email, subject: 'Your Vex Sync data was erased' });
    expect(mail.body.html).toBeUndefined();
    const text = mail.body.text;
    expect(text).toMatch(/^Your Vex Sync data was erased\.\n/);
    expect(text).toMatch(/At \d{4}-\d{2}-\d{2} \d{2}:\d{2} UTC, a device named "Kitchen PC" signed in to Vex Sync with a code sent to this address, erased everything synced to this account and started the account over/);
    expect(text).toContain('Settings › Vex Sync');
    expect(text).toContain('"I lost my recovery code: start over"');
    expect(text).toContain('change its password');
    // Nothing from the account: no blob, no key, no token, no device id.
    expect(text).not.toContain('OWNER-CIPHERTEXT');
    expect(text).not.toContain(lost.sessionToken);
    expect(text).not.toContain(lost.deviceId);
    expect(text).not.toContain(lost.emailHash);
    expect(text).not.toContain(await authKeyOf(KEY));
  });

  it('an unnamed device is "a device", and a name cannot add lines to the email', async () => {
    const email = 'names@erase.test';
    const { sys } = await accountWithData(email);
    const unnamed = await sys.signIn(email, '');
    emailOn(sys);
    await reset(sys, unnamed, email);
    expect(sent[0].body.text).toMatch(/UTC, a device signed in/);
    const sys2 = (await accountWithData('names2@erase.test')).sys;
    const odd = await sys2.signIn('names2@erase.test', 'PC\n\nClick http://evil.test');
    emailOn(sys2);
    await reset(sys2, odd, 'names2@erase.test');
    expect(sent[1].body.text).toContain('a device named "PC Click http://evil.test"');
  });

  it('is sent only to the account\'s own address, and the address is not kept', async () => {
    const email = 'own@erase.test';
    const { sys, owner } = await accountWithData(email);
    const lost = await sys.signIn(email, 'Lost key');
    emailOn(sys);
    const r = await reset(sys, lost, 'someone-else@erase.test');
    expect(r.body).toEqual({ ok: true, notice: 'no-address' });
    expect(sent).toEqual([]);
    const stored = JSON.stringify([...sys.accounts.get(owner.emailHash).entries()]) + JSON.stringify([...sys.global.entries()]);
    expect(stored.toLowerCase()).not.toContain('own@erase.test');
    expect(stored).not.toContain('someone-else');
  });

  it('a client that sends no address still starts over, without an email', async () => {
    const email = 'old@erase.test';
    const { sys } = await accountWithData(email);
    const lost = await sys.signIn(email, 'Old Vex');
    emailOn(sys);
    const r = await sys.call('POST', '/sync/reset', { confirm: 'erase my synced data' }, lost.sessionToken);
    expect(r.body).toEqual({ ok: true, notice: 'no-address' });
    expect(sent).toEqual([]);
  });

  it('without email delivery configured (a development worker) nothing is sent, and the reply says so', async () => {
    const email = 'dev@erase.test';
    const { sys } = await accountWithData(email);
    const lost = await sys.signIn(email, 'Dev');
    const r = await reset(sys, lost, email);
    expect(r.body).toEqual({ ok: true, notice: 'not-configured' });
    expect(sent).toEqual([]);
  });

  it('a failed delivery is in the reply and the log, and the account is erased all the same', async () => {
    const email = 'fails@erase.test';
    const { sys, owner } = await accountWithData(email);
    const lost = await sys.signIn(email, 'Lost key');
    emailOn(sys);
    globalThis.fetch = vi.fn(async () => new Response('{}', { status: 500 }));
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const r = await reset(sys, lost, email);
    expect(r.body).toEqual({ ok: true, notice: 'failed' });
    expect(errors.mock.calls.flat().join(' ')).toMatch(/erase notice could not be sent: Email delivery failed/);
    errors.mockRestore();
    expect((await sys.call('GET', '/sync/pull', undefined, owner.sessionToken)).status).toBe(401);
  });
});

describe('the email after erasing everything (DELETE /sync/all)', () => {
  it('says the data was erased, by which device, and how to start again', async () => {
    const email = 'wipe@erase.test';
    const { sys, owner } = await accountWithData(email, 'Desk PC');
    emailOn(sys);
    const r = await wipe(sys, owner, { email });
    expect(r.body).toEqual({ ok: true, notice: 'sent' });
    const text = sent[0].body.text;
    expect(text).toMatch(/UTC, a device named "Desk PC", signed in to this account with its sync key, erased everything synced to it\. Every device was signed out of sync\./);
    expect(text).toContain('Vex starts a new account with a new recovery code');
    expect(text).not.toContain('OWNER-CIPHERTEXT');
  });

  it('an older client (no body) still wipes, without an email', async () => {
    const email = 'wipe-old@erase.test';
    const { sys, owner } = await accountWithData(email);
    emailOn(sys);
    const r = await wipe(sys, owner, undefined);
    expect(r.body).toEqual({ ok: true, notice: 'no-address' });
    expect(sent).toEqual([]);
  });
});

describe('limited like the sign-in codes', () => {
  it('three per address in 15 minutes; the fourth erase still happens but sends nothing', async () => {
    const email = 'many@erase.test';
    const { sys } = await accountWithData(email);
    emailOn(sys);
    const notices = [];
    for (let i = 0; i < 4; i++) {
      // A sign-in for each erase: the sign-in code's own limit (3) is lifted here.
      for (const k of [...sys.global.keys()]) if (k.includes('rl:req:email')) sys.global.delete(k);
      delete sys.env.RESEND_API_KEY;
      const s = await sys.signIn(email, 'PC ' + i);
      emailOn(sys);
      // The owner's data is revision 1; after each wipe the account is empty.
      expect((await push(sys, s, i === 0 ? 1 : 0, 'B' + i)).status).toBe(200);
      const w = await wipe(sys, s, { email });
      expect(w.status).toBe(200);
      notices.push(w.body.notice);
    }
    expect(notices).toEqual(['sent', 'sent', 'sent', 'rate-limited']);
    expect(sent).toHaveLength(3);
  });
});

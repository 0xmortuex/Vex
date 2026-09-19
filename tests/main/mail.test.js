// A read-only inbox: the password is proven before it is kept, the mailbox is
// only ever opened read-only, and failures say what to do.
import { beforeEach, describe, expect, it, vi } from 'vitest';
const { createMail, providerFor, webmailUrl } = require('../../src/main/mail.js');

// An ImapFlow stand-in that records what was asked of it.
function fakeImap({ refuse = false, messages = [] } = {}) {
  const made = [];
  class FakeImap {
    constructor(opts) { this.opts = opts; this.calls = []; made.push(this); }
    async connect() { this.calls.push('connect'); if (refuse) { const e = new Error('Command failed'); e.authenticationFailed = true; e.responseText = 'Invalid credentials'; throw e; } }
    async status(box, what) { this.calls.push(['status', box, what]); return { messages: messages.length, unseen: messages.filter(m => !m.seen).length }; }
    async mailboxOpen(box, opts) { this.calls.push(['open', box, opts]); }
    async *fetch(range, what) { this.calls.push(['fetch', range, what]); for (const m of messages) yield { uid: m.uid, envelope: { subject: m.subject, from: [{ name: m.name, address: m.address }], date: m.date, messageId: m.messageId }, flags: new Set(m.seen ? ['\\Seen'] : []), size: m.size || 100 }; }
    async fetchOne(uid, what) { this.calls.push(['fetchOne', uid, what]); const m = messages.find(x => String(x.uid) === uid); if (!m) return null; return what.source ? { source: Buffer.from(m.raw || '') } : { size: m.size || 100 }; }
    async logout() { this.calls.push('logout'); }
    close() { this.calls.push('close'); }
  }
  return { FakeImap, made };
}

function memorySecrets() {
  const files = new Map();
  return {
    files,
    read: vi.fn(async (file) => (files.has(file) ? JSON.parse(files.get(file)) : null)),
    write: vi.fn(async (file, v) => { files.set(file, JSON.stringify(v)); return true; }),
  };
}

const MESSAGES = [
  { uid: 7, subject: 'Older', name: 'Bank', address: 'no-reply@bank.example', date: new Date('2026-09-18T08:00:00Z'), seen: true, messageId: '<b@bank.example>' },
  { uid: 9, subject: 'Your order shipped', name: 'Dana', address: 'dana@shop.example', date: new Date('2026-09-19T10:00:00Z'), seen: false, messageId: '<a1@shop.example>', raw: 'From: Dana <dana@shop.example>\r\nTo: me@gmail.com\r\nSubject: Your order shipped\r\nMessage-ID: <a1@shop.example>\r\n\r\nIt is on its way.\r\n' },
];

let secrets, imap, mail;
beforeEach(() => {
  secrets = memorySecrets();
  imap = fakeImap({ messages: MESSAGES });
  mail = createMail({ ImapFlow: imap.FakeImap, simpleParser: require('mailparser').simpleParser, secrets, file: 'mail.enc', randomId: () => 'acct1' });
});

describe('providers', () => {
  it('knows Gmail, Yahoo and iCloud by the address', () => {
    expect(providerFor('me@gmail.com')).toBe('gmail');
    expect(providerFor('me@ymail.com')).toBe('yahoo');
    expect(providerFor('me@me.com')).toBe('icloud');
    expect(providerFor('me@company.example')).toBeNull();
  });

  it('a reply goes to that very message in Gmail', () => {
    expect(webmailUrl({ provider: 'gmail', email: 'me@gmail.com' }, '<a1@shop.example>')).toBe('https://mail.google.com/mail/u/?authuser=me%40gmail.com#search/rfc822msgid%3Aa1%40shop.example');
    expect(webmailUrl({ provider: null, email: 'me@x.example' })).toBeNull();
  });
});

describe('signing in', () => {
  it('proves the password, then keeps the account — encrypted, and never handed back', async () => {
    const a = await mail.add({ email: ' Me@Gmail.com ', password: 'abcd efgh ijkl mnop' });
    expect(a).toEqual({ id: 'acct1', email: 'me@gmail.com', provider: 'gmail', host: 'imap.gmail.com', port: 993, name: 'Gmail', webmail: expect.stringContaining('mail.google.com') });
    expect(imap.made[0].opts).toMatchObject({ host: 'imap.gmail.com', port: 993, secure: true, auth: { user: 'me@gmail.com', pass: 'abcd efgh ijkl mnop' }, logger: false });
    expect(imap.made[0].calls).toEqual(['connect', 'logout']);
    expect(secrets.write).toHaveBeenCalledWith('mail.enc', [expect.objectContaining({ email: 'me@gmail.com', pass: 'abcd efgh ijkl mnop' })]);
    expect(JSON.stringify(await mail.accounts())).not.toContain('abcd');
  });

  it('a refused password is not kept, and says how to get an app password', async () => {
    const bad = fakeImap({ refuse: true });
    const m = createMail({ ImapFlow: bad.FakeImap, simpleParser: vi.fn(), secrets, file: 'mail.enc', randomId: () => 'x' });
    await expect(m.add({ email: 'me@gmail.com', password: 'my-real-password' })).rejects.toThrow(/refused the password\. Gmail needs an app password/);
    expect(secrets.write).not.toHaveBeenCalled();
  });

  it('Outlook and Hotmail are refused plainly, before any sign-in', async () => {
    await expect(mail.add({ email: 'me@outlook.com', password: 'x' })).rejects.toThrow(/Microsoft no longer lets mail programs sign in/);
    expect(imap.made).toHaveLength(0);
  });

  it('another provider needs its server; off port 993 the password waits for STARTTLS, except on this computer', async () => {
    await expect(mail.add({ email: 'me@company.example', password: 'x' })).rejects.toThrow(/IMAP server/);
    await mail.add({ email: 'me@company.example', password: 'x', host: 'imap.company.example', port: 143, secure: false });
    expect(imap.made[0].opts).toMatchObject({ host: 'imap.company.example', port: 143, secure: false, doSTARTTLS: true });
    await mail.add({ email: 'me@proton.example', password: 'bridge', host: '127.0.0.1', port: 1143, secure: false });
    expect(imap.made[1].opts).toMatchObject({ host: '127.0.0.1', port: 1143, secure: false });
    expect(imap.made[1].opts.doSTARTTLS).toBeUndefined();
  });

  it('refuses the same address twice, and a non-address', async () => {
    await mail.add({ email: 'me@gmail.com', password: 'p' });
    await expect(mail.add({ email: 'ME@gmail.com', password: 'p' })).rejects.toThrow(/already set up/);
    await expect(mail.add({ email: 'not-an-address', password: 'p' })).rejects.toThrow(/not an email address/);
  });
});

describe('reading, without changing anything', () => {
  beforeEach(async () => { await mail.add({ email: 'me@gmail.com', password: 'p' }); imap.made.length = 0; });

  it('the inbox: newest first, unread counted, opened READ-ONLY', async () => {
    const inbox = await mail.inbox('acct1', 50);
    expect(inbox).toMatchObject({ total: 2, unseen: 1 });
    expect(inbox.messages.map(m => [m.uid, m.subject, m.seen])).toEqual([[9, 'Your order shipped', false], [7, 'Older', true]]);
    const calls = imap.made[0].calls;
    expect(calls).toContainEqual(['open', 'INBOX', { readOnly: true }]);
    expect(calls.at(-1)).toBe('logout');
  });

  it('asks only for the newest ones', async () => {
    await mail.inbox('acct1', 1);
    expect(imap.made[0].calls.find(c => c[0] === 'fetch')[1]).toBe('2:*');
  });

  it('one message, as text, with where to reply — the mailbox opened read-only', async () => {
    const msg = await mail.message('acct1', 9);
    expect(msg).toMatchObject({ subject: 'Your order shipped', from: 'Dana <dana@shop.example>', text: expect.stringContaining('It is on its way.'), webmail: expect.stringContaining('rfc822msgid%3Aa1%40shop.example') });
    expect(imap.made[0].calls).toContainEqual(['open', 'INBOX', { readOnly: true }]);
  });

  it('a huge message is not downloaded', async () => {
    MESSAGES[1].size = 40 * 1024 * 1024;
    const msg = await mail.message('acct1', 9);
    MESSAGES[1].size = undefined;
    expect(msg).toMatchObject({ tooLarge: true });
    expect(imap.made[0].calls.some(c => c[0] === 'fetchOne' && c[2].source)).toBe(false);
  });

  it('a removed account is gone', async () => {
    await mail.remove('acct1');
    await expect(mail.inbox('acct1')).rejects.toThrow(/not set up any more/);
  });
});

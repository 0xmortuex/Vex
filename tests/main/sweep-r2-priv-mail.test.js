// @vitest-environment node
//
// Mail fixes of 2026-09-30 (r2-priv): a plain connection to a TLS port is
// told in seconds, not after the 20 s connect timeout; the inbox pages past
// 100 with `before` (a UID).
import { describe, expect, it, vi } from 'vitest';
const fs = require('fs');
const path = require('path');
const { createMail } = require('../../src/main/mail.js');

// An in-memory INBOX of `total` messages, UIDs 1..total, seen through the
// few imapflow calls inbox() makes.
function setup(total) {
  const made = [];
  const uids = Array.from({ length: total }, (_, i) => i + 1);
  const envelope = (uid) => ({ uid, envelope: { subject: 'Message ' + uid, from: [{ name: 'S', address: 's@x.test' }], date: new Date(Date.UTC(2026, 0, 1) + uid * 60000), messageId: '<' + uid + '@x>' }, flags: new Set(), size: 10 });
  class FakeImap {
    constructor(opts) { this.opts = opts; this.calls = []; made.push(this); }
    async connect() {}
    async logout() {}
    close() {}
    async status() { return { messages: total, unseen: 0 }; }
    async mailboxOpen() {}
    async search(query, opts) {
      this.calls.push(['search', query, opts]);
      const [lo, hi] = query.uid.split(':').map(Number);
      return uids.filter(u => u >= lo && u <= hi);
    }
    async *fetch(range, _what, opts) {
      this.calls.push(['fetch', range, opts]);
      const [a, b] = range.split(':');
      if (opts && opts.uid) {
        for (const u of uids) if (u >= Number(a) && u <= Number(b)) yield envelope(u);
      } else {
        const from = Number(a);
        for (let seq = from; seq <= total; seq++) yield envelope(uids[seq - 1]);
      }
    }
  }
  const store = [{ id: 'a', email: 'me@x.test', pass: 'p', host: 'imap.x.test', port: 993, secure: true }];
  const secrets = { read: vi.fn(async () => store), write: vi.fn() };
  const mail = createMail({ ImapFlow: FakeImap, simpleParser: vi.fn(), secrets, file: 'm', randomId: () => 'id1' });
  return { mail, made };
}

describe('a plain connection to a TLS port', () => {
  it('waits 8 s for the greeting, while connecting still has 20 s', async () => {
    const { mail, made } = setup(0);
    await mail.inbox('a');
    expect(made[0].opts.greetingTimeout).toBe(8000);
    expect(made[0].opts.connectionTimeout).toBe(20000);
  });
});

describe('Load more past 100', () => {
  it('without before: the newest page, as before', async () => {
    const { mail, made } = setup(501);
    const r = await mail.inbox('a', 50);
    expect(r.total).toBe(501);
    expect(r.messages.map(m => m.uid)).toEqual(Array.from({ length: 50 }, (_, i) => 501 - i));
    expect(made[0].calls[0]).toEqual(['fetch', '452:*', { uid: false }]);
  });

  it('with before: the newest of the older ones, down to the first message', async () => {
    const { mail } = setup(501);
    const seen = [];
    let before = null;
    for (let i = 0; i < 20; i++) {
      const r = await mail.inbox('a', 100, before);
      if (!r.messages.length) break;
      seen.push(...r.messages.map(m => m.uid));
      before = Math.min(...r.messages.map(m => m.uid));
    }
    expect(seen).toHaveLength(501);
    expect(new Set(seen).size).toBe(501);
    expect(Math.min(...seen)).toBe(1);
  });

  it('asks by UID, and before 1 is an empty page without a search', async () => {
    const { mail, made } = setup(501);
    const r = await mail.inbox('a', 50, 300);
    expect(r.messages.map(m => m.uid)[0]).toBe(299);
    expect(r.messages).toHaveLength(50);
    expect(made[0].calls).toEqual([['search', { uid: '1:299' }, { uid: true }], ['fetch', '250:299', { uid: true }]]);
    const none = await mail.inbox('a', 50, 1);
    expect(none.messages).toEqual([]);
    expect(made[1].calls).toEqual([]);
  });

  it('a before that is not a UID is refused', async () => {
    const { mail } = setup(5);
    await expect(mail.inbox('a', 50, 0)).rejects.toThrow('Not a message');
    await expect(mail.inbox('a', 50, 1.5)).rejects.toThrow('Not a message');
  });

  it('main, the preload and the payload contract pass before through', () => {
    const { validate } = require('../../src/main/ipc-schemas.js');
    expect(() => validate('mail:inbox', ['a', 50, 300])).not.toThrow();
    expect(() => validate('mail:inbox', ['a', 50, 'x'])).toThrow();
    const read = f => fs.readFileSync(path.resolve(f), 'utf8');
    expect(read('src/main.js')).toContain("ipcMain.handle('mail:inbox', _mailCall((_e, id, limit, before) => _mail.inbox(id, limit, before)));");
    expect(read('src/preload.js')).toContain("inbox: (id, limit, before) => ipcRenderer.invoke('mail:inbox', id, limit, before),");
  });
});

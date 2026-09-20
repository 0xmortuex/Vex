// Sorting an inbox. The judgement is made from the envelope alone — who sent
// it and what the subject says — so these are the cases that decide whether
// the piles are worth anything: a person asking something must not land in
// bulk, and a notification must not land in "wants something from you".
import { describe, it, expect } from 'vitest';
const { InboxTriage: T } = require('../../src/renderer/js/inbox-triage.js');

const NOW = Date.UTC(2026, 8, 20, 12);
const mail = (over = {}) => ({
  uid: 1, subject: 'Hello', from: { name: 'Sam', address: 'sam@work.example' },
  date: NOW, seen: false, flagged: false, messageId: '<abc@work.example>', ...over,
});

describe('which pile', () => {
  it('a person asking something wants you', () => {
    expect(T.classify(mail({ subject: 'Can you review the draft?' })).pile).toBe('needs');
    expect(T.classify(mail({ subject: 'Re: the invoice' })).pile).toBe('needs');
    expect(T.classify(mail({ subject: 'Following up on Tuesday' })).pile).toBe('needs');
  });

  it('an address that takes no replies is bulk, whatever it says', () => {
    for (const address of ['no-reply@shop.example', 'noreply@bank.example', 'notifications@social.example', 'alerts@status.example']) {
      expect(T.classify(mail({ subject: 'Can you confirm?', from: { address } })).pile, address).toBe('bulk');
    }
  });

  it('a newsletter is bulk by its subject', () => {
    expect(T.classify(mail({ subject: 'Your weekly digest' })).pile).toBe('bulk');
    expect(T.classify(mail({ subject: '40% off everything' })).pile).toBe('bulk');
    expect(T.classify(mail({ subject: 'Your receipt from the shop' })).pile).toBe('bulk');
    expect(T.classify(mail({ subject: 'Your one-time code' })).pile).toBe('bulk');
  });

  it('a flagged message is always at the top, even from a robot', () => {
    expect(T.classify(mail({ flagged: true, from: { address: 'no-reply@x.example' } })).pile).toBe('needs');
  });

  it('a person who asks nothing is worth a look, not urgent', () => {
    expect(T.classify(mail({ subject: 'Photos from the weekend' })).pile).toBe('look');
  });

  it('every message is told why it landed where it did', () => {
    expect(T.classify(mail({ subject: 'Re: hello' })).why).toMatch(/thread/);
    expect(T.classify(mail({ from: { address: 'no-reply@x.example' } })).why).toMatch(/takes no replies/);
  });
});

describe('the whole inbox', () => {
  const inbox = [
    mail({ uid: 1, subject: 'Can you send the file?', date: NOW - 1000 }),
    mail({ uid: 2, subject: 'Your weekly digest', from: { name: 'News', address: 'hello@news.example' }, date: NOW - 2000 }),
    mail({ uid: 3, subject: 'Photos', date: NOW - 3000 }),
    mail({ uid: 4, subject: 'Read already', seen: true }),
    mail({ uid: 5, subject: 'Build failed', from: { address: 'notifications@ci.example' }, date: NOW - 4000 }),
  ];

  it('leaves out what you have already read', () => {
    const piles = T.sort(inbox);
    expect([...piles.needs, ...piles.look, ...piles.bulk].some(m => m.uid === 4)).toBe(false);
    expect(T.sort(inbox, { unreadOnly: false }).look.some(m => m.uid === 4)).toBe(true);
  });

  it('puts each message in one pile, newest first', () => {
    const piles = T.sort(inbox);
    expect(piles.needs.map(m => m.uid)).toEqual([1]);
    expect(piles.look.map(m => m.uid)).toEqual([3]);
    expect(piles.bulk.map(m => m.uid)).toEqual([2, 5]);
  });

  it('groups the bulk by who keeps sending it, most first', () => {
    const bulk = [
      mail({ from: { name: 'Social', address: 'notifications@social.example' } }),
      mail({ from: { name: 'Social', address: 'no-reply@social.example' } }),
      mail({ from: { name: 'Shop', address: 'no-reply@shop.example' } }),
    ];
    expect(T.senders(bulk).map(s => s.sender + ':' + s.count)).toEqual(['social.example:2', 'shop.example:1']);
  });

  it('sums it up in one line', () => {
    expect(T.summary(T.sort(inbox))).toBe('1 wants something from you, 1 worth a look, 2 bulk.');
    expect(T.summary({ needs: [], look: [], bulk: [] })).toBe('Nothing unread.');
  });
});

describe('where a message opens', () => {
  const gmail = { email: 'someone@gmail.com' };
  it('at that exact message, by the id the mail carries', () => {
    expect(T.webmailMessage(gmail, mail())).toBe('https://mail.google.com/mail/u/0/#search/' + encodeURIComponent('rfc822msgid:abc@work.example'));
  });

  it('by subject when the message has no id', () => {
    expect(T.webmailMessage(gmail, mail({ messageId: '', subject: 'No id here' }))).toContain(encodeURIComponent('No id here'));
  });

  it('a sender\u2019s whole pile is one search', () => {
    expect(T.webmailSearch(gmail, 'social.example')).toBe('https://mail.google.com/mail/u/0/#search/' + encodeURIComponent('from:social.example is:unread'));
  });

  it('other providers go to their own mail', () => {
    expect(T.webmailSearch({ email: 'me@yahoo.com' }, 'x.example')).toMatch(/yahoo/);
    expect(T.webmailSearch({ email: 'me@icloud.com' }, 'x.example')).toMatch(/icloud/);
  });
});

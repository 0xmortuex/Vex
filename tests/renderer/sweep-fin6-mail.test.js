// @vitest-environment jsdom
//
// Mail fixes found live against local IMAP servers (2026-09-29): the security
// choice, custom-server wording, "only 50 of 501" with no note, inbox triage
// sending custom-server mail to Gmail, and a phone number read as a code.

import { beforeEach, describe, expect, it, vi } from 'vitest';
require('../../src/renderer/js/vex-icons.js');
require('../../src/renderer/js/page-export.js');
const { VexMail } = require('../../src/renderer/js/mail.js');
const { InboxTriage } = require('../../src/renderer/js/inbox-triage.js');
const { EmailCodeAutofill } = require('../../src/renderer/js/email-code-autofill.js');

const tick = () => new Promise(r => setTimeout(r, 0));
const ok = (value) => Promise.resolve({ ok: true, value });
const CUSTOM = { id: 'c1', email: 'tester@mail.test', provider: null, host: '127.0.0.1', port: 1143, name: '127.0.0.1', webmail: null };
const GMAIL = { id: 'g1', email: 'me@gmail.com', provider: 'gmail', name: 'Gmail', webmail: 'https://mail.google.com/mail/u/?authuser=me%40gmail.com' };
const msgs = (n) => Array.from({ length: n }, (_, i) => ({ uid: n - i, subject: 'Can you look at ' + (n - i) + '?', from: { name: 'S', address: 's@bulk.test' }, date: Date.now() - i * 60000, seen: false, messageId: '<m' + i + '@x>' }));

beforeEach(() => {
  document.body.innerHTML = '';
  window.escapeHtml = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  window.showToast = vi.fn();
  globalThis.TabManager = { createTab: vi.fn() };
  globalThis.VexMail = VexMail;
  VexMail._state = { accountId: null, inbox: null, open: null };
});

describe('M4: the security of a custom server is chosen, not guessed from the port', () => {
  it('defaults from the port, and TLS on another port can be picked', async () => {
    window.vex = { mail: { accounts: () => ok([]), add: vi.fn(() => Promise.resolve({ ok: false, error: 'no' })) } };
    await VexMail.open();
    const o = document.querySelector('.vex-mail-overlay');
    const email = o.querySelector('[data-email]');
    email.value = 'me@company.example'; email.dispatchEvent(new Event('input'));
    const port = o.querySelector('[data-port]'), security = o.querySelector('[data-security]');
    expect(security.value).toBe('tls');
    port.value = '143'; port.dispatchEvent(new Event('input'));
    expect(security.value).toBe('starttls');
    port.value = '1993'; port.dispatchEvent(new Event('input'));
    security.value = 'tls'; security.dispatchEvent(new Event('change'));
    port.value = '2993'; port.dispatchEvent(new Event('input'));
    expect(security.value).toBe('tls');
    o.querySelector('[data-host]').value = 'imap.company.example';
    o.querySelector('[data-pass]').value = 'p';
    o.querySelector('[data-setup]').dispatchEvent(new Event('submit', { cancelable: true }));
    await tick();
    expect(window.vex.mail.add).toHaveBeenCalledWith({ email: 'me@company.example', password: 'p', host: 'imap.company.example', port: 2993, secure: true });
  });
});

describe('M5 and M6: a custom server\'s inbox', () => {
  it('attachments are for "your mail program", not "127.0.0.1"', async () => {
    window.vex = { mail: {
      accounts: () => ok([CUSTOM]),
      inbox: () => ok({ account: CUSTOM, total: 1, unseen: 1, messages: msgs(1) }),
      message: () => ok({ uid: 1, subject: 'Report', from: 'Bob', to: 'me', cc: '', date: Date.now(), text: 'Attached.', html: '', attachments: [{ filename: 'report.pdf', size: 5000 }], webmail: null }),
    } };
    await VexMail.open();
    const o = document.querySelector('.vex-mail-overlay');
    o.querySelector('[data-uid]').click();
    await tick(); await tick();
    const reader = o.querySelector('[data-reader]').textContent;
    expect(reader).toContain('download them in your mail program');
    expect(reader).not.toContain('127.0.0.1');
  });

  it('says only the newest are shown, and loads more up to main\'s limit', async () => {
    const inbox = vi.fn((_id, limit) => ok({ account: CUSTOM, total: 501, unseen: 300, messages: msgs(limit) }));
    window.vex = { mail: { accounts: () => ok([CUSTOM]), inbox } };
    await VexMail.open();
    const o = document.querySelector('.vex-mail-overlay');
    expect(o.querySelector('[data-more-note]').textContent).toContain('Showing the newest 50 of 501');
    o.querySelector('[data-more]').click();
    await tick(); await tick();
    expect(inbox).toHaveBeenLastCalledWith('c1', 100);
    expect(o.querySelectorAll('[data-uid]')).toHaveLength(100);
    const note = o.querySelector('[data-more-note]');
    expect(note.textContent).toContain('Showing the newest 100 of 501. The rest are in your mail program.');
    expect(note.querySelector('[data-more]')).toBeNull();
  });

  it('no note when everything is shown', async () => {
    window.vex = { mail: { accounts: () => ok([GMAIL]), inbox: () => ok({ account: GMAIL, total: 2, unseen: 2, messages: msgs(2) }) } };
    await VexMail.open();
    expect(document.querySelector('[data-more-note]')).toBeNull();
  });
});

describe('M1: inbox triage', () => {
  it('a custom server has no webmail: no Gmail link, rows are not links', async () => {
    expect(InboxTriage.webmailMessage(CUSTOM, msgs(1)[0])).toBeNull();
    expect(InboxTriage.webmailSearch(CUSTOM, 'bulk.test')).toBeNull();
    window.vex = { mail: { accounts: () => ok([CUSTOM]), inbox: () => ok({ account: CUSTOM, total: 1, unseen: 1, messages: msgs(1) }) } };
    const overlay = await InboxTriage.open();
    const row = overlay.querySelector('[data-uid]');
    row.click();
    expect(TabManager.createTab).not.toHaveBeenCalled();
    expect(row.title).toBe('Open this in your mail program');
    expect(overlay.querySelector('[data-foot]').textContent).toContain('open these in your mail program');
  });

  it('reads the account the Mail sheet has open, and offers the others', async () => {
    const inbox = vi.fn((id) => ok({ account: id === 'c1' ? CUSTOM : GMAIL, total: 1, unseen: 1, messages: msgs(1) }));
    window.vex = { mail: { accounts: () => ok([GMAIL, CUSTOM]), inbox } };
    VexMail._state.accountId = 'c1';
    const overlay = await InboxTriage.open();
    expect(inbox).toHaveBeenCalledWith('c1', 100);
    const pick = overlay.querySelector('[data-account]');
    expect(pick.value).toBe('c1');
    pick.value = 'g1'; pick.dispatchEvent(new Event('change'));
    await tick(); await tick();
    expect(inbox).toHaveBeenLastCalledWith('g1', 100);
    overlay.querySelector('[data-uid]').click();
    expect(TabManager.createTab).toHaveBeenCalledWith(expect.stringContaining('mail.google.com'), true);
  });
});

describe('email code: a phone number is not a code', () => {
  it('skips digits joined to a longer phone-like run', () => {
    expect(EmailCodeAutofill._extractCode('Call 555-123456 now')).toBeNull();
    expect(EmailCodeAutofill._extractCode('Call (555) 123456 now')).toBeNull();
    expect(EmailCodeAutofill._extractCode('Ring 020 123456 today')).toBeNull();
    expect(EmailCodeAutofill._extractCode('Use 482913 to continue. Questions? Call 555-123456.')).toBe('482913');
    expect(EmailCodeAutofill._extractCode('Your verification code is 482913.')).toBe('482913');
    expect(EmailCodeAutofill._extractCode('Here: 482913')).toBe('482913');
  });
});

// @vitest-environment jsdom
//
// The inbox sheet: mail shown as text, links that open in a tab, nothing
// remote loaded, and the sign-in help for each provider.

import { beforeEach, describe, expect, it, vi } from 'vitest';
require('../../src/renderer/js/vex-icons.js');
require('../../src/renderer/js/page-export.js');
const { VexMail } = require('../../src/renderer/js/mail.js');

const tick = () => new Promise(r => setTimeout(r, 0));
const ok = (value) => Promise.resolve({ ok: true, value });
const ACCOUNT = { id: 'a1', email: 'me@gmail.com', provider: 'gmail', name: 'Gmail', webmail: 'https://mail.google.com/mail/u/?authuser=me%40gmail.com' };

beforeEach(() => {
  document.body.innerHTML = '';
  window.escapeHtml = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  window.showToast = vi.fn();
  globalThis.TabManager = { createTab: vi.fn() };
  VexMail._state = { accountId: null, inbox: null, open: null };
});

describe('turning a message into text', () => {
  it('an HTML-only message becomes its words; scripts and styles are dropped, link targets kept', () => {
    const text = VexMail.htmlToText('<style>p{color:red}</style><p>Hello <b>Dana</b></p><script>alert(1)</script><p>Track it <a href="https://shop.example/t/1">here</a></p>');
    expect(text).toBe('Hello Dana\nTrack it here (https://shop.example/t/1)');
  });

  it('nothing in the message is ever loaded: no images, no remote anything', () => {
    const before = performance.getEntriesByType ? performance.getEntriesByType('resource').length : 0;
    VexMail.htmlToText('<img src="https://tracker.example/pixel.gif"><link rel="stylesheet" href="https://x.example/a.css">');
    const after = performance.getEntriesByType ? performance.getEntriesByType('resource').length : 0;
    expect(after).toBe(before);
  });

  it('text is escaped and only web links become links', () => {
    const html = VexMail.linkify('Click <b>here</b>: https://shop.example/t?a=1&b=2 or javascript:alert(1)');
    expect(html).toContain('&lt;b&gt;here&lt;/b&gt;');
    expect(html).toContain('data-url="https://shop.example/t?a=1&amp;b=2"');
    expect(html).not.toContain('href="javascript');
  });
});

describe('signing in', () => {
  it('says which password each provider needs, and asks for a server only when unknown', async () => {
    window.vex = { mail: { accounts: () => ok([]) } };
    await VexMail.open();
    const o = document.querySelector('.vex-mail-overlay');
    const email = o.querySelector('[data-email]');
    email.value = 'me@gmail.com'; email.dispatchEvent(new Event('input'));
    expect(o.querySelector('[data-help]').textContent).toMatch(/app password/);
    expect(o.querySelector('[data-custom]').hidden).toBe(true);
    email.value = 'me@outlook.com'; email.dispatchEvent(new Event('input'));
    expect(o.querySelector('[data-help]').textContent).toMatch(/cannot be read here/);
    email.value = 'me@company.example'; email.dispatchEvent(new Event('input'));
    expect(o.querySelector('[data-custom]').hidden).toBe(false);
  });

  it('a refused sign-in shows why, and the password box is not cleared', async () => {
    window.vex = { mail: { accounts: () => ok([]), add: vi.fn(() => Promise.resolve({ ok: false, error: 'The mail server refused the password. Gmail needs an app password.' })) } };
    await VexMail.open();
    const o = document.querySelector('.vex-mail-overlay');
    o.querySelector('[data-email]').value = 'me@gmail.com';
    o.querySelector('[data-pass]').value = 'wrong';
    o.querySelector('[data-setup]').dispatchEvent(new Event('submit', { cancelable: true }));
    await tick(); await tick();
    expect(o.querySelector('[data-help]').textContent).toMatch(/refused the password/);
    expect(window.vex.mail.add).toHaveBeenCalledWith({ email: 'me@gmail.com', password: 'wrong' });
  });
});

describe('the inbox', () => {
  const INBOX = { account: ACCOUNT, total: 2, unseen: 1, messages: [
    { uid: 9, subject: 'Your order <shipped>', from: { name: 'Dana', address: 'dana@shop.example' }, date: Date.now(), seen: false },
    { uid: 7, subject: 'Statement', from: { name: '', address: 'no-reply@bank.example' }, date: Date.now() - 3 * 86400000, seen: true },
  ] };

  it('lists the newest mail with the unread count, and reads one as text', async () => {
    window.vex = { mail: {
      accounts: () => ok([ACCOUNT]),
      inbox: vi.fn(() => ok(INBOX)),
      message: vi.fn(() => ok({ uid: 9, subject: 'Your order <shipped>', from: 'Dana <dana@shop.example>', to: 'me@gmail.com', cc: '', date: Date.now(), text: 'On its way: https://shop.example/t/1', html: '', attachments: [{ filename: 'invoice.pdf', size: 20480 }], webmail: 'https://mail.google.com/mail/u/?authuser=me%40gmail.com#search/rfc822msgid%3Aa1' })),
    } };
    await VexMail.open();
    const o = document.querySelector('.vex-mail-overlay');
    expect(o.textContent).toMatch(/1\s*unread of 2/);
    const rows = o.querySelectorAll('[data-uid]');
    expect(rows).toHaveLength(2);
    expect(rows[0].innerHTML).toContain('Your order &lt;shipped&gt;');
    rows[0].click();
    await tick(); await tick();
    const reader = o.querySelector('[data-reader]');
    expect(reader.textContent).toContain('On its way');
    expect(reader.textContent).toContain('invoice.pdf (20 KB)');
    reader.querySelector('a[data-url]').click();
    expect(TabManager.createTab).toHaveBeenCalledWith('https://shop.example/t/1', true);
    reader.querySelector('[data-reply]').click();
    expect(TabManager.createTab).toHaveBeenLastCalledWith(expect.stringContaining('rfc822msgid'), true);
  });

  it('a mail error is shown in the sheet, not swallowed', async () => {
    window.vex = { mail: { accounts: () => ok([ACCOUNT]), inbox: () => Promise.resolve({ ok: false, error: 'The mail server did not answer in time' }) } };
    await VexMail.open();
    expect(document.querySelector('.vex-mail-overlay').textContent).toContain('did not answer in time');
  });
});

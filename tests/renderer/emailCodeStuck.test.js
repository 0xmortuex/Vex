// T0-011: email-code autofill that actually fires.
//
// The owner's autofill log: 178 attempts, 0 filled (111 busy, 61 no-mail, 5
// sender-mismatch). These tests reproduce the faults that produce those numbers
// against a fake mail bridge, and cover the new ways out (mail account over
// read-only IMAP, the code on the clipboard, a sender trusted with one click).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EmailCodeAutofill } from '../../src/renderer/js/email-code-autofill.js';

function make(overrides = {}) {
  const injected = [];
  const logs = [];
  const A = Object.assign(Object.create(Object.getPrototypeOf(EmailCodeAutofill)), EmailCodeAutofill, {
    _watching: new Set(),
    _active: new Set(),
    _imapCache: null,
    _hasEmptyCodeField: async () => true,
    _looksLikeCodePage: async () => true,
    _injectCode: async (_wv, code) => { injected.push(code); return true; },
    _log: (_url, ok, reason) => { logs.push({ ok, reason }); },
    _toast: () => {},
    _maybeAutoSubmit: () => {},
    _maybeMissToast: () => {},
    _refreshInbox: () => {},
    ...overrides,
  });
  return { A, injected, logs };
}
const page = (url) => ({ isConnected: true, getURL: () => url });
const loaded = (code, from = ['no-reply@spotify.com'], extra = {}) => ({ loaded: true, code, unread: true, strong: true, from, foreign: false, ...extra });
async function ticks(n) { for (let k = 0; k < n; k++) await vi.advanceTimersByTimeAsync(3100); }

describe('a mail page that never answers', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('_exec rejects after the timeout instead of waiting for ever', async () => {
    const { A } = make();
    const hung = { executeJavaScript: () => new Promise(() => {}) };
    const p = A._exec(hung, '1').then(() => 'resolved', e => e.message);
    await vi.advanceTimersByTimeAsync(A.EXEC_TIMEOUT_MS + 10);
    expect(await p).toMatch(/did not answer within 10000 ms/);
  });

  it('_readInbox reports a hung mail page as stuck, not as an empty inbox', async () => {
    const { A } = make();
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const mailWv = { getURL: () => 'https://mail.google.com/mail/u/0/#inbox', executeJavaScript: () => new Promise(() => {}) };
    const p = A._readInbox(mailWv, A._PROVIDERS[0], 'https://accounts.spotify.com/login');
    await vi.advanceTimersByTimeAsync(A.EXEC_TIMEOUT_MS + 10);
    const read = await p;
    expect(read.stuck).toBe(true);
    expect(read.loaded).toBe(false);
    err.mockRestore();
  });

  it('three polls on hung mail pages end and give every slot back: later attempts are not busy', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    let hang = true;
    const hungWv = { getURL: () => 'https://mail.google.com/mail/u/0/#inbox', executeJavaScript: () => (hang ? new Promise(() => {}) : Promise.resolve(JSON.stringify({ loaded: true, rows: [{ t: 'Your verification code is 424242', f: ['no-reply@spotify.com'], u: true }] }))) };
    const { A, injected, logs } = make({ _findMailWebview: () => ({ wv: hungWv, provider: EmailCodeAutofill._PROVIDERS[0] }) });
    A._readInbox = EmailCodeAutofill._readInbox;
    const urls = ['https://discord.com/login', 'https://www.roblox.com/login', 'https://store.steampowered.com/login'];
    const first = urls.map(u => A.tryFill(page(u), u));
    await ticks(130);
    await Promise.all(first);
    expect(A._active.size).toBe(0);
    expect(A._watching.size).toBe(0);
    expect(logs.every(l => l.reason !== 'busy')).toBe(true);
    // The mail page answers again: a fourth page is served at once.
    hang = false;
    const u = 'https://accounts.spotify.com/en/login/otp';
    const p = A.tryFill(page(u), u);
    await ticks(70);
    await p;
    expect(injected).toContain('424242');
    err.mockRestore();
  });
});

describe('pages with no mail to read do not hold the reading slots', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  // Before: a page showing a code field took a slot and kept it for the whole
  // three minutes even when there was no mail to read, so three such pages (a
  // Discord, a Roblox and a Steam login) turned every later attempt away as busy.
  it('a fourth page is served while three others have no mail to read', async () => {
    let mailUp = false;
    const { A, injected, logs } = make({
      _findMailWebview() { return mailUp ? { wv: {}, provider: { id: 'gmail' } } : null; },
      _readInbox: async () => loaded('777888'),
    });
    A._readImap = async () => null;
    const waiting = ['https://discord.com/login', 'https://www.roblox.com/login', 'https://store.steampowered.com/login'];
    waiting.forEach(u => A.tryFill(page(u), u));
    await ticks(3);
    expect(A._active.size).toBe(0);                       // nobody reads, nobody holds a slot
    mailUp = true;
    const u = 'https://accounts.spotify.com/en/login/otp';
    const p = A.tryFill(page(u), u);
    await ticks(70);
    await p;
    expect(injected).toContain('777888');
    expect(logs.filter(l => l.reason === 'busy')).toEqual([]);
  });

  it('says no-mail when no mail tab is open and mail-blocked when it is open but refused', async () => {
    const a = make({ _findMailWebview() { this._mailSeen = { open: 0, blocked: 0 }; return null; } });
    a.A._readImap = async () => null;
    const u = 'https://accounts.spotify.com/en/login/otp';
    const p1 = a.A.tryFill(page(u), u); await ticks(70); await p1;
    expect(a.logs).toEqual([{ ok: false, reason: 'no-mail' }]);

    const b = make({ _findMailWebview() { this._mailSeen = { open: 1, blocked: 1 }; return null; } });
    b.A._readImap = async () => null;
    const p2 = b.A.tryFill(page(u), u); await ticks(70); await p2;
    expect(b.logs).toEqual([{ ok: false, reason: 'mail-blocked' }]);
  });

  it('the real search counts a mail tab that the tab rule refuses', () => {
    const wv = { getAttribute: (n) => (n === 'partition' ? 'persist:container-tor-1' : null), getURL: () => 'https://mail.google.com/mail/u/0/#inbox' };
    globalThis.document = { querySelectorAll: () => [wv], getElementById: () => null };
    globalThis.window = { VexTabPolicy: { isPrivateWindow: false, canReadWebview: () => false, canShareTab: () => false } };
    globalThis.localStorage = { getItem: () => null };
    try {
      const { A } = make();
      expect(A._findMailWebview()).toBeNull();
      expect(A._mailSeen).toMatchObject({ open: 1, blocked: 1 });
    } finally { delete globalThis.document; delete globalThis.window; delete globalThis.localStorage; }
  });
});

describe('mail accounts set up in Vex (read-only IMAP)', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); delete globalThis.window; });

  it('reads the newest mail through accounts/inbox/message only and fills the site\'s own code', async () => {
    const calls = [];
    const now = Date.now();
    globalThis.window = { vex: { mail: {
      accounts: async () => { calls.push('accounts'); return [{ id: 'a1', email: 'me@example.net' }]; },
      inbox: async () => { calls.push('inbox'); return { messages: [
        { uid: 9, subject: 'Your sign-in', from: { address: 'no-reply@spotify.com' }, date: now - 20000, seen: false },
        { uid: 8, subject: 'Weekly deals 123456', from: { address: 'news@shop.example' }, date: now - 60000, seen: true },
      ] }; },
      message: async () => { calls.push('message'); return { text: 'Your verification code is 905512. It expires soon.' }; },
    } } };
    const { A } = make({ _findMailWebview: () => null });
    const u = 'https://accounts.spotify.com/en/login/otp';
    const read = await A._readImap(u);
    expect(read).toMatchObject({ loaded: true, code: '905512', from: ['no-reply@spotify.com'], foreign: false });
    expect(new Set(calls)).toEqual(new Set(['accounts', 'inbox', 'message']));
    // Nothing in the bridge's write surface exists on the fake: only these three were called.
    expect(calls.filter(c => !['accounts', 'inbox', 'message'].includes(c))).toEqual([]);
  });

  it('the poll fills from IMAP when no webmail tab can be read', async () => {
    const { A, injected } = make({ _findMailWebview: () => null });
    let n = 0;
    A._readImap = async () => (n++ === 0 ? { loaded: true, code: null, unread: false, strong: false, from: null } : { loaded: true, code: '135790', unread: true, strong: true, from: ['no-reply@spotify.com'] });
    const u = 'https://accounts.spotify.com/en/login/otp';
    const p = A.tryFill(page(u), u); await ticks(70); await p;
    expect(injected).toEqual(['135790']);
  });

  it('ignores a message older than half an hour and a code from another sender', async () => {
    const now = Date.now();
    globalThis.window = { vex: { mail: {
      accounts: async () => [{ id: 'a1' }],
      inbox: async () => ({ messages: [
        { uid: 3, subject: 'Spotify code 111111', from: { address: 'no-reply@spotify.com' }, date: now - 3 * 3600 * 1000, seen: true },
        { uid: 2, subject: 'Your code 222222', from: { address: 'x@evil.test' }, date: now - 1000, seen: false },
      ] }),
      message: async () => ({ text: '' }),
    } } };
    const { A } = make();
    const read = await A._readImap('https://accounts.spotify.com/login');
    expect(read.code).toBeNull();
    expect(read.foreign).toBe(true);
    expect(read.foreignFrom).toBe('evil.test');
  });

  it('is not used in a private window', async () => {
    globalThis.window = { VexTabPolicy: { isPrivateWindow: true }, vex: { mail: { accounts: async () => { throw new Error('must not be called'); }, inbox: async () => ({}) } } };
    const { A } = make();
    expect(await A._readImap('https://accounts.spotify.com/login')).toBeNull();
  });
});

describe('the code already on the clipboard', () => {
  afterEach(() => { delete globalThis.navigator; delete globalThis.window; });
  const wvUrl = 'https://accounts.spotify.com/en/login/otp';

  it('fills a lone 4-8 digit code and never submits', async () => {
    Object.defineProperty(globalThis, 'navigator', { value: { clipboard: { readText: async () => ' 482913\n' } }, configurable: true });
    const submit = vi.fn();
    const { A, injected, logs } = make({ _maybeAutoSubmit: submit });
    expect(await A.fillFromClipboard(page(wvUrl), wvUrl)).toBe(true);
    expect(injected).toEqual(['482913']);
    expect(logs).toEqual([{ ok: true, reason: 'clipboard' }]);
    expect(submit).not.toHaveBeenCalled();
  });

  it('refuses anything that is not only a code', async () => {
    Object.defineProperty(globalThis, 'navigator', { value: { clipboard: { readText: async () => 'call 555-123456 now' } }, configurable: true });
    const { A, injected } = make();
    expect(await A.fillFromClipboard(page(wvUrl), wvUrl)).toBe(false);
    expect(injected).toEqual([]);
  });

  it('raises when the clipboard cannot be read', async () => {
    Object.defineProperty(globalThis, 'navigator', { value: { clipboard: { readText: async () => { throw new Error('denied'); } } }, configurable: true });
    const { A } = make();
    await expect(A.fillFromClipboard(page(wvUrl), wvUrl)).rejects.toThrow('denied');
  });

  it('does not fill into a private or Tor tab', async () => {
    Object.defineProperty(globalThis, 'navigator', { value: { clipboard: { readText: async () => '482913' } }, configurable: true });
    globalThis.window = { VexTabPolicy: { canFillWebview: () => false } };
    const { A, injected } = make();
    expect(await A.fillFromClipboard(page(wvUrl), wvUrl)).toBe(false);
    expect(injected).toEqual([]);
  });
});

describe('trusting a sender for one site', () => {
  let store;
  beforeEach(() => { store = {}; globalThis.localStorage = { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } }; });
  afterEach(() => { delete globalThis.localStorage; });

  it('a code from an unrelated sender is refused until it is trusted, then accepted for that site only', () => {
    const { A } = make();
    expect(A._senderMatches(['codes@mailer-9x.net'], 'https://www.example.com/login')).toBe(false);
    A.trustSender('https://www.example.com/login', 'mailer-9x.net');
    expect(A._senderMatches(['codes@mailer-9x.net'], 'https://www.example.com/login')).toBe(true);
    expect(A._senderMatches(['codes@mailer-9x.net'], 'https://other.test/login')).toBe(false);
  });

  it('a free-mail domain can never be trusted', () => {
    const { A } = make();
    expect(() => A.trustSender('https://www.example.com/login', 'gmail.com')).toThrow(/free mail/);
    expect(store['vex.emailCodeTrust']).toBeUndefined();
  });

  it('only a registrable domain can be trusted', () => {
    const { A } = make();
    expect(() => A.trustSender('https://www.example.com/', 'mail.mailer-9x.net')).toThrow(/not a sender domain/);
  });

  it('a damaged list is reported and ignored, not trusted', () => {
    store['vex.emailCodeTrust'] = '{nope';
    const { A } = make();
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(A._senderMatches(['codes@mailer-9x.net'], 'https://www.example.com/')).toBe(false);
    expect(err).toHaveBeenCalled();
    err.mockRestore();
  });

  it('the miss hint offers the clipboard and, for a foreign sender, one-click trust', () => {
    const { A } = make();
    delete A._maybeMissToast; // use the real one
    A._maybeMissToast = EmailCodeAutofill._maybeMissToast;
    const toast = vi.fn();
    globalThis.window = { showToast: toast };
    try {
      A._lastMissToast = 0;
      A._maybeMissToast('sender-mismatch', true, { loginWv: page('https://www.example.com/'), url: 'https://www.example.com/', foreignFrom: 'mailer-9x.net' });
      const opts = toast.mock.calls[0][3];
      expect(opts.actions.map(a => a.label)).toEqual(['Use clipboard code', 'Trust mailer-9x.net']);
      opts.actions[1].run();
      expect(A._trustedFor('example.com')).toEqual(['mailer-9x.net']);
    } finally { delete globalThis.window; }
  });
});

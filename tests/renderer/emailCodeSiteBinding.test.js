// Email-code autofill puts a code only into the site that emailed it.
//
// The audit (B11) found that the newest code in the inbox was handed to
// whatever https page showed a code field: a Discord code was filled into
// disc0rd-verify.example. A look-alike page that says "enter the code we sent"
// while the attacker signs in to the real Discord gets the victim's real code -
// and with auto-submit on, it was sent without the person seeing it.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EmailCodeAutofill } from '../../src/renderer/js/email-code-autofill.js';

function harness(reads) {
  let i = 0;
  const injected = [];
  const logs = [];
  const submitted = [];
  const A = Object.assign(Object.create(Object.getPrototypeOf(EmailCodeAutofill)), EmailCodeAutofill, {
    _watching: new Set(),
    _active: new Set(),
    _hasEmptyCodeField: async () => true,
    _looksLikeCodePage: async () => true,
    _findMailWebview: () => ({ wv: {}, provider: EmailCodeAutofill._PROVIDERS[0] }),
    _readInbox: async () => reads[Math.min(i++, reads.length - 1)],
    _refreshInbox: () => {},
    _injectCode: async (_wv, code) => { injected.push(code); return true; },
    _log: (_url, ok, reason) => { logs.push({ ok, reason }); },
    _toast: () => {},
    _maybeMissToast: () => {},
    _maybeAutoSubmit: (_wv, url) => { submitted.push(url); },
  });
  return { A, injected, logs, submitted };
}

async function poll(A, url) {
  const wv = { isConnected: true, getURL: () => url };
  const p = A.tryFill(wv, url);
  for (let k = 0; k < 64; k++) await vi.advanceTimersByTimeAsync(3100);
  await p;
}

const discordMail = (code) => ({ loaded: true, code, unread: true, strong: true, from: ['noreply@discord.com'] });

describe('EmailCodeAutofill fills a code only into the site that sent it', () => {
  let storage;
  beforeEach(() => {
    vi.useFakeTimers();
    storage = new Map();
    vi.stubGlobal('localStorage', {
      getItem: (k) => (storage.has(k) ? storage.get(k) : null),
      setItem: (k, v) => storage.set(k, String(v)),
      removeItem: (k) => storage.delete(k),
    });
  });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

  it('does not fill (or submit) a Discord code into a look-alike phishing page', async () => {
    storage.set('vex.emailCodeAutoSubmit', '1');
    const { A, injected, submitted, logs } = harness([
      { loaded: true, code: null, unread: false, strong: false, from: null },
      discordMail('482913'),
    ]);
    await poll(A, 'https://disc0rd-verify.example/login');
    expect(injected).toEqual([]);
    expect(submitted).toEqual([]);
    expect(logs.at(-1)).toEqual({ ok: false, reason: 'sender-mismatch' });
  });

  it('does not fill a code whose sender could not be read at all', async () => {
    const { A, injected } = harness([
      { loaded: true, code: null, unread: false, strong: false, from: null },
      { loaded: true, code: '482913', unread: true, strong: true },
    ]);
    await poll(A, 'https://discord.com/login');
    expect(injected).toEqual([]);
  });

  it('fills the same Discord code into discord.com itself', async () => {
    const { A, injected, logs } = harness([
      { loaded: true, code: null, unread: false, strong: false, from: null },
      discordMail('482913'),
    ]);
    await poll(A, 'https://discord.com/login');
    expect(injected).toEqual(['482913']);
    expect(logs.at(-1)).toEqual({ ok: true, reason: 'new-code' });
  });

  it('the audit repro: the real tryFill with the real reader result no longer fills the phishing page', async () => {
    // Same shape as the audit's scratch test, which passed when the bug was there.
    const { A, injected } = harness([
      { loaded: true, code: '111111', unread: false, strong: true },
      { loaded: true, code: EmailCodeAutofill._extractCode('Discord <noreply@discord.com> Your Discord verification code is 482913'), unread: true, strong: true },
    ]);
    await poll(A, 'https://disc0rd-verify.example/login');
    expect(injected).toEqual([]);
  });
});

describe('EmailCodeAutofill._senderMatches', () => {
  const m = (from, url) => EmailCodeAutofill._senderMatches(from, url);

  it('matches the sender\'s registrable domain against the page\'s', () => {
    expect(m(['noreply@discord.com'], 'https://discord.com/login')).toBe(true);
    expect(m(['no-reply@accounts.google.com'], 'https://accounts.google.com/v3/signin')).toBe(true);
    expect(m(['no-reply@accounts.google.com'], 'https://myaccount.google.com/')).toBe(true);
    expect(m(['no-reply@spotify.com'], 'https://accounts.spotify.com/en/login/otp')).toBe(true);
    expect(m(['account@amazon.co.uk'], 'https://www.amazon.co.uk/ap/signin')).toBe(true);
    expect(m(['Discord <noreply@discord.com>'], 'https://discord.com/login')).toBe(true);
  });

  it('knows services that mail from one domain and sign in on another', () => {
    expect(m(['noreply@discordapp.com'], 'https://discord.com/login')).toBe(true);
    expect(m(['account-security-noreply@accountprotection.microsoft.com'], 'https://login.live.com/')).toBe(true);
    expect(m(['security@facebookmail.com'], 'https://www.facebook.com/login')).toBe(true);
  });

  it('rejects look-alikes and other sites', () => {
    expect(m(['noreply@discord.com'], 'https://disc0rd-verify.example/login')).toBe(false);
    expect(m(['noreply@discord.com'], 'https://discord.com.evil.example/login')).toBe(false);
    expect(m(['noreply@github.com'], 'https://evil.github.io/login')).toBe(false);
    expect(m(['account@amazon.co.uk'], 'https://evil.co.uk/')).toBe(false);
    expect(m(['noreply@discord.com.evil.example'], 'https://discord.com/login')).toBe(false);
    expect(m(['noreply@spotify.com'], 'https://discord.com/login')).toBe(false);
  });

  it('rejects a missing or unreadable sender', () => {
    expect(m(null, 'https://discord.com/login')).toBe(false);
    expect(m([], 'https://discord.com/login')).toBe(false);
    expect(m(['Discord'], 'https://discord.com/login')).toBe(false);
    expect(m(['noreply@discord.com'], 'not a url')).toBe(false);
  });
});

describe('EmailCodeAutofill._readInbox picks the code the page\'s own site sent', () => {
  const mailWv = (rows) => ({
    id: 'tab-mail',
    getURL: () => 'https://mail.google.com/mail/u/0/#inbox',
    executeJavaScript: async () => JSON.stringify({ loaded: true, rows }),
  });

  it('skips a newer code from another service and returns the site\'s own', async () => {
    const r = await EmailCodeAutofill._readInbox(mailWv([
      { t: 'Steam Your Steam login code is 777777', f: ['noreply@steampowered.com'], u: true },
      { t: 'Discord Your Discord verification code is 482913', f: ['noreply@discord.com'], u: true },
    ]), EmailCodeAutofill._PROVIDERS[0], 'https://discord.com/login');
    expect(r.code).toBe('482913');
    expect(r.from).toEqual(['noreply@discord.com']);
    expect(r.foreign).toBe(true);
  });

  it('returns no code when only other services sent one', async () => {
    const r = await EmailCodeAutofill._readInbox(mailWv([
      { t: 'Discord Your Discord verification code is 482913', f: ['noreply@discord.com'], u: true },
    ]), EmailCodeAutofill._PROVIDERS[0], 'https://disc0rd-verify.example/login');
    expect(r.code).toBeNull();
    expect(r.foreign).toBe(true);
  });

  it('the row script reads the sender from Gmail\'s email attribute', async () => {
    let script = '';
    await EmailCodeAutofill._readInbox({
      id: 'tab-mail',
      getURL: () => 'https://mail.google.com/mail/u/0/#inbox',
      executeJavaScript: async (js) => { script = js; return JSON.stringify({ loaded: true, rows: [] }); },
    }, EmailCodeAutofill._PROVIDERS[0], 'https://discord.com/login');
    expect(script).toContain("querySelectorAll('[email]')");
  });
});

describe('EmailCodeAutofill master switch', () => {
  let storage;
  beforeEach(() => {
    vi.useFakeTimers();
    storage = new Map();
    vi.stubGlobal('localStorage', { getItem: (k) => (storage.has(k) ? storage.get(k) : null), setItem: (k, v) => storage.set(k, String(v)) });
  });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

  it('is on by default', () => {
    expect(EmailCodeAutofill.enabled()).toBe(true);
  });

  it('turned off, page loads start nothing', async () => {
    storage.set('vex.emailCodeAutofill', '0');
    const { A, injected } = harness([discordMail(null), discordMail('482913')]);
    let probed = false;
    A._hasEmptyCodeField = async () => { probed = true; return true; };
    await A.tryFill({ isConnected: true, getURL: () => 'https://discord.com/login' }, 'https://discord.com/login');
    expect(probed).toBe(false);
    expect(injected).toEqual([]);
  });

  it('turned off, asking for it by hand still fills', async () => {
    storage.set('vex.emailCodeAutofill', '0');
    const { A, injected } = harness([discordMail(null), discordMail('482913')]);
    const wv = { isConnected: true, getURL: () => 'https://discord.com/login' };
    const p = A.tryFill(wv, 'https://discord.com/login', { manual: true });
    for (let k = 0; k < 64; k++) await vi.advanceTimersByTimeAsync(3100);
    await p;
    expect(injected).toEqual(['482913']);
  });

  it('Settings has the switch and Reset to Defaults clears it', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const html = readFileSync(resolve(process.cwd(), 'src/renderer/index.html'), 'utf8');
    const app = readFileSync(resolve(process.cwd(), 'src/renderer/js/app.js'), 'utf8');
    expect(html).toContain('id="setting-emailcode-autofill"');
    expect(app).toMatch(/getElementById\('setting-emailcode-autofill'\)/);
    expect(app.match(/const SETTINGS_PREF_KEYS = \[([\s\S]*?)\];/)[1]).toContain("'vex.emailCodeAutofill'");
  });
});

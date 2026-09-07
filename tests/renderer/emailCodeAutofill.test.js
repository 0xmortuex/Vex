// email-code autofill — the code-selection logic. The failing report was
// "the code came but it wasn't filled": the code was already in the inbox when
// the login page opened, so it became the immutable baseline and was skipped
// forever. These tests lock in the fix (fill an unread, strong baseline code as
// a last resort) while keeping the stale-code protection (never fill an old,
// already-consumed code, and prefer a genuinely newer one).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EmailCodeAutofill } from '../../src/renderer/js/email-code-autofill.js';

// Build a test harness: a fresh autofill object with the webview/IPC-touching
// helpers stubbed, so tryFill runs against scripted inbox reads with fake timers.
function makeAutofill(readsFn) {
  const injected = [];
  const logs = [];
  const A = Object.assign(Object.create(Object.getPrototypeOf(EmailCodeAutofill)), EmailCodeAutofill, {
    _hasEmptyCodeField: async () => true,
    _looksLikeCodePage: async () => true,
    _findMailWebview: () => ({ wv: {}, provider: { id: 'gmail' } }), // non-null mail webview
    _readInbox: async () => readsFn(),
    _injectCode: async (_wv, code) => { injected.push(code); return true; },
    _log: (_url, ok, reason) => { logs.push({ ok, reason }); },
    _toast: () => {},
    _maybeAutoSubmit: () => {},
  });
  return { A, injected, logs };
}

async function run(A, iterations = 64) {   // must exceed tryFill's poll-loop length
  const loginWv = { isConnected: true, getURL: () => 'https://accounts.spotify.com/login' };
  const p = A.tryFill(loginWv, 'https://accounts.spotify.com/login');
  for (let k = 0; k < iterations; k++) await vi.advanceTimersByTimeAsync(3100);
  await p;
}

// Turn a list of inbox states into a reader that yields each once, then repeats
// the last one forever (a real inbox keeps showing the same rows).
function scriptedReader(states) {
  let i = 0;
  return () => states[Math.min(i++, states.length - 1)];
}

const loaded = (code, unread, strong) => ({ loaded: true, code, unread, strong });

describe('EmailCodeAutofill._extractCode', () => {
  it('pulls a code after verification wording', () => {
    expect(EmailCodeAutofill._extractCode('Spotify Your verification code is 481920')).toBe('481920');
  });
  it('pulls a "123456 is your code" shape', () => {
    expect(EmailCodeAutofill._extractCode('758213 is your Spotify code')).toBe('758213');
  });
  it('falls back to a standalone 6-digit run', () => {
    expect(EmailCodeAutofill._extractCode('Login attempt 903214 from a new device')).toBe('903214');
  });
  it('returns null when there is no code', () => {
    expect(EmailCodeAutofill._extractCode('Your weekly newsletter is here')).toBeNull();
  });
});

describe('EmailCodeAutofill._isStrongCodeRow', () => {
  it('true for explicit verification wording', () => {
    expect(EmailCodeAutofill._isStrongCodeRow('Your verification code is 481920')).toBe(true);
    expect(EmailCodeAutofill._isStrongCodeRow('481920 is your Spotify code')).toBe(true);
  });
  it('false for a bare number with no code wording', () => {
    expect(EmailCodeAutofill._isStrongCodeRow('Order 481920 has shipped')).toBe(false);
  });
});

describe('EmailCodeAutofill._isHiddenReader', () => {
  it('true only for the dedicated hidden reader webview', () => {
    expect(EmailCodeAutofill._isHiddenReader({ id: 'vex-gmail-reader' })).toBe(true);
    expect(EmailCodeAutofill._isHiddenReader({ id: 'something-else' })).toBe(false);
    expect(EmailCodeAutofill._isHiddenReader(null)).toBe(false);
  });
});

describe('EmailCodeAutofill._readInbox body fallback', () => {
  // A gmail webview stub: the rows script yields no code; the body script (only
  // reached in the hidden reader) yields a body carrying the code.
  const makeWv = (id) => ({
    id, getURL: () => 'https://mail.google.com/mail/u/0/#inbox',
    executeJavaScript: async (js) => {
      if (js.includes('Back to Inbox')) return 'Hi — your Spotify verification code is 246810. It expires soon.';
      return JSON.stringify({ loaded: true, rows: [{ t: 'Weekly newsletter — top stories', u: true }] });
    },
  });

  it('reads the code from the email BODY when the inbox rows have none (hidden reader)', async () => {
    const A = Object.assign(Object.create(Object.getPrototypeOf(EmailCodeAutofill)), EmailCodeAutofill);
    const r = await A._readInbox(makeWv('vex-gmail-reader'));
    expect(r).toEqual({ loaded: true, code: '246810', unread: true, strong: true });
  });

  it('does NOT open message bodies in the user\'s own visible Gmail', async () => {
    const A = Object.assign(Object.create(Object.getPrototypeOf(EmailCodeAutofill)), EmailCodeAutofill);
    const r = await A._readInbox(makeWv('tab-7'));   // not the hidden reader
    expect(r.code).toBeNull();
  });
});

describe('EmailCodeAutofill._restoreAutoWoken', () => {
  let origWindow;
  beforeEach(() => { origWindow = global.window; });
  afterEach(() => { global.window = origWindow; });

  const fresh = () => Object.assign(Object.create(Object.getPrototypeOf(EmailCodeAutofill)), EmailCodeAutofill);
  function fakeTabs(activeId, tabs) {
    const slept = [];
    global.window = { TabManager: { activeTabId: activeId, tabs, sleepTab: (id) => slept.push(id) } };
    return slept;
  }

  it('re-sleeps a Gmail it woke, clearing the temporary keep-awake', () => {
    const A = fresh();
    const tab = { id: 'gmail', keepAwakeUntil: Date.now() + 120000 };
    const slept = fakeTabs('other', [tab]);
    A._autoWoken = 'gmail';
    A._restoreAutoWoken();
    expect(slept).toEqual(['gmail']);
    expect(tab.keepAwakeUntil).toBe(0);
    expect(A._autoWoken).toBeNull();
  });

  it('leaves the tab alone if the user is now viewing it', () => {
    const A = fresh();
    const tab = { id: 'gmail', keepAwakeUntil: Date.now() + 120000 };
    const slept = fakeTabs('gmail', [tab]);   // gmail is the active tab
    A._autoWoken = 'gmail';
    A._restoreAutoWoken();
    expect(slept).toEqual([]);
  });

  it('does nothing when it did not wake anything (e.g. Gmail was already live)', () => {
    const A = fresh();
    const slept = fakeTabs('x', [{ id: 'gmail' }]);
    A._autoWoken = null;
    A._restoreAutoWoken();
    expect(slept).toEqual([]);
  });
});

describe('EmailCodeAutofill.tryFill', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('fills a NEWER code that arrives after the page opened (fast path)', async () => {
    // Baseline is an old code, then a different one arrives -> fill the new one.
    const { A, injected, logs } = makeAutofill(scriptedReader([
      loaded('111111', false, true),   // baseline (old, already there)
      loaded('111111', false, true),
      loaded('222222', true, true),    // the new code arrives
    ]));
    await run(A);
    expect(injected).toEqual(['222222']);
    expect(logs.at(-1)).toEqual({ ok: true, reason: 'new-code' });
  });

  it('fills an inbox-empty -> first code arrives case', async () => {
    const { A, injected, logs } = makeAutofill(scriptedReader([
      { loaded: true, code: null, unread: false, strong: false }, // baseline: no code yet
      loaded('654321', true, true),                               // code lands
    ]));
    await run(A);
    expect(injected).toEqual(['654321']);
    expect(logs.at(-1).reason).toBe('new-code');
  });

  it('fills an UNREAD strong code that was ALREADY in the inbox (the bug) after a grace', async () => {
    // The code is present at baseline, unread + strong, and nothing newer comes.
    const { A, injected, logs } = makeAutofill(scriptedReader([
      loaded('345678', true, true),    // baseline == the code we actually want
    ]));
    await run(A);
    expect(injected).toEqual(['345678']);
    expect(logs.at(-1)).toEqual({ ok: true, reason: 'unread-baseline' });
  });

  it('fills a STRONG code even if unread detection fails, after a longer grace', async () => {
    // unread=false (e.g. Gmail markup shifted / auto-marked read) but the row is
    // clearly a verification code that stays newest — fill it as a last resort so
    // a real code isn't skipped just because unread detection is unreliable.
    const { A, injected, logs } = makeAutofill(scriptedReader([
      loaded('345678', false, true),
    ]));
    await run(A);
    expect(injected).toEqual(['345678']);
    expect(logs.at(-1)).toEqual({ ok: true, reason: 'strong-baseline' });
  });

  it('a genuinely newer code still wins over a strong baseline (no stale fill)', async () => {
    // Retry case: an old strong code is the baseline; a newer one arrives before
    // the strong-baseline grace elapses -> the NEW code is filled, not the old.
    const { A, injected, logs } = makeAutofill(scriptedReader([
      loaded('111111', false, true),   // old strong code (baseline)
      loaded('111111', false, true),
      loaded('222222', true, true),    // new code arrives at read 3
    ]));
    await run(A);
    expect(injected).toEqual(['222222']);
    expect(logs.at(-1).reason).toBe('new-code');
  });

  it('does NOT last-resort fill a WEAK (non-verification) unread baseline number', async () => {
    const { A, injected, logs } = makeAutofill(scriptedReader([
      loaded('345678', true, false),   // unread but not a verification code
    ]));
    await run(A);
    expect(injected).toEqual([]);
    expect(logs.at(-1)).toEqual({ ok: false, reason: 'no-new-code' });
  });

  it('records no-mail when no mail webview is available', async () => {
    const { A, injected, logs } = makeAutofill(scriptedReader([loaded('345678', true, true)]));
    A._findMailWebview = () => null;
    await run(A);
    expect(injected).toEqual([]);
    expect(logs.at(-1)).toEqual({ ok: false, reason: 'no-mail' });
  });
});

describe('EmailCodeAutofill.tryFill navigation boundary', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  // Asking a site for an email code IS a navigation: Spotify moves from the
  // email step to the code step and rewrites the URL, and did-start-navigation
  // bumps the generation even for a same-document push. Pinning the poll to the
  // original URL and generation killed it at exactly the moment the code field
  // appeared, so the code never got filled.
  async function poll(A, hrefs) {
    let href = hrefs[0];
    const loginWv = { isConnected: true, getURL: () => href, _navigationGeneration: 1 };
    const p = A.tryFill(loginWv, hrefs[0]);
    href = hrefs[1];
    loginWv._navigationGeneration = 2;
    for (let k = 0; k < 64; k++) await vi.advanceTimersByTimeAsync(3100);
    await p;
  }

  it('keeps polling when the site advances to its code step', async () => {
    const { A, injected } = makeAutofill(scriptedReader([
      loaded('111111', false, true),
      loaded('654321', true, true),
    ]));
    await poll(A, [
      'https://accounts.spotify.com/login?flow_ctx=first',
      'https://accounts.spotify.com/login/code?flow_ctx=regenerated',
    ]);
    expect(injected).toContain('654321');
  });

  it('stops polling once the page has left the site', async () => {
    const { A, injected } = makeAutofill(scriptedReader([
      loaded('111111', false, true),
      loaded('654321', true, true),
    ]));
    await poll(A, ['https://accounts.spotify.com/login', 'https://evil.test/login']);
    expect(injected).toEqual([]);
  });
});

describe('EmailCodeAutofill does not poll the mailbox itself', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  // Evidence from a real profile's autofill log: repeated
  // emailcode / mail.google.com / no-mail entries, and no entry at all for the
  // site being signed in to. Opening Gmail started a 90s poll that could only
  // report no-mail, and _running is one global mutex, so that poll blocked the
  // attempt that mattered.
  it('returns immediately on a webmail provider page', async () => {
    const { A, logs } = makeAutofill(scriptedReader([loaded('111111', true, true)]));
    let probed = false;
    A._hasEmptyCodeField = async () => { probed = true; return true; };
    const mailWv = { isConnected: true, getURL: () => 'https://mail.google.com/mail/u/0/#inbox' };
    await A.tryFill(mailWv, 'https://mail.google.com/mail/u/0/#inbox');
    expect(probed).toBe(false);
    expect(logs).toEqual([]);
    expect(A._running).toBe(false);
  });

  it('leaves the mutex free so the real login page can poll', async () => {
    const { A, injected } = makeAutofill(scriptedReader([
      loaded('111111', false, true),
      loaded('654321', true, true),
    ]));
    await A.tryFill({ isConnected: true, getURL: () => 'https://mail.google.com/mail/u/0/#inbox' }, 'https://mail.google.com/mail/u/0/#inbox');
    const loginWv = { isConnected: true, getURL: () => 'https://accounts.spotify.com/login' };
    const p = A.tryFill(loginWv, 'https://accounts.spotify.com/login');
    for (let k = 0; k < 64; k++) await vi.advanceTimersByTimeAsync(3100);
    await p;
    expect(injected).toContain('654321');
  });

  it('still polls a normal site whose host merely contains a provider name', async () => {
    const { A, injected } = makeAutofill(scriptedReader([
      loaded('111111', false, true),
      loaded('654321', true, true),
    ]));
    const wv = { isConnected: true, getURL: () => 'https://mail.google.com.evil.test/login' };
    const p = A.tryFill(wv, 'https://mail.google.com.evil.test/login');
    for (let k = 0; k < 64; k++) await vi.advanceTimersByTimeAsync(3100);
    await p;
    expect(injected).toContain('654321');
  });
});

describe('EmailCodeAutofill keeps watching a sign-in that has no code field yet', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  // Measured on the real https://accounts.spotify.com/en/login:
  //   looksLikeCodePage: false, hasEmptyCodeField: false, looksLikeAuthFlow: true
  // The old loop broke at `!plausible && i >= 4` (~15s) and, because neither
  // sawField nor plausible was ever true, did not even log a miss - which is
  // exactly why the profile's autofill log had no Spotify entry at all. The code
  // step then arrives in place, with no page load, so nothing re-ran.
  it('waits through the email step and fills once the code step appears', async () => {
    const { A, injected } = makeAutofill(scriptedReader([
      loaded(null, false, false),
      loaded('424242', true, true),
    ]));
    let step = 'email';
    A._hasEmptyCodeField = async () => step === 'code';
    A._looksLikeCodePage = async () => step === 'code';
    A._looksLikeAuthFlow = async () => true;
    const wv = { isConnected: true, getURL: () => 'https://accounts.spotify.com/en/login' };
    const p = A.tryFill(wv, 'https://accounts.spotify.com/en/login');
    for (let k = 0; k < 10; k++) await vi.advanceTimersByTimeAsync(3100);   // past the old cutoff
    step = 'code';
    for (let k = 0; k < 54; k++) await vi.advanceTimersByTimeAsync(3100);
    await p;
    expect(injected).toContain('424242');
  });

  it('still gives up quickly on a page that is not a sign-in at all', async () => {
    const { A, logs } = makeAutofill(scriptedReader([loaded('111111', true, true)]));
    A._hasEmptyCodeField = async () => false;
    A._looksLikeCodePage = async () => false;
    A._looksLikeAuthFlow = async () => false;
    const wv = { isConnected: true, getURL: () => 'https://news.example.test/article' };
    const p = A.tryFill(wv, 'https://news.example.test/article');
    for (let k = 0; k < 8; k++) await vi.advanceTimersByTimeAsync(3100);
    await p;
    expect(A._running).toBe(false);
    expect(logs).toEqual([]);
  });
});

describe('EmailCodeAutofill polls per page, not once for the whole app', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  // _running was a single global boolean. That was tolerable while a non-code
  // page gave up after ~15s, but once the poll was extended to ~3 minutes on
  // anything that looks like a sign-in, one login page could hold the lock for
  // minutes and the page actually asking for a code was dropped on entry -
  // silently, because a drop logged nothing.
  it('lets a second sign-in page poll while the first is still waiting', async () => {
    const { A, injected } = makeAutofill(scriptedReader([
      loaded('111111', false, true),
      loaded('654321', true, true),
    ]));
    A._looksLikeAuthFlow = async () => true;
    A._looksLikeCodePage = async () => false;
    const busy = { isConnected: true, getURL: () => 'https://discord.com/login' };
    A._hasEmptyCodeField = async (wv) => wv !== busy;      // only the second page has a code box
    A.tryFill(busy, 'https://discord.com/login');           // holds a poll for minutes
    const spotify = { isConnected: true, getURL: () => 'https://accounts.spotify.com/en/login/otp' };
    const p = A.tryFill(spotify, 'https://accounts.spotify.com/en/login/otp');
    for (let k = 0; k < 64; k++) await vi.advanceTimersByTimeAsync(3100);
    await p;
    expect(injected).toContain('654321');
  });

  it('records a miss instead of vanishing when too many polls are already running', async () => {
    const { A, logs } = makeAutofill(scriptedReader([loaded('111111', true, true)]));
    A._active = new Set([{}, {}, {}]);                      // at the cap
    await A.tryFill({ isConnected: true, getURL: () => 'https://accounts.spotify.com/en/login/otp' }, 'https://accounts.spotify.com/en/login/otp');
    expect(logs).toEqual([{ ok: false, reason: 'busy' }]);
  });

  it('will not start two polls for the same page', async () => {
    const { A } = makeAutofill(scriptedReader([loaded(null, false, false)]));
    A._looksLikeAuthFlow = async () => true;
    A._hasEmptyCodeField = async () => false;
    const wv = { isConnected: true, getURL: () => 'https://accounts.spotify.com/en/login' };
    A.tryFill(wv, 'https://accounts.spotify.com/en/login');
    await vi.advanceTimersByTimeAsync(100);
    expect(A._active.size).toBe(1);
    A.tryFill(wv, 'https://accounts.spotify.com/en/login');
    await vi.advanceTimersByTimeAsync(100);
    expect(A._active.size).toBe(1);
  });
});

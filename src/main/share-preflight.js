// === Screen sharing: why would it be refused? (T0-014) ======================
//
// A refused screen share used to be silent: every refusal path in the
// getDisplayMedia handler (main.js) just called back with nothing, and the page
// saw "NotAllowedError" or "AbortError". Nine refusals in one day, three fix
// commits, and no way to tell which cause was behind a given one.
//
// This module is the vocabulary and the checks, with no Electron in it:
//   - explain(code, ctx)  one refusal -> { code, message, fix } in plain words;
//   - preflight(facts)    the known causes, checked in order, before any picker;
//   - createShareLog()    the last refusals (in memory, host + reason only).
// main.js gathers the facts and calls these; the renderer shows the message and
// the one fix button. Nothing here changes a setting: a fix is a suggestion the
// person accepts.

const FIXES = {
  allow: { id: 'allow-screen-share', label: 'Allow screen sharing here' },
  site: { id: 'open-site-settings', label: 'Open site settings' },
  retry: { id: 'try-again', label: 'Try again' },
  bypass: { id: 'open-bypass-settings', label: 'Open the bypass setting' },
};

// code -> how it is said. `host` is the site's name; may be empty.
const REASONS = {
  'permission-denied': (h) => ({ message: `Screen sharing is blocked for ${h || 'this site'} (you chose Block earlier).`, fix: FIXES.allow }),
  'paranoid-mode': (h) => ({ message: `${h || 'This site'} is in paranoid mode, which never allows screen sharing.`, fix: FIXES.site }),
  'tor-tab': () => ({ message: 'A Tor tab is never given screen sharing.', fix: null }),
  'insecure-page': () => ({ message: 'Screen sharing only works on a secure (https) page.', fix: null }),
  'byedpi-on': (h) => ({ message: `${h || 'This page'} goes through the Strong bypass (ByeDPI). It rewrites the secure connection and can drop a screen share; Off, Light or Zapret do not.`, fix: FIXES.bypass }),
  'partition-unwired': () => ({ message: 'The browsing session of this tab has no screen-sharing picker attached, so a share would silently do nothing.', fix: null }),
  'no-frame': () => ({ message: 'The page that asked for the share is gone.', fix: FIXES.retry }),
  'not-in-a-tab': () => ({ message: 'The request did not come from a Vex tab (a hidden or pop-up frame), so Vex cannot show its picker for it.', fix: null }),
  'frame-detached': () => ({ message: 'The page that asked was closed or replaced before you chose.', fix: FIXES.retry }),
  'frame-unreadable': () => ({ message: 'Vex could not read the requesting frame to validate the screen share. Retry, and include this reason in your report.', fix: FIXES.retry }),
  'origin-unavailable': () => ({ message: 'Vex could not validate the requesting frame’s origin. The screen share was stopped before opening the picker.', fix: FIXES.retry }),
  'origin-changed': (h, c) => ({ message: `The page moved to another site${c && c.nowHost ? ' (' + c.nowHost + ')' : ''} before you chose, so the share was dropped.`, fix: FIXES.retry }),
  'no-sources': () => ({ message: 'Windows listed no screens or windows to share. Check Settings > Privacy > Screen capture, or a protected or disconnected display.', fix: null }),
  'capturer-error': (_h, c) => ({ message: 'Windows would not list the screens: ' + String((c && c.error) || 'unknown error').slice(0, 140), fix: FIXES.retry }),
  'pick-timeout': () => ({ message: 'No screen or window was chosen within 90 seconds, so the request was dropped.', fix: FIXES.retry }),
  'request-expired': () => ({ message: 'That share request had already expired.', fix: FIXES.retry }),
  'other-window': () => ({ message: 'The request belongs to another Vex window.', fix: null }),
  'source-gone': () => ({ message: 'The screen or window you chose is no longer there.', fix: FIXES.retry }),
  'start-failed': (_h, c) => ({ message: 'The share could not start: ' + String((c && c.error) || 'unknown error').slice(0, 140), fix: FIXES.retry }),
};

function explain(code, ctx) {
  const make = REASONS[code];
  if (!make) throw new Error('Not a known screen-share reason: ' + code);
  const host = ctx && ctx.host ? String(ctx.host) : '';
  const r = make(host, ctx || {});
  return { code, message: r.message, fix: r.fix ? { ...r.fix } : null, host };
}

// Why is the frame no longer the page that asked? (main.js _sameRequester said no.)
function frameOrigin(frame) {
  // about:blank/srcdoc can inherit a real origin which their URL does not
  // express. Electron's origin is authoritative; never fall back from an
  // explicitly opaque origin to the containing page's address.
  if (typeof frame.origin === 'string') return frame.origin === 'null' ? '' : new URL(frame.origin).origin;
  const origin = new URL(frame.url).origin;
  return origin === 'null' ? '' : origin;
}
function requesterIdentity(frame, contents) {
  try {
    if (!frame || !contents || contents.isDestroyed() || contents.mainFrame !== frame || frame.isDestroyed()) return null;
    const token = frame.frameToken, process = frame.processId;
    return typeof token === 'string' && token && Number.isInteger(process) && process >= 0 ? { contents, token, process } : null;
  } catch { return null; }
}
function requesterChange(frame, askedUrl, identity) {
  if (!frame) return 'no-frame';
  try {
    // A stale detached flag must never authorize a different document. Only
    // the current primary frame with the exact captured renderer token can
    // override it. Never substitute the current main frame for an old frame.
    if (identity) {
      const current = requesterIdentity(frame, identity.contents);
      if (!current || current.token !== identity.token || current.process !== identity.process) return 'frame-detached';
    } else if (frame.detached) return 'frame-detached';
  } catch { return 'frame-unreadable'; }
  try {
    const now = frameOrigin(frame), asked = new URL(askedUrl).origin;
    if (!now || asked === 'null') return 'origin-unavailable';
    return now === asked ? null : 'origin-changed';
  } catch { return 'frame-unreadable'; }
}
function hostOf(frame) {
  try { return frame && !frame.detached ? new URL(frameOrigin(frame)).hostname : ''; } catch { return ''; }
}

// Pages the browser treats as secure for screen capture without https: the machine itself.
const LOCAL = new Set(['localhost', '127.0.0.1', '[::1]']);
// Hosts that go through the Discord bypass proxy when ByeDPI is on (the panel's own session and Discord pages in normal tabs).
const DISCORD_HOST = /(^|\.)(discord\.com|discord\.gg|discordapp\.com|discordapp\.net|discord\.media)$/i;

// The facts main.js gathers for a tab (all plain values):
//   url              the page's address
//   saved            'allow' | 'deny' | null (the saved display-capture answer)
//   paranoid         the site is in paranoid mode
//   tor              the tab goes through Tor
//   partition        the tab's session partition (e.g. 'persist:discord'), or ''
//   partitionWired   whether that session has the screen-share picker attached (undefined: not asked)
//   byedpiRunning    the ByeDPI proxy is running (undefined: not asked)
//   sourcesCount     how many screens/windows Windows listed, or null if not asked
//   capturerError    the message if listing failed, else ''
// Returns { ok, checks: [{ id, ok, detail }], refusal, warnings }.
//   refusal   the first cause that WOULD refuse the share (secure page, Tor, paranoid, blocked, no session picker, no sources);
//   warnings  causes that MAY break it but do not refuse it (Strong bypass on): said, never blocking.
function preflight(facts) {
  const f = facts || {};
  let host = '', secure = false;
  try { const u = new URL(f.url); host = u.hostname; secure = u.protocol === 'https:' || ((u.protocol === 'http:') && LOCAL.has(host)); } catch { /* vex-allow-empty-catch: no usable address */ }
  const checks = [];
  const warnings = [];
  let refusal = null;
  const step = (id, ok, okText, code, ctx) => {
    const failing = !ok;
    checks.push({ id, ok, detail: failing ? explain(code, { host, ...ctx }).message : okText });
    if (failing && !refusal) refusal = explain(code, { host, ...ctx });
  };
  step('secure', secure, 'The page is secure (https).', 'insecure-page');
  step('tor', !f.tor, 'Not a Tor tab.', 'tor-tab');
  step('paranoid', !f.paranoid, 'The site is not in paranoid mode.', 'paranoid-mode');
  step('permission', f.saved !== 'deny', f.saved === 'allow' ? 'Screen sharing is allowed for this site.' : 'No block saved for this site; it will ask.', 'permission-denied');
  if (f.partitionWired !== undefined && f.partitionWired !== null) {
    step('partition', f.partitionWired === true, `The tab's session${f.partition ? ' (' + f.partition + ')' : ''} has the screen-share picker attached.`, 'partition-unwired');
  }
  if (f.byedpiRunning !== undefined && f.byedpiRunning !== null) {
    const through = f.byedpiRunning === true && (f.partition === 'persist:discord' || DISCORD_HOST.test(host));
    const w = explain('byedpi-on', { host });
    checks.push({ id: 'byedpi', ok: !through, detail: through ? w.message : 'The Strong bypass (ByeDPI) is not carrying this page.' });
    if (through) warnings.push(w);
  }
  if (f.sourcesCount !== null && f.sourcesCount !== undefined) {
    step('sources', f.sourcesCount > 0 && !f.capturerError, `Windows lists ${f.sourcesCount} screen${f.sourcesCount === 1 ? '' : 's'} and windows to share.`, f.capturerError ? 'capturer-error' : 'no-sources', { error: f.capturerError });
  }
  return { ok: !refusal && !warnings.length, checks, refusal, warnings };
}

// The last refusals, newest last, host and reason only (no page address, no
// title). In memory: it is a diagnostic for this session, and a restart is a
// fresh start.
function createShareLog(max = 40) {
  const entries = [];
  return {
    record(code, ctx) {
      const e = explain(code, ctx);
      entries.push({ t: Date.now(), code, host: e.host, message: e.message });
      while (entries.length > max) entries.shift();
      return e;
    },
    list() { return entries.slice().reverse(); },
    // { 'permission-denied': 3, ... } for the last `sinceMs`.
    counts(sinceMs = 24 * 3600 * 1000, now = Date.now()) {
      const out = {};
      for (const e of entries) if (now - e.t <= sinceMs) out[e.code] = (out[e.code] || 0) + 1;
      return out;
    },
  };
}

module.exports = { DISCORD_HOST, explain, preflight, createShareLog, requesterIdentity, requesterChange, hostOf, REASONS, FIXES };

// Pure helpers extracted from src/main.js for unit-testability.
// Anything in this file MUST stay free of `require('electron')` so the test
// runner can import it under plain Node.

const path = require('path');
const { pathToFileURL } = require('url');

// === External protocol forwarding ===
// Allowlist of non-http(s) schemes we hand off to shell.openExternal so the
// installed OS app (Roblox, Slack, mailto: client, etc.) launches. Schemes
// NOT in this set — including dangerous ones like javascript: and data: —
// fall through and are NOT forwarded. The set is the security boundary.
const EXTERNAL_PROTOCOLS = new Set([
  'roblox', 'roblox-player', 'roblox-studio',
  'mailto', 'tel', 'sms',
  'msteams', 'slack', 'zoommtg', 'zoomus', 'skype', 'discord',
  'vscode', 'vscode-insiders', 'obsidian',
  'spotify', 'steam',
  'ms-word', 'ms-excel', 'ms-powerpoint',
  'itmss', 'itms', 'itms-apps',
  'web+mastodon'
]);

function isExternalProtocol(url) {
  if (!url) return false;
  const m = /^([a-z][a-z0-9+.-]*):/i.exec(url);
  if (!m) return false;
  return EXTERNAL_PROTOCOLS.has(m[1].toLowerCase());
}

// === URL/path normalisation for argv from Windows shell ===
function normalizeLaunchArg(arg) {
  if (!arg || typeof arg !== 'string') return null;
  if (arg.startsWith('http://') || arg.startsWith('https://') || arg.startsWith('file://')) {
    return arg;
  }
  if (/\.html?$/i.test(arg) && /^[a-zA-Z]:[\\/]/.test(arg)) {
    return pathToFileURL(arg).toString();
  }
  return null;
}

function findLaunchUrl(argv) {
  for (const arg of (argv || [])) {
    const url = normalizeLaunchArg(arg);
    if (url) return url;
  }
  return null;
}

// === open-url buffering ===
// Canonical (tested) form of the cold-start link race fix. On a cold start
// the main process sends the clicked link via the 'open-url' IPC at the
// window's did-finish-load, but the renderer registers its handler late in its
// async init — so without buffering that first URL is dropped and Vex opens to
// the start page. deliver(url) is called by the IPC listener; attach(cb) is
// called when the renderer registers. URLs delivered before attach() are
// buffered and flushed (in order) on attach. A throwing cb never breaks
// delivery of later URLs.
//
// NOTE: preload.js is sandboxed and cannot require() this module, so it mirrors
// this exact logic inline. Keep the two in sync; this copy is the spec + test
// target.
function createOpenUrlBuffer() {
  let cb = null;
  const buffer = [];
  return {
    deliver(url) {
      if (cb) { try { cb(url); } catch { /* swallow — keep delivering */ } }
      else buffer.push(url);
    },
    attach(fn) {
      cb = fn;
      while (buffer.length) {
        const u = buffer.shift();
        try { cb(u); } catch { /* swallow */ }
      }
    },
  };
}

// === Fullscreen shortcut decider ===
// Pure-decision variant of handleFullscreenShortcut. Takes the input event +
// current tracked-state and returns a descriptor of what to do, so it can be
// tested without an Electron BrowserWindow. main.js wraps this with a thin
// closure that applies the action.
//
// Return shape:
//   { consumed: false }                      — handler did nothing, fall through
//   { consumed: true, action: 'toggle', to } — caller should setFullScreen(to)
//   { consumed: true, action: 'exit' }       — caller should setFullScreen(false)
function decideFullscreenAction(input, { isFullscreenTracked }) {
  if (!input || input.type !== 'keyDown') return { consumed: false };
  const noMods = !input.control && !input.alt && !input.shift && !input.meta;

  if (input.key === 'F11' && noMods) {
    return { consumed: true, action: 'toggle', to: !isFullscreenTracked };
  }
  if (input.key === 'Escape' && noMods && isFullscreenTracked) {
    return { consumed: true, action: 'exit' };
  }
  return { consumed: false };
}

// Convenience: same logic but applied to a (mock or real) BrowserWindow-like
// object. Tests can pass a mock with setFullScreen + a mutable trackedState.
// main.js passes its own closures over the module-level state.
function handleFullscreenShortcut(event, input, { mainWindow, isFullscreenTracked }) {
  if (!mainWindow) return false;
  const decision = decideFullscreenAction(input, { isFullscreenTracked });
  if (!decision.consumed) return false;
  if (event && typeof event.preventDefault === 'function') event.preventDefault();
  if (decision.action === 'toggle') mainWindow.setFullScreen(decision.to);
  else if (decision.action === 'exit') mainWindow.setFullScreen(false);
  return true;
}

// === Path-traversal sanitizers (security audit H-1, H-2, H-3) ===

// Validate that a candidate path resolves inside an allowed parent directory.
// Returns the resolved absolute path if safe; throws Error if it escapes.
// Defends against:
//   - "../" path traversal,
//   - absolute paths that escape the parent,
//   - lexical tricks like "a/../../etc".
// Does NOT chase symlinks — callers that need that should also check
// fs.realpathSync before using the returned path.
function safeJoin(parentDir, untrustedRelative) {
  if (typeof parentDir !== 'string' || !parentDir) {
    throw new Error('safeJoin: parentDir must be a non-empty string');
  }
  if (typeof untrustedRelative !== 'string') {
    throw new Error('safeJoin: untrustedRelative must be a string');
  }
  const parentResolved = path.resolve(parentDir);
  const candidate = path.resolve(parentResolved, untrustedRelative);
  if (
    candidate !== parentResolved &&
    !candidate.startsWith(parentResolved + path.sep)
  ) {
    throw new Error(
      `Path traversal blocked: ${untrustedRelative} resolves outside ${parentDir}`
    );
  }
  return candidate;
}

// === Geolocation coarsener (security audit M-3) ===
// The geolocation bridge in src/preload-webview.js used to expose
// `getPref()` directly to every guest page, letting any site read the user's
// stored coordinates without going through the permission prompt. The fix
// merges permission-check + pref-read into a single atomic IPC call and runs
// the result through `coarsenLocation` before it reaches the renderer.
//
// Coarsening does two privacy jobs:
//   1. Strips every field except {mode, latitude, longitude} — so even if a
//      future code path adds ISP / ASN / IP / accuracy / timezone to the raw
//      pref, those never leak across the bridge.
//   2. Rounds lat/lng to 1 decimal place (~11 km, city-level precision) so
//      a renderer-XSS can't read the user's building-precision location.
const COARSE_DECIMAL_PLACES = 1;

function roundCoord(n) {
  if (typeof n !== 'number' || !Number.isFinite(n)) return null;
  const f = 10 ** COARSE_DECIMAL_PLACES;
  return Math.round(n * f) / f;
}

// Sanitises a raw geolocation:get response into the minimal renderer-facing
// shape. Returns one of (and ONLY one of):
//   { mode: 'denied' }                              — denied / off / malformed
//   { mode: 'manual', latitude: N, longitude: N }   — coarse coords (1 dp)
//   { mode: 'ip' }                                  — caller does IP fallback
// No other fields are ever returned. Extra fields on `rawPref` (ISP, ASN,
// timezone, accuracy, timestamp, etc.) are dropped on the floor.
function coarsenLocation(rawPref) {
  if (!rawPref || typeof rawPref !== 'object') return { mode: 'denied' };
  if (rawPref.mode === 'off') return { mode: 'denied' };
  if (rawPref.mode === 'manual') {
    const lat = roundCoord(rawPref.latitude);
    const lng = roundCoord(rawPref.longitude);
    if (lat == null || lng == null) return { mode: 'ip' };
    return { mode: 'manual', latitude: lat, longitude: lng };
  }
  if (rawPref.mode === 'ip') return { mode: 'ip' };
  return { mode: 'denied' };
}

// === PiP URL validator (security audit M-4) ===
// The 'open-pip-window' IPC accepts a URL from the renderer and hands it to
// BrowserWindow.loadURL. Without scheme restrictions, a renderer-XSS could pop
// a frameless always-on-top window pointing at file:///, chrome://,
// javascript:, data:text/html, etc. Restrict to http(s) — PiP is for video
// popouts and there's no legitimate use case beyond those two schemes.
const SAFE_PIP_SCHEMES = ['http:', 'https:'];

function safePipUrl(rawUrl) {
  if (typeof rawUrl !== 'string' || rawUrl.length === 0) {
    throw new Error('Invalid PiP URL: must be non-empty string');
  }
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error(`Invalid PiP URL: not parseable: ${rawUrl}`);
  }
  if (!SAFE_PIP_SCHEMES.includes(parsed.protocol)) {
    throw new Error(`Invalid PiP URL: scheme '${parsed.protocol}' not allowed`);
  }
  return parsed.toString();
}

// Validate a "name" segment that should not contain any path separators or
// traversal. Use for folder/file/key names where slashes are never legitimate.
function safeName(name) {
  if (typeof name !== 'string' || name.length === 0) {
    throw new Error('Invalid name: must be non-empty string');
  }
  if (
    name.includes('/') ||
    name.includes('\\') ||
    name.includes('..') ||
    name.includes('\0')
  ) {
    throw new Error(`Invalid name: contains illegal characters: ${name}`);
  }
  if (name === '.' || name === '..') {
    throw new Error(`Invalid name: reserved: ${name}`);
  }
  return name;
}

// === Spellcheck — replace a misspelled word on a guest webContents ===
// `replaceMisspelling` lives on Electron `webContents`, NOT on the <webview>
// tag element — the renderer's old `webview.replaceMisspelling?.()` was a
// silent no-op. The renderer routes here via IPC. Resolution mirrors the
// devtools:open-for-webcontents two-strategy lookup: fromId fast path, then
// URL match across all webContents (covers <webview>.getWebContentsId()
// returning -1 on a not-yet-fully-attached guest).
//
// `webContentsModule` is Electron's `webContents` namespace, injected so this
// file stays free of `require('electron')` and remains unit-testable.
function resolveAndReplaceMisspelling(webContentsModule, webContentsId, suggestion, fallbackUrl) {
  if (typeof suggestion !== 'string' || suggestion.length === 0) {
    return { ok: false, error: 'invalid suggestion' };
  }
  let wc = null;
  try {
    if (typeof webContentsId === 'number' && webContentsId > 0) {
      wc = webContentsModule.fromId(webContentsId);
      if (wc && wc.isDestroyed()) wc = null;
    }
  } catch { /* fromId can throw on a stale id */ }
  if (!wc && typeof fallbackUrl === 'string' && fallbackUrl) {
    try {
      wc = webContentsModule.getAllWebContents()
        .find(c => !c.isDestroyed() && c.getURL() === fallbackUrl) || null;
    } catch { /* getAllWebContents/getURL best-effort */ }
  }
  if (!wc) {
    return { ok: false, error: 'webContents not found', requestedId: webContentsId };
  }
  try {
    wc.replaceMisspelling(suggestion);
    return { ok: true, id: wc.id };
  } catch (err) {
    return { ok: false, error: err.message, id: wc.id };
  }
}

// === OAuth identity popups ===
// These identity providers run a POPUP-based OAuth handshake: the popup
// postMessages the credential back to window.opener and then self-closes.
// setWindowOpenHandler must 'allow' them as real popup windows — re-homing
// the URL into a plain Vex tab severs window.opener and the flow dead-ends
// (Google GSI famously hangs blank on accounts.google.com/gsi/transform).
//
// Conservative list: ONLY hosts known to use popup mode. Redirect-based
// flows (github.com/login, login.live.com) are deliberately excluded —
// allowing those as popups would break their normal redirect.
const OAUTH_POPUP_HOSTS = new Set([
  'accounts.google.com',        // Google Identity Services (GSI)
  'login.microsoftonline.com',  // Microsoft Identity Platform
  'appleid.apple.com',          // Sign in with Apple
]);

// Exact-host match — no subdomain, suffix, or substring matching, so a
// deceptive host like accounts.google.com.evil.example is NOT treated as
// OAuth. Path is irrelevant: the whole host is OAuth territory.
function isOAuthPopupUrl(url) {
  if (typeof url !== 'string' || !url) return false;
  try {
    return OAUTH_POPUP_HOSTS.has(new URL(url).host);
  } catch {
    return false;
  }
}

module.exports = {
  EXTERNAL_PROTOCOLS,
  isExternalProtocol,
  resolveAndReplaceMisspelling,
  OAUTH_POPUP_HOSTS,
  isOAuthPopupUrl,
  normalizeLaunchArg,
  findLaunchUrl,
  createOpenUrlBuffer,
  decideFullscreenAction,
  handleFullscreenShortcut,
  safeJoin,
  safeName,
  safePipUrl,
  SAFE_PIP_SCHEMES,
  coarsenLocation,
  roundCoord,
  COARSE_DECIMAL_PLACES,
};

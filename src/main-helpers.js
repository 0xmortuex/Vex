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

module.exports = {
  EXTERNAL_PROTOCOLS,
  isExternalProtocol,
  normalizeLaunchArg,
  findLaunchUrl,
  decideFullscreenAction,
  handleFullscreenShortcut,
  safeJoin,
  safeName,
};

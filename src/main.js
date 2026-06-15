const { app, BrowserWindow, session, ipcMain, protocol, globalShortcut, Menu, net, shell, dialog, webContents, safeStorage } = require('electron');

// Enable Chromium's rich print preview UI (Save as PDF, margin controls,
// pages-per-sheet, background graphics, etc.). Without these flags Electron
// falls back to the Windows OS print dialog, which only exposes
// "Microsoft Print to PDF" with no preview. Both switches are idempotent;
// some Electron builds key off the feature flag, others off the dedicated
// switch, so apply both. MUST run before any other app.* access — Chromium
// initializes its feature list on first app touch, and reading e.g.
// app.isPackaged in a console.log was previously happening above this block.
app.commandLine.appendSwitch('enable-features', 'PrintPreview');
app.commandLine.appendSwitch('enable-print-preview');

// Disable Chromium's third-party storage partitioning. Since Chrome ~115 this
// is on by default and it BREAKS redirect-based federated sign-in: Firebase's
// signInWithRedirect (used by ElevenLabs' "Sign in with Google", many others)
// writes a pending-login token to sessionStorage, bounces to the auth handler
// on the provider/authDomain, then returns — and the auth-handler iframe gets a
// *partitioned* storage bucket, so it can't read the state it wrote. The result
// is Firebase's "Unable to process request due to missing initial state" page.
// Turning the feature off restores the unpartitioned behavior these flows rely
// on. Tradeoff: third-party storage is no longer isolated per top-site (a minor
// privacy reduction) — acceptable here because Vex's ad/tracker blocker already
// strips the cross-site trackers that would exploit it. MUST run before any
// other app.* access (Chromium freezes its feature list on first touch).
app.commandLine.appendSwitch('disable-features', 'ThirdPartyStoragePartitioning');

const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const { shouldBlock } = require('./adblocker');
const { initEngine: initAdblockEngine, engineBlocks } = require('./adblocker-engine');
const { createPipWindow, closePipWindow } = require('./pip');
const _mainHelpers = require('./main-helpers');
const { safeJoin, safeName, safePipUrl } = _mainHelpers;
const { registerSidebarConfigIpc } = require('./sidebar-config');

// === [Vex URL] DIAGNOSTIC: trace every layer of HTML/URL forwarding chain ===
console.log('[Vex URL] ====== Vex process boot ======');
console.log('[Vex URL] argv:', JSON.stringify(process.argv));
console.log('[Vex URL] cwd:', process.cwd());
console.log('[Vex URL] execPath:', process.execPath);
console.log('[Vex URL] defaultApp:', !!process.defaultApp);
console.log('[Vex URL] isPackaged:', app.isPackaged);

// Auto-updater (graceful — works in dev, fails silently if not packaged)
let autoUpdater = null;
try { autoUpdater = require('electron-updater').autoUpdater; } catch {}

let mainWindow = null;
let adBlockerEnabled = true;
let pendingOpenUrl = null;
// Widevine/DRM (castLabs) status, surfaced in Settings → About so users can tell
// whether protected playback (Spotify/Netflix) is actually enabled.
let _widevineStatus = 'unknown';

// Initialize the castLabs Widevine CDM "component". First run downloads it from
// Google's component server (a few seconds), cached afterwards. Made robust:
//   - fire-and-forget (never blocks window creation — playback happens later);
//   - each attempt races a 30s timeout so a stalled download can't wedge things,
//     and a second attempt gives a genuinely slow first-run download more time;
//   - failures leave an actionable status (Settings → About shows a Retry button
//     that relaunches Vex to re-run the install — the reliable recovery for a
//     transient first-run network failure, since whenReady() is memoized per run).
async function initWidevine(attempts = 2) {
  let components;
  try { ({ components } = require('electron')); } catch {}
  if (!components || typeof components.whenReady !== 'function') {
    _widevineStatus = 'unavailable (this Electron build has no Widevine)';
    return;
  }
  for (let i = 1; i <= attempts; i++) {
    try {
      await Promise.race([
        components.whenReady(),
        new Promise((_, rej) => setTimeout(() => rej(new Error('timed out — check your internet connection')), 30000)),
      ]);
      const st = typeof components.status === 'function' ? components.status() : null;
      console.log('[Widevine] components ready:', st);
      const wv = st && (st['Widevine Content Decryption Module'] || st.WIDEVINE || JSON.stringify(st));
      _widevineStatus = app.isPackaged
        ? (wv ? ('ready (' + wv + ')') : 'loaded')
        : 'dev mode — protected playback needs the installed build';
      return;
    } catch (e) {
      const msg = (e && e.message) || 'unknown error';
      _widevineStatus = 'failed: ' + msg;
      console.warn(`[Widevine] component init failed (attempt ${i}/${attempts}):`, msg);
      if (i < attempts) await new Promise(r => setTimeout(r, 3000));
    }
  }
}

// === Privacy hardening: fingerprint farbling seed, DNS-over-HTTPS, tracker tally ===
// Config persisted to userData/privacy.json. Everything defaults OFF so normal
// browsing is untouched until the user opts in (Settings → Privacy Hardening).
let privacyCfg = { farble: false, doh: 'off', dohProvider: 'cloudflare' };
// One stable seed per app run: farbling noise is consistent within a session
// (so a single site sees a coherent fingerprint) but changes across sessions
// (so it can't be used to link you over time). crypto so it's unguessable.
const FARBLE_SEED = (() => { try { return require('crypto').randomBytes(4).readUInt32LE(0); } catch { return 0x9e3779b9; } })();
const DOH_PROVIDERS = {
  cloudflare: 'https://cloudflare-dns.com/dns-query',
  google: 'https://dns.google/dns-query',
  quad9: 'https://dns.quad9.net/dns-query',
};
const _trackerTally = Object.create(null);
const _trackerSites = Object.create(null); // tracker host -> Set of first-party site hosts
let _trackerTotal = 0;
// Record one blocked request: bump the per-tracker count and remember which
// first-party site it was loaded on (so we can show cross-site trackers — the
// ones that follow you around the web). webContents.fromId resolves the tab that
// initiated the request; only runs on blocks (a fraction of traffic).
function _recordTracker(reqUrl, wcId) {
  try {
    const h = new URL(reqUrl).hostname.replace(/^www\./, '');
    _trackerTally[h] = (_trackerTally[h] || 0) + 1; _trackerTotal++;
    if (wcId != null) {
      const wc = webContents.fromId(wcId);
      const purl = wc && typeof wc.getURL === 'function' ? wc.getURL() : '';
      if (purl && /^https?:/i.test(purl)) {
        const site = new URL(purl).hostname.replace(/^www\./, '');
        if (site && site !== h) (_trackerSites[h] || (_trackerSites[h] = new Set())).add(site);
      }
    }
  } catch {}
}
function privacyLoad() {
  try { const fs = require('fs'); if (fs.existsSync(PRIVACY_FILE())) privacyCfg = { ...privacyCfg, ...JSON.parse(fs.readFileSync(PRIVACY_FILE(), 'utf8')) }; } catch {}
  return privacyCfg;
}
function privacySave() { try { require('fs').writeFileSync(PRIVACY_FILE(), JSON.stringify(privacyCfg)); } catch {} }
const PRIVACY_FILE = () => path.join(app.getPath('userData'), 'privacy.json');
function applyDoH() {
  try {
    if (privacyCfg.doh === 'off') { app.configureHostResolver({ secureDnsMode: 'off', secureDnsServers: [] }); return; }
    const server = DOH_PROVIDERS[privacyCfg.dohProvider] || DOH_PROVIDERS.cloudflare;
    // 'automatic' = opportunistic (falls back to system DNS if DoH fails — safe);
    // 'secure' = strict (DoH only, hardest privacy but can break captive portals).
    app.configureHostResolver({ secureDnsMode: privacyCfg.doh === 'strict' ? 'secure' : 'automatic', secureDnsServers: [server] });
  } catch (e) { console.error('[privacy] DoH apply failed:', e.message); }
}
// Track fullscreen state ourselves: Electron's BrowserWindow.isFullScreen()
// returns false on transparent + frameless windows (frame: false, transparent:
// true) on Windows, even after setFullScreen(true) and after the
// enter-full-screen event has fired. We rely on the native enter/leave events
// (which DO fire correctly) to keep this in sync, and read this variable
// instead of isFullScreen() everywhere we need to flip state.
let isFullscreenTracked = false;
// Auto-open DevTools when unpackaged (dev) or when --dev-tools is passed
const enableDevToolsAtStartup = process.argv.includes('--dev-tools') || !app.isPackaged;

// Clean up global shortcuts on quit
app.on('will-quit', () => { try { globalShortcut.unregisterAll(); } catch {} });

// F11 / Escape fullscreen handling — shared between the main-window and every
// <webview> guest webContents, because before-input-event only fires on the
// webContents that actually has focus. Without attaching to both, F11 only
// works when Vex's chrome is focused (URL bar etc.) and dies the moment the
// user clicks into a page. Returns true if the input was consumed so callers
// can skip their remaining handlers.
function handleFullscreenShortcut(event, input) {
  if (input && input.key === 'F11') {
    console.log('[Vex F11] handleFullscreenShortcut entered. type:', input.type, 'mods:', { c: input.control, a: input.alt, s: input.shift, m: input.meta }, 'mainWindow:', !!mainWindow, 'tracked:', isFullscreenTracked, 'isFullScreen():', mainWindow ? mainWindow.isFullScreen() : 'n/a');
  }
  return _mainHelpers.handleFullscreenShortcut(event, input, { mainWindow, isFullscreenTracked });
}

// F12 / Ctrl+Shift+I — toggle Chromium DevTools on the currently active webview.
// Attached to both the main window and every guest webContents for the same
// reason as the fullscreen handler: before-input-event only fires where focus
// lives, so without the guest hook F12 dies as soon as a page is clicked into.
// The renderer owns the "which tab is active" mapping, so we bounce through IPC
// rather than trying to guess from main.
function handleDevToolsShortcut(event, input) {
  if (!mainWindow || input.type !== 'keyDown') return false;

  const isDevToolsKey = input.key === 'F12' ||
    (input.control && input.shift && (input.key === 'I' || input.key === 'i'));
  if (!isDevToolsKey) return false;

  event.preventDefault();
  mainWindow.webContents.send('devtools:toggle-request');
  return true;
}

// Ctrl+Shift+R — hard reload (clear cache + reload). Like F11/F12, this must
// work even when a <webview> guest has focus: keydown inside a guest does NOT
// bubble to the host document, so the renderer's ShortcutsRegistry never sees
// it there. We catch it in the guest's before-input-event and tell the renderer
// to hard-reload the active tab. (The renderer still handles the chrome-focused
// case via ShortcutsRegistry; the two focus states are mutually exclusive, so
// there's no double-trigger.)
function handleHardReloadShortcut(event, input) {
  if (!mainWindow || !input || input.type !== 'keyDown') return false;
  if (input.control && input.shift && !input.alt && !input.meta &&
      (input.key === 'R' || input.key === 'r')) {
    event.preventDefault();
    mainWindow.webContents.send('hard-reload-tab');
    return true;
  }
  return false;
}

// === URL/path normalisation for argv from Windows shell ===
// Windows passes a double-clicked .html as an absolute file path
// (C:\Users\…\foo.html), not a file:// URL. Browsers register for both http(s)
// protocols AND file associations, so argv can be any of:
//   http://… / https://…           (link click in another app)
//   file:///C:/Users/…/foo.html    (less common — some launchers do this)
//   C:\Users\…\foo.html            (File Explorer double-click)
// Convert all of these into something the renderer's TabManager can load.
function normalizeLaunchArg(arg) {
  const out = _mainHelpers.normalizeLaunchArg(arg);
  console.log('[Vex URL]   normalize:', JSON.stringify(arg), '->', out);
  return out;
}
function findLaunchUrl(argv) {
  console.log('[Vex URL]   findLaunchUrl scanning', (argv || []).length, 'args');
  return _mainHelpers.findLaunchUrl(argv);
}

// === Single-instance lock (so external links route to existing Vex window) ===
console.log('[Vex URL] requesting single-instance lock...');
const gotTheLock = app.requestSingleInstanceLock();
console.log('[Vex URL] gotLock:', gotTheLock);
if (!gotTheLock) {
  console.log('[Vex URL] another instance already holds the lock — quitting (this argv should reach the primary via second-instance)');
  app.quit();
} else {
  app.on('second-instance', (event, commandLine, workingDirectory) => {
    console.log('[Vex URL] second-instance fired.');
    console.log('[Vex URL]   commandLine:', JSON.stringify(commandLine));
    console.log('[Vex URL]   workingDirectory:', workingDirectory);
    const url = findLaunchUrl(commandLine);
    console.log('[Vex URL]   normalized URL:', url);
    console.log('[Vex URL]   mainWindow present:', !!mainWindow);
    if (url && mainWindow) {
      console.log('[Vex URL]   sending open-url IPC to renderer');
      mainWindow.webContents.send('open-url', url);
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    } else if (url && !mainWindow) {
      console.log('[Vex URL]   no mainWindow yet — stashing as pendingOpenUrl');
      pendingOpenUrl = url;
    } else {
      console.log('[Vex URL]   no URL found in second-instance argv — nothing to forward');
    }
  });
}

// === Register Vex as HTTP/HTTPS protocol handler ===
if (process.defaultApp) {
  // Dev mode
  if (process.argv.length >= 2) {
    app.setAsDefaultProtocolClient('http', process.execPath, [path.resolve(process.argv[1])]);
    app.setAsDefaultProtocolClient('https', process.execPath, [path.resolve(process.argv[1])]);
  }
} else {
  app.setAsDefaultProtocolClient('http');
  app.setAsDefaultProtocolClient('https');
}

// macOS open-url event
app.on('open-url', (event, url) => {
  event.preventDefault();
  if (mainWindow) {
    mainWindow.webContents.send('open-url', url);
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  } else {
    pendingOpenUrl = url;
  }
});

// Storage helpers
const userDataPath = app.getPath('userData');

// Local sidebar config (userData/sidebar-config.json) — lets the renderer
// fetch personalized tool URLs that must stay out of the public repo.
registerSidebarConfigIpc(ipcMain, userDataPath);

// === Download tracking helper (hoisted so private-window sessions can reuse it) ===
function _broadcastDownloadEvent(channel, data) {
  BrowserWindow.getAllWindows().forEach(w => {
    if (!w.isDestroyed()) { try { w.webContents.send(channel, data); } catch {} }
  });
}
// === Site permission handler (geolocation, camera, mic, notifications, ...) ===
const permissionsFile = path.join(userDataPath, 'permissions.json');
const pendingPermissions = new Map();

// On cold start the renderer may not have registered its 'permission:request'
// listener yet when a webview fires a permission check. Queue sends until the
// renderer signals ready (or the fallback flush fires), otherwise the first
// prompt of the session silently times out.
let _permissionsRendererReady = false;
const _pendingPermissionSends = [];
function _deliverPermissionRequest(payload) {
  const win = mainWindow && !mainWindow.isDestroyed() ? mainWindow : null;
  if (!win) return false;
  try { win.webContents.send('permission:request', payload); return true; }
  catch { return false; }
}
function sendPermissionRequest(payload) {
  if (_permissionsRendererReady && _deliverPermissionRequest(payload)) return;
  _pendingPermissionSends.push(payload);
}
function _flushPermissionQueue(reason) {
  if (!_pendingPermissionSends.length) return;
  console.log(`[Permissions] flushing ${_pendingPermissionSends.length} queued request(s): ${reason}`);
  while (_pendingPermissionSends.length) {
    const p = _pendingPermissionSends.shift();
    if (!_deliverPermissionRequest(p)) {
      _pendingPermissionSends.unshift(p);
      return;
    }
  }
}
ipcMain.on('permissions:renderer-ready', () => {
  _permissionsRendererReady = true;
  _flushPermissionQueue('renderer signalled ready');
});

function loadPermissionDecisions() {
  try {
    if (fs.existsSync(permissionsFile)) {
      return JSON.parse(fs.readFileSync(permissionsFile, 'utf-8')) || {};
    }
  } catch {}
  return {};
}
function savePermissionDecisions(data) {
  try { fs.writeFileSync(permissionsFile, JSON.stringify(data, null, 2), 'utf-8'); }
  catch (err) { console.error('[Permissions] save failed:', err.message); }
}

function wirePermissionsOnSession(ses, tag) {
  if (!ses || ses.__vexPermsWired) return;
  ses.__vexPermsWired = true;

  ses.setPermissionRequestHandler((webContents, permission, callback, details) => {
    let origin = 'unknown';
    try { origin = new URL((details && details.requestingUrl) || webContents.getURL()).origin; } catch {}

    console.log(`[Permissions] (${tag}) ${origin} requests: ${permission}`);

    // Standard browser auto-allow list. mediaKeySystem (EME/Widevine DRM, used by
    // Spotify, Netflix, etc.) is auto-allowed like a normal browser — prompting
    // for it silently broke playback in the Spotify panel because the prompt
    // never surfaced/resolved there, so play and other actions did nothing.
    const AUTO_ALLOW = new Set(['fullscreen', 'pointerLock', 'clipboard-read', 'clipboard-sanitized-write', 'mediaKeySystem']);
    if (AUTO_ALLOW.has(permission)) return callback(true);

    const NEEDS_PROMPT = new Set(['geolocation', 'media', 'midi', 'midiSysex', 'notifications', 'camera', 'microphone', 'display-capture']);
    if (!NEEDS_PROMPT.has(permission)) {
      // Unknown permission — deny by default, but log so we can add it later
      console.log(`[Permissions] DENIED (unlisted): ${permission}`);
      return callback(false);
    }

    // Check persisted decisions
    const decisions = loadPermissionDecisions();
    const key = `${origin}::${permission}`;
    if (decisions[key] === 'allow') return callback(true);
    if (decisions[key] === 'deny')  return callback(false);

    // Ask the user — queued if the renderer isn't listening yet (cold start).
    const id = `perm_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    pendingPermissions.set(id, callback);
    sendPermissionRequest({ id, origin, permission });

    // Safety timeout — if the user ignores the prompt for 2 minutes, deny.
    setTimeout(() => {
      if (pendingPermissions.has(id)) {
        pendingPermissions.delete(id);
        try { callback(false); } catch {}
      }
    }, 120000);
  });

  // Sync check (used by navigator.permissions.query) — only grant if explicitly allowed
  ses.setPermissionCheckHandler((_wc, permission, requestingOrigin) => {
    // WebHID: keep navigator.hid available, and mark this origin as having a
    // device request in flight — Chromium runs this 'hid' check at the start of
    // requestDevice(), which lets the device-permission handler permit the
    // chooser to enumerate/open for it (see wireWebHidOnSession). Per-device
    // gating remains the interactive chooser.
    if (permission === 'hid') { _markHidRequestActive(requestingOrigin); return true; }
    // DRM playback (EME) is auto-OK like a normal browser, so the sync check
    // Chromium runs during requestMediaKeySystemAccess() doesn't block Spotify.
    if (permission === 'mediaKeySystem' || permission === 'fullscreen' || permission === 'pointerLock') return true;
    const decisions = loadPermissionDecisions();
    return decisions[`${requestingOrigin}::${permission}`] === 'allow';
  });
}

ipcMain.handle('permission:respond', (_e, payload) => {
  const { id, decision, remember, origin, permission } = payload || {};
  const cb = pendingPermissions.get(id);
  if (!cb) return { ok: false, error: 'No pending request' };
  pendingPermissions.delete(id);
  try { cb(decision === 'allow'); } catch {}
  if (remember && origin && permission) {
    const d = loadPermissionDecisions();
    d[`${origin}::${permission}`] = decision;
    savePermissionDecisions(d);
  }
  return { ok: true };
});
// === QR code for the current page (qrcode npm package, rendered in main) ===
ipcMain.handle('qr:make', async (_e, text) => {
  try {
    if (!text || typeof text !== 'string') return null;
    return await require('qrcode').toDataURL(text.slice(0, 1500), { width: 280, margin: 1 });
  } catch { return null; }
});

// === Per-process resource metrics for the renderer's Resource Monitor ===
ipcMain.handle('app:metrics', () => {
  try {
    return app.getAppMetrics().map(p => ({
      type: p.type,
      cpu: (p.cpu && p.cpu.percentCPUUsage) || 0,
      memKB: (p.memory && p.memory.workingSetSize) || 0,
    }));
  } catch { return []; }
});

// === Full-text recall ("memex") — index the text of pages you read, search it
// later. Stored as a capped JSON log in userData; local only, never uploaded. ===
const RECALL_FILE = () => path.join(app.getPath('userData'), 'recall.json');
const RECALL_MAX = 2000;
let _recallCache = null;
function recallLoad() {
  if (_recallCache) return _recallCache;
  try {
    const fsx = require('fs');
    _recallCache = fsx.existsSync(RECALL_FILE()) ? JSON.parse(fsx.readFileSync(RECALL_FILE(), 'utf8')) : [];
    if (!Array.isArray(_recallCache)) _recallCache = [];
  } catch { _recallCache = []; }
  return _recallCache;
}
let _recallSaveTimer = null;
function recallPersist() {
  clearTimeout(_recallSaveTimer);
  _recallSaveTimer = setTimeout(() => {
    try { require('fs').writeFileSync(RECALL_FILE(), JSON.stringify(_recallCache || [])); } catch {}
  }, 1500);
}
ipcMain.handle('recall:index', (_e, entry) => {
  try {
    const { url, title, text } = entry || {};
    if (!url || !/^https?:/i.test(url) || !text || text.length < 120) return { ok: false };
    const arr = recallLoad();
    const i = arr.findIndex(e => e.url === url);
    const rec = { url, title: String(title || '').slice(0, 300), text: String(text).slice(0, 6000), at: Date.now() };
    if (i >= 0) arr[i] = rec; else arr.unshift(rec);
    if (arr.length > RECALL_MAX) arr.length = RECALL_MAX;
    recallPersist();
    return { ok: true };
  } catch (err) { return { ok: false, error: err.message }; }
});
ipcMain.handle('recall:search', (_e, query) => {
  try {
    const q = String(query || '').toLowerCase().trim();
    if (!q) return [];
    const terms = q.split(/\s+/).filter(Boolean);
    const arr = recallLoad();
    const scored = [];
    for (const e of arr) {
      const hay = (e.title + ' ' + e.text).toLowerCase();
      let score = 0;
      for (const t of terms) { const n = hay.split(t).length - 1; if (!n) { score = 0; break; } score += n; }
      if (score > 0) {
        const idx = e.text.toLowerCase().indexOf(terms[0]);
        const snippet = idx >= 0 ? e.text.slice(Math.max(0, idx - 60), idx + 120) : e.text.slice(0, 160);
        scored.push({ url: e.url, title: e.title, at: e.at, score, snippet });
      }
    }
    return scored.sort((a, b) => b.score - a.score).slice(0, 40);
  } catch { return []; }
});
ipcMain.handle('recall:clear', () => { _recallCache = []; recallPersist(); return { ok: true }; });

// === Translate arbitrary text/word (free Google endpoint, via main to dodge CORS) ===
ipcMain.handle('translate:text', async (_e, { text, tl } = {}) => {
  try {
    if (!text) return null;
    const u = 'https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=' +
      encodeURIComponent(tl || 'en') + '&dt=t&q=' + encodeURIComponent(String(text).slice(0, 400));
    const res = await net.fetch(u);
    if (!res.ok) return null;
    const data = await res.json();
    return (data && data[0]) ? data[0].map(s => s[0]).join('') : null;
  } catch { return null; }
});

// === RSS fetch (renderer fetch would be CORS-blocked for arbitrary feeds) ===
ipcMain.handle('rss:fetch', async (_e, feedUrl) => {
  try {
    if (!feedUrl || !/^https?:\/\//i.test(feedUrl)) return null;
    const res = await net.fetch(feedUrl, { headers: { 'User-Agent': 'Vex Browser RSS' } });
    if (!res.ok) return null;
    const text = await res.text();
    return text.length > 2 * 1024 * 1024 ? null : text;
  } catch { return null; }
});

// === Generic HTTP request for the built-in API client + page-change monitor ===
// CORS-free arbitrary fetch, run from main like curl. User-driven dev tool in the
// user's own browser — not exposed to guest pages (only the host renderer's
// window.vex bridge can call it). Caps body size; returns timing + headers.
ipcMain.handle('api:request', async (_e, opts = {}) => {
  const t0 = Date.now();
  try {
    const { url, method = 'GET', headers = {}, body = null } = opts || {};
    if (!url || !/^https?:\/\//i.test(url)) return { ok: false, error: 'Invalid URL (must be http/https)' };
    const init = { method: String(method || 'GET').toUpperCase(), headers: headers && typeof headers === 'object' ? headers : {} };
    if (body != null && init.method !== 'GET' && init.method !== 'HEAD') init.body = String(body);
    const res = await net.fetch(url, init);
    const buf = Buffer.from(await res.arrayBuffer());
    const capped = buf.length > 5 * 1024 * 1024;
    const text = capped ? buf.slice(0, 5 * 1024 * 1024).toString('utf8') : buf.toString('utf8');
    const hdrs = {};
    try { res.headers.forEach((v, k) => { hdrs[k] = v; }); } catch {}
    return { ok: true, status: res.status, statusText: res.statusText, headers: hdrs, body: text, size: buf.length, capped, timeMs: Date.now() - t0 };
  } catch (err) {
    return { ok: false, error: err.message, timeMs: Date.now() - t0 };
  }
});

// === Password vault — encrypted at rest with safeStorage (OS keychain/DPAPI) ===
// The renderer never sees the file; plaintext secrets only cross IPC when the
// user autofills/copies. If safeStorage is unavailable (rare: no keychain),
// the vault refuses to save rather than writing plaintext.
const VAULT_FILE = () => path.join(app.getPath('userData'), 'vault.dat');
function vaultLoad() {
  try {
    const fsx = require('fs');
    if (!fsx.existsSync(VAULT_FILE())) return [];
    const enc = fsx.readFileSync(VAULT_FILE());
    const raw = safeStorage.decryptString(enc);
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch (err) {
    console.error('[Vault] load failed:', err.message);
    return [];
  }
}
function vaultSave(arr) {
  if (!safeStorage.isEncryptionAvailable()) throw new Error('OS encryption unavailable');
  const fsx = require('fs');
  fsx.writeFileSync(VAULT_FILE(), safeStorage.encryptString(JSON.stringify(arr)));
}
ipcMain.handle('vault:list', () => {
  // Metadata only — no passwords cross this channel.
  return vaultLoad().map(e => ({ host: e.host, username: e.username, updatedAt: e.updatedAt }));
});
ipcMain.handle('vault:get', (_e, host) => {
  if (!host || typeof host !== 'string') return [];
  return vaultLoad().filter(e => e.host === host);
});
ipcMain.handle('vault:save', (_e, entry) => {
  const { host, username, password } = entry || {};
  if (!host || !username || !password) return { ok: false, error: 'Missing fields' };
  try {
    const arr = vaultLoad();
    const existing = arr.find(e => e.host === host && e.username === username);
    if (existing) { existing.password = password; existing.updatedAt = new Date().toISOString(); }
    else arr.push({ host, username, password, updatedAt: new Date().toISOString() });
    vaultSave(arr);
    return { ok: true, updated: !!existing };
  } catch (err) { return { ok: false, error: err.message }; }
});
ipcMain.handle('vault:delete', (_e, { host, username } = {}) => {
  try {
    vaultSave(vaultLoad().filter(e => !(e.host === host && e.username === username)));
    return { ok: true };
  } catch (err) { return { ok: false, error: err.message }; }
});

ipcMain.handle('permissions:list',     () => loadPermissionDecisions());
ipcMain.handle('permissions:revoke',   (_e, key) => { const d = loadPermissionDecisions(); delete d[key]; savePermissionDecisions(d); return { ok: true }; });
ipcMain.handle('permissions:clear-all', () => { savePermissionDecisions({}); return { ok: true }; });

// === WebHID — navigator.hid.requestDevice() device chooser =================
// Electron does NOT pick a HID device on its own: without a 'select-hid-device'
// handler the chooser resolves empty and sites report "no compatible devices".
// We present Vex's own picker (the chooser IS the permission gate, Brave-style)
// and persist granted (origin → vendorId/productId) pairs so setDevicePermission
// Handler re-grants them and navigator.hid.getDevices() works on reconnect.
const hidGrantsFile = path.join(userDataPath, 'hid-grants.json');
function loadHidGrants() {
  try { if (fs.existsSync(hidGrantsFile)) return JSON.parse(fs.readFileSync(hidGrantsFile, 'utf-8')) || {}; }
  catch {}
  return {};
}
function saveHidGrants(data) {
  try { fs.writeFileSync(hidGrantsFile, JSON.stringify(data, null, 2), 'utf-8'); }
  catch (err) { console.error('[WebHID] grants save failed:', err.message); }
}
function _hidIsGranted(origin, vendorId, productId) {
  const grants = loadHidGrants();
  return !!(grants[origin] || []).some(g => g.vendorId === vendorId && g.productId === productId);
}
function _hidGrant(origin, vendorId, productId) {
  if (!origin) return;
  const grants = loadHidGrants();
  const list = grants[origin] || (grants[origin] = []);
  if (!list.some(g => g.vendorId === vendorId && g.productId === productId)) {
    list.push({ vendorId, productId });
    saveHidGrants(grants);
  }
}

// Origins with an interactive requestDevice() currently in flight. The device-
// permission handler can't gate on a persisted grant alone (first-connect has
// none, and returning false there suppresses the chooser). We mark an origin
// active when Chromium runs the 'hid' capability check that opens every
// requestDevice() (setPermissionCheckHandler), so the device-permission handler
// permits enumeration for THAT request only — while an idle origin (no active
// request, no stored grant) still gets false and cannot enumerate HID devices.
// The TTL is a safety net for a request abandoned before select-hid-device
// resolves; the chooser flow clears it explicitly on respond/timeout.
const _hidActiveRequestOrigins = new Map(); // origin -> expiry ms
const HID_ACTIVE_TTL_MS = 60 * 1000;
function _markHidRequestActive(origin) {
  if (origin && origin !== 'unknown') _hidActiveRequestOrigins.set(origin, Date.now() + HID_ACTIVE_TTL_MS);
}
function _isHidRequestActive(origin) {
  const exp = _hidActiveRequestOrigins.get(origin);
  if (!exp) return false;
  if (Date.now() > exp) { _hidActiveRequestOrigins.delete(origin); return false; }
  return true;
}
function _clearHidRequestActive(origin) { _hidActiveRequestOrigins.delete(origin); }

// Pending chooser callbacks, keyed by request id. Mirrors the permission-prompt
// cold-start queue so a request that fires before the renderer attaches its
// listener still gets delivered (requestDevice needs a user gesture, so the
// renderer is normally up — this is belt-and-suspenders).
const pendingHidSelections = new Map();
let _hidRendererReady = false;
const _pendingHidSends = [];
function _deliverHidRequest(payload) {
  const win = mainWindow && !mainWindow.isDestroyed() ? mainWindow : null;
  if (!win) return false;
  try { win.webContents.send('hid:select-request', payload); return true; }
  catch { return false; }
}
function _sendHidRequest(payload) {
  if (_hidRendererReady && _deliverHidRequest(payload)) return;
  _pendingHidSends.push(payload);
}
ipcMain.on('hid:renderer-ready', () => {
  _hidRendererReady = true;
  while (_pendingHidSends.length) {
    const p = _pendingHidSends.shift();
    if (!_deliverHidRequest(p)) { _pendingHidSends.unshift(p); break; }
  }
});

function _hidOriginFromFrame(frame) {
  try { return new URL(frame.url).origin; } catch { return 'unknown'; }
}

function wireWebHidOnSession(ses, tag) {
  if (!ses || ses.__vexHidWired) return;
  ses.__vexHidWired = true;

  ses.on('select-hid-device', (event, details, callback) => {
    event.preventDefault();
    const origin = _hidOriginFromFrame(details.frame);
    const devices = (details.deviceList || []).map(d => ({
      deviceId: d.deviceId,
      name: d.name || '',
      vendorId: d.vendorId,
      productId: d.productId
    }));
    const id = `hid_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    console.log(`[WebHID] (${tag}) ${origin} requests a device — ${devices.length} offered`);
    pendingHidSelections.set(id, { callback, origin, devices });
    _sendHidRequest({ id, origin, devices });

    // If the user ignores the chooser for 2 minutes, cancel (empty selection).
    setTimeout(() => {
      if (pendingHidSelections.has(id)) {
        pendingHidSelections.delete(id);
        _clearHidRequestActive(origin);
        try { callback(''); } catch {}
      }
    }, 120000);
  });

  // Device-access gate. NOTE: returning false for a device that should be
  // selectable suppresses the chooser on this Electron build (30.5.1+wvcus) —
  // Chromium checks here during enumeration and, if denied, never emits
  // 'select-hid-device'. So we permit a device when EITHER (a) the origin
  // previously picked it (persisted grant → silent getDevices() reconnect), OR
  // (b) the origin has an interactive requestDevice() in flight (marked by the
  // 'hid' permission check that opens every request) so the chooser can
  // enumerate and open. An idle origin with neither gets false → it cannot
  // enumerate HID devices without a user pick (closes the fingerprinting gap).
  ses.setDevicePermissionHandler((details) => {
    if (!details || details.deviceType !== 'hid') return false;
    const d = details.device || {};
    if (_hidIsGranted(details.origin, d.vendorId, d.productId)) return true;
    return _isHidRequestActive(details.origin);
  });
}

ipcMain.handle('hid:select-respond', (_e, payload) => {
  const { id, deviceId } = payload || {};
  const pending = pendingHidSelections.get(id);
  if (!pending) return { ok: false, error: 'No pending HID request' };
  pendingHidSelections.delete(id);
  _clearHidRequestActive(pending.origin);
  // Persist the grant BEFORE resolving so setDevicePermissionHandler (which
  // Chromium calls right after selection) sees it and allows the connection.
  if (deviceId) {
    const chosen = pending.devices.find(d => d.deviceId === deviceId);
    if (chosen) _hidGrant(pending.origin, chosen.vendorId, chosen.productId);
  }
  try { pending.callback(deviceId || ''); } catch (err) { return { ok: false, error: err.message }; }
  return { ok: true };
});

function wireAdblockerOnSession(ses, tag) {
  if (!ses || ses.__vexAdblockWired) return;
  ses.__vexAdblockWired = true;
  ses.webRequest.onBeforeRequest((details, callback) => {
    // Engine verdict (EasyList) ORed with the legacy domain list so we never
    // regress an existing block while the richer engine adds coverage. When the
    // engine isn't ready yet engineBlocks() returns null and the legacy list
    // carries on alone.
    if (adBlockerEnabled && (engineBlocks(details) === true || shouldBlock(details.url))) {
      _recordTracker(details.url, details.webContentsId);
      callback({ cancel: true });
    } else {
      callback({ cancel: false });
    }
  });
}

// Keep request Client Hints (Sec-CH-UA*) consistent with the spoofed Chrome UA.
// setUserAgent fixes the UA string, but Chromium still derives the Sec-CH-UA
// brand list from its real build — leaking "Electron"/app branding to sites that
// sniff Client Hints (which modern sites prefer over the UA string). We rewrite
// the brand hints to a plain Chrome 124 desktop identity whenever the request
// carries them. onBeforeSendHeaders is a distinct webRequest event (no clash with
// onBeforeRequest / onHeadersReceived) and nothing else in Vex registers it.
const CH_UA = '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"';
const CH_UA_FULL = '"Chromium";v="124.0.0.0", "Google Chrome";v="124.0.0.0", "Not-A.Brand";v="99.0.0.0"';
function wireClientHintsOnSession(ses) {
  if (!ses || ses.__vexCHWired) return;
  ses.__vexCHWired = true;
  ses.webRequest.onBeforeSendHeaders((details, callback) => {
    const h = details.requestHeaders || {};
    for (const k of Object.keys(h)) {
      switch (k.toLowerCase()) {
        case 'sec-ch-ua': h[k] = CH_UA; break;
        case 'sec-ch-ua-full-version-list': h[k] = CH_UA_FULL; break;
        case 'sec-ch-ua-full-version': h[k] = '"124.0.0.0"'; break;
        case 'sec-ch-ua-mobile': h[k] = '?0'; break;
        case 'sec-ch-ua-platform': h[k] = '"Windows"'; break;
      }
    }
    callback({ requestHeaders: h });
  });
}

function wireDownloadsOnSession(ses, tag) {
  if (!ses || ses.__vexDownloadsWired) return;
  ses.__vexDownloadsWired = true;
  ses.on('will-download', (event, item) => {
    const savePath = path.join(app.getPath('downloads'), item.getFilename());
    item.setSavePath(savePath);
    const info = {
      id: `dl_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      fileName: item.getFilename(),
      url: item.getURL(),
      totalBytes: item.getTotalBytes(),
      path: savePath,
      startedAt: new Date().toISOString()
    };
    console.log(`[Downloads] (${tag || 'session'}) start:`, info.fileName, info.totalBytes, 'bytes');
    _broadcastDownloadEvent('download-started', info);
    item.on('updated', (_e, state) => {
      _broadcastDownloadEvent('download-progress', {
        id: info.id,
        receivedBytes: item.getReceivedBytes(),
        totalBytes: item.getTotalBytes(),
        state
      });
    });
    item.once('done', (_e, state) => {
      console.log(`[Downloads] (${tag || 'session'}) done:`, info.fileName, state);
      _broadcastDownloadEvent('download-complete', {
        id: info.id, fileName: info.fileName, state, path: savePath
      });
    });
  });
}

// === Phase 18: Chrome extension loader ===
const extensionsDir = path.join(userDataPath, 'extensions');
if (!fs.existsSync(extensionsDir)) fs.mkdirSync(extensionsDir, { recursive: true });

const EXT_PARTITIONS = ['persist:main']; // tabs all share this; add more if new partitions appear

function _copyDirRecursive(src, dest) {
  if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) _copyDirRecursive(s, d);
    else fs.copyFileSync(s, d);
  }
}

function _extEntries() {
  if (!fs.existsSync(extensionsDir)) return [];
  return fs.readdirSync(extensionsDir, { withFileTypes: true })
    .filter(e => e.isDirectory())
    .map(e => {
      const extPath = path.join(extensionsDir, e.name);
      const manifestPath = path.join(extPath, 'manifest.json');
      if (!fs.existsSync(manifestPath)) return null;
      try {
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
        return { folder: e.name, path: extPath, manifest };
      } catch { return null; }
    })
    .filter(Boolean);
}

async function _loadExtensionEverywhere(extPath) {
  const sessions = [session.defaultSession, ...EXT_PARTITIONS.map(p => session.fromPartition(p))];
  let loaded = null;
  for (const ses of sessions) {
    try {
      const ext = await ses.loadExtension(extPath, { allowFileAccess: true });
      if (!loaded) loaded = ext;
    } catch (err) {
      console.error(`[Extensions] load failed (${ses === session.defaultSession ? 'default' : 'partition'}):`, err.message);
    }
  }
  return loaded;
}

async function loadAllExtensionsOnStartup() {
  for (const entry of _extEntries()) {
    try {
      const ext = await _loadExtensionEverywhere(entry.path);
      if (ext) console.log(`[Extensions] Loaded: ${ext.name} v${ext.manifest.version}`);
    } catch (err) {
      console.error(`[Extensions] Failed to load ${entry.folder}:`, err.message);
    }
  }
}

ipcMain.handle('extensions:list', () => {
  return _extEntries().map(e => ({
    folder: e.folder,
    name: e.manifest.name || e.folder,
    version: e.manifest.version || '—',
    description: e.manifest.description || '',
    path: e.path
  }));
});

ipcMain.handle('extensions:install-folder', async () => {
  const result = await dialog.showOpenDialog({
    title: 'Select extension folder (must contain manifest.json)',
    properties: ['openDirectory']
  });
  if (result.canceled || !result.filePaths.length) return { ok: false, cancelled: true };

  const sourceFolder = result.filePaths[0];
  const manifestPath = path.join(sourceFolder, 'manifest.json');
  if (!fs.existsSync(manifestPath)) return { ok: false, error: 'No manifest.json in that folder' };

  try {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
    const slug = String(manifest.name || 'extension').toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40);
    const destFolder = path.join(extensionsDir, `${slug}-${Date.now()}`);
    _copyDirRecursive(sourceFolder, destFolder);
    const ext = await _loadExtensionEverywhere(destFolder);
    return ext
      ? { ok: true, id: ext.id, name: ext.name, version: ext.manifest.version }
      : { ok: false, error: 'Loaded files but extension didn\'t attach' };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('extensions:install-zip', async () => {
  const result = await dialog.showOpenDialog({
    title: 'Select extension .zip or .crx',
    filters: [{ name: 'Extensions', extensions: ['zip', 'crx'] }],
    properties: ['openFile']
  });
  if (result.canceled || !result.filePaths.length) return { ok: false, cancelled: true };

  let AdmZip;
  try { AdmZip = require('adm-zip'); }
  catch { return { ok: false, error: 'adm-zip missing — run npm install' }; }

  try {
    const sourcePath = result.filePaths[0];
    let zipBuffer = fs.readFileSync(sourcePath);
    // Strip CRX header if present
    if (zipBuffer.slice(0, 4).toString() === 'Cr24') {
      const version = zipBuffer.readUInt32LE(4);
      if (version === 2) {
        const pubKeyLen = zipBuffer.readUInt32LE(8);
        const sigLen = zipBuffer.readUInt32LE(12);
        zipBuffer = zipBuffer.slice(16 + pubKeyLen + sigLen);
      } else if (version === 3) {
        const headerLen = zipBuffer.readUInt32LE(8);
        zipBuffer = zipBuffer.slice(12 + headerLen);
      } else {
        return { ok: false, error: 'Unknown CRX version: ' + version };
      }
    }
    const zip = new AdmZip(zipBuffer);
    const entries = zip.getEntries();

    // Find manifest.json — prefer the root, but fall back to the shallowest
    // match if the archive has the extension inside a wrapper folder
    // (e.g. GitHub release zips like "uBlock0.chromium/manifest.json").
    let manifestEntry = entries.find(e => e.entryName === 'manifest.json');
    let rootPath = '';
    if (!manifestEntry) {
      const candidates = entries
        .filter(e => !e.isDirectory && e.entryName.endsWith('/manifest.json'))
        .sort((a, b) => a.entryName.split('/').length - b.entryName.split('/').length);
      if (candidates.length) {
        manifestEntry = candidates[0];
        rootPath = manifestEntry.entryName.replace(/manifest\.json$/, ''); // keeps trailing slash
      }
    }
    if (!manifestEntry) return { ok: false, error: 'No manifest.json found anywhere in the archive' };

    const manifest = JSON.parse(manifestEntry.getData().toString('utf-8'));
    const slug = String(manifest.name || 'extension').toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40);
    const destFolder = path.join(extensionsDir, `${slug}-${Date.now()}`);
    if (!fs.existsSync(destFolder)) fs.mkdirSync(destFolder, { recursive: true });

    // Extract only the files under rootPath (or everything if the manifest
    // is already at the archive root) and strip the wrapper prefix.
    // Each entry's resolved write path is validated against destFolder via
    // safeJoin so a malicious zip with "../etc/passwd"-style entries can't
    // escape the extension folder (zip-slip; security-audit H-1). Skip-and-
    // log for individual bad entries so a single hostile file doesn't kill
    // the whole extraction (the manifest existence check after the loop
    // catches the case where every entry was skipped).
    for (const entry of entries) {
      if (entry.isDirectory) continue;
      const name = entry.entryName;
      if (rootPath && !name.startsWith(rootPath)) continue;
      const rel = rootPath ? name.slice(rootPath.length) : name;
      if (!rel) continue;
      let outPath;
      try {
        outPath = safeJoin(destFolder, rel);
      } catch (err) {
        console.warn('[Extensions] Skipping malicious zip entry:', name, err.message);
        continue;
      }
      const outDir = path.dirname(outPath);
      if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
      fs.writeFileSync(outPath, entry.getData());
    }

    if (!fs.existsSync(path.join(destFolder, 'manifest.json'))) {
      fs.rmSync(destFolder, { recursive: true, force: true });
      return { ok: false, error: 'Failed to place manifest.json at destination root' };
    }

    const ext = await _loadExtensionEverywhere(destFolder);
    return ext
      ? { ok: true, id: ext.id, name: ext.name, version: ext.manifest.version }
      : { ok: false, error: 'Extracted but extension didn\'t load (check console for details)' };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('extensions:uninstall', async (_e, folderName) => {
  let extPath;
  try {
    extPath = safeJoin(extensionsDir, safeName(folderName));
  } catch (err) {
    console.warn('[Extensions] uninstall rejected unsafe folderName:', folderName, err.message);
    return { ok: false, error: 'Invalid folder name' };
  }
  if (!fs.existsSync(extPath)) return { ok: false, error: 'Not found' };
  try {
    const sessions = [session.defaultSession, ...EXT_PARTITIONS.map(p => session.fromPartition(p))];
    for (const ses of sessions) {
      try {
        for (const ext of ses.getAllExtensions()) {
          if (path.resolve(ext.path) === path.resolve(extPath)) ses.removeExtension(ext.id);
        }
      } catch {}
    }
    fs.rmSync(extPath, { recursive: true, force: true });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('extensions:open-folder', () => { shell.openPath(extensionsDir); return { ok: true }; });

// Load installed extensions once the app is ready
app.whenReady().then(() => { loadAllExtensionsOnStartup().catch(() => {}); });

// === External protocol forwarding ===
// Custom-scheme URLs (roblox://, mailto:, discord://, etc.) aren't handled by
// Chromium — by default they error with ERR_UNKNOWN_URL_SCHEME inside a
// webview. Forward recognised ones to the OS via shell.openExternal so the
// installed desktop app launches. Note: webRequest.onBeforeRequest is a
// network-pipeline hook and never sees non-http schemes, so intercept at the
// navigation layer (will-navigate + setWindowOpenHandler) instead.
const { EXTERNAL_PROTOCOLS, isExternalProtocol } = _mainHelpers;

function handleExternalProtocol(url) {
  if (!isExternalProtocol(url)) return false;
  console.log(`[Protocol] Forwarding to OS: ${url}`);
  shell.openExternal(url).catch(err => {
    console.error('[Protocol] openExternal failed:', err.message);
  });
  return true;
}

// === Route webview new-window requests into Vex tabs (not new BrowserWindows) ===
// The renderer's webview 'new-window' DOM event is legacy and unreliable in
// Electron 30+. setWindowOpenHandler in main is the supported path.
app.on('web-contents-created', (_event, contents) => {
  // Only intercept for webviews hosting tabs — never for the main window or
  // for extension background pages (those need their own window.open semantics).
  const type = contents.getType();
  if (type !== 'webview') return;

  // (Gmail webview popup-intercept removed — Gmail now uses native IMAP/SMTP
  // via main/gmail/, no webview. persist:gmail partition is kept in the
  // partitions array in case a future OAuth flow reuses it.)

  contents.setWindowOpenHandler((details) => {
    const { url, disposition, frameName, features } = details || {};
    // External-protocol window.open (e.g. Roblox Play button spawns a hidden
    // window to roblox-player://…) — forward to the OS instead of creating a
    // dead tab that would just error out.
    if (handleExternalProtocol(url)) {
      return { action: 'deny' };
    }
    // Print-preview / client-side PDF generation popups. claude.ai's
    // "Export as PDF" calls window.open('about:blank'), writes formatted HTML
    // into the popup, then printWindow.print() — denying the popup makes the
    // whole flow silently no-op. blob:/data:/chrome-print:// follow the same
    // pattern (Stripe receipts, GitHub issue exports, etc.). Allow them as
    // real popup windows; the print dialog routes through Electron normally.
    const featuresStr = Array.isArray(features) ? features.join(',') : (features || '');
    const isPopupLikePrint =
      !url ||
      url === 'about:blank' ||
      url.startsWith('about:blank?') ||
      url.startsWith('blob:') ||
      url.startsWith('data:') ||
      url.startsWith('chrome-print://') ||
      frameName === '_print' ||
      /print/i.test(featuresStr);
    if (isPopupLikePrint) {
      console.log(`[new-window] allowing print/preview popup -> ${url || '(no url)'} frame=${frameName || '-'}`);
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          autoHideMenuBar: true,
          webPreferences: { contextIsolation: true, nodeIntegration: false }
        }
      };
    }
    // OAuth identity popups (Google GSI / Microsoft IDP / Sign in with Apple)
    // run a popup-based handshake — the popup postMessages the credential back
    // to window.opener and self-closes. The deny fall-through below would
    // re-home the URL into a plain Vex tab, severing window.opener and
    // dead-ending the flow (accounts.google.com/gsi/transform, blank page).
    // Allow it as a real popup window; it inherits the opener's persist:main
    // session so login cookies match.
    // Firebase / federated sign-in popups: the identity provider hosts above,
    // PLUS the site's own /__/auth/handler popup (e.g. ElevenLabs' "Sign in with
    // Google"). Both rely on window.opener to post the credential back; routing
    // them into Peek/a tab severs the opener and the popup hangs blank.
    if (_mainHelpers.isOAuthPopupUrl(url) || _mainHelpers.isAuthHandlerPopupUrl(url)) {
      console.log(`[new-window] allowing federated-auth popup -> ${url}`);
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          autoHideMenuBar: true,
          webPreferences: { contextIsolation: true, nodeIntegration: false }
        }
      };
    }
    console.log(`[new-window] ${disposition} -> ${url}`);
    try {
      const win = BrowserWindow.getAllWindows().find(w => !w.isDestroyed());
      if (win && url) {
        // Shift+click (and window.open popups that survived the filters above)
        // arrive as 'new-window' — open those in the Peek overlay instead of a
        // full tab. Plain target=_blank / middle-click stay tabs.
        if (disposition === 'new-window') {
          win.webContents.send('peek:open', { url });
        } else {
          win.webContents.send('tab:create-from-external', {
            url,
            background: disposition === 'background-tab' || disposition === 'save-to-disk'
          });
        }
      }
    } catch (err) { console.error('[new-window] forward failed:', err.message); }
    return { action: 'deny' };
  });

  // Same story for top-level navigations: some Roblox flows swap the current
  // webview's location to roblox-player://…, so catch those before Chromium
  // blocks them.
  contents.on('will-navigate', (evt, url) => {
    if (handleExternalProtocol(url)) {
      evt.preventDefault();
    }
  });

  // Subframe navigations — Roblox's "Play" button sets the src of a hidden
  // iframe to roblox-player://launch?…, which does NOT trigger will-navigate
  // (main-frame only). will-frame-navigate fires for every frame including
  // iframes, so the Bloxstrap handoff actually reaches the OS.
  if (typeof contents.on === 'function') {
    try {
      contents.on('will-frame-navigate', (evt, url) => {
        if (handleExternalProtocol(url)) {
          evt.preventDefault();
        }
      });
    } catch { /* older Electron without will-frame-navigate */ }
  }

  // Block window.onbeforeunload confirm prompts (prevents "Leave page?" spam
  // when user closes a tab that has an unload handler).
  contents.on('will-prevent-unload', (evt) => evt.preventDefault());

  // F11 / Esc fullscreen and F12 / Ctrl+Shift+I DevTools must work even when
  // the guest page has focus. Without this, pressing them inside any loaded
  // website is a no-op.
  contents.on('before-input-event', (event, input) => {
    if (input && input.key === 'F11') {
      console.log('[Vex F11] before-input-event fired on GUEST webContents id:', contents.id, 'type:', input.type);
    }
    if (handleFullscreenShortcut(event, input)) return;
    if (handleHardReloadShortcut(event, input)) return;
    handleDevToolsShortcut(event, input);
  });
});
const storagePath = path.join(userDataPath, 'vex-storage');

if (!fs.existsSync(storagePath)) {
  fs.mkdirSync(storagePath, { recursive: true });
}

function getStorageFile(key) {
  // Reject path separators / traversal in the key, then resolve via safeJoin
  // so any further escape (symlinks aside) is impossible. Throws on bad input;
  // the callers (IPC handlers) catch and return a safe error to the renderer.
  return safeJoin(storagePath, safeName(key) + '.json');
}

// === Persistent key/value store (survives reinstalls / Chromium-origin changes) ===
// Backs the localStorage shim in the renderer. Single JSON file, atomic writes.
const persistFile = path.join(userDataPath, 'vex-persist.json');
let _persistCache = null;
function _persistLoad() {
  if (_persistCache) return _persistCache;
  try {
    if (fs.existsSync(persistFile)) {
      _persistCache = JSON.parse(fs.readFileSync(persistFile, 'utf-8'));
    }
  } catch (e) { console.error('[persist] load failed:', e); }
  if (!_persistCache) _persistCache = {};
  return _persistCache;
}
function _persistSaveDebounced() {
  if (_persistSaveDebounced._t) clearTimeout(_persistSaveDebounced._t);
  _persistSaveDebounced._t = setTimeout(() => {
    try {
      const tmp = persistFile + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(_persistCache, null, 2), 'utf-8');
      fs.renameSync(tmp, persistFile);
    } catch (e) { console.error('[persist] save failed:', e); }
  }, 250);
}
ipcMain.handle('persist-get-all', () => _persistLoad());

// === Geolocation preference exposed to webview preloads ===
// The preload polyfill (preload-webview.js) runs in guest processes and can't
// touch the renderer's localStorage directly, so it asks us. We read from the
// already-loaded persist cache — values land here as the same JSON-stringified
// strings the renderer wrote via persist-set, so JSON.parse is required.
function _readPersistString(key, fallback) {
  const raw = _persistLoad()[key];
  if (raw == null) return fallback;
  try { return JSON.parse(raw); }
  catch { return typeof raw === 'string' ? raw : fallback; }
}
ipcMain.handle('geolocation:get', () => {
  const mode = _readPersistString('vex.locationMode', 'manual');
  if (mode === 'off') return { mode: 'off' };
  if (mode === 'manual') {
    let m = _readPersistString('vex.manualLocation', null);
    // Defensive: if the value somehow round-tripped as a JSON-encoded string
    // (double-encoding), parse it one more layer.
    if (typeof m === 'string') { try { m = JSON.parse(m); } catch {} }
    if (m && m.v && typeof m.v === 'object') m = m.v;
    const lat = m ? parseFloat(m.latitude) : NaN;
    const lng = m ? parseFloat(m.longitude) : NaN;
    if (!Number.isNaN(lat) && !Number.isNaN(lng)) {
      return { mode: 'manual', latitude: lat, longitude: lng };
    }
    // No coords saved yet — fall through to IP so first-run isn't broken.
    return { mode: 'ip' };
  }
  return { mode: 'ip' };
});

// Geolocation permission gate — the polyfill can't go through Chromium's
// setPermissionRequestHandler because it has replaced navigator.geolocation,
// so it asks us here. We reuse the existing permission prompt + decision store.
ipcMain.handle('geolocation:check-permission', async (_e, { origin } = {}) => {
  if (!origin || origin === 'null') return 'allow';

  const decisions = loadPermissionDecisions();
  const key = `${origin}::geolocation`;
  if (decisions[key] === 'allow') return 'allow';
  if (decisions[key] === 'deny') return 'deny';

  return await new Promise((resolve) => {
    const id = `perm_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    let settled = false;
    const settle = (allowed) => {
      if (settled) return;
      settled = true;
      resolve(allowed ? 'allow' : 'deny');
    };
    // The existing permission:respond handler calls this with (true|false)
    // and persists the decision itself when `remember` is set.
    pendingPermissions.set(id, settle);
    sendPermissionRequest({ id, origin, permission: 'geolocation' });

    setTimeout(() => {
      if (pendingPermissions.has(id)) {
        pendingPermissions.delete(id);
        settle(false);
      }
    }, 60000);
  });
});
ipcMain.handle('persist-set', (_e, key, value) => {
  const data = _persistLoad();
  data[key] = value;
  _persistSaveDebounced();
  return true;
});
ipcMain.handle('persist-delete', (_e, key) => {
  const data = _persistLoad();
  delete data[key];
  _persistSaveDebounced();
  return true;
});
ipcMain.handle('get-user-data-path', () => userDataPath);

// Gmail IMAP/SMTP sidebar panel was reverted — see commit history for Phases 1-3.
// One-time cleanup: remove any leftover encrypted app-password from disk so it
// doesn't sit around after the feature was pulled. Safe to remove this block
// after a few versions once users have launched at least once.
try {
  const staleGmailCreds = path.join(userDataPath, 'gmail-creds.enc');
  if (fs.existsSync(staleGmailCreds)) {
    fs.unlinkSync(staleGmailCreds);
    console.log('[Vex] Removed stale Gmail credentials from disk');
  }
} catch (err) {
  console.warn('[Vex] Gmail cleanup skipped:', err.message);
}

try {
  const staleNetflixPartition = path.join(userDataPath, 'Partitions', 'netflix');
  if (fs.existsSync(staleNetflixPartition)) {
    fs.rmSync(staleNetflixPartition, { recursive: true, force: true });
    console.log('[Vex] Removed stale Netflix partition data');
  }
} catch (err) {
  console.warn('[Vex] Netflix partition cleanup skipped:', err.message);
}

// === Phase 13: Vex Sync — encryption key + session metadata ===
const syncKeyFile = path.join(userDataPath, 'sync-key.bin');
const syncMetaFile = path.join(userDataPath, 'sync-meta.json');

ipcMain.handle('sync-save-key', (_e, hex) => {
  try {
    fs.writeFileSync(syncKeyFile, String(hex || ''), { encoding: 'utf-8', mode: 0o600 });
    return true;
  } catch (err) {
    console.error('[sync] save key failed:', err);
    return false;
  }
});

ipcMain.handle('sync-load-key', () => {
  try {
    if (!fs.existsSync(syncKeyFile)) return null;
    return fs.readFileSync(syncKeyFile, 'utf-8').trim() || null;
  } catch { return null; }
});

ipcMain.handle('sync-save-meta', (_e, meta) => {
  try {
    fs.writeFileSync(syncMetaFile, JSON.stringify(meta || {}, null, 2), 'utf-8');
    return true;
  } catch (err) {
    console.error('[sync] save meta failed:', err);
    return false;
  }
});

ipcMain.handle('sync-load-meta', () => {
  try {
    if (!fs.existsSync(syncMetaFile)) return null;
    return JSON.parse(fs.readFileSync(syncMetaFile, 'utf-8'));
  } catch { return null; }
});

ipcMain.handle('sync-clear-state', () => {
  try {
    if (fs.existsSync(syncKeyFile)) fs.unlinkSync(syncKeyFile);
    if (fs.existsSync(syncMetaFile)) fs.unlinkSync(syncMetaFile);
    return true;
  } catch (err) {
    console.error('[sync] clear failed:', err);
    return false;
  }
});
// Flush synchronously on quit so nothing is lost
app.on('before-quit', () => {
  try {
    if (_persistCache) {
      fs.writeFileSync(persistFile, JSON.stringify(_persistCache, null, 2), 'utf-8');
    }
  } catch {}
});

// Register custom protocol BEFORE app ready
protocol.registerSchemesAsPrivileged([
  { scheme: 'vex', privileges: { standard: true, secure: true, supportFetchAPI: true, bypassCSP: true } }
]);

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    frame: false,
    titleBarStyle: 'hidden',
    transparent: true,  // Required for backdrop-filter on Windows
    backgroundColor: '#00000000',  // Fully transparent
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      webviewTag: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  if (enableDevToolsAtStartup) {
    mainWindow.webContents.once('did-finish-load', () => {
      try { mainWindow.webContents.openDevTools({ mode: 'bottom' }); } catch {}
    });
  }

  // Belt-and-suspenders: if the renderer hasn't signalled 'permissions:renderer-ready'
  // within 500ms of did-finish-load, flush the queue anyway. Protects against
  // a renderer script that crashes before init() but still has the IPC channel.
  mainWindow.webContents.once('did-finish-load', () => {
    setTimeout(() => {
      if (!_permissionsRendererReady && _pendingPermissionSends.length) {
        console.warn('[Permissions] renderer-ready signal not received 500ms after load, flushing anyway');
      }
      _permissionsRendererReady = true;
      _flushPermissionQueue('fallback after did-finish-load');
    }, 500);
  });

  // Header stripping for webviews
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    const responseHeaders = { ...details.responseHeaders };
    if (responseHeaders) {
      delete responseHeaders['x-frame-options'];
      delete responseHeaders['X-Frame-Options'];
      delete responseHeaders['X-FRAME-OPTIONS'];
      if (responseHeaders['content-security-policy']) {
        responseHeaders['content-security-policy'] = responseHeaders['content-security-policy'].map(
          csp => csp.replace(/frame-ancestors[^;]*;?/gi, '')
        );
      }
      if (responseHeaders['Content-Security-Policy']) {
        responseHeaders['Content-Security-Policy'] = responseHeaders['Content-Security-Policy'].map(
          csp => csp.replace(/frame-ancestors[^;]*;?/gi, '')
        );
      }
    }
    callback({ responseHeaders });
  });

  // Named partitions used by sidebar panels (whatsapp/claude) — header stripping
  // so they can be embedded in panels. persist:main is the default tabs session;
  // it gets adblocker/permissions/downloads/preload wiring below but no header
  // strip since regular tabs don't need their own frame-ancestors loosened.
  const partitions = ['persist:whatsapp', 'persist:claude', 'persist:spotify'];

  // Gmail: spoof Chrome UA at the session level too. The webview-tag `useragent`
  // attribute covers top-level frames; setting it on the session ensures every
  // sub-request (redirects, XHR, iframes during the auth dance) also identifies
  // as Chrome, so Google's "browser not secure" detector doesn't trip on leaked
  // "Electron/X.X.X" tokens in edge-case requests.
  // (Gmail webview UA/Client Hints spoofing removed — Gmail is now a native
  // IMAP/SMTP client, not a webview. See src/main/gmail/.)
  partitions.forEach(partName => {
    const ses = session.fromPartition(partName);

    ses.webRequest.onHeadersReceived((details, callback) => {
      const responseHeaders = { ...details.responseHeaders };
      if (responseHeaders) {
        delete responseHeaders['x-frame-options'];
        delete responseHeaders['X-Frame-Options'];
        delete responseHeaders['X-FRAME-OPTIONS'];
        if (responseHeaders['content-security-policy']) {
          responseHeaders['content-security-policy'] = responseHeaders['content-security-policy'].map(
            csp => csp.replace(/frame-ancestors[^;]*;?/gi, '')
          );
        }
        if (responseHeaders['Content-Security-Policy']) {
          responseHeaders['Content-Security-Policy'] = responseHeaders['Content-Security-Policy'].map(
            csp => csp.replace(/frame-ancestors[^;]*;?/gi, '')
          );
        }
      }
      callback({ responseHeaders });
    });
  });

  // Ad blocker — attach on every session tabs actually use. Previously only
  // defaultSession and the two panel partitions were covered, so ads loaded
  // freely in regular tabs (which live in persist:main).
  wireAdblockerOnSession(session.defaultSession, 'default');
  wireAdblockerOnSession(session.fromPartition('persist:main'), 'persist:main');
  partitions.forEach(p => wireAdblockerOnSession(session.fromPartition(p), p));

  // Upgrade the request blocker to the EasyList + EasyPrivacy engine. Async &
  // fire-and-forget: the handlers above OR the engine verdict with the legacy
  // domain list, so blocking works immediately and gets richer once this
  // resolves. Serialized engine is cached under userData for instant relaunch.
  initAdblockEngine(path.join(app.getPath('userData'), 'vex-adblock-engine.bin'))
    .then(ok => console.log('[Vex] EasyList adblock engine', ok ? 'ready' : 'unavailable — using domain list'))
    .catch(() => {});

  // Privacy hardening: load saved config and apply DNS-over-HTTPS (no-op when off).
  privacyLoad();
  applyDoH();

  // Set user agent to Chrome to avoid "unsupported browser" blocks AND broken
  // UA-sniffed layouts. persist:main is where every regular tab lives, so it
  // MUST get the Chrome UA too — otherwise tabs leak the default Electron UA
  // ("…Electron/30.x… vex/X.Y.Z…") and sites that branch on UA serve a degraded
  // layout (e.g. Roblox rendered its global footer in the middle of the page
  // instead of pinned to the bottom). defaultSession + the named panel
  // partitions were already covered; persist:main was the gap.
  const chromeUA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
  session.defaultSession.setUserAgent(chromeUA);
  session.fromPartition('persist:main').setUserAgent(chromeUA);
  partitions.forEach(p => session.fromPartition(p).setUserAgent(chromeUA));

  // Normalize Sec-CH-UA Client Hints to match the spoofed Chrome UA on the same
  // sessions, so UA and CH agree (sites that sniff CH won't see Electron).
  wireClientHintsOnSession(session.defaultSession);
  wireClientHintsOnSession(session.fromPartition('persist:main'));
  partitions.forEach(p => wireClientHintsOnSession(session.fromPartition(p)));

  // Downloads — wire on every session tabs might use. Previously only the
  // default session had a listener, so webview downloads (partition=persist:main)
  // silently saved with no IPC to the renderer → panel stayed empty.
  wireDownloadsOnSession(session.defaultSession, 'default');
  wireDownloadsOnSession(session.fromPartition('persist:main'), 'persist:main');
  partitions.forEach(p => wireDownloadsOnSession(session.fromPartition(p), p));

  wirePermissionsOnSession(session.defaultSession, 'default');
  wirePermissionsOnSession(session.fromPartition('persist:main'), 'persist:main');
  partitions.forEach(p => wirePermissionsOnSession(session.fromPartition(p), p));

  // WebHID — same fan-out as permissions: default + tabs (persist:main) + the
  // sidebar-panel partitions, so navigator.hid.requestDevice() shows the Vex
  // device chooser everywhere a page can run.
  wireWebHidOnSession(session.defaultSession, 'default');
  wireWebHidOnSession(session.fromPartition('persist:main'), 'persist:main');
  partitions.forEach(p => wireWebHidOnSession(session.fromPartition(p), p));

  // Webview preload (PiP helpers + geolocation IP fallback) — attach to every
  // session so ALL pages get the polyfill. Use setPreloads so we don't clobber
  // any existing preload set elsewhere.
  const webviewPreload = path.join(__dirname, 'preload-webview.js');
  const sessions = [
    session.defaultSession,
    session.fromPartition('persist:main'),
    // Container tabs (isolated cookie jars) need the preload too.
    session.fromPartition('persist:container-work'),
    session.fromPartition('persist:container-personal'),
    session.fromPartition('persist:container-shopping'),
    ...partitions.map(p => session.fromPartition(p))
  ];
  for (const ses of sessions) {
    try {
      const existing = ses.getPreloads ? ses.getPreloads() : [];
      if (!existing.includes(webviewPreload)) {
        ses.setPreloads([...existing, webviewPreload]);
      }
    } catch (err) { console.error('[Preload] attach failed:', err.message); }
  }


  // Fullscreen change events — these are the source of truth for our tracked
  // state (Electron's isFullScreen() lies on transparent frameless windows).
  mainWindow.on('enter-full-screen', () => {
    isFullscreenTracked = true;
    console.log('[Vex F11] enter-full-screen event fired. tracked state:', isFullscreenTracked);
    mainWindow.webContents.send('fullscreen-changed', true);
  });
  mainWindow.on('leave-full-screen', () => {
    isFullscreenTracked = false;
    console.log('[Vex F11] leave-full-screen event fired. tracked state:', isFullscreenTracked);
    mainWindow.webContents.send('fullscreen-changed', false);
  });

  // Signal renderer to save session before quit
  mainWindow.on('close', () => {
    if (mainWindow) {
      mainWindow.webContents.send('save-session-before-quit');
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// Auto-updater setup
function setupAutoUpdater() {
  if (!autoUpdater || !mainWindow) return;
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('update-available', (info) => {
    mainWindow?.webContents.send('update-available', { version: info.version, releaseNotes: info.releaseNotes });
  });
  autoUpdater.on('update-not-available', () => {
    mainWindow?.webContents.send('update-not-available');
  });
  autoUpdater.on('download-progress', (p) => {
    mainWindow?.webContents.send('update-download-progress', { percent: Math.round(p.percent), transferred: p.transferred, total: p.total });
  });
  autoUpdater.on('update-downloaded', (info) => {
    mainWindow?.webContents.send('update-downloaded', { version: info.version });
  });
  autoUpdater.on('error', (err) => {
    mainWindow?.webContents.send('update-error', { message: err.message });
  });

  // v2.0.0: do NOT auto-check at startup. The electron-updater startup check
  // spawns a bundled 7za.exe (for .blockmap differential-download inspection)
  // that links against MSVC 2015-2022 runtime, which triggers the VC++
  // Redistributable installer prompt on machines without that runtime.
  // Users can still trigger "Check for Updates" manually from Settings.
}

// v1.9.0 one-time cleanup: remove Phase 17A Memory Recorder artifacts
app.whenReady().then(() => {
  try {
    const userData = app.getPath('userData');
    const memoryDir = path.join(userData, 'memory');
    const keyFile = path.join(userData, 'memory-key.bin');
    const whisperDir = path.join(userData, 'assets', 'whisper');
    if (fs.existsSync(memoryDir)) { fs.rmSync(memoryDir, { recursive: true, force: true }); console.log('[Cleanup] Removed memory recorder data'); }
    if (fs.existsSync(keyFile))  { fs.unlinkSync(keyFile); console.log('[Cleanup] Removed memory encryption key'); }
    if (fs.existsSync(whisperDir)) { fs.rmSync(whisperDir, { recursive: true, force: true }); console.log('[Cleanup] Removed whisper assets'); }
  } catch (err) { console.warn('[Cleanup] Memory data cleanup failed:', err.message); }
});

// Custom protocol handler for vex://
app.whenReady().then(async () => {
  // F12: toggle DevTools for the focused window (bottom panel)
  globalShortcut.register('F12', () => {
    const w = BrowserWindow.getFocusedWindow();
    if (!w) return;
    if (w.webContents.isDevToolsOpened()) w.webContents.closeDevTools();
    else w.webContents.openDevTools({ mode: 'bottom' });
  });
  // Boss key (Ctrl+Alt+H): instantly hide + mute every Vex window; again to restore.
  let bossHidden = false;
  globalShortcut.register('CommandOrControl+Alt+H', () => {
    bossHidden = !bossHidden;
    for (const w of BrowserWindow.getAllWindows()) {
      try {
        if (bossHidden) { w.hide(); } else { w.show(); w.focus(); }
      } catch {}
    }
    try { for (const wc of webContents.getAllWebContents()) wc.setAudioMuted(bossHidden); } catch {}
  });
  // Ctrl+Shift+F12: detached DevTools (backup when F12 is stolen by a webview)
  globalShortcut.register('CommandOrControl+Shift+F12', () => {
    const w = BrowserWindow.getFocusedWindow();
    if (!w) return;
    w.webContents.openDevTools({ mode: 'detach' });
  });

  // Ctrl+Shift+J: toggle DevTools (detached) for whatever webContents is
  // currently focused. Lives in main as a globalShortcut because the previous
  // renderer-side `document.addEventListener('keydown', ...)` listener never
  // fired when the user was browsing inside a tab — keydown events inside a
  // <webview> guest renderer don't bubble to the host doc's listener (same
  // OOPIF-event-isolation reason F12 lives here too, see line 643). Gating
  // on `getFocusedWindow() === mainWindow` keeps this from firing when Vex
  // isn't focused; getFocusedWebContents walks the focus chain across guest
  // views and gives us the panel-or-tab webContents the user expects.
  globalShortcut.register('CommandOrControl+Shift+J', () => {
    const win = BrowserWindow.getFocusedWindow();
    if (!win || win !== mainWindow) {
      console.log('[Vex DT] Ctrl+Shift+J ignored (Vex window not focused)');
      return;
    }
    let target = null;
    try { target = webContents.getFocusedWebContents?.(); } catch {}
    if (!target || target.isDestroyed()) target = win.webContents;
    console.log('[Vex DT] Ctrl+Shift+J — target id:', target.id, 'url:', (() => { try { return target.getURL(); } catch { return '?'; } })());
    try {
      if (target.isDevToolsOpened()) target.closeDevTools();
      else target.openDevTools({ mode: 'detach' });
    } catch (err) {
      console.error('[Vex DT] Ctrl+Shift+J openDevTools error:', err);
    }
  });

  protocol.handle('vex', (request) => {
    const reqUrl = request.url;

    // vex://start → serve start.html, injecting the saved theme attribute
    // so the start page renders in the same theme as the main shell. The
    // start page is cross-origin from the main shell (vex:// vs file://) so
    // localStorage doesn't bridge — we read the persisted theme file instead.
    if (reqUrl === 'vex://start' || reqUrl === 'vex://start/') {
      const filePath = path.join(__dirname, 'renderer', 'start.html');
      try {
        let html = fs.readFileSync(filePath, 'utf-8');
        // Default theme is Oxford Editorial. Any unknown/legacy value (e.g. an
        // old "blackops") falls back to oxford so the start page never renders
        // themeless.
        const KNOWN = ['oxford', 'default', 'midnight', 'forest', 'ocean', 'dracula', 'nord', 'catppuccin'];
        let theme = 'oxford';
        try {
          const themeFile = getStorageFile('theme');
          if (fs.existsSync(themeFile)) {
            const t = JSON.parse(fs.readFileSync(themeFile, 'utf-8'));
            if (typeof t === 'string' && KNOWN.includes(t)) theme = t;
          }
        } catch { /* oxford on any read error */ }
        // Belt-and-suspenders: inject the attribute on <html> AND a tiny inline
        // <script> at the head end. The attribute gives CSS a hook before paint;
        // the script ensures it stays set even if some other code path nukes
        // documentElement.dataset.theme. Always inject (oxford included) so the
        // served HTML carries an explicit theme.
        const safe = theme.replace(/[^a-z]/g, '');
        html = html.replace('<html lang="en">', `<html lang="en" data-theme="${safe}">`);
        html = html.replace(
          '</head>',
          `<script>document.documentElement.setAttribute("data-theme","${safe}");</script></head>`
        );
        // Cache-Control: no-store is critical here — without it Chromium's
        // heuristic cache for custom-protocol responses keeps the FIRST HTML
        // it ever served (incl. wrong theme) across reloads. That was the
        // round 1/2/3 typography ghost: stale cached <html> without the
        // data-theme attribute injected above.
        return new Response(html, {
          headers: {
            'content-type': 'text/html; charset=utf-8',
            'cache-control': 'no-store, no-cache, must-revalidate, max-age=0',
            'pragma': 'no-cache',
            'expires': '0'
          }
        });
      } catch (e) {
        console.error('[vex://start] serve error:', e);
        return new Response('Not Found', { status: 404 });
      }
    }

    // vex://start/css/foo.css → serve renderer/css/foo.css
    if (reqUrl.startsWith('vex://start/')) {
      const assetPath = reqUrl.replace('vex://start/', '');
      const fullPath = path.join(__dirname, 'renderer', assetPath);
      if (fs.existsSync(fullPath)) {
        return net.fetch(pathToFileURL(fullPath).toString());
      }
    }

    return new Response('Not Found', { status: 404 });
  });

  // castLabs Widevine CDM. Fire-and-forget so a slow/failed CDM download never
  // blocks window creation (playback happens later); see initWidevine() above.
  initWidevine();

  createWindow();
  setupAutoUpdater();

  // === Handle URL launched from external app (Discord, email, File Explorer) ===
  // process.argv[0] is the exe path, [1..] are the arguments Windows passed —
  // skip [0] so we don't accidentally normalise the exe location into a URL.
  console.log('[Vex URL] cold-start launch URL detection');
  console.log('[Vex URL]   process.argv:', JSON.stringify(process.argv));
  console.log('[Vex URL]   pendingOpenUrl:', pendingOpenUrl);
  const launchUrl = pendingOpenUrl || findLaunchUrl(process.argv.slice(1));
  console.log('[Vex URL]   resolved launchUrl:', launchUrl);
  if (launchUrl && mainWindow) {
    console.log('[Vex URL]   queuing open-url IPC for did-finish-load');
    mainWindow.webContents.once('did-finish-load', () => {
      console.log('[Vex URL]   did-finish-load -> sending open-url IPC:', launchUrl);
      mainWindow.webContents.send('open-url', launchUrl);
    });
    pendingOpenUrl = null;
  } else if (!launchUrl) {
    console.log('[Vex URL]   no launchUrl on cold start — normal Vex boot');
  }

  // Register global shortcuts
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input && input.key === 'F11') {
      console.log('[Vex F11] before-input-event fired on MAIN window webContents. type:', input.type, 'defaultPrevented(before):', event.defaultPrevented);
    }
    if (input.control && input.key === 'k') {
      mainWindow.webContents.send('toggle-command-bar');
      event.preventDefault();
    }
    if (input.control && input.key === 'f') {
      mainWindow.webContents.send('find-in-page');
      event.preventDefault();
    }
    if (input.control && input.key === 't') {
      mainWindow.webContents.send('new-tab');
      event.preventDefault();
    }
    if (input.control && input.key === 'w') {
      mainWindow.webContents.send('close-tab');
      event.preventDefault();
    }
    if (input.control && input.key === 'r') {
      mainWindow.webContents.send('reload-tab');
      event.preventDefault();
    }
    if (input.control && (input.key === '=' || input.key === '+')) {
      mainWindow.webContents.send('zoom-in');
      event.preventDefault();
    }
    if (input.control && input.key === '-') {
      mainWindow.webContents.send('zoom-out');
      event.preventDefault();
    }
    if (input.control && input.key === '0') {
      mainWindow.webContents.send('zoom-reset');
      event.preventDefault();
    }
    if (input.alt && input.key === 'ArrowLeft') {
      mainWindow.webContents.send('navigate-back');
      event.preventDefault();
    }
    if (input.alt && input.key === 'ArrowRight') {
      mainWindow.webContents.send('navigate-forward');
      event.preventDefault();
    }
    if (input.control && input.shift && input.key === 'S') {
      mainWindow.webContents.send('toggle-split');
      event.preventDefault();
    }
    if (input.control && input.shift && input.key === 'P') {
      mainWindow.webContents.send('toggle-pip');
      event.preventDefault();
    }
    if (input.control && input.shift && input.key === 'N') {
      mainWindow.webContents.send('toggle-notes');
      event.preventDefault();
    }
    if (input.control && input.shift && input.key === 'O') {
      mainWindow.webContents.send('toggle-sessions');
      event.preventDefault();
    }
    if (input.control && input.shift && input.key === 'T') {
      mainWindow.webContents.send('reopen-last-closed');
      event.preventDefault();
    }
    if (input.control && input.shift && input.key === 'H') {
      // Ctrl+Shift+H — open history panel with AI search auto-selected
      mainWindow.webContents.send('toggle-history-ai');
      event.preventDefault();
    } else if (input.control && input.key === 'h') {
      mainWindow.webContents.send('toggle-history');
      event.preventDefault();
    }
    if (input.control && input.shift && input.key === 'M') {
      mainWindow.webContents.send('toggle-memory');
      event.preventDefault();
    }
    if (input.control && input.shift && input.key === 'Z') {
      mainWindow.webContents.send('sleep-current-tab');
      event.preventDefault();
    }
    // Ctrl+Shift+R was previously bound here to toggle-reading-mode, which
    // hijacked the renderer-side hard-reload shortcut. Reading mode is still
    // accessible via Ctrl+Alt+R through the renderer's ShortcutsRegistry; this
    // block intentionally stays out of the way so hard-reload can fire.
    if (input.control && input.shift && (input.key === 'R' || input.key === 'r')) {
      console.log('[Vex] hard reload triggered — main process (Ctrl+Shift+R detected, passing to renderer)');
    }
    if (input.control && input.alt && input.key === 's') {
      mainWindow.webContents.send('take-screenshot');
      event.preventDefault();
    }
    if (handleFullscreenShortcut(event, input)) return;
    if (handleDevToolsShortcut(event, input)) return;
    if (input.control && input.key === 'm') {
      mainWindow.webContents.send('toggle-mute-tab');
      event.preventDefault();
    }
    if (input.control && input.shift && input.key === 'A') {
      mainWindow.webContents.send('toggle-ai-panel');
      event.preventDefault();
    }
    if (input.control && input.shift && input.key === 'L') {
      mainWindow.webContents.send('toggle-schedules');
      event.preventDefault();
    }
    if (input.control && !input.shift && !input.alt && input.key === 'b') {
      mainWindow.webContents.send('toggle-tabs-sidebar');
      event.preventDefault();
    }
  });

  // Disable default menu
  Menu.setApplicationMenu(null);
});

// IPC handlers
ipcMain.on('window-minimize', () => mainWindow?.minimize());
ipcMain.on('window-maximize', () => {
  if (mainWindow?.isMaximized()) {
    mainWindow.unmaximize();
  } else {
    mainWindow?.maximize();
  }
});
ipcMain.on('window-close', () => mainWindow?.close());

ipcMain.handle('get-start-page-path', () => 'vex://start');
ipcMain.handle('get-start-page-url', () => {
  // Return file:// URL as a bulletproof fallback that never triggers OS "open with" dialog
  const filePath = path.join(__dirname, 'renderer', 'start.html');
  return pathToFileURL(filePath).toString();
});

// === Google Suggest proxy (web search predictions) ===
// Fetched in the MAIN process because Google Suggest returns NO CORS header,
// so a webSecurity:true renderer/webview fetch is blocked. Both the address
// bar (window.vex.webSuggest) and the start-page guest (__vexSuggestBridge.
// suggest) funnel here. Fail-silent: any error/offline → [] (never throws).
//
// _parseGoogleSuggest is a byte-identical inline copy of parseGoogleSuggest in
// src/renderer/js/smart-searchbar.js — the two MUST stay in sync. The canonical
// copy (pinned by unit tests) lives in smart-searchbar.js.
function _parseGoogleSuggest(raw) {
  try {
    const arr = JSON.parse(raw);
    if (Array.isArray(arr) && Array.isArray(arr[1])) {
      return arr[1].filter(s => typeof s === 'string');
    }
  } catch {}
  return [];
}
ipcMain.handle('web-suggest', async (_event, query) => {
  const q = (query == null ? '' : String(query)).trim();
  if (!q) return [];
  try {
    const url = 'https://suggestqueries.google.com/complete/search?client=firefox&q=' + encodeURIComponent(q);
    const r = await net.fetch(url);
    if (!r.ok) return [];
    return _parseGoogleSuggest(await r.text());
  } catch (e) {
    return [];
  }
});

ipcMain.handle('storage-save', (event, key, data) => {
  try {
    fs.writeFileSync(getStorageFile(key), JSON.stringify(data, null, 2));
    return true;
  } catch (e) {
    console.error('Storage save error:', e);
    return false;
  }
});

ipcMain.handle('storage-load', (event, key) => {
  try {
    const file = getStorageFile(key);
    if (fs.existsSync(file)) {
      return JSON.parse(fs.readFileSync(file, 'utf-8'));
    }
    return null;
  } catch (e) {
    console.error('Storage load error:', e);
    return null;
  }
});

ipcMain.handle('open-pip-window', (event, url) => {
  // Security audit M-4: a renderer-XSS could pop a frameless always-on-top
  // window pointing at file:///, chrome://, javascript:, data: html, etc.
  // safePipUrl restricts to http(s) only and throws on anything else; we
  // catch it separately so the renderer learns "rejected" rather than the
  // generic "PiP window error" reserved for actual creation failures.
  let safe;
  try {
    safe = safePipUrl(url);
  } catch (err) {
    console.error('[Vex] PiP URL rejected:', err.message);
    return false;
  }
  try {
    createPipWindow(safe);
    return true;
  } catch (e) {
    console.error('PiP window error:', e);
    return false;
  }
});

ipcMain.handle('toggle-fullscreen', () => {
  if (mainWindow) {
    const next = !isFullscreenTracked;
    console.log('[Vex F11] ipcMain toggle-fullscreen called. tracked was:', isFullscreenTracked, '→ setting:', next);
    mainWindow.setFullScreen(next);
  }
});

// Hard reload: clear the webview session's HTTP cache, then reloadIgnoringCache.
// The renderer passes the <webview>'s webContentsId; we resolve it here because
// webContents.session.clearCache() isn't reachable from the renderer side.
ipcMain.handle('webview:hard-reload', async (_e, webContentsId) => {
  try {
    const wc = typeof webContentsId === 'number' ? webContents.fromId(webContentsId) : null;
    if (!wc || wc.isDestroyed()) return { ok: false, error: 'webContents not found' };
    if (wc.session && typeof wc.session.clearCache === 'function') {
      await wc.session.clearCache();
    }
    if (typeof wc.reloadIgnoringCache === 'function') wc.reloadIgnoringCache();
    else wc.reload();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('is-fullscreen', () => {
  return isFullscreenTracked;
});

// DevTools toggle — renderer sends the webContentsId of the tab to toggle
ipcMain.handle('devtools:toggle-webview', async (_e, webContentsId) => {
  try {
    const wc = typeof webContentsId === 'number' ? webContents.fromId(webContentsId) : null;
    if (!wc || wc.isDestroyed()) {
      return { ok: false, error: 'webContents not found' };
    }
    if (wc.isDevToolsOpened()) {
      wc.closeDevTools();
    } else {
      wc.openDevTools({ mode: 'bottom' });
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

// Open DevTools (detached) for a specific webContents. Two-strategy lookup:
//   1. webContents.fromId(webContentsId) — fast path. Used by sidebar panels
//      whose webviews have been mounted long enough that getWebContentsId
//      returns a real integer.
//   2. URL match across getAllWebContents() — fallback for the Inspect
//      Element case, where <webview>.getWebContentsId() can return -1 if
//      the guestInstance isn't fully attached. -1 != null in JS, so the
//      renderer's gate let it through; fromId(-1) returns null and the
//      previous handler silently failed without ever telling the renderer.
//      The `fallbackUrl` argument lets the caller hand in webview.getURL()
//      so we can find the right guest by URL when the ID lookup fails.
ipcMain.handle('devtools:open-for-webcontents', async (_e, webContentsId, fallbackUrl) => {
  console.log('[Vex DT] open-for-webcontents id:', webContentsId, 'fallbackUrl:', fallbackUrl);
  let wc = null;
  try {
    if (typeof webContentsId === 'number' && webContentsId > 0) {
      wc = webContents.fromId(webContentsId);
      if (wc && wc.isDestroyed()) wc = null;
      console.log('[Vex DT]   fromId(', webContentsId, ') →', wc ? 'wc#' + wc.id : 'null');
    } else {
      console.log('[Vex DT]   skipping fromId (id is', webContentsId, ')');
    }
  } catch (err) {
    console.error('[Vex DT]   fromId error:', err);
  }
  if (!wc && typeof fallbackUrl === 'string' && fallbackUrl) {
    const all = webContents.getAllWebContents();
    wc = all.find(c => !c.isDestroyed() && c.getURL() === fallbackUrl) || null;
    console.log('[Vex DT]   URL fallback over', all.length, 'webContents →', wc ? 'wc#' + wc.id : 'null');
  }
  if (!wc) {
    console.error('[Vex DT]   no target webContents found');
    return { ok: false, error: 'webContents not found', requestedId: webContentsId };
  }
  try {
    if (wc.isDevToolsOpened()) {
      wc.closeDevTools();
      console.log('[Vex DT]   closed DevTools for wc#' + wc.id);
    } else {
      wc.openDevTools({ mode: 'detach' });
      console.log('[Vex DT]   opened DevTools for wc#' + wc.id);
    }
    return { ok: true, id: wc.id };
  } catch (err) {
    console.error('[Vex DT]   openDevTools error:', err);
    return { ok: false, error: err.message, id: wc.id };
  }
});

// Replace a misspelled word with a spellcheck suggestion on a guest
// webContents. replaceMisspelling lives on webContents — NOT on the
// <webview> tag element — so the renderer's old webview.replaceMisspelling()
// call was a silent no-op. Resolution logic lives in main-helpers so it can
// be unit-tested without booting Electron.
ipcMain.handle('spellcheck:replace-misspelling', (_e, webContentsId, suggestion, fallbackUrl) => {
  const result = _mainHelpers.resolveAndReplaceMisspelling(webContents, webContentsId, suggestion, fallbackUrl);
  if (!result.ok) {
    console.warn('[Vex spell] replace-misspelling failed:', result.error, '| requestedId:', webContentsId);
  }
  return result;
});

// Downloads IPC — open/show
ipcMain.handle('downloads:open-file', async (_e, filePath) => {
  try { const r = await shell.openPath(filePath); return { ok: !r, error: r || null }; }
  catch (err) { return { ok: false, error: err.message }; }
});
ipcMain.handle('downloads:show-in-folder', (_e, filePath) => {
  try { shell.showItemInFolder(filePath); return { ok: true }; }
  catch (err) { return { ok: false, error: err.message }; }
});
ipcMain.handle('downloads:open-folder', async () => {
  try { await shell.openPath(app.getPath('downloads')); return { ok: true }; }
  catch (err) { return { ok: false, error: err.message }; }
});

ipcMain.handle('open-private-window', () => {
  const privSession = session.fromPartition(`private:${Date.now()}`);
  wireDownloadsOnSession(privSession, 'private');
  wirePermissionsOnSession(privSession, 'private');
  try {
    const preloadPath = path.join(__dirname, 'preload-webview.js');
    const existing = privSession.getPreloads ? privSession.getPreloads() : [];
    if (!existing.includes(preloadPath)) privSession.setPreloads([...existing, preloadPath]);
  } catch {}
  // Apply header stripping + ad blocker to private session
  privSession.webRequest.onHeadersReceived((details, callback) => {
    const rh = { ...details.responseHeaders };
    delete rh['x-frame-options']; delete rh['X-Frame-Options']; delete rh['X-FRAME-OPTIONS'];
    if (rh['content-security-policy']) rh['content-security-policy'] = rh['content-security-policy'].map(c => c.replace(/frame-ancestors[^;]*;?/gi, ''));
    if (rh['Content-Security-Policy']) rh['Content-Security-Policy'] = rh['Content-Security-Policy'].map(c => c.replace(/frame-ancestors[^;]*;?/gi, ''));
    callback({ responseHeaders: rh });
  });
  privSession.webRequest.onBeforeRequest((details, callback) => {
    const blocked = adBlockerEnabled && (engineBlocks(details) === true || shouldBlock(details.url));
    if (blocked) _recordTracker(details.url, details.webContentsId);
    callback({ cancel: blocked });
  });
  const chromeUA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
  privSession.setUserAgent(chromeUA);
  wireClientHintsOnSession(privSession);

  const privWin = new BrowserWindow({
    width: 1200, height: 800, frame: false, titleBarStyle: 'hidden',
    backgroundColor: '#1a0a1a',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      webviewTag: true, contextIsolation: true, nodeIntegration: false
    }
  });
  privWin.loadFile(path.join(__dirname, 'renderer', 'index.html'), { query: { private: 'true' } });
  return true;
});

// Update IPC
// Lightweight manual check: fetch latest.yml from the GitHub "latest" release and
// compare versions ourselves. We deliberately do NOT call
// autoUpdater.checkForUpdates() here — on this (castLabs, unsigned) build it can
// spawn native helpers (7za/differential tooling) that crash the process on
// machines missing the MSVC runtime, which made the app close on "Check for
// updates". This path only does an HTTPS GET + a string compare, so it can't
// take the app down; if an update exists we point the user at the release page.
function _cmpVer(a, b) {
  const pa = String(a).split(/[.\-+]/).map(n => parseInt(n, 10) || 0);
  const pb = String(b).split(/[.\-+]/).map(n => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d > 0 ? 1 : -1;
  }
  return 0;
}
ipcMain.handle('check-for-updates', async () => {
  const current = app.getVersion();
  const RELEASES = 'https://github.com/0xmortuex/Vex/releases/latest';
  // Direct link to the installer asset of whatever the latest release is — clicking
  // it downloads Vex-Setup.exe straight away (no release-page hunting).
  const DOWNLOAD = 'https://github.com/0xmortuex/Vex/releases/latest/download/Vex-Setup.exe';
  try {
    const res = await net.fetch('https://github.com/0xmortuex/Vex/releases/latest/download/latest.yml', { redirect: 'follow' });
    if (!res.ok) return { ok: false, error: 'Could not reach the update server', current, url: RELEASES, downloadUrl: DOWNLOAD };
    const text = await res.text();
    const m = text.match(/version:\s*([0-9][0-9A-Za-z.\-+]*)/i);
    const latest = m ? m[1].trim() : null;
    if (!latest) return { ok: false, error: 'No version info found', current, url: RELEASES, downloadUrl: DOWNLOAD };
    return { ok: true, current, latest, hasUpdate: _cmpVer(latest, current) > 0, url: RELEASES, downloadUrl: DOWNLOAD };
  } catch (e) {
    return { ok: false, error: e.message, current, url: RELEASES, downloadUrl: DOWNLOAD };
  }
});
ipcMain.handle('download-update', async () => {
  if (!autoUpdater) return { ok: false };
  try { await autoUpdater.downloadUpdate(); return { ok: true }; }
  catch (e) { return { ok: false, error: e.message }; }
});
ipcMain.handle('install-update', () => { autoUpdater?.quitAndInstall(false, true); });
ipcMain.handle('get-app-version', () => app.getVersion());
ipcMain.handle('widevine:status', () => ({ status: _widevineStatus, packaged: app.isPackaged }));
// Retry DRM setup: CLEAR the cached Widevine component, then relaunch so the
// castLabs component install runs from scratch. A plain relaunch isn't enough
// when the first download left a partial/corrupted component on disk — the
// updater sees the broken cached copy and keeps failing across restarts. Wiping
// these dirs forces a clean re-download. whenReady() is also memoized per run,
// so the relaunch is what actually re-attempts the install.
ipcMain.handle('widevine:retry', () => {
  try {
    const ud = app.getPath('userData');
    // castLabs/Chromium component locations (best-effort; force:true ignores
    // missing dirs). We deliberately do NOT touch unrelated caches.
    for (const rel of ['WidevineCdm', 'component_crx_cache', 'widevine_cdm_hint']) {
      try { fs.rmSync(path.join(ud, rel), { recursive: true, force: true }); } catch {}
    }
    console.log('[Widevine] cleared component cache; relaunching for clean install');
    app.relaunch();
    app.exit(0);
    return { ok: true };
  } catch (e) {
    console.warn('[Widevine] retry failed:', e && e.message);
    return { ok: false, error: e && e.message };
  }
});

// Set as default browser — opens Windows Default Apps settings
ipcMain.handle('set-as-default-browser', async () => {
  try {
    if (process.platform === 'win32') {
      shell.openExternal('ms-settings:defaultapps');
    } else {
      shell.openExternal('https://support.apple.com/guide/mac-help/change-your-default-web-browser-mh35856/mac');
    }
    return true;
  } catch (e) {
    console.error('set-as-default-browser error:', e);
    return false;
  }
});

ipcMain.handle('is-default-browser', () => {
  try {
    return app.isDefaultProtocolClient('http');
  } catch { return false; }
});

ipcMain.handle('adblocker-get-state', () => adBlockerEnabled);
ipcMain.handle('adblocker-set-state', (event, enabled) => {
  adBlockerEnabled = enabled;
  return adBlockerEnabled;
});

// === Privacy hardening IPC ===
// Synchronous config read for the webview preload (must know the farble flag +
// seed BEFORE any page script runs, so an async invoke would be too late).
ipcMain.on('privacy:config-sync', (e) => { e.returnValue = { farble: !!privacyCfg.farble, seed: FARBLE_SEED }; });
ipcMain.handle('privacy:get-config', () => privacyLoad());
ipcMain.handle('privacy:set-config', (_e, cfg) => {
  privacyCfg = { ...privacyCfg, ...(cfg || {}) };
  privacySave();
  applyDoH();
  return privacyCfg;
});
ipcMain.handle('privacy:tracker-stats', () => {
  const byHost = Object.keys(_trackerTally)
    .map(h => ({ host: h, count: _trackerTally[h], sites: _trackerSites[h] ? Array.from(_trackerSites[h]) : [] }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 100);
  // Cross-site trackers: the ones seen on more than one of your sites — i.e. the
  // companies actually following you around the web.
  const crossSite = byHost
    .filter(t => t.sites.length > 1)
    .map(t => ({ host: t.host, siteCount: t.sites.length, sites: t.sites.slice(0, 30) }))
    .sort((a, b) => b.siteCount - a.siteCount)
    .slice(0, 40);
  return { total: _trackerTotal, byHost, crossSite };
});
ipcMain.handle('privacy:tracker-reset', () => {
  for (const k in _trackerTally) delete _trackerTally[k];
  for (const k in _trackerSites) delete _trackerSites[k];
  _trackerTotal = 0;
  return { ok: true };
});

app.on('window-all-closed', () => {
  app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

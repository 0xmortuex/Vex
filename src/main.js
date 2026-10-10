require('./diagnostics').install(process.env.VEX_VERBOSE_DIAGNOSTICS === '1');
const { app, BrowserWindow, session, ipcMain, protocol, globalShortcut, Menu, net, shell, dialog, webContents, safeStorage, clipboard, Notification, nativeImage } = require('electron');

// The PrintPreview flag and --enable-print-preview were meant to turn on
// Chromium's rich print preview (Save as PDF, margins, background graphics).
// They do not: that preview is part of Chrome's own UI, which Electron does
// not ship, so window.print() and Print (Ctrl+P) open the Windows system print
// dialog (found 2026-09-30). The switches are left as they were; they change
// nothing. MUST run before any other app.* access — Chromium
// initializes its feature list on first app touch, and reading e.g.
// app.isPackaged in a console.log was previously happening above this block.
// NB: Chromium keeps only the LAST --enable-features occurrence (it does not
// merge), and Electron's appendSwitch overwrites a repeated switch — so every
// feature we enable must live in this ONE comma-separated list, never a second
// appendSwitch('enable-features', …) call.
//
// PrintPreview: see above — Electron has no print preview to turn on, so
// printing shows the Windows system print dialog either way.
//
// HardwareSecureDecryption: use the MediaFoundation-based Widevine CDM (the
// "Google Widevine Windows CDM" component, installed but idle by default in
// Electron) for hardware-backed decryption. Chrome enables this by default, so
// tracks that request a higher Widevine robustness than the software CDM's
// SW_SECURE_CRYPTO — a subset of Spotify's catalog — play in Chrome but showed
// "Spotify can't play this right now" in Vex (confirmed 2026-08-26: the same
// tracks play in Chrome, fail in the Vex panel). Enabling it exposes the
// higher robustness levels the software-only path lacked. Falls back to
// software automatically where the hardware path isn't available, so it can't
// regress machines that lack it.
app.commandLine.appendSwitch('enable-features', 'PrintPreview,HardwareSecureDecryption');
app.commandLine.appendSwitch('enable-print-preview');

// Let AudioContexts start without a user gesture. Required for Master Volume's
// >100% boost: it taps each media element through a Web Audio GainNode, which is
// silent if the context is suspended (Chromium's default autoplay policy keeps it
// suspended until a same-page gesture, which a host-side slider doesn't provide).
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

// === Profiles (src/main/profiles.js) =========================================
// Which profile this launch is: `--profile=<id>`, or the default (the userData
// folder Vex always used). Points userData at it HERE, before anything below
// reads userData (Memory Saver's flags, the single-instance lock, storage, the
// crash log, sessions) — so every one of them is that profile's own.
let _profile;
try {
  _profile = require('./main/profiles').selectProfile({ app, argv: process.argv, fs: require('fs') });
} catch (err) {
  console.error('[Profiles]', err.message);
  // A reminder's wake-up for a profile deleted since quietly does nothing;
  // anything else (a shortcut to a deleted profile, a damaged profile list)
  // says what is wrong instead of opening some other profile.
  if (!(err.code === 'VEX_PROFILE_MISSING' && process.argv.some(a => /^--reminder=|^vex:\/\//.test(a)))) {
    dialog.showErrorBox('Vex could not open this profile', err.message);
  }
  process.exit(1);
}
console.log('[Profiles] this is profile', _profile.id, '-', _profile.dir);

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
//
// SpareRendererForSitePerProcess: Chromium keeps a warm, EMPTY spare renderer
// process around at all times so the next navigation starts a touch faster. It
// costs a whole idle renderer (~40–130 MB) that does nothing until used —
// disabling it lowers Vex's resting memory with only a small first-navigation
// latency cost. (Same single disable-features list — Chromium keeps only the
// last --disable-features occurrence, so every feature must live here.)
//
// Memory Saver mode (opt-in, Settings → Performance): when enabled it adds more
// memory-reducing flags at launch. These are command-line flags, so they can
// only be applied at boot — we read the persisted setting straight from
// vex-persist.json (the renderer mirrors localStorage there) since this runs
// before the app is ready. BackForwardCache holds whole pages in RAM for instant
// back/forward; OptimizationGuide* download/hold on-device ML models Vex doesn't
// use; Translate is Chromium's built-in translator (Vex has its own). Turning
// them off trades a little convenience for lower resting memory.
let _memorySaver = false;
try {
  const _fs = require('fs'), _path = require('path');
  const _pf = _path.join(app.getPath('userData'), 'vex-persist.json');
  const _j = JSON.parse(_fs.readFileSync(_pf, 'utf-8'));
  _memorySaver = _j['vex.memorySaver'] === '1' || _j['vex.memorySaver'] === 1;
} catch {}
let _disableFeatures = 'SpareRendererForSitePerProcess';
if (_memorySaver) {
  _disableFeatures += ',BackForwardCache,OptimizationGuideModelDownloading,OptimizationHints,Translate';
  // Cap the number of renderer processes so heavy tab sets share processes
  // instead of spawning one each. A soft cap — Chromium still isolates where it
  // must; the trade is a little cross-tab jank under load for fewer processes.
  app.commandLine.appendSwitch('renderer-process-limit', '8');
}
app.commandLine.appendSwitch('disable-features', _disableFeatures);

// Windows toast identity. Web-page notifications surface as OS toasts, and on
// Windows a toast is silently dropped unless the process has an
// AppUserModelID. Packaged installs get one via the electron-builder shortcut,
// but the runtime call makes dev runs behave the same. Matches build.appId.
app.setAppUserModelId('com.vex.browser');

const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const { shouldBlock, repairAllows } = require('./adblocker');
const { initEngine: initAdblockEngine, engineBlocks, enableCosmeticFiltering } = require('./adblocker-engine');
const _torLauncher = require('./tor-launcher');
const { createPipWindow, createPipPlayer, pipPlaybackPosition, closePipWindow, togglePipPin, isPipOpen, onPipClosed, setCloseReason, setPipPosition, isPipContents } = require('./pip');
const _mainHelpers = require('./main-helpers');
const { safeJoin, safeName, safePipUrl } = _mainHelpers;
const { registerSidebarConfigIpc } = require('./sidebar-config');
const { createSessionSecurity } = require('./main/session-security');
const secureSessions = createSessionSecurity({ session, BrowserWindow, webContents, root: __dirname, isPipContents });
const boundedNetFetch = require('./main/network').createBoundedFetch(net.fetch.bind(net));
require('./main/ipc-policy').installIpcPolicy(ipcMain, secureSessions);
ipcMain.on('storage:flushed', event => {
  const host = secureSessions.owner(event.sender);
  if (!host) return;
  clearTimeout(host.flushTimer);
  host.allowClose = true;
  // The main window closing for good is Vex closing: what its processes do
  // from here is not a crash (src/main/exit-kinds.js).
  if (host.win === mainWindow) _exitWatch.mark(_pendingInstall ? 'installing an update' : 'closing');
  host.win.close();
});
ipcMain.on('storage:flush-failed', event => {
  const host = secureSessions.owner(event.sender);
  if (!host) return;
  clearTimeout(host.flushTimer);
  host.flushing = false;
  host.win.webContents.send('vex:toast', 'Changes could not be saved. Retry closing after the storage error is resolved.');
});
// A tab's back list, kept with the tab so its page can be built again with
// it after sleep, a reopen or a restart (session-security.js, carryHistory).
// The page is one of the asking window's own (ipc-policy.js, TARGET_CHANNELS).
ipcMain.handle('tabs:history', (_event, pageId) => {
  const guest = webContents.fromId(pageId);
  return guest && !guest.isDestroyed() ? secureSessions.readHistory(guest) : null;
});
ipcMain.on('tabs:carry-history', (event, token, partition, list) => {
  const host = secureSessions.owner(event.sender);
  if (!host) return;
  secureSessions.carryHistory(host.win.webContents.id, token, partition, list);
});
// A tab closed (js/tabs.js, closeTab): the back lists kept for its
// JavaScript-off pages go now (session-security.js, forgetHistories).
ipcMain.on('tabs:closed', (event, pageIds) => {
  const host = secureSessions.owner(event.sender);
  if (!host) return;
  secureSessions.forgetHistories(host.win.webContents.id, pageIds);
});

// === [Vex URL] DIAGNOSTIC: trace every layer of HTML/URL forwarding chain ===
console.log('[Vex URL] ====== Vex process boot ======');
console.log('[Vex URL] argv:', JSON.stringify(process.argv));
console.log('[Vex URL] cwd:', process.cwd());
console.log('[Vex URL] execPath:', process.execPath);
console.log('[Vex URL] defaultApp:', !!process.defaultApp);
console.log('[Vex URL] isPackaged:', app.isPackaged);

let mainWindow = null;
// Main-process reminders (src/main/reminders.js); created in startReminders()
// once the window exists, referenced by the second-instance handler above it.
let reminders = null;
let adBlockerEnabled = true;
let pendingOpenUrl = null;
// The currently-open Peek-style auth popup window (frameless OAuth child), so a
// backdrop click in the renderer can dismiss it. Null when none is open.
let _activePeekOAuthPopup = null;
// Maps each auth popup's chrome-bar WebContentsView id → its popup BrowserWindow,
// so 'popup-chrome:action' IPC (back/reload/copy/open-as-tab/close) routes to the
// right window.
const _peekChromeByWc = new Map();
// Widevine/DRM (castLabs) status, surfaced in Settings → About so users can tell
// whether protected playback (Spotify/Netflix) is actually enabled.
let _widevineStatus = 'unknown';

// Both guest-page preloads. site-tweaks.js is a separate preload (not required
// from preload-webview.js) because webview preloads run sandboxed, where
// require() only resolves 'electron' — a local require never loads.
const GUEST_PRELOADS = [
  path.join(__dirname, 'preload-webview.js'),
  path.join(__dirname, 'site-tweaks.js'),
  // Cosmetic ad-filtering preload (@ghostery). Self-contained bundle that only
  // require()s 'electron', so it's safe in the sandboxed guest context. It asks
  // main (ipc) for element-hiding rules per page and applies them — this is what
  // hides the visible ads network blocking alone can't stop. Handlers are
  // registered by enableCosmeticFiltering() once the engine is ready.
  require.resolve('@ghostery/adblocker-electron-preload'),
];
// Extension service workers never run the page preloads above, so the
// chrome.storage.sync stand-in has its own preload for them
// (preload-extension-sw.js). Registered on a session before an extension
// loads into it; a later worker start picks it up.
const EXT_SW_PRELOAD_ID = 'vex-extension-sw';
function ensureExtensionSwPreload(ses) {
  _wireExtensionWorkerIpc(ses);
  if (typeof ses.registerPreloadScript !== 'function') return;
  if (ses.getPreloadScripts().some(s => s.id === EXT_SW_PRELOAD_ID)) return;
  ses.registerPreloadScript({ type: 'service-worker', id: EXT_SW_PRELOAD_ID, filePath: path.join(__dirname, 'preload-extension-sw.js') });
}

function attachGuestPreloads(ses) {
  const existing = ses.getPreloads ? ses.getPreloads() : [];
  const missing = GUEST_PRELOADS.filter(p => !existing.includes(p));
  if (missing.length) ses.setPreloads([...existing, ...missing]);
}

// About's DRM line, in plain words. components.status() is keyed by
// component id ({"oimompecagnajdejgnnjijobebaeigek": {status, title,
// version}}), so looking Widevine up by its name never matched and About
// printed that raw JSON (found 2026-09-30).
function widevineStatusText(st, id) {
  const cdm = st && typeof st === 'object' ? st[id] : null;
  if (!cdm) return 'not available — the Widevine component is not registered';
  if (!cdm.version) return 'not available — Widevine is not installed' + (cdm.status ? ` (${cdm.status})` : '');
  return `Widevine ready (version ${cdm.version})`;
}

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
    _widevineStatus = 'not available — this Electron build has no Widevine';
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
      _widevineStatus = app.isPackaged
        ? widevineStatusText(st, components.WIDEVINE_CDM_ID)
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
let privacyCfg = { farble: false, doh: 'off', dohProvider: 'cloudflare', httpsOnly: false };
// A key made at launch: each page's farbling seed is derived from it, its
// session's partition and its site (main-helpers.js, farbleSeed), so noise is
// steady for one site in one session, unrelated between sites and sessions,
// and new at every launch. One seed for everything linked a Tor tab to a
// normal one (security scan M1).
const FARBLE_KEY = require('crypto').randomBytes(32);
const DOH_PROVIDERS = {
  cloudflare: 'https://cloudflare-dns.com/dns-query',
  google: 'https://dns.google/dns-query',
  quad9: 'https://dns.quad9.net/dns-query',
};
const _trackerTally = Object.create(null);
const _trackerSites = Object.create(null); // tracker host -> Set of first-party site hosts
const _trackerBySite = Object.create(null); // first-party site host -> requests blocked on its pages
let _trackerTotal = 0;
// Record one blocked request: bump the per-tracker count and remember which
// first-party site it was loaded on (so we can show cross-site trackers — the
// ones that follow you around the web). webContents.fromId resolves the tab that
// initiated the request; only runs on blocks (a fraction of traffic).
function _recordTracker(reqUrl, wcId) {
  try {
    const source = wcId != null ? webContents.fromId(wcId) : null;
    const partition = source && secureSessions.partitionOf(source);
    if (partition && !partition.startsWith('persist:')) return;
    const h = new URL(reqUrl).hostname.replace(/^www\./, '');
    _trackerTally[h] = (_trackerTally[h] || 0) + 1; _trackerTotal++;
    if (wcId != null) {
      const wc = webContents.fromId(wcId);
      const purl = wc && typeof wc.getURL === 'function' ? wc.getURL() : '';
      if (purl && /^https?:/i.test(purl)) {
        const site = new URL(purl).hostname.replace(/^www\./, '');
        if (site) _trackerBySite[site] = (_trackerBySite[site] || 0) + 1;
        if (site && site !== h) (_trackerSites[h] || (_trackerSites[h] = new Set())).add(site);
      }
    }
  } catch {}
}
function privacyLoad() {
  try { const fs = require('fs'); if (fs.existsSync(PRIVACY_FILE())) privacyCfg = { ...privacyCfg, ...JSON.parse(fs.readFileSync(PRIVACY_FILE(), 'utf8')) }; } catch {}
  return privacyCfg;
}

// --- HTTPS-Only mode (privacyCfg.httpsOnly) ---------------------------------
// When on, upgrade http:// document navigations to https:// so you never load a
// page in the clear where an encrypted version exists. Safety-critical detail:
// we ONLY ever fall back to http for a host WE upgraded (tracked per-webContents
// in _httpsUpgradedByWc) — never for a site the user explicitly requested over
// https, which would be a silent downgrade. A host that genuinely has no https
// is remembered for the session (_httpsOnlyFailed) so it stops being upgraded.
const _httpsOnlyFailed = new Set();       // bare hosts known http-only this session
const _httpsUpgradedByWc = new Map();     // wcId -> Set<bareHost> we upgraded (scoped fallback)
// A host whose https had a certificate error: the tab shows a notice
// (_httpsCertNotice), and its "load it unencrypted" link is let through
// without an upgrade, once, for two minutes.
const _httpsOnlyBypass = new Map();       // bare host -> until
function _httpsCertNotice(host, httpUrl) {
  const esc = (s) => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  return `<!doctype html><html><head><meta charset="utf-8"><title>Certificate not valid</title><meta name="color-scheme" content="light dark">
<style>:root{--bg:#f6f7f9;--text:#1b1f27;--muted:#5b6472;--accent:#b4232a}@media (prefers-color-scheme:dark){:root{--bg:#121419;--text:#e6e9ef;--muted:#9aa3b2;--accent:#ff6b6b}}
body{margin:0;background:var(--bg);color:var(--text);font:15px/1.55 system-ui,sans-serif;display:flex;min-height:100vh;align-items:center;justify-content:center}
main{max-width:560px;padding:32px 24px}h1{font-size:21px;margin:0 0 12px;color:var(--accent)}p{margin:0 0 14px}.muted{color:var(--muted);font-size:13.5px}a{color:var(--text)}</style></head>
<body><main><h1>This site's certificate is not valid</h1>
<p><b>${esc(host)}</b> offered a secure connection whose certificate does not check out. That is what happens when someone in the middle of your connection tries to read it.</p>
<p>HTTPS-Only mode stopped here instead of loading the page over an unencrypted connection.</p>
<p class="muted">If you trust this network and still want the page, you can <a href="${esc(httpUrl)}">load it unencrypted</a>. Anyone on the network can then read and change what you see and send.</p>
</main></body></html>`;
}
function _httpsIsLocal(h) {
  return h === 'localhost' || h === '::1' || h === '[::1]'
    || /^127\./.test(h) || /^10\./.test(h) || /^192\.168\./.test(h)
    || /^172\.(1[6-9]|2\d|3[01])\./.test(h) || /\.local$/i.test(h) || /\.onion$/i.test(h);
}
function _httpsIsIpLiteral(h) { return /^\d{1,3}(\.\d{1,3}){3}$/.test(h) || h.includes(':'); }
// Returns the https URL to redirect to, or null to leave the request alone.
function _httpsUpgradeURL(details) {
  if (!privacyCfg.httpsOnly) return null;
  const rt = details.resourceType;
  if (rt !== 'mainFrame' && rt !== 'subFrame') return null;
  let u; try { u = new URL(details.url); } catch { return null; }
  if (u.protocol !== 'http:') return null;
  const hn = u.hostname;
  if (_httpsIsLocal(hn) || _httpsIsIpLiteral(hn)) return null;   // local/dev/IP: no upgrade
  if (u.port && u.port !== '80') return null;                    // custom-port http servers rarely have https
  const bare = hn.replace(/^www\./, '');
  if (_httpsOnlyFailed.has(bare)) return null;                   // proven http-only — don't loop
  // The person chose "load it unencrypted" on the certificate notice: once.
  const bypass = _httpsOnlyBypass.get(bare);
  if (bypass) { _httpsOnlyBypass.delete(bare); if (bypass >= Date.now()) return null; }
  u.protocol = 'https:';
  if (u.port === '80') u.port = '';
  const wc = details.webContentsId;
  if (wc != null) { let s = _httpsUpgradedByWc.get(wc); if (!s) { s = new Set(); _httpsUpgradedByWc.set(wc, s); } s.add(bare); }
  return u.toString();
}
let privacyWrites = Promise.resolve();
function privacySave() {
  const bytes = JSON.stringify(privacyCfg);
  privacyWrites = privacyWrites.catch(() => {}).then(() => atomicWrite(PRIVACY_FILE(), bytes));
  return privacyWrites;
}
const PRIVACY_FILE = () => path.join(app.getPath('userData'), 'privacy.json');

// Remembered geometry + on-top pref for the Discord stream pop-out (PiP-style).
const POPOUT_STATE_FILE = () => path.join(app.getPath('userData'), 'popout-state.json');
function readPopoutState() {
  try { return JSON.parse(fs.readFileSync(POPOUT_STATE_FILE(), 'utf8')) || {}; } catch { return {}; }
}
function writePopoutState(state) {
  try { fs.writeFileSync(POPOUT_STATE_FILE(), JSON.stringify(state || {})); } catch { /* ignore */ }
}
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
app.on('will-quit', () => { try { globalShortcut.unregisterAll(); } catch {} try { _torLauncher.stop(); } catch {} });

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

// Ctrl+Shift+I — toggle Chromium DevTools on the currently active webview.
// Attached to both the main window and every guest webContents for the same
// reason as the fullscreen handler: before-input-event only fires where focus
// lives, so without the guest hook it dies as soon as a page is clicked into.
// The renderer owns the "which tab is active" mapping, so we bounce through IPC
// rather than trying to guess from main. (F12 is handleWindowKeys's.)
function handleDevToolsShortcut(event, input) {
  if (!mainWindow || input.type !== 'keyDown') return false;

  const isDevToolsKey = input.control && input.shift && (input.key === 'I' || input.key === 'i');
  if (!isDevToolsKey) return false;

  event.preventDefault();
  // No DevTools while Vex is locked: its console could open the lock.
  if (_vexLocked) return true;
  mainWindow.webContents.send('devtools:toggle-request');
  return true;
}

// F12, Ctrl+Shift+F12, Ctrl+Shift+J and the boss key, in Vex's own windows
// and the pages in them only (src/main/window-keys.js says why they stopped
// being Windows-wide). Attached to every window and page below.
const _windowKeys = require('./main/window-keys');
const _bossKey = _windowKeys.createBossKey({
  globalShortcut,
  windows: () => BrowserWindow.getAllWindows(),
  contents: () => webContents.getAllWebContents(),
  log: (m) => console.error(m),
});
function _windowOfContents(contents) {
  if (contents.getType() === 'webview') {
    const host = secureSessions.owner(contents);
    if (host && host.win && !host.win.isDestroyed()) return host.win;
    const embedder = contents.hostWebContents;
    return embedder ? BrowserWindow.fromWebContents(embedder) : null;
  }
  return BrowserWindow.fromWebContents(contents);
}
function handleWindowKeys(event, input, contents) {
  // The shortcut editor is recording in the main window: the key is its.
  if (_shortcutCapturing && mainWindow && !mainWindow.isDestroyed() && contents === mainWindow.webContents) return false;
  if (_windowKeys.isBossKey(input)) {
    event.preventDefault();
    const r = _bossKey.hide();
    if (!r.ok) {
      console.error('[BossKey] ' + r.error);
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('vex:toast', r.error);
    }
    return true;
  }
  const action = _windowKeys.devToolsKeyFor(input);
  if (!action) return false;
  event.preventDefault();
  // No DevTools while Vex is locked: its console could open the lock.
  if (_vexLocked) return true;
  const win = _windowOfContents(contents);
  if (!win || win.isDestroyed()) return true;
  try {
    if (action === 'window-docked') {
      if (win.webContents.isDevToolsOpened()) win.webContents.closeDevTools();
      else win.webContents.openDevTools({ mode: 'bottom' });
    } else if (action === 'window-detached') {
      win.webContents.openDevTools({ mode: 'detach' });
    } else if (win === mainWindow) {
      // Ctrl+Shift+J: the page or panel with the focus, in the main window.
      if (contents.isDevToolsOpened()) contents.closeDevTools();
      else contents.openDevTools({ mode: 'detach' });
    }
  } catch (err) {
    console.error('[Vex DT] ' + action + ' could not open DevTools:', err.message);
  }
  return true;
}
app.on('web-contents-created', (_e, contents) => {
  const type = contents.getType();
  if (type !== 'window' && type !== 'webview') return;
  contents.on('before-input-event', (event, input) => { handleWindowKeys(event, input, contents); });
  // Whatever opened DevTools (right-click Inspect, a panel's own button, a
  // key), it does not stay open while Vex is locked.
  contents.on('devtools-opened', () => {
    if (_vexLocked && !contents.isDestroyed()) contents.closeDevTools();
  });
});

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

// Forward the core browser-navigation shortcuts from a focused GUEST page to the
// renderer. before-input-event only fires where focus is, so without this the
// user's tab/URL/zoom shortcuts do nothing the moment they click into a web page
// (the host chrome handles them via ShortcutsRegistry when IT has focus).
// Deliberately narrow: ONLY pure browser combos that web apps never use — so we
// never steal Ctrl+B (bold), Ctrl+K (Discord/Slack quick switcher), Ctrl+M, etc.
// Those still work when the chrome is focused.
// Apps that paint their document text into a <canvas> rather than the DOM -
// Google Docs, Sheets and Slides - cannot be searched by Chromium's findInPage
// at all: it walks the text tree, and canvas pixels are not in it. Measured on a
// page holding both: DOM text 1 match, canvas text 0 matches. Those apps ship
// their own find, so swallowing Ctrl+F there replaced a working search with a
// find bar guaranteed to report nothing. Let the key reach the page instead.
const { guestOwnsFind } = require('./main/find-policy');
// The sessions ordinary browsing happens in: the default one plus the
// containers. Routing, and anything else that must cover "all of Vex",
// works through this list.
const BROWSING_SESSIONS = ['persist:main', 'persist:container-work', 'persist:container-personal', 'persist:container-shopping'];

const { shortcutFor, pageShortcut } = require('./main/guest-shortcuts');

// The key combinations the renderer's shortcut registry currently answers to
// (js/shortcuts-registry.js pushes them on start and on every rebind). Held
// here so a key pressed while a PAGE has the focus can be passed up to it.
let _guestWantedKeys = new Set();
ipcMain.on('shortcuts:guest-keys', (event, combos) => {
  if (!secureSessions.isUiFrame(event)) return;
  _guestWantedKeys = new Set((Array.isArray(combos) ? combos : []).filter(c => typeof c === 'string').slice(0, 300));
  // A key Vex took or gave up changes which extension shortcuts are live.
  _extKeysChanged();
});

// The shortcut editor records a key in the main window's page, but the keys
// main acts on there itself (Ctrl+T/W/K/F/R, zoom, F11, F12…) never reached
// it: pressing Ctrl+T to record it opened a tab (found 2026-09-29). While the
// editor listens, the main window's key handler stands aside. It clears
// itself when the window loses focus and after 15 s, so a recorder that never
// says it stopped cannot leave Vex's own shortcuts dead.
const SHORTCUT_CAPTURE_MS = 15000;
let _shortcutCapturing = false;
let _shortcutCaptureTimer = null;
function _setShortcutCapturing(on) {
  clearTimeout(_shortcutCaptureTimer);
  _shortcutCaptureTimer = null;
  _shortcutCapturing = on;
  if (on) _shortcutCaptureTimer = setTimeout(() => { _shortcutCapturing = false; _shortcutCaptureTimer = null; }, SHORTCUT_CAPTURE_MS);
}
ipcMain.handle('shortcuts:capturing', (event, on) => {
  if (!mainWindow || mainWindow.isDestroyed() || event.sender !== mainWindow.webContents || event.senderFrame !== mainWindow.webContents.mainFrame) {
    throw new Error('Only the main Vex window records shortcuts');
  }
  _setShortcutCapturing(on);
  return true;
});

// A key the page had first and left alone (preload-webview.js): Ctrl+B,
// Ctrl+Shift+Z and the rest of guest-shortcuts.js PAGE_FIRST.
ipcMain.on('guest:page-shortcut', (event, report) => {
  const win = _shortcutWindow(event.sender);
  if (!win) return;
  const hit = pageShortcut(report);
  if (hit) win.webContents.send(hit.channel);
});

// The window a page's key belongs to: its own. Every key went to the main
// window, so Ctrl+H in a private window opened History in the main one and
// Ctrl+W would have closed a main-window tab (found 2026-09-29). None while
// Vex is locked.
function _shortcutWindow(contents) {
  if (_vexLocked) return null;
  const host = secureSessions.owner(contents);
  const win = (host && host.win) || mainWindow;
  return win && !win.isDestroyed() ? win : null;
}

function handleBrowserShortcut(event, input, contents) {
  const win = _shortcutWindow(contents);
  if (!win) return false;
  let url;
  try { url = (contents && contents.getURL && contents.getURL()) || ''; } catch { url = ''; }
  const hit = shortcutFor(input, { ownsFind: guestOwnsFind(url), wanted: _guestWantedKeys });
  if (!hit) return false;
  win.webContents.send(hit.channel, ...(hit.args || []));
  event.preventDefault();
  return true;
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
  // Out now, not app.quit(): quit let the rest of this file run, and its boot
  // guard wrote "starting" over the running copy's state — two such launches
  // (two links from another app, opening an open profile twice) and the next
  // start came up in safe mode. The argv was already handed over: the lock
  // call returns only once the running copy has it.
  process.exit(0);
} else if (process.argv.includes('--vex-close-for-update')) {
  // Another profile installing an update asked this profile to close, but it
  // had already closed by the time this launch ran: there is nothing to do.
  console.log('[Profiles] asked to close for an update, and was not running');
  process.exit(0);
} else {
  app.on('second-instance', (event, commandLine, workingDirectory) => {
    console.log('[Vex URL] second-instance fired.');
    console.log('[Vex URL]   commandLine:', JSON.stringify(commandLine));
    console.log('[Vex URL]   workingDirectory:', workingDirectory);
    // Another profile is installing an update (src/main/profiles.js): close the
    // way the window's X does, which saves everything, and quit. This profile's
    // own pending install, if any, is dropped — only one installer runs.
    if (commandLine.includes('--vex-close-for-update')) {
      _closeForOtherProfileUpdate();
      return;
    }
    // A Snooze / Open button on a reminder's toast arrives as vex://…
    if (commandLine.some(a => handleVexAction(a))) return;
    // "Start in safe mode" from the taskbar while Vex is already running:
    // restart into it (tabs are saved continuously, as for any restart).
    if (commandLine.includes('--safe-mode')) {
      console.log('[SafeMode] asked for while running — restarting into safe mode');
      app.relaunch({ args: [...process.argv.slice(1).filter(a => a !== '--safe-mode'), '--safe-mode'] });
      app.exit(0);
      return;
    }
    // Windows Task Scheduler launching Vex for a reminder while it is already
    // running lands here. The in-process timer normally fired it already; a
    // due-check is idempotent, and the window comes forward either way.
    if (commandLine.some(a => /^--reminder=/.test(a))) {
      console.log('[Reminders] woken by the OS while running — checking what is due');
      if (reminders) reminders.fireDue().catch(err => console.error('[Reminders] fireDue after wake failed:', err.message));
      focusMainWindow();
      return;
    }
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
      // Starting a profile that is already open (its shortcut, the profile
      // menu, the Start menu) brings its window forward.
      focusMainWindow();
    }
  });
}

// === Register Vex as HTTP/HTTPS protocol handler ===
if (process.defaultApp) {
  // Dev mode
  if (process.argv.length >= 2) {
    app.setAsDefaultProtocolClient('http', process.execPath, [path.resolve(process.argv[1])]);
    app.setAsDefaultProtocolClient('https', process.execPath, [path.resolve(process.argv[1])]);
    // vex:// is what the buttons on a reminder's Windows toast launch (see
    // handleVexAction); registering it is what makes them reach Vex.
    app.setAsDefaultProtocolClient('vex', process.execPath, [path.resolve(process.argv[1])]);
  }
} else {
  app.setAsDefaultProtocolClient('http');
  app.setAsDefaultProtocolClient('https');
  app.setAsDefaultProtocolClient('vex');
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
const { savedDecision } = require('./main/permissions');
const { setPageDecision, resetPageDecisions, restorePageDecisions, pendingPermissions, sessionDecisions, sessionDecisionsFor, decisionsFor, sendPermissionRequest, wirePermissionsOnSession, loadPermissionDecisions, savePermissionDecisions, clearAllDecisions, restoreDecisions, permissionsReady, flushPermissions, askExternalApp } = require('./main/permissions').createPermissionService({ userDataPath, secureSessions, ipcMain, _markHidRequestActive });

// === Screen share (getDisplayMedia) — Electron ships no picker, so without a
// DisplayMediaRequestHandler the Discord "Share Screen" / Go Live button silently
// does nothing. We enumerate screens+windows via desktopCapturer, show our own
// picker in the renderer, and hand the chosen source back (with system-audio
// loopback so "share sound" works). ===
const _pendingScreenPicks = new Map();
function wireDisplayMediaOnSession(ses) {
  if (!ses || ses.__vexDisplayWired || typeof ses.setDisplayMediaRequestHandler !== 'function') return;
  ses.__vexDisplayWired = true;
  ses.setDisplayMediaRequestHandler((request, callback) => {
    const requestingContents = request.frame && webContents.fromFrame(request.frame);
    const requestingHost = secureSessions.owner(requestingContents);
    if (!requestingHost) { callback(); return; }
    const requestingFrame = request.frame, requestingUrl = requestingFrame.url;
    const { desktopCapturer } = require('electron');
    desktopCapturer.getSources({ types: ['screen', 'window'], thumbnailSize: { width: 320, height: 180 }, fetchWindowIcons: true })
      .then((sources) => {
        if (!sources || !sources.length) return callback();
        const id = 'scr_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
        if (requestingContents.isDestroyed() || requestingFrame.url !== requestingUrl) return callback();
        // The picker UI lives in the Vex window that owns this request. When the
        // request comes from a DIFFERENT window - a Discord pop-out, which floats
        // always-on-top by default - the picker opens behind it, so "Share Your
        // Screen" looks completely dead while every other call button works.
        // Measured: the picker event fired and the host window stayed unfocused.
        // Raise the host, and drop the pop-out's always-on-top for as long as the
        // pick is open so it cannot cover the picker; restore it afterwards.
        let restoreRequester = null;
        try {
          const requesterWin = requestingContents.getOwnerBrowserWindow?.();
          if (requesterWin && !requesterWin.isDestroyed() && requesterWin !== requestingHost.win) {
            if (requesterWin.isAlwaysOnTop()) {
              requesterWin.setAlwaysOnTop(false);
              restoreRequester = () => {
                try { if (!requesterWin.isDestroyed()) requesterWin.setAlwaysOnTop(true, 'floating'); } catch {}
              };
            }
            if (!requestingHost.win.isDestroyed()) { requestingHost.win.show(); requestingHost.win.focus(); }
          }
        } catch { /* best effort: a picker behind a window still beats no picker */ }

        _pendingScreenPicks.set(id, { callback, sources, host: requestingHost, frame: requestingFrame, url: requestingUrl, restoreRequester, audioRequested: !!request.audioRequested, pageId: requestingContents.id });
        const payload = { id, sources: sources.map((s) => ({
          id: s.id, name: s.name, isScreen: /screen/i.test(s.id),
          thumbnail: (s.thumbnail && !s.thumbnail.isEmpty()) ? s.thumbnail.toDataURL() : '',
          icon: (s.appIcon && !s.appIcon.isEmpty()) ? s.appIcon.toDataURL() : '',
        })) };
        try { if (!requestingHost.win.isDestroyed()) requestingHost.win.webContents.send('screen-picker:open', payload); } catch {}
        setTimeout(() => {
          if (!_pendingScreenPicks.has(id)) return;
          _pendingScreenPicks.delete(id);
          try { restoreRequester?.(); } catch {}
          try { callback(); } catch {}
        }, 90000);
      })
      .catch(() => { try { callback(); } catch {} });
  });
}
// The last screen-share quality choice, read ONCE by the guest's getDisplayMedia
// shim (preload-webview.js) so it can applyConstraints on the captured track —
// Electron's handler can't set the video resolution/FPS itself, only the source.
// Kept per page, by the id of the page that asked: with one value for all of
// Vex, any other tab asking first took the sharer's settings, and the sharer
// got the defaults (security scan L6).
const _shareQuality = new Map();
ipcMain.handle('screen-picker:choose', (_e, { id, sourceId, audio, width, height, fps, cursor } = {}) => {
  const p = _pendingScreenPicks.get(id);
  if (!p) return { ok: false, error: 'That share request has expired — start the share again' };
  if (p.host !== secureSessions.owner(_e.sender)) return { ok: false, error: 'Request belongs to another window' };
  _pendingScreenPicks.delete(id);
  try { p.restoreRequester?.(); } catch {}
  try { if (p.frame.detached || p.frame.url !== p.url) { p.callback(); return { ok: false, error: 'Requesting page changed' }; } } catch { try { p.callback(); } catch {} return { ok: false }; }
  if (!sourceId) { _shareQuality.delete(p.pageId); try { p.callback(); } catch {} return { ok: true, cancelled: true }; }
  const src = p.sources.find((s) => s.id === sourceId);
  if (!src) { _shareQuality.delete(p.pageId); try { p.callback(); } catch {} return { ok: false, error: 'That screen or window is no longer there — try again' }; }
  // The answer must match what the page ASKED for. Discord always asks for
  // audio, and a pick without it is refused outright — "AbortError: Invalid
  // capture constraints" — so with "Share audio" unticked (a choice Vex
  // remembers) every share died the moment a screen was picked, silently.
  // So: audio is supplied whenever it was asked for, and when the user does
  // not want it the guest shim drops the audio track before the page sees the
  // stream (dropAudio). Measured on discord.com in the panel, both ways.
  _shareQuality.set(p.pageId, { width: width || 0, height: height || 0, fps: fps || 0, cursor: cursor || '', dropAudio: p.audioRequested && audio === false, at: Date.now() });
  try { p.callback(p.audioRequested ? { video: src, audio: 'loopback' } : { video: src }); }
  catch (err) { _shareQuality.delete(p.pageId); return { ok: false, error: 'The share could not start: ' + err.message }; }
  return { ok: true };
});
ipcMain.handle('screen-share:get-quality', (event) => {
  const q = _shareQuality.get(event.sender.id);   // one-shot, and only this page's own
  _shareQuality.delete(event.sender.id);
  if (!q || Date.now() - q.at > 30000) return null;
  return { width: q.width, height: q.height, fps: q.fps, cursor: q.cursor, dropAudio: !!q.dropAudio };
});
// === QR code for the current page (qrcode npm package, rendered in main) ===
ipcMain.handle('qr:make', async (_e, text) => {
  try {
    if (!text || typeof text !== 'string') return null;
    return await require('qrcode').toDataURL(text.slice(0, 1500), { width: 280, margin: 1 });
  } catch { return null; }
});

// === Per-process resource metrics for the renderer's Resource Monitor ===
// Turn background throttling on/off for a live guest webContents (kept-awake
// tabs opt out so their page keeps running while backgrounded). Best-effort.
ipcMain.handle('vex:set-bg-throttling', (_e, wcId, enabled) => {
  try {
    const wc = webContents.fromId(wcId);
    if (wc && !wc.isDestroyed()) wc.setBackgroundThrottling(!!enabled);
  } catch { /* ignore */ }
});

ipcMain.handle('app:metrics', () => {
  try {
    return app.getAppMetrics().map(p => ({
      type: p.type,
      cpu: (p.cpu && p.cpu.percentCPUUsage) || 0,
      memKB: (p.memory && p.memory.workingSetSize) || 0,
    }));
  } catch { return []; }
});

// === REAL per-tab memory for the Memory panel ===
// Maps each tab's <webview> guest (by webContents id) to its OS process's
// working-set size, so the panel can show actual MB instead of fixed estimates.
// Returns { totalKB, byId: { <wcId>: { memKB, pid, shared } } }. `shared` flags a
// process backing more than one queried tab (same-site tabs share a renderer), so
// the panel can avoid double-counting / label it. totalKB sums UNIQUE process pids
// across the whole app (the true browser footprint), not the per-tab sum.
ipcMain.handle('app:tab-memory', (_e, ids) => {
  const out = { totalKB: 0, byId: {} };
  try {
    const metrics = app.getAppMetrics();
    const memByPid = new Map(metrics.map(p => [p.pid, (p.memory && p.memory.workingSetSize) || 0]));
    out.totalKB = metrics.reduce((s, p) => s + ((p.memory && p.memory.workingSetSize) || 0), 0);
    const pidUseCount = new Map();
    const pidById = {};
    for (const id of Array.isArray(ids) ? ids : []) {
      try {
        const wc = webContents.fromId(id);
        if (!wc || wc.isDestroyed()) continue;
        const pid = wc.getOSProcessId();
        pidById[id] = pid;
        pidUseCount.set(pid, (pidUseCount.get(pid) || 0) + 1);
      } catch { /* stale id */ }
    }
    for (const id of Object.keys(pidById)) {
      const pid = pidById[id];
      out.byId[id] = { memKB: memByPid.get(pid) || 0, pid, shared: (pidUseCount.get(pid) || 0) > 1 };
    }
  } catch { /* return whatever we have */ }
  return out;
});

// === Every process Vex runs, and what each one is (Memory panel › Processes) ===
// app.getAppMetrics() knows the processes; webContents knows which page,
// panel or extension background page lives in each. Joined by OS pid, so the
// panel can say "Discord panel — 1,013 MB" or "uBlock Origin background ·
// persist:spotify" instead of a bare renderer. The renderer names tabs and
// panels from the webContents ids; extension pages are named here, where the
// sessions know their extensions.
ipcMain.handle('app:processes', () => {
  const rows = new Map();
  for (const m of app.getAppMetrics()) {
    rows.set(m.pid, {
      pid: m.pid, type: m.type, name: m.name || m.serviceName || '', sandboxed: !!m.sandboxed,
      cpu: (m.cpu && m.cpu.percentCPUUsage) || 0,
      memKB: (m.memory && m.memory.workingSetSize) || 0,
      privKB: (m.memory && m.memory.privateBytes) || 0,
      contents: [],
    });
  }
  for (const wc of webContents.getAllWebContents()) {
    try {
      if (wc.isDestroyed()) continue;
      const row = rows.get(wc.getOSProcessId());
      if (!row) continue;
      const url = wc.getURL() || '';
      let extension = null;
      if (url.startsWith('chrome-extension://')) {
        const ext = typeof wc.session.getExtension === 'function' ? wc.session.getExtension(url.split('/')[2]) : null;
        extension = ext ? ext.name : 'extension';
      }
      row.contents.push({
        id: wc.id, kind: wc.getType(), url: url.slice(0, 200), title: (wc.getTitle() || '').slice(0, 120),
        partition: _partitionNameOf(wc.session), extension,
      });
    } catch { /* a page mid-teardown */ }
  }
  // Running service workers (an MV3 extension's background, a site's worker)
  // live in renderers of their own but are not webContents, and Electron
  // reports them by Chromium's child id, not the OS pid — so they cannot be
  // pinned to a row. Listed separately: the panel names them as what a
  // renderer with no page most likely is.
  const workers = [];
  for (const p of ['default', ...EXT_PARTITIONS]) {
    try {
      const ses = p === 'default' ? session.defaultSession : secureSessions.fromPartition(p);
      for (const w of Object.values(ses.serviceWorkers.getAllRunning())) {
        const url = String(w.scriptUrl || '');
        let extension = null;
        if (url.startsWith('chrome-extension://')) {
          const ext = typeof ses.getExtension === 'function' ? ses.getExtension(url.split('/')[2]) : null;
          extension = ext ? ext.name : 'extension';
        }
        workers.push({ url: url.slice(0, 200), partition: p, extension });
      }
    } catch { /* a session without service workers */ }
  }
  return { processes: [...rows.values()], workers };
});

// === Diagnostics (Memory panel › Health) ===
// What went wrong since launch, kept in memory: renderer crashes and hangs,
// helper processes gone (GPU, network, audio…), extension load failures, the
// updater's last word, and how long startup took. Bounded, newest last.
// Getting back in when a launch fails (main/safe-mode.js): two launches that
// never finish starting put the third into safe mode — no extensions, no
// panels, no session restore — and the first launch of a new version keeps a
// copy of the settings as they were under the old one.
const _bootGuard = require('./main/safe-mode').createBootGuard({
  dir: userDataPath,
  fs,
  argv: process.argv,
  version: app.getVersion(),
  settingsFile: path.join(userDataPath, 'vex-persist.json'),
  log: (m) => console.log(m),
});
const _boot = _bootGuard.begin();
if (_boot.safeMode) console.log('[SafeMode] ON');

const _diag = { startedAt: Date.now(), marks: {}, events: [], extensionTimes: [] };
// Crashes and hangs also go to a file, so Health can show last week's, not
// only this launch's (main/crash-log.js).
const _crashLog = require('./main/crash-log').createCrashLog({ dir: userDataPath, fs, version: app.getVersion(), log: (m) => console.log(m) });
const _CRASH_KINDS = new Set(['page crashed', 'page hung', 'helper process gone']);
if (_boot.crashed) _crashLog.add('Vex did not finish starting', _boot.fails + ' launch' + (_boot.fails === 1 ? '' : 'es') + ' in a row');
function _diagMark(name) { if (!(name in _diag.marks)) _diag.marks[name] = Math.round(process.uptime() * 1000); }
function _diagEvent(kind, detail) {
  _diag.events.push({ at: Date.now(), kind, detail: String(detail || '').slice(0, 300) });
  if (_CRASH_KINDS.has(kind)) _crashLog.add(kind, detail);
  if (_diag.events.length > 100) _diag.events.splice(0, _diag.events.length - 100);
  console.error(`[Diagnostics] ${kind}: ${detail}`);
}
_diagMark('main-loaded');
app.whenReady().then(() => {
  _diagMark('app-ready');
  // Right-click Vex on the taskbar › "Start in safe mode": the way in when an
  // extension or setting stops Vex starting. Packaged only: in development
  // the executable is bare Electron and the entry would not start Vex.
  // Writing the jump list takes ~130 ms of the main thread, so it waits until
  // the first window is on screen instead of holding up the start.
  if (process.platform === 'win32' && app.isPackaged) {
    app.once('browser-window-created', (_ev, win) => win.once('show', () => setTimeout(() => {
      try {
        app.setUserTasks([{ program: process.execPath, arguments: '--safe-mode', iconPath: process.execPath, iconIndex: 0, title: 'Start in safe mode', description: 'Starts without extensions' }]);
      } catch (err) { console.error('[SafeMode] could not add the taskbar entry:', err.message); }
    }, 1000)));
  }
  // Vex's own Start menu and desktop shortcuts that open a Vex.exe that is
  // gone are pointed back at this one (src/main/shortcut-repair.js; found
  // 2026-10-09). Every start, not only after an update: the installer starts
  // the updated Vex through the Start menu shortcut, so a broken one is the
  // very thing that keeps the --updated run from happening.
  if (process.platform === 'win32' && app.isPackaged) {
    setTimeout(() => {
      try {
        require('./main/shortcut-repair').repairShortcuts({
          packaged: app.isPackaged, shell, fs, execPath: process.execPath,
          dirs: [
            process.env.APPDATA ? path.join(process.env.APPDATA, 'Microsoft', 'Windows', 'Start Menu', 'Programs') : null,
            app.getPath('desktop'),
          ],
          log: (m) => console.log(m),
        });
      } catch (err) { console.error('[Shortcuts] could not check Vex\'s shortcuts:', err.message); }
    }, 5000);
  }
});
app.on('browser-window-created', (_e, win) => {
  win.once('show', () => _diagMark('window-shown'));
  win.webContents.once('did-finish-load', () => _diagMark('interface-loaded'));
  // This launch only counts as a success once the INTERFACE says it is up
  // (js/app.js, at the end of its startup). did-finish-load is far too early:
  // it means the HTML arrived, so a Vex that throws during startup would still
  // look like a good launch and never reach safe mode. The timer is the safety
  // net for a build where that signal never comes at all.
  const startedNet = setTimeout(() => _bootGuard.started(), 60000);
  win.once('closed', () => clearTimeout(startedNet));
});
// Processes ended by Vex quitting, updating or Windows ending the session are
// not crashes (src/main/exit-kinds.js); everything else still is.
const _exitWatch = require('./main/exit-kinds').createExitWatch();
app.on('before-quit', () => _exitWatch.mark('quitting'));
app.on('browser-window-created', (_e, win) => {
  win.on('query-session-end', () => _exitWatch.mark('closing because Windows is logging off or shutting down'));
  win.on('session-end', () => _exitWatch.mark('closing because Windows is logging off or shutting down'));
});
app.on('child-process-gone', (_e, d) => {
  if (!d) return;
  const what = `${d.type}${d.name ? ' ' + d.name : ''} — ${d.reason} (exit ${d.exitCode})`;
  const notCrash = _exitWatch.notACrash(d);
  if (notCrash) { if (d.reason !== 'clean-exit') console.log(`[Diagnostics] helper process ended, not a crash (${notCrash}): ${what}`); return; }
  _diagEvent('helper process gone', what);
});
// A guest page's executeJavaScript calls made while it loads share one
// did-stop-loading wait (src/main/load-wait.js): the New Tab page's dom-ready
// injections passed Node's 10-listener limit on every boot (walkthrough L13).
app.on('web-contents-created', (_e, wc) => { if (wc.getType() === 'webview') require('./main/load-wait').shareLoadWait(wc); });
app.on('web-contents-created', (_e, wc) => {
  // Only a Vex window may hold a <webview> (session-security.js, guardWebviews).
  secureSessions.guardWebviews(wc);
  // What crash-log.json, Health and a problem report say about the page: its
  // origin only, and nothing at all for a private, off-the-record, burner or
  // Tor page. 120 characters of the full address were kept for a week, query
  // strings and private pages included (security scan S5-2).
  const where = () => {
    try {
      const partition = secureSessions.partitionOf(wc);
      if ((partition && !partition.startsWith('persist:')) || partition === 'persist:route-tor' || (wc.session && wc.session.__vexTor)) return 'a private page';
      const u = new URL(wc.getURL());
      if (u.protocol === 'file:') return 'a Vex page';
      return u.origin && u.origin !== 'null' ? u.origin : wc.getType();
    } catch { return wc.getType(); }
  };
  wc.on('render-process-gone', (_ev, d) => {
    if (!d) return;
    const host = secureSessions.owner(wc);
    const notCrash = _exitWatch.notACrash(d, { closing: !!(host && host.allowClose) });
    if (notCrash) { if (d.reason !== 'clean-exit') console.log(`[Diagnostics] page ended, not a crash (${notCrash}): ${where()} — ${d.reason} (exit ${d.exitCode})`); return; }
    _diagEvent('page crashed', `${where()} — ${d.reason} (exit ${d.exitCode})`);
  });
  wc.on('unresponsive', () => _diagEvent('page hung', where()));
  wc.on('responsive', () => _diagEvent('page recovered', where()));
  if (wc.getType() === 'webview') {
    wc.once('did-finish-load', () => { if (!('first-page-loaded' in _diag.marks)) _diagMark('first-page-loaded'); });
  }
});
// Local AI is Ollama's server; after a reboot it is not running. The renderer
// asks for it to be up — no path, no arguments (main/ollama-launcher.js).
const _ollamaLauncher = require('./main/ollama-launcher').createOllamaLauncher({
  platform: process.platform,
  env: process.env,
  exists: (p) => fs.existsSync(p),
  spawn: require('child_process').spawn,
  probe: require('./main/ollama-launcher').httpProbe(require('http')),
  sleep: (ms) => new Promise(r => setTimeout(r, ms)),
  log: (m) => console.log(m),
});
ipcMain.handle('ollama:ensure', () => _ollamaLauncher.ensure());

// How full the graphics card is. A local model lives in video memory, and a
// game fills it: the AI then falls back to the processor and every request
// takes minutes. Vex says so instead of timing out (src/main/gpu.js).
const _gpuProbe = require('./main/gpu').createGpuProbe({ execFile: require('child_process').execFile });
ipcMain.handle('system:gpu', () => _gpuProbe.read());

// Which dev servers are up on this machine (src/main/dev-ports.js). A local
// TCP connect and nothing else: no request is sent, so nothing is disturbed.
const _devPorts = require('./main/dev-ports').createPortScanner({ net: require('net') });
let _devPortsCache = { at: 0, list: [] };
ipcMain.handle('system:dev-ports', async () => {
  // Knocking on thirty ports is cheap but not free, and the answer does not
  // change second to second.
  if (Date.now() - _devPortsCache.at < 5000) return _devPortsCache.list;
  const list = await _devPorts.scan();
  _devPortsCache = { at: Date.now(), list };
  return list;
});

// Notice a full-screen game and tell the renderer, which frees the GPU, sleeps
// background tabs and holds background AI (src/main/game-watch.js). The
// renderer switches it on or off from Settings › Privacy Hardening › Gaming
// and streaming; nothing runs until it asks.
const _gameWatch = require('./main/game-watch').createGameWatch({
  spawn: require('child_process').spawn,
  ownNames: [path.basename(process.execPath, '.exe'), 'Vex', 'electron'],
  // A tiny compiled helper (~a tenth of PowerShell's memory), built once with
  // Windows' own C# compiler into Vex's data folder.
  helper: () => require('./main/game-watch').ensureHelper({
    fs, path, crypto: require('crypto'), execFile: require('child_process').execFile,
    dir: path.join(app.getPath('userData'), 'helpers'), windir: process.env.SystemRoot || process.env.windir,
  }),
  log: (m) => console.log(m),
  onChange: (s) => {
    console.log('[GameWatch] ' + (s.game ? 'game running: ' + s.app : 'no game'));
    try { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('game:state', s); } catch { /* window gone */ }
  },
});
ipcMain.handle('game:watch', async (_e, on) => { if (on) await _gameWatch.start(); else _gameWatch.stop(); return { running: _gameWatch.running(), helper: _gameWatch.usingHelper(), ..._gameWatch.state() }; });
ipcMain.handle('game:state', () => ({ running: _gameWatch.running(), ..._gameWatch.state() }));
app.on('will-quit', () => { try { _gameWatch.stop(); } catch {} });

// Mute Discord without leaving the game (src/main/game-hotkeys.js). These are
// system-wide, so each one is off until the user sets it.
const _gameHotkeys = require('./main/game-hotkeys').createGameHotkeys({
  globalShortcut,
  log: (m) => console.log(m),
  load: () => { try { return JSON.parse(_persistLoad()['vex.gameHotkeys'] || '{}'); } catch { return {}; } },
  save: (applied) => { try { preferences.set('vex.gameHotkeys', JSON.stringify(applied)); } catch (err) { console.error('[Hotkeys] save failed:', err.message); } },
  onAction: (action) => {
    try {
      if (action === 'quick-capture') { openQuickCapture(); return; }
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('hotkey:action', action);
    } catch (err) { console.error('[Hotkeys] could not deliver ' + action + ':', err.message); }
  },
});
ipcMain.handle('hotkeys:get', () => ({ current: _gameHotkeys.current(), actions: _gameHotkeys.ACTIONS }));

// === Quick capture ========================================================
// A small window that floats over whatever you were doing — a game, a stream,
// another program — takes one line, and goes. Without it a thought is lost by
// the time you have alt-tabbed, found Vex, found the panel and clicked.
//
// It is NOT the main window: bringing Vex forward over a fullscreen game is
// exactly the interruption this avoids.
let _captureWin = null;
function openQuickCapture() {
  if (_captureWin && !_captureWin.isDestroyed()) { _captureWin.show(); _captureWin.focus(); return _captureWin; }
  // The screen the mouse is on, so the box appears where you are looking.
  const { screen } = require('electron');
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const width = 520, height = 168;
  _captureWin = new BrowserWindow({
    width, height,
    x: Math.round(display.workArea.x + (display.workArea.width - width) / 2),
    y: Math.round(display.workArea.y + display.workArea.height * 0.22),
    frame: false, transparent: true, resizable: false, movable: true,
    alwaysOnTop: true, skipTaskbar: true, fullscreenable: false, show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload-capture.js'),
      // Its preload uses only contextBridge and ipcRenderer, which a sandboxed
      // preload has (security scan L9).
      contextIsolation: true, nodeIntegration: false, sandbox: true,
    },
  });
  _captureWin.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  // Above a fullscreen game, which an ordinary always-on-top window is not.
  try { _captureWin.setAlwaysOnTop(true, 'screen-saver'); } catch { /* best effort */ }
  _captureWin.loadFile(path.join(__dirname, 'renderer', 'capture.html'));
  _captureWin.once('ready-to-show', () => { _captureWin.show(); _captureWin.focus(); });
  _captureWin.on('closed', () => { _captureWin = null; });
  return _captureWin;
}
// A feature you can only reach by a hotkey you must first set up is nearly
// invisible, so it is a command too.
ipcMain.handle('capture:open', () => { openQuickCapture(); return { ok: true }; });
ipcMain.on('capture:close', (e) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  if (win && !win.isDestroyed()) win.close();
});
// The line goes to the interface, which already knows how to make a note, set
// a reminder or run a command — there is no second implementation of any of it.
// One listener for every answer: the IPC policy wraps ipcMain.on, so an
// ipcMain.off with the original callback removed nothing and each capture
// leaked a listener (found 2026-09-29).
const _capturePending = new Map();
ipcMain.on('capture:done', (_ev, payload) => {
  const p = payload && _capturePending.get(payload.id);
  if (!p) return;
  _capturePending.delete(payload.id);
  clearTimeout(p.timer);
  payload.ok ? p.resolve({ said: payload.said }) : p.reject(new Error(payload.error || 'That did not work'));
});
ipcMain.handle('capture:submit', async (_e, entry) => {
  const kind = String((entry && entry.kind) || 'note');
  const text = String((entry && entry.text) || '').slice(0, 4000);
  if (!text) throw new Error('There is nothing to save');
  if (!mainWindow || mainWindow.isDestroyed()) throw new Error('Vex is not running');
  return new Promise((resolve, reject) => {
    const id = 'cap_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const timer = setTimeout(() => { _capturePending.delete(id); reject(new Error('Vex did not answer')); }, 15000);
    _capturePending.set(id, { resolve, reject, timer });
    mainWindow.webContents.send('capture:take', { id, kind, text });
  });
});
ipcMain.handle('hotkeys:set', (_e, config) => _gameHotkeys.set(config));

ipcMain.on('app:started', () => _bootGuard.started());
ipcMain.handle('app:safe-mode', () => ({ ..._boot, snapshots: _bootGuard.snapshots().map(x => ({ name: x.name, label: x.label, at: x.at })) }));
ipcMain.handle('app:restore-settings', (_e, name) => {
  try { const r = _bootGuard.restoreSettings(String(name || '')); return { ok: true, name: r.name }; }
  catch (err) { return { ok: false, error: err.message }; }
});

ipcMain.handle('app:diagnostics', () => {
  let update = null;
  try { update = require('./main/updates').state; } catch {}
  let scheduled = null;
  try { scheduled = reminders ? reminders.list().filter(r => r.os && r.os.scheduled).length : null; } catch {}
  return {
    startedAt: _diag.startedAt, uptimeMs: Date.now() - _diag.startedAt, marks: _diag.marks, events: _diag.events,
    extensionErrors: [..._extLoadErrors.entries()].map(([folder, error]) => ({ folder, error: String(error).slice(0, 200) })),
    update, remindersScheduled: scheduled, version: app.getVersion(), electron: process.versions.electron, chrome: process.versions.chrome,
    safeMode: _boot.safeMode, bootFails: _boot.fails, extensionTimes: _diag.extensionTimes,
    crashHistory: _crashLog.recent(),
    // The Windows build, for a problem report (js/report-problem.js).
    os: process.getSystemVersion(), arch: process.arch,
  };
});

ipcMain.handle('extensions:set-scope', async (_e, folderName, scope) => {
  if (scope !== 'auto' && scope !== 'everywhere') return { ok: false, error: 'Unknown scope: ' + scope };
  const entry = _extEntriesOnDisk().find(x => x.folder === folderName);
  if (!entry) return { ok: false, error: 'No extension folder named ' + folderName };
  try {
    const scopes = extHelpers.readScopes(extensionsDir);
    if (scope === 'everywhere') scopes[folderName] = 'everywhere';
    else delete scopes[folderName];
    extHelpers.writeScopes(extensionsDir, scopes);
  } catch (err) {
    return { ok: false, error: 'Could not save the scope: ' + err.message };
  }
  // Applied live: into the partitions now wanted, out of the rest — taking it
  // out ends its background page there, and that process, straight away.
  if (entry.manifest && !_readDisabledFolders().has(folderName)) {
    const wanted = new Set(_sessionsFor(entry.path, entry.manifest));
    for (const ses of [session.defaultSession, ...EXT_PARTITIONS.map(p => secureSessions.fromPartition(p))]) {
      // A lazy session with no page open gets it when one appears.
      if (_isLazySession(ses) && !_coveredSessions.has(ses)) continue;
      try {
        const live = ses.getAllExtensions().find(x => path.resolve(x.path) === path.resolve(entry.path));
        if (wanted.has(ses) && !live) { ensureExtensionSwPreload(ses); await ses.loadExtension(entry.path, _extLoadOptions(entry.path)); }
        else if (!wanted.has(ses) && live) ses.removeExtension(live.id);
      } catch (err) {
        return { ok: false, error: `Saved, but could not apply it to ${_partitionNameOf(ses) || 'a session'}: ${err.message}` };
      }
    }
  }
  return { ok: true, scope };
});

// Free memory now (Memory panel): unload the extensions of the lazy sessions
// that have no page open, without waiting the minute.
ipcMain.handle('extensions:release-idle', () => {
  const released = [];
  for (const p of LAZY_EXT_PARTITIONS) {
    const ses = p === 'default' ? session.defaultSession : secureSessions.fromPartition(p);
    const live = _liveBySession.get(ses);
    if (live && live.size) continue;
    if (!ses.getAllExtensions().length) continue;
    _releaseSessionExtensions(ses);
    released.push(p);
  }
  return { ok: true, released };
});

// === "Read free" — clear a single site's data to reset a metered paywall ===
// Clears the origin's local storage caches + removes its cookies in the given
// partition, so counter-based paywalls (NYT/WaPo-style "N free articles") reset
// on reload. Subscriber-only (server-side) walls aren't affected — the renderer
// offers an archive.today fallback for those.
// The session one of these acts on, decided here and not taken on the
// renderer's word: a private window's own session whatever it names, and in
// any other window the tab's partition, never a private window's (persist:main
// when none is named; the default session holds no tab). A private window's
// interface could name persist:main and read or change the main profile's
// cookies (security scan L2).
function _siteSessionFor(event, partition) {
  const host = secureSessions.owner(event.sender);
  if (host && host.privatePartition) return secureSessions.fromPartition(host.privatePartition);
  const p = partition || 'persist:main';
  if (p.startsWith('private:')) throw new Error('That page belongs to a private window');
  return secureSessions.fromPartition(p);
}
ipcMain.handle('site:clear-data', async (_e, opts) => {
  const { partition, url } = opts || {};
  try {
    const ses = _siteSessionFor(_e, partition);
    // Any part that fails is in the answer (src/main/site-data.js).
    const r = await require('./main/site-data').clearSiteData(ses, url);
    if (!r.ok) console.error('[SiteData] clearing failed:', r.error);
    return r;
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

// === One cookie at a time =================================================
// "Clear this site's data" is a hammer. Often one cookie is the problem — a
// stale consent flag, a session the site will not let go of, a counter — and
// the rest are the login you would rather keep. These read, change and remove
// them one by one, in the tab's own partition, so a container's cookies stay
// that container's.
const _cookieUrl = (c) => {
  const dom = String((c && c.domain) || '').replace(/^\./, '');
  return dom ? `http${c.secure ? 's' : ''}://${dom}${(c && c.path) || '/'}` : '';
};
const _cookieSession = (event, partition) => _siteSessionFor(event, partition);

ipcMain.handle('cookies:list', async (_e, opts) => {
  const { partition, url } = opts || {};
  try {
    const cookies = await _cookieSession(_e, partition).cookies.get({ url });
    return {
      ok: true,
      cookies: cookies.map(c => ({
        name: c.name,
        value: c.value,
        domain: c.domain || '',
        path: c.path || '/',
        secure: !!c.secure,
        httpOnly: !!c.httpOnly,
        // A cookie with no expiry goes when the browser does.
        expires: c.expirationDate ? Math.round(c.expirationDate * 1000) : null,
      })),
    };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('cookies:remove', async (_e, opts) => {
  const o = opts || {};
  try {
    await _cookieSession(_e, o.partition).cookies.remove(_cookieUrl(o) || o.url, o.name);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('cookies:set', async (_e, opts) => {
  const o = opts || {};
  try {
    const spec = {
      url: _cookieUrl(o) || o.url,
      name: o.name,
      value: String(o.value == null ? '' : o.value),
      path: o.path || '/',
      secure: !!o.secure,
      httpOnly: !!o.httpOnly,
    };
    // A cookie the site set for its whole domain (".example.com") stays that
    // way; one set for this host alone stays host-only. Changing which it is
    // would make a second cookie of the same name rather than edit this one.
    if (typeof o.domain === 'string' && o.domain.startsWith('.')) spec.domain = o.domain;
    if (Number.isFinite(o.expires) && o.expires > 0) spec.expirationDate = o.expires / 1000;
    await _cookieSession(_e, o.partition).cookies.set(spec);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

// === Full-text recall ("memex") — index the text of pages you read, search it
// later. Stored as a capped JSON log in userData; local only, never uploaded.
// Ranking, tokenizing and snippeting live in ./main/recall-index.js. ===
const { RecallIndex } = require('./main/recall-index');
const RECALL_FILE = () => path.join(app.getPath('userData'), 'recall.json');
// Writes are coalesced: the old code re-serialised and re-wrote the entire log
// (plus a .bak copy) on every single page visit, so a full index meant tens of
// megabytes of disk churn per page loaded, growing with the index.
const RECALL_WRITE_DELAY = 1500;
let _recall = null;
let _recallDirty = false;
let _recallTimer = null;
function recallStore() {
  if (_recall) return _recall;
  let records = [];
  try {
    const fsx = require('fs');
    if (fsx.existsSync(RECALL_FILE())) records = JSON.parse(fsx.readFileSync(RECALL_FILE(), 'utf8'));
    if (!Array.isArray(records)) records = [];
  } catch { records = []; }
  _recall = new RecallIndex(records);
  return _recall;
}
let recallWrites = Promise.resolve();
function recallFlush(erase = false) {
  if (_recallTimer) { clearTimeout(_recallTimer); _recallTimer = null; }
  if (!_recallDirty && !erase) return recallWrites;
  _recallDirty = false;
  const bytes = JSON.stringify(_recall ? _recall.toJSON() : []);
  recallWrites = recallWrites.catch(() => {}).then(async () => {
    await atomicWrite(RECALL_FILE(), bytes, { backup: !erase });
    if (erase) await fs.promises.rm(RECALL_FILE() + '.bak', { force: true });
  });
  return recallWrites;
}
function recallTouch() {
  _recallDirty = true;
  if (_recallTimer) return recallWrites;
  _recallTimer = setTimeout(() => { _recallTimer = null; recallFlush(); }, RECALL_WRITE_DELAY);
  if (typeof _recallTimer.unref === 'function') _recallTimer.unref();
  return recallWrites;
}
ipcMain.handle('recall:index', (_e, entry) => {
  try {
    const { url, title, text } = entry || {};
    if (!url || !/^https?:/i.test(url) || !text || text.length < 80) return { ok: false, reason: 'thin' };
    const store = recallStore();
    const rec = store.put({ url, title, text });
    if (!rec) return { ok: false, reason: 'rejected' };
    recallTouch();
    return { ok: true, pages: store.size };
  } catch (err) { return { ok: false, error: err.message }; }
});
ipcMain.handle('recall:search', (_e, query, options) => {
  try {
    const opts = options && typeof options === 'object' ? options : {};
    return recallStore().search(String(query || ''), {
      limit: opts.limit, offset: opts.offset, sort: opts.sort,
      since: opts.since, until: opts.until, site: opts.site,
    });
  } catch { return { total: 0, hits: [], terms: [], took: 0 }; }
});
ipcMain.handle('recall:stats', () => {
  try { return recallStore().stats(); }
  catch { return { pages: 0, bytes: 0, oldest: 0, newest: 0, hosts: [] }; }
});
ipcMain.handle('recall:forget', async (_e, target) => {
  try {
    const { url, host } = target || {};
    if (!url && !host) return { ok: false, removed: 0 };
    const removed = recallStore().forget({ url, host });
    if (removed) await recallTouch();
    return { ok: true, removed };
  } catch (err) { return { ok: false, removed: 0, error: err.message }; }
});
ipcMain.handle('recall:clear', async () => { recallStore().clear(); await recallFlush(true); return { ok: true }; });

// === Translate arbitrary text/word (free Google endpoint, via main to dodge CORS) ===
ipcMain.handle('translate:text', async (_e, { text, tl } = {}) => {
  try {
    if (!text) return null;
    const u = 'https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=' +
      encodeURIComponent(tl || 'en') + '&dt=t&q=' + encodeURIComponent(String(text).slice(0, 400));
    const res = await boundedNetFetch(u);
    if (!res.ok) return null;
    const data = await res.json();
    return (data && data[0]) ? data[0].map(s => s[0]).join('') : null;
  } catch { return null; }
});

// === What a word means =====================================================
// Asked of Wiktionary's own API, which is free, needs no key and is not going
// anywhere. From here and not from the page, because a page's own rules (CSP)
// would block the request, and because the page has no business knowing which
// words you did not know.
//
// Wiktionary answers in wiki markup turned into HTML, so the tags come off
// here: the renderer is given text, never markup to paste into a card.
const { readDefinitions } = require('./main/dictionary');
ipcMain.handle('dict:lookup', async (_e, word) => {
  const term = String(word || '').trim();
  if (!term || term.length > 40 || !/^[\p{L}][\p{L}'-]*$/u.test(term)) return { ok: false, error: 'That is not a word' };
  try {
    const res = await boundedNetFetch('https://en.wiktionary.org/api/rest_v1/page/definition/' + encodeURIComponent(term));
    if (res.status === 404) return { ok: false, notFound: true, error: 'No entry for "' + term + '"' };
    if (!res.ok) return { ok: false, error: 'The dictionary did not answer (' + res.status + ')' };
    const meanings = readDefinitions(await res.json());
    if (!meanings.length) return { ok: false, notFound: true, error: 'No English entry for "' + term + '"' };
    return { ok: true, word: term, phonetic: '', meanings };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

// === The text of a file you dropped on the AI panel ========================
// The renderer hands over the bytes; the words come back. A PDF is inflated
// and read here (src/main/pdf-text.js) because zlib is here; plain text, and
// the text-shaped formats, are just decoded. Nothing is written to disk and
// nothing leaves the machine — what the AI is then asked is the renderer's
// business, and the user's.
ipcMain.handle('doc:text', async (_e, bytes, name) => {
  const filename = String(name || '');
  try {
    const buffer = Buffer.from(bytes.buffer || bytes, bytes.byteOffset || 0, bytes.byteLength || bytes.length);
    if (/\.pdf$/i.test(filename) || buffer.subarray(0, 5).toString('latin1') === '%PDF-') {
      const text = require('./main/pdf-text').extract(buffer, (raw) => require('zlib').inflateSync(raw));
      if (!text) return { ok: false, error: 'There is no text in that PDF to read — it is probably a scan of paper, or it is locked' };
      return { ok: true, text, kind: 'pdf' };
    }
    const text = buffer.toString('utf8').replace(/\u0000/g, '');
    if (!text.trim()) return { ok: false, error: 'That file has no text in it' };
    return { ok: true, text, kind: 'text' };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

// === Who is live right now =================================================
// Twitch's and YouTube's own public pages, read for one fact each
// (src/main/live-channels.js). No account and no API key.
ipcMain.handle('live:check', async (_e, channels) => {
  const live = require('./main/live-channels');
  try {
    const statuses = await live.check(channels, async (target, opts) => {
      const res = await boundedNetFetch(target, opts);
      return { ok: res.ok, status: res.status, text: res.status === 404 ? '' : await res.text() };
    });
    return { ok: true, statuses };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

// === What this machine can spare ===========================================
// The memory ceiling used to be the same 1200 MB on every machine. This reads
// what the machine actually has (src/main/memory-baseline.js) so the ceiling
// can be set from that, and says why in words the renderer can show.
ipcMain.handle('system:memory', () => {
  const baseline = require('./main/memory-baseline');
  try {
    const reading = baseline.read(require('os'));
    return { ok: true, ...reading, ...baseline.suggest(reading) };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

// === The clips folder ======================================================
// Reading one folder of recordings (src/main/clips.js) so last night's clip
// can be found and watched without going through Explorer. Read-only: the
// folder is chosen by the user, and nothing in it is touched.
const _clipsFile = path.join(userDataPath, 'clips-folder.json');
let _clipsDir = '';
try { _clipsDir = String(JSON.parse(fs.readFileSync(_clipsFile, 'utf8')).dir || ''); } catch { _clipsDir = ''; }

ipcMain.handle('clips:folder', async (_e, pick) => {
  const clips = require('./main/clips');
  if (pick) {
    const result = await dialog.showOpenDialog({ title: 'Where your clips are', properties: ['openDirectory'] });
    if (result.canceled || !result.filePaths[0]) return { ok: false, cancelled: true, dir: _clipsDir };
    _clipsDir = result.filePaths[0];
    try { fs.writeFileSync(_clipsFile, JSON.stringify({ dir: _clipsDir })); } catch { /* it still works this session */ }
  }
  return { ok: true, dir: _clipsDir, guesses: clips.guesses(app.getPath('home')) };
});

ipcMain.handle('clips:list', async (_e, dir) => {
  const clips = require('./main/clips');
  const folder = String(dir || _clipsDir || '');
  if (!folder) return { ok: false, error: 'No clips folder chosen yet' };
  try {
    return { ok: true, dir: folder, clips: clips.list(folder) };
  } catch (err) {
    return { ok: false, error: err.code === 'ENOENT' ? 'That folder is not there any more' : err.message };
  }
});

// === What is free to keep this week ========================================
// Epic's and Steam's own public lists, merged (src/main/free-games.js). No
// account, no key; a store that does not answer is left out rather than
// taking the list down.
ipcMain.handle('games:free', async () => {
  const games = require('./main/free-games');
  const get = async (url) => {
    try {
      const res = await boundedNetFetch(url);
      if (!res.ok) return null;
      return await res.json();
    } catch { return null; }
  };
  try {
    const [epic, steam] = await Promise.all([get(games.EPIC), get(games.STEAM)]);
    if (!epic && !steam) return { ok: false, error: 'Neither store answered — check your connection' };
    return { ok: true, games: games.merge(epic, steam), stores: { epic: !!epic, steam: !!steam } };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

// === Is it me or the server? ===============================================
// Times a plain TCP connection to a few well-known hosts (src/main/latency.js)
// so a stutter can be blamed on the right thing. Nothing is sent, and nothing
// about the machine goes out with it.
ipcMain.handle('net:latency', async () => {
  const latency = require('./main/latency');
  try {
    return { ok: true, ...(await latency.check(latency.tcpConnect(require('net')))) };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

// === RSS fetch (renderer fetch would be CORS-blocked for arbitrary feeds) ===
ipcMain.handle('rss:fetch', async (_e, feedUrl) => {
  try {
    if (!feedUrl || !/^https?:\/\//i.test(feedUrl)) return null;
    const res = await boundedNetFetch(feedUrl, { headers: { 'User-Agent': 'Vex Browser RSS' } });
    if (!res.ok) return null;
    const text = await res.text();
    return text.length > 2 * 1024 * 1024 ? null : text;
  } catch { return null; }
});

// A subscribed calendar's iCal address (renderer: ics-calendar.js). Unlike
// rss:fetch it says why a fetch failed: a calendar that silently stops
// updating looks exactly like a quiet week.
ipcMain.handle('calendar:fetch', async (_e, url) => {
  if (!/^https?:\/\//i.test(String(url || ''))) return { ok: false, error: 'not a web address' };
  try {
    const res = await boundedNetFetch(url, { headers: { Accept: 'text/calendar, text/plain;q=0.8' } });
    if (!res.ok) return { ok: false, error: res.status === 404 ? 'the address no longer exists (404)' : 'the server answered ' + res.status };
    const text = await res.text();
    if (text.length > 10 * 1024 * 1024) return { ok: false, error: 'the calendar is larger than 10 MB' };
    if (!/BEGIN:VCALENDAR/.test(text.slice(0, 2000))) return { ok: false, error: 'that address is not an iCal calendar' };
    return { ok: true, text };
  } catch (err) { return { ok: false, error: (err && err.message) || 'could not be reached' }; }
});

// === Generic HTTP request for the built-in API client + page-change monitor ===
// CORS-free arbitrary fetch, run from main like curl. User-driven dev tool in the
// user's own browser — not exposed to guest pages (only the host renderer's
// window.vex bridge can call it). Caps body size; returns timing + headers.
ipcMain.handle('api:request', async (_e, opts = {}) => {
  const t0 = Date.now();
  try {
    const { url, method = 'GET', headers = {}, body = null, binary = false, mcpServer = null } = opts || {};
    if (!url || !/^https?:\/\//i.test(url)) return { ok: false, error: 'Invalid URL (must be http/https)' };
    const init = { method: String(method || 'GET').toUpperCase(), headers: headers && typeof headers === 'object' ? { ...headers } : {} };
    // An MCP server's token, kept encrypted in main (mcp:auth-set).
    if (mcpServer) {
      const token = (await _mcpAuthAll())[mcpServer];
      if (token) init.headers.Authorization = /^bearer\s/i.test(token) ? token : 'Bearer ' + token;
    }
    if (body != null && init.method !== 'GET' && init.method !== 'HEAD') init.body = String(body);
    const res = await boundedNetFetch(url, init);
    const buf = Buffer.from(await res.arrayBuffer());
    const capped = buf.length > 5 * 1024 * 1024;
    const text = capped ? buf.slice(0, 5 * 1024 * 1024).toString('utf8') : buf.toString('utf8');
    const hdrs = {};
    try { res.headers.forEach((v, k) => { hdrs[k] = v; }); } catch {}
    // An image read back as UTF-8 text is ruined, so a binary caller gets
    // base64 instead (the AI panel's "ask about this image").
    if (binary) return { ok: true, status: res.status, statusText: res.statusText, headers: hdrs, base64: buf.slice(0, 5 * 1024 * 1024).toString('base64'), size: buf.length, capped, timeMs: Date.now() - t0 };
    return { ok: true, status: res.status, statusText: res.statusText, headers: hdrs, body: text, size: buf.length, capped, timeMs: Date.now() - t0 };
  } catch (err) {
    return { ok: false, error: err.message, timeMs: Date.now() - t0 };
  }
});

// Lock Vex, as main sees it. The lock screen lived only in the window, so a
// private window (Ctrl+Alt+N) opened unlocked and could read saved passwords
// (found 2026-09-29). The window says when it locks and unlocks; the vault and
// new private windows refuse while it is locked.
let _vexLocked = false;
// Windows open when Vex locked (a private window, an app window, the overlay)
// stayed usable behind the lock and could read 2FA codes (found 2026-09-29).
// They are hidden while locked and come back on unlock. The video pop-out
// stays: it shows only the video you were watching.
let _hiddenByLock = [];
function _lockVex() {
  _vexLocked = true;
  for (const w of BrowserWindow.getAllWindows()) {
    if (w === mainWindow || w.isDestroyed() || !w.isVisible() || isPipContents(w.webContents)) continue;
    w.hide();
    _hiddenByLock.push(w);
  }
  // DevTools left open would keep a console that can read and change
  // everything behind the lock.
  for (const wc of webContents.getAllWebContents()) {
    try { if (!wc.isDestroyed() && wc.isDevToolsOpened()) wc.closeDevTools(); }
    catch (err) { console.error('[Lock] could not close DevTools:', err.message); }
  }
}
// The window says when it locks. It cannot say it unlocked: only the PIN,
// checked here, opens Vex again (vex-lock:unlock, src/main/lock-pin.js).
ipcMain.on('vex-lock:state', (e, locked) => {
  if (!mainWindow || mainWindow.isDestroyed() || e.sender !== mainWindow.webContents) return;
  if (locked !== true) { console.error('[Lock] refused: the window cannot unlock Vex without the PIN'); return; }
  _lockVex();
});
const _lockGate = require('./main/lock-pin').createLockGate({ readRecord: () => _persistLoad()['vex.lockPin'] });
ipcMain.handle('vex-lock:unlock', async (e, pin) => {
  if (!mainWindow || mainWindow.isDestroyed() || e.sender !== mainWindow.webContents || e.senderFrame !== mainWindow.webContents.mainFrame) {
    throw new Error('Only the main Vex window unlocks Vex');
  }
  if (!_vexLocked) return { ok: true };
  const r = await _lockGate.tryUnlock(pin);
  if (!r.ok) return r;
  _vexLocked = false;
  for (const w of _hiddenByLock) if (!w.isDestroyed()) w.show();
  _hiddenByLock = [];
  return { ok: true };
});
const { _WEBAUTHN_DISABLE_JS, _autofillPopup, flushVault, addMissing: _vaultAddMissing } = require('./main/vault').createVaultService({ app, safeStorage, ipcMain, isLocked: () => _vexLocked });
// A copied password or one-time code, cleared after 30 s by the main process
// even when Vex no longer has the focus (main/secret-clipboard.js).
require('./main/secret-clipboard').registerSecretClipboard({ ipcMain, clipboard, app });
// Bookmarks and history from Chrome, Edge, Brave and Firefox on this PC, and
// passwords from a CSV the person exported themselves (main/browser-import.js).
require('./main/browser-import').registerBrowserImport({ ipcMain, dialog, windowFor: (e) => BrowserWindow.fromWebContents(e.sender), addToVault: _vaultAddMissing });

// === TOTP authenticator — 2FA codes (Discord/Roblox/GitHub/etc.) generated
// locally per RFC 6238. Secrets are encrypted at rest with safeStorage
// (OS keychain/DPAPI), same as the vault, and the SECRET NEVER LEAVES THE MAIN
// PROCESS: the renderer only ever receives the finished 6-digit codes
// (totp:codes), so a compromised web/renderer context can't read your seeds. ===
const TOTP_FILE = () => path.join(app.getPath('userData'), 'totp.dat');
let totpCache = null;
let totpWrites = Promise.resolve();
function totpLoad() {
  if (totpCache) return structuredClone(totpCache);
  try {
    const fsx = require('fs');
    if (!fsx.existsSync(TOTP_FILE())) return [];
    const arr = JSON.parse(safeStorage.decryptString(fsx.readFileSync(TOTP_FILE())));
    if (!Array.isArray(arr)) throw new Error('Invalid authenticator storage');
    totpCache = arr;
    return structuredClone(arr);
  } catch (err) { console.error('[TOTP] load failed:', err.message); throw err; }
}
function totpSave(arr) {
  if (!safeStorage.isEncryptionAvailable()) throw new Error('OS encryption unavailable');
  const bytes = safeStorage.encryptString(JSON.stringify(arr));
  totpCache = structuredClone(arr);
  totpWrites = totpWrites.catch(() => {}).then(() => atomicWrite(TOTP_FILE(), bytes));
  return totpWrites;
}
function _b32decode(s) {
  const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  s = String(s).replace(/=+$/, '').replace(/\s/g, '').toUpperCase();
  let bits = 0, val = 0; const out = [];
  for (const ch of s) { const i = A.indexOf(ch); if (i < 0) continue; val = (val << 5) | i; bits += 5; if (bits >= 8) { out.push((val >>> (bits - 8)) & 0xff); bits -= 8; } }
  return Buffer.from(out);
}
function _totpCode(secret, { digits = 6, period = 30, algorithm = 'sha1' } = {}, when = Date.now()) {
  if (typeof secret !== 'string' || !/^[A-Z2-7]+={0,6}$/i.test(secret.replace(/\s/g, '')) || !Number.isInteger(digits) || digits < 4 || digits > 8 || !Number.isInteger(period) || period < 5 || period > 300 || !['sha1','sha256','sha512'].includes(algorithm)) throw new Error('Invalid authenticator parameters');
  const key = _b32decode(secret);
  if (!key.length) throw new Error('Invalid secret');
  const counter = Math.floor((when / 1000) / period);
  const buf = Buffer.alloc(8);
  buf.writeUInt32BE(Math.floor(counter / 0x100000000), 0);
  buf.writeUInt32BE(counter >>> 0, 4);
  const h = require('crypto').createHmac(algorithm, key).update(buf).digest();
  const off = h[h.length - 1] & 0x0f;
  const bin = ((h[off] & 0x7f) << 24) | ((h[off + 1] & 0xff) << 16) | ((h[off + 2] & 0xff) << 8) | (h[off + 3] & 0xff);
  return String(bin % (10 ** digits)).padStart(digits, '0');
}
function _parseOtpauth(uri) {
  try {
    const u = new URL(String(uri).trim());
    if (u.protocol !== 'otpauth:') return null;
    if (u.host && u.host.toLowerCase() !== 'totp') return null; // TOTP only (not HOTP)
    const secret = (u.searchParams.get('secret') || '').replace(/\s/g, '');
    if (!secret) return null;
    let label = decodeURIComponent((u.pathname || '').replace(/^\//, ''));
    let issuer = u.searchParams.get('issuer') || '';
    if (label.includes(':')) { const p = label.split(':'); if (!issuer) issuer = p[0].trim(); label = p.slice(1).join(':').trim(); }
    const alg = (u.searchParams.get('algorithm') || 'SHA1').toLowerCase();
    return {
      label: label || issuer || 'Account', issuer,
      secret,
      algorithm: ['sha1', 'sha256', 'sha512'].includes(alg) ? alg : 'sha1',
      digits: parseInt(u.searchParams.get('digits'), 10) || 6,
      period: parseInt(u.searchParams.get('period'), 10) || 30,
    };
  } catch { return null; }
}
function _refuseWhileLocked() { if (_vexLocked) throw new Error('Vex is locked — unlock it first'); }
ipcMain.handle('totp:list', () => (_refuseWhileLocked(), totpLoad()).map(e => ({ id: e.id, label: e.label, issuer: e.issuer, digits: e.digits, period: e.period })));
ipcMain.handle('totp:codes', () => {
  _refuseWhileLocked();
  const now = Date.now();
  return totpLoad().map(e => {
    try {
      const code = _totpCode(e.secret, e, now);
      const remaining = e.period - Math.floor((now / 1000) % e.period);
      return { id: e.id, code, period: e.period, remaining };
    } catch { return { id: e.id, code: null, period: e.period, remaining: 0, error: true }; }
  });
});
ipcMain.handle('totp:add', async (_e, input) => {
  try {
    let entry;
    if (typeof input === 'string') {
      entry = _parseOtpauth(input) || { label: 'Account', issuer: '', secret: input.replace(/\s/g, ''), algorithm: 'sha1', digits: 6, period: 30 };
    } else if (input && typeof input === 'object') {
      const parsed = _parseOtpauth(input.secret || '');
      entry = parsed || {
        label: (input.label || '').trim() || 'Account',
        issuer: (input.issuer || '').trim(),
        secret: String(input.secret || '').replace(/\s/g, ''),
        algorithm: ['sha1', 'sha256', 'sha512'].includes(String(input.algorithm || '').toLowerCase()) ? String(input.algorithm).toLowerCase() : 'sha1',
        digits: parseInt(input.digits, 10) || 6,
        period: parseInt(input.period, 10) || 30,
      };
      if (parsed && (input.label || '').trim()) entry.label = String(input.label).trim(); // user override
      if (parsed && (input.issuer || '').trim()) entry.issuer = String(input.issuer).trim();
    } else return { ok: false, error: 'No input' };
    if (!entry.secret) return { ok: false, error: 'No secret found in what you pasted' };
    _totpCode(entry.secret, entry); // validate — throws on a bad key
    entry.id = require('crypto').randomUUID();
    entry.created = new Date().toISOString();
    const arr = totpLoad(); arr.push(entry); await totpSave(arr);
    return { ok: true, id: entry.id, label: entry.label, issuer: entry.issuer };
  } catch (err) { return { ok: false, error: err.message || 'Invalid key' }; }
});
ipcMain.handle('totp:delete', async (_e, id) => {
  try { await totpSave(totpLoad().filter(e => e.id !== id)); return { ok: true }; }
  catch (err) { return { ok: false, error: err.message }; }
});

// Only decisions still in force: an "Allow for a day" that has run out is as
// if never made (savedDecision), so it is not listed as allowed either.
function _decisionsInForce(decisions) {
  const { __until__, ...d } = decisions;
  const now = Date.now();
  for (const [key, end] of Object.entries(__until__ || {})) if (end < now) delete d[key];
  return d;
}
ipcMain.handle('permissions:list',     () => _decisionsInForce(loadPermissionDecisions()));
// The decisions one tab's page is held to: its own container's, a private
// window's, or persist:main's. What a container tab's page was told it may
// ask came from persist:main's list (found 2026-09-30). The page is one this
// window owns (ipc-policy.js, TARGET_CHANNELS).
ipcMain.handle('permissions:list-for-page', (_e, id) => {
  const page = webContents.fromId(id);
  if (!page || page.isDestroyed()) throw new Error('That page is gone');
  return _decisionsInForce(decisionsFor(page));
});
ipcMain.handle('permissions:revoke',   async (_e, key) => { const d = loadPermissionDecisions(); delete d[key]; await savePermissionDecisions(d); return { ok: true }; });
// The site panel (js/site-panel.js): one permission of the page in front, or
// all of its site's, set in that page's own store (main/permissions.js). The
// page is one this window owns (ipc-policy.js, TARGET_CHANNELS). A Tor tab is
// given no permission at all, so there is nothing to set there.
function _sitePanelPage(id) {
  const page = webContents.fromId(id);
  if (!page || page.isDestroyed()) throw new Error('That page is gone');
  if (page.session && page.session.__vexTor) throw new Error('A Tor tab gives sites no permissions');
  return page;
}
ipcMain.handle('permissions:set-for-page', async (_e, id, permission, decision) => {
  const page = _sitePanelPage(id);
  await setPageDecision(page, page.getURL(), permission, decision);
  return _decisionsInForce(decisionsFor(page));
});
// What the reset took out stays here, never in the interface, behind a
// one-time token for its Undo (js/vex-undo.js), until it is used or ten
// minutes pass. Only the window that reset it may put it back. A private
// window's answers were only ever in memory, and so is what is kept here.
const _resetPagePermissions = new Map();
ipcMain.handle('permissions:reset-for-page', async (e, id) => {
  const page = _sitePanelPage(id);
  const snapshot = await resetPageDecisions(page, page.getURL());
  const token = require('crypto').randomBytes(16).toString('hex');
  _resetPagePermissions.set(token, { snapshot, sender: e.sender.id });
  setTimeout(() => _resetPagePermissions.delete(token), 10 * 60 * 1000).unref?.();
  return { decisions: _decisionsInForce(decisionsFor(page)), undo: token };
});
ipcMain.handle('permissions:reset-for-page-undo', async (e, token) => {
  const kept = _resetPagePermissions.get(token);
  if (!kept || kept.sender !== e.sender.id) return { ok: false, error: 'There is nothing to put back any more' };
  _resetPagePermissions.delete(token);
  await restorePageDecisions(kept.snapshot);
  return { ok: true };
});
// Clear all answers with a token for its Undo (js/vex-undo.js): what was
// cleared stays here, never in the interface, until the next clear or an hour.
const _clearedPermissions = new Map();
ipcMain.handle('permissions:clear-all', async () => {
  const before = await clearAllDecisions();
  _clearedPermissions.clear();
  const token = require('crypto').randomBytes(16).toString('hex');
  _clearedPermissions.set(token, before);
  setTimeout(() => _clearedPermissions.delete(token), 60 * 60 * 1000).unref?.();
  return { ok: true, undo: token };
});
ipcMain.handle('permissions:clear-undo', async (_e, token) => {
  const before = _clearedPermissions.get(token);
  if (!before) return { ok: false, error: 'There is nothing to put back any more' };
  _clearedPermissions.delete(token);
  await restoreDecisions(before);
  return { ok: true };
});

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
  const pending = pendingHidSelections.get(payload.id);
  if (!pending) return true;
  const win = pending.host?.win;
  if (!win || win.isDestroyed()) return false;
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
    const contents = details.frame && webContents.fromFrame(details.frame);
    const host = secureSessions.owner(contents);
    if (!host || host.privatePartition) { callback(''); return; }
    const origin = _hidOriginFromFrame(details.frame);
    const devices = (details.deviceList || []).map(d => ({
      deviceId: d.deviceId,
      name: d.name || '',
      vendorId: d.vendorId,
      productId: d.productId
    }));
    const id = `hid_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    console.log(`[WebHID] (${tag}) ${origin} requests a device — ${devices.length} offered`);
    pendingHidSelections.set(id, { callback, origin, devices, host, frame: details.frame, url: details.frame.url });
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
  if (pending.host !== secureSessions.owner(_e.sender)) return { ok: false, error: 'Request belongs to another window' };
  try { if (pending.frame.detached || pending.frame.url !== pending.url) { pendingHidSelections.delete(id); pending.callback(''); return { ok: false, error: 'Requesting page changed' }; } } catch { pendingHidSelections.delete(id); return { ok: false }; }
  if (deviceId && !pending.devices.some(device => device.deviceId === deviceId)) return { ok: false, error: 'Unknown device' };
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

// Lighter Discord (src/main/discord-lite.js): set by the renderer's switch.
const { isHeavyDiscordMedia, stillVersionOf } = require('./main/discord-lite');
let _discordLite = false;
ipcMain.handle('discord:lite', (_e, on) => { _discordLite = !!on; return _discordLite; });

function wireAdblockerOnSession(ses, tag) {
  if (!ses || ses.__vexAdblockWired) return;
  ses.__vexAdblockWired = true;
  ses.webRequest.onBeforeRequest((details, callback) => {
    // Lighter Discord: the animated decoration is fetched as the still one
    // rather than not at all, so nothing can end up missing (discord-lite.js).
    if (_discordLite && tag === 'persist:discord' && isHeavyDiscordMedia(details.url)) {
      const still = stillVersionOf(details.url);
      callback(still ? { redirectURL: still } : { cancel: true });
      return;
    }
    // Engine verdict (EasyList) ORed with the legacy domain list so we never
    // regress an existing block while the richer engine adds coverage. When the
    // engine isn't ready yet engineBlocks() returns null and the legacy list
    // carries on alone.
    // A site whose third-party content is switched off (js/site-rules.js).
    if (Object.keys(_siteRules).length && SiteRules.blocksThirdParty(_siteRules, _pageUrlOf(details.webContentsId), details.url)) {
      callback({ cancel: true });
      return;
    }
    if (adBlockerEnabled && (engineBlocks(details) === true || shouldBlock(details.url))
        && !repairAllows(details.url, _pageUrlOf(details.webContentsId))
        && !_adsAllowedOn(_pageUrlOf(details.webContentsId), ses)) {
      _recordTracker(details.url, details.webContentsId);
      callback({ cancel: true });
    } else {
      const upgraded = _httpsUpgradeURL(details);
      if (upgraded) callback({ redirectURL: upgraded });
      else callback({ cancel: false });
    }
  });
}

// Keep request Client Hints (Sec-CH-UA*) consistent with the spoofed Chrome UA.
// setUserAgent fixes the UA string, but Chromium still derives the Sec-CH-UA
// brand list from its real build — leaking "Electron"/app branding to sites that
// sniff Client Hints (which modern sites prefer over the UA string). We rewrite
// the brand hints to a plain Chrome desktop identity whenever the request
// carries them. onBeforeSendHeaders is a distinct webRequest event (no clash with
// onBeforeRequest / onHeadersReceived) and nothing else in Vex registers it.
// The Chrome version is derived from the real Chromium build (not hardcoded):
// a pinned version goes stale — a spoofed "Chrome 124" in 2026 reads as a
// 2-year-old browser, and sites like Crunchyroll refuse playback on outdated
// versions while navigator.userAgentData (unspoofable from the session layer)
// contradicts it with the real major. Deriving keeps UA, Sec-CH-UA, and
// userAgentData version-consistent across Electron upgrades.
const CHROME_FULL_VERSION = process.versions.chrome || '148.0.0.0';
const CHROME_MAJOR = CHROME_FULL_VERSION.split('.')[0];
// Real Chrome sends a reduced UA (major.0.0.0) — mirror that exactly.
const CHROME_UA = `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${CHROME_MAJOR}.0.0.0 Safari/537.36`;
const CH_UA = `"Chromium";v="${CHROME_MAJOR}", "Google Chrome";v="${CHROME_MAJOR}", "Not-A.Brand";v="99"`;
const CH_UA_FULL = `"Chromium";v="${CHROME_FULL_VERSION}", "Google Chrome";v="${CHROME_FULL_VERSION}", "Not-A.Brand";v="99.0.0.0"`;
// Add Access-Control-Allow-Origin to MEDIA responses so cross-origin <video>/
// <audio> can be routed through Web Audio for the Master Volume boost (>100%).
// Without CORS, tapping a cross-origin media element silences it, so boost falls
// back to 100%. Scoped to media resource loads only; harmless for non-CORS
// requests (the browser ignores ACAO when the request had no Origin).
function _addMediaCorsHeaders(details, responseHeaders) {
  try {
    if (!responseHeaders || details.resourceType !== 'media') return;
    const has = Object.keys(responseHeaders).some(k => k.toLowerCase() === 'access-control-allow-origin');
    if (!has) responseHeaders['Access-Control-Allow-Origin'] = ['*'];
  } catch {}
}

function wireClientHintsOnSession(ses) {
  if (!ses || ses.__vexCHWired) return;
  ses.__vexCHWired = true;
  ses.webRequest.onBeforeSendHeaders((details, callback) => {
    const h = details.requestHeaders || {};
    // A site whose cookies are switched off is sent none.
    if (Object.keys(_siteRules).length && SiteRules.blocksCookies(_siteRules, details.url)) {
      for (const k of Object.keys(h)) if (k.toLowerCase() === 'cookie') delete h[k];
    }
    // Per-session override (set for ephemeral "New Identity" sessions) keeps the
    // brand hints consistent with that session's spoofed Chrome version; falls
    // back to the global real-Chromium-version identity for every normal session.
    const ch = ses.__vexCH || null;
    for (const k of Object.keys(h)) {
      switch (k.toLowerCase()) {
        case 'sec-ch-ua': h[k] = (ch && ch.ua) || CH_UA; break;
        case 'sec-ch-ua-full-version-list': h[k] = (ch && ch.full) || CH_UA_FULL; break;
        case 'sec-ch-ua-full-version': h[k] = (ch && ch.fullVer) || `"${CHROME_FULL_VERSION}"`; break;
        case 'sec-ch-ua-mobile': h[k] = '?0'; break;
        case 'sec-ch-ua-platform': h[k] = '"Windows"'; break;
      }
    }
    callback({ requestHeaders: h });
  });
}

// === Spellcheck — enable + pin dictionary languages per session ===
// Electron's spellchecker follows the OS locale by default; when that locale
// has no Chromium Hunspell dictionary (e.g. Turkish), the checker silently
// stays OFF for every page — no red squiggles, context-menu params carry
// spellcheckEnabled:false, and no suggestions ever populate (observed live
// 2026-08-25; userData/Dictionaries had never been created). Pin the language
// list to the intersection of what the user plausibly types (app locale +
// en-US) and what Hunspell actually offers, so the dictionary download kicks
// in and misspelledWord/dictionarySuggestions reach the context menu.
// Chromium looks for the Hunspell .bdic on disk (userData/Dictionaries)
// before downloading it through the SESSION's network stack. Sessions routed
// through the ByeDPI/DPI-bypass proxy (persist:discord) fail that in-session
// download silently, leaving spellcheck dead exactly where the user types
// most. Fetch the en-US dictionary once from the MAIN process (net.fetch —
// system network, no session proxy) into the folder Chromium reads; the
// en-US-10-1 name/version has been stable in Chromium for a decade.
const SPELL_DICT_FILE = 'en-US-10-1.bdic';
const SPELL_DICT_URL = 'https://redirector.gvt1.com/edgedl/chrome/dict/en-us-10-1.bdic';
let _spellDictReady = null;
function ensureSpellDictionary() {
  if (_spellDictReady) return _spellDictReady;
  _spellDictReady = (async () => {
    const dir = path.join(userDataPath, 'Dictionaries');
    const file = path.join(dir, SPELL_DICT_FILE);
    try {
      if (fs.existsSync(file) && fs.statSync(file).size > 0) return;
      fs.mkdirSync(dir, { recursive: true });
      const res = await boundedNetFetch(SPELL_DICT_URL);
      if (!res.ok) { console.warn('[Spellcheck] dictionary fetch HTTP', res.status); return; }
      const buf = Buffer.from(await res.arrayBuffer());
      fs.writeFileSync(file, buf);
      console.log('[Spellcheck] en-US dictionary installed,', buf.length, 'bytes');
    } catch (err) {
      console.warn('[Spellcheck] dictionary fetch failed:', err.message);
    }
  })();
  return _spellDictReady;
}

function wireSpellcheckOnSession(ses) {
  if (!ses || ses.__vexSpellWired) return;
  ses.__vexSpellWired = true;
  try {
    const avail = ses.availableSpellCheckerLanguages || [];
    const want = [];
    try {
      const l = app.getLocale();
      if (l) { want.push(l, l.split('-')[0]); }
    } catch {}
    want.push('en-US', 'en');
    const langs = [...new Set(want)].filter(l => avail.includes(l));
    // A blocked/unreachable dictionary CDN is otherwise invisible — the
    // checker just never turns on. Surface it in the log.
    ses.on('spellcheck-dictionary-download-failure', (_e, lang) => {
      console.warn('[Spellcheck] dictionary download failed:', lang);
    });
    // Enable AFTER the on-disk dictionary is ensured, so the spellcheck
    // service initializes against a present file instead of kicking off an
    // in-session download that may go through a broken proxy.
    ensureSpellDictionary().finally(() => {
      try {
        ses.setSpellCheckerEnabled(true);
        if (langs.length) ses.setSpellCheckerLanguages(langs);
      } catch (err) {
        console.warn('[Spellcheck] enable failed:', err.message);
      }
    });
  } catch (err) {
    console.warn('[Spellcheck] wiring failed:', err.message);
  }
}

// === Media grabber — sniff downloadable media per tab ===
// onCompleted (unused elsewhere) records media responses keyed by the guest's
// webContents id, so the renderer can list what's grabbable on the current page.
// We keep playlists (.m3u8/.mpd) but skip their individual .ts/.m4s segments
// (noise). Cleared on main-frame navigation / tab destroy (see web-contents-created).
const _mediaByWc = new Map(); // webContentsId -> Map(url -> {url,kind,mime,sizeKB})
function _hdrVal(headers, name) {
  if (!headers) return '';
  const k = Object.keys(headers).find(h => h.toLowerCase() === name);
  if (!k) return '';
  const v = headers[k];
  return Array.isArray(v) ? (v[0] || '') : (v || '');
}
function _mediaKind(url, ct) {
  const u = url.toLowerCase();
  if (/\.m3u8(\?|$)/.test(u) || /mpegurl/i.test(ct)) return 'hls';
  if (/\.mpd(\?|$)/.test(u) || /dash\+xml/i.test(ct)) return 'dash';
  if (/\.(mp3|m4a|aac|ogg|oga|wav|flac|opus)(\?|$)/.test(u) || /^audio\//i.test(ct)) return 'audio';
  return 'video';
}
function wireMediaSnifferOnSession(ses) {
  if (!ses || ses.__vexMediaWired) return;
  ses.__vexMediaWired = true;
  ses.webRequest.onCompleted({ urls: ['http://*/*', 'https://*/*'] }, (details) => {
    try {
      const { webContentsId, url, resourceType, responseHeaders, statusCode } = details;
      if (!webContentsId || !url || (statusCode && statusCode >= 400)) return;
      if (!/^https?:/i.test(url)) return;
      if (/\.(ts|m4s)(\?|$)/i.test(url)) return; // segment noise; keep the playlist
      const ct = (_hdrVal(responseHeaders, 'content-type') || '').split(';')[0].trim();
      const isMedia = resourceType === 'media'
        || /\.(mp4|m4v|webm|ogv|mov|mkv|m3u8|mpd|mp3|m4a|aac|ogg|oga|wav|flac|opus)(\?|$)/i.test(url)
        || /^(video|audio)\//i.test(ct) || /mpegurl|dash\+xml/i.test(ct);
      if (!isMedia) return;
      let map = _mediaByWc.get(webContentsId);
      if (!map) { map = new Map(); _mediaByWc.set(webContentsId, map); }
      // A video arrives in pieces (206 Partial Content): content-length is the
      // size of one piece, and the first one was shown as the file's size —
      // 34 KB for a 788 KB video (found 2026-09-29). The whole size is the
      // figure after the slash in content-range.
      const range = /\/(\d+)\s*$/.exec(_hdrVal(responseHeaders, 'content-range') || '');
      const len = range ? parseInt(range[1], 10) : parseInt(_hdrVal(responseHeaders, 'content-length'), 10);
      const sizeKB = Number.isFinite(len) ? Math.round(len / 1024) : 0;
      const known = map.get(url);
      if (!known) {
        map.set(url, { url, kind: _mediaKind(url, ct), mime: ct, sizeKB });
        if (map.size > 80) map.delete(map.keys().next().value); // cap, drop oldest
      } else if (sizeKB > known.sizeKB) {
        known.sizeKB = sizeKB;
      }
    } catch { /* sniffing is best-effort */ }
  });
}

// Keep a page as a PDF, or as one file that opens offline (src/main/page-save.js).
const _pageSave = require('./main/page-save').createPageSave({
  webContents, dialog, app, getWindow: () => mainWindow,
});
ipcMain.handle('page:save', async (_e, wcId, format, title) => {
  try { return await _pageSave.save(wcId, format, title); }
  catch (err) { return { ok: false, error: (err && err.message) || 'Could not save the page' }; }
});

// Which links on a page are broken (src/main/link-check.js). Asked from a
// separate in-memory session: no cookies, no logins — forty sites contacted
// must not learn who is asking.
const _linkCheckMod = require('./main/link-check');
const _linkCheck = _linkCheckMod.createLinkCheck({
  fetchIn: _linkCheckMod.netRequestFetch(net, () => secureSessions.fromPartition('vex-linkcheck')),
});
ipcMain.handle('links:check', async (_e, urls) => {
  try { return { ok: true, ...(await _linkCheck.check(urls)) }; }
  catch (err) { return { ok: false, error: (err && err.message) || 'Could not check the links' }; }
});

// A read-only inbox over IMAP (src/main/mail.js). Accounts — addresses and
// app passwords — live in one file encrypted by Windows.
// imapflow and mailparser bring ~190 modules (pino, html-to-text, iconv-lite…)
// that most launches never use, so they load on the first connection instead
// of at every start.
let _mailLibs = null;
const _mailLib = () => _mailLibs || (_mailLibs = { ImapFlow: require('imapflow').ImapFlow, simpleParser: require('mailparser').simpleParser });
const _mail = require('./main/mail').createMail({
  ImapFlow: function ImapFlow(options) { return new (_mailLib().ImapFlow)(options); },
  simpleParser: (...a) => _mailLib().simpleParser(...a),
  // secretStore is declared further down this file; reach it when used.
  secrets: { read: (...a) => secretStore.read(...a), write: (...a) => secretStore.write(...a) },
  file: path.join(userDataPath, 'mail-accounts.enc'),
  randomId: () => require('crypto').randomBytes(8).toString('hex'),
  // Through the route for all of Vex when one is on (_mailProxy).
  proxy: () => _mailProxy(),
});
const _mailCall = (fn) => async (...args) => { try { return { ok: true, value: await fn(...args) }; } catch (err) { return { ok: false, error: (err && err.message) || 'Mail failed' }; } };
ipcMain.handle('mail:accounts', _mailCall(() => _mail.accounts()));
ipcMain.handle('mail:add', _mailCall((_e, account) => _mail.add(account)));
ipcMain.handle('mail:remove', _mailCall((_e, id) => _mail.remove(id)));
ipcMain.handle('mail:inbox', _mailCall((_e, id, limit, before) => _mail.inbox(id, limit, before)));
ipcMain.handle('mail:message', _mailCall((_e, id, uid) => _mail.message(id, uid)));

// One page for the site crawler (src/main/page-fetch.js): the same empty
// session as the link checker, HTML only, size- and time-limited.
const _pageFetch = require('./main/page-fetch').createPageFetch({ net, getSession: () => secureSessions.fromPartition('vex-linkcheck') });
ipcMain.handle('crawl:fetch', async (_e, url, accept) => {
  try { return { ok: true, ...(await _pageFetch.fetchPage(url, { accept })) }; }
  catch (err) { return { ok: false, error: (err && err.message) || 'Could not fetch the page' }; }
});

// Screen recordings, appended to a temporary file chunk by chunk so a long
// recording never sits in memory (src/main/recordings.js).
const _recordings = require('./main/recordings').createRecordings({
  fs, path, dialog, app, getWindow: () => mainWindow,
  dir: path.join(app.getPath('userData'), 'recordings-in-progress'),
  randomId: () => require('crypto').randomBytes(8).toString('hex'),
});
_recordings.cleanLeftovers();
// Vex's own window as a capture source, so "Record this tab" needs no
// picker (renderer: js/area-recorder.js crops it to the tab or an area).
ipcMain.handle('rec:own-window', (e) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  if (!win) throw new Error('No window to record');
  return win.getMediaSourceId();
});
ipcMain.handle('rec:start', (_e, ext) => { try { return { ok: true, ..._recordings.start(ext) }; } catch (err) { return { ok: false, error: err.message }; } });
ipcMain.handle('rec:chunk', async (_e, id, bytes) => { try { return { ok: true, ...(await _recordings.chunk(id, bytes)) }; } catch (err) { return { ok: false, error: err.message }; } });
ipcMain.handle('rec:finish', async (_e, id, name) => { try { return await _recordings.finish(id, name); } catch (err) { return { ok: false, error: err.message }; } });
ipcMain.handle('rec:cancel', async (_e, id) => { try { return await _recordings.cancel(id); } catch (err) { return { ok: false, error: err.message }; } });

// The whole page in one image, not one screenful (src/main/full-page-capture.js).
const _fullPage = require('./main/full-page-capture').createFullPageCapture({ webContents });
ipcMain.handle('page:capture-full', async (_e, wcId) => {
  try { return { ok: true, ...(await _fullPage.capture(wcId)) }; }
  catch (err) { return { ok: false, error: (err && err.message) || 'Could not capture the page' }; }
});

// Run one script in every frame of a tab. webview.executeJavaScript runs in the
// top frame only, so Master Volume, the per-site volume and Night mode never
// reached a player embedded in an iframe (found 2026-09-29). Each frame answers
// for itself; one that does not answer within 6 s is reported, not waited on.
ipcMain.handle('page:eval-all-frames', async (_e, wcId, code, userGesture) => {
  const wc = webContents.fromId(wcId);
  if (!wc || wc.isDestroyed()) return { ok: false, error: 'That tab has closed' };
  const frames = wc.mainFrame ? wc.mainFrame.framesInSubtree : [];
  const results = await Promise.all(frames.map(f => new Promise(resolve => {
    const timer = setTimeout(() => resolve({ ok: false, error: 'The frame did not answer within 6 s' }), 6000);
    Promise.resolve().then(() => f.executeJavaScript(code, !!userGesture)).then(
      value => { clearTimeout(timer); resolve({ ok: true, value }); },
      err => { clearTimeout(timer); resolve({ ok: false, error: String((err && err.message) || err) }); });
  })));
  return { ok: true, results };
});

ipcMain.handle('media:list', (_e, wcId) => {
  const map = _mediaByWc.get(wcId);
  return map ? Array.from(map.values()) : [];
});
ipcMain.handle('media:download', (_e, wcId, url) => {
  try {
    const wc = webContents.fromId(wcId);
    if (wc && !wc.isDestroyed() && url) { wc.downloadURL(url); return { ok: true }; }
  } catch (err) { return { ok: false, error: err.message }; }
  return { ok: false, error: 'tab not found' };
});

// Chrome-style collision handling: setting an explicit save path bypasses
// Electron's automatic "file (1).ext" dedup, so a second download of the same
// name would silently OVERWRITE the first on disk. Find a free name instead.
// Sorting rules for downloads (src/main/download-rules.js). Kept in the
// profile so a download that starts before the window is ready still lands in
// the right folder.
const _rulesFile = path.join(userDataPath, 'download-rules.json');
let _downloadRules = [];
try { _downloadRules = JSON.parse(fs.readFileSync(_rulesFile, 'utf8')); } catch { _downloadRules = []; }
if (!Array.isArray(_downloadRules)) _downloadRules = [];
ipcMain.handle('downloads:set-rules', (_e, rules) => {
  _downloadRules = Array.isArray(rules) ? rules.slice(0, 50) : [];
  try { fs.writeFileSync(_rulesFile, JSON.stringify(_downloadRules)); return { ok: true }; }
  catch (err) { return { ok: false, error: err.message }; }
});
// Per-site switches (src/main/site-rules.js): JavaScript, cookies and
// third-party content, off for one site at a time. Kept in the profile so a
// page that loads before the window is ready is already covered.
const SiteRules = require('./main/site-rules');
const _siteRulesFile = path.join(userDataPath, 'site-rules.json');
let _siteRules = {};
try { _siteRules = SiteRules.clean(JSON.parse(fs.readFileSync(_siteRulesFile, 'utf8'))); } catch { _siteRules = {}; }
ipcMain.handle('siterules:set', (_e, rules) => {
  const before = _siteRules;
  _siteRules = SiteRules.clean(rules);
  try { fs.writeFileSync(_siteRulesFile, JSON.stringify(_siteRules)); }
  catch (err) { return { ok: false, error: err.message }; }
  // Every window hears of the change at once. A private window keeps a copy
  // of these and used to re-read it every three seconds, so a site switched
  // off here still ran its JavaScript there for up to that long (found
  // 2026-09-29).
  _broadcastDownloadEvent('siterules:changed', _siteRules);
  _dropServiceWorkersOfScriptsOff(before, _siteRules);
  return { ok: true, rules: _siteRules };
});
ipcMain.handle('siterules:get', () => ({ ok: true, rules: _siteRules }));
// The site panel's "Block ads and trackers on this site" switch (the 'ads'
// rule, js/site-panel.js): the blocker leaves that site's pages alone, network
// and element hiding both. Never in a Tor tab, which blocks whatever a switch
// made in a normal window says.
function _adsAllowedOn(pageUrl, ses) {
  if (ses && ses.__vexTor) return false;
  return Object.keys(_siteRules).length > 0 && SiteRules.allowsAds(_siteRules, pageUrl);
}
// The certificates each session's connections were secured with, by host, as
// Chromium checked them: a certificate check passes through here, is noted,
// and Chromium's own verdict stands (-3). The site panel shows the one its
// page's session saw — never by connecting again, which would go round a Tor
// or proxy route. (The DevTools protocol only has a certificate for a page
// loaded while it was already listening.)
const _seenCerts = new WeakMap();   // session -> Map(host -> what its check saw)
function _watchCertificates(ses) {
  if (!ses || ses.__vexCertWatch) return;
  ses.__vexCertWatch = true;
  ses.setCertificateVerifyProc((request, callback) => {
    try {
      let byHost = _seenCerts.get(ses);
      if (!byHost) _seenCerts.set(ses, byHost = new Map());
      byHost.delete(request.hostname);
      byHost.set(request.hostname, { certificate: request.certificate, verificationResult: request.verificationResult, at: Date.now() });
      if (byHost.size > 400) byHost.delete(byHost.keys().next().value);
    } catch (err) { console.warn('[Certificates] could not note the certificate of', request && request.hostname, err.message); }
    callback(-3);
  });
}
app.on('session-created', _watchCertificates);
ipcMain.handle('site:certificate', async (_e, id) => {
  const page = webContents.fromId(id);
  if (!page || page.isDestroyed()) throw new Error('That page is gone');
  let u;
  try { u = new URL(page.getURL()); } catch { throw new Error('That page has no address'); }
  if (u.protocol !== 'https:') return { ok: true, secure: false };
  const seen = _seenCerts.get(page.session);
  const hit = seen && seen.get(u.hostname);
  if (!hit || !hit.certificate) throw new Error('Vex has not seen this site’s certificate since it started — reload the page to read it');
  const cert = hit.certificate;
  let organization = '', issuerOrg = '', altNames = [], fingerprint256 = String(cert.fingerprint || '');
  try {
    const x = new (require('crypto').X509Certificate)(cert.data);
    const field = (dn, key) => { const m = new RegExp('(?:^|\\n)' + key + '=([^\\n]*)').exec(dn || ''); return m ? m[1] : ''; };
    organization = field(x.subject, 'O');
    issuerOrg = field(x.issuer, 'O');
    altNames = String(x.subjectAltName || '').split(/,\s*/).filter(Boolean).slice(0, 12);
    fingerprint256 = x.fingerprint256;
  } catch (err) { console.warn('[Certificates] could not read the details of', u.hostname, err.message); }
  return {
    ok: true, secure: hit.verificationResult === 'net::OK',
    subject: cert.subjectName, organization,
    issuer: issuerOrg || cert.issuerName, issuerName: cert.issuerName,
    validFrom: cert.validStart * 1000, validTo: cert.validExpiry * 1000,
    fingerprint256,
    altNames,
    networkError: hit.verificationResult === 'net::OK' ? '' : hit.verificationResult,
    selfSigned: !!cert.subjectName && cert.subjectName === cert.issuerName,
  };
});


// JavaScript switched off for a site is enforced on the page's own response
// (a Content-Security-Policy of script-src 'none', below). A page answered by
// the site's service worker never passes through that response, so the
// worker the site registered while it still had JavaScript is taken away when
// the switch goes off; with scripts refused the site cannot register another
// (found 2026-09-29). Only the host itself and its www. name are cleared: a
// worker belongs to one exact origin.
function _dropServiceWorkersOfScriptsOff(before, after) {
  const hosts = Object.keys(after).filter(h => after[h].js === 'off' && !(before[h] && before[h].js === 'off'));
  if (!hosts.length) return;
  const sessions = [session.defaultSession, ...BROWSING_SESSIONS.map(p => secureSessions.fromPartition(p))];
  for (const h of hosts) {
    for (const origin of [`https://${h}`, `https://www.${h}`, `http://${h}`, `http://www.${h}`]) {
      for (const ses of sessions) {
        ses.clearStorageData({ origin, storages: ['serviceworkers'] })
          .catch(err => console.error('[SiteRules] could not remove the service worker of', origin, err && err.message));
      }
    }
  }
}

// The page of a site whose JavaScript is off is answered with a policy that
// runs no script at all — its own, inline ones, event attributes, workers.
// The switch used to be read only when a tab was built, so a site you browsed
// to inside a tab already open ran its scripts regardless (found 2026-09-29).
// A frame inside such a page is held to it too: a policy does not reach into
// a frame from another host by itself.
function _scriptsOffCsp(details, responseHeaders) {
  if (!Object.keys(_siteRules).length) return;
  if (details.resourceType !== 'mainFrame' && details.resourceType !== 'subFrame') return;
  let off = SiteRules.blocksScripts(_siteRules, details.url);
  if (!off && details.resourceType === 'subFrame') {
    let top;
    try { top = (details.frame && details.frame.top && details.frame.top.url) || ''; } catch { top = ''; }
    off = !!top && SiteRules.blocksScripts(_siteRules, top);
  }
  if (!off) return;
  const key = Object.keys(responseHeaders).find(k => k.toLowerCase() === 'content-security-policy');
  // A second policy is enforced alongside the site's own, never instead of it.
  if (key) responseHeaders[key] = [].concat(responseHeaders[key], "script-src 'none'");
  else responseHeaders['Content-Security-Policy'] = ["script-src 'none'"];
}

// Which page made a request: asked of the webContents, and remembered for a
// moment, because this is on the path of every request a page makes.
const _pageUrlCache = new Map();
function _pageUrlOf(webContentsId) {
  if (!webContentsId) return '';
  const now = Date.now();
  const hit = _pageUrlCache.get(webContentsId);
  if (hit && now - hit.at < 2000) return hit.url;
  let url;
  try { url = webContents.fromId(webContentsId)?.getURL() || ''; } catch { url = ''; }
  _pageUrlCache.set(webContentsId, { url, at: now });
  if (_pageUrlCache.size > 200) _pageUrlCache.delete(_pageUrlCache.keys().next().value);
  return url;
}

const _downloadService = require('./main/downloads').createDownloadService({ app, secureSessions, broadcast: _broadcastDownloadEvent, ipcMain, rules: () => _downloadRules, webContents,
  // Read lazily, the first time a download finishes or is opened.
  knownBefore: () => {
    const list = JSON.parse(_persistLoad()['vex.downloads'] || '[]');
    return Array.isArray(list) ? list.filter(d => d && d.state === 'completed').map(d => d.path) : [];
  } });
const { wireDownloadsOnSession } = _downloadService;

// === Phase 18: Chrome extension loader ===
const extensionsDir = path.join(userDataPath, 'extensions');
if (!fs.existsSync(extensionsDir)) fs.mkdirSync(extensionsDir, { recursive: true });

// Chrome extensions load into these sessions. Every PERSISTENT partition Vex
// can put a page in is listed: regular tabs (persist:main), the sidebar panels,
// and the container tabs — an extension the user installed should apply
// everywhere they browse, not only in normal tabs. persist:discord matters
// separately so the Vencord browser extension applies inside the Discord panel.
// Partitions created later (a new container, a panel repointed at runtime) are
// picked up by _coverNewSession. In-memory sessions — Off-the-Record tabs, Tor,
// burner identities — are deliberately absent: Electron refuses to load an
// extension into a temporary session.
const EXT_PARTITIONS = [
  'persist:main', 'persist:discord', 'persist:whatsapp', 'persist:claude',
  'persist:spotify', 'persist:netflix', 'persist:roblox',
  'persist:container-work', 'persist:container-personal', 'persist:container-shopping'
];
const extHelpers = require('./main/extensions');

// folder -> why its last load attempt failed, surfaced by extensions:list so a
// broken extension explains itself in the manager instead of looking installed.
const _extLoadErrors = new Map();
// Sessions covered on demand by _coverNewSession (beyond EXT_PARTITIONS).
const _extraExtSessions = new Set();
let _extStateError = null;

// A corrupt enabled/disabled file must not silently re-enable everything the
// user turned off, so the reason is logged AND reported to the manager.
function _readDisabledFolders() {
  try {
    const disabled = extHelpers.readDisabled(extensionsDir);
    _extStateError = null;
    return disabled;
  } catch (err) {
    _extStateError = `Enabled/disabled state is unreadable (${err.message}) — every extension is being treated as enabled.`;
    console.error('[Extensions]', _extStateError);
    return new Set();
  }
}

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
  // Safe mode exists for exactly this: an extension that breaks the browser
  // cannot be removed from inside a browser that will not start.
  if (_boot.safeMode) return [];
  return _installedEntries();
}

// Every extension folder but one being uninstalled (its Undo still on
// screen): that one loads nowhere, and installing the same extension again
// meanwhile makes a fresh copy rather than updating the one about to go.
function _installedEntries() {
  const removing = _readRemovingFolders();
  return _extEntriesOnDisk().filter(e => !removing[e.folder]);
}

// Every extension folder, safe mode or not. The manager lists these so that,
// in safe mode, the one that broke the start can be switched off or removed:
// it used to say "No extensions installed" there (found 2026-09-29).
function _extEntriesOnDisk() {
  if (!fs.existsSync(extensionsDir)) return [];
  return fs.readdirSync(extensionsDir, { withFileTypes: true })
    .filter(e => e.isDirectory())
    .map(e => {
      const extPath = path.join(extensionsDir, e.name);
      const manifestPath = path.join(extPath, 'manifest.json');
      if (!fs.existsSync(manifestPath)) return null;
      let manifest;
      try {
        manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
      } catch (err) {
        // Keep it listed WITH the reason. Dropping it here used to make a
        // corrupt extension vanish from the manager, leaving the user no way
        // to uninstall the folder that was still failing on every boot.
        return { folder: e.name, path: extPath, manifest: null, messages: Object.create(null),
          error: `manifest.json is not valid JSON: ${err.message}` };
      }
      // A broken _locales catalogue must not hide the extension either: record
      // the reason and fall back to the raw manifest strings.
      let messages = Object.create(null), localeError = null;
      try { messages = extHelpers.readMessages(extPath, manifest.default_locale); }
      catch (err) { localeError = `_locales unreadable: ${err.message}`; }
      return { folder: e.name, path: extPath, manifest, messages, error: localeError };
    })
    .filter(Boolean);
}

// Diagnostic log for the local-Vencord install flow — appended to
// <userData>/vencord-install.log so a failure on a user's machine is
// inspectable instead of a silent "nothing happened".
function _vlog(msg) {
  try { fs.appendFileSync(path.join(userDataPath, 'vencord-install.log'), `[${new Date().toISOString()}] ${msg}\n`); } catch {}
}

// Keep only the NEWEST vencord-* extension folder; remove the rest. Two Vencord
// builds loaded at once conflict — whichever registers window.Vencord first wins,
// and that's usually the OLDER one, so a freshly-installed build appears to do
// nothing (exactly the "still the old plugin" report). Called at startup BEFORE
// loadExtension (files aren't locked yet, so a delete that failed mid-session
// succeeds here) and right after an install. Best-effort.
// Keeping exactly one loadable Vencord build — see ./main/vencord-folders.js
// for the ordering rule and why a manifest-less folder must go first.
function _dedupeVencordFolders() {
  return require('./main/vencord-folders').dedupeVencordFolders({
    fs, path, dir: extensionsDir, log: _vlog,
  });
}

// Loads an extension into every session it must apply to. Returns the loaded
// Extension AND every per-session failure, so callers can report the real
// reason instead of a generic "it didn't load".
// Which partition a Session object is — sessions are one per partition string.
function _partitionNameOf(ses) {
  if (ses === session.defaultSession) return 'default';
  for (const p of EXT_PARTITIONS) if (secureSessions.fromPartition(p) === ses) return p;
  return null;
}

function _readScopes() {
  try { return extHelpers.readScopes(extensionsDir); }
  catch (err) { console.error('[Extensions] scope file unreadable, using defaults:', err.message); return {}; }
}

// Which folders came from the Chrome Web Store (extensions.js readSources).
// Unreadable, the extensions still list; only "Update from Web Store" is gone.
function _readSources() {
  try { return extHelpers.readSources(extensionsDir); }
  catch (err) { console.error('[Extensions] sources file unreadable:', err.message); return {}; }
}

// Access to file:// pages, per extension (extensions.js readFileAccess): off
// unless the person allowed it on the extension's card, as in Chrome (security
// scan M6: every extension used to get it). Unreadable, no extension gets it
// (the safe side) and the manager says why.
let _fileAccessError = null;
function _fileAccessState() {
  try {
    const s = extHelpers.readFileAccess(extensionsDir);
    _fileAccessError = null;
    return s || { allow: {}, kept: {} };
  } catch (err) {
    _fileAccessError = `File-access settings are unreadable (${err.message}) — no extension can open file:// pages until this is fixed.`;
    console.error('[Extensions]', _fileAccessError);
    return { allow: {}, kept: {} };
  }
}
function _extLoadOptions(extPath) {
  return { allowFileAccess: !!_fileAccessState().allow[path.basename(extPath)] };
}
// The first start with this setting: existing installs lose file access,
// except one whose manifest names file:// pages (extensions.js migrateFileAccess).
function _migrateFileAccess() {
  try {
    if (extHelpers.readFileAccess(extensionsDir) !== null) return;
    const state = extHelpers.migrateFileAccess(_extEntriesOnDisk());
    extHelpers.writeFileAccess(extensionsDir, state);
    console.log(`[Extensions] file access is now per extension; kept for: ${Object.keys(state.kept).join(', ') || 'none'}`);
  } catch (err) {
    _fileAccessError = `Could not set up the file-access settings: ${err.message}`;
    console.error('[Extensions]', _fileAccessError);
  }
}

// The sessions one extension belongs in (src/main/extensions.js partitionsFor):
// the default session and the browsing partitions always; an app panel's
// partition only when the extension names that site, or its scope is
// 'everywhere'.
function _sessionsFor(extPath, manifest) {
  let m = manifest;
  if (!m) { try { m = JSON.parse(fs.readFileSync(path.join(extPath, 'manifest.json'), 'utf-8')); } catch { m = null; } }
  const { partitions } = extHelpers.partitionsFor(m || {}, _readScopes()[path.basename(extPath)]);
  return [session.defaultSession, ...partitions.map(p => secureSessions.fromPartition(p))];
}

// Sessions that get their extensions only while a page is open in them, and
// give them back a minute after the last one goes: the three containers and
// the default session rarely hold a page, yet each held its own copy of every
// extension — three idle uBlock Origin background pages, ~85 MB apiece, for
// containers with no tab open. persist:main and the app panels stay eager: a
// content script registered after the first page has started loading misses
// that page.
const LAZY_EXT_PARTITIONS = new Set(['default', 'persist:container-work', 'persist:container-personal', 'persist:container-shopping']);
const LAZY_EXT_RELEASE_MS = 60000;
const _liveBySession = new Map();   // Session → Set<webContents> open in it
const _releaseTimers = new Map();   // Session → pending unload

function _isLazySession(ses) {
  const name = _partitionNameOf(ses);
  return name !== null && LAZY_EXT_PARTITIONS.has(name);
}

function _trackSessionUse(contents) {
  const ses = contents.session;
  if (!_isLazySession(ses)) return;
  let live = _liveBySession.get(ses);
  if (!live) { live = new Set(); _liveBySession.set(ses, live); }
  live.add(contents);
  const pending = _releaseTimers.get(ses);
  if (pending) { clearTimeout(pending); _releaseTimers.delete(ses); }
  contents.once('destroyed', () => {
    live.delete(contents);
    if (live.size) return;
    _releaseTimers.set(ses, setTimeout(() => {
      _releaseTimers.delete(ses);
      if (!live.size) _releaseSessionExtensions(ses);
    }, LAZY_EXT_RELEASE_MS));
  });
}

function _releaseSessionExtensions(ses) {
  for (const ext of ses.getAllExtensions()) {
    try { ses.removeExtension(ext.id); }
    catch (err) { console.error(`[Extensions] could not unload ${ext.name} from ${_partitionNameOf(ses)}:`, err.message); }
  }
  _coveredSessions.delete(ses);
}

// chrome.storage.sync for an extension's content scripts (extensions.js,
// withContentShim): the shim file is (re)written into the folder and listed
// first in its content-script entries, before the extension loads anywhere;
// Chromium reads the content scripts when it loads the extension. Every other
// place that loads an extension loads a folder that came through here.
let _contentShimText = null;
function _prepareContentShim(extPath) {
  const manifestPath = path.join(extPath, 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8').replace(/^\uFEFF/, ''));
  const plan = extHelpers.withContentShim(manifest);
  if (!plan.uses) return;
  if (_contentShimText === null) _contentShimText = extHelpers.contentShimSource(fs.readFileSync(path.join(__dirname, 'preload-extension-sw.js'), 'utf-8'));
  const shimPath = path.join(extPath, extHelpers.CONTENT_SHIM_FILE);
  if (!fs.existsSync(shimPath) || fs.readFileSync(shimPath, 'utf-8') !== _contentShimText) fs.writeFileSync(shimPath, _contentShimText);
  if (plan.manifest) fs.writeFileSync(manifestPath, JSON.stringify(plan.manifest, null, 2));
}

async function _loadExtensionEverywhere(extPath, manifest) {
  // A lazy session only while it has pages (it was covered when the first one appeared).
  const sessions = _sessionsFor(extPath, manifest).filter(ses => !_isLazySession(ses) || _coveredSessions.has(ses));
  let loaded = null;
  const errors = [];
  // Not given it, the extension still loads, as before; the reason is said.
  try { _prepareContentShim(extPath); }
  catch (err) { console.error(`[Extensions] ${path.basename(extPath)}: its content scripts get no chrome.storage.sync — ${err.message}`); }
  for (const ses of sessions) {
    try {
      ensureExtensionSwPreload(ses);
      const ext = await ses.loadExtension(extPath, _extLoadOptions(extPath));
      if (!loaded) loaded = ext;
    } catch (err) {
      errors.push(err.message);
    }
  }
  // One line per extension rather than one per session: the same manifest error
  // repeats for every partition we load into, so a single broken extension
  // would otherwise print a dozen identical lines on every boot.
  if (errors.length) {
    const unique = [...new Set(errors)];
    console.error(`[Extensions] ${path.basename(extPath)}: failed in ${errors.length}/${sessions.length} sessions — ${unique.join(' | ')}`);
  }
  if (loaded) _checkBackgroundStarts(path.basename(extPath), extPath);
  return { extension: loaded, errors };
}

// loadExtension succeeds even when an MV3 extension's service worker cannot
// register ("Service worker registration failed. Status code: 15"): Violentmonkey
// showed "On" with no background at all (found 2026-09-29). A few seconds
// after loading, persist:main is asked to start the worker; a refusal is
// recorded, so the manager says why the extension does nothing.
//
// It waits for the worker's own start: a fresh profile on a busy machine took
// 6 to 11 seconds to register one, and the check that asked at 4 seconds was
// refused ("Failed to start service worker") and said "did not start" about a
// worker that ran a few seconds later (found 2026-10-08). Only a worker that
// has not run after BACKGROUND_WAIT_MS is asked to start, and a refusal then
// is the real failure.
const BACKGROUND_WAIT_MS = 30000;
const _extWorkersRan = new Set(); // `${partition}\n${scope}` of workers that reached "running"
function _noteWorkerRunning(ses, versionId) {
  const info = ses.serviceWorkers.getAllRunning()[versionId];
  if (info && String(info.scope || '').startsWith('chrome-extension://')) _extWorkersRan.add(_partitionKey(ses) + '\n' + info.scope);
}
function _workerHasRun(ses, scope) {
  if (_extWorkersRan.has(_partitionKey(ses) + '\n' + scope)) return true;
  return Object.values(ses.serviceWorkers.getAllRunning()).some(info => info.scope === scope);
}
function _checkBackgroundStarts(folder, extPath) {
  const ses = secureSessions.fromPartition('persist:main');
  const started = Date.now();
  const tick = () => {
    const ext = ses.getAllExtensions().find(x => path.resolve(x.path) === path.resolve(extPath));
    const worker = ext && ext.manifest && ext.manifest.background && ext.manifest.background.service_worker;
    if (!worker) return; // unloaded meanwhile, or no worker to check
    const scope = `chrome-extension://${ext.id}/`;
    if (_workerHasRun(ses, scope)) {
      if (/^Its background did not start/.test(_extLoadErrors.get(folder) || '')) _extLoadErrors.delete(folder);
      return;
    }
    if (Date.now() - started < BACKGROUND_WAIT_MS) { setTimeout(tick, 500); return; }
    ses.serviceWorkers.startWorkerForScope(scope).then(() => {
      if (/^Its background did not start/.test(_extLoadErrors.get(folder) || '')) _extLoadErrors.delete(folder);
    }, err => {
      // Unloaded (switched off, uninstalled, updated) meanwhile: nothing to say.
      if (!ses.getAllExtensions().some(x => x.id === ext.id)) return;
      const why = `Its background did not start: ${err.message}`;
      _extLoadErrors.set(folder, why);
      console.error(`[Extensions] ${folder}: ${why}`);
    });
  };
  setTimeout(tick, 500);
}

// Unload one installed folder from every session that could be holding it.
function _unloadFromAllSessions(extPath) {
  const sessions = [session.defaultSession, ...EXT_PARTITIONS.map(p => secureSessions.fromPartition(p)), ..._extraExtSessions];
  for (const ses of sessions) {
    try {
      for (const ext of ses.getAllExtensions()) {
        if (path.resolve(ext.path) !== path.resolve(extPath)) continue;
        ses.removeExtension(ext.id);
        // Switched off, uninstalled or updated: its menu items and badge go
        // (an update makes them again when it starts, as in Chrome).
        _extUi.forgetExtension(ext.id);
      }
    } catch (err) {
      console.error('[Extensions] unload failed:', err.message);
    }
  }
}

// Re-installing an extension must REPLACE the old copy, not stack a second one:
// two copies both load and both run their own background context, and the older
// one can win. Matched on the (localized) extension name, which is the only
// stable identity available — Electron derives the extension id from the
// install path, so the same extension in two folders has two different ids.
function _removeSupersededCopies(keepPath, name) {
  if (!name) return;
  for (const entry of _extEntries()) {
    if (path.resolve(entry.path) === path.resolve(keepPath)) continue;
    if (!entry.manifest) continue;
    if (extHelpers.localize(entry.manifest.name, entry.messages) !== name) continue;
    _unloadFromAllSessions(entry.path);
    try { fs.rmSync(entry.path, { recursive: true, force: true }); console.log(`[Extensions] Replaced older copy: ${entry.folder}`); }
    catch (err) { console.error(`[Extensions] could not remove superseded ${entry.folder}:`, err.message); }
  }
}

// The installed copy a freshly-placed folder updates: same (localized) name,
// another folder. The one loaded in persist:main wins when there are several.
function _installedCopyOf(newFolder) {
  const manifest = JSON.parse(fs.readFileSync(path.join(newFolder, 'manifest.json'), 'utf-8'));
  const name = extHelpers.localize(manifest.name, extHelpers.readMessages(newFolder, manifest.default_locale));
  return _installedCopyNamed(name, newFolder);
}

function _installedCopyNamed(name, exceptFolder) {
  if (!name) return null;
  const copies = _installedEntries().filter(e => e.manifest && (!exceptFolder || path.resolve(e.path) !== path.resolve(exceptFolder))
    && extHelpers.localize(e.manifest.name, e.messages) === name);
  if (!copies.length) return null;
  let loaded = [];
  try { loaded = secureSessions.fromPartition('persist:main').getAllExtensions().map(x => path.resolve(x.path)); }
  catch (err) { console.error('[Extensions] could not read the loaded extensions:', err.message); }
  return copies.find(e => loaded.includes(path.resolve(e.path))) || copies[0];
}

// An update goes INTO the installed copy's folder. Electron names an unpacked
// extension after its folder, so a new folder was a new extension to Chromium:
// the id changed and chrome.storage came back empty — Dark Reader lost its
// site lists on every update (found 2026-09-29). The same folder also keeps
// its "where it runs" and on/off entries. The old files are set aside until
// the new ones have loaded, and put back if they do not.
// Once the new files are in place for good, the set-aside copies go
// (extensions.js tidyReplaced). A failure there leaves files, not a broken
// extension, so it is said in the log rather than failing the update.
function _tidyReplaced(backupDir, folder) {
  try { extHelpers.tidyReplaced(backupDir, folder); }
  catch (err) { console.error('[Extensions] could not tidy', backupDir + ':', err.message); }
}

async function _replaceInPlace(previous, staged) {
  const backupDir = path.join(userDataPath, 'extensions-replaced');
  const backup = path.join(backupDir, `${previous.folder}-${Date.now()}`);
  fs.mkdirSync(backupDir, { recursive: true });
  const wasDisabled = _readDisabledFolders().has(previous.folder);
  const reloadOld = async () => {
    if (wasDisabled || _boot.safeMode) return;
    const { extension, errors } = await _loadExtensionEverywhere(previous.path);
    if (!extension) console.error(`[Extensions] ${previous.folder}: the old copy did not load again either — ${errors[0] || 'unknown'}`);
  };
  _unloadFromAllSessions(previous.path);
  try {
    fs.renameSync(previous.path, backup);
  } catch (err) {
    fs.rmSync(staged, { recursive: true, force: true });
    await reloadOld();
    return { ok: false, error: `Could not replace the installed copy: ${err.message}` };
  }
  try {
    fs.renameSync(staged, previous.path);
  } catch (err) {
    fs.renameSync(backup, previous.path);
    fs.rmSync(staged, { recursive: true, force: true });
    await reloadOld();
    return { ok: false, error: `Could not put the new version in place: ${err.message}` };
  }
  const manifest = JSON.parse(fs.readFileSync(path.join(previous.path, 'manifest.json'), 'utf-8'));
  const name = extHelpers.localize(manifest.name, extHelpers.readMessages(previous.path, manifest.default_locale));
  if (wasDisabled) {
    // Switched off, it stays off: the new files wait for the user to switch it on.
    fs.rmSync(backup, { recursive: true, force: true });
    _tidyReplaced(backupDir, previous.folder);
    _extLoadErrors.delete(previous.folder);
    return { ok: true, id: null, name, version: manifest.version, disabled: true, folder: previous.folder };
  }
  if (_boot.safeMode) {
    // Safe mode loads no extensions: an update went live anyway, perhaps the
    // very one that stopped Vex starting (found 2026-09-29). The files are in
    // place and it loads on a normal start.
    fs.rmSync(backup, { recursive: true, force: true });
    _tidyReplaced(backupDir, previous.folder);
    return { ok: true, id: null, name, version: manifest.version, afterRestart: true, folder: previous.folder };
  }
  const { extension, errors } = await _loadExtensionEverywhere(previous.path);
  if (!extension) {
    _unloadFromAllSessions(previous.path);
    fs.rmSync(previous.path, { recursive: true, force: true });
    fs.renameSync(backup, previous.path);
    await reloadOld();
    return { ok: false, error: errors[0] || 'the extension did not load' };
  }
  fs.rmSync(backup, { recursive: true, force: true });
  _tidyReplaced(backupDir, previous.folder);
  _extLoadErrors.delete(previous.folder);
  _removeSupersededCopies(previous.path, extension.name);
  return { ok: true, id: extension.id, name: extension.name, version: extension.manifest.version, folder: previous.folder };
}

// Load a freshly-placed install folder. If it can't load, the folder is REMOVED:
// leaving it behind made it retry-and-fail on every boot and show up in the
// manager as a nameless "v—" entry the user couldn't explain.
async function _activateInstalledFolder(destFolder, copyToUpdate) {
  let previous;
  try { previous = copyToUpdate || _installedCopyOf(destFolder); }
  catch (err) {
    fs.rmSync(destFolder, { recursive: true, force: true });
    return { ok: false, error: err.message };
  }
  if (previous) return _replaceInPlace(previous, destFolder);
  if (_boot.safeMode) {
    // Placed but not loaded in safe mode, like an update (_replaceInPlace).
    const manifest = JSON.parse(fs.readFileSync(path.join(destFolder, 'manifest.json'), 'utf-8'));
    const name = extHelpers.localize(manifest.name, extHelpers.readMessages(destFolder, manifest.default_locale));
    return { ok: true, id: null, name: name || path.basename(destFolder), version: manifest.version, afterRestart: true, folder: path.basename(destFolder) };
  }
  // Told "install" when it starts (chrome.runtime.onInstalled, _extTellInstalled).
  _freshInstalls.add(path.basename(destFolder));
  const { extension, errors } = await _loadExtensionEverywhere(destFolder);
  if (!extension) {
    try { fs.rmSync(destFolder, { recursive: true, force: true }); }
    catch (err) { console.error('[Extensions] could not clean up the failed install:', err.message); }
    return { ok: false, error: errors[0] || 'the extension did not load' };
  }
  _extLoadErrors.delete(path.basename(destFolder));
  _removeSupersededCopies(destFolder, extension.name);
  return { ok: true, id: extension.id, name: extension.name, version: extension.manifest.version, folder: path.basename(destFolder) };
}

// Extensions must also reach partitions created AFTER startup — a container
// tab, or a panel pointed at a new partition. Electron refuses extensions in
// temporary (in-memory) sessions, so OTR/Tor/burner tabs are skipped up front
// rather than failing once per extension.
const _coveredSessions = new WeakSet();
async function _coverNewSession(ses) {
  if (!ses || _coveredSessions.has(ses)) return;
  _coveredSessions.add(ses);
  if (typeof ses.isPersistent === 'function' && !ses.isPersistent()) return;
  const disabled = _readDisabledFolders();
  // A partition Vex knows gets only the extensions that belong in it; a
  // session it does not know (a pinned site's, Tor's) gets them all, as before.
  const known = _partitionNameOf(ses) !== null;
  for (const entry of _extEntries()) {
    // An extension that already failed to load everywhere fails here too, once
    // per new partition. The manager already reports why, so don't retry it.
    if (!entry.manifest || disabled.has(entry.folder) || _extLoadErrors.has(entry.folder)) continue;
    if (known && !_sessionsFor(entry.path, entry.manifest).includes(ses)) continue;
    try {
      if (ses.getAllExtensions().some(x => path.resolve(x.path) === path.resolve(entry.path))) continue;
      ensureExtensionSwPreload(ses);
      await ses.loadExtension(entry.path, _extLoadOptions(entry.path));
      _extraExtSessions.add(ses);
    } catch (err) {
      console.error(`[Extensions] could not load ${entry.folder} into a new session:`, err.message);
    }
  }
}

async function loadAllExtensionsOnStartup() {
  // An uninstall whose Undo was still on screen when Vex last stopped.
  _finishPendingRemovals('start');
  // Collapse any duplicate Vencord builds to the newest BEFORE loading, so a
  // stale build left behind by a locked-file delete can't shadow the new one.
  _dedupeVencordFolders();
  _migrateFileAccess();
  // Before any extension starts, so one that adds to its saved items finds them.
  _restoreExtensionMenus();
  const disabled = _readDisabledFolders();
  for (const entry of _extEntries()) {
    if (entry.error && !entry.manifest) { _extLoadErrors.set(entry.folder, entry.error); continue; }
    if (disabled.has(entry.folder)) continue;
    const t0 = Date.now();
    try {
      const { extension, errors } = await _loadExtensionEverywhere(entry.path);
      _diag.extensionTimes.push({ name: (extension && extension.name) || entry.folder, ms: Date.now() - t0 });
      if (extension) {
        _extLoadErrors.delete(entry.folder);
        console.log(`[Extensions] Loaded: ${extension.name} v${extension.manifest.version}`);
      } else {
        _extLoadErrors.set(entry.folder, errors[0] || 'the extension did not load');
      }
    } catch (err) {
      _extLoadErrors.set(entry.folder, err.message);
      console.error(`[Extensions] Failed to load ${entry.folder}:`, err.message);
    }
  }
}

ipcMain.handle('extensions:list', () => {
  const disabled = _readDisabledFolders();
  // "Loaded" is read from the live session rather than inferred from the folder,
  // so the manager can't show a failed extension as if it were running.
  // persist:main is the session every extension is always in (the default
  // session only holds them while a page is open there).
  const loadedByPath = new Map();
  try {
    for (const ext of secureSessions.fromPartition('persist:main').getAllExtensions()) loadedByPath.set(path.resolve(ext.path), ext);
  } catch (err) {
    console.error('[Extensions] could not read the loaded extensions:', err.message);
  }
  const scopes = _readScopes();
  const sources = _readSources();
  const fileAccess = _fileAccessState();
  const pins = _readExtPins();
  let updates = null, updatesError = null;
  try { updates = _extUpdates.readState(extensionsDir); }
  catch (err) { updatesError = `The extension update record is unreadable (${err.message}).`; console.error('[Extensions]', updatesError); }
  // One being uninstalled is gone as far as the manager is concerned (its
  // Undo is on the toast).
  const removing = _readRemovingFolders();
  return _extEntriesOnDisk().filter(e => !removing[e.folder]).map(e => {
    const live = loadedByPath.get(path.resolve(e.path)) || null;
    const manifest = e.manifest || {};
    const icon = e.manifest ? extHelpers.pickIcon(manifest) : null;
    const pages = e.manifest ? extHelpers.pickPages(manifest) : { popup: null, options: null };
    const where = e.manifest ? extHelpers.partitionsFor(manifest, scopes[e.folder]) : { partitions: [], generic: false, hosts: [] };
    return {
      folder: e.folder,
      scope: scopes[e.folder] === 'everywhere' ? 'everywhere' : 'auto',
      generic: where.generic,
      where: where.partitions,
      // Asks for request blocking, which Electron does not give extensions.
      blocker: (Array.isArray(manifest.permissions) ? manifest.permissions : []).some(p => /^(webRequest|webRequestBlocking|declarativeNetRequest)/.test(String(p))),
      name: extHelpers.localize(manifest.name, e.messages) || e.folder,
      version: manifest.version || '—',
      description: extHelpers.localize(manifest.description, e.messages) || '',
      path: e.path,
      id: live ? live.id : null,
      enabled: !disabled.has(e.folder),
      loaded: !!live,
      hasPopup: !!pages.popup,
      // A toolbar button with no popup: a click on it is the extension's own
      // (chrome.action.onClicked).
      hasAction: !!(manifest.action || manifest.browser_action),
      // Pinned to the toolbar (main.js, extensions:set-pinned).
      pinned: pins.includes(e.folder),
      hasOptions: !!pages.options,
      optionsUrl: (live && pages.options)
        ? `chrome-extension://${live.id}/${String(pages.options).replace(/^\/+/, '')}`
        : null,
      iconPath: icon ? path.join(e.path, icon) : null,
      // Installed from the Chrome Web Store: its id there, for "Update from Web Store".
      webstore: (sources[e.folder] && sources[e.folder].webstore) || null,
      // Where it came from, so the card can say whether Vex can update it.
      source: _sourceInfo(sources[e.folder]),
      update: _updateInfo(updates, e.folder, manifest.version),
      // "Allow access to file URLs", off unless switched on (security scan M6).
      fileAccess: !!fileAccess.allow[e.folder],
      fileAccessKept: !!fileAccess.kept[e.folder],
      fileUrls: e.manifest ? extHelpers.fileUrlPatterns(manifest).length > 0 : false,
      // What this extension can read, and what it is allowed to do, in words
      // (src/main/extension-audit.js).
      audit: require('./main/extension-audit').auditOne(e),
      error: e.error || _extLoadErrors.get(e.folder) || (_boot.safeMode ? 'Not loaded: Vex started in safe mode' : null),
      stateError: _extStateError || _fileAccessError || updatesError || _extPinsError
    };
  });
});

// "Install from folder" and "Install from .zip / .crx" are two steps, like a
// Web Store install: extensions:install-folder / install-zip pick the file,
// check it and describe it (nothing is written); the manager shows the same
// permissions dialog (js/web-store.js dialogHtml); extensions:install-picked
// then installs exactly what was checked. A picked item is kept in memory for
// ten minutes under a random token.
const _pickedExt = new Map();
const PICKED_EXT_TTL_MS = 10 * 60 * 1000;
function _stagePickedExt(item) {
  const now = Date.now();
  for (const [k, v] of _pickedExt) if (now - v.at > PICKED_EXT_TTL_MS) _pickedExt.delete(k);
  const token = require('crypto').randomBytes(16).toString('hex');
  _pickedExt.set(token, { ...item, at: now });
  return token;
}
function _installedSummary(have) {
  return have ? { folder: have.folder, version: (have.manifest && have.manifest.version) || '' } : null;
}

// A picked folder: its manifest and what it asks for. The folder is copied at
// install time, and refused then if its manifest changed in between.
function _previewPickedFolder(sourceFolder) {
  const manifestPath = path.join(sourceFolder, 'manifest.json');
  if (!fs.existsSync(manifestPath)) return { ok: false, error: 'No manifest.json in that folder' };
  const manifestText = fs.readFileSync(manifestPath, 'utf-8');
  const manifest = JSON.parse(manifestText.replace(/^\uFEFF/, ''));
  const messages = extHelpers.readMessages(sourceFolder, manifest.default_locale);
  const info = require('./main/webstore').describe(manifest, messages);
  const token = _stagePickedExt({ kind: 'folder', folder: sourceFolder, manifestText, refuse: info.refuse });
  return { ok: true, token, ...info, source: 'folder', file: path.basename(sourceFolder), installed: _installedSummary(_installedCopyNamed(info.name)), safeMode: !!_boot.safeMode };
}

// A picked .crx goes through the Web Store's checks (webstore.js
// inspectLocalCrx): CRX3 only, every signature valid, the developer's key
// matching the id it names, and the Web Store's own signature on anything that
// presents itself as a store package. A .zip is not signed at all; the dialog
// says so.
function _previewPickedFile(sourcePath) {
  const AdmZip = require('adm-zip');
  const { validateZip } = require('./main/archive-security');
  const ws = require('./main/webstore');
  const buf = fs.readFileSync(sourcePath);
  const file = path.basename(sourcePath);
  if (buf.subarray(0, 4).toString('latin1') === 'Cr24') {
    const crx = ws.inspectLocalCrx(buf, { AdmZip, validateZip });
    const keyB64 = crx.publicKey.toString('base64');
    const have = crx.fromWebStore ? _webStoreCopyOf(crx.id, crx.info.name, keyB64)
      : (_installedEntries().find(e => e.manifest && e.manifest.key === keyB64) || _installedCopyNamed(crx.info.name));
    const token = _stagePickedExt({ kind: 'crx', id: crx.id, archive: crx.archive, publicKey: crx.publicKey, fromWebStore: crx.fromWebStore, name: crx.info.name, refuse: crx.info.refuse });
    // A Chrome theme: its colours and pictures for the window, which makes it
    // one of the user's themes (main/chrome-theme.js, js/chrome-theme.js).
    const theme = crx.info.isTheme ? require('./main/chrome-theme').themePreview(crx.archive, { AdmZip, validateZip }) : {};
    return { ok: true, token, id: crx.id, ...crx.info, ...theme, source: crx.fromWebStore ? 'webstore-file' : 'developer', file, installed: _installedSummary(have), safeMode: !!_boot.safeMode };
  }
  const zip = new AdmZip(buf);
  // Diagnose a Windows-separator archive BEFORE the validator rejects it, so
  // the user gets an actionable message rather than "Unsafe archive path".
  const separatorProblem = extHelpers.archiveProblem(zip.getEntries().map(e => e.entryName));
  if (separatorProblem) return { ok: false, error: separatorProblem };
  const entries = validateZip(zip);
  // The manifest at the root, or in the shallowest folder that has one
  // (GitHub release zips like "uBlock0.chromium/manifest.json").
  let manifestEntry = entries.find(e => e.entryName === 'manifest.json');
  let rootPath = '';
  if (!manifestEntry) {
    manifestEntry = entries.filter(e => !e.isDirectory && e.entryName.endsWith('/manifest.json'))
      .sort((a, b) => a.entryName.split('/').length - b.entryName.split('/').length)[0];
    if (manifestEntry) rootPath = manifestEntry.entryName.replace(/manifest\.json$/, '');
  }
  if (!manifestEntry) return { ok: false, error: 'No manifest.json found anywhere in the archive' };
  const manifest = JSON.parse(manifestEntry.getData().toString('utf-8').replace(/^\uFEFF/, ''));
  const messages = Object.create(null);
  for (const locale of [manifest.default_locale, 'en'].filter(l => typeof l === 'string' && l)) {
    const localeEntry = entries.find(e => e.entryName === `${rootPath}_locales/${locale}/messages.json`);
    if (!localeEntry) continue;
    for (const [key, value] of Object.entries(JSON.parse(localeEntry.getData().toString('utf-8').replace(/^\uFEFF/, '')))) {
      if (value && typeof value.message === 'string') messages[key] = value.message;
    }
    break;
  }
  const info = ws.describe(manifest, messages);
  const token = _stagePickedExt({ kind: 'zip', buffer: buf, refuse: info.refuse });
  return { ok: true, token, ...info, source: 'zip', file, installed: _installedSummary(_installedCopyNamed(info.name)), safeMode: !!_boot.safeMode };
}

ipcMain.handle('extensions:install-folder', async () => {
  const result = await dialog.showOpenDialog({
    title: 'Select extension folder (must contain manifest.json)',
    properties: ['openDirectory']
  });
  if (result.canceled || !result.filePaths.length) return { ok: false, cancelled: true };
  try { return _previewPickedFolder(result.filePaths[0]); }
  catch (err) { return { ok: false, error: err.message }; }
});

ipcMain.handle('extensions:install-zip', async () => {
  const result = await dialog.showOpenDialog({
    title: 'Select extension .zip or .crx',
    filters: [{ name: 'Extensions', extensions: ['zip', 'crx'] }],
    properties: ['openFile']
  });
  if (result.canceled || !result.filePaths.length) return { ok: false, cancelled: true };
  try { return _previewPickedFile(result.filePaths[0]); }
  catch (err) { return { ok: false, error: err.message, code: err.code || null }; }
});

// The second step: install what the person saw in the dialog.
ipcMain.handle('extensions:install-picked', async (_e, token) => {
  const item = _pickedExt.get(token);
  _pickedExt.delete(token);
  if (!item || Date.now() - item.at > PICKED_EXT_TTL_MS) return { ok: false, error: 'That choice has expired. Pick the file again.' };
  if (item.refuse) return { ok: false, error: item.refuse };
  try {
    if (item.kind === 'crx') {
      // A store package from a file is a store install: same id, same record,
      // and it is kept up to date from the store from now on.
      if (item.fromWebStore) return await _installWebStorePackage({ id: item.id, archive: item.archive, publicKey: item.publicKey, info: { name: item.name } });
      const keyB64 = item.publicKey.toString('base64');
      const previous = _installedEntries().find(e => e.manifest && e.manifest.key === keyB64) || _installedCopyNamed(item.name);
      // Its own key in the manifest gives it the id it was signed for, except
      // when it updates a copy installed without one (that copy's storage
      // belongs to the id its folder gave it).
      const manifestKey = previous && !previous.manifest.key ? null : keyB64;
      return await _installExtFromZipBuffer(item.archive, null, previous || undefined, { skipPrefixes: ['_metadata/'], manifestKey });
    }
    if (item.kind === 'zip') return await _installExtFromZipBuffer(item.buffer, null, undefined, { skipPrefixes: ['_metadata/'] });
    if (item.kind === 'folder') {
      const manifestPath = path.join(item.folder, 'manifest.json');
      if (!fs.existsSync(manifestPath) || fs.readFileSync(manifestPath, 'utf-8') !== item.manifestText) {
        return { ok: false, error: 'The folder\'s manifest.json changed after you looked at it. Pick the folder again.' };
      }
      const manifest = JSON.parse(item.manifestText.replace(/^\uFEFF/, ''));
      // Slug from the LOCALIZED name so a localized extension doesn't install
      // into a folder literally named after its "__MSG_extName__" placeholder.
      const messages = extHelpers.readMessages(item.folder, manifest.default_locale);
      const slug = extHelpers.slugFromName(extHelpers.localize(manifest.name, messages));
      const destFolder = path.join(extensionsDir, `${slug}-${Date.now()}`);
      _copyDirRecursive(item.folder, destFolder);
      if (fs.readFileSync(path.join(destFolder, 'manifest.json'), 'utf-8') !== item.manifestText) {
        fs.rmSync(destFolder, { recursive: true, force: true });
        return { ok: false, error: 'The folder\'s manifest.json changed while it was being copied. Pick the folder again.' };
      }
      return await _activateInstalledFolder(destFolder);
    }
    return { ok: false, error: 'Unknown install kind: ' + item.kind };
  } catch (err) {
    return { ok: false, error: err.message, code: err.code || null };
  }
});

// Download a URL to a Buffer via Electron net (follows redirects, e.g. GitHub
// release → objects.githubusercontent.com).
async function _downloadBuffer(url) {
  const response = await boundedNetFetch(url, { maxBytes: 64 * 1024 * 1024, timeoutMs: 60000 });
  if (!response.ok) throw new Error('HTTP ' + response.status);
  return Buffer.from(await response.arrayBuffer());
}

// Extract a zip Buffer into the extensions dir (zip-slip-safe) and load it into
// every EXT_PARTITIONS session. Mirrors extensions:install-zip but works from a
// buffer (used by the Vencord auto-installer). forceSlug pins the folder name so
// a re-install can find + replace the old copy.
// opts.skipPrefixes: archive paths left out (a Web Store package's _metadata/,
// which Chromium refuses in an unpacked extension: names starting "_" are
// reserved). opts.manifestKey: written into manifest.json as "key", so
// Chromium gives the extension its Web Store id rather than one made from the
// folder's path.
async function _installExtFromZipBuffer(zipBuffer, forceSlug, copyToUpdate, opts = {}) {
  const skipPrefixes = Array.isArray(opts.skipPrefixes) ? opts.skipPrefixes : [];
  let AdmZip;
  try { AdmZip = require('adm-zip'); } catch { return { ok: false, error: 'adm-zip missing' }; }
  // A .crx reaches here only as the archive inside it, after its signatures
  // were checked (webstore.js). Its header used to be cut off unread here.
  if (zipBuffer.subarray(0, 4).toString('latin1') === 'Cr24') return { ok: false, error: 'A .crx package must be checked before it is installed; this one was not. Nothing was installed.' };
  const zip = new AdmZip(zipBuffer);
  const entries = require('./main/archive-security').validateZip(zip);
  let manifestEntry = entries.find(e => e.entryName === 'manifest.json');
  let rootPath = '';
  if (!manifestEntry) {
    const cands = entries.filter(e => !e.isDirectory && e.entryName.endsWith('/manifest.json'))
      .sort((a, b) => a.entryName.split('/').length - b.entryName.split('/').length);
    if (cands.length) { manifestEntry = cands[0]; rootPath = manifestEntry.entryName.replace(/manifest\.json$/, ''); }
  }
  if (!manifestEntry) return { ok: false, error: 'No manifest.json in archive' };
  const manifest = JSON.parse(manifestEntry.getData().toString('utf-8'));
  let slug = forceSlug;
  if (!slug) {
    // The archive's own _locales name the folder, as in extensions:install-zip.
    const localeEntry = manifest.default_locale ? entries.find(e => e.entryName === `${rootPath}_locales/${manifest.default_locale}/messages.json`) : null;
    const messages = Object.create(null);
    if (localeEntry) {
      for (const [key, value] of Object.entries(JSON.parse(localeEntry.getData().toString('utf-8').replace(/^\uFEFF/, '')))) {
        if (value && typeof value.message === 'string') messages[key] = value.message;
      }
    }
    slug = extHelpers.slugFromName(extHelpers.localize(manifest.name, messages));
  }
  const destFolder = path.join(extensionsDir, `${slug}-${Date.now()}`);
  fs.mkdirSync(destFolder, { recursive: true });
  for (const entry of entries) {
    if (entry.isDirectory) continue;
    const name = entry.entryName;
    if (rootPath && !name.startsWith(rootPath)) continue;
    const rel = rootPath ? name.slice(rootPath.length) : name;
    if (!rel) continue;
    if (skipPrefixes.some(p => rel.startsWith(p))) continue;
    let outPath;
    try { outPath = safeJoin(destFolder, rel); } catch { continue; }
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, entry.getData());
  }
  const placedManifest = path.join(destFolder, 'manifest.json');
  if (!fs.existsSync(placedManifest)) {
    fs.rmSync(destFolder, { recursive: true, force: true });
    return { ok: false, error: 'manifest not at root after extract' };
  }
  if (opts.manifestKey) {
    try {
      const placed = JSON.parse(fs.readFileSync(placedManifest, 'utf-8').replace(/^\uFEFF/, ''));
      placed.key = opts.manifestKey;
      fs.writeFileSync(placedManifest, JSON.stringify(placed, null, 2));
    } catch (err) {
      fs.rmSync(destFolder, { recursive: true, force: true });
      return { ok: false, error: 'Could not write the extension\'s key into its manifest: ' + err.message };
    }
  }
  return await _activateInstalledFolder(destFolder, copyToUpdate);
}

// One-click install for the catalogue (main/extension-sources.js): the latest
// GitHub release of an extension Vex knows, installed through the same checked
// path as a zip picked by hand. An update replaces the old copy only once the
// new one has loaded (_activateInstalledFolder → _removeSupersededCopies).
const _extSources = require('./main/extension-sources');
ipcMain.handle('extensions:install-catalog', async (_e, id) => {
  try {
    if (!Object.prototype.hasOwnProperty.call(_extSources.SOURCES, id)) return { ok: false, error: 'Vex does not install that extension by itself' };
    const src = _extSources.SOURCES[id];
    const res = await boundedNetFetch(_extSources.latestReleaseUrl(id), {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Vex' }, maxBytes: 2 * 1024 * 1024, timeoutMs: 20000,
    });
    if (res.status === 404) return { ok: false, error: 'There is no release to install yet' };
    if (!res.ok) return { ok: false, error: 'GitHub answered ' + res.status };
    const release = await res.json();
    const asset = _extSources.pickAsset(release, src.asset);
    if (!asset) return { ok: false, error: 'The latest release (' + (release.tag_name || '?') + ') has no Chrome build to install' };
    const buffer = await _downloadBuffer(asset.browser_download_url);
    // The file must be the one GitHub published (security scan M6: nothing
    // here is pinned, so this is what can be checked).
    const digest = _extSources.checkAssetDigest(buffer, asset);
    return await _installCatalogPackage(id, { buffer, tag: String(release.tag_name || ''), file: asset.name, digest });
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

// Installs a catalogue release and records where it came from
// (sources.json), so it is kept up to date from the same releases.
async function _installCatalogPackage(id, { buffer, tag, file, digest }, previous) {
  const done = await _installExtFromZipBuffer(buffer, id, previous || undefined);
  if (!done.ok) return done;
  const sources = _readSources();
  sources[done.folder] = { catalog: id, tag, file, digest: digest && digest.checked ? 'sha256:' + digest.sha256 : null };
  extHelpers.writeSources(extensionsDir, sources);
  return { ...done, release: tag, file, digestChecked: !!(digest && digest.checked) };
}

// Installs a verified Web Store package (webstore.js) and records its id.
// previousOverride: the copy it updates, when the caller already knows it.
async function _installWebStorePackage(pkg, previousOverride) {
  const keyB64 = pkg.publicKey.toString('base64');
  const previous = previousOverride || _webStoreCopyOf(pkg.id, pkg.info.name, keyB64);
  // The extension gets its Web Store id (its key in the manifest), except
  // when it updates a copy installed without one: that copy's id comes from
  // its folder, and changing it would empty its storage.
  const manifestKey = previous && !previous.manifest.key ? null : keyB64;
  const done = await _installExtFromZipBuffer(pkg.archive, null, previous || undefined, { skipPrefixes: ['_metadata/'], manifestKey });
  if (!done.ok) return done;
  const sources = _readSources();
  sources[done.folder] = { webstore: pkg.id };
  extHelpers.writeSources(extensionsDir, sources);
  return { ...done, webstore: pkg.id, updated: !!previous, previousVersion: previous ? (previous.manifest.version || '') : null };
}

// Where an installed extension came from, for its card.
function _sourceInfo(src) {
  if (src && src.webstore) return { kind: 'webstore', id: src.webstore };
  if (src && src.catalog) {
    const known = _extSources.SOURCES[src.catalog];
    return { kind: 'catalog', id: src.catalog, repo: known ? known.repo : null, tag: src.tag || null, file: src.file || null, digestChecked: !!src.digest };
  }
  return null;
}

// The update state of one extension for its card: a version waiting for
// approval (only while it is still newer than what is installed), the last
// check's failure, and the last update installed.
function _updateInfo(state, folder, installedVersion) {
  if (!state) return null;
  let pending = state.pending[folder] || null;
  if (pending) {
    try { if (_extUpdates.compareVersions(pending.version, installedVersion) <= 0) pending = null; }
    catch { pending = null; }
  }
  const last = state.history.filter(h => h.folder === folder).pop() || null;
  return { pending, error: state.errors[folder] || null, last };
}

// Automatic updates (main/extension-updates.js). Started after the
// extensions have loaded; "Check now" and approvals come from the manager.
const _extUpdates = require('./main/extension-updates');
let _extUpdaterLazy = null;
function _extUpdater() {
  if (_extUpdaterLazy) return _extUpdaterLazy;
  const AdmZip = require('adm-zip');
  const { validateZip } = require('./main/archive-security');
  _extUpdaterLazy = _extUpdates.createExtensionUpdater({
    list: () => {
      const sources = _readSources();
      const removing = _readRemovingFolders();   // being uninstalled: not updated
      return _extEntriesOnDisk().filter(e => e.manifest && sources[e.folder] && !removing[e.folder]).map(e => ({
        folder: e.folder, name: extHelpers.localize(e.manifest.name, e.messages) || e.folder,
        version: String(e.manifest.version || ''), manifest: e.manifest, source: sources[e.folder],
      }));
    },
    find: (item) => item.source.webstore
      ? _extUpdates.findWebStoreUpdate({ id: item.source.webstore, installedVersion: item.version, fetch: boundedNetFetch, chromeVersion: process.versions.chrome, AdmZip, validateZip })
      : _extUpdates.findCatalogUpdate({ catalogId: item.source.catalog, installedVersion: item.version, fetch: boundedNetFetch, AdmZip, validateZip }),
    install: async (item, found) => {
      const previous = _extEntriesOnDisk().find(e => e.folder === item.folder && e.manifest);
      if (!previous || _readRemovingFolders()[item.folder]) return { ok: false, error: 'It was uninstalled during the check' };
      return found.archive
        ? _installWebStorePackage({ id: found.id, archive: found.archive, publicKey: found.publicKey, info: { name: item.name } }, previous)
        : _installCatalogPackage(item.source.catalog, found, previous);
    },
    readState: () => _extUpdates.readState(extensionsDir),
    writeState: (s) => _extUpdates.writeState(extensionsDir, s),
    isOnline: () => net.isOnline(),
    isMetered: () => _extUpdates.isMeteredWindows(),
    onUpdated: (r) => {
      const line = `${r.name} ${r.from} → ${r.to}${r.how === 'approved' ? ' (approved by you)' : ''}`;
      console.log('[Extensions] updated:', line);
      _diagEvent('extension updated', line);
    },
  });
  return _extUpdaterLazy;
}

ipcMain.handle('extensions:update-status', () => {
  try {
    const s = _extUpdates.readState(extensionsDir);
    return { ok: true, auto: s.auto, lastCheck: s.lastCheck, lastOutcome: s.lastOutcome, checking: _extUpdater().checking };
  } catch (err) {
    return { ok: false, error: 'The extension update record is unreadable: ' + err.message };
  }
});

ipcMain.handle('extensions:set-auto-update', (_e, on) => {
  try {
    const s = _extUpdates.readState(extensionsDir);
    s.auto = !!on;
    _extUpdates.writeState(extensionsDir, s);
    return { ok: true, auto: s.auto };
  } catch (err) {
    return { ok: false, error: 'Could not save it: ' + err.message };
  }
});

ipcMain.handle('extensions:update-check', async () => {
  if (_boot.safeMode) return { ok: false, error: 'Vex started in safe mode: extensions are not checked for updates until it starts normally.' };
  try {
    const r = await _extUpdater().checkNow({ manual: true });
    const s = _extUpdates.readState(extensionsDir);
    return { ok: true, ...r, lastCheck: s.lastCheck, lastOutcome: s.lastOutcome };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('extensions:update-approve', async (_e, folder) => {
  try { return await _extUpdater().approve(String(folder)); }
  catch (err) { return { ok: false, error: err.message }; }
});

// "Allow access to file URLs" on an extension's card. Applied now: the
// extension is loaded again, with the new setting, wherever it is loaded.
ipcMain.handle('extensions:set-file-access', async (_e, folderName, allow) => {
  let extPath;
  try { extPath = safeJoin(extensionsDir, safeName(folderName)); }
  catch (err) {
    console.warn('[Extensions] set-file-access rejected unsafe folderName:', folderName, err.message);
    return { ok: false, error: 'Invalid folder name' };
  }
  if (!fs.existsSync(extPath)) return { ok: false, error: 'Not found' };
  try {
    const state = extHelpers.readFileAccess(extensionsDir) || extHelpers.migrateFileAccess(_extEntriesOnDisk());
    if (allow) state.allow[folderName] = true; else delete state.allow[folderName];
    delete state.kept[folderName];
    extHelpers.writeFileAccess(extensionsDir, state);
    _fileAccessError = null;
  } catch (err) {
    return { ok: false, error: 'Could not save it: ' + err.message };
  }
  const errors = [];
  const sessions = new Set([session.defaultSession, ...EXT_PARTITIONS.map(p => secureSessions.fromPartition(p)), ..._extraExtSessions]);
  for (const ses of sessions) {
    try {
      const live = ses.getAllExtensions().find(x => path.resolve(x.path) === path.resolve(extPath));
      if (!live) continue;
      ses.removeExtension(live.id);
      ensureExtensionSwPreload(ses);
      await ses.loadExtension(extPath, _extLoadOptions(extPath));
    } catch (err) {
      errors.push(`${_partitionNameOf(ses) || 'a session'}: ${err.message}`);
    }
  }
  if (errors.length) {
    console.error(`[Extensions] ${folderName}: file access changed, but it did not load again — ${errors.join(' | ')}`);
    return { ok: false, error: 'Saved, but it did not load again: ' + errors[0] };
  }
  return { ok: true, allow: !!allow };
});

// Install from the Chrome Web Store (main/webstore.js). The package comes from
// Google's own update server, as in Chrome, Brave and Vivaldi, and is used only
// when its CRX3 signatures, the developer's and the Web Store's, check out.
// Two steps, so the person sees what it may do before anything is written:
// webstore-preview downloads, verifies and describes it; install-webstore
// installs that same verified package (downloaded again after ten minutes).
// Both take one string, an extension id or a store link, and main finds the
// id in it itself. Refused in private windows by the IPC policy (extensions:).
let _webStoreLazy = null;
function _webStoreInstaller() {
  if (!_webStoreLazy) {
    _webStoreLazy = require('./main/webstore').createWebStoreInstaller({
      fetch: boundedNetFetch, chromeVersion: process.versions.chrome,
      AdmZip: require('adm-zip'), validateZip: require('./main/archive-security').validateZip,
    });
  }
  return _webStoreLazy;
}

// The installed copy a Web Store install updates: the folder recorded for that
// id, else one carrying the same key, else one of the same name.
function _webStoreCopyOf(id, name, keyB64) {
  const sources = _readSources();
  const entries = _installedEntries().filter(e => e.manifest);
  return entries.find(e => sources[e.folder] && sources[e.folder].webstore === id)
    || entries.find(e => keyB64 && e.manifest.key === keyB64)
    || _installedCopyNamed(name);
}

ipcMain.handle('extensions:webstore-preview', async (_e, input) => {
  try {
    const p = await _webStoreInstaller().preview(input);
    // A Chrome theme is not installed as an extension: the window makes it
    // one of the user's themes from the colours and pictures read here.
    const theme = p.isTheme ? await _webStoreInstaller().theme(p.id) : {};
    const have = _webStoreCopyOf(p.id, p.name, null);
    return { ok: true, ...p, ...theme, installed: have ? { folder: have.folder, version: (have.manifest && have.manifest.version) || '' } : null, safeMode: !!_boot.safeMode };
  } catch (err) {
    return { ok: false, error: err.message, code: err.code || null };
  }
});

ipcMain.handle('extensions:install-webstore', async (_e, input) => {
  try {
    const pkg = await _webStoreInstaller().take(input);
    return await _installWebStorePackage(pkg);
  } catch (err) {
    return { ok: false, error: err.message, code: err.code || null };
  }
});

// The installed Vencord a (re)install updates in place. Deleting it first gave
// the new build a new folder, so a new extension id and empty storage: every
// Vencord setting was lost on each reinstall (found 2026-09-29). Matched on
// the folder rather than the name, since the official and local builds need
// not share one. The copy loaded in the Discord panel wins, else the newest.
function _installedVencord() {
  const copies = _installedEntries().filter(e => e.manifest && /^vencord-/.test(e.folder));
  if (!copies.length) return null;
  let loaded = [];
  try { loaded = secureSessions.fromPartition('persist:discord').getAllExtensions().map(x => path.resolve(x.path)); }
  catch (err) { console.error('[Extensions] could not read the Discord panel extensions:', err.message); }
  const mtime = e => fs.statSync(e.path).mtimeMs;
  return copies.find(e => loaded.includes(path.resolve(e.path))) || copies.sort((a, b) => mtime(b) - mtime(a))[0];
}

// One-click Vencord: download the official chromium browser extension and load
// it into the Discord panel session (persist:discord, included in EXT_PARTITIONS).
ipcMain.handle('discord:install-vencord', async () => {
  // Prefer a LOCAL build if one exists (Fadi's custom userplugins/plugins aren't
  // in the official devbuild), so the familiar button never clobbers them with
  // the upstream build. Falls back to the official download when there's no
  // local build.
  const localZip = _findLocalVencordZip();
  if (localZip) {
    try {
      const buf = fs.readFileSync(localZip);
      if (buf && buf.length >= 50000) {
        try { fs.writeFileSync(path.join(userDataPath, 'vencord-local.json'), JSON.stringify({ path: localZip })); } catch {}
        const r = await _installExtFromZipBuffer(buf, 'vencord', _installedVencord());
        if (r.ok) return { ...r, source: 'local:' + localZip };
      }
    } catch { /* fall back to official */ }
  }
  const URL_VENCORD = 'https://github.com/Vendicated/Vencord/releases/download/devbuild/extension-chrome.zip';
  try {
    const buf = await _downloadBuffer(URL_VENCORD);
    if (!buf || buf.length < 50000) return { ok: false, error: 'download too small / failed' };
    return await _installExtFromZipBuffer(buf, 'vencord', _installedVencord());
  } catch (e) {
    return { ok: false, error: (e && e.message) || 'install failed' };
  }
});

// Install Vencord from a LOCAL build (Fadi's src/userplugins + src/plugins),
// so custom plugins that aren't in the official devbuild show up in the Discord
// panel. Point it at the `extension-chrome.zip` produced by `pnpm buildWeb`
// (dist/extension-chrome.zip). Autodetects the common checkout, remembers the
// last-used path, and replaces the official Vencord (slug 'vencord').
function _findLocalVencordZip(customPath) {
  const tryResolve = (p) => {
    try {
      if (!p || !fs.existsSync(p)) return null;
      if (fs.statSync(p).isDirectory()) {
        for (const sub of ['dist/extension-chrome.zip', 'extension-chrome.zip']) {
          const q = path.join(p, sub);
          if (fs.existsSync(q)) return q;
        }
        return null;
      }
      return /\.zip$/i.test(p) ? p : null;
    } catch { return null; }
  };
  // An explicit path always wins. Otherwise gather every candidate that exists
  // and pick the MOST RECENTLY BUILT zip — so a fresh `pnpm buildWeb` always
  // wins over a stale path saved in vencord-local.json from an older build (the
  // cause of "I reinstalled but it's still the old plugin").
  if (customPath) { const r = tryResolve(customPath); if (r) return r; }
  const cands = [];
  cands.push('C:\\vencord-dev\\dist\\extension-chrome.zip');
  cands.push('C:\\vencord-dev');
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(userDataPath, 'vencord-local.json'), 'utf8'));
    if (cfg && cfg.path) cands.push(cfg.path);
  } catch {}
  const resolved = [];
  for (const c of cands) { const r = tryResolve(c); if (r && !resolved.includes(r)) resolved.push(r); }
  if (!resolved.length) return null;
  resolved.sort((a, b) => {
    try { return fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs; } catch { return 0; }
  });
  return resolved[0];
}
ipcMain.handle('discord:install-vencord-local', async (_e, customPath) => {
  _vlog(`install-local: START (customPath=${customPath || 'none'})`);
  try {
    const zipPath = _findLocalVencordZip(customPath);
    _vlog(`install-local: zip = ${zipPath || 'NOT FOUND'}`);
    if (!zipPath) return { ok: false, error: 'No local Vencord build found. Build it first: cd vencord-dev && pnpm buildWeb' };
    const buf = fs.readFileSync(zipPath);
    _vlog(`install-local: read ${buf ? buf.length : 0} bytes`);
    if (!buf || buf.length < 50000) return { ok: false, error: 'build zip too small / not a real build' };
    try { fs.writeFileSync(path.join(userDataPath, 'vencord-local.json'), JSON.stringify({ path: zipPath })); } catch {}
    _vlog(`install-local: before=[${_extEntries().map(e => e.folder).filter(f => /^vencord-/.test(f)).join(', ')}]`);
    const r = await _installExtFromZipBuffer(buf, 'vencord', _installedVencord());
    _dedupeVencordFolders();
    _vlog(`install-local: result ok=${r.ok} ${r.ok ? 'v' + r.version : 'err=' + r.error} after=[${_extEntries().map(e => e.folder).filter(f => /^vencord-/.test(f)).join(', ')}]`);
    return r.ok ? { ...r, source: zipPath } : r;
  } catch (e) {
    _vlog(`install-local: EXCEPTION ${(e && e.stack) || e}`);
    return { ok: false, error: (e && e.message) || 'install failed' };
  }
});

// === Uninstall with Undo ======================================================
// The manager's Uninstall switches the extension off at once and lists it as
// being removed (extensions.js, REMOVING_FILE); the interface's Undo toast
// (js/vex-undo.js) either turns it back on (extensions:uninstall-undo) or, when
// it goes, removes it for good (extensions:uninstall). One still listed when
// Vex quits, or at the next start after a crash, is removed then — before any
// extension loads — so a quit never leaves one half removed.
function _readRemovingFolders() {
  try { return extHelpers.readRemoving(extensionsDir); }
  catch (err) {
    console.error('[Extensions]', err.message);
    return {};
  }
}
function _finishPendingRemovals(reason) {
  const removing = _readRemovingFolders();
  for (const folder of Object.keys(removing)) {
    const r = _removeExtensionFolder(folder);
    if (r.ok) console.log(`[Extensions] removed ${folder} (${reason}: its Undo was not used)`);
    else console.error(`[Extensions] could not finish removing ${folder} (${reason}):`, r.error);
  }
}
ipcMain.handle('extensions:uninstall-later', async (_e, folderName) => {
  let extPath;
  try { extPath = safeJoin(extensionsDir, safeName(folderName)); }
  catch { return { ok: false, error: 'Invalid folder name' }; }
  if (!fs.existsSync(extPath)) return { ok: false, error: 'Not found' };
  try {
    const removing = extHelpers.readRemoving(extensionsDir);
    removing[folderName] = { at: Date.now() };
    extHelpers.writeRemoving(extensionsDir, removing);
    _unloadFromAllSessions(extPath);
    _extUiChanged();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});
ipcMain.handle('extensions:uninstall-undo', async (_e, folderName) => {
  let extPath;
  try { extPath = safeJoin(extensionsDir, safeName(folderName)); }
  catch { return { ok: false, error: 'Invalid folder name' }; }
  try {
    const removing = extHelpers.readRemoving(extensionsDir);
    if (!removing[folderName]) return { ok: false, error: 'It is not being removed' };
    if (!fs.existsSync(extPath)) return { ok: false, error: 'It has already been removed' };
    delete removing[folderName];
    extHelpers.writeRemoving(extensionsDir, removing);
    // On again only if it was on: one switched off before stays off.
    if (!_boot.safeMode && !_readDisabledFolders().has(folderName)) {
      const { extension, errors } = await _loadExtensionEverywhere(extPath);
      if (!extension) {
        const error = errors[0] || 'the extension did not load';
        _extLoadErrors.set(folderName, error);
        return { ok: false, error: 'It is back, but did not load: ' + error };
      }
      _extLoadErrors.delete(folderName);
    }
    _extUiChanged();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});
app.on('will-quit', () => _finishPendingRemovals('quit'));

ipcMain.handle('extensions:uninstall', async (_e, folderName) => _removeExtensionFolder(folderName));
function _removeExtensionFolder(folderName) {
  let extPath;
  try {
    extPath = safeJoin(extensionsDir, safeName(folderName));
  } catch (err) {
    console.warn('[Extensions] uninstall rejected unsafe folderName:', folderName, err.message);
    return { ok: false, error: 'Invalid folder name' };
  }
  const removing = _readRemovingFolders();
  if (removing[folderName]) { delete removing[folderName]; extHelpers.writeRemoving(extensionsDir, removing); }
  if (!fs.existsSync(extPath)) return { ok: false, error: 'Not found' };
  try {
    _unloadFromAllSessions(extPath);
    fs.rmSync(extPath, { recursive: true, force: true });
    // Its toolbar pin goes with it.
    const pins = _readExtPins();
    if (!_extPinsError && pins.includes(folderName)) fs.writeFileSync(path.join(extensionsDir, EXT_PINS_FILE), JSON.stringify(pins.filter(f => f !== folderName), null, 1));
    // Drop any leftover state so re-installing the same extension later doesn't
    // come back disabled, or inherit the old copy's failure message.
    _extLoadErrors.delete(folderName);
    const disabled = _readDisabledFolders();
    if (disabled.delete(folderName)) extHelpers.writeDisabled(extensionsDir, disabled);
    const sources = _readSources();
    if (sources[folderName]) { delete sources[folderName]; extHelpers.writeSources(extensionsDir, sources); }
    const access = extHelpers.readFileAccess(extensionsDir);
    if (access && (access.allow[folderName] || access.kept[folderName])) {
      delete access.allow[folderName]; delete access.kept[folderName];
      extHelpers.writeFileAccess(extensionsDir, access);
    }
    const updates = _extUpdates.readState(extensionsDir);
    if (updates.pending[folderName] || updates.errors[folderName]) {
      delete updates.pending[folderName]; delete updates.errors[folderName];
      _extUpdates.writeState(extensionsDir, updates);
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

ipcMain.handle('extensions:open-folder', () => { shell.openPath(extensionsDir); return { ok: true }; });

// Turn an installed extension off without uninstalling it. Disabling unloads it
// from every session immediately; the choice is persisted so it stays off after
// a restart (Electron reloads extensions from scratch on every boot).
ipcMain.handle('extensions:set-enabled', async (_e, folderName, enabled) => {
  let extPath;
  try {
    extPath = safeJoin(extensionsDir, safeName(folderName));
  } catch (err) {
    console.warn('[Extensions] set-enabled rejected unsafe folderName:', folderName, err.message);
    return { ok: false, error: 'Invalid folder name' };
  }
  if (!fs.existsSync(extPath)) return { ok: false, error: 'Not found' };
  try {
    const disabled = _readDisabledFolders();
    if (enabled) {
      disabled.delete(folderName);
      extHelpers.writeDisabled(extensionsDir, disabled);
      // Safe mode loads no extensions; switching one back on loaded it anyway,
      // perhaps the very one that stopped Vex starting (found 2026-09-29).
      // The choice is saved and takes effect on a normal start.
      if (_boot.safeMode) return { ok: true, enabled: true, afterRestart: true };
      const { extension, errors } = await _loadExtensionEverywhere(extPath);
      if (!extension) {
        const error = errors[0] || 'the extension did not load';
        _extLoadErrors.set(folderName, error);
        return { ok: false, error };
      }
      _extLoadErrors.delete(folderName);
      return { ok: true, enabled: true };
    }
    disabled.add(folderName);
    extHelpers.writeDisabled(extensionsDir, disabled);
    _unloadFromAllSessions(extPath);
    return { ok: true, enabled: false };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

// Host an extension's toolbar popup. Electron has no built-in action UI, so the
// popup is rendered in a frameless window on the SAME session the extension is
// loaded into (persist:main, or the container of the tab under it) and sized
// to its content the way Chrome does — a fixed window clips every popup that
// isn't exactly the size we guessed.
let _extPopupWindow = null;
let _extPopupOver = null; // { extId, session, popup: webContents id, tab: webContents id | null, grant: origin | null }
// Asked by the open popup's own extension (the stand-ins wrap chrome.tabs.query
// in its pages and its service worker); any other extension gets nothing.
//
// Clicking an extension's button in Chrome grants an extension that declares
// "activeTab" that tab: its url, title and favicon become readable. Electron
// knows no such grant and leaves them out of tabs.get for an extension with
// neither "tabs" nor a host permission for the page, so Material Icons for
// GitHub read no address, failed on new URL('') and said "Not Supported" on
// GitHub (found 2026-10-04). The answer carries them, while the tab is still
// on the site the popup was opened over (Chrome takes the grant back when the
// tab leaves it).
async function _popupTabFor(senderUrl, ses) {
  const over = _extPopupOver;
  if (!over || !_extPopupWindow || _extPopupWindow.isDestroyed()) return null;
  if (!String(senderUrl || '').startsWith(`chrome-extension://${over.extId}/`)) return null;
  if (ses !== over.session) return null;
  const answer = { popup: over.popup, tab: over.tab };
  const page = over.grant && over.tab != null ? webContents.fromId(over.tab) : null;
  if (!page || page.isDestroyed() || _originOf(page.getURL()) !== over.grant) return answer;
  answer.url = page.getURL();
  answer.title = page.getTitle();
  const host = secureSessions.owner(page);
  if (host && host.win && !host.win.isDestroyed()) {
    const icon = await host.win.webContents.executeJavaScript(`(() => { const t = TabManager.tabsByPageId(${JSON.stringify([over.tab])}).tabs[0]; return t && typeof t.favicon === 'string' ? t.favicon : null; })()`);
    if (icon) answer.favIconUrl = icon;
  }
  return answer;
}
function _originOf(url) {
  try { const u = new URL(url); return /^https?:$/.test(u.protocol) ? u.origin : null; } catch { return null; }
}
ipcMain.handle('extensions:popup-tab', (event) => _popupTabFor(event.senderFrame?.url, event.sender.session));

// A Vex tab asked for by an extension: tabs.create, runtime.openOptionsPage, or
// a link in its popup. Electron has no tabs.create and its openOptionsPage
// fails, so a popup's "Manage", "Options" and "Report a bug" did nothing
// (found 2026-09-29). Only web pages and the extension's own pages open; the
// tab opens in the extension's session (a container stays a container).
//
// The tab is made by the interface, and tabs.create answered undefined: an
// extension that keeps the new tab's id to update or close it later had
// nothing (found 2026-09-29). The interface now says which tab it made — its
// page's webContents id, the id Electron's own tabs.get/query/update use — and
// the answer is that tab. No answer in 10 s is an error, not a hang.
const _extTabRequests = new Map(); // request id -> { resolve, reject, timer }
let _extTabRequestSeq = 0;
ipcMain.on('tab:created-for-extension', (event, reply) => {
  if (!mainWindow || mainWindow.isDestroyed() || event.sender !== mainWindow.webContents) {
    console.warn('[Extensions] a tab answer came from a window that was not asked');
    return;
  }
  const pending = _extTabRequests.get(reply.id);
  if (!pending) return; // already timed out
  _extTabRequests.delete(reply.id);
  clearTimeout(pending.timer);
  if (reply.ok) pending.resolve({ id: reply.tabId, url: reply.url, active: !!reply.active });
  else pending.reject(new Error(reply.error || 'Vex did not open the tab'));
});
function _openTabForExtension(senderUrl, ses, request) {
  const sender = /^chrome-extension:\/\/([a-p]{32})\//.exec(String(senderUrl || ''));
  if (!sender) throw new Error('Only an extension page can open a tab this way');
  let url;
  try { url = new URL(String((request && request.url) || '')); }
  catch { throw new Error('That is not a web address'); }
  const ownPage = url.protocol === 'chrome-extension:' && url.host === sender[1];
  if (!ownPage && url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error(`Vex opens only web pages and the extension's own pages from an extension, not ${url.protocol}`);
  if (!mainWindow || mainWindow.isDestroyed()) throw new Error('There is no Vex window to open the tab in');
  const partition = _partitionNameOf(ses);
  const requestId = 'ext-tab-' + (++_extTabRequestSeq);
  const created = new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      _extTabRequests.delete(requestId);
      reject(new Error('Vex did not say which tab it opened'));
    }, 10000);
    _extTabRequests.set(requestId, { resolve, reject, timer });
  });
  mainWindow.webContents.send('tab:create-from-external', {
    url: url.href,
    background: !!(request && request.active === false),
    partition: partition && partition !== 'default' && partition !== 'persist:main' ? partition : undefined,
    requestId,
  });
  // The new tab takes the focus, which in Chrome closes the extension's popup;
  // here the popup stayed open over the tab it had just opened.
  const popup = _extPopupWindow;
  if (!(request && request.active === false) && popup && !popup.isDestroyed() && _extPopupOver && _extPopupOver.extId === sender[1]) popup.close();
  return created;
}
ipcMain.handle('extensions:open-tab', (event, request) => _openTabForExtension(event.senderFrame?.url, event.sender.session, request));

// An extension's tabs.remove. Electron has none, so an extension that closed
// a tab it had opened threw there (found 2026-09-30). The id is the tab's page
// (its webContents id, as tabs.create answers). Only a Vex tab in the
// extension's own session closes; anything else — Vex's own pages, a peek, a
// private window's tab — is "No tab with id", as Chrome says of an id it does
// not know. Every id is checked before any tab closes, as in Chrome.
async function _closeTabsForExtension(senderUrl, ses, request) {
  if (!/^chrome-extension:\/\/[a-p]{32}\//.test(String(senderUrl || ''))) throw new Error('Only an extension page can close a tab this way');
  const ids = request && request.ids;
  if (!Array.isArray(ids) || !ids.length || ids.length > 500 || !ids.every(Number.isSafeInteger)) throw new Error('tabs.remove takes a tab id or a list of them');
  const byWindow = new Map();
  for (const id of ids) {
    const page = id > 0 ? webContents.fromId(id) : null;
    const host = page && !page.isDestroyed() && page.getType() === 'webview' && page.session === ses ? secureSessions.owner(page) : null;
    if (!host || !host.win || host.win.isDestroyed()) throw new Error(`No tab with id: ${id}.`);
    if (!byWindow.has(host.win)) byWindow.set(host.win, []);
    byWindow.get(host.win).push(id);
  }
  for (const [win, own] of byWindow) {
    const missing = await win.webContents.executeJavaScript(`TabManager.tabsByPageId(${JSON.stringify(own)}).missing`);
    if (missing != null) throw new Error(`No tab with id: ${missing}.`);
  }
  for (const [win, own] of byWindow) await win.webContents.executeJavaScript(`TabManager.closeTabsByPageId(${JSON.stringify(own)})`);
}
ipcMain.handle('extensions:close-tab', (event, request) => _closeTabsForExtension(event.senderFrame?.url, event.sender.session, request));

// An extension's tabs.query and tabs.get: which page is the tab in front.
// Electron calls a page active when it has the focus, and cannot know which
// Vex tab is in front: with Vex's own bar focused no tab was active, or every
// one was (found 2026-09-30). Each Vex window's interface says which of its
// tabs is in front; only pages in the extension's own session are named.
// `current` is the one in front of the Vex window used last (a toolbar popup
// is not one, so while it is open that is the window it was opened over).
let _lastFocusedHostWin = null;
app.on('browser-window-focus', (_event, win) => { if (secureSessions.hosts.has(win.webContents.id)) _lastFocusedHostWin = win; });
async function _activeTabsFor(senderUrl, ses) {
  if (!/^chrome-extension:\/\/[a-p]{32}\//.test(String(senderUrl || ''))) throw new Error('Only an extension page can ask which tab is in front');
  const ids = [];
  let current = null;
  // No Vex window focused yet (or that one closed): the main window.
  const used = _lastFocusedHostWin && !_lastFocusedHostWin.isDestroyed() ? _lastFocusedHostWin : mainWindow;
  for (const host of secureSessions.hosts.values()) {
    const win = host.win;
    if (!win || win.isDestroyed()) continue;
    // A tab whose page is not made yet (not attached) has no page id.
    const id = await win.webContents.executeJavaScript('(() => { const wv = WebviewManager.webviews.get(TabManager.activeTabId); try { return wv ? wv.getWebContentsId() : null; } catch { return null; } })()');
    const page = Number.isInteger(id) ? webContents.fromId(id) : null;
    if (!page || page.isDestroyed() || page.session !== ses) continue;
    ids.push(id);
    if (win === used) current = id;
  }
  return { ids, current };
}
ipcMain.handle('extensions:active-tabs', (event) => _activeTabsFor(event.senderFrame?.url, event.sender.session));

// An MV3 extension's service worker sends its IPC to its own ServiceWorkerMain,
// not to ipcMain (so the IPC policy never sees it): Stylus's worker builds its
// popup's data and asked for the active tab, heard [] and the popup drew
// nothing (found 2026-09-29). Each extension worker gets the same answers
// as its pages, checked against the worker's own script URL.
const _wiredWorkerSessions = new WeakSet();
const _wiredWorkers = new WeakSet();
function _wireExtensionWorkerIpc(ses) {
  if (_wiredWorkerSessions.has(ses) || !ses.serviceWorkers || typeof ses.serviceWorkers.getWorkerFromVersionID !== 'function') return;
  _wiredWorkerSessions.add(ses);
  const wire = (versionId) => {
    const worker = ses.serviceWorkers.getWorkerFromVersionID(versionId);
    if (!worker || _wiredWorkers.has(worker) || !String(worker.scriptURL || '').startsWith('chrome-extension://')) return;
    _wiredWorkers.add(worker);
    worker.ipc.handle('extensions:popup-tab', () => _popupTabFor(worker.scriptURL, ses));
    worker.ipc.handle('extensions:open-tab', (_event, request) => _openTabForExtension(worker.scriptURL, ses, request));
    worker.ipc.handle('extensions:close-tab', (_event, request) => _closeTabsForExtension(worker.scriptURL, ses, request));
    worker.ipc.handle('extensions:active-tabs', () => _activeTabsFor(worker.scriptURL, ses));
    worker.ipc.handle('extensions:api', (_event, request) => _extApi(worker.scriptURL, ses, request));
  };
  ses.serviceWorkers.on('running-status-changed', ({ versionId, runningStatus }) => {
    if (runningStatus === 'starting' || runningStatus === 'running') wire(versionId);
    if (runningStatus === 'running') _noteWorkerRunning(ses, versionId);
  });
  for (const versionId of Object.keys(ses.serviceWorkers.getAllRunning())) wire(Number(versionId));
  _watchExtensionLoads(ses);
}

// === Extension menus, badges and shortcuts ===============================
// chrome.contextMenus, chrome.action's badge and title, and chrome.commands
// (src/main/extension-ui.js, src/main/extension-commands.js). Electron has
// none of them; the stand-ins in the extension's pages and service worker
// bring every call here (extensions:api), the interface draws the items and
// the badge (js/ext-ui.js), and the clicks and keys come back here to be
// told to the extension (extensions:event). Per session: a container's copy
// of an extension is a separate one. Private, Off-the-Record and Tor tabs
// load no extensions, so nothing of this reaches them.
const _extCmds = require('./main/extension-commands');
const _extMenuModel = require('./renderer/js/ext-menu-model');
const EXT_MENUS_FILE = path.join(userDataPath, 'extension-menus.json');
const _extUi = require('./main/extension-ui').createExtensionUi({ onChange: () => _extUiChanged() });
let _extUiPushTimer = null, _extMenusSaveTimer = null;
let _extMetaCache = null;     // extension id → { folder, name, iconPath, hasPopup }
let _extCommandsCache = null; // extension-commands resolve() result
let _extCommandsError = null;

// The partition a session is known by ('' for the default session), as a tab's
// <webview partition> names it.
function _partitionKey(ses) { return secureSessions.partitionOf({ session: ses }); }
// The session a partition names, among those already made (none is made here).
function _sessionForKey(key) {
  if (key === '') return session.defaultSession;
  for (const ses of secureSessions.sessions) if (_partitionKey(ses) === key) return ses;
  return null;
}

// A session's extensions (session.extensions; the calls on the session itself
// are deprecated).
function _exts(ses) { return ses.extensions || ses; }

const _watchedExtSessions = new WeakSet();
function _watchExtensionLoads(ses) {
  if (_watchedExtSessions.has(ses)) return;
  _watchedExtSessions.add(ses);
  const changed = () => { _extMetaCache = null; _extCommandsCache = null; _extUiChanged(); };
  _exts(ses).on('extension-loaded', changed);
  _exts(ses).on('extension-unloaded', changed);
  _exts(ses).on('extension-ready', (_event, ext) => _extTellInstalled(ses, ext));
}

// chrome.runtime.onInstalled. Electron never fires it, and most extensions
// make their right-click menu items there and nowhere else (Chrome keeps the
// items afterwards): with nothing firing it they had none (found 2026-10-08).
// Vex fires it once per version in each session the extension runs in (a
// container's copy is a separate one): "install" for one just installed,
// "update" with the version it replaced, and "chrome_update" — the reason
// Chrome gives when the browser itself was updated — for one that was already
// there, so no extension takes a Vex update or a new container for a fresh
// install (no "thanks for installing" tab).
const EXT_INSTALLS_FILE = path.join(userDataPath, 'extension-installs.json');
const _freshInstalls = new Set(); // folders installed while Vex runs
function _readExtInstalls() {
  if (!fs.existsSync(EXT_INSTALLS_FILE)) return {};
  const parsed = JSON.parse(fs.readFileSync(EXT_INSTALLS_FILE, 'utf-8'));
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('extension-installs.json is corrupt');
  return parsed;
}
async function _extTellInstalled(ses, ext) {
  if (!ext || !ext.path) return;
  const folder = path.basename(ext.path);
  const partition = _partitionKey(ses);
  const version = String((ext.manifest && ext.manifest.version) || '');
  let installs;
  try { installs = _readExtInstalls(); }
  catch (err) { console.error(`[Extensions] ${folder}: not told it is installed — ${err.message}`); return; }
  const before = installs[folder] && installs[folder][partition];
  if (before === version) return;
  let details;
  if (before) details = { reason: 'update', previousVersion: before };
  else if (_freshInstalls.has(folder) && partition === 'persist:main') details = { reason: 'install' };
  else details = { reason: 'chrome_update' };
  // The service worker is not registered yet when the extension is ready, and
  // asking Electron to start it then failed it for good ("Failed to start
  // service worker", found 2026-10-08): wait until it runs by itself, as it
  // does once registered (seconds after loading on a fresh profile).
  if (ext.manifest && ext.manifest.background && ext.manifest.background.service_worker) {
    const scope = `chrome-extension://${ext.id}/`;
    for (let i = 0; i < 150; i++) {
      if (Object.values(ses.serviceWorkers.getAllRunning()).some(info => info.scope === scope)) break;
      await new Promise(r => setTimeout(r, 200));
    }
  }
  let lastErr = null;
  for (const wait of [300, 1000, 2000, 4000]) {
    await new Promise(r => setTimeout(r, wait));
    if (!_exts(ses).getExtension(ext.id)) return; // unloaded meanwhile
    try { await _extDispatch(ses, ext.id, 'runtime.onInstalled', [details]); lastErr = null; break; }
    catch (err) { lastErr = err; }
  }
  if (lastErr) { console.error(`[Extensions] ${folder}: could not tell it it is installed — ${lastErr.message}`); return; }
  try {
    const now = _readExtInstalls();
    now[folder] = { ...(now[folder] || {}), [partition]: version };
    fs.writeFileSync(EXT_INSTALLS_FILE, JSON.stringify(now, null, 1));
  } catch (err) { console.error(`[Extensions] ${folder}: could not record that it was told it is installed — ${err.message}`); }
}

function _extMeta() {
  if (_extMetaCache) return _extMetaCache;
  const meta = new Map();
  const entries = new Map(_extEntriesOnDisk().map(e => [path.resolve(e.path), e]));
  const sessions = [session.defaultSession, ...secureSessions.sessions];
  for (const ses of sessions) {
    for (const ext of _exts(ses).getAllExtensions()) {
      if (meta.has(ext.id)) continue;
      const e = entries.get(path.resolve(ext.path));
      if (!e || !e.manifest) continue;
      const icon = extHelpers.pickIcon(e.manifest);
      meta.set(ext.id, { folder: e.folder, name: extHelpers.localize(e.manifest.name, e.messages) || e.folder,
        iconPath: icon ? path.join(e.path, icon) : null, hasPopup: !!extHelpers.pickPages(e.manifest).popup });
    }
  }
  _extMetaCache = meta;
  return meta;
}

// Extensions pinned to the toolbar, by folder, in the order pinned
// (<extensions>/pinned.json). Unreadable, none show and the manager says why.
const EXT_PINS_FILE = 'pinned.json';
let _extPinsError = null;
function _readExtPins() {
  const file = path.join(extensionsDir, EXT_PINS_FILE);
  try {
    if (!fs.existsSync(file)) { _extPinsError = null; return []; }
    const parsed = JSON.parse(fs.readFileSync(file, 'utf-8'));
    if (!Array.isArray(parsed)) throw new Error('expected a list of folders');
    _extPinsError = null;
    return parsed.filter(f => typeof f === 'string');
  } catch (err) {
    _extPinsError = `The pinned extensions could not be read (${err.message}).`;
    console.error('[Extensions]', _extPinsError);
    return [];
  }
}
ipcMain.handle('extensions:set-pinned', (_event, folder, pinned) => {
  if (!_extEntriesOnDisk().some(e => e.folder === folder)) return { ok: false, error: 'That extension is not installed' };
  const pins = _readExtPins().filter(f => f !== folder);
  if (_extPinsError) return { ok: false, error: _extPinsError };
  if (pinned) pins.push(folder);
  try {
    fs.mkdirSync(extensionsDir, { recursive: true });
    fs.writeFileSync(path.join(extensionsDir, EXT_PINS_FILE), JSON.stringify(pins, null, 1));
  } catch (err) { return { ok: false, error: `Could not save it: ${err.message}` }; }
  _extUiChanged();
  return { ok: true, pinned: !!pinned };
});

// What the interface draws: only extensions loaded in that session now.
function _extUiSnapshot() {
  const snap = _extUi.snapshot();
  const meta = _extMeta();
  let loaded = [];
  try { loaded = _exts(secureSessions.fromPartition('persist:main')).getAllExtensions().map(x => path.basename(x.path)).sort(); }
  catch (err) { console.error('[Extensions] could not read the loaded extensions:', err.message); }
  // The pinned ones (in pin order), and which are running, so the toolbar
  // knows when to draw its buttons again.
  const out = { menus: {}, action: {}, exts: {}, pins: _readExtPins(), loaded };
  for (const kind of ['menus', 'action']) {
    for (const [p, byExt] of Object.entries(snap[kind])) {
      const ses = _sessionForKey(p);
      for (const [id, value] of Object.entries(byExt)) {
        if (!ses || !_exts(ses).getExtension(id) || !meta.has(id)) continue;
        (out[kind][p] = out[kind][p] || {})[id] = value;
        out.exts[id] = meta.get(id);
      }
    }
  }
  return out;
}
function _extUiChanged() {
  if (!_extUiPushTimer) {
    _extUiPushTimer = setTimeout(() => {
      _extUiPushTimer = null;
      const snap = _extUiSnapshot();
      for (const host of secureSessions.hosts.values()) {
        if (host.win && !host.win.isDestroyed()) host.win.webContents.send('extensions:ui-state', snap);
      }
    }, 30);
  }
  if (!_extMenusSaveTimer) {
    _extMenusSaveTimer = setTimeout(() => { _extMenusSaveTimer = null; _saveExtensionMenus(); }, 500);
  }
}

// Menu items survive a restart for an extension whose background stops when
// idle (a service worker, or an MV2 event page): Chrome keeps them, and such
// an extension makes them once, when installed.
function _idleBackground(manifest) {
  const bg = (manifest && manifest.background) || {};
  return !!bg.service_worker || bg.persistent === false;
}
function _saveExtensionMenus() {
  const data = _extUi.saved((p, id) => {
    const ses = _sessionForKey(p);
    const ext = ses && _exts(ses).getExtension(id);
    return !!ext && _idleBackground(ext.manifest);
  });
  atomicWrite(EXT_MENUS_FILE, JSON.stringify(data), { backup: false })
    .catch(err => console.error('[Extensions] could not save the extensions\' menu items:', err.message));
}
function _restoreExtensionMenus() {
  if (!fs.existsSync(EXT_MENUS_FILE)) return;
  try { _extUi.restore(JSON.parse(fs.readFileSync(EXT_MENUS_FILE, 'utf-8'))); }
  catch (err) { console.error('[Extensions] the saved menu items could not be read, so extensions start without them:', err.message); }
}

// Tell an extension something, in every context of it in that session that
// listens: its pages (background page, popup, options) and its service
// worker, which is started for it if it was asleep (as Chrome wakes it).
async function _extDispatch(ses, extId, type, args) {
  const msg = { type, args };
  const prefix = `chrome-extension://${extId}/`;
  let reached = 0;
  for (const wc of webContents.getAllWebContents()) {
    if (wc.isDestroyed() || wc.session !== ses) continue;
    let url;
    try { url = wc.getURL(); } catch { url = ''; }
    if (!url.startsWith(prefix)) continue;
    // A page still loading has not set its listeners yet.
    if (wc.isLoading()) await new Promise(r => { wc.once('did-stop-loading', r); setTimeout(r, 5000); });
    if (wc.isDestroyed()) continue;
    wc.send('extensions:event', msg);
    reached++;
  }
  const ext = _exts(ses).getExtension(extId);
  if (ext && ext.manifest && ext.manifest.background && ext.manifest.background.service_worker) {
    let worker = null;
    for (const [versionId, info] of Object.entries(ses.serviceWorkers.getAllRunning())) {
      if (info.scope === prefix) { worker = ses.serviceWorkers.getWorkerFromVersionID(Number(versionId)); break; }
    }
    if (!worker || worker.isDestroyed()) worker = await ses.serviceWorkers.startWorkerForScope(prefix);
    worker.send('extensions:event', msg);
    reached++;
  }
  if (!reached) throw new Error(`${type}: the extension has nothing running to tell`);
}

// The tab an extension hears about, as chrome.tabs describes it. Its address
// and title only for an extension allowed to read them ("tabs", "activeTab" —
// a click on its item or button grants it — or a host permission for it).
function _extTabFor(ext, page) {
  if (!page || page.isDestroyed()) return undefined;
  const m = (ext && ext.manifest) || {};
  const perms = [].concat(m.permissions || [], m.host_permissions || []).filter(p => typeof p === 'string');
  const url = page.getURL();
  const host = perms.some(p => {
    if (!/[:/*<]/.test(p)) return false;
    try { return _extMenuModel.matchPattern(p, url); } catch { return false; }
  });
  const tab = { id: page.id, index: 0, windowId: 0, active: true, highlighted: true, selected: true, pinned: false,
    audible: page.isCurrentlyAudible(), discarded: false, autoDiscardable: true, incognito: false, groupId: -1,
    mutedInfo: { muted: page.isAudioMuted() }, status: page.isLoading() ? 'loading' : 'complete' };
  if (perms.includes('tabs') || perms.includes('activeTab') || host) { tab.url = url; tab.title = page.getTitle(); }
  return tab;
}
// A tab (page) id from the interface, if it is a page in that session.
function _extPage(ses, id) {
  const page = Number.isSafeInteger(id) && id > 0 ? webContents.fromId(id) : null;
  return page && !page.isDestroyed() && page.session === ses ? page : null;
}

// action.setPopup / the popup opened: one of the extension's own pages.
function _extPopupUrlOf(ext, page) {
  const u = new URL(String(page).replace(/^\/+/, ''), `chrome-extension://${ext.id}/`);
  if (u.protocol !== 'chrome-extension:' || u.host !== ext.id) throw new Error('A popup must be one of the extension\'s own pages');
  return u.href;
}
// The popup for a tab: what action.setPopup set for it or for every tab,
// else the manifest's. '' is none.
function _extPopupUrl(ses, ext, tabId, manifestPopup) {
  const page = _extUi.actionGet(_partitionKey(ses), ext.id, 'popup', tabId, { popup: manifestPopup || '' });
  return page ? _extPopupUrlOf(ext, page) : '';
}
// action.setIcon's imageData ({ width, height, data: RGBA numbers }, made
// plain by the stand-ins) as a PNG, or its path as a file of the extension.
function _extIconValue(ext, value) {
  if (value == null) return null;
  if (typeof value.path === 'string') {
    const root = path.resolve(ext.path);
    const full = path.resolve(root, value.path.replace(/^\/+/, ''));
    if (!full.startsWith(root + path.sep)) throw new Error('The icon must be a file of the extension');
    if (!fs.existsSync(full)) throw new Error(`Could not load the icon ${value.path}`);
    return full;
  }
  const img = value.imageData;
  if (img && Number.isInteger(img.width) && Number.isInteger(img.height) && img.width > 0 && img.height > 0 && img.width <= 256 && img.height <= 256
    && Array.isArray(img.data) && img.data.length === img.width * img.height * 4) {
    // Electron's bitmaps are BGRA.
    const buf = Buffer.alloc(img.data.length);
    for (let i = 0; i < img.data.length; i += 4) { buf[i] = img.data[i + 2]; buf[i + 1] = img.data[i + 1]; buf[i + 2] = img.data[i]; buf[i + 3] = img.data[i + 3]; }
    return nativeImage.createFromBitmap(buf, { width: img.width, height: img.height }).toDataURL();
  }
  throw new Error('setIcon needs imageData or a path');
}

// --- Asked by the extension (the stand-ins).
async function _extApi(senderUrl, ses, request) {
  const m = /^chrome-extension:\/\/([a-p]{32})\//.exec(String(senderUrl || ''));
  if (!m) throw new Error('Only an extension can ask this');
  const extId = m[1];
  const ext = _exts(ses).getExtension(extId);
  if (!ext) throw new Error('This extension is not loaded here');
  const r = request && typeof request === 'object' ? request : {};
  const args = r.args && typeof r.args === 'object' ? r.args : {};
  const manifest = ext.manifest || {};
  const partition = _partitionKey(ses);
  const perms = Array.isArray(manifest.permissions) ? manifest.permissions : [];
  const needMenus = () => { if (!perms.includes('contextMenus') && !perms.includes('menus')) throw new Error('The "contextMenus" permission is required'); };
  const needAction = () => { if (!manifest.action && !manifest.browser_action) throw new Error('This extension has no toolbar button in its manifest'); };
  const tabId = args.tabId == null ? null : args.tabId;
  if (tabId !== null && !_extPage(ses, tabId)) throw new Error(`No tab with id: ${tabId}.`);
  switch (r.op) {
    case 'menus.create': needMenus(); return _extUi.menusCreate(partition, extId, args.props);
    case 'menus.update': needMenus(); _extUi.menusUpdate(partition, extId, args.id, args.props); return undefined;
    case 'menus.remove': needMenus(); _extUi.menusRemove(partition, extId, args.id); return undefined;
    case 'menus.removeAll': needMenus(); _extUi.menusRemoveAll(partition, extId); return undefined;
    case 'action.set': {
      needAction();
      let value = args.value;
      if (args.prop === 'icon') value = _extIconValue(ext, value);
      if (args.prop === 'popup' && value) _extPopupUrlOf(ext, value); // refuses a page that is not the extension's
      _extUi.actionSet(partition, extId, args.prop, value, tabId);
      return undefined;
    }
    case 'action.get': {
      needAction();
      if (args.prop === 'popup') return _extPopupUrl(ses, ext, tabId, extHelpers.pickPages(manifest).popup);
      const own = (manifest.action || manifest.browser_action || {}).default_title;
      return _extUi.actionGet(partition, extId, args.prop, tabId, { title: typeof own === 'string' ? own : (ext.name || '') });
    }
    case 'commands.getAll': {
      const rows = _extCommands().byFolder[path.basename(ext.path)] || [];
      return rows.map(row => ({ name: row.name, description: row.description, shortcut: row.shortcut }));
    }
    default: throw new Error('Vex does not know ' + String(r.op));
  }
}
ipcMain.handle('extensions:api', (event, request) => _extApi(event.senderFrame?.url, event.sender.session, request));

// --- Asked by the interface.
ipcMain.handle('extensions:ui-state', () => _extUiSnapshot());

// A click on an extension's item in the page's right-click menu, or in its
// button's menu (ctx.kind 'action').
ipcMain.handle('extensions:menu-click', async (_event, request) => {
  const ses = _sessionForKey(request.partition);
  const ext = ses && _exts(ses).getExtension(request.id);
  if (!ext) throw new Error('That extension does not run in this tab (private and Tor tabs have none)');
  const page = _extPage(ses, request.tab);
  const ctx = { ...request.ctx };
  // The button's menu is about the tab in front, which the extension may
  // not be allowed to read.
  if (ctx.kind === 'action') ctx.pageUrl = (_extTabFor(ext, page) || {}).url || '';
  const { info } = _extUi.menusClick(request.partition, request.id, request.item, ctx);
  await _extDispatch(ses, request.id, 'menus.onClicked', [info, _extTabFor(ext, page)]);
  return true;
});

// A click on the button of an extension with no popup (chrome.action.onClicked).
ipcMain.handle('extensions:action-click', async (_event, request) => {
  const ses = _sessionForKey(request.partition);
  const ext = ses && _exts(ses).getExtension(request.id);
  if (!ext) throw new Error('That extension does not run in this tab (private and Tor tabs have none)');
  await _extDispatch(ses, request.id, 'action.onClicked', [_extTabFor(ext, _extPage(ses, request.tab))]);
  return true;
});

// --- Shortcuts.
// The Vex shortcut on a key, or null: main's own keys and the ones the
// interface's registry answers (_guestWantedKeys).
function _vexKeyLabel(combo) {
  return _extCmds.FIXED_VEX_KEYS.get(combo) || (_guestWantedKeys.has(combo) ? 'one of the shortcuts in Settings › Shortcuts' : null);
}
function _extCommands() {
  if (_extCommandsCache) return _extCommandsCache;
  let overrides = {};
  try { overrides = _extCmds.readOverrides(extensionsDir); _extCommandsError = null; }
  catch (err) { _extCommandsError = err.message; console.error('[Extensions]', err.message); }
  // persist:main holds every extension that is switched on. Descriptions
  // may be "__MSG_name__" placeholders, in the extension's own words.
  const entries = new Map(_extEntriesOnDisk().map(e => [path.resolve(e.path), e]));
  const exts = _exts(secureSessions.fromPartition('persist:main')).getAllExtensions()
    .map(ext => {
      const entry = entries.get(path.resolve(ext.path));
      return { folder: path.basename(ext.path), id: ext.id, name: (_extMeta().get(ext.id) || {}).name || ext.name, manifest: ext.manifest,
        localize: (text) => extHelpers.localize(text, entry ? entry.messages : Object.create(null)) };
    })
    .sort((a, b) => a.folder.localeCompare(b.folder));
  _extCommandsCache = _extCmds.resolve(exts, overrides, _vexKeyLabel);
  return _extCommandsCache;
}
// The interface's own keys changed: a key it gave up may now be an extension's.
function _extKeysChanged() { _extCommandsCache = null; }

// A key pressed in the window (contents null) or in a page. Taken before the
// page hears it, as Chrome does with an extension's shortcut; never a key
// Vex answers (resolve() leaves those out), never behind the lock screen, and
// in a page only when the extension is loaded in that page's session — so
// never in a private or Tor tab.
function handleExtensionCommandKey(event, input, contents) {
  if (!input || input.type !== 'keyDown' || !(input.control || input.alt || input.meta) || _vexLocked) return false;
  const combo = _extCmds.comboFromInput(input);
  if (!combo) return false;
  const hit = _extCommands().byCombo.get(combo);
  if (!hit) return false;
  if (contents && !_exts(contents.session).getExtension(hit.id)) return false;
  const win = contents ? _shortcutWindow(contents) : (mainWindow && !mainWindow.isDestroyed() ? mainWindow : null);
  if (!win) return false;
  event.preventDefault();
  _runExtensionCommand(hit, win, contents).catch(err => console.error(`[Extensions] the shortcut ${combo} for ${hit.folder} did not reach it:`, err.message));
  return true;
}
async function _runExtensionCommand(hit, win, page) {
  if (!page) {
    // The window's tab in front.
    const id = await win.webContents.executeJavaScript('(() => { const wv = WebviewManager.webviews.get(TabManager.activeTabId); try { return wv ? wv.getWebContentsId() : null; } catch { return null; } })()');
    const front = Number.isInteger(id) ? webContents.fromId(id) : null;
    page = front && !front.isDestroyed() ? front : null;
  }
  const ses = page ? page.session : secureSessions.fromPartition('persist:main');
  const ext = _exts(ses).getExtension(hit.id);
  if (!ext) throw new Error('the tab in front is in a session without it (a private or Tor tab, or a panel it does not run in)');
  if (_extCmds.ACTION_COMMANDS.has(hit.command)) {
    win.webContents.send('extensions:run-action', { id: hit.id, folder: hit.folder, partition: _partitionKey(ses), tab: page ? page.id : null });
    return;
  }
  await _extDispatch(ses, hit.id, 'commands.onCommand', [hit.command, _extTabFor(ext, page)]);
}

ipcMain.handle('extensions:commands', () => ({ byFolder: _extCommands().byFolder, error: _extCommandsError }));
// Give a command a key you pressed, take its key away (key null), or put
// back the extension's own (reset). A Vex key or another extension's is refused.
ipcMain.handle('extensions:set-command-key', (_event, request) => {
  const { folder, command } = request;
  const rows = _extCommands().byFolder[folder];
  if (!rows || !rows.some(r => r.name === command)) return { ok: false, error: 'That extension has no such shortcut, or is not switched on' };
  let combo = '';
  if (request.key) {
    combo = _extCmds.comboFromInput(request.key);
    if (!combo) return { ok: false, error: 'That key cannot be a shortcut' };
    const checked = _extCmds.checkCombo(combo);
    if (checked.error) return { ok: false, error: checked.error };
    const vex = _vexKeyLabel(combo);
    if (vex) return { ok: false, error: `${_extCmds.toChrome(combo)} is taken by Vex: ${vex}` };
    const taken = _extCommands().byCombo.get(combo);
    if (taken && !(taken.folder === folder && taken.command === command)) {
      const other = (_extMeta().get(taken.id) || {}).name || taken.folder;
      return { ok: false, error: `${_extCmds.toChrome(combo)} is already ${other}'s shortcut` };
    }
  }
  let overrides;
  try { overrides = _extCmds.readOverrides(extensionsDir); }
  catch (err) { return { ok: false, error: err.message }; }
  const mine = overrides[folder] || {};
  if (request.reset) delete mine[command];
  else mine[command] = combo;
  if (Object.keys(mine).length) overrides[folder] = mine;
  else delete overrides[folder];
  try { _extCmds.writeOverrides(extensionsDir, overrides); }
  catch (err) { return { ok: false, error: `Could not save it: ${err.message}` }; }
  _extCommandsCache = null;
  const row = (_extCommands().byFolder[folder] || []).find(r => r.name === command);
  return { ok: true, shortcut: row ? row.shortcut : '', conflict: row ? row.conflict : null, conflictWith: row ? row.conflictWith : null };
});

// Windows keeps a border on a frameless, non-resizable window that Electron
// does not count, and ignores a size that would make it smaller: popups came
// up 16x8 px short, with scroll bars, and never shrank again (found
// 2026-09-29). Setting the CONTENT size while the window is briefly resizable
// lands exactly on the page's size, both ways. It is moved first: Electron
// still believes the smaller size, and a move after the resize put it back.
function _setPopupContentSize(win, w, h, x, y) {
  win.setPosition(x, y);
  win.setResizable(true);
  win.setContentSize(w, h);
  win.setResizable(false);
}
ipcMain.handle('extensions:open-popup', async (_e, request) => {
  try {
    const folderName = request && request.folder;
    let extPath;
    try {
      extPath = safeJoin(extensionsDir, safeName(folderName));
    } catch (err) {
      console.warn('[Extensions] open-popup rejected unsafe folderName:', folderName, err.message);
      return { ok: false, error: 'Invalid folder name' };
    }
    const entry = _extEntries().find(e => path.resolve(e.path) === path.resolve(extPath));
    if (!entry || !entry.manifest) return { ok: false, error: 'Not found' };
    const pages = extHelpers.pickPages(entry.manifest);

    // Over a container tab the popup belongs in the container's session: from
    // persist:main the extension cannot see that tab, and Dark Reader said
    // "This page is protected by browser" about it (found 2026-09-29).
    let tabUnder = null;
    if (Number.isInteger(request.tab)) {
      const wc = webContents.fromId(request.tab);
      if (wc && !wc.isDestroyed() && wc.getType() === 'webview') tabUnder = wc;
    }
    const isThis = x => path.resolve(x.path) === path.resolve(extPath);
    let ses = secureSessions.fromPartition('persist:main');
    if (tabUnder && tabUnder.session !== ses && tabUnder.session.getAllExtensions().some(isThis)) ses = tabUnder.session;
    const live = ses.getAllExtensions().find(isThis);
    if (!live) return { ok: false, error: 'That extension is not loaded — enable it first' };
    // The popup the extension set for this tab or for all (action.setPopup),
    // else its manifest's; '' is none.
    const popupUrl = _extPopupUrl(ses, live, tabUnder && tabUnder.session === ses ? tabUnder.id : null, pages.popup);
    if (!popupUrl) return { ok: false, error: 'This extension has no toolbar popup' };

    if (_extPopupWindow && !_extPopupWindow.isDestroyed()) _extPopupWindow.destroy();
    const win = new BrowserWindow({
      width: 360, height: 480, show: false, frame: false, resizable: false,
      minimizable: false, maximizable: false, fullscreenable: false, skipTaskbar: true,
      parent: (mainWindow && !mainWindow.isDestroyed()) ? mainWindow : undefined,
      webPreferences: { session: ses, contextIsolation: true, nodeIntegration: false, enablePreferredSizeMode: true }
    });
    _extPopupWindow = win;
    // A popup's content can change size after it loads: Dark Reader's is a
    // "Loading, please wait" line until its data arrives, then 580px tall, and
    // it showed in a 500px window with scroll bars (2026-09-28). Chrome resizes
    // the popup to follow; so does this, keeping it centred under the button.
    // The page's scroll size never comes out below the window, so a popup could
    // only grow: Stylus's 246x117 page sat in a 328x464 box (found 2026-09-29).
    // The event's preferred size is the content's own size, and is the target;
    // it can come out smaller than a page that lays out wider once it has room
    // (Dark Reader's clipped), so the page is then measured and the window
    // grows to whatever still overflows.
    let preferred = null;
    const measurePopup = (w, h) => win.webContents.executeJavaScript(
      `new Promise(done => { const t0 = Date.now(); (function check() {
        if ((innerWidth === ${w} && innerHeight === ${h}) || Date.now() - t0 > 300) done({ w: Math.ceil(document.documentElement.scrollWidth), h: Math.ceil(document.documentElement.scrollHeight), iw: innerWidth, ih: innerHeight });
        else setTimeout(check, 16);
      })(); })`
    );
    const fitPopup = async () => {
      if (win.isDestroyed()) return;
      let [cw, ch] = win.getContentSize();
      if (preferred) {
        const [w, h] = extHelpers.clampPopupSize(preferred.width, preferred.height);
        if (w !== cw || h !== ch) {
          const [x, y] = win.getPosition();
          _setPopupContentSize(win, w, h, Math.max(0, x + Math.round((cw - w) / 2)), y);
          [cw, ch] = [w, h];
        }
      }
      const size = await measurePopup(cw, ch)
        .catch(err => { if (!win.isDestroyed()) console.error('[Extensions] popup re-measure failed:', err.message); return null; });
      if (!size || win.isDestroyed() || ![size.w, size.h, size.iw, size.ih].every(Number.isFinite)) return;
      if (size.w <= size.iw && size.h <= size.ih) return;
      const [w, h] = extHelpers.clampPopupSize(Math.max(size.w, size.iw), Math.max(size.h, size.ih));
      if (w === size.iw && h === size.ih) return;
      const [x, y] = win.getPosition();
      _setPopupContentSize(win, w, h, Math.max(0, x + Math.round((size.iw - w) / 2)), y);
    };
    win.webContents.on('preferred-size-changed', (_event, size) => {
      preferred = size;
      if (win.isVisible()) fitPopup().catch(err => console.error('[Extensions] popup fit failed:', err.message));
    });
    // Electron calls the focused page the active tab, and the popup takes the
    // focus: Dark Reader's popup said "This page is protected by browser"
    // about itself (2026-09-28). Remember the tab it was opened over.
    const under = tabUnder && tabUnder.session === ses ? tabUnder.id : null;
    const activeTab = Array.isArray(entry.manifest.permissions) && entry.manifest.permissions.includes('activeTab');
    _extPopupOver = { extId: live.id, session: ses, popup: win.webContents.id, tab: under, grant: activeTab && under != null ? _originOf(tabUnder.getURL()) : null };
    win.on('blur', () => { if (!win.isDestroyed()) win.close(); });
    win.on('closed', () => { if (_extPopupWindow === win) { _extPopupWindow = null; _extPopupOver = null; } });
    // A link in the popup (target=_blank, window.open) closed the popup and
    // opened nothing: RoSuite's GitHub and Report Bug links, Return YouTube
    // Dislike's (found 2026-09-29). It opens as a Vex tab, the way Chrome does.
    win.webContents.setWindowOpenHandler(({ url }) => {
      const notOpened = (err) => {
        console.error('[Extensions] popup link not opened:', err.message);
        if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('vex:toast', `Not opened: ${err.message}`);
      };
      try { _openTabForExtension(`chrome-extension://${live.id}/`, ses, { url }).catch(notOpened); }
      catch (err) { notOpened(err); }
      if (!win.isDestroyed()) win.close();
      return { action: 'deny' };
    });
    // Escape closes a popup in Chrome; here it did nothing (found 2026-09-29).
    win.webContents.on('before-input-event', (event, input) => {
      if (input.type === 'keyDown' && input.key === 'Escape') { event.preventDefault(); if (!win.isDestroyed()) win.close(); }
    });

    await win.loadURL(popupUrl);
    // The content's preferred size once it has laid out; a page that has not
    // reported one yet is measured, and follows when it does.
    let first = preferred ? { w: preferred.width, h: preferred.height } : await win.webContents.executeJavaScript(
      '({ w: Math.ceil(document.documentElement.scrollWidth), h: Math.ceil(document.documentElement.scrollHeight) })'
    ).catch(err => { console.error('[Extensions] popup measure failed:', err.message); return null; });
    if (first && !(Number.isFinite(first.w) && Number.isFinite(first.h))) first = null;
    const [w, h] = first ? extHelpers.clampPopupSize(first.w, first.h) : win.getContentSize();
    const [x, y] = Number.isInteger(request.x) && Number.isInteger(request.y)
      ? [Math.max(0, request.x - Math.round(w / 2)), Math.max(0, request.y)]
      : win.getPosition();
    _setPopupContentSize(win, w, h, x, y);
    win.show();
    win.focus();
    // Not every growth raises preferred-size-changed: Return YouTube Dislike's
    // popup stayed 296px wide against its 339px page (found 2026-09-29).
    for (const ms of [0, 300, 1000]) setTimeout(() => { fitPopup().catch(err => console.error('[Extensions] popup fit failed:', err.message)); }, ms);
    return { ok: true, id: live.id };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

// A partition created after startup (a container tab, a panel repointed at a
// new partition) would otherwise run with no extensions at all.
app.on('web-contents-created', (_event, contents) => {
  if (contents.getType() !== 'webview') return;
  _trackSessionUse(contents);
  _coverNewSession(contents.session)
    .catch(err => console.error('[Extensions] new-session coverage failed:', err.message));
  // A badge set for this tab alone goes with it (as in Chrome).
  const tabId = contents.id;
  contents.once('destroyed', () => _extUi.forgetTab(tabId));
});

// Load installed extensions once the app is ready
app.whenReady().then(() => {
  loadAllExtensionsOnStartup().catch(err => console.error('[Extensions] startup load failed:', err.message))
    // Then the update checks (main/extension-updates.js): not in safe mode,
    // which exists to start without extensions doing anything.
    .then(() => { if (!_boot.safeMode) _extUpdater().start(); });
});

// === External protocol forwarding ===
// Custom-scheme URLs (roblox://, mailto:, discord://, etc.) aren't handled by
// Chromium — by default they error with ERR_UNKNOWN_URL_SCHEME inside a
// webview. Forward recognised ones to the OS via shell.openExternal so the
// installed desktop app launches. Note: webRequest.onBeforeRequest is a
// network-pipeline hook and never sees non-http schemes, so intercept at the
// navigation layer (will-navigate + setWindowOpenHandler) instead.
//
// Returns true when the URL is such a link: the navigation is then always
// stopped, and whether the program opens is decided here. It used to open at
// once, for any page or ad frame, with no click and no question, from Tor tabs
// too (security scan H1). Now: never from a private, off-the-record, burner or
// Tor page; only shortly after a click or key press on the page; and only once
// the person has said yes for that site and kind of link (the site-permission
// prompt; Settings > Site permissions lists and revokes the answer).
const _lastGestureAt = new Map();   // page id -> when it last had a click or key press
function _watchGestures(contents) {
  const id = contents.id;
  contents.on('input-event', (_e, input) => {
    if (input && _mainHelpers.GESTURE_INPUT_TYPES.has(input.type)) _lastGestureAt.set(id, Date.now());
  });
  contents.once('destroyed', () => _lastGestureAt.delete(id));
}
// A pop-up (a window the page opened with no click or key from you) on a site
// whose pop-ups are blocked in its site panel. Said in the window, once in a
// while, so a site that "does nothing" is explained.
const _popupRefusalSaid = new Map();      // page id -> when the window was last told
// What the page's own window.open said just before asking (preload-webview.js,
// vexPopupActivation): whether its frame had transient user activation — the
// test Chrome's pop-up blocker uses. Sent synchronously, so it is here before
// the window request it belongs to.
const _popupActivation = new Map();       // page id -> { active, at }
ipcMain.on('popup:activation', (e, active) => {
  const id = e.sender.id;
  if (!_popupActivation.has(id)) e.sender.once('destroyed', () => _popupActivation.delete(id));
  _popupActivation.set(id, { active: active === true, at: Date.now() });
  e.returnValue = true;
});
const POPUP_ACTIVATION_MS = 5000;         // Chromium's transient activation lifespan
function _popupActivated(contents) {
  const said = _popupActivation.get(contents.id);
  _popupActivation.delete(contents.id);
  if (said && Date.now() - said.at < 2000) return said.active;
  // A frame the check could not reach (another site's frame in the page):
  // a click or key in the last five seconds, as long as activation lasts.
  const last = _lastGestureAt.get(contents.id);
  return Number.isFinite(last) && Date.now() - last <= POPUP_ACTIVATION_MS;
}
function _popupRefused(contents, openerUrl) {
  if (_popupActivated(contents)) return false;
  let origin;
  try { origin = new URL(openerUrl).origin; } catch { return false; }
  if (!/^https?:/.test(origin)) return false;
  if (savedDecision(decisionsFor(contents), origin, ['popups'], sessionDecisionsFor(contents)) !== 'deny') return false;
  console.log(`[new-window] pop-up from ${origin} refused: pop-ups are blocked for this site`);
  const host = secureSessions.owner(contents);
  if (host && !host.win.isDestroyed() && Date.now() - (_popupRefusalSaid.get(contents.id) || 0) > 10000) {
    _popupRefusalSaid.set(contents.id, Date.now());
    host.win.webContents.send('vex:toast', `Blocked a pop-up from ${new URL(origin).hostname} — allow pop-ups from the site icon in the address bar`);
  }
  return true;
}
const _externalRefusalSaid = new Map();   // page id|scheme -> when the window was last told
function handleExternalProtocol(url, contents) {
  const scheme = _mainHelpers.externalScheme(url);
  if (!scheme) return false;
  const app = _mainHelpers.externalAppName(scheme);
  const gesture = _mainHelpers.hasRecentGesture(_lastGestureAt.get(contents.id));
  const host = secureSessions.owner(contents);
  if (_mainHelpers.refusesExternalApps(secureSessions.partitionOf(contents), contents.session)) {
    console.log(`[Protocol] not opening a ${scheme}: link from a private, off-the-record or Tor page`);
    // Said once in a while, and only when the person did something: an ad
    // trying it on its own is refused without a word.
    const key = contents.id + '|' + scheme;
    if (gesture && host && !host.win.isDestroyed() && Date.now() - (_externalRefusalSaid.get(key) || 0) > 10000) {
      _externalRefusalSaid.set(key, Date.now());
      host.win.webContents.send('vex:toast', `Vex does not open ${app} from a private, off-the-record or Tor tab`);
    }
    return true;
  }
  if (!gesture) { console.log(`[Protocol] not opening a ${scheme}: link nobody clicked`); return true; }
  let origin;
  try { origin = new URL(contents.getURL()).origin; } catch { origin = ''; }
  if (!origin || origin === 'null') { console.log(`[Protocol] not opening a ${scheme}: link from a page with no site`); return true; }
  const remote = _mainHelpers.opensRemoteDocument(url);
  askExternalApp(contents, origin, scheme, {
    app,
    detail: remote ? 'It opens a file from the internet in that program, outside Vex.' : 'A program on your computer, outside Vex.',
    noRemember: remote,
  }).then((ok) => {
    if (!ok || contents.isDestroyed()) return;
    console.log(`[Protocol] opening a ${scheme}: link in ${app}`);
    return shell.openExternal(url);
  }).catch(err => console.error('[Protocol] could not open the link in another program:', err.message));
  return true;
}

// Per-webContents throttle for the Claude-panel auto-Google-login click, so a
// cancelled/failed OAuth can't loop back into re-clicking. wcId -> last attempt.
const _claudeGoogleClick = new Map();

// === Route webview new-window requests into Vex tabs (not new BrowserWindows) ===
// The renderer's webview 'new-window' DOM event is legacy and unreliable in
// Electron 30+. setWindowOpenHandler in main is the supported path.
app.on('web-contents-created', (_event, contents) => {
  // Tor tabs: stop WebRTC from leaking the real IP around the SOCKS proxy.
  // disable_non_proxied_udp forces any WebRTC traffic through the proxy (Tor
  // can't carry UDP, so it's effectively disabled — exactly what we want).
  // Before the webview check: a popup window a Tor page opens (window.open
  // with features) has the Tor session too, and was left unlocked
  // (found 2026-09-29). A session routed through a proxy gets the same lock
  // (found 2026-09-30).
  try { if (contents.session && (contents.session.__vexTor || contents.session.__vexRouted)) contents.setWebRTCIPHandlingPolicy('disable_non_proxied_udp'); } catch {}
  // A private window and an off-the-record or burner tab: WebRTC shows sites
  // only the public address, never the computer's own on the local network
  // (security scan H2, L10). routing.markRoutedSession keeps this when such a
  // session is set back to direct.
  if (contents.session && contents.session.__vexEphemeral && !contents.session.__vexRouted) contents.setWebRTCIPHandlingPolicy('default_public_interface_only');
  // A page opening in a Tor session keeps Tor running; any page closing may
  // be the last use, which starts the idle countdown (found 2026-09-30). Every
  // page is watched: a burner or container can be routed through Tor after
  // its tab is already open.
  if (contents.session && contents.session.__vexTor) _torIdleCheck();
  contents.once('destroyed', () => { if (_torLauncher.isRunning()) setImmediate(_torIdleCheck); });
  // A page in a Tor route whose Tor has stopped starts it again (a tab opened
  // in it starts with a navigation too); a page that cannot load because Tor
  // is down says so in its tab instead of staying blank (found 2026-09-30).
  contents.on('did-start-navigation', (_e, url, isInPlace, isMainFrame) => {
    const ses = contents.session;
    if (isMainFrame && !isInPlace && ses && ses.__vexTorDown && ses.__vexTorRevive && /^https?:/i.test(url)) _reviveTor(contents);
  });
  contents.on('did-fail-load', (_e, errorCode, _desc, _url, isMainFrame) => {
    const ses = contents.session;
    if (!isMainFrame || errorCode === -3 || !ses || !ses.__vexTorDown) return;
    if (ses.__vexTorRevive && _torRevival.running) { _torRevival.waiting.add(contents); _torPageDown(contents, 'starting'); }
    else _torPageDown(contents, ses.__vexTorRevive ? 'failed' : 'stopped');
  });

  // Only intercept for webviews hosting tabs — never for the main window or
  // for extension background pages (those need their own window.open semantics).
  const type = contents.getType();
  if (type !== 'webview') return;

  // Media grabber: hook this guest's session (once) to record media URLs, and
  // reset the tab's list on a real navigation / when the tab goes away.
  try { wireMediaSnifferOnSession(contents.session); } catch {}
  contents.on('did-start-navigation', (_e, _url, isInPlace, isMainFrame) => {
    if (isMainFrame && !isInPlace) { try { _mediaByWc.delete(contents.id); } catch {} }
  });
  const createdContentsId = contents.id;
  contents.on('destroyed', () => {
    _mediaByWc.delete(createdContentsId);
    _httpsUpgradedByWc.delete(createdContentsId);
    _claudeGoogleClick.delete(createdContentsId);
  });

  // HTTPS-Only fallback: if a page WE upgraded to https can't load (no https, SSL
  // failure, reset…), drop that host back to http for the rest of the session so
  // the site still works. Scoped strictly to our own upgrades (never a downgrade
  // of a site the user asked for over https). ERR_ABORTED (-3) is a superseded
  // navigation, not a real failure — ignore it.
  contents.on('did-fail-load', (_e, errorCode, _desc, validatedURL, isMainFrame) => {
    if (!isMainFrame || !privacyCfg.httpsOnly || errorCode === -3) return;
    let u; try { u = new URL(validatedURL); } catch { return; }
    if (u.protocol !== 'https:') return;
    const bare = u.hostname.replace(/^www\./, '');
    const s = _httpsUpgradedByWc.get(contents.id);
    if (!s || !s.has(bare)) return;               // only OUR upgrades fall back
    s.delete(bare);
    // A certificate error (net::ERR_CERT_*, -200 to -299) is what someone
    // in the middle of the connection causes; falling back to http then hands
    // them the page in the clear without a word (security scan L13). The tab
    // says so instead, and loads it unencrypted only if the person asks.
    if (errorCode <= -200 && errorCode >= -299) {
      _httpsOnlyBypass.set(bare, Date.now() + 120000);
      const plainUrl = 'http://' + u.host + u.pathname + u.search + u.hash;
      contents.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(_httpsCertNotice(u.host, plainUrl))).catch(err => {
        if (err && (err.errno === -3 || /ERR_ABORTED/.test(err.message))) return;
        console.warn('[HTTPS-Only] could not show the certificate notice:', err && err.message);
      });
      return;
    }
    _httpsOnlyFailed.add(bare);
    const httpUrl = 'http://' + u.host + u.pathname + u.search + u.hash;
    // loadURL rejects when the load fails, and that went unhandled (found
    // 2026-09-30). ERR_ABORTED (-3) is the page going somewhere else first;
    // any other failure is shown in the tab by Chromium, and logged here.
    contents.loadURL(httpUrl).catch(err => {
      if (err && (err.errno === -3 || /ERR_ABORTED/.test(err.message))) return;
      console.warn('[HTTPS-Only] could not load ' + httpUrl + ' over http:', err && err.message);
    });
    try { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('vex:toast', bare + ' has no HTTPS — loaded over an unencrypted connection'); } catch {}
  });
  // A clean main-frame load means there's no pending upgrade left to fall back
  // for on this tab — clearing avoids a stale entry ever downgrading a later nav.
  contents.on('did-finish-load', () => { try { _httpsUpgradedByWc.delete(contents.id); } catch {} });

  // Claude panel: auto-continue login with Google. Claude's "Continue with
  // Google" opens the OAuth popup via window.open, which the browser only allows
  // under transient USER ACTIVATION — a page script's plain .click() (and even
  // main's sendInputEvent) don't grant it, so the popup is silently blocked
  // (proven live). executeJavaScript(code, true) DOES run with a user gesture, so
  // the button's .click() → window.open is permitted. Scoped to the Claude PANEL
  // session (persist:claude) + its login page; throttled per tab so a cancelled
  // login can't loop.
  contents.on('did-finish-load', async () => {
    try {
      const sp = contents.session && contents.session.getStoragePath && contents.session.getStoragePath();
      const m = /[\\/]Partitions[\\/]([^\\/]+)$/.exec(sp || '');
      if (!m || m[1] !== 'claude') return;                       // Claude panel only
      if (!/claude\.ai\/login/i.test(contents.getURL() || '')) return; // login page only
      const last = _claudeGoogleClick.get(contents.id) || 0;
      if (Date.now() - last < 30000) return;                     // throttle: no loop on cancel
      const clickJs = "(function(){var ns=document.querySelectorAll('button,a,[role=button]');for(var i=0;i<ns.length;i++){var n=ns[i];var t=((n.textContent||'')+' '+(n.getAttribute('aria-label')||'')).toLowerCase();if(t.indexOf('continue with google')>=0||t.indexOf('sign in with google')>=0){var r=n.getBoundingClientRect();if(r.width>0&&r.height>0){n.click();return true;}}}return false;})()";
      for (let i = 0; i < 12; i++) {
        if (contents.isDestroyed()) return;
        // userGesture=true → the .click()'s window.open passes the activation gate.
        const clicked = await contents.executeJavaScript(clickJs, true).catch(() => false);
        if (clicked) { _claudeGoogleClick.set(contents.id, Date.now()); console.log('[claude-auto-google] clicked Continue with Google'); return; }
        await new Promise(r => setTimeout(r, 400));
      }
    } catch { /* ignore */ }
  });

  // (Gmail webview popup-intercept removed — Gmail now uses native IMAP/SMTP
  // via main/gmail/, no webview. persist:gmail partition is kept in the
  // partitions array in case a future OAuth flow reuses it.)

  // Resolve THIS webContents' (the opener tab's) partition string so popups we
  // allow can be pinned EXPLICITLY to the SAME session — not the default
  // session, not a fresh one.
  //
  // getLastWebPreferences() does NOT expose `partition` for webview guests
  // (verified: scripts/verify-oauth-popup-partition.js), so derive it from the
  // opener session's on-disk partition path instead:
  //     <userData>/Partitions/<name>  ->  persist:<name>
  // This is reliable for persist:main and the container tabs (persist:container-*).
  //
  // DELIBERATE EXCEPTION — off-the-record tabs ('otr-<ts>') use an IN-MEMORY
  // partition with NO on-disk storage path, so the partition string is NOT
  // derivable here (and getLastWebPreferences omits `partition`). We return null
  // and let the popup INHERIT the opener's session implicitly. This is correct,
  // not a gap to be "fixed": scripts/verify-oauth-popup-partition.js (Scenario B)
  // proves inheritance yields popup.session === opener.session === the OTR jar,
  // the auth cookie lands in that OTR session and NOT in persist:main, and the
  // jar stays ephemeral (no storage path, no Partitions dir). There is no
  // partition string to set for an in-memory session; making OTR "explicit"
  // would require a renderer→main webContents-id→partition registry, which we
  // deliberately chose NOT to build. Do not force a partition here.
  const resolveOpenerPartition = () => {
    try {
      const wp = typeof contents.getLastWebPreferences === 'function' ? contents.getLastWebPreferences() : null;
      if (wp && typeof wp.partition === 'string' && wp.partition) return wp.partition; // future-proof
    } catch { /* ignore */ }
    try {
      const p = contents.session && contents.session.getStoragePath && contents.session.getStoragePath();
      if (p) {
        const m = /[\\/]Partitions[\\/]([^\\/]+)$/.exec(p);
        if (m) return 'persist:' + m[1];
      }
    } catch { /* ignore */ }
    return null;
  };
  // Set by the OAuth/scripted-popup allow branches just before they return, and
  // read once in did-create-window (which fires synchronously right after the
  // handler returns, before any other popup can open). Marks a popup that should
  // get the Peek-style look: frameless, parented, centered over a dimmed Vex.
  let pendingPeekPopup = false;
  // Set by the Discord pop-out branch just before it returns; read once in
  // did-create-window so the new window can restore its remembered size/position
  // and behave like a picture-in-picture stream window (always-on-top, toggle).
  let pendingDiscordPopout = false;

  // Build overrideBrowserWindowOptions for an allowed popup, pinning it to the
  // opener tab's partition explicitly (the actual fix for container/OTR cases).
  // opts.peek -> dress it as the in-app Peek overlay (a frameless card centered
  // over the main window). It stays a REAL opener-connected window — Peek the
  // overlay can't host the opener, but a frameless child window can, so this is
  // how we keep the login working while restoring the old in-app look.
  const popupOverrides = (opts = {}) => {
    const webPreferences = { contextIsolation: true, nodeIntegration: false };
    const part = resolveOpenerPartition();
    if (part) webPreferences.partition = part;
    const base = { autoHideMenuBar: true, webPreferences };
    if (!opts.peek) return base;
    // A compact landscape rectangle in the Peek style — big enough for an OAuth
    // consent screen, clamped so it never dominates the display.
    let width = 720, height = 560;
    try {
      const wa = require('electron').screen.getPrimaryDisplay().workAreaSize;
      width = Math.min(760, Math.round(wa.width * 0.5));
      height = Math.min(620, Math.round(wa.height * 0.64));
    } catch { /* fall back to defaults */ }
    return {
      ...base,
      parent: (mainWindow && !mainWindow.isDestroyed()) ? mainWindow : undefined,
      frame: false,
      center: true,
      width,
      height,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      backgroundColor: '#0a0c10',
      hasShadow: true,
    };
  };

  // Diagnostic proof: every popup we ALLOW (OAuth/print) creates a window here.
  // Log whether its session is literally the opener's session and where each
  // partition stores on disk — so "the cookie landed in the right partition" is
  // observable, not assumed. (Denied/Peek popups never create a window.)
  contents.on('did-create-window', (win, details) => {
    secureSessions.linkGuest(win.webContents, contents);
    try {
      const openerSes = contents.session;
      const popupSes = win.webContents.session;
      console.log('[popup-session] partition=%s sameSession=%s openerStorage=%s popupStorage=%s url=%s',
        resolveOpenerPartition() || '(inherited/default)',
        popupSes === openerSes,
        (openerSes.getStoragePath && openerSes.getStoragePath()) || '(in-memory)',
        (popupSes.getStoragePath && popupSes.getStoragePath()) || '(in-memory)',
        (details && details.url) || '(no url)');
    } catch (err) { console.error('[popup-session] log failed:', err.message); }

    // Autofill saved credentials into sign-in POPUP windows (OAuth "Sign in with
    // Google", etc.). These are separate BrowserWindows, so the renderer's
    // PasswordVault never reaches them. Fires on each load — covers the
    // email→password step and async-rendered fields. NOT for the Discord stream
    // pop-out: it's a video window, never a login form, and there's no reason to
    // run field-scanning JS inside it while it's setting up a WebRTC stream.
    if (!pendingDiscordPopout) {
      // The try/catch must be INSIDE the callback: wrapping only the .on() call
      // leaves a throw here to escape through the emitter as an uncaught main
      // process exception, which Electron shows as a modal error dialog over the
      // user's sign-in popup.
      try { win.webContents.on('did-finish-load', () => {
        try { _autofillPopup(win.webContents, { partition: secureSessions.partitionOf(win.webContents) }); } catch (err) { console.error('[popup-autofill] failed:', err && err.message); }
      }); } catch {}
      // Sign-in popups (Google/Microsoft OAuth) also trigger the OS passkey /
      // "Windows Security" dialog. Popups don't get site-tweaks (no guest
      // preload), so disable WebAuthn get() here too, on each load. Runs before
      // the user reaches the passkey step, so the prompt never appears.
      try { win.webContents.on('did-finish-load', () => { try {
        if (_passkeySuppressed(new URL(win.webContents.getURL()).hostname)) win.webContents.executeJavaScript(_WEBAUTHN_DISABLE_JS).catch(() => {});
      } catch {} }); } catch {}
    }

    // Peek-style auth popup: dim Vex behind it, allow Esc / backdrop-click to
    // dismiss (frameless windows have no native close button), and clear the dim
    // when it closes (incl. the provider's own window.close() on success).
    const isPeek = pendingPeekPopup;
    pendingPeekPopup = false;
    if (isPeek) {
      _activePeekOAuthPopup = win;
      try { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('oauth-popup:open'); } catch {}
      try {
        win.webContents.on('before-input-event', (_e, input) => {
          if (input && input.type === 'keyDown' && input.key === 'Escape') {
            try { if (!win.isDestroyed()) win.close(); } catch {}
          }
        });
      } catch {}

      // Overlay the Peek chrome bar (back · reload · url · Open as tab · copy ·
      // close) across the top of the auth content. The auth web contents fills
      // the window and can't be inset (it's not a contentView child — proven by
      // scripts/probe-popup-chrome.js), so the bar sits over the top ~44px; OAuth
      // consent cards are vertically centered, so the Authorize button stays clear.
      const BAR_H = 44;
      let chromeView = null;
      try {
        const { WebContentsView } = require('electron');
        chromeView = new WebContentsView({ webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, preload: path.join(__dirname, 'preload-popup-chrome.js') } });
        chromeView.webContents.on('will-navigate', event => event.preventDefault());
        chromeView.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
        win.contentView.addChildView(chromeView);
        const layout = () => {
          try { const [w] = win.getContentSize(); chromeView.setBounds({ x: 0, y: 0, width: w, height: BAR_H }); } catch {}
        };
        layout();
        win.on('resize', layout);
        chromeView.webContents.loadFile(path.join(__dirname, 'renderer', 'popup-chrome.html'));
        _peekChromeByWc.set(chromeView.webContents.id, win);
        const pushUrl = () => { try { chromeView.webContents.send('popup-chrome:url', win.webContents.getURL()); } catch {} };
        chromeView.webContents.on('did-finish-load', pushUrl);
        // The bar wears the user's colours. Main can't know the theme, so read
        // the resolved tokens off the main window (which follows the theme AND
        // the GUI style) and hand them over; the bar was hard-coded dark before.
        const pushPalette = async () => {
          if (!mainWindow || mainWindow.isDestroyed()) return;
          try {
            const palette = await mainWindow.webContents.executeJavaScript(`(() => {
              const cs = getComputedStyle(document.body);
              const g = (n, fb) => (cs.getPropertyValue(n) || '').trim() || fb;
              return { surface: g('--surface', '#151921'), bg: g('--bg', '#0a0c10'), bg2: g('--bg-2', '#0f1218'),
                border: g('--border', '#1f2530'), text: g('--text', '#e5e9f0'), textMuted: g('--text-muted', '#6b7482'),
                primary: g('--primary', '#6366f1'), danger: g('--danger', '#ef4444') };
            })()`);
            if (!chromeView.webContents.isDestroyed()) chromeView.webContents.send('popup-chrome:palette', palette);
          } catch (err) { console.error('[peek-popup] palette push failed:', err.message); }
        };
        chromeView.webContents.on('did-finish-load', pushPalette);
        win.webContents.on('did-navigate', pushUrl);
        win.webContents.on('did-navigate-in-page', pushUrl);
      } catch (err) { console.error('[peek-popup] chrome bar setup failed:', err.message); }

      win.on('closed', () => {
        if (_activePeekOAuthPopup === win) _activePeekOAuthPopup = null;
        try { if (chromeView) _peekChromeByWc.delete(chromeView.webContents.id); } catch {}
        try { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('oauth-popup:close'); } catch {}
      });
    }

    // Discord stream / screen-share pop-out: make it behave like a real
    // picture-in-picture window — restore its last size/position, float it on
    // top by default (so you can watch a friend's screen while doing other
    // things), and let Ctrl+Shift+P toggle the on-top pin. State persists in
    // userData/popout-state.json so it opens where you left it next time.
    const isDiscordPopout = pendingDiscordPopout;
    pendingDiscordPopout = false;
    if (isDiscordPopout) {
      try {
        const st = readPopoutState();
        if (st.bounds && Number.isFinite(st.bounds.width) && Number.isFinite(st.bounds.height)) {
          try { win.setBounds(st.bounds); } catch {}
        }
        // `onTop` is the user's pin PREFERENCE. We use the gentle 'floating'
        // level (not 'screen-saver', which sits above fullscreen apps and traps
        // Alt+Tab), and we DROP always-on-top entirely while the pop-out itself
        // is fullscreen — an always-on-top fullscreen window blocks app
        // switching. It's restored when leaving fullscreen.
        let onTop = st.alwaysOnTop !== false; // default ON (PiP-like)
        // A pop-out that (nearly) fills the screen must NOT stay always-on-top: a
        // topmost full-size window covers everything, so Alt+Tab switches focus
        // but you still can't SEE what you switched to — you have to minimize the
        // pop-out first (the "can't Alt+Tab out of it" trap). So the PiP float
        // only applies while it's a genuinely small window; a big one behaves as a
        // normal window. Re-checked on resize, so shrinking it makes it float and
        // growing it releases the float.
        const coversScreen = () => {
          try {
            const b = win.getBounds();
            const wa = require('electron').screen.getDisplayMatching(b).workAreaSize;
            return (b.width * b.height) >= (wa.width * wa.height) * 0.6;
          } catch { return false; }
        };
        const applyOnTop = () => {
          try { win.setAlwaysOnTop(onTop && !win.isFullScreen() && !coversScreen(), 'floating'); } catch {}
        };
        applyOnTop();

        const persist = () => {
          try {
            if (win.isDestroyed()) return;
            const cur = readPopoutState();
            if (!win.isMinimized() && !win.isMaximized() && !win.isFullScreen()) cur.bounds = win.getBounds();
            cur.alwaysOnTop = onTop; // store the preference, not the transient fullscreen state
            writePopoutState(cur);
          } catch { /* ignore */ }
        };
        let saveTimer = null, topTimer = null;
        const debouncedPersist = () => { clearTimeout(saveTimer); saveTimer = setTimeout(persist, 400); };
        const debouncedOnTop = () => { clearTimeout(topTimer); topTimer = setTimeout(applyOnTop, 250); };
        win.on('resize', () => { debouncedOnTop(); debouncedPersist(); });
        win.on('move', debouncedPersist);
        // Fullscreen ⇄ windowed: never keep on-top while fullscreen (Alt+Tab trap).
        win.on('enter-full-screen', applyOnTop);
        win.on('leave-full-screen', applyOnTop);

        win.webContents.on('before-input-event', (_e, input) => {
          if (input && input.type === 'keyDown' && input.control && input.shift &&
              (input.key === 'P' || input.key === 'p')) {
            onTop = !onTop;
            applyOnTop();
            persist();
            try { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('vex:toast', onTop ? 'Pop-out pinned on top' : 'Pop-out unpinned'); } catch {}
          }
        });

        win.on('closed', () => { clearTimeout(saveTimer); clearTimeout(topTimer); console.log('[discord-popout] window closed'); });

        // Zombie-window guard + diagnostics. Symptom seen: popping out a live
        // screen-share spawns a white window that you can't switch to (its
        // renderer hangs/crashes, so Windows lists a dead frame in Alt+Tab).
        // If the render process goes (crash/OOM/GPU) or the window wedges,
        // destroy it so no ghost is left behind — and log the reason so the
        // real cause is visible on the next attempt instead of guessed at.
        win.webContents.on('render-process-gone', (_e, d) => {
          console.error('[discord-popout] render-process-gone reason=%s exitCode=%s — destroying window', d && d.reason, d && d.exitCode);
          try { if (!win.isDestroyed()) win.destroy(); } catch {}
        });
        win.webContents.on('did-fail-load', (_e, ec, ed, u) => {
          if (ec === -3) return; // ERR_ABORTED (a superseded nav) — not a real failure
          console.error('[discord-popout] did-fail-load code=%s desc=%s url=%s', ec, ed, u);
        });
        win.on('unresponsive', () => { console.error('[discord-popout] window unresponsive'); });

        // Let the renderer surface a one-line discoverability hint.
        try { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('vex:discord-popout-open'); } catch {}
      } catch (err) { console.error('[discord-popout] setup failed:', err.message); }
    }
  });

  contents.setWindowOpenHandler((details) => {
    const { url, disposition, frameName, features } = details || {};
    // External-protocol window.open (e.g. Roblox Play button spawns a hidden
    // window to roblox-player://…) — forward to the OS instead of creating a
    // dead tab that would just error out.
    if (handleExternalProtocol(url, contents)) {
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
      return { action: 'allow', overrideBrowserWindowOptions: popupOverrides() };
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
    //
    // shouldKeepPopupReal also covers provider-agnostic OAuth-SHAPED popups
    // (Discord and other "Login with X" dashboards) by URL shape, not host —
    // see isOAuthShapedUrl. The popup is pinned to the OPENER TAB's partition
    // (popupOverrides), so cookies land where the originating tab can read them,
    // for container/OTR tabs too — not just persist:main.
    if (_mainHelpers.shouldKeepPopupReal(url)) {
      console.log(`[new-window] allowing OAuth/federated-auth popup -> ${url}`);
      pendingPeekPopup = true;
      return { action: 'allow', overrideBrowserWindowOptions: popupOverrides({ peek: true }) };
    }
    // Redirect-proof gate: a scripted window.open popup (disposition 'new-window'
    // WITH features or a frame name) is a real opener-connected window in every
    // browser, regardless of where it navigates next. URL-shape gating above only
    // sees the FIRST url, so OAuth flows that open at a non-shaped BOUNCE url and
    // redirect into the provider afterward (Ticket Tool -> Discord) slip past it;
    // setWindowOpenHandler never re-fires on in-window redirects. Keep these real
    // and pinned to the opener tab's partition. Bare shift+click (no features, no
    // name) is NOT matched and still falls through to Peek below. Proven by
    // scripts/verify-oauth-popup-partition.js (Scenario C — bounce-then-OAuth).
    // Discord "Pop Out" (stream / screen-share / voice / picture-in-picture) is a
    // scripted window.open from a Discord page. It IS a real opener-connected
    // window — Discord paints the live video into it — so it must stay real, but
    // as a NORMAL resizable + fullscreenable window. The generic scripted-popup
    // branch below would dress it as the Peek auth card (fullscreenable:false +
    // an "Open as tab" chrome bar), which is exactly why Full Screen did nothing
    // and "Open as tab" dead-ended on a blank stream URL. Give it a plain window
    // pinned to the opener's (persist:discord) partition instead. (about:blank
    // popouts are already handled real-and-plain by the print/blank branch above.)
    let openerUrl = '';
    try { openerUrl = contents.getURL() || ''; } catch { /* opener gone */ }
    // Pop-ups blocked for this site (site panel › Pop-ups): a window the page
    // opens by itself, without a click or key from you, is refused. A link you
    // click still opens. The answer lives with the site's other permissions.
    if (_popupRefused(contents, openerUrl)) return { action: 'deny' };
    if (disposition === 'new-window' && _mainHelpers.isDiscordHostUrl(openerUrl)) {
      console.log(`[new-window] Discord pop-out -> real resizable window -> ${url || '(blank)'}`);
      pendingDiscordPopout = true;
      return { action: 'allow', overrideBrowserWindowOptions: popupOverrides() };
    }
    if (_mainHelpers.isScriptedHandbackPopup(disposition, features, frameName)) {
      console.log(`[new-window] allowing scripted window.open popup (disp=${disposition} frame=${frameName || '-'}) -> ${url}`);
      pendingPeekPopup = true;
      return { action: 'allow', overrideBrowserWindowOptions: popupOverrides({ peek: true }) };
    }
    console.log(`[new-window] ${disposition} -> ${url}`);
    try {
      // The window the page is in: a link from a private window's tab went to
      // the first window found, which could be the main one (found 2026-09-29).
      const host = secureSessions.owner(contents);
      const win = host && !host.win.isDestroyed() ? host.win : BrowserWindow.getAllWindows().find(w => !w.isDestroyed());
      if (win && url) {
        const openerPartition = secureSessions.partitionOf(contents);
        // Shift+click (and window.open popups that survived the filters above)
        // arrive as 'new-window' — open those in the Peek overlay instead of a
        // full tab. Plain target=_blank / middle-click stay tabs.
        if (disposition === 'new-window') {
          win.webContents.send('peek:open', { url, partition: openerPartition });
        } else {
          win.webContents.send('tab:create-from-external', {
            url,
            background: disposition === 'background-tab' || disposition === 'save-to-disk',
            // A Tor / burner / private / container tab's link stays in that
            // session; it opened in persist:main before (found 2026-09-29).
            partition: require('./main/routing').keepsOpenerSession(openerPartition) ? openerPartition : undefined,
            // The page the link was in, so the tab opens next to its own
            // (js/app.js); it went to the far end (found 2026-10-10).
            opener: contents.id,
          });
        }
      }
    } catch (err) { console.error('[new-window] forward failed:', err.message); }
    return { action: 'deny' };
  });

  // Same story for top-level navigations: some Roblox flows swap the current
  // webview's location to roblox-player://…, so catch those before Chromium
  // blocks them.
  _watchGestures(contents);
  contents.on('will-navigate', (evt, url) => {
    if (handleExternalProtocol((evt && evt.url) || url, contents)) {
      evt.preventDefault();
    }
  });

  // Subframe navigations — Roblox's "Play" button sets the src of a hidden
  // iframe to roblox-player://launch?…, which does NOT trigger will-navigate
  // (main-frame only). will-frame-navigate fires for every frame including
  // iframes, so the Bloxstrap handoff actually reaches the OS. Its one
  // argument is the details (url, isMainFrame); the main frame's own is left
  // to will-navigate above, so a link is asked about once.
  contents.on('will-frame-navigate', (details) => {
    if (!details || details.isMainFrame) return;
    if (handleExternalProtocol(details.url, contents)) details.preventDefault();
  });

  // "Leave site?" for a page you clicked or typed in, asked in Vex's own
  // dialog; never when a tab or window closes (src/main/leave-page.js).
  _leaveGuard.watch(contents);
  contents.on('will-prevent-unload', (evt) => { _leaveGuard.onWillPreventUnload(evt, contents); });

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
    if (handleDictateShortcut(event, input)) return;
    if (handleCommandBarShortcut(event, input, contents)) return;
    // An extension's shortcut (chrome.commands), before the page hears it.
    if (handleExtensionCommandKey(event, input, contents)) return;
    if (handleBrowserShortcut(event, input, contents)) return;
    // Ctrl+Alt+L locks Vex (js/vex-lock.js) even with a page focused.
    if (input && input.type === 'keyDown' && input.control && input.alt && !input.shift && (input.key || '').toLowerCase() === 'l' && mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('lock-vex');
      event.preventDefault();
    }
  });
});

// A page's alert / confirm / prompt is asked over its own tab or panel, not in
// a native box that disabled the whole Vex window (src/main/page-dialogs.js).
const _pageDialogs = require('./main/page-dialogs').createPageDialogs({
  owner: (contents) => secureSessions.owner(contents),
  newId: () => require('crypto').randomUUID(),
  log: (m) => console.error(m),
  // A page in a window of its own: the box belongs to that window only.
  // Electron has no prompt box, so prompt() there answers null, as before.
  nativeAsk: async (contents, { type, message, origin }) => {
    if (type === 'prompt') return { ok: false };
    const win = BrowserWindow.fromWebContents(contents);
    const opts = {
      type: type === 'confirm' ? 'question' : 'none',
      title: origin ? origin + ' says' : 'This page says',
      message,
      buttons: type === 'confirm' ? ['OK', 'Cancel'] : ['OK'],
      defaultId: 0, cancelId: type === 'confirm' ? 1 : 0, noLink: true,
    };
    const r = win && !win.isDestroyed() ? await dialog.showMessageBox(win, opts) : await dialog.showMessageBox(opts);
    return { ok: r.response === 0 };
  },
});
ipcMain.on('page-dialog', (event, req) => _pageDialogs.request(event, req));
ipcMain.on('page-dialog:answer', (event, res) => _pageDialogs.answer(event, res));

// "Leave site?" (src/main/leave-page.js): asked by the window the page is in
// (js/page-dialogs.js), never while that window or Vex is closing.
const _leavePage = require('./main/leave-page');
const _leaveQuestions = _leavePage.createLeaveQuestions({
  owner: (contents) => secureSessions.owner(contents),
  newId: () => require('crypto').randomUUID(),
});
const _leaveGuard = _leavePage.createLeaveGuard({
  ask: (contents) => _leaveQuestions.ask(contents, { origin: require('./main/page-dialogs').originOf(contents.getURL()) }),
  isClosing: (contents) => {
    const host = secureSessions.owner(contents);
    return !!(host && host.allowClose) || !!_exitWatch.ending();
  },
  tellAgain: (contents) => {
    const host = secureSessions.owner(contents);
    if (host && host.win && !host.win.isDestroyed()) host.win.webContents.send('vex:toast', 'Do that again to leave the page');
  },
  log: (m) => console.error(m),
});
ipcMain.on('page:leave-answer', (event, res) => _leaveQuestions.answer(event, res));

// Ctrl+Alt+D from inside a page: dictation types into web pages, and the page
// has the focus while you do — so this one key is passed up to Vex.
// Ctrl+K from inside a page opens the command bar (src/main/command-bar-key.js).
const { isCommandBarKey } = require('./main/command-bar-key');
function handleCommandBarShortcut(event, input, contents) {
  if (!mainWindow || mainWindow.isDestroyed()) return false;
  let url;
  try { url = contents.getURL(); } catch { url = ''; }
  if (!isCommandBarKey(input, url)) return false;
  mainWindow.webContents.send('toggle-command-bar');
  event.preventDefault();
  return true;
}

const { isDictateKey } = require('./main/dictate-key');
function handleDictateShortcut(event, input) {
  if (!mainWindow || mainWindow.isDestroyed() || !isDictateKey(input)) return false;
  mainWindow.webContents.send('dictate-toggle');
  event.preventDefault();
  return true;
}
const storagePath = path.join(userDataPath, 'vex-storage');
const { JsonStore, SecretStore, atomicWrite } = require('./main/file-store');
const dataStore = new JsonStore(storagePath);
const secretStore = new SecretStore(safeStorage);
ipcMain.handle('cloud:token-save', (_event, token) => {
  if (typeof token !== 'string' || token.length < 24 || token.length > 512) throw new Error('Use a token of 24–512 characters');
  return secretStore.write(path.join(userDataPath, 'ai-token.enc'), token);
});
// MCP servers' tokens (js/mcp-client.js), by server id, encrypted like the
// other secrets. They sat in plain text in vex-persist.json and went into
// every backup, though PRIVACY.md says backups leave tokens out (security scan
// S5-3). The interface never holds one again: api:request adds it to a
// request that names its server (mcpServer).
const MCP_AUTH_FILE = path.join(userDataPath, 'mcp-auth.enc');
let _mcpAuthQueue = Promise.resolve();
async function _mcpAuthAll() {
  const all = await secretStore.read(MCP_AUTH_FILE, () => ({}));
  return all && typeof all === 'object' ? all : {};
}
ipcMain.handle('mcp:auth-set', (_event, id, token) => {
  const operation = _mcpAuthQueue.catch(() => {}).then(async () => {
    const all = { ...(await _mcpAuthAll()) };
    const t = String(token || '').trim();
    if (t) all[id] = t; else delete all[id];
    await secretStore.write(MCP_AUTH_FILE, all);
    return { ok: true, has: !!t };
  });
  _mcpAuthQueue = operation;
  return operation;
});
ipcMain.handle('cloud:request', async (_event, body) => {
  const url = String(_persistLoad()['vex.aiWorkerUrl'] || '');
  if (!/^https:\/\//.test(url)) throw new Error('Configure an HTTPS AI Worker URL');
  const token = await secretStore.read(path.join(userDataPath, 'ai-token.enc'));
  if (!token) throw new Error('Set your AI access token in Cloud Services');
  const response = await boundedNetFetch(url, { method: 'POST', redirect: 'error', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, body: JSON.stringify(body), timeoutMs: 25000 });
  return { status: response.status, body: await response.text() };
});

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
const preferences = require('./main/storage').createPreferenceStore(persistFile);
const _persistLoad = preferences.load;
// History is kept once, in vex.history: visits still only in the old second
// copy (vex-storage/history.json) join it before the interface reads it, and
// the file goes (main/history-fold.js). A failure keeps the file, says why,
// and is tried again next start.
const _historyFolded = require('./main/history-fold').foldHistoryFile({ dataStore, preferences })
  .then(r => { if (r.removed) console.log('[History] folded history.json into vex.history: ' + r.added + ' visit(s) added'); })
  .catch(err => console.error('[History] history.json could not be folded into vex.history; it is kept for the next start:', err));
ipcMain.handle('persist-get-all', async () => { await _historyFolded; return _persistLoad(); });
// Locked when Vex was closed: locked from the first moment, not from when the
// window has loaded and says so, so there is no gap to open DevTools in. The
// window starts locked in the same case (js/vex-lock.js, init).
try {
  const saved = _persistLoad();
  if (saved['vex.locked'] === '1' && require('./main/lock-pin').parseRecord(saved['vex.lockPin'])) _vexLocked = true;
} catch (err) { console.error('[Lock] could not read whether Vex was locked:', err.message); }

// === Geolocation preference exposed to webview preloads ===
// The preload polyfill (preload-webview.js) runs in guest processes and can't
// touch the renderer's localStorage directly, so it asks us. We read from the
// already-loaded persist cache — values land here as the same JSON-stringified
// strings the renderer wrote via persist-set, so JSON.parse is required.
// Should this host get the WebAuthn suppression that stops Windows from popping
// its "Windows Security" passkey / USB-key dialog over a password login?
//
// This used to apply everywhere. The September audit made it opt-in per exact
// hostname, which left the default list empty - so the dialog came back on every
// site and there was no way to turn it off short of typing each hostname in.
// The default is suppression everywhere again, expressed as "*", and the setting
// still narrows it: replace "*" with hostnames to keep passkeys on elsewhere, or
// empty the field to re-enable passkey prompts everywhere.
function _passkeySuppressed(hostname) {
  const hosts = _readPersistString('vex.passkeySuppressedHosts', ['*']);
  if (!Array.isArray(hosts)) return false;
  return hosts.includes('*') || hosts.includes(hostname);
}
function _readPersistString(key, fallback) {
  const raw = _persistLoad()[key];
  if (raw == null) return fallback;
  try { return JSON.parse(raw); }
  catch { return typeof raw === 'string' ? raw : fallback; }
}
// Tor pages never learn where you are. Vex's own geolocation stand-in asks
// here, not through the session's permission handler, so the deny-all given
// to Tor sessions never saw it: a Tor tab showed the prompt and, when
// allowed, got the saved location (found 2026-09-30).
function _locationRefused(contents) {
  const ses = contents && contents.session;
  if (ses && ses.__vexTor) return true;
  let partition;
  try { partition = secureSessions.partitionOf(contents); } catch (err) { console.error('[Geolocation] could not read the page session:', err.message); return true; }
  return typeof partition === 'string' && (partition.startsWith('tor-') || partition.startsWith('persist:route-tor'));
}

ipcMain.handle('geolocation:get', (_e) => {
  if (_locationRefused(_e && _e.sender)) return { mode: 'off' };
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
    // Manual mode with nothing saved used to fall through to an IP lookup so
    // "first-run isn't broken". That quietly did the one thing the chosen
    // setting promises not to do — it put the user on a third-party geo-IP
    // endpoint from the guest page, under a mode whose own description says
    // nothing leaves your device. Report that there is no location instead;
    // Settings → Location shows a warning and the one-click ways to set one.
    return { mode: 'off' };
  }
  return { mode: 'ip' };
});

// Geolocation permission gate — the polyfill can't go through Chromium's
// setPermissionRequestHandler because it has replaced navigator.geolocation,
// so it asks us here. We reuse the existing permission prompt + decision store.
ipcMain.handle('geolocation:check-permission', async (_e) => {
  if (_locationRefused(_e.sender)) return 'deny';
  // A page can call the public bridge with any argument. Only Electron's
  // sending frame identifies the origin whose permission we may grant.
  let origin;
  try {
    const url = new URL(_e.senderFrame.url);
    if (!['http:', 'https:'].includes(url.protocol)) return 'deny';
    origin = url.origin;
  } catch { return 'deny'; }

  // The same reading every other permission gets (main/permissions.js):
  // "Allow this visit" lives in sessionDecisions, and "Allow for a day" ends
  // at decisions.__until__. Reading decisions[key] alone ignored both, so a
  // site allowed for this visit asked again every time it wanted the
  // location, and one allowed for a day stayed allowed for good.
  const saved = savedDecision(decisionsFor(_e.sender), origin, ['geolocation'], sessionDecisionsFor(_e.sender));
  if (saved === 'allow') return 'allow';
  if (saved === 'deny') return 'deny';

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
    Object.assign(settle, { _host: secureSessions.owner(_e.sender), _contents: _e.sender, _origin: origin, _permission: 'geolocation' });
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
// The PIN main checks an unlock against cannot be swapped while locked.
function _refuseLockPinChange(key) {
  if (_vexLocked && key === 'vex.lockPin') throw new Error('Vex is locked — the PIN cannot be changed');
}
ipcMain.handle('persist-set', async (_e, key, value) => {
  _refuseLockPinChange(key);
  return preferences.set(key, value);
});
ipcMain.handle('persist-delete', async (_e, key) => {
  _refuseLockPinChange(key);
  return preferences.delete(key);
});
ipcMain.handle('persist-apply', async (_e, entries) => {
  return preferences.apply(entries);
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

ipcMain.handle('sync-save-key', (_event, hex) => {
  if (typeof hex !== 'string' || !/^[a-f0-9]{64}$/i.test(hex)) throw new Error('Invalid sync key');
  return secretStore.write(syncKeyFile, hex);
});
ipcMain.handle('sync-load-key', () => secretStore.read(syncKeyFile));
ipcMain.handle('sync-save-meta', (_event, meta) => secretStore.write(syncMetaFile, meta));
ipcMain.handle('sync-load-meta', () => secretStore.read(syncMetaFile, JSON.parse));
ipcMain.handle('sync-clear-state', async () => {
  await Promise.all([secretStore.clear(syncKeyFile), secretStore.clear(syncMetaFile)]);
  return true;
});
// Windows close only after the acknowledged renderer/main storage flush.
app.on('before-quit', () => {
  closePipWindow();
});

// Register custom protocol BEFORE app ready
protocol.registerSchemesAsPrivileged([
  { scheme: 'vex', privileges: { standard: true, secure: true, supportFetchAPI: true } }
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
    show: false,        // show only once painted — avoids the blank/transparent
                        // window that lands in the taskbar but never surfaces
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      webviewTag: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true
    }
  });

  secureSessions.registerHost(mainWindow);
  // Stopped answering: written in the crash log with what was open, and a
  // Reload window offered instead of a dead window (src/main/window-hang.js).
  require('./main/window-hang').createWindowHangGuard({
    win: mainWindow, dialog, crashLog: _crashLog,
    openPages: () => webContents.getAllWebContents()
      .filter(wc => !wc.isDestroyed() && wc.getType() === 'webview')
      .map(wc => { const u = wc.getURL(); return /^file:/i.test(u) ? 'a Vex page' : u.replace(/[?#].*$/, '').slice(0, 60); }),
    log: (m) => console.error(m),
  });
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  // Show + focus the window once the first frame is ready. A transparent,
  // frameless window shown before paint can render blank (you see through it).
  // Fallback timer in case 'ready-to-show' is missed on some GPUs.
  const _showMainWindow = () => {
    try {
      if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isVisible()) {
        mainWindow.show();
        mainWindow.focus();
      }
    } catch {}
  };
  mainWindow.once('ready-to-show', _showMainWindow);
  setTimeout(_showMainWindow, 4000);

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
      permissionsReady();
    }, 500);
  });

  // Header stripping for webviews
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    const responseHeaders = { ...details.responseHeaders };
    _addMediaCorsHeaders(details, responseHeaders);
    _scriptsOffCsp(details, responseHeaders);
    callback({ responseHeaders });
  });

  // Named partitions used by sidebar panels (whatsapp/claude) — header stripping
  // so they can be embedded in panels. persist:main is the default tabs session;
  // it gets adblocker/permissions/downloads/preload wiring below but no header
  // strip since regular tabs don't need their own frame-ancestors loosened.
  const partitions = ['persist:whatsapp', 'persist:claude', 'persist:spotify', 'persist:netflix', 'persist:discord', 'persist:roblox'];

  // Gmail: spoof Chrome UA at the session level too. The webview-tag `useragent`
  // attribute covers top-level frames; setting it on the session ensures every
  // sub-request (redirects, XHR, iframes during the auth dance) also identifies
  // as Chrome, so Google's "browser not secure" detector doesn't trip on leaked
  // "Electron/X.X.X" tokens in edge-case requests.
  // (Gmail webview UA/Client Hints spoofing removed — Gmail is now a native
  // IMAP/SMTP client, not a webview. See src/main/gmail/.)
  partitions.forEach(partName => {
    const ses = secureSessions.fromPartition(partName);
    // The Discord panel additionally drops CSP entirely so the Vencord browser
    // extension can inject its bundle + load themes/QuickCSS (the extension would
    // normally relax CSP via declarativeNetRequest, which Electron only partly
    // supports). Scoped to persist:discord only — every other session keeps CSP.
    const stripAllCsp = (partName === 'persist:discord');

    ses.webRequest.onHeadersReceived((details, callback) => {
      const responseHeaders = { ...details.responseHeaders };
      if (stripAllCsp && /^https:\/\/(?:[a-z0-9-]+\.)?discord\.com(?::443)?\//i.test(details.url) && details.resourceType === 'mainFrame') {
        delete responseHeaders['x-frame-options'];
        delete responseHeaders['X-Frame-Options'];
        delete responseHeaders['X-FRAME-OPTIONS'];
        for (const k of Object.keys(responseHeaders)) {
          const lk = k.toLowerCase();
          if (lk === 'content-security-policy' || lk === 'content-security-policy-report-only') {
            if (stripAllCsp) delete responseHeaders[k];
            else responseHeaders[k] = responseHeaders[k].map(csp => csp.replace(/frame-ancestors[^;]*;?/gi, ''));
          }
        }
      }
      // ...and is not allowed to set any either.
      if (Object.keys(_siteRules).length && SiteRules.blocksCookies(_siteRules, details.url)) {
        for (const k of Object.keys(responseHeaders)) if (k.toLowerCase() === 'set-cookie') delete responseHeaders[k];
      }
      _addMediaCorsHeaders(details, responseHeaders);
      callback({ responseHeaders });
    });
  });

  // === DPI-bypass for the Discord panel ===
  // Discord is blocked in some regions (e.g. Turkey) via DNS poisoning + SNI/DPI
  // filtering. Route the persist:discord session through a local proxy that
  // resolves over DoH and fragments the TLS ClientHello SNI (see
  // src/main-dpi-bypass.js). Fail-open: if the proxy can't start, Discord loads
  // directly. Toggleable from the Discord button's right-click menu.
  // Three bypass modes for the Discord session:
  //   'off'    — direct connection.
  //   'light'  — Vex's built-in JS proxy (DoH + SNI fragmentation). No deps.
  //   'strong' — ByeDPI userspace SOCKS5 desync proxy (downloaded on demand);
  //              same power as Zapret/GoodbyeDPI without admin. Has tunable
  //              desync presets (preset index) for per-ISP tuning.
  const _byedpi = require('./byedpi.js');
  let _dpiBypassPort = 0; // light (JS) proxy port
  // Route Discord domains through the bypass on the NORMAL browsing sessions too,
  // so the OAuth authorize page + discord.com links work in regular Vex tabs —
  // not just the Discord sidebar panel. A PAC script sends ONLY discord.* through
  // ByeDPI (everything else stays direct). TCP only — voice UDP still needs Zapret.
  const _BROWSING_SESSIONS = BROWSING_SESSIONS;
  function _routeBrowsingDiscord(port) {
    let cfg = { mode: 'direct' };
    if (port) {
      const pac = "function FindProxyForURL(u,h){if("
        + "shExpMatch(h,'discord.com')||shExpMatch(h,'*.discord.com')||"
        + "shExpMatch(h,'discordapp.com')||shExpMatch(h,'*.discordapp.com')||"
        + "shExpMatch(h,'discord.gg')||shExpMatch(h,'*.discord.gg')||"
        + "shExpMatch(h,'*.discordapp.net'))return 'SOCKS5 127.0.0.1:" + port + "';return 'DIRECT';}";
      cfg = { pacScript: 'data:application/x-ns-proxy-autoconfig;base64,' + Buffer.from(pac).toString('base64') };
    }
    // What a covered session set back to direct gets (applyRouting).
    _discordBrowsingProxy = cfg;
    // A session with a saved route (a container through Tor or a proxy, or
    // all of Vex) keeps it. This ran at every start, after the routes were
    // restored, and put each of them back to direct (found 2026-09-30).
    let saved;
    try { saved = readRouting(); }
    catch (err) { console.error('[DPI-bypass] the saved routes could not be read, so no session was changed:', err); return; }
    const routed = p => !!(saved[_ALL_ROUTE_KEY] || saved[p || 'default']);
    for (const p of _BROWSING_SESSIONS) { if (routed(p)) continue; try { secureSessions.fromPartition(p).setProxy(cfg); } catch {} }
    if (!routed(null)) { try { session.defaultSession.setProxy(cfg); } catch {} }
  }
  // Voice (RTC) must NOT ride the desync proxy. ByeDPI is TCP-only, so the media
  // stream (UDP) never goes through it anyway - but its TLS-record splitting
  // mangles Discord's long-lived voice-gateway WebSocket on *.discord.media,
  // which the client shows as "RTC connecting" dropping and retrying every few
  // seconds. Send voice hosts DIRECT and keep chat/login on the bypass (those
  // are the hostnames the ISP actually blocks).
  const _discordProxyConfig = (rules) => {
    if (!rules) return { mode: 'direct' };
    const spec = String(rules);
    // Only the ByeDPI SOCKS route needs the split; anything else (light mode's
    // http=/https= rules) is passed through unchanged.
    const port = spec.startsWith('socks') ? parseInt(spec.slice(spec.lastIndexOf(':') + 1), 10) : 0;
    if (!port) return { proxyRules: spec };
    const pac = "function FindProxyForURL(u,h){"
      + "if(shExpMatch(h,'discord.media')||shExpMatch(h,'*.discord.media'))return 'DIRECT';"
      + "return 'SOCKS5 127.0.0.1:" + port + "';}";
    return { pacScript: 'data:application/x-ns-proxy-autoconfig;base64,' + Buffer.from(pac).toString('base64') };
  };
  // While all of Vex goes through one route, the Discord and Roblox panels go
  // through it too (_coverWithAllRoute): the bypass keeps its rules and puts
  // them back when that route is turned off (_reapplyPanelBypass).
  let _lastDiscordRules = null, _lastRobloxRules = null;
  const _setDiscordProxy = (rules) => {
    _lastDiscordRules = rules;
    if (!_allRoute()) {
      try { secureSessions.fromPartition('persist:discord').setProxy(_discordProxyConfig(rules)); }
      catch (e) { console.warn('[DPI-bypass] setProxy failed:', e && e.message); }
    }
    // Mirror Discord-domain routing onto normal tabs when (and only when) the
    // panel is going through ByeDPI's SOCKS proxy.
    const m = rules && /socks5?:\/\/127\.0\.0\.1:(\d+)/.exec(String(rules));
    _routeBrowsingDiscord(m ? parseInt(m[1], 10) : 0);
  };
  // One request through the Discord session's current proxy. Any HTTP response =
  // the handshake completed (block beaten); a connection error = blocked.
  function _testOne(url) {
    return new Promise((resolve) => {
      let done = false; const fin = (v) => { if (!done) { done = true; resolve(v); } };
      try {
        const req = net.request({ url, session: secureSessions.fromPartition('persist:discord') });
        const to = setTimeout(() => { try { req.abort(); } catch {} fin(false); }, 6000);
        req.on('response', (res) => { clearTimeout(to); try { res.resume(); } catch {} fin((res.statusCode || 0) > 0); });
        req.on('error', () => { clearTimeout(to); fin(false); });
        req.end();
      } catch { fin(false); }
    });
  }
  // Rigorous: TWO requests must both succeed, so a flaky single pass (the DPI is
  // probabilistic) doesn't get mistaken for a working bypass.
  async function _testDiscordRobust() {
    if (!(await _testOne('https://discord.com/app'))) return false;
    return await _testOne('https://discord.com/api/v9/gateway');
  }

  // --- Roblox panel bypass: Roblox is blocked by the same ISP/DPI, so the
  // desync that beats Discord beats Roblox too. We SHARE the single ByeDPI
  // instance — reuse a running one (never restart one Discord may be using); if
  // none is up, start the known-good preset and route persist:roblox through it.
  const _setRobloxProxy = (rules) => {
    _lastRobloxRules = rules;
    if (_allRoute()) return;
    try { secureSessions.fromPartition('persist:roblox').setProxy(rules ? { proxyRules: rules } : { mode: 'direct' }); }
    catch (e) { console.warn('[DPI-bypass] roblox setProxy failed:', e && e.message); }
  };
  _reapplyPanelBypass = () => { _setDiscordProxy(_lastDiscordRules); _setRobloxProxy(_lastRobloxRules); };
  // Roblox and Discord share ONE ByeDPI process; ./main/byedpi-share.js keeps
  // whoever is not calling pointed at the port that actually exists.
  const _share = require('./main/byedpi-share').createByedpiShare({
    byedpi: _byedpi,
    setRobloxProxy: _setRobloxProxy,
    notify: (message) => {
      try {
        if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('vex:toast', message);
      } catch (e) { console.warn('[DPI-bypass] could not report the Roblox bypass stopping:', e && e.message); }
    },
  });
  const _byedpiStart = (ud, buf, preset, custom) => _share.start(ud, buf, preset, custom);
  const _byedpiStop = () => _share.stop();

  function _testRoblox(url) {
    return new Promise((resolve) => {
      let done = false; const fin = (v) => { if (!done) { done = true; resolve(v); } };
      try {
        const req = net.request({ url, session: secureSessions.fromPartition('persist:roblox') });
        const to = setTimeout(() => { try { req.abort(); } catch {} fin(false); }, 6000);
        req.on('response', (res) => { clearTimeout(to); try { res.resume(); } catch {} fin((res.statusCode || 0) > 0); });
        req.on('error', () => { clearTimeout(to); fin(false); });
        req.end();
      } catch { fin(false); }
    });
  }
  async function _testRobloxRobust() {
    if (!(await _testRoblox('https://www.roblox.com/'))) return false;
    return await _testRoblox('https://www.roblox.com/home');
  }
  async function _applyRobloxBypass(on) {
    if (!on) { _share.attachRoblox(false); _setRobloxProxy(null); return { ok: true, off: true }; }
    try {
      // Reuse a ByeDPI that's already up (e.g. Discord bypass) — never restart it.
      const reused = _share.reuseExisting();
      if (reused != null) {
        return { ok: true, reused: true, port: reused };
      }
      // Otherwise start the known-good preset and route Roblox through it.
      const ud = app.getPath('userData');
      _share.attachRoblox(true);
      const port = await _byedpiStart(ud, _downloadBuffer, 0);
      _setRobloxProxy('socks5://127.0.0.1:' + port);
      if (await _testRobloxRobust()) return { ok: true, port, preset: 0 };
      // Preset 0 didn't pass — sweep the rest (safe: no other consumer yet).
      for (let i = 1; i < _byedpi.PRESETS.length; i++) {
        try {
          const p = await _byedpiStart(ud, _downloadBuffer, i);
          _setRobloxProxy('socks5://127.0.0.1:' + p);
          if (await _testRobloxRobust()) return { ok: true, port: p, preset: i };
        } catch {}
      }
      _share.attachRoblox(false);
      _byedpi.stop(); _setRobloxProxy(null);
      return { ok: false, error: 'no mode got through' };
    } catch (e) { _share.attachRoblox(false); _setRobloxProxy(null); return { ok: false, error: (e && e.message) || 'failed' }; }
  }

  // mode: 'off' | 'light' | 'strong'. opts: { preset?: number (>=0 forces it,
  // <0 / undefined = auto-tune), custom?: string (raw ciadpi flags) }.
  async function _applyDiscordBypass(mode, opts) {
    opts = opts || {};
    try {
      if (mode === 'auto') {
        // Auto-configure sweep: try EVERY ByeDPI desync preset first (the real
        // tools), rigorously testing each (two requests must pass), keeping the
        // first that works. Built-in light is only a last resort — it tends to
        // pass the test flukily without actually carrying the app, so trying it
        // first would short-circuit the whole sweep. Every preset's real result
        // is appended to byedpi/sweep.log for diagnosis.
        const ud = app.getPath('userData');
        const total = _byedpi.PRESETS.length + 1;
        const send = (p) => { try { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('discord:bypass-progress', p); } catch {} };
        const swlog = (line) => { try { fs.appendFileSync(path.join(ud, 'byedpi', 'sweep.log'), `[${new Date().toISOString()}] ${line}\n`); } catch {} };
        swlog('--- auto-configure sweep start ---');
        // 1) ByeDPI desync presets (preset 0 already worked for the maintainer)
        for (let i = 0; i < _byedpi.PRESETS.length; i++) {
          send({ phase: 'testing', label: 'mode ' + (i + 1), i: i + 1, total });
          const flags = (_byedpi.PRESETS[i] || []).join(' ');
          try {
            const port = await _byedpiStart(ud, _downloadBuffer, i);
            _setDiscordProxy('socks5://127.0.0.1:' + port);
            const ok = await _testDiscordRobust();
            swlog(`mode ${i + 1} [${flags}]: listening=yes test=${ok ? 'PASS' : 'fail'}`);
            if (ok) { send({ phase: 'done', ok: true, via: 'byedpi', preset: i }); return { ok: true, mode: 'auto', via: 'byedpi', preset: i }; }
          } catch (e) { swlog(`mode ${i + 1} [${flags}]: launch FAILED — ${(e && e.message) || e}`); }
        }
        // 2) built-in light as a last resort
        send({ phase: 'testing', label: 'built-in', i: total, total });
        try {
          _byedpiStop();
          _setDiscordProxy(_dpiBypassPort ? ('https=127.0.0.1:' + _dpiBypassPort + ';http=127.0.0.1:' + _dpiBypassPort) : null);
          const ok = await _testDiscordRobust();
          swlog(`built-in light: test=${ok ? 'PASS' : 'fail'}`);
          if (ok) { send({ phase: 'done', ok: true, via: 'light' }); return { ok: true, mode: 'auto', via: 'light' }; }
        } catch {}
        _byedpiStop(); _setDiscordProxy(null);
        swlog('--- no mode got through ---');
        send({ phase: 'done', ok: false });
        return { ok: false, mode: 'auto', error: 'no mode got through' };
      }
      if (mode === 'strong') {
        const ud = app.getPath('userData');
        // Custom flags: run exactly what the user pasted.
        if (opts.custom && String(opts.custom).trim()) {
          const port = await _byedpiStart(ud, _downloadBuffer, 0, opts.custom);
          _setDiscordProxy('socks5://127.0.0.1:' + port);
          return { ok: true, mode: 'strong', custom: true, port };
        }
        // Forced preset: run just that one.
        if (typeof opts.preset === 'number' && opts.preset >= 0) {
          const port = await _byedpiStart(ud, _downloadBuffer, opts.preset);
          _setDiscordProxy('socks5://127.0.0.1:' + port);
          return { ok: true, mode: 'strong', preset: opts.preset, port };
        }
        // Auto-tune: try presets in order, keep the first that actually reaches Discord.
        for (let i = 0; i < _byedpi.PRESETS.length; i++) {
          try {
            const port = await _byedpiStart(ud, _downloadBuffer, i);
            _setDiscordProxy('socks5://127.0.0.1:' + port);
            if (await _testDiscordRobust()) {
              console.log('[DPI-bypass] ByeDPI auto-tune: preset ' + i + ' works');
              return { ok: true, mode: 'strong', preset: i, auto: true, port };
            }
          } catch (e) { console.warn('[DPI-bypass] preset ' + i + ' failed:', e && e.message); }
        }
        _byedpiStop(); _setDiscordProxy(null);
        return { ok: false, mode: 'strong', error: 'no preset got through (your ISP may need Zapret)' };
      }
      _byedpiStop();
      if (mode === 'light') {
        _setDiscordProxy(_dpiBypassPort ? ('https=127.0.0.1:' + _dpiBypassPort + ';http=127.0.0.1:' + _dpiBypassPort) : null);
        return { ok: true, mode: 'light' };
      }
      _setDiscordProxy(null); // off
      return { ok: true, mode: 'off' };
    } catch (e) {
      console.warn('[DPI-bypass] apply failed:', e && e.message);
      return { ok: false, mode, error: (e && e.message) || 'failed' };
    }
  }
  // Start the built-in JS proxy and default the session to 'light'.
  // Run-once guard: these one-time registrations live inside createWindow(),
  // which has a second call site (app.on('activate')). It isn't reachable today
  // (window-all-closed quits the app), but if it ever became re-openable, a
  // second ipcMain.handle() for the same channel throws "Attempted to register a
  // second handler…" and a fresh before-quit listener would leak. The guard
  // makes the block idempotent so that can never happen.
  if (!ipcMain.__vexBypassWired) {
    ipcMain.__vexBypassWired = true;
    try {
      require('./main-dpi-bypass.js').startDpiBypassProxy().then((port) => {
        _dpiBypassPort = port || 0;
        _applyDiscordBypass('light');
      }).catch((e) => console.warn('[DPI-bypass] start error:', e && e.message));
    } catch (e) { console.warn('[DPI-bypass] init failed:', e && e.message); }
    ipcMain.handle('discord:set-bypass-mode', (_e, mode, opts) => _applyDiscordBypass(mode, opts || {}));
    ipcMain.handle('roblox:set-bypass', (_e, on) => _applyRobloxBypass(!!on));
    ipcMain.handle('gui-style:set', async (_e, style) => {
      await dataStore.write('gui-style', style === 'glass' ? 'glass' : 'classic');
      return { ok: true };
    });
    ipcMain.on('discord:set-bypass', (_e, on) => _applyDiscordBypass(on ? 'light' : 'off')); // back-compat
    app.on('before-quit', () => { try { _byedpi.stop(); } catch {} });
  }

  // Ad blocker — attach on every session tabs actually use. Previously only
  // defaultSession and the two panel partitions were covered, so ads loaded
  // freely in regular tabs (which live in persist:main).
  wireAdblockerOnSession(session.defaultSession, 'default');
  wireAdblockerOnSession(secureSessions.fromPartition('persist:main'), 'persist:main');
  // Media CORS for Master Volume boost on the tabs session (no other
  // onHeadersReceived is registered on persist:main), and JavaScript held off
  // for a site that has it switched off — in the container tabs too, which
  // had no handler of their own (found 2026-09-29).
  try {
    for (const p of BROWSING_SESSIONS) {
      secureSessions.fromPartition(p).webRequest.onHeadersReceived((details, callback) => {
        const responseHeaders = { ...details.responseHeaders };
        _addMediaCorsHeaders(details, responseHeaders);
        _scriptsOffCsp(details, responseHeaders);
        callback({ responseHeaders });
      });
    }
  } catch {}
  partitions.forEach(p => wireAdblockerOnSession(secureSessions.fromPartition(p), p));

  // Upgrade the request blocker to the EasyList + EasyPrivacy engine. Async &
  // fire-and-forget: the handlers above OR the engine verdict with the legacy
  // domain list, so blocking works immediately and gets richer once this
  // resolves. Serialized engine is cached under userData for instant relaunch.
  // Cache filename bumped to -full so the richer prebuilt list set (and its
  // cosmetic rules) rebuilds instead of loading the old ads+tracking cache.
  // Saved routing is installed before this window can create any guests.

  // Register the cosmetic-filter ipc handlers NOW, before any guest page loads —
  // the guest preload starts calling them immediately, so waiting for the async
  // engine build below would make early pages throw "No handler registered". The
  // handlers no-op until the engine is ready (and follow the ad-blocker toggle).
  enableCosmeticFiltering((event) => adBlockerEnabled
    && !(event && event.sender && !event.sender.isDestroyed() && _adsAllowedOn(event.sender.getURL(), event.sender.session)));

  initAdblockEngine(path.join(app.getPath('userData'), 'vex-adblock-engine-full.bin'))
    .then(ok => {
      console.log('[Vex] adblock engine', ok ? 'ready (full lists)' : 'unavailable — using domain list');
    })
    .catch(e => console.error('[Vex] adblock engine start failed:', e && e.message));

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
  session.defaultSession.setUserAgent(CHROME_UA);
  secureSessions.fromPartition('persist:main').setUserAgent(CHROME_UA);
  partitions.forEach(p => secureSessions.fromPartition(p).setUserAgent(CHROME_UA));

  // Normalize Sec-CH-UA Client Hints to match the spoofed Chrome UA on the same
  // sessions, so UA and CH agree (sites that sniff CH won't see Electron).
  wireClientHintsOnSession(session.defaultSession);
  wireClientHintsOnSession(secureSessions.fromPartition('persist:main'));
  partitions.forEach(p => wireClientHintsOnSession(secureSessions.fromPartition(p)));

  // Downloads — wire on every session tabs might use. Previously only the
  // default session had a listener, so webview downloads (partition=persist:main)
  // silently saved with no IPC to the renderer → panel stayed empty.
  wireDownloadsOnSession(session.defaultSession, 'default');
  wireDownloadsOnSession(secureSessions.fromPartition('persist:main'), 'persist:main');
  partitions.forEach(p => wireDownloadsOnSession(secureSessions.fromPartition(p), p));

  wirePermissionsOnSession(session.defaultSession, 'default');
  wirePermissionsOnSession(secureSessions.fromPartition('persist:main'), 'persist:main');
  partitions.forEach(p => wirePermissionsOnSession(secureSessions.fromPartition(p), p, { autoAllowMedia: p === 'persist:discord' }));

  // WebHID — same fan-out as permissions: default + tabs (persist:main) + the
  // sidebar-panel partitions, so navigator.hid.requestDevice() shows the Vex
  // device chooser everywhere a page can run.
  wireWebHidOnSession(session.defaultSession, 'default');
  wireWebHidOnSession(secureSessions.fromPartition('persist:main'), 'persist:main');
  partitions.forEach(p => wireWebHidOnSession(secureSessions.fromPartition(p), p));

  // Screen share (getDisplayMedia) — fan out the picker to every session a page
  // can run in, so Discord Go Live / Share Screen works.
  wireDisplayMediaOnSession(session.defaultSession);
  wireDisplayMediaOnSession(secureSessions.fromPartition('persist:main'));
  partitions.forEach(p => wireDisplayMediaOnSession(secureSessions.fromPartition(p)));

  // Webview preloads (PiP helpers + geolocation IP fallback, and the per-site
  // main-world tweaks) — attach to every session so ALL pages get them. Use
  // setPreloads so we don't clobber any existing preload set elsewhere.
  const sessions = [
    session.defaultSession,
    secureSessions.fromPartition('persist:main'),
    // Container tabs (isolated cookie jars) need the preload too.
    secureSessions.fromPartition('persist:container-work'),
    secureSessions.fromPartition('persist:container-personal'),
    secureSessions.fromPartition('persist:container-shopping'),
    ...partitions.map(p => secureSessions.fromPartition(p))
  ];
  for (const ses of sessions) {
    try { attachGuestPreloads(ses); }
    catch (err) { console.error('[Preload] attach failed:', err.message); }
    wireSpellcheckOnSession(ses);
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
    restorePlacementAfterFullscreen();
  });

  // Where the window was before fullscreen. On this transparent frameless
  // window Electron does not reliably put it back: after F11 or a video going
  // fullscreen, the window stayed screen-sized (1920x1080) but no longer
  // maximized, spilling past the right edge and under the taskbar
  // (2026-09-28). So the placement is remembered here, and restored.
  let placement = null;
  const rememberPlacement = () => {
    try {
      if (!mainWindow || mainWindow.isDestroyed() || isFullscreenTracked || mainWindow.isMinimized()) return;
      const b = mainWindow.getBounds();
      const display = require('electron').screen.getDisplayMatching(b);
      // Mid-way into fullscreen the window is already screen-sized; that is
      // not a place to come back to.
      if (b.width >= display.bounds.width && b.height >= display.bounds.height) return;
      placement = { maximized: mainWindow.isMaximized(), bounds: mainWindow.isMaximized() ? (placement && placement.bounds) || b : b };
    } catch (err) { console.warn('[Vex window] could not note its place:', err.message); }
  };
  function restorePlacementAfterFullscreen() {
    setTimeout(() => {
      try {
        if (!mainWindow || mainWindow.isDestroyed() || isFullscreenTracked) return;
        if (placement && placement.maximized) { if (!mainWindow.isMaximized()) mainWindow.maximize(); return; }
        const b = (placement && placement.bounds) || mainWindow.getBounds();
        const wa = require('electron').screen.getDisplayMatching(b).workArea;
        const width = Math.min(b.width, wa.width), height = Math.min(b.height, wa.height);
        const x = Math.min(Math.max(b.x, wa.x), wa.x + wa.width - width);
        const y = Math.min(Math.max(b.y, wa.y), wa.y + wa.height - height);
        mainWindow.setBounds({ x, y, width, height });
      } catch (err) { console.warn('[Vex window] could not put it back after fullscreen:', err.message); }
    }, 60);
  }
  for (const ev of ['move', 'resize', 'maximize', 'unmaximize']) mainWindow.on(ev, rememberPlacement);
  rememberPlacement();
  mainWindow.once('ready-to-show', rememberPlacement);

  // Signal renderer to save session before quit
  mainWindow.on('closed', () => {
    mainWindow = null;
    // Never leave the PiP window behind: it is frameless and always-on-top,
    // there would be no Vex UI left to close it from, and it would hold the
    // app open past window-all-closed.
    closePipWindow();
  });
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
  // The user's own game hotkeys, from the settings file (main/game-hotkeys.js).
  // Registered after the preference store exists, and only what registers is kept.
  try {
    const r = _gameHotkeys.apply();
    for (const e of r.errors) console.error('[Hotkeys] ' + e.accel + ' for ' + e.action + ': ' + e.error);
  } catch (err) { console.error('[Hotkeys] could not register:', err.message); }

  // F12, Ctrl+Shift+F12, Ctrl+Shift+J and the boss key are no longer
  // Windows-wide: handleWindowKeys answers them in Vex's own windows and pages
  // (src/main/window-keys.js).

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
        // Any theme the page itself has colours for. A fixed list of the first
        // eight left every later theme on Oxford here (found 2026-09-29).
        const KNOWN = { includes: (t) => /^[a-z]+(-[a-z]+)?$/.test(t) && html.includes('[data-theme="' + t + '"]') };
        let theme = 'oxford';
        try {
          const themeFile = getStorageFile('theme');
          if (fs.existsSync(themeFile)) {
            const raw = JSON.parse(fs.readFileSync(themeFile, 'utf-8'));
            const t = raw?.$vexStore === 1 ? raw.data : raw;
            if (typeof t === 'string' && KNOWN.includes(t)) theme = t;
          }
        } catch { /* oxford on any read error */ }
        // Belt-and-suspenders: inject the attribute on <html> AND a tiny inline
        // <script> at the head end. The attribute gives CSS a hook before paint;
        // the script ensures it stays set even if some other code path nukes
        // documentElement.dataset.theme. Always inject (oxford included) so the
        // served HTML carries an explicit theme.
        const safe = theme.replace(/[^a-z]/g, '');
        // Also bake the GUI Style (classic|glass) so the start page matches.
        let guiStyle = 'classic';
        try {
          const gf = getStorageFile('gui-style');
          if (fs.existsSync(gf)) { const raw = JSON.parse(fs.readFileSync(gf, 'utf-8')); const g = raw?.$vexStore === 1 ? raw.data : raw; if (g === 'glass') guiStyle = 'glass'; }
        } catch {}
        html = html.replace('<html lang="en">', `<html lang="en" data-theme="${safe}" data-gui-style="${guiStyle}">`);
        html = html.replace(
          '</head>',
          `<script>document.documentElement.setAttribute("data-theme","${safe}");document.documentElement.setAttribute("data-gui-style","${guiStyle}");</script></head>`
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
      try {
        const assetPath = decodeURIComponent(new URL(reqUrl).pathname).replace(/^\//, '');
        const fullPath = safeJoin(path.join(__dirname, 'renderer'), assetPath);
        if (fs.existsSync(fullPath)) return net.fetch(pathToFileURL(fullPath).toString());
      } catch { return new Response('Invalid asset path', { status: 400 }); }
    }

    return new Response('Not Found', { status: 404 });
  });

  // castLabs Widevine CDM. Fire-and-forget so a slow/failed CDM download never
  // blocks window creation (playback happens later); see initWidevine() above.
  initWidevine();

  // Before any route is restored: a site route's session made by the restore
  // is given its refusing proxy first (see _wireBrowsingSession).
  secureSessions.onSessionCreated(_wireBrowsingSession);
  // An off-the-record tab's or a burner's in-memory session (otr-<ts>,
  // otr-burner-<ts>) is made when the tab opens, or when a burner's Tor route
  // is set just before: it gets everything a private window's session gets
  // (_wireEphemeralBrowsing), the page preloads included — without them its
  // alert/confirm/prompt had no tab-local stand-in.
  secureSessions.onSessionCreated((ses, partition) => {
    if (typeof partition === 'string' && partition.startsWith('otr-')) _wireEphemeralBrowsing(ses, 'otr');
  });
  // While all of Vex goes through one route, a session made later goes
  // through it too (a private window, a container, a panel, a burner).
  secureSessions.onSessionCreated(_coverWithAllRoute);
  await applyStoredRoutings();
  createWindow();
  // Installers left in userData/updates by the last update (or a download cut
  // short). Late, so the installer that just started this version has exited.
  setTimeout(() => {
    if (_updater.downloading) return;
    try { _updater.cleanup(); } catch (err) { console.warn('[Updates] could not tidy the updates folder:', err.message); }
  }, 60000).unref();
  startReminders();

  // === Boot smoke test (gated by VEX_SMOKE=1) ===
  // Boots the REAL app and asserts the renderer initialized in real Chromium —
  // the tab system created a tab + rendered a <webview>, and the core managers
  // are defined — then exits 0 (pass) / 1 (fail). Driven by
  // scripts/verify-smoke-boot.js. No effect on normal runs. Catches "won't boot
  // / renderer throws / no tab renders" regressions the jsdom unit tests can't.
  if (process.env.VEX_SMOKE === '1' && mainWindow) {
    const wc = mainWindow.webContents;
    let done = false;
    let securityVerifying = false;
    const finish = (ok, detail) => {
      if (done) return; done = true;
      console.log(`SMOKE: ${ok ? 'PASS' : 'FAIL'} ${detail || ''}`);
      setTimeout(() => app.exit(ok ? 0 : 1), 150);
    };
    wc.on('render-process-gone', (_e, d) => finish(false, 'render-process-gone ' + (d && d.reason)));
    const deadline = Date.now() + 25000;
    const poll = async () => {
      if (done) return;
      try {
        const s = await wc.executeJavaScript(`(function(){try{return {
          tm: typeof TabManager!=='undefined',
          tabs: (typeof TabManager!=='undefined'&&Array.isArray(TabManager.tabs))?TabManager.tabs.length:-1,
          wvm: typeof WebviewManager!=='undefined',
          wv: document.querySelectorAll('webview').length,
          sb: typeof SidebarManager!=='undefined',
          cb: typeof CommandBar!=='undefined'
        };}catch(e){return {err:String(e)};}})()`, true);
        if (s && s.tm && s.tabs >= 1 && s.wvm && s.wv >= 1 && s.sb && s.cb) {
          if (process.env.VEX_SECURITY_SMOKE === '1' || process.env.VEX_UI_SMOKE === '1' || process.env.VEX_RESTART_PHASE) {
            if (securityVerifying) return;
            securityVerifying = true;
            try {
              const details = [];
              if (process.env.VEX_RESTART_PHASE) details.push(await require('./main/restart-smoke').run({ mainWindow, phase: process.env.VEX_RESTART_PHASE }));
              if (process.env.VEX_SECURITY_SMOKE === '1') details.push(await require('./main/security-smoke').run({ mainWindow, security: secureSessions, userData: userDataPath }));
              if (process.env.VEX_UI_SMOKE === '1') details.push(await require('./main/ui-smoke').run({ mainWindow }));
              finish(true, details.join('; '));
            }
            catch (error) { finish(false, error.message); }
            return;
          }
          finish(true, `tabs=${s.tabs} webviews=${s.wv}`); return;
        }
        if (Date.now() > deadline) { finish(false, 'timeout state=' + JSON.stringify(s)); return; }
      } catch (e) {
        if (Date.now() > deadline) { finish(false, 'timeout exec ' + e.message); return; }
      }
      setTimeout(poll, 400);
    };
    wc.once('did-finish-load', () => setTimeout(poll, 300));
    setTimeout(poll, 1500); // safety net if load already fired
  }

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
  mainWindow.on('blur', () => _setShortcutCapturing(false));
  mainWindow.webContents.on('before-input-event', (event, input) => {
    // The shortcut editor is recording: every key goes to it, F11 and F12 too.
    if (_shortcutCapturing) return;
    // An extension's shortcut (chrome.commands); never one of the keys below.
    if (handleExtensionCommandKey(event, input, null)) return;
    if (input && input.key === 'F11') {
      console.log('[Vex F11] before-input-event fired on MAIN window webContents. type:', input.type, 'defaultPrevented(before):', event.defaultPrevented);
    }
    // Ctrl alone, on the key going down. Nothing checked that Alt was up, so
    // Ctrl+Alt+W (Watch page) closed the tab, Ctrl+Alt+T opened one and
    // Ctrl+Alt+M muted it (found 2026-09-29).
    const down = input.type === 'keyDown';
    const ctrlOnly = down && input.control && !input.alt;
    if (ctrlOnly && input.key === 'k') {
      mainWindow.webContents.send('toggle-command-bar');
      event.preventDefault();
    }
    if (ctrlOnly && input.key === 'f') {
      mainWindow.webContents.send('find-in-page');
      event.preventDefault();
    }
    if (ctrlOnly && input.key === 't') {
      mainWindow.webContents.send('new-tab');
      event.preventDefault();
    }
    if (ctrlOnly && input.key === 'w') {
      mainWindow.webContents.send('close-tab');
      event.preventDefault();
    }
    if (ctrlOnly && input.key === 'r') {
      mainWindow.webContents.send('reload-tab');
      event.preventDefault();
    }
    if (ctrlOnly && (input.key === '=' || input.key === '+')) {
      mainWindow.webContents.send('zoom-in');
      event.preventDefault();
    }
    if (ctrlOnly && input.key === '-') {
      mainWindow.webContents.send('zoom-out');
      event.preventDefault();
    }
    if (ctrlOnly && input.key === '0') {
      mainWindow.webContents.send('zoom-reset');
      event.preventDefault();
    }
    // Ctrl+1…9: go to that tab (Ctrl+9 the last). Only a page passed them on,
    // so with Vex's own interface focused they did nothing (found 2026-09-29).
    if (ctrlOnly && !input.shift && /^[1-9]$/.test(input.key)) {
      mainWindow.webContents.send('jump-to-tab', Number(input.key));
      event.preventDefault();
    }
    if (down && input.alt && !input.control && input.key === 'ArrowLeft') {
      mainWindow.webContents.send('navigate-back');
      event.preventDefault();
    }
    if (down && input.alt && !input.control && input.key === 'ArrowRight') {
      mainWindow.webContents.send('navigate-forward');
      event.preventDefault();
    }
    if (ctrlOnly && input.shift && input.key === 'S') {
      mainWindow.webContents.send('toggle-split');
      event.preventDefault();
    }
    if (ctrlOnly && input.shift && input.key === 'P') {
      mainWindow.webContents.send('toggle-pip');
      event.preventDefault();
    }
    if (ctrlOnly && input.shift && input.key === 'N') {
      mainWindow.webContents.send('toggle-notes');
      event.preventDefault();
    }
    if (ctrlOnly && input.shift && input.key === 'O') {
      mainWindow.webContents.send('toggle-sessions');
      event.preventDefault();
    }
    if (ctrlOnly && input.shift && input.key === 'T') {
      mainWindow.webContents.send('reopen-last-closed');
      event.preventDefault();
    }
    if (ctrlOnly && input.shift && input.key === 'H') {
      // Ctrl+Shift+H — open history panel with AI search auto-selected
      mainWindow.webContents.send('toggle-history-ai');
      event.preventDefault();
    } else if (ctrlOnly && input.key === 'h') {
      mainWindow.webContents.send('toggle-history');
      event.preventDefault();
    }
    if (ctrlOnly && input.shift && input.key === 'M') {
      mainWindow.webContents.send('toggle-memory');
      event.preventDefault();
    }
    if (ctrlOnly && input.shift && input.key === 'Z') {
      mainWindow.webContents.send('sleep-current-tab');
      event.preventDefault();
    }
    // Ctrl+Shift+R was previously bound here to toggle-reading-mode, which
    // hijacked the renderer-side hard-reload shortcut. Reading mode is still
    // accessible via Ctrl+Alt+R through the renderer's ShortcutsRegistry; this
    // block intentionally stays out of the way so hard-reload can fire.
    if (ctrlOnly && input.shift && (input.key === 'R' || input.key === 'r')) {
      console.log('[Vex] hard reload triggered — main process (Ctrl+Shift+R detected, passing to renderer)');
    }
    if (down && input.control && input.alt && input.key === 's') {
      mainWindow.webContents.send('take-screenshot');
      event.preventDefault();
    }
    if (handleFullscreenShortcut(event, input)) return;
    if (handleDevToolsShortcut(event, input)) return;
    if (ctrlOnly && input.key === 'm') {
      mainWindow.webContents.send('toggle-mute-tab');
      event.preventDefault();
    }
    if (ctrlOnly && input.shift && input.key === 'A') {
      mainWindow.webContents.send('toggle-ai-panel');
      event.preventDefault();
    }
    if (ctrlOnly && input.shift && input.key === 'L') {
      mainWindow.webContents.send('toggle-schedules');
      event.preventDefault();
    }
    if (ctrlOnly && !input.shift && input.key === 'b') {
      mainWindow.webContents.send('toggle-tabs-sidebar');
      event.preventDefault();
    }
  });

  // Disable default menu
  Menu.setApplicationMenu(null);
});

// IPC handlers
ipcMain.on('window-minimize', e => secureSessions.owner(e.sender)?.win.minimize());
// On this transparent frameless window, maximize() makes it fill the work
// area but neither Electron nor Windows then call it maximized, so the button
// always maximized again and never restored down (2026-09-28). "Maximized"
// is therefore judged by whether it fills the work area, and the size it had
// before is kept to go back to.
ipcMain.on('window-maximize', e => {
  const win = secureSessions.owner(e.sender)?.win;
  if (!win) return;
  const b = win.getBounds();
  const wa = require('electron').screen.getDisplayMatching(b).workArea;
  const near = (a, c) => Math.abs(a - c) <= 2;
  const fills = near(b.x, wa.x) && near(b.y, wa.y) && near(b.width, wa.width) && near(b.height, wa.height);
  if (win.isMaximized() || fills) {
    win.unmaximize();
    const back = win._vexRestoreBounds;
    const now = win.getBounds();
    if (near(now.width, wa.width) && near(now.height, wa.height)) {
      const width = Math.min(back ? back.width : 1400, wa.width - 80), height = Math.min(back ? back.height : 900, wa.height - 80);
      win.setBounds(back && !(near(back.width, wa.width) && near(back.height, wa.height))
        ? { x: back.x, y: back.y, width, height }
        : { x: Math.round(wa.x + (wa.width - width) / 2), y: Math.round(wa.y + (wa.height - height) / 2), width, height });
    }
  } else {
    win._vexRestoreBounds = b;
    win.maximize();
  }
});
ipcMain.on('window-close', e => secureSessions.owner(e.sender)?.win.close());

// Backdrop click behind a Peek-style auth popup → dismiss the frameless popup
// (it has no native close button). Esc inside the popup does the same (wired in
// did-create-window). No-op if nothing is open.
ipcMain.on('oauth-popup:dismiss', () => {
  try { if (_activePeekOAuthPopup && !_activePeekOAuthPopup.isDestroyed()) _activePeekOAuthPopup.close(); } catch {}
});

// Peek-style auth popup chrome-bar buttons → act on the popup's auth web contents.
// 'Open as tab' promotes the popup's current URL into a real Vex tab (and closes
// the popup); the rest mirror the Peek bar (back/reload/copy/close).
ipcMain.on('popup-chrome:action', (e, payload) => {
  const win = _peekChromeByWc.get(e.sender.id);
  if (!win || win.isDestroyed()) return;
  const wc = win.webContents;
  const action = payload && payload.action;
  try {
    if (action === 'back') { if (wc.canGoBack()) wc.goBack(); }
    else if (action === 'reload') { wc.reload(); }
    else if (action === 'close') { win.close(); }
    else if (action === 'copy') { clipboard.writeText(wc.getURL()); }
    else if (action === 'open-as-tab') {
      const url = wc.getURL();
      if (url && mainWindow && !mainWindow.isDestroyed()) {
        // The popup has its opener tab's session; a Tor tab's popup opened as
        // a persist:main tab (found 2026-09-29).
        const partition = secureSessions.partitionOf(wc);
        mainWindow.webContents.send('tab:create-from-external', { url, background: false,
          partition: require('./main/routing').keepsOpenerSession(partition) ? partition : undefined });
      }
      win.close();
    }
  } catch (err) { console.error('[popup-chrome] action failed:', err.message); }
});

ipcMain.handle('get-start-page-path', () => 'vex://start');
ipcMain.handle('get-start-page-url', () => {
  // Return file:// URL as a bulletproof fallback that never triggers OS "open with" dialog
  const filePath = path.join(__dirname, 'renderer', 'start.html');
  return pathToFileURL(filePath).toString();
});

// === Search suggestions (web search predictions) ===
// Fetched in the MAIN process because the engines' suggestion addresses send
// NO CORS header, so a webSecurity:true renderer/webview fetch is blocked. Both
// the address bar (window.vex.webSuggest) and the start-page guest
// (__vexSuggestBridge.suggest) funnel here. Fail-silent: any error/offline → []
// (never throws).
//
// What you type went to Google whatever engine you had chosen, also from a
// private window. Now this decides, from the main window's own settings (the
// renderer and the New Tab page cannot pick another address): suggestions
// come only from the chosen engine (js/typed-address.js), not at all when
// Settings › General › Search suggestions is off, and never from a private
// window (src/main/ipc-policy.js answers those before this runs), a Tor tab
// or a burner tab.
const _typedAddress = require('./renderer/js/typed-address');
function _suggestAllowedFrom(sender) {
  if (!sender || sender.isDestroyed()) return false;
  if (sender.getType() !== 'webview') return true;          // the address bar
  // A burner's session is kept in memory only; Tor as for geolocation.
  return sender.session.isPersistent() && !_locationRefused(sender);
}
// LRU + TTL cache so repeat/backspaced queries return instantly without a
// network hit (the renderer caches too; this also helps the start-page bridge).
const _suggestCache = new Map(); // engine \n q -> { list, ts }
const SUGGEST_TTL = 10 * 60 * 1000;
const SUGGEST_MAX = 600;
ipcMain.handle('web-suggest', async (event, query) => {
  const text = (query == null ? '' : String(query)).trim();
  if (!text || !_suggestAllowedFrom(event.sender)) return [];
  if (!_typedAddress.suggestionsOn(_readPersistString(_typedAddress.SUGGEST_KEY, 'on'))) return [];
  const engine = _typedAddress.engineOf(_readPersistString('vex.searchEngine', 'google'));
  const url = _typedAddress.suggestUrl(text, engine);
  if (!url) return [];
  const q = engine + '\n' + text;
  const hit = _suggestCache.get(q);
  if (hit && (Date.now() - hit.ts) < SUGGEST_TTL) {
    _suggestCache.delete(q); _suggestCache.set(q, hit); // LRU bump
    return hit.list;
  }
  try {
    // Bound the wait so a slow/hung request can't stall the dropdown.
    const ctrl = new AbortController();
    const to = setTimeout(() => { try { ctrl.abort(); } catch {} }, 2500);
    let list = [];
    try {
      const r = await boundedNetFetch(url, { signal: ctrl.signal });
      if (r.ok) list = _typedAddress.parseSuggestions(await r.text());
    } finally { clearTimeout(to); }
    _suggestCache.set(q, { list, ts: Date.now() });
    if (_suggestCache.size > SUGGEST_MAX) _suggestCache.delete(_suggestCache.keys().next().value);
    return list;
  } catch (e) {
    return [];
  }
});

ipcMain.handle('storage-save', (_event, key, data) => dataStore.write(key, data));
ipcMain.handle('storage-load', (_event, key) => dataStore.read(key));
ipcMain.handle('storage:flush', async () => { await dataStore.flush(); await preferences.flush(); await secretStore.flush(); await totpWrites; await recallFlush(); await privacyWrites; await routingPending; await routingStore?.flush(); await flushVault(); await flushPermissions(); return true; });
ipcMain.handle('browsing:clear-data', async () => {
  await dataStore.flush(); await preferences.flush();
  for (const ses of new Set([session.defaultSession, ...secureSessions.sessions])) { await ses.clearStorageData(); await ses.clearCache(); }
  await dataStore.remove('history');
  await dataStore.clear('sync-records', null);
  // Without the records, the next tile sync has to add this device's tiles
  // to the account's again, which only happens while this flag is unset
  // (js/sync-engine.js, checkTileGate).
  await dataStore.clear('sync-tiles-joined', null);
  recallStore().clear();
  await recallFlush(true);
  await preferences.clearKeys(['vex.history','vex.sessions','vex.archivedTabs','vex.workspaceSnapshots','vex.downloads','vex.autofillLog']);
  return true;
});
// History › Clear History. Saving an empty list left the whole history in
// history.json.bak and vex-persist.json.bak until the next write, and the
// closed-tab list still named every page (found 2026-09-29) — clear() and
// clearKeys() erase the backups too, as browsing:clear-data does.
ipcMain.handle('browsing:clear-history', async () => {
  await dataStore.flush(); await preferences.flush();
  await dataStore.remove('history');
  await preferences.clearKeys(['vex.history', 'vex.recentlyClosed']);
  // The open-tab list, and the groups and stacks that name tabs, keep their
  // previous version in a .bak: tabs.json.bak still held a tab closed just
  // before Clear History (found 2026-09-29). Each backup becomes a copy of
  // the current file, so a bad write can still be recovered from.
  for (const key of ['tabs', 'groups', 'stacks']) {
    await dataStore.enqueue(key, async () => {
      const file = dataStore.file(key);
      try { await fs.promises.copyFile(file, file + '.bak'); }
      catch (err) {
        if (err.code !== 'ENOENT') throw err;
        await fs.promises.rm(file + '.bak', { force: true });
      }
    });
  }
  return true;
});
// pageId: the id of the tab's page. The pop-out is made in that page's session
// (pip.js, createPipWindow) and never in the default one; a page of another
// window, or none, is refused.
ipcMain.handle('open-pip-window', async (event, url, media, pageId) => {
  if (!secureSessions.ownsTarget(event, pageId)) { console.error('[Vex] PiP refused: not a page of this window'); return false; }
  const pipSession = webContents.fromId(pageId).session;
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
    if (media && typeof media === 'object' && typeof media.src === 'string' && /^https?:\/\//i.test(media.src)) {
      try {
        createPipPlayer(media, pipSession);
        return { ok: true, mode: 'video' };
      } catch (err) {
        // A player that won't start is not a reason to give up on PiP.
        console.warn('[Vex PiP] video-only player refused, using the page:', err.message);
      }
    }
    createPipWindow(safe, pipSession);
    return { ok: true, mode: 'page' };
  } catch (e) {
    console.error('PiP window error:', e);
    return false;
  }
});

ipcMain.handle('close-pip-window', async () => { await closePipRemembering('closed'); return true; });
ipcMain.handle('is-pip-open', () => isPipOpen());

// Control-bar actions from the PiP window's own preload (src/preload-pip.js).
// The PiP window runs with contextIsolation and no contextBridge exposure,
// so only that preload can reach these — not the page loaded inside it.
// The renderer undoes what it did when the pop-out opened (it mutes the source
// tab so you don't hear the same video twice), and for "back to tab" it also
// switches to that tab — main only ever had the URL, so it cannot.
onPipClosed((reason, at) => {
  try {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('pip:closed', reason, at);
  } catch (e) { console.error('[Vex PiP] could not tell the window PiP closed:', e.message); }
});
// Ask the floating player where it got to before tearing it down — after the
// window is gone there is nothing left to ask.
async function closePipRemembering(reason) {
  let at;
  try { at = await pipPlaybackPosition(); } catch (err) {
    console.warn('[Vex PiP] could not read the playback position:', err && err.message);
    at = null;
  }
  if (reason) setCloseReason(reason);
  setPipPosition(at);
  closePipWindow();
}
ipcMain.on('pip:close', () => { closePipRemembering('closed'); });
ipcMain.on('pip:toggle-pin', () => togglePipPin());
ipcMain.on('pip:back-to-tab', async () => {
  await closePipRemembering('back-to-tab');
  try {
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  } catch (e) { console.error('[Vex PiP] back-to-tab focus failed:', e.message); }
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
// DevTools for the interface itself — the main window's own document, not a
// page in a tab. Docked at the bottom, the way F12 does it. What the developer
// dashboard's button calls.
ipcMain.handle('devtools:toggle-host', async (_e) => {
  if (_vexLocked) return { ok: false, error: 'Vex is locked' };
  const wc = _e.sender;
  if (!wc || wc.isDestroyed()) return { ok: false, error: 'The window is gone' };
  try {
    if (wc.isDevToolsOpened()) { wc.closeDevTools(); return { ok: true, open: false }; }
    wc.openDevTools({ mode: 'bottom' });
    return { ok: true, open: true };
  } catch (err) { return { ok: false, error: err.message }; }
});

ipcMain.handle('devtools:toggle-webview', async (_e, webContentsId) => {
  if (_vexLocked) return { ok: false, error: 'Vex is locked' };
  try {
    const wc = typeof webContentsId === 'number' ? webContents.fromId(webContentsId) : null;
    if (!wc || wc.isDestroyed()) {
      return { ok: false, error: 'webContents not found' };
    }
    if (wc.isDevToolsOpened()) {
      wc.closeDevTools();
    } else {
      // Detached, never docked. Every target here is a <webview> guest, and a
      // guest has no window of its own to dock DevTools into: mode 'bottom'
      // fired devtools-opened yet produced no window at all. And because this
      // handler toggles, the next F12 closed that invisible one - so F12 only
      // ever flipped between invisible-open and closed. Measured by listing
      // real top-level windows: 'bottom' left just "Vex"; 'detach' (what the
      // right-click Open DevTools already uses) added "Developer Tools - <url>".
      wc.openDevTools({ mode: 'detach' });
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
  if (_vexLocked) return { ok: false, error: 'Vex is locked' };
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
    // The IPC policy only checks ownership when an id was given; a match by
    // URL must belong to the window that asked, or another window's page
    // could be inspected through it.
    const all = webContents.getAllWebContents();
    const mine = secureSessions.owner(_e.sender);
    wc = all.find(c => !c.isDestroyed() && c.getURL() === fallbackUrl && mine && secureSessions.owner(c) === mine) || null;
    console.log('[Vex DT]   URL fallback over', all.length, 'webContents →', wc ? 'wc#' + wc.id : 'null');
  }
  if (!wc) {
    console.error('[Vex DT]   no target webContents found');
    return { ok: false, error: 'That page is not attached yet — give it a second and try again', requestedId: webContentsId };
  }
  try {
    if (wc.isDevToolsOpened()) {
      wc.closeDevTools();
      console.log('[Vex DT]   closed DevTools for wc#' + wc.id);
      return { ok: true, id: wc.id, open: false };
    }
    wc.openDevTools({ mode: 'detach', activate: true });
    console.log('[Vex DT]   opened DevTools for wc#' + wc.id);
    return { ok: true, id: wc.id, open: true };
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
// What a downloaded file IS, before it is opened (src/main/file-check.js).
// Nothing is sent anywhere: the hash is computed here and shown.
const _fileCheck = require('./main/file-check').createFileCheck({
  fs, crypto: require('crypto'), execFile: require('child_process').execFile, platform: process.platform, log: (m) => console.log(m),
});
// What is inside a .zip, without unpacking it: names and sizes only, read
// through the same guards that protect an extract (src/main/archive-security.js).
ipcMain.handle('archive:list', async (_e, filePath) => {
  try {
    if (!/\.zip$/i.test(String(filePath || ''))) return { ok: false, error: 'Vex can look inside .zip files only' };
    const AdmZip = require('adm-zip');
    const zip = new AdmZip(filePath);
    const { validateZip } = require('./main/archive-security');
    validateZip(zip);
    const entries = zip.getEntries().map(e => ({ name: e.entryName, size: e.header.size, dir: e.isDirectory }));
    return { ok: true, count: entries.length, entries: entries.slice(0, 200) };
  } catch (err) {
    // adm-zip's own wording ('ADM-ZIP: Invalid filename') says nothing to a person.
    const why = String((err && err.message) || '');
    return { ok: false, error: /^ADM-ZIP/.test(why) ? 'that file could not be read as a .zip' : (why || 'that file could not be read') };
  }
});

ipcMain.handle('file:inspect', async (_e, filePath, from) => {
  try { return { ok: true, ...(await _fileCheck.inspect(String(filePath || ''), String(from || ''))) }; }
  catch (err) { return { ok: false, error: (err && err.message) || 'could not be checked' }; }
});

// Only a file Vex downloaded: this runs whatever it opens (security scan L5).
ipcMain.handle('downloads:open-file', async (_e, filePath) => {
  if (!_downloadService.isDownloadedFile(filePath)) return { ok: false, error: 'Vex opens only files it downloaded itself. Use Show in folder to open this one.' };
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

// === New Identity tab ===
// A throwaway, fully isolated session (in-memory partition → cookies/storage
// vanish on close) with a consistent, randomly-picked Chrome identity. Unlike
// the fixed containers (work/personal/shopping), each call is a brand-new jar,
// so sites can't correlate it with any existing login. The UA + client-hints
// are rotated together (same Chrome version) so the fingerprint stays coherent.
// Rotate within the last few Chrome majors relative to the real build — a
// hardcoded list ages into "ancient browser" territory (blockable/fingerprintable).
const IDENTITY_VERSIONS = [-2, -1, 0].map(d => String(Number(CHROME_MAJOR) + d));
function buildIdentity(v) {
  return {
    ua: `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${v}.0.0.0 Safari/537.36`,
    ch: {
      ua: `"Chromium";v="${v}", "Google Chrome";v="${v}", "Not-A.Brand";v="99"`,
      full: `"Chromium";v="${v}.0.0.0", "Google Chrome";v="${v}.0.0.0", "Not-A.Brand";v="99.0.0.0"`,
      fullVer: `"${v}.0.0.0"`,
    },
  };
}
ipcMain.handle('identity:create', () => {
  try {
    const part = `vexid-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
    const ses = secureSessions.fromPartition(part); // no persist: → in-memory, wiped on close
    const v = IDENTITY_VERSIONS[Math.floor(Math.random() * IDENTITY_VERSIONS.length)];
    const idn = buildIdentity(v);
    ses.__vexCH = idn.ch;
    ses.setUserAgent(idn.ua);
    wireClientHintsOnSession(ses);
    wireDownloadsOnSession(ses, 'identity');
    wirePermissionsOnSession(ses, 'identity');
    try { wireDisplayMediaOnSession(ses); } catch {}
    try { wireMediaSnifferOnSession(ses); } catch {}
    // Header stripping + ad blocker, mirroring the private-window session.
    ses.webRequest.onHeadersReceived((details, callback) => {
      const rh = { ...details.responseHeaders };
      _scriptsOffCsp(details, rh);
      callback({ responseHeaders: rh });
    });
    ses.webRequest.onBeforeRequest((details, callback) => {
      const blocked = adBlockerEnabled && (engineBlocks(details) === true || shouldBlock(details.url))
        && !_adsAllowedOn(_pageUrlOf(details.webContentsId), ses);
      if (blocked) _recordTracker(details.url, details.webContentsId);
      callback({ cancel: blocked });
    });
    try { attachGuestPreloads(ses); } catch {}
    return { ok: true, partition: part, label: `Chrome ${v}` };
  } catch (err) { return { ok: false, error: err.message }; }
});

// === Tor session (maximum-security private tab) ===
// Routes a throwaway, fully isolated session through a local Tor SOCKS5 proxy
// (Tor Browser on 9150, or a tor service on 9050), with remote DNS (no leak),
// WebRTC disabled, all site permissions denied, and the fingerprint-resistance
// preload. Requires Tor to be running locally; the renderer guides the user to
// start Tor Browser if it isn't detected.
function _probeTcp(port, host = '127.0.0.1', timeout = 700) {
  return new Promise((resolve) => {
    let net; try { net = require('net'); } catch { return resolve(false); }
    const sock = new net.Socket();
    let done = false;
    const finish = (ok) => { if (done) return; done = true; try { sock.destroy(); } catch {} resolve(ok); };
    try {
      sock.setTimeout(timeout);
      sock.once('connect', () => finish(true));
      sock.once('timeout', () => finish(false));
      sock.once('error', () => finish(false));
      sock.connect(port, host);
    } catch { finish(false); }
  });
}
async function detectTorPort() {
  for (const p of [9150, 9050]) { if (await _probeTcp(p)) return p; } // 9150 = Tor Browser, 9050 = tor service
  return null;
}
// Cancel in Tor's progress dialog only closed the dialog, and Tor went on
// starting (found 2026-09-29). It cannot stop a download half-way, but it
// stops Tor and the tab is not made.
let _torCancelled = false;
ipcMain.handle('tor:cancel', () => { _torCancelled = true; _torLauncher.stop(); return { ok: true }; });

// The Tor Vex started itself went on running after the last Tor tab closed,
// with nothing on screen to say so (found 2026-09-30). It now stops once
// nothing uses it (routing.torInUse), after a grace so that closing one Tor
// tab and opening the next does not restart Tor; any new Tor page cancels the
// countdown. Tor Browser or a tor service Vex only borrowed is never stopped.
const TOR_IDLE_GRACE_MS = 30000;
let _torIdleTimer = null;
function _torStillNeeded() {
  try { return require('./main/routing').torInUse(webContents.getAllWebContents(), readRouting()); }
  catch (err) {
    // The saved routes could not be read: keep Tor rather than cut off a
    // Tor route, and say why.
    console.error('[tor] could not tell whether Tor is still in use:', err);
    return true;
  }
}
function _torIdleCheck() {
  if (!_torLauncher.isRunning() || _torStillNeeded()) {
    if (_torIdleTimer) { clearTimeout(_torIdleTimer); _torIdleTimer = null; }
    return;
  }
  if (_torIdleTimer) return;
  _torIdleTimer = setTimeout(() => {
    _torIdleTimer = null;
    if (_torLauncher.isRunning() && !_torStillNeeded()) _torLauncher.stop();
  }, TOR_IDLE_GRACE_MS);
}
// The sessions going through Tor, each with the port it uses. When the Tor
// Vex runs stops (Stop, the idle stop, or Tor exiting), every session on its
// port is given the refusing proxy and marked down: a Tor container, a burner
// over Tor or a Tor site rule stayed pointed at the dead port and loaded
// nothing until its route was set again or Vex restarted (found 2026-09-30),
// and a later program listening on that port would have been used as Tor.
// A route's session (revive) starts Tor again on its next page load; a Tor
// tab's own session does not — its tab is closed by Stop, and it says so.
const _torSessions = new Set();
let _ownTorPort = 0;
function _useTor(ses, port, revive) {
  ses.__vexTorPort = port;
  ses.__vexTorDown = false;
  ses.__vexTorRevive = revive;
  _torSessions.add(ses);
}
function _leaveTor(ses) {
  _torSessions.delete(ses);
  ses.__vexTorDown = false;
}
function _torWentDown(port) {
  if (!port) return;
  for (const ses of _torSessions) {
    if (ses.__vexTorPort !== port) continue;
    ses.__vexTorDown = true;
    ses.setProxy(require('./main/routing').REFUSED_PROXY)
      .catch(err => console.error('[tor] a session could not be closed off after Tor stopped:', err));
  }
}
// Every window's "Tor is running" indicator follows Vex's own Tor.
_torLauncher.onStateChange((running) => {
  if (!running && _torIdleTimer) { clearTimeout(_torIdleTimer); _torIdleTimer = null; }
  if (running) _ownTorPort = _torLauncher.getPort();
  else { _torWentDown(_ownTorPort); _ownTorPort = 0; }
  BrowserWindow.getAllWindows().forEach(w => {
    if (!w.isDestroyed()) w.webContents.send('tor:state', { running });
  });
});

// A page in a Tor route's session that is down starts Tor again, with the
// progress dialog in its window, and every such session is put on the new
// port; until then the refusing proxy stays, so nothing goes direct. The
// pages that failed meanwhile load again once Tor is up (found 2026-09-30).
const _torRevival = { running: null, windows: new Set(), waiting: new Set() };
function _torPageDown(contents, state, error) {
  const host = secureSessions.owner(contents);
  if (!host || !host.win || host.win.isDestroyed()) return;   // a popup window: no tab to say it in
  host.win.webContents.send('tor:page-down', { id: contents.id, state, error: error || null });
}
function _reviveTor(contents) {
  const host = secureSessions.owner(contents);
  const win = host && host.win && !host.win.isDestroyed() ? host.win : null;
  if (win && !_torRevival.windows.has(win)) { _torRevival.windows.add(win); win.webContents.send('tor:reviving'); }
  if (_torRevival.running) return;
  const send = (channel, payload) => { for (const w of _torRevival.windows) if (!w.isDestroyed()) w.webContents.send(channel, payload); };
  _torCancelled = false;
  _torRevival.running = (async () => {
    let port = await detectTorPort();
    if (!port) port = await _torLauncher.start(app.getPath('userData'), (phase, value, detail) => send('tor:progress', { phase, value, detail }));
    for (const ses of _torSessions) {
      if (!ses.__vexTorDown || !ses.__vexTorRevive) continue;
      await ses.setProxy({ proxyRules: `socks5://127.0.0.1:${port}`, proxyBypassRules: '<-loopback>' });
      _useTor(ses, port, true);
    }
    return port;
  })().then((port) => {
    send('tor:revived', { ok: true, port });
    for (const wc of _torRevival.waiting) if (!wc.isDestroyed() && !wc.session.__vexTorDown) wc.reload();
  }, (err) => {
    const cancelled = _torCancelled || err.message === 'cancelled';
    if (!cancelled) console.error('[tor] could not start Tor again for a Tor route:', err);
    send('tor:revived', { ok: false, cancelled, error: err.message });
    for (const wc of _torRevival.waiting) if (!wc.isDestroyed()) _torPageDown(wc, 'failed', cancelled ? null : err.message);
  }).finally(() => {
    _torRevival.running = null;
    _torRevival.windows.clear();
    _torRevival.waiting.clear();
  });
}

// Vex's own windows (the main one and any private ones). A window still
// starting has no TorSession yet, and no tabs either.
function _torTabsInWindows(action) {
  const wins = [...secureSessions.hosts.values()].map(h => h.win).filter(w => w && !w.isDestroyed());
  return Promise.all(wins.map(w => w.webContents.executeJavaScript(`typeof TorSession === 'undefined' ? 0 : TorSession.${action}()`)));
}
// The tab pages going through Tor that are not Tor tabs: a container, a
// burner or a site rule routed through Tor. Stop leaves them open; their
// session gets the refusing proxy (_torWentDown) and their next page starts
// Tor again (_reviveTor). Stop closed them with the Tor tabs (found 2026-09-30).
function _torRoutedPages() {
  return webContents.getAllWebContents().filter(wc => !wc.isDestroyed() && wc.getType() === 'webview' && wc.session && wc.session.__vexTor && !wc.session.__vexTorTab).length;
}
// What the indicator shows, and the Tor tabs Stop closes. Stop closed them
// only in the window it was clicked in; a Tor page in another window just
// stopped loading (found 2026-09-30). Every window is counted and told.
ipcMain.handle('tor:status', async () => {
  const counts = await _torTabsInWindows('countTorTabs');
  return { running: _torLauncher.isRunning(), tabs: counts.reduce((a, b) => a + b, 0), windows: counts.filter(Boolean).length, routed: _torRoutedPages() };
});
ipcMain.handle('tor:stop', async () => {
  await _torTabsInWindows('closeTorTabs');
  _torLauncher.stop();
  return { ok: true };
});
ipcMain.handle('tor:create', async (event) => {
  _torCancelled = false;
  try {
    let port = await detectTorPort();
    let launched = false;
    if (!port) {
      // No Tor Browser (:9150) or tor service (:9050) running — launch our own
      // bundled Tor in the background, streaming download + bootstrap progress to
      // the renderer so it can show real progress bars. No Tor Browser needed.
      const wc = event && event.sender;
      try {
        port = await _torLauncher.start(app.getPath('userData'), (phase, value, detail) => {
          try { if (wc && !wc.isDestroyed()) wc.send('tor:progress', { phase, value, detail }); } catch {}
        });
        launched = true;
      } catch (e) {
        if (_torCancelled) return { ok: false, reason: 'cancelled' };
        return { ok: false, reason: 'launch-failed', error: e && e.message };
      }
      if (_torCancelled) { _torLauncher.stop(); return { ok: false, reason: 'cancelled' }; }
    }
    const part = `tor-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
    const ses = secureSessions.fromPartition(part); // no persist: → in-memory, wiped on close
    ses.__vexTor = true; // tag so web-contents-created disables WebRTC for it
    ses.__vexTorTab = true; // a Tor tab's own session: Stop closes its tabs
    // Route EVERYTHING (incl. DNS) through Tor. socks5:// makes Chromium resolve
    // hostnames at the proxy, so there's no local DNS leak.
    await ses.setProxy({ proxyRules: `socks5://127.0.0.1:${port}`, proxyBypassRules: '<-loopback>' });
    _useTor(ses, port, false);
    // Consistent masked desktop identity + client hints (less unique than the
    // raw Electron UA), adblock, header strip, and the hardening preload.
    const idn = buildIdentity('124');
    ses.__vexCH = idn.ch;
    ses.setUserAgent(idn.ua);
    wireClientHintsOnSession(ses);
    wireDownloadsOnSession(ses, 'tor');
    // Maximum security: deny every site permission (geolocation, camera, mic,
    // notifications, clipboard, etc.) — overrides any wired handler.
    try { ses.setPermissionRequestHandler((_wc, _perm, cb) => cb(false)); } catch {}
    try { ses.setPermissionCheckHandler(() => false); } catch {}
    ses.webRequest.onHeadersReceived((details, callback) => {
      const rh = { ...details.responseHeaders };
      _scriptsOffCsp(details, rh);
      callback({ responseHeaders: rh });
    });
    ses.webRequest.onBeforeRequest((details, callback) => {
      const blocked = adBlockerEnabled && (engineBlocks(details) === true || shouldBlock(details.url));
      if (blocked) _recordTracker(details.url, details.webContentsId);
      callback({ cancel: blocked });
    });
    try { attachGuestPreloads(ses); } catch {}
    // Armed now in case the tab is never made; the tab's page cancels it.
    _torIdleCheck();
    return { ok: true, partition: part, port, launched };
  } catch (err) { return { ok: false, reason: 'error', error: err.message }; }
});

// Confirm the session actually routes through Tor. A detected/open SOCKS port
// doesn't mean Tor has finished bootstrapping (Tor Browser opens 9150 while still
// connecting) — so fetch check.torproject.org's JSON API THROUGH the Tor session
// and read IsTor. Returns { ok, isTor, ip } or { ok:false, error }.
ipcMain.handle('tor:verify', async (_e, partition) => {
  try {
    if (!partition || typeof partition !== 'string') return { ok: false, error: 'bad-partition' };
    const ses = secureSessions.fromPartition(partition);
    const fetchThroughSession = require('./main/network').createBoundedFetch(ses.fetch.bind(ses));
    const response = await fetchThroughSession('https://check.torproject.org/api/ip', { maxBytes: 8192, timeoutMs: 20000 });
    if (!response.ok) throw new Error('HTTP ' + response.status);
    const data = await response.json();
    return { ok: true, isTor: !!data.IsTor, ip: String(data.IP || '') };
  } catch (err) { return { ok: false, error: err && err.message }; }
});

// === Per-container routing =====================================================
// Route a whole session (a container's persistent partition, or the default one)
// through Tor or a custom SOCKS/HTTP proxy — persistently. Choices are saved and
// re-applied on next launch so a "Tor container" stays a Tor container.
const ROUTING_FILE = () => path.join(app.getPath('userData'), 'session-routing.json');
// The proxy the Discord bypass gives the browsing sessions: direct, or a PAC
// that sends only Discord through ByeDPI (_routeBrowsingDiscord).
let _discordBrowsingProxy = { mode: 'direct' };
let routingStore;
let routingPending = Promise.resolve();
const routingGeneration = new Map();
function getRoutingStore() { return routingStore ||= require('./main/storage').createPreferenceStore(ROUTING_FILE()); }
function readRouting() { return getRoutingStore().load(); }

async function applyRouting(partition, mode, custom, sender) {
  const key = partition || 'default';
  const generation = (routingGeneration.get(key) || 0) + 1;
  routingGeneration.set(key, generation);
  const ses = partition ? secureSessions.fromPartition(partition) : session.defaultSession;
  if (mode === 'tor') {
    // Marked before Tor is up, so no page in it can use WebRTC around the
    // proxy while it starts (a restored Tor route has a refusing proxy then).
    require('./main/routing').markRoutedSession(ses, 'tor', webContents.getAllWebContents());
    // The session kept its old proxy (often direct) until Tor had started, so
    // a page loaded in it meanwhile went direct (found 2026-09-30). It loads
    // nothing until Tor is up. A session already on a live Tor keeps it.
    if (!(_torSessions.has(ses) && ses.__vexTorPort && !ses.__vexTorDown)) await ses.setProxy(require('./main/routing').REFUSED_PROXY);
    let port;
    try {
      port = await detectTorPort();
      if (!port && _torLauncher) {
        port = await _torLauncher.start(app.getPath('userData'), (phase, value, detail) => {
          try { if (sender && !sender.isDestroyed()) sender.send('tor:progress', { phase, value, detail }); } catch {}
        });
      }
      if (!port) throw new Error('Tor unavailable');
    } catch (err) {
      // A Tor route whose Tor did not start (at launch, or a site rule armed)
      // loaded nothing, said nothing and never tried again (found
      // 2026-09-30). Marked down, its next page starts Tor again and a page
      // that fails says why (_reviveTor, tor:page-down). A newer route for
      // the session has put its own proxy on it.
      if (routingGeneration.get(key) === generation) { _useTor(ses, 0, true); ses.__vexTorDown = true; }
      throw err;
    }
    if (routingGeneration.get(key) !== generation) throw new Error('Routing changed while Tor was starting');
    await ses.setProxy({ proxyRules: `socks5://127.0.0.1:${port}`, proxyBypassRules: '<-loopback>' });
    _useTor(ses, port, true);
    return { mode: 'tor', port };
  }
  // Every way in (Private routing, a container, a site route, a restore) is
  // checked here, so nothing but one scheme://host:port reaches setProxy; an
  // empty proxy used to go direct without a word (found 2026-09-29).
  if (mode === 'proxy') {
    const address = require('./main/routing').proxyAddress(custom);
    await ses.setProxy({ proxyRules: address });
    _leaveTor(ses);
    require('./main/routing').markRoutedSession(ses, 'proxy', webContents.getAllWebContents());
    return { mode: 'proxy', custom: address };
  }
  // Direct is direct plus the Discord bypass for the sessions it covers, as
  // at startup: a session set back to direct lost the Discord rule until the
  // bypass mode changed again, and setting all of Vex (or persist:main) to
  // direct overrode it (found 2026-09-30).
  await ses.setProxy(!partition || BROWSING_SESSIONS.includes(partition) ? _discordBrowsingProxy : { mode: 'direct' });
  _leaveTor(ses);
  require('./main/routing').markRoutedSession(ses, 'direct', webContents.getAllWebContents());
  return { mode: 'direct' };
}

ipcMain.handle('routing:set', (event, partition, mode, custom) => {
  const operation = routingPending.catch(() => {}).then(async () => {
    const r = await applyRouting(partition, mode, custom, event && event.sender);
    if (mode === 'direct') await getRoutingStore().delete(partition || 'default');
    // A temporary session (a burner identity) is gone at the next start; its
    // saved Tor route started Tor on every launch for nothing (found 2026-09-29).
    else if (!partition || String(partition).startsWith('persist:')) await getRoutingStore().set(partition || 'default', { mode, custom: r.custom || null });
    _torIdleCheck();
    return { ok: true, ...r };
  });
  routingPending = operation;
  return operation.catch(e => ({ ok: false, error: e && e.message }));
});
ipcMain.handle('routing:get', (_e, partition) => { try { return readRouting()[partition || 'default'] || { mode: 'direct' }; } catch { return { mode: 'direct' }; } });

// A site rule removed or replaced left its route saved: Tor never stopped,
// and started again on every launch (found 2026-09-30). The window forgets
// the route of a partition no rule uses any more. The session keeps the proxy
// it has — a tab still open in it stays on Tor, never direct — and loads
// nothing after the next start (see _wireBrowsingSession).
ipcMain.handle('routing:forget', (_e, partition) => {
  const operation = routingPending.catch(() => {}).then(async () => {
    if (!require('./main/routing').isSiteRoutePartition(partition)) throw new Error(`"${partition}" is not a site route's session`);
    await getRoutingStore().delete(partition);
    _torIdleCheck();
    return { ok: true };
  });
  routingPending = operation;
  return operation.catch(e => ({ ok: false, error: e && e.message }));
});
// The partitions the window's site rules use, once it has loaded them: any
// other saved site route (left by a rule removed before routing:forget
// existed) is forgotten.
ipcMain.handle('routing:prune', (_e, used) => {
  const operation = routingPending.catch(() => {}).then(async () => {
    const stale = require('./main/routing').staleSiteRoutes(readRouting(), used);
    for (const partition of stale) await getRoutingStore().delete(partition);
    _torIdleCheck();
    return { ok: true, forgot: stale };
  });
  routingPending = operation;
  return operation.catch(e => ({ ok: false, error: e && e.message }));
});

// The hosts the main window's Tor and proxy rules name, for a private window
// to say they do not apply there (js/site-routes.js, _notePrivate). The rules
// live in the main window's storage; a private window's starts empty.
ipcMain.handle('siteroutes:routed-hosts', async () => {
  if (!mainWindow || mainWindow.isDestroyed()) throw new Error('The main window is closed, so its site rules cannot be read');
  const rules = await mainWindow.webContents.executeJavaScript(`typeof SiteRoutes === 'undefined' ? [] : SiteRoutes.rules().filter(r => r.mode === 'tor' || r.mode === 'proxy').map(r => ({ host: r.host, mode: r.mode }))`);
  if (!Array.isArray(rules)) throw new Error('The site rules came back unreadable');
  return rules.filter(r => r && typeof r.host === 'string' && (r.mode === 'tor' || r.mode === 'proxy')).map(r => ({ host: r.host, mode: r.mode }));
});

// === All of Vex through one route ==========================================
//
// Routing existed per container, which is the right shape for "this account
// goes through Tor" and the wrong shape for what people mean by a VPN: send
// EVERYTHING through it, and tell me whether it is really working.
//
// Both halves are here. set-all applies one route to every browsing session
// (and the default one) in a single pass and records it under a name of its
// own, so a restart puts it back. check makes a real request through a real
// session and reports the address the internet saw — routed and direct, so
// the answer is a comparison rather than a claim.
const _ALL_ROUTE_KEY = require('./main/routing').ALL_ROUTE_KEY;
// Set by the Discord/Roblox bypass: puts its panel proxies back once all of
// Vex no longer goes through one route.
let _reapplyPanelBypass = null;

// "All of Vex" covered the default session and the four built-in browsing
// sessions only. A private window, an off-the-record or burner tab, a
// throwaway identity, a container named by hand and every sidebar app panel
// went direct from the real address while the panel said "everything"
// (security scan P1). It now covers every session but these, which keep a
// route of their own: a Tor tab (already Tor), a site route, and a session
// whose own route is saved (a container through Tor). Sessions made later get
// it as they are made (_coverWithAllRoute), and mail goes through it too
// (_mailProxy).
function _allRoute() {
  const r = readRouting()[_ALL_ROUTE_KEY];
  return r && typeof r === 'object' && (r.mode === 'tor' || r.mode === 'proxy') ? r : null;
}
function _allRouteCovers(partition) {
  if (typeof partition !== 'string' || !partition || BROWSING_SESSIONS.includes(partition)) return false;
  if (partition.startsWith('tor-') || require('./main/routing').isSiteRoutePartition(partition)) return false;
  const own = readRouting()[partition];
  return !(own && typeof own === 'object' && (own.mode === 'tor' || own.mode === 'proxy'));
}
// Every session made so far that the route covers besides the built-in ones.
function _allRouteExtraTargets() {
  const out = [];
  for (const ses of secureSessions.sessions) {
    const partition = secureSessions.partitionOf({ session: ses });
    if (_allRouteCovers(partition)) out.push(partition);
  }
  return out;
}
// A session made while all of Vex goes through one route: it loads nothing
// until it is on that route. One whose own route is being set (a burner over
// Tor) is left to that.
function _coverWithAllRoute(ses, partition) {
  let all;
  try { all = _allRoute(); if (!all || !_allRouteCovers(partition)) return; }
  catch (err) { console.error('[Routing] could not tell whether a new session goes through the route for all of Vex:', err); return; }
  if (routingGeneration.has(partition)) return;
  ses.setProxy(require('./main/routing').REFUSED_PROXY).catch(err => console.error(`[Routing] ${partition} could not be closed off:`, err));
  require('./main/routing').markRoutedSession(ses, all.mode, webContents.getAllWebContents());
  applyRouting(partition, all.mode, all.custom || undefined)
    .catch(err => console.error(`[Routing] ${partition} could not be put on the route for all of Vex (it loads nothing until it is):`, err));
}
// Mail (IMAP, from main itself) goes through the route for all of Vex too:
// Tor's SOCKS port, or the proxy. Tor not running yet: mail waits for it
// rather than going direct.
async function _mailProxy() {
  const all = _allRoute();
  if (!all) return null;
  if (all.mode === 'proxy') return require('./main/routing').proxyAddress(all.custom);
  const port = (_torLauncher.isRunning() && _ownTorPort) || await detectTorPort();
  if (!port) throw new Error('All of Vex goes through Tor, and Tor is not connected yet. Mail waits until it is.');
  return `socks5://127.0.0.1:${port}`;
}

ipcMain.handle('routing:set-all', (event, mode, custom) => {
  const operation = routingPending.catch(() => {}).then(async () => {
    // Checked once up front, so a bad address is refused in its own words
    // rather than once per session (found 2026-09-29).
    if (mode === 'proxy') custom = require('./main/routing').proxyAddress(custom);
    // Saved first, so a session made meanwhile is covered too.
    const before = readRouting()[_ALL_ROUTE_KEY] || null;
    if (mode === 'direct') await getRoutingStore().delete(_ALL_ROUTE_KEY);
    else await getRoutingStore().set(_ALL_ROUTE_KEY, { mode, custom: custom || null, at: Date.now() });
    const targets = [null, ...BROWSING_SESSIONS, ..._allRouteExtraTargets()];
    const failed = [];
    for (const partition of targets) {
      try { await applyRouting(partition, mode, custom, event && event.sender); }
      catch (err) { failed.push((partition || 'default') + ': ' + (err && err.message)); }
    }
    if (failed.length === targets.length) {
      if (before) await getRoutingStore().set(_ALL_ROUTE_KEY, before); else await getRoutingStore().delete(_ALL_ROUTE_KEY);
      throw new Error(failed[0] || 'Could not apply that route');
    }
    // The Discord and Roblox panels get their bypass back.
    if (mode === 'direct' && _reapplyPanelBypass) _reapplyPanelBypass();
    _torIdleCheck();
    return { ok: true, mode, custom: custom || null, partial: failed.length ? failed : null };
  });
  routingPending = operation;
  return operation.catch(e => ({ ok: false, error: e && e.message }));
});

ipcMain.handle('routing:get-all', () => {
  try { return readRouting()[_ALL_ROUTE_KEY] || { mode: 'direct' }; }
  catch { return { mode: 'direct' }; }
});

// What the internet sees, asked through one of Vex's own sessions so the
// answer reflects the route that session is really using. `direct` asks the
// same question through a throwaway session with no proxy at all, which is
// what makes the result mean something.
const _IP_SERVICE = 'https://api.ipify.org?format=json';
const _IP_TIMEOUT = 12000;

function _askApparentIp(ses) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (value) => { if (!done) { done = true; resolve(value); } };
    const timer = setTimeout(() => finish({ ok: false, error: 'No answer in ' + (_IP_TIMEOUT / 1000) + ' seconds' }), _IP_TIMEOUT);
    let req;
    try { req = net.request({ url: _IP_SERVICE, session: ses, useSessionCookies: false }); }
    catch (err) { clearTimeout(timer); return finish({ ok: false, error: (err && err.message) || 'Could not ask' }); }
    req.on('response', (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; if (body.length > 4096) { try { req.abort(); } catch {} } });
      res.on('end', () => {
        clearTimeout(timer);
        try {
          const parsed = JSON.parse(body);
          finish(parsed && parsed.ip ? { ok: true, ip: String(parsed.ip) } : { ok: false, error: 'The service answered with something unexpected' });
        } catch { finish({ ok: false, error: 'The service answered with something unexpected' }); }
      });
      res.on('error', (err) => { clearTimeout(timer); finish({ ok: false, error: (err && err.message) || 'The connection failed' }); });
    });
    req.on('error', (err) => { clearTimeout(timer); finish({ ok: false, error: (err && err.message) || 'The connection failed' }); });
    try { req.end(); } catch (err) { clearTimeout(timer); finish({ ok: false, error: (err && err.message) || 'Could not ask' }); }
  });
}

ipcMain.handle('routing:check', async (_e, partition) => {
  const routed = partition ? secureSessions.fromPartition(partition) : secureSessions.fromPartition('persist:main');
  const began = Date.now();
  const through = await _askApparentIp(routed);
  const took = Date.now() - began;
  // A second session, never routed, for the comparison. Made fresh each time
  // so nothing about it can have been changed by a route.
  const bare = session.fromPartition('vex-route-check-' + Date.now());
  try { await bare.setProxy({ mode: 'direct' }); } catch { /* it is direct already */ }
  const plain = await _askApparentIp(bare);
  try { await bare.clearStorageData(); } catch { /* nothing was stored */ }
  return {
    ok: !!through.ok,
    ip: through.ip || null,
    error: through.error || null,
    directIp: plain.ok ? plain.ip : null,
    directError: plain.ok ? null : (plain.error || null),
    changed: !!(through.ok && plain.ok && through.ip !== plain.ip),
    ms: took,
    service: _IP_SERVICE,
  };
});

// A container named by hand (persist:container-<name>) and a site route's
// session (persist:route-*) are made when their first tab opens, and got none
// of what persist:main has: no permission handler, so Electron granted camera,
// microphone and notifications without asking, and WebRTC gave sites the raw
// LAN address; no downloads panel, ad blocker or Chrome identity either
// (found 2026-09-30). Each is wired the first time it is made. The three
// built-in containers were missing the same, and get it here too.
function _wireBrowsingSession(ses, partition) {
  if (!/^persist:(?:container-|route-)/.test(partition)) return;
  const routing = require('./main/routing');
  if (routing.isSiteRoutePartition(partition)) {
    // A site route's session loads nothing until its route is put on it: its
    // rule may be gone (routing:forget), and direct is what it exists to
    // avoid. The saved route, or the rule's arm(), replaces this proxy.
    ses.setProxy(routing.REFUSED_PROXY).catch(err => console.error(`[Routing] ${partition} could not be closed off:`, err));
    routing.markRoutedSession(ses, partition === 'persist:route-tor' ? 'tor' : 'proxy', webContents.getAllWebContents());
  }
  ses.setUserAgent(CHROME_UA);
  wireClientHintsOnSession(ses);
  wireAdblockerOnSession(ses, partition);
  wireDownloadsOnSession(ses, partition);
  if (partition === 'persist:route-tor') {
    // Like a Tor tab (tor:create): every site permission denied.
    ses.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));
    ses.setPermissionCheckHandler(() => false);
  } else {
    wirePermissionsOnSession(ses, partition);
    wireWebHidOnSession(ses, partition);
    wireDisplayMediaOnSession(ses);
  }
  // The built-in containers get theirs in createWindow.
  if (!BROWSING_SESSIONS.includes(partition)) {
    ses.webRequest.onHeadersReceived((details, callback) => {
      const responseHeaders = { ...details.responseHeaders };
      _addMediaCorsHeaders(details, responseHeaders);
      _scriptsOffCsp(details, responseHeaders);
      callback({ responseHeaders });
    });
  }
  attachGuestPreloads(ses);
  wireSpellcheckOnSession(ses);
}

// Re-apply saved routings at startup (Tor ones lazily — starting Tor for every
// container on boot would be heavy, so a Tor container reconnects on first use;
// custom proxies are cheap and applied immediately).
async function applyStoredRoutings() {
  await require('./main/routing').restoreRoutes({ routes: readRouting(),
    getSession: partition => partition ? secureSessions.fromPartition(partition) : session.defaultSession,
    // '__all__' means every browsing session, not a session of its own.
    allPartitions: BROWSING_SESSIONS,
    applyRouting, report: err => console.warn('[Routing] could not restore a route:', err.message) });
}

// What a session that lasts until it is closed gets — a private window's, and
// an off-the-record or burner tab's (otr-*, wired as it is made). The
// off-the-record ones had none of it: no permission handler, so Electron gave
// every site the camera, microphone and notifications without asking; no ad
// blocker or site rules; Electron's own user agent naming the app; no
// downloads panel (security scan H2). WebRTC there shows sites only the
// public address (web-contents-created).
function _wireEphemeralBrowsing(ses, tag) {
  if (ses.__vexEphemeralWired) return;
  ses.__vexEphemeralWired = true;
  ses.__vexEphemeral = true;
  wireDownloadsOnSession(ses, tag);
  // A burner put through Tor asks nothing and is given nothing, as a Tor tab.
  wirePermissionsOnSession(ses, tag, { denyOverTor: true });
  wireDisplayMediaOnSession(ses);
  attachGuestPreloads(ses);
  // Header stripping + ad blocker, as in the main session.
  ses.webRequest.onHeadersReceived((details, callback) => {
    const rh = { ...details.responseHeaders };
    // Per-site switches hold in a private window too: a site whose cookies
    // are off may not set any here either — they were ignored in private
    // windows before (found 2026-09-29). Sending none is done by
    // wireClientHintsOnSession below.
    if (Object.keys(_siteRules).length && SiteRules.blocksCookies(_siteRules, details.url)) {
      for (const k of Object.keys(rh)) if (k.toLowerCase() === 'set-cookie') delete rh[k];
    }
    _scriptsOffCsp(details, rh);
    callback({ responseHeaders: rh });
  });
  ses.webRequest.onBeforeRequest((details, callback) => {
    // A site whose third-party content is switched off, as in
    // wireAdblockerOnSession (found 2026-09-29).
    if (Object.keys(_siteRules).length && SiteRules.blocksThirdParty(_siteRules, _pageUrlOf(details.webContentsId), details.url)) {
      callback({ cancel: true });
      return;
    }
    const blocked = adBlockerEnabled && (engineBlocks(details) === true || shouldBlock(details.url))
      && !_adsAllowedOn(_pageUrlOf(details.webContentsId), ses);
    if (blocked) _recordTracker(details.url, details.webContentsId);
    callback({ cancel: blocked });
  });
  ses.setUserAgent(CHROME_UA);
  wireClientHintsOnSession(ses);
}

// clean: the window for sharing a screen — private, and showing only `url`
// (the renderer hides the bookmarks bar and sidebar and turns streamer mode on).
function openPrivateWindow({ clean = false, url = '', look = '', uiMode = '' } = {}) {
  if (_vexLocked) throw new Error('Vex is locked — unlock it first');
  const privatePartition = secureSessions.newPrivatePartition();
  const privSession = secureSessions.fromPartition(privatePartition);
  _wireEphemeralBrowsing(privSession, 'private');

  const privWin = new BrowserWindow({
    width: 1200, height: 800, frame: false, titleBarStyle: 'hidden',
    backgroundColor: '#1a0a1a',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      partition: privatePartition,
      webviewTag: true, contextIsolation: true, nodeIntegration: false
    }
  });
  secureSessions.registerHost(privWin, privatePartition);
  privWin.loadFile(path.join(__dirname, 'renderer', 'index.html'), { query: { private: 'true', partition: privatePartition, ...(look ? { look } : {}), ...(uiMode ? { uiMode } : {}), ...(clean ? { clean: 'true', url } : {}) } });
  return true;
}
// `look` is the opener's GUI style: a private window keeps its own storage,
// so without it every private window came up in the Classic look.
// How long the computer has had no keyboard or mouse input, for Lock when idle.
ipcMain.handle('app:idle-seconds', () => require('electron').powerMonitor.getSystemIdleTime());
// A small always-on-top window over other apps (src/main/overlay.js).
let _overlay = null;
ipcMain.handle('overlay:open', (_e, url, opacity, partition) => {
  const { createOverlayWindow } = require('./main/overlay');
  _refuseMainProfileCopy(partition);
  if (_overlay && !_overlay.isDestroyed()) { _overlay.close(); _overlay = null; }
  _overlay = createOverlayWindow({ BrowserWindow, url, opacity: typeof opacity === 'number' ? opacity : 0.92,
    onOpacity: (o) => { try { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('overlay:opacity-changed', o); } catch {} } });
  secureSessions.registerWebWindow(_overlay.webContents);
  _openLinksAsTabs(_overlay.webContents);
  _overlay.on('closed', () => { _overlay = null; });
  return { ok: true };
});
ipcMain.handle('overlay:close', () => { if (_overlay && !_overlay.isDestroyed()) _overlay.close(); _overlay = null; return { ok: true }; });
// `uiMode` likewise carries the opener's Simple/Full mode (js/simple-mode.js).
ipcMain.handle('open-private-window', (_e, look, uiMode) => openPrivateWindow({ look: look || '', uiMode: uiMode || '' }));
ipcMain.handle('open-clean-window', (_e, url, look, uiMode) => openPrivateWindow({ clean: true, url, look: look || '', uiMode: uiMode || '' }));

// === Updates (src/main/updates.js; the cover is js/update-notifier.js) ======
// The check is a plain HTTPS GET of latest.yml and a version compare. We
// deliberately do NOT use electron-updater: on this (castLabs, unsigned) build
// its native helpers (7za/differential tooling) crashed machines missing the
// MSVC runtime, and publisherName in package.json made it refuse every update
// of the unsigned installer. Download, checksum and install are Vex's own.
// net.fetch follows GitHub's redirect to its file storage.
const _updater = require('./main/updates').createUpdater({
  fetch: (url, init) => net.fetch(url, init),
  fs, dir: path.join(app.getPath('userData'), 'updates'), currentVersion: app.getVersion(),
  spawn: require('child_process').spawn, parseChangelogList: _mainHelpers.parseChangelogList,
});
// Only Vex's own main window may download or install an update: not a private
// window, not a page, not another window of Vex's.
function _updatesFromMainWindow(event) {
  if (!mainWindow || mainWindow.isDestroyed() || event.sender !== mainWindow.webContents) throw new Error('Only the main Vex window can update Vex');
}
let _pendingInstall = null;
// Vex has closed its windows (tabs saved) and is quitting: start the installer
// now, detached, so it outlives Vex. With --updated it waits for Vex to exit.
app.on('quit', () => {
  if (!_pendingInstall) return;
  const plan = _pendingInstall;
  _pendingInstall = null;
  try {
    _updater.launch(plan);
    console.log('[Updates] installer started:', plan.file, plan.args.join(' '));
  } catch (err) { console.error('[Updates] the installer could not be started:', err.message); }
});
ipcMain.handle('check-for-updates', () => _updater.check());
ipcMain.handle('updates:upcoming-notes', async (_e, version) => {
  try { return { ok: true, ...(await _updater.notes(version)) }; }
  catch (err) { return { ok: false, error: err.message }; }
});
ipcMain.handle('updates:download', async (event, version) => {
  _updatesFromMainWindow(event);
  const sender = event.sender;
  return _updater.download(version, progress => { if (!sender.isDestroyed()) sender.send('updates:progress', progress); });
});
ipcMain.handle('updates:cancel', (event) => { _updatesFromMainWindow(event); return { ok: _updater.cancel() }; });
ipcMain.handle('updates:install', async (event, version) => {
  _updatesFromMainWindow(event);
  let plan;
  try { plan = await _updater.prepareInstall(version); }
  catch (err) { return { ok: false, error: err.message }; }
  // Close the main window the way its X does, which saves the tabs first
  // (session-security.js), then quit; the installer starts on 'quit' above.
  // If saving fails the window stays open and says so, and nothing installs.
  const win = mainWindow;
  _pendingInstall = plan;
  // The installer replaces Vex.exe under every profile, so the other profiles
  // that are open close too — saved, the way their X does — once this one has
  // closed; the default profile reopens them after the update.
  const quit = () => { _closeOtherProfilesForUpdate(); app.quit(); };
  win.once('closed', quit);
  setTimeout(() => {
    if (win.isDestroyed()) return;
    win.removeListener('closed', quit);
    _pendingInstall = null;
    win.webContents.send('updates:install-failed', { error: 'Vex could not save your tabs, so it did not close to install the update. Try again once the problem it reported is fixed.' });
  }, 9000);
  win.close();
  return { ok: true };
});
// The backup made right before an update installs (src/main/update-backups.js):
// the same file Settings › Backup saves, kept in userData/backups (newest 3),
// and listed there with a Restore button (js/backup.js).
const _updateBackups = require('./main/update-backups').createUpdateBackups({ fs, dir: path.join(app.getPath('userData'), 'backups') });
ipcMain.handle('updates:backup-save', (event, version, text) => {
  _updatesFromMainWindow(event);
  try {
    const saved = _updateBackups.save(version, text);
    console.log('[Updates] backup before the update saved:', saved.file, saved.bytes, 'bytes', saved.removed.length ? '(removed ' + saved.removed.join(', ') + ')' : '');
    return { ok: true, name: saved.name, bytes: saved.bytes };
  } catch (err) { return { ok: false, error: err.message }; }
});
ipcMain.handle('updates:backups', (event) => {
  _updatesFromMainWindow(event);
  try { return { ok: true, items: _updateBackups.list() }; }
  catch (err) { return { ok: false, error: err.message }; }
});
ipcMain.handle('updates:backup-read', (event, name) => {
  _updatesFromMainWindow(event);
  try { return { ok: true, text: _updateBackups.read(name) }; }
  catch (err) { return { ok: false, error: err.message }; }
});

// === Profiles: the switcher (js/profiles-ui.js) and running side by side ====
// _profile was chosen at the top of this file (src/main/profiles.js). Each
// profile is its own Vex process; opening one starts Vex with --profile=<id>,
// and if that profile is already open the single-instance lock hands the
// launch to it, which brings its window forward (second-instance above).
const _profiles = require('./main/profiles');
function _launchProfile(id, extra = []) {
  const args = _profiles.launchArgs({ id, packaged: app.isPackaged, appPath: app.getAppPath(), argv: process.argv, extra });
  const child = require('child_process').spawn(process.execPath, args, { detached: true, stdio: 'ignore' });
  child.on('error', err => console.error('[Profiles] could not start profile', id + ':', err.message));
  child.unref();
  console.log('[Profiles] started profile', id, extra.join(' '));
}
function _closeOtherProfilesForUpdate() {
  try {
    const open = _profile.store.list().filter(p => p.id !== _profile.id && _profile.store.isRunning(p.id)).map(p => p.id);
    for (const id of open) _launchProfile(id, ['--vex-close-for-update']);
    // The installer starts the default profile again; it reopens the rest.
    const reopen = [...open, _profile.id].filter(id => id !== _profiles.DEFAULT_ID);
    if (reopen.length) _profile.store.noteReopen(reopen, app.getVersion());
    console.log('[Profiles] closing for the update:', open.join(', ') || 'no other profile open', '| reopen after:', reopen.join(', ') || 'none');
  } catch (err) { console.error('[Profiles] could not close the other profiles for the update:', err.message); }
}
function _closeForOtherProfileUpdate() {
  console.log('[Profiles] another profile is installing an update — closing');
  _pendingInstall = null;
  if (!mainWindow || mainWindow.isDestroyed()) { app.quit(); return; }
  const win = mainWindow;
  win.once('closed', () => app.quit());
  win.close();
}
function _profilesFromMainWindow(event) {
  if (!mainWindow || mainWindow.isDestroyed() || event.sender !== mainWindow.webContents) throw new Error('Only the main Vex window manages profiles');
}
function _profileDetails(entry) {
  return _profiles.appDetails({ id: entry.id, name: entry.name, execPath: process.execPath, packaged: app.isPackaged, appPath: app.getAppPath(), argv: process.argv });
}
// Each extra profile's windows group on their own on the taskbar, and a
// pinned one starts that profile. The process keeps Vex's own id, which is
// what Windows toasts are shown under.
function _applyProfileDetails(win) {
  if (process.platform !== 'win32' || _profile.id === _profiles.DEFAULT_ID || !win || win.isDestroyed()) return;
  try { win.setAppDetails(_profileDetails(_profile.store.get(_profile.id))); }
  catch (err) { console.error('[Profiles] could not set the taskbar identity:', err.message); }
}
app.on('browser-window-created', (_e, win) => _applyProfileDetails(win));
// The default profile, started again by an update's installer, reopens the
// profiles that update closed (_closeOtherProfilesForUpdate).
if (_profile.id === _profiles.DEFAULT_ID) {
  app.whenReady().then(() => {
    let ids = [];
    try { ids = _profile.store.takeReopen(); }
    catch (err) { console.error('[Profiles] could not read which profiles to reopen:', err.message); }
    for (const id of ids) _launchProfile(id);
  });
}
function _profileView() {
  const list = _profile.store.list();
  return {
    current: _profile.id,
    profiles: list.map(p => ({
      id: p.id, name: p.name, color: p.color, icon: p.icon, created: p.created, isDefault: p.isDefault,
      current: p.id === _profile.id,
      running: p.id === _profile.id || _profile.store.isRunning(p.id),
    })),
  };
}
ipcMain.handle('profiles:list', (event) => { _profilesFromMainWindow(event); return _profileView(); });
ipcMain.handle('profiles:create', (event, look) => {
  _profilesFromMainWindow(event);
  const entry = _profile.store.create(look);
  console.log('[Profiles] created', entry.id, entry.dir);
  return _profileView();
});
ipcMain.handle('profiles:update', (event, id, patch) => {
  _profilesFromMainWindow(event);
  _profile.store.update(id, patch);
  if (id === _profile.id) for (const w of BrowserWindow.getAllWindows()) _applyProfileDetails(w);
  return _profileView();
});
ipcMain.handle('profiles:open', (event, id) => {
  _profilesFromMainWindow(event);
  _profile.store.get(id);
  if (id === _profile.id) { focusMainWindow(); return { ok: true, focused: true }; }
  _launchProfile(id);
  return { ok: true };
});
// The desktop shortcuts a profile's "Create desktop shortcut" made: found by
// the --profile argument they start, whatever the profile is called now.
function _profileShortcutsOnDesktop(id) {
  const desktop = app.getPath('desktop');
  let names;
  try { names = fs.readdirSync(desktop).filter(n => /^Vex \(.*\)\.lnk$/i.test(n)); }
  catch (err) { console.error('[Profiles] could not read the desktop folder:', err.message); return []; }
  return names.map(n => path.join(desktop, n)).filter(file => {
    try { return String(shell.readShortcutLink(file).args || '').split(/\s+/).includes('--profile=' + id); }
    catch { return false; }
  });
}
ipcMain.handle('profiles:shortcut', (event, id) => {
  _profilesFromMainWindow(event);
  const entry = _profile.store.get(id);
  const spec = _profiles.shortcutSpec({ id, name: entry.name, execPath: process.execPath, packaged: app.isPackaged, appPath: app.getAppPath(), argv: process.argv, desktopDir: app.getPath('desktop') });
  if (!shell.writeShortcutLink(spec.file, 'create', spec.options)) throw new Error('Windows did not create the shortcut ' + spec.file);
  console.log('[Profiles] desktop shortcut written:', spec.file);
  return { ok: true, file: spec.file };
});
ipcMain.handle('profiles:delete', async (event, id) => {
  _profilesFromMainWindow(event);
  const shortcuts = _profileShortcutsOnDesktop(id);
  _profile.store.remove(id, { currentId: _profile.id });
  console.log('[Profiles] deleted', id);
  for (const file of shortcuts) {
    try { fs.rmSync(file, { force: true }); console.log('[Profiles] removed its desktop shortcut', file); }
    catch (err) { console.error('[Profiles] could not remove the desktop shortcut', file + ':', err.message); }
  }
  // Its reminders' wake-ups would start Vex for a profile that is gone.
  const scheduler = require('./main/os-schedule').createOsScheduler({
    platform: process.env.VEX_NO_OS_SCHEDULE === '1' ? 'none' : process.platform,
    execFile: require('child_process').execFile, log: (m) => console.log(m),
  });
  let tasks;
  try { tasks = await scheduler.unregisterScope(id); }
  catch (err) { console.error('[Profiles] could not remove the deleted profile\'s reminder tasks:', err.message); tasks = 'failed: ' + err.message; }
  return { ..._profileView(), removedShortcuts: shortcuts.length, tasks };
});

ipcMain.handle('get-app-version', () => app.getVersion());
// Open an http(s) URL in the system's default browser (used by the "What's New"
// modal so GitHub renders properly instead of in an in-app window).
// A new email in the user's own mail app, with no recipient: Vex's mail is
// read-only, so a draft is handed to whatever handles mailto:.
ipcMain.handle('mail:compose', async (_e, { subject, body }) => {
  const url = require('./main/mail-draft').mailtoUrl(subject, body);
  await shell.openExternal(url);
  return { ok: true };
});
ipcMain.handle('open-external', (_e, url) => {
  try { if (typeof url === 'string' && /^https?:\/\//i.test(url)) { shell.openExternal(url); return { ok: true }; } } catch {}
  return { ok: false };
});
// Release notes for the "What's New" update log. LOCAL-FIRST: the bundled
// CHANGELOG.md always has the running version's notes, needs no network, and
// can't 404, rate-limit, or return an empty body — all three of which the
// GitHub path did (the "Couldn't load the release notes (offline?)" dialog
// was a fetch that SUCCEEDED against a fallback release with no body, shown
// to a user who was online). GitHub remains only as a fallback for the
// unlikely case the local file is unreadable.
ipcMain.handle('updates:notes', async (_e, tag) => {
  const ver = tag || ('v' + app.getVersion());
  try {
    const md = fs.readFileSync(path.join(__dirname, '..', 'CHANGELOG.md'), 'utf8');
    const local = _mainHelpers.parseChangelogEntry(md, ver.replace(/^v/, ''));
    if (local) return { ...local, url: 'https://github.com/0xmortuex/Vex/releases' };
  } catch (err) {
    console.warn('[WhatsNew] local changelog unavailable, falling back to GitHub:', err.message);
  }
  const fetchJson = async (url) => {
    try {
      const response = await boundedNetFetch(url, { maxBytes: 1024 * 1024, timeoutMs: 8000,
        headers: { 'User-Agent': 'Vex', Accept: 'application/vnd.github+json' } });
      return response.ok ? await response.json() : null;
    } catch { return null; }
  };
  let rel = await fetchJson('https://api.github.com/repos/0xmortuex/Vex/releases/tags/' + encodeURIComponent(ver));
  if (!rel || !rel.tag_name) rel = await fetchJson('https://api.github.com/repos/0xmortuex/Vex/releases/latest');
  if (!rel || !rel.tag_name) return null;
  return { version: rel.tag_name, name: rel.name || rel.tag_name, body: rel.body || '', url: rel.html_url, publishedAt: rel.published_at };
});
// Full release history for the "What's New" version picker. Local-first from the
// bundled CHANGELOG.md — no network, can't rate-limit, and always has every
// shipped version. Returns [] if the file is unreadable (the picker just hides).
ipcMain.handle('updates:list', async () => {
  try {
    const md = fs.readFileSync(path.join(__dirname, '..', 'CHANGELOG.md'), 'utf8');
    const list = _mainHelpers.parseChangelogList(md);
    if (list && list.length) {
      return list.map((e) => ({ ...e, url: 'https://github.com/0xmortuex/Vex/releases/tag/' + e.version }));
    }
  } catch (err) {
    console.warn('[WhatsNew] changelog list unavailable:', err.message);
  }
  return [];
});
// === Custom Image theme — persisted in the main process so EVERY start page can
// read it, whether or not one was open when the image was picked. The old path
// only pushed the image into start-page guests that happened to be open at the
// time (via localStorage on the shared persist:main partition), so choosing the
// theme while a website was the active tab left later new-tab pages blank. This
// on-disk copy is the authoritative source; the renderer keeps a localStorage
// mirror purely as a no-flash fast path. Stored as the raw data: URL string. ===
let _customThemeImage; // undefined = not loaded, null = none, string = data: URL
function _customThemeImagePath() { return path.join(app.getPath('userData'), 'custom-theme-image.txt'); }
function _loadCustomThemeImage() {
  if (_customThemeImage !== undefined) return _customThemeImage;
  try { _customThemeImage = fs.readFileSync(_customThemeImagePath(), 'utf8') || null; }
  catch { _customThemeImage = null; }
  return _customThemeImage;
}
// Light and dark follows Windows' app mode (src/main/system-theme.js); every
// Vex window (the main one and private ones) hears when it changes.
app.whenReady().then(() => {
  require('./main/system-theme').wireSystemTheme({
    ipcMain,
    nativeTheme: require('electron').nativeTheme,
    windows: () => BrowserWindow.getAllWindows().filter(w => !w.isDestroyed() && secureSessions.owner(w.webContents)?.win === w),
  });
});
// Your own themes (js/theme-studio.js) each keep their New Tab background
// image here, one file per theme id (theme-images/<id>.txt). Without an id
// these read and clear the old single Custom Image file, which the renderer
// moves into a theme of its own once (ThemeStudio.migrateLegacy). The id and
// the data: URL are checked by the IPC schema before they get here.
function _themeImagePath(id) { return path.join(app.getPath('userData'), 'theme-images', id + '.txt'); }
ipcMain.handle('theme:get-custom-image', (_e, id) => {
  if (!id) return _loadCustomThemeImage();
  try { return fs.readFileSync(_themeImagePath(id), 'utf8') || null; }
  catch (e) { if (e.code === 'ENOENT') return null; throw e; }
});
ipcMain.handle('theme:set-custom-image', (_e, dataUrl, id) => {
  try {
    const file = id ? _themeImagePath(id) : _customThemeImagePath();
    if (typeof dataUrl === 'string' && /^data:image\//.test(dataUrl)) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, dataUrl);
      if (!id) _customThemeImage = dataUrl;
    } else {
      try { fs.unlinkSync(file); } catch (e) { if (e.code !== 'ENOENT') throw e; }
      if (!id) _customThemeImage = null;
    }
    return { ok: true };
  } catch (e) {
    console.warn('[Theme] custom image persist failed:', e && e.message);
    return { ok: false, error: e && e.message };
  }
});
// "Use my Windows wallpaper" in the theme editor: reads the desktop picture,
// never changes any Windows setting (src/main/wallpaper.js).
require('./main/wallpaper').registerWallpaper({
  ipcMain, platform: process.platform, env: process.env,
  execFile: require('child_process').execFile, fs, nativeImage,
});
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
    // 1) Remove the stale/empty standard-CDM dir + cached crx so the next launch
    //    re-fetches. We keep MediaFoundationWidevineCdm (it installs fine) — the
    //    updater re-registers it from disk on relaunch.
    for (const rel of ['WidevineCdm', 'component_crx_cache', 'widevine_cdm_hint']) {
      try { fs.rmSync(path.join(ud, rel), { recursive: true, force: true }); } catch {}
    }
    // 2) The real blocker: the component updater records each component in
    //    "Local State" → updateclientdata and backs off re-downloading one that
    //    previously failed (the standard Widevine CDM has no installed version
    //    there). Drop that record so the updater treats the components as new and
    //    downloads them cleanly. Preserve everything else — especially os_crypt,
    //    whose key decrypts saved cookies/passwords; wiping the whole file would
    //    lose them.
    try {
      const lsPath = path.join(ud, 'Local State');
      const ls = JSON.parse(fs.readFileSync(lsPath, 'utf8'));
      if (ls && ls.updateclientdata) {
        delete ls.updateclientdata;
        fs.writeFileSync(lsPath, JSON.stringify(ls));
      }
    } catch (e) { console.warn('[Widevine] could not reset Local State:', e && e.message); }
    console.log('[Widevine] reset component state; relaunching for clean install');
    app.relaunch();
    app.exit(0);
    return { ok: true };
  } catch (e) {
    console.warn('[Widevine] retry failed:', e && e.message);
    return { ok: false, error: e && e.message };
  }
});

// Restart Vex — used by settings that only take effect at launch (e.g. Memory
// Saver's command-line flags). The open tab set is persisted continuously, so a
// relaunch restores the session; this just re-runs main with the new flags.
// Bring the main window to the foreground (used by PiP "Back to tab", which
// can't focus the app itself in a webview browser).
ipcMain.handle('app:focus', () => {
  try { if (mainWindow && !mainWindow.isDestroyed()) { if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.show(); mainWindow.focus(); } return { ok: true }; }
  catch (e) { return { ok: false, error: e && e.message }; }
});

ipcMain.handle('app:restart', () => {
  // Without --safe-mode: "Restart normally" after a safe-mode start must not
  // start in safe mode again.
  const args = process.argv.slice(1).filter(a => a !== '--safe-mode');
  try {
    // Close the window the way its X does, which saves everything first, and
    // start again once it has closed. app.exit(0) straight away dropped what
    // was still waiting to be saved (found 2026-09-29). If saving fails the
    // window stays open and says so, and Vex does not restart.
    if (mainWindow && !mainWindow.isDestroyed()) {
      const win = mainWindow;
      const relaunch = () => { app.relaunch({ args }); app.exit(0); };
      win.once('closed', relaunch);
      // Saving gives up after 8 s (session-security.js); a later ordinary
      // close must then not restart.
      setTimeout(() => { if (!win.isDestroyed()) win.removeListener('closed', relaunch); }, 9000);
      win.close();
      return { ok: true };
    }
    app.relaunch({ args }); app.exit(0); return { ok: true };
  }
  catch (e) { return { ok: false, error: e && e.message }; }
});

// === Desktop notifications and reminders ====================================
//
// Both live in the main process on purpose. The renderer is a file:// page and
// Chromium denies it the Notification API outright — every renderer-side
// notification Vex ever had was dead on arrival (see src/main/notify.js). And a
// reminder whose timer lived in the renderer died with a reload, and could not
// fire at all with Vex closed. src/main/reminders.js holds the timer; on
// Windows, Task Scheduler launches Vex at the time if it is not running.
function focusMainWindow() {
  try {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  } catch (err) { console.error('[Reminders] could not focus the window:', err.message); }
}

// A button on a Windows toast reaches Vex as a vex:// URL in argv — on a cold
// start, or through second-instance when Vex is already running. Returns true
// when the argument was one of ours.
//   vex://snooze/<id>   push the reminder back nine minutes
//   vex://open/<id>     open it in the interface
function handleVexAction(arg) {
  // `?profile=<id>`: the profile the toast came from (main/notify.js), already
  // used to pick this profile at launch.
  const m = /^vex:\/\/(snooze|open)\/([A-Za-z0-9_-]{1,64})\/?(?:\?profile=[a-z0-9-]{1,40})?$/.exec(String(arg || ''));
  if (!m) return false;
  const [, action, id] = m;
  focusMainWindow();
  const send = (channel, payload) => { try { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload); } catch {} };
  if (!reminders) { console.error('[Reminders] toast action before reminders started:', arg); return true; }
  if (action === 'snooze') {
    reminders.snooze(id, 9 * 60 * 1000)
      .then(copy => { console.log(`[Reminders] snoozed ${id} from the toast → ${copy.id}`); send('reminders:snoozed', { id, copy }); })
      .catch(err => { console.error('[Reminders] snooze from toast failed:', err.message); send('reminders:snoozed', { id, error: err.message }); });
  } else {
    reminders.ack(id).catch(() => {});
    send('reminders:clicked', { id });
  }
  return true;
}

const notifier = require('./main/notify').createNotifier({
  Notification, nativeImage,
  iconPath: path.join(app.getAppPath(), 'assets', 'icon.ico'),
  // Clicking a toast brings Vex forward; a reminder's toast also opens the
  // reminder itself in the interface, with a way to snooze it.
  onClick: ({ tag } = {}) => {
    focusMainWindow();
    if (tag && reminders && mainWindow && !mainWindow.isDestroyed()) {
      try { mainWindow.webContents.send('reminders:clicked', { id: tag }); } catch {}
    }
  },
  // A toast's buttons reopen this profile, not the default one.
  profile: _profile.id === 'default' ? null : _profile.id,
  log: (m) => console.log(m),
});
// Windows heads a toast with the Start Menu shortcut that targets the process.
// The installer writes one for Vex.exe; a development run is electron.exe,
// and without a shortcut of its own Electron writes one named "Electron" on
// the first toast. Ours goes first, so dev toasts are headed "Vex (dev)".
try {
  require('./main/notify').ensureDevShortcut({
    shell, fs, packaged: app.isPackaged,
    startMenuDir: process.env.APPDATA ? path.join(process.env.APPDATA, 'Microsoft', 'Windows', 'Start Menu', 'Programs') : null,
    execPath: process.execPath, appPath: app.getAppPath(),
    iconPath: path.join(app.getAppPath(), 'assets', 'icon.ico'),
    appUserModelId: 'com.vex.browser',
    log: (m) => console.log(m),
  });
} catch (err) { console.error('[Notify] could not write the dev Start Menu shortcut:', err.message); }

function startReminders() {
  const { JsonStore } = require('./main/file-store');
  const osScheduler = require('./main/os-schedule').createOsScheduler({
    // A throwaway profile (a test run, a live probe) must not leave Windows
    // scheduled tasks behind — 69 were found pointing at deleted temp
    // profiles, thirty of them launching Vex at once on a Friday afternoon.
    platform: process.env.VEX_NO_OS_SCHEDULE === '1' ? 'none' : process.platform,
    execFile: require('child_process').execFile,
    execPath: process.execPath,
    appPath: app.getAppPath(),
    packaged: app.isPackaged,
    // A Vex running on a non-default profile must be woken into the same one;
    // the reminder is in that profile's store and nowhere else.
    extraArgs: process.argv.filter(a => /^--user-data-dir=/.test(a)).concat(_profile.id === 'default' ? [] : ['--profile=' + _profile.id]),
    // Each Vex profile's tasks are named apart (main/os-schedule.js).
    scope: _profile.id === 'default' ? undefined : _profile.id,
    log: (m) => console.log(m),
  });
  reminders = require('./main/reminders').createReminders({
    store: new JsonStore(userDataPath),
    notifier,
    osScheduler,
    log: (m) => console.log(m),
    // The renderer shows the same reminder in-app as well — and, when the OS
    // toast was refused, that in-app copy is the only place it appears, so the
    // failure is stated rather than lost.
    onFired: (payload) => {
      try { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('reminders:fired', payload); } catch {}
      if (payload.delivered === 'failed') focusMainWindow();
    },
  });
  reminders.init()
    .then(() => { for (const a of process.argv) handleVexAction(a); })
    .catch(err => console.error('[Reminders] failed to start:', err.message));
  if (process.argv.some(a => /^--reminder=/.test(a))) console.log('[Reminders] launched by the OS for a reminder');
}

ipcMain.handle('notify:show', async (_e, payload) => {
  const { title, body } = payload || {};
  // Rejections travel to the renderer as the error message; nothing is hidden.
  return notifier.show({ title, body });
});
ipcMain.handle('reminders:create', async (_e, payload) => {
  if (!reminders) throw new Error('Reminders have not started yet');
  return reminders.create(payload || {});
});
ipcMain.handle('reminders:list', async () => {
  if (!reminders) throw new Error('Reminders have not started yet');
  return reminders.list();
});
ipcMain.handle('reminders:delete', async (_e, id) => {
  if (!reminders) throw new Error('Reminders have not started yet');
  return reminders.delete(id);
});
// A tab opened a site: fire any "next time I open …" reminder for it.
ipcMain.handle('reminders:visited', async (_e, host) => {
  if (!reminders) throw new Error('Reminders have not started yet');
  return reminders.visited(host);
});
// Reminders carried in by Vex Sync from another machine.
ipcMain.handle('reminders:import', async (_e, items) => {
  if (!reminders) throw new Error('Reminders have not started yet');
  return reminders.importList(items);
});
// An alarm's ringing was dismissed.
ipcMain.handle('reminders:ack', async (_e, id) => {
  if (!reminders) throw new Error('Reminders have not started yet');
  return reminders.ack(id);
});
// A focus session holds non-urgent reminders until it ends (0 clears).
// Focus and Meeting mode each hold reminders; stopping one used to end the
// other's hold too (found 2026-09-29).
ipcMain.handle('reminders:hold', async (_e, untilMs, who) => {
  if (!reminders) throw new Error('Reminders have not started yet');
  return reminders.hold(untilMs, who);
});

// Save a small text file where the user chooses. Used for calendar entries;
// the renderer is a file:// page and cannot offer a download of its own.
ipcMain.handle('file:save-text', async (_e, { name, text, kind } = {}) => {
  const filters = kind === 'ics'
    ? [{ name: 'Calendar entry', extensions: ['ics'] }]
    : kind === 'md'
      ? [{ name: 'Markdown', extensions: ['md'] }]
      : [{ name: 'Text', extensions: ['txt'] }];
  const safeName = String(name || 'vex.txt').replace(/[\\/:*?"<>|]+/g, '-').slice(0, 120);
  const r = await dialog.showSaveDialog(mainWindow && !mainWindow.isDestroyed() ? mainWindow : undefined, {
    title: 'Save', defaultPath: path.join(app.getPath('downloads'), safeName), filters,
  });
  if (r.canceled || !r.filePath) return { ok: false, cancelled: true };
  await fs.promises.writeFile(r.filePath, String(text || ''), 'utf8');
  return { ok: true, path: r.filePath };
});

// Copy a picture onto the clipboard (renderer: WebviewManager.copyImage).
// For the pictures a right-click finds under a link or an overlay, where
// Chromium's own copyImageAt has nothing at that point to copy. Fetched in the
// page's own session, so a signed-in picture is fetched signed in. PNG and
// JPEG are asked for first, because the clipboard image cannot be made from
// WebP or AVIF.
ipcMain.handle('image:copy', async (_e, url, partition) => {
  try {
    const { nativeImage, clipboard, session } = require('electron');
    let img;
    if (/^data:image\//i.test(url)) img = nativeImage.createFromDataURL(url);
    else if (/^https?:\/\//i.test(url)) {
      if (partition && !/^(persist:)?[\w.-]{1,120}$/.test(partition)) throw new Error('Unknown page session');
      const ses = partition ? session.fromPartition(partition) : session.defaultSession;
      const res = await ses.fetch(url, { headers: { Accept: 'image/png,image/jpeg;q=0.9,image/gif;q=0.8,image/*;q=0.5' } });
      if (!res.ok) throw new Error('the site answered ' + res.status);
      img = nativeImage.createFromBuffer(Buffer.from(await res.arrayBuffer()));
    } else throw new Error('that picture cannot be fetched from here \u2014 Save Image works');
    if (!img || img.isEmpty()) throw new Error('this picture\u2019s format cannot go on the clipboard \u2014 Save Image works');
    clipboard.writeImage(img);
    return { ok: true };
  } catch (err) { return { ok: false, error: err.message }; }
});

// "Ask Vex about this image": the picture, fetched through the session of the
// tab it is in (its Tor or proxy route, its cookies), never direct from main's
// own. It went through api:request, direct from the real address, and then
// to the AI — from a private or Tor tab too, though PRIVACY.md says those are
// never read for AI (security scan P3). A private, off-the-record, burner or
// Tor tab's picture is fetched only once the person has said yes (confirmed);
// without it the answer is needsConsent. ipc-policy.js checks the page is the
// asking window's own.
ipcMain.handle('image:for-ai', async (_e, pageId, url, confirmed) => {
  try {
    const page = webContents.fromId(pageId);
    if (!page || page.isDestroyed()) throw new Error('the tab is gone');
    const partition = secureSessions.partitionOf(page);
    const ses = page.session;
    const kind = ses.__vexTor || partition === 'persist:route-tor' ? 'tor' : (!partition.startsWith('persist:') ? 'private' : null);
    if (kind && confirmed !== true) return { ok: false, needsConsent: true, kind };
    const fetchThroughTab = require('./main/network').createBoundedFetch(ses.fetch.bind(ses));
    const res = await fetchThroughTab(url, { maxBytes: 16 * 1024 * 1024, timeoutMs: 30000, headers: { Accept: 'image/*,*/*;q=0.8' } });
    if (!res.ok) throw new Error('the site answered ' + res.status);
    const type = String(res.headers.get('content-type') || 'image/png').split(';')[0].trim();
    if (!/^image\//i.test(type)) throw new Error('that address gave back ' + type + ', not an image');
    return { ok: true, type, base64: Buffer.from(await res.arrayBuffer()).toString('base64') };
  } catch (err) { return { ok: false, error: err.message }; }
});

// A tab's icon for a tab in a session of its own, fetched through that
// session and handed back as a data: URL (src/main/favicon-fetch.js). Vex's
// window drawing the icon itself loaded it direct, so a Tor or proxy tab's
// site saw the real address (found 2026-09-30). ipc-policy.js checks the
// page belongs to the asking window.
const _faviconFetch = require('./main/favicon-fetch').createFaviconFetch({ webContents });
ipcMain.handle('tabs:favicon', (_e, guestId, url) => _faviconFetch.fetchIcon(guestId, url));

// The readable part of a page as an e-book (renderer: PageExport.saveEpub).
ipcMain.handle('page:save-epub', async (_e, { title, url, xhtml }) => {
  const book = require('./main/epub').buildEpub({ title, url, xhtmlBody: xhtml });
  const safeName = (String(title || 'page').replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim().slice(0, 100) || 'page') + '.epub';
  const r = await dialog.showSaveDialog(mainWindow && !mainWindow.isDestroyed() ? mainWindow : undefined, {
    title: 'Save as an e-book', defaultPath: path.join(app.getPath('downloads'), safeName), filters: [{ name: 'E-book', extensions: ['epub'] }],
  });
  if (r.canceled || !r.filePath) return { ok: false, cancelled: true };
  await fs.promises.writeFile(r.filePath, book);
  return { ok: true, path: r.filePath };
});

// Generate a QR code (PNG data URL) for "Send to phone". Done in the main process
// with the bundled `qrcode` package — full Node, works offline, no external
// script. Returns a data: URL or null.
ipcMain.handle('qr:generate', async (_e, text) => {
  try {
    if (!text || typeof text !== 'string') return null;
    const QR = require('qrcode');
    return await QR.toDataURL(text, { margin: 1, width: 320, errorCorrectionLevel: 'M' });
  } catch (e) {
    console.warn('[QR] generate failed:', e && e.message);
    return null;
  }
});

// Exchange rates for the inline currency converter (base USD). Fetched at most
// every 12h and cached to disk, so it works offline after the first fetch and
// makes no request on most calls. Returns { base, rates, at } or null.
let _fxCache = null;
ipcMain.handle('fx:rates', async () => {
  const file = path.join(app.getPath('userData'), 'fx-rates.json');
  const fresh = (o) => o && o.at && (Date.now() - o.at < 12 * 3600 * 1000);
  if (fresh(_fxCache)) return _fxCache;
  try { const disk = JSON.parse(fs.readFileSync(file, 'utf8')); if (fresh(disk)) { _fxCache = disk; return disk; } } catch {}
  try {
    const res = await boundedNetFetch('https://open.er-api.com/v6/latest/USD');
    const j = await res.json();
    if (j && j.rates) {
      _fxCache = { base: j.base_code || 'USD', rates: j.rates, at: Date.now() };
      try { fs.writeFileSync(file, JSON.stringify(_fxCache)); } catch {}
      return _fxCache;
    }
  } catch (e) { console.warn('[FX] fetch failed:', e && e.message); }
  // Offline / failed: fall back to any (stale) disk cache.
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
});

// A page from a private window, an off-the-record or burner tab or a Tor tab
// or route is never reopened in persist:main, the main profile (Open as App,
// the overlay): it would be fetched direct and its cookies kept (security
// scan L3). A private window is refused by the IPC policy; a tab names its
// partition.
function _refuseMainProfileCopy(partition) {
  if (typeof partition !== 'string' || !partition) return;
  if (!partition.startsWith('persist:') || partition === 'persist:route-tor' || secureSessions.fromPartition(partition).__vexTor) {
    throw new Error('Not available for a private, off-the-record or Tor tab');
  }
}
// A window that shows a web page and is not a Vex window (Open as App, the
// overlay): its links and window.open calls open as tabs in the main window,
// never as further windows of their own (security scan L4).
function _openLinksAsTabs(contents) {
  contents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url || '') && mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('tab:create-from-external', { url });
    return { action: 'deny' };
  });
}
// Open a URL in its own chromeless window ("open as app" / site-specific
// browser). Shares the main persistent session so you stay signed in.
ipcMain.handle('app:open-as-app', (_e, url, title, partition) => {
  try {
    if (!url || !/^https?:\/\//i.test(url)) return { ok: false };
    _refuseMainProfileCopy(partition);
    const win = new BrowserWindow({
      width: 1024, height: 720, autoHideMenuBar: true, title: title || 'Vex',
      // --vex-web-window: the guest preload sends no Vex shortcuts from here.
      webPreferences: { partition: 'persist:main', contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: true, additionalArguments: ['--vex-web-window'] },
    });
    secureSessions.registerWebWindow(win.webContents);
    _openLinksAsTabs(win.webContents);
    win.setMenuBarVisibility(false);
    win.loadURL(url);
    return { ok: true };
  } catch (e) { return { ok: false, error: e && e.message }; }
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
// The seed is for the page's own session and the site in its address bar
// (a frame's top page), worked out here from the sender, never told by it.
ipcMain.on('privacy:config-sync', (e) => {
  e.returnValue = { farble: !!privacyCfg.farble, seed: _mainHelpers.farbleSeed(FARBLE_KEY, secureSessions.partitionOf(e.sender), e.sender.getURL() || (e.senderFrame && e.senderFrame.url) || '') };
});
ipcMain.on('compatibility:get', e => {
  try { e.returnValue = { suppressPasskeys: _passkeySuppressed(new URL(e.senderFrame.url).hostname) }; }
  catch { e.returnValue = { suppressPasskeys: false }; }
});
ipcMain.handle('privacy:get-config', () => privacyLoad());
ipcMain.handle('privacy:set-config', async (_e, cfg) => {
  privacyCfg = { ...privacyCfg, ...(cfg || {}) };
  await privacySave();
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
  // What was blocked on each of your sites' pages (the site panel's count).
  return { total: _trackerTotal, byHost, crossSite, bySite: { ..._trackerBySite } };
});
ipcMain.handle('privacy:tracker-reset', () => {
  for (const k in _trackerTally) delete _trackerTally[k];
  for (const k in _trackerSites) delete _trackerSites[k];
  for (const k in _trackerBySite) delete _trackerBySite[k];
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

// === Vex EasyList-backed block engine ===
//
// Wraps @ghostery/adblocker (the FULL prebuilt list set — EasyList, EasyPrivacy,
// Peter Lowe's, the uBlock Origin filters + badware/privacy/unbreak/quick-fixes,
// and annoyances) and exposes:
//   - a synchronous match() (engineBlocks) that Vex's EXISTING webRequest
//     handlers call for NETWORK blocking. We do NOT use the library's
//     enableBlockingInSession() for the network side: Electron allows only one
//     webRequest listener per event, so handing it the session would clobber
//     Vex's frame-ancestors stripping, tracker counter, and per-partition wiring.
//   - COSMETIC filtering (enableCosmeticFiltering): element hiding + scriptlet
//     injection, wired the same way enableBlockingInSession does its cosmetic
//     half (a frame preload + two ipcMain handlers) but WITHOUT its network half,
//     so it stacks cleanly on top of Vex's own network blocker. This is what
//     catches the visible ads that network blocking alone leaves behind
//     (first-party ad slots, leftover placeholders) — reliably, in-process,
//     rather than depending on an extension's content scripts reaching guests.
//
// engineBlocks(details) returns:
//   true  → block this request (engine matched a filter)
//   false → engine is ready and did not match (caller still ORs the legacy list)
//   null  → engine not ready yet → caller falls back to the legacy domain list

const fsp = require('fs/promises');

let _engine = null;       // { blocker, fromElectronDetails } once ready
let _initStarted = false;

async function initEngine(cachePath) {
  if (_engine) return true;
  if (_initStarted) return false;
  _initStarted = true;
  try {
    const { ElectronBlocker, fromElectronDetails } = require('@ghostery/adblocker-electron');
    if (typeof fetch !== 'function') throw new Error('global fetch unavailable');
    // Caching contract: read() must REJECT when the cache file is missing so the
    // library knows to download + serialize fresh; write() persists it.
    const caching = {
      path: cachePath,
      read: (p) => fsp.readFile(p),
      write: (p, buf) => fsp.writeFile(p, buf),
    };
    // Full list set (default config → cosmetic + network filters both parsed),
    // so enableCosmeticFiltering() below has real cosmetic rules to serve.
    const blocker = await ElectronBlocker.fromPrebuiltFull(fetch, caching);
    _engine = { blocker, fromElectronDetails };
    return true;
  } catch (e) {
    console.error('[Vex adblock-engine] init failed:', e && e.message);
    _engine = null;
    return false;
  }
}

// Decide a verdict for one Electron webRequest `details` object. Never blocks
// main-frame navigations (mirrors the library's own onBeforeRequest behaviour).
function engineBlocks(details) {
  if (!_engine) return null;
  try {
    const request = _engine.fromElectronDetails(details);
    if (request.isMainFrame && request.isMainFrame()) return false;
    const { match } = _engine.blocker.match(request);
    return !!match;
  } catch {
    return null;
  }
}

function isReady() { return !!_engine; }

// --- Cosmetic filtering (element hiding + scriptlets) --------------------------
// The @ghostery cosmetic preload (added to Vex's GUEST_PRELOADS so it loads in
// every webview) asks main, per page, for the element-hiding rules to apply.
// This registers the two ipcMain handlers it calls (once). isEnabled() gates
// injection so cosmetic filtering follows the ad-blocker on/off toggle live.
// Returns true if the handlers are in place.
let _cosmeticHandlersWired = false;
function enableCosmeticFiltering(isEnabled) {
  if (!_engine) return false;
  if (_cosmeticHandlersWired) return true;
  try {
    const { ipcMain } = require('electron');
    ipcMain.handle('@ghostery/adblocker/inject-cosmetic-filters', (event, url, msg) => {
      try {
        if (isEnabled && !isEnabled()) return;
        return _engine.blocker.onInjectCosmeticFilters(event, url, msg);
      } catch { /* ignore per-frame failures */ }
    });
    ipcMain.handle('@ghostery/adblocker/is-mutation-observer-enabled', (event) => {
      try { return _engine.blocker.onIsMutationObserverEnabled(event); } catch { return false; }
    });
    _cosmeticHandlersWired = true;
    return true;
  } catch (e) {
    console.error('[Vex adblock-engine] cosmetic handlers failed:', e && e.message);
    return false;
  }
}

module.exports = { initEngine, engineBlocks, isReady, enableCosmeticFiltering };

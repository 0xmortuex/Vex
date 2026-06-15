// === Vex EasyList-backed block engine ===
//
// Wraps @ghostery/adblocker (EasyList + EasyPrivacy prebuilt lists) and exposes
// a synchronous match() that Vex's EXISTING webRequest handlers call. We do NOT
// use the library's enableBlockingInSession(): Electron allows only one
// webRequest listener per event (the adblocker's own docs note this), so handing
// it the session would clobber Vex's frame-ancestors stripping, tracker counter,
// and per-partition wiring. Instead the engine acts as a smarter shouldBlock() —
// network-filter matching only (no cosmetic/DOM injection) — loaded once at
// startup with the serialized engine cached to disk so subsequent launches are
// instant and offline-safe.
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
    const blocker = await ElectronBlocker.fromPrebuiltAdsAndTracking(fetch, caching);
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

module.exports = { initEngine, engineBlocks, isReady };

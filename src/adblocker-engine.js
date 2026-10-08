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
// Register the two ipc handlers the guest cosmetic preload calls. This is
// deliberately NOT gated on the engine being ready: the preload starts calling
// as soon as the first page loads, which races the async engine build — if the
// handlers aren't registered yet, every early page throws "No handler registered
// for '@ghostery/adblocker/inject-cosmetic-filters'". So we wire the handlers up
// front (call this at startup) and just no-op inside until the engine exists.
// The library injects each scriptlet with its own executeJavaScript, and
// assembleScript() puts the scriptlet's dependencies (uBO's `class JSONPath`,
// for one) at the page's top level. YouTube gets several scriptlets that share
// JSONPath, so every one after the first died with "Identifier 'JSONPath' has
// already been declared" and never ran; the rejected executeJavaScript promise
// was never caught, so main logged an UnhandledPromiseRejection for each
// (walkthrough M1, 2026-10-07). A block makes class/let/const declarations
// local to that one scriptlet; `var scriptletGlobals` and sloppy-mode function
// declarations still reach the page scope exactly as before.
function wrapScriptlet(code) {
  return '{\n' + code + '\n}';
}

// A scriptlet that still fails is logged once per site and message, with the
// page it was for — not once per page load, and never as an unhandled rejection.
const _loggedScriptletFailures = new Set();
function _logScriptletFailure(kind, url, err) {
  let host = '';
  try { host = new URL(url).hostname; } catch { host = String(url || '').slice(0, 60); }
  const msg = (err && err.message) || String(err);
  const key = kind + '|' + host + '|' + msg;
  if (_loggedScriptletFailures.has(key)) return;
  _loggedScriptletFailures.add(key);
  console.error(`[Vex adblock-engine] ${kind} failed on ${host}:`, msg);
}

// The event handed to the library: same frame ids, but its insertCSS and
// executeJavaScript go to the frame that asked, wrap each scriptlet in a
// block, and catch what the library left uncaught.
function _cosmeticEvent(event, url) {
  const sender = event.sender;
  const frame = event.senderFrame;
  return {
    frameId: event.frameId,
    processId: event.processId,
    sender: {
      insertCSS(css, opts) {
        const p = sender.insertCSS(css, opts);
        if (p && typeof p.catch === 'function') p.catch(e => _logScriptletFailure('cosmetic CSS', url, e));
        return p;
      },
      executeJavaScript(code, userGesture) {
        const target = (frame && !frame.isDestroyed?.() && typeof frame.executeJavaScript === 'function') ? frame : sender;
        const p = target.executeJavaScript(wrapScriptlet(code), userGesture);
        if (p && typeof p.catch === 'function') p.catch(e => _logScriptletFailure('scriptlet', url, e));
        return p;
      },
    },
  };
}

function enableCosmeticFiltering(isEnabled) {
  if (_cosmeticHandlersWired) return true;
  try {
    const { ipcMain } = require('electron');
    ipcMain.handle('@ghostery/adblocker/inject-cosmetic-filters', async (event, url, msg) => {
      // isEnabled is told which page asks: a site whose blocking is switched
      // off in its site panel gets no element hiding either.
      if (!_engine || (isEnabled && !isEnabled(event, url))) return;
      try {
        await _engine.blocker.onInjectCosmeticFilters(_cosmeticEvent(event, url), url, msg);
      } catch (e) {
        _logScriptletFailure('cosmetic filters', url, e);
      }
    });
    ipcMain.handle('@ghostery/adblocker/is-mutation-observer-enabled', (event) => {
      try { return _engine ? _engine.blocker.onIsMutationObserverEnabled(event) : false; } catch { return false; }
    });
    _cosmeticHandlersWired = true;
    return true;
  } catch (e) {
    console.error('[Vex adblock-engine] cosmetic handlers failed:', e && e.message);
    return false;
  }
}

module.exports = { initEngine, engineBlocks, isReady, enableCosmeticFiltering, wrapScriptlet, _cosmeticEvent };

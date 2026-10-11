// === Events main tells extensions about (tabs, webRequest, downloads) ===
// Electron fires none of chrome.tabs.onUpdated, onActivated, onCreated,
// onRemoved or webRequest.onCompleted for an extension (found 2026-10-10):
// an extension that redraws its badge per tab, or counts what a page loaded,
// never heard a thing. The stand-ins tell main which events an extension
// listens to (when it adds a listener, op 'events.listen'), and main tells
// only those extensions, waking a sleeping service worker as Chrome does.
//
// A webRequest listener has its own filter, so each one is its own event
// type, '<event>#<n>', and main checks the filter before telling it.

const EVENTS = new Set([
  'tabs.onUpdated', 'tabs.onActivated', 'tabs.onCreated', 'tabs.onRemoved',
  'webRequest.onCompleted',
  'downloads.onCreated', 'downloads.onChanged',
  'windows.onFocusChanged', 'windows.onCreated', 'windows.onRemoved',
  'notifications.onClicked', 'notifications.onClosed', 'notifications.onButtonClicked',
]);
const MAX_TYPES = 200;

function baseOf(type) { return String(type).replace(/#\d{1,6}$/, ''); }

// Electron's resource types, as Chrome names them.
const RESOURCE_TYPES = {
  mainFrame: 'main_frame', subFrame: 'sub_frame', stylesheet: 'stylesheet', script: 'script', image: 'image', font: 'font',
  object: 'object', xhr: 'xmlhttprequest', ping: 'ping', cspReport: 'csp_report', media: 'media', webSocket: 'websocket', other: 'other',
};

function createExtensionEvents() {
  const byKey = new Map();   // '<partition>|<extension id>' -> Map(type -> filter | null)

  function listen(key, type, filter) {
    type = String(type || '');
    if (!EVENTS.has(baseOf(type)) || (type !== baseOf(type) && !/^webRequest\./.test(type))) throw new Error(`Vex cannot tell an extension about ${type}`);
    let types = byKey.get(key);
    if (!types) { types = new Map(); byKey.set(key, types); }
    if (!types.has(type) && types.size >= MAX_TYPES) throw new Error('Too many listeners');
    types.set(type, filter && typeof filter === 'object' ? filter : null);
  }

  // [{ extId, type, filter }] listening in that session to `base` (or one of
  // its numbered webRequest listeners).
  function listeners(partition, base) {
    const out = [];
    const prefix = partition + '|';
    for (const [key, types] of byKey) {
      if (!key.startsWith(prefix)) continue;
      const extId = key.slice(prefix.length);
      for (const [type, filter] of types) if (baseOf(type) === base) out.push({ extId, type, filter });
    }
    return out;
  }

  function forget(key) { byKey.delete(key); }

  return { listen, listeners, forget };
}

// Whether a webRequest listener's filter takes this request (Chrome's
// RequestFilter: urls, types, tabId, windowId).
function filterTakes(filter, details, matchPattern) {
  const f = filter || {};
  const type = RESOURCE_TYPES[details.resourceType] || 'other';
  if (Array.isArray(f.types) && f.types.length && !f.types.includes(type)) return false;
  if (typeof f.tabId === 'number' && f.tabId !== (details.webContentsId || -1)) return false;
  if (!Array.isArray(f.urls) || !f.urls.length) return false;   // Chrome requires urls
  return f.urls.some(p => { try { return matchPattern(p, details.url); } catch { return false; } });
}

// What a webRequest listener hears, as Chrome describes a request.
function requestDetails(details) {
  const out = {
    requestId: String(details.id), url: details.url, method: details.method, frameId: details.resourceType === 'mainFrame' ? 0 : -1,
    parentFrameId: -1, tabId: details.webContentsId || -1, type: RESOURCE_TYPES[details.resourceType] || 'other',
    timeStamp: details.timestamp, fromCache: !!details.fromCache,
  };
  if (details.statusCode !== undefined) out.statusCode = details.statusCode;
  if (details.statusLine !== undefined) out.statusLine = details.statusLine;
  if (details.ip !== undefined) out.ip = details.ip;
  if (details.error !== undefined) out.error = details.error;
  if (details.referrer) out.initiator = (() => { try { return new URL(details.referrer).origin; } catch { return undefined; } })();
  return out;
}

module.exports = { createExtensionEvents, filterTakes, requestDetails, EVENTS, RESOURCE_TYPES };

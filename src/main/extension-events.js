// === Events main tells extensions about (tabs, webRequest, downloads) ===
// Electron fires none of chrome.tabs.onUpdated, onActivated, onCreated,
// onRemoved or webRequest.onCompleted for an extension (found 2026-10-10):
// an extension that redraws its badge per tab, or counts what a page loaded,
// never heard a thing. The stand-ins tell main which events an extension
// listens to (when it adds a listener, op 'events.listen'), and main tells
// only those extensions, waking a sleeping service worker as Chrome does.
//
// A webRequest or webNavigation listener has its own filter, so each one is
// its own event type, '<event>#<n>', and main checks the filter before
// telling it.

const EVENTS = new Set([
  'tabs.onUpdated', 'tabs.onActivated', 'tabs.onCreated', 'tabs.onRemoved',
  'webRequest.onCompleted',
  'webNavigation.onBeforeNavigate', 'webNavigation.onCommitted', 'webNavigation.onDOMContentLoaded', 'webNavigation.onCompleted',
  'webNavigation.onErrorOccurred', 'webNavigation.onHistoryStateUpdated', 'webNavigation.onReferenceFragmentUpdated',
  'cookies.onChanged',
  'downloads.onCreated', 'downloads.onChanged',
  'notifications.onClicked',
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
    if (!EVENTS.has(baseOf(type)) || (type !== baseOf(type) && !/^(webRequest|webNavigation)\./.test(type))) throw new Error(`Vex cannot tell an extension about ${type}`);
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

// === chrome.webNavigation ===
// Chrome's UrlFilter (the `url` array a webNavigation listener is added with):
// a URL is taken when ANY filter takes it, and a filter takes it when ALL its
// conditions hold. No filter (or an empty list) takes every URL.
const DEFAULT_PORTS = { 'http:': 80, 'https:': 443, 'ftp:': 21 };
function urlFilterTakes(filter, url) {
  const list = filter && Array.isArray(filter.url) ? filter.url : null;
  if (!list || !list.length) return true;
  let u;
  try { u = new URL(url); } catch { return false; }
  const port = u.port ? Number(u.port) : (DEFAULT_PORTS[u.protocol] || -1);
  const query = u.search.replace(/^\?/, '');
  const origin = u.origin === 'null' ? `${u.protocol}//${u.host}` : u.origin;
  const one = (f) => {
    if (!f || typeof f !== 'object') return false;
    const t = (v, fn) => v === undefined || fn(String(v));
    const re = (v, s) => { try { return new RegExp(v).test(s); } catch { return false; } };
    if (f.schemes !== undefined && !(Array.isArray(f.schemes) && f.schemes.includes(u.protocol.replace(':', '')))) return false;
    if (f.ports !== undefined && !(Array.isArray(f.ports) && f.ports.some(p => (Array.isArray(p) ? port >= p[0] && port <= p[1] : port === p)))) return false;
    return t(f.hostEquals, v => u.hostname === v) && t(f.hostContains, v => u.hostname.includes(v))
      && t(f.hostPrefix, v => u.hostname.startsWith(v)) && t(f.hostSuffix, v => u.hostname.endsWith(v))
      && t(f.pathEquals, v => u.pathname === v) && t(f.pathContains, v => u.pathname.includes(v))
      && t(f.pathPrefix, v => u.pathname.startsWith(v)) && t(f.pathSuffix, v => u.pathname.endsWith(v))
      && t(f.queryEquals, v => query === v) && t(f.queryContains, v => query.includes(v))
      && t(f.queryPrefix, v => query.startsWith(v)) && t(f.querySuffix, v => query.endsWith(v))
      && t(f.urlEquals, v => u.href === v) && t(f.urlContains, v => u.href.includes(v))
      && t(f.urlPrefix, v => u.href.startsWith(v)) && t(f.urlSuffix, v => u.href.endsWith(v))
      && t(f.urlMatches, v => re(v, u.href)) && t(f.originAndPathMatches, v => re(v, origin + u.pathname));
  };
  return list.some(one);
}

// Pages an extension is told about: web pages only. A Vex page, a file or an
// internal address is never announced to an extension.
function navigableUrl(url) {
  return /^https?:\/\//i.test(String(url || ''));
}

// A page of a private, off-the-record, burner, container-less or Tor session:
// never announced. `partition` is Vex's name for the session; `persistent` is
// session.isPersistent(); `tor` is session.__vexTor.
function isPrivateSession({ partition, persistent, tor }) {
  if (tor || persistent === false) return true;
  if (typeof partition !== 'string' || !partition) return false;   // the default session
  return !partition.startsWith('persist:') || partition === 'persist:route-tor' || partition.startsWith('persist:route-tor');
}

// frame: { frameTreeNodeId, parent, processId } (Electron's WebFrameMain), or
// null. The top frame is frameId 0 with parentFrameId -1, as in Chrome; any
// other frame is its frame tree node id, its parent 0 when that is the top.
function frameIds(frame, isMainFrame) {
  if (isMainFrame || (frame && !frame.parent)) return { frameId: 0, parentFrameId: -1 };
  if (!frame || !Number.isInteger(frame.frameTreeNodeId)) return null;
  const p = frame.parent;
  return { frameId: frame.frameTreeNodeId, parentFrameId: p && p.parent ? p.frameTreeNodeId : 0 };
}

const NAV_EVENTS = {
  onBeforeNavigate: [], onCommitted: ['transitionType', 'transitionQualifiers'], onDOMContentLoaded: [], onCompleted: [],
  onErrorOccurred: ['error'], onHistoryStateUpdated: ['transitionType', 'transitionQualifiers'],
  onReferenceFragmentUpdated: ['transitionType', 'transitionQualifiers'],
};
// The details object Chrome documents for one webNavigation event.
function navigationDetails(event, { tabId, url, frame, isMainFrame, processId, timeStamp, error }) {
  if (!NAV_EVENTS[event]) throw new Error(`Vex has no webNavigation.${event}`);
  const ids = frameIds(frame, isMainFrame);
  if (!ids) return null;
  const out = { tabId, url, processId: Number.isInteger(processId) ? processId : -1, frameId: ids.frameId, parentFrameId: ids.parentFrameId,
    timeStamp: timeStamp === undefined ? Date.now() : timeStamp, documentLifecycle: 'active', frameType: ids.frameId === 0 ? 'outermost_frame' : 'sub_frame' };
  if (event === 'onErrorOccurred') out.error = String(error || 'net::ERR_FAILED');
  if (NAV_EVENTS[event].includes('transitionType')) { out.transitionType = 'link'; out.transitionQualifiers = []; }
  return out;
}

// === chrome.cookies.onChanged ===
// Electron's session.cookies 'changed' (cookie, cause, removed) as Chrome's
// { removed, cookie, cause }. Chrome names the causes with underscores.
const COOKIE_CAUSES = { explicit: 'explicit', overwrite: 'overwrite', expired: 'expired', evicted: 'evicted', 'expired-overwrite': 'expired_overwrite',
  'inserted-no-change-overwrite': 'overwrite', 'inserted-no-value-change-overwrite': 'overwrite' };
function cookieChange(cookie, cause, removed, toChrome) {
  return { removed: !!removed, cookie: toChrome(cookie), cause: COOKIE_CAUSES[cause] || 'explicit' };
}

module.exports = { createExtensionEvents, filterTakes, requestDetails, urlFilterTakes, navigableUrl, isPrivateSession, frameIds, navigationDetails,
  cookieChange, EVENTS, RESOURCE_TYPES, NAV_EVENTS };

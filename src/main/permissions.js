const path = require('path');
const fs = require('fs');
const { atomicWrite } = require('./file-store');

// One spelling of an origin for every decision key: scheme://host[:port],
// no trailing slash, no path. Electron's handlers spell the same origin two
// ways (see the check handler below); this makes them agree.
function originKey(origin) {
  const s = String(origin || '');
  try { return new URL(s).origin; } catch { return s.replace(/\/+$/, ''); }
}
// What a request is REALLY for. Electron reports the microphone, the camera,
// both together, and a screen share all as the one permission 'media', told
// apart only by details.mediaTypes — measured: ["audio"], ["video"],
// ["audio","video"], and [] for getDisplayMedia. Vex ignored that, so every
// one of them asked for "your camera and microphone", and "Remember" filed
// the answer under a single key: allowing a site's microphone pre-approved its
// camera and its screen shares, and blocking a screen share blocked the mic.
function mediaParts(permission, details) {
  if (permission !== 'media') return [permission];
  const types = details && Array.isArray(details.mediaTypes) ? details.mediaTypes : null;
  if (types && !types.length) return ['display-capture'];
  const parts = [];
  if (!types || types.includes('video')) parts.push('camera');
  if (!types || types.includes('audio')) parts.push('microphone');
  return parts.length ? parts : ['camera', 'microphone'];
}
const DAY_MS = 24 * 60 * 60 * 1000;

// 'allow' only when every part is allowed; 'deny' when any part is denied.
// An answer saved before this change sits under '::media'. Its prompt said
// "camera and microphone", so it still counts for those two — never for a
// screen share, which nobody was told they were agreeing to.
function savedDecision(decisions, origin, parts, session, now = Date.now()) {
  // "Allow for a day" keeps its end time under decisions.__until__; past it,
  // the decision is as if never made, and the site asks again.
  const until = decisions.__until__ || {};
  const live = (key) => (until[key] && now > until[key] ? undefined : decisions[key]);
  const one = (p) => (session && session.get(`${origin}::${p}`))
    || live(`${origin}::${p}`)
    || (session && (p === 'camera' || p === 'microphone') && session.get(`${origin}::media`))
    || ((p === 'camera' || p === 'microphone') ? live(`${origin}::media`) : undefined);
  const found = parts.map(one);
  if (found.includes('deny')) return 'deny';
  return found.every(v => v === 'allow') ? 'allow' : null;
}

// Vex's own interface — the main window's page, not a web page in a tab. Only
// it may capture the screen without a prompt, and only the screen: it asks
// when the user presses Record, and the user then chooses what in Vex's own
// picker, which IS the consent. Web pages keep the normal prompt. Refused
// here, the recorder failed with "Permission denied" before any picker
// appeared (measured).
function isVexUi(contents) {
  try {
    if (!contents || contents.isDestroyed?.() || typeof contents.getType !== 'function' || contents.getType() !== 'window') return false;
    const u = new URL(contents.getURL());
    return u.protocol === 'file:' && /\/renderer\/index\.html$/i.test(u.pathname);
  } catch { return false; }
}

function createPermissionService({ userDataPath, secureSessions, ipcMain, _markHidRequestActive }) {
// Answers that last until Vex closes. Never written to disk: "just this visit"
// that survived a restart would be a lie.
const sessionDecisions = new Map();
// === Site permission handler (geolocation, camera, mic, notifications, ...) ===
const permissionsFile = path.join(userDataPath, 'permissions.json');
let cachedDecisions = null, writes = Promise.resolve();
const pendingPermissions = new Map();
const ephemeralPermissions = new WeakMap();
function decisionsFor(contents) {
  const partition = contents ? secureSessions.partitionOf(contents) : 'persist:main';
  if (partition && !partition.startsWith('persist:')) {
    if (!ephemeralPermissions.has(contents.session)) ephemeralPermissions.set(contents.session, Object.create(null));
    return ephemeralPermissions.get(contents.session);
  }
  return loadPermissionDecisions();
}

// On cold start the renderer may not have registered its 'permission:request'
// listener yet when a webview fires a permission check. Queue sends until the
// renderer signals ready (or the fallback flush fires), otherwise the first
// prompt of the session silently times out.
let _permissionsRendererReady = false;
const _pendingPermissionSends = [];
function _deliverPermissionRequest(payload) {
  if (!pendingPermissions.has(payload.id)) return true;
  const win = pendingPermissions.get(payload.id)?._host?.win;
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
  if (cachedDecisions) return { ...cachedDecisions };
  try {
    if (fs.existsSync(permissionsFile)) {
      cachedDecisions = JSON.parse(fs.readFileSync(permissionsFile, 'utf-8')) || {};
      return { ...cachedDecisions };
    }
  } catch {}
  return {};
}
function savePermissionDecisions(data) {
  cachedDecisions = { ...data };
  const bytes = JSON.stringify(data);
  writes = writes.catch(() => {}).then(() => atomicWrite(permissionsFile, bytes));
  return writes;
}

function wirePermissionsOnSession(ses, tag, opts) {
  if (!ses || ses.__vexPermsWired) return;
  ses.__vexPermsWired = true;
  opts = opts || {};
  // Media family — mic/camera/screen-share + audio in/out device selection.
  const MEDIA_PERMS = new Set(['media', 'microphone', 'camera', 'audioCapture', 'videoCapture', 'speaker-selection', 'display-capture']);

  ses.setPermissionRequestHandler((webContents, permission, callback, details) => {
    let origin = 'unknown';
    try { origin = new URL((details && details.requestingUrl) || webContents.getURL()).origin; } catch {}

    console.log(`[Permissions] (${tag}) ${origin} requests: ${permission}`);

    // Standard browser auto-allow list. mediaKeySystem (EME/Widevine DRM, used by
    // Spotify, Netflix, etc.) is auto-allowed like a normal browser — prompting
    // for it silently broke playback in the Spotify panel because the prompt
    // never surfaced/resolved there, so play and other actions did nothing.
    // 'clipboard-read' is deliberately NOT here. It used to be, which let any
    // page call navigator.clipboard.readText() and receive whatever you last
    // copied, with no prompt and no user gesture — proved against a real page.
    // Vex copies passwords out of its own vault and one-time codes out of its
    // authenticator, so that is precisely the wrong thing to hand over in
    // silence. Chrome prompts for it; so does Vex now (see NEEDS_PROMPT).
    // Writing stays automatic: a page writing to the clipboard is an ordinary
    // "copy" button and gives nothing away.
    const AUTO_ALLOW = new Set(['fullscreen', 'pointerLock', 'clipboard-sanitized-write', 'mediaKeySystem']);
    if (AUTO_ALLOW.has(permission)) return callback(true);
    // A screen capture arrives as 'display-capture' or as 'media' with no media
    // types (see mediaParts) — both mean the screen, and nothing but the screen.
    // Vex's own interface also gets the microphone, and only that: dictation
    // opens it when you start dictating, which is the consent. Never a camera.
    if (isVexUi(webContents)) {
      const asked = mediaParts(permission, details);
      if (asked.length === 1 && (asked[0] === 'display-capture' || asked[0] === 'microphone')) return callback(true);
    }

    // Dedicated Discord panel session: auto-grant mic/camera/output-device so
    // voice & screen-share work. The generic prompt never surfaces in a panel
    // webview (same reason mediaKeySystem is auto-allowed above), which left
    // Discord unable to see any input/output device.
    if (opts.autoAllowMedia && MEDIA_PERMS.has(permission)) return callback(true);

    const NEEDS_PROMPT = new Set(['geolocation', 'media', 'midi', 'midiSysex', 'notifications', 'camera', 'microphone', 'display-capture', 'clipboard-read']);
    if (!NEEDS_PROMPT.has(permission)) {
      // Unknown permission — deny by default, but log so we can add it later
      console.log(`[Permissions] DENIED (unlisted): ${permission}`);
      return callback(false);
    }

    // Check persisted decisions — under what is really being asked for.
    const parts = mediaParts(permission, details);
    const saved = savedDecision(decisionsFor(webContents), origin, parts, sessionDecisions);
    if (saved === 'allow') return callback(true);
    if (saved === 'deny')  return callback(false);
    const asked = parts.length > 1 ? 'media' : parts[0];

    // Ask the user — queued if the renderer isn't listening yet (cold start).
    const id = `perm_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    Object.assign(callback, { _host: secureSessions.owner(webContents), _contents: webContents, _origin: origin, _permission: asked, _parts: parts });
    pendingPermissions.set(id, callback);
    sendPermissionRequest({ id, origin, permission: asked });

    // Safety timeout — if the user ignores the prompt for 2 minutes, deny.
    setTimeout(() => {
      if (pendingPermissions.has(id)) {
        pendingPermissions.delete(id);
        try { callback(false); } catch {}
      }
    }, 120000);
  });

  // Sync check (used by navigator.permissions.query, and by Chromium before it
  // DISPLAYS a notification) — only grant if explicitly allowed.
  //
  // Decisions are stored under `new URL(...).origin`, which has no trailing
  // slash. Electron hands this handler an origin spec that does — so an
  // allowed site never matched its own decision here, and every website
  // notification in Vex was granted by the prompt and then refused at display
  // time: navigator.permissions.query said "denied" seconds after Allow, and
  // `new Notification()` fired onerror. Measured 2026-09-13. Normalise both
  // sides to the same form before comparing.
  ses.setPermissionCheckHandler((_wc, permission, requestingOrigin, details) => {
    requestingOrigin = originKey(requestingOrigin);
    // WebHID: keep navigator.hid available, and mark this origin as having a
    // device request in flight — Chromium runs this 'hid' check at the start of
    // requestDevice(), which lets the device-permission handler permit the
    // chooser to enumerate/open for it (see wireWebHidOnSession). Per-device
    // gating remains the interactive chooser.
    if (permission === 'hid') { _markHidRequestActive(requestingOrigin); return true; }
    // DRM playback (EME) is auto-OK like a normal browser, so the sync check
    // Chromium runs during requestMediaKeySystemAccess() doesn't block Spotify.
    if (permission === 'mediaKeySystem' || permission === 'fullscreen' || permission === 'pointerLock') return true;
    if (permission === 'display-capture' && isVexUi(_wc)) return true;
    if (opts.autoAllowMedia && MEDIA_PERMS.has(permission)) return true;
    // The check names one device: details.mediaType is 'audio' or 'video'.
    const kind = details && details.mediaType;
    if (isVexUi(_wc) && ((permission === 'media' && kind === 'audio') || permission === 'microphone')) return true;
    const parts = permission === 'media' ? (kind === 'audio' ? ['microphone'] : kind === 'video' ? ['camera'] : ['camera', 'microphone']) : [permission];
    return savedDecision(decisionsFor(_wc), requestingOrigin, parts, sessionDecisions) === 'allow';
  });
}

ipcMain.handle('permission:respond', async (_e, payload) => {
  const { id, decision, remember } = payload || {};
  const cb = pendingPermissions.get(id);
  if (!cb) return { ok: false, error: 'No pending request' };
  if (cb._host !== secureSessions.owner(_e.sender) || !['allow', 'deny'].includes(decision)) return { ok: false, error: 'Invalid permission response' };
  pendingPermissions.delete(id);
  try { cb(decision === 'allow'); } catch {}
  // remember: true = keep it; 'day' = for 24 hours; 'session' = until Vex
  // closes; false = this once.
  // "Allow" used to mean for ever or not at all, and the box was ticked by
  // default — so agreeing to a microphone for one call agreed to it for good.
  if (remember && cb._origin && cb._permission) {
    const parts = cb._parts || [cb._permission];
    if (remember === 'session') {
      for (const part of parts) sessionDecisions.set(`${cb._origin}::${part}`, decision);
    } else {
      const d = decisionsFor(cb._contents);
      const until = { ...(d.__until__ || {}) };
      for (const part of parts) {
        const key = `${cb._origin}::${part}`;
        d[key] = decision;
        if (remember === 'day') until[key] = Date.now() + DAY_MS; else delete until[key];
      }
      if (Object.keys(until).length) d.__until__ = until; else delete d.__until__;
      const partition = secureSessions.partitionOf(cb._contents);
      if (!partition || partition.startsWith('persist:')) await savePermissionDecisions(d);
    }
  }
  return { ok: true };
});


function permissionsReady() { _permissionsRendererReady = true; _flushPermissionQueue('renderer ready'); }
return { sessionDecisions, pendingPermissions, decisionsFor, sendPermissionRequest, wirePermissionsOnSession, loadPermissionDecisions, savePermissionDecisions, permissionsReady, flushPermissions: () => writes };
}
module.exports = { createPermissionService, originKey, mediaParts, savedDecision, isVexUi };

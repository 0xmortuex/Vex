const path = require('path');
const fs = require('fs');
const { atomicWrite } = require('./file-store');
function createPermissionService({ userDataPath, secureSessions, ipcMain, _markHidRequestActive }) {
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

    // Check persisted decisions
    const decisions = decisionsFor(webContents);
    const key = `${origin}::${permission}`;
    if (decisions[key] === 'allow') return callback(true);
    if (decisions[key] === 'deny')  return callback(false);

    // Ask the user — queued if the renderer isn't listening yet (cold start).
    const id = `perm_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    Object.assign(callback, { _host: secureSessions.owner(webContents), _contents: webContents, _origin: origin, _permission: permission });
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
    if (opts.autoAllowMedia && MEDIA_PERMS.has(permission)) return true;
    const decisions = decisionsFor(_wc);
    return decisions[`${requestingOrigin}::${permission}`] === 'allow';
  });
}

ipcMain.handle('permission:respond', async (_e, payload) => {
  const { id, decision, remember } = payload || {};
  const cb = pendingPermissions.get(id);
  if (!cb) return { ok: false, error: 'No pending request' };
  if (cb._host !== secureSessions.owner(_e.sender) || !['allow', 'deny'].includes(decision)) return { ok: false, error: 'Invalid permission response' };
  pendingPermissions.delete(id);
  try { cb(decision === 'allow'); } catch {}
  if (remember && cb._origin && cb._permission) {
    const d = decisionsFor(cb._contents);
    d[`${cb._origin}::${cb._permission}`] = decision;
    const partition = secureSessions.partitionOf(cb._contents);
    if (!partition || partition.startsWith('persist:')) await savePermissionDecisions(d);
  }
  return { ok: true };
});


function permissionsReady() { _permissionsRendererReady = true; _flushPermissionQueue('renderer ready'); }
return { pendingPermissions, decisionsFor, sendPermissionRequest, wirePermissionsOnSession, loadPermissionDecisions, savePermissionDecisions, permissionsReady, flushPermissions: () => writes };
}
module.exports = { createPermissionService };

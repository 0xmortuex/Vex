// === Four web permissions Vex used to refuse without a word =========================
//
// Measured in castLabs Electron 42 (a throwaway real-Electron probe, temp profile): these four reach
// ses.setPermissionRequestHandler, and Vex's "deny anything unlisted" rule answered "no" before the
// person was ever asked, so the page saw an error and nothing in Vex said why:
//
//   keyboardLock       navigator.keyboard.lock(['Escape']) in full screen -> InvalidStateError.
//   window-management  getScreenDetails() (also asked by permissions.query).
//   idle-detection     IdleDetector.requestPermission().
//   storage-access     document.requestStorageAccess() from a cross-site iframe (also asked by
//                      permissions.query). Embedded sign-in and payment widgets need it.
//
// They are now asked, with the same prompt as the camera (Block / allow this visit / for a day / always),
// kept per site in the same store (so Settings > Site permissions and the site panel list and revoke
// them, and permission hygiene expires them). This file holds only the RULES, as pure functions, so
// every combination can be tested without Electron. src/main/permissions.js does the asking.
//
// Everything here fails SAFE: a request this file cannot place exactly is refused, as it was before.
//
// NOT handled, on purpose: 'top-level-storage-access' (document.requestStorageAccessFor(origin)). Its
// details carry only { isMainFrame, requestingUrl }: the origin the page wants access FOR is not in
// them, so no per-site rule can be written that is safe. It stays refused. 'openExternal' stays refused.
'use strict';

const EXTRA_PERMISSIONS = new Set(['keyboardLock', 'window-management']);
function webUrl(url) {
  try {
    const u = new URL(String(url || ''));
    return /^https?:$/.test(u.protocol) ? u : null;
  } catch { return null; }
}

// 'https://a.example.com' for any address on it; '' for anything that is not a web page.
function originOf(url) {
  const u = webUrl(url);
  return u ? u.origin : '';
}

// What the request is, and under which saved key it lives.
//   input.permission  one of EXTRA_PERMISSIONS
//   input.details     Electron's details: { isMainFrame, requestingUrl }
//   input.topUrl      webContents.getURL(): the page the person is on
//   input.fullscreen  the page is in HTML full screen right now
// -> { deny: 'why' }                                refused, no question
//    { origin, part }                              ask / look up under origin + '::' + part
function planExtra(input) {
  const { permission, details, topUrl, fullscreen } = input || {};
  if (!EXTRA_PERMISSIONS.has(permission)) return { deny: 'not one of the four' };
  const d = details || {};
  const topOrigin = originOf(topUrl);
  const origin = originOf(d.requestingUrl || topUrl);
  if (!topOrigin || !origin) return { deny: 'not a web page' };

  // These belong to the page itself: the top-level origin, never a frame inside it (a frame may
  // not even be given the permission by the page's policy, and a third-party ad must not be able to ask).
  if (d.isMainFrame === false || origin !== topOrigin) return { deny: 'asked by a frame' };
  if (permission === 'keyboardLock' && fullscreen !== true) return { deny: 'not in full screen' };
  return { origin: topOrigin, part: permission };
}

// What to do with a plan. saved: 'allow' | 'deny' | null from the permission store. A private, Tor or
// burner window (priv) remembers nothing and so asks every time: whatever sits in its in-memory store is
// ignored. -> 'allow' | 'deny' | 'ask'
function resolveExtra(saved, priv) {
  if (priv) return 'ask';
  if (saved === 'allow') return 'allow';
  if (saved === 'deny') return 'deny';
  return 'ask';
}

module.exports = { EXTRA_PERMISSIONS, originOf, planExtra, resolveExtra };

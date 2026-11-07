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

const { registrableDomain } = require('./preconnect');

const EXTRA_PERMISSIONS = new Set(['keyboardLock', 'window-management', 'idle-detection', 'storage-access']);
// storage-access is kept per PAIR: the page the person is on (the key's origin) and the third party's
// site (this suffix). Allowing a sign-in widget on one site never allows it on another, and never
// allows any other third party on the same page.
const STORAGE_PREFIX = 'storage-access:';

// Hosting suffixes where every customer is a different site although they share a registrable domain.
// Two of them are never "the same site". A short list of the common ones, not the Public Suffix List;
// one missing from it makes two customers look like one site, so everything unsure is treated as
// cross-site below.
const SHARED_SUFFIXES = new Set([
  'github.io', 'gitlab.io', 'blogspot.com', 'herokuapp.com', 'vercel.app', 'netlify.app', 'pages.dev', 'workers.dev',
  'web.app', 'firebaseapp.com', 'azurewebsites.net', 'cloudfront.net', 'amazonaws.com', 'appspot.com', 'onrender.com',
  'fly.dev', 'glitch.me', 'repl.co', 'wordpress.com', 'wixsite.com', 'weebly.com', 'myshopify.com', 'bubbleapps.io',
  'ngrok.io', 'ngrok-free.app', 'trycloudflare.com', 'surge.sh', 'neocities.org', 'itch.io',
]);

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

// The site an address belongs to: its registrable domain (example.com for www.example.com), or the whole
// host when that cannot be said safely (a shared hosting suffix, an address, something that looks like a
// registry such as "xx.yy"). Never the empty string for a web address.
function siteOf(url) {
  const u = webUrl(url);
  if (!u) return '';
  const host = u.hostname.toLowerCase().replace(/\.$/, '');
  if (!host) return '';
  const reg = registrableDomain(host);
  if (!reg || SHARED_SUFFIXES.has(reg)) return host;
  const labels = reg.split('.');
  // "xx.yy": a two-letter country code under a label of three letters or fewer is probably a registry
  // the small list in preconnect.js does not know, not a company. Treat each host as its own site.
  if (labels.length === 2 && labels[1].length === 2 && labels[0].length <= 3) return host;
  return reg;
}

// Same scheme and same site (Chrome's "schemeful same-site"). Two addresses that cannot be told are not.
function sameSite(a, b) {
  const ua = webUrl(a), ub = webUrl(b);
  if (!ua || !ub || ua.protocol !== ub.protocol) return false;
  const sa = siteOf(a);
  return !!sa && sa === siteOf(b);
}

// What the request is, and under which saved key it lives.
//   input.permission  one of EXTRA_PERMISSIONS
//   input.details     Electron's details: { isMainFrame, requestingUrl }
//   input.topUrl      webContents.getURL(): the page the person is on
//   input.tracker     the requesting frame's address is on an ad or tracker list
//   input.fullscreen  the page is in HTML full screen right now
// -> { deny: 'why' }                                refused, no question
//    { origin, part, frame?: {...} }               ask / look up under origin + '::' + part
function planExtra(input) {
  const { permission, details, topUrl, tracker, fullscreen } = input || {};
  if (!EXTRA_PERMISSIONS.has(permission)) return { deny: 'not one of the four' };
  const d = details || {};
  const topOrigin = originOf(topUrl);
  const origin = originOf(d.requestingUrl || topUrl);
  if (!topOrigin || !origin) return { deny: 'not a web page' };

  if (permission === 'storage-access') {
    // Only a frame inside another page asks for this. The page itself, or a request that does not say, is refused.
    if (d.isMainFrame !== false) return { deny: 'not asked by a frame' };
    // NEVER an ad or tracker host: a third party that exists to follow people between sites is not given
    // its cookies back, however the question is answered. No prompt either: there is nothing to decide.
    if (tracker !== false) return { deny: 'ad or tracker host' };
    const frameSite = siteOf(d.requestingUrl);
    const topSite = siteOf(topUrl);
    if (!frameSite || !topSite) return { deny: 'no site' };
    const cross = !sameSite(d.requestingUrl, topUrl);
    return { origin: topOrigin, part: STORAGE_PREFIX + frameSite, frame: { origin, site: frameSite, top: topOrigin, cross } };
  }

  // The other three belong to the page itself: the top-level origin, never a frame inside it (a frame may
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

// The key a saved storage-access answer lives under, for the sync check (permissions.query): the page the
// frame is in, and the frame's site. '' when it cannot be said (then the check answers "not granted").
function storageKeyFor(embeddingOrigin, requestingUrl) {
  const top = originOf(embeddingOrigin);
  const site = siteOf(requestingUrl);
  return top && site ? { origin: top, part: STORAGE_PREFIX + site } : null;
}

module.exports = { EXTRA_PERMISSIONS, STORAGE_PREFIX, SHARED_SUFFIXES, siteOf, sameSite, originOf, planExtra, resolveExtra, storageKeyFor };

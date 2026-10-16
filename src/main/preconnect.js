// === Warm up the connection to a link you are about to click (T3-075) ===========
//
// Resting the pointer on a link for 150 ms is a good sign it will be clicked.
// Chromium can open the connection (DNS, TCP, TLS) to the link's site in advance,
// which takes 100 to 300 ms off the click. The cost is that the site hears from you
// before you clicked, so this is held to what cannot reveal anything new:
//
//   * only a link to the SAME site as the page you are on (the same registrable
//     domain), or to a site you put on the allow list in Settings; a link to
//     anywhere else is never connected to until you click it;
//   * never from a private or Tor tab, a private window, or any other session that
//     does not outlive the window: only a saved session, which has already been
//     talking to that site;
//   * only the origin (scheme, host, port) is warmed, one socket, and at most once
//     in 30 seconds for the same origin and six a minute for a page;
//   * https to https, or http to http: a secure page is never made to open a
//     plain connection.
//
// The page is named by its webContents id (ipc-policy.js checks it belongs to the
// asking window); the address is the link's. Nothing is read from the page.

const PER_ORIGIN_MS = 30 * 1000;
const PER_PAGE_PER_MIN = 6;

// Second-level labels under a country code that belong to the registry, not to a
// site: "bbc.co.uk" is the site, "co.uk" is not. A small list, not the Public Suffix
// List. A registry label missing from it would make every site under that registry
// look like one site ("a.xx.yy" and "b.xx.yy" both read as "xx.yy"), so the list
// carries the common ones and the Turkish ones.
const REGISTRY_LABELS = new Set(['co', 'com', 'org', 'net', 'gov', 'edu', 'ac', 'or', 'ne', 'go', 'gen', 'web', 'info', 'biz', 'k12', 'pvt', 'av', 'bel', 'tsk', 'kep', 'dr']);

function registrableDomain(host) {
  const h = String(host || '').toLowerCase().replace(/\.$/, '');
  if (!h) return '';
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(h) || h.includes(':')) return h;     // an address is its own site
  const parts = h.split('.');
  if (parts.length <= 2) return h;
  const tld = parts[parts.length - 1];
  const second = parts[parts.length - 2];
  if (tld.length === 2 && REGISTRY_LABELS.has(second)) return parts.slice(-3).join('.');
  return parts.slice(-2).join('.');
}

// Hostnames on the allow list: "example.com" allows example.com and its subdomains.
function allowListed(host, allow) {
  const h = String(host || '').toLowerCase();
  return (Array.isArray(allow) ? allow : []).some(a => {
    const x = String(a || '').trim().toLowerCase();
    return x && (h === x || h.endsWith('.' + x));
  });
}

// → { ok: true, origin } or { ok: false, reason }.
function judge({ pageUrl, linkUrl, prefs, privatePage }) {
  if (!prefs || prefs.on !== true) return { ok: false, reason: 'switched off' };
  if (privatePage) return { ok: false, reason: 'private session' };
  let page, link;
  try { page = new URL(String(pageUrl)); link = new URL(String(linkUrl)); } catch { return { ok: false, reason: 'not an address' }; }
  if (!/^https?:$/.test(link.protocol) || !/^https?:$/.test(page.protocol)) return { ok: false, reason: 'not a web address' };
  if (page.protocol !== link.protocol) return { ok: false, reason: 'scheme differs' };
  if (link.username || link.password) return { ok: false, reason: 'address carries a login' };
  const sameSite = registrableDomain(page.hostname) === registrableDomain(link.hostname);
  if (!sameSite && !allowListed(link.hostname, prefs.allow)) return { ok: false, reason: 'another site, not on the allow list' };
  return { ok: true, origin: link.origin };
}

function createPreconnect({ webContents, getPrefs, isPrivate, now = () => Date.now() }) {
  const lastOrigin = new Map();   // origin -> time
  const perPage = new Map();      // page id -> [times]

  function preconnect(guestId, linkUrl) {
    const guest = webContents.fromId(guestId);
    if (!guest || guest.isDestroyed()) return { ok: false, reason: 'tab is gone' };
    if (typeof guest.getType === 'function' && guest.getType() !== 'webview') return { ok: false, reason: 'not a tab' };
    const ses = guest.session;
    if (!ses || typeof ses.preconnect !== 'function') return { ok: false, reason: 'no session' };
    const verdict = judge({ pageUrl: guest.getURL(), linkUrl, prefs: getPrefs(), privatePage: isPrivate(guest) });
    if (!verdict.ok) return verdict;
    const t = now();
    if (t - (lastOrigin.get(verdict.origin) || 0) < PER_ORIGIN_MS) return { ok: false, reason: 'just done' };
    const recent = (perPage.get(guestId) || []).filter(x => t - x < 60 * 1000);
    if (recent.length >= PER_PAGE_PER_MIN) return { ok: false, reason: 'too many for this page' };
    recent.push(t);
    perPage.set(guestId, recent);
    lastOrigin.set(verdict.origin, t);
    if (lastOrigin.size > 200) lastOrigin.delete(lastOrigin.keys().next().value);
    ses.preconnect({ url: verdict.origin, numSockets: 1 });
    return { ok: true, origin: verdict.origin };
  }
  return { preconnect };
}

module.exports = { createPreconnect, judge, registrableDomain, allowListed, PER_ORIGIN_MS, PER_PAGE_PER_MIN };

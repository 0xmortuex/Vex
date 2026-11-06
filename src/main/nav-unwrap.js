// === Skip the redirect: a link to a tracking wrapper goes straight to the page it names =========
//
// google.com/url?q=https%3A%2F%2Fexample.com%2F, l.facebook.com/l.php?u=..., out.reddit.com/..?url=...: a link that goes through
// a company's redirect page before it reaches the page it names, so the company hears of every click. The destination is in the
// address itself, so Vex can go there directly. No request is made to the wrapper.
//
// This is the pure part: given an address, the address to go to instead, or null. It reuses the wrapper list of
// js/link-safety.js (the one "copy this link" uses) with the entries removed that must never be skipped:
//   - login: a sign-in page that carries the page to return to (Roblox, Discord): the sign-in has to happen;
//   - app: a share link that exists to hand over to an installed app (ro.blox.com).
// and it is stricter than copying is, because this one changes where a click goes:
//   - the target must be an absolute http or https address with no user name or password in it: a relative one (/x, //host/x,
//     x), javascript:, data:, blob:, file:, vbscript: and anything with a control character or a space is refused;
//   - a wrapper reached over https never sends you to http (no downgrade), at any hop of a nested chain;
//   - a target that is itself a wrapper is followed, up to 4 hops; a chain that does not end in a clean address is not touched;
//   - a double-encoded target (https%253A%252F%252F...) is decoded up to twice.
// Whether to do it at all (only a link the person clicked, only a GET, only when switched on, not for a site that opted out) is
// decided where it is called (src/main.js _unwrapTarget); siteAllows() below is the per-site part.
const { LinkSafety } = require('../renderer/js/link-safety');
const SiteRules = require('./site-rules');

const MAX_HOPS = 4;
const MAX_URL = 8192;

// The wrappers that may be skipped on a click.
const wrappers = () => LinkSafety.WRAPPERS.filter(w => !w.login && !w.app);

// Any control character, space, or line separator: never inside an address Vex will go to.
const CONTROL = new RegExp("[" + String.fromCharCode(0) + "-" + String.fromCharCode(32) + String.fromCharCode(127) + "-" + String.fromCharCode(159) + String.fromCharCode(0x2028) + String.fromCharCode(0x2029) + "]");

// One decoded candidate -> a parsed URL if it is a clean absolute web address, else null.
function cleanTarget(raw) {
  let v = String(raw == null ? '' : raw);
  // Double-encoded: the whole address is percent-encoded again.
  for (let i = 0; i < 2 && /^https?(?:%3a|(?:%25)+3a)/i.test(v); i++) {
    try { v = decodeURIComponent(v); } catch { return null; }
  }
  if (!v || v.length > MAX_URL || CONTROL.test(v)) return null;
  // Exactly two slashes and then a host (https:///x would be read as https://x/), and no backslash, which a browser reads as a slash.
  if (!/^https?:\/\/[^/\\?#@]/i.test(v) || v.includes('\\')) return null;
  let u;
  try { u = new URL(v); } catch { return null; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  if (u.username || u.password) return null;
  if (!u.hostname) return null;
  return u;
}

// google.com, google.com.tr, google.co.uk, google.de ... and nothing like google.com.evil.example (the list's own pattern is looser).
const GOOGLE_HOST = /^(?:www\.)?google\.(?:[a-z]{2,3}|(?:com|co|org|net)\.[a-z]{2})$/i;

// The inner address a wrapper URL carries, as a parsed URL, or null (not a wrapper, no parameter, or an unsafe one).
function innerOf(u) {
  for (const w of wrappers()) {
    if (!w.host.test(u.hostname) || !w.path.test(u.pathname)) continue;
    if (/(^|\.)google\./i.test(u.hostname) && !GOOGLE_HOST.test(u.hostname)) continue;
    const candidates = [];
    for (const p of w.params) {
      const v = u.searchParams.get(p);
      if (v) candidates.push(v);
    }
    // href.li puts the address after a bare "?" with no name at all.
    if (!w.params.length && u.search.length > 1) {
      try { candidates.push(decodeURIComponent(u.search.slice(1))); } catch { /* vex-allow-empty-catch: a malformed escape is not an address, so there is no candidate */ }
    }
    // The first parameter that holds a clean address (google.com/url?q=a+search&url=https://...).
    for (const c of candidates) {
      const t = cleanTarget(c);
      if (t) return t;
    }
    return null;
  }
  return null;
}

// -> { url, via: [hosts skipped] } or null when the address is not a wrapper (or is one that cannot be skipped safely).
function unwrapNavigation(url) {
  let u;
  try { u = new URL(String(url)); } catch { return null; }
  if (String(url).length > MAX_URL || (u.protocol !== 'http:' && u.protocol !== 'https:')) return null;
  const via = [];
  let cur = u;
  for (let hop = 0; hop < MAX_HOPS; hop++) {
    const next = innerOf(cur);
    if (!next) break;
    // Never from encrypted to unencrypted.
    if (cur.protocol === 'https:' && next.protocol === 'http:') return null;
    via.push(cur.hostname.replace(/^www\./, ''));
    cur = next;
  }
  if (!via.length) return null;
  // Still a wrapper after the hop limit: not a clean end, leave the click alone.
  if (innerOf(cur)) return null;
  return { url: cur.href, via };
}

// The person's per-site off switch ('unwrap' off, src/main/site-rules.js) on the page the click was on, on the wrapper, or on the
// page it leads to: any of the three keeps the click as it was (a sign-in that depends on the redirect).
function siteAllows(rules, fromUrl, wrapperUrl, targetUrl) {
  for (const u of [fromUrl, wrapperUrl, targetUrl]) {
    if (u && /^https?:/i.test(String(u)) && SiteRules.ruleFor(rules, u) && SiteRules.ruleFor(rules, u).unwrap === 'off') return false;
  }
  return true;
}

module.exports = { unwrapNavigation, siteAllows, cleanTarget, innerOf, MAX_HOPS };

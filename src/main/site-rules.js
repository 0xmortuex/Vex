// === Switches for one site =================================================
//
// A site that will not stop setting cookies, an article that only works with
// JavaScript off, a page whose adverts come from thirty other hosts: browser
// settings are global, and the site's own settings are the site's. These are
// per-site switches, kept by host.
//
// A rule is { js, cookies, thirdParty }, each 'on' (the normal thing) or
// 'off'. Only the ones turned off are stored, so a site with nothing turned
// off has no rule at all, and the whole thing stays a short list.
//
// What each switch does, and where:
//   js           a tab built on the site has JavaScript disabled
//                (renderer); a page reached inside an open tab gets
//                script-src 'none' (main)
//   cookies      the Cookie header is not sent to the site, and Set-Cookie
//                from it is dropped (main, per request)
//   thirdParty   requests a page of that site makes to other hosts are
//                refused (main, needs to know the page)
//   ads          the ad and tracker blocker leaves the pages of that site
//                alone (main, needs to know the page) — the site panel's
//                "Block ads and trackers on this site" switch
//   images       the page's pictures are not loaded (main, per request, needs
//                to know the page): data saving. Never in a Tor tab.
//   gpc          the Global Privacy Control signal (Sec-GPC: 1) is not sent to
//                this site: the "excluded sites" of Settings > Privacy
//   referrer     the address a request came from is left alone for this site
//                even when Settings trims it ("this site needs the referrer")
//   ua           not a switch: the site is asked for as 'mobile' or with a
//                typed User-Agent string (the desktop one is the normal
//                thing, so it is never stored). Never in a Tor tab.
const OFF = 'off';
const SWITCHES = ['js', 'cookies', 'thirdParty', 'ads', 'images', 'gpc', 'referrer'];
const UA_MOBILE = 'mobile';
const UA_MAX = 512;

function host(url) {
  try { return new URL(String(url)).hostname.replace(/^www\./, '').toLowerCase(); } catch { return ''; }
}

// A rule for the host, or for a parent domain ("example.com" covers
// "shop.example.com"). The most specific one wins.
function ruleFor(rules, url) {
  const h = host(url);
  if (!h || !rules) return null;
  let best = null, bestLen = -1;
  for (const [key, rule] of Object.entries(rules)) {
    const k = String(key).replace(/^www\./, '').toLowerCase();
    if (!(h === k || h.endsWith('.' + k))) continue;
    if (k.length > bestLen) { best = rule; bestLen = k.length; }
  }
  return best;
}

const isOff = (rules, url, what) => {
  const rule = ruleFor(rules, url);
  return !!(rule && rule[what] === OFF);
};

const blocksCookies = (rules, url) => isOff(rules, url, 'cookies');
const blocksScripts = (rules, url) => isOff(rules, url, 'js');

// Third-party: a request the page makes to a host that is not its own. Same
// registrable-ish domain counts as the site itself, so a site's own CDN on a
// subdomain is not cut off.
function blocksThirdParty(rules, pageUrl, requestUrl) {
  if (!isOff(rules, pageUrl, 'thirdParty')) return false;
  const page = host(pageUrl);
  const req = host(requestUrl);
  if (!page || !req) return false;
  return !(req === page || req.endsWith('.' + page) || page.endsWith('.' + req));
}

// The blocker is off for the page a request comes from. A request with no
// page behind it (a service worker's own) is blocked as usual.
const allowsAds = (rules, pageUrl) => !!pageUrl && isOff(rules, pageUrl, 'ads');

const blocksImages = (rules, url) => isOff(rules, url, 'images');
// GPC goes to every site unless its host is excluded.
const sendsGpc = (rules, url) => !isOff(rules, url, 'gpc');

// Whether a request keeps the address it came from untouched: the page it
// came from (the Referer's own site) or the site being asked has "needs the
// referrer" on.
function keepsReferrer(rules, referrerUrl, requestUrl) {
  return isOff(rules, referrerUrl, 'referrer') || isOff(rules, requestUrl, 'referrer');
}

// A User-Agent a person typed: printable ASCII on one line, nothing else.
function validUserAgent(ua) {
  return typeof ua === 'string' && ua.length >= 8 && ua.length <= UA_MAX && /^[ -~]+$/.test(ua) && ua.trim() === ua;
}

// The identity to ask this site's pages with, or null for the ordinary one.
// `mobileUa` is Vex's own mobile string (main.js builds it from the real
// Chrome version so it never goes stale).
function userAgentFor(rules, url, mobileUa) {
  const rule = ruleFor(rules, url);
  if (!rule || typeof rule.ua !== 'string') return null;
  if (rule.ua === UA_MOBILE) return { ua: mobileUa, mobile: true, platform: 'Android' };
  if (!validUserAgent(rule.ua)) return null;
  const mobile = /\b(Mobile|Android|iPhone|iPad)\b/i.test(rule.ua);
  return { ua: rule.ua, mobile, platform: /Android/i.test(rule.ua) ? 'Android' : /iPhone|iPad/i.test(rule.ua) ? 'iOS' : /Macintosh/i.test(rule.ua) ? 'macOS' : /Linux/i.test(rule.ua) ? 'Linux' : 'Windows' };
}

// What the renderer sends is a person's typing; keep it to the shape above.
function clean(rules) {
  const out = {};
  for (const [key, rule] of Object.entries(rules || {})) {
    const h = String(key || '').trim().replace(/^www\./, '').toLowerCase();
    if (!h || h.length > 253 || !/^[a-z0-9.-]+$/.test(h)) continue;
    const kept = {};
    for (const what of SWITCHES) if (rule && rule[what] === OFF) kept[what] = OFF;
    if (rule && (rule.ua === UA_MOBILE || validUserAgent(rule.ua))) kept.ua = rule.ua;
    if (Object.keys(kept).length) out[h] = kept;
    if (Object.keys(out).length >= 200) break;
  }
  return out;
}

module.exports = { host, ruleFor, blocksCookies, blocksScripts, blocksThirdParty, allowsAds, blocksImages, sendsGpc, keepsReferrer, userAgentFor, validUserAgent, UA_MOBILE, clean };

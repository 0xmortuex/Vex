// === Vex Ad Blocker ===
//
// Pattern-based request blocker. Two kinds of entries in AD_DOMAINS:
//   - Pure host:        "doubleclick.net"     — blocks doubleclick.net and *.doubleclick.net
//   - Host + path-pfx:  "facebook.com/tr"     — blocks facebook.com when path starts with /tr
//
// Public API: shouldBlock(url), AD_DOMAINS.
// Used by every session's webRequest.onBeforeRequest in src/main.js.

const AD_DOMAINS = [
  'doubleclick.net',
  'googlesyndication.com',
  'googletagmanager.com',
  'google-analytics.com',
  'googleadservices.com',
  'adservice.google.com',
  'pagead2.googlesyndication.com',
  'facebook.com/tr',
  'connect.facebook.net',
  'amazon-adsystem.com',
  'adsystem.com',
  'ads-twitter.com',
  'scorecardresearch.com',
  'quantserve.com',
  'adnxs.com',
  'taboola.com',
  'outbrain.com',
  'moatads.com',
  'criteo.net',
  'criteo.com',
  'adform.net',
  'pubmatic.com',
  'openx.net',
  'rubiconproject.com',
  'mathtag.com',
  'yieldmo.com',
  'bidswitch.net',
  'adsafeprotected.com',
  'ad.doubleclick.net',
  'stats.g.doubleclick.net',
  'cm.g.doubleclick.net',
  'track.adform.net',
  'cdn.taboola.com',
  'trc.taboola.com',
  'widgets.outbrain.com',
  'log.outbrain.com',
  'amplify.outbrain.com',
  'zemanta.com',
  'smartadserver.com',
  'serving-sys.com',
  'scdn.cxense.com',
  'cdn.cxense.com',
  // Ad-reinsertion / anti-adblock CDNs that rotate subdomains (e.g.
  // 0.stg.html-load.com, 3.stg.html-load.com) to slip past EasyList — the
  // Playwire ad stack many browser games (makeitmeme.com, gartic, etc.) use.
  // The engine's lists don't cover these, so block the whole domain here.
  'html-load.com',
  'intergient.com',
  'playwire.com',
  'venatusmedia.com',
  'aniview.com',
  // Fuse (game-ad mediation) + RTB House ad creatives — the other half of the
  // makeitmeme/gartic ad stack. The EasyList engine covers these, but it loads
  // asynchronously at startup; keeping them in this always-synchronous list
  // blocks them even before the engine is ready (or if its cache is stale).
  'fuseplatform.net',
  'creativecdn.com'
];

function _hostMatchesDomain(host, d) {
  // Exact host match OR direct subdomain (.x.example.com matches example.com,
  // but mydomain.com must NOT match domain.com).
  return host === d || host.endsWith('.' + d);
}

function shouldBlock(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  // Strip leading "www." so a doubleclick.net entry blocks www.doubleclick.net.
  const host = parsed.hostname.replace(/^www\./, '');

  for (const entry of AD_DOMAINS) {
    if (entry.includes('/')) {
      // Path-bearing entry: block only when host matches AND path starts with
      // the declared prefix.
      const slash = entry.indexOf('/');
      const domainPart = entry.slice(0, slash);
      const pathPrefix = entry.slice(slash);
      if (_hostMatchesDomain(host, domainPart) && parsed.pathname.startsWith(pathPrefix)) {
        return true;
      }
    } else {
      // Pure-domain entry: exact host or direct subdomain.
      if (_hostMatchesDomain(host, entry)) return true;
    }
  }
  return false;
}

// Blocked everywhere except on the site that cannot work without it. A
// filter-list rule is right about a host in general and wrong on the one site
// whose app waits on it:
//   bzr.openai.com  ChatGPT signed in showed "Content failed to load" in a
//                   tab and in the panel (2026-09-27). ||bzr.openai.com^ from
//                   the privacy list was the one new block on the day it
//                   broke; signed out, ChatGPT never asks for it.
// Each entry is the request's host and the sites (the page's host, or a
// subdomain of it) where it is let through.
const SITE_REPAIRS = [
  { host: 'bzr.openai.com', on: ['chatgpt.com', 'openai.com'] },
];
function _hostOf(u) { try { return new URL(u).hostname.toLowerCase(); } catch { return ''; } }
function repairAllows(url, pageUrl) {
  const host = _hostOf(url), page = _hostOf(pageUrl);
  if (!host || !page) return false;
  return SITE_REPAIRS.some(r => _hostMatchesDomain(host, r.host) && r.on.some(d => _hostMatchesDomain(page, d)));
}

module.exports = { shouldBlock, repairAllows, SITE_REPAIRS, AD_DOMAINS };

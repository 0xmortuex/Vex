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
  'cdn.cxense.com'
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

module.exports = { shouldBlock, AD_DOMAINS };

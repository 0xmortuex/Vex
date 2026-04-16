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

function shouldBlock(url) {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname;
    const full = host + parsed.pathname;
    return AD_DOMAINS.some(d => host === d || host.endsWith('.' + d) || full.includes(d));
  } catch {
    return false;
  }
}

module.exports = { shouldBlock, AD_DOMAINS };

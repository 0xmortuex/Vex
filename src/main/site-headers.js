// === Request headers a site is sent: GPC, the referrer, the User-Agent ====
//
// Applied in the ONE onBeforeSendHeaders dispatcher every session shares
// (main.js, wireClientHintsOnSession), after the Client Hints are made
// consistent. Pure, so the exact behaviour is tested without a window.
//
//   Sec-GPC: 1            the Global Privacy Control signal, unless the host is
//                         excluded (the 'gpc' site switch) or the session is
//                         a Tor one, which sends only what every Tor user
//                         sends.
//   Referer               trimmed by Settings > Privacy > "Referrer trimming":
//                         'origin' keeps only the origin on a cross-site
//                         request, 'strict' sends none cross-site and only
//                         the origin same-site. A site with "needs the
//                         referrer" on (either end of the request) is left
//                         alone. The header only: document.referrer in the
//                         page is the browser's and is not changed here.
//   User-Agent            the site's own choice (mobile / a typed string).
//                         Not in a Tor tab.

const SiteRules = require('./site-rules');

// Two-part public suffixes seen often enough to matter (co.uk, com.tr, ...):
// the whole public suffix list is not carried for this. A host under one of
// them needs three labels to be "a site".
const SECOND_LEVEL = new Set(['co', 'com', 'org', 'net', 'gov', 'edu', 'ac', 'or', 'ne', 'go']);

// The part of a host that makes it "one site": example.co.uk, example.com.
function siteOf(host) {
  const h = String(host || '').toLowerCase().replace(/\.$/, '');
  if (!h || /^[\d.]+$/.test(h) || h.includes(':')) return h; // an address is its own site
  const parts = h.split('.');
  if (parts.length <= 2) return h;
  const last = parts[parts.length - 1], second = parts[parts.length - 2];
  const take = last.length === 2 && SECOND_LEVEL.has(second) ? 3 : 2;
  return parts.slice(-take).join('.');
}

const isWeb = (url) => /^https?:\/\//i.test(String(url || ''));

function find(headers, name) {
  const want = name.toLowerCase();
  return Object.keys(headers).find(k => k.toLowerCase() === want);
}
function setHeader(headers, name, value) {
  const k = find(headers, name);
  if (k && k !== name) delete headers[k];
  headers[name] = value;
}
// What the Referer should be, given the mode: a string (send this), null
// (send none) or undefined (leave it as the browser made it).
function referrerFor(mode, referer, requestUrl) {
  if (mode !== 'origin' && mode !== 'strict') return undefined;
  let from, to;
  try { from = new URL(referer); to = new URL(requestUrl); } catch { return undefined; }
  if (!/^https?:$/.test(from.protocol)) return undefined;
  const origin = from.origin + '/';
  const same = siteOf(from.hostname) === siteOf(to.hostname);
  if (mode === 'origin') return same ? undefined : (referer === origin ? undefined : origin);
  return same ? (referer === origin ? undefined : origin) : null;
}

/**
 * @param {Record<string,string>} headers  the request's headers; changed in place
 * @param {{ url:string, resourceType?:string, cfg:{gpc?:boolean, referrer?:string}, rules:object,
 *           tor:boolean, pageUrl:() => string, mobileUa:string, hasUaRules:boolean }} ctx
 */
function applyHeaders(headers, ctx) {
  if (ctx.tor || !isWeb(ctx.url)) return;
  const rules = ctx.rules || {};
  const hasRules = Object.keys(rules).length > 0;

  if (ctx.cfg.gpc !== false && (!hasRules || SiteRules.sendsGpc(rules, ctx.url))) setHeader(headers, 'Sec-GPC', '1');

  const mode = ctx.cfg.referrer;
  if (mode === 'origin' || mode === 'strict') {
    const key = find(headers, 'Referer');
    if (key) {
      const referer = headers[key];
      if (!(hasRules && SiteRules.keepsReferrer(rules, referer, ctx.url))) {
        const next = referrerFor(mode, referer, ctx.url);
        if (next === null) delete headers[key];
        else if (typeof next === 'string') headers[key] = next;
      }
    }
  }

  // ctx.restoreUa: the page's webContents still carries a User-Agent from the
  // site it was on, which the network layer applies to this request before
  // main can set the page's own back; the header is put right here.
  if (ctx.hasUaRules || ctx.restoreUa) {
    const page = ctx.resourceType === 'mainFrame' ? ctx.url : ctx.pageUrl();
    const ua = ctx.hasUaRules && page ? SiteRules.userAgentFor(rules, page, ctx.mobileUa) : null;
    if (ua) {
      setHeader(headers, 'User-Agent', ua.ua);
      if (find(headers, 'sec-ch-ua-mobile')) setHeader(headers, 'sec-ch-ua-mobile', ua.mobile ? '?1' : '?0');
      if (find(headers, 'sec-ch-ua-platform')) setHeader(headers, 'sec-ch-ua-platform', '"' + ua.platform + '"');
    } else if (ctx.restoreUa) {
      setHeader(headers, 'User-Agent', ctx.restoreUa);
    }
  }
}

module.exports = { applyHeaders, referrerFor, siteOf };

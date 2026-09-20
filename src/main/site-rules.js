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
//   js           the tab is built with JavaScript disabled (renderer)
//   cookies      the Cookie header is not sent to the site, and Set-Cookie
//                from it is dropped (main, per request)
//   thirdParty   requests a page of that site makes to other hosts are
//                refused (main, needs to know the page)
const OFF = 'off';

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

// What the renderer sends is a person's typing; keep it to the shape above.
function clean(rules) {
  const out = {};
  for (const [key, rule] of Object.entries(rules || {})) {
    const h = String(key || '').trim().replace(/^www\./, '').toLowerCase();
    if (!h || h.length > 253 || !/^[a-z0-9.-]+$/.test(h)) continue;
    const kept = {};
    for (const what of ['js', 'cookies', 'thirdParty']) if (rule && rule[what] === OFF) kept[what] = OFF;
    if (Object.keys(kept).length) out[h] = kept;
    if (Object.keys(out).length >= 200) break;
  }
  return out;
}

module.exports = { host, ruleFor, blocksCookies, blocksScripts, blocksThirdParty, clean };

// === The brand list a Chrome of a given major version sends ================
//
// Vex says it is Google Chrome (a User-Agent, the Sec-CH-UA request headers and
// navigator.userAgentData in the page). Chrome's brand list has three entries:
// Chromium, Google Chrome and a made-up filler brand, and both the filler's
// name and the order of the three are worked out from the major version
// (Chromium, components/embedder_support/user_agent_utils.cc,
// GenerateBrandVersionList). Vex sent the filler of Chrome 124
// ("Not-A.Brand") with every version, while the page beside it saw this
// Chromium's own ("Not/A)Brand" on 148) in another order: a header and a page
// that disagree, and a list no Chrome 148 sends. Found 2026-11-13, when
// Cloudflare's "Verify you are human" page passed in Chrome and not in Vex.
//
// The page half is the client-hints shim in src/preload-webview.js: a sandboxed
// preload cannot require this file, so the same rule is written out there and
// tests/main/uaBrands.test.js holds the two together.

const FILLER_CHARS = [' ', '(', ':', '-', '.', '/', ')', ';', '=', '?', '_'];
const FILLER_VERSIONS = ['8', '99', '24'];
// Where the filler, Chromium and the product go: ORDERS[major % 6] = [filler, Chromium, product].
const ORDERS = [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]];

function majorOf(version) {
  const major = Number(String(version).split('.')[0]);
  if (!Number.isInteger(major) || major < 1) throw new Error('Not a Chrome version: ' + version);
  return major;
}

// [{ brand, version }] in the order Chrome gives them. `version` is a major ("148") for the short
// list, or a full version ("148.0.7778.280") for the full-version list: the filler then gets ".0.0.0".
function chromeBrands(version) {
  const v = String(version);
  const major = majorOf(v);
  const full = v.includes('.');
  const filler = {
    brand: 'Not' + FILLER_CHARS[major % 11] + 'A' + FILLER_CHARS[(major + 1) % 11] + 'Brand',
    version: FILLER_VERSIONS[major % 3] + (full ? '.0.0.0' : ''),
  };
  const order = ORDERS[major % 6];
  const list = [];
  list[order[0]] = filler;
  list[order[1]] = { brand: 'Chromium', version: v };
  list[order[2]] = { brand: 'Google Chrome', version: v };
  return list;
}

// The same list as a Sec-CH-UA / Sec-CH-UA-Full-Version-List header value.
function secChUa(version) {
  return chromeBrands(version).map(b => `"${b.brand}";v="${b.version}"`).join(', ');
}

// Chrome sends the three short hints with every page and frame load from a secure address (https, or
// this computer). Electron sends them with a page's own requests (fetch, images, scripts) and with no
// page or frame load at all, so a server saw a "Chrome" whose first request had no brand list. Found
// 2026-11-14 by comparing the two browsers on a local page. Returns `headers` itself when there is
// nothing to add, or a new object with the hints where Chrome puts them: in front of
// Upgrade-Insecure-Requests (the order of the keys is the order they are sent in).
const SECURE_ADDRESS = /^(https:\/\/|http:\/\/(localhost|[^/:]+\.localhost|127\.0\.0\.1|\[::1\])([:/]|$))/i;
function withNavigationHints(headers, { resourceType, url, brands }) {
  if (resourceType !== 'mainFrame' && resourceType !== 'subFrame') return headers;
  if (!SECURE_ADDRESS.test(String(url || ''))) return headers;
  const names = Object.keys(headers);
  if (names.some(k => k.toLowerCase() === 'sec-ch-ua')) return headers;
  const hints = { 'sec-ch-ua': brands, 'sec-ch-ua-mobile': '?0', 'sec-ch-ua-platform': '"Windows"' };
  let before = names.find(k => k.toLowerCase() === 'upgrade-insecure-requests');
  if (!before) before = names.find(k => k.toLowerCase() === 'user-agent');
  if (!before) return Object.assign(hints, headers);
  const out = {};
  for (const k of names) {
    if (k === before) Object.assign(out, hints);
    out[k] = headers[k];
  }
  return out;
}

// The Accept-Language list Chrome makes from the languages a page sees in navigator.languages
// (Chromium, net/http/http_util.cc, ExpandLanguageList): each language is followed by its plain one
// ("en-US" then "en") unless the next language in the list is of the same family, and nothing is listed
// twice. Electron sends only the first language, so the header and the page disagreed ("en-US" against
// ["en-US", "tr"]). The result is what session.setUserAgent takes; Chromium adds the q= weights.
function acceptLanguages(languages) {
  const list = [...new Set(languages.filter(Boolean))];
  const out = [];
  const add = (l) => { if (!out.includes(l)) out.push(l); };
  const baseOf = (l) => l.split('-')[0];
  list.forEach((lang, i) => {
    add(lang);
    const base = baseOf(lang);
    if (base === 'x' || base === 'i') return;
    if (i + 1 === list.length || baseOf(list[i + 1]) !== base) add(base);
  });
  return out.join(',');
}

module.exports = { chromeBrands, secChUa, withNavigationHints, acceptLanguages };

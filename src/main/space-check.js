// === Share a space: what Vex knows about the addresses in a space someone sent (js/share-space.js) ==========================================
//
// The review of a shared space lists every address with its real host name. This is the part that only main can answer: whether the name is
// a look-alike of a well-known site (src/main/web-safety.js) and whether it is on the list of reported phishing and malware sites
// (src/main/threat-list.js). Both lookups are local: an address is never sent anywhere. Nothing is loaded here, nothing is opened.
//
//   checkAddresses(urls, { analyzeHost, threatCheck, domainToUnicode }) -> [{ url, host, unicode, punycode, lookalike, threat, error }]
//
// `host` is the name exactly as the network would use it (punycode stays punycode), `unicode` is how a browser would draw it, and
// `punycode` says some part of the name is written that way, which is how a look-alike name hides.

const MAX_URLS = 200;
const MAX_URL_CHARS = 2048;

function checkAddresses(urls, { analyzeHost, threatCheck, domainToUnicode }) {
  if (!Array.isArray(urls)) throw new Error('The addresses to check must be a list');
  if (urls.length > MAX_URLS) throw new Error('At most ' + MAX_URLS + ' addresses can be checked at once');
  return urls.map((url) => {
    if (typeof url !== 'string' || url.length > MAX_URL_CHARS) throw new Error('An address to check must be text of at most ' + MAX_URL_CHARS + ' characters');
    let u;
    try { u = new URL(url); } catch { return { url, host: '', unicode: '', punycode: false, lookalike: null, threat: null, error: 'That is not an address' }; }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return { url, host: '', unicode: '', punycode: false, lookalike: null, threat: null, error: 'Only http and https addresses are opened' };
    const host = u.hostname.toLowerCase().replace(/\.+$/, '');
    const unicode = domainToUnicode(host) || host;
    const verdict = analyzeHost(host);
    const hit = threatCheck(url);
    return {
      url, host, unicode,
      punycode: host.split('.').some((label) => label.startsWith('xn--')),
      lookalike: verdict && verdict.flagged ? { kind: verdict.kind, resembles: verdict.resembles || null, line: verdict.line || '' } : null,
      threat: hit ? { kind: hit.kind, host: hit.host } : null,
      error: null,
    };
  });
}

module.exports = { checkAddresses, MAX_URLS, MAX_URL_CHARS };

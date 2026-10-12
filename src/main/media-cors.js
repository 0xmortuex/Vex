// === Access-Control-Allow-Origin on media, for the Master Volume boost ===
// Boosting a cross-origin <video>/<audio> above 100% (js/master-volume.js)
// routes it through Web Audio, which silences it unless the response is
// CORS-clean; so Vex adds "Access-Control-Allow-Origin: *" to media responses
// that have none. Added to every media response, that let any page read the
// bytes of audio and video on the computer itself or the local network
// (a camera, a NAS, a router's page) by asking for it with crossorigin set —
// what the browser exists to stop (security finding SE7). It is now added only
// for a server on the internet: a public file the page's own server could
// fetch anyway, sent without cookies (the tap asks "anonymous").
//
// Hosts are judged by name and address as written; a public name that
// resolves to a private address is not caught here.

function ipv4Private(h) {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
  if (!m) return null;
  const [a, b] = [Number(m[1]), Number(m[2])];
  return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
}

function ipv6Private(h) {
  if (!h.includes(':')) return null;
  if (h === '::' || h === '::1') return true;
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(h);
  if (mapped) return ipv4Private(mapped[1]);
  // The URL parser writes a mapped IPv4 address in hex: ::ffff:7f00:1.
  const hex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(h);
  if (hex) {
    const hi = parseInt(hex[1], 16), lo = parseInt(hex[2], 16);
    return ipv4Private(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`);
  }
  return /^f[cd][0-9a-f]{0,2}:/.test(h) || /^fe[89ab][0-9a-f]?:/.test(h);
}

// True for anything that is not plainly a server on the internet: this
// computer, a private or link-local address, an intranet name.
function isPrivateNetworkUrl(url) {
  let u;
  try { u = new URL(url); } catch { return true; }
  if (!/^https?:$/.test(u.protocol)) return true;
  const h = u.hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (!h) return true;
  const v4 = ipv4Private(h);
  if (v4 !== null) return v4;
  const v6 = ipv6Private(h);
  if (v6 !== null) return v6;
  if (!h.includes('.')) return true;   // "nas", "router": a name only the local network knows
  return h === 'localhost' || /\.(?:localhost|local|lan|home|internal|intranet|corp|localdomain|home\.arpa)$/.test(h);
}

function addMediaCorsHeaders(details, responseHeaders) {
  if (!responseHeaders || !details || details.resourceType !== 'media') return false;
  if (Object.keys(responseHeaders).some(k => k.toLowerCase() === 'access-control-allow-origin')) return false;
  if (isPrivateNetworkUrl(details.url)) return false;
  responseHeaders['Access-Control-Allow-Origin'] = ['*'];
  return true;
}

module.exports = { isPrivateNetworkUrl, addMediaCorsHeaders };

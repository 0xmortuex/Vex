// === API playground: one request, sent from the main process ===
//
// The playground's request builder (renderer/js/api-playground.js) hands main
// a method, an address, headers and a body. Main sends it with a short
// timeout and a size cap and gives the answer back.
//
// Where it may go:
//   - public internet addresses, always. Every hop is checked (public-fetch.js:
//     the name, then what it resolves to, then each redirect).
//   - this machine ONLY when the person has switched "allow localhost" on in
//     the playground, and then only localhost / 127.x / ::1. Other private
//     addresses (a router, 192.168.x.x, 10.x.x.x) stay refused either way.
//     A localhost answer that redirects is not followed.
//   - never with the user's cookies: the request carries only what the person
//     wrote in the headers.
//
// createApiPlayground({ publicFetch, localFetch, boundedFactory, timeoutMs, maxBytes })
//   publicFetch(url, init) → Response   (createPublicFetch's result)
//   localFetch(url, init)  → Response   (net.fetch with redirect:'manual', no credentials)
//   boundedFactory(fetchImpl) → bounded fetch (createBoundedFetch)

const { isIpLiteral, isPrivateIp } = require('../renderer/js/private-address');
const { REFUSED } = require('./public-fetch');

const METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']);
// Headers a request builder must not set: the network stack owns them.
const FORBIDDEN_HEADERS = new Set(['host', 'content-length', 'connection', 'transfer-encoding', 'upgrade', 'te', 'trailer', 'keep-alive', 'proxy-authorization', 'proxy-connection']);
const TOKEN = /^[!#$%&'*+.^_`|~0-9A-Za-z-]{1,100}$/;

// localhost, *.localhost, 127.0.0.0/8, ::1 and ::ffff:127.x.
function isLoopbackHost(host) {
  const h = String(host || '').toLowerCase().replace(/^\[|\]$/g, '').replace(/\.+$/, '');
  if (h === 'localhost' || h.endsWith('.localhost')) return true;
  if (/^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h)) return true;
  if (h === '::1' || h === '0:0:0:0:0:0:0:1') return true;
  const mapped = /^::ffff:(.+)$/.exec(h);
  if (mapped) return /^127\./.test(mapped[1]) || /^7f[0-9a-f]{2}:[0-9a-f]{1,4}$/.test(mapped[1]);
  return false;
}

function cleanHeaders(headers) {
  const out = {};
  if (headers == null) return out;
  if (typeof headers !== 'object' || Array.isArray(headers)) throw new Error('Headers must be a name/value object');
  const names = Object.keys(headers);
  if (names.length > 50) throw new Error('At most 50 headers');
  for (const name of names) {
    if (!TOKEN.test(name)) throw new Error('Not a valid header name: ' + name.slice(0, 40));
    if (FORBIDDEN_HEADERS.has(name.toLowerCase())) throw new Error('The ' + name + ' header is set by Vex');
    const value = headers[name];
    if (typeof value !== 'string' || value.length > 8192 || /[\r\n\0]/.test(value)) throw new Error('Not a valid value for header ' + name);
    out[name] = value;
  }
  return out;
}

function createApiPlayground({ publicFetch, localFetch, boundedFactory, timeoutMs = 10000, maxBytes = 2 * 1024 * 1024 }) {
  if (typeof publicFetch !== 'function' || typeof localFetch !== 'function' || typeof boundedFactory !== 'function') throw new Error('createApiPlayground needs publicFetch, localFetch and boundedFactory');
  const viaPublic = boundedFactory(publicFetch);
  const viaLocal = boundedFactory(localFetch);

  async function send(req) {
    if (!req || typeof req !== 'object') throw new Error('No request');
    const method = String(req.method || 'GET').toUpperCase();
    if (!METHODS.has(method)) throw new Error('Method not allowed: ' + method.slice(0, 20));
    let u;
    try { u = new URL(String(req.url || '')); } catch { throw new Error('That is not a valid address'); }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('Only http and https addresses can be sent to');
    if (u.username || u.password) throw new Error('Put credentials in a header, not in the address');
    const headers = cleanHeaders(req.headers);
    let body;
    if (req.body != null && req.body !== '') {
      if (method === 'GET' || method === 'HEAD') throw new Error(method + ' requests carry no body');
      if (typeof req.body !== 'string') throw new Error('The body must be text');
      if (req.body.length > 1024 * 1024) throw new Error('The body is larger than 1 MB');
      body = req.body;
    }
    const host = u.hostname.replace(/^\[|\]$/g, '');
    const loopback = isLoopbackHost(host);
    if (loopback && req.allowLocal !== true) throw new Error('This is a localhost address. Turn on "Allow localhost" in the playground to send to it');
    if (!loopback && isIpLiteral(host) && isPrivateIp(host)) throw new Error('Addresses on the local network are not sent to');
    // Names without a dot (a router's name, a machine name) and everything a
    // name resolves to are judged by createPublicFetch on every hop.

    const t0 = Date.now();
    const fetchIt = loopback ? viaLocal : viaPublic;
    let res;
    try {
      res = await fetchIt(u.href, { method, headers, ...(body !== undefined ? { body } : {}), timeoutMs, maxBytes, maxRequestBytes: 1024 * 1024 + 16 });
    } catch (err) {
      // The shared check speaks of "the agent"; here it is the playground's.
      if (err && err.message === REFUSED) throw new Error('That address is on this machine or the local network, which the playground does not send to', { cause: err });
      throw err;
    }
    const buf = Buffer.from(await res.arrayBuffer());
    const hdrs = [];
    res.headers.forEach((v, k) => { hdrs.push([k, v]); });
    const contentType = res.headers.get('content-type') || '';
    const binary = /^(image|audio|video|font)\/|application\/(octet-stream|zip|pdf|gzip)/i.test(contentType);
    return {
      ok: true,
      status: res.status,
      statusText: res.statusText || '',
      timeMs: Date.now() - t0,
      size: buf.length,
      contentType,
      headers: hdrs.slice(0, 100),
      body: binary ? '' : buf.toString('utf8'),
      binary,
      local: loopback,
    };
  }

  return { send };
}

module.exports = { createApiPlayground, isLoopbackHost, cleanHeaders };

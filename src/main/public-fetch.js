// === A fetch that only reaches the public internet ===
//
// The AI agent reads pages it was pointed at by text it read (read_url,
// read_many, web_search). That text can be written by anyone, so the agent
// must not be talked into reading a service on this machine or the user's
// router. The window's check was only a courtesy: it saw [::ffff:127.0.0.1],
// the machine's own name and a redirect as "public" (found 2026-10-10).
//
// Here, in main, every hop is checked: the host name, then the addresses it
// resolves to (with Chromium's own resolver, the one the request then uses),
// and a redirect is not followed by the network stack: it ends that request,
// and the new address is checked before a fresh request goes to it.
//
// createPublicFetch({ request, resolveHost }) → fetchImpl(url, init) → Response
//   request:     Electron's net.request
//   resolveHost: (host) → { endpoints: [{ address }] } (Electron's net.resolveHost)
// The result is a plain fetch implementation, meant to be wrapped by
// createBoundedFetch (size and time limits).

const { isPrivateHost, isPrivateIp, isIpLiteral } = require('../renderer/js/private-address');

const REFUSED = 'Pages on this machine or the local network are not read by the agent';
const MAX_REDIRECTS = 5;
const NULL_BODY = new Set([101, 204, 205, 304]);

function createPublicFetch({ request, resolveHost }) {
  if (typeof request !== 'function' || typeof resolveHost !== 'function') throw new Error('createPublicFetch needs request and resolveHost');

  async function checkUrl(href) {
    let u;
    try { u = new URL(href); } catch { throw new Error('Not a valid URL: ' + href); }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('Only http and https pages can be read');
    const host = u.hostname.replace(/^\[|\]$/g, '');
    if (isPrivateHost(host)) throw new Error(REFUSED);
    if (isIpLiteral(host)) return u;
    const resolved = await resolveHost(host);
    const addresses = ((resolved && resolved.endpoints) || []).map(e => e && e.address).filter(Boolean);
    if (!addresses.length) throw new Error('Could not find the address of ' + host);
    if (addresses.some(isPrivateIp)) throw new Error(REFUSED);
    return u;
  }

  // One hop. Resolves { redirect: { status, url } } or { response }.
  function hop(href, init) {
    return new Promise((resolve, reject) => {
      const signal = init.signal;
      if (signal && signal.aborted) { reject(signal.reason || new Error('Request cancelled')); return; }
      const req = request({ url: href, method: init.method || 'GET', redirect: 'manual', useSessionCookies: false });
      let settled = false;
      const finish = (fn, value) => { if (!settled) { settled = true; if (signal) signal.removeEventListener('abort', onAbort); fn(value); } };
      const onAbort = () => { try { req.abort(); } catch (err) { console.error('[publicFetch] abort failed:', err.message); } finish(reject, signal.reason || new Error('Request cancelled')); };
      if (signal) signal.addEventListener('abort', onAbort, { once: true });
      for (const [k, v] of Object.entries(init.headers || {})) req.setHeader(k, String(v));
      req.on('redirect', (status, _method, redirectUrl) => {
        // Not followed here: the next address is checked first (asynchronously),
        // and Electron cancels a redirect that is not followed synchronously.
        finish(resolve, { redirect: { status, url: redirectUrl } });
        try { req.abort(); } catch (err) { console.error('[publicFetch] abort after redirect failed:', err.message); }
      });
      req.on('response', (res) => {
        const headers = new Headers();
        for (const [k, v] of Object.entries(res.headers || {})) {
          for (const one of (Array.isArray(v) ? v : [v])) headers.append(k, String(one));
        }
        const body = NULL_BODY.has(res.statusCode) ? null : new ReadableStream({
          start(ctrl) {
            res.on('data', (chunk) => ctrl.enqueue(new Uint8Array(chunk)));
            res.on('end', () => ctrl.close());
            res.on('error', (err) => ctrl.error(err));
          },
          cancel() { try { req.abort(); } catch (err) { console.error('[publicFetch] abort on cancel failed:', err.message); } },
        });
        const response = new Response(body, { status: res.statusCode, statusText: res.statusMessage || '', headers });
        Object.defineProperty(response, 'url', { value: href });
        finish(resolve, { response });
      });
      req.on('error', (err) => finish(reject, err));
      if (init.body != null) req.write(init.body);
      req.end();
    });
  }

  return async function publicFetch(url, init = {}) {
    let href = String(url || '');
    let opts = { ...init };
    for (let n = 0; ; n++) {
      const u = await checkUrl(href);
      const out = await hop(u.href, opts);
      if (out.response) return out.response;
      if (n >= MAX_REDIRECTS) throw new Error('Too many redirects from ' + u.hostname);
      href = new URL(out.redirect.url, u.href).href;
      // A 303 (and a POST answered by 301/302) is fetched again with GET.
      const method = String(opts.method || 'GET').toUpperCase();
      if (out.redirect.status === 303 || ((out.redirect.status === 301 || out.redirect.status === 302) && method === 'POST')) {
        opts = { ...opts, method: 'GET' };
        delete opts.body;
      }
    }
  };
}

module.exports = { createPublicFetch, REFUSED };

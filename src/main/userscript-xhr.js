// === GM_xmlhttpRequest's transport ==========================================
//
// One request for a userscript, made by the main process from a session of its
// own (no cookies in, none kept: the page's logins never ride along), over
// plain http(s). Every hop of a redirect is checked against the script's
// @connect list again, so an allowed host cannot bounce the request somewhere
// that is not. Size and time are bounded both ways.
'use strict';

// Headers a script may not set: the browser (or this file) owns them.
const FORBIDDEN_HEADERS = /^(?:cookie2?|host|content-length|connection|transfer-encoding|upgrade|origin|sec-.*|proxy-.*|te|trailer|keep-alive|expect|via|dnt|access-control-request-.*)$/i;
const MAX_HOPS = 8;

function createXhr({ net, getSession, limits }) {
  if (!net || typeof net.request !== 'function') throw new Error('createXhr needs net.request');
  function start({ url, method = 'GET', headers = {}, body = null, timeoutMs, responseType = 'text', allow }) {
    let aborted = null;
    let current = null;
    const promise = new Promise((resolve, reject) => {
      const verdict = allow(url);
      if (!verdict.ok) { reject(new Error(verdict.reason)); return; }
      const upper = String(method || 'GET').toUpperCase();
      if (!['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'].includes(upper)) { reject(new Error('Method not allowed: ' + String(method).slice(0, 20))); return; }
      let payload = null;
      if (body != null) {
        payload = typeof body === 'string' ? Buffer.from(body, 'utf8') : Buffer.from(body);
        if (payload.length > limits.maxXhrBody) { reject(new Error('The request body is larger than ' + Math.round(limits.maxXhrBody / 1048576) + ' MB')); return; }
        if (upper === 'GET' || upper === 'HEAD') payload = null;
      }
      const wait = Math.min(Math.max(Number(timeoutMs) || limits.xhrTimeoutMs, 1000), limits.maxXhrTimeoutMs);
      const started = Date.now();
      let settled = false;
      const done = (fn, v) => { if (settled) return; settled = true; clearTimeout(timer); fn(v); };
      const timer = setTimeout(() => { try { current && current.abort(); } catch { /* already gone */ } done(reject, Object.assign(new Error('timeout'), { timeout: true })); }, wait);
      aborted = () => { try { current && current.abort(); } catch { /* already gone */ } done(reject, Object.assign(new Error('aborted'), { aborted: true })); };
      let hops = 0;
      let target = url;

      const go = () => {
        const req = net.request({ url: target, method: upper, session: getSession(), redirect: 'manual', credentials: 'omit', useSessionCookies: false });
        current = req;
        for (const [k, v] of Object.entries(headers || {})) {
          if (typeof k !== 'string' || FORBIDDEN_HEADERS.test(k) || typeof v !== 'string') continue;
          try { req.setHeader(k, v); } catch { /* a header Chromium refuses */ }
        }
        req.on('redirect', (_status, _m, redirectUrl) => {
          hops++;
          if (hops > MAX_HOPS) { try { req.abort(); } catch { /* gone */ } done(reject, new Error('too many redirects')); return; }
          const next = allow(redirectUrl);
          if (!next.ok) { try { req.abort(); } catch { /* gone */ } done(reject, new Error('redirected to a site this script may not contact: ' + next.reason)); return; }
          target = redirectUrl;
          req.followRedirect();
        });
        req.on('response', (res) => {
          const chunks = [];
          let size = 0;
          res.on('data', (chunk) => {
            size += chunk.length;
            if (size > limits.maxXhrResponse) { try { req.abort(); } catch { /* gone */ } done(reject, new Error('The answer is larger than ' + Math.round(limits.maxXhrResponse / 1048576) + ' MB')); return; }
            chunks.push(chunk);
          });
          res.on('end', () => {
            const buf = Buffer.concat(chunks);
            const h = res.headers || {};
            const lines = Object.entries(h).map(([k, v]) => k + ': ' + (Array.isArray(v) ? v.join(', ') : v)).join('\r\n');
            const out = {
              status: res.statusCode, statusText: res.statusMessage || '', finalUrl: target, readyState: 4,
              responseHeaders: lines, ms: Date.now() - started,
            };
            if (responseType === 'arraybuffer' || responseType === 'blob') {
              out.response = new Uint8Array(buf);
              out.contentType = String(h['content-type'] || '');
            } else {
              out.responseText = buf.toString('utf8');
            }
            done(resolve, out);
          });
          res.on('error', (err) => done(reject, err));
        });
        req.on('error', (err) => done(reject, err));
        if (payload && payload.length) {
          try { req.write(payload); } catch (err) { done(reject, err); return; }
        }
        req.end();
      };
      go();
    });
    return { promise, abort: () => { if (aborted) aborted(); } };
  }
  return { start };
}

module.exports = { createXhr, FORBIDDEN_HEADERS, MAX_HOPS };

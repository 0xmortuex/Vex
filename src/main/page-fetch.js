// === One page, fetched for the site crawler =================================
//
// The link checker only ever asks for a status. A crawler has to read the
// page, to find the next links and to see its title. This is that one read:
//
//   - from the same SEPARATE, EMPTY session as the link checker (no cookies,
//     no logins — a site being crawled must not learn who is asking),
//   - web addresses only,
//   - HTML only: anything else is answered with its status and dropped
//     unread, so a crawl never downloads a video or an installer,
//   - at most MAX_BYTES of it, and within a deadline,
//   - redirects followed hop by hop, so the report can say where a link
//     really ends up (Electron's fetch reports the original address).
//
// The crawl itself — which pages, how many, robots.txt — is the renderer's
// (src/renderer/js/site-crawler.js), where a page can be parsed with a real
// HTML parser instead of patterns.

const MAX_BYTES = 2 * 1024 * 1024;
const TIMEOUT_MS = 15000;
const MAX_HOPS = 8;

function createPageFetch({ net, getSession, timeoutMs = TIMEOUT_MS, maxBytes = MAX_BYTES, now = () => Date.now() }) {
  function fetchPage(url, { accept = 'text/html' } = {}) {
    let u;
    try { u = new URL(String(url)); } catch { return Promise.reject(new Error('Not a web address: ' + String(url).slice(0, 200))); }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return Promise.reject(new Error('Only web pages can be crawled'));
    // robots.txt is text (some sites label it text/html); everything else must be a page.
    const wanted = accept === 'text/plain' ? /^text\//i : /^(text\/html|application\/xhtml\+xml)\b/i;

    return new Promise((resolve, reject) => {
      const started = now();
      const hops = [];
      let settled = false;
      const done = (fn, v) => { if (settled) return; settled = true; clearTimeout(timer); fn(v); };
      const req = net.request({ url: u.href, method: 'GET', session: getSession(), redirect: 'manual', credentials: 'omit', useSessionCookies: false });
      try { req.setHeader('Accept', accept === 'text/plain' ? 'text/plain' : 'text/html,application/xhtml+xml;q=0.9'); } catch { /* restricted header */ }
      const timer = setTimeout(() => { try { req.abort(); } catch {} done(reject, new Error('timeout')); }, timeoutMs);

      req.on('redirect', (statusCode, _method, redirectUrl) => {
        hops.push({ status: statusCode, url: redirectUrl });
        if (hops.length > MAX_HOPS) { try { req.abort(); } catch {} done(reject, new Error('too many redirects')); return; }
        if (!/^https?:/i.test(redirectUrl)) { try { req.abort(); } catch {} done(reject, new Error('redirected away from the web: ' + redirectUrl.slice(0, 200))); return; }
        req.followRedirect();
      });

      req.on('response', (res) => {
        const h = res.headers || {};
        const header = (name) => { const v = h[name]; return Array.isArray(v) ? v[0] : (v == null ? '' : String(v)); };
        const contentType = header('content-type');
        const base = { url: u.href, finalUrl: hops.length ? hops[hops.length - 1].url : u.href, redirects: hops, status: res.statusCode, contentType, xRobots: header('x-robots-tag') };
        if (!wanted.test(contentType)) {
          // Not a page: its status is all that is needed. Drop it unread.
          try { req.abort(); } catch {}
          done(resolve, { ...base, ms: now() - started, text: null, truncated: false });
          return;
        }
        const chunks = [];
        let size = 0, truncated = false;
        res.on('data', (chunk) => {
          if (truncated) return;
          size += chunk.length;
          if (size > maxBytes) {
            chunks.push(chunk.subarray(0, chunk.length - (size - maxBytes)));
            truncated = true;
            try { req.abort(); } catch {}
            done(resolve, { ...base, ms: now() - started, text: Buffer.concat(chunks).toString('utf8'), truncated: true });
            return;
          }
          chunks.push(chunk);
        });
        res.on('end', () => done(resolve, { ...base, ms: now() - started, text: Buffer.concat(chunks).toString('utf8'), truncated }));
        res.on('error', (err) => done(reject, err));
      });
      req.on('error', (err) => done(reject, err));
      req.on('abort', () => done(reject, new Error('aborted')));
      req.end();
    });
  }

  return { fetchPage };
}

module.exports = { createPageFetch, MAX_BYTES, MAX_HOPS };

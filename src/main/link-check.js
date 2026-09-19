// === Which links on this page are broken? ===================================
//
// A page full of links rots. A post from 2019 points at a moved article, a
// store listing at a dead product, your own site at a page you deleted. You
// find out by clicking them one at a time.
//
// This asks every link at once — politely: a few at a time, HEAD first so no
// page is downloaded, each with a deadline — and sorts the answers.
//
// It asks from a SEPARATE, EMPTY session (no cookies, no logins, nothing from
// your browsing), because checking forty links means contacting forty sites
// and none of them should learn who you are from it. The cost is honest: a
// page that needs you signed in answers "sign in first", and that is filed as
// "needs sign-in", not as broken.

const MAX_LINKS = 300;
const CONCURRENCY = 6;
const TIMEOUT_MS = 12000;
const MAX_HOPS = 8;            // redirects followed before giving up

// What an answer means, in the terms a person would use.
function classify(status, error) {
  if (error) {
    if (/timeout|timed out|aborted/i.test(error)) return 'slow';
    return 'broken';                 // DNS failure, refused, TLS failure…
  }
  if (status >= 200 && status < 400) return 'ok';
  if (status === 404 || status === 410) return 'broken';
  // 401/403: signed-in only or a bot wall. 429: slow down. 999: LinkedIn's
  // own "no robots". None of these say the link is dead.
  if (status === 401 || status === 403 || status === 429 || status === 999) return 'blocked';
  if (status >= 500) return 'error';
  return 'broken';
}

function createLinkCheck({ fetchIn, timeoutMs = TIMEOUT_MS, concurrency = CONCURRENCY }) {
  async function one(url) {
    // Redirects are followed HERE, hop by hop, not by fetch: Electron's
    // session fetch followed them but reported the original address as the
    // final one, so a moved link came back looking untouched (seen live).
    const attempt = async (method) => {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(new Error('timeout')), timeoutMs);
      try {
        let at = url;
        for (let hop = 0; hop <= MAX_HOPS; hop++) {
          const r = await fetchIn(at, { method, redirect: 'manual', signal: ctl.signal, headers: { Accept: 'text/html,*/*;q=0.8' } });
          // A GET was only to learn the status: never read a whole page.
          if (method === 'GET') { try { r.body && r.body.cancel && await r.body.cancel(); } catch { /* already done */ } }
          const location = r.status >= 300 && r.status < 400 && r.headers && typeof r.headers.get === 'function' ? r.headers.get('location') : null;
          if (!location) return { status: r.status, finalUrl: at };
          let nextUrl;
          try { nextUrl = new URL(location, at).href; } catch { return { status: r.status, finalUrl: at }; }
          if (!/^https?:/i.test(nextUrl)) return { status: r.status, finalUrl: at };
          at = nextUrl;
        }
        throw new Error('too many redirects');
      } finally { clearTimeout(timer); }
    };
    try {
      let r = await attempt('HEAD');
      // Plenty of servers refuse HEAD, or answer it differently from GET.
      if (r.status === 405 || r.status === 501 || r.status === 403 || r.status === 404 || r.status === 400) {
        try { r = await attempt('GET'); } catch { /* keep the HEAD answer */ }
      }
      return { url, status: r.status, finalUrl: r.finalUrl, redirected: !!r.finalUrl && r.finalUrl !== url, verdict: classify(r.status) };
    } catch (err) {
      const msg = String((err && (err.cause && err.cause.message)) || (err && err.message) || err || 'failed');
      return { url, status: 0, finalUrl: url, redirected: false, verdict: classify(0, msg), error: msg.slice(0, 160) };
    }
  }

  async function check(urls) {
    if (!Array.isArray(urls)) throw new Error('No links to check');
    const list = [...new Set(urls.filter(u => typeof u === 'string' && /^https?:\/\//i.test(u) && u.length <= 4096))];
    if (!list.length) throw new Error('There are no web links on this page');
    const todo = list.slice(0, MAX_LINKS);
    const results = new Array(todo.length);
    let next = 0;
    const worker = async () => {
      while (next < todo.length) {
        const i = next++;
        results[i] = await one(todo[i]);
      }
    };
    await Promise.all(Array.from({ length: Math.min(concurrency, todo.length) }, worker));
    return { results, skipped: Math.max(0, list.length - MAX_LINKS) };
  }

  return { check, one };
}

// Electron's own fetch cannot do what the checker needs: with redirect
// 'follow' it reports the ORIGINAL address as the final one, and with
// 'manual' it aborts ("Redirect was cancelled") instead of returning the
// 3xx — both seen live. net.request raises a real 'redirect' event with the
// next address, so a fetch-shaped adapter over it gives the checker a proper
// 3xx + Location. Nothing is read from a body; the request is dropped as soon
// as its status is known.
function netRequestFetch(net, getSession) {
  return (url, init = {}) => new Promise((resolve, reject) => {
    let settled = false;
    const done = (fn, v) => { if (settled) return; settled = true; fn(v); };
    const req = net.request({ url, method: init.method || 'GET', session: getSession(), redirect: 'manual', credentials: 'omit', useSessionCookies: false });
    for (const [k, v] of Object.entries(init.headers || {})) { try { req.setHeader(k, v); } catch { /* restricted header */ } }
    const onAbort = () => { try { req.abort(); } catch {} done(reject, (init.signal && init.signal.reason) || new Error('aborted')); };
    if (init.signal) {
      if (init.signal.aborted) return onAbort();
      init.signal.addEventListener('abort', onAbort, { once: true });
    }
    req.on('redirect', (statusCode, _method, redirectUrl) => {
      done(resolve, { status: statusCode, url, headers: { get: (h) => (String(h).toLowerCase() === 'location' ? redirectUrl : null) }, body: null });
      try { req.abort(); } catch {}
    });
    req.on('response', (res) => {
      const headers = res.headers || {};
      done(resolve, { status: res.statusCode, url, headers: { get: (h) => { const v = headers[String(h).toLowerCase()]; return Array.isArray(v) ? v[0] : (v == null ? null : v); } }, body: null });
      try { req.abort(); } catch {}
    });
    req.on('error', (err) => done(reject, err));
    req.on('abort', () => done(reject, new Error('aborted')));
    req.end();
  });
}

module.exports = { createLinkCheck, classify, netRequestFetch, MAX_LINKS };

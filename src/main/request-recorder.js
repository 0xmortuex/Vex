// === Request recorder for "Copy as request" ===================================
//
// "Right-click a request, copy it as cURL, fetch or PowerShell" needs a list of the requests a page made. Vex had
// none on purpose: keeping every request's headers would mean holding every page's cookies and tokens. This is
// the version that is safe to build:
//
//   * OFF until the person arms ONE page ("Record requests of this tab"), and it disarms itself after
//     ARM_MS (5 minutes), when the page's window closes, or when the person stops it;
//   * only for a page that is not private, not in a private window, and not through Tor (the caller judges that
//     and passes `allowed`; a refusal is an error, never a silent skip);
//   * the sensitive values are removed WHEN A REQUEST IS RECORDED, not when it is shown: Authorization, Cookie,
//     token-like headers are stored as the marker <REDACTED> (the header name stays, so the copy shows that one
//     was sent), and the address goes through redactUrl (js/redact.js) like the failed-request log. A secret is
//     never held in memory here at all;
//   * no request body and no response is kept; the list lives in memory, is bounded (MAX requests, MAX_HEADERS
//     headers each) and is gone with the app or the page.
//
// The listeners are the ones every session already has (a second webRequest listener would REPLACE Vex's own):
// main.js calls recordHeaders() from the one onBeforeSendHeaders and recordDone() from onCompleted and
// onErrorOccurred.
const { redactUrl } = require('../renderer/js/redact');

const REDACTED = '<REDACTED>';
// The same rule as VexCopyAs.SENSITIVE_HEADER (js/copy-as-request.js); a test keeps the two equal.
const SENSITIVE_HEADER = /^(authorization|proxy-authorization|cookie|set-cookie|x-api-key|api-key|x-auth-token|x-csrf-token|x-xsrf-token)$|token|secret|password|passwd|session|signature|credential|(^|-)key$/i;
// Headers the browser adds that mean nothing when you replay a request by hand.
const NOISE_HEADER = /^(sec-ch-ua.*|sec-fetch-.*|accept-encoding|connection|host|content-length|priority|upgrade-insecure-requests|origin-agent-cluster)$/i;
const SKIP_TYPES = new Set(['webSocket', 'cspReport', 'ping']);
const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];

function createRequestRecorder({ max = 100, maxArmed = 3, armMs = 5 * 60 * 1000, now = () => Date.now() } = {}) {
  const armed = new Map();    // webContents id -> { until, seq, list: [{ seq, rid, t, method, url, type, headers, status, error }] }

  function live(id) {
    const a = armed.get(id);
    if (!a) return null;
    if (now() >= a.until) { armed.delete(id); return null; }
    return a;
  }

  // `allowed` is the caller's judgement of the page (false = private, Tor, in a private window).
  function arm(id, { allowed, why = 'This page cannot be recorded' } = {}) {
    if (!Number.isInteger(id) || id < 1) throw new Error('There is no page to record');
    if (allowed !== true) throw new Error(why);
    if (!armed.has(id) && armed.size >= maxArmed) {
      // Drop the oldest armed page rather than refuse: the person just asked for this one.
      armed.delete(armed.keys().next().value);
    }
    armed.set(id, { until: now() + armMs, seq: 0, list: [] });
    return { id, until: armed.get(id).until };
  }
  const disarm = (id) => armed.delete(id);
  const isArmed = (id) => !!live(id);

  // Called from onBeforeSendHeaders with the FINAL headers (after Vex's own rewrites). Cheap when nothing is armed.
  function recordHeaders(details, requestHeaders) {
    if (!armed.size || !details) return false;
    const id = details.webContentsId;
    const a = live(id);
    if (!a) return false;
    if (SKIP_TYPES.has(details.resourceType)) return false;
    const method = String(details.method || 'GET').toUpperCase();
    if (!METHODS.includes(method)) return false;
    const headers = [];
    for (const [name, value] of Object.entries(requestHeaders || {})) {
      if (NOISE_HEADER.test(name)) continue;
      if (headers.length >= 30) break;
      headers.push({ name, value: SENSITIVE_HEADER.test(name) ? REDACTED : String(Array.isArray(value) ? value.join(', ') : value).slice(0, 500) });
    }
    a.seq += 1;
    a.list.push({ seq: a.seq, rid: details.id, t: now(), method, url: redactUrl(details.url), type: String(details.resourceType || '').slice(0, 24), headers, status: null, error: '' });
    if (a.list.length > max) a.list.shift();
    return true;
  }

  // Called from onCompleted / onErrorOccurred: the answer's status for a request recorded above.
  function recordDone(details) {
    if (!armed.size || !details) return false;
    const a = live(details.webContentsId);
    if (!a) return false;
    const hit = a.list.find(r => r.rid === details.id && r.status == null && !r.error);
    if (!hit) return false;
    if (details.error) hit.error = String(details.error).slice(0, 80);
    else hit.status = Number(details.statusCode) || 0;
    return true;
  }

  // Newest first. The marker, not the secret, is what a copy contains.
  function list(id) {
    const a = live(id);
    return a ? a.list.map(r => ({ ...r, headers: r.headers.map(h => ({ ...h })) })).reverse() : [];
  }

  function state(id) {
    const a = live(id);
    return a ? { armed: true, until: a.until, count: a.list.length } : { armed: false, until: 0, count: 0 };
  }

  return { arm, disarm, isArmed, recordHeaders, recordDone, list, state, REDACTED };
}

module.exports = { createRequestRecorder, SENSITIVE_HEADER, REDACTED };

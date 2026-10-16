// === GitHub read-only token vault ===========================================
//
// The owner pastes a fine-grained, READ-ONLY personal access token once. It is
// kept sealed by the operating system (Electron safeStorage, through the same
// SecretStore the AI and MCP tokens use) in ONE file in the profile folder,
// and it never leaves this module:
//
//   - it is never returned to a window: status() says only whether there is
//     one, test() and get() hand back data and numbers, never the token;
//   - it is never in localStorage, in Vex Sync, in a backup, in the egress
//     ledger (which keeps host and sizes only), or in a log or error message
//     (every message is scrubbed of it);
//   - it is sent only to https://api.github.com, built here from a path that
//     matches a short list of READ endpoints. No other host ever sees it. The
//     one redirect GitHub makes (a job's log is a pre-signed storage address)
//     is followed WITHOUT the token, and only to GitHub's own storage hosts;
//   - the only method used is GET.
//
// createGithubVault({ secretStore, file, fetch, now }) is pure over its
// arguments so it is tested against a local stand-in for api.github.com.
//   secretStore: { read(file), write(file, value), clear(file) }  (main/file-store.js SecretStore)
//   fetch:       (url, init) -> Response   (main's bounded fetch)

const API_HOST = 'api.github.com';
const API = 'https://' + API_HOST;
// Fine-grained tokens only: a classic token cannot be limited to read-only.
const TOKEN_RE = /^github_pat_[A-Za-z0-9_]{20,250}$/;
const SEG = '[A-Za-z0-9_.-]{1,100}';
// The read endpoints the developer features need. Anything else is refused,
// so a window (or a page that reached it) cannot ask for another endpoint.
const PATHS = [
  new RegExp('^/rate_limit$'),
  new RegExp('^/user$'),
  new RegExp('^/user/repos$'),
  new RegExp('^/repos/' + SEG + '/' + SEG + '$'),
  new RegExp('^/repos/' + SEG + '/' + SEG + '/actions/runs$'),
  new RegExp('^/repos/' + SEG + '/' + SEG + '/actions/runs/\\d{1,20}$'),
  new RegExp('^/repos/' + SEG + '/' + SEG + '/actions/runs/\\d{1,20}/jobs$'),
  new RegExp('^/repos/' + SEG + '/' + SEG + '/actions/jobs/\\d{1,20}/logs$'),
  new RegExp('^/repos/' + SEG + '/' + SEG + '/commits$'),
  new RegExp('^/repos/' + SEG + '/' + SEG + '/releases$'),
  new RegExp('^/repos/' + SEG + '/' + SEG + '/releases/latest$'),
  new RegExp('^/repos/' + SEG + '/' + SEG + '/contents/[A-Za-z0-9_.@/-]{1,200}$'),
];
const QUERY_KEYS = new Set(['per_page', 'page', 'branch', 'status', 'event', 'since', 'until', 'sha', 'author', 'ref', 'state', 'sort', 'direction', 'type']);
const QUERY_VALUE = /^[A-Za-z0-9_.:+,@/-]{1,100}$/;
const LOG_REDIRECT_HOST = /(^|\.)(githubusercontent\.com|blob\.core\.windows\.net)$/;
const MAX_BODY = 2 * 1024 * 1024;       // text handed back, bytes
const MAX_LOG = 12 * 1024 * 1024;       // a job log read from storage, bytes

// Builds the request address from a path, or throws why it is refused.
function apiUrl(pathAndQuery) {
  const raw = String(pathAndQuery == null ? '' : pathAndQuery);
  if (!raw.startsWith('/') || raw.startsWith('//') || /[\\\s#]/.test(raw) || raw.length > 400) throw new Error('That GitHub address is not allowed');
  const u = new URL(raw, API);
  if (u.protocol !== 'https:' || u.hostname !== API_HOST || u.username || u.password || u.port) throw new Error('Only api.github.com is reachable');
  if (u.pathname.includes('..') || u.pathname.includes('%')) throw new Error('That GitHub address is not allowed');
  if (!PATHS.some(re => re.test(u.pathname))) throw new Error('That GitHub endpoint is not one Vex reads');
  for (const [k, v] of u.searchParams) {
    if (!QUERY_KEYS.has(k) || !QUERY_VALUE.test(v)) throw new Error('That GitHub query is not allowed: ' + k);
  }
  return u.href;
}

function quotaOf(headers) {
  const n = (name) => { const v = headers.get(name); return v == null || v === '' ? null : Number(v); };
  const limit = n('x-ratelimit-limit'), remaining = n('x-ratelimit-remaining'), reset = n('x-ratelimit-reset');
  if (limit == null || remaining == null) return null;
  return { limit, remaining, used: n('x-ratelimit-used'), resetAt: reset == null ? null : reset * 1000, resource: headers.get('x-ratelimit-resource') || 'core' };
}

function createGithubVault({ secretStore, file, fetch, now = () => Date.now() } = {}) {
  if (!secretStore || typeof secretStore.read !== 'function' || typeof secretStore.write !== 'function' || typeof secretStore.clear !== 'function') throw new Error('createGithubVault needs a secret store');
  if (!file) throw new Error('createGithubVault needs a file');
  if (typeof fetch !== 'function') throw new Error('createGithubVault needs a fetch');

  let lastQuota = null;            // the newest X-RateLimit numbers seen (numbers only)
  const scrub = (text, token) => {
    let s = String(text == null ? '' : text);
    if (token) s = s.split(token).join('[token]');
    return s.replace(/github_pat_[A-Za-z0-9_]{10,}/g, '[token]').replace(/\bgh[pousr]_[A-Za-z0-9]{20,}/g, '[token]');
  };

  // The error kept as a cause must not carry the token either: its message is scrubbed in place.
  const scrubbed = (err, token) => { if (err && typeof err.message === 'string') err.message = scrub(err.message, token); return err; };

  async function readToken() {
    const rec = await secretStore.read(file, () => null);
    return rec && typeof rec.token === 'string' && rec.token ? rec.token : '';
  }

  // { has, savedAt, quota } — never the token.
  async function status() {
    const rec = await secretStore.read(file, () => null);
    const has = !!(rec && typeof rec.token === 'string' && rec.token);
    return { has, savedAt: has ? rec.savedAt || 0 : 0, quota: lastQuota };
  }

  async function set(token) {
    const t = String(token == null ? '' : token).trim();
    if (/^gh[pousr]_/.test(t)) throw new Error('That is a classic token, which cannot be limited to read-only. Create a fine-grained token with read-only access instead.');
    if (!TOKEN_RE.test(t)) throw new Error('That does not look like a fine-grained GitHub token (it starts with github_pat_)');
    await secretStore.write(file, { v: 1, token: t, savedAt: now() });
    lastQuota = null;
    return { ok: true, has: true };
  }

  async function clear() {
    await secretStore.clear(file);
    lastQuota = null;
    return { ok: true, has: false };
  }

  async function call(path, { accept, authed = true, timeoutMs = 15000 } = {}) {
    const url = apiUrl(path);
    const token = authed ? await readToken() : '';
    const headers = { Accept: accept || 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'Vex' };
    if (token) headers.Authorization = 'Bearer ' + token;
    let res;
    try { res = await fetch(url, { method: 'GET', redirect: 'manual', credentials: 'omit', headers, timeoutMs, maxBytes: MAX_BODY, egress: { feature: 'GitHub (read-only)', kind: 'fetch' } }); }
    catch (err) { scrubbed(err, token); throw new Error('GitHub could not be reached: ' + err.message, { cause: err }); }
    const quota = quotaOf(res.headers);
    if (quota) lastQuota = quota;
    return { res, quota, authed: !!token, token };
  }

  async function bodyOf(res, token, limit) {
    const buf = Buffer.from(await res.arrayBuffer());
    const capped = buf.length > limit;
    return { text: scrub((capped ? buf.subarray(buf.length - limit) : buf).toString('utf8'), token), capped };
  }

  // Test token: GET /rate_limit (it does not use up quota). -> numbers and words, never the token.
  async function test() {
    const token = await readToken();
    if (!token) throw new Error('There is no token to test');
    const { res } = await call('/rate_limit');
    if (res.status === 401) throw new Error('GitHub rejected the token (it may be revoked or expired)');
    if (res.status === 403 || res.status === 429) throw new Error('GitHub is limiting this token right now');
    if (!res.ok) throw new Error('GitHub answered ' + res.status);
    const scopes = String(res.headers.get('x-oauth-scopes') || '').split(',').map(s => s.trim()).filter(Boolean);
    const expires = res.headers.get('github-authentication-token-expiration') || '';
    const body = JSON.parse((await bodyOf(res, token, MAX_BODY)).text || '{}');
    const core = body && body.resources && body.resources.core;
    const quota = quotaOf(res.headers) || (core ? { limit: core.limit, remaining: core.remaining, used: core.used, resetAt: core.reset * 1000, resource: 'core' } : null);
    if (quota) lastQuota = quota;
    return { ok: true, kind: 'fine-grained', scopes, expires, quota, note: 'GitHub does not list a fine-grained token\'s permissions here; check them on github.com (they should all be Read-only).' };
  }

  // One read. `authed: false` asks without the token (public data, 60 an hour).
  // -> { status, ok, authed, text, capped, quota }
  async function get(path, opts = {}) {
    const wantLog = /\/actions\/jobs\/\d+\/logs$/.test(String(path).split('?')[0]);
    const { res, quota, authed, token } = await call(path, { authed: opts.authed !== false, accept: opts.accept });
    if (wantLog && res.status >= 300 && res.status < 400) {
      // The log lives at a pre-signed storage address: followed without the token, https and GitHub's own storage hosts only.
      const loc = res.headers.get('location') || '';
      let target;
      try { target = new URL(loc); } catch { throw new Error('GitHub sent the log to an address Vex could not read'); }
      if (target.protocol !== 'https:' || target.username || target.password || !LOG_REDIRECT_HOST.test(target.hostname)) throw new Error('GitHub sent the log somewhere Vex will not follow');
      let second;
      try { second = await fetch(target.href, { method: 'GET', redirect: 'error', credentials: 'omit', headers: { 'User-Agent': 'Vex' }, timeoutMs: 30000, maxBytes: MAX_LOG, egress: { feature: 'GitHub (read-only)', kind: 'fetch' } }); }
      catch (err) { scrubbed(err, token); throw new Error('The job log could not be fetched: ' + err.message, { cause: err }); }
      const out = await bodyOf(second, token, MAX_BODY);
      return { status: second.status, ok: second.ok, authed, text: out.text, capped: out.capped, quota };
    }
    if (wantLog && res.status === 0) throw new Error('The log redirect could not be read');
    const out = await bodyOf(res, token, MAX_BODY);
    return { status: res.status, ok: res.ok, authed, text: out.text, capped: out.capped, quota };
  }

  return { status, set, clear, test, get, apiUrl };
}

module.exports = { createGithubVault, apiUrl, quotaOf, API_HOST, TOKEN_RE };

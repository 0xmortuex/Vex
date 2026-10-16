// === Public feeds for the developer features ================================
//
// Three small, bounded, GET-or-query-only helpers for the main process:
//
//   latest(ecosystem, name)            the newest published version of a package
//                                      (registry.npmjs.org, pypi.org)
//   advisories(ecosystem, name, ver)   known advisories for that version (api.osv.dev)
//   ping(url)                          one GET to an endpoint the owner listed
//                                      (a Cloudflare worker, a bot), for the health board
//
// No credential is ever sent. ping() refuses an address with a user name or a
// password in it, a secret-looking query key, anything that is not https, and
// anything on this machine or the local network (the fetch it is given is the
// public-only one, which re-checks every redirect hop; the address is also
// judged here so the refusal says why).
//
// createDevFeeds({ fetch, publicFetch }) so tests can pass local stand-ins.

const { isPrivateHost } = require('../renderer/js/private-address');

const NAME_RE = /^(?:@[a-z0-9][a-z0-9._-]{0,60}\/)?[a-z0-9][a-z0-9._-]{0,100}$/i;
const SECRET_QUERY = /(?:^|[_-])(token|key|secret|password|passwd|pwd|auth|sig|signature|apikey|api_key|access_token|bearer)$/i;
const PING_MAX_BYTES = 64 * 1024;
const PING_TIMEOUT_MS = 8000;

// Judges an endpoint address. Returns the URL, or throws why not.
function checkEndpointUrl(href) {
  let u;
  try { u = new URL(String(href == null ? '' : href).trim()); } catch { throw new Error('That is not a web address'); }
  if (String(href).length > 300) throw new Error('That address is too long');
  if (u.protocol !== 'https:') throw new Error('Only https addresses can be checked');
  if (u.username || u.password) throw new Error('Do not put a user name or password in the address');
  for (const k of u.searchParams.keys()) if (SECRET_QUERY.test(k)) throw new Error('Do not put a key or token in the address (' + k + ')');
  if (u.hash && /(token|key|secret|password)=/i.test(u.hash)) throw new Error('Do not put a key or token in the address');
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (isPrivateHost(host)) throw new Error('Addresses on this machine or the local network are not checked');
  return u;
}

function createDevFeeds({ fetch, publicFetch } = {}) {
  if (typeof fetch !== 'function') throw new Error('createDevFeeds needs a fetch');
  if (typeof publicFetch !== 'function') throw new Error('createDevFeeds needs a public-only fetch');

  const egress = (feature) => ({ feature, kind: 'fetch' });

  async function latest(ecosystem, name) {
    const n = String(name == null ? '' : name);
    if (!NAME_RE.test(n)) throw new Error('That is not a package name');
    if (ecosystem === 'npm') {
      const res = await fetch('https://registry.npmjs.org/' + n.replace('/', '%2F') + '/latest', { headers: { Accept: 'application/json' }, redirect: 'error', credentials: 'omit', timeoutMs: 15000, maxBytes: 512 * 1024, egress: egress('Dependency radar'), polite: { background: true, ttlMs: 300000 } });
      if (res.status === 404) throw new Error(n + ' is not on npm');
      if (!res.ok) throw new Error('npm answered ' + res.status);
      const j = await res.json();
      if (!j || typeof j.version !== 'string') throw new Error('npm gave no version for ' + n);
      return { name: n, version: j.version };
    }
    if (ecosystem === 'pypi') {
      const res = await fetch('https://pypi.org/pypi/' + encodeURIComponent(n) + '/json', { headers: { Accept: 'application/json' }, redirect: 'error', credentials: 'omit', timeoutMs: 15000, maxBytes: 4 * 1024 * 1024, egress: egress('Dependency radar'), polite: { background: true, ttlMs: 300000 } });
      if (res.status === 404) throw new Error(n + ' is not on PyPI');
      if (!res.ok) throw new Error('PyPI answered ' + res.status);
      const j = await res.json();
      const v = j && j.info && j.info.version;
      if (typeof v !== 'string') throw new Error('PyPI gave no version for ' + n);
      return { name: n, version: v };
    }
    throw new Error('Unknown ecosystem: ' + ecosystem);
  }

  async function advisories(ecosystem, name, version) {
    const n = String(name == null ? '' : name), v = String(version == null ? '' : version);
    if (!NAME_RE.test(n)) throw new Error('That is not a package name');
    if (!/^[0-9A-Za-z.+_-]{1,60}$/.test(v)) throw new Error('That is not a version');
    const eco = ecosystem === 'npm' ? 'npm' : ecosystem === 'pypi' ? 'PyPI' : '';
    if (!eco) throw new Error('Unknown ecosystem: ' + ecosystem);
    const res = await fetch('https://api.osv.dev/v1/query', { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ version: v, package: { name: n, ecosystem: eco } }), redirect: 'error', credentials: 'omit', timeoutMs: 15000, maxBytes: 2 * 1024 * 1024, egress: egress('Dependency radar'), polite: { background: true } });
    if (!res.ok) throw new Error('The advisory database answered ' + res.status);
    const j = await res.json();
    const vulns = Array.isArray(j && j.vulns) ? j.vulns : [];
    return { name: n, version: v, count: vulns.length, items: vulns.slice(0, 5).map(x => ({ id: String(x.id || '').slice(0, 60), summary: String(x.summary || '').slice(0, 160) })) };
  }

  // One GET. The body's first part comes back so the board can read a JSON
  // field (status, version); nothing is sent but the request line.
  async function ping(href) {
    const u = checkEndpointUrl(href);
    const t0 = Date.now();
    let res;
    try { res = await publicFetch(u.href, { method: 'GET', headers: { Accept: 'application/json, text/plain;q=0.9, */*;q=0.5', 'User-Agent': 'Vex health check' }, credentials: 'omit', timeoutMs: PING_TIMEOUT_MS, maxBytes: PING_MAX_BYTES, egress: egress('Endpoint health board') }); }
    catch (err) { return { ok: false, status: 0, ms: Date.now() - t0, error: String((err && err.message) || err).slice(0, 200), text: '' }; }
    let text;
    try { text = (await res.text()).slice(0, 4000); }
    catch (err) { return { ok: false, status: res.status, ms: Date.now() - t0, error: 'The answer was too large or could not be read: ' + String((err && err.message) || err).slice(0, 120), text: '' }; }
    return { ok: res.ok, status: res.status, ms: Date.now() - t0, error: '', text };
  }

  return { latest, advisories, ping, checkEndpointUrl };
}

module.exports = { createDevFeeds, checkEndpointUrl, NAME_RE };

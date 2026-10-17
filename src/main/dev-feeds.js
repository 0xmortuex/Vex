// === Public feeds for the developer features ================================
//
// Three small, bounded, GET-or-query-only helpers for the main process:
//
//   latest(ecosystem, name)            the newest published version of a package
//                                      (registry.npmjs.org, pypi.org)
//   advisories(ecosystem, name, ver)   known advisories for that version (api.osv.dev)
//   notes(eco, name, from, to)         the GitHub release notes between two versions, BREAKING lines picked out
//                                      (only the github.com repository the registry names)
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

// ---- release notes between two versions (T1-031) -----------------------------------------------
// The release notes of a package live on its GitHub releases page. The registry says which repository that is;
// only github.com repositories are followed, so the one other host that is ever asked is api.github.com.
function githubRepoOf(url) {
  const short = /^github:([A-Za-z0-9_.-]{1,100})\/([A-Za-z0-9_.-]{1,100})(?:#.*)?$/i.exec(String(url == null ? '' : url));
  if (short) return short[1] + '/' + short[2];
  const m =/github\.com[/:]([A-Za-z0-9_.-]{1,100})\/([A-Za-z0-9_.-]{1,100}?)(?:\.git)?(?:[/#?].*)?$/i.exec(String(url == null ? '' : url));
  if (!m || m[1] === '.' || m[1] === '..' || m[2] === '.' || m[2] === '..') return '';
  return m[1] + '/' + m[2];
}

// "v1.2.3", "pkg@1.2.3", "release-1.2" -> [1, 2, 3] or null
function versionOf(tag) {
  const m = /(\d+)\.(\d+)(?:\.(\d+))?/.exec(String(tag == null ? '' : tag));
  return m ? [Number(m[1]), Number(m[2]), Number(m[3] || 0)] : null;
}
const cmpV = (a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];

// Lines of a release note that announce a breaking change. A line is one when it says BREAKING, "breaking change",
// or begins a "migration" / "removed" heading-like note.
function breakingLines(body) {
  return String(body == null ? '' : body).split(/\r?\n/)
    .filter(l => /\bBREAKING\b|breaking[ -]change|\bno longer (?:supports?|works?)\b|\bremoved support\b|\bdrops? support\b/i.test(l))
    .map(l => l.replace(/^[\s>*#-]+/, '').trim().slice(0, 240)).filter(Boolean).slice(0, 8);
}

// The releases newer than `from` and not newer than `to`, newest first, each with its breaking lines.
function selectNotes(releases, from, to, limit = 30) {
  const lo = versionOf(from), hi = versionOf(to);
  if (!lo || !hi) throw new Error('Both versions need to look like 1.2.3');
  const out = [];
  for (const r of Array.isArray(releases) ? releases : []) {
    if (!r || r.draft || r.prerelease) continue;
    const v = versionOf(r.tag_name);
    if (!v || cmpV(v, lo) <= 0 || cmpV(v, hi) > 0) continue;
    const body = String(r.body || '').slice(0, 4000);
    const lines = breakingLines(body);
    out.push({ tag: String(r.tag_name).slice(0, 80), version: v.join('.'), name: String(r.name || r.tag_name || '').slice(0, 120), url: String(r.html_url || '').slice(0, 300), body, breaking: lines.length > 0, breakingLines: lines });
  }
  return out.sort((a, b) => cmpV(versionOf(b.version), versionOf(a.version))).slice(0, limit);
}

function createDevFeeds({ fetch, publicFetch, github } = {}) {
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

  // The repository a package says it lives in -> 'owner/repo' on github.com, or throws why not.
  async function repoOf(ecosystem, n) {
    if (ecosystem === 'npm') {
      const res = await fetch('https://registry.npmjs.org/' + n.replace('/', '%2F') + '/latest', { headers: { Accept: 'application/json' }, redirect: 'error', credentials: 'omit', timeoutMs: 15000, maxBytes: 512 * 1024, egress: egress('Dependency radar'), polite: { background: true, ttlMs: 300000 } });
      if (!res.ok) throw new Error('npm answered ' + res.status);
      const j = await res.json();
      const r = j && j.repository;
      return githubRepoOf(typeof r === 'string' ? r : r && r.url);
    }
    if (ecosystem === 'pypi') {
      const res = await fetch('https://pypi.org/pypi/' + encodeURIComponent(n) + '/json', { headers: { Accept: 'application/json' }, redirect: 'error', credentials: 'omit', timeoutMs: 15000, maxBytes: 4 * 1024 * 1024, egress: egress('Dependency radar'), polite: { background: true, ttlMs: 300000 } });
      if (!res.ok) throw new Error('PyPI answered ' + res.status);
      const urls = (await res.json() || {}).info || {};
      for (const u of [...Object.values(urls.project_urls || {}), urls.home_page]) { const r = githubRepoOf(u); if (r) return r; }
      return '';
    }
    throw new Error('Unknown ecosystem: ' + ecosystem);
  }

  // Release notes between `from` (exclusive) and `to` (inclusive). -> { name, repo, releases: [...], note }
  async function notes(ecosystem, name, from, to) {
    const n = String(name == null ? '' : name);
    if (!NAME_RE.test(n)) throw new Error('That is not a package name');
    for (const v of [from, to]) if (!/^[0-9A-Za-z.+_-]{1,60}$/.test(String(v))) throw new Error('That is not a version');
    const repo = await repoOf(ecosystem, n);
    if (!repo) return { name: n, repo: '', releases: [], note: n + ' does not name a public GitHub repository, so there are no release notes to read' };
    const path = '/repos/' + repo + '/releases?per_page=100';
    let list;
    if (typeof github === 'function') {
      const r = await github(path);
      if (r.status === 404) return { name: n, repo, releases: [], note: repo + ' has no public releases page' };
      if (!r.ok) throw new Error('GitHub answered ' + r.status + ' for the releases of ' + repo);
      list = JSON.parse(r.text);
    } else {
      const res = await fetch('https://api.github.com' + path, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Vex' }, redirect: 'error', credentials: 'omit', timeoutMs: 15000, maxBytes: 2 * 1024 * 1024, egress: egress('Dependency radar'), polite: { background: true, ttlMs: 300000 } });
      if (res.status === 404) return { name: n, repo, releases: [], note: repo + ' has no public releases page' };
      if (!res.ok) throw new Error('GitHub answered ' + res.status + ' for the releases of ' + repo);
      list = await res.json();
    }
    const releases = selectNotes(list, from, to);
    return { name: n, repo, releases, note: releases.length ? '' : 'No release notes were published between ' + from + ' and ' + to + ' (the project may only tag versions)' };
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

  return { latest, advisories, ping, notes, checkEndpointUrl };
}

module.exports = { createDevFeeds, checkEndpointUrl, NAME_RE, githubRepoOf, versionOf, breakingLines, selectNotes };

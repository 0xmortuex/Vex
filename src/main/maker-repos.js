// === More from the creator: the maker's public repositories (refresh only when asked) =========
//
// The list in the window ("More from the creator", js/maker-repos.js) is a snapshot that ships with Vex
// (js/maker-repos-data.js, written by scripts/update-maker-repos.js). Nothing is contacted until the person
// presses "Refresh from GitHub"; then this module asks the public GitHub API for the creator's repositories:
//
//   https://api.github.com/users/0xmortuex/repos?per_page=100   (up to three pages)
//
// One fixed address, GET only, https only, a public-only fetch (every hop checked), no cookies, no token, a size
// cap, nothing about the person in the request. The answer is reduced to a few plain fields by normalizeRepos(),
// which also DROPS every repository that is not public (private:true, or no private:false at all), so a private
// repository can never reach the screen or the file, whatever the API returns. The refreshed copy is kept in the
// profile folder (maker-repos.json) with its date.
//
// scripts/update-maker-repos.js uses the same normalizeRepos(), so the shipped snapshot and a refresh agree.

const LOGIN = '0xmortuex';
const PAGE_SIZE = 100;
const MAX_PAGES = 3;
const MAX_BYTES = 1024 * 1024;
const TIMEOUT_MS = 15000;
const FILE = 'maker-repos.json';

const clip = (v, n) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, n);
const count = (v) => (Number.isSafeInteger(v) && v >= 0 ? v : 0);
const isoOrEmpty = (v) => (typeof v === 'string' && !Number.isNaN(Date.parse(v)) ? new Date(v).toISOString() : '');

// The API's list -> { repos, dropped }. `dropped` is how many were left out because they were not public.
// A payload that is not a list throws; an entry without a name or a github.com address is dropped too.
function normalizeRepos(list, login = LOGIN) {
  if (!Array.isArray(list)) throw new Error('GitHub did not answer with a list of repositories');
  const repos = [];
  let dropped = 0;
  for (const r of list) {
    if (!r || typeof r !== 'object' || r.private !== false || r.visibility === 'private' || r.visibility === 'internal') { dropped++; continue; }
    const name = clip(r.name, 100);
    const owner = r.owner && typeof r.owner.login === 'string' ? r.owner.login : login;
    const url = 'https://github.com/' + owner + '/' + name;
    if (!/^[A-Za-z0-9._-]+$/.test(name) || owner.toLowerCase() !== login.toLowerCase()) { dropped++; continue; }
    let homepage = '';
    try { const h = new URL(String(r.homepage || '')); if (h.protocol === 'https:' || h.protocol === 'http:') homepage = h.href; } catch { /* vex-allow-empty-catch: no homepage, or not a web address, is simply none */ }
    repos.push({
      name,
      description: clip(r.description, 300),
      language: clip(r.language, 40) || null,
      stars: count(r.stargazers_count),
      forks: count(r.forks_count),
      topics: (Array.isArray(r.topics) ? r.topics : []).map(t => clip(t, 50)).filter(Boolean).slice(0, 20),
      license: r.license && typeof r.license.spdx_id === 'string' && r.license.spdx_id !== 'NOASSERTION' ? clip(r.license.spdx_id, 40) : null,
      updatedAt: isoOrEmpty(r.updated_at),
      pushedAt: isoOrEmpty(r.pushed_at),
      archived: r.archived === true,
      fork: r.fork === true,
      homepage,
      url,
    });
  }
  repos.sort((a, b) => b.stars - a.stars || a.name.localeCompare(b.name));
  return { repos, dropped };
}

// The words for a refused answer. GitHub says when the rate limit resets in x-ratelimit-reset (seconds since 1970).
function refusal(res, now) {
  const h = (k) => (res.headers && typeof res.headers.get === 'function' ? res.headers.get(k) : null);
  if ((res.status === 403 || res.status === 429) && (h('x-ratelimit-remaining') === '0' || h('retry-after'))) {
    const reset = Number(h('x-ratelimit-reset')) * 1000;
    const wait = Number(h('retry-after')) * 1000;
    const at = Number.isFinite(reset) && reset > 0 ? reset : (Number.isFinite(wait) && wait > 0 ? now() + wait : 0);
    if (!at) return new Error('GitHub\'s limit for requests without a sign-in is used up. Try again later.');
    return new Error('GitHub\'s limit for requests without a sign-in is used up. It resets at ' + new Date(at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) + ' (in about ' + Math.max(1, Math.ceil((at - now()) / 60000)) + ' minutes). Try again then.');
  }
  return new Error('GitHub answered ' + res.status);
}

function createMakerRepos({ publicFetch, dir, fs, path, now = () => Date.now(), userAgent = 'Vex' } = {}) {
  if (typeof publicFetch !== 'function') throw new Error('createMakerRepos needs a public-only fetch');
  if (!dir || !fs || !path) throw new Error('createMakerRepos needs a folder to keep the refreshed list in');
  const file = path.join(dir, FILE);

  async function refresh() {
    let all = [];
    let dropped = 0;
    for (let page = 1; page <= MAX_PAGES; page++) {
      const href = 'https://api.github.com/users/' + LOGIN + '/repos?per_page=' + PAGE_SIZE + '&page=' + page;
      const res = await publicFetch(href, {
        method: 'GET', headers: { Accept: 'application/vnd.github+json', 'User-Agent': userAgent }, credentials: 'omit', redirect: 'error',
        timeoutMs: TIMEOUT_MS, maxBytes: MAX_BYTES, egress: { feature: 'More from the creator', kind: 'fetch' },
      });
      if (!res.ok) throw refusal(res, now);
      const part = normalizeRepos(await res.json());
      all = all.concat(part.repos);
      dropped += part.dropped;
      // A short page is the last one; the list can be sliced into more than three pages only for 300+ repositories.
      if (part.repos.length + part.dropped < PAGE_SIZE) break;
    }
    all.sort((a, b) => b.stars - a.stars || a.name.localeCompare(b.name));
    const out = { login: LOGIN, fetchedAt: new Date(now()).toISOString(), repos: all };
    await fs.promises.mkdir(dir, { recursive: true });
    const tmp = file + '.tmp';
    await fs.promises.writeFile(tmp, JSON.stringify(out), 'utf8');
    await fs.promises.rename(tmp, file);
    return { ...out, dropped };
  }

  // The refreshed copy kept from an earlier press, or null when there is none. A damaged file throws.
  async function stored() {
    let text;
    try { text = await fs.promises.readFile(file, 'utf8'); } catch (err) { if (err && err.code === 'ENOENT') return null; throw err; }
    const data = JSON.parse(text);
    if (!data || data.login !== LOGIN || !Array.isArray(data.repos) || typeof data.fetchedAt !== 'string') throw new Error('The refreshed list on disk is not one Vex wrote');
    // Read back through the same field clean-up (the file only ever holds entries refresh() already judged public).
    const raw = data.repos.map(r => ({ ...r, private: false, stargazers_count: r.stars, forks_count: r.forks, updated_at: r.updatedAt, pushed_at: r.pushedAt, owner: { login: LOGIN }, license: r.license ? { spdx_id: r.license } : null }));
    return { login: LOGIN, fetchedAt: data.fetchedAt, repos: normalizeRepos(raw).repos };
  }

  return { refresh, stored };
}

function registerMakerRepos({ ipcMain, dir, fs, path, publicFetch, userAgent }) {
  const svc = createMakerRepos({ publicFetch, dir, fs, path, userAgent });
  ipcMain.handle('makerepos:refresh', () => svc.refresh());
  ipcMain.handle('makerepos:stored', () => svc.stored());
  return svc;
}

module.exports = { createMakerRepos, registerMakerRepos, normalizeRepos, LOGIN, MAX_PAGES, PAGE_SIZE };

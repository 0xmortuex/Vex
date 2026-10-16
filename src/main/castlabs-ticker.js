// === Electron / castLabs compatibility ticker ================================
//
// Vex pins one castLabs Electron build (the one with Widevine and VMP signing).
// A security release, or a VMP-signing rebuild, is easy to miss. This asks the
// public tag list of castlabs/electron-releases and says how many releases the
// pinned version is behind.
//
// One GET to api.github.com, no credentials, bounded by the fetch it is given
// (main's bounded fetch, which feeds the egress ledger), cached for six hours.
// A failure is raised, never turned into "0 behind".
//
// createCastlabsTicker({ fetch, versions, now }) so tests pass local stand-ins.

const TAGS_URL = 'https://api.github.com/repos/castlabs/electron-releases/tags?per_page=100';
const TTL_MS = 6 * 3600 * 1000;
// v42.11.0+wvcus  (the suffix names the Widevine/VMP build line)
const TAG_RE = /^v(\d{1,3})\.(\d{1,3})\.(\d{1,3})\+(wvcus)$/;

const cmp = (a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
const text = (v) => v.join('.');

function parseTags(list) {
  if (!Array.isArray(list)) throw new Error('The castLabs release list was not in the expected form');
  const out = [];
  for (const t of list) {
    const m = t && typeof t.name === 'string' ? TAG_RE.exec(t.name) : null;
    if (m) out.push([Number(m[1]), Number(m[2]), Number(m[3])]);
  }
  return out;
}

// { pinned, latest, behind, newerMajor, latestMajor }
//   behind      releases newer than the pinned one on the SAME major (what a rebuild can take today)
//   newerMajor  distinct newer majors that exist
function compare(pinnedText, tags) {
  const m = /^(\d+)\.(\d+)\.(\d+)/.exec(String(pinnedText));
  if (!m) throw new Error('This build does not report an Electron version');
  const pinned = [Number(m[1]), Number(m[2]), Number(m[3])];
  const seen = new Set();
  const unique = tags.filter(t => !seen.has(text(t)) && seen.add(text(t)));
  if (!unique.length) throw new Error('No castLabs releases were listed');
  const newer = unique.filter(t => cmp(t, pinned) > 0);
  const sameMajor = newer.filter(t => t[0] === pinned[0]);
  const majors = new Set(newer.filter(t => t[0] > pinned[0]).map(t => t[0]));
  const latest = unique.slice().sort(cmp).pop();
  const latestSame = sameMajor.slice().sort(cmp).pop() || pinned;
  return {
    pinned: text(pinned), latest: text(latest), latestSameMajor: text(latestSame),
    behind: sameMajor.length, newerMajor: majors.size,
    pinnedListed: unique.some(t => cmp(t, pinned) === 0),
  };
}

function createCastlabsTicker({ fetch, versions = process.versions, now = () => Date.now() } = {}) {
  if (typeof fetch !== 'function') throw new Error('createCastlabsTicker needs a fetch');
  let cache = null;

  async function check({ force = false } = {}) {
    if (!force && cache && now() - cache.checkedAt < TTL_MS) return cache;
    const res = await fetch(TAGS_URL, {
      method: 'GET', redirect: 'error', credentials: 'omit', timeoutMs: 15000, maxBytes: 512 * 1024,
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Vex' },
      egress: { feature: 'Electron ticker', kind: 'fetch' },
    });
    if (res.status === 403 || res.status === 429) throw new Error('GitHub is limiting requests right now; try again later');
    if (!res.ok) throw new Error('GitHub answered ' + res.status + ' for the castLabs release list');
    let list;
    try { list = JSON.parse(Buffer.from(await res.arrayBuffer()).toString('utf8')); } catch (err) { throw new Error('The castLabs release list could not be read', { cause: err }); }
    const result = compare(versions.electron, parseTags(list));
    cache = { ...result, chrome: String(versions.chrome || ''), checkedAt: now() };
    return cache;
  }
  return { check };
}

module.exports = { createCastlabsTicker, compare, parseTags, TAGS_URL, TTL_MS };

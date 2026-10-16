// === Package page intelligence ===============================================
//
// On a package's own page (npmjs.com, pypi.org, crates.io) a small card says what
// the page does not: when it was last released, whether it is deprecated, its
// licence, how many people fetch it, whether a public advisory exists for the
// latest version, and a one-line safety verdict with the reasons.
//
// Public, key-less, read-only APIs of the registries themselves, called from here
// (never from the page) through the bounded public fetch, which refuses non-public
// addresses and feeds the egress ledger. One short request per fact, small caps,
// a 6-hour memory cache. Nothing about the person is sent: only the package name.
//
// The verdict is a HEURISTIC, written as such: it can miss a malicious package and
// it can flag a harmless old one. winget has no stable public API of this kind and
// is not covered. crates.io has no advisory API (RustSec is a git repository), so
// "advisories" is reported as not checked there rather than as none.

const NPM_NAME = /^(?:@[a-z0-9][a-z0-9._-]{0,213}\/)?[a-z0-9][a-z0-9._~-]{0,213}$/;
const PYPI_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
const CRATE_NAME = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
const DAY = 24 * 3600 * 1000;
const CACHE_MS = 6 * 3600 * 1000;

// Which package a page address is about, or null.
function parsePackagePage(rawUrl) {
  let u;
  try { u = new URL(String(rawUrl)); } catch { return null; }
  if (u.protocol !== 'https:') return null;
  const host = u.hostname.replace(/^www\./, '');
  const seg = u.pathname.split('/').filter(Boolean).map(s => { try { return decodeURIComponent(s); } catch { return s; } });
  let eco = null, name = null;
  if (host === 'npmjs.com' && seg[0] === 'package' && seg[1]) {
    eco = 'npm'; name = seg[1].startsWith('@') && seg[2] ? seg[1] + '/' + seg[2] : seg[1];
  } else if (host === 'pypi.org' && seg[0] === 'project' && seg[1]) {
    eco = 'pypi'; name = seg[1];
  } else if (host === 'crates.io' && seg[0] === 'crates' && seg[1]) {
    eco = 'crates'; name = seg[1];
  }
  if (!eco || !validName(eco, name)) return null;
  return { eco, name };
}
function validName(eco, name) {
  const rx = eco === 'npm' ? NPM_NAME : eco === 'pypi' ? PYPI_NAME : eco === 'crates' ? CRATE_NAME : null;
  return !!rx && typeof name === 'string' && rx.test(name);
}

const addCommand = (eco, name) => eco === 'npm' ? 'pnpm add ' + name : eco === 'pypi' ? 'uv add ' + name : 'cargo add ' + name;

function ageDays(iso, now) {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? Math.max(0, Math.floor((now - t) / DAY)) : null;
}

// → { level: 'ok'|'caution'|'warning', reasons: [...] }
function judge(info) {
  const reasons = [];
  let level = 'ok';
  const rank = { ok: 0, caution: 1, warning: 2 };
  const raise = (to, why) => { reasons.push(why); if (rank[to] > rank[level]) level = to; };
  if (info.deprecated) raise('warning', 'marked deprecated' + (typeof info.deprecated === 'string' ? ': ' + info.deprecated.slice(0, 120) : ''));
  if (info.yanked) raise('warning', 'the latest version was yanked');
  const worst = (info.advisories || []).find(a => /high|critical/i.test(a.severity));
  if (worst) raise('warning', 'a ' + worst.severity + ' advisory covers the latest version');
  else if ((info.advisories || []).length) raise('caution', info.advisories.length + ' public advisor' + (info.advisories.length === 1 ? 'y' : 'ies') + ' mention the latest version');
  if (info.ageDays != null && info.ageDays > 730) raise('caution', 'no release for ' + Math.floor(info.ageDays / 365) + ' years');
  if (!info.license) raise('caution', 'no licence is declared');
  if (info.firstPublishDays != null && info.firstPublishDays < 30 && info.downloadsWeek != null && info.downloadsWeek < 200) raise('caution', 'new and little used (a name worth double-checking for a look-alike)');
  if (!reasons.length) reasons.push('nothing above looked wrong (this is a quick check, not an audit)');
  return { level, reasons };
}

function createPkgIntel({ getJson, postJson, now = () => Date.now() }) {
  const cache = new Map();

  async function npm(name) {
    const enc = name.replace('/', '%2f');
    const latest = await getJson('https://registry.npmjs.org/' + enc + '/latest');
    const version = String(latest.version || '');
    const out = {
      version, license: typeof latest.license === 'string' ? latest.license : (latest.license && latest.license.type) || '',
      deprecated: latest.deprecated ? String(latest.deprecated) : null, description: String(latest.description || '').slice(0, 200),
      lastPublish: null, firstPublishDays: null, downloadsWeek: null, advisories: null, advisoriesChecked: false, notes: [],
    };
    try {
      const search = await getJson('https://registry.npmjs.org/-/v1/search?text=' + encodeURIComponent(name) + '&size=5');
      const hit = (search.objects || []).map(o => o.package).find(p => p && p.name === name);
      if (hit && hit.date) out.lastPublish = String(hit.date);
      else out.notes.push('the last release date was not found');
    } catch (err) { out.notes.push('last release date: ' + err.message); }
    try {
      const dl = await getJson('https://api.npmjs.org/downloads/point/last-week/' + enc);
      if (Number.isFinite(dl.downloads)) out.downloadsWeek = dl.downloads;
    } catch (err) { out.notes.push('downloads: ' + err.message); }
    try {
      const adv = await postJson('https://registry.npmjs.org/-/npm/v1/security/advisories/bulk', { [name]: [version] });
      out.advisories = (adv[name] || []).slice(0, 10).map(a => ({ id: String(a.id), title: String(a.title || '').slice(0, 140), severity: String(a.severity || ''), url: String(a.url || '') }));
      out.advisoriesChecked = true;
    } catch (err) { out.notes.push('advisories: ' + err.message); }
    return out;
  }

  async function pypi(name) {
    const j = await getJson('https://pypi.org/pypi/' + encodeURIComponent(name) + '/json');
    const info = j.info || {};
    const files = Array.isArray(j.urls) ? j.urls : [];
    const upload = files.map(f => f.upload_time_iso_8601).filter(Boolean).sort().pop() || null;
    const lic = String(info.license_expression || info.license || '').split('\n')[0].slice(0, 80)
      || ((info.classifiers || []).find(c => c.startsWith('License ::')) || '').split('::').pop().trim();
    const inactive = (info.classifiers || []).some(c => /Development Status :: 7 - Inactive/.test(c));
    return {
      version: String(info.version || ''), license: lic, deprecated: inactive ? 'its classifiers say it is inactive' : null,
      yanked: !!info.yanked || (files.length > 0 && files.every(f => f.yanked)), description: String(info.summary || '').slice(0, 200),
      lastPublish: upload, firstPublishDays: null, downloadsWeek: null,
      advisories: (j.vulnerabilities || []).slice(0, 10).map(v => ({ id: String(v.id || (v.aliases || [])[0] || ''), title: String(v.summary || v.details || '').slice(0, 140), severity: '', url: String(v.link || '') })),
      advisoriesChecked: true, notes: ['download counts are not offered by PyPI itself'],
    };
  }

  async function crates(name) {
    const j = await getJson('https://crates.io/api/v1/crates/' + encodeURIComponent(name));
    const c = j.crate || {};
    const versions = Array.isArray(j.versions) ? j.versions : [];
    const latest = versions.find(v => v.num === c.max_stable_version || v.num === c.max_version) || versions[0] || {};
    return {
      version: String(latest.num || c.max_version || ''), license: String(latest.license || ''), deprecated: null, yanked: !!latest.yanked,
      description: String(c.description || '').slice(0, 200), lastPublish: latest.created_at || c.updated_at || null,
      firstPublishDays: ageDays(c.created_at, now()), downloadsWeek: Number.isFinite(c.recent_downloads) ? Math.round(c.recent_downloads / 13) : null,
      advisories: null, advisoriesChecked: false, notes: ['downloads are the 90-day figure divided by 13', 'security advisories (RustSec) are not checked here'],
    };
  }

  async function lookup(eco, name) {
    if (!validName(eco, name)) throw new Error('That is not a package name Vex can look up');
    const key = eco + ':' + name;
    const hit = cache.get(key);
    if (hit && now() - hit.at < CACHE_MS) return hit.value;
    const raw = await (eco === 'npm' ? npm(name) : eco === 'pypi' ? pypi(name) : crates(name));
    const value = {
      eco, name, version: raw.version, license: raw.license, deprecated: raw.deprecated, yanked: !!raw.yanked, description: raw.description,
      lastPublish: raw.lastPublish, ageDays: raw.lastPublish ? ageDays(raw.lastPublish, now()) : null,
      downloadsWeek: raw.downloadsWeek, advisories: raw.advisories, advisoriesChecked: raw.advisoriesChecked, notes: raw.notes,
      addCommand: addCommand(eco, name), firstPublishDays: raw.firstPublishDays,
    };
    value.safety = judge(value);
    cache.set(key, { at: now(), value });
    if (cache.size > 100) cache.delete(cache.keys().next().value);
    return value;
  }

  return { lookup };
}

module.exports = { createPkgIntel, parsePackagePage, validName, judge, addCommand };

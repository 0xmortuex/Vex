// === The wallpaper catalogue that ships inside Vex ================================
//
// Three files in src/main/data/ (inside the app, packaged with it: build.files has src/**/*):
//
//   wallpaper-catalogue.json             { schema: 1, name, updated, entries: [...] }   the pictures (checked entry by entry, see wallpaper-catalogue.js)
//   wallpaper-catalogue-categories.json  [{ id, title, blurb }]                         the chips in the store
//   wallpaper-catalogue-hosts.json       ["upload.wikimedia.org", ...]                  the ONLY hosts a picture may be fetched from
//
// No picture is bundled: the list names where each one lives, and a picture is downloaded
// only when someone looks at its card (a small preview) or picks it (the full picture).
// A file that does not exist means "nothing built in": an empty list, never made-up data.
// A file that exists but is damaged is an error that is thrown (and shown), never half used.
// An entry whose preview or picture is not on a listed host is dropped with a reason.

const { validateCatalogue, httpsUrl } = require('./wallpaper-catalogue');

const FILES = Object.freeze({ catalogue: 'wallpaper-catalogue.json', categories: 'wallpaper-catalogue-categories.json', hosts: 'wallpaper-catalogue-hosts.json' });
const CATEGORY_ID_RE = /^[a-z][a-z0-9-]{0,29}$/;
const HOST_RE = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

// One of the three files -> parsed JSON, or null when it does not exist.
function readJson(fs, path, dir, key) {
  const file = path.join(dir, FILES[key]);
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch (e) { if (e.code === 'ENOENT') return null; throw e; }
  try { return JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text); }
  catch (e) { throw new Error('The built-in wallpaper file ' + FILES[key] + ' is not valid JSON: ' + e.message, { cause: e }); }
}

// ["a.example", ...] or { hosts: [...] } -> { hosts: [lowercase names], problems }
function checkHosts(doc) {
  const raw = Array.isArray(doc) ? doc : (doc && Array.isArray(doc.hosts) ? doc.hosts : null);
  if (!raw) throw new Error('The built-in wallpaper host list must be a list of host names');
  const hosts = [], problems = [];
  for (const h of raw) {
    const name = typeof h === 'string' ? h.trim().toLowerCase() : '';
    if (!HOST_RE.test(name)) { problems.push('host ' + JSON.stringify(h) + ' is not a plain host name'); continue; }
    if (!hosts.includes(name)) hosts.push(name);
  }
  return { hosts, problems };
}

function checkCategories(doc) {
  const raw = Array.isArray(doc) ? doc : (doc && Array.isArray(doc.categories) ? doc.categories : null);
  if (!raw) throw new Error('The built-in wallpaper categories must be a list');
  const categories = [], problems = [], seen = new Set();
  raw.forEach((c, i) => {
    const label = 'category ' + (c && typeof c.id === 'string' ? '"' + c.id + '"' : 'number ' + (i + 1));
    if (!c || typeof c !== 'object' || typeof c.id !== 'string' || !CATEGORY_ID_RE.test(c.id)) { problems.push(label + ' needs an "id" of lowercase letters, digits and dashes'); return; }
    if (typeof c.title !== 'string' || !c.title.trim() || c.title.trim().length > 60) { problems.push(label + ' needs a "title" (up to 60 characters)'); return; }
    if (seen.has(c.id)) { problems.push(label + ' repeats an id'); return; }
    seen.add(c.id);
    categories.push({ id: c.id, title: c.title.trim(), blurb: typeof c.blurb === 'string' ? c.blurb.trim().slice(0, 200) : '' });
  });
  return { categories, problems };
}

// Is this address one a picture may be fetched from? https, no login in it, the usual port, a listed host.
function hostAllowed(href, hosts) {
  if (!httpsUrl(href)) return false;
  const u = new URL(href);
  if (u.port && u.port !== '443') return false;
  return Array.isArray(hosts) && hosts.includes(u.hostname.toLowerCase());
}

// -> { name, updated, entries, categories, hosts, problems, present: { catalogue, categories, hosts } }
function loadBuiltin({ fs, path, dir }) {
  if (!fs || !path || !dir) throw new Error('loadBuiltin needs fs, path and the data folder');
  const catDoc = readJson(fs, path, dir, 'categories');
  const hostDoc = readJson(fs, path, dir, 'hosts');
  const docDoc = readJson(fs, path, dir, 'catalogue');
  const problems = [];
  const h = hostDoc === null ? { hosts: [], problems: [] } : checkHosts(hostDoc);
  const c = catDoc === null ? { categories: [], problems: [] } : checkCategories(catDoc);
  problems.push(...h.problems, ...c.problems);
  const entries = [];
  let name = '', updated = '';
  if (docDoc !== null) {
    const v = validateCatalogue(docDoc);
    name = v.name; updated = v.updated;
    problems.push(...v.problems);
    for (const e of v.entries) {
      if (!hostAllowed(e.thumbUrl, h.hosts)) { problems.push('entry "' + e.id + '" has a preview on a host that is not on the built-in host list'); continue; }
      if (!hostAllowed(e.fullUrl, h.hosts)) { problems.push('entry "' + e.id + '" has a picture on a host that is not on the built-in host list'); continue; }
      entries.push(e);
    }
  }
  return { name, updated, entries, categories: c.categories, hosts: h.hosts, problems, present: { catalogue: docDoc !== null, categories: catDoc !== null, hosts: hostDoc !== null } };
}

module.exports = { loadBuiltin, hostAllowed, checkHosts, checkCategories, FILES };

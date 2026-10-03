// === Bringing bookmarks, history and passwords over from another browser ===
//
// Chrome, Edge, Brave (all Chromium) and Firefox keep bookmarks and history in
// plain files in each profile folder: Chromium a "Bookmarks" JSON file and a
// "History" SQLite database, Firefox one "places.sqlite". They are read here,
// in the main process, and only what they hold (addresses, titles, folders,
// times) is handed to the window, which adds it to Vex's own lists.
//
// What this deliberately does NOT do:
//
//  - Read another browser's saved passwords or cookies. Those stores are
//    encrypted for that browser alone, and prying them open is what malware
//    does. Passwords come over only as a CSV file the person exports from that
//    browser's own password manager themselves (importPasswordCsv below).
//  - Take a path from the window. The window names a browser and a profile id
//    from the list this file made; the folder is worked out again here, so a
//    message can never point the reader at some other file on the disk.
//  - Open the browser's own database. A running browser holds it open, so the
//    files are copied to a temp folder first and the copy is what is read, then
//    removed.
const fs = require('fs');
const os = require('os');
const path = require('path');

const CHROMIUM = {
  chrome: { name: 'Chrome', dir: ['Google', 'Chrome', 'User Data'] },
  edge: { name: 'Edge', dir: ['Microsoft', 'Edge', 'User Data'] },
  brave: { name: 'Brave', dir: ['BraveSoftware', 'Brave-Browser', 'User Data'] },
};
const BROWSERS = ['chrome', 'edge', 'brave', 'firefox'];
const NAMES = { chrome: 'Chrome', edge: 'Edge', brave: 'Brave', firefox: 'Firefox' };

// Vex keeps the latest 5,000 visits (js/history-panel.js MAX_ENTRIES); reading
// more than that from a browser with years of history would only be thrown away.
const HISTORY_LIMIT = 5000;
const CSV_MAX_BYTES = 20 * 1024 * 1024;

const isWeb = (u) => typeof u === 'string' && /^https?:\/\//i.test(u) && u.length <= 8192;
// The same test in SQL (LIKE ignores ASCII case, as isWeb does), so the total
// shown as "the latest N of M" counts only rows that can be brought over, and
// file://, javascript:, chrome:// rows do not eat into the limit either.
const WEB_SQL = "(url LIKE 'http://%' OR url LIKE 'https://%') AND length(url) <= 8192";
const clip = (s, n = 500) => (typeof s === 'string' ? s : '').slice(0, n);
// Chromium counts microseconds from 1601-01-01; Firefox from 1970.
// A Chromium time in microseconds is past what a JS number holds exactly, so
// SQL divides it down to milliseconds before node:sqlite hands it over.
const fromWebkit = (us) => { const n = Number(us); return n > 0 ? Math.round(n / 1000 - 11644473600000) : 0; };
const fromWebkitMs = (ms) => { const n = Number(ms); return n > 0 ? n - 11644473600000 : 0; };
const fromPrTimeMs = (ms) => { const n = Number(ms); return n > 0 ? n : 0; };
const iso = (ms) => (ms > 0 && Number.isFinite(ms) ? new Date(ms).toISOString() : null);

function chromiumRoot(browser, env) {
  return env.LOCALAPPDATA ? path.join(env.LOCALAPPDATA, ...CHROMIUM[browser].dir) : null;
}
function firefoxRoot(env) {
  return env.APPDATA ? path.join(env.APPDATA, 'Mozilla', 'Firefox') : null;
}

// Windows tools often start a text file with a byte-order mark.
const stripBom = (s) => (s.charCodeAt(0) === 0xFEFF ? s.slice(1) : s);
function readJson(file) {
  return JSON.parse(stripBom(fs.readFileSync(file, 'utf8')));
}

// A Chromium profile is a folder ("Default", "Profile 1", …) that holds a
// Bookmarks or History file; its display name is in "Local State".
function chromiumProfiles(browser, env) {
  const root = chromiumRoot(browser, env);
  if (!root || !fs.existsSync(root)) return [];
  let names;
  try { names = readJson(path.join(root, 'Local State'))?.profile?.info_cache || {}; }
  catch { names = {}; }   // no Local State: the folder names will do
  const out = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || !/^(Default|Profile \d+)$/.test(entry.name)) continue;
    const dir = path.join(root, entry.name);
    if (!['Bookmarks', 'History'].some(f => fs.existsSync(path.join(dir, f)))) continue;
    const shown = names[entry.name] && typeof names[entry.name].name === 'string' ? names[entry.name].name : entry.name;
    out.push({ id: entry.name, name: shown, dir });
  }
  out.sort((a, b) => (a.id === 'Default' ? -1 : b.id === 'Default' ? 1 : a.id.localeCompare(b.id, undefined, { numeric: true })));
  return out;
}

// profiles.ini: one [ProfileN] section per profile, Path relative to the
// Firefox folder when IsRelative=1.
function parseProfilesIni(text) {
  const sections = [];
  let cur = null;
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith(';') || line.startsWith('#')) continue;
    const head = /^\[(.+)\]$/.exec(line);
    if (head) { cur = { section: head[1] }; sections.push(cur); continue; }
    const eq = line.indexOf('=');
    if (cur && eq > 0) cur[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
  }
  return sections.filter(s => /^Profile\d+$/.test(s.section) && s.Path);
}
function firefoxProfiles(env) {
  const root = firefoxRoot(env);
  const ini = root && path.join(root, 'profiles.ini');
  if (!ini || !fs.existsSync(ini)) return [];
  const out = [];
  for (const s of parseProfilesIni(fs.readFileSync(ini, 'utf8'))) {
    const dir = s.IsRelative === '0' ? s.Path : path.join(root, ...s.Path.split(/[\\/]/));
    if (!fs.existsSync(path.join(dir, 'places.sqlite'))) continue;
    out.push({ id: s.Path, name: s.Name || path.basename(dir), dir, isDefault: s.Default === '1' });
  }
  out.sort((a, b) => Number(b.isDefault) - Number(a.isDefault));
  return out.map(({ isDefault: _d, ...p }) => p);
}

function profilesOf(browser, env) {
  if (browser === 'firefox') return firefoxProfiles(env);
  if (CHROMIUM[browser]) return chromiumProfiles(browser, env);
  throw new Error('Unknown browser: ' + browser);
}

// Every browser on this PC with at least one profile that has something to
// bring over. Folder paths stay here; the window sees ids and names.
function listSources(env = process.env) {
  const out = [];
  for (const id of BROWSERS) {
    const profiles = profilesOf(id, env);
    if (profiles.length) out.push({ id, name: NAMES[id], profiles: profiles.map(p => ({ id: p.id, name: p.name })) });
  }
  return out;
}

function resolveProfile(browser, profileId, env) {
  if (!BROWSERS.includes(browser)) throw new Error('Unknown browser: ' + browser);
  const found = profilesOf(browser, env).find(p => p.id === profileId);
  if (!found) throw new Error(`That ${NAMES[browser]} profile is no longer on this PC`);
  return found;
}

// Copy a database (and its write-ahead log, which holds the newest changes)
// into `tmp` and open the copy.
function openCopy(file, tmp, browserName) {
  const { DatabaseSync } = require('node:sqlite');
  const dest = path.join(tmp, path.basename(file));
  try {
    fs.copyFileSync(file, dest);
    if (fs.existsSync(file + '-wal')) fs.copyFileSync(file + '-wal', dest + '-wal');
  } catch (err) {
    if (['EBUSY', 'EPERM', 'EACCES'].includes(err.code)) {
      throw new Error(`${browserName} is holding its ${path.basename(file)} file shut — close ${browserName} and try again`, { cause: err });
    }
    throw err;
  }
  return new DatabaseSync(dest);
}

// --- Chromium -------------------------------------------------------------

const CHROMIUM_ROOTS = [['bookmark_bar', 'Bookmarks bar'], ['other', 'Other bookmarks'], ['synced', 'Mobile bookmarks']];

function chromiumBookmarks(file) {
  if (!fs.existsSync(file)) return [];
  const data = readJson(file);
  const roots = data && data.roots;
  if (!roots || typeof roots !== 'object') throw new Error('The Bookmarks file is not one this version of Vex understands');
  const out = [];
  const walk = (node, trail, depth) => {
    if (!node || typeof node !== 'object' || depth > 40) return;
    if (node.type === 'url') {
      if (isWeb(node.url)) out.push({ url: node.url, title: clip(node.name) || node.url, path: trail, addedAt: iso(fromWebkit(node.date_added)) });
      return;
    }
    if (Array.isArray(node.children)) for (const child of node.children) walk(child, child.type === 'folder' ? [...trail, clip(child.name, 200) || 'Folder'] : trail, depth + 1);
  };
  for (const [key, label] of CHROMIUM_ROOTS) if (roots[key]) walk(roots[key], [clip(roots[key].name, 200) || label], 0);
  return out;
}

function chromiumHistory(file, tmp, browserName, limit) {
  if (!fs.existsSync(file)) return { total: 0, items: [] };
  const db = openCopy(file, tmp, browserName);
  try {
    const total = db.prepare(`SELECT COUNT(*) AS n FROM urls WHERE hidden = 0 AND last_visit_time > 0 AND ${WEB_SQL}`).get().n;
    const rows = db.prepare(`SELECT url, title, visit_count, last_visit_time / 1000 AS ms FROM urls WHERE hidden = 0 AND last_visit_time > 0 AND ${WEB_SQL} ORDER BY last_visit_time DESC LIMIT ?`).all(limit);
    const items = rows.filter(r => isWeb(r.url)).map(r => ({ url: r.url, title: clip(r.title) || r.url, visitedAt: iso(fromWebkitMs(r.ms)), visits: Number(r.visit_count) || 1 }));
    return { total: Number(total), items };
  } finally { db.close(); }
}

// --- Firefox --------------------------------------------------------------

const FIREFOX_ROOTS = { 'menu________': 'Bookmarks menu', 'toolbar_____': 'Bookmarks toolbar', 'unfiled_____': 'Other bookmarks', 'mobile______': 'Mobile bookmarks' };

function firefoxPlaces(file, tmp, limit) {
  const db = openCopy(file, tmp, 'Firefox');
  try {
    // type 1 is a bookmark, 2 a folder; the tags tree (tags________) is not
    // bookmarks and is left behind with everything not under a known root.
    const rows = db.prepare('SELECT b.id, b.type, b.parent, b.title, b.guid, b.dateAdded / 1000 AS ms, p.url FROM moz_bookmarks b LEFT JOIN moz_places p ON p.id = b.fk ORDER BY b.parent, b.position').all();
    const children = new Map();
    for (const r of rows) { if (!children.has(r.parent)) children.set(r.parent, []); children.get(r.parent).push(r); }
    const bookmarks = [];
    const walk = (id, trail, depth) => {
      if (depth > 40) return;
      for (const r of children.get(id) || []) {
        if (r.type === 1 && isWeb(r.url)) bookmarks.push({ url: r.url, title: clip(r.title) || r.url, path: trail, addedAt: iso(fromPrTimeMs(r.ms)) });
        else if (r.type === 2) walk(r.id, [...trail, clip(r.title, 200) || 'Folder'], depth + 1);
      }
    };
    for (const [guid, label] of Object.entries(FIREFOX_ROOTS)) {
      const root = rows.find(r => r.guid === guid && r.type === 2);
      if (root) walk(root.id, [label], 0);
    }
    const total = db.prepare(`SELECT COUNT(*) AS n FROM moz_places WHERE hidden = 0 AND last_visit_date IS NOT NULL AND ${WEB_SQL}`).get().n;
    const hist = db.prepare(`SELECT url, title, visit_count, last_visit_date / 1000 AS ms FROM moz_places WHERE hidden = 0 AND last_visit_date IS NOT NULL AND ${WEB_SQL} ORDER BY last_visit_date DESC LIMIT ?`).all(limit);
    const items = hist.filter(r => isWeb(r.url)).map(r => ({ url: r.url, title: clip(r.title) || r.url, visitedAt: iso(fromPrTimeMs(r.ms)), visits: Number(r.visit_count) || 1 }));
    return { bookmarks, history: { total: Number(total), items } };
  } finally { db.close(); }
}

// What one profile holds. Nothing is changed in the browser's own folder.
function readProfile(browser, profileId, { env = process.env, limit = HISTORY_LIMIT } = {}) {
  const profile = resolveProfile(browser, profileId, env);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vex-import-'));
  try {
    let bookmarks, history;
    if (browser === 'firefox') ({ bookmarks, history } = firefoxPlaces(path.join(profile.dir, 'places.sqlite'), tmp, limit));
    else {
      bookmarks = chromiumBookmarks(path.join(profile.dir, 'Bookmarks'));
      history = chromiumHistory(path.join(profile.dir, 'History'), tmp, NAMES[browser], limit);
    }
    return { browser, browserName: NAMES[browser], profile: { id: profile.id, name: profile.name }, bookmarks, history };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}

// --- Passwords, from a CSV the person exported ----------------------------

// RFC 4180: quoted fields may hold commas, doubled quotes and line breaks.
function parseCsv(text) {
  const rows = [];
  let row = [], field = '', quoted = false;
  const s = stripBom(String(text));
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quoted) {
      if (c === '"' && s[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows.filter(r => r.some(f => f !== ''));
}

// Chrome, Edge and Brave export name,url,username,password,note; Firefox
// "url","username","password","httpRealm",…; other managers use origin,
// login_uri or login_username. Hosts take the vault's one form (lower case,
// no "www.") so autofill finds them (js/passwords.js _host).
function credentialsFromCsv(text) {
  const rows = parseCsv(text);
  if (!rows.length) throw new Error('That file is empty');
  const head = rows[0].map(h => h.trim().toLowerCase());
  const col = (...names) => head.findIndex(h => names.includes(h));
  const iUrl = col('url', 'origin', 'login_uri', 'website', 'web site');
  const iUser = col('username', 'login', 'login_username', 'user');
  const iPass = col('password', 'login_password');
  if (iUrl < 0 || iPass < 0) throw new Error('That file is not a password export — it has no url and password columns');
  const entries = [];
  let noUsername = 0, notWeb = 0;
  for (const r of rows.slice(1)) {
    const url = (r[iUrl] || '').trim(), password = r[iPass] || '', username = iUser >= 0 ? (r[iUser] || '').trim() : '';
    let host = '';
    try { const u = new URL(url); if (/^https?:$/.test(u.protocol)) host = u.hostname.toLowerCase().replace(/^www\./, ''); } catch { host = ''; }
    if (!host || !password) { notWeb++; continue; }
    if (!username) { noUsername++; continue; }
    if (host.length > 253 || username.length > 4096 || password.length > 16384) { notWeb++; continue; }
    entries.push({ host, username, password });
  }
  return { rows: rows.length - 1, entries, noUsername, notWeb };
}

// Ask for the file here, read it here, and add what is new to the vault here:
// not one password crosses to the window. It is told the hosts, usernames and
// saved times that were added (what vault:list shows anyway), so it can undo
// the import — and leave a login alone that was changed since.
async function importPasswordCsv({ dialog, win, addToVault }) {
  const pick = await dialog.showOpenDialog(win, {
    title: 'Choose the passwords file you exported',
    filters: [{ name: 'Password export (CSV)', extensions: ['csv'] }],
    properties: ['openFile'],
  });
  if (pick.canceled || !pick.filePaths[0]) return { canceled: true };
  const file = pick.filePaths[0];
  const size = fs.statSync(file).size;
  if (size > CSV_MAX_BYTES) throw new Error('That file is too large to be a password export');
  const parsed = credentialsFromCsv(fs.readFileSync(file, 'utf8'));
  const result = await addToVault(parsed.entries);
  return { file: path.basename(file), rows: parsed.rows, added: result.added, duplicates: result.duplicates, noUsername: parsed.noUsername, notWeb: parsed.notWeb };
}

function registerBrowserImport({ ipcMain, dialog, windowFor, addToVault, env = process.env }) {
  ipcMain.handle('browser-import:sources', () => listSources(env));
  ipcMain.handle('browser-import:read', (_e, browser, profileId) => readProfile(browser, profileId, { env }));
  ipcMain.handle('browser-import:passwords-csv', (e) => importPasswordCsv({ dialog, win: windowFor(e), addToVault }));
}

module.exports = {
  BROWSERS, HISTORY_LIMIT,
  listSources, readProfile, parseProfilesIni, parseCsv, credentialsFromCsv, importPasswordCsv, registerBrowserImport,
};

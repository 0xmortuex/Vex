// === Profiles: a separate Vex for each person or purpose ====================
//
// A profile is a whole userData folder of its own, the way Chrome does it:
// tabs, bookmarks, history, passwords, extensions, the sync account, settings
// and cookies all live in it, and nothing is shared with another profile.
//
//   Default profile    the folder Vex has always used (%APPDATA%\Vex, or the
//                      --user-data-dir it was started with). It is never moved
//                      or renamed, so everyone who updates keeps everything.
//   Other profiles     <parent of the default>\Vex Profiles\<id>\ — a sibling
//                      of the default folder, so a test run started with
//                      --user-data-dir keeps its extra profiles inside its own
//                      temporary tree as well.
//   profiles.json      in "Vex Profiles": the name, colour, icon and creation
//                      time of each extra profile, and the default profile's
//                      own name/colour/icon if the user changed them.
//
// Each profile runs as its own process (`--profile=<id>`), chosen before the
// app is ready with app.setPath('userData'), so Chromium's single-instance
// lock is per profile: two profiles run side by side, and a second launch of
// the same profile is handed to the copy already running.
//
// Whether a profile is running is read from Chromium's own lock: while a Vex
// holds a profile, <dir>\lockfile exists and cannot be opened for writing
// (Windows opens it delete-on-close, so it disappears when that Vex exits,
// a crash included).
const nodePath = require('path');

const DEFAULT_ID = 'default';
const ID_RE = /^p-[a-z0-9]{8}$/;
const ROOT_NAME = 'Vex Profiles';
const REGISTRY = 'profiles.json';
const REOPEN_FILE = 'reopen-after-update.json';
const REOPEN_MAX_AGE_MS = 15 * 60 * 1000;
const COLOR_RE = /^#[0-9a-f]{6}$/i;
const ICON_RE = /^[a-z][a-z0-9-]{0,23}$/;
const NAME_MAX = 40;
const MAX_PROFILES = 30;
const DEFAULT_LOOK = Object.freeze({ name: 'Default', color: '#6366f1', icon: 'user' });

function isProfileId(id) { return id === DEFAULT_ID || ID_RE.test(String(id || '')); }

// The profile a launch asks for: `--profile=<id>`, or the `profile` a reminder
// toast's vex:// button carries (src/main/notify.js). Null means the default.
function profileArg(argv) {
  let found = null;
  for (const a of argv || []) {
    const s = String(a || '');
    const flag = /^--profile=(.*)$/.exec(s);
    if (flag) { found = flag[1]; continue; }
    const url = /^vex:\/\/[^?#]*\?(?:.*&)?profile=([^&#]*)/i.exec(s);
    if (url && found == null) found = decodeURIComponent(url[1]);
  }
  return found;
}

function rootFor(defaultDir) { return nodePath.join(nodePath.dirname(defaultDir), ROOT_NAME); }

function cleanName(name) {
  const s = String(name == null ? '' : name).replace(/[\u0000-\u001f\u007f]/g, '').trim();
  if (!s) throw new Error('A profile needs a name');
  if (s.length > NAME_MAX) throw new Error(`A profile name can be at most ${NAME_MAX} characters`);
  return s;
}
function cleanColor(color) {
  if (!COLOR_RE.test(String(color || ''))) throw new Error('A profile colour must be a #rrggbb colour');
  return String(color).toLowerCase();
}
function cleanIcon(icon) {
  if (!ICON_RE.test(String(icon || ''))) throw new Error('Not a profile icon name');
  return String(icon);
}

function createProfileStore({ fs, defaultDir, root = rootFor(defaultDir), now = () => Date.now(), randomId }) {
  if (!defaultDir) throw new Error('The default profile folder is unknown');
  const registryFile = nodePath.join(root, REGISTRY);
  const makeId = randomId || (() => 'p-' + require('crypto').randomBytes(4).toString('hex'));

  // A missing registry is a Vex with only the default profile. An unreadable
  // one is an error: guessing would hide profiles the user still has.
  function read() {
    let text;
    try { text = fs.readFileSync(registryFile, 'utf8'); }
    catch (err) { if (err.code === 'ENOENT') return { version: 1, default: {}, profiles: [] }; throw err; }
    let data;
    try { data = JSON.parse(text); }
    catch (err) { throw new Error(`The profile list (${registryFile}) is damaged: ${err.message}`, { cause: err }); }
    if (!data || typeof data !== 'object' || !Array.isArray(data.profiles)) throw new Error(`The profile list (${registryFile}) is damaged: no profiles array`);
    return {
      version: 1,
      default: data.default && typeof data.default === 'object' ? data.default : {},
      profiles: data.profiles.filter(p => p && ID_RE.test(String(p.id))),
    };
  }

  function write(data) {
    fs.mkdirSync(root, { recursive: true });
    const tmp = registryFile + '.' + process.pid + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
    fs.renameSync(tmp, registryFile);
  }

  function dirFor(id) {
    if (id === DEFAULT_ID) return defaultDir;
    if (!ID_RE.test(String(id || ''))) throw new Error('Not a profile id: ' + id);
    return nodePath.join(root, id);
  }

  function entryOf(raw, id) {
    const look = { ...DEFAULT_LOOK };
    for (const [key, clean] of [['name', cleanName], ['color', cleanColor], ['icon', cleanIcon]]) {
      try { if (raw && raw[key] != null) look[key] = clean(raw[key]); } catch { /* keep the default look for a bad field */ }
    }
    return { id, ...look, created: Number(raw && raw.created) || 0, isDefault: id === DEFAULT_ID, dir: dirFor(id) };
  }

  function list() {
    const data = read();
    return [entryOf(data.default, DEFAULT_ID), ...data.profiles.map(p => entryOf(p, p.id))];
  }

  function get(id) {
    const found = list().find(p => p.id === id);
    if (!found) throw new Error('There is no profile ' + id);
    return found;
  }

  function create({ name, color, icon } = {}) {
    const data = read();
    if (data.profiles.length + 1 >= MAX_PROFILES) throw new Error(`Vex keeps at most ${MAX_PROFILES} profiles`);
    const entry = { id: '', name: cleanName(name), color: cleanColor(color || DEFAULT_LOOK.color), icon: cleanIcon(icon || DEFAULT_LOOK.icon), created: now() };
    for (let i = 0; i < 20 && (!entry.id || data.profiles.some(p => p.id === entry.id) || fs.existsSync(dirFor(entry.id))); i++) entry.id = makeId();
    if (!ID_RE.test(entry.id) || data.profiles.some(p => p.id === entry.id)) throw new Error('Could not choose a new profile id');
    fs.mkdirSync(dirFor(entry.id), { recursive: true });
    data.profiles.push(entry);
    write(data);
    return entryOf(entry, entry.id);
  }

  function update(id, patch = {}) {
    const data = read();
    const target = id === DEFAULT_ID ? data.default : data.profiles.find(p => p.id === id);
    if (!target) throw new Error('There is no profile ' + id);
    if (patch.name !== undefined) target.name = cleanName(patch.name);
    if (patch.color !== undefined) target.color = cleanColor(patch.color);
    if (patch.icon !== undefined) target.icon = cleanIcon(patch.icon);
    write(data);
    return entryOf(target, id);
  }

  function isRunning(id) {
    const lock = nodePath.join(dirFor(id), 'lockfile');
    if (!fs.existsSync(lock)) return false;
    try { fs.closeSync(fs.openSync(lock, 'r+')); return false; }
    catch (err) {
      if (err.code === 'EBUSY' || err.code === 'EPERM' || err.code === 'EACCES') return true;
      if (err.code === 'ENOENT') return false;
      throw err;
    }
  }

  // Deletes the profile's whole folder. Never the default profile, never the
  // one asking, never one that is open in another Vex.
  function remove(id, { currentId } = {}) {
    if (id === DEFAULT_ID) throw new Error('The default profile cannot be deleted');
    if (id === currentId) throw new Error('A profile cannot delete itself; delete it from another profile');
    const data = read();
    const at = data.profiles.findIndex(p => p.id === id);
    if (at < 0) throw new Error('There is no profile ' + id);
    if (isRunning(id)) throw new Error('That profile is open. Close its window first, then delete it.');
    fs.rmSync(dirFor(id), { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    data.profiles.splice(at, 1);
    write(data);
    return { ok: true, id };
  }

  // An update closes every Vex. The profiles that were open are written down
  // so the default profile, which the installer starts again, reopens them.
  function noteReopen(ids, version) {
    const wanted = [...new Set(ids)].filter(id => ID_RE.test(String(id)));
    if (!wanted.length) return null;
    fs.mkdirSync(root, { recursive: true });
    const file = nodePath.join(root, REOPEN_FILE);
    fs.writeFileSync(file, JSON.stringify({ at: now(), version: String(version || ''), profiles: wanted }));
    return file;
  }

  // Read once and removed: a reopen list older than REOPEN_MAX_AGE_MS is an
  // update that never happened, and is dropped without reopening anything.
  function takeReopen() {
    const file = nodePath.join(root, REOPEN_FILE);
    let data;
    try { data = JSON.parse(fs.readFileSync(file, 'utf8')); }
    catch (err) { if (err.code === 'ENOENT') return []; fs.rmSync(file, { force: true }); throw err; }
    fs.rmSync(file, { force: true });
    if (!data || !Array.isArray(data.profiles) || !(now() - Number(data.at) < REOPEN_MAX_AGE_MS)) return [];
    const known = new Set(read().profiles.map(p => p.id));
    return data.profiles.filter(id => known.has(id));
  }

  return { list, get, create, update, remove, isRunning, dirFor, noteReopen, takeReopen, root, registryFile, defaultDir };
}

// Chooses this launch's profile and points userData at it. Must run before
// the app is ready and before anything reads userData (main.js, top).
// Throws for a profile that does not exist, so a stale shortcut says so
// instead of quietly opening another profile.
function selectProfile({ app, argv, fs }) {
  const defaultDir = app.getPath('userData');
  const asked = profileArg(argv);
  const id = asked == null || asked === '' ? DEFAULT_ID : asked;
  if (!isProfileId(id)) throw new Error(`"${asked}" is not a Vex profile`);
  const store = createProfileStore({ fs, defaultDir });
  if (id === DEFAULT_ID) return { id, store, defaultDir, dir: defaultDir };
  const known = store.list().some(p => p.id === id);
  if (!known) {
    const err = new Error(`The Vex profile ${id} no longer exists`);
    err.code = 'VEX_PROFILE_MISSING';
    throw err;
  }
  const dir = store.dirFor(id);
  fs.mkdirSync(dir, { recursive: true });
  app.setPath('userData', dir);
  return { id, store, defaultDir, dir };
}

// The command line that starts Vex in a profile. `--user-data-dir` is carried
// over so a Vex started from a test's (or a portable) folder finds the same
// profiles; the development binary needs the app folder first.
function launchArgs({ id, packaged, appPath, argv = [], extra = [] }) {
  const args = [];
  if (!packaged) args.push(appPath);
  for (const a of argv) if (/^--user-data-dir=/.test(String(a))) args.push(a);
  args.push('--profile=' + id);
  return [...args, ...extra];
}

const quoteArg = (a) => (/[\s"]/.test(a) ? '"' + String(a).replace(/"/g, '\\"') + '"' : String(a));

// The taskbar identity of a profile's windows: its own AppUserModelID, so the
// taskbar groups each profile on its own, and a pinned window starts that
// profile again. The default profile keeps Vex's own id (com.vex.browser).
function appDetails({ id, name, execPath, packaged, appPath, argv }) {
  if (id === DEFAULT_ID) return null;
  return {
    appId: 'com.vex.browser.profile.' + id,
    appIconPath: execPath,
    appIconIndex: 0,
    relaunchCommand: [execPath, ...launchArgs({ id, packaged, appPath, argv })].map(quoteArg).join(' '),
    relaunchDisplayName: `Vex (${name})`,
  };
}

// A desktop shortcut that starts Vex in the profile.
function shortcutSpec({ id, name, execPath, packaged, appPath, argv, desktopDir }) {
  const safe = String(name).replace(/[<>:"/\\|?*\u0000-\u001f]/g, '').trim() || id;
  return {
    file: nodePath.join(desktopDir, `Vex (${safe}).lnk`),
    options: {
      target: execPath,
      args: launchArgs({ id, packaged, appPath, argv }).map(quoteArg).join(' '),
      description: `Vex — the ${name} profile`,
      icon: execPath,
      iconIndex: 0,
      appUserModelId: id === DEFAULT_ID ? 'com.vex.browser' : 'com.vex.browser.profile.' + id,
    },
  };
}

module.exports = {
  DEFAULT_ID, ROOT_NAME, REGISTRY, REOPEN_FILE, REOPEN_MAX_AGE_MS, MAX_PROFILES, DEFAULT_LOOK,
  isProfileId, profileArg, rootFor, createProfileStore, selectProfile, launchArgs, appDetails, shortcutSpec,
};

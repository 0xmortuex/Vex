// === Launching the Game Control Center ======================================
//
// Game Control Center is a separate Electron app of the owner's (bypass, game
// boost, network, overlay and gamma light). Ctrl+K "Open Game Control Center"
// starts it from here.
//
// The renderer never names a program. It asks for "launch", and THIS module
// finds the program, from places only the person or the installer can write:
//
//   1. the location chosen in Settings (checked again every time, not trusted
//      because it was valid when it was saved),
//   2. the Start-menu shortcut "Game Control Center.lnk" (per user, then all
//      users), read with Electron's own shell.readShortcutLink,
//   3. the uninstall entry's InstallLocation in the registry (per user, then
//      per machine), read with reg.exe given an argument list, never a shell,
//   4. C:\Program Files\Game Control Center\Game Control Center.exe.
//
// Whatever it finds must be a file called exactly "Game Control Center.exe";
// anything else is refused, wherever it came from. It is started detached,
// with no shell and no arguments, so it keeps running if Vex closes.
const fs = require('fs');
const path = require('path');

const EXE_NAME = 'Game Control Center.exe';
const LNK_NAME = 'Game Control Center.lnk';
const PRODUCT = 'Game Control Center';
const SAVE_FILE = 'game-control-center.json';

// A path that may be launched: a string, absolute, naming the exact file.
// Throws with the reason; never returns a "fixed" path.
function checkExe(p) {
  if (typeof p !== 'string' || !p.trim()) throw new Error('No location given');
  if (p.length > 1024 || p.includes('\0')) throw new Error('That is not a usable location');
  if (!path.win32.isAbsolute(p)) throw new Error('The location must be a full path');
  if (path.win32.basename(p).toLowerCase() !== EXE_NAME.toLowerCase()) {
    throw new Error('Choose the file named "' + EXE_NAME + '" (this one is "' + path.win32.basename(p) + '")');
  }
  return path.win32.normalize(p);
}

// Same, and the file must exist. Returns the path or throws.
function checkExeExists(p, exists) {
  const norm = checkExe(p);
  if (!exists(norm)) throw new Error('There is no file at ' + norm);
  return norm;
}

// reg.exe prints, for `query <key> /s /f <text> /d /e`, each matching key on a
// line of its own beginning with HKEY_. Returns those key paths.
function parseMatchingKeys(output) {
  return String(output || '').split(/\r?\n/).map(l => l.trim()).filter(l => /^HKEY_(LOCAL_MACHINE|CURRENT_USER)\\/i.test(l));
}

// `query <key> /v InstallLocation` prints "    InstallLocation    REG_SZ    C:\...".
function parseInstallLocation(output) {
  const m = /^\s*InstallLocation\s+REG_(?:EXPAND_)?SZ\s+(.+?)\s*$/im.exec(String(output || ''));
  return m ? m[1].replace(/^"(.*)"$/, '$1') : '';
}

const UNINSTALL_ROOTS = [
  'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
  'HKLM\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
  'HKLM\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
];

// reg.exe through execFile: arguments are an array, so nothing is parsed by a
// shell. A root with no match makes reg exit 1, which just means "not there".
function readRegistryInstallDirs(execFile) {
  const run = (args) => new Promise((resolve) => {
    execFile('reg.exe', args, { windowsHide: true, timeout: 8000, maxBuffer: 1024 * 1024 }, (err, stdout) => resolve(err ? '' : String(stdout)));
  });
  return (async () => {
    const dirs = [];
    for (const root of UNINSTALL_ROOTS) {
      const keys = parseMatchingKeys(await run(['query', root, '/s', '/f', PRODUCT, '/d', '/e']));
      for (const key of keys) {
        if (!key.toLowerCase().startsWith(root.replace(/^HKCU/i, 'HKEY_CURRENT_USER').replace(/^HKLM/i, 'HKEY_LOCAL_MACHINE').toLowerCase())) continue;
        const dir = parseInstallLocation(await run(['query', key, '/v', 'InstallLocation']));
        if (dir) dirs.push(dir);
      }
    }
    return dirs;
  })();
}

// The ordered places to look, as { source, label, find: async () => path|null }.
function places({ saved, env, exists, readShortcut, readdir, execFile }) {
  const startMenus = [
    env.APPDATA && path.win32.join(env.APPDATA, 'Microsoft', 'Windows', 'Start Menu', 'Programs'),
    env.ProgramData && path.win32.join(env.ProgramData, 'Microsoft', 'Windows', 'Start Menu', 'Programs'),
  ].filter(Boolean);
  return [
    { source: 'setting', label: 'the location chosen in Settings', find: async () => saved || null },
    {
      source: 'shortcut',
      label: 'the Start menu shortcut "' + LNK_NAME + '"',
      find: async () => {
        for (const dir of startMenus) {
          // In Programs itself, or in one folder inside it (a publisher folder).
          const candidates = [path.win32.join(dir, LNK_NAME)];
          let subs;
          try { subs = readdir(dir); } catch (err) { if (err.code !== 'ENOENT') throw err; subs = []; }
          for (const sub of subs) candidates.push(path.win32.join(dir, sub, LNK_NAME));
          for (const lnk of candidates) {
            if (!exists(lnk)) continue;
            const info = readShortcut(lnk);
            if (info && info.target) return info.target;
          }
        }
        return null;
      },
    },
    {
      source: 'registry',
      label: 'the installed-programs list (uninstall entry)',
      find: async () => {
        for (const dir of await readRegistryInstallDirs(execFile)) {
          const exe = path.win32.join(dir, EXE_NAME);
          if (exists(exe)) return exe;
        }
        return null;
      },
    },
    {
      source: 'programfiles',
      label: path.win32.join(env.ProgramFiles || 'C:\\Program Files', PRODUCT, EXE_NAME),
      find: async () => { const p = path.win32.join(env.ProgramFiles || 'C:\\Program Files', PRODUCT, EXE_NAME); return exists(p) ? p : null; },
    },
  ];
}

// -> { path, source } or { path: null, looked: [labels], refused: [reasons] }.
// A place that gives something that is not the right file is recorded and the
// next place is tried; it is never launched.
async function resolve(deps) {
  const looked = [];
  const refused = [];
  for (const place of places(deps)) {
    looked.push(place.label);
    let found;
    try { found = await place.find(); } catch (err) { refused.push(place.label + ': ' + err.message); continue; }
    if (!found) continue;
    try { return { path: checkExeExists(found, deps.exists), source: place.source }; }
    catch (err) { refused.push(place.label + ': ' + err.message); }
  }
  return { path: null, looked, refused };
}

// Start it. Resolves when the process exists, rejects when it could not start.
function launch(spawn, exe) {
  return new Promise((resolveP, rejectP) => {
    let child;
    try {
      child = spawn(exe, [], { detached: true, stdio: 'ignore', windowsHide: false, cwd: path.win32.dirname(exe), shell: false });
    } catch (err) { rejectP(err); return; }
    child.once('error', rejectP);
    child.once('spawn', () => { child.unref(); resolveP(); });
  });
}

// Channels (policy: Vex's own windows only, ipc-policy.js UI_ONLY_CHANNELS):
//   gcc:launch  []            -> { ok, source } | { ok:false, error, looked }
//   gcc:get     []            -> { path }   the saved location, or ''
//   gcc:pick    []            -> { ok, path } | { ok:false, cancelled } | { ok:false, error }
//   gcc:clear   []            -> { ok }
function register({ ipcMain, dialog, getWindow, userDataPath, spawn, execFile, shell, env, exists, readdir }) {
  const file = path.join(userDataPath, SAVE_FILE);
  let saved = '';
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8')).path;
    saved = typeof raw === 'string' ? raw : '';
  } catch { saved = ''; }
  const deps = () => ({ saved, env, exists, readdir, execFile, readShortcut: (p) => shell.readShortcutLink(p) });

  ipcMain.handle('gcc:get', () => ({ path: saved }));

  ipcMain.handle('gcc:launch', async () => {
    const found = await resolve(deps());
    if (!found.path) {
      return { ok: false, error: PRODUCT + ' was not found', looked: found.looked, refused: found.refused };
    }
    try { await launch(spawn, found.path); }
    catch (err) { return { ok: false, error: PRODUCT + ' would not start: ' + err.message, looked: [found.path], refused: [] }; }
    return { ok: true, source: found.source, path: found.path };
  });

  ipcMain.handle('gcc:pick', async (event) => {
    const win = getWindow && getWindow(event && event.sender);
    const opts = { title: 'Where is ' + PRODUCT + '?', properties: ['openFile'], filters: [{ name: 'Program', extensions: ['exe'] }] };
    const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
    if (r.canceled || !r.filePaths[0]) return { ok: false, cancelled: true };
    try {
      const norm = checkExeExists(r.filePaths[0], exists);
      fs.writeFileSync(file, JSON.stringify({ path: norm }));
      saved = norm;
      return { ok: true, path: norm };
    } catch (err) { return { ok: false, error: err.message }; }
  });

  ipcMain.handle('gcc:clear', () => {
    saved = '';
    try { fs.unlinkSync(file); } catch (err) { if (err.code !== 'ENOENT') throw err; }
    return { ok: true };
  });
}

module.exports = {
  EXE_NAME, LNK_NAME, SAVE_FILE, UNINSTALL_ROOTS,
  checkExe, checkExeExists, parseMatchingKeys, parseInstallLocation,
  readRegistryInstallDirs, places, resolve, launch, register,
};

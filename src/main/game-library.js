'use strict';
// === Which games are installed: a read-only listing (T2-002) =================
//
// Game mode starts for the programs on the person's own list. Two games were on
// it while far more are installed. This lists what the launchers say is
// installed so the person can add them with one confirm each. It never adds
// anything itself.
//
// What it reads, and nothing else:
//   Steam   steamapps\libraryfolders.vdf (the library folders), steamapps\appmanifest_*.acf
//           (name + install folder) and the program names in that install folder.
//   Epic    ProgramData\Epic\EpicGamesLauncher\Data\Manifests\*.item (name + launch program)
//   Roblox  %LOCALAPPDATA%\Roblox\Versions\*\RobloxPlayerBeta.exe
//
// It lists files and reads those small manifest files. It never opens, reads,
// attaches to or touches a game, writes nothing to disk, uses no registry and
// starts no program. A launcher that is not installed is simply absent; a file
// it could not read is reported in `errors`, never hidden.

const path = require('path');

const MAX_CANDIDATES = 300;
const MAX_MANIFEST_BYTES = 256 * 1024;
const MAX_DIRS_PER_GAME = 60;
const MAX_DEPTH = 4;

// Programs that sit in a game's folder but are not the game.
const NOT_THE_GAME = /(^|[^a-z])(unins\w*|uninstall\w*|crash\w*|redist\w*|vc_?redist\w*|dxsetup|dxwebsetup|dotnet\w*|ue4prereq\w*|unitycrash\w*|easyanticheat\w*|eac_?\w*|battleye\w*|be_?service|setup|installer|touchup|cleanup|report\w*|helper|updater|bootstrap\w*|launcher_?helper|notification_?helper)([^a-z]|$)/i;
const NOT_A_GAME_NAME = /^(steamworks common redistributables|steam linux runtime|proton\b|steamvr|steam controller configs)/i;

function normalizeExe(value) {
  return String(value || '').trim().toLowerCase().replace(/^.*[\\/]/, '').replace(/\.exe$/, '');
}

// libraryfolders.vdf -> the folders that hold steamapps.
function parseLibraryFolders(text) {
  const out = [];
  for (const m of String(text || '').matchAll(/"path"\s+"([^"]+)"/g)) out.push(m[1].replace(/\\\\/g, '\\'));
  return out;
}

// appmanifest_*.acf -> { name, installdir } (or null when it is not a game).
function parseAppManifest(text) {
  const name = /"name"\s+"([^"]*)"/.exec(String(text || ''));
  const dir = /"installdir"\s+"([^"]*)"/.exec(String(text || ''));
  if (!name || !dir || !name[1] || !dir[1]) return null;
  if (NOT_A_GAME_NAME.test(name[1])) return null;
  return { name: name[1], installdir: dir[1] };
}

// Epic's .item file -> { name, exe } (or null when it is unfinished or not a program).
function parseEpicItem(json) {
  if (!json || typeof json !== 'object') return null;
  if (json.bIsIncompleteInstall) return null;
  const name = String(json.DisplayName || '').trim();
  const exe = normalizeExe(json.LaunchExecutable);
  if (!name || !exe || NOT_THE_GAME.test(exe)) return null;
  return { name, exe };
}

// The program of a game folder from its listing: [{ name, size }] -> the biggest that is not a helper.
function pickExe(files) {
  let best = null;
  for (const f of files || []) {
    if (!f || !/\.exe$/i.test(f.name) || NOT_THE_GAME.test(f.name.replace(/\.exe$/i, ''))) continue;
    if (!best || f.size > best.size) best = f;
  }
  return best ? normalizeExe(best.name) : '';
}

// -> { candidates: [{ source, name, exe }], errors: [{ source, message }], sources: { steam, epic, roblox } }
async function scanLibraries({ fsp, env = process.env } = {}) {
  if (!fsp) throw new Error('scanLibraries needs a file system');
  const candidates = [];
  const errors = [];
  const seen = new Set();
  const sources = { steam: false, epic: false, roblox: false };
  const add = (source, name, exe) => {
    const key = normalizeExe(exe);
    if (!key || seen.has(key) || candidates.length >= MAX_CANDIDATES) return;
    seen.add(key);
    candidates.push({ source, name: String(name || key).slice(0, 120), exe: key });
  };
  const note = (source, err) => errors.push({ source, message: (err && err.message) || String(err) });
  const missing = (err) => err && (err.code === 'ENOENT' || err.code === 'ENOTDIR');
  const readSmall = async (file) => {
    const st = await fsp.stat(file);
    if (st.size > MAX_MANIFEST_BYTES) throw new Error(path.basename(file) + ' is larger than expected and was skipped');
    return fsp.readFile(file, 'utf8');
  };

  // The biggest program in the game's folder, looking at most four folders deep.
  const exeIn = async (root) => {
    const queue = [{ dir: root, depth: 0 }];
    let looked = 0;
    while (queue.length && looked < MAX_DIRS_PER_GAME) {
      const { dir, depth } = queue.shift();
      looked++;
      let entries;
      try { entries = await fsp.readdir(dir, { withFileTypes: true }); } catch (err) { if (!missing(err)) throw err; continue; }
      const files = [];
      for (const e of entries) {
        if (e.isFile() && /\.exe$/i.test(e.name)) {
          const st = await fsp.stat(path.join(dir, e.name));
          files.push({ name: e.name, size: st.size });
        } else if (e.isDirectory() && depth < MAX_DEPTH && !/^(_?redist|directx|vcredist|__installer|engine|crashreportclient)$/i.test(e.name)) {
          queue.push({ dir: path.join(dir, e.name), depth: depth + 1 });
        }
      }
      const exe = pickExe(files);
      if (exe) return exe;
    }
    return '';
  };

  // ---- Steam ----
  const pf86 = env['ProgramFiles(x86)'] || '';
  const pf = env.ProgramFiles || '';
  const steamRoots = [pf86 && path.join(pf86, 'Steam'), pf && path.join(pf, 'Steam')].filter(Boolean);
  const libraries = new Set();
  for (const root of steamRoots) {
    try {
      const text = await readSmall(path.join(root, 'steamapps', 'libraryfolders.vdf'));
      sources.steam = true;
      libraries.add(path.join(root, 'steamapps'));
      for (const lib of parseLibraryFolders(text)) libraries.add(path.join(lib, 'steamapps'));
    } catch (err) { if (!missing(err)) note('steam', err); }
  }
  for (const lib of libraries) {
    let names;
    try { names = (await fsp.readdir(lib)).filter(n => /^appmanifest_\d+\.acf$/.test(n)); }
    catch (err) { if (!missing(err)) note('steam', err); continue; }
    for (const n of names) {
      try {
        const app = parseAppManifest(await readSmall(path.join(lib, n)));
        if (!app) continue;
        const exe = await exeIn(path.join(lib, 'common', app.installdir));
        if (exe) add('steam', app.name, exe);
      } catch (err) { note('steam', err); }
    }
  }

  // ---- Epic ----
  const manifests = path.join(env.ProgramData || 'C:\\ProgramData', 'Epic', 'EpicGamesLauncher', 'Data', 'Manifests');
  try {
    const items = (await fsp.readdir(manifests)).filter(n => /\.item$/i.test(n));
    sources.epic = true;
    for (const n of items) {
      try {
        const item = parseEpicItem(JSON.parse(await readSmall(path.join(manifests, n))));
        if (item) add('epic', item.name, item.exe);
      } catch (err) { note('epic', err); }
    }
  } catch (err) { if (!missing(err)) note('epic', err); }

  // ---- Roblox ----
  const local = env.LOCALAPPDATA || '';
  if (local) {
    const versions = path.join(local, 'Roblox', 'Versions');
    try {
      for (const v of await fsp.readdir(versions)) {
        try {
          await fsp.stat(path.join(versions, v, 'RobloxPlayerBeta.exe'));
          sources.roblox = true;
          add('roblox', 'Roblox', 'RobloxPlayerBeta');
          break;
        } catch (err) { if (!missing(err)) note('roblox', err); }
      }
    } catch (err) { if (!missing(err)) note('roblox', err); }
  }

  candidates.sort((a, b) => a.name.localeCompare(b.name));
  return { candidates, errors, sources };
}

module.exports = { scanLibraries, parseLibraryFolders, parseAppManifest, parseEpicItem, pickExe, normalizeExe, MAX_CANDIDATES };

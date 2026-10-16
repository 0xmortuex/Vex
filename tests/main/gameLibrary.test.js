import { describe, it, expect } from 'vitest';

const path = require('path');
const L = require('../../src/main/game-library.js');

// A tiny in-memory file system: { 'C:\\dir\\file': contents-or-size, 'C:\\dir': null }
function fakeFs(files) {
  const norm = (p) => path.win32.normalize(p).replace(/[\\/]+$/, '');
  const map = new Map(Object.entries(files).map(([k, v]) => [norm(k), v]));
  const dirs = new Set();
  for (const k of map.keys()) { let d = path.win32.dirname(k); while (d && !dirs.has(d) && d !== path.win32.dirname(d)) { dirs.add(d); d = path.win32.dirname(d); } }
  const enoent = (p) => Object.assign(new Error('ENOENT ' + p), { code: 'ENOENT' });
  return {
    async stat(p) {
      const k = norm(p);
      if (map.has(k)) { const v = map.get(k); return { size: typeof v === 'number' ? v : Buffer.byteLength(v) }; }
      if (dirs.has(k)) return { size: 0 };
      throw enoent(p);
    },
    async readFile(p) { const k = norm(p); if (!map.has(k) || typeof map.get(k) === 'number') throw enoent(p); return map.get(k); },
    async readdir(p, opts) {
      const k = norm(p);
      if (!dirs.has(k)) throw enoent(p);
      const names = new Map();
      for (const f of map.keys()) if (path.win32.dirname(f) === k) names.set(path.win32.basename(f), 'file');
      for (const d of dirs) if (path.win32.dirname(d) === k) names.set(path.win32.basename(d), 'dir');
      if (!opts || !opts.withFileTypes) return [...names.keys()];
      return [...names].map(([name, kind]) => ({ name, isFile: () => kind === 'file', isDirectory: () => kind === 'dir' }));
    },
  };
}

describe('parsers', () => {
  it('reads the library folders out of libraryfolders.vdf', () => {
    const vdf = '"libraryfolders"\n{\n\t"0"\n\t{\n\t\t"path"\t\t"C:\\\\Program Files (x86)\\\\Steam"\n\t}\n\t"1"\n\t{\n\t\t"path"\t\t"D:\\\\SteamLibrary"\n\t}\n}';
    expect(L.parseLibraryFolders(vdf)).toEqual(['C:\\Program Files (x86)\\Steam', 'D:\\SteamLibrary']);
  });
  it('reads a Steam app manifest and skips runtimes', () => {
    expect(L.parseAppManifest('"AppState"\n{\n"appid" "730"\n"name"\t\t"Counter-Strike 2"\n"installdir"\t\t"Counter-Strike Global Offensive"\n}')).toEqual({ name: 'Counter-Strike 2', installdir: 'Counter-Strike Global Offensive' });
    expect(L.parseAppManifest('"name" "Steamworks Common Redistributables"\n"installdir" "Steamworks Shared"')).toBe(null);
    expect(L.parseAppManifest('nonsense')).toBe(null);
  });
  it('reads an Epic item and skips an unfinished install', () => {
    expect(L.parseEpicItem({ DisplayName: 'Fortnite', LaunchExecutable: 'FortniteGame\\Binaries\\Win64\\FortniteClient-Win64-Shipping.exe' })).toEqual({ name: 'Fortnite', exe: 'fortniteclient-win64-shipping' });
    expect(L.parseEpicItem({ DisplayName: 'X', LaunchExecutable: 'x.exe', bIsIncompleteInstall: true })).toBe(null);
    expect(L.parseEpicItem(null)).toBe(null);
  });
  it('picks the biggest program that is not a helper', () => {
    expect(L.pickExe([{ name: 'UnityCrashHandler64.exe', size: 9e6 }, { name: 'Game.exe', size: 5e6 }, { name: 'unins000.exe', size: 8e6 }, { name: 'notes.txt', size: 1e9 }])).toBe('game');
    expect(L.pickExe([{ name: 'vcredist_x64.exe', size: 1 }])).toBe('');
  });
});

describe('scanLibraries', () => {
  const env = { 'ProgramFiles(x86)': 'C:\\Program Files (x86)', ProgramFiles: 'C:\\Program Files', ProgramData: 'C:\\ProgramData', LOCALAPPDATA: 'C:\\Users\\me\\AppData\\Local' };
  const steam = 'C:\\Program Files (x86)\\Steam\\steamapps';

  it('lists Steam (including a second library), Epic and Roblox without duplicates', async () => {
    const fsp = fakeFs({
      [steam + '\\libraryfolders.vdf']: '"path" "C:\\\\Program Files (x86)\\\\Steam"\n"path" "D:\\\\Lib"',
      [steam + '\\appmanifest_730.acf']: '"name" "Counter-Strike 2"\n"installdir" "CS2"',
      [steam + '\\common\\CS2\\game\\bin\\win64\\cs2.exe']: 90,
      [steam + '\\common\\CS2\\game\\bin\\win64\\crashhandler64.exe']: 99,
      'D:\\Lib\\steamapps\\appmanifest_1.acf': '"name" "Hades"\n"installdir" "Hades"',
      'D:\\Lib\\steamapps\\common\\Hades\\Hades.exe': 50,
      'C:\\ProgramData\\Epic\\EpicGamesLauncher\\Data\\Manifests\\a.item': JSON.stringify({ DisplayName: 'Rocket League', LaunchExecutable: 'Binaries\\Win64\\RocketLeague.exe' }),
      'C:\\ProgramData\\Epic\\EpicGamesLauncher\\Data\\Manifests\\b.item': JSON.stringify({ DisplayName: 'Hades again', LaunchExecutable: 'Hades.exe' }),
      'C:\\Users\\me\\AppData\\Local\\Roblox\\Versions\\version-abc\\RobloxPlayerBeta.exe': 10,
    });
    const r = await L.scanLibraries({ fsp, env });
    expect(r.errors).toEqual([]);
    expect(r.sources).toEqual({ steam: true, epic: true, roblox: true });
    expect(r.candidates.map(c => c.exe + ':' + c.source)).toEqual(['cs2:steam', 'hades:steam', 'robloxplayerbeta:roblox', 'rocketleague:epic']);
  });

  it('says nothing is installed when no launcher is there, without an error', async () => {
    const r = await L.scanLibraries({ fsp: fakeFs({}), env });
    expect(r).toEqual({ candidates: [], errors: [], sources: { steam: false, epic: false, roblox: false } });
  });

  it('reports a manifest it could not read instead of hiding it', async () => {
    const fsp = fakeFs({ 'C:\\ProgramData\\Epic\\EpicGamesLauncher\\Data\\Manifests\\bad.item': '{not json' });
    const r = await L.scanLibraries({ fsp, env });
    expect(r.candidates).toEqual([]);
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0].source).toBe('epic');
  });

  it('needs a file system', async () => {
    await expect(L.scanLibraries({})).rejects.toThrow(/needs a file system/);
  });
});

describe('the channel', () => {
  const fs = require('fs');
  const read = (p) => fs.readFileSync(path.resolve(__dirname, '../..', p), 'utf8');
  it('has a schema, a preload entry and is for Vex\'s own window only', () => {
    expect(read('src/main/ipc-schemas.js')).toMatch(/define\('gamemode:library', \[\]\)/);
    expect(read('src/preload.js')).toMatch(/ipcRenderer\.invoke\('gamemode:library'\)/);
    expect(require('../../src/main/ipc-policy.js').UI_ONLY_CHANNELS.has('gamemode:library')).toBe(true);
  });
});

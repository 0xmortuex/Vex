// Opening an incognito window must never start Tor by itself. Read from main.js's own text, like the other wiring tests.
// Tor starts from exactly these places (2026-10-24 audit), and each needs a Tor route or a Tor tab that someone asked for:
//   tor:create        a Tor tab (button, Ctrl+K New Tor Tab)
//   applyRouting      a saved or newly set route whose mode is 'tor': all of Vex, a container, a site rule, a burner
//   _reviveTor        a page loading in a session whose Tor route has gone down
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const main = fs.readFileSync(path.join(__dirname, '../../src/main.js'), 'utf8').replace(/\r\n/g, '\n');
const between = (a, b) => { const i = main.indexOf(a); const j = main.indexOf(b, i); expect(i).toBeGreaterThan(-1); expect(j).toBeGreaterThan(i); return main.slice(i, j); };

describe('opening incognito never starts Tor on its own', () => {
  const open = between('async function openPrivateWindow(', "ipcMain.handle('open-private-window'");

  it('openPrivateWindow does not touch the Tor launcher or the Tor channels', () => {
    expect(open).not.toMatch(/_torLauncher|createTor|tor:create|applyRouting|detectTorPort|_reviveTor/);
  });

  it('a new session is put on a route only through _coverWithAllRoute, which does nothing unless the all-of-Vex route is Tor or a proxy', () => {
    const cover = between('function _coverWithAllRoute(', "ipcMain.handle('routing:set-all'");
    // _allRoute() is null for 'direct' (or nothing saved); the function returns before applyRouting.
    expect(cover).toMatch(/all = _allRoute\(\); if \(!all \|\| !_allRouteCovers\(partition\)\) return;/);
    const route = between('function _allRoute()', 'function _allRouteCovers(');
    expect(route).toMatch(/r\.mode === 'tor' \|\| r\.mode === 'proxy'/);
  });

  it('the only callers that start Tor are the three known ones', () => {
    const starts = [...main.matchAll(/_torLauncher\.start\(/g)].length;
    expect(starts).toBe(3);                                   // tor:create, _reviveTor, applyRouting('tor')
    expect(between("ipcMain.handle('tor:create'", "ipcMain.handle('tor:verify'")).toMatch(/_torLauncher\.start\(/);
    expect(between('function _reviveTor(', 'function _torTabsInWindows(')).toMatch(/_torLauncher\.start\(/);
    expect(between('async function applyRouting(', "ipcMain.handle('routing:set'")).toMatch(/if \(mode === 'tor'\) \{/);
  });
});

// @vitest-environment node
//
// The ad-block filter lists were downloaded with Node's own fetch, outside
// every Vex session, so with all of Vex routed through Tor or a proxy they
// left from the real address; and they were downloaded with the blocker
// switched off (found 2026-10-11). They now come through the default session
// (which the route for all of Vex covers) and only while the blocker is on.
import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const main = fs.readFileSync(path.join(__dirname, '../../src/main.js'), 'utf8');
const engine = fs.readFileSync(path.join(__dirname, '../../src/adblocker-engine.js'), 'utf8');

describe('the list download', () => {
  const { createListFetch, storedBlockerOn } = require('../../src/main/adblock-lists.js');

  it('goes through the fetch it is given while the blocker is on', async () => {
    const fetch = vi.fn(async () => 'response');
    let on = true;
    const listFetch = createListFetch({ fetch, isOn: () => on });
    expect(await listFetch('https://lists.example/easylist.txt')).toBe('response');
    on = false;
    await expect(listFetch('https://lists.example/easylist.txt')).rejects.toThrow(/ad blocker is off/);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('reads the saved switch: on unless switched off', () => {
    expect(storedBlockerOn(null)).toBe(true);
    expect(storedBlockerOn({ searchEngine: 'google' })).toBe(true);
    expect(storedBlockerOn({ adBlocker: true })).toBe(true);
    expect(storedBlockerOn({ adBlocker: false })).toBe(false);
  });

  it('the engine builds and refreshes with that fetch, not Node’s', () => {
    expect(engine).toMatch(/fromPrebuiltFull\(listFetch, caching\)/);
    expect(engine).toMatch(/fromPrebuiltFull\(listFetch\)/);
    expect(engine).not.toMatch(/fromPrebuiltFull\(fetch/);
  });

  it('main hands it the default session’s fetch, gated on the switch', () => {
    expect(main).toMatch(/createListFetch\(\{ fetch: \(url, init\) => session\.defaultSession\.fetch\(url, init\), isOn: \(\) => adBlockerEnabled \}\)/);
    expect(main).toMatch(/initAdblockEngine\(adblockCache, \{ fetch: _adblockListFetch \}\)/);
    expect(main).toMatch(/refreshIfStale\(adblockCache, \{ fetch: _adblockListFetch \}\)/);
  });

  it('main starts the engine only with the saved switch on, and when it is turned on', () => {
    expect(main).toMatch(/storedBlockerOn\(saved\)/);
    const handler = main.slice(main.indexOf("ipcMain.handle('adblocker-set-state'"), main.indexOf("ipcMain.handle('adblocker-set-state'") + 400);
    expect(handler).toMatch(/if \(adBlockerEnabled && _startAdblockEngine\) _startAdblockEngine\(\)/);
  });
});

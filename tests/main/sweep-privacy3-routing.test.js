// The proxy address is checked in main, where every route is applied: the
// renderer's loose pattern let socks5://hello, http://; and a fallback list
// that quietly went direct all through (found 2026-09-29).
import { describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
const require = createRequire(import.meta.url);
const { proxyAddress, restoreRoutes } = require('../../src/main/routing.js');

describe('proxyAddress', () => {
  it.each([
    ['socks5://127.0.0.1:1080', 'socks5://127.0.0.1:1080'],
    ['  http://proxy.example:8080  ', 'http://proxy.example:8080'],
    ['HTTPS://Proxy.Example:443/', 'https://proxy.example:443'],
    ['socks4://10.0.0.2:9050', 'socks4://10.0.0.2:9050'],
    ['http://h:80', 'http://h:80'],
    ['socks5://[::1]:1080', 'socks5://[::1]:1080'],
  ])('takes %s', (text, want) => { expect(proxyAddress(text)).toBe(want); });

  it.each([
    'socks5://hello', 'http://;', 'socks5://127.0.0.1:99999', 'socks5://x:1080,direct://',
    'http://a:1;https=b:2', 'socks5://127.0.0.1:0', 'hello', 'ftp://h:21', '', null, 42,
    'http://user:pw@h:8080', 'http://h:8080/path', 'http://h:8080?x=1', 'socks5://:1080',
  ])('refuses %s', (text) => { expect(() => proxyAddress(text)).toThrow(/A proxy address looks like/); });
});

describe('restoring a saved proxy that no longer passes', () => {
  it('blocks that session instead of going direct or stopping Vex from opening', async () => {
    const setProxy = vi.fn(async () => {});
    const applyRouting = vi.fn(async () => {});
    const report = vi.fn();
    await restoreRoutes({ routes: { 'persist:main': { mode: 'proxy', custom: 'socks5://x:1080,direct://' } },
      getSession: () => ({ setProxy }), applyRouting, report });
    expect(applyRouting).not.toHaveBeenCalled();
    expect(setProxy).toHaveBeenCalledWith({ proxyRules: 'socks5://127.0.0.1:9', proxyBypassRules: '<-loopback>' });
    expect(report).toHaveBeenCalledOnce();
  });

  it('applies a good one in its checked form', async () => {
    const applyRouting = vi.fn(async () => {});
    await restoreRoutes({ routes: { default: { mode: 'proxy', custom: ' socks5://127.0.0.1:1080 ' } }, applyRouting, report: vi.fn() });
    expect(applyRouting).toHaveBeenCalledWith('', 'proxy', 'socks5://127.0.0.1:1080');
  });
});

describe('main wiring', () => {
  const main = fs.readFileSync(new URL('../../src/main.js', import.meta.url), 'utf8');
  it('applyRouting checks every proxy before setProxy', () => {
    const fn = main.slice(main.indexOf('async function applyRouting'), main.indexOf("ipcMain.handle('routing:set'"));
    expect(fn).toMatch(/proxyAddress\(custom\)/);
    expect(fn).not.toMatch(/proxyRules: String\(custom\)/);
  });
  it('the private session obeys the third-party and cookie switches', () => {
    // Wired by _wireEphemeralBrowsing, which off-the-record tabs get too.
    const open = main.slice(main.indexOf('function openPrivateWindow'), main.indexOf('const privWin = new BrowserWindow'));
    expect(open).toMatch(/_wireEphemeralBrowsing\(privSession, 'private'\)/);
    const fn = main.slice(main.indexOf('function _wireEphemeralBrowsing'), main.indexOf('function openPrivateWindow'));
    expect(fn).toMatch(/SiteRules\.blocksThirdParty\(/);
    expect(fn).toMatch(/SiteRules\.blocksCookies\(/);
  });
  it('Clear History has a channel that erases the backup copies', () => {
    const fn = main.slice(main.indexOf("ipcMain.handle('browsing:clear-history'"), main.indexOf("ipcMain.handle('open-pip-window'"));
    // The old second copy (history.json) and its backup are removed outright.
    expect(fn).toMatch(/dataStore\.remove\('history'\)/);
    expect(fn).toMatch(/preferences\.clearKeys\(\['vex\.history', 'vex\.recentlyClosed'\]\)/);
    const { schemas } = require('../../src/main/ipc-schemas.js');
    expect(schemas.has('browsing:clear-history')).toBe(true);
  });
});

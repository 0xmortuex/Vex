// @vitest-environment node
//
// Fixes of 2026-09-30 (r3-fix):
//  - a removed or replaced site rule left its route saved, so Tor never
//    stopped and started on every launch; the route is now forgotten, stale
//    ones are pruned at start, and a site route's session with no route loads
//    nothing rather than going direct;
//  - a container named by hand and a site route's session had no permission
//    handler (camera, mic, notifications granted without asking; raw LAN
//    address in WebRTC); every one is wired when it is first made;
//  - the "Tor is running" indicator waited for bootstrap to finish.
// main.js cannot be loaded outside Electron, so it is read as text where a
// module cannot stand in for it.
import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
const path = require('path');

const routing = require('../../src/main/routing.js');
const { createSessionSecurity } = require('../../src/main/session-security.js');
const { validate } = require('../../src/main/ipc-schemas.js');
const { installIpcPolicy } = require('../../src/main/ipc-policy.js');

const read = f => fs.readFileSync(path.resolve(f), 'utf8').replace(/\r\n/g, '\n');
const MAIN = read('src/main.js');

describe("a site route's saved route", () => {
  it('knows a site route partition from any other', () => {
    expect(routing.isSiteRoutePartition('persist:route-tor')).toBe(true);
    expect(routing.isSiteRoutePartition('persist:route-proxy-1x9k2')).toBe(true);
    expect(routing.isSiteRoutePartition('persist:container-work')).toBe(false);
    expect(routing.isSiteRoutePartition('persist:main')).toBe(false);
    expect(routing.isSiteRoutePartition('default')).toBe(false);
    expect(routing.isSiteRoutePartition('persist:route-tor-x')).toBe(false);
    expect(routing.isSiteRoutePartition(null)).toBe(false);
  });

  it('only site routes no rule uses are stale; containers, default and all of Vex are kept', () => {
    const routes = {
      'persist:route-tor': { mode: 'tor' },
      'persist:route-proxy-abc': { mode: 'proxy', custom: 'socks5://127.0.0.1:1080' },
      'persist:route-proxy-def': { mode: 'proxy', custom: 'socks5://127.0.0.1:1081' },
      'persist:container-x': { mode: 'tor' },
      default: { mode: 'proxy', custom: 'socks5://127.0.0.1:1080' },
      __all__: { mode: 'tor' },
    };
    expect(routing.staleSiteRoutes(routes, ['persist:route-proxy-def'])).toEqual(['persist:route-tor', 'persist:route-proxy-abc']);
    expect(routing.staleSiteRoutes(routes, ['persist:route-tor', 'persist:route-proxy-abc', 'persist:route-proxy-def'])).toEqual([]);
  });

  it("a saved site-route Tor route is closed off at start but does not start Tor; a container's still does", async () => {
    const sessions = {};
    const getSession = p => (sessions[p] ||= { setProxy: vi.fn(async () => {}) });
    const applyRouting = vi.fn(async () => ({}));
    await routing.restoreRoutes({
      routes: { 'persist:route-tor': { mode: 'tor' }, 'persist:container-x': { mode: 'tor' } },
      getSession, applyRouting, report: e => { throw e; },
    });
    expect(sessions['persist:route-tor'].setProxy).toHaveBeenCalledWith(routing.REFUSED_PROXY);
    expect(applyRouting).toHaveBeenCalledTimes(1);
    expect(applyRouting).toHaveBeenCalledWith('persist:container-x', 'tor');
  });

  it('routing:forget refuses anything but a site route, and asks whether Tor is still needed', () => {
    const src = MAIN.slice(MAIN.indexOf("ipcMain.handle('routing:forget'"), MAIN.indexOf("ipcMain.handle('routing:prune'"));
    expect(src).toMatch(/isSiteRoutePartition\(partition\)\) throw/);
    expect(src).toMatch(/getRoutingStore\(\)\.delete\(partition\)/);
    expect(src).toMatch(/_torIdleCheck\(\)/);
    // never touches the live session's proxy: an open route-tor tab stays on Tor
    expect(src).not.toMatch(/setProxy|applyRouting/);
  });

  it('the channels are checked and closed to a private window', async () => {
    expect(() => validate('routing:forget', ['persist:route-tor'])).not.toThrow();
    expect(() => validate('routing:forget', [42])).toThrow();
    expect(() => validate('routing:prune', [['persist:route-tor']])).not.toThrow();
    expect(() => validate('routing:prune', ['persist:route-tor'])).toThrow();
    const handlers = new Map();
    const ipcMain = { handle: (ch, fn) => handlers.set(ch, fn), on: () => {} };
    installIpcPolicy(ipcMain, { isUiFrame: () => true, owner: () => ({ privatePartition: 'private:x' }), isAuxiliary: () => false, ownsTarget: () => true });
    ipcMain.handle('routing:forget', () => 'reached');
    ipcMain.handle('routing:prune', () => 'reached');
    const call = (ch, ...args) => handlers.get(ch)({ sender: {}, senderFrame: { url: 'file:///x' } }, ...args);
    await expect(call('routing:forget', 'persist:route-tor')).rejects.toThrow(/private window/);
    await expect(call('routing:prune', [])).rejects.toThrow(/private window/);
  });
});

describe("the Discord bypass and a saved route", () => {
  // It ran at every start, after the routes were restored, and set every
  // browsing session and the default one back to direct (found 2026-09-30).
  const src = MAIN.slice(MAIN.indexOf('function _routeBrowsingDiscord('), MAIN.indexOf('// Voice (RTC) must NOT ride the desync proxy'));
  function apply(saved, port = 0) {
    const sessions = {};
    const fromPartition = p => (sessions[p] ||= { setProxy: vi.fn() });
    const defaultSession = { setProxy: vi.fn() };
    const fn = new Function('_BROWSING_SESSIONS', 'secureSessions', 'session', 'readRouting', '_ALL_ROUTE_KEY', 'Buffer', src + '\nreturn _routeBrowsingDiscord;')(
      ['persist:main', 'persist:container-work'], { fromPartition }, { defaultSession }, () => { if (saved instanceof Error) throw saved; return saved; }, '__all__', Buffer);
    fn(port);
    return { main: sessions['persist:main']?.setProxy, work: sessions['persist:container-work']?.setProxy, def: defaultSession.setProxy };
  }
  it('leaves a routed container alone and sets the rest', () => {
    const r = apply({ 'persist:container-work': { mode: 'tor' } });
    expect(r.work).toBeUndefined();
    expect(r.main).toHaveBeenCalledWith({ mode: 'direct' });
    expect(r.def).toHaveBeenCalledWith({ mode: 'direct' });
  });
  it('all of Vex routed: touches nothing', () => {
    const r = apply({ __all__: { mode: 'proxy', custom: 'http://127.0.0.1:8080' } });
    expect(r.main).toBeUndefined();
    expect(r.work).toBeUndefined();
    expect(r.def).not.toHaveBeenCalled();
  });
  it('saved routes that cannot be read: touches nothing, and says so', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const r = apply(new Error('bad file'));
    expect(r.main).toBeUndefined();
    expect(r.def).not.toHaveBeenCalled();
    expect(err).toHaveBeenCalled();
    err.mockRestore();
  });
});

describe('a session is wired the first time it is made', () => {
  function build() {
    const session = { fromPartition: (p) => ({ partition: p }) };
    const cache = new Map();
    session.fromPartition = (p) => { if (!cache.has(p)) cache.set(p, { partition: p }); return cache.get(p); };
    const webContents = { fromId: () => null, getAllWebContents: () => [] };
    return createSessionSecurity({ session, webContents, root: path.resolve('src') });
  }

  it('told once per session, and of the sessions made before it asked', () => {
    const security = build();
    security.fromPartition('persist:main');
    const seen = [];
    security.onSessionCreated((ses, p) => seen.push(p));
    expect(seen).toEqual(['persist:main']);
    security.fromPartition('persist:container-x');
    security.fromPartition('persist:container-x');
    security.fromPartition('persist:route-tor');
    expect(seen).toEqual(['persist:main', 'persist:container-x', 'persist:route-tor']);
  });

  function wire(partition) {
    const src = MAIN.slice(MAIN.indexOf('function _wireBrowsingSession('), MAIN.indexOf('// Re-apply saved routings at startup'));
    const calls = [];
    const note = name => (...a) => { calls.push([name, a[1]]); };
    const ses = {
      setProxy: vi.fn(async () => {}), setUserAgent: vi.fn(),
      setPermissionRequestHandler: vi.fn(), setPermissionCheckHandler: vi.fn(),
      webRequest: { onHeadersReceived: vi.fn() },
    };
    const fn = new Function('require', 'webContents', 'CHROME_UA', 'BROWSING_SESSIONS', 'wireClientHintsOnSession', 'wireAdblockerOnSession',
      'wireDownloadsOnSession', 'wirePermissionsOnSession', 'wireWebHidOnSession', 'wireDisplayMediaOnSession', '_addMediaCorsHeaders', '_scriptsOffCsp',
      'attachGuestPreloads', 'wireSpellcheckOnSession', src + '\nreturn _wireBrowsingSession;')(
      m => (m === './main/routing' ? routing : require(m)), { getAllWebContents: () => [] }, 'UA', ['persist:main', 'persist:container-work'],
      note('ch'), note('adblock'), note('downloads'), note('permissions'), note('hid'), note('display'), () => {}, () => {}, note('preloads'), note('spell'));
    fn(ses, partition);
    return { ses, calls: calls.map(c => c[0]) };
  }

  it("a container named by hand gets persist:main's permission prompt, downloads, ad blocker and identity", () => {
    const { ses, calls } = wire('persist:container-x');
    expect(calls).toEqual(expect.arrayContaining(['permissions', 'downloads', 'adblock', 'ch', 'hid', 'display', 'preloads', 'spell']));
    expect(ses.setUserAgent).toHaveBeenCalledWith('UA');
    expect(ses.setProxy).not.toHaveBeenCalled();
    expect(ses.webRequest.onHeadersReceived).toHaveBeenCalled();
  });

  it('a site route through Tor denies every permission and loads nothing until its route is on', () => {
    const { ses, calls } = wire('persist:route-tor');
    expect(calls).not.toContain('permissions');
    const deny = vi.fn();
    ses.setPermissionRequestHandler.mock.calls[0][0](null, 'media', deny);
    expect(deny).toHaveBeenCalledWith(false);
    expect(ses.setPermissionCheckHandler.mock.calls[0][0]()).toBe(false);
    expect(ses.setProxy).toHaveBeenCalledWith(routing.REFUSED_PROXY);
    expect(ses.__vexTor).toBe(true);
  });

  it("a site route through a proxy prompts like persist:main, and is closed off and marked routed", () => {
    const { ses, calls } = wire('persist:route-proxy-abc');
    expect(calls).toContain('permissions');
    expect(ses.setProxy).toHaveBeenCalledWith(routing.REFUSED_PROXY);
    expect(ses.__vexRouted).toBe(true);
    expect(ses.__vexTor).toBe(false);
  });

  it('leaves the app panels and persist:main alone', () => {
    for (const p of ['persist:main', 'persist:discord', 'tor-abc', 'private:x']) expect(wire(p).calls).toEqual([]);
  });

  it('is hooked in before the saved routes are restored', () => {
    const at = MAIN.indexOf('secureSessions.onSessionCreated(_wireBrowsingSession)');
    expect(at).toBeGreaterThan(0);
    expect(at).toBeLessThan(MAIN.indexOf('await applyStoredRoutings();'));
  });
});

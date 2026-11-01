// @vitest-environment node
//
// The parts of the Unblock centre that touch helpers (src/main/unblock-main.js) and the shared ByeDPI process
// (src/main/byedpi-share.js): the lifecycle ("never leave a helper running"), the order of the ways with fake helpers,
// and that nothing in it can start Zapret or anything that needs administrator rights.

import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
const { createByedpiShare } = require('../../src/main/byedpi-share.js');
const { createMethods, BYEDPI_PRESETS_TRIED } = require('../../src/main/unblock-main.js');
const { createUnblock } = require('../../src/main/unblock.js');

function fakeByedpi({ running = false } = {}) {
  let port = 2000, on = running;
  return {
    PRESETS: new Array(10).fill(0),
    isRunning: () => on, getPort: () => port,
    start: vi.fn(async () => { on = true; port += 1; return port; }),
    stop: vi.fn(() => { on = false; }),
  };
}

function shareOf(byedpi) {
  const repoint = vi.fn();
  const share = createByedpiShare({ byedpi, setRobloxProxy: vi.fn(), notify: vi.fn() });
  share.setUnblockRepoint(repoint);
  return { share, repoint };
}

describe('the shared ByeDPI process and the Unblock centre', () => {
  it('stops when the last site is gone, if nobody else uses it', async () => {
    const byedpi = fakeByedpi(); const { share } = shareOf(byedpi);
    share.attachUnblock(true);
    await share.start('ud', null, 0);
    expect(share.releaseUnblock()).toBe(true);
    expect(byedpi.stop).toHaveBeenCalledTimes(1);
    expect(share.isUnblockAttached()).toBe(false);
  });
  it('keeps running for Discord or Roblox when the Unblock centre lets go', async () => {
    for (const who of ['discord', 'roblox']) {
      const byedpi = fakeByedpi(); const { share } = shareOf(byedpi);
      if (who === 'discord') await share.startForDiscord('ud', null, 0); else { await share.start('ud', null, 0); share.attachRoblox(true); }
      share.attachUnblock(true);
      expect(share.releaseUnblock(), who).toBe(false);
      expect(byedpi.stop).not.toHaveBeenCalled();
    }
  });
  it('is not stopped by Discord or Roblox turning off while sites ride it', async () => {
    const byedpi = fakeByedpi(); const { share } = shareOf(byedpi);
    await share.startForDiscord('ud', null, 0);
    share.attachUnblock(true);
    expect(share.releaseDiscord()).toBe(false);
    expect(byedpi.isRunning()).toBe(true);
    share.attachRoblox(true);
    expect(share.releaseRoblox()).toBe(false);
    expect(byedpi.isRunning()).toBe(true);
    expect(share.releaseUnblock()).toBe(true);
    expect(byedpi.isRunning()).toBe(false);
  });
  it('tells the Unblock centre the new port when the process is restarted, and 0 when it stops', async () => {
    const byedpi = fakeByedpi(); const { share, repoint } = shareOf(byedpi);
    share.attachUnblock(true);
    const p1 = await share.start('ud', null, 0);
    const p2 = await share.start('ud', null, 1);
    expect(repoint.mock.calls.map(c => c[0])).toEqual([p1, p2]);
    share.stop();
    expect(repoint).toHaveBeenLastCalledWith(0);
    expect(share.isUnblockAttached()).toBe(false);
  });
  it('Discord and Roblox behave as before when the Unblock centre is not using it', async () => {
    const byedpi = fakeByedpi(); const { share, repoint } = shareOf(byedpi);
    await share.startForDiscord('ud', null, 0);
    expect(share.releaseDiscord()).toBe(true);
    expect(repoint).not.toHaveBeenCalled();
  });
});

function methodsWith({ byedpi, exe = false, light = 8000, dohResolve = async () => '1.1.1.1' } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vex-unblock-test-'));
  if (exe) { fs.mkdirSync(path.join(dir, 'byedpi')); fs.writeFileSync(path.join(dir, 'byedpi', 'ciadpi.exe'), 'x'); }
  const b = byedpi || fakeByedpi();
  const { share } = shareOf(b);
  const m = createMethods({ dohResolve, lightPort: () => light, byedpi: b, share, userData: dir, downloadBuffer: vi.fn() });
  const by = Object.fromEntries(m.methods.map(x => [x.id, x]));
  return { ...m, by, byedpi: b, share, dir };
}

describe('the ways', () => {
  it('are listed in this order, and only the last needs administrator rights', () => {
    const { methods, shutdown } = methodsWith();
    expect(methods.map(m => m.id)).toEqual(['doh', 'light', 'byedpi', 'admin']);
    expect(methods.map(m => !!m.adminOnly)).toEqual([false, false, false, true]);
    shutdown();
  });

  it('the administrator way can never be run', async () => {
    const { by, shutdown } = methodsWith();
    expect((await by.admin.available()).ok).toBe(false);
    await expect(by.admin.find()).rejects.toThrow(/administrator/);
    await expect(by.admin.restore()).rejects.toThrow(/administrator/);
    shutdown();
  });

  it('encrypted DNS opens its proxy on loopback only when asked, and closes it when no site uses it', async () => {
    const { by, shutdown } = methodsWith();
    let route;
    const found = await by.doh.find('example.com', async (r) => { route = r; return { ok: true }; });
    expect(found.route).toEqual(route);
    expect(route.kind).toBe('http');
    // it is listening, on 127.0.0.1
    await new Promise((resolve, reject) => { const c = net.connect({ host: '127.0.0.1', port: route.port }, () => { c.destroy(); resolve(); }); c.on('error', reject); });
    await by.doh.releaseIfUnused(1);
    await new Promise((resolve, reject) => { const c = net.connect({ host: '127.0.0.1', port: route.port }, () => { c.destroy(); resolve(); }); c.on('error', reject); });
    await by.doh.releaseIfUnused(0);
    await expect(new Promise((resolve, reject) => { const c = net.connect({ host: '127.0.0.1', port: route.port }, () => { c.destroy(); resolve(); }); c.on('error', reject); })).rejects.toThrow();
    shutdown();
  });

  it('shutdown closes the encrypted-DNS proxy', async () => {
    const { by, shutdown } = methodsWith();
    const route = (await by.doh.find('example.com', async () => ({ ok: true }))).route;
    shutdown();
    await expect(new Promise((resolve, reject) => { const c = net.connect({ host: '127.0.0.1', port: route.port }, () => { c.destroy(); resolve(); }); c.on('error', reject); })).rejects.toThrow();
  });

  it('the built-in proxy is used as it is and is never stopped from here', async () => {
    const { by, shutdown } = methodsWith({ light: 8123 });
    expect((await by.light.find('example.com', async () => ({ ok: true }))).route).toEqual({ kind: 'http', port: 8123 });
    expect(by.light.releaseIfUnused).toBeUndefined();
    shutdown();
  });
  it('the built-in proxy is unavailable when it did not start', async () => {
    const { by, shutdown } = methodsWith({ light: 0 });
    expect(await by.light.available()).toMatchObject({ ok: false });
    await expect(by.light.restore()).rejects.toThrow(/not running/);
    shutdown();
  });

  describe('ByeDPI', () => {
    it('is not downloaded unless the person agreed', async () => {
      const { by, shutdown } = methodsWith({ exe: false });
      expect(await by.byedpi.available({ allowDownload: false })).toMatchObject({ ok: false, needsDownload: true });
      expect((await by.byedpi.available({ allowDownload: true })).ok).toBe(true);
      shutdown();
    });
    it('is available at once when the helper is already on the computer', async () => {
      const { by, shutdown } = methodsWith({ exe: true });
      expect((await by.byedpi.available({ allowDownload: false })).ok).toBe(true);
      shutdown();
    });
    it('uses a process that is already running as it is: never restarts it', async () => {
      const { by, byedpi, share, shutdown } = methodsWith({ byedpi: fakeByedpi({ running: true }) });
      const test = vi.fn(async () => ({ ok: true }));
      const found = await by.byedpi.find('example.com', test);
      expect(found.route).toEqual({ kind: 'socks5', port: 2000 });
      expect(byedpi.start).not.toHaveBeenCalled();
      expect(share.isUnblockAttached()).toBe(true);
      shutdown();
    });
    it('does not restart a running process when it does not open the site, and says why', async () => {
      const { by, byedpi, shutdown } = methodsWith({ byedpi: fakeByedpi({ running: true }) });
      const found = await by.byedpi.find('example.com', async () => ({ ok: false }));
      expect(found.route).toBe(null);
      expect(found.reason).toMatch(/does not restart it/);
      expect(byedpi.start).not.toHaveBeenCalled();
      shutdown();
    });
    it('sweeps the settings in order and keeps the first that opens the site, with its number', async () => {
      const { by, byedpi, share, shutdown } = methodsWith({ exe: true });
      const tests = [];
      const found = await by.byedpi.find('example.com', async (route) => { tests.push(route.port); return { ok: tests.length === 3 }; });
      expect(byedpi.start.mock.calls.map(c => c[2])).toEqual([0, 1, 2]);
      expect(found.preset).toBe(2);
      expect(share.isUnblockAttached()).toBe(true);
      expect(byedpi.isRunning()).toBe(true);
      shutdown();
      expect(byedpi.isRunning()).toBe(false);
    });
    it('stops the process again when no setting opened the site', async () => {
      const { by, byedpi, share, shutdown } = methodsWith({ exe: true });
      const found = await by.byedpi.find('example.com', async () => ({ ok: false }));
      expect(found.route).toBe(null);
      expect(byedpi.start).toHaveBeenCalledTimes(BYEDPI_PRESETS_TRIED);
      expect(byedpi.isRunning()).toBe(false);
      expect(share.isUnblockAttached()).toBe(false);
      shutdown();
    });
    it('raises the start error when the helper could not be started at all, and leaves nothing behind', async () => {
      const b = fakeByedpi(); b.start = vi.fn(async () => { throw new Error('ByeDPI exited immediately (check ciadpi.log / antivirus)'); });
      const { by, share, shutdown } = methodsWith({ byedpi: b, exe: true });
      await expect(by.byedpi.find('example.com', async () => ({ ok: true }))).rejects.toThrow(/exited immediately/);
      expect(share.isUnblockAttached()).toBe(false);
      shutdown();
    });
    it('restoring a saved site starts the saved setting, or says the helper is missing', async () => {
      const a = methodsWith({ exe: true });
      expect(await a.by.byedpi.restore({ preset: 4 })).toEqual({ kind: 'socks5', port: 2001 });
      expect(a.byedpi.start.mock.calls[0][2]).toBe(4);
      a.shutdown();
      const b = methodsWith({ exe: false });
      await expect(b.by.byedpi.restore({ preset: 4 })).rejects.toThrow(/not on this computer/);
      expect(b.share.isUnblockAttached()).toBe(false);
      b.shutdown();
    });
    it('the helper stops with the last site, not before', async () => {
      const { by, byedpi, shutdown } = methodsWith({ exe: true });
      await by.byedpi.restore({ preset: 0 });
      await by.byedpi.releaseIfUnused(2);
      expect(byedpi.isRunning()).toBe(true);
      await by.byedpi.releaseIfUnused(0);
      expect(byedpi.isRunning()).toBe(false);
      shutdown();
    });
  });
});

describe('the whole thing, with fake network', () => {
  it('a site that only the second way opens is remembered with that way and survives a restart as "always"', async () => {
    const { methods, shutdown } = methodsWith({ exe: true });
    const opens = (route) => route && route.port === 8000;   // only the built-in proxy gets through
    const applied = [];
    const make = () => createUnblock({ methods, request: async (h, route) => ({ ok: opens(route) }), control: async () => ({ ok: true }), resolveHost: async () => '1.1.1.1', applyRoutes: (r) => applied.push(r) });
    const first = make();
    const r = await first.try('blocked.example.com');
    expect(r).toMatchObject({ ok: true, method: 'light' });
    expect(r.steps.map(s => s.id)).toEqual(['doh', 'light']);
    // restart: a new manager, told the saved list
    const second = make();
    const st = await second.sync({ enabled: true, sites: [{ host: 'blocked.example.com', mode: 'always', method: 'light', preset: null }] });
    expect(st.active).toEqual([{ host: 'blocked.example.com', method: 'light', preset: null }]);
    await second.stopAll();
    expect(second.routes()).toEqual([]);
    shutdown();
  });
});

describe('what the Unblock centre cannot do', () => {
  const read = (f) => fs.readFileSync(path.resolve(__dirname, '../..', f), 'utf8').split('\n').filter(l => !/^\s*(\/\/|\*)/.test(l)).join('\n');
  it('does not start Zapret, winws, WinDivert or any other program itself', () => {
    for (const f of ['src/main/unblock.js', 'src/main/unblock-main.js']) {
      const src = read(f);
      expect(src, f).not.toMatch(/child_process|spawn\(|execFile|exec\(|taskkill|Start-Process|runas|elevat/i);
      expect(src, f).not.toMatch(/winws\.exe|windivert\.|zapret\.bat|\.bat['"]/i);
    }
  });
  it('only starts ByeDPI through the shared process module, and leaves the Discord and Roblox bypass settings alone', () => {
    const src = read('src/main/unblock-main.js');
    expect(src).not.toMatch(/startForDiscord|attachRoblox|releaseRoblox|releaseDiscord|setProxy\(\s*\{\s*proxyRules/);
    expect(src).not.toMatch(/persist:discord|persist:roblox/);
  });
  it('is closed in a private window, for the app\'s own window only, with schemas and a preload entry', () => {
    const pol = require('../../src/main/ipc-policy.js');
    for (const ch of ['unblock:assess', 'unblock:try', 'unblock:sync', 'unblock:status']) {
      expect(pol.UI_ONLY_CHANNELS.has(ch), ch).toBe(true);
      expect(read('src/main/ipc-schemas.js')).toContain("define('" + ch + "'");
      expect(read('src/preload.js')).toContain("invoke('" + ch + "'");
    }
    const src = fs.readFileSync(path.resolve(__dirname, '../../src/main/ipc-policy.js'), 'utf8');
    const PD = eval(src.match(/const PRIVATE_DISABLED = (\/.*\/);/)[1]); // eslint-disable-line no-eval
    expect(PD.test('unblock:try')).toBe(true);
    expect(PD.test('unblock:sync')).toBe(true);
  });
  it('is stopped when Vex closes', () => {
    expect(read('src/main.js')).toMatch(/app\.on\('before-quit', \(\) => \{ try \{ _unblock\.shutdown\(\)/);
  });
});

describe('the schemas', () => {
  const { validate } = require('../../src/main/ipc-schemas.js');
  it('take a failed address with its code, a site with options, the list, and no arguments for the status', () => {
    const ok = (c, a) => expect(() => validate(c, a), c).not.toThrow();
    const bad = (c, a) => expect(() => validate(c, a), c).toThrow();
    ok('unblock:assess', ['https://a.example.com/', -101, 'persist:main']);
    ok('unblock:assess', ['https://a.example.com/', -101]);
    bad('unblock:assess', ['https://a.example.com/', 'x', 'persist:main']);
    bad('unblock:assess', ['https://a.example.com/', 12, null]);
    ok('unblock:try', ['a.example.com', { prefer: 'light', allowDownload: true }]);
    ok('unblock:try', ['a.example.com']);
    bad('unblock:try', ['a.example.com', { prefer: 'admin' }]);
    ok('unblock:sync', [{ enabled: true, sites: [{ host: 'a.example.com', mode: 'always', method: 'doh', preset: 2 }] }]);
    bad('unblock:sync', [{ enabled: true, sites: [{ host: 'a.example.com', mode: 'sometimes' }] }]);
    bad('unblock:sync', [{ enabled: true, sites: new Array(201).fill({ host: 'a.example.com', mode: 'ask' }) }]);
    ok('unblock:status', []);
    bad('unblock:status', ['x']);
  });
});

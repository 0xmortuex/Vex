// @vitest-environment node
//
// Fixes of 2026-09-30 (r5), main side:
//   * a session switched to Tor kept its old proxy (often direct) until Tor
//     had started, so pages loaded meanwhile went direct (applyRouting);
//   * a Tor route whose Tor did not start was never marked down: its pages
//     loaded nothing, said nothing, and nothing tried again;
//   * the HTTPS-Only fallback's loadURL rejection went unhandled;
//   * Clear browsing data left the tile-sync joined flag;
//   * a container tab's page was told persist:main's permission decisions;
//   * a closed tab's JavaScript-off back list was kept for half an hour;
//   * a private window could not say that site rules do not apply there;
//   * pdfViewer.test.js read an empty slice of session-security.js.
// main.js cannot be loaded outside Electron, so it is read as text and the
// blocks are run on their own. Verified live as well (scratchpad agents/r5).
import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
const path = require('path');
const { createSessionSecurity } = require('../../src/main/session-security.js');
const { validate } = require('../../src/main/ipc-schemas.js');
const routing = require('../../src/main/routing.js');

const read = f => fs.readFileSync(path.resolve(f), 'utf8').replace(/\r\n/g, '\n');
const MAIN = read('src/main.js');
const between = (from, to) => { const a = MAIN.indexOf(from); const b = MAIN.indexOf(to, a); expect(a).toBeGreaterThan(0); expect(b).toBeGreaterThan(a); return MAIN.slice(a, b); };
const REFUSED = routing.REFUSED_PROXY;

describe('switching a session to Tor', () => {
  const tor = between('const _torSessions = new Set();', "// Every window's \"Tor is running\" indicator");
  const apply = between('async function applyRouting(', "ipcMain.handle('routing:set',");
  function harness({ detect = 0, start } = {}) {
    const sessions = new Map();
    const ses = (p) => { if (!sessions.has(p)) sessions.set(p, { partition: p, calls: [], setProxy: vi.fn(function (c) { this.calls.push(c); return Promise.resolve(); }) }); return sessions.get(p); };
    const launcher = { start: vi.fn(start || (() => Promise.resolve(50123))) };
    const t = new Function('require', 'secureSessions', 'session', 'webContents', 'detectTorPort', '_torLauncher', 'app', 'BROWSING_SESSIONS', '_discordBrowsingProxy',
      'const routingGeneration = new Map();\n' + tor + '\n' + apply + '\nreturn { applyRouting, _torSessions, _useTor };')(
      (m) => { if (m === './main/routing') return routing; throw new Error('unexpected require ' + m); },
      { fromPartition: ses }, { defaultSession: ses('') }, { getAllWebContents: () => [] },
      vi.fn(async () => detect), launcher, { getPath: () => 'C:/tmp' }, ['persist:main'], { mode: 'direct' });
    return { ...t, ses, launcher };
  }

  it('the session refuses everything before Tor is asked for, and until it is up', async () => {
    let finish;
    const h = harness({ start: () => new Promise(r => { finish = r; }) });
    const pending = h.applyRouting('persist:container-work', 'tor');
    await vi.waitFor(() => expect(h.launcher.start).toHaveBeenCalled());
    const s = h.ses('persist:container-work');
    expect(s.calls).toEqual([REFUSED]);            // nothing else while Tor starts
    finish(50123);
    await expect(pending).resolves.toEqual({ mode: 'tor', port: 50123 });
    expect(s.calls).toEqual([REFUSED, { proxyRules: 'socks5://127.0.0.1:50123', proxyBypassRules: '<-loopback>' }]);
    expect(s.__vexTor).toBe(true);
  });

  it('a session already on a live Tor keeps it', async () => {
    const h = harness({ detect: 50123 });
    const s = h.ses('persist:route-tor');
    h._useTor(s, 50123, true);
    await h.applyRouting('persist:route-tor', 'tor');
    expect(s.calls).toEqual([{ proxyRules: 'socks5://127.0.0.1:50123', proxyBypassRules: '<-loopback>' }]);
  });

  it('a Tor that does not start leaves the session refusing and marked down, so its next page starts Tor again', async () => {
    const h = harness({ start: () => Promise.reject(new Error('bootstrap failed')) });
    await expect(h.applyRouting('persist:container-work', 'tor')).rejects.toThrow('bootstrap failed');
    const s = h.ses('persist:container-work');
    expect(s.calls).toEqual([REFUSED]);
    expect(s.__vexTorDown).toBe(true);
    expect(s.__vexTorRevive).toBe(true);
    expect(h._torSessions.has(s)).toBe(true);
  });

  it('a route changed while Tor was starting is left to the newer route', async () => {
    let fail;
    const h = harness({ start: () => new Promise((_r, j) => { fail = j; }) });
    const first = h.applyRouting('persist:container-work', 'tor');
    await vi.waitFor(() => expect(h.launcher.start).toHaveBeenCalled());
    await h.applyRouting('persist:container-work', 'direct');
    fail(new Error('cancelled'));
    await expect(first).rejects.toThrow('cancelled');
    const s = h.ses('persist:container-work');
    expect(s.__vexTorDown).toBe(false);
    expect(s.calls.at(-1)).toEqual({ mode: 'direct' });
  });

  it('a restored Tor route is refused first and its failure reaches applyRouting (so it is marked down)', async () => {
    const setProxy = vi.fn(() => Promise.resolve());
    const applyRouting = vi.fn(() => Promise.reject(new Error('no tor')));
    const report = vi.fn();
    await routing.restoreRoutes({ routes: { 'persist:container-work': { mode: 'tor' } }, getSession: () => ({ setProxy }), applyRouting, report });
    await vi.waitFor(() => expect(report).toHaveBeenCalled());
    expect(setProxy).toHaveBeenCalledWith(REFUSED);
    expect(applyRouting).toHaveBeenCalledWith('persist:container-work', 'tor');
  });
});

describe('HTTPS-Only falling back to http', () => {
  it('handles the load rejecting: -3 is expected, anything else is logged', async () => {
    const block = between("contents.on('did-fail-load', (_e, errorCode, _desc, validatedURL, isMainFrame) => {", "// A clean main-frame load");
    expect(block).not.toContain('try { contents.loadURL(httpUrl); } catch {}');
    const handler = block.slice(block.indexOf('const httpUrl'), block.indexOf("try { if (mainWindow"));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    for (const err of [Object.assign(new Error('ERR_ABORTED (-3) loading'), { errno: -3 }), new Error('ERR_CONNECTION_REFUSED (-102)')]) {
      const contents = { loadURL: vi.fn(() => Promise.reject(err)) };
      new Function('contents', 'u', handler)(contents, new URL('https://plain.example/a?b#c'));
      await new Promise(r => setTimeout(r, 0));
      expect(contents.loadURL).toHaveBeenCalledWith('http://plain.example/a?b#c');
    }
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][1])).toContain('ERR_CONNECTION_REFUSED');
    warn.mockRestore();
  });
});

describe('Clear browsing data', () => {
  it('clears the tile-sync joined flag with the sync records', () => {
    const block = between("ipcMain.handle('browsing:clear-data'", "ipcMain.handle('browsing:clear-history'");
    expect(block).toContain("await dataStore.clear('sync-records', null);");
    expect(block).toContain("await dataStore.clear('sync-tiles-joined', null);");
  });
});

describe('what a tab\'s page is told it may ask', () => {
  const block = between('function _decisionsInForce(decisions) {', '// === WebHID');
  const make = (decisionsFor, pages) => {
    const handlers = {};
    new Function('ipcMain', 'loadPermissionDecisions', 'decisionsFor', 'webContents', block)(
      { handle: (ch, fn) => { handlers[ch] = fn; } }, () => ({}), decisionsFor, { fromId: (id) => pages[id] || null });
    return handlers['permissions:list-for-page'];
  };

  it('comes from the page\'s own session, without decisions that ran out', () => {
    const work = { isDestroyed: () => false, partition: 'persist:container-work' };
    const main = { isDestroyed: () => false, partition: 'persist:main' };
    const stores = {
      'persist:container-work': { 'https://maps.example::geolocation': 'deny', 'https://old.example::notifications': 'allow', __until__: { 'https://old.example::notifications': Date.now() - 1 } },
      'persist:main': { 'https://maps.example::geolocation': 'allow' },
    };
    const list = make((page) => stores[page.partition], { 7: work, 8: main });
    expect(list({}, 7)).toEqual({ 'https://maps.example::geolocation': 'deny' });
    expect(list({}, 8)).toEqual({ 'https://maps.example::geolocation': 'allow' });
    expect(() => list({}, 99)).toThrow('That page is gone');
  });

  it('takes one page id, and only a page of the asking window (TARGET_CHANNELS)', () => {
    expect(() => validate('permissions:list-for-page', [7])).not.toThrow();
    expect(() => validate('permissions:list-for-page', ['7'])).toThrow();
    const policy = read('src/main/ipc-policy.js');
    expect(policy.slice(0, policy.indexOf('const PRIVATE_DISABLED'))).toContain("'permissions:list-for-page'");
  });
});

describe('a private window asking which sites the Tor and proxy rules name', () => {
  const block = between("ipcMain.handle('siteroutes:routed-hosts'", '// === All of Vex through one route');
  const run = (mainWindow) => {
    let handler;
    new Function('ipcMain', 'mainWindow', block)({ handle: (_ch, fn) => { handler = fn; } }, mainWindow);
    return handler();
  };

  it('gets host and mode of the main window\'s Tor and proxy rules, nothing else', async () => {
    const executeJavaScript = vi.fn(async () => [{ host: 'check.torproject.org', mode: 'tor', custom: 'x' }, { host: 'a.example', mode: 'container' }, { host: 'p.example', mode: 'proxy' }]);
    const got = await run({ isDestroyed: () => false, webContents: { executeJavaScript } });
    expect(got).toEqual([{ host: 'check.torproject.org', mode: 'tor' }, { host: 'p.example', mode: 'proxy' }]);
    expect(executeJavaScript.mock.calls[0][0]).toContain('SiteRoutes.rules()');
  });

  it('says so when the main window is closed', async () => {
    await expect(run(null)).rejects.toThrow('main window is closed');
    expect(() => validate('siteroutes:routed-hosts', [])).not.toThrow();
  });
});

describe('a closed tab\'s JavaScript-off back list goes at once', () => {
  function harness() {
    const sessions = new Map();
    const session = { fromPartition: (p) => { if (!sessions.has(p)) sessions.set(p, { partition: p }); return sessions.get(p); } };
    const handlers = {};
    const win = { on: vi.fn(), once: vi.fn(), webContents: { id: 1, on: (ev, fn) => { handlers[ev] = fn; }, send: vi.fn(), setWindowOpenHandler: vi.fn(), isDestroyed: () => false } };
    const all = [{ id: 1, isDestroyed: () => false, getType: () => 'window' }];
    const security = createSessionSecurity({ session, webContents: { getAllWebContents: () => all, fromId: () => null }, root: process.cwd() + '/src' });
    security.registerHost(win);
    let nextId = 10;
    const guest = ({ javascript = true } = {}) => {
      const on = {};
      const g = {
        id: nextId++, session: session.fromPartition('persist:main'),
        isDestroyed: () => false, getType: () => 'webview', hostWebContents: win.webContents,
        getLastWebPreferences: () => ({ javascript }),
        on: (ev, fn) => { (on[ev] = on[ev] || []).push(fn); }, once: (ev, fn) => { (on[ev] = on[ev] || []).push(fn); },
        emit: (ev, ...a) => (on[ev] || []).forEach(fn => fn(...a)),
        navigationHistory: { entries: [], index: -1, getAllEntries: () => g.navigationHistory.entries, getActiveIndex: () => g.navigationHistory.index, restore: vi.fn(() => Promise.resolve()) },
      };
      return g;
    };
    const attach = async (prefs, g) => { handlers['will-attach-webview']({ preventDefault: vi.fn() }, prefs, { partition: 'persist:main' }); all.push(g); handlers['did-attach-webview']({}, g); await Promise.resolve(); };
    const offTab = async () => {
      const off = guest({ javascript: false });
      await attach({}, off);
      off.navigationHistory.entries = [{ url: 'https://off.example/' }]; off.navigationHistory.index = 0;
      off.emit('did-navigate');
      off.emit('destroyed');
      return off;
    };
    return { security, guest, attach, offTab };
  }

  it('the list named by a closed tab is dropped; another window\'s is not; others stay', async () => {
    const h = harness();
    const closed = await h.offTab(), open = await h.offTab();
    h.security.forgetHistories(2, [open.id]);           // not this window's
    h.security.forgetHistories(1, [closed.id]);
    const a = h.guest(), b = h.guest();
    await h.attach({ vexHistoryFrom: String(closed.id) }, a);
    await h.attach({ vexHistoryFrom: String(open.id) }, b);
    expect(a.navigationHistory.restore).not.toHaveBeenCalled();
    expect(b.navigationHistory.restore).toHaveBeenCalled();
  });

  it('main is told by the window the tab was in', () => {
    const block = between("ipcMain.on('tabs:closed'", '// === [Vex URL]');
    const forgetHistories = vi.fn();
    const handlers = {};
    new Function('ipcMain', 'secureSessions', block)({ on: (ch, fn) => { handlers[ch] = fn; } }, { owner: (s) => (s.id === 5 ? { win: { webContents: { id: 5 } } } : null), forgetHistories });
    handlers['tabs:closed']({ sender: { id: 5 } }, [11, 12]);
    handlers['tabs:closed']({ sender: { id: 6 } }, [13]);
    expect(forgetHistories.mock.calls).toEqual([[5, [11, 12]]]);
    expect(() => validate('tabs:closed', [[11, 12]])).not.toThrow();
    expect(() => validate('tabs:closed', [['x']])).toThrow();
  });
});

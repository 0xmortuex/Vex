// @vitest-environment node
//
// Fixes of 2026-09-30 (r2-priv): a session routed through an ordinary proxy
// gets WebRTC locked like a Tor one; Vex's own Tor stops once nothing uses
// it, and says when it starts and stops; About's DRM line is plain words.
// main.js cannot be loaded outside Electron, so it is read as text where a
// module cannot stand in for it.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
const path = require('path');

const { markRoutedSession, torInUse } = require('../../src/main/routing.js');

const read = f => fs.readFileSync(path.resolve(f), 'utf8').replace(/\r\n/g, '\n');
const MAIN = read('src/main.js');
const page = (ses, destroyed = false) => ({ session: ses, isDestroyed: () => destroyed, setWebRTCIPHandlingPolicy: vi.fn() });

describe('WebRTC in a session routed through a proxy', () => {
  it('a proxy route locks the pages open in that session, and marks it routed but not Tor', () => {
    const ses = {}, other = {};
    const mine = page(ses), elsewhere = page(other);
    markRoutedSession(ses, 'proxy', [mine, elsewhere]);
    expect(ses.__vexRouted).toBe(true);
    expect(ses.__vexTor).toBe(false);
    expect(mine.setWebRTCIPHandlingPolicy).toHaveBeenCalledWith('disable_non_proxied_udp');
    expect(elsewhere.setWebRTCIPHandlingPolicy).not.toHaveBeenCalled();
  });

  it('direct undoes it; an unknown route is refused', () => {
    const ses = { __vexRouted: true, __vexTor: true };
    const mine = page(ses);
    markRoutedSession(ses, 'direct', [mine]);
    expect(ses.__vexRouted).toBe(false);
    expect(ses.__vexTor).toBe(false);
    expect(mine.setWebRTCIPHandlingPolicy).toHaveBeenCalledWith('default');
    expect(() => markRoutedSession(ses, 'vpn', [])).toThrow(/Unknown route/);
  });

  it('applyRouting marks each route, and pages opened later in a proxied session are locked', () => {
    const fn = MAIN.slice(MAIN.indexOf('async function applyRouting('), MAIN.indexOf("ipcMain.handle('routing:set'"));
    expect(fn).toContain("markRoutedSession(ses, 'proxy'");
    expect(fn).toContain("markRoutedSession(ses, 'direct'");
    const handler = MAIN.slice(MAIN.indexOf("app.on('web-contents-created', (_event, contents) => {\n  // Tor tabs"));
    expect(handler).toContain("(contents.session.__vexTor || contents.session.__vexRouted)) contents.setWebRTCIPHandlingPolicy('disable_non_proxied_udp')");
  });
});

describe('whether Tor is still in use', () => {
  const tor = { __vexTor: true }, plain = {};
  it('a page in a Tor session keeps it; a closed one does not', () => {
    expect(torInUse([page(plain), page(tor)], {})).toBe(true);
    expect(torInUse([page(plain), page(tor, true)], {})).toBe(false);
    expect(torInUse([], {})).toBe(false);
  });
  it('a saved Tor route keeps it (Vex restores it at the next start); a proxy route does not', () => {
    expect(torInUse([], { 'persist:container-x': { mode: 'tor', custom: null }, __vexPreferenceStore: 1 })).toBe(true);
    expect(torInUse([], { __all__: { mode: 'tor' } })).toBe(true);
    expect(torInUse([], { 'persist:container-x': { mode: 'proxy', custom: 'socks5://h:1' }, __vexPreferenceStore: 1 })).toBe(false);
  });
});

describe('main stops its own Tor when nothing uses it', () => {
  it('after a 30 s grace, re-checked when the timer fires, and only Vex\'s own Tor', () => {
    const at = MAIN.indexOf('const TOR_IDLE_GRACE_MS = 30000;');
    expect(at).toBeGreaterThan(0);
    const block = MAIN.slice(at, at + 2400);
    expect(block).toContain("require('./main/routing').torInUse(webContents.getAllWebContents(), readRouting())");
    expect(block).toContain('if (!_torLauncher.isRunning() || _torStillNeeded()) {');
    expect(block).toContain('if (_torLauncher.isRunning() && !_torStillNeeded()) _torLauncher.stop();');
    expect(block).toContain("w.webContents.send('tor:state', { running })");
    expect(block).toContain("ipcMain.handle('tor:stop', () => { _torLauncher.stop(); return { ok: true }; });");
    expect(block).toContain("ipcMain.handle('tor:status'");
  });

  it('is re-checked when a page opens or closes, after a Tor tab is made, and after a route changes', () => {
    const handler = MAIN.slice(MAIN.indexOf("app.on('web-contents-created', (_event, contents) => {\n  // Tor tabs"));
    const hook = handler.slice(0, handler.indexOf("if (type !== 'webview') return;"));
    expect(hook).toContain('if (contents.session && contents.session.__vexTor) _torIdleCheck();');
    expect(hook).toContain("contents.once('destroyed', () => { if (_torLauncher.isRunning()) setImmediate(_torIdleCheck); });");
    const create = MAIN.slice(MAIN.indexOf("ipcMain.handle('tor:create'"), MAIN.indexOf("ipcMain.handle('tor:verify'"));
    expect(create).toMatch(/_torIdleCheck\(\);\n\s+return \{ ok: true, partition: part, port, launched \};/);
    const set = MAIN.slice(MAIN.indexOf("ipcMain.handle('routing:set',"), MAIN.indexOf("ipcMain.handle('routing:get',"));
    expect(set).toContain('_torIdleCheck();');
    const setAll = MAIN.slice(MAIN.indexOf("ipcMain.handle('routing:set-all'"), MAIN.indexOf("ipcMain.handle('routing:get-all'"));
    expect(setAll).toContain('_torIdleCheck();');
  });

  it('the channels have payload contracts and are in the preload', () => {
    const { validate } = require('../../src/main/ipc-schemas.js');
    expect(() => validate('tor:status', [])).not.toThrow();
    expect(() => validate('tor:stop', [])).not.toThrow();
    expect(() => validate('tor:stop', ['x'])).toThrow();
    const preload = read('src/preload.js');
    expect(preload).toContain("torStatus: () => ipcRenderer.invoke('tor:status'),");
    expect(preload).toContain("stopTor: () => ipcRenderer.invoke('tor:stop'),");
    expect(preload).toContain("ipcRenderer.on('tor:state', h)");
  });
});

describe('the Tor launcher says when Tor starts and stops', () => {
  const cp = require('child_process');
  const realSpawn = cp.spawn;
  const LAUNCHER = require.resolve('../../src/tor-launcher.js');
  let dir, spawned;
  const tick = () => new Promise(r => setTimeout(r, 5));
  function fakeTor() {
    const proc = new EventEmitter();
    proc.stdout = new PassThrough(); proc.stderr = new PassThrough();
    proc.kill = vi.fn();
    return proc;
  }
  function load() {
    delete require.cache[LAUNCHER];
    const archive = require.resolve('../../src/main/archive-security.js');
    const real = require(archive);
    require.cache[archive].exports = { ...real, verifyDigest: () => {} };
    return require(LAUNCHER);
  }
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vex-r2-tor-'));
    fs.mkdirSync(path.join(dir, 'tor', 'tor'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'tor', 'tor', 'tor.exe'), 'exe');
    spawned = [];
    cp.spawn = vi.fn(() => { const p = fakeTor(); spawned.push(p); return p; });
  });
  afterEach(() => {
    cp.spawn = realSpawn;
    delete require.cache[LAUNCHER];
    delete require.cache[require.resolve('../../src/main/archive-security.js')];
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('running as soon as tor.exe runs, stopped on Stop', async () => {
    const tor = load();
    const seen = [];
    tor.onStateChange(r => seen.push(r));
    const run = tor.start(dir);
    for (let i = 0; i < 50 && !spawned.length; i++) await tick();
    // Said before it has connected: a slow bootstrap kept the indicator (and
    // its Stop) hidden (found 2026-09-30).
    expect(seen).toEqual([true]);
    spawned[0].stdout.write('Bootstrapped 100% (done): Done\n');
    await run;
    expect(seen).toEqual([true]);
    tor.stop();
    expect(seen).toEqual([true, false]);
    tor.stop();                               // nothing running: nothing to say
    expect(seen).toEqual([true, false]);
  });

  it('stopped when Tor exits on its own', async () => {
    const tor = load();
    const seen = [];
    tor.onStateChange(r => seen.push(r));
    const run = tor.start(dir);
    for (let i = 0; i < 50 && !spawned.length; i++) await tick();
    spawned[0].stdout.write('Bootstrapped 100% (done): Done\n');
    await run;
    spawned[0].emit('exit', 1);
    expect(seen).toEqual([true, false]);
    expect(tor.isRunning()).toBe(false);
  });
});

describe("About's DRM line", () => {
  const src = MAIN.slice(MAIN.indexOf('function widevineStatusText('), MAIN.indexOf('// Initialize the castLabs Widevine CDM'));
  const widevineStatusText = new Function(src + '\nreturn widevineStatusText;')();
  const ID = 'oimompecagnajdejgnnjijobebaeigek';

  it('is plain words, not the component JSON', () => {
    expect(widevineStatusText({ [ID]: { status: 'up-to-date', title: 'Widevine Content Decryption Module', version: '4.10.2891.0' } }, ID)).toBe('Widevine ready (version 4.10.2891.0)');
    expect(widevineStatusText({ [ID]: { status: 'new', title: 'Widevine Content Decryption Module', version: null } }, ID)).toBe('not available — Widevine is not installed (new)');
    expect(widevineStatusText({}, ID)).toBe('not available — the Widevine component is not registered');
    expect(widevineStatusText(null, ID)).toBe('not available — the Widevine component is not registered');
  });

  it('is what main reports', () => {
    expect(MAIN).toContain('? widevineStatusText(st, components.WIDEVINE_CDM_ID)');
    expect(MAIN).not.toContain('JSON.stringify(st)');
  });
});

// @vitest-environment node
//
// Fixes of 2026-09-29 around Tor (fin7): a link opened in a new tab from a
// Tor / burner / private / container tab stays in that session, a session
// routed through Tor (a burner over Tor, a Tor container) gets WebRTC locked
// like a Tor tab, Cancel during Tor's download really cancels, updater errors
// come through in plain words, and the New Tor Tab hint no longer says Tor
// has to be running already. main.js cannot be loaded outside Electron, so it
// is read as text where a module cannot stand in for it.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
const path = require('path');

const { keepsOpenerSession, markTorSession } = require('../../src/main/routing.js');
const { plainUpdateError, bindUpdater } = require('../../src/main/updates.js');

const read = f => fs.readFileSync(path.resolve(f), 'utf8').replace(/\r\n/g, '\n');
const MAIN = read('src/main.js');

describe('a new tab from a page keeps a private session', () => {
  it('Tor, burner, private-window, container and routed-site sessions are kept', () => {
    for (const p of ['tor-mun3czzk-d6hc', 'otr-burner-mun3ldjr', 'private:1b2c', 'persist:container-work', 'persist:container-tor-x', 'persist:route-tor', 'persist:route-proxy-1k'])
      expect(keepsOpenerSession(p), p).toBe(true);
  });

  it('the ordinary session and the app sessions open links as before', () => {
    for (const p of ['persist:main', 'persist:discord', 'persist:spotify', '', undefined, null, 42])
      expect(keepsOpenerSession(p), String(p)).toBe(false);
  });

  it('target=_blank / middle-click hands the opener session to the new tab, in the opener window', () => {
    const at = MAIN.indexOf("win.webContents.send('tab:create-from-external', {\n            url,");
    expect(at).toBeGreaterThan(0);
    const block = MAIN.slice(at - 1200, at + 600);
    expect(block).toContain("partition: require('./main/routing').keepsOpenerSession(openerPartition) ? openerPartition : undefined");
    expect(block).toContain('const host = secureSessions.owner(contents);');
  });

  it("a popup's Open as tab keeps its session too", () => {
    const at = MAIN.indexOf("action === 'open-as-tab'");
    expect(MAIN.slice(at, at + 700)).toContain('keepsOpenerSession(partition) ? partition : undefined');
  });
});

describe('WebRTC in a session routed through Tor', () => {
  const page = (ses, destroyed = false) => ({ session: ses, isDestroyed: () => destroyed, setWebRTCIPHandlingPolicy: vi.fn() });

  it('marks the session and locks the pages already open in it, and only those', () => {
    const ses = {}, other = {};
    const mine = page(ses), gone = page(ses, true), elsewhere = page(other);
    markTorSession(ses, true, [mine, gone, elsewhere]);
    expect(ses.__vexTor).toBe(true);
    expect(mine.setWebRTCIPHandlingPolicy).toHaveBeenCalledWith('disable_non_proxied_udp');
    expect(gone.setWebRTCIPHandlingPolicy).not.toHaveBeenCalled();
    expect(elsewhere.setWebRTCIPHandlingPolicy).not.toHaveBeenCalled();
  });

  it('going direct again undoes both', () => {
    const ses = { __vexTor: true };
    const mine = page(ses);
    markTorSession(ses, false, [mine]);
    expect(ses.__vexTor).toBe(false);
    expect(mine.setWebRTCIPHandlingPolicy).toHaveBeenCalledWith('default');
  });

  it('applyRouting marks for Tor before Tor starts, and unmarks for a proxy or direct', () => {
    const fn = MAIN.slice(MAIN.indexOf('async function applyRouting('), MAIN.indexOf("ipcMain.handle('routing:set'"));
    const tor = fn.indexOf("markTorSession(ses, true");
    expect(tor).toBeGreaterThan(0);
    expect(tor).toBeLessThan(fn.indexOf('await detectTorPort()'));
    expect(fn.match(/markTorSession\(ses, false/g)).toHaveLength(2);
  });

  it('the lock is applied before the webview-only part, so a popup window of a Tor page gets it', () => {
    const handler = MAIN.slice(MAIN.indexOf("app.on('web-contents-created', (_event, contents) => {\n  // Tor tabs"));
    expect(handler.indexOf("setWebRTCIPHandlingPolicy('disable_non_proxied_udp')")).toBeGreaterThan(0);
    expect(handler.indexOf("setWebRTCIPHandlingPolicy('disable_non_proxied_udp')")).toBeLessThan(handler.indexOf("if (type !== 'webview') return;"));
  });
});

// tor-launcher with https, child_process and (optionally) the digest checks
// replaced, loaded fresh each time.
describe('Cancel while Tor is downloading', () => {
  const https = require('https');
  const cp = require('child_process');
  const realGet = https.get, realSpawn = cp.spawn;
  const LAUNCHER = require.resolve('../../src/tor-launcher.js');
  const ARCHIVE = require.resolve('../../src/main/archive-security.js');
  let dir, gets, spawned, extractGate;

  function load({ fakeDigest = true } = {}) {
    delete require.cache[LAUNCHER];
    delete require.cache[ARCHIVE];
    if (fakeDigest) {
      const real = require(ARCHIVE);
      require.cache[ARCHIVE].exports = {
        ...real,
        verifyDigest: () => {},
        extractTar: async (_tgz, into) => {
          if (extractGate) await extractGate.promise;
          fs.mkdirSync(path.join(into, 'tor'), { recursive: true });
          fs.writeFileSync(path.join(into, 'tor', 'tor.exe'), 'exe');
        },
      };
    }
    return require(LAUNCHER);
  }

  // One download: a response that sends `size` bytes in chunks as `pump` is called.
  function serve(size = 2000000) {
    https.get = (url, opts, cb) => {
      const req = new EventEmitter();
      req.destroyed = false;
      req.destroy = (err) => { req.destroyed = true; process.nextTick(() => { req.emit('error', err); res.complete = false; res.emit('close'); }); };
      req.setTimeout = () => {};
      const res = new PassThrough();
      res.statusCode = 200; res.headers = { 'content-length': String(size) }; res.complete = false;
      gets.push({ url, req, res, size, sent: 0 });
      process.nextTick(() => cb(res));
      return req;
    };
  }
  function pump(g, bytes) {
    g.res.write(Buffer.alloc(bytes)); g.sent += bytes;
    if (g.sent >= g.size) { g.res.complete = true; g.res.end(); }
  }
  const tick = () => new Promise(r => setTimeout(r, 5));

  function fakeTor() {
    const proc = new EventEmitter();
    proc.stdout = new PassThrough(); proc.stderr = new PassThrough();
    proc.kill = vi.fn(() => { process.nextTick(() => proc.emit('exit', 1)); });
    return proc;
  }

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vex-fin7-tor-'));
    gets = []; spawned = []; extractGate = null;
    cp.spawn = vi.fn(() => { const p = fakeTor(); spawned.push(p); return p; });
    serve();
  });
  afterEach(() => {
    https.get = realGet; cp.spawn = realSpawn;
    delete require.cache[LAUNCHER]; delete require.cache[ARCHIVE];
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('stops the download, says cancelled, spawns nothing and leaves nothing behind; the next start downloads afresh', async () => {
    const tor = load();
    const progress = [];
    const first = tor.start(dir, (phase, v) => progress.push([phase, v]));
    await tick();
    pump(gets[0], 500000);
    await tick();
    expect(progress.some(([p, v]) => p === 'download' && v > 0 && v < 1)).toBe(true);
    tor.stop();
    await expect(first).rejects.toThrow('cancelled');
    expect(gets[0].req.destroyed).toBe(true);
    expect(cp.spawn).not.toHaveBeenCalled();
    expect(fs.existsSync(path.join(dir, 'tor', 'teb.tar.gz'))).toBe(false);
    expect(fs.existsSync(path.join(dir, 'tor', 'tor', 'tor.exe'))).toBe(false);

    const second = tor.start(dir);
    await tick();
    expect(gets).toHaveLength(2);
    pump(gets[1], 2000000);
    for (let i = 0; i < 50 && !spawned.length; i++) await tick();
    expect(spawned).toHaveLength(1);
    spawned[0].stdout.write('Sep 29 [notice] Bootstrapped 100% (done): Done\n');
    await expect(second).resolves.toBeGreaterThan(0);
    expect(tor.isRunning()).toBe(true);
    tor.stop();
  });

  it('a cancel after the download (while it unpacks) still gives up before Tor is started', async () => {
    const tor = load();
    let open; extractGate = { promise: new Promise(r => { open = r; }) };
    const run = tor.start(dir);
    await tick();
    pump(gets[0], 2000000);
    await tick(); await tick();
    tor.stop();
    open();
    await expect(run).rejects.toThrow('cancelled');
    expect(cp.spawn).not.toHaveBeenCalled();
  });

  it('a download cut short fails the integrity check rather than being used', async () => {
    const tor = load({ fakeDigest: false });
    const run = tor.start(dir);
    await tick();
    pump(gets[0], 2000000); // the right size, the wrong bytes
    await expect(run).rejects.toThrow('Artifact integrity verification failed');
    expect(cp.spawn).not.toHaveBeenCalled();
  });

  it('a second caller joins the start in flight and hears its progress, rather than cancelling it', async () => {
    const tor = load();
    const a = [], b = [];
    const one = tor.start(dir, (p, v) => a.push(v));
    const two = tor.start(dir, (p, v) => b.push(v));
    expect(two).toBe(one);
    await tick();
    expect(gets).toHaveLength(1);
    pump(gets[0], 1000000);
    await tick();
    expect(a.length).toBeGreaterThan(0);
    expect(b).toEqual(a);
    tor.stop();
    await expect(one).rejects.toThrow('cancelled');
  });

  it("a cancelled Tor exiting late does not stop the Tor started after it", async () => {
    fs.mkdirSync(path.join(dir, 'tor', 'tor'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'tor', 'tor', 'tor.exe'), 'exe');
    const kills = [];
    cp.spawn = vi.fn(() => { const p = fakeTor(); p.kill = vi.fn(() => kills.push(p)); spawned.push(p); return p; });
    const tor = load();
    const first = tor.start(dir);
    for (let i = 0; i < 50 && !spawned.length; i++) await tick();
    tor.stop();                       // Cancel mid-bootstrap; its exit comes later
    const second = tor.start(dir);
    for (let i = 0; i < 50 && spawned.length < 2; i++) await tick();
    kills[0].emit('exit', 1);         // the first Tor finally exits
    await expect(first).rejects.toThrow('cancelled');
    spawned[1].stdout.write('Bootstrapped 100% (done): Done\n');
    await expect(second).resolves.toBeGreaterThan(0);
    expect(tor.isRunning()).toBe(true);
    expect(spawned[1].kill).not.toHaveBeenCalled();
    tor.stop();
  });

  it('main still reports a cancelled start as cancelled', () => {
    expect(MAIN).toContain("ipcMain.handle('tor:cancel', () => { _torCancelled = true; _torLauncher.stop(); return { ok: true }; });");
  });
});

describe('updater errors in plain words', () => {
  it('a signature failure says so, without PowerShell JSON or the installer path', () => {
    const raw = 'New version 9.9.9 is not signed by the application owner: publisherNames: 0xmortuex, raw info: { "SignerCertificate": null, "Status": 1, "Path": "C:\\\\Users\\\\USER\\\\AppData\\\\Local\\\\vex-updater\\\\pending\\\\temp-Vex-Setup-9.9.9.exe" }';
    const out = plainUpdateError(Object.assign(new Error(raw), { code: 'ERR_UPDATER_INVALID_SIGNATURE' }));
    expect(out).toMatch(/not signed/);
    expect(out).not.toMatch(/Users|SignerCertificate|\{/);
  });

  it('a damaged download and a download before any check', () => {
    expect(plainUpdateError(new Error('sha512 checksum mismatch, expected SoDN1K==, got 1yQj=='))).toMatch(/damaged/);
    expect(plainUpdateError(new Error('sha512 checksum mismatch, expected SoDN1K==, got 1yQj=='))).not.toMatch(/SoDN1K/);
    expect(plainUpdateError(new Error('Please check update first'))).toMatch(/Check for updates, then download/);
  });

  it('anything else: its first line, with Windows paths taken out, and short', () => {
    expect(plainUpdateError(new Error('network is down'))).toBe('network is down');
    expect(plainUpdateError(new Error('ENOENT: open C:\\Users\\USER\\x\\latest.yml\n    at stack'))).toBe('ENOENT: open (file)');
    expect(plainUpdateError(new Error('x'.repeat(500))).length).toBe(200);
    expect(plainUpdateError(null)).toBe('unknown');
  });

  it('reaches the window mapped, and the download IPC answers mapped too', () => {
    const listeners = {};
    const sent = [];
    bindUpdater({ on: (e, fn) => { listeners[e] = fn; }, removeListener() {} },
      () => ({ isDestroyed: () => false, webContents: { send: (c, p) => sent.push(p) } }));
    listeners.error(new Error('Please check update first'));
    expect(sent[0].message).toMatch(/has not checked/);
    expect(MAIN).toContain("return { ok: false, error: require('./main/updates').plainUpdateError(e) };");
  });
});

describe('the New Tor Tab hint', () => {
  it('no longer says Tor has to be running', () => {
    const cmd = read('src/renderer/js/command.js');
    const line = cmd.split('\n').find(l => l.includes("id: 'tor', label: 'New Tor Tab'"));
    expect(line).not.toMatch(/needs Tor running/);
    expect(line).toMatch(/Vex downloads and starts Tor/);
  });
});

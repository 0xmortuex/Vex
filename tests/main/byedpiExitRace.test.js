// @vitest-environment node
//
// src/byedpi.js gives each spawned ciadpi an exit handler. stop() kills the old
// process and start() spawns a new one (the auto-configure sweep does this for
// every preset). The OS reports the old process's exit a little later — and
// that late exit used to wipe the NEW process's bookkeeping: isRunning() went
// false, getPort() 0, and the next stop() could not kill the new process, so
// ciadpi.exe was left running for ever. The spawn here is fake: nothing real
// is started and nothing touches the network beyond a loopback listener.
import { describe, it, expect, afterEach } from 'vitest';
import { createRequire } from 'module';
import fs from 'fs';
import os from 'os';
import path from 'path';
import net from 'net';
import { EventEmitter } from 'events';

const require = createRequire(import.meta.url);
const SRC = path.resolve(__dirname, '../../src');

const live = new Set();
const procs = [];
function makeSpawn(exitDelayMs) {
  return (exe, args) => {
    const port = Number(args[args.indexOf('-p') + 1]);
    const proc = new EventEmitter();
    procs.push(proc);
    const srv = net.createServer(c => c.destroy());
    srv.listen(port, '127.0.0.1');
    live.add(srv);
    let killed = false;
    proc.kill = () => {
      if (killed) return true;
      killed = true;
      srv.close(); live.delete(srv);
      setTimeout(() => proc.emit('exit', 1), exitDelayMs);   // the OS reports the exit a little later
      return true;
    };
    return proc;
  };
}

function loadByedpi(exitDelayMs) {
  const cp = require('child_process');
  const sec = require(path.join(SRC, 'main/archive-security.js'));
  const realSpawn = cp.spawn, realVerify = sec.verifyDigest;
  cp.spawn = makeSpawn(exitDelayMs);
  sec.verifyDigest = () => {};                              // the dummy exe below is not the real ciadpi
  const key = require.resolve(path.join(SRC, 'byedpi.js'));
  delete require.cache[key];
  try { return require(key); }                               // destructures spawn/verifyDigest now
  finally { cp.spawn = realSpawn; sec.verifyDigest = realVerify; }
}

function userDir() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'vex-byedpi-test-'));
  fs.mkdirSync(path.join(d, 'byedpi'));
  fs.writeFileSync(path.join(d, 'byedpi', 'ciadpi.exe'), 'not really an exe');
  return d;
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

describe('byedpi start() after start() (auto-configure sweep, preset to preset)', () => {
  afterEach(() => { for (const s of live) s.close(); live.clear(); });

  it('keeps tracking the NEW process when the old one exits late', async () => {
    const b = loadByedpi(40);
    const dir = userDir();
    await b.start(dir, null, 0);
    const p2 = await b.start(dir, null, 1);
    await sleep(120);                    // the first process's exit event has now arrived
    expect(b.isRunning()).toBe(true);
    expect(b.getPort()).toBe(p2);
    b.stop();
  });

  it('stop() ends every process it started (no orphaned ciadpi)', async () => {
    const b = loadByedpi(40);
    const dir = userDir();
    await b.start(dir, null, 0);
    await b.start(dir, null, 1);
    await sleep(120);
    b.stop();
    await sleep(80);
    expect(live.size).toBe(0);
  });

  it('the live process exiting by itself is still noticed', async () => {
    const b = loadByedpi(0);
    const dir = userDir();
    await b.start(dir, null, 0);
    const [srv] = [...live];
    expect(b.isRunning()).toBe(true);
    // Simulate ciadpi dying on its own (antivirus, crash): kill it behind byedpi's back.
    srv.close(); live.delete(srv);
    procs[procs.length - 1].emit('exit', 1);
    expect(b.isRunning()).toBe(false);
    expect(b.getPort()).toBe(0);
  });
});

// Found 2026-11-12 on the owner's PC: two ciadpi.exe under one Vex. At launch the window replays the
// saved Discord mode and the saved Roblox bypass within milliseconds. Both got past stop() before
// either had spawned, both spawned, and only the second was tracked: nothing ever stopped the first.
describe('byedpi start() while another start() has not finished (launch: Discord, then Roblox)', () => {
  afterEach(() => { for (const s of live) s.close(); live.clear(); });

  it('starts ONE process and gives both callers its port', async () => {
    const b = loadByedpi(0);
    const dir = userDir();
    const before = procs.length;
    const [p1, p2] = await Promise.all([b.start(dir, null, 0), b.start(dir, null, 0)]);
    expect(procs.length - before).toBe(1);
    expect(p2).toBe(p1);
    expect(b.getPort()).toBe(p1);
    b.stop();
    await sleep(40);
    expect(live.size).toBe(0);           // and stop() ends everything that was started
  });

  it('settled() waits for the start in flight, so "is one running?" can be asked after it', async () => {
    const b = loadByedpi(0);
    const dir = userDir();
    const first = b.start(dir, null, 0);
    expect(b.isRunning()).toBe(false);   // the gap the second caller used to fall into
    await b.settled();
    expect(b.isRunning()).toBe(true);
    expect(b.getPort()).toBe(await first);
    b.stop();
  });

  it('settled() resolves at once when nothing is starting', async () => {
    const b = loadByedpi(0);
    await expect(b.settled()).resolves.toBeUndefined();
  });

  it('a start that fails is reported to its own caller only, and the next start still works', async () => {
    const b = loadByedpi(0);
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'vex-byedpi-test-'));   // no ciadpi.exe, and the download gives nothing
    const failing = b.start(empty, async () => null, 0);
    await expect(b.settled()).resolves.toBeUndefined();
    await expect(failing).rejects.toThrow(/download failed/);
    const port = await b.start(userDir(), null, 0);
    expect(b.getPort()).toBe(port);
    b.stop();
  });

  it('main.js lets the Roblox bypass wait for a start in flight before it looks for one to reuse', () => {
    const src = fs.readFileSync(path.join(SRC, 'main.js'), 'utf8');
    const start = src.indexOf('async function _applyRobloxBypass(');
    const body = src.slice(start, src.indexOf('async function _applyDiscordBypass(', start));
    expect(body.indexOf('await _byedpi.settled();')).toBeGreaterThan(-1);
    expect(body.indexOf('await _byedpi.settled();')).toBeLessThan(body.indexOf('_share.reuseExisting()'));
  });
});

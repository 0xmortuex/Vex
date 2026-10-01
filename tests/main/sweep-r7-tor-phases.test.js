// @vitest-environment node
//
// r7 (2026-09-30): starting Tor again (a Tor route's next page) showed
// "Downloading Tor 100%" though Tor was already on disk: the launcher said
// download 1 on every start. A download is said only when there is one, and
// the start of Tor itself is said at once ("Starting Tor"), so the dialog
// shows the phase that is really going on. Checked live as well (scratchpad
// agents/r7 p1-tor.js: first start and revive, Tor on disk).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
const path = require('path');

const https = require('https');
const cp = require('child_process');
const realGet = https.get, realSpawn = cp.spawn;
const LAUNCHER = require.resolve('../../src/tor-launcher.js');
const ARCHIVE = require.resolve('../../src/main/archive-security.js');
let dir, gets, spawned;

function load() {
  delete require.cache[LAUNCHER];
  delete require.cache[ARCHIVE];
  const real = require(ARCHIVE);
  require.cache[ARCHIVE].exports = {
    ...real,
    verifyDigest: () => {},
    extractTar: async (_tgz, into) => {
      fs.mkdirSync(path.join(into, 'tor'), { recursive: true });
      fs.writeFileSync(path.join(into, 'tor', 'tor.exe'), 'exe');
    },
  };
  return require(LAUNCHER);
}
function fakeTor() {
  const proc = new EventEmitter();
  proc.stdout = new PassThrough(); proc.stderr = new PassThrough();
  proc.kill = vi.fn(() => { process.nextTick(() => proc.emit('exit', 1)); });
  return proc;
}
const tick = () => new Promise(r => setTimeout(r, 5));
// The launcher makes its folder before it asks for the archive; on a slow
// disk (CI) one tick is not enough for the request to exist yet.
const started = async (n) => {
  for (let i = 0; i < 400 && gets.length < n; i++) await tick();
  if (gets.length < n) throw new Error('the download never started');
};

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vex-r7-tor-'));
  gets = []; spawned = [];
  cp.spawn = vi.fn(() => { const p = fakeTor(); spawned.push(p); return p; });
  https.get = (url, opts, cb) => {
    const req = new EventEmitter();
    req.destroy = () => {}; req.setTimeout = () => {};
    const res = new PassThrough();
    res.statusCode = 200; res.headers = { 'content-length': '2000000' }; res.complete = false;
    gets.push({ req, res });
    process.nextTick(() => cb(res));
    return req;
  };
});
afterEach(() => {
  https.get = realGet; cp.spawn = realSpawn;
  delete require.cache[LAUNCHER]; delete require.cache[ARCHIVE];
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('the phases a Tor start reports', () => {
  it('Tor already on disk: no download at all, "starting" at once, then Tor\'s own bootstrap', async () => {
    fs.mkdirSync(path.join(dir, 'tor', 'tor'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'tor', 'tor', 'tor.exe'), 'exe');
    const tor = load();
    const progress = [];
    const run = tor.start(dir, (phase, value, detail) => progress.push([phase, value, detail]));
    for (let i = 0; i < 50 && !spawned.length; i++) await tick();
    expect(gets).toHaveLength(0);
    expect(progress).toEqual([['bootstrap', 0, 'starting']]);
    spawned[0].stdout.write('Bootstrapped 5% (conn): Connecting to a relay\nBootstrapped 100% (done): Done\n');
    await expect(run).resolves.toBeGreaterThan(0);
    expect(progress.map(p => p[0])).not.toContain('download');
    expect(progress.at(-1)).toEqual(['bootstrap', 100, 'done']);
    tor.stop();
  });

  it('Tor not on disk yet: the download is said from its first byte to its end, then the start', async () => {
    const tor = load();
    const progress = [];
    const run = tor.start(dir, (phase, value, detail) => progress.push([phase, value, detail]));
    await started(1);
    expect(progress).toEqual([['download', 0, undefined]]);
    gets[0].res.write(Buffer.alloc(1000000));
    await tick();
    gets[0].res.write(Buffer.alloc(1000000)); gets[0].res.complete = true; gets[0].res.end();
    for (let i = 0; i < 50 && !spawned.length; i++) await tick();
    const phases = progress.map(p => p[0]);
    expect(phases.lastIndexOf('download')).toBeLessThan(phases.indexOf('bootstrap'));
    expect(progress.filter(p => p[0] === 'download').at(-1)[1]).toBe(1);
    expect(progress.find(p => p[0] === 'bootstrap')).toEqual(['bootstrap', 0, 'starting']);
    spawned[0].stdout.write('Bootstrapped 100% (done): Done\n');
    await expect(run).resolves.toBeGreaterThan(0);
    tor.stop();
  });
});

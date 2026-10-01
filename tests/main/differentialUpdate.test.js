// @vitest-environment node
//
// Smaller updates (src/main/differential.js + src/main/updates.js): with the
// installer of the running version kept in userData/updates, only the blocks
// of the new installer that changed are downloaded (HTTP Range), the rest is
// copied, and the whole file must still match latest.yml's sha512 and size.
// Anything that goes wrong on that path falls back to the whole installer,
// once. The blockmaps are made by electron-builder's own builder, so the
// format is the real one.
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

const { createUpdater } = require('../../src/main/updates.js');
const { parseBlockMap, planDownload } = require('../../src/main/differential.js');
const { buildBlockMap } = require('app-builder-lib/out/targets/blockmap/blockmap.js');

const sha = buf => crypto.createHash('sha512').update(buf).digest('base64');
const GH = 'https://github.com/0xmortuex/Vex/releases';
const GH_YML = GH + '/latest/download/latest.yml';
const GH_EXE = GH + '/download/v2.35.1/Vex-Setup.exe';
const GH_NEW_MAP = GH + '/download/v2.35.1/Vex-Setup.exe.blockmap';
const GH_OLD_MAP = GH + '/download/v2.35.0/Vex-Setup.exe.blockmap';

let OLD, NEW, OLD_MAP, NEW_MAP, work;
beforeAll(async () => {
  work = fs.mkdtempSync(path.join(os.tmpdir(), 'vex-difftest-'));
  // Random bytes, so the content-defined blocks are realistic. The new file
  // shares most of them: a changed stretch in the middle, a few inserted
  // bytes that shift everything after them, and a new tail.
  OLD = crypto.randomBytes(3 * 1024 * 1024);
  NEW = Buffer.concat([
    OLD.subarray(0, 1024 * 1024),
    crypto.randomBytes(100 * 1024),
    OLD.subarray(1124 * 1024, 2 * 1024 * 1024),
    Buffer.from('inserted'),
    OLD.subarray(2 * 1024 * 1024),
    crypto.randomBytes(40 * 1024),
  ]);
  const old = path.join(work, 'old.exe'), neu = path.join(work, 'new.exe');
  fs.writeFileSync(old, OLD); fs.writeFileSync(neu, NEW);
  await buildBlockMap(old, 'gzip', old + '.blockmap');
  await buildBlockMap(neu, 'gzip', neu + '.blockmap');
  OLD_MAP = fs.readFileSync(old + '.blockmap');
  NEW_MAP = fs.readFileSync(neu + '.blockmap');
  return () => fs.rmSync(work, { recursive: true, force: true });
});

const yml = () => `version: 2.35.1\nfiles:\n  - url: Vex-Setup.exe\n    sha512: ${sha(NEW)}\n    size: ${NEW.length}\npath: Vex-Setup.exe\nsha512: ${sha(NEW)}\nreleaseDate: '2026-10-02T10:00:00.000Z'\n`;
const respond = (body, { status = 200, headers = {} } = {}) => new Response(body, { status, headers });

// A file server the way GitHub's storage answers: Range gives 206 with
// Content-Range. Every request is logged.
let dir, routes, fetch, log, requests;
function serveFile(buf, { ignoreRange = false, corrupt = false } = {}) {
  return (init) => {
    const range = init && init.headers && init.headers.Range;
    requests.push(range || 'whole');
    if (!range || ignoreRange) return respond(buf, { headers: { 'content-length': String(buf.length) } });
    const [, a, b] = range.match(/^bytes=(\d+)-(\d+)$/);
    let part = Buffer.from(buf.subarray(+a, +b + 1));
    if (corrupt) part[0] ^= 0xff;
    return respond(part, { status: 206, headers: { 'content-range': `bytes ${a}-${b}/${buf.length}`, 'content-length': String(part.length) } });
  };
}
const make = (over = {}) => createUpdater({ fetch, fs, dir, currentVersion: '2.35.0', env: {}, spawn: vi.fn(), log, platform: 'win32', ...over });
const base = () => path.join(dir, 'Vex-Setup-2.35.0.exe');

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vex-diffupd-'));
  requests = [];
  routes = new Map([
    [GH_YML, () => respond(yml())],
    [GH_EXE, serveFile(NEW)],
    [GH_NEW_MAP, () => respond(NEW_MAP)],
    [GH_OLD_MAP, () => respond(OLD_MAP)],
  ]);
  fetch = vi.fn(async (url, init) => (routes.get(url) || (() => respond('Not Found', { status: 404 })))(init));
  log = { warn: vi.fn(), error: vi.fn(), log: vi.fn() };
  fs.writeFileSync(base(), OLD);
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('the plan', () => {
  it('reads electron-builder blockmaps and copies what both installers share', () => {
    const oldMap = parseBlockMap(OLD_MAP), newMap = parseBlockMap(NEW_MAP);
    expect(oldMap.version).toBe('2');
    expect(oldMap.total).toBe(OLD.length);
    expect(newMap.total).toBe(NEW.length);
    const plan = planDownload(oldMap, newMap);
    expect(plan.downloadBytes + plan.copyBytes).toBe(NEW.length);
    expect(plan.downloadBytes).toBeLessThan(NEW.length / 5);
    // The steps cover the new file end to end, in order, without gaps.
    let at = 0;
    for (const s of plan.steps) { expect(s.start).toBe(at); at = s.end; }
    expect(at).toBe(NEW.length);
    // Every copy really is the same bytes in the old file.
    for (const s of plan.steps.filter(x => x.kind === 'copy')) {
      expect(OLD.subarray(s.from, s.from + s.end - s.start).equals(NEW.subarray(s.start, s.end))).toBe(true);
    }
  });

  it('refuses blockmaps it cannot trust', () => {
    expect(() => parseBlockMap(Buffer.from('not a blockmap'))).toThrow(/could not be read/);
    const zlib = require('node:zlib');
    const gz = obj => zlib.gzipSync(Buffer.from(JSON.stringify(obj)));
    expect(() => parseBlockMap(gz({ version: '2', files: [] }))).toThrow(/expected one file/);
    expect(() => parseBlockMap(gz({ version: '2', files: [{ name: 'file', checksums: ['a'], sizes: [-1] }] }))).toThrow(/impossible size/);
    expect(() => parseBlockMap(gz({ version: '2', files: [{ name: 'file', checksums: ['a', 'b'], sizes: [1] }] }))).toThrow(/lists its blocks wrongly/);
    const v1 = parseBlockMap(gz({ version: '1', files: [{ name: 'file', offset: 0, checksums: ['a'], sizes: [1] }] }));
    expect(() => planDownload(v1, parseBlockMap(NEW_MAP))).toThrow(/different kinds/);
  });
});

describe('a smaller download', () => {
  it('downloads only the changed ranges, copies the rest, and passes the sha512 check', async () => {
    const u = make(); await u.check();
    const progress = [];
    const r = await u.download('2.35.1', p => progress.push(p));
    expect(r).toEqual({ ok: true, version: '2.35.1', size: NEW.length });
    expect(fs.readFileSync(path.join(dir, 'Vex-Setup-2.35.1.exe')).equals(NEW)).toBe(true);
    // Only Range requests reached the installer, and they add up to the plan.
    const plan = planDownload(parseBlockMap(OLD_MAP), parseBlockMap(NEW_MAP));
    expect(requests.length).toBeGreaterThan(0);
    expect(requests.every(x => x.startsWith('bytes='))).toBe(true);
    const asked = requests.reduce((n, x) => { const [, a, b] = x.match(/(\d+)-(\d+)/); return n + (+b - +a + 1); }, 0);
    expect(asked).toBe(plan.downloadBytes);
    // Progress counts the bytes that came over the network.
    expect(progress[0]).toMatchObject({ received: 0, total: plan.downloadBytes, full: NEW.length, reused: plan.copyBytes });
    expect(progress[progress.length - 1]).toMatchObject({ received: plan.downloadBytes, verifying: true });
    // The base stays for now; the next start's cleanup removes it once 2.35.1 runs.
    expect(fs.readdirSync(dir).sort()).toEqual(['Vex-Setup-2.35.0.exe', 'Vex-Setup-2.35.1.exe']);
    expect(log.log.mock.calls.flat().join(' ')).toMatch(/smaller download verified/);
  });

  it('a server that ignores Range: said in the log, then the whole installer', async () => {
    routes.set(GH_EXE, serveFile(NEW, { ignoreRange: true }));
    const u = make(); await u.check();
    const r = await u.download('2.35.1');
    expect(r.ok).toBe(true);
    expect(fs.readFileSync(path.join(dir, 'Vex-Setup-2.35.1.exe')).equals(NEW)).toBe(true);
    expect(log.warn.mock.calls.flat().join(' ')).toMatch(/ignored the Range request \(HTTP 200 instead of 206\)/);
    expect(requests.filter(x => x === 'whole' || x.startsWith('bytes='))).toHaveLength(2);
  });

  it('a damaged range fails the checksum, and the whole installer is downloaded once', async () => {
    let calls = 0;
    const good = serveFile(NEW), bad = serveFile(NEW, { corrupt: true });
    routes.set(GH_EXE, (init) => (++calls, init.headers.Range ? bad(init) : good(init)));
    const u = make(); await u.check();
    const r = await u.download('2.35.1');
    expect(r.ok).toBe(true);
    expect(log.warn.mock.calls.flat().join(' ')).toMatch(/did not match the checksum/);
    expect(requests[requests.length - 1]).toBe('whole');
    expect(fs.readFileSync(path.join(dir, 'Vex-Setup-2.35.1.exe')).equals(NEW)).toBe(true);
  });

  it('…and if the whole installer is damaged too, it fails in plain words', async () => {
    // Inside the changed stretch, so both the ranges and the whole file carry it.
    const damaged = Buffer.from(NEW); damaged[1024 * 1024 + 50 * 1024] ^= 1;
    routes.set(GH_EXE, serveFile(damaged));
    const u = make(); await u.check();
    const r = await u.download('2.35.1');
    expect(r).toMatchObject({ ok: false, code: 'checksum' });
    expect(r.error).toMatch(/did not match the checksum its release gives/);
    expect(requests.filter(x => x === 'whole')).toHaveLength(1);
    expect(fs.readdirSync(dir)).toEqual(['Vex-Setup-2.35.0.exe']);
  });

  it('no kept installer: the whole installer, and no blockmap is fetched', async () => {
    fs.rmSync(base());
    const u = make(); await u.check();
    expect((await u.download('2.35.1')).ok).toBe(true);
    expect(requests).toEqual(['whole']);
    expect(fetch.mock.calls.map(c => c[0])).not.toContain(GH_OLD_MAP);
  });

  it('a release without a blockmap (v2.34.4 had none): the whole installer', async () => {
    routes.delete(GH_OLD_MAP);
    const u = make(); await u.check();
    expect((await u.download('2.35.1')).ok).toBe(true);
    expect(requests).toEqual(['whole']);
    expect(log.warn.mock.calls.flat().join(' ')).toMatch(/no blockmap for 2\.35\.0 \(HTTP 404\)/);
  });

  it('a kept installer that is not the one its blockmap describes is not used', async () => {
    fs.appendFileSync(base(), 'x');
    const u = make(); await u.check();
    expect((await u.download('2.35.1')).ok).toBe(true);
    expect(requests).toEqual(['whole']);
    expect(log.warn.mock.calls.flat().join(' ')).toMatch(/is not the installer its release's blockmap describes/);
  });

  it('Cancel in the middle stops it, does not fall back, and leaves only the kept installer', async () => {
    let cancelled = false;
    routes.set(GH_EXE, (init) => {
      requests.push(init.headers.Range || 'whole');
      const [, a] = init.headers.Range.match(/(\d+)-(\d+)/);
      const body = new ReadableStream({
        start(c) { c.enqueue(new Uint8Array(NEW.subarray(+a, +a + 10))); },
        pull() { return new Promise(() => {}); },
        cancel() { cancelled = true; },
      });
      return respond(body, { status: 206, headers: { 'content-range': init.headers.Range.replace('=', ' ') + '/' + NEW.length } });
    });
    const u = make(); await u.check();
    const pending = u.download('2.35.1', () => {});
    await vi.waitFor(() => expect(requests.length).toBe(1));
    expect(u.cancel()).toBe(true);
    expect(await pending).toMatchObject({ ok: false, code: 'cancelled', error: 'Download cancelled.' });
    expect(cancelled).toBe(true);
    expect(requests).toHaveLength(1);
    expect(fs.readdirSync(dir)).toEqual(['Vex-Setup-2.35.0.exe']);
  });
});

describe('the kept installer', () => {
  it('cleanup keeps the installer of the running version and removes the rest', () => {
    fs.writeFileSync(path.join(dir, 'Vex-Setup-2.34.5.exe'), 'older');
    fs.writeFileSync(path.join(dir, 'Vex-Setup-2.35.1.exe.part'), 'partial');
    expect(make().cleanup().sort()).toEqual(['Vex-Setup-2.34.5.exe', 'Vex-Setup-2.35.1.exe.part']);
    expect(fs.readdirSync(dir)).toEqual(['Vex-Setup-2.35.0.exe']);
  });

  it('cleanup leaves a verified download that is waiting to be installed', async () => {
    const u = make(); await u.check();
    expect((await u.download('2.35.1')).ok).toBe(true);
    expect(u.cleanup()).toEqual([]);
    expect((await u.prepareInstall('2.35.1')).file).toBe(path.join(dir, 'Vex-Setup-2.35.1.exe'));
  });
});

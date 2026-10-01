// @vitest-environment node
//
// Vex's own updater (src/main/updates.js): latest.yml is read the way
// electron-builder writes it, the installer is downloaded, checked against
// the release's sha512 and size, and only a verified file is ever started —
// with the flags that make electron-builder's NSIS installer upgrade in
// place quietly and start Vex again.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

const { createUpdater, parseLatestYml, pickInstaller, resolveFeed, cmpVersion, INSTALLER_ARGS, state } = require('../../src/main/updates.js');
const { parseChangelogList } = require('../../src/main-helpers.js');

const sha = buf => crypto.createHash('sha512').update(buf).digest('base64');
const INSTALLER = Buffer.alloc(300 * 1024, 7);
const yml = ({ version = '2.35.0', body = INSTALLER, size = body.length, hash = sha(body), url = 'Vex-Setup.exe' } = {}) => `version: ${version}
files:
  - url: ${url}
    sha512: ${hash}
    size: ${size}
path: ${url}
sha512: ${hash}
releaseNotes: |
  The short release body.

  - one fix
releaseDate: '2026-10-02T10:00:00.000Z'
`;

let dir, routes, fetch, log;
function streamOf(buf, { chunk = 64 * 1024, hang = false, onCancel } = {}) {
  let offset = 0;
  return new ReadableStream({
    pull(c) {
      if (offset < buf.length) { c.enqueue(new Uint8Array(buf.subarray(offset, offset + chunk))); offset += chunk; return; }
      if (hang) return new Promise(() => {});
      c.close();
    },
    cancel() { onCancel && onCancel(); },
  });
}
const respond = (body, { status = 200, length, url } = {}) => {
  const headers = new Headers();
  if (length != null) headers.set('content-length', String(length));
  const res = new Response(body, { status, headers });
  if (url) Object.defineProperty(res, 'url', { value: url });
  return res;
};
const make = (over = {}) => createUpdater({ fetch, fs, dir, currentVersion: '2.34.5', env: {}, spawn: vi.fn(), log, parseChangelogList, platform: 'win32', ...over });
const GH_YML = 'https://github.com/0xmortuex/Vex/releases/latest/download/latest.yml';
const GH_EXE = 'https://github.com/0xmortuex/Vex/releases/download/v2.35.0/Vex-Setup.exe';

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vex-updtest-'));
  routes = new Map();
  fetch = vi.fn(async (url, init) => {
    const handler = routes.get(url);
    if (!handler) return respond('nope', { status: 404 });
    return handler(init);
  });
  log = { warn: vi.fn(), error: vi.fn(), log: vi.fn() };
  routes.set(GH_YML, () => respond(yml()));
  routes.set(GH_EXE, () => respond(streamOf(INSTALLER), { length: INSTALLER.length, url: 'https://release-assets.githubusercontent.com/x' }));
});
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); vi.useRealTimers(); });

describe('latest.yml', () => {
  it('is read the way electron-builder writes it', () => {
    const y = parseLatestYml(yml());
    expect(y.version).toBe('2.35.0');
    expect(y.path).toBe('Vex-Setup.exe');
    expect(y.files).toEqual([{ url: 'Vex-Setup.exe', sha512: sha(INSTALLER), size: String(INSTALLER.length) }]);
    expect(y.releaseDate).toBe('2026-10-02T10:00:00.000Z');
    expect(y.releaseNotes).toBe('The short release body.\n\n- one fix');
  });

  it('gives the installer only with a well-formed checksum and size', () => {
    expect(pickInstaller(parseLatestYml(yml()))).toEqual({ url: 'Vex-Setup.exe', sha512: sha(INSTALLER), size: INSTALLER.length });
    expect(() => pickInstaller(parseLatestYml(yml({ hash: 'abc' })))).toThrow(/valid checksum/);
    expect(() => pickInstaller(parseLatestYml(yml({ size: 0 })))).toThrow(/impossible size/);
    expect(() => pickInstaller(parseLatestYml(yml({ size: 700 * 1024 * 1024 })))).toThrow(/impossible size/);
    expect(() => pickInstaller(parseLatestYml(yml({ url: 'Vex.dmg' })))).toThrow(/no Windows installer/);
    expect(() => pickInstaller(parseLatestYml(yml({ url: '../evil.exe' })))).toThrow(/will not use/);
    // A .cmd stand-in only under the test feed.
    expect(() => pickInstaller(parseLatestYml(yml({ url: 'stand-in.cmd' })))).toThrow(/no Windows installer/);
    expect(pickInstaller(parseLatestYml(yml({ url: 'stand-in.cmd' })), { allowScript: true }).url).toBe('stand-in.cmd');
  });

  it('versions compare as numbers', () => {
    expect(cmpVersion('2.35.0', '2.34.5')).toBe(1);
    expect(cmpVersion('2.34.10', '2.34.9')).toBe(1);
    expect(cmpVersion('2.34.5', '2.34.5')).toBe(0);
    expect(cmpVersion('2.3.99', '2.34.0')).toBe(-1);
  });
});

describe('the feed', () => {
  it('is the GitHub release, and the installer comes from that exact version', () => {
    const f = resolveFeed({});
    expect(f.test).toBe(false);
    expect(f.latestYml).toBe(GH_YML);
    expect(f.installer('2.35.0', 'Vex-Setup.exe')).toBe(GH_EXE);
  });
  it('VEX_UPDATE_FEED is honoured only for a loopback http address', () => {
    const f = resolveFeed({ VEX_UPDATE_FEED: 'http://127.0.0.1:17100/' });
    expect(f.test).toBe(true);
    expect(f.latestYml).toBe('http://127.0.0.1:17100/latest.yml');
    expect(f.installer('9.9.9', 'stand-in.cmd')).toBe('http://127.0.0.1:17100/stand-in.cmd');
    for (const bad of ['https://evil.example/', 'http://10.0.0.2/', 'http://127.0.0.1:17100', 'file:///C:/x/', 'http://127.0.0.1.evil.com/'])
      expect(() => resolveFeed({ VEX_UPDATE_FEED: bad }), bad).toThrow(/must be a local address/);
  });
});

describe('check', () => {
  it('finds a newer version and records it for Health', async () => {
    const r = await make().check();
    expect(r).toMatchObject({ ok: true, current: '2.34.5', latest: '2.35.0', hasUpdate: true, size: INSTALLER.length, releaseUrl: 'https://github.com/0xmortuex/Vex/releases/tag/v2.35.0' });
    expect(r.releasedAt).toBe(Date.parse('2026-10-02T10:00:00.000Z'));
    expect(state.result).toBe('update-available');
  });
  it('up to date is up to date', async () => {
    routes.set(GH_YML, () => respond(yml({ version: '2.34.5' })));
    expect(await make().check()).toMatchObject({ ok: true, hasUpdate: false });
  });
  it('a missing release and no network are said in plain words', async () => {
    routes.delete(GH_YML);
    expect((await make().check()).error).toMatch(/no release information yet \(404\)/);
    fetch = vi.fn(async () => { throw new TypeError('net::ERR_INTERNET_DISCONNECTED'); });
    const r = await make().check();
    expect(r.ok).toBe(false);
    expect(r.error).toBe('Vex could not reach the update server. Check your internet connection and try again.');
  });
  it('a bad test feed address is an error, not a fall-back to GitHub', async () => {
    const r = await make({ env: { VEX_UPDATE_FEED: 'https://evil.example/' } }).check();
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/must be a local address/);
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('download', () => {
  it('streams into userData/updates, checks sha512 and size, reports progress', async () => {
    fs.writeFileSync(path.join(dir, 'Vex-Setup-2.34.0.exe'), 'old');
    fs.writeFileSync(path.join(dir, 'Vex-Setup-2.34.9.exe.part'), 'partial');
    const u = make();
    await u.check();
    const progress = [];
    const r = await u.download('2.35.0', p => progress.push(p));
    expect(r).toEqual({ ok: true, version: '2.35.0', size: INSTALLER.length });
    expect(fs.readdirSync(dir)).toEqual(['Vex-Setup-2.35.0.exe']);
    expect(fs.readFileSync(path.join(dir, 'Vex-Setup-2.35.0.exe')).equals(INSTALLER)).toBe(true);
    expect(progress[0]).toEqual({ received: 0, total: INSTALLER.length, percent: 0 });
    expect(progress[progress.length - 1]).toMatchObject({ percent: 100, verifying: true });
    expect(fetch.mock.calls.find(c => c[0] === GH_EXE)[1]).toMatchObject({ redirect: 'follow' });
  });

  it('a checksum mismatch is refused and the file deleted', async () => {
    const tampered = Buffer.from(INSTALLER); tampered[1000] ^= 1;
    routes.set(GH_EXE, () => respond(streamOf(tampered), { length: tampered.length }));
    const u = make(); await u.check();
    const r = await u.download('2.35.0');
    expect(r).toMatchObject({ ok: false, code: 'checksum' });
    expect(r.error).toMatch(/did not match the checksum its release gives, so Vex deleted it and did not install it/);
    expect(fs.readdirSync(dir)).toEqual([]);
    await expect(u.prepareInstall('2.35.0')).rejects.toThrow(/Download the update first/);
  });

  it('a size that does not match is refused: declared, longer or shorter', async () => {
    const u = make(); await u.check();
    routes.set(GH_EXE, () => respond(streamOf(INSTALLER), { length: INSTALLER.length + 5 }));
    expect(await u.download('2.35.0')).toMatchObject({ ok: false, code: 'size' });
    routes.set(GH_EXE, () => respond(streamOf(Buffer.concat([INSTALLER, Buffer.alloc(10)]))));
    const longer = await u.download('2.35.0');
    expect(longer).toMatchObject({ ok: false, code: 'size' });
    expect(longer.error).toMatch(/bigger than the release says/);
    routes.set(GH_EXE, () => respond(streamOf(INSTALLER.subarray(0, 1000))));
    const shorter = await u.download('2.35.0');
    expect(shorter.error).toMatch(/smaller than the release says/);
    expect(fs.readdirSync(dir)).toEqual([]);
  });

  it('404 and no network are said in plain words', async () => {
    const u = make(); await u.check();
    routes.delete(GH_EXE);
    expect((await u.download('2.35.0')).error).toMatch(/installer for Vex 2\.35\.0 is not on its release page \(404\)/);
    fetch = vi.fn(async (url) => { if (url === GH_YML) return respond(yml()); throw new TypeError('fetch failed'); });
    const v = make(); await v.check();
    expect(await v.download('2.35.0')).toMatchObject({ ok: false, code: 'offline' });
  });

  it('Cancel mid-download stops it and leaves nothing behind', async () => {
    let cancelled = false;
    routes.set(GH_EXE, () => respond(streamOf(INSTALLER.subarray(0, 128 * 1024), { hang: true, onCancel: () => { cancelled = true; } }), { length: INSTALLER.length }));
    const u = make(); await u.check();
    const pending = u.download('2.35.0', () => {});
    await new Promise(r => setTimeout(r, 50));
    expect(u.downloading).toBe('2.35.0');
    await expect(u.download('2.35.0')).rejects.toThrow(/already downloading/);
    expect(u.cancel()).toBe(true);
    expect(await pending).toMatchObject({ ok: false, code: 'cancelled', error: 'Download cancelled.' });
    expect(cancelled).toBe(true);
    expect(fs.readdirSync(dir)).toEqual([]);
    expect(u.downloading).toBe(null);
  });

  it('refuses a version it did not just find, and an insecure redirect', async () => {
    const u = make();
    await expect(u.download('2.35.0')).rejects.toThrow(/Check for updates again/);
    await u.check();
    await expect(u.download('2.36.0')).rejects.toThrow(/Check for updates again/);
    routes.set(GH_EXE, () => respond(streamOf(INSTALLER), { length: INSTALLER.length, url: 'http://mirror.example/Vex-Setup.exe' }));
    expect((await u.download('2.35.0')).error).toMatch(/insecure address/);
  });
});

describe('install', () => {
  it('runs only the verified file, detached, as a quiet in-place upgrade that starts Vex again', async () => {
    const spawn = vi.fn(() => ({ on: vi.fn(), unref: vi.fn() }));
    const u = make({ spawn }); await u.check(); await u.download('2.35.0');
    const plan = await u.prepareInstall('2.35.0');
    expect(plan).toEqual({ file: path.join(dir, 'Vex-Setup-2.35.0.exe'), args: ['--updated', '/S', '--force-run'], script: false });
    expect(INSTALLER_ARGS).toEqual(['--updated', '/S', '--force-run']);
    const child = u.launch(plan);
    expect(spawn).toHaveBeenCalledWith(plan.file, ['--updated', '/S', '--force-run'], expect.objectContaining({ detached: true, stdio: 'ignore' }));
    expect(child.unref).toHaveBeenCalled();
  });

  it('a file changed after the check is refused and deleted', async () => {
    const u = make(); await u.check(); await u.download('2.35.0');
    fs.appendFileSync(path.join(dir, 'Vex-Setup-2.35.0.exe'), 'x');
    await expect(u.prepareInstall('2.35.0')).rejects.toThrow(/changed on disk after it was checked/);
    expect(fs.readdirSync(dir)).toEqual([]);
  });

  it('a .cmd stand-in runs through cmd.exe, and only under the test feed', async () => {
    const standIn = Buffer.from('@echo off\r\necho %*> args.txt\r\n');
    const feed = 'http://127.0.0.1:17100/';
    routes.set(feed + 'latest.yml', () => respond(yml({ body: standIn, url: 'stand-in.cmd' })));
    routes.set(feed + 'stand-in.cmd', () => respond(streamOf(standIn), { length: standIn.length }));
    const spawn = vi.fn(() => ({ on: vi.fn(), unref: vi.fn() }));
    const env = { VEX_UPDATE_FEED: feed, ComSpec: 'C:\\Windows\\System32\\cmd.exe' };
    const u = make({ spawn, env }); await u.check(); await u.download('2.35.0');
    const plan = await u.prepareInstall('2.35.0');
    expect(plan.script).toBe(true);
    u.launch(plan);
    expect(spawn).toHaveBeenCalledWith('C:\\Windows\\System32\\cmd.exe', ['/d', '/c', path.join(dir, 'Vex-Setup-2.35.0.cmd'), '--updated', '/S', '--force-run'], expect.objectContaining({ detached: true }));
    // The same downloaded stand-in, once the override is gone, is not run.
    delete env.VEX_UPDATE_FEED;
    await expect(u.prepareInstall('2.35.0')).rejects.toThrow(/only runs a real installer/);
  });
});

describe('what is new', () => {
  const changelog = '# Changelog\n\n## v2.35.1 (2026-10-03) — later\n\nNot yet.\n\n## v2.35.0 (2026-10-02) — New\n\n### Fixes\n- **A** fix\n\n## v2.34.6 (2026-10-01) — Between\n\n- between\n\n## v2.34.5 (2026-10-01) — Running\n\n- already have it\n';
  it('every CHANGELOG section after the running version, up to the new one', async () => {
    routes.set('https://raw.githubusercontent.com/0xmortuex/Vex/v2.35.0/CHANGELOG.md', () => respond(changelog));
    const u = make(); await u.check();
    const n = await u.notes('2.35.0');
    expect(n.source).toBe('changelog');
    expect(n.entries.map(e => e.version)).toEqual(['v2.35.0', 'v2.34.6']);
    expect(n.entries[0].body).toMatch(/\*\*A\*\* fix/);
  });
  it('falls back to the release notes latest.yml carries', async () => {
    const u = make(); await u.check();
    const n = await u.notes('2.35.0');
    expect(n).toMatchObject({ source: 'release', entries: [{ version: 'v2.35.0', body: 'The short release body.\n\n- one fix' }] });
  });
});

describe('cleanup', () => {
  it('removes old installers and partial downloads, and says what it could not', () => {
    fs.writeFileSync(path.join(dir, 'a.exe'), '1');
    fs.writeFileSync(path.join(dir, 'b.exe.part'), '2');
    expect(make().cleanup().sort()).toEqual(['a.exe', 'b.exe.part']);
    expect(fs.readdirSync(dir)).toEqual([]);
    expect(make({ dir: path.join(dir, 'missing') }).cleanup()).toEqual([]);
  });
});

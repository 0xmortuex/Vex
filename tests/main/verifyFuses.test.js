// @vitest-environment node
//
// Electron fuses for the packaged app (scripts/lib/fuse-config.js, opt-in with VEX_FUSES=1) and
// the check that reads them back from a built exe (scripts/verify-fuses.js).
// The REAL proof (a castLabs runtime copy with the fuses flipped, run with and
// without ELECTRON_RUN_AS_NODE, and with a swapped app.asar) is a throwaway
// Electron probe described in the commit; these tests pin the configuration and
// the pure logic.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const vf = require('../../scripts/verify-fuses.js');
const pkg = require('../../package.json');
const { FUSES, fusesRequested } = require('../../scripts/lib/fuse-config.js');
const signing = require('../../scripts/code-signing.js');
const root = path.join(__dirname, '..', '..');

const ON = { VEX_FUSES: '1' };
const wire = (over = {}) => ({ 0: 49, 1: 48, 2: 49, 3: 49, 4: 48, 5: 48, 6: 48, 7: 49, 8: 49, ...over });

describe('fuse configuration', () => {
  it('turns off running Vex.exe as Node, NODE_OPTIONS and --inspect, and validates app.asar', () => {
    expect(vf.expectedFuses()).toEqual({
      runAsNode: false,
      enableNodeOptionsEnvironmentVariable: false,
      enableNodeCliInspectArguments: false,
      enableEmbeddedAsarIntegrityValidation: true,
      onlyLoadAppFromAsar: true,
    });
  });
  it('leaves cookie encryption alone (turning it on is a one-way change to the cookie store)', () => {
    expect(FUSES).not.toHaveProperty('enableCookieEncryption');
  });
  it('keeps afterSign (the castLabs VMP signature) and does not move the fuses after it', () => {
    expect(pkg.build.afterSign).toBe('scripts/vmp-sign.js');
    // electron-builder flips fuses in doPack, before doSignAfterPack (Authenticode, then afterSign/VMP).
    const src = fs.readFileSync(path.join(root, 'node_modules', 'app-builder-lib', 'out', 'platformPackager.js'), 'utf8');
    expect(src.indexOf('await this.doAddElectronFuses(packContext)')).toBeGreaterThan(0);
    expect(src.indexOf('await this.doAddElectronFuses(packContext)')).toBeLessThan(src.indexOf('await this.doSignAfterPack('));
  });
  it('rejects a config that cannot be checked', () => {
    expect(() => vf.expectedFuses(null)).toThrow(/no fuse configuration/);
    expect(() => vf.expectedFuses({ bogus: true })).toThrow(/not a fuse/);
    expect(() => vf.expectedFuses({ runAsNode: 'no' })).toThrow(/true or false/);
  });
});

describe('comparing a built exe with the configuration', () => {
  const expected = vf.expectedFuses();
  it('flags every fuse that is not as asked (an old or unfused build)', () => {
    const p = vf.compareFuses(wire(), expected);
    expect(p).toHaveLength(5);
    expect(p.join('\n')).toMatch(/runAsNode is ON/);
    expect(p.join('\n')).toMatch(/enableEmbeddedAsarIntegrityValidation is OFF/);
  });
  it('is quiet when they all match', () => {
    expect(vf.compareFuses(wire({ 0: 48, 2: 48, 3: 48, 4: 49, 5: 49 }), expected)).toEqual([]);
  });
  it('flags a fuse this Electron does not have, instead of passing silently', () => {
    expect(vf.compareFuses({ 0: 48 }, { onlyLoadAppFromAsar: true })[0]).toMatch(/no such fuse/);
  });
});

describe('reading a real exe-shaped file', () => {
  let tmp;
  beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vex-fuses-')); });
  afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const fakeExe = (states) => Buffer.concat([Buffer.from('MZ-padding'), Buffer.from('dL7pKGdnNz796PbbjQWNKmHXBZaB9tsX'), Buffer.from([1, states.length, ...states]), Buffer.from('tail')]);

  it('check() reads the fuse wire from the file and reports what differs', async () => {
    fs.writeFileSync(path.join(tmp, 'Vex.exe'), fakeExe([49, 48, 49, 49, 48, 48, 48, 49, 49]));
    const bad = await vf.check(tmp, { runAsNode: false }, ON);
    expect(bad.ok).toBe(false);
    expect(bad.problems[0]).toMatch(/runAsNode is ON/);
    fs.writeFileSync(path.join(tmp, 'Vex.exe'), fakeExe([48, 48, 49, 49, 48, 48, 48, 49, 49]));
    expect((await vf.check(tmp, { runAsNode: false }, ON)).ok).toBe(true);
  });
  it('check() throws when there is no exe', async () => {
    await expect(vf.check(tmp, FUSES, ON)).rejects.toThrow(/does not exist/);
  });
  it('hashes an asar header the way electron-builder records it', async () => {
    const src = path.join(tmp, 'app'); fs.mkdirSync(src);
    fs.writeFileSync(path.join(src, 'main.js'), 'x');
    const resources = path.join(tmp, 'resources'); fs.mkdirSync(resources);
    await require('@electron/asar').createPackage(src, path.join(resources, 'app.asar'));
    const { computeData } = require('app-builder-lib/out/asar/integrity.js');
    const record = await computeData({ resourcesPath: resources, resourcesRelativePath: 'resources', resourcesDestinationPath: resources, extraResourceMatchers: [] });
    expect(vf.asarHeaderHash(path.join(resources, 'app.asar'))).toBe(Object.values(record)[0].hash);
  });
});

describe('the release gate', () => {
  it('verify-packaged-boot runs the fuse check before it starts the build', () => {
    const src = fs.readFileSync(path.join(root, 'scripts', 'verify-packaged-boot.js'), 'utf8');
    expect(src.indexOf('verify-fuses.js')).toBeGreaterThan(0);
    expect(src.indexOf('verify-fuses.js')).toBeLessThan(src.lastIndexOf('verify-smoke-boot.js'));
  });
  it('the dev run is unaffected: nothing in src or the dev scripts needs ELECTRON_RUN_AS_NODE in a packaged build', () => {
    const grep = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) return e.name === 'vendor' ? [] : grep(p);
      return /\.(js|mjs)$/.test(e.name) && /ELECTRON_RUN_AS_NODE|\.fork\(/.test(fs.readFileSync(p, 'utf8')) ? [p] : [];
    });
    expect(grep(path.join(root, 'src'))).toEqual([]);
  });
});

describe('fuses are opt-in (VEX_FUSES=1)', () => {
  const cfg = (env) => {
    const saved = { VEX_FUSES: process.env.VEX_FUSES };
    for (const k of Object.keys(saved)) { if (env[k] === undefined) delete process.env[k]; else process.env[k] = env[k]; }
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    try { return signing(); }
    finally { log.mockRestore(); for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } }
  };

  it('package.json no longer carries electronFuses (the parent config adds it)', () => {
    expect(pkg.build).not.toHaveProperty('electronFuses');
    expect(pkg.build.extends).toBe('./scripts/code-signing.js');
  });
  it('only VEX_FUSES=1 asks for fuses', () => {
    expect(fusesRequested({})).toBe(false);
    expect(fusesRequested({ VEX_FUSES: '' })).toBe(false);
    expect(fusesRequested({ VEX_FUSES: '0' })).toBe(false);
    expect(fusesRequested({ VEX_FUSES: 'true' })).toBe(false);
    expect(fusesRequested({ VEX_FUSES: '1' })).toBe(true);
  });
  it('with VEX_FUSES unset the electron-builder config has no electronFuses (nothing is flipped)', () => {
    expect(cfg({})).not.toHaveProperty('electronFuses');
  });
  it('with VEX_FUSES=1 the electron-builder config has exactly the five fuses', () => {
    expect(cfg({ VEX_FUSES: '1' }).electronFuses).toEqual({
      runAsNode: false,
      enableNodeOptionsEnvironmentVariable: false,
      enableNodeCliInspectArguments: false,
      enableEmbeddedAsarIntegrityValidation: true,
      onlyLoadAppFromAsar: true,
    });
  });
  it('check() reports "not requested" and passes, without needing an exe, when VEX_FUSES is unset', async () => {
    const r = await vf.check(path.join(os.tmpdir(), 'vex-no-such-dir'), FUSES, {});
    expect(r).toMatchObject({ ok: true, skipped: true });
  });
  it('the verify-fuses script prints one clear line and exits 0 when VEX_FUSES is unset', () => {
    const env = { ...process.env }; delete env.VEX_FUSES;
    const r = spawnSync(process.execPath, [path.join(root, 'scripts', 'verify-fuses.js'), path.join(os.tmpdir(), 'vex-no-such-dir')], { env, encoding: 'utf8', windowsHide: true });
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe(vf.NOT_REQUESTED);
    expect(vf.NOT_REQUESTED).toMatch(/fuses not requested \(VEX_FUSES unset\): not checked/);
  });
  it('the verify-fuses script still fails on a missing exe when VEX_FUSES=1', () => {
    const r = spawnSync(process.execPath, [path.join(root, 'scripts', 'verify-fuses.js'), path.join(os.tmpdir(), 'vex-no-such-dir')], { env: { ...process.env, VEX_FUSES: '1' }, encoding: 'utf8', windowsHide: true });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/does not exist/);
  });
  it('verify-packaged-boot still runs verify-fuses.js (which decides by VEX_FUSES)', () => {
    const src = fs.readFileSync(path.join(root, 'scripts', 'verify-packaged-boot.js'), 'utf8');
    expect(src).toMatch(/verify-fuses\.js/);
    expect(src).not.toMatch(/process\.env\.VEX_FUSES/);
  });
});

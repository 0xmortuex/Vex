// @vitest-environment node
//
// Electron fuses for the packaged app (package.json build.electronFuses) and
// the check that reads them back from a built exe (scripts/verify-fuses.js).
// The REAL proof (a castLabs runtime copy with the fuses flipped, run with and
// without ELECTRON_RUN_AS_NODE, and with a swapped app.asar) is a throwaway
// Electron probe described in the commit; these tests pin the configuration and
// the pure logic.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const vf = require('../../scripts/verify-fuses.js');
const pkg = require('../../package.json');
const root = path.join(__dirname, '..', '..');

const wire = (over = {}) => ({ 0: 49, 1: 48, 2: 49, 3: 49, 4: 48, 5: 48, 6: 48, 7: 49, 8: 49, ...over });

describe('fuse configuration', () => {
  it('turns off running Vex.exe as Node, NODE_OPTIONS and --inspect, and validates app.asar', () => {
    expect(vf.expectedFuses(pkg)).toEqual({
      runAsNode: false,
      enableNodeOptionsEnvironmentVariable: false,
      enableNodeCliInspectArguments: false,
      enableEmbeddedAsarIntegrityValidation: true,
      onlyLoadAppFromAsar: true,
    });
  });
  it('leaves cookie encryption alone (turning it on is a one-way change to the cookie store)', () => {
    expect(pkg.build.electronFuses).not.toHaveProperty('enableCookieEncryption');
  });
  it('keeps afterSign (the castLabs VMP signature) and does not move the fuses after it', () => {
    expect(pkg.build.afterSign).toBe('scripts/vmp-sign.js');
    // electron-builder flips fuses in doPack, before doSignAfterPack (Authenticode, then afterSign/VMP).
    const src = fs.readFileSync(path.join(root, 'node_modules', 'app-builder-lib', 'out', 'platformPackager.js'), 'utf8');
    expect(src.indexOf('await this.doAddElectronFuses(packContext)')).toBeGreaterThan(0);
    expect(src.indexOf('await this.doAddElectronFuses(packContext)')).toBeLessThan(src.indexOf('await this.doSignAfterPack('));
  });
  it('rejects a config that cannot be checked', () => {
    expect(() => vf.expectedFuses({ build: {} })).toThrow(/no build.electronFuses/);
    expect(() => vf.expectedFuses({ build: { electronFuses: { bogus: true } } })).toThrow(/not a fuse/);
    expect(() => vf.expectedFuses({ build: { electronFuses: { runAsNode: 'no' } } })).toThrow(/true or false/);
  });
});

describe('comparing a built exe with the configuration', () => {
  const expected = vf.expectedFuses(pkg);
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
    const bad = await vf.check(tmp, { build: { electronFuses: { runAsNode: false } } });
    expect(bad.ok).toBe(false);
    expect(bad.problems[0]).toMatch(/runAsNode is ON/);
    fs.writeFileSync(path.join(tmp, 'Vex.exe'), fakeExe([48, 48, 49, 49, 48, 48, 48, 49, 49]));
    expect((await vf.check(tmp, { build: { electronFuses: { runAsNode: false } } })).ok).toBe(true);
  });
  it('check() throws when there is no exe', async () => {
    await expect(vf.check(tmp, pkg)).rejects.toThrow(/does not exist/);
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

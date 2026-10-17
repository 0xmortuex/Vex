import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import path from 'node:path';
import fs from 'node:fs';

const require = createRequire(import.meta.url);
const H = require('../../scripts/lib/probe-harness.js');

const unpackedExe = path.join(H.REPO, 'dist', 'win-unpacked', 'Vex.exe');

// The release's own boot check starts the build it has just made from dist\win-unpacked.
// The harness keeps refusing that folder for every other caller.
describe('assertLaunchable: the release boot check may start the fresh dist build', () => {
  it('still refuses dist\\win-unpacked when the caller does not say it is the release boot', () => {
    expect(() => H.assertLaunchable(unpackedExe, {}, [])).toThrow(/owner/);
    expect(() => H.assertLaunchable(unpackedExe, { releaseBuild: false }, [])).toThrow(/owner/);
    expect(() => H.assertLaunchable(unpackedExe, { releaseBuild: 'yes' }, [])).toThrow(/owner/);
  });
  it('allows exactly dist\\win-unpacked\\Vex.exe for the release boot while nothing runs that file', () => {
    expect(() => H.assertLaunchable(unpackedExe, { releaseBuild: true }, [])).not.toThrow();
    // Case does not matter on Windows.
    expect(() => H.assertLaunchable(unpackedExe.toUpperCase(), { releaseBuild: true }, [])).not.toThrow();
  });
  it('refuses when Vex from dist\\win-unpacked is running, and names the pid', () => {
    const table = [{ pid: 4242, ppid: 1, exe: unpackedExe, cmd: '"' + unpackedExe + '"' }];
    expect(() => H.assertLaunchable(unpackedExe, { releaseBuild: true }, table)).toThrow(/running \(pid 4242\)/);
  });
  it('does not open the folder for any other file in it', () => {
    const other = path.join(H.REPO, 'dist', 'win-unpacked', 'resources', 'app.asar');
    expect(() => H.assertLaunchable(other, { releaseBuild: true }, [])).toThrow(/owner/);
    const uninstall = path.join(H.REPO, 'dist', 'win-unpacked', 'Uninstall Vex.exe');
    expect(() => H.assertLaunchable(uninstall, { releaseBuild: true }, [])).toThrow(/owner/);
  });
  it('is not needed for an exe outside dist\\win-unpacked', () => {
    expect(() => H.assertLaunchable(path.join(H.REPO, 'scratchpad', 'copy', 'Vex.exe'), {}, [])).not.toThrow();
  });
});

describe('the scripts wire it only for the release boot', () => {
  const read = (f) => fs.readFileSync(path.join(H.REPO, 'scripts', f), 'utf8');
  it('verify-packaged-boot sets VEX_RELEASE_BOOT for the smoke boot', () => {
    expect(read('verify-packaged-boot.js')).toMatch(/VEX_RELEASE_BOOT:\s*'1'/);
  });
  it('verify-smoke-boot passes releaseBuild only with that variable and an explicit executable', () => {
    expect(read('verify-smoke-boot.js')).toMatch(/releaseBuild:\s*process\.env\.VEX_RELEASE_BOOT === '1' && !!process\.env\.VEX_SMOKE_EXECUTABLE/);
  });
  it('the harness keeps the temp profile and the forced scheduler-off for every launch', () => {
    const src = fs.readFileSync(path.join(H.REPO, 'scripts', 'lib', 'probe-harness.js'), 'utf8');
    expect(src).toMatch(/VEX_NO_OS_SCHEDULE: '1'/);
    expect(src).toMatch(/assertTempProfile\(/);
  });
});

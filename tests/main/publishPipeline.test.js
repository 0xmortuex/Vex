// `npm run publish` built an installer and shipped it to everyone without ever
// running it. The unit tests cover the source and the smoke test covers the
// source under Electron; neither touches the PACKAGED app, where the failures
// are of a different kind (a file left out of build.files, a runtime require()
// that is not a declared dependency, an asar path that only breaks once
// packed). Fourteen versions went out in three days.
//
// The pipeline is now: build without publishing → start the built app → create
// the release → upload. Nothing reaches an installed copy that has not started
// on this machine first.

import { describe, it, expect } from 'vitest';
const fs = require('fs');
const path = require('path');

const pkg = require('../../package.json');
const { REQUIRED } = require('../../scripts/verify-packaged-boot.js');
const { ASSETS } = require('../../scripts/upload-release.js');
const steps = pkg.scripts.publish.split('&&').map(s => s.trim());

describe('the publish pipeline', () => {
  it('builds without publishing, so there is a moment to check the build', () => {
    expect(pkg.scripts.publish).toContain('electron-builder --publish never');
    expect(pkg.scripts.publish).not.toContain('--publish always');
  });

  it('starts the built app before anything is uploaded', () => {
    const build = steps.findIndex(s => s.includes('electron-builder'));
    const boot = steps.findIndex(s => s.includes('verify-packaged-boot'));
    const upload = steps.findIndex(s => s.includes('upload-release'));
    expect(build).toBeGreaterThanOrEqual(0);
    expect(boot).toBeGreaterThan(build);
    expect(upload).toBeGreaterThan(boot);
  });

  it('creates the GitHub release only once the build is proved, then uploads', () => {
    const boot = steps.findIndex(s => s.includes('verify-packaged-boot'));
    const ensure = steps.findIndex(s => s.includes('ensure-release'));
    const upload = steps.findIndex(s => s.includes('upload-release'));
    expect(ensure).toBeGreaterThan(boot);          // a build that fails leaves no empty release
    expect(upload).toBeGreaterThan(ensure);
  });

  it('checks the release afterwards and moves the website badge', () => {
    expect(pkg.scripts.postpublish).toBe('node scripts/post-publish.js');
  });

  it('the boot check requires the app, the installer, its block map and latest.yml', () => {
    expect(REQUIRED).toEqual(['win-unpacked/Vex.exe', 'Vex-Setup.exe', 'Vex-Setup.exe.blockmap', 'latest.yml']);
  });

  it('latest.yml is uploaded LAST — it is what tells an installed Vex there is an update', () => {
    expect(ASSETS).toEqual(['Vex-Setup.exe', 'Vex-Setup.exe.blockmap', 'latest.yml']);
    expect(ASSETS.at(-1)).toBe('latest.yml');
  });

  it('the boot check runs the real smoke test against the packaged exe', () => {
    const src = fs.readFileSync(path.join(__dirname, '../../scripts/verify-packaged-boot.js'), 'utf8');
    expect(src).toContain('VEX_SMOKE_EXECUTABLE');
    expect(src).toContain('verify-smoke-boot.js');
    expect(src).toContain('VEX_NO_OS_SCHEDULE');          // and leaves no Windows task behind
    expect(src).toMatch(/dist\/ holds version/);          // and refuses a stale build
  });

  it('the smoke test waits for the app to exit before removing its profile', () => {
    // Removing it the instant after the kill lost the race every time (EPERM)
    // and left the folder in Temp for good — 85 had piled up.
    const src = fs.readFileSync(path.join(__dirname, '../../scripts/verify-smoke-boot.js'), 'utf8');
    expect(src).toMatch(/async function cleanup/);
    expect(src).toMatch(/await dead/);
  });
});

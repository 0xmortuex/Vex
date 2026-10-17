// T0-021: a release whose castLabs VMP signature or Widevine component is
// invalid does not get uploaded.
import { describe, it, expect } from 'vitest';

const fs = require('fs');
const path = require('path');
const { preflight, checkStatic, checkBoot } = require('../../scripts/verify-drm.js');
const drmSmoke = require('../../src/main/drm-smoke.js');
const pkg = require('../../package.json');

const ok = (stdout) => () => ({ status: 0, stdout, stderr: '', error: null });
const present = () => true;
const DIR = 'C:\\build\\dist\\win-unpacked';

describe('checkStatic (the built app\'s VMP signature)', () => {
  it('passes a valid signature and reports the days left', () => {
    expect(checkStatic({ dir: DIR, run: ok('Signature is valid: streaming, 1492 days left'), env: {}, exists: present }))
      .toBe('VMP signature is valid (1492 days left)');
  });
  it('fails InvalidSignature (the recurring "DRM failed")', () => {
    const run = () => ({ status: 1, stdout: 'InvalidSignature - Failed to verify signature', stderr: '', error: null });
    expect(() => checkStatic({ dir: DIR, run, env: {}, exists: present })).toThrow(/did not confirm the signature/);
  });
  it('fails when verify-pkg exits 0 but never says the signature is valid', () => {
    expect(() => checkStatic({ dir: DIR, run: ok('nothing useful'), env: {}, exists: present })).toThrow(/did not confirm/);
  });
  it('fails a development-only certificate', () => {
    expect(() => checkStatic({ dir: DIR, run: ok('Signature is valid\nCertificate is valid for development only.'), env: {}, exists: present })).toThrow(/development-only/);
  });
  it('fails when the signature is about to run out', () => {
    expect(() => checkStatic({ dir: DIR, run: ok('Signature is valid: streaming, 12 days left'), env: {}, exists: present })).toThrow(/only 12 days left/);
  });
  it('fails when Vex.exe.sig is missing, without even asking castLabs', () => {
    let asked = false;
    const exists = (p) => !/\.sig$/.test(p);
    expect(() => checkStatic({ dir: DIR, run: () => { asked = true; return { status: 0, stdout: '', stderr: '' }; }, env: {}, exists })).toThrow(/Vex\.exe\.sig is missing/);
    expect(asked).toBe(false);
  });
  it('fails when there is no build', () => {
    expect(() => checkStatic({ dir: DIR, run: ok(''), env: {}, exists: () => false })).toThrow(/no built app/);
  });
  it('refuses a no-DRM test build outright', () => {
    expect(() => checkStatic({ dir: DIR, run: ok('Signature is valid'), env: { VEX_SKIP_VMP_VERIFY: '1' }, exists: present })).toThrow(/no-DRM test build/);
  });
  it('fails when python or castlabs-evs cannot be run', () => {
    const run = () => ({ status: null, stdout: '', stderr: '', error: new Error('spawn python ENOENT') });
    expect(() => checkStatic({ dir: DIR, run, env: {}, exists: present })).toThrow(/spawn python ENOENT/);
  });
});

describe('preflight (before the version is bumped)', () => {
  it('passes when castlabs-evs runs', () => {
    expect(preflight({ run: ok('usage: vmp'), env: {} })).toMatch(/available/);
  });
  it('stops the release when it does not, and says how to fix it', () => {
    const run = () => ({ status: 1, stdout: '', stderr: 'No module named castlabs_evs', error: null });
    expect(() => preflight({ run, env: {} })).toThrow(/pip install castlabs-evs/);
  });
  it('refuses a no-DRM environment', () => {
    expect(() => preflight({ run: ok(''), env: { VEX_SKIP_VMP_VERIFY: '1' } })).toThrow(/no-DRM/);
  });
});

describe('checkBoot (the built app, in a throwaway profile)', () => {
  const exe = path.join(__dirname, '../../package.json');   // any file that exists
  it('passes when the smoke harness reports PASS', () => {
    const run = () => ({ status: 0, stdout: 'RESULT: PASS — Widevine ready (version 4.10); license request of 412 bytes generated', stderr: '' });
    expect(checkBoot({ exe, run, env: {} })).toMatch(/Widevine ready/);
  });
  it('fails with the harness\'s reason', () => {
    const run = () => ({ status: 1, stdout: 'RESULT: FAIL — Widevine did not become ready: not available — Widevine is not installed', stderr: '' });
    expect(() => checkBoot({ exe, run, env: {} })).toThrow(/Widevine is not installed/);
  });
  it('starts the built exe with the DRM check on and no OS task', () => {
    let seen;
    checkBoot({ exe, run: (c, a, o) => { seen = o.env; return { status: 0, stdout: 'RESULT: PASS — x', stderr: '' }; }, env: {} });
    // VEX_RELEASE_BOOT lets the probe harness start the build the release has just made in dist\win-unpacked.
    expect(seen).toMatchObject({ VEX_SMOKE_EXECUTABLE: exe, VEX_RELEASE_BOOT: '1', VEX_DRM_SMOKE: '1', VEX_NO_OS_SCHEDULE: '1' });
  });
});

describe('the in-app assertion (drm-smoke)', () => {
  const win = (bytes) => ({ webContents: { executeJavaScript: async () => bytes } });
  it('passes once Widevine is ready and the CDM makes a license request', async () => {
    const seq = ['not available - Widevine is not installed', 'Widevine ready (version 4.10.2710.0)'];
    let i = 0;
    const r = await drmSmoke.run({ mainWindow: win(412), status: () => seq[Math.min(i++, 1)], isPackaged: true, sleep: async () => {} });
    expect(r).toMatch(/Widevine ready .*412 bytes/);
  });
  it('fails if Widevine never becomes ready', async () => {
    let t = 0;
    await expect(drmSmoke.run({ mainWindow: win(1), status: () => 'failed: timed out', isPackaged: true, deadlineMs: 5000, now: () => (t += 3000), sleep: async () => {} })).rejects.toThrow(/did not become ready: failed: timed out/);
  });
  it('fails from source, where Widevine cannot be installed', async () => {
    await expect(drmSmoke.run({ mainWindow: win(1), status: () => 'Widevine ready', isPackaged: false })).rejects.toThrow(/BUILT app/);
  });
  it('fails on an empty license request', async () => {
    await expect(drmSmoke.run({ mainWindow: win(0), status: () => 'Widevine ready (version 1)', isPackaged: true, sleep: async () => {} })).rejects.toThrow(/empty license request/);
  });
});

describe('wired into the release', () => {
  const steps = pkg.scripts.publish.split('&&').map(s => s.trim());
  it('npm run publish checks DRM after the packaged boot and before the signing check, the release and the upload', () => {
    const boot = steps.findIndex(s => s.includes('verify-packaged-boot'));
    const drm = steps.findIndex(s => s.includes('verify-drm.js --boot'));
    expect(drm).toBeGreaterThan(boot);
    expect(drm).toBeLessThan(steps.findIndex(s => s.includes('verify-signing')));
    expect(drm).toBeLessThan(steps.findIndex(s => s.includes('ensure-release')));
    expect(drm).toBeLessThan(steps.findIndex(s => s.includes('upload-release')));
  });
  it('release.js runs the preflight before it changes any file', () => {
    const src = fs.readFileSync(path.join(__dirname, '../../scripts/release.js'), 'utf8');
    const gate = src.indexOf("require('./verify-drm.js').preflight()");
    expect(gate).toBeGreaterThan(0);
    expect(gate).toBeLessThan(src.indexOf('// 2. Bump version'));
  });
  it('the smoke hook and the longer harness timeout exist', () => {
    const main = fs.readFileSync(path.join(__dirname, '../../src/main.js'), 'utf8');
    expect(main).toContain("process.env.VEX_DRM_SMOKE === '1'");
    expect(main).toContain("require('./main/drm-smoke').run(");
    expect(fs.readFileSync(path.join(__dirname, '../../scripts/verify-smoke-boot.js'), 'utf8')).toContain('VEX_DRM_SMOKE');
  });
});

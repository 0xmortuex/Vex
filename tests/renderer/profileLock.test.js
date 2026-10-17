// @vitest-environment jsdom
//
// T3-123, Settings' side of the encrypted profile lock: off by default, the pure helpers, the recovery-code
// display (copy, saved, the check of the last group) and the wiring. The engine is tested in tests/main/profileCrypt.test.js.
import { describe, it, expect, beforeEach, vi } from 'vitest';
const fs = require('fs');
const path = require('path');
const { VexProfileLock } = require('../../src/renderer/js/profile-lock.js');
const ROOT = path.resolve(__dirname, '../..');

beforeEach(() => { localStorage.clear(); delete window.vex; delete window.vexConfirm; delete window.vexPrompt; delete window.showToast; });

describe('Encrypted profile lock (renderer)', () => {
  it('is off until switched on', () => {
    expect(VexProfileLock.enabled()).toBe(false);
    VexProfileLock.setEnabled(true);
    expect(VexProfileLock.enabled()).toBe(true);
  });
  it('refuses a short, long or all-digit passphrase', () => {
    expect(VexProfileLock.passphraseProblem('short')).toMatch(/at least 8/);
    expect(VexProfileLock.passphraseProblem('x'.repeat(129))).toMatch(/at most 128/);
    expect(VexProfileLock.passphraseProblem('12345678')).toMatch(/Digits alone/);
    expect(VexProfileLock.passphraseProblem('four plain words here')).toBe('');
  });
  it('says what state the profile is in', () => {
    expect(VexProfileLock.statusLine({ enabled: false })).toMatch(/Not encrypted/);
    expect(VexProfileLock.statusLine({ enabled: true, state: 'encrypted', locked: false })).toMatch(/Unlocked/);
    expect(VexProfileLock.statusLine({ enabled: true, state: 'decrypting', locked: true })).toMatch(/interrupted/);
  });
  it('counts the plaintext backups it cannot reach', () => {
    expect(VexProfileLock.coverage({ plainCopies: 3 }).notCovered.join(' ')).toMatch(/3 file\(s\)/);
    expect(VexProfileLock.coverage({ plainCopies: 0 }).notCovered.join(' ')).toMatch(/none are on disk/);
  });
  it('asks for the last group of the code', () => {
    expect(VexProfileLock.confirmGroup('AAAA-BBBB-CCCC-DDDD-EEEE-FFFF-GGGG-HHHH')).toBe('HHHH');
  });
  it('turning on refuses while the options are off, and when the passphrases differ', async () => {
    await expect(VexProfileLock.turnOn()).rejects.toThrow(/switched off/);
    VexProfileLock.setEnabled(true);
    window.vex = { profileCryptStatus: async () => ({ enabled: false }), profileCryptEnable: vi.fn() };
    window.vexConfirm = async () => true;
    const answers = ['a long passphrase', 'a different one'];
    window.vexPrompt = async () => answers.shift();
    await expect(VexProfileLock.turnOn()).rejects.toThrow(/not the same/);
    expect(window.vex.profileCryptEnable).not.toHaveBeenCalled();
  });
  it('shows the recovery code until it is saved and the last group is typed back', async () => {
    const code = 'AAAA-BBBB-CCCC-DDDD-EEEE-FFFF-GGGG-HHHH';
    const copySecret = vi.fn(async () => true);
    window.vex = { copySecret };
    window.showToast = vi.fn();
    const seen = [];
    // 1st: Copy; 2nd: saved; then the check is wrong once, right the second time (which shows the code again first).
    const script = [{ copy: true }, { ok: true }, { ok: true }];
    window.vexConfirm = async (o) => { seen.push(o.html); const step = script.shift(); if (step.copy) o.extra.run(); return !!step.ok; };
    const typed = ['wxyz', 'hhhh'];
    window.vexPrompt = async () => typed.shift();
    expect(await VexProfileLock.showRecoveryCode(code)).toBe(true);
    expect(copySecret).toHaveBeenCalledWith(code, 60);
    expect(seen.every((h) => h.includes(code))).toBe(true);
    expect(seen.length).toBe(3);
  });
  it('closing without saving asks twice before it lets go', async () => {
    window.vex = { copySecret: async () => true };
    const answers = [false, false, false, true];          // Close, "show again", Close, "Close anyway"
    window.vexConfirm = async () => answers.shift();
    expect(await VexProfileLock.showRecoveryCode('AAAA-BBBB-CCCC-DDDD-EEEE-FFFF-GGGG-HHHH')).toBe(false);
    expect(answers).toEqual([]);
  });
});

describe('wiring', () => {
  it('has a script tag, a manifest, a catalog entry and a usage row, and ships maturity new', () => {
    const html = fs.readFileSync(path.join(ROOT, 'src/renderer/index.html'), 'utf8');
    expect(html).toContain('js/profile-lock.js');
    const man = fs.readFileSync(path.join(ROOT, 'src/renderer/js/feature-manifests.js'), 'utf8');
    expect(man).toMatch(/id: 'profile-lock'[^}]*maturity: 'new'/);
    expect(fs.readFileSync(path.join(ROOT, 'src/renderer/js/feature-catalog.js'), 'utf8')).toContain("feature: 'profile-lock'");
    expect(fs.readFileSync(path.join(ROOT, 'src/renderer/js/vex-usage-registry.js'), 'utf8')).toContain("['profile-lock'");
  });
});

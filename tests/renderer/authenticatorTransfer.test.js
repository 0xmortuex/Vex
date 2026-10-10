// @vitest-environment jsdom
// The Authenticator panel: a pasted (or scanned) Google Authenticator export
// link goes to the migration import; Back up asks again, then for the
// passphrase twice; Restore asks for the passphrase.
import { describe, it, expect, beforeEach, vi } from 'vitest';

require('../../src/renderer/js/vex-icons.js');
globalThis.VexIcons = window.VexIcons;
require('../../src/renderer/js/authenticator.js');
const A = () => window.Authenticator;
const tick = async (n = 6) => { for (let i = 0; i < n; i++) await new Promise(r => setTimeout(r, 0)); };

let el;
beforeEach(async () => {
  document.body.innerHTML = '<div id="p"></div>';
  el = document.getElementById('p');
  window.showToast = vi.fn();
  window.VexLock = { recheck: vi.fn(async () => true) };
  window.vex = {
    totpList: vi.fn(async () => []), totpCodes: vi.fn(async () => []),
    totpAdd: vi.fn(async () => ({ ok: true })),
    totpImportMigration: vi.fn(async () => ({ added: 2, duplicates: 1, invalid: 0, skipped: 1 })),
    totpExportBackup: vi.fn(async () => ({ ok: true, count: 3, path: 'x' })),
    totpImportBackup: vi.fn(async () => ({ ok: true, added: 3, duplicates: 0, invalid: 0 })),
  };
  vi.spyOn(A(), '_startTicking').mockImplementation(() => {});
  await A().renderPanel(el);
});

describe('Authenticator transfer', () => {
  it('a pasted Google Authenticator export link imports every account in it', async () => {
    el.querySelector('#auth-secret').value = 'otpauth-migration://offline?data=CgA%3D';
    await A()._add();
    expect(window.vex.totpImportMigration).toHaveBeenCalledWith('otpauth-migration://offline?data=CgA%3D');
    expect(window.vex.totpAdd).not.toHaveBeenCalled();
    expect(window.showToast).toHaveBeenCalledWith('Google Authenticator: 2 accounts added, 1 already here, 1 counter-based (HOTP) left out');
  });

  it('back up: re-check, passphrase twice, then main saves it', async () => {
    const answers = ['correct horse', 'correct horse'];
    window.vexPrompt = vi.fn(async () => answers.shift());
    el.querySelector('#auth-backup').click();
    await tick();
    expect(window.VexLock.recheck).toHaveBeenCalled();
    expect(window.vexPrompt.mock.calls.every(c => c[0].password === true)).toBe(true);
    expect(window.vex.totpExportBackup).toHaveBeenCalledWith('correct horse');
    expect(window.showToast).toHaveBeenCalledWith('Backed up 3 accounts');
  });

  it('back up refuses a short or mistyped passphrase', async () => {
    window.vexPrompt = vi.fn(async () => 'short');
    el.querySelector('#auth-backup').click();
    await tick();
    const answers = ['correct horse', 'correct house'];
    window.vexPrompt = vi.fn(async () => answers.shift());
    el.querySelector('#auth-backup').click();
    await tick();
    expect(window.vex.totpExportBackup).not.toHaveBeenCalled();
    expect(window.showToast).toHaveBeenCalledWith('The two passphrases are not the same — nothing was saved', 'error');
  });

  it('restore says what came in, or why not', async () => {
    window.vexPrompt = vi.fn(async () => 'correct horse');
    el.querySelector('#auth-restore').click();
    await tick();
    expect(window.showToast).toHaveBeenCalledWith('Restored: 3 accounts added');
    window.vex.totpImportBackup = vi.fn(async () => { throw new Error("Error invoking remote method 'totp:import-backup': Error: Wrong passphrase, or the file was changed"); });
    el.querySelector('#auth-restore').click();
    await tick();
    expect(window.showToast).toHaveBeenCalledWith('Could not restore: Wrong passphrase, or the file was changed', 'error');
  });
});

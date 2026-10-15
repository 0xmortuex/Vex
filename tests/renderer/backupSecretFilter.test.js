// @vitest-environment jsdom
//
// "Back up everything" leaves secrets out by the shape of the key's name. As a
// bare substring, "pass" and "auth" also threw out ordinary settings: the
// Discord and Roblox bypass modes and the passkey host lists (found 2026-10-10).

import { describe, it, expect } from 'vitest';
const { VexBackup } = require('../../src/renderer/js/backup.js');

describe('backup secret filter', () => {
  it('keeps settings whose names only contain a secret-looking fragment', () => {
    const prefs = ['vex.discordBypassMode', 'vex.robloxBypass', 'vex.passkeySuppressedHosts',
      'vex.passkeyAllowedHosts', 'vex.breachCheck', 'vex.keybindings', 'vex.authorName'];
    expect(prefs.filter(k => VexBackup._blocked(k))).toEqual([]);
  });

  it('still leaves real secrets out', () => {
    const secrets = ['vex.password', 'vex.savedPasswords', 'vex.syncPassphrase', 'vex.apiKey', 'vex.ai.apiKey',
      'vex.githubToken', 'vex.synctoken', 'vex.authToken', 'vex.oauth', 'vex.workerSecret', 'vex.credentials',
      'vex.vault', 'vex.totpSites', 'vex.otpSeed', 'vex.seed', 'vex.sync_key', 'vex.syncKeys', 'vex.pass',
      'vex.lockPin', 'vex.locked', 'vex.lockFails', 'vex.lockWaitUntil', 'vex.mcpServers', 'vex.OTPCode', 'vex.AUTH',
      // Passkeys never live in a preference; a key by their name is a store.
      'vex.passkeys', 'vex.passkeyStore', 'vex.passkeyCredentials', 'vex.passkeyPrivateKeys', 'vex.passkeysSync'];
    expect(secrets.filter(k => !VexBackup._blocked(k))).toEqual([]);
  });

  it('says what a restore does: it writes the file over Vex and leaves the rest (it said "replaces")', async () => {
    localStorage.clear();
    localStorage.setItem('vex.notInFile', 'kept');
    localStorage.setItem('vex.theme', 'old');
    globalThis.VexIcons = { svg: () => '' };
    let asked = null;
    globalThis.vexConfirm = async (o) => { asked = o.message; return true; };
    const m = VexBackup.open();
    expect(m.textContent).not.toMatch(/replaces/);
    expect(m.textContent).toMatch(/left as it is/);
    await VexBackup._restore({ v: 1, at: new Date().toISOString(), items: { 'vex.theme': 'new' } }, m, () => {});
    expect(asked).not.toMatch(/replaces/);
    expect(asked).toMatch(/left as it is/);
    expect(localStorage.getItem('vex.theme')).toBe('new');
    expect(localStorage.getItem('vex.notInFile')).toBe('kept');
    m.remove();
    delete globalThis.vexConfirm;
  });

  it('a backup keeps the bypass mode and drops the token', () => {
    localStorage.clear();
    localStorage.setItem('vex.discordBypassMode', 'strong');
    localStorage.setItem('vex.githubToken', 'ghp_x');
    const data = VexBackup.collect([]);
    expect(data.items['vex.discordBypassMode']).toBe('strong');
    expect('vex.githubToken' in data.items).toBe(false);
  });
});

describe('page actions never travel in a backup', () => {
  it('vex.pageActions and the recorder state are denylisted', () => {
    expect(VexBackup._blocked('vex.pageActions')).toBe(true);
    expect(VexBackup._blocked('vex.pageRecorder.runs')).toBe(true);
    expect(VexBackup._blocked('vex.pageRecorder.state')).toBe(true);
  });

  it('collect leaves them out and restore does not write them, but says so', () => {
    localStorage.clear();
    localStorage.setItem('vex.pageActions', JSON.stringify({ enabled: true, scripts: [{ name: 'x' }] }));
    localStorage.setItem('vex.theme', 'oxford');
    const out = VexBackup.collect();
    expect(out.items['vex.pageActions']).toBeUndefined();
    expect(out.items['vex.theme']).toBe('oxford');
    const file = { v: 1, at: new Date().toISOString(), items: { 'vex.pageActions': JSON.stringify({ enabled: true, scripts: [] }), 'vex.theme': 'dark' } };
    localStorage.removeItem('vex.pageActions');
    expect(VexBackup.describe(file).pageActions).toBe(true);
    VexBackup.apply(file);
    expect(localStorage.getItem('vex.pageActions')).toBeNull();
    expect(localStorage.getItem('vex.theme')).toBe('dark');
  });
});

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
      'vex.lockPin', 'vex.locked', 'vex.lockFails', 'vex.lockWaitUntil', 'vex.mcpServers', 'vex.OTPCode', 'vex.AUTH'];
    expect(secrets.filter(k => !VexBackup._blocked(k))).toEqual([]);
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

// Passkey suppression: the "*" default, hostnames, and the sites allowed from
// the "asked for a passkey" bar, which win over the list.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
const { passkeySuppressed } = require('../../src/main/passkey-policy.js');

describe('passkeySuppressed', () => {
  it('suppresses everywhere by default, narrows to hostnames, and [] turns it off', () => {
    expect(passkeySuppressed(['*'], [], 'roblox.com')).toBe(true);
    expect(passkeySuppressed(['roblox.com'], [], 'roblox.com')).toBe(true);
    expect(passkeySuppressed(['roblox.com'], [], 'github.com')).toBe(false);
    expect(passkeySuppressed([], [], 'roblox.com')).toBe(false);
    expect(passkeySuppressed('not-an-array', [], 'roblox.com')).toBe(false);
  });
  it('never suppresses a site the person allowed', () => {
    expect(passkeySuppressed(['*'], ['login.example.com'], 'login.example.com')).toBe(false);
    expect(passkeySuppressed(['*'], ['login.example.com'], 'example.com')).toBe(true);
    expect(passkeySuppressed(['*'], 'corrupt', 'login.example.com')).toBe(true);
  });
  it('is what main.js uses, with the allowed list read from the saved settings', () => {
    const main = fs.readFileSync(path.join(__dirname, '../../src/main.js'), 'utf8');
    expect(main).toMatch(/require\('\.\/main\/passkey-policy'\)\.passkeySuppressed\(\s*_readPersistString\('vex\.passkeySuppressedHosts', \['\*'\]\),\s*_readPersistString\('vex\.passkeyAllowedHosts', \[\]\)/);
  });
});

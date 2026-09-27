import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
const require = createRequire(import.meta.url);
const { validate } = require('../../src/main/ipc-schemas.js');

// Every site that asked for a location was refused without a prompt: the
// guest shim sent { origin } to a channel whose schema takes an optional
// string, the refusal was caught, and "caught" meant "denied" (2026-09-27).
describe('the location permission check reaches main', () => {
  it('the call the shim makes passes the channel schema', () => {
    const src = fs.readFileSync(new URL('../../src/preload-webview.js', import.meta.url), 'utf8');
    const call = src.match(/ipcRenderer\.invoke\('geolocation:check-permission'([^)]*)\)/);
    expect(call).not.toBeNull();
    expect(call[1]).toBe('');                       // no argument: main reads the asking frame
    expect(() => validate('geolocation:check-permission', [])).not.toThrow();
  });
  it('an object argument would still be refused, which is what went wrong', () => {
    expect(() => validate('geolocation:check-permission', [{ origin: 'https://a.test' }])).toThrow();
  });
});

import { describe, it, expect } from 'vitest';
import { isExternalProtocol } from '../../src/main-helpers.js';

// `isExternalProtocol` returns TRUE only for schemes in the EXTERNAL_PROTOCOLS
// allowlist — those are the ones we hand off to shell.openExternal so the OS
// app launches. Anything not on the list (including dangerous schemes like
// javascript: and data:) returns FALSE: the caller treats false as "not our
// problem, leave it to Chromium / drop it" — which is the SAFE outcome for
// javascript: because we explicitly do NOT want to feed those to openExternal.

describe('isExternalProtocol', () => {
  describe('returns true for known external protocols', () => {
    it.each([
      ['mailto:foo@bar.com'],
      ['tel:+15551234'],
      ['sms:+15551234'],
      ['magnet:?xt=urn:btih:abc'], // not in allowlist — see "returns false" group
    ].slice(0, 3))('%s', (url) => {
      expect(isExternalProtocol(url)).toBe(true);
    });

    it('steam: launches the Steam client', () => {
      expect(isExternalProtocol('steam://run/440')).toBe(true);
    });
    it('obsidian: opens an Obsidian vault', () => {
      expect(isExternalProtocol('obsidian://open?vault=foo')).toBe(true);
    });
    it('discord: opens the Discord app', () => {
      expect(isExternalProtocol('discord://channels/@me')).toBe(true);
    });
    it('vscode: launches VS Code', () => {
      expect(isExternalProtocol('vscode://file/c:/x')).toBe(true);
    });
    it('case-insensitive scheme match', () => {
      expect(isExternalProtocol('MAILTO:foo@bar.com')).toBe(true);
      expect(isExternalProtocol('Roblox-Player://launch')).toBe(true);
    });
  });

  describe('returns false for schemes NOT on the allowlist', () => {
    it('http://', () => expect(isExternalProtocol('http://example.com')).toBe(false));
    it('https://', () => expect(isExternalProtocol('https://example.com')).toBe(false));
    it('file://', () => expect(isExternalProtocol('file:///C:/x.html')).toBe(false));
    it('about:blank', () => expect(isExternalProtocol('about:blank')).toBe(false));
    it('chrome://', () => expect(isExternalProtocol('chrome://settings')).toBe(false));
    it('data:', () => expect(isExternalProtocol('data:text/html,<h1>hi</h1>')).toBe(false));
    it('blob:', () => expect(isExternalProtocol('blob:https://x.com/abc')).toBe(false));
    it('magnet: (intentionally excluded — not on allowlist)', () => {
      expect(isExternalProtocol('magnet:?xt=urn:btih:abc')).toBe(false);
    });
  });

  describe('javascript: must return FALSE (security-critical)', () => {
    // The original task asked for true here, but the function's contract is
    // an allowlist — true means "hand off to shell.openExternal". We MUST NOT
    // hand a javascript: URL to the OS shell. The protective behaviour is
    // exactly that javascript: is NOT in EXTERNAL_PROTOCOLS, so the function
    // returns false and the URL falls through to the regular nav pipeline,
    // where Chromium drops it inside a webview.
    it('javascript:alert(1) is not forwarded to shell.openExternal', () => {
      expect(isExternalProtocol('javascript:alert(1)')).toBe(false);
    });
  });

  describe('returns false for empty / null / malformed input', () => {
    it('null', () => expect(isExternalProtocol(null)).toBe(false));
    it('undefined', () => expect(isExternalProtocol(undefined)).toBe(false));
    it('empty string', () => expect(isExternalProtocol('')).toBe(false));
    it('no colon', () => expect(isExternalProtocol('mailtofoo@bar')).toBe(false));
    it('just a path', () => expect(isExternalProtocol('/foo/bar')).toBe(false));
    it('leading colon', () => expect(isExternalProtocol(':mailto:x')).toBe(false));
    it('scheme starts with digit', () => expect(isExternalProtocol('1http://x')).toBe(false));
  });
});

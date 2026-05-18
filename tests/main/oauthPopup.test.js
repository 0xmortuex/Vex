import { describe, it, expect } from 'vitest';
import { isOAuthPopupUrl } from '../../src/main-helpers.js';

// Google/Microsoft/Apple identity endpoints run a POPUP-based OAuth
// handshake — the popup postMessages the credential back to window.opener
// and self-closes. setWindowOpenHandler must 'allow' these as real popups;
// every other URL falls through to the tab path. isOAuthPopupUrl is the
// predicate that gate.

describe('isOAuthPopupUrl', () => {
  describe('popup-based OAuth hosts → true (allowed as a real popup window)', () => {
    it('accounts.google.com', () => {
      expect(isOAuthPopupUrl('https://accounts.google.com/o/oauth2/auth?client_id=x')).toBe(true);
    });
    it('accounts.google.com /gsi/transform — the exact endpoint the bug hung on', () => {
      expect(isOAuthPopupUrl('https://accounts.google.com/gsi/transform')).toBe(true);
    });
    it('login.microsoftonline.com', () => {
      expect(isOAuthPopupUrl('https://login.microsoftonline.com/common/oauth2/v2.0/authorize')).toBe(true);
    });
    it('appleid.apple.com', () => {
      expect(isOAuthPopupUrl('https://appleid.apple.com/auth/authorize?response_type=code')).toBe(true);
    });
    it('matches by host regardless of path — the whole host is OAuth territory', () => {
      expect(isOAuthPopupUrl('https://accounts.google.com/')).toBe(true);
    });
  });

  describe('non-popup-OAuth and regular URLs → false (fall through to the tab path)', () => {
    it('github.com/login is redirect-based, not a popup — deliberately excluded', () => {
      expect(isOAuthPopupUrl('https://github.com/login/oauth/authorize?client_id=x')).toBe(false);
    });
    it('login.live.com (legacy Microsoft, redirect-based) is deliberately excluded', () => {
      expect(isOAuthPopupUrl('https://login.live.com/oauth20_authorize.srf')).toBe(false);
    });
    it('a regular web page', () => {
      expect(isOAuthPopupUrl('https://example.com/some/page')).toBe(false);
    });
    it('a regular Google property that is not the identity host', () => {
      expect(isOAuthPopupUrl('https://www.google.com/search?q=x')).toBe(false);
    });
  });

  describe('exact-host match — no subdomain / suffix / substring spoofing', () => {
    it('rejects a deceptive suffix host (accounts.google.com.evil.example)', () => {
      expect(isOAuthPopupUrl('https://accounts.google.com.evil.example/auth')).toBe(false);
    });
    it('rejects a subdomain of an OAuth host', () => {
      expect(isOAuthPopupUrl('https://evil.accounts.google.com/auth')).toBe(false);
    });
    it('rejects a host that merely contains an OAuth host as a substring', () => {
      expect(isOAuthPopupUrl('https://myaccounts.google.com/auth')).toBe(false);
    });
  });

  describe('print-like popup URLs → false (handled by the print branch, never OAuth)', () => {
    // setWindowOpenHandler checks the print-popup branch BEFORE the OAuth
    // branch; these must not be mis-claimed by isOAuthPopupUrl (empty host).
    it('about:blank', () => expect(isOAuthPopupUrl('about:blank')).toBe(false));
    it('blob: URL', () => expect(isOAuthPopupUrl('blob:https://x.example/abc-123')).toBe(false));
    it('data: URL', () => expect(isOAuthPopupUrl('data:text/html,<p>hi</p>')).toBe(false));
  });

  describe('malformed / empty input → false', () => {
    it('empty string', () => expect(isOAuthPopupUrl('')).toBe(false));
    it('null', () => expect(isOAuthPopupUrl(null)).toBe(false));
    it('undefined', () => expect(isOAuthPopupUrl(undefined)).toBe(false));
    it('not a URL at all', () => expect(isOAuthPopupUrl('not a url')).toBe(false));
  });
});

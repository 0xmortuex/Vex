import { describe, it, expect } from 'vitest';
import { isOAuthPopupUrl, isAuthHandlerPopupUrl } from '../../src/main-helpers.js';

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

// Firebase / federated auth handler popups, matched by PATH on any host (the
// authDomain is the site's own domain). Routing these into Peek/a tab severs
// window.opener and the popup hangs blank — the ElevenLabs "Sign in with
// Google" bug. setWindowOpenHandler must 'allow' them as real popup windows.
describe('isAuthHandlerPopupUrl', () => {
  describe('Firebase auth handler/iframe paths → true (on any host)', () => {
    it('ElevenLabs own-domain auth handler (the reported case)', () => {
      expect(isAuthHandlerPopupUrl('https://elevenlabs.io/__/auth/handler?state=AMbdmDmK85u9H0')).toBe(true);
    });
    it('classic firebaseapp.com authDomain handler', () => {
      expect(isAuthHandlerPopupUrl('https://my-app.firebaseapp.com/__/auth/handler?apiKey=x')).toBe(true);
    });
    it('the auth iframe endpoint', () => {
      expect(isAuthHandlerPopupUrl('https://foo.web.app/__/auth/iframe')).toBe(true);
    });
    it('with a hash fragment', () => {
      expect(isAuthHandlerPopupUrl('https://site.com/__/auth/handler#x')).toBe(true);
    });
  });

  describe('non-auth-handler URLs → false', () => {
    it('a regular page on a Firebase-hosted site', () => {
      expect(isAuthHandlerPopupUrl('https://elevenlabs.io/app/sign-up')).toBe(false);
    });
    it('a path that merely contains the segment but does not end with it', () => {
      expect(isAuthHandlerPopupUrl('https://evil.com/__/auth/handler/extra')).toBe(false);
    });
    it('a lookalike path', () => {
      expect(isAuthHandlerPopupUrl('https://evil.com/auth/handler')).toBe(false);
    });
    it('non-http(s) scheme', () => {
      expect(isAuthHandlerPopupUrl('app://x/__/auth/handler')).toBe(false);
    });
    it('empty / null / malformed', () => {
      expect(isAuthHandlerPopupUrl('')).toBe(false);
      expect(isAuthHandlerPopupUrl(null)).toBe(false);
      expect(isAuthHandlerPopupUrl('not a url')).toBe(false);
    });
  });
});

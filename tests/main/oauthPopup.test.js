import { describe, it, expect } from 'vitest';
import { isOAuthPopupUrl, isAuthHandlerPopupUrl, isOAuthShapedUrl, shouldKeepPopupReal, isScriptedHandbackPopup, isDiscordHostUrl } from '../../src/main-helpers.js';

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

// Provider-agnostic OAuth-shape detector. Gates on URL shape, not host, so a
// Discord (or any "Login with X") popup stays a real opener-connected popup —
// the fix for the Ticket Tool / tickettool.xyz Discord-OAuth handback failure.
describe('isOAuthShapedUrl', () => {
  describe('OAuth-shaped URLs → true', () => {
    it('Discord oauth2 authorize (the reported failing flow)', () => {
      expect(isOAuthShapedUrl('https://discord.com/oauth2/authorize?client_id=123&redirect_uri=https%3A%2F%2Ftickettool.xyz%2Fcb&response_type=code&scope=identify')).toBe(true);
    });
    it('Discord /api/oauth2/authorize variant', () => {
      expect(isOAuthShapedUrl('https://discord.com/api/oauth2/authorize?client_id=1&redirect_uri=x&response_type=code')).toBe(true);
    });
    it('Ticket Tool auth callback (api.tickettool.xyz/api/auth/callback?code=...)', () => {
      expect(isOAuthShapedUrl('https://api.tickettool.xyz/api/auth/callback?code=abc123')).toBe(true);
    });
    it('Google identity authorize (response_type=code)', () => {
      expect(isOAuthShapedUrl('https://accounts.google.com/o/oauth2/v2/auth?client_id=x&redirect_uri=y&response_type=code')).toBe(true);
    });
    it('Microsoft identity authorize', () => {
      expect(isOAuthShapedUrl('https://login.microsoftonline.com/common/oauth2/v2.0/authorize?client_id=x&redirect_uri=y&response_type=code')).toBe(true);
    });
    it('Apple authorize (/auth/authorize path)', () => {
      expect(isOAuthShapedUrl('https://appleid.apple.com/auth/authorize?client_id=x&redirect_uri=y')).toBe(true);
    });
    it('generic authorize with client_id + redirect_uri but no response_type', () => {
      expect(isOAuthShapedUrl('https://id.example.com/oauth/authorize?client_id=a&redirect_uri=b')).toBe(true);
    });
  });

  describe('non-OAuth URLs → false', () => {
    it('a normal https page', () => {
      expect(isOAuthShapedUrl('https://example.com/some/page')).toBe(false);
    });
    it('a blog post that merely mentions oauth in the path', () => {
      expect(isOAuthShapedUrl('https://example.com/blog/oauth-tips')).toBe(false);
    });
    it('a Google search for an oauth term', () => {
      expect(isOAuthShapedUrl('https://www.google.com/search?q=oauth/authorize')).toBe(false);
    });
    it('data: URL', () => expect(isOAuthShapedUrl('data:text/html,<p>hi</p>')).toBe(false));
    it('javascript: URL', () => expect(isOAuthShapedUrl('javascript:alert(1)')).toBe(false));
    it('about:blank', () => expect(isOAuthShapedUrl('about:blank')).toBe(false));
    it('empty / null / malformed', () => {
      expect(isOAuthShapedUrl('')).toBe(false);
      expect(isOAuthShapedUrl(null)).toBe(false);
      expect(isOAuthShapedUrl('not a url')).toBe(false);
    });
  });
});

// The combined gate used by setWindowOpenHandler — keeps a popup as a real
// opener-connected window. Must be true for Discord + the 4 existing allowlisted
// providers, false for ordinary pages and pseudo-schemes.
describe('shouldKeepPopupReal', () => {
  it('Discord OAuth authorize', () => {
    expect(shouldKeepPopupReal('https://discord.com/oauth2/authorize?client_id=1&redirect_uri=x&response_type=code')).toBe(true);
  });
  it('Ticket Tool callback', () => {
    expect(shouldKeepPopupReal('https://api.tickettool.xyz/api/auth/callback?code=abc')).toBe(true);
  });
  it('Google identity (allowlisted host)', () => {
    expect(shouldKeepPopupReal('https://accounts.google.com/gsi/transform')).toBe(true);
  });
  it('Microsoft identity (allowlisted host)', () => {
    expect(shouldKeepPopupReal('https://login.microsoftonline.com/common/oauth2/v2.0/authorize')).toBe(true);
  });
  it('Apple identity (allowlisted host)', () => {
    expect(shouldKeepPopupReal('https://appleid.apple.com/auth/authorize?response_type=code')).toBe(true);
  });
  it('Firebase auth handler (path-matched)', () => {
    expect(shouldKeepPopupReal('https://my-app.firebaseapp.com/__/auth/handler?apiKey=x')).toBe(true);
  });
  it('a normal page → false (routes to Peek/tab)', () => {
    expect(shouldKeepPopupReal('https://example.com/some/page')).toBe(false);
  });
  it('data: / javascript: → false', () => {
    expect(shouldKeepPopupReal('data:text/html,x')).toBe(false);
    expect(shouldKeepPopupReal('javascript:alert(1)')).toBe(false);
  });
});

// Redirect-proof gate: keep a SCRIPTED window.open popup real (opener intact)
// based on window SHAPE, not its first URL — so an OAuth flow that opens at a
// non-OAuth-shaped bounce URL and only redirects into the provider afterward
// (the Ticket Tool / Discord case, proven: disp=new-window frame=login) still
// stays a real opener-connected popup. Must NOT match bare shift+click so that
// shift+click → Peek is preserved.
describe('isScriptedHandbackPopup', () => {
  describe('scripted window.open popups → true (kept real, opener intact)', () => {
    it('Ticket Tool: new-window + features + frame name (the proven failing case)', () => {
      expect(isScriptedHandbackPopup('new-window', 'width=500,height=700', 'login')).toBe(true);
    });
    it('new-window with features but no name', () => {
      expect(isScriptedHandbackPopup('new-window', 'width=480,height=640,popup', '')).toBe(true);
    });
    it('new-window with a frame name but empty features', () => {
      expect(isScriptedHandbackPopup('new-window', '', 'oauthpopup')).toBe(true);
    });
    it('features passed as an array (Electron can hand either form)', () => {
      expect(isScriptedHandbackPopup('new-window', ['width=500', 'height=700'], '')).toBe(true);
    });
    it('a lone noopener feature still counts as scripted (non-empty features)', () => {
      expect(isScriptedHandbackPopup('new-window', 'noopener', '')).toBe(true);
    });
  });

  describe('NOT a scripted handback popup → false (falls through to Peek/tab)', () => {
    it('bare shift+click: new-window, no features, no name → stays Peek', () => {
      expect(isScriptedHandbackPopup('new-window', '', '')).toBe(false);
    });
    it('shift+click with undefined features/frameName', () => {
      expect(isScriptedHandbackPopup('new-window', undefined, undefined)).toBe(false);
    });
    it('whitespace-only features with no name → false', () => {
      expect(isScriptedHandbackPopup('new-window', '   ', '')).toBe(false);
    });
    it('reserved _blank target with no features → false (that is a plain new tab)', () => {
      expect(isScriptedHandbackPopup('new-window', '', '_blank')).toBe(false);
    });
    it('foreground-tab (target=_blank / featureless window.open) → false, stays a tab', () => {
      expect(isScriptedHandbackPopup('foreground-tab', '', 'login')).toBe(false);
    });
    it('background-tab (ctrl/middle-click) → false', () => {
      expect(isScriptedHandbackPopup('background-tab', '', '')).toBe(false);
    });
    it('default disposition → false', () => {
      expect(isScriptedHandbackPopup('default', 'width=500', 'x')).toBe(false);
    });
    it('missing/empty disposition → false', () => {
      expect(isScriptedHandbackPopup('', 'width=500', 'x')).toBe(false);
      expect(isScriptedHandbackPopup(undefined, 'width=500', 'x')).toBe(false);
    });
  });
});

// Discord-opener detector. When a Discord page scripts a window.open (the
// "Pop Out" stream/screen-share/voice window), setWindowOpenHandler keeps it a
// real window but as a PLAIN resizable+fullscreenable one — not the Peek auth
// card (which disabled Full Screen and added a stream-breaking "Open as tab").
describe('isDiscordHostUrl', () => {
  describe('Discord web hosts → true', () => {
    it('discord.com app route (the opener while watching a stream)', () => {
      expect(isDiscordHostUrl('https://discord.com/channels/123/456')).toBe(true);
    });
    it('bare discord.com', () => expect(isDiscordHostUrl('https://discord.com/app')).toBe(true));
    it('ptb./canary. subdomains', () => {
      expect(isDiscordHostUrl('https://ptb.discord.com/app')).toBe(true);
      expect(isDiscordHostUrl('https://canary.discord.com/app')).toBe(true);
    });
    it('discordapp.com (legacy) + discordapp.net (media)', () => {
      expect(isDiscordHostUrl('https://discordapp.com/app')).toBe(true);
      expect(isDiscordHostUrl('https://cdn.discordapp.net/x')).toBe(true);
    });
    it('discord.gg invite host', () => expect(isDiscordHostUrl('https://discord.gg/abc')).toBe(true));
  });

  describe('non-Discord / spoofy / malformed → false', () => {
    it('a deceptive suffix host (discord.com.evil.example)', () => {
      expect(isDiscordHostUrl('https://discord.com.evil.example/app')).toBe(false);
    });
    it('a host that merely contains discord as a substring', () => {
      expect(isDiscordHostUrl('https://notdiscord.com/app')).toBe(false);
    });
    it('a regular page', () => expect(isDiscordHostUrl('https://example.com/x')).toBe(false));
    it('non-http(s) scheme', () => expect(isDiscordHostUrl('app://discord.com/x')).toBe(false));
    it('empty / null / malformed', () => {
      expect(isDiscordHostUrl('')).toBe(false);
      expect(isDiscordHostUrl(null)).toBe(false);
      expect(isDiscordHostUrl('not a url')).toBe(false);
    });
  });
});

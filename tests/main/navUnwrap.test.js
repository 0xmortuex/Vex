// @vitest-environment node
//
// Skipping tracking redirect links (src/main/nav-unwrap.js): the pure address logic, as a table. It changes where a click goes, so it
// is stricter than "copy this link": a target must be a clean absolute http(s) address, never a downgrade, never a login redirect.
// Measured in real Electron 42 (throwaway probe): a webRequest.onBeforeRequest answer of { redirectURL } on a link the person clicked
// (a trusted click through the DevTools protocol) landed on the target and the server never saw the wrapper; a script-made
// navigation with no click, a form POST to the wrapper and a typed address were all left alone.
import { describe, it, expect } from 'vitest';
const fs = require('fs'), path = require('path');
const NU = require('../../src/main/nav-unwrap.js');
const NavPrivacy = require('../../src/main/nav-privacy.js');
const main = fs.readFileSync(path.join(__dirname, '../../src/main.js'), 'utf8');
const enc = encodeURIComponent;
const un = (u) => NU.unwrapNavigation(u);
const to = (u) => { const r = un(u); return r && r.url; };

describe('the known wrappers', () => {
  it('google.com/url takes q or url, on any google domain', () => {
    expect(to('https://www.google.com/url?q=' + enc('https://example.com/a?b=1&c=2') + '&sa=D&usg=x')).toBe('https://example.com/a?b=1&c=2');
    expect(to('https://www.google.com/url?sa=t&url=' + enc('https://example.com/x'))).toBe('https://example.com/x');
    expect(to('https://www.google.com.tr/url?q=' + enc('https://example.com/'))).toBe('https://example.com/');
    expect(to('https://google.de/url?q=' + enc('https://example.com/'))).toBe('https://example.com/');
  });
  it('the first parameter that holds a real address wins (a search term in q does not stop url)', () => {
    expect(to('https://www.google.com/url?q=a+search+term&url=' + enc('https://example.com/ok'))).toBe('https://example.com/ok');
    expect(un('https://www.google.com/url?q=a+search+term')).toBe(null);
  });
  it('facebook, duckduckgo, reddit, youtube, steam, linkedin', () => {
    expect(to('https://l.facebook.com/l.php?u=' + enc('https://example.com/p') + '&h=AT0')).toBe('https://example.com/p');
    expect(to('https://duckduckgo.com/l/?uddg=' + enc('https://example.com/d'))).toBe('https://example.com/d');
    expect(to('https://out.reddit.com/t3_abc?url=' + enc('https://example.com/r') + '&token=x')).toBe('https://example.com/r');
    expect(to('https://www.youtube.com/redirect?event=video_description&q=' + enc('https://example.com/y'))).toBe('https://example.com/y');
    expect(to('https://steamcommunity.com/linkfilter/?url=' + enc('https://example.com/s'))).toBe('https://example.com/s');
    expect(to('https://www.linkedin.com/redir/redirect?url=' + enc('https://example.com/l'))).toBe('https://example.com/l');
  });
  it('href.li carries the address after a bare ?', () => {
    expect(to('https://href.li/?https://example.com/h')).toBe('https://example.com/h');
    expect(to('https://href.li/?' + enc('https://example.com/h2'))).toBe('https://example.com/h2');
    expect(un('https://href.li/?%E0%A4%A')).toBe(null);   // a malformed escape is not an address
  });
  it('says which redirect pages it skipped', () => {
    expect(un('https://l.facebook.com/l.php?u=' + enc('https://example.com/')).via).toEqual(['l.facebook.com']);
  });
  it('does nothing to an address that is not a wrapper', () => {
    for (const u of ['https://example.com/', 'https://www.google.com/search?q=' + enc('https://example.com/'), 'https://www.google.com/url', 'https://notgoogle.com/url?q=' + enc('https://example.com/'),
      'https://google.com.evil.test/url?q=' + enc('https://example.com/'), 'https://l.facebook.com/l.php', 'https://l.facebook.com/l.php?u=', 'https://example.com/url?q=' + enc('https://example.org/')]) {
      expect(un(u)).toBe(null);
    }
  });
  it('a bare t.co style shortener has nothing in the address to read, so it is left alone', () => {
    expect(un('https://t.co/AbC123')).toBe(null);
    expect(un('https://bit.ly/3xyz')).toBe(null);
  });
});

describe('never the redirects that are a sign-in or an app hand-over', () => {
  it('Roblox and Discord login pages keep their return address', () => {
    expect(un('https://www.roblox.com/login?returnUrl=' + enc('https://www.roblox.com/home'))).toBe(null);
    expect(un('https://www.roblox.com/newlogin?returnUrl=' + enc('https://www.roblox.com/home'))).toBe(null);
    expect(un('https://discord.com/login?redirect_to=' + enc('https://discord.com/channels/1'))).toBe(null);
    expect(un('https://discordapp.com/login?redirect_to=' + enc('https://discord.com/channels/1'))).toBe(null);
  });
  it('the Roblox share link that hands over to the app', () => {
    expect(un('https://ro.blox.com/Ebh5?af_web_dp=' + enc('https://www.roblox.com/games/1'))).toBe(null);
  });
});

describe('what a target may be', () => {
  const g = (inner) => 'https://www.google.com/url?q=' + inner;
  it('refuses javascript:, data:, blob:, file:, vbscript:, about: and ftp:', () => {
    for (const bad of ['javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'data:text/html,<script>alert(1)</script>', 'blob:https://x.example/uuid', 'file:///C:/Windows/win.ini', 'vbscript:msgbox(1)', 'about:blank', 'ftp://example.com/f', 'chrome://settings', 'vex-pdf://view/x', 'mailto:a@b.example']) {
      expect(un(g(enc(bad))), bad).toBe(null);
    }
  });
  it('refuses a relative target, a protocol-relative one and a bare word', () => {
    for (const bad of ['/search?q=1', '//evil.example/x', 'evil.example/x', 'x', '?a=1', '#frag', '\\\\evil.example\\x', 'http:/evil.example', 'http:evil.example']) {
      expect(un(g(enc(bad))), bad).toBe(null);
    }
  });
  it('refuses an address with a user name or password in it', () => {
    expect(un(g(enc('https://user:pass@example.com/')))).toBe(null);
    expect(un(g(enc('https://google.com@evil.example/')))).toBe(null);
  });
  it('refuses spaces, tabs, new lines and other control characters anywhere in it', () => {
    for (const bad of ['https://exa mple.com/', 'https://example.com/a b', 'https://example.com/\tx', 'https://example.com/\nx', 'https://example.com/\r\nSet-Cookie:x', 'https://example.com/\u0000', 'https://example.com/\u0085', 'https://example.com/\u2028']) {
      expect(un(g(enc(bad))), JSON.stringify(bad)).toBe(null);
    }
  });
  it('refuses an empty target, an address with no host and an over-long one', () => {
    expect(un(g(''))).toBe(null);
    expect(un(g(enc('https://')))).toBe(null);
    expect(un(g(enc('https:///x')))).toBe(null);
    expect(un(g(enc('https://example.com/' + 'a'.repeat(9000))))).toBe(null);
  });
  it('keeps the target’s path, query, fragment, port and encoding as they were', () => {
    expect(to(g(enc('https://example.com:8443/p%20q/?a=1&b=%26#top')))).toBe('https://example.com:8443/p%20q/?a=1&b=%26#top');
  });
  it('accepts http from an http wrapper', () => {
    expect(to('http://www.google.com/url?q=' + enc('http://example.com/'))).toBe('http://example.com/');
  });
});

describe('https to http is refused', () => {
  it('a secure wrapper never leads to an insecure page', () => {
    expect(un('https://www.google.com/url?q=' + enc('http://example.com/'))).toBe(null);
    expect(un('https://l.facebook.com/l.php?u=' + enc('http://example.com/'))).toBe(null);
  });
  it('at any hop of a chain', () => {
    const inner = 'https://l.facebook.com/l.php?u=' + enc('http://example.com/');
    expect(un('https://www.google.com/url?q=' + enc(inner))).toBe(null);
    const mid = 'http://out.reddit.com/x?url=' + enc('http://example.com/');
    expect(un('https://www.google.com/url?q=' + enc(mid))).toBe(null);   // https -> http at the first hop
  });
});

describe('nested and double-encoded', () => {
  it('follows a wrapper inside a wrapper', () => {
    const inner = 'https://l.facebook.com/l.php?u=' + enc('https://example.com/deep');
    const r = un('https://www.google.com/url?q=' + enc(inner));
    expect(r.url).toBe('https://example.com/deep');
    expect(r.via).toEqual(['google.com', 'l.facebook.com']);
  });
  it('stops at 4 hops and leaves a longer chain alone', () => {
    let u = 'https://example.com/end';
    for (let i = 0; i < 4; i++) u = 'https://www.google.com/url?q=' + enc(u);
    expect(un(u).url).toBe('https://example.com/end');
    u = 'https://www.google.com/url?q=' + enc(u);   // a fifth
    expect(un(u)).toBe(null);
  });
  it('a chain whose last wrapper holds an unsafe target stops at that wrapper, as the click would have gone there anyway', () => {
    const inner = 'https://l.facebook.com/l.php?u=' + enc('javascript:alert(1)');
    const r = un('https://www.google.com/url?q=' + enc(inner));
    expect(r.url).toBe(inner);
    expect(un(r.url)).toBe(null);   // and that last page is never skipped
  });
  it('decodes a double-encoded target (twice at most)', () => {
    const once = enc('https://example.com/a?b=1');
    expect(to('https://www.google.com/url?q=' + enc(once))).toBe('https://example.com/a?b=1');
    const twice = enc(once);
    expect(to('https://www.google.com/url?q=' + enc(twice))).toBe('https://example.com/a?b=1');
    const thrice = enc(twice);
    expect(un('https://www.google.com/url?q=' + enc(thrice))).toBe(null);
  });
  it('a double-encoded unsafe target is still refused', () => {
    expect(un('https://www.google.com/url?q=' + enc(enc('javascript:alert(1)')))).toBe(null);
    expect(un('https://www.google.com/url?q=' + enc(enc('https://user:p@evil.example/')))).toBe(null);
  });
  it('a malformed escape inside the target is refused, not thrown', () => {
    expect(() => un('https://www.google.com/url?q=https%253A%252F%252Fexample.com%252F%25ZZ')).not.toThrow();
    expect(un('https://www.google.com/url?q=https%253A%252F%252Fexample.com%252F%25ZZ')).toBe(null);
  });
});

describe('addresses that are not addresses', () => {
  it('never throws', () => {
    for (const u of ['', 'nonsense', 'https://', 'javascript:1', undefined, null, 42, {}, 'https://www.google.com/url?q=%']) {
      expect(() => NU.unwrapNavigation(u)).not.toThrow();
    }
  });
  it('only http(s) wrappers', () => {
    expect(un('ftp://www.google.com/url?q=' + enc('https://example.com/'))).toBe(null);
    expect(un('file:///url?q=' + enc('https://example.com/'))).toBe(null);
  });
  it('an over-long wrapper address is left alone', () => {
    expect(un('https://www.google.com/url?q=' + enc('https://example.com/') + '&x=' + 'a'.repeat(9000))).toBe(null);
  });
});

describe('the per-site off switch', () => {
  const wrapper = 'https://www.google.com/url?q=' + enc('https://school.example/login');
  it('allows when nobody opted out', () => {
    expect(NU.siteAllows({}, 'https://mail.example/', wrapper, 'https://school.example/login')).toBe(true);
  });
  it('is off for the page the click was on, the redirect page, or the page it leads to (and their subdomains)', () => {
    expect(NU.siteAllows({ 'mail.example': { unwrap: 'off' } }, 'https://www.mail.example/inbox', wrapper, 'https://school.example/login')).toBe(false);
    expect(NU.siteAllows({ 'google.com': { unwrap: 'off' } }, 'https://mail.example/', wrapper, 'https://school.example/login')).toBe(false);
    expect(NU.siteAllows({ 'school.example': { unwrap: 'off' } }, 'https://mail.example/', wrapper, 'https://portal.school.example/login')).toBe(false);
  });
  it('another switch on the site does not count as off', () => {
    expect(NU.siteAllows({ 'school.example': { cookies: 'off' } }, 'https://mail.example/', wrapper, 'https://school.example/login')).toBe(true);
  });
  it('is kept by clean() like the other switches', () => {
    expect(require('../../src/main/site-rules.js').clean({ 'school.example': { unwrap: 'off' } })).toEqual({ 'school.example': { unwrap: 'off' } });
  });
});

describe('the global setting', () => {
  it('is undecided (null) until the window decides, and off in main until then', () => {
    expect(NavPrivacy.clean(null).unwrap).toBe(null);
    expect(NavPrivacy.clean({ lite: true }).unwrap).toBe(null);
    expect(NavPrivacy.clean({ unwrap: true }).unwrap).toBe(true);
    expect(NavPrivacy.clean({ unwrap: 'yes' }).unwrap).toBe(null);
  });
  it('is changed only with a boolean', () => {
    expect(NavPrivacy.apply({ lite: false, unwrap: null }, { unwrap: true })).toEqual({ lite: false, unwrap: true });
    expect(() => NavPrivacy.apply({ lite: false, unwrap: null }, { unwrap: null })).toThrow(/on or off/);
    expect(() => NavPrivacy.apply({ lite: false, unwrap: null }, { unwrap: 1 })).toThrow(/on or off/);
  });
});

describe('where main applies it', () => {
  it('only for a main-frame GET, a click in the last 3 seconds, and only when switched on (never "undecided")', () => {
    const at = main.indexOf('function _unwrapAnswer(');
    const body = main.slice(at, at + 700);
    expect(body).toMatch(/_navPrivacy\.unwrap !== true \|\| details\.resourceType !== 'mainFrame' \|\| details\.method !== 'GET' \|\| !details\.webContentsId\) return null;/);
    expect(body).toMatch(/Date\.now\(\) - last > UNWRAP_GESTURE_MS\) return null;/);
    expect(main).toMatch(/const UNWRAP_GESTURE_MS = 3000;/);
  });
  it('not in a Tor tab, not for a page that is not a tab, and not for a site that opted out', () => {
    const at = main.indexOf('function _unwrapTarget(');
    const body = main.slice(at, at + 1500);
    expect(body).toMatch(/getType\(\) !== 'webview' \|\| \(contents\.session && contents\.session\.__vexTor\)\) return null;/);
    expect(body).toMatch(/NavUnwrap\.siteAllows\(_siteRules, from, url, r\.url\)\) return null;/);
  });
  it('the answer goes through the one place every session’s request hook ends in, before the HTTPS-only upgrade', () => {
    const at = main.indexOf('function _httpsAnswer(');
    const body = main.slice(at, at + 900);
    expect(body.indexOf('_unwrapAnswer(details)')).toBeGreaterThan(body.indexOf('_threatGuard(details)'));
    expect(body.indexOf('_unwrapAnswer(details)')).toBeLessThan(body.indexOf('_httpsUpgradeURL(details)'));
    expect(body).toMatch(/return \{ redirectURL: unwrapped \};/);
  });
  it('a link opened in a new tab is skipped too, with no Undo (its page is not the one clicked)', () => {
    expect(main).toMatch(/const url = _unwrapTarget\(contents, details\.url, \{ newTab: true \}\) \|\| details\.url;\s*win\.webContents\.send\('tab:create-from-external', \{\s*url,/);
  });
  it('Undo lets the wrapper through once, for that tab and address, for 30 seconds', () => {
    expect(main).toMatch(/ipcMain\.handle\('linkunwrap:allow-once'[\s\S]{0,500}_unwrapBypass\.set\(pageId, \{ url, until: Date\.now\(\) \+ 30000 \}\)/);
    expect(main).toMatch(/if \(bypass\.url === url && bypass\.until >= Date\.now\(\)\) return null;/);
  });
});

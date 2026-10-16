// @vitest-environment jsdom
//
// Wave 4 safer-web fold-ins (js/chat-link-hygiene.js, js/safe-web-extras.js):
// invite and redirect hygiene on chat links, "is this safe to send", the weekly
// breach re-check, the backup check, and the permission prompt's reason line.
import { describe, it, expect, beforeEach, vi } from 'vitest';

const { LinkSafety } = require('../../src/renderer/js/link-safety.js');
globalThis.LinkSafety = LinkSafety;
const { ChatLinkHygiene } = require('../../src/renderer/js/chat-link-hygiene.js');
const { SafeWebExtras } = require('../../src/renderer/js/safe-web-extras.js');
const { VexBackup } = require('../../src/renderer/js/backup.js');

beforeEach(() => {
  localStorage.clear();
  globalThis.VexProblems = { note: vi.fn() };
  delete globalThis.VexAttention;
  delete globalThis.VexLedger;
  delete window.vex;
});

describe('chat links: redirects and invites', () => {
  it('unwraps a redirect on Discord’s own address and flags the unrelated destination', () => {
    const r = ChatLinkHygiene.inspect('https://discord.com/login?redirect_to=' + encodeURIComponent('https://evil.example/gift'));
    expect(r.destination).toBe('https://evil.example/gift');
    expect(r.hops).toHaveLength(1);
    expect(r.level).toBe('caution');
    expect(r.lines[0]).toMatch(/redirect: it really goes to evil\.example/);
  });
  it('unwraps the Roblox share wrapper and treats a Roblox destination as a note, not a warning', () => {
    const r = ChatLinkHygiene.inspect('https://ro.blox.com/Ebh5?pid=share&af_web_dp=' + encodeURIComponent('https://www.roblox.com/games/1234/x'));
    expect(r.destination).toBe('https://www.roblox.com/games/1234/x');
    expect(r.level).toBe('note');
  });
  it('does not unwrap an OAuth screen or a same-site return path', () => {
    expect(ChatLinkHygiene.unwrap('https://discord.com/oauth2/authorize?client_id=1&redirect_uri=' + encodeURIComponent('https://app.example/cb')).hops).toEqual([]);
    expect(ChatLinkHygiene.unwrap('https://www.roblox.com/login?returnUrl=%2Fgames%2F1').hops).toEqual([]);
  });
  it('knows a server invite, says it cannot tell whether it has run out, and stays a note', () => {
    for (const u of ['https://discord.gg/abc123', 'https://discord.com/invite/abc123', 'https://discordapp.com/invite/abc123']) {
      const r = ChatLinkHygiene.inspect(u);
      expect(r.invite, u).toMatchObject({ kind: 'discord-invite', code: 'abc123' });
      expect(r.level, u).toBe('note');
      expect(r.lines.join(' ')).toMatch(/Vex cannot tell/);
    }
  });
  it('flags a Nitro gift as one-use, and as a warning on an address that is not Discord', () => {
    const real = ChatLinkHygiene.inspect('https://discord.gift/AbCdEf');
    expect(real.invite).toMatchObject({ kind: 'discord-gift', oneTime: true });
    expect(real.level).toBe('note');
    const fake = ChatLinkHygiene.inspect('https://discord-gifts.com/AbCdEf');
    expect(fake.level).toBe('caution');
    expect(fake.lines.join(' ')).toMatch(/uses Discord’s name with a come-on word/);
  });
  it('flags Roblox private-server, share and live-server links as ones that run out', () => {
    expect(ChatLinkHygiene.invite('https://www.roblox.com/games/606849621/Jailbreak?privateServerLinkCode=123')).toMatchObject({ kind: 'roblox-private-server', expiring: true });
    expect(ChatLinkHygiene.invite('https://www.roblox.com/share?code=abc&type=Server')).toMatchObject({ kind: 'roblox-share', expiring: true });
    expect(ChatLinkHygiene.invite('https://www.roblox.com/games/start?placeId=1&gameInstanceId=xyz')).toMatchObject({ kind: 'roblox-live-server', expiring: true });
  });
  it('reads an expiry the link carries, and calls an old one expired', () => {
    const old = ChatLinkHygiene.inspect('https://discord.gg/abc?expires=1000000000');
    expect(old.invite.expired).toBe(true);
    expect(old.level).toBe('caution');
    const future = ChatLinkHygiene.invite('https://example.org/join?expires=' + (Math.floor(Date.now() / 1000) + 86400));
    expect(future).toMatchObject({ expiring: true, expired: false });
    expect(ChatLinkHygiene.invite('https://example.org/join?once=1').oneTime).toBe(true);
    expect(ChatLinkHygiene.invite('https://example.org/join?once=0')).toBeNull();
  });
  it('says a link left a chat for another site', () => {
    const r = ChatLinkHygiene.inspect('https://example.org/a', { openerUrl: 'https://discord.com/channels/1/2' });
    expect(r.lines[0]).toBe('It came from Discord and leaves it for example.org.');
    expect(ChatLinkHygiene.inspect('https://example.org/a').lines).toEqual([]);
  });
  it('says nothing about an honest brand site name or a plain link', () => {
    expect(ChatLinkHygiene.inspect('https://discord.js.org/docs').level).toBe('none');
    expect(ChatLinkHygiene.inspect('https://discordbots.example/list').level).toBe('none');
    expect(ChatLinkHygiene.inspect('not a url').lines).toEqual([]);
  });
});

describe('is this link safe to send', () => {
  it('is quiet for an ordinary link', () => {
    const v = ChatLinkHygiene.sendVerdict('https://example.org/page');
    expect(v).toEqual({ level: 'ok', lines: [], clean: 'https://example.org/page', changed: false });
  });
  it('notes a shortener, tracking tags, and an unencrypted address', () => {
    expect(ChatLinkHygiene.sendVerdict('https://bit.ly/abc').lines.join(' ')).toMatch(/link shortener/);
    const t = ChatLinkHygiene.sendVerdict('https://example.org/p?utm_source=x&id=2');
    expect(t.changed).toBe(true);
    expect(t.clean).toBe('https://example.org/p?id=2');
    expect(t.level).toBe('note');
    expect(ChatLinkHygiene.sendVerdict('http://example.org/p').lines.join(' ')).toMatch(/not encrypted/);
  });
  it('warns about a lookalike and about a secret in the address', () => {
    const l = ChatLinkHygiene.sendVerdict('https://paypa1.com/login');
    expect(l.level).toBe('caution');
    const s = ChatLinkHygiene.sendVerdict('https://example.org/x?token=abc');
    expect(s.level).toBe('caution');
    expect(s.lines.join(' ')).toMatch(/token=/);
  });
  it('is off until switched on: no toast text, no menu row', () => {
    expect(ChatLinkHygiene.enabled()).toBe(false);
    expect(ChatLinkHygiene.copyNote('https://bit.ly/abc')).toBeNull();
    expect(ChatLinkHygiene.menuItems('https://discord.gift/x', 'https://discord.com/channels/1/2')).toEqual([]);
    ChatLinkHygiene.setEnabled(true);
    const note = ChatLinkHygiene.copyNote('https://paypa1.com/');
    expect(note.kind).toBe('error');
    expect(note.text).toMatch(/^Before you send this:/);
    expect(ChatLinkHygiene.copyNote('https://example.org/')).toBeNull();
    const rows = ChatLinkHygiene.menuItems('https://discord.gift/x', 'https://discord.com/channels/1/2');
    expect(rows).toHaveLength(1);
    expect(rows[0].disabled).toBe(true);
    expect(rows[0].label.length).toBeLessThan(110);
  });
});

describe('weekly breach re-check', () => {
  const entry = (host, username) => ({ host, username, count: 3 });
  const setup = (...runs) => {
    const q = runs.slice();
    window.vex = { vaultBreachCheck: vi.fn(async () => ({ checked: 9, breached: q.shift() })) };
    globalThis.VexAttention = { suggest: vi.fn(() => true) };
    globalThis.VexLedger = { record: vi.fn() };
  };

  it('is off by default and refuses to switch on without the breach check', () => {
    expect(SafeWebExtras.recheckEnabled()).toBe(false);
    expect(() => SafeWebExtras.setRecheckEnabled(true)).toThrow(/Password Health/);
    localStorage.setItem('vex.breachCheck', 'true');
    SafeWebExtras.setRecheckEnabled(true);
    expect(SafeWebExtras.recheckEnabled()).toBe(true);
  });
  it('does nothing, and asks nobody, while it is off', async () => {
    setup([]);
    expect(await SafeWebExtras.recheck()).toEqual({ skipped: 'off' });
    expect(window.vex.vaultBreachCheck).not.toHaveBeenCalled();
    await expect(SafeWebExtras.recheck({ force: true })).rejects.toThrow(/off/);
  });
  it('the first run only sets the baseline, and says nothing', async () => {
    localStorage.setItem('vex.breachCheck', 'true'); SafeWebExtras.setRecheckEnabled(true);
    setup([entry('a.example', 'me')]);
    expect(await SafeWebExtras.recheck()).toEqual({ baseline: true, count: 1 });
    expect(globalThis.VexAttention.suggest).not.toHaveBeenCalled();
    expect(globalThis.VexLedger.record).toHaveBeenCalledOnce();
    // The stored list holds short tags, never a host or a user name.
    expect(localStorage.getItem('vex.safeWeb.breachSeen')).not.toMatch(/example|me/);
  });
  it('a later run leaves ONE Inbox line for what is newly breached, and waits a week between runs', async () => {
    localStorage.setItem('vex.breachCheck', 'true'); SafeWebExtras.setRecheckEnabled(true);
    setup([entry('a.example', 'me')], [entry('a.example', 'me'), entry('b.example', 'me'), entry('c.example', 'me')]);
    await SafeWebExtras.recheck();
    expect(await SafeWebExtras.recheck()).toEqual({ skipped: 'not due' });
    localStorage.setItem('vex.safeWeb.breachLast', String(Date.now() - 8 * 86400000));
    expect(await SafeWebExtras.recheck()).toEqual({ count: 3, fresh: 2 });
    expect(globalThis.VexAttention.suggest).toHaveBeenCalledOnce();
    const row = globalThis.VexAttention.suggest.mock.calls[0][0];
    expect(row).toMatchObject({ feature: 'breach-recheck', title: '2 saved passwords are newly in a known breach' });
    expect(row.action.key).toBe('open');
  });
  it('says nothing when nothing is new', async () => {
    localStorage.setItem('vex.breachCheck', 'true'); SafeWebExtras.setRecheckEnabled(true);
    setup([entry('a.example', 'me')], [entry('a.example', 'me')]);
    await SafeWebExtras.recheck();
    localStorage.setItem('vex.safeWeb.breachLast', '0');
    expect(await SafeWebExtras.recheck()).toEqual({ count: 1, fresh: 0 });
    expect(globalThis.VexAttention.suggest).not.toHaveBeenCalled();
  });
  it('a failed check is noted, not swallowed and not announced as a breach', async () => {
    localStorage.setItem('vex.breachCheck', 'true'); SafeWebExtras.setRecheckEnabled(true);
    window.vex = { vaultBreachCheck: vi.fn(async () => { throw new Error('The vault is locked'); }) };
    globalThis.VexAttention = { suggest: vi.fn() };
    await SafeWebExtras.tick();
    expect(globalThis.VexProblems.note).toHaveBeenCalledWith('Breach re-check', expect.any(String), expect.objectContaining({ message: 'The vault is locked' }));
    expect(globalThis.VexAttention.suggest).not.toHaveBeenCalled();
  });
});

describe('backup check', () => {
  it('finds values that look like secrets and reports only the setting’s name', () => {
    const token = 'ghp_' + 'a1B2c3D4e5'.repeat(4);
    const r = SafeWebExtras.scanItems({ 'vex.notes': 'my token is ' + token, 'vex.theme': 'dark', 'vex.link': 'https://user:hunter22@host.example/x', 'vex.empty': '' });
    expect(r.scanned).toBe(4);
    expect(r.findings.map(f => f.key).sort()).toEqual(['vex.link', 'vex.notes']);
    expect(JSON.stringify(r)).not.toContain(token);
    expect(JSON.stringify(r)).not.toContain('hunter22');
  });
  it('reports that a backup is not encrypted, what it withholds and what it would hold', () => {
    localStorage.setItem('vex.theme', 'dark');
    localStorage.setItem('vex.apiToken', 'x');                       // withheld by its name
    localStorage.setItem('vex.stickyNotes', 'pin: AKIA' + 'ABCDEFGHIJKLMNOP');
    localStorage.setItem('vex.aiConversations', '[]');               // an optional group
    const r = SafeWebExtras.backupReport();
    expect(r.encrypted).toBe(false);
    expect(r.withheld).toBeGreaterThanOrEqual(1);
    expect(r.findings.map(f => f.key)).toContain('vex.stickyNotes');
    expect(r.optional).toContain('chats');
    expect(r.lines[0]).toMatch(/not encrypted/);
    expect(r.lines.join('\n')).toMatch(/vex\.stickyNotes: looks like an AWS access key/);
    expect(r.lines.join('\n')).not.toContain('AKIAABCDEFGHIJKLMNOP');
  });
  it('is read-only: it changes nothing in storage', () => {
    localStorage.setItem('vex.theme', 'dark');
    const before = JSON.stringify(Object.entries(localStorage));
    SafeWebExtras.backupReport();
    expect(JSON.stringify(Object.entries(localStorage))).toBe(before);
    expect(typeof VexBackup.collect).toBe('function');
  });
  it('says so plainly when nothing looks like a secret', () => {
    localStorage.setItem('vex.theme', 'dark');
    expect(SafeWebExtras.backupReport().lines.join('\n')).toMatch(/No value in it looks like a password/);
  });
});

describe('third-party line for the site panel', () => {
  it('words each case', () => {
    expect(SafeWebExtras.thirdPartyLine(null)).toBe('Counting…');
    expect(SafeWebExtras.thirdPartyLine({ error: 'boom' })).toBe('boom');
    expect(SafeWebExtras.thirdPartyLine({ note: 'Not counted in a Tor tab.' })).toBe('Not counted in a Tor tab.');
    expect(SafeWebExtras.thirdPartyLine({ contacted: 0, withCookies: 0, cookies: 0 })).toBe('This page loaded nothing from other sites.');
    expect(SafeWebExtras.thirdPartyLine({ contacted: 4, withCookies: 0, cookies: 0 })).toBe('Loaded from 4 other sites; none of them keeps a cookie here.');
    expect(SafeWebExtras.thirdPartyLine({ contacted: 1, withCookies: 1, cookies: 1 })).toBe('Loaded from 1 other site; 1 of them keeps 1 cookie here.');
  });
  it('does not read a Tor tab, a private tab or a page that is not loaded', async () => {
    expect(await SafeWebExtras.thirdPartyFor({ web: true, tor: true, wv: {} })).toMatchObject({ note: expect.stringMatching(/Tor/) });
    expect(await SafeWebExtras.thirdPartyFor({ web: true })).toMatchObject({ note: expect.stringMatching(/not loaded/) });
    window.VexTabPolicy = { canReadWebview: () => false };
    expect(await SafeWebExtras.thirdPartyFor({ web: true, wv: {} })).toMatchObject({ note: expect.stringMatching(/private/) });
    delete window.VexTabPolicy;
    expect(await SafeWebExtras.thirdPartyFor({ web: false })).toMatchObject({ note: 'Not a website.' });
  });
  it('asks main for counts with only host names from the page', async () => {
    window.vexGuestEval = vi.fn(async () => ['a.tracker.net', 'cdn.example.org']);
    window.vex = { webSafety: { thirdPartyCount: vi.fn(async () => ({ contacted: 1, withCookies: 1, cookies: 2, domains: [] })) } };
    const r = await SafeWebExtras.thirdPartyFor({ web: true, wv: {}, fullHost: 'www.example.org', host: 'example.org', partition: 'persist:main' });
    expect(r.cookies).toBe(2);
    expect(window.vex.webSafety.thirdPartyCount).toHaveBeenCalledWith({ site: 'www.example.org', partition: 'persist:main', hosts: ['a.tracker.net', 'cdn.example.org'] });
    delete window.vexGuestEval;
  });
});

describe('permission prompt reason line', () => {
  it('draws the reason under the plain-language risk line', () => {
    document.body.innerHTML = '';
    window.escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    window.requestAnimationFrame = (f) => f();
    const { PermissionPrompts } = (() => { require('../../src/renderer/js/permission-prompts.js'); return { PermissionPrompts: window.PermissionPrompts }; })();
    PermissionPrompts.showPrompt({ id: 'p1', origin: 'https://example.org', permission: 'geolocation', risk: { level: 'normal', riskLine: 'It could learn where you are.', reason: 'Sites ask where you are for maps.', why: [], summary: '' } });
    const el = document.querySelector('.perm-risk-reason');
    expect(el).not.toBeNull();
    expect(el.textContent).toBe('Sites ask where you are for maps.');
    expect(document.querySelector('.perm-risk-line').nextElementSibling).toBe(el);
  });
});

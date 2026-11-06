// @vitest-environment node
//
// "Forget this site when I close it" (src/main/site-forget.js), tested with a fake session. Also measured in real Electron 42
// on 2026-11-07 (throwaway probe): clearing one origin's storage and cookies through this code left another origin's
// localStorage and cookies untouched, and the quit sweep removed a cookie of the site and left the other site's.
import { describe, it, expect, vi } from 'vitest';
const fs = require('fs'), path = require('path');
const SiteRules = require('../../src/main/site-rules.js');
const { createSiteForget, quitTargets, partitionAllowed } = require('../../src/main/site-forget.js');
const main = fs.readFileSync(path.join(__dirname, '../../src/main.js'), 'utf8');

// A session that remembers what was cleared and holds a few cookies.
function fakeSession(cookies = []) {
  const jar = [...cookies];
  const ses = {
    cleared: [], removed: [], flushed: 0,
    clearStorageData: vi.fn(async (o) => { ses.cleared.push(o.origin); }),
    flushStorageData: vi.fn(async () => { ses.flushed += 1; }),
    cookies: {
      get: vi.fn(async (f) => {
        if (!f || !f.url) return jar.slice();
        const u = new URL(f.url);
        return jar.filter(c => { const d = c.domain.replace(/^\./, ''); return u.hostname === d || u.hostname.endsWith('.' + d); });
      }),
      remove: vi.fn(async (url, name) => { ses.removed.push(name + '@' + new URL(url).hostname); }),
    },
  };
  return ses;
}
const make = ({ rules, sessions, open = [] }) => createSiteForget({
  getRules: () => rules,
  sessionFor: (p) => sessions[p],
  openPages: () => open,
  quitPartitions: () => Object.keys(sessions),
  log: { error: vi.fn() },
});

describe('the rule', () => {
  it('is kept by clean() for an ordinary site and dropped for a protected one', () => {
    expect(SiteRules.clean({ 'school.example': { forget: true } })).toEqual({ 'school.example': { forget: true } });
    for (const h of ['netflix.com', 'www.spotify.com', 'open.spotify.com', 'discord.com', 'discordapp.com', 'disneyplus.com', 'twitch.tv']) {
      expect(SiteRules.clean({ [h]: { forget: true } })).toEqual({});
    }
    expect(SiteRules.clean({ 'school.example': { forget: 'yes' } })).toEqual({});
  });
  it('forgets() is true only for a site that asked, and never for a protected one even if the file was edited', () => {
    expect(SiteRules.forgets({ 'school.example': { forget: true } }, 'https://portal.school.example/x')).toBe(true);
    expect(SiteRules.forgets({ 'school.example': { forget: true } }, 'https://other.example/')).toBe(false);
    expect(SiteRules.forgets({ 'netflix.com': { forget: true } }, 'https://www.netflix.com/browse')).toBe(false);
    expect(SiteRules.forgets({ 'notnetflix.com': { forget: true } }, 'https://notnetflix.com/')).toBe(true);
  });
  it('names the key a page’s rule was saved under', () => {
    const r = { 'school.example': { forget: true }, 'a.school.example': { cookies: 'off' } };
    expect(SiteRules.ruleKeyFor(r, 'https://www.school.example/')).toBe('school.example');
    expect(SiteRules.ruleKeyFor(r, 'https://b.a.school.example/')).toBe('a.school.example');
    expect(SiteRules.ruleKeyFor(r, 'https://elsewhere.example/')).toBe(null);
  });
  it('only the main session and the containers are ever swept, never a panel’s', () => {
    for (const ok of ['persist:main', 'persist:container-work', 'persist:container-my_1']) expect(partitionAllowed(ok)).toBe(true);
    for (const no of ['persist:discord', 'persist:spotify', 'persist:netflix', 'persist:whatsapp', 'persist:claude', 'persist:roblox', 'persist:route-tor', 'persist:route-proxy-1', 'tor-3', 'burner-1', 'private:1', '', undefined, 'persist:container-']) {
      expect(partitionAllowed(no)).toBe(false);
    }
  });
});

describe('the last tab of the site closed', () => {
  const rules = { 'school.example': { forget: true } };
  const url = 'https://portal.school.example/exam';

  it('clears the site’s storage and its cookies in the tab’s own session, and says so', async () => {
    const ses = fakeSession([{ domain: '.school.example', name: 'sid', path: '/', secure: true }, { domain: 'other.example', name: 'x', path: '/' }]);
    const r = await make({ rules, sessions: { 'persist:main': ses } }).afterTabClosed({ url, partition: 'persist:main' });
    expect(r).toEqual({ ok: true, cleared: true, host: 'portal.school.example' });
    expect(ses.cleared).toEqual(['https://portal.school.example']);
    expect(ses.removed).toEqual(['sid@school.example']);   // the other site’s cookie is not touched
  });
  it('uses the container’s session for a container tab', async () => {
    const main = fakeSession(), work = fakeSession([{ domain: 'portal.school.example', name: 'sid', path: '/' }]);
    await make({ rules, sessions: { 'persist:main': main, 'persist:container-work': work } }).afterTabClosed({ url, partition: 'persist:container-work' });
    expect(work.cleared.length).toBe(1);
    expect(main.cleared).toEqual([]);
  });
  it('does nothing while another page of the site (any subdomain) is still open in that session', async () => {
    const ses = fakeSession();
    const f = make({ rules, sessions: { 'persist:main': ses }, open: [{ id: 5, url: 'https://www.school.example/home' }] });
    expect(await f.afterTabClosed({ url, partition: 'persist:main' })).toEqual({ ok: true, skipped: 'open' });
    expect(ses.cleared).toEqual([]);
  });
  it('does not count the closing page itself, or a page of another site', async () => {
    const ses = fakeSession();
    const f = make({ rules, sessions: { 'persist:main': ses }, open: [{ id: 5, url: url }, { id: 6, url: 'https://news.example/' }] });
    const r = await f.afterTabClosed({ url, partition: 'persist:main', exceptPageId: 5 });
    expect(r.cleared).toBe(true);
  });
  it('does nothing for a site without the rule', async () => {
    const ses = fakeSession();
    expect(await make({ rules: {}, sessions: { 'persist:main': ses } }).afterTabClosed({ url, partition: 'persist:main' })).toEqual({ ok: true, skipped: 'rule' });
    expect(ses.cleared).toEqual([]);
  });
  it('does nothing in a panel’s session, a burner tab or a Tor tab', async () => {
    const ses = fakeSession();
    const f = make({ rules, sessions: { 'persist:discord': ses, 'tor-1': ses, 'burner-1': ses } });
    for (const partition of ['persist:discord', 'tor-1', 'burner-1']) expect(await f.afterTabClosed({ url, partition })).toEqual({ ok: true, skipped: 'session' });
    expect(ses.cleared).toEqual([]);
  });
  it('does nothing for a protected site even if a rule got in', async () => {
    const ses = fakeSession();
    const f = make({ rules: { 'netflix.com': { forget: true } }, sessions: { 'persist:main': ses } });
    expect(await f.afterTabClosed({ url: 'https://www.netflix.com/browse', partition: 'persist:main' })).toEqual({ ok: true, skipped: 'rule' });
    expect(ses.cleared).toEqual([]);
  });
  it('refuses an address that is not a website', async () => {
    const f = make({ rules, sessions: { 'persist:main': fakeSession() } });
    expect((await f.afterTabClosed({ url: 'file:///C:/x', partition: 'persist:main' })).ok).toBe(false);
    expect((await f.afterTabClosed({ url: 'nonsense', partition: 'persist:main' })).ok).toBe(false);
  });
  it('a failure is reported, not swallowed', async () => {
    const ses = fakeSession();
    ses.clearStorageData = vi.fn(async () => { throw new Error('disk busy'); });
    const r = await make({ rules, sessions: { 'persist:main': ses } }).afterTabClosed({ url, partition: 'persist:main' });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/disk busy/);
  });
});

describe('Vex quits', () => {
  const rules = { 'school.example': { forget: true }, 'keep.example': { cookies: 'off' }, 'netflix.com': { forget: true } };

  it('lists the site, its www form, and the host of every cookie that belongs to it', () => {
    const t = quitTargets(rules, [{ domain: '.accounts.school.example' }, { domain: 'keep.example' }, { domain: 'school.example.evil.test' }]);
    expect(t.sort()).toEqual(['https://accounts.school.example/', 'https://school.example/', 'https://www.school.example/'].sort());
  });
  it('an address or a bare name has no www form', () => {
    expect(quitTargets({ '127.0.0.1': { forget: true }, localhost: { forget: true } }, [])).toEqual(['https://127.0.0.1/', 'https://localhost/']);
  });
  it('sweeps the main session and the containers, not a panel’s, and saves the change', async () => {
    const main = fakeSession([{ domain: 'school.example', name: 'sid', path: '/' }]), work = fakeSession(), discord = fakeSession([{ domain: 'school.example', name: 'd', path: '/' }]);
    const f = make({ rules, sessions: { 'persist:main': main, 'persist:container-work': work, 'persist:discord': discord } });
    const r = await f.onQuit();
    expect(r.errors).toEqual([]);
    expect(main.cleared).toContain('https://school.example');
    expect(main.removed).toContain('sid@school.example');
    expect(work.cleared.length).toBeGreaterThan(0);
    expect(discord.cleared).toEqual([]);
    expect(discord.removed).toEqual([]);
    expect(main.flushed).toBe(1);
    // The video site is never cleared, and the site without the rule is left alone.
    for (const s of [main, work]) expect(s.cleared.some(o => /netflix|keep\.example/.test(o))).toBe(false);
  });
  it('with no site asking, nothing is read or cleared', async () => {
    const ses = fakeSession();
    const r = await make({ rules: { 'keep.example': { cookies: 'off' } }, sessions: { 'persist:main': ses } }).onQuit();
    expect(r).toEqual({ cleared: 0, errors: [] });
    expect(ses.cookies.get).not.toHaveBeenCalled();
  });
  it('one failing session does not stop the others, and every error is reported', async () => {
    const bad = fakeSession(), good = fakeSession();
    bad.cookies.get = vi.fn(async () => { throw new Error('locked'); });
    bad.clearStorageData = vi.fn(async () => { throw new Error('locked too'); });
    const f = make({ rules: { 'school.example': { forget: true } }, sessions: { 'persist:main': bad, 'persist:container-work': good } });
    const r = await f.onQuit();
    expect(r.errors.join('|')).toMatch(/locked/);
    expect(good.cleared.length).toBeGreaterThan(0);
  });
});

describe('wiring in main.js', () => {
  it('the window’s message is checked again, and the quit waits for the sweep', () => {
    expect(main).toMatch(/ipcMain\.handle\('siteforget:run'[\s\S]{0,700}_siteForget\.afterTabClosed\(/);
    expect(main).toMatch(/_siteForget\.onQuit\(\)[\s\S]{0,200}\.finally\(\(\) => app\.quit\(\)\)/);
    expect(main).toMatch(/quitPartitions: \(\) => BROWSING_SESSIONS/);
  });
  it('a private window cannot ask for it', () => {
    expect(fs.readFileSync(path.join(__dirname, '../../src/main/ipc-policy.js'), 'utf8')).toMatch(/\|navprivacy:set\|siteforget:\|/);
  });
});

// T2-087 / T2-088: what am I signed in to, and the kill switch (src/main/signed-in.js).
import { describe, it, expect, vi } from 'vitest';

const S = require('../../src/main/signed-in.js');
const { baseDomain } = require('../../src/main/signout-why.js');

const cookie = (name, domain, over = {}) => ({ name, domain, path: '/', secure: true, session: false, expirationDate: 4_000_000_000, ...over });
const NOW = 1_700_000_000_000;

describe('collect', () => {
  it('groups sign-in cookies by site and container, with names only', () => {
    const r = S.collect({
      'persist:main': [cookie('sessionid', '.discord.com'), cookie('_ga', '.discord.com'), cookie('token', 'www.github.com', { session: true, expirationDate: undefined })],
      'persist:container-work': [cookie('sessionid', 'discord.com')],
    }, ['discord.com', 'discord.com', 'example.org'], NOW);
    const d = r.sites.find(s => s.domain === 'discord.com');
    expect(d.containers.map(c => c.label).sort()).toEqual(['Main', 'Work container']);
    expect(d.containers[0].names).toEqual(['sessionid']);
    expect(d.saved).toBe(2);
    expect(r.sites.find(s => s.domain === 'github.com').sessionOnly).toBe(true);
    expect(r.savedWithoutSession).toBe(1);
  });
  it('skips a cookie whose date has passed and a site with no sign-in cookie', () => {
    const r = S.collect({ 'persist:main': [cookie('sessionid', 'old.com', { expirationDate: 1 }), cookie('_ga', 'ads.com')] }, [], NOW);
    expect(r.sites).toEqual([]);
  });
});

describe('links', () => {
  it('every listed address is the site\'s own https page', () => {
    for (const [domain, info] of Object.entries(S.SITE_LINKS)) {
      const own = new Set([domain, ...info.hosts]);
      for (const url of [info.where, info.password]) {
        expect(url.startsWith('https://')).toBe(true);
        expect(own.has(baseDomain(new URL(url).hostname))).toBe(true);
      }
    }
  });
  it('knows an alias and gives an unknown site its home page and the general steps', () => {
    expect(S.linksFor('youtube.com')).toMatchObject({ known: true, name: 'Google' });
    expect(S.linksFor('www.unknown-shop.net')).toMatchObject({ known: false, where: 'https://unknown-shop.net/', steps: S.GENERAL_STEPS });
    expect(() => S.linksFor('')).toThrow(/not a site/);
  });
});

const fakeSession = (cookies, { failRemove = false, failStorage = false } = {}) => ({
  cookies: { get: vi.fn(async () => cookies), remove: vi.fn(async () => { if (failRemove) throw new Error('locked'); }) },
  clearStorageData: vi.fn(async () => { if (failStorage) throw new Error('busy'); }),
});

describe('clearEverywhere', () => {
  it('removes the site\'s cookies and storage in every container and nothing else', async () => {
    const a = fakeSession([cookie('sessionid', '.discord.com'), cookie('x', 'cdn.discord.com'), cookie('other', '.github.com')]);
    const b = fakeSession([cookie('sessionid', 'discord.com')]);
    const r = await S.clearEverywhere({ 'persist:main': a, 'persist:container-work': b }, 'www.discord.com');
    expect(r).toMatchObject({ ok: true, domain: 'discord.com', total: 3 });
    expect(a.cookies.remove).toHaveBeenCalledTimes(2);
    expect(a.cookies.remove).toHaveBeenCalledWith('https://discord.com/', 'sessionid');
    const origins = a.clearStorageData.mock.calls.map(c => c[0].origin);
    expect(origins).toContain('https://cdn.discord.com');
    expect(origins).not.toContain('https://github.com');
  });
  it('names every part that failed', async () => {
    const a = fakeSession([cookie('sessionid', '.discord.com')], { failRemove: true, failStorage: true });
    const r = await S.clearEverywhere({ 'persist:main': a }, 'discord.com');
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/Main: cookie sessionid \(locked\)/);
    expect(r.errors.join(' ')).toMatch(/stored data of https:\/\/discord.com \(busy\)/);
  });
  it('refuses a name that is not a site', async () => {
    await expect(S.clearEverywhere({}, 'localhost')).rejects.toThrow(/not a site/);
  });
});

describe('IPC', () => {
  it('tells "Why was I signed out?" before it clears, and returns the next steps', async () => {
    const handlers = new Map();
    const noteAction = vi.fn();
    S.registerSignedIn({ ipcMain: { handle: (c, f) => handlers.set(c, f) }, sessions: () => ({ 'persist:main': fakeSession([cookie('sessionid', '.discord.com')]) }), vaultHosts: () => [], noteAction });
    const r = await handlers.get('hygiene:kill-site')({}, 'discord.com');
    expect(noteAction).toHaveBeenCalledWith('kill-switch', ['discord.com']);
    expect(r.links.known).toBe(true);
  });
  it('lists the sites and says when the vault could not be read', async () => {
    const handlers = new Map();
    S.registerSignedIn({ ipcMain: { handle: (c, f) => handlers.set(c, f) }, sessions: () => ({ 'persist:main': fakeSession([cookie('sessionid', '.discord.com')]) }), vaultHosts: () => { throw new Error('Vex is locked'); }, noteAction() {}, now: () => NOW });
    const r = await handlers.get('hygiene:signed-in')();
    expect(r.sites).toHaveLength(1);
    expect(r.vault).toEqual({ ok: false, error: 'Vex is locked' });
  });
  it('the kill switch is a known action of "Why was I signed out?"', () => {
    const w = require('../../src/main/signout-why.js');
    expect(w.VEX_ACTIONS['kill-switch'].cause).toBe('vex-kill-switch');
    expect(w.lineFor({ cause: 'vex-kill-switch', action: 'kill-switch' })).toMatch(/My session leaked/);
  });
});

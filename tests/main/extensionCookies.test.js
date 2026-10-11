// @vitest-environment node
//
// EX6: chrome.cookies.get answered null and getAll [] while the cookies were
// there. Main answers now from the extension's session, only for the sites
// it has host permission for.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const req = createRequire(import.meta.url);
const { cookiesApi } = req('../../src/main/extension-cookies.js');
const { matchPattern } = req('../../src/renderer/js/ext-menu-model.js');
const SW = fs.readFileSync(path.join(__dirname, '../../src/preload-extension-sw.js'), 'utf8').replace(/\r\n/g, '\n');

// A tiny stand-in for Electron's session.cookies.
function jar(list) {
  const host = (u) => new URL(u).hostname;
  const domainMatch = (c, h) => (c.hostOnly ? c.domain === h : (h === c.domain.replace(/^\./, '') || h.endsWith(c.domain)));
  return {
    list,
    async get(f) {
      return list.filter(c => (!f.url || domainMatch(c, host(f.url))) && (f.name === undefined || c.name === f.name) && (!f.domain || c.domain.replace(/^\./, '').endsWith(f.domain)));
    },
    async set(d) { list.push({ name: d.name, value: d.value, domain: host(d.url), hostOnly: true, path: d.path || '/', secure: false, httpOnly: false, session: true }); },
    async remove(url, name) { const i = list.findIndex(c => c.name === name && domainMatch(c, host(url))); if (i >= 0) list.splice(i, 1); },
  };
}
const COOKIES = () => [
  { name: 'sid', value: 'A', domain: 'site.example', hostOnly: true, path: '/', secure: true, httpOnly: true, session: false, expirationDate: 2e9, sameSite: 'lax' },
  { name: 'pref', value: 'dark', domain: '.other.example', hostOnly: false, path: '/', secure: false, httpOnly: false, session: true },
];
const ctx = (manifest, cookies = jar(COOKIES())) => ({ manifest, cookies, matchPattern });

describe('chrome.cookies through the session', () => {
  it('get and getAll answer the cookies that are there, as Chrome describes them', async () => {
    const c = ctx({ permissions: ['cookies'], host_permissions: ['<all_urls>'] });
    expect(await cookiesApi('cookies.get', { details: { url: 'https://site.example/a', name: 'sid' } }, c))
      .toEqual({ name: 'sid', value: 'A', domain: 'site.example', hostOnly: true, path: '/', secure: true, httpOnly: true, sameSite: 'lax', session: false, expirationDate: 2e9, storeId: '0' });
    expect((await cookiesApi('cookies.getAll', { details: {} }, c)).map(x => x.name)).toEqual(['sid', 'pref']);
    expect(await cookiesApi('cookies.getAllCookieStores', {}, c)).toEqual([{ id: '0', tabIds: [] }]);
  });
  it('only for the sites the extension has host permission for (a path does not narrow it)', async () => {
    const c = ctx({ permissions: ['cookies', 'https://site.example/only/*'] });
    expect((await cookiesApi('cookies.getAll', { details: {} }, c)).map(x => x.name)).toEqual(['sid']);
    expect(await cookiesApi('cookies.get', { details: { url: 'https://other.example/', name: 'pref' } }, c)).toBe(null);
    await expect(cookiesApi('cookies.set', { details: { url: 'https://other.example/', name: 'x', value: '1' } }, c)).rejects.toThrow(/No host permissions/);
  });
  it('nothing without the "cookies" permission', async () => {
    await expect(cookiesApi('cookies.getAll', { details: {} }, ctx({ permissions: [], host_permissions: ['<all_urls>'] }))).rejects.toThrow(/"cookies" permission/);
  });
  it('set and remove change the session\'s cookies', async () => {
    const j = jar(COOKIES());
    const c = ctx({ permissions: ['cookies'], host_permissions: ['<all_urls>'] }, j);
    expect((await cookiesApi('cookies.set', { details: { url: 'https://site.example/', name: 'n', value: 'v' } }, c)).value).toBe('v');
    expect(await cookiesApi('cookies.remove', { details: { url: 'https://site.example/', name: 'sid' } }, c)).toEqual({ url: 'https://site.example/', name: 'sid', storeId: '0' });
    expect(j.list.map(x => x.name)).toEqual(['pref', 'n']);
  });
  it('another store is refused, as Chrome does', async () => {
    await expect(cookiesApi('cookies.getAll', { details: { storeId: '1' } }, ctx({ permissions: ['cookies'], host_permissions: ['<all_urls>'] }))).rejects.toThrow(/No cookie store/);
  });
  it('the stand-in asks main and no longer answers empty', () => {
    expect(SW).toMatch(/get: cookieCall\('cookies\.get'\), getAll: cookieCall\('cookies\.getAll'\)/);
    expect(SW).not.toMatch(/get: done\(null\), getAll: done\(\[\]\)/);
  });
});

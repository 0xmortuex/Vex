// @vitest-environment jsdom
//
// T3-018 (Wave 5): the Roblox resolver takes a selected id on a Roblox or DevForum page and shows a thumbnail.
// Roblox is a local stand-in; nothing is fetched.
import { beforeEach, describe, expect, it, vi } from 'vitest';
require('../../src/renderer/js/vex-utils.js');
globalThis.VexIcons = require('../../src/renderer/js/vex-icons.js').VexIcons;
const { RobloxResolver: RB } = require('../../src/renderer/js/dev-shortcuts.js');

let answers;
beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = '';
  RB._cache.clear(); RB._last = 0; RB.MIN_GAP_MS = 0;
  window.showToast = vi.fn();
  globalThis.VexSettingsGroups = { dialog: () => { const body = document.createElement('div'); document.body.appendChild(body); return { body }; }, note: (t) => { const p = document.createElement('p'); p.textContent = t; return p; }, button: (t) => { const b = document.createElement('button'); b.textContent = t; return b; } };
  answers = {};
  window.vex = { apiRequest: vi.fn(async ({ url }) => {
    const key = Object.keys(answers).find(k => url.startsWith(k));
    if (!key) return { ok: true, status: 404, body: '' };
    const a = answers[key];
    return { ok: true, status: a.status || 200, body: JSON.stringify(a.body) };
  }) };
});

describe('a selected id on a Roblox page', () => {
  it('is an id only on a Roblox or DevForum page', () => {
    expect(RB.selectionId('920587237', 'https://www.roblox.com/games/920587237/Adopt-Me')).toBe('920587237');
    expect(RB.selectionId('#12345', 'https://devforum.roblox.com/t/some-topic/1')).toBe('12345');
    expect(RB.selectionId('https://www.roblox.com/catalog/1818/Crown', 'https://devforum.roblox.com/t/x/1')).toBe('1818');
    expect(RB.selectionId('920587237', 'https://example.com/')).toBeNull();
    expect(RB.selectionId('920587237', 'https://roblox.com.evil.example/')).toBeNull();
    expect(RB.selectionId('hello world', 'https://www.roblox.com/')).toBeNull();
    expect(RB.selectionId('12', 'https://www.roblox.com/')).toBeNull();
    expect(RB.selectionId('920587237', 'not a url')).toBeNull();
  });
  it('offers a menu row only when the switch is on and the selection is an id', () => {
    const rows = RB.selectionItems('1818', 'https://www.roblox.com/');
    expect(rows).toHaveLength(1);
    expect(rows[0].label).toBe('Resolve Roblox id 1818');
    expect(RB.selectionItems('nope', 'https://www.roblox.com/')).toEqual([]);
    RB.setEnabled(false);
    expect(RB.selectionItems('1818', 'https://www.roblox.com/')).toEqual([]);
  });
  it('reads the selection of the page in front through the page policy, and refuses a tab it may not read', async () => {
    const wv = { executeJavaScript: vi.fn(async () => '  1818 ') };
    globalThis.TabManager = { getActiveTab: () => ({ id: 't', url: 'https://www.roblox.com/catalog/1818' }) };
    globalThis.WebviewManager = { webviews: new Map([['t', wv]]) };
    answers['https://economy.roblox.com/v2/assets/1818/details'] = { body: { Name: 'Crown', AssetTypeId: 8, Creator: { Name: 'Roblox' }, IsForSale: false } };
    answers['https://thumbnails.roblox.com/v1/assets'] = { body: { data: [{ state: 'Completed', imageUrl: 'https://t5.rbxcdn.com/abc' }] } };
    const r = await RB.askSelection();
    expect(r.id).toBe('1818');
    window.VexTabPolicy = { canReadWebview: () => false };
    await expect(RB.askSelection()).rejects.toThrow(/cannot be read/);
    window.VexTabPolicy = { isPrivateWindow: false };
    wv.executeJavaScript = vi.fn(async () => 'words');
    await expect(RB.askSelection()).rejects.toThrow(/Select an asset or place id/);
    delete globalThis.TabManager; delete globalThis.WebviewManager;
  });
});

describe('the thumbnail', () => {
  it('is added to an asset from the thumbnail service, on the image host only', async () => {
    answers['https://economy.roblox.com/v2/assets/1818/details'] = { body: { Name: 'Crown', AssetTypeId: 8, Creator: { Name: 'Roblox' }, IsForSale: true, PriceInRobux: 5 } };
    answers['https://thumbnails.roblox.com/v1/assets'] = { body: { data: [{ state: 'Completed', imageUrl: 'https://t5.rbxcdn.com/abc.png' }] } };
    const r = await RB.resolve('1818');
    expect(r.thumbnail).toBe('https://t5.rbxcdn.com/abc.png');
    expect(window.vex.apiRequest.mock.calls.every(c => c[0].publicOnly === true && c[0].method === 'GET')).toBe(true);
  });
  it('uses the game icon service for a place', async () => {
    answers['https://economy.roblox.com/v2/assets/920/details'] = { body: { Name: 'Game', AssetTypeId: 9 } };
    answers['https://apis.roblox.com/universes/v1/places/920/universe'] = { body: { universeId: 77 } };
    answers['https://games.roblox.com/v1/games'] = { body: { data: [{ name: 'Game', playing: 1, visits: 2 }] } };
    answers['https://thumbnails.roblox.com/v1/places/gameicons'] = { body: { data: [{ state: 'Completed', imageUrl: 'https://t2.rbxcdn.com/i' }] } };
    const r = await RB.resolve('920');
    expect(r.kind).toBe('place');
    expect(r.thumbnail).toBe('https://t2.rbxcdn.com/i');
  });
  it('refuses a picture address that is not on the image host, and says so, keeping the answer', async () => {
    answers['https://economy.roblox.com/v2/assets/1818/details'] = { body: { Name: 'Crown', AssetTypeId: 8 } };
    answers['https://thumbnails.roblox.com/v1/assets'] = { body: { data: [{ state: 'Completed', imageUrl: 'https://evil.example/x.png' }] } };
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const r = await RB.resolve('1818');
    expect(r.name).toBe('Crown');
    expect(r.thumbnail).toBe('');
    expect(r.thumbnailNote).toMatch(/not on its image host/);
    err.mockRestore();
  });
  it('says why when the picture is not ready', async () => {
    answers['https://economy.roblox.com/v2/assets/1818/details'] = { body: { Name: 'Crown', AssetTypeId: 8 } };
    answers['https://thumbnails.roblox.com/v1/assets'] = { body: { data: [{ state: 'Pending', imageUrl: '' }] } };
    const r = await RB.resolve('1818');
    expect(r.thumbnail).toBe('');
    expect(r.thumbnailNote).toMatch(/no picture.*Pending/);
  });
  it('the card shows the picture with a text alternative and no referrer', async () => {
    answers['https://economy.roblox.com/v2/assets/1818/details'] = { body: { Name: 'Crown', AssetTypeId: 8 } };
    answers['https://thumbnails.roblox.com/v1/assets'] = { body: { data: [{ state: 'Completed', imageUrl: 'https://t5.rbxcdn.com/abc.png' }] } };
    const r = await RB.resolve('1818');
    RB.show(r);
    const img = document.querySelector('img');
    expect(img.alt).toBe('Picture of Crown');
    expect(img.referrerPolicy).toBe('no-referrer');
    expect(img.src).toBe('https://t5.rbxcdn.com/abc.png');
  });
});

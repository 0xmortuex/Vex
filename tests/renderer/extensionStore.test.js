// @vitest-environment jsdom
//
// The Vex Extension Store (js/extension-store.js + js/extension-store-data.js): the list is data that a
// person reviews, so its shape is checked entry by entry; the page draws from the installed list; and an Add
// button runs the install flow Vex already has instead of one of its own.

import { describe, it, expect, beforeEach, vi } from 'vitest';

const { VexExtensionStoreData } = require('../../src/renderer/js/extension-store-data.js');
const { VexExtensionCatalog } = require('../../src/renderer/js/extension-catalog.js');
const { VexIcons } = require('../../src/renderer/js/vex-icons.js');
const { VexI18nUI } = require('../../src/renderer/js/i18n-ui.js');
const linkApi = require('../../src/renderer/js/web-store-link.js');
const { VexTr } = require('../../src/renderer/js/vex-tr.js');
const { VexExtensionStore } = require('../../src/renderer/js/extension-store.js');

globalThis.VexExtensionStoreData = VexExtensionStoreData;
globalThis.VexExtensionCatalog = VexExtensionCatalog;
globalThis.VexIcons = VexIcons;
globalThis.VexI18nUI = VexI18nUI;
globalThis.VexTr = VexTr;
globalThis.VexWebStoreLink = linkApi;
globalThis.VexExtensionStore = VexExtensionStore;
window.escapeHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const WEB = VexExtensionStoreData.WEB;
const CATEGORY_IDS = VexExtensionStoreData.CATEGORIES.map(c => c.id);

describe('the store list (extension-store-data.js)', () => {
  it('has a good shelf', () => {
    expect(WEB.length).toBeGreaterThanOrEqual(25);
  });

  it('gives every entry the same shape', () => {
    for (const e of WEB) {
      expect(e.key, e.name).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
      expect(e.webstoreId, e.key).toMatch(/^[a-p]{32}$/);
      expect(e.name && e.publisher && e.what && e.works, e.key).toBeTruthy();
      expect(['full', 'partial', 'none'], e.key).toContain(e.level);
      expect(CATEGORY_IDS, e.key).toContain(e.category);
      expect('caveat' in e, e.key + ' states its caveat, even when null').toBe(true);
      expect(Number.isInteger(e.sizeKB) && e.sizeKB > 0, e.key + ' has a size in KB').toBe(true);
      expect(e.sourceUrl, e.key).toBe('https://chromewebstore.google.com/detail/' + e.webstoreId);
    }
  });

  it('has no duplicate id, key or name', () => {
    for (const field of ['webstoreId', 'key', 'name']) {
      const seen = WEB.map(e => String(e[field]).toLowerCase());
      expect(new Set(seen).size, field).toBe(seen.length);
    }
  });

  it('lists nothing that does not work: those are dropped, not shown', () => {
    expect(WEB.filter(e => e.level === 'none').map(e => e.key)).toEqual([]);
  });

  it('is honest: a partly working entry says what is missing, and a full one has no blocking-API claim', () => {
    for (const e of WEB) {
      if (e.level === 'partial') expect(String(e.caveat || '').length, e.key + ' needs a caveat saying what is missing').toBeGreaterThan(30);
      expect(e.works, e.key).not.toMatch(/^\s*$/);
    }
  });

  it('has Turkish for every entry, and no emoji anywhere', () => {
    for (const e of WEB) {
      expect(e.tr && e.tr.what && e.tr.works, e.key + ' needs Turkish').toBeTruthy();
      if (e.caveat) expect(e.tr.caveat, e.key + ' needs a Turkish caveat').toBeTruthy();
      else expect(e.tr.caveat == null, e.key).toBe(true);
    }
    for (const c of VexExtensionStoreData.CATEGORIES) expect(c.tr, c.id).toBeTruthy();
    expect(JSON.stringify(VexExtensionStoreData)).not.toMatch(/\p{Extended_Pictographic}/u);
  });

  it('includes Ambient light for YouTube, by its real Chrome Web Store id', () => {
    const e = WEB.find(x => x.name === 'Ambient Light for YouTube');
    expect(e).toBeTruthy();
    expect(e.webstoreId).toBe('paponcgjfojgemddooebbgniglhkajkj');
    expect(e.category).toBe('youtube');
  });

  it('only lists ids the install flow accepts', () => {
    for (const e of WEB) expect(linkApi.extensionIdFrom(e.webstoreId)).toBe(e.webstoreId);
  });

  it('adds the catalogue GitHub entries once, and never one that does not work', () => {
    const all = VexExtensionStoreData.combined(VexExtensionCatalog);
    const keys = all.map(e => e.key);
    expect(new Set(keys).size).toBe(keys.length);
    const names = all.map(e => e.name.toLowerCase());
    expect(new Set(names).size).toBe(names.length);
    const gh = all.filter(e => e.catalogId);
    expect(gh.map(e => e.catalogId)).toContain('rosuite');
    expect(gh.map(e => e.catalogId)).not.toContain('violentmonkey');
    for (const e of gh) {
      expect(e.webstoreId, e.key).toBeUndefined();
      expect(e.sourceUrl, e.key).toMatch(/^https:\/\//);
      expect(CATEGORY_IDS, e.key).toContain(e.category);
      expect(e.tr && e.tr.what && e.tr.works, e.key + ' needs Turkish').toBeTruthy();
    }
  });

  it('marks uBlock Origin as something Vex already does', () => {
    const u = VexExtensionStoreData.combined(VexExtensionCatalog).find(e => e.catalogId === 'ublock-origin');
    expect(u.redundant).toBe(true);
    expect(u.level).toBe('partial');
  });
});

describe('search, categories and state', () => {
  const all = () => VexExtensionStore.entries();
  it('finds by name, by what it does, and without caring for case', () => {
    expect(VexExtensionStore.filter(all(), { query: 'AMBIENT' }).map(e => e.key)).toContain('ambient-light');
    expect(VexExtensionStore.filter(all(), { query: 'dark mode' }).length).toBeGreaterThan(0);
    expect(VexExtensionStore.filter(all(), { query: 'zzzz-nothing' })).toEqual([]);
  });
  it('filters by category and every category on the chips has entries', () => {
    const yt = VexExtensionStore.filter(all(), { category: 'youtube' });
    expect(yt.length).toBeGreaterThanOrEqual(5);
    expect(yt.every(e => e.category === 'youtube')).toBe(true);
  });
  it('says installed, update available, or neither', () => {
    const e = all().find(x => x.key === 'ambient-light');
    expect(VexExtensionStore.stateOf(e, []).state).toBe(null);
    expect(VexExtensionStore.stateOf(e, [{ webstore: e.webstoreId, name: 'x', version: '1', folder: 'f' }]).state).toBe('installed');
    expect(VexExtensionStore.stateOf(e, [{ webstore: e.webstoreId, name: 'x', version: '1', folder: 'f', update: { pending: { version: '2' } } }]).state).toBe('update');
    expect(VexExtensionStore.stateOf(e, [{ name: 'Ambient light for YouTube™', version: '1', folder: 'f' }]).state).toBe('installed');
  });
  it('reads a pasted Web Store link or id, and nothing else', () => {
    const id = 'paponcgjfojgemddooebbgniglhkajkj';
    expect(VexExtensionStore.pastedId(id)).toBe(id);
    expect(VexExtensionStore.pastedId('https://chromewebstore.google.com/detail/youtube-ambilight/' + id)).toBe(id);
    expect(VexExtensionStore.pastedId('dark')).toBe(null);
    expect(VexExtensionStore.pastedId('https://example.com/')).toBe(null);
  });
});

describe('the page', () => {
  let installs;
  beforeEach(() => {
    document.body.innerHTML = '';
    localStorage.clear();
    VexExtensionStore.close();
    installs = [];
    window.VexWebStore = globalThis.VexWebStore = { install: vi.fn(async (id) => { installs.push(id); return { ok: true }; }) };
    window.vex = {
      extensionsList: vi.fn(async () => []),
      extensionsInstallCatalog: vi.fn(async () => ({ ok: true, name: 'RoSuite', version: '1.0.0' })),
      extensionsUninstallLater: vi.fn(async () => ({ ok: true })),
      extensionsUninstallUndo: vi.fn(async () => ({ ok: true })),
      extensionsUninstall: vi.fn(async () => ({ ok: true })),
    };
    window.VexUndo = { offer: vi.fn() };
    window.vexConfirm = vi.fn(async () => true);
    window.showToast = vi.fn();
  });

  it('builds nothing until it is opened, and removes itself when closed', async () => {
    expect(document.querySelector('.exs-overlay')).toBe(null);
    await VexExtensionStore.open();
    expect(document.querySelectorAll('.exs-overlay').length).toBe(1);
    expect(document.querySelectorAll('.exs-card').length).toBe(VexExtensionStore.entries().length);
    VexExtensionStore.close();
    expect(document.querySelector('.exs-overlay')).toBe(null);
  });

  it('shows a badge and the honest reason on every card', async () => {
    await VexExtensionStore.open();
    for (const card of document.querySelectorAll('.exs-card')) {
      expect(card.querySelector('.exs-badge'), card.dataset.key).toBeTruthy();
      expect(card.querySelector('.exs-works').textContent.length, card.dataset.key).toBeGreaterThan(20);
    }
  });

  it('Add runs the existing Web Store flow with the entry\'s id', async () => {
    await VexExtensionStore.open();
    document.querySelector('.exs-card[data-key="ambient-light"] [data-exs-act="add"]').click();
    await new Promise(r => setTimeout(r, 0));
    expect(installs).toEqual(['paponcgjfojgemddooebbgniglhkajkj']);
  });

  it('a GitHub entry asks first, then installs from the catalogue source', async () => {
    await VexExtensionStore.open();
    document.querySelector('.exs-card[data-key="gh-rosuite"] [data-exs-act="add"]').click();
    await new Promise(r => setTimeout(r, 0));
    expect(window.vexConfirm).toHaveBeenCalledTimes(1);
    expect(window.vex.extensionsInstallCatalog).toHaveBeenCalledWith('rosuite');
  });

  it('shows Installed with Remove, and Update available', async () => {
    const e = VexExtensionStore.entries().find(x => x.key === 'ambient-light');
    const d = VexExtensionStore.entries().find(x => x.key === 'dearrow');
    window.vex.extensionsList = vi.fn(async () => [
      { webstore: e.webstoreId, name: e.name, version: '2.38.17', folder: 'ambient-1' },
      { webstore: d.webstoreId, name: d.name, version: '2.3.0', folder: 'dearrow-1', update: { pending: { version: '2.3.10' } } },
    ]);
    await VexExtensionStore.open();
    const a = document.querySelector('.exs-card[data-key="ambient-light"]');
    expect(a.querySelector('.exs-have').textContent).toContain('Installed');
    expect(a.querySelector('[data-exs-act="remove"]')).toBeTruthy();
    expect(a.querySelector('[data-exs-act="add"]')).toBe(null);
    const u = document.querySelector('.exs-card[data-key="dearrow"] [data-exs-act="add"]');
    expect(u.textContent).toBe('Update available');
    a.querySelector('[data-exs-act="remove"]').click();
    await new Promise(r => setTimeout(r, 0));
    expect(window.vex.extensionsUninstallLater).toHaveBeenCalledWith('ambient-1');
    expect(window.VexUndo.offer).toHaveBeenCalled();
  });

  it('a pasted Web Store link offers to install that extension', async () => {
    await VexExtensionStore.open();
    const input = document.querySelector('.exs-input');
    input.value = 'https://chromewebstore.google.com/detail/some-thing/' + 'a'.repeat(32);
    input.dispatchEvent(new Event('input'));
    const btn = document.querySelector('[data-exs-act="paste"]');
    expect(btn).toBeTruthy();
    btn.click();
    await new Promise(r => setTimeout(r, 0));
    expect(installs).toEqual(['a'.repeat(32)]);
  });

  it('search narrows the cards and an empty search says so', async () => {
    await VexExtensionStore.open();
    const input = document.querySelector('.exs-input');
    input.value = 'sponsor';
    input.dispatchEvent(new Event('input'));
    expect([...document.querySelectorAll('.exs-card')].map(c => c.dataset.key)).toContain('sponsorblock');
    input.value = 'qqqqqqqq';
    input.dispatchEvent(new Event('input'));
    expect(document.querySelectorAll('.exs-card').length).toBe(0);
    expect(document.querySelector('.exs-empty').hidden).toBe(false);
  });

  it('Escape closes it', async () => {
    await VexExtensionStore.open();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(document.querySelector('.exs-overlay')).toBe(null);
  });
});

describe('in Turkish', () => {
  beforeEach(() => { document.body.innerHTML = ''; VexExtensionStore.close(); localStorage.setItem('vex.lang', JSON.stringify('tr')); window.vex = { extensionsList: async () => [] }; });

  it('draws the entry texts from the entry and the chrome from the dictionary', async () => {
    await VexExtensionStore.open();
    VexI18nUI.apply();
    const o = document.querySelector('.exs-overlay');
    expect(o.querySelector('.exs-title').textContent).toBe('Vex Eklenti Mağazası');
    const card = o.querySelector('.exs-card[data-key="ambient-light"]');
    const e = VexExtensionStore.entries().find(x => x.key === 'ambient-light');
    expect(card.querySelector('.exs-what').textContent).toBe(e.tr.what);
    expect(card.querySelector('[data-exs-act="add"]').textContent).toBe('Vex’e ekle');
    expect(card.querySelector('.exs-badge').textContent).toMatch(/çalışır/);
    expect(o.querySelector('.exs-input').getAttribute('placeholder')).toMatch(/Chrome Web Mağazası/);
  });

  it('has a Turkish word for every fixed phrase the page shows', () => {
    const tr = VexI18nUI.TABLE.tr;
    for (const s of ['Open the extension store', 'Extension store…', 'Vex Extension Store', 'Works fully', 'Works partly', 'Does not work in Vex', 'Installed', 'Update available', 'Add to Vex', 'Remove', 'Source', 'In Vex:', 'Chrome Web Store', 'GitHub release', 'Working…', 'Categories', 'Nothing on the shelf matches that']) {
      expect(tr[s], s).toBeTruthy();
    }
  });
});

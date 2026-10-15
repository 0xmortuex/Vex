// @vitest-environment jsdom
//
// js/packs-consumers.js: installed Vex Pack items reach the features that read
// them, in memory only, with the same guards those features keep for their own
// data. A hostile item that slipped past install is still inert at the consumer.
import { describe, it, expect, beforeEach, vi } from 'vitest';

const path = require('path');
const JS = path.resolve(__dirname, '../../src/renderer/js');
const fresh = (rel) => { const p = path.join(JS, rel); delete require.cache[require.resolve(p)]; return require(p); };

let items;
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><circle cx="32" cy="32" r="20" fill="#f00"/></svg>';

function load() {
  vi.resetModules();
  localStorage.clear();
  document.body.innerHTML = '';
  for (const k of ['VexAliases', 'SiteReadability', 'PageActions', 'BriefIntegration', 'VexFortune', 'VexWidgets', 'StickerSheet', 'VexCosmetics',
    'VexUnlock', 'VexExpression', 'VexPacks', 'VexPackConsumers', 'VexBrief', 'CommandBar', 'TabManager', 'WebviewManager', 'VexLiving', 'VexModuleCommands']) delete globalThis[k];
  window.VexTabPolicy = { isPrivateWindow: false, canReadWebview: () => true, canFillWebview: () => true, canShareTab: () => true };
  globalThis.CommandChains = { run() {} };
  globalThis.CommandBar = { commands: [{ id: 'open-settings', label: 'Open Settings' }, { id: 'new-tab', label: 'New tab' }] };
  globalThis.VexExpression = fresh('vex-expression.js').VexExpression;
  globalThis.VexUnlock = fresh('vex-unlock.js').VexUnlock;
  globalThis.VexAliases = fresh('command-aliases.js').VexAliases;
  globalThis.SiteReadability = fresh('site-readability.js').SiteReadability;
  globalThis.VexFortune = fresh('vex-fortune.js').VexFortune;
  globalThis.VexWidgets = fresh('start-widgets.js').VexWidgets;
  globalThis.VexCosmetics = fresh('vex-cosmetics.js').VexCosmetics;
  globalThis.StickerSheet = fresh('sticker-sheet.js').StickerSheet;
  globalThis.BriefIntegration = fresh('brief-integration.js').BriefIntegration;
  globalThis.PageActions = fresh('page-actions.js').PageActions;
  globalThis.VexPacks = { items: (t) => items.filter(x => !t || x.item.type === t), onChange: () => () => {} };
  return fresh('packs-consumers.js').VexPackConsumers;
}

beforeEach(() => { items = []; });

describe('pack consumers', () => {
  it('lists every type as consumed in this build, and none as inert', () => {
    const C = load();
    expect(C.status().inert).toEqual([]);
    expect(C.status().consumed.sort()).toEqual([...C.TYPES].sort());
  });

  it('aliases are looked up after the person\'s own words and never written to their list', () => {
    const C = load();
    items = [{ packId: 'p1', packName: 'P', item: { type: 'aliases', id: 'a', entries: [{ word: 'st', command: 'open-settings' }, { word: 'nt', command: 'new-tab' }] } }];
    localStorage.setItem('vex.commandAliases.prefs', JSON.stringify({ enabled: true, learn: true, threshold: 3 }));
    C.apply();
    expect(VexAliases.lookup('st')).toBe('open-settings');
    VexAliases.set('st', 'new-tab');
    expect(VexAliases.lookup('st')).toBe('new-tab');                 // the person's own wins
    expect(localStorage.getItem('vex.commandAliases') || '').not.toContain('open-settings');
    items = [];
    C.apply();
    expect(VexAliases.lookup('nt')).toBeNull();                       // gone with the pack
  });

  it('a readability preset is applied for its host, never over a private or Tor tab, never over the person\'s own', () => {
    const C = load();
    items = [{ packId: 'p1', packName: 'P', item: { type: 'readability-preset', id: 'r', host: 'example.com', name: 'x', font: 130, contrast: 100, width: 0 } }];
    C.apply();
    const calls = [];
    const wv = { insertCSS: async (css) => { calls.push(css); return 'k'; }, removeInsertedCSS: async () => {} };
    expect(SiteReadability.applyTo(wv, 'https://example.com/a')).toBe(true);
    expect(SiteReadability.all()).toEqual({});                        // not in the person's own list
    window.VexTabPolicy.canFillWebview = () => false;       // a private or Tor tab
    const wv2 = { insertCSS: async () => 'k', removeInsertedCSS: async () => {} };
    expect(SiteReadability.canRemember(wv2)).toBe(false);
    expect(SiteReadability.applyTo(wv2, 'https://example.com/a')).toBe(false);
  });

  it('a pack page action runs only when chosen, only on its origin, never automatically', async () => {
    const C = load();
    localStorage.setItem('vex.pageActions', JSON.stringify({ enabled: true, scripts: [] }));
    items = [{ packId: 'p1', packName: 'P', item: { type: 'page-action', id: 'pa', name: 'Hide', origin: 'https://example.com', source: 'hide .ad' } }];
    C.apply();
    expect(PageActions._pack.has('pack:p1:pa')).toBe(true);
    await expect(PageActions.run('pack:p1:pa', { auto: true })).rejects.toThrow(/only runs when you choose/);
    globalThis.TabManager = { getActiveTab: () => ({ id: 1, url: 'https://evil.test/' }) };
    globalThis.WebviewManager = { webviews: new Map([[1, { executeJavaScript: vi.fn() }]]) };
    await expect(PageActions.run('pack:p1:pa')).rejects.toThrow(/is for https:\/\/example\.com/);
    expect(PageActions.scripts()).toEqual([]);                        // not in the person's own scripts
  });

  it('quotes feed the fortune and the widget quote, kept apart by kind', () => {
    const C = load();
    items = [
      { packId: 'p', packName: 'P', item: { type: 'quotes', id: 'q', kind: 'quote', entries: [{ text: 'Be kind.', by: 'Someone' }] } },
      { packId: 'p', packName: 'P', item: { type: 'quotes', id: 'f', kind: 'fortune', entries: [{ text: 'A good day.' }] } },
    ];
    C.apply();
    expect(VexWidgets._packQuotes).toEqual([{ t: 'Be kind.', a: 'Someone' }]);
    expect(VexFortune._pack.map(l => l.text)).toEqual(['A good day.']);
    const day = new Date(2026, 9, 16);
    expect(typeof VexFortune.today(day).text).toBe('string');
  });

  it('a medal frame and a sticker are drawn as images, which carry no script', () => {
    const C = load();
    const hostile = '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script><circle r="3"/></svg>';
    items = [
      { packId: 'p', packName: 'P', item: { type: 'medal-frame', id: 'mf', name: 'Gold', svg: SVG } },
      { packId: 'p', packName: 'P', item: { type: 'sticker', id: 'st', name: 'Dot', svg: hostile } },
    ];
    C.apply();
    const frame = VexCosmetics.svg('frame', 'pack:p:mf');
    expect(frame).toContain('<image href="data:image/svg+xml;charset=utf-8,');
    expect(frame).not.toContain('<script');
    expect(StickerSheet.normalize({ placed: [{ uid: 'u', sticker: 'pack:p:st', x: 0.5, y: 0.5 }] }).placed.length).toBe(1);
    // a name nobody installed is still dropped
    expect(StickerSheet.normalize({ placed: [{ uid: 'u', sticker: 'pack:p:other', x: 0.5, y: 0.5 }] }).placed.length).toBe(0);
    items = [];
    C.apply();
    expect(StickerSheet.normalize({ placed: [{ uid: 'u', sticker: 'pack:p:st', x: 0.5, y: 0.5 }] }).placed.length).toBe(0);
  });

  it('a brief section shows text and https links, skips a query template, and fills a page template only from a normal tab', async () => {
    const C = load();
    const regs = new Map();
    globalThis.VexBrief = { register: (d) => regs.set(d.id, d), unregister: (id) => regs.delete(id), get: (id) => regs.get(id) };
    items = [{ packId: 'p', packName: 'P', item: { type: 'brief-section', id: 'b', title: 'Links', blocks: [
      { kind: 'text', text: 'Hello' },
      { kind: 'link', label: 'Docs', url: 'https://docs.example.com/' },
      { kind: 'url-template', label: 'Search', template: 'https://s.example.com/?q={query}' },
      { kind: 'url-template', label: 'This site', template: 'https://w.example.com/{tab-host}' },
    ] } }];
    C.apply();
    const sec = regs.get('pack-p-b');
    expect(sec).toBeTruthy();
    let out = await sec.build();
    expect(out.items.map(i => i.text)).toEqual(['Hello', 'Docs']);    // no tab, no query: both templates skipped
    globalThis.TabManager = { getActiveTab: () => ({ id: 1, url: 'https://site.test/x' }) };
    globalThis.WebviewManager = { webviews: new Map([[1, {}]]) };
    out = await sec.build();
    expect(out.items.map(i => i.text)).toEqual(['Hello', 'Docs', 'This site']);
    window.VexTabPolicy.canReadWebview = () => false;                  // a private / Tor tab
    out = await sec.build();
    expect(out.items.map(i => i.text)).toEqual(['Hello', 'Docs']);
    items = [];
    C.apply();
    expect(regs.has('pack-p-b')).toBe(false);
  });
});

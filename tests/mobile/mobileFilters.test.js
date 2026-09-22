// @vitest-environment jsdom
//
// The filter-list parser that feeds the native blocker. Everything it gets
// wrong here is either a tracker that loads anyway or a page element that
// disappears when it should not, so the shapes worth pinning down are the
// exception rules, the cosmetic split, and the lines that must be ignored.
import { describe, it, expect, beforeEach, vi } from 'vitest';

const store = {};
window.VexStore = {
  get: (key, fallback) => (key in store ? store[key] : fallback),
  set: async (key, value) => { store[key] = value; return value; }
};
window.VexBridge = {
  setBlocking: vi.fn(async () => {}),
  setSiteAllowed: vi.fn(async () => {}),
  loadRules: vi.fn(async () => ({}))
};
const { VexBlock } = require('../../mobile/www/js/adblock.js');

beforeEach(() => {
  for (const key of Object.keys(store)) delete store[key];
  window.VexBridge.setBlocking.mockClear();
  window.VexBridge.setSiteAllowed.mockClear();
  window.VexBridge.loadRules.mockClear();
});

describe('parsing a filter list', () => {
  it('splits blocks, exceptions and cosmetic rules', () => {
    const parsed = VexBlock.parse([
      '! Title: a comment',
      '[Adblock Plus 2.0]',
      '||ads.example.com^',
      '||tracker.example.net^$third-party',
      '@@||ads.example.com/allowed.js',
      'example.com##.ad-slot',
      '##.generic-banner',
      'a.com,b.com##.shared'
    ].join('\n'));

    expect(parsed.block).toEqual(['||ads.example.com^', '||tracker.example.net^$third-party']);
    expect(parsed.allow).toEqual(['||ads.example.com/allowed.js']);
    expect(parsed.hide['example.com']).toEqual(['.ad-slot']);
    expect(parsed.hide['*']).toEqual(['.generic-banner']);
    expect(parsed.hide['a.com']).toEqual(['.shared']);
    expect(parsed.hide['b.com']).toEqual(['.shared']);
  });

  it('skips the cosmetic forms the native side cannot apply', () => {
    const parsed = VexBlock.parse([
      'example.com#@#.kept',
      'example.com#?#.has-thing',
      'example.com#$#body { x: y }'
    ].join('\n'));
    expect(parsed.block).toEqual([]);
    expect(parsed.allow).toEqual([]);
    expect(Object.keys(parsed.hide)).toEqual([]);
  });

  it('ignores blank lines and keeps nothing from comments', () => {
    const parsed = VexBlock.parse('\n\n!comment\n   \n||x.example^\n');
    expect(parsed.block).toEqual(['||x.example^']);
  });
});

describe('switching it off', () => {
  it('remembers the setting and tells native', async () => {
    await VexBlock.setEnabled(false);
    expect(VexBlock.enabled()).toBe(false);
    expect(window.VexBridge.setBlocking).toHaveBeenCalledWith(false);
  });

  it('is on when nothing has been stored', () => {
    expect(VexBlock.enabled()).toBe(true);
  });

  it('keeps a per-site exception both ways', async () => {
    await VexBlock.setSiteAllowed('example.com', true);
    expect(VexBlock.siteAllowed('example.com')).toBe(true);
    expect(VexBlock.siteAllowed('other.com')).toBe(false);
    await VexBlock.setSiteAllowed('example.com', false);
    expect(VexBlock.siteAllowed('example.com')).toBe(false);
  });
});

describe('handing rules to native', () => {
  it('uses the built-in seed list before any list has been fetched', async () => {
    const rules = await VexBlock.apply();
    expect(rules.block.length).toBeGreaterThan(10);
    expect(rules.block).toContain('||doubleclick.net^');
    expect(window.VexBridge.loadRules).toHaveBeenCalledWith(rules);
    expect(window.VexBridge.setBlocking).toHaveBeenCalledWith(true);
  });

  it('prefers the cached lists once they exist', async () => {
    store['vex.blockRules'] = { block: ['||cached.example^'], allow: [], hide: {} };
    store['vex.blockRulesAt'] = Date.now();
    const rules = await VexBlock.apply();
    expect(rules.block).toEqual(['||cached.example^']);
  });

  it('re-applies every site exception on boot', async () => {
    store['vex.blockAllowed'] = ['news.example', 'shop.example'];
    store['vex.blockRulesAt'] = Date.now();
    await VexBlock.apply();
    expect(window.VexBridge.setSiteAllowed).toHaveBeenCalledWith('news.example', true);
    expect(window.VexBridge.setSiteAllowed).toHaveBeenCalledWith('shop.example', true);
  });
});

// @vitest-environment jsdom
//
// Per-site rules. The behaviour worth pinning down is what gets stored (only
// what differs from the default, so the store does not grow a row per site
// you visit), what "follow the global setting" means when the global changes,
// and that applying rules reaches the right native calls.
import { describe, it, expect, beforeEach, vi } from 'vitest';

const store = {};
window.VexStore = {
  get: (key, fallback) => (key in store ? store[key] : fallback),
  set: async (key, value) => { store[key] = value; return value; }
};
window.VexSearch = { prettyHost: url => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; } } };
window.VexBridge = {
  setScriptsEnabled: vi.fn(async () => {}),
  setImagesEnabled: vi.fn(async () => {}),
  setDarkMode: vi.fn(async () => {}),
  setDesktopMode: vi.fn(async () => {}),
  setZoom: vi.fn(async () => {})
};
window.VexBlock = { setSiteAllowed: vi.fn(async () => {}) };

const { VexSiteRules } = require('../../mobile/www/js/site-rules.js');

beforeEach(() => {
  for (const key of Object.keys(store)) delete store[key];
  for (const fn of Object.values(window.VexBridge)) fn.mockClear();
  window.VexBlock.setSiteAllowed.mockClear();
});

describe('storing a rule', () => {
  it('starts from the defaults', () => {
    expect(VexSiteRules.for('example.com')).toEqual({
      scripts: true, images: true, dark: null, desktop: null, blocking: true, zoom: 1
    });
    expect(VexSiteRules.customised('example.com')).toEqual([]);
  });

  it('keeps only what differs from the default', async () => {
    await VexSiteRules.set('example.com', 'scripts', false);
    expect(store['vex.siteRules']).toEqual({ 'example.com': { scripts: false } });
    expect(VexSiteRules.customised('example.com')).toEqual(['scripts']);
  });

  it('drops the host again when the last rule goes back to default', async () => {
    await VexSiteRules.set('example.com', 'images', false);
    await VexSiteRules.set('example.com', 'images', true);
    expect(store['vex.siteRules']).toEqual({});
  });

  it('keeps hosts apart', async () => {
    await VexSiteRules.set('a.example', 'scripts', false);
    expect(VexSiteRules.for('b.example').scripts).toBe(true);
  });

  it('resets a host in one go', async () => {
    await VexSiteRules.set('example.com', 'scripts', false);
    await VexSiteRules.set('example.com', 'zoom', 1.3);
    await VexSiteRules.reset('example.com');
    expect(VexSiteRules.for('example.com').zoom).toBe(1);
    expect(store['vex.siteRules']).toEqual({});
  });
});

describe('applying rules to a tab', () => {
  const tab = () => ({ id: 't1', url: 'https://example.com/page', desktopMode: false });

  it('pushes every rule down to the WebView', async () => {
    await VexSiteRules.set('example.com', 'scripts', false);
    await VexSiteRules.set('example.com', 'zoom', 1.3);
    await VexSiteRules.applyTo(tab());
    expect(window.VexBridge.setScriptsEnabled).toHaveBeenCalledWith('t1', false);
    expect(window.VexBridge.setZoom).toHaveBeenCalledWith('t1', 1.3);
    expect(window.VexBlock.setSiteAllowed).toHaveBeenCalledWith('example.com', false);
  });

  it('follows the global dark setting until the site overrides it', async () => {
    store['vex.darkPages'] = true;
    await VexSiteRules.applyTo(tab());
    expect(window.VexBridge.setDarkMode).toHaveBeenCalledWith('t1', true);

    await VexSiteRules.set('example.com', 'dark', false);
    window.VexBridge.setDarkMode.mockClear();
    await VexSiteRules.applyTo(tab());
    expect(window.VexBridge.setDarkMode).toHaveBeenCalledWith('t1', false);
  });

  it('turns images off everywhere when data saver is on', async () => {
    store['vex.dataSaver'] = true;
    await VexSiteRules.applyTo(tab());
    expect(window.VexBridge.setImagesEnabled).toHaveBeenCalledWith('t1', false);
  });

  it('tells the blocker when a site is exempted', async () => {
    await VexSiteRules.set('example.com', 'blocking', false);
    await VexSiteRules.applyTo(tab());
    expect(window.VexBlock.setSiteAllowed).toHaveBeenCalledWith('example.com', true);
  });

  it('only switches desktop mode when it actually changes', async () => {
    const live = tab();
    live.desktopMode = true;
    await VexSiteRules.set('example.com', 'desktop', true);
    await VexSiteRules.applyTo(live);
    expect(window.VexBridge.setDesktopMode).not.toHaveBeenCalled();
  });
});

describe('describing a site', () => {
  it('says what is different, in words', async () => {
    expect(VexSiteRules.describe('example.com')).toBe('Default settings');
    await VexSiteRules.set('example.com', 'scripts', false);
    await VexSiteRules.set('example.com', 'blocking', false);
    expect(VexSiteRules.describe('example.com')).toBe('JavaScript off · blocking off');
  });
});

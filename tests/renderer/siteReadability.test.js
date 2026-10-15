// @vitest-environment jsdom
//
// Per-site readability: a text size, contrast and content width remembered for
// each site and applied through insertCSS when it loads.
import { beforeEach, describe, expect, it, vi } from 'vitest';
require('../../src/renderer/js/vex-utils.js');
globalThis.VexIcons = require('../../src/renderer/js/vex-icons.js').VexIcons;
const { VexSettingsGroups, VexModuleCommands } = require('../../src/renderer/js/settings-groups.js');
globalThis.VexSettingsGroups = VexSettingsGroups;
globalThis.VexModuleCommands = VexModuleCommands;
const { SiteReadability } = require('../../src/renderer/js/site-readability.js');

function fakeWebview() {
  let n = 0;
  return {
    sheets: new Map(),
    insertCSS: vi.fn(async function (css) { const k = 'k' + (++n); this.sheets.set(k, css); return k; }),
    removeInsertedCSS: vi.fn(async function (k) { this.sheets.delete(k); }),
    getAttribute: () => 'persist:main',
  };
}
const settle = () => new Promise(r => setTimeout(r, 0));

beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = '';
  window.VexTabPolicy = { isPrivateWindow: false, canFillWebview: () => true };
  window.showToast = vi.fn();
});

describe('what is stored', () => {
  it('a site at its defaults is not a tuned site', () => {
    expect(SiteReadability.normalize({ font: 100, contrast: 100, width: 0 })).toBeNull();
    expect(SiteReadability.set('example.com', { font: 100 })).toBeNull();
    expect(SiteReadability.all()).toEqual({});
  });

  it('clamps out-of-range values', () => {
    expect(SiteReadability.normalize({ font: 9999, contrast: 3, width: 50 })).toEqual({ font: 250, contrast: 100, width: 400 });
    expect(SiteReadability.normalize({ font: 'x', contrast: 150 })).toEqual({ font: 100, contrast: 150, width: 0 });
  });

  it('remembers a site by its bare host, www or not', () => {
    SiteReadability.set('www.Example.com', { font: 130, width: 700 });
    expect(SiteReadability.get('example.com')).toEqual({ font: 130, contrast: 100, width: 700 });
    expect(SiteReadability.hostOf('https://www.example.com/a/b?c=1')).toBe('example.com');
    expect(SiteReadability.hostOf('file:///C:/x.html')).toBe('');
    expect(SiteReadability.hostOf('vex://start')).toBe('');
  });

  it('ignores a damaged store instead of throwing', () => {
    localStorage.setItem(SiteReadability.KEY, '{not json');
    expect(SiteReadability.all()).toEqual({});
    localStorage.setItem(SiteReadability.KEY, JSON.stringify({ 'ok.com': { font: 120 }, 'bad host!': { font: 120 }, 'zero.com': { font: 100 } }));
    expect(Object.keys(SiteReadability.all())).toEqual(['ok.com']);
  });

  it('is not in the sync list', () => {
    const src = require('node:fs').readFileSync(require('node:path').join(__dirname, '../../src/renderer/js/sync-engine.js'), 'utf8');
    expect(src).not.toContain('vex.siteReadability');
  });
});

describe('the stylesheet', () => {
  it('is empty when nothing is set', () => { expect(SiteReadability.buildCss(null)).toBe(''); });

  it('scales running text, never the page filter', () => {
    const css = SiteReadability.buildCss({ font: 130, contrast: 140, width: 720 });
    expect(css).toContain('html{font-size:130% !important}');
    expect(css).toContain('filter:contrast(140%)');
    expect(css).toContain('max-width:720px');
    // contrast must not sit on <html>/<body>, which the colour-vision filter and force-dark own
    expect(css).not.toMatch(/(^|\n)html\{[^}]*filter/);
    expect(css).not.toMatch(/body\{[^}]*filter/);
  });

  it('writes only the parts that were changed', () => {
    expect(SiteReadability.buildCss({ width: 600 })).not.toContain('font-size');
    expect(SiteReadability.buildCss({ font: 120 })).not.toContain('contrast');
  });
});

describe('applying it', () => {
  it('inserts the sheet for a tuned site and swaps it on the next page', async () => {
    SiteReadability.set('example.com', { font: 140 });
    const wv = fakeWebview();
    expect(SiteReadability.applyTo(wv, 'https://example.com/a')).toBe(true);
    await settle(); await settle();
    expect([...wv.sheets.values()].join('')).toContain('140%');
    // another site: the old sheet goes, nothing new comes in
    expect(SiteReadability.applyTo(wv, 'https://other.org/')).toBe(false);
    await settle(); await settle();
    expect(wv.sheets.size).toBe(0);
  });

  it('does nothing for an untuned site on a fresh page', () => {
    const wv = fakeWebview();
    expect(SiteReadability.applyTo(wv, 'https://plain.com/')).toBe(false);
    expect(wv.insertCSS).not.toHaveBeenCalled();
  });

  it('still inserts when removing the old key is refused (a navigation dropped it)', async () => {
    SiteReadability.set('example.com', { font: 120 });
    const wv = fakeWebview();
    wv._vexReadabilityKey = 'gone';
    wv.removeInsertedCSS = vi.fn(async () => { throw new Error('no such key'); });
    SiteReadability.applyTo(wv, 'https://example.com/');
    await settle(); await settle();
    expect(wv.insertCSS).toHaveBeenCalledTimes(1);
  });

  it('refuses to remember a site from a private window or a Tor tab', () => {
    expect(SiteReadability.canRemember(fakeWebview())).toBe(true);
    window.VexTabPolicy = { isPrivateWindow: true, canFillWebview: () => true };
    expect(SiteReadability.canRemember(fakeWebview())).toBe(false);
    window.VexTabPolicy = { isPrivateWindow: false, canFillWebview: () => false };
    expect(SiteReadability.canRemember(fakeWebview())).toBe(false);
  });
});

describe('Settings and Ctrl+K', () => {
  it('lists tuned sites and resets one', () => {
    SiteReadability.set('a.com', { font: 120 });
    SiteReadability.set('b.com', { contrast: 150 });
    const box = document.createElement('div');
    SiteReadability.renderSettings(box);
    expect(box.textContent).toContain('a.com');
    expect(box.textContent).toContain('text 120%');
    box.querySelector('[data-host="a.com"] [data-act="reset"]').click();
    expect(SiteReadability.get('a.com')).toBeNull();
    expect(box.textContent).not.toContain('a.com');
    expect(box.textContent).toContain('b.com');
  });

  it('owns a settings group and a command without touching index.html markup', () => {
    expect(VexSettingsGroups.ids()).toContain('site-readability');
    const root = document.createElement('div');
    VexSettingsGroups.mount(root);
    expect(root.querySelector('#setting-site-readability .setting-label').textContent).toMatch(/Reading/);
    globalThis.CommandBar = { commands: [] };
    VexModuleCommands.pushAll();
    expect(CommandBar.commands.map(c => c.id)).toContain('readability:tune');
    delete globalThis.CommandBar;
  });
});

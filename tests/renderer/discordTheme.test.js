// @vitest-environment jsdom
//
// "Match Discord to my Vex theme" (js/discord-theme.js): off by default; the
// 28 themes named after BetterDiscord themes load the real theme by its link,
// every other theme becomes a Vencord theme file of Discord's own variables
// with readable text; only Vex's own entries are ever touched, so the user's
// Vencord themes, links and QuickCSS survive turning it on and off.

import { beforeEach, describe, expect, it, vi } from 'vitest';
const fs = require('fs');
const path = require('path');
const { CustomThemes } = require('../../src/renderer/js/theme-custom.js');
globalThis.CustomThemes = CustomThemes;
const { DiscordTheme } = require('../../src/renderer/js/discord-theme.js');
const { IDS, ThemeManager, chromeTokens, hex, over } = require('./themeTokens.js');

// A built-in theme's nine colours, as the window's tokens resolve them (what
// ThemeStudio.colorsFromTheme reads in the real window).
function palette(id) {
  const t = chromeTokens(id);
  const toHex = (v, under) => {
    const c = hex(v);
    if (!c) throw new Error(`${id}: unreadable colour ${v}`);
    const solid = c.a < 1 && under ? over(c, hex(under)) : c;
    return CustomThemes.hex(solid.r, solid.g, solid.b);
  };
  const background = toHex(t['--bg']);
  const map = { surface: '--surface', text: '--text', muted: '--text-muted', primary: '--primary', success: '--success', warning: '--warning', danger: '--danger', border: '--border' };
  const out = { background };
  for (const [k, tok] of Object.entries(map)) out[k] = toHex(t[tok], background);
  return out;
}

const GENERATED = IDS.filter(id => !DiscordTheme.realFor(id));

describe('generated Discord colours', () => {
  it.each(GENERATED)('%s: every text colour reads at 4.5:1 on what it is drawn on', (id) => {
    const { checks } = DiscordTheme.tokens(palette(id));
    const bad = checks.filter(c => !c.ok).map(c => `${c.label} ${c.fg} on ${c.againstName} = ${c.ratio}`);
    expect(bad).toEqual([]);
    for (const c of checks) expect(CustomThemes.contrast(c.fg, c.against)).toBeGreaterThanOrEqual(4.5);
  });

  it('writes only checked values, onto Discord\'s live variable names, above Discord\'s own selectors', () => {
    const css = DiscordTheme.css(palette('rose'), 'Rosé');
    expect(css).toContain('@name Vex theme match');
    for (const v of ['--background-base-lowest', '--background-base-lower', '--background-surface-high', '--chat-background-default',
      '--text-default', '--text-muted', '--interactive-text-default', '--brand-500', '--control-primary-background-default', '--text-link']) {
      expect(css).toMatch(new RegExp(v + ': (#[0-9a-f]{6}|rgb\\([^)]*\\)) !important;'));
    }
    expect(css).toContain(':root:root.theme-dark');
    expect(css).toContain(':root:root .theme-light:not(.custom-user-profile-theme)');
    expect(() => DiscordTheme._cssValue('red; } body { display:none')).toThrow();
  });

  it('a light theme makes a light Discord and a dark one a dark Discord', () => {
    const lightT = DiscordTheme.tokens(palette('firefox-light'));
    const darkT = DiscordTheme.tokens(palette('firefox-dark'));
    expect(lightT.light).toBe(true);
    expect(darkT.light).toBe(false);
    expect(CustomThemes.luminance(lightT.vars['--chat-background-default'])).toBeGreaterThan(0.4);
    expect(CustomThemes.luminance(darkT.vars['--chat-background-default'])).toBeLessThan(0.1);
  });

  it('fixes a theme of your own whose text would not read', () => {
    const { checks } = DiscordTheme.tokens({ background: '#202020', surface: '#2a2a2a', text: '#444444', muted: '#333333', primary: '#ffff00' });
    expect(checks.every(c => c.ok)).toBe(true);
  });

  it('Discord\'s variable names are the ones its live CSS defines (checked 2026-10-11)', () => {
    // From discord.com's design-token sheet: the old --background-primary /
    // --header-primary family is gone; these are what .theme-dark sets now.
    const live = ['--background-base-lowest', '--background-base-lower', '--background-base-low', '--background-surface-high',
      '--background-surface-higher', '--background-surface-highest', '--chat-background-default', '--text-default', '--text-strong',
      '--text-subtle', '--text-muted', '--text-link', '--interactive-text-default', '--interactive-icon-default', '--channels-default',
      '--control-primary-background-default', '--control-primary-text-default', '--background-mod-subtle', '--app-frame-background'];
    const css = DiscordTheme.css(palette('nord'), 'Nord');
    for (const v of live) expect(css).toContain(v + ':');
    expect(css).not.toMatch(/--background-primary:|--header-primary:/);
  });
});

// ---- the Vencord side ------------------------------------------------------

// A Discord page with Vencord: its Settings, its theme-file store and QuickCSS.
function fakeVencord({ links = [], enabled = [], files = {}, quickCss = '' } = {}) {
  const store = new Map(Object.entries(files));
  const sets = { themeLinks: 0, enabledThemes: 0 };
  const settings = { _links: links, _enabled: enabled };
  Object.defineProperty(settings, 'themeLinks', { get() { return this._links; }, set(v) { sets.themeLinks++; this._links = v; } });
  Object.defineProperty(settings, 'enabledThemes', { get() { return this._enabled; }, set(v) { sets.enabledThemes++; this._enabled = v; } });
  const win = {
    Vencord: { Settings: settings },
    VencordNative: {
      themes: {
        uploadTheme: async (n, d) => { store.set(n, d); },
        deleteTheme: async (n) => { store.delete(n); },
        getThemeData: async (n) => store.get(n),
      },
      quickCss: { css: quickCss, get: async () => quickCss, set: async () => { throw new Error('Vex must never write QuickCSS'); } },
    },
  };
  return { win, store, settings, sets };
}
async function run(page, plan) {
  // eslint-disable-next-line no-new-func
  const fn = new Function('window', 'Vencord', 'VencordNative', 'return ' + DiscordTheme.guestScript(plan));
  return fn(page.win, page.win.Vencord, page.win.VencordNative);
}

describe('Vencord entries', () => {
  const USER_LINKS = ['https://example.github.io/mine.css', '@dark https://other.example/dark.css'];
  const USER_FILES = { 'my-theme.css': '/* mine */', 'other.css': '/* other */' };

  it('a real theme adds one marked link and keeps the user\'s links, files and QuickCSS', async () => {
    const page = fakeVencord({ links: [...USER_LINKS], enabled: ['my-theme.css'], files: { ...USER_FILES }, quickCss: 'body{}' });
    const r = await run(page, { link: 'https://clearvision.github.io/x.css' + DiscordTheme.LINK_MARK });
    expect(r).toEqual({ ok: true, changed: true });
    expect(page.settings.themeLinks).toEqual([...USER_LINKS, 'https://clearvision.github.io/x.css#vex-theme-match']);
    expect(page.settings.enabledThemes).toEqual(['my-theme.css']);
    expect([...page.store.keys()].sort()).toEqual(['my-theme.css', 'other.css']);
  });

  it('switching to a generated theme replaces Vex\'s link with Vex\'s file', async () => {
    const page = fakeVencord({ links: [...USER_LINKS, 'https://a.example/t.css#vex-theme-match'], enabled: ['my-theme.css'], files: { ...USER_FILES } });
    await run(page, { css: '/* vex */' });
    expect(page.settings.themeLinks).toEqual(USER_LINKS);
    expect(page.settings.enabledThemes).toEqual(['my-theme.css', DiscordTheme.FILE]);
    expect(page.store.get(DiscordTheme.FILE)).toBe('/* vex */');
    expect(page.store.get('my-theme.css')).toBe('/* mine */');
  });

  it('a colour change rewrites the file and makes Vencord read it again, live', async () => {
    const page = fakeVencord({ enabled: [DiscordTheme.FILE], files: { [DiscordTheme.FILE]: '/* old */' } });
    const before = page.sets.enabledThemes;
    const r = await run(page, { css: '/* new */' });
    expect(r.changed).toBe(true);
    expect(page.store.get(DiscordTheme.FILE)).toBe('/* new */');
    expect(page.sets.enabledThemes).toBe(before + 1);
    // Nothing changed: Vencord is left alone.
    const again = await run(page, { css: '/* new */' });
    expect(again.changed).toBe(false);
    expect(page.sets.enabledThemes).toBe(before + 1);
    expect(page.sets.themeLinks).toBe(0);
  });

  it('off removes exactly what Vex added: the user\'s own state comes back as it was', async () => {
    const page = fakeVencord({ links: [...USER_LINKS], enabled: ['my-theme.css', 'other.css'], files: { ...USER_FILES } });
    await run(page, { css: '/* vex */' });
    await run(page, { link: 'https://x.example/a.css#vex-theme-match' });
    await run(page, null);
    expect(page.settings.themeLinks).toEqual(USER_LINKS);
    expect(page.settings.enabledThemes).toEqual(['my-theme.css', 'other.css']);
    expect(Object.fromEntries(page.store)).toEqual(USER_FILES);
  });

  it('says so when Vencord is not running', async () => {
    const old = DiscordTheme.VENCORD_WAIT_MS;
    DiscordTheme.VENCORD_WAIT_MS = 50;
    try {
      // eslint-disable-next-line no-new-func
      const fn = new Function('window', 'return ' + DiscordTheme.guestScript(null));
      expect(await fn({})).toEqual({ ok: false, reason: 'no-vencord' });
    } finally { DiscordTheme.VENCORD_WAIT_MS = old; }
  });
});

describe('the switch', () => {
  beforeEach(() => {
    localStorage.clear();
    document.body.innerHTML = '<div id="discord-theme-setting"></div>';
    globalThis.ThemeManager = ThemeManager;
    ThemeManager.currentTheme = 'nord';
    globalThis.ThemeStudio = { colorsFromTheme: (id) => palette(id) };
    window.vexGuestUrl = (wv) => wv.url;
    window.vexGuestEval = vi.fn(async () => ({ ok: true, changed: true }));
  });

  it('is off by default, and off means Discord is not touched', () => {
    expect(DiscordTheme.isOn()).toBe(false);
    expect(DiscordTheme.plan('nord')).toBe(null);
    DiscordTheme.onPageReady({ url: 'https://discord.com/app' });
    expect(window.vexGuestEval).not.toHaveBeenCalled();
    DiscordTheme.renderSetting();
    expect(document.getElementById('setting-discord-theme').checked).toBe(false);
  });

  it('turning it on without Vencord offers the one-click install, and stays off when declined', async () => {
    window.vex = { extensionsList: vi.fn(async () => [{ folder: 'ublock-1', enabled: true }]) };
    window.vexConfirm = vi.fn(async () => false);
    expect(await DiscordTheme.setOn(true)).toBe(false);
    expect(window.vexConfirm).toHaveBeenCalled();
    expect(DiscordTheme.isOn()).toBe(false);
  });

  it('with Vencord, on gives every open Discord the plan, and a theme change updates it live', async () => {
    window.vex = { extensionsList: vi.fn(async () => [{ folder: 'vencord-123', enabled: true }]) };
    const panel = { url: 'https://discord.com/channels/@me' };
    globalThis.SidebarManager = { panelWebviews: { discord: panel } };
    expect(await DiscordTheme.setOn(true)).toBe(true);
    expect(window.vexGuestEval).toHaveBeenCalledTimes(1);
    expect(window.vexGuestEval.mock.calls[0][0]).toBe(panel);
    expect(window.vexGuestEval.mock.calls[0][1]).toContain('Vex theme match');
    expect(localStorage.getItem(DiscordTheme.APPLIED_KEY)).toBe('1');
    ThemeManager.currentTheme = 'firefox-light';
    document.dispatchEvent(new CustomEvent('theme-changed', { detail: { theme: 'firefox-light', auto: true } }));
    await DiscordTheme._chain;
    expect(window.vexGuestEval).toHaveBeenCalledTimes(2);
    // Off: Vex's entries are taken away, and a Discord loaded later is cleaned too.
    await DiscordTheme.setOn(false);
    expect(window.vexGuestEval.mock.calls[2][1]).toContain('"link":null,"css":null');
    expect(localStorage.getItem(DiscordTheme.APPLIED_KEY)).toBe(null);
    delete globalThis.SidebarManager;
  });

  it('a Discord that loads while the switch is off but Vex\'s entries may remain is cleaned', async () => {
    localStorage.setItem(DiscordTheme.APPLIED_KEY, '1');
    DiscordTheme.onPageReady({ url: 'https://discord.com/app' });
    await Promise.resolve();
    expect(window.vexGuestEval).toHaveBeenCalledTimes(1);
    expect(window.vexGuestEval.mock.calls[0][1]).toContain('"link":null,"css":null');
  });
});

describe('wiring', () => {
  const ROOT = path.join(__dirname, '..', '..', 'src', 'renderer');
  it('the panel and the tab both hand Discord pages over, and Settings has the switch', () => {
    expect(fs.readFileSync(path.join(ROOT, 'js', 'sidebar.js'), 'utf8')).toMatch(/DiscordTheme\.onPageReady\(wv\)/);
    expect(fs.readFileSync(path.join(ROOT, 'js', 'webview.js'), 'utf8')).toMatch(/DiscordTheme\.onPageReady\(webview\)/);
    const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
    expect(html).toContain('id="discord-theme-setting"');
    expect(html).toContain('<script src="js/discord-theme.js"></script>');
  });
});

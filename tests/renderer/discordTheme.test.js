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
const { DiscordTokens } = require('../../src/renderer/js/discord-tokens.js');
globalThis.DiscordTokens = DiscordTokens;
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

// A variable's value in one Discord mode (palette colours are set per mode).
const at = (t, n, m = 'dark') => t.modeVars[m][n] || t.vars[n];

// The text people read most: never given up for another use of its colour.
const READING = /^--(text-(default|strong|muted|subtle|link)|channels-default|interactive-text-(default|hover|active)|header-(primary|secondary)|input-text-default|channel-text-area-placeholder|input-placeholder-text-default) on /;

// A check of text drawn on the page itself (the surfaces, bare or under a hover veil).
const onPage = (c) => {
  const on = / on (.+) \(\w+\)$/.exec(c.label)[1];
  return on === 'the surfaces' || DiscordTokens.floors.includes(on) || DiscordTokens.layers.includes(on);
};

describe('generated Discord colours', () => {
  it('the token list is Discord\'s own, refreshed by scripts/discord-tokens.js', () => {
    // Every colour variable Discord's theme layers define, and every palette
    // colour its components use directly, with Discord's dark and light
    // values; the old --background-primary / --header-primary family is gone.
    expect(Object.keys(DiscordTokens.semantic).length).toBeGreaterThan(600);
    expect(Object.keys(DiscordTokens.primitive).length).toBeGreaterThan(100);
    expect(DiscordTokens.semantic['--background-primary']).toBeUndefined();
    for (const v of ['--background-base-lowest', '--background-base-low', '--background-surface-high', '--chat-background-default',
      '--text-default', '--text-muted', '--interactive-text-default', '--channels-default', '--control-primary-background-default',
      '--control-secondary-background-default', '--control-secondary-text-default', '--modal-background', '--background-mod-subtle']) {
      expect(DiscordTokens.semantic[v], v).toHaveLength(2);
    }
    // No value from the design-tool sheet that paints every palette colour hotpink.
    expect(JSON.stringify(DiscordTokens)).not.toContain('#ff69b4');
    expect(DiscordTokens.pairs.length).toBeGreaterThan(150);
    expect(DiscordTokens.floors).toContain('--background-base-low');
    expect(fs.existsSync(path.join(__dirname, '..', '..', 'scripts', 'discord-tokens.js'))).toBe(true);
  });

  it.each(IDS)('%s: every text-on-background pairing Discord\'s rules make reads, in every Discord mode', (id) => {
    const { checks } = DiscordTheme.tokens(palette(id));
    expect(checks.length).toBeGreaterThan(500);
    const bad = checks.filter(c => !c.ok).map(c => `${c.label} ${c.fg} on ${c.against} = ${c.ratio}`);
    expect(bad).toEqual([]);
    for (const c of checks) {
      if (c.conflict) {
        // A colour Discord uses in ways no one colour can serve on this
        // theme's page (its green as text on the page and under white text):
        // 3:1, or never less readable than in Discord itself, and never the
        // main text.
        expect(c.ratio, c.label).toBeGreaterThanOrEqual(Math.min(c.min, c.discord, 3, c.balanced ? DiscordTheme.BALANCED_FLOOR : 3) - 0.01);
        if (onPage(c)) expect(c.label).not.toMatch(READING);
      } else expect(c.ratio, c.label).toBeGreaterThanOrEqual(c.min - 0.005);
    }
  });

  it('covers every colour Discord defines and uses, in every Discord mode, with only checked values', () => {
    const css = DiscordTheme.css(palette('rose'), 'Rosé');
    expect(css).toContain('@name Vex theme match');
    const decl = (v) => new RegExp('\\n  ' + v + ': [^;]+ !important;');
    for (const v of Object.keys(DiscordTokens.semantic)) expect(css, v).toMatch(decl(v));
    for (const v of Object.keys(DiscordTokens.primitive)) expect(css, v).toMatch(decl(v));
    for (const m of DiscordTokens.modes) {
      expect(css).toContain(':root:root.theme-' + m);
      expect(css).toContain(':root:root .theme-' + m + ':not(.custom-user-profile-theme)');
    }
    for (const line of css.split('\n').filter(l => l.startsWith('  --'))) {
      expect(line).toMatch(/^ {2}--[\w-]+: (#[0-9a-f]{6}|rgb\(\d+ \d+ \d+ \/ [\d.]+\)|[\d.]+ [\d.]+% [\d.]+%) !important;$/);
    }
    expect(() => DiscordTheme._cssValue('red; } body { display:none')).toThrow();
  });

  it('the owner\'s report: Oxford Editorial makes all of Discord light, and the Edit buttons read', () => {
    const t = DiscordTheme.tokens(palette('oxford'));
    expect(t.light).toBe(true);
    const ct = CustomThemes;
    // Every surface, in every Discord mode (the vars are the same for all).
    for (const m of DiscordTokens.modes) for (const n of DiscordTokens.floors) expect(ct.luminance(at(t, n, m)), n + ' ' + m).toBeGreaterThan(0.6);
    // The "Edit" buttons: Discord's grey secondary button, white text in its dark design.
    const label = t.vars['--control-secondary-text-default'];
    for (const f of DiscordTokens.floors) {
      const veil = /rgb\((\d+) (\d+) (\d+) \/ ([\d.]+)\)/.exec(t.vars['--control-secondary-background-default']);
      const under = ct.mix(at(t, f), ct.hex(+veil[1], +veil[2], +veil[3]), +veil[4]);
      expect(ct.contrast(label, under), f).toBeGreaterThanOrEqual(4.5);
    }
    for (const n of ['--text-default', '--text-muted', '--channels-default', '--interactive-text-default']) {
      for (const f of DiscordTokens.floors) expect(ct.contrast(t.vars[n], at(t, f)), n + ' on ' + f).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('a light theme makes a light Discord and a dark one a dark Discord, whatever mode Discord is in', () => {
    const ct = CustomThemes;
    const opaqueNeutral = (v) => /^#[0-9a-f]{6}$/.test(v) && ct.toOklch(v)[1] < 0.035;
    for (const [id, light] of [['firefox-light', true], ['oxford', true], ['firefox-dark', false], ['dracula', false]]) {
      const t = DiscordTheme.tokens(palette(id));
      expect(t.light).toBe(light);
      // Discord's backgrounds, from its own design of the other brightness:
      // its dark surfaces under a light theme come out light, and the other way.
      for (const [n, [dark, lite]] of Object.entries(DiscordTokens.semantic)) {
        if (!/^--background-(base|surface)-/.test(n) && !DiscordTokens.floors.includes(n)) continue;
        const v = t.vars[n];
        if (!opaqueNeutral(v)) continue;
        if (light) expect(ct.luminance(v), `${id} ${n} (Discord: ${dark} / ${lite})`).toBeGreaterThan(0.4);
        else expect(ct.luminance(v), `${id} ${n}`).toBeLessThan(0.1);
      }
      // The member list's own background, set per Discord mode outside its
      // theme variables (#333338 in dark mode, #fafafa in light).
      for (const m of DiscordTokens.modes) {
        const v = t.modeVars[m]['--custom-channel-members-bg'];
        if (light) expect(ct.luminance(v), `${id} member list in Discord's ${m} mode`).toBeGreaterThan(0.4);
        else expect(ct.luminance(v), `${id} member list in Discord's ${m} mode`).toBeLessThan(0.1);
      }
    }
  });

  it('fixes a theme of your own whose text would not read', () => {
    const colors = { background: '#202020', surface: '#2a2a2a', text: '#444444', muted: '#333333', primary: '#ffff00' };
    const { checks } = DiscordTheme.tokens(colors);
    // Everything reads, except a palette colour balanced between uses no
    // colour can serve on surfaces this close together (and never the text).
    const bad = checks.filter(c => !c.ok);
    for (const c of bad) {
      expect(c.balanced, c.label).toBe(true);
      expect(c.label).not.toMatch(READING);
    }
    for (const c of checks.filter(k => READING.test(k.label) && onPage(k))) expect(c.ratio, c.label).toBeGreaterThanOrEqual(c.min - 0.005);
    expect(() => DiscordTheme.css(colors, 'Mine')).not.toThrow();
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
    expect(html.indexOf('<script src="js/discord-tokens.js"></script>')).toBeGreaterThan(-1);
    expect(html.indexOf('<script src="js/discord-tokens.js">')).toBeLessThan(html.indexOf('<script src="js/discord-theme.js">'));
  });
});

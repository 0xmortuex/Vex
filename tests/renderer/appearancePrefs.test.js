// @vitest-environment jsdom
//
// Two gaps in Settings > Appearance (cat-themes): websites ignored Vex's own
// light/dark (a dark Vex showed light sites), and Reduce motion could only be
// had from Windows.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(__dirname, '../..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

let WA, RM, sent, scheme;
async function load() {
  vi.resetModules();
  localStorage.clear();
  document.documentElement.removeAttribute('data-reduce-motion');
  document.body.innerHTML = '<select id="setting-website-appearance"><option value="vex"></option><option value="windows"></option><option value="light"></option><option value="dark"></option></select><input type="checkbox" id="setting-reduce-motion">';
  sent = [];
  scheme = 'light';
  window.vex = { setWebsiteAppearance: vi.fn(async (s) => { sent.push(s); return { ok: true, source: s }; }) };
  delete window.VexTabPolicy;
  window.showToast = vi.fn();
  // jsdom computes no color-scheme from the stylesheets; the window's own is given.
  window.getComputedStyle = () => ({ colorScheme: scheme });
  const mod = await import('../../src/renderer/js/appearance-prefs.js');
  WA = mod.WebsiteAppearance; RM = mod.ReduceMotion;
}

describe('Website appearance', () => {
  beforeEach(load);

  it('follows Vex by default: pages are told the light or dark Vex wears', async () => {
    expect(WA.mode()).toBe('vex');
    await WA.apply();
    expect(sent).toEqual(['light']);
    scheme = 'dark';
    document.dispatchEvent(new CustomEvent('theme-changed', { detail: { theme: 'firefox-dark' } }));
    await Promise.resolve();
    expect(sent).toEqual(['light', 'dark']);
  });

  it('Follow Windows, Light and Dark become themeSource system, light and dark', async () => {
    await WA.set('windows'); await WA.set('light'); await WA.set('dark');
    expect(sent).toEqual(['system', 'light', 'dark']);
    expect(localStorage.getItem('vex.websiteAppearance')).toBe('dark');
    expect(() => WA.set('purple')).toThrow(/no website appearance/);
  });

  it('a private window leaves it to the main window', async () => {
    window.VexTabPolicy = { isPrivateWindow: true };
    await WA.apply();
    expect(sent).toEqual([]);
  });

  it('the setting is in Settings > Appearance, translated, and cleared by Reset to Defaults', () => {
    const html = read('src/renderer/index.html');
    expect(html).toMatch(/<select id="setting-website-appearance"[^>]*>\s*<option value="vex">Follow Vex<\/option>\s*<option value="windows">Follow Windows<\/option>\s*<option value="light">Light<\/option>\s*<option value="dark">Dark<\/option>/);
    expect(html.indexOf('js/appearance-prefs.js')).toBeGreaterThan(-1);
    expect(html.indexOf('js/appearance-prefs.js')).toBeLessThan(html.indexOf('js/app.js'));
    const i18n = read('src/renderer/js/i18n-ui.js');
    for (const s of ['Website appearance', 'Follow Vex', 'Reduce motion']) expect(i18n).toContain(`'${s}':`);
    const app = read('src/renderer/js/app.js');
    expect(app).toMatch(/'vex\.websiteAppearance', 'vex\.reduceMotion'/);
  });

  it('main applies it to nativeTheme.themeSource and refuses anything else', async () => {
    const { wireWebsiteAppearance } = await import('../../src/main/website-appearance.js');
    const handlers = {};
    const nativeTheme = { themeSource: 'system' };
    wireWebsiteAppearance({ ipcMain: { handle: (c, fn) => { handlers[c] = fn; } }, nativeTheme });
    expect(handlers['theme:set-website-appearance']({}, 'dark')).toEqual({ ok: true, source: 'dark' });
    expect(nativeTheme.themeSource).toBe('dark');
    expect(() => handlers['theme:set-website-appearance']({}, 'blue')).toThrow(/Not a website appearance/);
    const { validate } = await import('../../src/main/ipc-schemas.js');
    expect(() => validate('theme:set-website-appearance', ['light'])).not.toThrow();
    expect(() => validate('theme:set-website-appearance', ['blue'])).toThrow();
  });
});

describe('Reduce motion', () => {
  beforeEach(load);

  it('off by default (Windows decides); on stills Vex\'s animations whatever Windows says', () => {
    expect(RM.on()).toBe(false);
    expect(document.documentElement.hasAttribute('data-reduce-motion')).toBe(false);
    const box = document.getElementById('setting-reduce-motion');
    box.checked = true;
    box.dispatchEvent(new Event('change'));
    expect(document.documentElement.hasAttribute('data-reduce-motion')).toBe(true);
    expect(localStorage.getItem('vex.reduceMotion')).toBe('1');
    box.checked = false;
    box.dispatchEvent(new Event('change'));
    expect(document.documentElement.hasAttribute('data-reduce-motion')).toBe(false);
  });

  it('a11y.css applies the reduced-motion rules under the switch as under Windows\' setting', () => {
    const css = read('src/renderer/css/a11y.css');
    expect(css).toMatch(/html\[data-reduce-motion\] \*,\s*html\[data-reduce-motion\] \*::before,\s*html\[data-reduce-motion\] \*::after \{\s*animation-duration: 0\.01ms !important;[^}]*transition-duration: 0\.01ms !important;/);
    expect(css).toMatch(/html\[data-reduce-motion\] :is\(\.ai-spinner/);
  });

  it('the page loading ring keeps pulsing under reduced motion instead of freezing', () => {
    const css = read('src/renderer/css/a11y.css');
    const media = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'));
    expect(media).toMatch(/#webviews-container\.wv-loading::after\s*\{\s*animation-name: vex-a11y-working !important;/);
    expect(css).toMatch(/html\[data-reduce-motion\] #webviews-container\.wv-loading::after \{\s*animation-name: vex-a11y-working !important;/);
    // A pseudo-element inside :is() is dropped by the browser, silently.
    expect(css).not.toMatch(/:is\([^)]*::(after|before)/);
  });
});

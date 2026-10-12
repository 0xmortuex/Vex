// @vitest-environment jsdom
//
// Item #2 (2026-10-09): a Chrome Web Store theme becomes one of your own
// themes (js/chrome-theme.js on js/theme-custom.js and js/theme-studio.js).
// jsdom decodes no pictures, so the picture steps (main colour of the frame
// and toolbar pictures, the New Tab picture fitted and toned) were driven in
// the live app with real store themes (see the item #2 report); here: the
// colour mapping, the contrast guarantee, the install routes and what is kept.
import { describe, it, expect, vi, afterEach } from 'vitest';

const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..', '..');

let images, saved, confirmAnswer;

async function load({ list, theme = 'nord' } = {}) {
  vi.resetModules();
  localStorage.clear();
  document.head.innerHTML = '';
  document.body.innerHTML = '<div id="panel-settings"><button id="setting-theme-make"></button><button id="setting-theme-import"></button><button id="setting-theme-chrome"></button><div id="custom-themes-list"></div>'
    + '<select id="setting-theme-auto-mode"><option value="off">Off</option><option value="system">System</option></select>'
    + '<select id="setting-theme-light"></select><select id="setting-theme-dark"></select><input id="setting-theme-dark-from"><input id="setting-theme-dark-to"></div>';
  document.documentElement.removeAttribute('data-theme');
  localStorage.setItem('vex.customThemesMigrated', '1');
  if (list) localStorage.setItem('vex.customThemes', JSON.stringify(list));
  images = new Map();
  saved = { theme };
  confirmAnswer = true;
  globalThis.VexStorage = { load: vi.fn(async (k) => saved[k]), save: vi.fn(async (k, v) => { saved[k] = v; }) };
  globalThis.VexIcons = { svg: (n) => `<svg data-icon="${n}"></svg>` };
  window.escapeHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  window.showToast = vi.fn();
  window.vexConfirm = vi.fn(async () => confirmAnswer);
  window.vexAlert = vi.fn(async () => {});
  window.vex = {
    getCustomThemeImage: vi.fn(async (id) => images.get(id || '') ?? null),
    setCustomThemeImage: vi.fn(async (img, id) => { if (img) images.set(id || '', img); else images.delete(id || ''); return { ok: true }; }),
    getSystemDark: vi.fn(async () => ({ dark: true })),
  };
  globalThis.VexJobs = { every: vi.fn(), stop: vi.fn() };
  await import('../../src/renderer/js/theme-custom.js');
  const TM = (await import('../../src/renderer/js/theme-manager.js')).ThemeManager;
  globalThis.ThemeManager = TM;
  const TA = (await import('../../src/renderer/js/theme-auto.js')).ThemeAuto;
  globalThis.ThemeAuto = TA;
  const TS = (await import('../../src/renderer/js/theme-studio.js')).ThemeStudio;
  globalThis.ThemeStudio = TS;
  const CT = (await import('../../src/renderer/js/chrome-theme.js')).ChromeTheme;
  TS.wireSettings();
  await TM.init();
  return { TM, TA, TS, CT, C: window.CustomThemes };
}
afterEach(() => { globalThis.ThemeAuto?.stop?.(); delete globalThis.VexWebStore; });

// main's clean form: [r, g, b, a].
const rgb = (r, g, b, a = 1) => [r, g, b, a];
// Google's "Just Black" (aghfnjkcakhmadgdomlmlhhaocbkloab), as main reads it.
const JUST_BLACK = {
  colors: { frame: rgb(0, 0, 0), toolbar: rgb(45, 45, 45), ntp_background: rgb(0, 0, 0), tab_text: rgb(255, 255, 255), bookmark_text: rgb(255, 255, 255), tab_background_text: rgb(255, 255, 255), ntp_text: rgb(125, 134, 142) },
  tints: { buttons: [0.2, 0.2, 0.9] },
};
// Catppuccin Macchiato (cmpdlhmnmjhihmcfnigoememnffkimlk).
const CATPPUCCIN = {
  colors: { frame: rgb(24, 25, 38), bookmark_text: rgb(202, 211, 245), tab_background_text: rgb(184, 192, 224), tab_text: rgb(202, 211, 245), toolbar: rgb(36, 39, 58), omnibox_text: rgb(202, 211, 245), omnibox_background: rgb(24, 25, 38), ntp_background: rgb(36, 39, 58), ntp_link: rgb(202, 211, 245), ntp_text: rgb(202, 211, 245), button_background: rgb(24, 25, 38) },
  tints: {},
};

describe('Chrome colours to Vex colours', () => {
  it('Just Black: black background, its toolbar grey as the surface, white text, the light grey of its tinted buttons as the accent', async () => {
    const { CT, C } = await load();
    const out = CT.convert(JUST_BLACK);
    expect(out.colors).toMatchObject({ background: '#000000', surface: '#2d2d2d', text: '#ffffff', primary: '#e0e0e0' });
    expect(out.accentFrom).toBe('buttons');
    expect(out.light).toBe(false);
    expect(out.changed).toEqual([]);
    expect(C.checks(out.colors).every(c => c.ok)).toBe(true);
  });
  it('a link colour that is just the text colour is not an accent; a frame with no hue gives Chrome\'s blue', async () => {
    const { CT } = await load();
    const out = CT.convert(CATPPUCCIN);
    expect(out.colors.background).toBe('#181926');
    expect(out.colors.text).toBe('#cad3f5');
    expect(out.accentFrom).toBe('default');
    expect(out.colors.primary).toBe('#8ab4f8');
  });
  it('a link colour of its own is the accent', async () => {
    const { CT } = await load();
    const out = CT.convert({ colors: { ...CATPPUCCIN.colors, ntp_link: rgb(238, 153, 160) } });
    expect(out.accentFrom).toBe('link');
    expect(out.mapped.primary).toBe('#ee99a0');
  });
  it('a mid-grey frame with white text: the background is darkened just enough, and Vex says so', async () => {
    const { CT, C } = await load();
    const out = CT.convert({ colors: { frame: rgb(127, 127, 127), toolbar: rgb(120, 120, 120), tab_text: rgb(255, 255, 255) } });
    expect(out.light).toBe(false);
    expect(out.changed).toEqual(expect.arrayContaining(['background', 'surface']));
    expect(C.luminance(out.colors.background)).toBeLessThanOrEqual(0.1);
    expect(C.checks(out.colors).every(c => c.ok)).toBe(true);
  });
  it('a light theme with no toolbar colour gets a lighter surface of its own, and dark text', async () => {
    const { CT, C } = await load();
    const out = CT.convert({ colors: { frame: rgb(230, 240, 250), ntp_text: rgb(20, 30, 40) } });
    expect(out.light).toBe(true);
    expect(out.colors.text).toBe('#141e28');
    expect(C.luminance(out.colors.surface)).toBeGreaterThan(C.luminance(out.colors.background));
    expect(C.checks(out.colors).every(c => c.ok)).toBe(true);
  });
  it('a dark tab strip over a light toolbar and New Tab (Mono Light) is a light theme: the frame is lifted, keeping its hue', async () => {
    const { CT, C } = await load();
    const out = CT.convert({ colors: { frame: rgb(66, 66, 66), toolbar: rgb(224, 224, 224), ntp_background: rgb(224, 224, 224), bookmark_text: rgb(0, 0, 0), tab_text: rgb(0, 0, 0), tab_background_text: rgb(224, 224, 224) }, tints: { buttons: [1, 0, 0.5] } });
    expect(out.light).toBe(true);
    expect(out.colors.surface).toBe('#e0e0e0');
    expect(out.colors.text).toBe('#000000');
    expect(C.luminance(out.colors.background)).toBeGreaterThanOrEqual(0.42);
    expect(C.toHsl(out.colors.background)[1]).toBe(0);
    expect(out.changed).toContain('background');
    expect(out.changed).not.toContain('surface');
  });
  it('no frame colour: Chrome\'s own frame, shifted by the theme\'s frame tint', async () => {
    const { CT } = await load();
    expect(CT.convert({ colors: {} }).mapped.background).toBe('#dee1e6');
    const tinted = CT.convert({ colors: {}, tints: { frame: [0.6, 0.9, 0.3] } }).mapped.background;
    expect(tinted).not.toBe('#dee1e6');
  });
  it('the frame and toolbar pictures\' colours stand in for the template colours under them', async () => {
    const { CT } = await load();
    // Many store themes keep a template frame [66,116,201] and toolbar [40,40,40] under their pictures.
    const out = CT.convert({ colors: { frame: rgb(66, 116, 201), toolbar: rgb(40, 40, 40), bookmark_text: rgb(255, 255, 255), tab_text: rgb(0, 0, 0) }, frameImage: '#e9e0f2', toolbarImage: '#f4eef9' });
    expect(out.mapped.background).toBe('#e9e0f2');
    expect(out.mapped.surface).toBe('#f4eef9');
    // The text that reads on them: the black tab text, not the white bookmark text.
    expect(out.mapped.text).toBe('#000000');
    expect(out.light).toBe(true);
  });
  it('see-through colours are laid over what they sit on', async () => {
    const { CT } = await load();
    expect(CT.hexOf(rgb(0, 0, 0, 0.5), '#ffffff')).toBe('#808080');
    expect(CT.hexOf(rgb(0, 0, 0, 0))).toBe('#ffffff');
    expect(CT.hexOf(null)).toBeNull();
  });
  it('tints shift like Chrome\'s HSLShift: -1 and 0.5 leave a value alone', async () => {
    const { CT } = await load();
    expect(CT.shift('#5f6368', [-1, -1, -1])).toBe('#5f6368');
    expect(CT.shift('#5f6368', [-1, 0.5, 0.5])).toBe('#5f6368');
    expect(CT.shift('#5f6368', [0, 0, 1])).toBe('#ffffff');
    expect(CT.shift('#5f6368', [0, 0, 0])).toBe('#000000');
    // Full saturation at hue 0 turns a grey red.
    const [r, g, b] = window.CustomThemes.rgb(CT.shift('#808080', [0, 1, -1]));
    expect(r).toBeGreaterThan(250);
    expect(g + b).toBeLessThan(10);
  });
  it('whatever a theme says, every text colour reads at 4.5:1 and every colour is a plain hex', async () => {
    const { CT, C } = await load();
    let s = 12345;
    const rnd = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
    const col = () => rgb(Math.floor(rnd() * 256), Math.floor(rnd() * 256), Math.floor(rnd() * 256), rnd() < 0.15 ? rnd() : 1);
    for (let i = 0; i < 120; i++) {
      const colors = {};
      for (const k of ['frame', 'toolbar', 'tab_text', 'bookmark_text', 'ntp_text', 'ntp_link', 'button_background']) if (rnd() < 0.7) colors[k] = col();
      const tints = rnd() < 0.5 ? { buttons: [rnd(), rnd(), rnd()], frame: [-1, rnd(), rnd()] } : {};
      const out = CT.convert({ colors, tints });
      for (const v of Object.values(out.colors)) expect(v).toMatch(/^#[0-9a-f]{6}$/);
      const bad = C.checks(out.colors).filter(c => !c.ok);
      expect(bad, JSON.stringify({ colors, tints, out: out.colors })).toEqual([]);
      expect(out.unresolved).toEqual([]);
    }
  }, 180000);
});

const preview = (extra = {}) => ({ ok: true, id: 'aghfnjkcakhmadgdomlmlhhaocbkloab', name: 'Just Black', isTheme: true, refuse: 'This is a Chrome theme, not an extension.', theme: { name: 'Just Black', ...JUST_BLACK, properties: { alignment: 'center', repeat: 'no-repeat' }, images: {} }, ...extra });

describe('adding it', () => {
  it('asks first, then it is one of your themes: saved, worn, in the dark list of Light and dark', async () => {
    const { CT, TS, TM, TA } = await load();
    expect(await CT.offer(preview())).toBe('added');
    const dialog = window.vexConfirm.mock.calls[0][0];
    expect(dialog.title).toBe('Add the theme “Just Black”?');
    expect(dialog.okLabel).toBe('Add to Vex');
    expect(dialog.html).toMatch(/Nothing in it runs/);
    expect(dialog.html).toMatch(/A dark theme/);
    const rec = TS.records()[0];
    expect(rec).toMatchObject({ name: 'Just Black', colors: { background: '#000000', primary: '#e0e0e0' } });
    expect(TM.getCurrentTheme()).toBe(rec.id);
    expect(TA.isLightTheme(TM.getThemeMeta(rec.id))).toBe(false);
    expect(window.showToast).toHaveBeenCalledWith('Added the theme “Just Black” and switched to it.', 'success', 3000);
    // A second time is a second theme, with its own name.
    await CT.offer(preview());
    expect(TS.records().map(r => r.name)).toEqual(['Just Black', 'Just Black 2']);
  });
  it('says in the toast when it made colours readable', async () => {
    const { CT } = await load();
    await CT.offer(preview({ theme: { name: 'Grey', colors: { frame: rgb(127, 127, 127), toolbar: rgb(120, 120, 120), tab_text: rgb(255, 255, 255) }, tints: {}, images: {} } }));
    const [msg] = window.showToast.mock.calls.at(-1);
    expect(msg).toMatch(/Vex made its background(, surface)? and (surface|accent) colours a little lighter or darker so all text reads at 4\.5:1/);
  });
  it('No keeps nothing', async () => {
    const { CT, TS } = await load();
    confirmAnswer = false;
    expect(await CT.offer(preview())).toBe('cancelled');
    expect(TS.records()).toEqual([]);
  });
  it('the dialog escapes the file name and the theme name; a long name is cut to fit', async () => {
    const { CT } = await load();
    const evil = '<img src=x onerror=alert(1)>';
    await CT.offer(preview({ source: 'developer', file: evil, theme: { ...preview().theme, name: evil + ' and a very long name that goes on' } }));
    const dialog = window.vexConfirm.mock.calls[0][0];
    expect(dialog.html).not.toContain('<img src=x');
    expect(dialog.html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(dialog.html).toMatch(/not from the Chrome Web Store/);
    expect(dialog.title.length).toBeLessThanOrEqual('Add the theme “”?'.length + 40);
  });
  it('a theme that is also an extension is offered as an extension; one with hidden code is refused', async () => {
    const { CT, TS } = await load();
    expect(await CT.offer(preview({ theme: undefined, themeRefused: 'This theme also carries code (background).', asExtension: true }))).toBe('extension');
    expect(window.vexConfirm.mock.calls[0][0].okLabel).toBe('Install as an extension');
    confirmAnswer = false;
    expect(await CT.offer(preview({ theme: undefined, themeRefused: 'x', asExtension: true }))).toBe('cancelled');
    expect(await CT.offer(preview({ theme: undefined, themeRefused: 'This theme also carries code (images/x.js).', asExtension: false }))).toBe('refused');
    expect(window.vexAlert).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringMatching(/images\/x\.js/) }));
    expect(TS.records()).toEqual([]);
  });
  it('not a theme: nothing to do here', async () => {
    const { CT } = await load();
    expect(await CT.offer({ ok: true, isTheme: false, name: 'uBlock' })).toBeNull();
  });
});

describe('the ways in', () => {
  it('Add to Vex on a theme\'s store page makes it a theme and never installs it as an extension', async () => {
    const { TS } = await load();
    window.vex.extensionsWebStorePreview = vi.fn(async () => preview());
    window.vex.extensionsInstallWebStore = vi.fn();
    globalThis.TabManager = undefined;
    const { VexWebStore } = await import('../../src/renderer/js/web-store.js');
    const r = await VexWebStore.install('https://chromewebstore.google.com/detail/just-black/aghfnjkcakhmadgdomlmlhhaocbkloab');
    expect(r).toEqual({ ok: true, theme: true });
    expect(window.vex.extensionsInstallWebStore).not.toHaveBeenCalled();
    expect(TS.records()[0].name).toBe('Just Black');
  });
  it('a theme .crx picked in Settings › Extensions is a theme too', () => {
    const src = fs.readFileSync(path.join(ROOT, 'src/renderer/js/extensions-settings.js'), 'utf8');
    expect(src).toMatch(/p\.isTheme && typeof ChromeTheme !== 'undefined' && await ChromeTheme\.offer\(p\) !== 'extension'/);
  });
  it('Settings › Appearance › Chrome theme… asks for a link or id, with a .crx file as the other way', async () => {
    const { CT } = await load();
    window.vexPrompt = vi.fn(async () => '  aghfnjkcakhmadgdomlmlhhaocbkloab ');
    globalThis.VexWebStore = { install: vi.fn(async () => ({ ok: true, theme: true })) };
    document.getElementById('setting-theme-chrome').click();
    await new Promise(r => setTimeout(r, 0));
    expect(window.vexPrompt.mock.calls[0][0]).toMatchObject({ title: 'Add a Chrome theme', extra: { label: 'From a .crx file…' } });
    expect(globalThis.VexWebStore.install).toHaveBeenCalledWith('aghfnjkcakhmadgdomlmlhhaocbkloab');
    // The .crx: main's picker, then the same offer.
    window.vex.extensionsInstallZip = vi.fn(async () => preview({ source: 'webstore-file', file: 'justblack.crx' }));
    expect(await CT.pickFile()).toBe('added');
    window.vex.extensionsInstallZip = vi.fn(async () => ({ ok: true, isTheme: false, name: 'uBlock' }));
    expect(await CT.pickFile()).toBeNull();
    expect(window.showToast).toHaveBeenLastCalledWith('“uBlock” is an extension, not a theme. Settings › Extensions installs it.', 'info', 5000);
  });
  it('the button is in Settings › Appearance, and the script loads after the theme editor', () => {
    const html = fs.readFileSync(path.join(ROOT, 'src/renderer/index.html'), 'utf8');
    expect(html).toMatch(/id="setting-theme-chrome"/);
    expect(html.indexOf('js/chrome-theme.js')).toBeGreaterThan(html.indexOf('js/theme-studio.js'));
  });
});

describe('vexPrompt carries a third button', () => {
  it('extra closes the prompt as a cancel and runs', async () => {
    vi.resetModules();
    document.body.innerHTML = '';
    await import('../../src/renderer/js/vex-dialog.js');
    const run = vi.fn();
    const p = window.vexPrompt({ title: 'Add a Chrome theme', extra: { label: 'From a .crx file…', run } });
    const extra = document.querySelector('[data-extra]');
    expect(extra.textContent).toBe('From a .crx file…');
    extra.click();
    expect(await p).toBeNull();
    expect(run).toHaveBeenCalled();
  });
});

describe('Glass shows a theme\'s New Tab picture', () => {
  it('the start page marks a picture and Glass paints it under its own dark, measured, instead of hiding it', () => {
    const html = fs.readFileSync(path.join(ROOT, 'src/renderer/start.html'), 'utf8');
    expect(html).toMatch(/html\[data-gui-style="glass"\]\[data-theme-image\] body \{[^}]*var\(--vex-theme-image\) center \/ cover no-repeat fixed[^}]*!important/);
    expect(html).toMatch(/var\(--vex-glass-scrim, 0\.9\)/);
    expect(html).toMatch(/html\.setAttribute\('data-theme-image', ''\)/);
    expect(html).toMatch(/html\.removeAttribute\('data-theme-image'\)/);
    // Only a checked picture is written into CSS.
    expect(html).toMatch(/CustomThemes\.checkImage\(img\);/);
  });
});

describe('Ask Vex knows about themes of your own', () => {
  it('the catalogue has the theme editor, a theme from a picture, Light and dark and Chrome themes, each pointing at Settings › Appearance', async () => {
    vi.resetModules();
    const { VexFeatures } = await import('../../src/renderer/js/feature-catalog.js');
    const { FeatureDetails } = await import('../../src/renderer/js/feature-details.js');
    const html = fs.readFileSync(path.join(ROOT, 'src/renderer/index.html'), 'utf8');
    for (const id of ['theme-editor', 'theme-from-picture', 'theme-auto', 'chrome-themes']) {
      const f = VexFeatures.get(id);
      expect(f, id).toBeTruthy();
      expect(f.cat).toBe('look');
      expect(html).toContain(`id="${f.setting.section}"`);
      expect(FeatureDetails[id], id).toBeTruthy();
    }
    globalThis.VexFeatures = VexFeatures;
    const { VexGuide } = await import('../../src/renderer/js/vex-guide.js');
    const best = (q) => VexGuide.find(q, 1)[0]?.entry.id;
    expect(best('how do i install a chrome theme')).toBe('chrome-themes');
    expect(best('make my own theme')).toBe('theme-editor');
    expect(best('theme from my wallpaper')).toBe('theme-from-picture');
    expect(best('switch to a dark theme at night')).toBe('theme-auto');
    // Following it opens Settings at that row.
    globalThis.SettingsUI = { openSection: vi.fn() };
    VexGuide.show(VexFeatures.get('chrome-themes'));
    expect(globalThis.SettingsUI.openSection).toHaveBeenCalledWith('custom-themes-row');
    delete globalThis.SettingsUI;
    delete globalThis.VexFeatures;
  });
});

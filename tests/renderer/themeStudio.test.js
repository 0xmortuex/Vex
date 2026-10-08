// @vitest-environment jsdom
//
// Item #4 (2026-10-08): the theme editor, your themes in Settings, the
// .vextheme file and the old Custom Image theme moving into a theme of its own
// (js/theme-studio.js). jsdom draws nothing, so these hold the contract: what
// is saved, what the window wears, what Cancel puts back, what the New Tab is
// handed. The live app was driven by hand as well (see the item #4 report).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..', '..');

const DARK = { background: '#0e0e12', surface: '#1a1a22', text: '#e6e6f0', muted: '#7f7f92', primary: '#8b8bff', success: '#34d399', warning: '#fbbf24', danger: '#f87171', border: '#2a2a35' };
const NORD = { background: '#2e3440', surface: '#3b4252', text: '#eceff4', muted: '#d8dee9', primary: '#88c0d0', success: '#a3be8c', warning: '#ebcb8b', danger: '#bf616a', border: '#4c566a' };

let images, saved, confirmAnswer;

async function load({ list, theme, legacyImage, migrated = true, favs } = {}) {
  vi.resetModules();
  localStorage.clear();
  document.head.innerHTML = '';
  document.body.innerHTML = '<div id="panel-settings"><button id="setting-theme-make"></button><button id="setting-theme-import"></button><div id="custom-themes-list"></div>'
    + '<select id="setting-theme-auto-mode"><option value="off">Off</option><option value="system">System</option><option value="schedule">Schedule</option><option value="sun">Sun</option></select>'
    + '<select id="setting-theme-light"></select><select id="setting-theme-dark"></select><input id="setting-theme-dark-from"><input id="setting-theme-dark-to"></div>';
  document.documentElement.removeAttribute('data-theme');
  if (migrated) localStorage.setItem('vex.customThemesMigrated', '1');
  if (list) localStorage.setItem('vex.customThemes', JSON.stringify(list));
  if (favs) localStorage.setItem('vex.favThemes', JSON.stringify(favs));
  images = new Map();
  if (legacyImage) images.set('', legacyImage);
  saved = { theme };
  confirmAnswer = true;
  globalThis.VexStorage = {
    load: vi.fn(async (k) => saved[k]),
    save: vi.fn(async (k, v) => { saved[k] = v; }),
  };
  globalThis.VexIcons = { svg: (n) => `<svg data-icon="${n}"></svg>` };
  window.showToast = vi.fn();
  window.vexConfirm = vi.fn(async () => confirmAnswer);
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
  // jsdom resolves no CSS variables, so a built-in theme's colours are given.
  TS.colorsFromTheme = vi.fn((id) => (TS.record(id) ? { ...TS.record(id).colors } : { ...NORD }));
  TS.wireSettings();
  await TM.init();
  return { TM, TA, TS };
}

const styleText = () => document.getElementById('vex-user-themes')?.textContent || '';
const panel = () => document.querySelector('.vts-panel');
const click = (sel) => panel().querySelector(sel).click();
const setColour = (key, value) => {
  const hex = panel().querySelector(`.vts-hex[data-key="${key}"]`);
  hex.value = value;
  hex.dispatchEvent(new Event('input', { bubbles: true }));
};
const flush = () => new Promise(r => setTimeout(r, 0));

afterEach(() => { globalThis.ThemeAuto?.stop?.(); delete globalThis.WebviewManager; });

describe('your themes in the theme list', () => {
  it('are registered after the built-in ones, with a CSS block each, and restored at start', async () => {
    const { TM } = await load({ list: [{ id: 'user-harbour', name: 'Harbour', colors: DARK }], theme: 'user-harbour' });
    const meta = TM.getThemeMeta('user-harbour');
    expect(meta).toMatchObject({ id: 'user-harbour', label: 'Harbour', user: true, accent: '#8b8bff' });
    expect(TM.THEMES.indexOf(meta)).toBe(TM.THEMES.length - 1);
    expect(styleText()).toContain('[data-theme="user-harbour"] {');
    expect(TM.getCurrentTheme()).toBe('user-harbour');
    expect(document.documentElement.getAttribute('data-theme')).toBe('user-harbour');
  });

  it('light ones are offered as light themes and dark ones as dark in Light and dark', async () => {
    const light = { ...DARK, background: '#f4f1ea', surface: '#ffffff', text: '#1b1b1b', muted: '#5c5c5c', primary: '#0b5cad' };
    const { TA, TM } = await load({ list: [{ id: 'user-paper', name: 'Paper', colors: light }, { id: 'user-harbour', name: 'Harbour', colors: DARK }] });
    expect(TA.isLightTheme(TM.getThemeMeta('user-paper'))).toBe(true);
    expect(TA.isLightTheme(TM.getThemeMeta('user-harbour'))).toBe(false);
    TA.wireSettings();
    const opts = (sel, group) => [...document.querySelector(`${sel} optgroup[label="${group}"]`).querySelectorAll('option')].map(o => o.value);
    expect(opts('#setting-theme-light', 'Light themes')).toContain('user-paper');
    expect(opts('#setting-theme-dark', 'Dark themes')).toContain('user-harbour');
    // As the dark slot, it is worn when it is dark.
    TA.set({ mode: 'system', light: 'oxford', dark: 'user-harbour' });
    expect(TM.getCurrentTheme()).toBe('user-harbour');
  });

  it('the New Tab is handed the colours with the id (?tc=), and the page derives the same CSS', async () => {
    const { TM } = await load({ list: [{ id: 'user-harbour', name: 'Harbour', colors: DARK }] });
    const js = TM.startPageThemeJs('user-harbour');
    expect(js).toContain('"user-harbour"');
    expect(js).toContain(CustomThemes.toQuery(DARK));
    window.applyStartTheme = vi.fn();
    window.history.replaceState(null, '', '/start.html?theme=oxford');
    new Function(js)();
    expect(window.applyStartTheme).toHaveBeenCalledWith('user-harbour', CustomThemes.toQuery(DARK));
    expect(new URL(location.href).searchParams.get('tc')).toBe(CustomThemes.toQuery(DARK));
    // A built-in theme takes the tc off again.
    new Function(TM.startPageThemeJs('nord'))();
    expect(new URL(location.href).searchParams.get('tc')).toBeNull();
    delete window.applyStartTheme;
  });
});

describe('the editor', () => {
  let wv;
  beforeEach(() => { wv = { getURL: () => 'file:///C:/vex/src/renderer/start.html?theme=nord', executeJavaScript: vi.fn(() => Promise.resolve()) }; });

  it('Customise a built-in theme: the window and the New Tab wear the edit, Cancel puts it all back', async () => {
    const { TM, TS } = await load({ theme: 'nord' });
    globalThis.WebviewManager = { webviews: new Map([['t', wv]]) };
    const before = styleText();
    await TS.open({ from: 'nord' });
    const id = TS._ed.id;
    expect(id).toMatch(/^user-[a-z]{10}$/);
    expect(document.documentElement.getAttribute('data-theme')).toBe(id);
    expect(panel().querySelector('.vts-name').value).toBe('Nord (my version)');
    setColour('background', '#203040');
    expect(styleText()).toContain('--vex-bg-base: #203040;');
    await new Promise(r => setTimeout(r, 120));
    const last = wv.executeJavaScript.mock.calls.at(-1)[0];
    expect(last).toContain(id);
    expect(last).toContain('203040');
    // Nothing is saved while editing.
    expect(localStorage.getItem('vex.customThemes')).toBeNull();
    expect(VexStorage.save).not.toHaveBeenCalledWith('theme', id);
    click('[data-act="cancel"]');
    await flush();
    expect(panel()).toBeNull();
    expect(document.documentElement.getAttribute('data-theme')).toBe('nord');
    expect(TM.availableThemes).not.toContain(id);
    expect(styleText()).toBe(before);
    expect(wv.executeJavaScript.mock.calls.at(-1)[0]).toContain('"nord"');
  });

  it('under a browser look in its own colours the frame follows the edit, and Cancel gives the look its colours back', async () => {
    const { TS } = await load({ theme: 'nord' });
    let colours = 'look';
    window.VexGuiStyle = { isBrowserLook: () => true, getColors: () => colours, setColors: vi.fn((m) => { colours = m; }) };
    await TS.open({ from: 'nord' });
    expect(colours).toBe('theme');
    TS.cancel();
    expect(colours).toBe('look');
    // Saved, it keeps the theme's colours, as any real pick does.
    await TS.open({ from: 'nord' });
    click('[data-act="save"]');
    await flush(); await flush();
    expect(colours).toBe('theme');
    delete window.VexGuiStyle;
  });

  it('a half-typed hex value changes nothing and is marked', async () => {
    const { TS } = await load({ theme: 'nord' });
    await TS.open({ from: 'nord' });
    setColour('text', '#12');
    expect(panel().querySelector('.vts-hex[data-key="text"]').getAttribute('aria-invalid')).toBe('true');
    expect(TS._ed.colors.text).toBe(NORD.text);
    TS.cancel();
  });

  it('shows a contrast warning, and Fix contrast clears it', async () => {
    const { TS } = await load({ theme: 'nord' });
    await TS.open({ from: 'nord' });
    setColour('muted', '#4a4f5a');
    const box = panel().querySelector('.vts-contrast');
    expect(box.textContent).toMatch(/hard to read/);
    expect(box.querySelector('[data-check="muted"]').textContent).toMatch(/^Muted text on .*: \d\.\d\d:1$/);
    click('.vts-fix');
    await flush();
    expect(panel().querySelector('.vts-contrast').textContent).toMatch(/4\.5:1 or better/);
    expect(CustomThemes.checks(TS._ed.colors).every(c => c.ok)).toBe(true);
    expect(panel().querySelector('.vts-hex[data-key="muted"]').value).toBe(TS._ed.colors.muted);
    TS.cancel();
  });

  it('Save keeps it, wears it as a real pick and lists it in Settings', async () => {
    const { TM, TS } = await load({ theme: 'nord' });
    await TS.open({ from: 'nord' });
    const id = TS._ed.id;
    const name = panel().querySelector('.vts-name');
    name.value = 'Harbour at night';
    name.dispatchEvent(new Event('input'));
    setColour('primary', '#4cc2ff');
    click('[data-act="save"]');
    await flush(); await flush();
    const rec = TS.record(id);
    expect(rec).toMatchObject({ name: 'Harbour at night', base: 'nord' });
    expect(rec.colors.primary).toBe('#4cc2ff');
    expect(saved.theme).toBe(id);
    expect(TM.getCurrentTheme()).toBe(id);
    expect(document.querySelector(`#custom-themes-list [data-theme="${id}"] .vts-row-name`).textContent).toBe('Harbour at night — in use');
  });

  it('editing your own theme: Cancel restores its exact colours; Save as new makes a copy', async () => {
    const { TM, TS } = await load({ list: [{ id: 'user-harbour', name: 'Harbour', colors: DARK }], theme: 'user-harbour' });
    const before = styleText();
    await TS.open({ from: 'user-harbour' });
    expect(TS._ed.mode).toBe('edit');
    setColour('surface', '#333333');
    expect(styleText()).not.toBe(before);
    TS.cancel();
    expect(styleText()).toBe(before);
    expect(TS.record('user-harbour').colors).toEqual(DARK);

    await TS.open({ from: 'user-harbour' });
    setColour('surface', '#333333');
    click('[data-act="save-new"]');
    await flush(); await flush();
    const list = TS.records();
    expect(list).toHaveLength(2);
    expect(list[0].colors).toEqual(DARK);
    expect(list[1]).toMatchObject({ name: 'Harbour copy' });
    expect(list[1].colors.surface).toBe('#333333');
    expect(TM.getCurrentTheme()).toBe(list[1].id);
  });

  it('a picture chosen in the editor is stored for that theme on Save, and Remove takes it off', async () => {
    const { TS } = await load({ list: [{ id: 'user-harbour', name: 'Harbour', colors: DARK }], theme: 'user-harbour' });
    images.set('user-harbour', 'data:image/jpeg;base64,AAAA');
    await TS.open({ from: 'user-harbour' });
    expect(panel().querySelector('.vts-image-state').textContent).toMatch(/A picture/);
    click('[data-act="no-image"]');
    click('[data-act="save"]');
    await flush(); await flush();
    expect(images.has('user-harbour')).toBe(false);
  });

  it('Light and dark waits while the editor is open', async () => {
    const { TA, TS } = await load({ theme: 'nord' });
    await TS.open({ from: 'nord' });
    localStorage.setItem('vex.themeAuto', JSON.stringify({ mode: 'system', light: 'oxford', dark: 'dracula' }));
    TA._systemDark = true;
    expect(TA.evaluate()).toBeNull();
    expect(document.documentElement.getAttribute('data-theme')).toBe(TS._ed.id);
    TS.cancel();
  });

  it('Escape is Cancel', async () => {
    const { TS } = await load({ theme: 'nord' });
    await TS.open({ from: 'nord' });
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(TS.isEditing()).toBe(false);
    expect(document.documentElement.getAttribute('data-theme')).toBe('nord');
  });
});

describe('deleting', () => {
  it('asks first; the theme in use falls back to the one it came from, and its Light and dark slot and picture go too', async () => {
    const { TM, TA, TS } = await load({ list: [{ id: 'user-harbour', name: 'Harbour', colors: DARK, base: 'nord' }], theme: 'user-harbour' });
    images.set('user-harbour', 'data:image/jpeg;base64,AAAA');
    localStorage.setItem('vex.themeAuto', JSON.stringify({ mode: 'schedule', light: 'oxford', dark: 'user-harbour', from: '00:00', to: '00:01' }));
    confirmAnswer = false;
    document.querySelector('[data-theme="user-harbour"] [data-act="delete"]').click();
    await flush(); await flush();
    expect(TS.record('user-harbour')).not.toBeNull();
    confirmAnswer = true;
    document.querySelector('[data-theme="user-harbour"] [data-act="delete"]').click();
    await flush(); await flush(); await flush();
    expect(window.vexConfirm).toHaveBeenCalledTimes(2);
    expect(TS.record('user-harbour')).toBeNull();
    expect(TM.getCurrentTheme()).toBe('nord');
    expect(TM.availableThemes).not.toContain('user-harbour');
    expect(styleText()).not.toContain('user-harbour');
    expect(TA.state().dark).toBe('nord');
    expect(images.has('user-harbour')).toBe(false);
  });

  it('a light theme with no base falls back to Oxford, a dark one to Firefox Dark', async () => {
    const { TS } = await load();
    expect(TS.fallbackFor({ colors: { ...DARK, background: '#ffffff' } })).toBe('oxford');
    expect(TS.fallbackFor({ colors: DARK })).toBe('firefox-dark');
    expect(TS.fallbackFor({ colors: DARK, base: 'oxford' })).toBe('firefox-dark');
  });
});

describe('export and import', () => {
  const file = (text, name = 'harbour.vextheme') => new File([text], name, { type: 'application/json' });

  it('export writes a file that imports back to the same theme, picture included', async () => {
    const { TM, TS } = await load({ list: [{ id: 'user-harbour', name: 'Harbour', colors: DARK }], theme: 'nord' });
    images.set('user-harbour', 'data:image/png;base64,iVBORw0KGgo=');
    URL.createObjectURL = vi.fn(() => 'blob:x');
    URL.revokeObjectURL = vi.fn();
    const clicked = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function () { this.dataset.saw = this.download; });
    const text = await TS.exportTheme('user-harbour');
    expect(clicked).toHaveBeenCalled();
    clicked.mockRestore();
    expect(TS.fileName('Harbour at Night!')).toBe('harbour-at-night.vextheme');
    TS._decode = vi.fn(async () => ({}));
    const rec = await TS.importFile(file(text));
    expect(rec.name).toBe('Harbour 2');
    expect(rec.colors).toEqual(DARK);
    expect(rec.id).not.toBe('user-harbour');
    expect(images.get(rec.id)).toBe('data:image/png;base64,iVBORw0KGgo=');
    expect(TM.getCurrentTheme()).toBe(rec.id);
  });

  it('a hostile or broken file is refused and nothing is kept', async () => {
    const { TS } = await load({ theme: 'nord' });
    const bad = [
      '{"format":"vex-theme","version":1,"name":"x","colors":{"background":"#000","surface":"#111","text":"#fff","primary":"#f00"},"css":"*{display:none}"}',
      '{"format":"vex-theme","version":1,"name":"x","colors":{"background":"#000;}*{x:y","surface":"#111","text":"#fff","primary":"#f00"}}',
      'not json',
    ];
    for (const t of bad) await expect(TS.importFile(file(t))).rejects.toThrow();
    // A picture that does not decode.
    TS._decode = vi.fn(async () => { throw new Error('The picture in that theme is broken'); });
    await expect(TS.importFile(file(JSON.stringify({ format: 'vex-theme', version: 1, name: 'x', colors: DARK, image: 'data:image/png;base64,AAAA' })))).rejects.toThrow(/broken/);
    // Too big, before it is read.
    await expect(TS.importFile({ size: 3 * 1024 * 1024, text: vi.fn() })).rejects.toThrow(/too big/);
    expect(TS.records()).toEqual([]);
    expect(images.size).toBe(0);
  });

  it('a .vextheme dropped on Settings is imported', async () => {
    const { TS } = await load({ theme: 'nord' });
    const text = JSON.stringify({ format: 'vex-theme', version: 1, name: 'Dropped', colors: DARK });
    const ev = new Event('drop', { bubbles: true, cancelable: true });
    ev.dataTransfer = { types: ['Files'], files: [file(text, 'dropped.vextheme')] };
    document.getElementById('panel-settings').dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
    for (let i = 0; i < 5; i++) await flush();
    expect(TS.records().map(r => r.name)).toEqual(['Dropped']);
  });
});

describe('the old Custom Image theme', () => {
  it('becomes a theme of your own once: its picture moves, a saved "custom" becomes its id, favourites follow', async () => {
    const { TM, TS } = await load({ theme: 'custom', legacyImage: 'data:image/jpeg;base64,AAAA', migrated: false, favs: ['custom', 'nord'] });
    const list = TS.records();
    expect(list).toHaveLength(1);
    const id = list[0].id;
    expect(list[0]).toMatchObject({ name: 'Custom Image', base: 'default' });
    expect(list[0].colors).toEqual(TS.LEGACY_COLORS);
    expect(images.get(id)).toBe('data:image/jpeg;base64,AAAA');
    expect(images.has('')).toBe(false);
    expect(saved.theme).toBe(id);
    expect(TM.getCurrentTheme()).toBe(id);
    expect(localStorage.getItem('vex.customImageThemeId')).toBe(id);
    expect(TM._migrate('custom')).toBe(id);
    expect(JSON.parse(localStorage.getItem('vex.favThemes'))).toEqual([id, 'nord']);
    // Once only.
    await TS.migrateLegacy();
    expect(TS.records()).toHaveLength(1);
  });

  it('a profile that never used it gets nothing', async () => {
    const { TS } = await load({ theme: 'nord', migrated: false });
    expect(TS.records()).toEqual([]);
    expect(localStorage.getItem('vex.customThemesMigrated')).toBe('1');
  });
});

describe('sync and the rest of Vex', () => {
  it('your themes sync item by item (without pictures); the New Tab loads the shared maths', () => {
    const sync = fs.readFileSync(path.join(ROOT, 'src/renderer/js/sync-engine.js'), 'utf8');
    expect(sync).toMatch(/SYNC_KEYS = \[[\s\S]*'vex\.customThemes'/);
    expect(sync).toMatch(/LIST_PREFERENCES = \[[^\]]*'vex\.customThemes'/);
    const start = fs.readFileSync(path.join(ROOT, 'src/renderer/start.html'), 'utf8');
    expect(start.indexOf('<script src="js/theme-custom.js"></script>')).toBeGreaterThan(-1);
    expect(start.indexOf('<script src="js/theme-custom.js"></script>')).toBeLessThan(start.indexOf('function applyStartTheme('));
    expect(start).not.toMatch(/\[data-theme="custom"\]/);
    const index = fs.readFileSync(path.join(ROOT, 'src/renderer/index.html'), 'utf8');
    expect(index.indexOf('<script src="js/theme-custom.js">')).toBeLessThan(index.indexOf('<script src="js/theme-manager.js">'));
    expect(index.indexOf('<script src="js/theme-studio.js">')).toBeGreaterThan(index.indexOf('<script src="js/theme-manager.js">'));
  });

  it('a theme made on another device appears when sync brings it', async () => {
    const { TM } = await load({ theme: 'nord' });
    localStorage.setItem('vex.customThemes', JSON.stringify([{ id: 'user-fromphone', name: 'From phone', colors: DARK }]));
    window.dispatchEvent(new CustomEvent('vex-sync-data-applied'));
    expect(TM.availableThemes).toContain('user-fromphone');
    expect(document.querySelector('[data-theme="user-fromphone"]')).not.toBeNull();
  });
});

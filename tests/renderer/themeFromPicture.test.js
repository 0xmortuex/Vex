// @vitest-environment jsdom
//
// Item #3: a theme from a picture in the theme editor (js/theme-studio.js +
// js/theme-from-image.js). jsdom decodes no pictures, so reading one is given
// the pixels and the picture handling is stood in for; what is held here is
// the contract: the palettes offered, what the window wears, what is saved,
// what the New Tab is handed, what is said when it cannot be done.
import { describe, it, expect, afterEach, vi } from 'vitest';

const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..', '..');
const NORD = { background: '#2e3440', surface: '#3b4252', text: '#eceff4', muted: '#d8dee9', primary: '#88c0d0', success: '#a3be8c', warning: '#ebcb8b', danger: '#bf616a', border: '#4c566a' };

function picture(fn, w = 64, h = 36) {
  const a = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const [r, g, b] = fn(x / w, y / h);
    const p = (y * w + x) * 4;
    a[p] = r; a[p + 1] = g; a[p + 2] = b; a[p + 3] = 255;
  }
  return a;
}
const DARK = picture((x, y) => (Math.hypot(x - 0.7, y - 0.3) < 0.1 ? [255, 160, 70] : [10 + 15 * y, 22 + 25 * y, 45 + 35 * y]));
const PNG_HEAD = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0, 0, 0, 0, 0];
const file = (name, bytes = PNG_HEAD, type = 'image/png') => ({ name, size: 5000, type, slice: () => ({ arrayBuffer: async () => Uint8Array.from(bytes).buffer }) });

let images, saved;
async function load() {
  vi.resetModules();
  localStorage.clear();
  document.head.innerHTML = '';
  document.body.innerHTML = '<div id="panel-settings"><button id="setting-theme-make"></button><button id="setting-theme-from-picture"></button><button id="setting-theme-import"></button><div id="custom-themes-list"></div>'
    + '<select id="setting-theme-auto-mode"><option value="off">Off</option><option value="system">System</option></select>'
    + '<select id="setting-theme-light"></select><select id="setting-theme-dark"></select><input id="setting-theme-dark-from"><input id="setting-theme-dark-to"></div>';
  localStorage.setItem('vex.customThemesMigrated', '1');
  images = new Map();
  saved = { theme: 'nord' };
  globalThis.VexStorage = { load: vi.fn(async (k) => saved[k]), save: vi.fn(async (k, v) => { saved[k] = v; }) };
  globalThis.VexIcons = { svg: (n) => `<svg data-icon="${n}"></svg>` };
  window.showToast = vi.fn();
  window.vexConfirm = vi.fn(async () => true);
  window.vex = {
    getCustomThemeImage: vi.fn(async (id) => images.get(id || '') ?? null),
    setCustomThemeImage: vi.fn(async (img, id) => { if (img) images.set(id || '', img); else images.delete(id || ''); return { ok: true }; }),
    getSystemDark: vi.fn(async () => ({ dark: true })),
    readWallpaper: vi.fn(async () => ({ ok: false, reason: 'solid', message: 'Your desktop background is a solid colour, not a picture. Choose a picture instead.' })),
  };
  globalThis.VexJobs = { every: vi.fn(), stop: vi.fn() };
  await import('../../src/renderer/js/theme-custom.js');
  const FI = (await import('../../src/renderer/js/theme-from-image.js')).ThemeFromImage;
  globalThis.ThemeFromImage = FI;
  // What the window does with a real picture, stood in for.
  FI.sample = vi.fn(async () => FI.summarize(DARK));
  FI.bake = vi.fn(async (raw, colors) => `data:image/jpeg;base64,BAKED${colors.background.slice(1)}`);
  const TM = (await import('../../src/renderer/js/theme-manager.js')).ThemeManager;
  globalThis.ThemeManager = TM;
  const TA = (await import('../../src/renderer/js/theme-auto.js')).ThemeAuto;
  globalThis.ThemeAuto = TA;
  const TS = (await import('../../src/renderer/js/theme-studio.js')).ThemeStudio;
  globalThis.ThemeStudio = TS;
  TS.colorsFromTheme = vi.fn((id) => (TS.record(id) ? { ...TS.record(id).colors } : { ...NORD }));
  TS._fitImage = vi.fn(async () => 'data:image/jpeg;base64,RAW');
  TS.wireSettings();
  await TM.init();
  return { TM, TS, FI };
}
const panel = () => document.querySelector('.vts-panel');
const flush = () => new Promise(r => setTimeout(r, 0));

afterEach(() => { globalThis.ThemeAuto?.stop?.(); });

describe('a theme from a picture in the editor', () => {
  it('offers Calm, Vivid and Light, wears Calm, names it after the file and shows the picture on the New Tab', async () => {
    const { TM, TS, FI } = await load();
    await TS.open({ from: 'nord' });
    expect(panel().querySelector('.vts-fp-options').hidden).toBe(true);
    await TS.usePicture(file('night-lake.png'), { name: FI.nameFor('night-lake.png') });
    const opts = [...panel().querySelectorAll('.vts-fp-opt')];
    expect(opts.map(b => b.textContent)).toEqual(['Calm', 'Vivid', 'Light']);
    expect(opts.map(b => b.getAttribute('aria-checked'))).toEqual(['true', 'false', 'false']);
    expect(panel().querySelector('.vts-fp-options').getAttribute('role')).toBe('radiogroup');
    const calm = TS._ed.fromPicture.options[0].colors;
    expect(TS._ed.colors).toEqual(calm);
    expect(panel().querySelector('.vts-hex[data-key="background"]').value).toBe(calm.background);
    expect(panel().querySelector('.vts-name').value).toBe('Night lake');
    expect(TS.previewOf(TS._ed.id).image).toBe('data:image/jpeg;base64,BAKED' + calm.background.slice(1));
    expect(FI.bake).toHaveBeenCalledWith('data:image/jpeg;base64,RAW', calm, expect.objectContaining({ n: 64 * 36 }));
    expect(panel().querySelector('.vts-contrast-head').className).toContain('ok');
    expect(TM.getCurrentTheme()).toBe(TS._ed.id);
  });

  it('a click on another palette wears it and tones the picture for it; Save keeps both', async () => {
    const { TM, TS } = await load();
    await TS.open({ from: 'nord' });
    await TS.usePicture(file('lake.png'), { name: 'Lake' });
    panel().querySelector('.vts-fp-opt[data-palette="flip"]').click();
    await flush(); await flush();
    const light = TS._ed.fromPicture.options[2].colors;
    expect(TS._ed.colors).toEqual(light);
    expect(panel().querySelector('.vts-fp-opt[data-palette="flip"]').getAttribute('aria-checked')).toBe('true');
    const id = TS._ed.id;
    const rec = await TS.save({ asNew: false });
    expect(rec).toMatchObject({ id, name: 'Lake', colors: light });
    expect(images.get(id)).toBe('data:image/jpeg;base64,BAKED' + light.background.slice(1));
    expect(TM.getCurrentTheme()).toBe(id);
    expect(JSON.parse(localStorage.getItem('vex.customThemes'))[0].colors).toEqual(light);
  });

  it('a colour changed by hand after the palette: the picture is toned again for it on Save', async () => {
    const { TS, FI } = await load();
    await TS.open({ from: 'nord' });
    await TS.usePicture(file('lake.png'), { name: 'Lake' });
    const hex = panel().querySelector('.vts-hex[data-key="background"]');
    hex.value = '#202830';
    hex.dispatchEvent(new Event('input', { bubbles: true }));
    const id = TS._ed.id;
    await TS.save({ asNew: false });
    expect(FI.bake).toHaveBeenLastCalledWith('data:image/jpeg;base64,RAW', expect.objectContaining({ background: '#202830' }), expect.anything());
    expect(images.get(id)).toBe('data:image/jpeg;base64,BAKED202830');
  });

  it('a name you typed is kept', async () => {
    const { TS } = await load();
    await TS.open({ from: 'nord' });
    const name = panel().querySelector('.vts-name');
    name.value = 'Mine';
    name.dispatchEvent(new Event('input', { bubbles: true }));
    await TS.usePicture(file('lake.png'), { name: 'Lake' });
    expect(name.value).toBe('Mine');
  });

  it('editing a theme of your own: a picture changes its colours but not its name (found live)', async () => {
    const { TS } = await load();
    localStorage.setItem('vex.customThemes', JSON.stringify([{ id: 'user-harbour', name: 'Harbour', colors: NORD }]));
    TS.register();
    await TS.open({ from: 'user-harbour' });
    expect(TS._ed.mode).toBe('edit');
    await TS.usePicture(file('lake.png'), { name: 'Lake' });
    expect(panel().querySelector('.vts-name').value).toBe('Harbour');
    expect(TS._ed.colors).toEqual(TS._ed.fromPicture.options[0].colors);
  });

  it('a file that is not a PNG, JPEG or WebP is refused, said in the editor, and changes nothing', async () => {
    const { TS } = await load();
    await TS.open({ from: 'nord' });
    const before = { ...TS._ed.colors };
    await expect(TS.usePicture(file('x.gif', [0x47, 0x49, 0x46, 0x38, 0, 0, 0, 0, 0, 0, 0, 0], 'image/gif'))).rejects.toThrow('PNG, JPEG and WebP');
    expect(TS._ed.colors).toEqual(before);
    expect(panel().querySelector('.vts-fp-status').textContent).toBe('Vex makes themes from PNG, JPEG and WebP pictures');
    expect(panel().querySelector('.vts-fp-status').classList.contains('bad')).toBe(true);
    expect(panel().querySelector('[data-act="from-picture"]').disabled).toBe(false);
  });

  it('a newer picture wins over a slower one', async () => {
    const { TS, FI } = await load();
    await TS.open({ from: 'nord' });
    let release;
    FI.sample.mockImplementationOnce(() => new Promise(r => { release = () => r(FI.summarize(picture(() => [250, 240, 230]))); }));
    const slow = TS.usePicture(file('first.png'), { name: 'First' });
    await flush();
    await TS.usePicture(file('second.png'), { name: 'Second' });
    release();
    await slow;
    expect(panel().querySelector('.vts-name').value).toBe('Second');
    expect(TS._ed.fromPicture.options[0].light).toBe(false);
  });

  it('Use my Windows wallpaper: a solid colour is said plainly', async () => {
    const { TS } = await load();
    await TS.open({ from: 'nord' });
    panel().querySelector('[data-act="from-wallpaper"]').click();
    await flush(); await flush();
    expect(window.vex.readWallpaper).toHaveBeenCalledTimes(1);
    expect(panel().querySelector('.vts-fp-status').textContent).toMatch(/solid colour, not a picture/);
    // Said once, in the editor — not again as a toast over the page.
    expect(window.showToast).not.toHaveBeenCalledWith(expect.stringMatching(/solid colour/), 'error');
    expect(TS._ed.fromPicture).toBeUndefined();
  });

  it('Use my Windows wallpaper: the picture, named "My wallpaper", with the slideshow note', async () => {
    const { TS } = await load();
    await TS.open({ from: 'nord' });
    window.vex.readWallpaper.mockResolvedValueOnce({ ok: true, dataUrl: 'data:image/bmp;base64,Qk0AAAAAAAAAAAAAAAAA', note: 'Your wallpaper is a slideshow, so Vex used the picture showing now.' });
    await TS.useWallpaper();
    expect(panel().querySelector('.vts-name').value).toBe('My wallpaper');
    expect(panel().querySelector('.vts-fp-status').textContent).toMatch(/slideshow/);
    expect(TS._ed.fromPicture.options).toHaveLength(3);
  });

  it('Cancel puts the theme back, picture and all', async () => {
    const { TM, TS } = await load();
    await TS.open({ from: 'nord' });
    await TS.usePicture(file('lake.png'), { name: 'Lake' });
    TS.cancel();
    expect(TM.getCurrentTheme()).toBe('nord');
    expect(localStorage.getItem('vex.customThemes')).toBe(null);
    expect(images.size).toBe(0);
  });
});

describe('ways in', () => {
  it('Settings › From a picture… opens the editor and the picture chooser (PNG, JPEG, WebP)', async () => {
    const { TS } = await load();
    const clicked = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(function () { this.dataset.clicked = '1'; });
    document.getElementById('setting-theme-from-picture').click();
    await flush(); await flush();
    expect(panel()).toBeTruthy();
    const input = document.querySelector('input[type="file"][data-clicked]');
    expect(input.accept).toBe('image/png,image/jpeg,image/webp');
    clicked.mockRestore();
    expect(TS.isEditing()).toBe(true);
  });

  it('From a picture while wearing a theme of your own makes a new theme; yours is untouched (found live)', async () => {
    const { TM, TS } = await load();
    const mine = { id: 'user-harbour', name: 'Harbour', colors: NORD };
    localStorage.setItem('vex.customThemes', JSON.stringify([mine]));
    TS.register();
    TM.applyTheme('user-harbour');
    await TS.openFromPicture(file('lake.png'));
    expect(TS._ed.mode).toBe('new');
    expect(TS._ed.id).not.toBe('user-harbour');
    const rec = await TS.save({ asNew: false });
    const list = JSON.parse(localStorage.getItem('vex.customThemes'));
    expect(list.map(r => r.name)).toEqual(['Harbour', 'Lake']);
    expect(list[0].colors).toEqual(NORD);
    expect(TM.getCurrentTheme()).toBe(rec.id);
  });

  it('a picture dropped on Settings opens the editor with it', async () => {
    const { TS } = await load();
    const ev = new Event('drop', { bubbles: true, cancelable: true });
    ev.dataTransfer = { types: ['Files'], files: [file('beach.jpg', [0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0], 'image/jpeg')] };
    document.getElementById('panel-settings').dispatchEvent(ev);
    for (let i = 0; i < 6; i++) await flush();
    expect(TS.isEditing()).toBe(true);
    expect(panel().querySelector('.vts-name').value).toBe('Beach');
    expect(TS._ed.fromPicture.options).toHaveLength(3);
  });

  it('a picture dropped on the editor', async () => {
    const { TS } = await load();
    await TS.open({ from: 'nord' });
    const ev = new Event('drop', { bubbles: true, cancelable: true });
    ev.dataTransfer = { types: ['Files'], files: [file('sunset.webp', [0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50], 'image/webp')] };
    panel().dispatchEvent(ev);
    for (let i = 0; i < 6; i++) await flush();
    expect(ev.defaultPrevented).toBe(true);
    expect(panel().querySelector('.vts-name').value).toBe('Sunset');
  });

  it('the page loads the module before the editor, and the picker has a From a picture card', () => {
    const index = fs.readFileSync(path.join(ROOT, 'src/renderer/index.html'), 'utf8');
    const at = (f) => index.indexOf(`<script src="js/${f}"></script>`);
    expect(at('theme-from-image.js')).toBeGreaterThan(at('theme-custom.js'));
    expect(at('theme-custom.js')).toBeGreaterThan(-1);
    expect(at('theme-from-image.js')).toBeLessThan(at('theme-studio.js'));
    expect(index).toContain('id="setting-theme-from-picture"');
    expect(fs.readFileSync(path.join(ROOT, 'src/renderer/js/theme-picker.js'), 'utf8')).toContain("card.dataset.theme = 'from-picture'");
  });
});

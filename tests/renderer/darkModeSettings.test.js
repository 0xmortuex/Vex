// @vitest-environment jsdom
//
// Dark mode for websites, the window's side (js/dark-mode.js): the Settings rows, the page menu's per-site
// toggle in each mode, what a tab is handed, the backdrop behind a dark page, the Preview and the entry
// points webview.js keeps for the page menu, the site panel and the site reset.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(__dirname, '../..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

let D, applied, wv, toasts;
async function load() {
  vi.resetModules();
  localStorage.clear();
  document.body.innerHTML = '<div id="dark-mode-websites-setting"></div>';
  applied = [];
  toasts = [];
  wv = { _url: 'https://www.example.com/page', getURL() { return this._url; }, getWebContentsId: () => 7, style: { background: '' }, dataset: {} };
  window.vex = {
    darkModeApply: vi.fn(async (id, raw, opts) => {
      const d = require('../../src/renderer/js/dark-mode.js').VexDarkMode.decide(raw, wv._url, opts || {});
      d.base = d.on ? '#1a1d1e' : '';
      applied.push({ id, opts, on: d.on, reason: d.reason });
      return d;
    }),
    darkModeStatus: vi.fn(async () => ({ darkReader: false })),
  };
  window.showToast = (m, kind) => toasts.push([m, kind]);
  globalThis.WebviewManager = { webviews: new Map([['t1', wv]]), getActiveWebview: () => wv };
  const mod = await import('../../src/renderer/js/dark-mode.js');
  D = mod.VexDarkMode;
  window.VexDarkMode = D;
}

describe('the page menu toggle', () => {
  beforeEach(load);

  it('per site: adds the site, then takes it off, and the tab is handed the answer each time', async () => {
    expect(D.toggleSite(wv)).toBe(true);
    expect(JSON.parse(localStorage.getItem('vex.forceDarkHosts'))).toEqual(['example.com']);
    expect(toasts[0][0]).toBe('Dark mode on — example.com');
    await Promise.resolve(); await Promise.resolve();
    expect(applied.at(-1)).toMatchObject({ id: 7, on: true });
    expect(wv.style.background).toBe('#1a1d1e');
    expect(wv._forceDarkKey).toBe('smart');
    expect(D.toggleSite(wv)).toBe(false);
    expect(JSON.parse(localStorage.getItem('vex.forceDarkHosts'))).toEqual([]);
    expect(toasts[1][0]).toBe('Dark mode off — example.com');
    await Promise.resolve(); await Promise.resolve();
    expect(applied.at(-1)).toMatchObject({ on: false });
    expect(wv.style.background).toBe('');
    expect(wv._forceDarkKey).toBeNull();
  });

  it('with the mode off, asking for dark mode on a site turns the per-site mode on for it', () => {
    localStorage.setItem('vex.darkMode.mode', 'off');
    expect(D.toggleSite(wv)).toBe(true);
    expect(localStorage.getItem('vex.darkMode.mode')).toBe('site');
    expect(JSON.parse(localStorage.getItem('vex.forceDarkHosts'))).toEqual(['example.com']);
  });

  it('in All sites mode the toggle keeps the site out, and puts it back', () => {
    localStorage.setItem('vex.darkMode.mode', 'all');
    expect(D.isOnFor(wv.getURL())).toBe(true);
    expect(D.toggleSite(wv)).toBe(false);
    expect(JSON.parse(localStorage.getItem('vex.darkMode.neverHosts'))).toEqual(['example.com']);
    expect(D.isOnFor(wv.getURL())).toBe(false);
    expect(D.toggleSite(wv)).toBe(true);
    expect(JSON.parse(localStorage.getItem('vex.darkMode.neverHosts'))).toEqual([]);
  });

  it('a page that is not a website says so instead of changing a list', () => {
    wv._url = 'file:///C:/vex/start.html';
    expect(D.toggleSite(wv)).toBe(false);
    expect(toasts[0][0]).toBe('Open a page first');
    expect(localStorage.getItem('vex.forceDarkHosts')).toBeNull();
  });

  it('a tab that is not attached yet is skipped without an error: its own load asks main', async () => {
    wv.getWebContentsId = () => { throw new Error('The WebView must be attached'); };
    await expect(D.pushTo(wv)).resolves.toBeNull();
    expect(window.vex.darkModeApply).not.toHaveBeenCalled();
  });
});

describe('the backdrop and the entry points', () => {
  beforeEach(load);

  it('a navigation to a listed site paints dark behind it, one to another site gives the old backdrop back', () => {
    localStorage.setItem('vex.forceDarkHosts', JSON.stringify(['example.com']));
    wv.style.background = 'var(--vex-bg-base)';
    D.onNavigate(wv, 'https://example.com/a');
    expect(wv.style.background).toBe('#1a1d1e');
    D.onNavigate(wv, 'https://other.org/');
    expect(wv.style.background).toBe('var(--vex-bg-base)');
    expect(wv.dataset.vexDmBg).toBeUndefined();
  });

  it('webview.js keeps its entry points and hands them to the window module', () => {
    const src = read('src/renderer/js/webview.js');
    for (const name of ['_shouldForceDark(url)', '_applyForceDark(wv)', '_removeForceDark(wv)', 'toggleForceDarkForSite(webview)', '_forceDarkHosts()']) expect(src, name).toContain(name);
    expect(src).not.toContain('DARK_CSS');
    expect(src).toContain('VexDarkMode.onNavigate(webview, event.url)');
  });

  it('the late module is listed, not a new blocking script; the settings placeholder is in the page', () => {
    expect(read('src/renderer/js/lazy-boot.js')).toContain("{ src: 'js/dark-mode.js', usage: [] }");
    const html = read('src/renderer/index.html');
    expect(html).toContain('id="dark-mode-websites-setting"');
    expect(html).not.toMatch(/<script src="js\/dark-mode\.js"/);
  });

  it('Reset to Defaults clears how it is done and leaves the person’s site lists alone', () => {
    const app = read('src/renderer/js/app.js');
    for (const k of ['vex.darkMode.mode', 'vex.darkMode.engine', 'vex.darkMode.look', 'vex.darkMode.keepImages', 'vex.darkMode.readerDefer']) expect(app).toContain("'" + k + "'");
    const list = /SETTINGS_PREF_KEYS = \[([\s\S]*?)\n  \];/.exec(app)[1].replace(/\/\/.*$/gm, '');
    expect(list).not.toContain('vex.darkMode.neverHosts');
    expect(list).not.toContain('vex.forceDarkHosts');
  });
});

describe('the Settings rows', () => {
  beforeEach(load);
  const host = () => document.getElementById('dark-mode-websites-setting');

  it('per site (the default) shows the engine, the look, images, Dark Reader, the site list and Preview', () => {
    D.renderSettings(host());
    for (const id of ['setting-dark-mode', 'setting-dark-engine', 'setting-dark-brightness', 'setting-dark-contrast', 'setting-dark-sepia', 'setting-dark-images', 'setting-dark-reader', 'dark-preview', 'dark-hosts']) expect(document.getElementById(id), id).toBeTruthy();
    expect(document.getElementById('dark-never')).toBeNull();
    expect(document.getElementById('setting-dark-mode').value).toBe('site');
    expect(document.getElementById('setting-dark-images').checked).toBe(true);
  });

  it('Off shows only the choice; All sites shows the exceptions list', () => {
    localStorage.setItem('vex.darkMode.mode', 'off');
    D.renderSettings(host());
    expect(document.getElementById('setting-dark-engine')).toBeNull();
    localStorage.setItem('vex.darkMode.mode', 'all');
    D.renderSettings(host());
    expect(document.getElementById('dark-never')).toBeTruthy();
    expect(document.getElementById('dark-hosts')).toBeNull();
  });

  it('choosing a mode saves it, hands the open tabs the answer and redraws the rows', async () => {
    D.renderSettings(host());
    const sel = document.getElementById('setting-dark-mode');
    sel.value = 'all';
    sel.dispatchEvent(new Event('change'));
    expect(localStorage.getItem('vex.darkMode.mode')).toBe('all');
    await Promise.resolve(); await Promise.resolve();
    expect(applied.length).toBeGreaterThan(0);
    expect(document.getElementById('dark-never')).toBeTruthy();
  });

  it('the look sliders and the switches save what they say', () => {
    D.renderSettings(host());
    const b = document.getElementById('setting-dark-brightness');
    b.value = '80'; b.dispatchEvent(new Event('input'));
    expect(JSON.parse(localStorage.getItem('vex.darkMode.look'))).toMatchObject({ brightness: 80, contrast: 100, sepia: 0 });
    const img = document.getElementById('setting-dark-images');
    img.checked = false; img.dispatchEvent(new Event('change'));
    expect(localStorage.getItem('vex.darkMode.keepImages')).toBe('false');
    img.checked = true; img.dispatchEvent(new Event('change'));
    expect(localStorage.getItem('vex.darkMode.keepImages')).toBeNull();
    const dr = document.getElementById('setting-dark-reader');
    dr.checked = false; dr.dispatchEvent(new Event('change'));
    expect(localStorage.getItem('vex.darkMode.readerDefer')).toBe('false');
  });

  it('says whether Dark Reader is there, from main', async () => {
    window.vex.darkModeStatus = vi.fn(async () => ({ darkReader: true }));
    D.renderSettings(host());
    await Promise.resolve(); await Promise.resolve();
    expect(document.getElementById('dark-reader-status').textContent).toBe('Dark Reader is installed and on.');
  });

  it('adds a site from the box (an address or a bare host) and removes it again', () => {
    D.renderSettings(host());
    const input = document.querySelector('#dark-hosts input');
    input.value = 'https://www.news.example.org/a/b';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(JSON.parse(localStorage.getItem('vex.forceDarkHosts'))).toEqual(['news.example.org']);
    expect(document.querySelector('#dark-hosts .site-settings-host').textContent).toBe('news.example.org');
    input.value = 'nonsense with spaces';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(toasts.at(-1)).toEqual(['That is not a site address', 'error']);
    document.querySelector('#dark-hosts button[aria-label="Remove news.example.org"]').click();
    expect(JSON.parse(localStorage.getItem('vex.forceDarkHosts'))).toEqual([]);
  });

  it('Preview shows the page in front on whatever the lists say, and stops', async () => {
    D.renderSettings(host());
    expect(D.startPreview()).toBe(true);
    await Promise.resolve(); await Promise.resolve();
    expect(applied.at(-1)).toMatchObject({ opts: { force: true }, on: true, reason: 'preview' });
    D.stopPreview();
    await Promise.resolve(); await Promise.resolve();
    expect(applied.at(-1).on).toBe(false);
    wv._url = 'file:///x.html';
    expect(D.startPreview()).toBe(false);
  });
});

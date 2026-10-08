// @vitest-environment jsdom
//
// Light and dark (src/renderer/js/theme-auto.js): a light theme and a dark
// theme, worn by Windows' app mode, by fixed hours, or from sunset to sunrise.
// The pure parts (schedule, sun times, light/dark classification) are checked
// directly; the wiring (ThemeManager, a manual pick filling the slot, the
// browser look's light/dark version, Settings) against stand-ins.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(__dirname, '..', '..');

async function load() {
  vi.resetModules();
  const tm = await import('../../src/renderer/js/theme-manager.js');
  globalThis.ThemeManager = tm.ThemeManager;
  const ta = await import('../../src/renderer/js/theme-auto.js');
  globalThis.ThemeAuto = ta.ThemeAuto;
  return { TM: tm.ThemeManager, TA: ta.ThemeAuto };
}

beforeEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute('data-theme');
  globalThis.VexStorage = { load: vi.fn(async () => undefined), save: vi.fn(async () => {}) };
  globalThis.VexJobs = { every: vi.fn() };
  window.showToast = vi.fn();
  delete window.VexGuiStyle;
  delete window.vex;
});
afterEach(() => {
  globalThis.ThemeAuto?.stop();
  delete globalThis.ThemeAuto;
  delete globalThis.ThemeManager;
  delete globalThis.WebviewManager;
});

describe('fixed hours', () => {
  it('reads HH:MM and refuses anything else', async () => {
    const { TA } = await load();
    expect(TA.parseHM('19:00')).toBe(1140);
    expect(TA.parseHM('7:05')).toBe(425);
    expect(TA.parseHM('24:00')).toBeNull();
    expect(TA.parseHM('12:60')).toBeNull();
    expect(TA.parseHM('')).toBeNull();
  });

  it('is dark across midnight for 19:00-07:00, and inside a same-day span', async () => {
    const { TA } = await load();
    const f = 19 * 60, t = 7 * 60;
    expect(TA.isDarkBySchedule(18 * 60 + 59, f, t)).toBe(false);
    expect(TA.isDarkBySchedule(19 * 60, f, t)).toBe(true);
    expect(TA.isDarkBySchedule(0, f, t)).toBe(true);
    expect(TA.isDarkBySchedule(6 * 60 + 59, f, t)).toBe(true);
    expect(TA.isDarkBySchedule(7 * 60, f, t)).toBe(false);
    // 13:00-15:00 (a same-day span)
    expect(TA.isDarkBySchedule(14 * 60, 780, 900)).toBe(true);
    expect(TA.isDarkBySchedule(16 * 60, 780, 900)).toBe(false);
    // the same start and end is never dark
    expect(TA.isDarkBySchedule(600, 600, 600)).toBe(false);
  });

  it('says when the next switch is', async () => {
    const { TA } = await load();
    const st = { mode: 'schedule', from: '19:00', to: '07:00' };
    const noon = new Date(2026, 9, 8, 12, 0);
    expect(TA.nextChange(st, noon)).toEqual(new Date(2026, 9, 8, 19, 0));
    const night = new Date(2026, 9, 8, 23, 30);
    expect(TA.nextChange(st, night)).toEqual(new Date(2026, 9, 9, 7, 0));
  });
});

describe('sunset to sunrise', () => {
  it('gives Istanbul\'s sunrise and sunset on the longest day within a few minutes', async () => {
    const { TA } = await load();
    // Midday UTC is 21 June on every inhabited clock.
    const t = TA.sunTimes(new Date(Date.UTC(2026, 5, 21, 12)), 41.0082, 28.9784);
    // timeanddate.com: 05:32 and 20:39 local (UTC+3).
    expect(Math.abs(t.sunrise - Date.UTC(2026, 5, 21, 2, 32))).toBeLessThan(4 * 60000);
    expect(Math.abs(t.sunset - Date.UTC(2026, 5, 21, 17, 39))).toBeLessThan(4 * 60000);
  });

  it('knows the polar day and the polar night', async () => {
    const { TA } = await load();
    expect(TA.sunTimes(new Date(Date.UTC(2026, 5, 21, 12)), 78.2, 15.6)).toEqual({ polar: 'day' });
    expect(TA.sunTimes(new Date(Date.UTC(2026, 11, 21, 12)), 78.2, 15.6)).toEqual({ polar: 'night' });
    expect(TA.isDarkBySun(new Date(Date.UTC(2026, 11, 21, 12)), { lat: 78.2, lon: 15.6 })).toBe(true);
  });

  it('is dark before sunrise and after sunset', async () => {
    const { TA } = await load();
    const c = { lat: 41.0082, lon: 28.9784 };
    const t = TA.sunTimes(new Date(Date.UTC(2026, 5, 21, 12)), c.lat, c.lon);
    expect(TA.isDarkBySun(new Date(t.sunrise.getTime() - 60000), c)).toBe(true);
    expect(TA.isDarkBySun(new Date(t.sunrise.getTime() + 60000), c)).toBe(false);
    expect(TA.isDarkBySun(new Date(t.sunset.getTime() + 60000), c)).toBe(true);
  });

  it('takes its location from Settings, never from an IP guess', async () => {
    const { TA } = await load();
    expect(TA.coords()).toBeNull();
    localStorage.setItem('vex.weatherLoc', JSON.stringify({ lat: 1, lon: 2, city: 'Guess', approx: true }));
    expect(TA.coords()).toBeNull();
    localStorage.setItem('vex.weatherLoc', JSON.stringify({ lat: 39.93, lon: 32.85, city: 'Ankara' }));
    expect(TA.coords()).toMatchObject({ lat: 39.93, lon: 32.85, label: 'Ankara' });
    localStorage.setItem('vex.manualLocation', JSON.stringify({ latitude: 41.0082, longitude: 28.9784, label: 'Istanbul' }));
    expect(TA.coords()).toMatchObject({ lat: 41.0082, lon: 28.9784, label: 'Istanbul' });
  });

  it('cannot say light or dark for sun mode without a location', async () => {
    const { TA } = await load();
    expect(TA.resolveDark({ mode: 'sun' }, { now: new Date(), coords: null })).toBeNull();
  });
});

describe('light and dark themes', () => {
  // Every theme's page colour, from the stylesheets the window really uses.
  function cssBackgrounds() {
    const css = ['theme-tokens.css', 'theme-extra.css'].map(f => readFileSync(resolve(ROOT, 'src/renderer/css', f), 'utf8')).join('\n');
    const out = new Map();
    for (const m of css.matchAll(/\[data-theme="([\w-]+)"\]\s*\{([^}]*)\}/g)) {
      const bg = /--vex-bg-base:\s*(#[0-9a-fA-F]{6})\s*;/.exec(m[2]);
      if (bg) out.set(m[1], bg[1]);
    }
    return out;
  }

  it('sorts every theme by its real page colour', async () => {
    const { TA, TM } = await load();
    const bgs = cssBackgrounds();
    const wrong = [];
    for (const t of TM.THEMES) {
      if (t.upload || !bgs.has(t.id)) continue;
      const light = TA._luminance(bgs.get(t.id)) > 0.4;
      if (light !== TA.isLightTheme(t)) wrong.push(`${t.id} (${bgs.get(t.id)})`);
    }
    expect(wrong).toEqual([]);
    expect(TM.THEMES.filter(t => TA.isLightTheme(t)).map(t => t.id))
      .toEqual(expect.arrayContaining(['oxford', 'firefox-light', 'paperred']));
  });

  it('starts from the theme in use and its partner', async () => {
    const { TA, TM } = await load();
    expect(TA.defaultSlots('firefox-light', TM.THEMES)).toEqual({ light: 'firefox-light', dark: 'firefox-dark' });
    expect(TA.defaultSlots('firefox-dark', TM.THEMES)).toEqual({ light: 'firefox-light', dark: 'firefox-dark' });
    expect(TA.defaultSlots('oxford', TM.THEMES)).toEqual({ light: 'oxford', dark: 'firefox-dark' });
    expect(TA.defaultSlots('dracula', TM.THEMES)).toEqual({ light: 'oxford', dark: 'dracula' });
  });
});

describe('switching', () => {
  function stubSystem(dark) {
    const listeners = [];
    window.vex = {
      getSystemDark: vi.fn(async () => ({ dark })),
      onSystemThemeChanged: vi.fn(cb => { listeners.push(cb); return () => {}; }),
    };
    return (d) => listeners.forEach(cb => cb({ dark: d }));
  }

  it('follows Windows: the first paint already wears the dark theme, and it changes when Windows does', async () => {
    const emit = stubSystem(true);
    localStorage.setItem('vex.themeAuto', JSON.stringify({ mode: 'system', light: 'oxford', dark: 'dracula' }));
    const { TM } = await load();
    const seen = [];
    document.addEventListener('theme-changed', e => seen.push(e.detail));
    await TM.init();
    await new Promise(r => setTimeout(r, 0));
    expect(document.documentElement.getAttribute('data-theme')).toBe('dracula');
    expect(seen[0]).toEqual({ theme: 'dracula', userChoice: false });   // boot restore
    emit(false);
    expect(TM.getCurrentTheme()).toBe('oxford');
    expect(seen.at(-1)).toEqual({ theme: 'oxford', userChoice: false, auto: true });
    expect(VexJobs.every).toHaveBeenCalledWith('Light and dark', expect.any(Number), expect.any(Function));
  });

  it('keeps the saved theme when it is off', async () => {
    stubSystem(true);
    globalThis.VexStorage.load = vi.fn(async () => 'nord');
    const { TM } = await load();
    await TM.init();
    expect(TM.getCurrentTheme()).toBe('nord');
  });

  it('runs by the clock on a schedule', async () => {
    stubSystem(false);
    localStorage.setItem('vex.themeAuto', JSON.stringify({ mode: 'schedule', light: 'firefox-light', dark: 'firefox-dark', from: '19:00', to: '07:00' }));
    const { TM, TA } = await load();
    TA._clock = () => new Date(2026, 9, 8, 18, 59);
    await TM.init();
    await new Promise(r => setTimeout(r, 0));
    expect(TM.getCurrentTheme()).toBe('firefox-light');
    TA._clock = () => new Date(2026, 9, 8, 19, 0);
    const tick = VexJobs.every.mock.calls[0][2];
    tick();
    expect(TM.getCurrentTheme()).toBe('firefox-dark');
  });

  it('a theme picked by hand becomes the slot for now, and says so', async () => {
    stubSystem(true);
    localStorage.setItem('vex.themeAuto', JSON.stringify({ mode: 'system', light: 'oxford', dark: 'dracula' }));
    const { TM, TA } = await load();
    await TM.init();
    await new Promise(r => setTimeout(r, 0));
    TM.applyTheme('nord');   // a pick: userChoice
    expect(TA.state()).toMatchObject({ light: 'oxford', dark: 'nord' });
    expect(window.showToast).toHaveBeenCalledWith(expect.stringContaining('Nord is now your dark theme'), 'info', 4500);
    // and the next evaluation keeps it rather than putting Dracula back
    TA.evaluate();
    expect(TM.getCurrentTheme()).toBe('nord');
    expect(TA.slotOf('nord')).toBe('dark');
    expect(TA.pickerNote()).toContain('becomes your dark theme');
  });

  it('switches a browser look to its light or dark version with the theme', async () => {
    const emit = stubSystem(false);
    let style = 'firefox';
    window.VexGuiStyle = { get: () => style, set: vi.fn(async s => { style = s; }) };
    localStorage.setItem('vex.themeAuto', JSON.stringify({ mode: 'system', light: 'firefox-light', dark: 'firefox-dark' }));
    const { TM } = await load();
    await TM.init();
    await new Promise(r => setTimeout(r, 0));
    expect(window.VexGuiStyle.set).not.toHaveBeenCalled();
    emit(true);
    expect(window.VexGuiStyle.set).toHaveBeenLastCalledWith('firefox-dark');
    emit(false);
    expect(window.VexGuiStyle.set).toHaveBeenLastCalledWith('firefox');
    // a look with no dark version is left alone
    style = 'safari';
    window.VexGuiStyle.set.mockClear();
    emit(true);
    expect(window.VexGuiStyle.set).not.toHaveBeenCalled();
  });

  // AMOLED as the dark theme left the Firefox look in Firefox Dark grey: an
  // automatic switch is not a pick, so the look kept its own colours (item #5
  // review, 2026-10-08).
  it('a switch to a theme that is not the look\'s own colours moves the look to the theme\'s colours, and back', async () => {
    const emit = stubSystem(false);
    let style = 'firefox', colours = 'look';
    window.VexGuiStyle = {
      get: () => style, set: vi.fn(async s => { style = s; }),
      isBrowserLook: () => true, getColors: () => colours, setColors: vi.fn(m => { colours = m; }),
    };
    localStorage.setItem('vex.themeAuto', JSON.stringify({ mode: 'system', light: 'firefox-light', dark: 'amoled' }));
    const { TM, TA } = await load();
    await TM.init();
    await new Promise(r => setTimeout(r, 0));
    expect(TM.getCurrentTheme()).toBe('firefox-light');
    expect(colours).toBe('look');            // Firefox Light is the Firefox look's own colours
    emit(true);
    expect(TM.getCurrentTheme()).toBe('amoled');
    expect(style).toBe('firefox-dark');      // the look's dark version, as before
    expect(colours).toBe('theme');           // ...wearing AMOLED's black
    expect(TA.state().coloursByAuto).toBe(true);
    emit(false);
    expect(TM.getCurrentTheme()).toBe('firefox-light');
    expect(style).toBe('firefox');
    expect(colours).toBe('look');            // given back: this feature took them
    expect(TA.state().coloursByAuto).toBe(false);
  });

  it('theme colours the user chose are not given back to the look', async () => {
    const emit = stubSystem(true);
    let style = 'firefox-dark', colours = 'theme';
    window.VexGuiStyle = {
      get: () => style, set: vi.fn(async s => { style = s; }),
      isBrowserLook: () => true, getColors: () => colours, setColors: vi.fn(m => { colours = m; }),
    };
    localStorage.setItem('vex.themeAuto', JSON.stringify({ mode: 'system', light: 'firefox-light', dark: 'amoled' }));
    const { TM } = await load();
    await TM.init();
    await new Promise(r => setTimeout(r, 0));
    emit(false);
    expect(TM.getCurrentTheme()).toBe('firefox-light');
    expect(window.VexGuiStyle.setColors).not.toHaveBeenCalled();
    expect(colours).toBe('theme');
  });

  it('a look picked by hand stays until the next switch', async () => {
    stubSystem(true);
    let style = 'firefox';
    window.VexGuiStyle = { get: () => style, set: vi.fn(async s => { style = s; }) };
    localStorage.setItem('vex.themeAuto', JSON.stringify({ mode: 'system', light: 'firefox-light', dark: 'firefox-dark' }));
    const { TM, TA } = await load();
    await TM.init();
    await new Promise(r => setTimeout(r, 0));
    expect(style).toBe('firefox-dark');
    style = 'firefox';          // picked by hand
    TA.evaluate();              // a tick
    expect(style).toBe('firefox');
  });

  it('turning it on fills both slots and takes effect at once', async () => {
    stubSystem(true);
    const { TM, TA } = await load();
    await TM.init();
    TM.applyTheme('firefox-light');
    await new Promise(r => setTimeout(r, 0));
    TA.set({ mode: 'system' });
    expect(TA.state()).toEqual({ mode: 'system', light: 'firefox-light', dark: 'firefox-dark', from: '19:00', to: '07:00' });
    expect(TM.getCurrentTheme()).toBe('firefox-dark');
    TA.set({ mode: 'off' });
    expect(TM.getCurrentTheme()).toBe('firefox-dark');   // off keeps what is on
    expect(() => TA.set({ mode: 'sometimes' })).toThrow(/Unknown/);
  });

  it('a start-up that cannot read Windows keeps the saved theme and says why', async () => {
    window.vex = { getSystemDark: vi.fn(async () => { throw new Error('no IPC'); }), onSystemThemeChanged: vi.fn() };
    globalThis.VexStorage.load = vi.fn(async () => 'nord');
    localStorage.setItem('vex.themeAuto', JSON.stringify({ mode: 'system', light: 'oxford', dark: 'dracula' }));
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { TM } = await load();
    await TM.init();
    expect(TM.getCurrentTheme()).toBe('nord');
    expect(err.mock.calls.some(c => String(c[0]).includes('light/dark'))).toBe(true);
    err.mockRestore();
  });
});

describe('the New Tab page', () => {
  it('is recoloured in place with its address rewritten, not reloaded', async () => {
    const exec = vi.fn(() => Promise.resolve());
    const loadURL = vi.fn(() => Promise.resolve());
    const reload = vi.fn();
    globalThis.WebviewManager = { webviews: new Map([['t1', {
      getURL: () => 'file:///C:/vex/src/renderer/start.html?theme=oxford', executeJavaScript: exec, loadURL, reload,
    }]]) };
    const { TM } = await load();
    TM.applyTheme('firefox-dark', { auto: true });
    expect(loadURL).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
    const js = exec.mock.calls[0][0];
    expect(js).toContain('applyStartTheme(t)');
    expect(js).toContain('history.replaceState');
    expect(js).toContain('"firefox-dark"');
  });

  it('the script does what it says in a page', async () => {
    const { TM } = await load();
    window.applyStartTheme = vi.fn(t => document.documentElement.setAttribute('data-theme', t));
    window.history.replaceState(null, '', '/start.html?theme=oxford');
    new Function(TM.startPageThemeJs('nord'))();
    expect(window.applyStartTheme).toHaveBeenCalledWith('nord');
    expect(new URL(location.href).searchParams.get('theme')).toBe('nord');
    window.applyStartTheme.mockClear();
    new Function(TM.startPageThemeJs('nord'))();   // already there: nothing
    expect(window.applyStartTheme).not.toHaveBeenCalled();
    delete window.applyStartTheme;
  });
});

describe('Settings › Appearance', () => {
  function markup() {
    document.body.innerHTML = `
      <span id="theme-auto-hint"></span>
      <select id="setting-theme-auto-mode"><option value="off"></option><option value="system"></option><option value="schedule"></option><option value="sun"></option></select>
      <div id="theme-auto-details" style="display:none">
        <select id="setting-theme-light"></select><select id="setting-theme-dark"></select>
        <div id="theme-auto-schedule-row" style="display:none"><input id="setting-theme-dark-from"><input id="setting-theme-dark-to"></div>
        <div id="theme-auto-status"></div>
      </div>`;
  }

  it('shows the rows for the mode, offers sun times only with a location, and saves picks', async () => {
    markup();
    window.vex = { getSystemDark: vi.fn(async () => ({ dark: false })), onSystemThemeChanged: vi.fn() };
    const { TM, TA } = await load();
    await TM.init();
    await new Promise(r => setTimeout(r, 0));
    const mode = document.getElementById('setting-theme-auto-mode');
    const sun = mode.querySelector('option[value="sun"]');
    expect(sun.disabled).toBe(true);
    expect(sun.textContent).toMatch(/needs a location/);
    expect(document.getElementById('theme-auto-details').style.display).toBe('none');

    mode.value = 'schedule';
    mode.dispatchEvent(new Event('change'));
    expect(document.getElementById('theme-auto-details').style.display).toBe('');
    expect(document.getElementById('theme-auto-schedule-row').style.display).toBe('');
    expect(document.getElementById('setting-theme-dark-from').value).toBe('19:00');
    expect(document.getElementById('theme-auto-status').textContent).toMatch(/^Now (light|dark): .+ until \d\d:\d\d\./);

    const dark = document.getElementById('setting-theme-dark');
    expect(dark.querySelector('optgroup[label="Dark themes"] option[value="nord"]')).not.toBeNull();
    dark.value = 'nord';
    dark.dispatchEvent(new Event('change'));
    expect(TA.state().dark).toBe('nord');

    localStorage.setItem('vex.manualLocation', JSON.stringify({ latitude: 41, longitude: 29 }));
    TA.renderSettings();
    expect(sun.disabled).toBe(false);
  });
});

describe('main process: Windows light/dark mode', () => {
  it('answers the question and tells only real changes to every Vex window', async () => {
    const { wireSystemTheme } = await import('../../src/main/system-theme.js');
    const { EventEmitter } = await import('node:events');
    const nativeTheme = Object.assign(new EventEmitter(), { shouldUseDarkColors: false });
    const handlers = {};
    const ipcMain = { handle: (ch, fn) => { handlers[ch] = fn; } };
    const send = vi.fn();
    const win = { isDestroyed: () => false, webContents: { isDestroyed: () => false, send } };
    wireSystemTheme({ ipcMain, nativeTheme, windows: () => [win] });
    expect(handlers['system-theme:get']()).toEqual({ dark: false });
    nativeTheme.emit('updated');                   // high contrast etc.: no change
    expect(send).not.toHaveBeenCalled();
    nativeTheme.shouldUseDarkColors = true;
    nativeTheme.emit('updated');
    expect(send).toHaveBeenCalledWith('system-theme:changed', { dark: true });
    expect(handlers['system-theme:get']()).toEqual({ dark: true });
  });
});

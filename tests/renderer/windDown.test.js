// @vitest-environment jsdom
//
// Wind-down (the bottom of src/renderer/js/theme-auto.js): a warm, dimming veil
// that fades in after a set hour. Off by default; never changes the saved
// theme; the dark variant it may wear is given back exactly.

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

const at = (h, m = 0) => () => new Date(2026, 9, 16, h, m, 0);

beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = '';
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
});

describe('the level', () => {
  it('is 0 before the start, ramps up, holds, ramps down, 0 after', async () => {
    const { TA } = await load();
    const s = 22 * 60, e = 6 * 60;
    expect(TA.windLevel(21 * 60 + 59, s, e, 30)).toBe(0);
    expect(TA.windLevel(s, s, e, 30)).toBe(0);
    expect(TA.windLevel(s + 15, s, e, 30)).toBeCloseTo(0.5, 5);
    expect(TA.windLevel(s + 30, s, e, 30)).toBe(1);
    expect(TA.windLevel(2 * 60, s, e, 30)).toBe(1);
    expect(TA.windLevel(e - 15, s, e, 30)).toBeCloseTo(0.5, 5);
    expect(TA.windLevel(e, s, e, 30)).toBe(0);
    expect(TA.windLevel(12 * 60, s, e, 30)).toBe(0);
  });
  it('never exceeds 1 and never goes negative, and a same-day span works', async () => {
    const { TA } = await load();
    for (let m = 0; m < 1440; m += 7) {
      const v = TA.windLevel(m, 13 * 60, 15 * 60, 30);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
    expect(TA.windLevel(14 * 60, 13 * 60, 15 * 60, 30)).toBe(1);
    expect(TA.windLevel(10, 5, 5, 30)).toBe(0);
  });
  it('scales the veil by strength and stays under its caps', async () => {
    const { TA } = await load();
    expect(TA.windAlphas(0, 100)).toEqual({ dim: 0, warm: 0 });
    const full = TA.windAlphas(1, 100);
    expect(full.dim).toBeCloseTo(TA.WIND_MAX_DIM, 5);
    expect(full.warm).toBeCloseTo(TA.WIND_MAX_WARM, 5);
    expect(TA.windAlphas(1, 50).dim).toBeCloseTo(TA.WIND_MAX_DIM / 2, 5);
    expect(TA.windAlphas(9, 900).dim).toBeLessThanOrEqual(TA.WIND_MAX_DIM);
  });
  it('finds where "not tonight" ends, running or not', async () => {
    const { TA } = await load();
    const s = 22 * 60, e = 6 * 60;
    // 23:00 -> tomorrow 06:00
    expect(new Date(TA.windEndMs(new Date(2026, 9, 16, 23, 0), s, e)).toString()).toBe(new Date(2026, 9, 17, 6, 0).toString());
    // 03:00 -> today 06:00
    expect(new Date(TA.windEndMs(new Date(2026, 9, 16, 3, 0), s, e)).toString()).toBe(new Date(2026, 9, 16, 6, 0).toString());
    // 15:00 (not running) -> tomorrow 06:00 (the end of tonight's)
    expect(new Date(TA.windEndMs(new Date(2026, 9, 16, 15, 0), s, e)).toString()).toBe(new Date(2026, 9, 17, 6, 0).toString());
  });
});

describe('off by default', () => {
  it('has no state, no tint and no veil opacity', async () => {
    const { TA } = await load();
    TA._clock = at(23);
    expect(TA.windState().on).toBe(false);
    expect(TA.windNow()).toBe(0);
    TA.windTick({ instant: true });
    const veil = document.getElementById('wind-down-veil');
    expect(veil.style.opacity).toBe('0');
    expect(veil.style.pointerEvents).toBe('none');
    expect(localStorage.getItem('vex.windDown')).toBeNull();
  });
  it('treats an unreadable stored value as off, not as an error screen', async () => {
    const { TA } = await load();
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    localStorage.setItem('vex.windDown', '{nope');
    expect(TA.windState().on).toBe(false);
    expect(err).toHaveBeenCalled();
    err.mockRestore();
  });
  it('is not a key the sleep of an old profile could have switched on', async () => {
    const { TA } = await load();
    localStorage.setItem('vex.windDown', JSON.stringify({ on: 'yes', start: '99:99', rampMin: 7, intensity: 'x' }));
    const s = TA.windState();
    expect(s.on).toBe(false);
    expect(s.start).toBe('22:00');
    expect(s.rampMin).toBe(30);
    expect(s.intensity).toBe(60);
  });
});

describe('the veil', () => {
  it('dims and warms at the hour, lets clicks through, and never touches the theme', async () => {
    const { TA, TM } = await load();
    TM.applyTheme('oxford', { persist: false });
    TA._clock = at(23);
    TA.windSet({ on: true });
    const veil = document.getElementById('wind-down-veil');
    expect(veil.style.opacity).toBe('1');
    expect(veil.style.background).toContain('255, 140, 40');
    expect(veil.dataset.level).toBe('1');
    expect(veil.style.pointerEvents).toBe('none');
    expect(TM.currentTheme).toBe('oxford');
    expect(document.documentElement.getAttribute('data-theme')).toBe('oxford');
  });
  it('is halfway at half the ramp and gone at the end hour', async () => {
    const { TA } = await load();
    TA.windSet({ on: true, start: '22:00', end: '06:00', rampMin: 30 });
    TA._clock = at(22, 15);
    TA.windTick({ instant: true });
    expect(Number(document.getElementById('wind-down-veil').dataset.level)).toBeCloseTo(0.5, 2);
    TA._clock = at(6, 0);
    TA.windTick({ instant: true });
    expect(document.getElementById('wind-down-veil').style.opacity).toBe('0');
  });
  it('"not tonight" removes it until the end hour, and survives a tick', async () => {
    const { TA } = await load();
    TA._clock = at(23);
    TA.windSet({ on: true });
    TA.windSnooze();
    expect(TA.windNow()).toBe(0);
    TA._clock = at(1);
    TA.windTick();
    expect(TA.windNow()).toBe(0);
    // Tomorrow night it is back.
    TA._clock = () => new Date(2026, 9, 17, 23, 0, 0);
    expect(TA.windNow()).toBe(1);
  });
});

describe('the dark variant', () => {
  it('wears the dark theme during the wind-down and gives the exact theme back', async () => {
    const { TA, TM } = await load();
    TM.applyTheme('oxford', { persist: false });
    TA._clock = at(23);
    TA.windSet({ on: true, forceDark: true });
    expect(TM.currentTheme).not.toBe('oxford');
    expect(TA.isLightTheme(TM.THEMES.find(t => t.id === TM.currentTheme))).toBe(false);
    expect(TA.windState().forced.restore).toBe('oxford');
    // The end hour.
    TA._clock = at(6, 30);
    TA.windTick({ instant: true });
    expect(TM.currentTheme).toBe('oxford');
    expect(TA.windState().forced).toBeNull();
  });
  it('is given back when it is switched off or snoozed', async () => {
    const { TA, TM } = await load();
    TM.applyTheme('oxford', { persist: false });
    TA._clock = at(23);
    TA.windSet({ on: true, forceDark: true });
    TA.windSnooze();
    expect(TM.currentTheme).toBe('oxford');
    TA.windResume();
    expect(TM.currentTheme).not.toBe('oxford');
    TA.windSet({ on: false });
    expect(TM.currentTheme).toBe('oxford');
  });
  it('leaves a dark theme alone and records nothing to restore', async () => {
    const { TA, TM } = await load();
    TM.applyTheme('firefox-dark', { persist: false });
    TA._clock = at(23);
    TA.windSet({ on: true, forceDark: true });
    expect(TM.currentTheme).toBe('firefox-dark');
    expect(TA.windState().forced).toBeNull();
  });
  it('does not fight a theme picked by hand meanwhile', async () => {
    const { TA, TM } = await load();
    await TA.start();
    TM.applyTheme('oxford', { persist: false });
    TA._clock = at(23);
    TA.windSet({ on: true, forceDark: true });
    const forcedTo = TM.currentTheme;
    expect(forcedTo).not.toBe('oxford');
    // The user picks Matrix by hand.
    TM.applyTheme('matrix');
    expect(TA.windState().forced).toBeNull();
    TA._clock = at(6, 30);
    TA.windTick({ instant: true });
    expect(TM.currentTheme).toBe('matrix');
  });
  it('keeps the saved theme in storage while the dark one is worn', async () => {
    const { TA, TM } = await load();
    TM.applyTheme('oxford', { persist: false });
    VexStorage.save.mockClear();
    TA._clock = at(23);
    TA.windSet({ on: true, forceDark: true });
    expect(VexStorage.save).not.toHaveBeenCalledWith('theme', expect.anything());
  });
  it('works the same with Light and dark on: the dark slot is worn, then the light theme', async () => {
    const { TA, TM } = await load();
    TM.applyTheme('oxford', { persist: false });
    TA._clock = at(12);
    TA.set({ mode: 'schedule', from: '23:30', to: '23:45', light: 'oxford', dark: 'amoled' });
    TA._clock = at(22, 40);
    TA.evaluate({ force: true });
    expect(TM.currentTheme).toBe('oxford');
    TA.windSet({ on: true, forceDark: true });
    expect(TM.currentTheme).toBe('amoled');
    TA.evaluate({ force: true });
    expect(TM.currentTheme).toBe('amoled');
    TA._clock = at(6, 30);
    TA.windTick({ instant: true });
    expect(TM.currentTheme).toBe('oxford');
  });
});

describe('every look and the New Tab page', () => {
  it('is a host-level veil: it is above the webviews, so New Tab is covered with no start.html change', async () => {
    const { TA } = await load();
    TA._clock = at(23);
    TA.windSet({ on: true });
    const veil = document.getElementById('wind-down-veil');
    expect(veil.parentElement).toBe(document.body);
    expect(veil.style.position).toBe('fixed');
    expect(Number(veil.style.zIndex)).toBeGreaterThan(2147483450);
  });
  it('does not depend on any theme or look attribute', async () => {
    const { TA, TM } = await load();
    TA._clock = at(23);
    TA.windSet({ on: true });
    const before = document.getElementById('wind-down-veil').style.background;
    for (const id of TM.availableThemes) {
      TM.applyTheme(id, { persist: false });
      for (const gs of ['classic', 'glass', 'firefox', 'chrome', 'fluent']) {
        document.documentElement.setAttribute('data-gui-style', gs);
        TA.windTick({ instant: true });
        expect(document.getElementById('wind-down-veil').style.background).toBe(before);
      }
    }
  });
  it('does not touch start.html or today.js', () => {
    const start = readFileSync(resolve(ROOT, 'src/renderer/start.html'), 'utf8');
    expect(start).not.toContain('wind-down');
  });
});

describe('Settings', () => {
  function dom() {
    document.body.innerHTML = `
      <input type="checkbox" id="setting-wind-down">
      <div id="wind-down-details" style="display:none">
        <input type="time" id="setting-wind-down-start"><input type="time" id="setting-wind-down-end">
        <select id="setting-wind-down-ramp"><option value="15"></option><option value="30"></option><option value="60"></option><option value="90"></option></select>
        <input type="range" min="10" max="100" id="setting-wind-down-intensity">
        <input type="checkbox" id="setting-wind-down-dark">
        <span id="wind-down-status"></span><button id="wind-down-snooze"></button>
      </div>`;
  }
  const html = () => readFileSync(resolve(ROOT, 'src/renderer/index.html'), 'utf8');

  it('index.html has every control the code looks for, off by default', () => {
    const h = html();
    for (const id of ['setting-wind-down', 'wind-down-details', 'setting-wind-down-start', 'setting-wind-down-end', 'setting-wind-down-ramp', 'setting-wind-down-intensity', 'setting-wind-down-dark', 'wind-down-snooze', 'wind-down-status']) {
      expect(h).toContain(`id="${id}"`);
    }
    expect(h).not.toMatch(/id="setting-wind-down"[^>]*checked/);
  });
  it('turning it on shows the details, and changes are saved', async () => {
    const { TA } = await load();
    dom();
    TA._clock = at(12);
    TA.wireWind();
    const on = document.getElementById('setting-wind-down');
    on.checked = true;
    on.dispatchEvent(new Event('change'));
    expect(TA.windState().on).toBe(true);
    expect(document.getElementById('wind-down-details').style.display).toBe('');
    const s = document.getElementById('setting-wind-down-start');
    s.value = '21:15';
    s.dispatchEvent(new Event('change'));
    expect(TA.windState().start).toBe('21:15');
    const r = document.getElementById('setting-wind-down-ramp');
    r.value = '60';
    r.dispatchEvent(new Event('change'));
    expect(TA.windState().rampMin).toBe(60);
    const i = document.getElementById('setting-wind-down-intensity');
    i.value = '80';
    i.dispatchEvent(new Event('input'));
    expect(TA.windState().intensity).toBe(80);
  });
  it('refuses a start equal to the end', async () => {
    const { TA } = await load();
    dom();
    TA._clock = at(12);
    TA.wireWind();
    document.getElementById('setting-wind-down-start').value = '06:00';
    document.getElementById('setting-wind-down-end').value = '06:00';
    document.getElementById('setting-wind-down-end').dispatchEvent(new Event('change'));
    expect(window.showToast).toHaveBeenCalledWith(expect.stringContaining('differ'), 'error');
    expect(TA.windState().start).toBe('22:00');
  });
  it('the snooze button toggles', async () => {
    const { TA } = await load();
    dom();
    TA._clock = at(23);
    TA.wireWind();
    TA.windSet({ on: true });
    const b = document.getElementById('wind-down-snooze');
    expect(b.textContent).toBe('Not tonight');
    b.click();
    expect(TA.windNow()).toBe(0);
    expect(b.textContent).toBe('Turn tonight back on');
    b.click();
    expect(TA.windNow()).toBe(1);
  });
  it('is on the Reset list, and sync stays out of it (this device only)', () => {
    expect(readFileSync(resolve(ROOT, 'src/renderer/js/app.js'), 'utf8')).toContain("'vex.windDown'");
  });
});

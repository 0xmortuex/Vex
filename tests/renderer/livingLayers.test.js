// @vitest-environment jsdom
//
// Seasonal worlds, weather layer and tab personalities: gating, scheduling and
// the data they read. Nothing here touches the network.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
const { VexLiving } = require('../../src/renderer/js/living-core.js');
const { SeasonalWorlds } = require('../../src/renderer/js/seasonal-worlds.js');
const { WeatherLayer } = require('../../src/renderer/js/weather-layer.js');
const { TabPersonality } = require('../../src/renderer/js/tab-personality.js');

let rafQueue;
function fakeCanvas() {
  const ctx = new Proxy({}, { get: (t, k) => (k in t ? t[k] : (k === 'createRadialGradient' || k === 'createLinearGradient' ? () => ({ addColorStop() {} }) : () => {})), set: (t, k, v) => { t[k] = v; return true; } });
  HTMLCanvasElement.prototype.getContext = () => ctx;
}

beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = '<div id="host" style="width:640px;height:360px"></div>';
  document.body.className = '';
  rafQueue = [];
  globalThis.requestAnimationFrame = (f) => { rafQueue.push(f); return rafQueue.length; };
  globalThis.cancelAnimationFrame = () => { rafQueue.length = 0; };
  globalThis.fetch = vi.fn();
  fakeCanvas();
});
afterEach(() => { SeasonalWorlds.unmount(); WeatherLayer.unmount(); delete globalThis.fetch; });

describe('Seasonal worlds', () => {
  it('auto picks night at night and the season by day', () => {
    const at = (m, h) => new Date(2026, m, 15, h, 0, 0);
    expect(SeasonalWorlds.autoWorld(at(9, 23))).toBe('night');
    expect(SeasonalWorlds.autoWorld(at(9, 3))).toBe('night');
    expect(SeasonalWorlds.autoWorld(at(9, 14))).toBe('autumn');
    expect(SeasonalWorlds.autoWorld(at(0, 14))).toBe('snow');
    expect(SeasonalWorlds.autoWorld(at(3, 14))).toBe('spring');
    expect(SeasonalWorlds.autoWorld(at(6, 14))).toBe('night');
    expect(SeasonalWorlds.autoWorld(at(0, 14), 'south')).toBe('night');   // January there is high summer
    expect(SeasonalWorlds.autoWorld(at(6, 14), 'south')).toBe('snow');
  });

  it('keeps the particle count inside a floor and a hard cap', () => {
    expect(SeasonalWorlds.particleCount('snow', 3840, 2160)).toBe(70);
    expect(SeasonalWorlds.particleCount('snow', 100, 100)).toBe(20);
    expect(SeasonalWorlds.particleCount('night', 1280, 720)).toBe(110);
    expect(() => SeasonalWorlds.particleCount('lava', 1, 1)).toThrow();
  });

  it('does nothing at all while its switch is off', () => {
    const host = document.getElementById('host');
    expect(SeasonalWorlds.mount(host)).toBe(false);
    expect(host.querySelector('canvas')).toBeNull();
    expect(rafQueue.length).toBe(0);
    expect(SeasonalWorlds.snapshot().mounted).toBe(false);
  });

  it('mounts, animates, and unmounts cleanly when switched on', () => {
    VexLiving.write({ world: 'snow' });
    const host = document.getElementById('host');
    expect(SeasonalWorlds.mount(host, { seed: 5 })).toBe(true);
    expect(host.querySelector('canvas.vex-living-world')).toBeTruthy();
    expect(host.classList.contains('vex-living-host')).toBe(true);
    const s = SeasonalWorlds.snapshot();
    expect(s.variant).toBe('snow');
    expect(s.scheduled).toBe(true);
    expect(s.fps).toBe(30);
    expect(SeasonalWorlds.unmount()).toBe(true);
    expect(host.querySelector('canvas')).toBeNull();
    expect(host.classList.contains('vex-living-host')).toBe(false);
  });

  it('is still in Game mode and with the master switch off, and resumes after', () => {
    VexLiving.write({ world: 'autumn' });
    SeasonalWorlds.mount(document.getElementById('host'));
    expect(SeasonalWorlds.snapshot().scheduled).toBe(true);
    document.dispatchEvent(new CustomEvent('vex:game-mode', { detail: { active: true } }));
    let s = SeasonalWorlds.snapshot();
    expect(s.scheduled).toBe(false);
    expect(s.reason).toBe('game-mode');
    document.dispatchEvent(new CustomEvent('vex:game-mode', { detail: { active: false } }));
    expect(SeasonalWorlds.snapshot().scheduled).toBe(true);
    VexLiving.write({ animations: false });
    expect(SeasonalWorlds.snapshot().scheduled).toBe(false);
  });

  it('turning the world off from Settings removes the schedule and clears', () => {
    VexLiving.write({ world: 'night' });
    SeasonalWorlds.mount(document.getElementById('host'));
    VexLiving.write({ world: 'off' });
    const s = SeasonalWorlds.snapshot();
    expect(s.scheduled).toBe(false);
    expect(s.variant).toBe('');
  });
});

describe('Weather layer', () => {
  const put = (loc, cache) => {
    if (loc) localStorage.setItem('vex.weatherLoc', JSON.stringify(loc));
    if (cache) localStorage.setItem('vex.weatherCache', JSON.stringify(cache));
  };

  it('reads the start page description words', () => {
    const c = WeatherLayer.conditionFromDescription;
    expect(c('Light rain · Berlin')).toBe('rain');
    expect(c('Rain showers')).toBe('rain');
    expect(c('Thunderstorm')).toBe('storm');
    expect(c('Heavy snow · Oslo')).toBe('snow');
    expect(c('Foggy')).toBe('fog');
    expect(c('Overcast')).toBe('cloudy');
    expect(c('Partly cloudy')).toBe('cloudy');
    expect(c('Clear sky')).toBe('clear');
    expect(c('Mainly clear')).toBe('clear');
    expect(c('???')).toBe('');
  });

  it('uses the facility only when a city is saved (opt-in) and the forecast is fresh', () => {
    expect(WeatherLayer.readFacility(localStorage).reason).toBe('no-saved-city');
    put({ lat: 1, lon: 2 });
    expect(WeatherLayer.readFacility(localStorage).reason).toBe('no-forecast-yet');
    put(null, { desc: 'Rain', t: Date.now() });
    expect(WeatherLayer.readFacility(localStorage)).toEqual({ condition: 'rain', reason: 'facility' });
    put(null, { desc: 'Rain', t: Date.now() - 4 * 3600 * 1000 });
    expect(WeatherLayer.readFacility(localStorage).reason).toBe('stale');
  });

  it('manual choice wins and needs no location; auto with no facility draws nothing', () => {
    expect(WeatherLayer.resolve({ weatherLayer: false, weatherManual: 'rain' }).reason).toBe('off');
    expect(WeatherLayer.resolve({ weatherLayer: true, weatherManual: 'snow' }, {})).toEqual({ condition: 'snow', reason: 'manual' });
    expect(WeatherLayer.resolve({ weatherLayer: true, weatherManual: 'auto' }, { facilityStorage: localStorage }).condition).toBe('');
  });

  it('mounts from the saved forecast and makes no network call', () => {
    put({ lat: 1, lon: 2 }, { desc: 'Light snow · Oslo', t: Date.now() });
    VexLiving.write({ weatherLayer: true });
    expect(WeatherLayer.mount(document.getElementById('host'), { facilityStorage: localStorage })).toBe(true);
    expect(WeatherLayer.snapshot().variant).toBe('snow');
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('with nothing to read it does not mount a schedule', () => {
    VexLiving.write({ weatherLayer: true });
    expect(WeatherLayer.mount(document.getElementById('host'), { facilityStorage: localStorage })).toBe(false);
    expect(rafQueue.length).toBe(0);
  });

  it('the manual selector works with no saved city', () => {
    VexLiving.write({ weatherLayer: true, weatherManual: 'rain' });
    expect(WeatherLayer.mount(document.getElementById('host'))).toBe(true);
    expect(WeatherLayer.snapshot().variant).toBe('rain');
  });
});

describe('Tab personalities', () => {
  const T = TabPersonality;
  beforeEach(() => { T._reset(); document.body.innerHTML = ''; });

  it('maps hosts to a flavour, subdomains included', () => {
    expect(T.kindFor('youtube.com')).toBe('video');
    expect(T.kindFor('m.youtube.com')).toBe('video');
    expect(T.kindFor('github.com')).toBe('code');
    expect(T.kindFor('example.org')).toBe('default');
    expect(T.kindFor('')).toBe('default');
    expect(T.hostOf('https://www.GitHub.com/x')).toBe('github.com');
    expect(T.hostOf('file:///a.html')).toBe('');
    expect(T.hostOf('about:blank')).toBe('');
  });

  it('counts distinct days in the last 7 and calls 5 of 7 "daily"', () => {
    let v = {};
    const today = '2026-10-16';
    for (const d of ['2026-10-10', '2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15']) v = T.recordVisit(v, 'a.com', d);
    expect(T.recentDays(v, 'a.com', today)).toBe(5);
    expect(T.isDaily(v, 'a.com', today)).toBe(true);
    v = T.recordVisit(v, 'b.com', today);
    expect(T.isDaily(v, 'b.com', today)).toBe(false);
    // same day twice is one day; old days fall out of the window
    v = T.recordVisit(v, 'b.com', today);
    expect(v['b.com']).toEqual([today]);
    expect(T.recentDays(v, 'a.com', '2026-10-30')).toBe(0);
  });

  it('keeps at most 200 hosts, dropping the least recently visited', () => {
    let v = {};
    for (let i = 0; i < 210; i++) v = T.recordVisit(v, 'h' + i + '.com', i < 10 ? '2026-10-01' : '2026-10-16');
    expect(Object.keys(v).length).toBe(200);
    expect(v['h0.com']).toBeUndefined();
    expect(v['h209.com']).toBeTruthy();
  });

  const on = { animations: true, tabPersonality: true };
  const calm = { settings: on };
  it('plays only for a finished load of a real site, when switched on and not quiet', () => {
    expect(T.decide({ settings: on, env: calm, url: 'https://youtube.com/', wasLoading: true })).toEqual({ host: 'youtube.com', kind: 'video' });
    expect(T.decide({ settings: on, env: calm, url: 'https://youtube.com/', wasLoading: false })).toBeNull();
    expect(T.decide({ settings: { ...on, tabPersonality: false }, env: calm, url: 'https://youtube.com/', wasLoading: true })).toBeNull();
    expect(T.decide({ settings: on, env: { ...calm, gameActive: true }, url: 'https://youtube.com/', wasLoading: true })).toBeNull();
    expect(T.decide({ settings: on, env: { ...calm, reducedMotion: true }, url: 'https://youtube.com/', wasLoading: true })).toBeNull();
    expect(T.decide({ settings: on, env: calm, url: 'file:///start.html', wasLoading: true })).toBeNull();
  });

  it('animates the strip element by class and cleans up, with no inline sizing', () => {
    document.body.innerHTML = '<div class="top-tab" data-tab-id="t1"><img class="tab-favicon"></div>';
    VexLiving.write({ tabPersonality: true });
    const tab = { id: 't1', url: 'https://github.com/' };
    T.onUpdate('t1', { loading: true }, tab);
    const el = document.querySelector('.top-tab');
    expect(el.classList.contains('vex-tp')).toBe(false);
    T.onUpdate('t1', { loading: false }, tab);
    expect(el.classList.contains('vex-tp-code')).toBe(true);
    expect(el.getAttribute('style')).toBeNull();
    el.dispatchEvent(new Event('animationend'));
    expect(el.classList.contains('vex-tp')).toBe(false);
  });

  it('writes the daily glow as a generated stylesheet that survives re-renders', () => {
    const today = T.dayKey(new Date());
    let v = {};
    for (let i = 0; i < 5; i++) v = T.recordVisit(v, 'github.com', T.daysAgo(today, i));
    localStorage.setItem('vex.living.visits', JSON.stringify(v));
    globalThis.TabManager = { tabs: [{ id: 'g1', url: 'https://github.com/a' }, { id: 'g2', url: 'https://example.org/' }] };
    VexLiving.write({ tabDailyGlow: true });
    T.refreshGlow();
    const css = document.getElementById('vex-tp-glow').textContent;
    expect(css).toContain('[data-tab-id="g1"]');
    expect(css).not.toContain('g2');
    VexLiving.write({ tabDailyGlow: false });
    T.refreshGlow();
    expect(document.getElementById('vex-tp-glow')).toBeNull();
    delete globalThis.TabManager;
  });
});

// @vitest-environment jsdom
//
// The privacy defaults: search suggestions only from the engine you search
// with (and none from a private window), SponsorBlock off on a new profile,
// an existing profile kept as it was and told once, the setup wizard's
// "Privacy choices" step, and the switch for the update check at start.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

require('../../src/renderer/js/vex-utils.js');
require('../../src/renderer/js/vex-icons.js');
require('../../src/renderer/js/geo-search.js');
const TA = require('../../src/renderer/js/typed-address.js');
const { SponsorSkip } = require('../../src/renderer/js/sponsor-skip.js');
const { Onboarding } = require('../../src/renderer/js/onboarding.js');
const { UpdateNotifier } = require('../../src/renderer/js/update-notifier.js');
const { installIpcPolicy } = require('../../src/main/ipc-policy.js');

// The two Settings switches the wizard drives, with the change handlers
// Settings attaches (js/app.js).
function settingsSwitches({ suggest = true, sponsor = false } = {}) {
  const mk = (id, on, onChange) => {
    const el = document.createElement('input');
    el.type = 'checkbox'; el.id = id; el.checked = on;
    el.addEventListener('change', () => onChange(el.checked));
    document.body.appendChild(el);
  };
  mk('setting-search-suggest', suggest, on => localStorage.setItem(TA.SUGGEST_KEY, on ? 'on' : 'off'));
  mk('setting-sponsor-skip', sponsor, on => SponsorSkip.setEnabled(on));
}

beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = '';
  delete window.VexTabPolicy;
  globalThis.SponsorSkip = SponsorSkip;
  globalThis.WebviewManager = { webviews: new Map() };
  window.showToast = vi.fn();
  Onboarding.step = 0; Onboarding._session = {}; Onboarding.activeSteps = null;
});
afterEach(() => { vi.useRealTimers(); });

describe('where suggestions come from', () => {
  it('every engine has its own suggestion address, and Google is asked only for Google', () => {
    for (const id of Object.keys(TA.SEARCH_ENGINES)) {
      const url = TA.suggestUrl('weather in rome', id);
      expect(url).toMatch(/^https:\/\//);
      expect(url).toContain('weather%20in%20rome');
      if (id !== 'google') expect(url).not.toContain('google');
    }
    expect(new URL(TA.suggestUrl('x', 'duckduckgo')).host).toBe('duckduckgo.com');
    expect(new URL(TA.suggestUrl('x', 'bing')).host).toBe('api.bing.com');
    expect(new URL(TA.suggestUrl('x', 'brave')).host).toBe('search.brave.com');
    expect(new URL(TA.suggestUrl('x', 'startpage')).host).toBe('www.startpage.com');
    expect(new URL(TA.suggestUrl('x', 'ecosia')).host).toBe('ac.ecosia.org');
    expect(new URL(TA.suggestUrl('x', 'google')).host).toBe('suggestqueries.google.com');
  });

  it('an engine without one gets none, and nothing typed asks nothing', () => {
    const saved = TA.SEARCH_ENGINES.ecosia.suggest;
    delete TA.SEARCH_ENGINES.ecosia.suggest;
    try { expect(TA.suggestUrl('x', 'ecosia')).toBeNull(); }
    finally { TA.SEARCH_ENGINES.ecosia.suggest = saved; }
    expect(TA.suggestUrl('   ', 'google')).toBeNull();
  });

  it('the switch is on unless turned off', () => {
    expect(TA.suggestionsOn(null)).toBe(true);
    expect(TA.suggestionsOn('on')).toBe(true);
    expect(TA.suggestionsOn('off')).toBe(false);
  });

  it('every engine answers in one shape', () => {
    expect(TA.parseSuggestions('["weath",["weather","weather radar"]]')).toEqual(['weather', 'weather radar']);
    expect(TA.parseSuggestions('<html>429</html>')).toEqual([]);
  });

  it('a private window is answered with nothing, and the handler never runs', async () => {
    const handlers = new Map();
    const owner = { privatePartition: 'priv-1', persist: {}, data: {} };
    // installIpcPolicy wraps ipcMain.handle: register through the wrapped one.
    const fakeMain = { handle: (ch, fn) => handlers.set(ch, fn), on: () => {} };
    installIpcPolicy(fakeMain, { isUiFrame: () => true, owner: () => owner, isAuxiliary: () => false, ownsTarget: () => true });
    let reached = 0;
    fakeMain.handle('web-suggest', () => { reached++; return ['leaked']; });
    const result = await handlers.get('web-suggest')({ sender: {}, senderFrame: { url: 'file:///C:/vex/src/renderer/index.html?private=true' } }, 'my secret query');
    expect(result).toEqual([]);
    expect(reached).toBe(0);
  });
});

describe('SponsorBlock and existing profiles', () => {
  it('a new profile: SponsorBlock off, nothing to tell', () => {
    expect(Onboarding.migratePrivacyDefaults()).toBeNull();
    expect(SponsorSkip.enabled()).toBe(false);
    expect(localStorage.getItem('vex.privacyDefaults')).toBe('1');
  });

  it('an existing profile keeps SponsorBlock on as it had it, and is told once where suggestions now come from', () => {
    vi.useFakeTimers();
    localStorage.setItem('vex.onboardingDone', 'true');
    localStorage.setItem('vex.searchEngine', 'duckduckgo');
    const told = Onboarding.migratePrivacyDefaults();
    expect(SponsorSkip.enabled()).toBe(true);
    expect(told).toContain('DuckDuckGo');
    vi.advanceTimersByTime(6000);
    expect(window.showToast).toHaveBeenCalledTimes(1);
    expect(Onboarding.migratePrivacyDefaults()).toBeNull();          // once
    vi.advanceTimersByTime(6000);
    expect(window.showToast).toHaveBeenCalledTimes(1);
  });

  it('an existing profile that turned SponsorBlock off keeps it off; Google users are not told anything', () => {
    localStorage.setItem('vex.history', '[]');
    localStorage.setItem(SponsorSkip.KEY, 'off');
    expect(Onboarding.migratePrivacyDefaults()).toBeNull();
    expect(SponsorSkip.enabled()).toBe(false);
  });

  it('a private window changes nothing', () => {
    window.VexTabPolicy = { isPrivateWindow: true };
    localStorage.setItem('vex.onboardingDone', 'true');
    expect(Onboarding.migratePrivacyDefaults()).toBeNull();
    expect(localStorage.getItem('vex.privacyDefaults')).toBeNull();
    expect(localStorage.getItem(SponsorSkip.KEY)).toBeNull();
  });
});

describe('the "Privacy choices" step', () => {
  it('is in the short setup, right after the search engine', () => {
    const quick = Onboarding.STEPS().filter(s => s.quick).map(s => s.key);
    expect(quick.indexOf('privacy')).toBe(quick.indexOf('search') + 1);
  });

  it('shows three switches with the private defaults: suggestions on, weather off, SponsorBlock off', () => {
    settingsSwitches();
    const body = document.createElement('div');
    Onboarding._renderPrivacy(body);
    const boxes = [...body.querySelectorAll('input[type=checkbox]')];
    expect(boxes.map(b => b.dataset.key)).toEqual(['suggest', 'weather', 'sponsor']);
    expect(boxes.map(b => b.checked)).toEqual([true, false, false]);
    expect(body.textContent).toContain('sponsor.ajay.app');
    expect(body.textContent).toContain('Google');                    // the engine in use
  });

  it('applies through the Settings switches, and weather on asks for the city next', () => {
    settingsSwitches();
    Onboarding.activeSteps = Onboarding.STEPS().filter(s => s.quick);
    Onboarding.step = Onboarding.activeSteps.findIndex(s => s.key === 'privacy');
    const body = document.createElement('div');
    Onboarding._renderPrivacy(body);
    for (const key of ['suggest', 'weather', 'sponsor']) {
      const box = body.querySelector(`[data-key="${key}"]`);
      box.checked = !box.checked;
      box.dispatchEvent(new Event('change'));
    }
    Onboarding._applyPrivacy();
    expect(localStorage.getItem(TA.SUGGEST_KEY)).toBe('off');
    expect(SponsorSkip.enabled()).toBe(true);
    expect(Onboarding.activeSteps[Onboarding.step + 1].key).toBe('weather');
    expect(localStorage.getItem('vex.privacyChosen')).toBe('true');
  });

  it('weather turned off forgets the saved city', () => {
    settingsSwitches();
    localStorage.setItem('vex.weatherLoc', JSON.stringify({ lat: 1, lon: 2, city: 'X' }));
    const body = document.createElement('div');
    Onboarding._renderPrivacy(body);
    const box = body.querySelector('[data-key="weather"]');
    expect(box.checked).toBe(true);
    box.checked = false; box.dispatchEvent(new Event('change'));
    Onboarding._applyPrivacy();
    expect(localStorage.getItem('vex.weatherLoc')).toBeNull();
  });
});

describe('the update check at start', () => {
  it('is on unless turned off; off, nothing is asked at start', () => {
    vi.useFakeTimers();
    const check = vi.fn(async () => ({ ok: true, hasUpdate: false }));
    window.vex = { checkForUpdates: check, updates: {} };
    expect(UpdateNotifier.checksOnStart()).toBe(true);
    UpdateNotifier.setChecksOnStart(false);
    UpdateNotifier.init();
    vi.advanceTimersByTime(10000);
    expect(check).not.toHaveBeenCalled();
    UpdateNotifier.setChecksOnStart(true);
    UpdateNotifier.init();
    vi.advanceTimersByTime(10000);
    expect(check).toHaveBeenCalledTimes(1);
  });
});

// @vitest-environment jsdom
//
// Coverage for the first-run onboarding gate + start-page value mirroring.
// The wizard UI itself is exercised at runtime; here we lock the logic that
// decides WHEN it shows and that values reach both host + start-page storage.

import { describe, it, expect, beforeEach, vi } from 'vitest';

require('../../src/renderer/js/vex-utils.js'); // installs window.escapeHtml (loaded first in index.html)
const { Onboarding } = require('../../src/renderer/js/onboarding.js');

beforeEach(() => {
  localStorage.clear();
  Onboarding.step = 0;
  globalThis.WebviewManager = { webviews: new Map() };
});

describe('Onboarding gate', () => {
  it('does not start when already marked done', () => {
    localStorage.setItem('vex.onboardingDone', 'true');
    const spy = vi.spyOn(Onboarding, 'start');
    Onboarding.maybeStart();
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('silently marks done (no wizard) for an existing install with prior data', () => {
    localStorage.setItem('vex.tabs', '[]');           // evidence of prior use
    const spy = vi.spyOn(Onboarding, 'start');
    Onboarding.maybeStart();
    expect(spy).not.toHaveBeenCalled();
    expect(localStorage.getItem('vex.onboardingDone')).toBe('true');
    spy.mockRestore();
  });

  it('done() reflects the stored flag', () => {
    expect(Onboarding.done()).toBe(false);
    localStorage.setItem('vex.onboardingDone', 'true');
    expect(Onboarding.done()).toBe(true);
  });

  it('finish() sets the flag', () => {
    Onboarding._reloadStartPages = () => {};   // no-op for test
    Onboarding.finish();
    expect(localStorage.getItem('vex.onboardingDone')).toBe('true');
  });
});

describe('Onboarding relaunch + step-done detection', () => {
  it('relaunch always shows ALL steps (pre-filled), never a filtered subset', () => {
    // Even with everything configured, every step is present.
    localStorage.setItem('vex.theme', 'ocean');
    localStorage.setItem('vex.githubUsername', 'octocat');
    localStorage.setItem('vex.aiWorkerUrl', 'https://x.workers.dev');
    const render = vi.spyOn(Onboarding, '_render').mockImplementation(() => {});
    Onboarding.relaunch();
    expect(render).toHaveBeenCalled();
    expect(Onboarding.activeSteps.map(s => s.key)).toEqual(Onboarding.STEPS().map(s => s.key));
    render.mockRestore();
  });

  it('_isStepDone reflects saved values per step', () => {
    expect(Onboarding._isStepDone('theme')).toBe(false);
    localStorage.setItem('vex.theme', 'ocean');
    expect(Onboarding._isStepDone('theme')).toBe(true);
    localStorage.setItem('vex.githubUsername', 'octocat');
    expect(Onboarding._isStepDone('github')).toBe(true);
    localStorage.setItem('vex.defaultBrowserConfigured', 'true');
    expect(Onboarding._isStepDone('defaultbrowser')).toBe(true);
  });

  it('each AI backend is judged independently (cloud done ≠ ollama/on-device done)', () => {
    localStorage.setItem('vex.aiWorkerUrl', 'https://x.workers.dev');
    expect(Onboarding._isStepDone('aicloud')).toBe(true);
    expect(Onboarding._isStepDone('ollama')).toBe(false);
    expect(Onboarding._isStepDone('ondevice')).toBe(false);
    localStorage.setItem('vex.preferLocalAI', 'true');
    expect(Onboarding._isStepDone('ollama')).toBe(true);
    localStorage.setItem('vex.preferOnDeviceAI', 'true');
    expect(Onboarding._isStepDone('ondevice')).toBe(true);
  });
});

describe('Onboarding step bodies render without throwing', () => {
  it('every step key produces a body (no exceptions)', () => {
    globalThis.ThemeManager = { THEMES: [{ id: 'oxford', label: 'Oxford' }], currentTheme: 'oxford', applyTheme() {} };
    globalThis.WebLLM = undefined;   // exercises the "no WebGPU" branch
    globalThis.window.vex = { isDefaultBrowser: () => Promise.resolve(false), setAsDefaultBrowser: () => Promise.resolve(), vaultSave: () => Promise.resolve() };
    const keys = Onboarding.STEPS().map(s => s.key);
    for (const key of keys) {
      const body = document.createElement('div');
      expect(() => Onboarding._renderBody(key, body)).not.toThrow();
    }
    delete globalThis.ThemeManager;
  });
});

describe('Setup style step (Full Vex / Minimal / Custom)', () => {
  const stubEnv = () => {
    const calls = { style: [], rendered: 0, overridesApplied: 0 };
    globalThis.window.VexGuiStyle = {
      set: (s) => calls.style.push(s),
      get: () => 'classic',
      render: () => { calls.rendered++; },
      defaults: () => [
        { name: 'Google', url: 'https://www.google.com' },
        { name: 'YouTube', url: 'https://www.youtube.com' },
        { name: 'Reddit', url: 'https://www.reddit.com' },
      ],
    };
    globalThis.SidebarManager = { applyPanelOverrides: () => { calls.overridesApplied++; } };
    return calls;
  };
  const overrides = () => JSON.parse(localStorage.getItem('vex.panelOverrides') || '{}');

  it('is the second step, right after welcome', () => {
    const keys = Onboarding.STEPS().map(s => s.key);
    expect(keys[0]).toBe('welcome');
    expect(keys[1]).toBe('setupstyle');
  });

  it('_isStepDone reflects a saved profile', () => {
    expect(Onboarding._isStepDone('setupstyle')).toBe(false);
    localStorage.setItem('vex.setupProfile', 'minimal');
    expect(Onboarding._isStepDone('setupstyle')).toBe(true);
  });

  it('renders four profile cards (Mortuex/Minimal/Custom/Code) with thumbnails; zones follow selection', () => {
    stubEnv();
    Onboarding._session = {};
    const body = document.createElement('div');
    Onboarding._renderBody('setupstyle', body);
    const cards = body.querySelectorAll('[data-profile]');
    expect([...cards].map(c => c.dataset.profile)).toEqual(['owner', 'minimal', 'custom', 'code']);
    expect(cards[0].textContent).toContain('The Mortuex Setup');
    // Every card carries a preview thumbnail.
    for (const c of cards) expect(c.querySelector('svg')).toBeTruthy();
    const zone = body.querySelector('#ob-setup-custom');
    const codeZone = body.querySelector('#ob-setup-code');
    expect(zone.style.display).toBe('none');
    expect(codeZone.style.display).toBe('none');
    cards[2].click();
    expect(zone.style.display).toBe('flex');
    expect(body.querySelectorAll('[data-panel]').length).toBe(Onboarding._APP_PANELS().length);
    expect(body.querySelectorAll('[data-shortcut]').length).toBe(3);
    cards[3].click();
    expect(zone.style.display).toBe('none');
    expect(codeZone.style.display).toBe('flex');
  });

  it('Minimal hides every app panel, empties the shortcut bar, uses Classic', () => {
    const calls = stubEnv();
    Onboarding._applySetupProfile({ profile: 'minimal' });
    const ov = overrides();
    for (const p of Onboarding._APP_PANELS()) expect(ov[p.id]?.hidden).toBe(true);
    expect(localStorage.getItem('vex.shortcuts')).toBe('[]');
    expect(calls.style).toContain('classic');
    expect(calls.overridesApplied).toBeGreaterThan(0);
    expect(localStorage.getItem('vex.setupProfile')).toBe('minimal');
  });

  it('Full Vex (owner) un-hides panels, restores stock shortcuts, uses Glass', () => {
    const calls = stubEnv();
    // Simulate a prior Minimal choice plus an unrelated override that must survive.
    localStorage.setItem('vex.panelOverrides', JSON.stringify({
      discord: { hidden: true, name: 'DC' },
      spotify: { hidden: true },
    }));
    localStorage.setItem('vex.shortcuts', '[]');
    Onboarding._applySetupProfile({ profile: 'owner' });
    const ov = overrides();
    expect(ov.discord.hidden).toBeUndefined();
    expect(ov.discord.name).toBe('DC');       // non-visibility override kept
    expect(ov.spotify).toBeUndefined();       // emptied override pruned
    expect(localStorage.getItem('vex.shortcuts')).toBeNull(); // stock set
    expect(calls.style).toContain('glass');
    expect(localStorage.getItem('vex.setupProfile')).toBe('owner');
  });

  it('Custom hides exactly the unchecked panels and keeps chosen shortcuts', () => {
    stubEnv();
    Onboarding._applySetupProfile({
      profile: 'custom',
      panels: ['discord', 'spotify'],
      shortcuts: ['Google', 'Reddit'],
      glass: true,
    });
    const ov = overrides();
    expect(ov.discord).toBeUndefined();
    expect(ov.spotify).toBeUndefined();
    expect(ov.whatsapp?.hidden).toBe(true);
    expect(ov.netflix?.hidden).toBe(true);
    const sc = JSON.parse(localStorage.getItem('vex.shortcuts'));
    expect(sc.map(s => s.name)).toEqual(['Google', 'Reddit']);
    expect(localStorage.getItem('vex.setupProfile')).toBe('custom');
  });
});

describe('Language + daily-wisdom steps', () => {
  it('are steps, in order, right after theme', () => {
    const keys = Onboarding.STEPS().map(s => s.key);
    const themeIdx = keys.indexOf('theme');
    expect(keys[themeIdx + 1]).toBe('language');
    expect(keys[themeIdx + 2]).toBe('wisdom');
  });

  it('_isStepDone reflects saved language / wisdom choices', () => {
    expect(Onboarding._isStepDone('language')).toBe(false);
    expect(Onboarding._isStepDone('wisdom')).toBe(false);
    localStorage.setItem('vex.lang', 'tr');
    localStorage.setItem('vex.wisdomSource', 'bible');
    expect(Onboarding._isStepDone('language')).toBe(true);
    expect(Onboarding._isStepDone('wisdom')).toBe(true);
  });

  it('language step renders both options and records the click', () => {
    Onboarding._session = {};
    const body = document.createElement('div');
    Onboarding._renderBody('language', body);
    const opts = [...body.querySelectorAll('[data-lang]')].map(b => b.dataset.lang);
    expect(opts).toEqual(['en', 'tr']);
    body.querySelector('[data-lang="tr"]').click();
    expect(Onboarding._pendingLang).toBe('tr');
  });

  it('wisdom step offers all five sources (Qur’an, Bible, Tanakh, Quotes, None)', () => {
    Onboarding._session = {};
    const body = document.createElement('div');
    Onboarding._renderBody('wisdom', body);
    const opts = [...body.querySelectorAll('[data-wisdom]')].map(b => b.dataset.wisdom);
    expect(opts).toEqual(['quran', 'bible', 'tanakh', 'secular', 'off']);
    body.querySelector('[data-wisdom="off"]').click();
    expect(Onboarding._pendingWisdom).toBe('off');
  });

  it('committing writes vex.lang / vex.wisdomSource and clears the ayah cache', async () => {
    Onboarding._session = {};
    localStorage.setItem('vex.quranVerse', '{"day":1}');
    const render = vi.spyOn(Onboarding, '_render').mockImplementation(() => {});
    const overlay = document.createElement('div');
    overlay.innerHTML = '<div id="ob-body"></div>';
    Onboarding._pendingLang = 'tr';
    await Onboarding._commitAndNext('language', overlay);
    expect(localStorage.getItem('vex.lang')).toBe('tr');
    Onboarding._pendingWisdom = 'tanakh';
    await Onboarding._commitAndNext('wisdom', overlay);
    expect(localStorage.getItem('vex.wisdomSource')).toBe('tanakh');
    expect(localStorage.getItem('vex.quranVerse')).toBeNull();
    render.mockRestore();
  });
});

describe('Shareable setup codes', () => {
  const stubEnv = (glass = 'glass') => {
    globalThis.window.VexGuiStyle = {
      set: vi.fn(), get: () => glass, render: vi.fn(),
      defaults: () => [{ name: 'Google', url: 'https://www.google.com' }],
    };
    globalThis.SidebarManager = { applyPanelOverrides: vi.fn() };
    globalThis.ThemeManager = { THEMES: [{ id: 'oxford', label: 'Oxford' }], applyTheme: vi.fn() };
  };

  it('encode → decode roundtrips the current setup', () => {
    stubEnv('glass');
    localStorage.setItem('vex.theme', 'oxford');
    localStorage.setItem('vex.panelOverrides', JSON.stringify({ netflix: { hidden: true }, roblox: { hidden: true }, discord: { name: 'DC' } }));
    localStorage.setItem('vex.shortcuts', JSON.stringify([{ name: 'Google', url: 'https://www.google.com' }]));
    const code = Onboarding._encodeSetupCode();
    expect(code.startsWith('VEXSETUP1.')).toBe(true);
    const d = Onboarding._decodeSetupCode(code);
    expect(d).toEqual({
      theme: 'oxford',
      glass: true,
      hidden: expect.arrayContaining(['netflix', 'roblox']),
      shortcuts: [{ name: 'Google', url: 'https://www.google.com' }],
    });
    expect(d.hidden).toHaveLength(2); // discord (rename only) is NOT hidden
  });

  it('rejects garbage, wrong prefix, and non-JSON payloads', () => {
    expect(Onboarding._decodeSetupCode('')).toBeNull();
    expect(Onboarding._decodeSetupCode('hello')).toBeNull();
    expect(Onboarding._decodeSetupCode('VEXSETUP2.abc')).toBeNull();
    expect(Onboarding._decodeSetupCode('VEXSETUP1.!!!')).toBeNull();
    expect(Onboarding._decodeSetupCode('VEXSETUP1.' + btoa('not json').replace(/=+$/, ''))).toBeNull();
  });

  it('sanitizes: unknown panels dropped, non-http shortcut URLs stripped', () => {
    const evil = 'VEXSETUP1.' + btoa(JSON.stringify({
      v: 1, theme: 'x"y', glass: true,
      hidden: ['discord', 'settings', '__proto__', 'downloads'],
      shortcuts: [{ name: 'ok', url: 'https://ok.example' }, { name: 'bad', url: 'javascript:alert(1)' }, { url: 42 }],
    })).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const d = Onboarding._decodeSetupCode(evil);
    expect(d.hidden).toEqual(['discord']);   // only real app panels survive
    expect(d.shortcuts).toEqual([{ name: 'ok', url: 'https://ok.example' }]);
    expect(d.theme).toBeNull();              // invalid theme id rejected
  });

  it('_applySetupCode applies panels, shortcuts, look, theme, and marks the profile imported', () => {
    stubEnv('classic');
    Onboarding._applySetupCode({
      theme: 'oxford', glass: true, hidden: ['whatsapp', 'netflix'],
      shortcuts: [{ name: 'G', url: 'https://g.example' }],
    });
    const ov = JSON.parse(localStorage.getItem('vex.panelOverrides'));
    expect(ov.whatsapp.hidden).toBe(true);
    expect(ov.netflix.hidden).toBe(true);
    expect(JSON.parse(localStorage.getItem('vex.shortcuts'))).toEqual([{ name: 'G', url: 'https://g.example' }]);
    expect(window.VexGuiStyle.set).toHaveBeenCalledWith('glass');
    expect(globalThis.ThemeManager.applyTheme).toHaveBeenCalledWith('oxford');
    expect(localStorage.getItem('vex.setupProfile')).toBe('imported');
  });

  it('an unknown theme id in a code is ignored (no applyTheme call)', () => {
    stubEnv('classic');
    Onboarding._applySetupCode({ theme: 'not-a-theme', glass: false, hidden: [], shortcuts: null });
    expect(globalThis.ThemeManager.applyTheme).not.toHaveBeenCalled();
  });

  it('an invalid code blocks Save & continue with an inline error', async () => {
    stubEnv();
    Onboarding._session = { setup: { profile: 'code', code: 'VEXSETUP1.garbage!!!' } };
    Onboarding.step = 1;
    const overlay = document.createElement('div');
    overlay.innerHTML = '<div id="ob-body"></div><div id="ob-setup-code-status"></div>';
    const render = vi.spyOn(Onboarding, '_render').mockImplementation(() => {});
    await Onboarding._commitAndNext('setupstyle', overlay);
    expect(Onboarding.step).toBe(1);   // did not advance
    expect(overlay.querySelector('#ob-setup-code-status').textContent).toContain('not a valid setup code');
    render.mockRestore();
  });
});

describe('Onboarding._setStart', () => {
  it('writes to host localStorage and pushes JS into live start-page webviews', () => {
    const calls = [];
    const fakeWv = { getURL: () => 'file:///x/renderer/start.html', executeJavaScript: (js) => { calls.push(js); return Promise.resolve(); } };
    const other = { getURL: () => 'https://example.com', executeJavaScript: () => { calls.push('SHOULD_NOT'); return Promise.resolve(); } };
    globalThis.WebviewManager.webviews.set('a', fakeWv);
    globalThis.WebviewManager.webviews.set('b', other);

    Onboarding._setStart('vex.userName', 'Alex');
    expect(localStorage.getItem('vex.userName')).toBe('Alex');
    expect(calls.some(c => c.includes('vex.userName') && c.includes('Alex'))).toBe(true);
    expect(calls).not.toContain('SHOULD_NOT');     // non-start pages untouched
  });

  it('null value removes the key', () => {
    localStorage.setItem('vex.githubUsername', 'old');
    Onboarding._setStart('vex.githubUsername', null);
    expect(localStorage.getItem('vex.githubUsername')).toBeNull();
  });
});

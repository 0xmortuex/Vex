// @vitest-environment jsdom
//
// Coverage for the first-run onboarding gate + start-page value mirroring.
// The wizard UI itself is exercised at runtime; here we lock the logic that
// decides WHEN it shows and that values reach both host + start-page storage.

import { describe, it, expect, beforeEach, vi } from 'vitest';

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

describe('Onboarding resume (relaunch)', () => {
  const ALL_MISSING = ['theme', 'name', 'weather', 'github', 'search', 'defaultbrowser', 'aicloud', 'ollama', 'ondevice', 'sync', 'passwords'];

  // Save a value for every step so the profile counts as fully configured.
  const completeAll = () => {
    localStorage.setItem('vex.theme', 'ocean');
    localStorage.setItem('vex.userName', 'Alex');
    localStorage.setItem('vex.weatherLoc', '{}');
    localStorage.setItem('vex.githubUsername', 'octocat');
    localStorage.setItem('vex.searchEngine', 'duckduckgo');
    localStorage.setItem('vex.defaultBrowserConfigured', 'true');
    localStorage.setItem('vex.aiWorkerUrl', 'https://x.workers.dev');
    localStorage.setItem('vex.syncWorkerUrl', 'https://s.workers.dev');
    localStorage.setItem('vex.vaultSeeded', 'true');
  };

  it('lists every optional step as missing on a clean profile', () => {
    expect(Onboarding._missingStepKeys()).toEqual(ALL_MISSING);
  });

  it('drops steps whose data is already saved', () => {
    localStorage.setItem('vex.theme', 'ocean');
    localStorage.setItem('vex.userName', 'Alex');
    expect(Onboarding._missingStepKeys()).not.toContain('theme');
    expect(Onboarding._missingStepKeys()).not.toContain('name');
    expect(Onboarding._missingStepKeys()).toContain('weather');
  });

  it('any one AI backend (cloud / local / on-device) clears all three AI steps', () => {
    for (const k of ['vex.aiWorkerUrl', 'vex.preferLocalAI', 'vex.preferOnDeviceAI']) {
      localStorage.clear();
      localStorage.setItem(k, k === 'vex.aiWorkerUrl' ? 'https://x.workers.dev' : 'true');
      const m = Onboarding._missingStepKeys();
      expect(m).not.toContain('aicloud');
      expect(m).not.toContain('ollama');
      expect(m).not.toContain('ondevice');
    }
  });

  it('shows all three AI steps when no backend is configured', () => {
    const m = Onboarding._missingStepKeys();
    expect(m).toEqual(expect.arrayContaining(['aicloud', 'ollama', 'ondevice']));
  });

  it('relaunch builds welcome + only-missing + done, and skips when nothing is missing', () => {
    completeAll();
    const render = vi.spyOn(Onboarding, '_render').mockImplementation(() => {});
    const toast = vi.fn(); globalThis.window.showToast = toast;
    Onboarding.relaunch();
    expect(render).not.toHaveBeenCalled();         // all set → no wizard
    expect(toast).toHaveBeenCalled();

    localStorage.removeItem('vex.githubUsername');   // one thing missing now
    Onboarding.relaunch();
    expect(render).toHaveBeenCalled();
    expect(Onboarding.activeSteps.map(s => s.key)).toEqual(['welcome', 'github', 'done']);
    render.mockRestore();
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

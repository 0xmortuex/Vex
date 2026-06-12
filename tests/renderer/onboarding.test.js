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

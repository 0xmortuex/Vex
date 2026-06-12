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
  it('lists every optional step as missing on a clean profile', () => {
    expect(Onboarding._missingStepKeys()).toEqual(['theme', 'name', 'weather', 'github', 'ai']);
  });

  it('drops steps whose data is already saved', () => {
    localStorage.setItem('vex.theme', 'ocean');
    localStorage.setItem('vex.userName', 'Alex');
    expect(Onboarding._missingStepKeys()).toEqual(['weather', 'github', 'ai']);
  });

  it('treats AI as done for any of cloud / local / on-device prefs', () => {
    localStorage.setItem('vex.preferOnDeviceAI', 'true');
    expect(Onboarding._missingStepKeys()).not.toContain('ai');
    localStorage.clear();
    localStorage.setItem('vex.preferLocalAI', 'true');
    expect(Onboarding._missingStepKeys()).not.toContain('ai');
    localStorage.clear();
    localStorage.setItem('vex.aiWorkerUrl', 'https://x.workers.dev');
    expect(Onboarding._missingStepKeys()).not.toContain('ai');
  });

  it('relaunch builds welcome + only-missing + done, and skips when nothing is missing', () => {
    localStorage.setItem('vex.theme', 'ocean');
    localStorage.setItem('vex.userName', 'Alex');
    localStorage.setItem('vex.weatherLoc', '{}');
    localStorage.setItem('vex.githubUsername', 'octocat');
    localStorage.setItem('vex.aiWorkerUrl', 'https://x.workers.dev');
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

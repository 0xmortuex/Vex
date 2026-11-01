// @vitest-environment jsdom
//
// With the sidebar answered "no" the starting-point step is left out: of the walk, of "Step n of N", of the time left and of Back.
import { describe, it, expect, beforeEach, vi } from 'vitest';

require('../../src/renderer/js/vex-utils.js');
require('../../src/renderer/js/vex-icons.js');
require('../../src/renderer/js/geo-search.js');
globalThis.VexSimpleMode = require('../../src/renderer/js/simple-mode.js').VexSimpleMode; // a top-level const in the app
const { Onboarding } = require('../../src/renderer/js/onboarding.js');

const label = () => document.getElementById('ob-progress-label').textContent;
const total = () => Number(/of (\d+)/.exec(label())[1]);
const keyAt = () => (Onboarding.activeSteps || Onboarding.STEPS())[Onboarding.step].key;

beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = '';
  Onboarding.step = 0; Onboarding._session = {}; Onboarding._perf = null; Onboarding.activeSteps = null;
  globalThis.WebviewManager = { webviews: new Map() };
  window.showToast = vi.fn();
  window.VexSidebarVisibility = { enabled: () => true, chosen: () => false, setEnabled: vi.fn() };
});

describe('the starting point with no sidebar', () => {
  for (const pace of ['quick', 'full']) {
    it(`is skipped in the ${pace} wizard when the sidebar answer is no, and back when it is yes`, () => {
      Onboarding._pace = pace;
      Onboarding.activeSteps = Onboarding._stepsForPace();
      Onboarding.step = Onboarding.activeSteps.findIndex(s => s.key === 'welcome');
      Onboarding._render();
      const withIt = total();
      expect(Onboarding.activeSteps.map(s => s.key)).toContain('setupstyle');
      Onboarding.step = Onboarding.activeSteps.findIndex(s => s.key === 'sidebar');
      Onboarding._session.sidebar = false;
      Onboarding._render();
      expect(total()).toBe(withIt - 1);
      Onboarding._move(1);
      expect(keyAt()).toBe('theme');
      Onboarding._render();
      expect(label()).toMatch(new RegExp('Step \\d+ of ' + (withIt - 1)));
      Onboarding._move(-1);
      expect(keyAt()).toBe('sidebar');
      // Changing to yes brings it back, in the count and in the walk.
      Onboarding._session.sidebar = true;
      Onboarding._render();
      expect(total()).toBe(withIt);
      Onboarding._move(1);
      expect(keyAt()).toBe('setupstyle');
      Onboarding._move(1);
      expect(keyAt()).toBe('theme');
      Onboarding._move(-1);
      expect(keyAt()).toBe('setupstyle');
    });
  }

  it('follows the card at once on the sidebar step and Skip does not count as a no', () => {
    Onboarding._pace = 'quick';
    Onboarding.activeSteps = Onboarding._stepsForPace();
    Onboarding.step = Onboarding.activeSteps.findIndex(s => s.key === 'sidebar');
    Onboarding._render();
    const n = total();
    document.querySelector('[data-sb-answer="no"]').click();
    expect(total()).toBe(n - 1);
    document.querySelector('[data-sb-answer="yes"]').click();
    expect(total()).toBe(n);
    document.querySelector('[data-sb-answer="no"]').click();
    document.getElementById('ob-skip').click();
    expect(keyAt()).toBe('setupstyle');
  });

  it('uses a saved "no" from an earlier run too, and the last step counts N of N', () => {
    window.VexSidebarVisibility = { enabled: () => false, chosen: () => true, setEnabled: vi.fn() };
    Onboarding._pace = 'full';
    Onboarding.activeSteps = Onboarding._stepsForPace();
    Onboarding.step = Onboarding.activeSteps.length - 1;
    Onboarding._render();
    expect(label()).toMatch(/^Step (\d+) of \1 /);
    expect(Onboarding.activeSteps.length - 1).toBe(total());
  });

  it('has one progress line and no dots, and the bar carries the numbers', () => {
    Onboarding._pace = 'full';
    Onboarding.activeSteps = Onboarding._stepsForPace();
    Onboarding.step = 3;
    Onboarding._render();
    const bar = document.getElementById('ob-progress-fill').parentElement;
    expect(bar.getAttribute('aria-valuemax')).toBe(String(total()));
    expect(document.querySelector('#ob-progress-label').parentElement.children.length).toBe(1);
  });
});

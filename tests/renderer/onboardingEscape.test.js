// @vitest-environment jsdom
//
// Escape in the setup used to finish the whole setup at once, also when it
// was pressed to close a drop-down (found 2026-10-10). It closes what is open
// first, and asks before skipping the rest.

import { describe, it, expect, beforeEach, vi } from 'vitest';

require('../../src/renderer/js/vex-utils.js');
require('../../src/renderer/js/vex-icons.js');
require('../../src/renderer/js/geo-search.js');
const { Onboarding } = require('../../src/renderer/js/onboarding.js');

const esc = (target) => target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
const flush = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };

beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = '';
  Onboarding._close?.();
  Onboarding.step = 0; Onboarding._session = {}; Onboarding._perf = null; Onboarding._askingSkip = false;
  globalThis.WebviewManager = { webviews: new Map() };
  window.showToast = vi.fn();
  globalThis.PrivacyPack = { cfg: { farble: false, httpsOnly: true, doh: 'off' }, setCfg: vi.fn(async () => {}) };
});

describe('Escape in the setup', () => {
  it('asks before skipping setup, and a no keeps it open', async () => {
    const finish = vi.spyOn(Onboarding, 'finish').mockImplementation(() => {});
    globalThis.vexConfirm = vi.fn(async () => false);
    Onboarding._render();
    esc(document.querySelector('#vex-onboarding button'));
    await flush();
    expect(globalThis.vexConfirm).toHaveBeenCalledTimes(1);
    expect(finish).not.toHaveBeenCalled();
    expect(document.getElementById('vex-onboarding')).toBeTruthy();
    globalThis.vexConfirm = vi.fn(async () => true);
    esc(document.querySelector('#vex-onboarding button'));
    await flush();
    expect(finish).toHaveBeenCalledTimes(1);
    finish.mockRestore();
  });

  it('on a drop-down, Escape is for the drop-down', async () => {
    const finish = vi.spyOn(Onboarding, 'finish').mockImplementation(() => {});
    globalThis.vexConfirm = vi.fn(async () => true);
    Onboarding._render();
    const sel = document.createElement('select');
    document.getElementById('ob-body').appendChild(sel);
    sel.focus();
    esc(sel);
    await flush();
    expect(globalThis.vexConfirm).not.toHaveBeenCalled();
    expect(finish).not.toHaveBeenCalled();
    finish.mockRestore();
  });

  it('an opened list is closed first', async () => {
    const finish = vi.spyOn(Onboarding, 'finish').mockImplementation(() => {});
    globalThis.vexConfirm = vi.fn(async () => true);
    Onboarding._render();
    const toggle = document.createElement('button');
    toggle.setAttribute('aria-expanded', 'true');
    toggle.addEventListener('click', () => toggle.setAttribute('aria-expanded', 'false'));
    document.getElementById('ob-body').appendChild(toggle);
    esc(document.querySelector('#vex-onboarding button'));
    await flush();
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(globalThis.vexConfirm).not.toHaveBeenCalled();
    expect(finish).not.toHaveBeenCalled();
    finish.mockRestore();
  });
});

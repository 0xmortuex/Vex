// @vitest-environment jsdom
//
// Settings › General › Language. The language could only be changed by going
// through the whole setup again, and Simple mode hid even that (found
// 2026-10-10). The select does what the setup's language step does.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

require('../../src/renderer/js/vex-utils.js');
const { SettingsUI } = require('../../src/renderer/js/settings-ui.js');
const { Onboarding } = require('../../src/renderer/js/onboarding.js');
const { VexI18nUI } = require('../../src/renderer/js/i18n-ui.js');

beforeEach(() => {
  localStorage.clear();
  const html = readFileSync(path.join(__dirname, '../../src/renderer/index.html'), 'utf8');
  const doc = new DOMParser().parseFromString(html, 'text/html');
  document.body.innerHTML = doc.getElementById('panel-settings').outerHTML;
  window.Onboarding = Onboarding;
  window.showToast = vi.fn();
  globalThis.VexI18nUI = VexI18nUI;
});

describe('Settings › General › Language', () => {
  it('is in the General section, which Simple mode keeps', () => {
    const sel = document.getElementById('setting-language');
    expect(sel).toBeTruthy();
    expect([...sel.options].map(o => o.value)).toEqual(['en', 'tr']);
    const group = sel.closest('.setting-group');
    expect(group.querySelector('.setting-label').textContent.trim()).toBe('General');
    expect(SettingsUI.tierOf('General')).toBe('basic');
  });

  it('shows the language in force, and choosing one does what the setup step does', () => {
    localStorage.setItem('vex.lang', JSON.stringify('tr'));
    SettingsUI.enhance();
    const sel = document.getElementById('setting-language');
    expect(sel.value).toBe('tr');
    const changed = vi.fn();
    window.addEventListener('vex-lang-changed', changed);
    const reload = vi.spyOn(Onboarding, '_reloadStartPages');
    sel.value = 'en';
    sel.dispatchEvent(new Event('change'));
    expect(localStorage.getItem('vex.lang')).toBe('en');
    expect(changed).toHaveBeenCalledTimes(1);
    expect(reload).toHaveBeenCalled();
    window.removeEventListener('vex-lang-changed', changed);
  });

  it('the setup step goes through the same function', () => {
    const src = readFileSync(path.join(__dirname, '../../src/renderer/js/onboarding.js'), 'utf8');
    expect(src).toMatch(/key === 'language'\) \{[^}]*this\.setLanguage\(/);
  });

  it('refuses a language Vex has no translation for, out loud', () => {
    expect(() => Onboarding.setLanguage('de')).toThrow(/no "de" translation/);
  });
});

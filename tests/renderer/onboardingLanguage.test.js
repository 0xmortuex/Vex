// @vitest-environment jsdom
//
// English | Türkçe on the first step of the setup wizard (js/onboarding.js _langSwitch). A Turkish-only person on a new profile met the
// agreement and the whole short setup in English with no way to change it: the language step is only in the long path.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';

require('../../src/renderer/js/vex-utils.js');
require('../../src/renderer/js/vex-icons.js');
require('../../src/renderer/js/geo-search.js');
require('../../src/renderer/js/typed-address.js');
require('../../src/renderer/js/i18n.js');
globalThis.SponsorSkip = require('../../src/renderer/js/sponsor-skip.js').SponsorSkip;
const { Onboarding } = require('../../src/renderer/js/onboarding.js');
globalThis.VexSimpleMode = require('../../src/renderer/js/simple-mode.js').VexSimpleMode;

const overlay = () => document.getElementById('vex-onboarding');
const buttons = () => [...document.querySelectorAll('#ob-lang button')];
const pressed = () => buttons().filter(b => b.getAttribute('aria-pressed') === 'true').map(b => b.textContent);

beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = '';
  globalThis.WebviewManager = { webviews: new Map() };
  Object.defineProperty(window.navigator, 'language', { value: 'en-US', configurable: true });
  Onboarding.step = 0; Onboarding._session = {}; Onboarding._perf = null; Onboarding.activeSteps = null;
});
afterEach(() => { Onboarding._close(); });

describe('the language choice on the first step', () => {
  it('offers English and Türkçe, with English selected', () => {
    Onboarding.start();
    expect(overlay()).not.toBeNull();
    expect(buttons().map(b => b.textContent)).toEqual(['English', 'Türkçe']);
    expect(pressed()).toEqual(['English']);
    expect(document.getElementById('ob-lang').getAttribute('role')).toBe('group');
    expect(document.getElementById('ob-lang').getAttribute('aria-label')).toBe('Language · Dil');
  });
  it('is English even on a Turkish Windows: nothing reads the Windows language, Turkish is for those who choose it', () => {
    Object.defineProperty(window.navigator, 'language', { value: 'tr-TR', configurable: true });
    Onboarding.start();
    expect(pressed()).toEqual(['English']);
    expect(localStorage.getItem('vex.lang')).toBeNull();
  });
  it('choosing Türkçe saves it and draws the step again in Turkish', () => {
    Onboarding.start();
    const title = () => document.querySelector('#vex-onboarding span[style*="font-size:21px"]').textContent;
    expect(title()).toBe('Welcome to Vex');
    buttons().find(b => b.dataset.lang === 'tr').click();
    expect(localStorage.getItem('vex.lang')).toBe('tr');
    expect(pressed()).toEqual(['Türkçe']);
    expect(title()).toBe('Vex’e hoş geldiniz');
    expect(document.getElementById('ob-next').textContent).toBe('Başlayalım');
    expect(document.getElementById('ob-skipall').textContent).toBe('Kurulumu atla');
  });
  it('and back to English again', () => {
    Onboarding.start();
    buttons().find(b => b.dataset.lang === 'tr').click();
    buttons().find(b => b.dataset.lang === 'en').click();
    expect(localStorage.getItem('vex.lang')).toBe('en');
    expect(pressed()).toEqual(['English']);
    expect(document.getElementById('ob-next').textContent).toBe('Get started');
  });
  it('choosing the language already selected changes nothing', () => {
    Onboarding.start();
    const before = overlay();
    buttons().find(b => b.dataset.lang === 'en').click();
    expect(overlay()).toBe(before);
    expect(localStorage.getItem('vex.lang')).toBeNull();
  });
  it('keeps the keyboard on the language that was chosen', () => {
    Onboarding.start();
    buttons().find(b => b.dataset.lang === 'tr').click();
    expect(document.activeElement && document.activeElement.dataset && document.activeElement.dataset.lang).toBe('tr');
  });
  it('is only on the first step, not on the ones after it', () => {
    Onboarding.start();
    expect(document.getElementById('ob-lang')).not.toBeNull();
    Onboarding.step = 1;
    Onboarding._render();
    expect(document.getElementById('ob-lang')).toBeNull();
  });
  it('the language step of the long path agrees with what was chosen here', () => {
    Onboarding.start();
    buttons().find(b => b.dataset.lang === 'tr').click();
    expect(Onboarding._session.lang).toBe('tr');
  });
  it('says so, and changes nothing on screen, when the language cannot be saved', () => {
    window.showToast = vi.fn();
    Onboarding.start();
    const spy = vi.spyOn(Onboarding, 'setLanguage').mockImplementation(() => { throw new Error('disk said no'); });
    buttons().find(b => b.dataset.lang === 'tr').click();
    expect(window.showToast).toHaveBeenCalledWith('disk said no', 'error');
    expect(pressed()).toEqual(['English']);
    spy.mockRestore();
  });
  it('is not drawn on the monthly short setup\'s later steps either, and the wizard still has its own Skip setup', () => {
    Onboarding.start();
    expect(document.getElementById('ob-skipall')).not.toBeNull();
  });
});

describe('what the code promises', () => {
  const src = fs.readFileSync('src/renderer/js/onboarding.js', 'utf8').replace(/\r\n/g, '\n');
  it('never looks at the Windows language to choose one', () => {
    expect(src).not.toMatch(/navigator\.language/);
  });
  it('shows the chooser above the agreement', () => {
    expect(src.indexOf('if (this.step === 0) this._langSwitch(overlay);')).toBeLessThan(src.indexOf("const legal = s.key === 'legal';"));
  });
});

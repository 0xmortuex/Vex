// @vitest-environment jsdom
//
// The privacy policy and terms must be agreed to before Vex is used: the
// first step of the setup wizard on a new profile, a dialog over the window
// for a profile that accepted an older version (or none). Only "I agree" and
// "Quit Vex" leave it; Escape, Skip and "Skip setup" do not.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

const root = path.join(__dirname, '../..');
const read = (f) => readFileSync(path.join(root, f), 'utf8');

require('../../src/renderer/js/vex-utils.js');
require('../../src/renderer/js/vex-icons.js');
require('../../src/renderer/js/geo-search.js');
require('../../src/renderer/js/vex-markdown.js');
require('../../src/renderer/js/i18n.js');
const { VexLegal } = require('../../src/renderer/js/legal.js');
globalThis.VexLegal = VexLegal;   // a top-level const in the app
const { Onboarding } = require('../../src/renderer/js/onboarding.js');
globalThis.Onboarding = Onboarding;

const key = (target, k) => target.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
const flush = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };

beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = '';
  Onboarding._close();
  document.getElementById('vex-legal')?.remove();
  Onboarding.step = 0; Onboarding.activeSteps = null; Onboarding._session = {}; Onboarding._askingSkip = false;
  globalThis.WebviewManager = { webviews: new Map() };
  window.showToast = vi.fn();
  window.VexTabPolicy = undefined;
  globalThis.vexConfirm = vi.fn(async () => true);
  window.vex = { quitApp: vi.fn(async () => ({ ok: true })), legalGate: vi.fn(), legalRead: vi.fn(async (name) => '# ' + name + '\n\nSee [the terms](https://github.com/0xmortuex/Vex/blob/main/TERMS.md).') };
});

describe('the documents and the version constant', () => {
  it('VERSION and DATE are the ones written at the top of PRIVACY.md and TERMS.md', () => {
    for (const doc of ['PRIVACY.md', 'TERMS.md']) {
      const head = read(doc).split('\n').slice(0, 12).join('\n');
      expect(head, doc).toMatch(new RegExp('^Document version: ' + VexLegal.VERSION + '$', 'm'));
      expect(head, doc).toMatch(new RegExp('^Last updated: ' + VexLegal.DATE + '$', 'm'));
    }
  });

  it('what changed is listed in both languages, and the summary has 6 to 10 points', () => {
    expect(VexLegal.CHANGES.en.length).toBeGreaterThan(0);
    expect(VexLegal.CHANGES.tr).toHaveLength(VexLegal.CHANGES.en.length);
    expect(VexLegal.SUMMARY.en.length).toBeGreaterThanOrEqual(6);
    expect(VexLegal.SUMMARY.en.length).toBeLessThanOrEqual(10);
    expect(VexLegal.SUMMARY.tr).toHaveLength(VexLegal.SUMMARY.en.length);
  });

  it('every string it shows has a Turkish translation', () => {
    const used = new Set([...read('src/renderer/js/legal.js').matchAll(/_t\('(legal[A-Za-z]+)'/g), ...read('src/renderer/js/onboarding.js').matchAll(/t\('(legal[A-Za-z]+)'/g)].map(m => m[1]));
    expect(used.size).toBeGreaterThan(10);
    const tr = window.VexI18n.strings.tr;
    expect([...used].filter(k => !tr[k])).toEqual([]);
    expect(tr.legal && tr['legal.sub']).toBeTruthy();
  });

  it('ships the documents in the package and loads legal.js before the wizard', () => {
    const files = JSON.parse(read('package.json')).build.files;
    expect(files).toEqual(expect.arrayContaining(['PRIVACY.md', 'TERMS.md']));
    const html = read('src/renderer/index.html');
    expect(html.indexOf('<script src="js/legal.js">')).toBeGreaterThan(0);
    expect(html.indexOf('<script src="js/legal.js">')).toBeLessThan(html.indexOf('<script src="js/onboarding.js">'));
    expect(html.indexOf('css/legal.css')).toBeLessThan(html.indexOf('css/a11y.css'));
  });
});

describe('a new profile: the wizard asks first', () => {
  it('starts with the agreement, which has no Skip, Back or Skip setup', () => {
    Onboarding.start();
    const overlay = document.getElementById('vex-onboarding');
    expect(Onboarding.activeSteps[0].key).toBe('legal');
    expect(overlay.querySelector('[role="dialog"][aria-modal="true"]')).toBeTruthy();
    expect(overlay.querySelector('#ob-skip')).toBeNull();
    expect(overlay.querySelector('#ob-back')).toBeNull();
    expect(overlay.querySelector('#ob-skipall')).toBeNull();
    expect(overlay.querySelector('#ob-next').textContent).toBe('I agree');
    expect(overlay.querySelector('#ob-quit').textContent).toBe('Quit Vex');
    expect(overlay.querySelectorAll('.vex-legal-list li').length).toBe(VexLegal.SUMMARY.en.length);
  });

  it('Escape does not skip past it', async () => {
    const finish = vi.spyOn(Onboarding, 'finish');
    Onboarding.start();
    key(document.querySelector('#vex-onboarding button'), 'Escape');
    await flush();
    expect(globalThis.vexConfirm).not.toHaveBeenCalled();
    expect(finish).not.toHaveBeenCalled();
    expect(document.querySelector('#vex-onboarding #ob-quit')).toBeTruthy();
    expect(VexLegal.needed()).toBe(true);
    finish.mockRestore();
  });

  it('I agree records the version and the date, and the walk goes on without it', async () => {
    Onboarding.start();
    document.querySelector('#ob-next').click();
    await flush();
    expect(localStorage.getItem('vex.legalAcceptedVersion')).toBe(String(VexLegal.VERSION));
    expect(Date.parse(localStorage.getItem('vex.legalAcceptedAt'))).not.toBeNaN();
    expect(Onboarding.activeSteps.map(s => s.key)).not.toContain('legal');
    expect(Onboarding.activeSteps[Onboarding.step].key).toBe('welcome');
    expect(document.querySelector('#vex-onboarding #ob-back')).toBeNull();   // nothing to go back to
    expect(document.querySelector('#vex-onboarding #ob-skipall')).toBeTruthy();
  });

  it('Quit Vex quits', () => {
    Onboarding.start();
    document.querySelector('#ob-quit').click();
    expect(window.vex.quitApp).toHaveBeenCalledTimes(1);
    expect(VexLegal.needed()).toBe(true);
  });

  it('is left out once accepted, and in a private window', () => {
    localStorage.setItem('vex.legalAcceptedVersion', String(VexLegal.VERSION));
    expect(Onboarding.STEPS().map(s => s.key)).not.toContain('legal');
    localStorage.clear();
    window.VexTabPolicy = { isPrivateWindow: true };
    expect(Onboarding.STEPS().map(s => s.key)).not.toContain('legal');
  });
});

describe('an existing profile: a dialog over the window, once per version', () => {
  const pastWizard = () => localStorage.setItem('vex.onboardingDone', 'true');

  it('asks a profile that accepted nothing or an older version, with what changed', () => {
    pastWizard();
    expect(VexLegal.maybeAsk()).toBe(true);
    const card = document.querySelector('#vex-legal [role="dialog"]');
    expect(card.getAttribute('aria-modal')).toBe('true');
    expect(card.getAttribute('aria-labelledby')).toBe('vex-legal-title');
    expect(document.activeElement).toBe(card);
    // Start-up focusing the address bar behind it does not take focus away.
    const behind = document.createElement('input'); document.body.prepend(behind);
    behind.focus();
    expect(document.activeElement).toBe(card);
    behind.remove();
    expect(card.querySelector('#vex-legal-changes').textContent).toBe('What changed');
    expect(card.querySelectorAll('.vex-legal-list')[0].children.length).toBe(VexLegal.CHANGES.en.length);
    document.getElementById('vex-legal').remove();
    localStorage.setItem('vex.legalAcceptedVersion', String(VexLegal.VERSION - 1));
    expect(VexLegal.maybeAsk()).toBe(true);
  });

  it('does not ask once this version is accepted, in a private window, or before the wizard', () => {
    expect(VexLegal.maybeAsk()).toBe(false);                 // the wizard will ask
    pastWizard();
    window.VexTabPolicy = { isPrivateWindow: true };
    expect(VexLegal.maybeAsk()).toBe(false);
    window.VexTabPolicy = undefined;
    localStorage.setItem('vex.legalAcceptedVersion', String(VexLegal.VERSION));
    expect(VexLegal.maybeAsk()).toBe(false);
    expect(document.getElementById('vex-legal')).toBeNull();
  });

  it('Escape and a click beside it leave it open; I agree closes it and records the version', () => {
    pastWizard();
    VexLegal.maybeAsk();
    const overlay = document.getElementById('vex-legal');
    key(overlay.querySelector('[data-legal-agree]'), 'Escape');
    overlay.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    overlay.click();
    expect(document.getElementById('vex-legal')).toBeTruthy();
    const heard = vi.fn();
    window.addEventListener('vex-legal-accepted', heard, { once: true });
    overlay.querySelector('[data-legal-agree]').click();
    expect(document.getElementById('vex-legal')).toBeNull();
    expect(VexLegal.acceptedVersion()).toBe(VexLegal.VERSION);
    expect(heard).toHaveBeenCalledTimes(1);
    expect(VexLegal.maybeAsk()).toBe(false);
  });

  it('Quit Vex quits without accepting', () => {
    pastWizard();
    VexLegal.maybeAsk();
    document.querySelector('#vex-legal [data-legal-quit]').click();
    expect(window.vex.quitApp).toHaveBeenCalledTimes(1);
    expect(VexLegal.needed()).toBe(true);
  });
});

describe('reading the documents inside Vex', () => {
  it('opens a shipped document over the agreement; Escape closes only the document', async () => {
    localStorage.setItem('vex.onboardingDone', 'true');
    VexLegal.maybeAsk();
    document.querySelector('#vex-legal [data-legal-open="PRIVACY.md"]').click();
    await flush();
    const sheet = document.getElementById('vex-legal-doc');
    expect(window.vex.legalRead).toHaveBeenCalledWith('PRIVACY.md');
    expect(sheet.querySelector('[role="dialog"]').getAttribute('aria-modal')).toBe('true');
    expect(sheet.querySelector('.vex-legal-doc-body h1, .vex-legal-doc-body .vex-md-h1').textContent).toContain('PRIVACY.md');
    // A link to the other document opens it in the same sheet.
    sheet.querySelector('.vex-md-link').click();
    await flush();
    expect(window.vex.legalRead).toHaveBeenLastCalledWith('TERMS.md');
    key(document.activeElement, 'Escape');
    expect(document.getElementById('vex-legal-doc')).toBeNull();
    expect(document.getElementById('vex-legal')).toBeTruthy();
  });

  it('refuses any other file', async () => {
    await expect(VexLegal.openDoc('../secret.txt')).rejects.toThrow(/Not one of/);
    expect(window.vex.legalRead).not.toHaveBeenCalled();
  });

  it('Settings › About says when it was accepted', () => {
    document.body.innerHTML = '<p id="setting-legal-accepted"></p>';
    VexLegal.renderAbout();
    expect(document.getElementById('setting-legal-accepted').textContent).toMatch(/not accepted yet/);
    VexLegal.accept();
    VexLegal.renderAbout();
    expect(document.getElementById('setting-legal-accepted').textContent).toMatch(new RegExp('version ' + VexLegal.VERSION + '\\) accepted on '));
  });

  it('the About line follows a language change at once (it stayed in the old language, found 2026-10-11)', () => {
    document.body.innerHTML = '<p id="setting-legal-accepted"></p>';
    VexLegal.accept();
    VexLegal.renderAbout();
    localStorage.setItem('vex.lang', 'tr');
    window.dispatchEvent(new CustomEvent('vex-lang-changed'));
    expect(document.getElementById('setting-legal-accepted').textContent).toMatch(/kabul edildi/);
  });
});

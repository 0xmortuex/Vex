// @vitest-environment jsdom
//
// While the agreement is up (the setup's "Before you start" step, or the
// "privacy policy and terms have changed" dialog), Vex's own keys did not
// stop: Ctrl+T opened a tab behind it (release check, 2026-10-12). Now no
// Vex key or command reaches anything but the agreement: Tab, Enter and
// Space work its buttons, Escape does nothing there, the reader opens and
// closes, and main is told so its own keys stand aside too
// (src/main/agreement-gate.js).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

require('../../src/renderer/js/vex-utils.js');
require('../../src/renderer/js/vex-icons.js');
require('../../src/renderer/js/geo-search.js');
require('../../src/renderer/js/vex-markdown.js');
require('../../src/renderer/js/i18n.js');
// Vex's shortcut registry listens on the document, in the capture phase
// (js/shortcuts-registry.js), and is loaded before legal.js.
const heard = [];
document.addEventListener('keydown', (e) => heard.push(e.key), true);
const { VexLegal } = require('../../src/renderer/js/legal.js');
globalThis.VexLegal = VexLegal;
const { Onboarding } = require('../../src/renderer/js/onboarding.js');
globalThis.Onboarding = Onboarding;

const key = (target, k, mods = {}) => {
  const e = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...mods });
  target.dispatchEvent(e);
  return e;
};
const flush = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };

// The keys a person would try to get past it with.
const VEX_KEYS = [
  ['t', { ctrlKey: true }], ['k', { ctrlKey: true }], ['n', { ctrlKey: true, altKey: true }], ['N', { ctrlKey: true, shiftKey: true }],
  ['w', { ctrlKey: true }], ['l', { ctrlKey: true }], ['h', { ctrlKey: true }], ['b', { ctrlKey: true }], ['1', { ctrlKey: true }],
  ['Tab', { ctrlKey: true }], ['F5', {}], ['F6', {}], ['F11', {}], ['Home', { altKey: true }], ['ArrowLeft', { altKey: true }],
  ['ContextMenu', {}], ['F10', { shiftKey: true }], ['a', {}],
];

let gate;
beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = '<input id="url-input">';
  Onboarding._close();
  document.getElementById('vex-legal')?.remove();
  document.getElementById('vex-legal-doc')?.remove();
  VexLegal.gateChanged();
  Onboarding.step = 0; Onboarding.activeSteps = null; Onboarding._session = {}; Onboarding._askingSkip = false;
  globalThis.WebviewManager = { webviews: new Map() };
  window.showToast = vi.fn();
  window.VexTabPolicy = undefined;
  globalThis.vexConfirm = vi.fn(async () => true);
  gate = [];
  window.vex = {
    quitApp: vi.fn(async () => ({ ok: true })),
    legalRead: vi.fn(async (name) => '# ' + name + '\n\nText.'),
    legalGate: vi.fn((up) => gate.push(up)),
  };
  heard.length = 0;
});
afterEach(() => { document.getElementById('vex-legal')?.remove(); Onboarding._close(); });

function expectBlocked(target) {
  for (const [k, mods] of VEX_KEYS) {
    heard.length = 0;
    const e = key(target, k, mods);
    expect(heard, k + JSON.stringify(mods)).toEqual([]);
    expect(e.defaultPrevented, k + JSON.stringify(mods)).toBe(true);
  }
}

describe('the "changed" dialog over the window', () => {
  beforeEach(() => { localStorage.setItem('vex.onboardingDone', 'true'); VexLegal.maybeAsk(); });

  it('no Vex key reaches Vex, from the dialog or from what was focused behind it', () => {
    expectBlocked(document.querySelector('#vex-legal [data-legal-agree]'));
    expectBlocked(document.getElementById('url-input'));
    expectBlocked(document.body);
  });

  it('Tab, Shift+Tab, Enter and Space still work its buttons; Escape does nothing', () => {
    const agree = document.querySelector('#vex-legal [data-legal-agree]');
    for (const [k, mods] of [['Tab', {}], ['Tab', { shiftKey: true }], ['Enter', {}], [' ', {}]]) {
      heard.length = 0;
      key(agree, k, mods);
      expect(heard, k).toEqual([k]);
    }
    key(agree, 'Escape');
    expect(document.getElementById('vex-legal')).toBeTruthy();
  });

  it('the documents open and close from the keyboard over it', async () => {
    document.querySelector('#vex-legal [data-legal-open="TERMS.md"]').click();
    await flush();
    const body = document.querySelector('#vex-legal-doc .vex-legal-doc-body');
    heard.length = 0;
    key(body, 'PageDown');
    expect(heard).toEqual(['PageDown']);
    expectBlocked(body);
    key(document.activeElement, 'Escape');
    expect(document.getElementById('vex-legal-doc')).toBeNull();
    expect(document.getElementById('vex-legal')).toBeTruthy();
  });

  it('main is told when it is up and when it is gone; after I agree the keys work again', () => {
    expect(gate).toEqual([true]);
    document.querySelector('#vex-legal [data-legal-agree]').click();
    expect(gate).toEqual([true, false]);
    heard.length = 0;
    const e = key(document.getElementById('url-input'), 't', { ctrlKey: true });
    expect(heard).toEqual(['t']);
    expect(e.defaultPrevented).toBe(false);
  });
});

describe('the setup\'s "Before you start" step', () => {
  beforeEach(() => Onboarding.start());

  it('no Vex key reaches Vex', () => {
    expect(Onboarding.activeSteps[0].key).toBe('legal');
    expectBlocked(document.querySelector('#vex-onboarding #ob-next'));
    expectBlocked(document.getElementById('url-input'));
  });

  it('focus that lands behind it (start-up focuses the address bar) comes back to it', () => {
    document.getElementById('url-input').focus();
    expect(document.getElementById('vex-onboarding').contains(document.activeElement)).toBe(true);
  });

  it('main is told; once agreed, the rest of setup and Vex\'s keys are as before', async () => {
    expect(gate).toEqual([true]);
    document.querySelector('#ob-next').click();
    await flush();
    expect(Onboarding.activeSteps[Onboarding.step].key).toBe('welcome');
    expect(gate[gate.length - 1]).toBe(false);
    heard.length = 0;
    key(document.querySelector('#vex-onboarding button'), 't', { ctrlKey: true });
    expect(heard).toEqual(['t']);
  });

  it('Quit Vex still quits', () => {
    document.querySelector('#ob-quit').click();
    expect(window.vex.quitApp).toHaveBeenCalledTimes(1);
  });
});

it('with no agreement up nothing is held back', () => {
  localStorage.setItem('vex.legalAcceptedVersion', String(VexLegal.VERSION));
  heard.length = 0;
  for (const [k, mods] of VEX_KEYS) key(document.getElementById('url-input'), k, mods);
  expect(heard).toHaveLength(VEX_KEYS.length);
  expect(gate).toEqual([]);
});

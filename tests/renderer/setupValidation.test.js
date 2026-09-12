// @vitest-environment jsdom
//
// The setup wizard refuses to pretend that nothing is something.
//
// Every optional step used to accept an empty box, or a URL that was never
// going to work, and say nothing — so people finished setup believing they had
// configured things they hadn't, and the weather step quietly picked whichever
// place the geocoder happened to rank first. Now a step either has a usable
// answer or you press Skip deliberately.

import { describe, it, expect, beforeEach, vi } from 'vitest';

const MODULE = '../../src/renderer/js/onboarding.js';
delete require.cache[require.resolve(MODULE)];
require('../../src/renderer/js/vex-utils.js');
const { VexIcons } = require('../../src/renderer/js/vex-icons.js');
globalThis.VexIcons = VexIcons;
const { Onboarding } = require(MODULE);

// A stand-in for the wizard overlay: only the field the step under test uses.
function overlayWith(html) {
  document.body.innerHTML = `<div id="ov"><div id="ob-body">${html}</div></div>`;
  return document.getElementById('ov');
}

beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = '';
  Onboarding._pendingLoc = null;
  Onboarding._session = {};
  window.showToast = vi.fn();
});

describe('a blank answer is refused, not silently saved', () => {
  const blank = [
    ['name', '<input id="ob-name" value="   ">'],
    ['github', '<input id="ob-gh" value="">'],
    ['aicloud', '<input id="ob-ai-url" value="">'],
    ['sync', '<input id="ob-sync-url" value="">'],
    ['weather', '<input id="ob-city" value="">'],
  ];

  for (const [key, html] of blank) {
    it(`${key}: says it is empty and points at Skip`, () => {
      const ov = overlayWith(html);
      const problem = Onboarding._validate(key, ov);
      expect(problem, key).toBeTruthy();
      expect(problem.message).toMatch(/empty/i);
      expect(problem.message).toMatch(/Skip/);
    });
  }

  it('shows the message next to the field, marks it invalid, and clears on typing', () => {
    const ov = overlayWith('<input id="ob-name" value="">');
    Onboarding._showError(ov, Onboarding._validate('name', ov));

    const field = ov.querySelector('#ob-name');
    const note = ov.querySelector('#ob-error');
    expect(note).toBeTruthy();
    expect(note.getAttribute('role')).toBe('alert');
    expect(field.getAttribute('aria-invalid')).toBe('true');

    field.value = 'Alex';
    field.dispatchEvent(new Event('input', { bubbles: true }));
    expect(ov.querySelector('#ob-error')).toBeNull();
    expect(field.getAttribute('aria-invalid')).toBeNull();
  });

  it('only one message at a time, however many times you press it', () => {
    const ov = overlayWith('<input id="ob-name" value="">');
    Onboarding._showError(ov, Onboarding._validate('name', ov));
    Onboarding._showError(ov, Onboarding._validate('name', ov));
    expect(ov.querySelectorAll('#ob-error')).toHaveLength(1);
  });
});

describe('an invalid answer is refused with the reason', () => {
  it('rejects things that are not GitHub usernames', () => {
    for (const bad of ['@octocat', 'https://github.com/octocat', 'two words', '-lead', 'trail-', 'a--b']) {
      const ov = overlayWith(`<input id="ob-gh" value="${bad}">`);
      expect(Onboarding._validate('github', ov), bad).toBeTruthy();
    }
  });

  it('accepts real ones', () => {
    for (const ok of ['octocat', '0xmortuex', 'a-b', 'A1']) {
      const ov = overlayWith(`<input id="ob-gh" value="${ok}">`);
      expect(Onboarding._validate('github', ov), ok).toBeNull();
    }
  });

  it('rejects a worker address that is not a URL, and one that is not encrypted', () => {
    const notUrl = overlayWith('<input id="ob-ai-url" value="my worker">');
    expect(Onboarding._validate('aicloud', notUrl).message).toMatch(/not a web address/i);

    const plain = overlayWith('<input id="ob-ai-url" value="http://worker.example.com">');
    expect(Onboarding._validate('aicloud', plain).message).toMatch(/https/i);

    const good = overlayWith('<input id="ob-ai-url" value="https://w.workers.dev">');
    expect(Onboarding._validate('aicloud', good)).toBeNull();
  });

  it('allows a local worker over plain http — nothing leaves the machine', () => {
    const ov = overlayWith('<input id="ob-sync-url" value="http://localhost:8787">');
    expect(Onboarding._validate('sync', ov)).toBeNull();
  });

  it('refuses a name longer than the start page can show', () => {
    const ov = overlayWith(`<input id="ob-name" value="${'a'.repeat(41)}">`);
    expect(Onboarding._validate('name', ov).message).toMatch(/40/);
  });
});

describe('weather: typing is not choosing', () => {
  it('refuses to continue on typed text with nothing picked', () => {
    const ov = overlayWith('<input id="ob-city" value="Ataşehir">');
    const problem = Onboarding._validate('weather', ov);
    expect(problem).toBeTruthy();
    expect(problem.message).toMatch(/Pick one of the matches/i);
  });

  it('continues once a place has actually been picked', () => {
    const ov = overlayWith('<input id="ob-city" value="Ataşehir">');
    Onboarding._pendingLoc = { lat: 40.9, lon: 29.1, city: 'Ataşehir, İstanbul, TR' };
    expect(Onboarding._validate('weather', ov)).toBeNull();
  });
});

describe('steps that carry no free text are never blocked', () => {
  for (const key of ['welcome', 'setupstyle', 'theme', 'look', 'performance', 'job', 'language',
    'wisdom', 'search', 'defaultbrowser', 'ollama', 'ondevice', 'passwords', 'done']) {
    it(`${key} passes validation`, () => {
      expect(Onboarding._validate(key, overlayWith(''))).toBeNull();
    });
  }
});

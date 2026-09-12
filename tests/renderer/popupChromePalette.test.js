// @vitest-environment jsdom
//
// The chrome bar on a sign-in pop-up (renderer/popup-chrome.html) was dark
// whatever the theme. Main now reads the resolved tokens off the main window
// and sends them over; the bar applies them as CSS variables. Values reach CSS,
// so anything that isn't plain colour syntax is ignored.

import { describe, it, expect, beforeEach, vi } from 'vitest';

let onPalette;

beforeEach(() => {
  vi.resetModules();
  document.documentElement.removeAttribute('style');
  document.body.innerHTML = '<div id="url"></div><button data-act="close"></button>';
  window.popupChrome = {
    action: vi.fn(),
    onUrl: vi.fn(),
    onPalette: vi.fn((cb) => { onPalette = cb; }),
  };
  require('../../src/renderer/js/popup-chrome.js');
});

const v = (name) => document.documentElement.style.getPropertyValue(name);

describe('pop-up chrome bar palette', () => {
  it('takes the theme colours main sends', () => {
    onPalette({ surface: '#faf6ee', bg: '#fff', text: '#1f1c18', textMuted: 'rgb(106, 98, 83)', primary: '#1e3a5f', border: '#e2d9c6', danger: '#9c2a1a', bg2: '#f3ede0' });
    expect(v('--surface')).toBe('#faf6ee');
    expect(v('--text')).toBe('#1f1c18');
    expect(v('--text-muted')).toBe('rgb(106, 98, 83)');
    expect(v('--primary')).toBe('#1e3a5f');
    expect(v('--primary-hover')).toBe('color-mix(in srgb, #1e3a5f 82%, #000)');
  });

  it('ignores anything that is not a plain colour, keeping the default', () => {
    onPalette({ surface: 'url(evil.png);background:red', text: '', primary: 42, bg: '#101018' });
    expect(v('--surface')).toBe('');
    expect(v('--text')).toBe('');
    expect(v('--primary')).toBe('');
    expect(v('--primary-hover')).toBe('');
    expect(v('--bg')).toBe('#101018');   // the valid one still applies
  });
});

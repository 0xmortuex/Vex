// @vitest-environment jsdom
//
// Right-clicking the address bar did nothing (found 2026-10-10). It has the
// menu every browser has there: Cut and Copy for a selection, Paste, Paste
// and go, Select all.
import { describe, it, expect, beforeEach, vi } from 'vitest';
const { UrlBarMenu } = require('../../src/renderer/js/url-bar-menu.js');

let input, go, clip;
const flush = async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); };
const labels = () => [...document.querySelectorAll('.url-bar-menu .tab-context-item')].map(e => e.textContent);
const choose = async (label) => {
  [...document.querySelectorAll('.url-bar-menu .tab-context-item')].find(e => e.textContent === label).click();
  await flush();
};

beforeEach(() => {
  document.body.innerHTML = '<input id="url-input">';
  input = document.getElementById('url-input');
  globalThis.TabManager = { _dismissMenu: (m) => m.remove(), _clampMenuToViewport: vi.fn(), _attachMenuDismissal: vi.fn() };
  clip = 'https://pasted.example/';
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { readText: vi.fn(async () => clip), writeText: vi.fn(async (t) => { clip = t; }) } });
  go = vi.fn();
  window.showToast = vi.fn();
  UrlBarMenu.init(input, { onPasteAndGo: go });
});

const rightClick = () => input.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 10, clientY: 10 }));

describe('the address bar menu', () => {
  it('without a selection: Paste, Paste and go, Select all', () => {
    input.value = 'abc';
    input.setSelectionRange(3, 3);
    rightClick();
    expect(labels()).toEqual(['Paste', 'Paste and go', 'Select all']);
    // At the pointer, not the window's corner (seen live, Firefox look).
    const menu = document.querySelector('.url-bar-menu');
    expect([menu.style.left, menu.style.top]).toEqual(['10px', '10px']);
  });

  it('with a selection: Cut and Copy too, acting on it', async () => {
    input.value = 'https://example.com/';
    input.setSelectionRange(8, 19);
    rightClick();
    expect(labels()).toEqual(['Cut', 'Copy', 'Paste', 'Paste and go', 'Select all']);
    await choose('Copy');
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('example.com');
    input.setSelectionRange(8, 19);
    rightClick();
    await choose('Cut');
    expect(input.value).toBe('https:///');
  });

  it('Paste and go goes where the bar would', async () => {
    rightClick();
    await choose('Paste and go');
    expect(go).toHaveBeenCalledWith('https://pasted.example/');
  });

  it('Paste puts the text in, Select all selects', async () => {
    input.value = '';
    rightClick();
    await choose('Paste');
    expect(input.value).toBe('https://pasted.example/');
    rightClick();
    await choose('Select all');
    expect([input.selectionStart, input.selectionEnd]).toEqual([0, input.value.length]);
  });

  it('an empty clipboard says so', async () => {
    clip = '';
    rightClick();
    await choose('Paste and go');
    expect(go).not.toHaveBeenCalled();
    expect(window.showToast).toHaveBeenCalledWith(expect.stringContaining('clipboard is empty'), 'error');
  });
});

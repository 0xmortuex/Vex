// @vitest-environment jsdom
//
// What you type in Ctrl+K is shown as you typed it. The rows are drawn with
// textContent, but the "Go to", "Search" and calculator rows escaped the text
// first, so "a&b" read "a&amp;b" (found 2026-10-10).

import { describe, it, expect, beforeEach } from 'vitest';

window.escapeHtml = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
window.VexTypedAddress = require('../../src/renderer/js/typed-address.js');
const { CommandBar } = require('../../src/renderer/js/command.js');

const titles = () => [...document.querySelectorAll('.command-result-title')].map(e => e.textContent);

beforeEach(() => {
  document.body.innerHTML = '<div id="command-bar"><div id="command-results"></div></div>';
  globalThis.VexIcons = require('../../src/renderer/js/vex-icons.js').VexIcons;
  delete globalThis.VexCalc;
});

describe('Ctrl+K shows typed text as typed', () => {
  it('the Search row', () => {
    CommandBar.search('a&b <i>');
    expect(titles()).toContain('Search "a&b <i>"');
  });

  it('the Go to row', () => {
    CommandBar.search('example.com/?a=1&b=2');
    expect(titles()).toContain('Go to example.com/?a=1&b=2');
  });

  it('the calculator row', () => {
    globalThis.VexCalc = { evaluate: () => ({ text: '1 < 2 & true', value: '1' }) };
    CommandBar.search('1<2');
    expect(titles()).toContain('1 < 2 & true');
  });
});

// @vitest-environment jsdom
//
// Typing a page that is already open offers to switch to it, as Chrome does.
import { describe, it, expect, vi } from 'vitest';
require('../../src/renderer/js/vex-utils.js');
const { SmartSearchbar } = require('../../src/renderer/js/smart-searchbar.js');

describe('a page that is already open', () => {
  it('is offered as "Switch to tab", and choosing it goes there — closing the blank new tab — instead of opening it twice', async () => {
    vi.useFakeTimers();
    document.body.innerHTML = '<div id="url-bar-wrapper"><input id="url-input"></div>';
    const switched = [], closed = [], submitted = [];
    globalThis.isStartPage = (u) => /start\.html/.test(u);
    globalThis.TabManager = {
      tabs: [{ id: 'new', url: 'file:///start.html', title: 'New Tab' }, { id: 'gh', url: 'https://github.com/0xmortuex/Vex', title: 'Vex on GitHub' }],
      getActiveTab: () => ({ id: 'new', url: 'file:///start.html' }),
      switchTab: (id) => switched.push(id), closeTab: (id) => closed.push(id),
    };
    const input = document.getElementById('url-input');
    SmartSearchbar.init(input, { onSubmit: (u) => submitted.push(u) });
    input.value = 'github';
    input.dispatchEvent(new Event('input'));
    vi.advanceTimersByTime(500);
    const row = document.querySelector('#searchbar-suggestions');
    expect(row.textContent).toContain('Switch to tab');
    SmartSearchbar.handleKeydown(new KeyboardEvent('keydown', { key: 'ArrowDown' }));
    SmartSearchbar.handleKeydown(new KeyboardEvent('keydown', { key: 'Enter' }));
    expect(switched).toEqual(['gh']);
    expect(closed).toEqual(['new']);
    expect(submitted).toEqual([]);
    vi.useRealTimers();
  });
});

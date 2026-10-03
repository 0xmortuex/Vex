// @vitest-environment jsdom
//
// The command bar (Ctrl+K) to a screen reader: the box is a combobox that owns
// a listbox of results, and aria-activedescendant names the result the arrows
// highlight. Before, the highlight moved in silence.

import { describe, it, expect, beforeEach } from 'vitest';

const { CommandBar } = require('../../src/renderer/js/command.js');
globalThis.VexIcons = require('../../src/renderer/js/vex-icons.js').VexIcons;

const input = () => document.getElementById('command-input');
const list = () => document.getElementById('command-results');
const press = (key) => input().dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));

beforeEach(() => {
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};   // jsdom has no layout
  document.body.innerHTML = `
    <div id="command-overlay" style="display: none;">
      <div id="command-bar" role="dialog" aria-modal="true" aria-label="Command bar">
        <input type="text" id="command-input" aria-label="Address, search, or &gt; for a command">
        <div id="command-results"></div>
      </div>
    </div>`;
  CommandBar.init();
  CommandBar.isOpen = true;
  CommandBar.selectedIndex = 0;
  CommandBar.results = [
    { id: 'a', label: 'New Tab', hint: 'Open a new tab', shortcut: 'Ctrl+T', icon: 'plus', action() {} },
    { id: 'b', label: 'Bookmarks', icon: 'bookmark', action() {} },
    { id: 'c', label: 'Clock', hint: 'Alarms and timers', icon: 'clock', action() {} },
  ];
  CommandBar.renderResults();
});

describe('the command bar as a combobox', () => {
  it('ties the box to its list and names the highlighted result', () => {
    expect(input().getAttribute('role')).toBe('combobox');
    expect(input().getAttribute('aria-controls')).toBe('command-results');
    expect(input().getAttribute('aria-autocomplete')).toBe('list');
    expect(input().getAttribute('aria-expanded')).toBe('true');
    expect(list().getAttribute('role')).toBe('listbox');
    const opts = [...list().querySelectorAll('[role=option]')];
    expect(opts).toHaveLength(3);
    expect(input().getAttribute('aria-activedescendant')).toBe(opts[0].id);
    expect(opts.map(o => o.getAttribute('aria-selected'))).toEqual(['true', 'false', 'false']);
    // Named by the title; the hint and the key describe it.
    const first = opts[0];
    expect(document.getElementById(first.getAttribute('aria-labelledby')).textContent).toBe('New Tab');
    expect(first.getAttribute('aria-describedby').split(' ').map(id => document.getElementById(id).textContent)).toEqual(['Open a new tab', 'Ctrl+T']);
    expect(opts[1].hasAttribute('aria-describedby')).toBe(false);
    expect(first.querySelector('.command-result-icon').getAttribute('aria-hidden')).toBe('true');
  });

  it('moves the highlight with the arrows, as before, and says so', () => {
    press('ArrowDown');
    const opts = [...list().querySelectorAll('[role=option]')];
    expect(CommandBar.selectedIndex).toBe(1);
    expect(input().getAttribute('aria-activedescendant')).toBe(opts[1].id);
    expect(opts.map(o => o.getAttribute('aria-selected'))).toEqual(['false', 'true', 'false']);
    expect(opts[1].classList.contains('selected')).toBe(true);
    press('ArrowUp'); press('ArrowUp');
    expect(CommandBar.selectedIndex).toBe(2);
    expect(input().getAttribute('aria-activedescendant')).toBe(opts[2].id);
  });

  it('with nothing found, is not an empty listbox but a line that is read out', () => {
    CommandBar.results = [];
    CommandBar.renderResults();
    expect(list().hasAttribute('role')).toBe(false);
    expect(list().querySelector('[role=status]').textContent).toBe('No results found');
    expect(input().getAttribute('aria-expanded')).toBe('false');
    expect(input().hasAttribute('aria-activedescendant')).toBe(false);
  });

  it('closing collapses it', () => {
    CommandBar.close();
    expect(input().getAttribute('aria-expanded')).toBe('false');
    expect(input().hasAttribute('aria-activedescendant')).toBe(false);
  });
});

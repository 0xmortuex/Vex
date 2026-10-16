// @vitest-environment jsdom
//
// js/tab-mru.js (T1-014): the order, the cycle (step / commit / cancel), the
// list on screen, and the switch.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const { VexTabMru } = require('../../src/renderer/js/tab-mru.js');

const mk = (id, lastViewedAt, extra = {}) => ({ id, title: 'Tab ' + id, url: 'https://' + id + '.example/', lastViewedAt, ...extra });

function install(tabs, activeTabId) {
  const tm = {
    tabs,
    activeTabId,
    groups: [{ id: 'g1', name: 'Work' }],
    displayOrder() { return this.tabs.slice(); },
    switchTab: vi.fn(function (id) { this.activeTabId = id; }),
  };
  globalThis.TabManager = tm;
  return tm;
}

beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = '';
  window.vex = { setMruKeys: vi.fn(), onMruKey: vi.fn() };
  vi.useFakeTimers();
});
afterEach(() => {
  VexTabMru.cancel();
  vi.useRealTimers();
  delete globalThis.TabManager;
  delete window.vex;
});

describe('order', () => {
  it('puts the tab in front first, then the rest by last use, newest first', () => {
    const tabs = [mk('a', 10), mk('b', 50), mk('c', 30), mk('d', 40)];
    expect(VexTabMru.order(tabs, 'c').map(t => t.id)).toEqual(['c', 'b', 'd', 'a']);
  });
  it('keeps strip order among tabs never used, and puts them last', () => {
    const tabs = [mk('a', 0), mk('b', 20), mk('c', undefined), mk('d', 5)];
    expect(VexTabMru.order(tabs, 'b').map(t => t.id)).toEqual(['b', 'd', 'a', 'c']);
  });
  it('does not change the list it is given', () => {
    const tabs = [mk('a', 1), mk('b', 2)];
    VexTabMru.order(tabs, 'a');
    expect(tabs.map(t => t.id)).toEqual(['a', 'b']);
  });
});

describe('the cycle', () => {
  it('Ctrl+Tab selects the tab used before this one, and releasing Ctrl goes there', () => {
    const tm = install([mk('a', 10), mk('b', 30), mk('c', 20)], 'b');
    VexTabMru.step(1);
    expect(VexTabMru.selected().id).toBe('c');
    VexTabMru.commit();
    expect(tm.switchTab).toHaveBeenCalledWith('c');
    expect(document.getElementById('tab-mru')).toBeNull();
  });
  it('goes on down the list with more presses, and wraps', () => {
    install([mk('a', 10), mk('b', 30), mk('c', 20)], 'b');
    VexTabMru.step(1); VexTabMru.step(1);
    expect(VexTabMru.selected().id).toBe('a');
    VexTabMru.step(1);
    expect(VexTabMru.selected().id).toBe('b');
  });
  it('Ctrl+Shift+Tab starts at the least recently used tab', () => {
    install([mk('a', 10), mk('b', 30), mk('c', 20)], 'b');
    VexTabMru.step(-1);
    expect(VexTabMru.selected().id).toBe('a');
  });
  it('switches nothing while cycling, so the order of the others stays', () => {
    const tm = install([mk('a', 10), mk('b', 30), mk('c', 20)], 'b');
    VexTabMru.step(1); VexTabMru.step(1);
    expect(tm.switchTab).not.toHaveBeenCalled();
  });
  it('cancel stays where it is', () => {
    const tm = install([mk('a', 10), mk('b', 30)], 'b');
    VexTabMru.step(1);
    VexTabMru.cancel();
    expect(tm.switchTab).not.toHaveBeenCalled();
    expect(document.getElementById('tab-mru')).toBeNull();
    expect(VexTabMru.selected()).toBeNull();
  });
  it('commit with nothing started does nothing', () => {
    const tm = install([mk('a', 1), mk('b', 2)], 'a');
    expect(VexTabMru.commit()).toBeNull();
    expect(tm.switchTab).not.toHaveBeenCalled();
  });
  it('with one tab there is nothing to cycle', () => {
    install([mk('a', 1)], 'a');
    expect(VexTabMru.step(1)).toBe(false);
    expect(document.getElementById('tab-mru')).toBeNull();
  });
  it('does not switch to a tab that was closed while the list was up', () => {
    const tm = install([mk('a', 10), mk('b', 30), mk('c', 20)], 'b');
    VexTabMru.step(1);
    tm.tabs = tm.tabs.filter(t => t.id !== 'c');
    expect(VexTabMru.commit()).toBeNull();
    expect(tm.switchTab).not.toHaveBeenCalled();
  });
  it('a lost key-up still ends the cycle, ten seconds after the last step', () => {
    const tm = install([mk('a', 10), mk('b', 30)], 'b');
    VexTabMru.step(1);
    vi.advanceTimersByTime(VexTabMru.AUTO_COMMIT_MS - 1);
    expect(tm.switchTab).not.toHaveBeenCalled();
    vi.advanceTimersByTime(2);
    expect(tm.switchTab).toHaveBeenCalledWith('a');
  });
  it('every step pushes the ten seconds back', () => {
    const tm = install([mk('a', 10), mk('b', 30), mk('c', 20)], 'b');
    VexTabMru.step(1);
    vi.advanceTimersByTime(9000);
    VexTabMru.step(1);
    vi.advanceTimersByTime(9000);
    expect(tm.switchTab).not.toHaveBeenCalled();
  });
});

describe('messages from the main process', () => {
  it('runs step, commit and cancel', () => {
    const tm = install([mk('a', 10), mk('b', 30)], 'b');
    VexTabMru.onKey({ kind: 'step', dir: 1 });
    VexTabMru.onKey({ kind: 'commit' });
    expect(tm.switchTab).toHaveBeenCalledWith('a');
    VexTabMru.onKey({ kind: 'step', dir: -1 });
    VexTabMru.onKey({ kind: 'cancel' });
    expect(VexTabMru.selected()).toBeNull();
  });
  it('refuses a message it does not know', () => {
    expect(() => VexTabMru.onKey({ kind: 'fly' })).toThrow(/Unknown/);
    expect(() => VexTabMru.onKey({ kind: 'step', dir: 2 })).toThrow(/forward \(1\) or back \(-1\)/);
    expect(() => VexTabMru.onKey(null)).toThrow(/object/);
  });
  it('init listens and tells main whether the switch is on', () => {
    VexTabMru.init();
    expect(window.vex.onMruKey).toHaveBeenCalledTimes(1);
    expect(window.vex.setMruKeys).toHaveBeenCalledWith(true);
  });
  it('a failing message ends the list and is reported, not left up', () => {
    install([mk('a', 10), mk('b', 30)], 'b');
    VexTabMru.init();
    const listener = window.vex.onMruKey.mock.calls[0][0];
    listener({ kind: 'step', dir: 1 });
    expect(document.getElementById('tab-mru')).not.toBeNull();
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    listener({ kind: 'bogus' });
    expect(document.getElementById('tab-mru')).toBeNull();
    err.mockRestore();
  });
});

describe('the list on screen', () => {
  it('shows the tabs in order, marks the selected one, and tells a screen reader', () => {
    install([mk('a', 10, { pinned: true }), mk('b', 30), mk('c', 20, { audible: true })], 'b');
    VexTabMru.step(1);
    const rows = [...document.querySelectorAll('#tab-mru .tt-row')];
    expect(rows.map(r => r.dataset.tabId)).toEqual(['b', 'c', 'a']);
    expect(rows[1].classList.contains('selected')).toBe(true);
    expect(rows[1].getAttribute('aria-selected')).toBe('true');
    expect(document.querySelector('#tab-mru .tt-card').getAttribute('role')).toBe('listbox');
    expect(document.querySelector('#tab-mru .tt-card').getAttribute('aria-activedescendant')).toBe('tab-mru-row-1');
    expect(document.querySelector('#tab-mru .tt-sr').textContent).toBe('Tab c, 2 of 3');
  });
  it('shows a window of the list when there are many tabs, around the selection', () => {
    const tabs = Array.from({ length: 30 }, (_, i) => mk('t' + i, 1000 - i));
    install(tabs, 't0');
    for (let i = 0; i < 15; i++) VexTabMru.step(1);
    const rows = [...document.querySelectorAll('#tab-mru .tt-row')];
    expect(rows).toHaveLength(VexTabMru.MAX_ROWS);
    expect(rows.some(r => r.classList.contains('selected'))).toBe(true);
  });
  it('draws page text as text, never as markup', () => {
    install([mk('a', 10, { title: '<img src=x onerror=alert(1)>' }), mk('b', 30)], 'b');
    VexTabMru.step(1);
    expect(document.querySelector('#tab-mru img[src="x"]')).toBeNull();
    expect(document.querySelectorAll('#tab-mru .tt-title')[1].textContent).toBe('<img src=x onerror=alert(1)>');
  });
  it('describes a New Tab page and the group of a tab', () => {
    install([mk('a', 1, { groupId: 'g1', url: 'vex://start' }), mk('b', 2)], 'b');
    const d = VexTabMru.describe(globalThis.TabManager.tabs[0]);
    expect(d.host).toBe('New Tab');
    expect(d.group).toBe('Work');
  });
});

describe('the switch', () => {
  it('is on until switched off, and tells main both ways', () => {
    expect(VexTabMru.enabled()).toBe(true);
    VexTabMru.setEnabled(false);
    expect(VexTabMru.enabled()).toBe(false);
    expect(window.vex.setMruKeys).toHaveBeenLastCalledWith(false);
    VexTabMru.setEnabled(true);
    expect(window.vex.setMruKeys).toHaveBeenLastCalledWith(true);
    expect(localStorage.getItem('vex.tabMru')).toBe('1');
  });
  it('switching off closes a list that is up', () => {
    install([mk('a', 10), mk('b', 30)], 'b');
    VexTabMru.step(1);
    VexTabMru.setEnabled(false);
    expect(document.getElementById('tab-mru')).toBeNull();
  });
  it('takes the registry actions bound to Ctrl+Tab while on, so they do nothing a second time', () => {
    globalThis.ShortcutsRegistry = { getShortcut: (id) => ({ 'next-tab': 'Ctrl+Tab', 'prev-tab': 'Ctrl+Shift+Tab', 'other': 'Ctrl+Alt+Right' }[id] || null) };
    expect(VexTabMru.takes('next-tab')).toBe(true);
    expect(VexTabMru.takes('prev-tab')).toBe(true);
    expect(VexTabMru.takes('other')).toBe(false);
    VexTabMru.setEnabled(false);
    expect(VexTabMru.takes('next-tab')).toBe(false);
    delete globalThis.ShortcutsRegistry;
  });
  it('app.js hands Ctrl+Tab to the switcher while it is on', () => {
    const src = require('fs').readFileSync(require('path').resolve(__dirname, '../../src/renderer/js/app.js'), 'utf8');
    expect(src).toMatch(/register\('next-tab',[^\n]*VexTabMru\.takes\('next-tab'\)[^\n]*cycleTab\(1\)/);
    expect(src).toMatch(/register\('prev-tab',[^\n]*VexTabMru\.takes\('prev-tab'\)[^\n]*cycleTab\(-1\)/);
  });
  it('says so when the window bridge is missing', () => {
    delete window.vex;
    expect(() => VexTabMru.syncMain()).toThrow(/window bridge/);
  });
});

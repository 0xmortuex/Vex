// @vitest-environment jsdom
//
// js/strip-actions.js (T1-018): the buttons over a hovered tab, the empty-strip
// clicks, the wheel, return to the opener, and the new-tab menu.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

globalThis.VexIcons = { has: () => true, svg: (name) => '<svg data-icon="' + name + '"></svg>' };
const { VexStripActions } = require('../../src/renderer/js/strip-actions.js');

let tm;
function widths(el, w) { el.getBoundingClientRect = () => ({ left: 100, right: 100 + w, top: 4, bottom: 34, width: w, height: 30 }); }

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers();
  document.body.innerHTML = `
    <div id="top-tab-bar"><div id="top-tabs-list">
      <div class="top-tab" data-tab-id="t1"><span class="tab-title">One</span></div>
      <div class="top-tab pinned" data-tab-id="t2"></div>
      <div class="top-tab" data-tab-id="t3"></div>
    </div><button id="btn-new-tab-top">+</button></div>`;
  tm = {
    tabs: [{ id: 't1', title: 'One', url: 'https://one.example/', muted: false, pinned: false }, { id: 't2', title: 'Two', pinned: true }, { id: 't3', title: 'Three' }],
    activeTabId: 't1',
    toggleMuteTab: vi.fn(), togglePinTab: vi.fn(), duplicateTab: vi.fn(), closeOtherTabs: vi.fn(), createTab: vi.fn(), reopenLastClosed: vi.fn(), cycleTab: vi.fn(),
    isOnScreen: () => true,
  };
  globalThis.TabManager = tm;
  globalThis.START_URL = 'vex://start';
  window.showToast = vi.fn();
  VexStripActions._hide();
  widths(document.querySelector('[data-tab-id="t1"]'), 200);
  widths(document.querySelector('[data-tab-id="t2"]'), 36);
  widths(document.querySelector('[data-tab-id="t3"]'), 100);
  VexStripActions.init();
});
afterEach(() => {
  VexStripActions._hide();
  VexStripActions._closeMenu();
  vi.useRealTimers();
  delete globalThis.TabManager; delete globalThis.TabTrail; delete globalThis.START_URL;
});

const over = (el) => el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
const list = () => document.getElementById('top-tabs-list');

describe('preferences', () => {
  it('start with everything on except the wheel and return to the opener', () => {
    expect(VexStripActions.prefs()).toEqual({ on: true, hover: true, dblNew: true, midReopen: true, wheel: false, returnToOpener: false });
  });
  it('save keeps the rest, and refuses an unknown name or a non-boolean', () => {
    VexStripActions.save({ wheel: true });
    expect(VexStripActions.prefs().wheel).toBe(true);
    expect(VexStripActions.prefs().hover).toBe(true);
    expect(() => VexStripActions.save({ nope: true })).toThrow(/Unknown/);
    expect(() => VexStripActions.save({ wheel: 'yes' })).toThrow(/on or off/);
  });
  it('a damaged saved value starts again, said on the console', () => {
    localStorage.setItem('vex.stripActions', '{not json');
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(VexStripActions.prefs().on).toBe(true);
    expect(err).toHaveBeenCalled();
    err.mockRestore();
  });
  it('ignores values of the wrong type in a saved record', () => {
    localStorage.setItem('vex.stripActions', JSON.stringify({ hover: 'no', wheel: true }));
    const p = VexStripActions.prefs();
    expect(p.hover).toBe(true);
    expect(p.wheel).toBe(true);
  });
});

describe('the buttons over a tab', () => {
  it('appear after a moment, over the tab, as a layer on the body and not in the strip', () => {
    over(document.querySelector('[data-tab-id="t1"]'));
    expect(document.querySelector('.tt-quick')).toBeNull();
    vi.advanceTimersByTime(VexStripActions.HOVER_MS + 1);
    const bar = document.querySelector('.tt-quick');
    expect(bar).not.toBeNull();
    expect(bar.parentElement).toBe(document.body);
    expect(list().contains(bar)).toBe(false);
    expect(bar.getAttribute('role')).toBe('toolbar');
    expect(bar.querySelectorAll('button')).toHaveLength(4);
    for (const b of bar.querySelectorAll('button')) expect(b.getAttribute('aria-label')).toBeTruthy();
  });
  it('change nothing in the strip: same children, same classes, same inline styles', () => {
    const before = list().outerHTML;
    over(document.querySelector('[data-tab-id="t1"]'));
    vi.advanceTimersByTime(VexStripActions.HOVER_MS + 1);
    expect(list().outerHTML).toBe(before);
    VexStripActions._hide();
    expect(list().outerHTML).toBe(before);
  });
  it('are not shown on a pinned or a narrow tab', () => {
    over(document.querySelector('[data-tab-id="t2"]'));
    vi.advanceTimersByTime(1000);
    expect(document.querySelector('.tt-quick')).toBeNull();
    over(document.querySelector('[data-tab-id="t3"]'));
    vi.advanceTimersByTime(1000);
    expect(document.querySelector('.tt-quick')).toBeNull();
  });
  it('mute, pin, duplicate and close-others call the tab manager with that tab, then go away', () => {
    over(document.querySelector('[data-tab-id="t1"]'));
    vi.advanceTimersByTime(500);
    const click = (i) => { document.querySelectorAll('.tt-quick button')[i].click(); };
    click(0); expect(tm.toggleMuteTab).toHaveBeenCalledWith('t1');
    expect(document.querySelector('.tt-quick')).toBeNull();
    over(document.querySelector('[data-tab-id="t1"]')); vi.advanceTimersByTime(500);
    click(1); expect(tm.togglePinTab).toHaveBeenCalledWith('t1');
    over(document.querySelector('[data-tab-id="t1"]')); vi.advanceTimersByTime(500);
    click(2); expect(tm.duplicateTab).toHaveBeenCalledWith(tm.tabs[0]);
    over(document.querySelector('[data-tab-id="t1"]')); vi.advanceTimersByTime(500);
    click(3); expect(tm.closeOtherTabs).toHaveBeenCalledWith('t1');
  });
  it('say Unmute / Unpin when the tab is muted or pinned', () => {
    tm.tabs[0].muted = true; tm.tabs[0].pinned = true;
    over(document.querySelector('[data-tab-id="t1"]'));
    vi.advanceTimersByTime(500);
    const labels = [...document.querySelectorAll('.tt-quick button')].map(b => b.getAttribute('aria-label'));
    expect(labels[0]).toBe('Unmute tab');
    expect(labels[1]).toBe('Unpin tab');
  });
  it('a failing action is said, not lost', () => {
    tm.togglePinTab = vi.fn(() => { throw new Error('boom'); });
    over(document.querySelector('[data-tab-id="t1"]'));
    vi.advanceTimersByTime(500);
    document.querySelectorAll('.tt-quick button')[1].click();
    expect(window.showToast).toHaveBeenCalledWith('That did not work: boom', 'error');
  });
  it('go away when the pointer leaves, but stay while it is on them', () => {
    over(document.querySelector('[data-tab-id="t1"]'));
    vi.advanceTimersByTime(500);
    list().dispatchEvent(new MouseEvent('mouseleave'));
    document.querySelector('.tt-quick').dispatchEvent(new MouseEvent('mouseenter'));
    vi.advanceTimersByTime(1000);
    expect(document.querySelector('.tt-quick')).not.toBeNull();
    document.querySelector('.tt-quick').dispatchEvent(new MouseEvent('mouseleave'));
    vi.advanceTimersByTime(VexStripActions.HIDE_MS + 5);
    expect(document.querySelector('.tt-quick')).toBeNull();
  });
  it('go by themselves when the pointer left without the strip hearing of it, but not while it is on them', () => {
    over(document.querySelector('[data-tab-id="t1"]'));
    vi.advanceTimersByTime(500);
    vi.advanceTimersByTime(VexStripActions.LIFE_MS - 600);
    expect(document.querySelector('.tt-quick')).not.toBeNull();
    vi.advanceTimersByTime(700);
    expect(document.querySelector('.tt-quick')).toBeNull();
    over(document.querySelector('[data-tab-id="t1"]'));
    vi.advanceTimersByTime(500);
    document.querySelector('.tt-quick').dispatchEvent(new MouseEvent('mouseenter'));
    vi.advanceTimersByTime(VexStripActions.LIFE_MS * 2);
    expect(document.querySelector('.tt-quick')).not.toBeNull();
  });
  it('go when the window loses focus, or on Escape', () => {
    over(document.querySelector('[data-tab-id="t1"]'));
    vi.advanceTimersByTime(500);
    window.dispatchEvent(new Event('blur'));
    expect(document.querySelector('.tt-quick')).toBeNull();
    over(document.querySelector('[data-tab-id="t1"]'));
    vi.advanceTimersByTime(500);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(document.querySelector('.tt-quick')).toBeNull();
  });
  it('a press on the strip, or a drag, takes them away', () => {
    over(document.querySelector('[data-tab-id="t1"]'));
    vi.advanceTimersByTime(500);
    list().dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    expect(document.querySelector('.tt-quick')).toBeNull();
  });
  it('are not made when switched off', () => {
    VexStripActions.save({ hover: false });
    over(document.querySelector('[data-tab-id="t1"]'));
    vi.advanceTimersByTime(1000);
    expect(document.querySelector('.tt-quick')).toBeNull();
    VexStripActions.save({ hover: true, on: false });
    over(document.querySelector('[data-tab-id="t1"]'));
    vi.advanceTimersByTime(1000);
    expect(document.querySelector('.tt-quick')).toBeNull();
  });
  it('switching the feature off removes a bar that is showing', () => {
    over(document.querySelector('[data-tab-id="t1"]'));
    vi.advanceTimersByTime(500);
    VexStripActions.setEnabled(false);
    expect(document.querySelector('.tt-quick')).toBeNull();
  });
});

describe('the empty strip', () => {
  it('double-click on the empty part opens a new tab; on a tab it does not', () => {
    list().dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    expect(tm.createTab).toHaveBeenCalledWith('vex://start', true);
    document.querySelector('[data-tab-id="t1"]').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    expect(tm.createTab).toHaveBeenCalledTimes(1);
  });
  it('middle-click on the empty part reopens the last closed tab', () => {
    list().dispatchEvent(new MouseEvent('auxclick', { bubbles: true, button: 1 }));
    expect(tm.reopenLastClosed).toHaveBeenCalledTimes(1);
    list().dispatchEvent(new MouseEvent('auxclick', { bubbles: true, button: 2 }));
    expect(tm.reopenLastClosed).toHaveBeenCalledTimes(1);
  });
  it('middle-click on the + button reopens the last closed tab too', () => {
    const plus = document.getElementById('btn-new-tab-top');
    plus.dispatchEvent(new MouseEvent('auxclick', { bubbles: true, button: 1 }));
    expect(tm.reopenLastClosed).toHaveBeenCalledTimes(1);
    plus.dispatchEvent(new MouseEvent('auxclick', { bubbles: true, button: 0 }));
    expect(tm.reopenLastClosed).toHaveBeenCalledTimes(1);
  });
  it('each can be switched off', () => {
    VexStripActions.save({ dblNew: false, midReopen: false });
    document.getElementById('btn-new-tab-top').dispatchEvent(new MouseEvent('auxclick', { bubbles: true, button: 1 }));
    list().dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    list().dispatchEvent(new MouseEvent('auxclick', { bubbles: true, button: 1 }));
    expect(tm.createTab).not.toHaveBeenCalled();
    expect(tm.reopenLastClosed).not.toHaveBeenCalled();
  });
});

describe('the wheel', () => {
  const wheel = (deltaY) => { const e = new WheelEvent('wheel', { deltaY, bubbles: true, cancelable: true }); list().dispatchEvent(e); return e; };
  it('does nothing until switched on', () => {
    wheel(100);
    expect(tm.cycleTab).not.toHaveBeenCalled();
  });
  it('goes to the next or previous tab, not faster than a notch every 150 ms', () => {
    VexStripActions.save({ wheel: true });
    const e = wheel(100);
    expect(e.defaultPrevented).toBe(true);
    expect(tm.cycleTab).toHaveBeenLastCalledWith(1);
    wheel(100);
    expect(tm.cycleTab).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(200);
    wheel(-100);
    expect(tm.cycleTab).toHaveBeenLastCalledWith(-1);
  });
  it('leaves a strip that scrolls to scroll', () => {
    VexStripActions.save({ wheel: true });
    Object.defineProperty(list(), 'scrollWidth', { value: 2000, configurable: true });
    Object.defineProperty(list(), 'clientWidth', { value: 500, configurable: true });
    wheel(100);
    expect(tm.cycleTab).not.toHaveBeenCalled();
  });
});

describe('return to the opener', () => {
  it('is off by default', () => {
    globalThis.TabTrail = { from: new Map([['t3', { id: 't1' }]]) };
    expect(VexStripActions.openerToReturnTo(tm.tabs[2], tm)).toBeNull();
  });
  it('goes back to the tab that opened the closing one, when it is still there and on screen', () => {
    VexStripActions.save({ returnToOpener: true });
    globalThis.TabTrail = { from: new Map([['t3', { id: 't1' }]]) };
    expect(VexStripActions.openerToReturnTo(tm.tabs[2], tm)).toBe(tm.tabs[0]);
  });
  it('does not, when the opener is closed, hidden, or there is none', () => {
    VexStripActions.save({ returnToOpener: true });
    globalThis.TabTrail = { from: new Map([['t3', { id: 'gone' }], ['t2', { id: 't1' }]]) };
    expect(VexStripActions.openerToReturnTo(tm.tabs[2], tm)).toBeNull();
    tm.isOnScreen = () => false;
    expect(VexStripActions.openerToReturnTo(tm.tabs[1], tm)).toBeNull();
    expect(VexStripActions.openerToReturnTo({ id: 'zzz' }, tm)).toBeNull();
  });
  it('is hooked into closeTab where the next tab is chosen', () => {
    const src = require('fs').readFileSync(require('path').resolve(__dirname, '../../src/renderer/js/tabs.js'), 'utf8');
    expect(src).toMatch(/VexStripActions\.openerToReturnTo\(closing, this\)/);
    expect(src).toMatch(/const next = opener \|\| this\._nextShownAfter/);
  });
});

describe('the + button menu', () => {
  it('a right click opens a menu of recently closed tabs and the copied link', async () => {
    localStorage.setItem('vex.recentlyClosed', JSON.stringify([{ url: 'https://old.example/', title: 'Old page', closedAt: 'x' }]));
    globalThis.getRecentlyClosed = () => JSON.parse(localStorage.getItem('vex.recentlyClosed'));
    globalThis.saveRecentlyClosed = (l) => localStorage.setItem('vex.recentlyClosed', JSON.stringify(l));
    Object.defineProperty(navigator, 'clipboard', { value: { readText: async () => 'https://copied.example/page' }, configurable: true });
    const ev = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    document.getElementById('btn-new-tab-top').dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
    await vi.advanceTimersByTimeAsync(0);
    const items = [...document.querySelectorAll('.tt-menu .tt-menu-item')];
    expect(items.map(i => i.querySelector('.tt-title').textContent)).toEqual(['Open the copied link', 'Old page']);
    items[1].click();
    expect(tm.createTab).toHaveBeenCalledWith('https://old.example/', true, null, { allowDuplicate: true });
    expect(JSON.parse(localStorage.getItem('vex.recentlyClosed'))).toEqual([]);
    delete globalThis.getRecentlyClosed; delete globalThis.saveRecentlyClosed;
  });
  it('says so when there is nothing to offer', async () => {
    Object.defineProperty(navigator, 'clipboard', { value: { readText: async () => '' }, configurable: true });
    globalThis.getRecentlyClosed = () => [];
    document.getElementById('btn-new-tab-top').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
    await vi.advanceTimersByTimeAsync(0);
    expect(document.querySelector('.tt-menu .tt-menu-item').disabled).toBe(true);
    delete globalThis.getRecentlyClosed;
  });
});

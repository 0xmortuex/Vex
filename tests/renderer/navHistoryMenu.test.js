// @vitest-environment jsdom
//
// js/nav-history-menu.js (T1-015): the pages behind Back and ahead of Forward.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const { VexNavHistoryMenu } = require('../../src/renderer/js/nav-history-menu.js');

const data = {
  index: 3,
  total: 6,
  entries: [
    { at: 0, url: 'https://a.example/', title: 'A page' },
    { at: 1, url: 'https://b.example/path', title: '' },
    { at: 2, url: 'data:text/html;charset=utf-8,oops', title: '' },
    { at: 3, url: 'https://now.example/', title: 'Now' },
    { at: 4, url: 'https://e.example/', title: 'E' },
    { at: 5, url: 'https://f.example/', title: 'F' },
  ],
};

let wv;
beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers();
  document.body.innerHTML = '<button id="btn-back"></button><button id="btn-forward"></button>';
  window.showToast = vi.fn();
  wv = { _attached: true, getWebContentsId: () => 42, goToIndex: vi.fn() };
  globalThis.WebviewManager = { getActiveWebview: () => wv };
  window.vex = { tabNavList: vi.fn(async () => data) };
});
afterEach(() => {
  VexNavHistoryMenu.close();
  vi.useRealTimers();
  delete globalThis.WebviewManager;
  delete globalThis.NavLock;
  delete window.vex;
});

describe('side', () => {
  it('lists the pages before the current one, nearest first', () => {
    expect(VexNavHistoryMenu.side(data, -1).map(e => e.at)).toEqual([2, 1, 0]);
  });
  it('lists the pages after it, nearest first', () => {
    expect(VexNavHistoryMenu.side(data, 1).map(e => e.at)).toEqual([4, 5]);
  });
  it('is bounded', () => {
    const long = { index: 100, entries: Array.from({ length: 101 }, (_, i) => ({ at: i, url: 'https://x.example/' + i, title: '' })) };
    expect(VexNavHistoryMenu.side(long, -1)).toHaveLength(VexNavHistoryMenu.MAX_ITEMS);
    expect(VexNavHistoryMenu.side(long, -1)[0].at).toBe(99);
  });
  it('refuses something that is not a list', () => {
    expect(() => VexNavHistoryMenu.side({}, -1)).toThrow(/Not a navigation list/);
    expect(() => VexNavHistoryMenu.side(null, 1)).toThrow();
  });
});

describe('label', () => {
  it('uses the title, else the host, and hides a data: address', () => {
    expect(VexNavHistoryMenu.label(data.entries[0])).toEqual({ title: 'A page', sub: 'a.example' });
    expect(VexNavHistoryMenu.label(data.entries[1])).toEqual({ title: 'b.example', sub: 'b.example' });
    expect(VexNavHistoryMenu.label(data.entries[2])).toEqual({ title: 'Vex page', sub: '' });
  });
});

describe('the menu', () => {
  it('opens under the button with the pages behind, and a click jumps to that place in the history', async () => {
    const btn = document.getElementById('btn-back');
    expect(await VexNavHistoryMenu.open(btn, -1)).toBe(true);
    expect(window.vex.tabNavList).toHaveBeenCalledWith(42);
    const items = [...document.querySelectorAll('.tt-menu .tt-menu-item')];
    expect(items).toHaveLength(3);
    expect(document.querySelector('.tt-menu').getAttribute('role')).toBe('menu');
    expect(document.activeElement).toBe(items[0]);
    items[1].click();
    expect(wv.goToIndex).toHaveBeenCalledWith(1);
    expect(document.querySelector('.tt-menu')).toBeNull();
  });
  it('Forward lists the pages ahead', async () => {
    await VexNavHistoryMenu.open(document.getElementById('btn-forward'), 1);
    const titles = [...document.querySelectorAll('.tt-menu .tt-title')].map(e => e.textContent);
    expect(titles).toEqual(['E', 'F']);
  });
  it('says so when there is nothing on that side', async () => {
    window.vex.tabNavList = vi.fn(async () => ({ index: 0, total: 1, entries: [{ at: 0, url: 'https://a.example/', title: 'A' }] }));
    await VexNavHistoryMenu.open(document.getElementById('btn-back'), -1);
    expect(document.querySelector('.tt-menu-empty').textContent).toBe('No earlier pages');
  });
  it('arrows move between items, Escape closes and gives the focus back to the button', async () => {
    const btn = document.getElementById('btn-back');
    await VexNavHistoryMenu.open(btn, -1);
    const items = [...document.querySelectorAll('.tt-menu .tt-menu-item')];
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
    expect(document.activeElement).toBe(items[1]);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true, cancelable: true }));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true, cancelable: true }));
    expect(document.activeElement).toBe(items[2]);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    expect(document.querySelector('.tt-menu')).toBeNull();
    expect(document.activeElement).toBe(btn);
  });
  it('a click elsewhere closes it', async () => {
    await VexNavHistoryMenu.open(document.getElementById('btn-back'), -1);
    document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    expect(document.querySelector('.tt-menu')).toBeNull();
  });
  it('draws titles as text', async () => {
    window.vex.tabNavList = vi.fn(async () => ({ index: 1, total: 2, entries: [{ at: 0, url: 'https://a.example/', title: '<img src=x onerror=1>' }, { at: 1, url: 'https://b.example/', title: 'B' }] }));
    await VexNavHistoryMenu.open(document.getElementById('btn-back'), -1);
    expect(document.querySelector('.tt-menu img')).toBeNull();
  });
  it('does nothing while a side panel covers the page (the buttons are locked)', async () => {
    globalThis.NavLock = { blocked: () => true };
    expect(await VexNavHistoryMenu.open(document.getElementById('btn-back'), -1)).toBe(false);
    expect(window.vex.tabNavList).not.toHaveBeenCalled();
  });
  it('says so when there is no page', async () => {
    wv = null;
    expect(await VexNavHistoryMenu.open(document.getElementById('btn-back'), -1)).toBe(false);
    expect(window.showToast).toHaveBeenCalled();
  });
  it('jump refuses a place that is not one', () => {
    expect(() => VexNavHistoryMenu.jump(wv, -1)).toThrow(/Not a place/);
    expect(() => VexNavHistoryMenu.jump(wv, 1.5)).toThrow();
  });
  it('off, it opens nothing', async () => {
    VexNavHistoryMenu.setEnabled(false);
    expect(await VexNavHistoryMenu.open(document.getElementById('btn-back'), -1)).toBe(false);
  });
});

describe('the buttons', () => {
  it('a right click opens the menu and the browser menu is kept away', async () => {
    VexNavHistoryMenu.init();
    const ev = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    document.getElementById('btn-back').dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(document.querySelector('.tt-menu')).not.toBeNull();
  });
  it('a long press opens it, and the click that ends the press does not also go back', async () => {
    VexNavHistoryMenu.init();
    const btn = document.getElementById('btn-back');
    const clicks = vi.fn();
    btn.addEventListener('click', clicks);
    btn.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 }));
    await vi.advanceTimersByTimeAsync(VexNavHistoryMenu.HOLD_MS + 5);
    expect(document.querySelector('.tt-menu')).not.toBeNull();
    btn.dispatchEvent(new MouseEvent('pointerup', { bubbles: true }));
    btn.click();
    expect(clicks).not.toHaveBeenCalled();
    btn.click();   // the next, real click goes through
    expect(clicks).toHaveBeenCalledTimes(1);
  });
  it('a quick press is an ordinary click', async () => {
    VexNavHistoryMenu.init();
    const btn = document.getElementById('btn-back');
    const clicks = vi.fn();
    btn.addEventListener('click', clicks);
    btn.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 }));
    await vi.advanceTimersByTimeAsync(100);
    btn.dispatchEvent(new MouseEvent('pointerup', { bubbles: true }));
    await vi.advanceTimersByTimeAsync(VexNavHistoryMenu.HOLD_MS);
    btn.click();
    expect(clicks).toHaveBeenCalledTimes(1);
    expect(document.querySelector('.tt-menu')).toBeNull();
  });
});

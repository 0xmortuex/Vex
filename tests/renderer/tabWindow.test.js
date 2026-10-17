// @vitest-environment jsdom
//
// T3-118, second half: Move this tab to a new window (js/tab-names.js VexTabWindow).
import { describe, it, expect, beforeEach, vi } from 'vitest';

const { VexTabNames, VexTabWindow: W } = require('../../src/renderer/js/tab-names.js');

const tab = (over = {}) => ({ id: 't1', url: 'https://docs.example/guide', title: 'Guide', partition: 'persist:main', ...over });
let close;

beforeEach(() => {
  localStorage.clear();
  globalThis.VexTabNames = VexTabNames;
  close = vi.fn(() => 1);
  globalThis.TabManager = { closeTabsWithUndo: close };
  window.vex = { openAsApp: vi.fn(async () => ({ ok: true })) };
  window.showToast = vi.fn();
});

describe('moving a tab to its own window', () => {
  it('opens the address in the tab\'s own profile and then closes the tab with an Undo', async () => {
    await W.move(tab());
    expect(window.vex.openAsApp).toHaveBeenCalledWith('https://docs.example/guide', 'Guide', 'persist:main');
    expect(close).toHaveBeenCalledTimes(1);
    expect(close.mock.calls[0][0]).toEqual(['t1']);
    expect(close.mock.calls[0][1]).toMatch(/Moved .Guide. to its own window/);
  });
  it('a copy leaves the tab where it is', async () => {
    await W.move(tab(), { copy: true });
    expect(window.vex.openAsApp).toHaveBeenCalledTimes(1);
    expect(close).not.toHaveBeenCalled();
  });
  it('keeps the tab when the main process refuses (a private or Tor tab), and says why', async () => {
    window.vex.openAsApp = vi.fn(async () => ({ ok: false, error: 'A private tab cannot open as an app' }));
    await expect(W.move(tab({ partition: 'private-1' }))).rejects.toThrow(/private tab/);
    expect(close).not.toHaveBeenCalled();
  });
  it('refuses a page that is not on the web, and raises when the bridge is missing', async () => {
    await expect(W.move(tab({ url: 'vex://start' }))).rejects.toThrow(/Only a web page/);
    await expect(W.move(null)).rejects.toThrow(/Only a web page/);
    delete window.vex;
    await expect(W.move(tab())).rejects.toThrow(/not available/);
  });
});

describe('the tab menu rows', () => {
  it('is a Window submenu with the two choices', () => {
    const rows = W.menuItems(tab());
    expect(rows).toHaveLength(1);
    expect(rows[0].label).toBe('Window');
    expect(rows[0].sub.map(r => r.label)).toEqual(['Move to a new window', 'Open a copy in a new window']);
  });
  it('is absent for a page that is not on the web, and when the tab tools switch is off', () => {
    expect(W.menuItems(tab({ url: 'about:blank' }))).toEqual([]);
    VexTabNames.setEnabled(false);
    expect(W.menuItems(tab())).toEqual([]);
  });
  it('the row runs the move, and reports a refusal as an error toast', async () => {
    window.vex.openAsApp = vi.fn(async () => ({ ok: false, error: 'No' }));
    W.menuItems(tab())[0].sub[0].action();
    await new Promise(r => setTimeout(r, 0));
    expect(window.showToast).toHaveBeenCalledWith('No', 'error');
  });
});

describe('the tab context menu', () => {
  it('includes the window rows', () => {
    const src = require('fs').readFileSync(require('path').resolve(__dirname, '../../src/renderer/js/tabs.js'), 'utf8');
    expect(src).toMatch(/VexTabWindow\.menuItems\(tab\)/);
  });
});

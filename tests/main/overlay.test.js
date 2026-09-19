// src/main/overlay.js — the small always-on-top window. Its keys are handled
// before the page sees them, so a page that swallows keystrokes cannot trap
// you in a window with no chrome of its own.
import { describe, it, expect, vi } from 'vitest';
const { createOverlayWindow, clamp, MIN_OPACITY } = require('../../src/main/overlay.js');

function fakeWindow() {
  const win = {
    opts: null, opacity: null, onTop: [], closed: false, loaded: null, handlers: {},
    setAlwaysOnTop: (on, level) => { win.onTop.push([on, level]); win._top = on; },
    isAlwaysOnTop: () => !!win._top,
    setOpacity: (o) => { win.opacity = o; },
    loadURL: (u) => { win.loaded = u; },
    close: () => { win.closed = true; },
    webContents: { on: (name, fn) => { win.handlers[name] = fn; } },
  };
  const BrowserWindow = function (opts) { win.opts = opts; return win; };
  return { win, BrowserWindow };
}
const press = (win, input) => { const e = { preventDefault: vi.fn() }; win.handlers['before-input-event'](e, { type: 'keyDown', ...input }); return e; };

describe('the overlay window', () => {
  it('floats above other windows, in Vex\'s own session, at the asked opacity', () => {
    const { win, BrowserWindow } = fakeWindow();
    createOverlayWindow({ BrowserWindow, url: 'https://wiki.example/map', opacity: 0.8 });
    expect(win.opts).toMatchObject({ frame: false, alwaysOnTop: true, skipTaskbar: false, resizable: true });
    expect(win.opts.webPreferences).toMatchObject({ partition: 'persist:main', contextIsolation: true, nodeIntegration: false });
    expect(win.onTop[0]).toEqual([true, 'screen-saver']);
    expect(win.opacity).toBe(0.8);
    expect(win.loaded).toBe('https://wiki.example/map');
  });

  it('Esc closes it, Ctrl+Up/Down change how see-through it is, Ctrl+P stops it floating', () => {
    const seen = [];
    const { win, BrowserWindow } = fakeWindow();
    createOverlayWindow({ BrowserWindow, url: 'https://a.example', opacity: 0.9, onOpacity: (o) => seen.push(o) });
    press(win, { key: 'ArrowUp', control: true });
    expect(win.opacity).toBe(0.95);
    press(win, { key: 'ArrowDown', control: true });
    press(win, { key: 'ArrowDown', control: true });
    expect(win.opacity).toBe(0.85);
    expect(seen).toEqual([0.95, 0.9, 0.85]);
    press(win, { key: 'p', control: true });
    expect(win.isAlwaysOnTop()).toBe(false);
    expect(win.closed).toBe(false);
    press(win, { key: 'Escape' });
    expect(win.closed).toBe(true);
  });

  it('a key the overlay does not use is left to the page', () => {
    const { win, BrowserWindow } = fakeWindow();
    createOverlayWindow({ BrowserWindow, url: 'https://a.example' });
    expect(press(win, { key: 'ArrowUp' }).preventDefault).not.toHaveBeenCalled();
    expect(press(win, { key: 'k', control: true }).preventDefault).not.toHaveBeenCalled();
  });

  it('never goes fully invisible, or past solid', () => {
    expect(clamp(5)).toBe(1);
    expect(clamp(0)).toBe(MIN_OPACITY);
    expect(clamp(0.923)).toBe(0.92);
  });
});

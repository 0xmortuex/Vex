// @vitest-environment jsdom
// src/main/overlay.js — the frameless overlay gets a thin bar, added in an
// isolated world after every load, so the mouse can move and close it
// (found 2026-09-29: only the keys could).
import { describe, it, expect, vi } from 'vitest';
const { createOverlayWindow, BAR_SCRIPT } = require('../../src/main/overlay.js');

function fakeWindow() {
  const win = {
    handlers: {}, injected: [],
    setAlwaysOnTop() {}, isAlwaysOnTop: () => true, setOpacity() {}, loadURL() {}, close() {},
    webContents: {
      on: (name, fn) => { win.handlers[name] = fn; },
      executeJavaScriptInIsolatedWorld: vi.fn(async (world, scripts) => { win.injected.push([world, scripts]); }),
    },
  };
  return { win, BrowserWindow: function () { return win; } };
}

describe('the overlay\'s move/close bar', () => {
  it('is injected in an isolated world on every dom-ready', () => {
    const { win, BrowserWindow } = fakeWindow();
    createOverlayWindow({ BrowserWindow, url: 'https://a.example' });
    win.handlers['dom-ready']();
    win.handlers['dom-ready']();
    expect(win.injected).toHaveLength(2);
    expect(win.injected[0][0]).toBeGreaterThan(0);
    expect(win.injected[0][1][0].code).toBe(BAR_SCRIPT);
  });

  it('builds one draggable bar with a close button that closes the window', () => {
    document.body.innerHTML = '<p>page</p>';
    const closeSpy = vi.spyOn(window, 'close').mockImplementation(() => {});
    // jsdom has no constructable stylesheets; the real window (Chromium) does.
    if (typeof CSSStyleSheet.prototype.replaceSync !== 'function') CSSStyleSheet.prototype.replaceSync = function () {};
    const shadows = [];
    const attach = Element.prototype.attachShadow;
    Element.prototype.attachShadow = function (o) { const r = attach.call(this, { ...o, mode: 'open' }); shadows.push(r); return r; };
    try {
      new Function(BAR_SCRIPT)();
      new Function(BAR_SCRIPT)();
      expect(document.querySelectorAll('#vex-overlay-bar')).toHaveLength(1);
      const btn = shadows[0].querySelector('button');
      expect(btn.getAttribute('aria-label')).toBe('Close overlay');
      expect(btn.querySelector('svg')).not.toBeNull();
      btn.click();
      expect(closeSpy).toHaveBeenCalled();
    } finally {
      Element.prototype.attachShadow = attach;
      clearInterval(window.__vexOverlayBarHeal);
      closeSpy.mockRestore();
    }
  });
});

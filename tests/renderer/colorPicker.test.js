// @vitest-environment jsdom
//
// You are looking at a colour and you want its hex. Today that means a
// screenshot, a paint program and a guess — or an extension you have to trust
// with every page you visit. Chromium has had EyeDropper since Chrome 95 and
// almost nothing uses it: it samples any pixel on the SCREEN, drawn by Chromium
// itself, so no page is injected into and no page is told.

import { beforeEach, describe, expect, it, vi } from 'vitest';
const { ColorPicker } = require('../../src/renderer/js/color-picker.js');

function eyedropperReturning(hex) {
  window.EyeDropper = function () { return { open: async () => ({ sRGBHex: hex }) }; };
}
function eyedropperThrowing(err) {
  window.EyeDropper = function () { return { open: async () => { throw err; } }; };
}

beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = '';
  window.showToast = vi.fn();
  window.escapeHtml = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  Object.assign(navigator, { clipboard: { writeText: vi.fn(async () => {}) } });
  eyedropperReturning('#3366CC');
  ColorPicker.recent = [];
  ColorPicker.init();
});

describe('the numbers', () => {
  it('gives the three forms anyone actually pastes', () => {
    expect(ColorPicker.formats('#3366cc')).toEqual({
      hex: '#3366cc', rgb: 'rgb(51, 102, 204)', hsl: 'hsl(220, 60%, 50%)',
    });
  });

  it('handles the ends of the range without going wrong', () => {
    expect(ColorPicker.formats('#000000')).toMatchObject({ rgb: 'rgb(0, 0, 0)', hsl: 'hsl(0, 0%, 0%)' });
    expect(ColorPicker.formats('#ffffff')).toMatchObject({ rgb: 'rgb(255, 255, 255)', hsl: 'hsl(0, 0%, 100%)' });
    expect(ColorPicker.formats('#ff0000').hsl).toBe('hsl(0, 100%, 50%)');
    expect(ColorPicker.formats('#00ff00').hsl).toBe('hsl(120, 100%, 50%)');
    expect(ColorPicker.formats('#0000ff').hsl).toBe('hsl(240, 100%, 50%)');
  });

  it('knows which colours need light text on them', () => {
    expect(ColorPicker.isDark('#000000')).toBe(true);
    expect(ColorPicker.isDark('#3366cc')).toBe(true);
    expect(ColorPicker.isDark('#ffffff')).toBe(false);
    expect(ColorPicker.isDark('#ffff00')).toBe(false);      // yellow is bright, not dark
  });
});

describe('picking one', () => {
  it('copies the hex, because that is what you are about to paste', async () => {
    const hex = await ColorPicker.pick();
    expect(hex).toBe('#3366cc');
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('#3366cc');
    expect(window.showToast).toHaveBeenCalledWith(expect.stringContaining('rgb(51, 102, 204)'));
    expect(ColorPicker.recent).toEqual(['#3366cc']);
  });

  it('cancelling is not an error', async () => {
    const abort = new Error('user cancelled'); abort.name = 'AbortError';
    eyedropperThrowing(abort);
    await expect(ColorPicker.pick()).resolves.toBe(null);
    expect(ColorPicker.recent).toEqual([]);
    expect(window.showToast).not.toHaveBeenCalled();
  });

  it('explains a refused gesture in words, not in Chromium\'s', async () => {
    const denied = new Error("Failed to execute 'open' on 'EyeDropper': EyeDropper::open() requires user gesture");
    denied.name = 'NotAllowedError';
    eyedropperThrowing(denied);
    await expect(ColorPicker.pick()).rejects.toThrow(/Start the eyedropper yourself/);
  });

  it('a real failure is not swallowed', async () => {
    eyedropperThrowing(new Error('the screen could not be read'));
    await expect(ColorPicker.pick()).rejects.toThrow(/screen could not be read/);
  });

  it('says so plainly where there is no eyedropper at all', async () => {
    delete window.EyeDropper;
    expect(ColorPicker.available()).toBe(false);
    await expect(ColorPicker.pick()).rejects.toThrow(/no eyedropper/);
  });

  it('refuses a nonsense answer rather than storing it', async () => {
    eyedropperReturning('rgb(1,2,3)');
    await expect(ColorPicker.pick()).rejects.toThrow(/unreadable/);
    expect(ColorPicker.recent).toEqual([]);
  });

  it('still reports the colour when the clipboard refuses it', async () => {
    navigator.clipboard.writeText = vi.fn(async () => { throw new Error('denied'); });
    await expect(ColorPicker.pick()).resolves.toBe('#3366cc');
    expect(window.showToast).toHaveBeenCalledWith(expect.stringContaining('#3366cc'));
  });
});

describe('the ones you picked before', () => {
  it('keeps them newest first and survives a restart', async () => {
    await ColorPicker.pick();
    eyedropperReturning('#ff0000');
    await ColorPicker.pick();
    ColorPicker.recent = [];
    ColorPicker.init();
    expect(ColorPicker.recent).toEqual(['#ff0000', '#3366cc']);
  });

  it('picking the same colour twice moves it up rather than repeating it', async () => {
    await ColorPicker.pick();
    eyedropperReturning('#ff0000');
    await ColorPicker.pick();
    eyedropperReturning('#3366CC');
    await ColorPicker.pick();
    expect(ColorPicker.recent).toEqual(['#3366cc', '#ff0000']);
  });

  it('stops at a dozen instead of growing for ever', async () => {
    for (let i = 0; i < ColorPicker.MAX + 5; i++) {
      eyedropperReturning('#' + i.toString(16).padStart(6, '0'));
      await ColorPicker.pick();
    }
    expect(ColorPicker.recent).toHaveLength(ColorPicker.MAX);
  });

  it('ignores rubbish left in storage rather than rendering it', () => {
    localStorage.setItem(ColorPicker.KEY, JSON.stringify(['#3366cc', 'javascript:alert(1)', 42, null]));
    ColorPicker.init();
    expect(ColorPicker.recent).toEqual(['#3366cc']);
  });

  it('lists each with its swatch and all three forms, and copies on click', async () => {
    await ColorPicker.pick();
    ColorPicker.openRecent();
    const row = document.querySelector('.vex-color-box [data-list] > div');
    expect(row.textContent).toContain('#3366cc');
    expect(row.textContent).toContain('rgb(51, 102, 204)');
    expect(row.textContent).toContain('hsl(220, 60%, 50%)');
    expect(row.querySelector('span').getAttribute('style')).toContain('#3366cc');
    navigator.clipboard.writeText.mockClear();
    row.click();
    await vi.waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith('#3366cc'));
  });

  it('clears them', async () => {
    await ColorPicker.pick();
    ColorPicker.openRecent();
    document.querySelector('[data-forget]').click();
    expect(ColorPicker.recent).toEqual([]);
    expect(localStorage.getItem(ColorPicker.KEY)).toBe(null);
    expect(document.querySelector('[data-list]').textContent).toMatch(/No colours yet/);
  });

  it('Escape closes it, and opening twice leaves one', () => {
    ColorPicker.openRecent();
    ColorPicker.openRecent();
    expect(document.querySelectorAll('.vex-color-overlay')).toHaveLength(1);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(document.querySelector('.vex-color-overlay')).toBe(null);
  });

  it('gets out of the way before the magnifier opens — it would sit on top of it', async () => {
    ColorPicker.openRecent();
    let openWhilePicking = true;
    window.EyeDropper = function () {
      return { open: async () => { openWhilePicking = !!document.querySelector('.vex-color-overlay'); return { sRGBHex: '#123456' }; } };
    };
    document.querySelector('[data-pick]').click();
    await vi.waitFor(() => expect(ColorPicker.recent).toContain('#123456'));
    expect(openWhilePicking).toBe(false);
    await vi.waitFor(() => expect(document.querySelector('.vex-color-overlay')).not.toBe(null));
  });
});

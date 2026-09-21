// @vitest-environment jsdom
//
// The font Vex itself wears. The interface was Outfit, named directly in about
// three hundred places, so "I want Times New Roman" had no answer — and the
// accessibility pack could only change the font of a page, never of the
// browser around it.
import { describe, it, expect, beforeEach, vi } from 'vitest';
const { VexFonts } = require('../../src/renderer/js/fonts.js');

beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = '';
  document.documentElement.removeAttribute('data-vex-font');
  document.documentElement.style.cssText = '';
  window.escapeHtml = (v) => String(v == null ? '' : v).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  window.showToast = () => {};
  VexFonts.close();
});

const root = () => document.documentElement;

describe('picking one', () => {
  it('Times New Roman by default, which is itself an override', () => {
    // The stylesheets are written in Outfit, so the shipped face needs the
    // sweeping rule on. Only picking Outfit back turns it off.
    VexFonts.apply();
    expect(VexFonts.current().id).toBe('times');
    expect(VexFonts.isShipped()).toBe(true);
    expect(VexFonts.needsOverride()).toBe(true);
    expect(root().getAttribute('data-vex-font')).toBe('times');
    VexFonts.set('default');
    expect(VexFonts.needsOverride()).toBe(false);
    expect(root().hasAttribute('data-vex-font')).toBe(false);
  });

  it('a chosen face becomes the variable everything follows', () => {
    VexFonts.set('times');
    expect(root().style.getPropertyValue('--vex-font-base')).toMatch(/Times New Roman/);
    expect(root().getAttribute('data-vex-font')).toBe('times');
    // Headings follow it too, rather than staying in Vex's own display face.
    expect(root().style.getPropertyValue('--vex-font-display')).toMatch(/Times New Roman/);
  });

  it('code keeps a font where every letter is the same width', () => {
    VexFonts.set('times');
    expect(root().style.getPropertyValue('--vex-font-mono')).toMatch(/JetBrains Mono/);
    VexFonts.setMono('consolas');
    expect(root().style.getPropertyValue('--vex-font-mono')).toMatch(/Consolas/);
    expect(() => VexFonts.setMono('times')).toThrow(/same width/);
  });

  it('remembers it, and refuses one it does not have', () => {
    VexFonts.set('georgia');
    expect(localStorage.getItem('vex.font')).toBe('georgia');
    expect(VexFonts.current().name).toBe('Georgia');
    expect(() => VexFonts.set('wingdings')).toThrow(/no font called/);
  });

  it('goes back to how Vex ships', () => {
    VexFonts.set('verdana');
    VexFonts.setMono('courier');
    VexFonts.reset();
    expect(VexFonts.isShipped()).toBe(true);
    expect(VexFonts.current().id).toBe('times');
    expect(VexFonts.currentMono().id).toBe('jetbrains');
  });

  it('every face names a real fallback chain, so a machine without it still reads', () => {
    for (const f of VexFonts.FONTS) {
      expect(f.stack, f.id).toMatch(/,/);
      expect(f.stack, f.id).toMatch(/(sans-serif|serif|monospace|system-ui)\s*$/);
    }
  });
});

describe('the start page, which is a different document', () => {
  it('is given the font as CSS, and nothing only when Outfit is chosen back', () => {
    VexFonts.set('default');
    expect(VexFonts.startPageCss()).toBe('');
    VexFonts.set('times');
    const css = VexFonts.startPageCss();
    expect(css).toMatch(/--vex-font-base: 'Times New Roman'/);
    expect(css).toMatch(/!important/);
    expect(css).toMatch(/code, pre, kbd/);
    // Under a browser look the page carries html[data-look] body { ... !important },
    // which outranks a plain body rule — so these have to outrank that.
    expect(css).toMatch(/html\[data-vex-font\]\[data-vex-font\] body/);
    expect(css).toMatch(/--look-font: 'Times New Roman'/);
  });

  it('pushes it into every open start page, and keeps a copy there for next time', () => {
    const ran = [];
    globalThis.WebviewManager = {
      webviews: new Map([
        ['t1', { getURL: () => 'file:///C:/vex/src/renderer/start.html?theme=oxford', executeJavaScript: (js) => ran.push(js) }],
        ['t2', { getURL: () => 'https://example.com', executeJavaScript: (js) => ran.push('WRONG') }],
      ]),
    };
    VexFonts.set('georgia');
    expect(ran.length).toBe(1);
    expect(ran[0]).toMatch(/vex\.fontCss/);
    expect(ran[0]).toMatch(/Georgia/);
    delete globalThis.WebviewManager;
  });
});

describe('the picker', () => {
  it('draws every face in itself, grouped, with code last', () => {
    VexFonts.open();
    expect(document.querySelector('.vexfont')).not.toBeNull();
    const kinds = [...document.querySelectorAll('.vexfont-kind')].map(e => e.firstChild.textContent.trim());
    expect(kinds).toEqual(['Without serifs', 'With serifs', 'Every letter the same width', 'The font for code']);
    // Each row is drawn in the face it offers, and with !important: the
    // sweeping rule would otherwise draw all of them in the one already
    // chosen, which is a font picker that shows you nothing.
    const times = document.querySelector('[data-font="times"] .vexfont-name');
    expect(times.getAttribute('style')).toMatch(/Times New Roman.*!important/);
    expect(document.querySelector('[data-font="times"] .vexfont-sample').getAttribute('style')).toMatch(/!important/);
  });

  it('picking one applies it and marks it', () => {
    VexFonts.open();
    document.querySelector('[data-font="cambria"]').click();
    expect(VexFonts.current().id).toBe('cambria');
    expect(document.querySelector('[data-font="cambria"]').classList.contains('on')).toBe(true);
    expect(document.querySelector('#vexfont-now').textContent).toMatch(/Cambria/);
  });

  it('closes on Escape', () => {
    VexFonts.open();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(document.querySelector('.vexfont')).toBeNull();
  });
});

// @vitest-environment jsdom
//
// Skins: what Vex is made of, over whatever theme it is wearing. Thirty-seven
// themes and every one of them was flat colour — this is the texture, the
// geometry and the light, each one separate and each one optional.
import { describe, it, expect, beforeEach } from 'vitest';
const { VexSkins } = require('../../src/renderer/js/skins.js');

beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = '';
  for (const a of ['data-skin-pattern', 'data-skin-shape', 'data-skin-glow', 'data-skin-noise']) document.documentElement.removeAttribute(a);
  document.documentElement.style.cssText = '';
  window.escapeHtml = (v) => String(v == null ? '' : v).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  window.showToast = () => {};
  VexSkins.close();
});

const root = () => document.documentElement;

describe('the catalogue itself', () => {
  it('every texture is drawable, named and explained', () => {
    for (const p of VexSkins.PATTERNS) {
      expect(p.name, p.id).toBeTruthy();
      expect(p.note, p.id).toBeTruthy();
      if (p.svg) {
        expect(p.size, p.id).toBeGreaterThan(4);
        expect(p.svg, p.id).toContain('%c');        // drawn in the theme's ink
      }
    }
    expect(VexSkins.PATTERNS.length).toBeGreaterThan(15);
  });

  it('a tile can go in a style attribute — quotes were what broke the picker', () => {
    const tile = VexSkins.tile(VexSkins.PATTERNS.find(p => p.id === 'hex'), '#112233');
    expect(tile.startsWith("url('data:image/svg+xml,")).toBe(true);
    expect(tile).not.toContain('"');               // a double quote ends the attribute
    expect(decodeURIComponent(tile)).toContain('#112233');
    expect(VexSkins.tile(VexSkins.PATTERNS[0], '#fff')).toBe('');   // "None" draws nothing
  });
});

describe('wearing one', () => {
  it('starts plain, exactly as Vex shipped', () => {
    VexSkins.apply();
    expect(VexSkins.isDefault()).toBe(true);
    expect(root().hasAttribute('data-skin-pattern')).toBe(false);
    expect(root().hasAttribute('data-skin-shape')).toBe(false);
    expect(root().hasAttribute('data-skin-glow')).toBe(false);
  });

  it('a texture becomes an attribute and a tile, at the strength chosen', () => {
    VexSkins.set('pattern', 'circuit');
    VexSkins.set('strength', 'bold');
    expect(root().getAttribute('data-skin-pattern')).toBe('circuit');
    expect(root().style.getPropertyValue('--vex-skin-tile')).toContain('data:image/svg+xml');
    expect(root().style.getPropertyValue('--vex-skin-alpha')).toBe('0.22');
    expect(root().style.getPropertyValue('--vex-skin-size')).toBe('32px');
  });

  it('grain is a generated field, not a repeating tile', () => {
    VexSkins.set('pattern', 'noise');
    expect(root().hasAttribute('data-skin-noise')).toBe(true);
    VexSkins.set('pattern', 'dots');
    expect(root().hasAttribute('data-skin-noise')).toBe(false);
  });

  it('shape drives the corners, borders and how much air there is', () => {
    VexSkins.set('shape', 'sharp');
    expect(root().style.getPropertyValue('--vex-skin-radius')).toBe('0px');
    VexSkins.set('shape', 'round');
    expect(root().style.getPropertyValue('--vex-skin-radius')).toBe('16px');
    expect(root().getAttribute('data-skin-shape')).toBe('round');
  });

  it('the three are independent — a texture does not force a shape', () => {
    VexSkins.set('pattern', 'waves');
    expect(root().hasAttribute('data-skin-shape')).toBe(false);
    expect(root().hasAttribute('data-skin-glow')).toBe(false);
  });

  it('refuses something it does not have, and remembers what it does', () => {
    expect(() => VexSkins.set('pattern', 'tartan')).toThrow(/no pattern called/);
    expect(() => VexSkins.set('nonsense', 'x')).toThrow(/pattern, a shape/);
    VexSkins.set('glow', 'halo');
    expect(localStorage.getItem('vex.skinGlow')).toBe('halo');
    expect(VexSkins.glow().name).toBe('Halo');
  });

  it('plain again puts everything back', () => {
    VexSkins.set('pattern', 'plaid');
    VexSkins.set('shape', 'heavy');
    VexSkins.set('glow', 'lift');
    VexSkins.reset();
    expect(VexSkins.isDefault()).toBe(true);
    expect(root().hasAttribute('data-skin-pattern')).toBe(false);
  });
});

describe('the picker', () => {
  it('shows every texture drawn in itself', () => {
    VexSkins.open();
    const swatches = [...document.querySelectorAll('[data-set="pattern"] .vexskin-swatch')];
    expect(swatches.length).toBe(VexSkins.PATTERNS.length);
    const hex = document.querySelector('[data-set="pattern"][data-id="hex"] .vexskin-swatch');
    expect(hex.getAttribute('style')).toContain('data:image/svg+xml');
  });

  it('offers texture, strength, shape and light, and says what is on', () => {
    VexSkins.set('pattern', 'stars');
    VexSkins.open();
    const kinds = [...document.querySelectorAll('.vexskin-kind')].map(e => e.firstChild.textContent.trim());
    expect(kinds).toEqual(['Texture', 'How strong', 'Shape', 'Light']);
    expect(document.querySelector('#vexskin-now').textContent).toMatch(/night sky texture/);
    expect(document.querySelector('[data-id="stars"]').classList.contains('on')).toBe(true);
  });

  it('picking one applies it there and then', () => {
    VexSkins.open();
    document.querySelector('[data-set="shape"][data-id="tight"]').click();
    expect(VexSkins.shape().id).toBe('tight');
    expect(root().getAttribute('data-skin-shape')).toBe('tight');
  });

  it('closes on Escape', () => {
    VexSkins.open();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(document.querySelector('.vexskin')).toBeNull();
  });
});

import { describe, it, expect } from 'vitest';
import { KEY_CODES } from '../../src/renderer/js/agent-cdp.js';

// The agent's press_key tool advertises this exact set in its enum; if the two
// drift the model can request a key the executor will reject at runtime.
const ADVERTISED = [
  'Enter', 'Tab', 'Escape', 'Backspace', 'Delete',
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
  'Home', 'End', 'PageUp', 'PageDown',
];

describe('KEY_CODES', () => {
  it('covers every key the press_key tool advertises', () => {
    for (const key of ADVERTISED) {
      expect(KEY_CODES[key], `missing key: ${key}`).toBeDefined();
    }
  });

  it('gives every key a numeric virtual key code', () => {
    for (const [name, spec] of Object.entries(KEY_CODES)) {
      expect(typeof spec.code, `${name}.code`).toBe('number');
      expect(spec.code).toBeGreaterThan(0);
      expect(spec.key).toBe(name);
    }
  });

  it('uses the standard Windows virtual key codes', () => {
    // These are load-bearing: dispatchKeyEvent needs the real codes or the
    // page sees a keypress with the wrong identity.
    expect(KEY_CODES.Enter.code).toBe(13);
    expect(KEY_CODES.Tab.code).toBe(9);
    expect(KEY_CODES.Backspace.code).toBe(8);
    expect(KEY_CODES.Escape.code).toBe(27);
    expect(KEY_CODES.Delete.code).toBe(46);
    expect(KEY_CODES.ArrowLeft.code).toBe(37);
    expect(KEY_CODES.ArrowUp.code).toBe(38);
    expect(KEY_CODES.ArrowRight.code).toBe(39);
    expect(KEY_CODES.ArrowDown.code).toBe(40);
  });

  it('sends text only for keys that actually insert a character', () => {
    expect(KEY_CODES.Enter.text).toBe('\r');
    expect(KEY_CODES.Tab.text).toBe('\t');
    // Navigation and deletion keys insert nothing — a text payload here would
    // make the page receive a stray character alongside the keypress.
    for (const k of ['Escape', 'Backspace', 'Delete', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown']) {
      expect(KEY_CODES[k].text, `${k} should not insert text`).toBe('');
    }
  });
});

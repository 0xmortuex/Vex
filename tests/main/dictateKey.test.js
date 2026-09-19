// Ctrl+Alt+D inside a web page is passed up to Vex for dictation — and
// nothing else is.
import { describe, expect, it } from 'vitest';
const { isDictateKey } = require('../../src/main/dictate-key.js');

const k = (o) => ({ type: 'keyDown', control: true, alt: true, shift: false, key: 'd', ...o });

describe('the dictation key from inside a page', () => {
  it('is Ctrl+Alt+D, either case, or Cmd on a Mac', () => {
    expect(isDictateKey(k())).toBe(true);
    expect(isDictateKey(k({ key: 'D' }))).toBe(true);
    expect(isDictateKey(k({ control: false, meta: true }))).toBe(true);
  });

  it('is not Ctrl+D (bookmark), Alt+D, Ctrl+Shift+Alt+D, another letter, or a release', () => {
    expect(isDictateKey(k({ alt: false }))).toBe(false);
    expect(isDictateKey(k({ control: false }))).toBe(false);
    expect(isDictateKey(k({ shift: true }))).toBe(false);
    expect(isDictateKey(k({ key: 'f' }))).toBe(false);
    expect(isDictateKey(k({ type: 'keyUp' }))).toBe(false);
    expect(isDictateKey(null)).toBe(false);
  });
});

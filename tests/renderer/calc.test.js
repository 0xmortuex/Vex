// VexCalc.evaluate — inline calculator/converter used by the command bar.
import { describe, it, expect, beforeEach } from 'vitest';
import { VexCalc } from '../../src/renderer/js/calc.js';

describe('VexCalc.evaluate', () => {
  beforeEach(() => { VexCalc._rates = null; VexCalc._ratesBase = 'USD'; });

  it('does arithmetic', () => {
    expect(VexCalc.evaluate('12*7').value).toBe('84');
    expect(VexCalc.evaluate('(2+3)*4').value).toBe('20');
    expect(VexCalc.evaluate('2^10').value).toBe('1024');
    expect(VexCalc.evaluate('10/4').value).toBe('2.5');
  });

  // "-5 c to f" gave nothing (found 2026-09-29).
  it('converts negative numbers', () => {
    expect(VexCalc.evaluate('-5 c to f').value).toBe('23');
    expect(VexCalc.evaluate('-40 f to c').value).toBe('-40');
    expect(VexCalc.evaluate('-3 km to m').value).toBe('-3000');
    VexCalc._rates = { EUR: 0.5 };
    expect(VexCalc.evaluate('-10 usd to eur').value).toBe('-5');
  });

  it('ignores non-calc queries', () => {
    expect(VexCalc.evaluate('hello world')).toBeNull();
    expect(VexCalc.evaluate('github')).toBeNull();
    expect(VexCalc.evaluate('12')).toBeNull();        // a bare number isn't a calc
    expect(VexCalc.evaluate('')).toBeNull();
  });

  it('is injection-safe (no identifiers reach eval)', () => {
    expect(VexCalc.evaluate('alert(1)')).toBeNull();
    expect(VexCalc.evaluate('1;process.exit()')).toBeNull();
  });

  it('converts length', () => {
    expect(VexCalc.evaluate('20 cm to in').text).toBe('7.874016 in');
    expect(VexCalc.evaluate('5 km to miles').text).toBe('3.106856 miles');
  });

  it('converts mass', () => {
    expect(VexCalc.evaluate('10 kg to lb').text).toBe('22.046226 lb');
  });

  it('converts temperature', () => {
    expect(VexCalc.evaluate('100 f to c').text).toBe('37.777778°C');
    expect(VexCalc.evaluate('0 c to f').text).toBe('32°F');
  });

  it('currency: unavailable without rates', () => {
    const r = VexCalc.evaluate('10 usd to eur');
    expect(r.unavailable).toBe(true);
  });

  it('currency: uses cached rates (base per USD)', () => {
    VexCalc._rates = { USD: 1, EUR: 0.9, GBP: 0.8 };
    // 10 USD -> EUR = 10 * 0.9
    expect(VexCalc.evaluate('10 usd to eur').text).toBe('9 EUR');
    // 10 EUR -> GBP = (10/0.9)*0.8
    expect(Number(VexCalc.evaluate('10 eur to gbp').value)).toBeCloseTo(8.8889, 3);
  });

  it('currency: unknown code returns null', () => {
    VexCalc._rates = { USD: 1, EUR: 0.9 };
    expect(VexCalc.evaluate('10 usd to zzz')).toBeNull();
  });

  // The window's CSP has no 'unsafe-eval'. Function() used to do the sums,
  // threw there, and every calculation in the real app came back empty.
  it('works where eval is forbidden, as it is in the Vex window', () => {
    const real = globalThis.Function;
    globalThis.Function = function () { throw new EvalError('Refused to evaluate a string as JavaScript (CSP)'); };
    try {
      expect(VexCalc.evaluate('12.5 + 48.2 + 7.3 + 31').text).toBe('= 99');
      expect(VexCalc.evaluate('2^3^2').value).toBe('512');
      expect(VexCalc.evaluate('-2^2').value).toBe('-4');
      expect(VexCalc.evaluate('(1 + 2) * 3 % 4').value).toBe('1');
      expect(VexCalc.evaluate('2 ** 3').value).toBe('8');
      for (const bad of ['2+', '(1+2', '1/0', '1 2 + 3']) expect(VexCalc.evaluate(bad), bad).toBeNull();
    } finally { globalThis.Function = real; }
  });
});

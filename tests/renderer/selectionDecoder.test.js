// @vitest-environment jsdom
//
// Selection decoder (js/selection-decoder.js): what a selection could be, worked out locally.
import { describe, it, expect, beforeEach } from 'vitest';
const { VexDecode: D } = require('../../src/renderer/js/selection-decoder.js');

const NOW = 1700000100000;
const decode = (s) => D.analyze(s, { now: NOW, zone: 'UTC' });
const JWT = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4iLCJleHAiOjE5MDAwMDAwMDB9.abc123';

beforeEach(() => localStorage.clear());

describe('JWT', () => {
  it('is unpacked, with the times, and said not to be verified', () => {
    const [r] = decode(JWT);
    expect(r.kind).toBe('jwt');
    expect(r.rows.find(x => x.label === 'Header').value).toContain('"alg": "HS256"');
    expect(r.rows.find(x => x.label === 'Payload').value).toContain('"name": "John"');
    expect(r.rows.find(x => x.label === 'Expires').value).toContain('2030-03-17T17:46:40.000Z');
    expect(r.rows.find(x => x.label === 'Signature').value).toMatch(/NOT checked/);
    expect(r.warnings[0]).toMatch(/Not verified/);
  });
  it('warns about alg none', () => {
    const none = btoa('{"alg":"none"}').replace(/=/g, '') + '.' + btoa('{"a":1}').replace(/=/g, '') + '.';
    expect(decode(none)[0].warnings.join(' ')).toMatch(/none/);
  });
  it('is not a JWT when the parts are not JSON', () => {
    expect(decode('aaaa.bbbb.cccc').find(r => r.kind === 'jwt')).toBeUndefined();
  });
});

describe('the other readings', () => {
  it('base64 text', () => { expect(decode('SGVsbG8sIFdvcmxkIQ==')[0]).toMatchObject({ kind: 'base64', rows: [{ value: 'Hello, World!' }] }); });
  it('does not call an ordinary word or a kebab-case name base64', () => {
    expect(decode('implementation')).toEqual([]);
    expect(decode('some-kebab-case-name')).toEqual([]);
  });
  it('percent-encoding', () => { expect(decode('hello%20world%21%3Fa%3D1')[0].rows[0].value).toBe('hello world!?a=1'); });
  it('a broken percent escape is nothing, not an error', () => { expect(decode('100%zz')).toEqual([]); });
  it('hex as text and as a number', () => {
    const rows = decode('0x48656c6c6f')[0].rows;
    expect(rows.find(r => r.label === 'As text').value).toBe('Hello');
    expect(rows.find(r => r.label === 'As a number').value).toBe('310939249775');
    expect(decode('0xff')[0].rows[0].value).toBe('255');
  });
  it('a plain run of digits is not hex', () => { expect(decode('12345678')).toEqual([]); });
  it('Unix time in seconds and milliseconds', () => {
    for (const s of ['1700000000', '1700000000000']) {
      const [r] = decode(s);
      expect(r.kind).toBe('epoch');
      expect(r.rows.find(x => x.label === 'UTC').value).toBe('2023-11-14T22:13:20.000Z');
      expect(r.rows.find(x => x.label === 'Relative').value).toBe('2 minutes ago');
    }
    expect(decode('123456789')).toEqual([]);          // 1973: not a plausible time
  });
  it('unicode escapes', () => { expect(decode('caf\\u00e9 \\u{1F600} \\x41 U+263A')[0].rows[0].value).toBe('café 😀 A ☺'); });
});

describe('limits and switch', () => {
  it('ignores empty and huge input', () => {
    expect(decode('')).toEqual([]);
    expect(decode('A'.repeat(D.MAX_INPUT + 1))).toEqual([]);
  });
  it('looksDecodable follows the switch', () => {
    expect(D.looksDecodable('1700000000')).toBe(true);
    D.setEnabled(false);
    expect(D.looksDecodable('1700000000')).toBe(false);
  });
});

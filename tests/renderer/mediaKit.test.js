// @vitest-environment jsdom
//
// js/media-kit.js: the helpers the Wave 3 games-and-media features share.
import { describe, it, expect, beforeEach } from 'vitest';

const { VexMediaKit } = require('../../src/renderer/js/media-kit.js');

beforeEach(() => { localStorage.clear(); delete globalThis.GameMode; delete globalThis.GameSession; delete globalThis.AttentionState; });

describe('storage', () => {
  it('reads the fallback only for a key that was never written', () => {
    expect(VexMediaKit.read('vex.x', [1])).toEqual([1]);
    VexMediaKit.write('vex.x', { a: 1 });
    expect(VexMediaKit.read('vex.x', null)).toEqual({ a: 1 });
  });
  it('throws, naming the key, for a value that cannot be read', () => {
    localStorage.setItem('vex.bad', '{nope');
    expect(() => VexMediaKit.read('vex.bad', [])).toThrow(/"vex.bad" is not readable/);
  });
  it('keeps a switch as 1 or 0 with a default for an unset one', () => {
    expect(VexMediaKit.flag('vex.f', true)).toBe(true);
    expect(VexMediaKit.flag('vex.f', false)).toBe(false);
    VexMediaKit.setFlag('vex.f', false);
    expect(VexMediaKit.flag('vex.f', true)).toBe(false);
  });
});

describe('time', () => {
  it('reads a day and a time on the local clock or UTC, and refuses nonsense', () => {
    expect(VexMediaKit.parseLocal('2026-11-02 18:30')).toBe(new Date(2026, 10, 2, 18, 30).getTime());
    expect(VexMediaKit.parseLocal('2026-11-02 18:30', true)).toBe(Date.UTC(2026, 10, 2, 18, 30));
    expect(VexMediaKit.parseLocal('2026-11-02')).toBe(new Date(2026, 10, 2).getTime());
    expect(() => VexMediaKit.parseLocal('2026-02-30')).toThrow(/not a real date/);
    expect(() => VexMediaKit.parseLocal('tomorrow')).toThrow(/YYYY-MM-DD/);
    expect(() => VexMediaKit.parseLocal('2026-11-02 25:00')).toThrow();
  });
  it('writes a span in the biggest two units', () => {
    expect(VexMediaKit.span(30000)).toBe('under a minute');
    expect(VexMediaKit.span(40 * 60000)).toBe('40 min');
    expect(VexMediaKit.span(130 * 60000)).toBe('2 h 10 min');
    expect(VexMediaKit.span((3 * 1440 + 4 * 60) * 60000)).toBe('3 d 4 h');
  });
});

describe('addresses and state', () => {
  it('accepts only http(s) addresses without a login', () => {
    expect(VexMediaKit.webUrl('https://a.example/x')).toBe('https://a.example/x');
    expect(() => VexMediaKit.webUrl('javascript:alert(1)')).toThrow(/Only a web address/);
    expect(() => VexMediaKit.webUrl('https://u:p@a.example')).toThrow(/user name/);
    expect(() => VexMediaKit.webUrl('nope')).toThrow(/not a web address/);
  });
  it('knows a game or a quiet moment from Vex\'s own state', () => {
    expect(VexMediaKit.gaming()).toBe(false);
    globalThis.GameSession = { active: true };
    expect(VexMediaKit.gaming()).toBe(true);
    delete globalThis.GameSession;
    globalThis.AttentionState = { get: () => ({ quiet: true }) };
    expect(VexMediaKit.quiet()).toBe(true);
  });
});

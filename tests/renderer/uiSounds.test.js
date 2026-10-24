// @vitest-environment jsdom
//
// Interface sounds (js/ui-sounds.js): on by default, gated by Game mode / meetings / Focus / quiet
// hours / volume / a hidden window / a held mouse button, and rate limited per kind.
import { describe, it, expect, beforeEach } from 'vitest';

const { VexUiSounds: U } = require('../../src/renderer/js/ui-sounds.js');
const fs = require('fs');
const path = require('path');
const JS = path.resolve(__dirname, '../../src/renderer/js');

const base = (over = {}) => ({ kind: 'tick', enabled: { master: true, typing: true, hover: true, tabs: true }, volume: 0.5, quietHours: false, sources: [], hidden: false, unfocused: false, buttonsDown: false, last: 0, now: 100000, ...over });

beforeEach(() => { localStorage.clear(); });

describe('defaults', () => {
  it('a fresh profile has everything on at volume 0.5', () => {
    for (const n of ['master', 'typing', 'hover', 'tabs']) expect(U.flag(n), n).toBe(true);
    expect(U.volume()).toBe(0.5);
    expect(U.tabsOn()).toBe(true);
  });
  it('a saved 0 is off, a saved 1 is on', () => {
    U.setFlag('hover', false);
    expect(localStorage.getItem('vex.uiSounds.hover')).toBe('0');
    expect(U.flag('hover')).toBe(false);
    U.setFlag('hover', true);
    expect(U.flag('hover')).toBe(true);
    U.setFlag('master', false);
    expect(U.tabsOn()).toBe(false);
  });
  it('volume is clamped on read and refused on write when out of range', () => {
    localStorage.setItem('vex.uiSounds.volume', '7');
    expect(U.volume()).toBe(1);
    localStorage.setItem('vex.uiSounds.volume', 'abc');
    expect(U.volume()).toBe(0.5);
    localStorage.setItem('vex.uiSounds.volume', '0');
    expect(U.volume()).toBe(0);
    expect(() => U.setVolume(2)).toThrow();
  });
  it('is not under the playful sound switch', () => {
    const src = fs.readFileSync(path.join(JS, 'ui-sounds.js'), 'utf8');
    expect(src).not.toMatch(/VexFun\.|VexPlayfulness\./);
    const P = require('../../src/renderer/js/vex-playfulness.js').VexPlayfulness;
    expect(P.FUNCTIONAL_AUDIO).toContain('ui-sounds.js');
  });
});

describe('decide', () => {
  it('lets a normal sound through', () => {
    for (const kind of Object.keys(U.KINDS)) expect(U.decide(base({ kind, settled: true })), kind).toBe('');
  });
  it('refuses an unknown kind', () => { expect(U.decide(base({ kind: 'nope' }))).toBe('unknown sound'); });
  it('the master and each kind switch stop their sounds', () => {
    expect(U.decide(base({ enabled: { master: false, hover: true } }))).toMatch(/off/);
    expect(U.decide(base({ kind: 'tick', enabled: { master: true, hover: false } }))).toMatch(/hover/);
    expect(U.decide(base({ kind: 'key', enabled: { master: true, typing: false } }))).toMatch(/typing/);
    expect(U.decide(base({ kind: 'tabClose', enabled: { master: true, tabs: false } }))).toMatch(/tabs/);
    expect(U.decide(base({ kind: 'key', enabled: { master: true, hover: false } }))).toBe('');
  });
  it('zero volume is silent', () => { expect(U.decide(base({ volume: 0 }))).toBe('volume is zero'); });
  it('Game mode, a meeting and a Focus session each silence it', () => {
    expect(U.decide(base({ sources: ['game'] }))).toBe('game is on');
    expect(U.decide(base({ sources: ['meeting'] }))).toBe('meeting is on');
    expect(U.decide(base({ sources: ['focus'] }))).toBe('focus is on');
    expect(U.decide(base({ sources: ['quiet-switch'] }))).toBe('quiet switch is on');
    expect(U.decide(base({ sources: ['travel'] }))).toBe('');
  });
  it('quiet hours, a hidden window, an unfocused window and a held mouse button silence it', () => {
    expect(U.decide(base({ quietHours: true }))).toBe('quiet hours');
    expect(U.decide(base({ hidden: true }))).toMatch(/hidden/);
    expect(U.decide(base({ unfocused: true }))).toMatch(/focused/);
    expect(U.decide(base({ buttonsDown: true }))).toMatch(/button/);
  });
  it('a sample ignores everything but the volume', () => {
    expect(U.decide(base({ kind: 'tabOpen', sources: ['game'], quietHours: true, hidden: true, enabled: { master: false }, preview: true }))).toBe('');
    expect(U.decide(base({ preview: true, volume: 0 }))).toBe('volume is zero');
  });
  it('a tab that opens before the window has settled is silent', () => {
    expect(U.decide(base({ kind: 'tabOpen', settled: false }))).toMatch(/starting/);
    expect(U.decide(base({ kind: 'tabOpen', settled: true }))).toBe('');
  });
  it('rate limits each kind', () => {
    const gap = (kind, ms, over = {}) => U.decide(base({ kind, last: 100000 - ms, now: 100000, settled: true, ...over }));
    expect(gap('tick', 50)).toMatch(/too soon/);
    expect(gap('tick', U.KINDS.tick.gap)).toBe('');
    expect(gap('key', 10)).toMatch(/too soon/);
    expect(gap('key', 60)).toBe('');
    expect(gap('tabClose', 699)).toMatch(/too soon/);
    expect(gap('tabClose', 700)).toBe('');
    expect(gap('tabOpen', 100)).toMatch(/too soon/);
  });
  it('the hover tick is rate limited harder than typing, so a sweep is not a machine gun', () => {
    expect(U.KINDS.tick.gap).toBeGreaterThanOrEqual(100);
    expect(U.KINDS.tick.gap).toBeGreaterThan(U.KINDS.key.gap);
  });
});

describe('settledFor', () => {
  it('needs the settled mark plus two seconds', () => {
    expect(U.settledFor({}, 99999)).toBe(false);
    expect(U.settledFor(null, 99999)).toBe(false);
    expect(U.settledFor({ settled: 5000 }, 6999)).toBe(false);
    expect(U.settledFor({ settled: 5000 }, 7000)).toBe(true);
  });
});

describe('notes', () => {
  it('a tab opening rises and closing falls', () => {
    const o = U.notesFor('tabOpen'), c = U.notesFor('tabClose');
    expect(o[1].f).toBeGreaterThan(o[0].f);
    expect(c[1].f).toBeLessThan(c[0].f);
    expect(() => U.notesFor('x')).toThrow();
  });
});

describe('wiring', () => {
  it('plays a key for typing in the address bar and Ctrl+K only, with plain keys only', () => {
    const played = [];
    const orig = U.play; U.play = (k) => { played.push(k); return true; };
    const ev = (id, key, extra = {}) => ({ target: { id }, key, ...extra });
    U._onKey(ev('url-input', 'a'));
    U._onKey(ev('command-input', 'Backspace'));
    U._onKey(ev('other-input', 'a'));
    U._onKey(ev('url-input', 'Shift'));
    U._onKey(ev('url-input', 'ArrowLeft'));
    U._onKey(ev('url-input', 'c', { ctrlKey: true }));
    U.play = orig;
    expect(played).toEqual(['key', 'key']);
  });

  it('ticks when entering a browser button, not when moving inside it or holding a button', () => {
    document.body.innerHTML = '<div id="top-bar"><button id="b"><span id="s">x</span></button></div><div id="page"><button id="p">p</button></div>';
    const played = [];
    const orig = U.play; U.play = (k) => { played.push(k); return true; };
    const b = document.getElementById('b'), s = document.getElementById('s');
    U._onOver({ target: b, relatedTarget: document.body, buttons: 0 });
    U._onOver({ target: s, relatedTarget: b, buttons: 0 });
    U._onOver({ target: b, relatedTarget: document.body, buttons: 1 });
    U._onOver({ target: document.getElementById('p'), relatedTarget: null, buttons: 0 });
    b.disabled = true;
    U._onOver({ target: b, relatedTarget: null, buttons: 0 });
    U.play = orig;
    expect(played).toEqual(['tick']);
  });

  it('play() refuses (and counts nothing) when the rules say no', () => {
    globalThis.AttentionState = { get: () => ({ sources: [{ id: 'game' }] }) };
    expect(U.play('tick')).toBe(false);
    expect(U.lastReason).toBe('game is on');
    delete globalThis.AttentionState;
  });

  it('vex-sounds.js leaves tab close to this file while tab sounds are on', () => {
    const src = fs.readFileSync(path.join(JS, 'vex-sounds.js'), 'utf8');
    expect(src).toContain('VexUiSounds.tabsOn()');
  });

  it('TabManager.createTab announces vex:tab-created and session restore does not', () => {
    const src = fs.readFileSync(path.join(JS, 'tabs.js'), 'utf8');
    expect(src.match(/vex:tab-created/g).length).toBe(1);
    const at = src.indexOf('vex:tab-created');
    expect(src.slice(0, at).lastIndexOf('  createTab(')).toBeGreaterThan(src.slice(0, at).lastIndexOf('\n  }\n'));
  });

  it('is loaded after vex-sounds.js', () => {
    const html = fs.readFileSync(path.join(JS, '../index.html'), 'utf8');
    expect(html.indexOf('js/ui-sounds.js')).toBeGreaterThan(html.indexOf('js/vex-sounds.js'));
  });
});

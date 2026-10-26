// @vitest-environment jsdom
//
// Interface sounds, the options added 2026-10-26 (js/ui-sounds.js): button presses, five styles, a pitch, a reset, the click in the New Tab page's search
// and in search boxes, and the reasons a click used to go missing.
import { describe, it, expect, beforeEach } from 'vitest';

const { VexUiSounds: U } = require('../../src/renderer/js/ui-sounds.js');
const fs = require('fs');
const path = require('path');
const JS = path.resolve(__dirname, '../../src/renderer/js');

beforeEach(() => { localStorage.clear(); U._last = {}; U._down = false; });

describe('button presses, style and pitch', () => {
  it('button presses are off until switched on, the other sounds are on', () => {
    expect(U.flag('press')).toBe(false);
    expect(U.flag('typing')).toBe(true);
    U.setFlag('press', true);
    expect(U.flag('press')).toBe(true);
    U.setFlag('press', false);
    expect(U.flag('press')).toBe(false);
    expect(() => U.flag('volume')).toThrow();
  });
  it('a press is refused while its switch is off, and the sample ignores that', () => {
    expect(U.why('press', { fresh: true })).toBe('press sounds are off');
    expect(U.why('press', { fresh: true, preview: true })).toBe('');
  });
  it('the style is soft until chosen; an unknown saved style is soft; an unknown style is refused', () => {
    expect(U.style()).toBe('soft');
    U.setStyle('mechanical');
    expect(U.style()).toBe('mechanical');
    localStorage.setItem(U.KEYS.style, 'nonsense');
    expect(U.style()).toBe('soft');
    expect(() => U.setStyle('nonsense')).toThrow();
  });
  it('the pitch is 1 until chosen, is clamped on read and refused on write when out of range', () => {
    expect(U.pitch()).toBe(1);
    U.setPitch(1.25);
    expect(U.pitch()).toBe(1.25);
    localStorage.setItem(U.KEYS.pitch, '9');
    expect(U.pitch()).toBe(U.PITCH_MAX);
    localStorage.setItem(U.KEYS.pitch, '0.01');
    expect(U.pitch()).toBe(U.PITCH_MIN);
    expect(() => U.setPitch(3)).toThrow();
    expect(() => U.setPitch('x')).toThrow();
  });
  it('resetAll puts every sound option back to what a fresh profile has', () => {
    U.setFlag('master', false); U.setFlag('press', true); U.setStyle('glass'); U.setPitch(1.4); U.setVolume(0.9);
    U.resetAll();
    expect(U.flag('master')).toBe(true);
    expect(U.flag('press')).toBe(false);
    expect(U.style()).toBe('soft');
    expect(U.pitch()).toBe(1);
    expect(U.volume()).toBe(U.DEFAULT_VOLUME);
  });
});

describe('every style', () => {
  it('has a note list for every sound, each note well formed', () => {
    for (const style of Object.keys(U.STYLES)) {
      for (const kind of Object.keys(U.KINDS)) {
        const notes = U.notesFor(kind, 1, style, 1);
        expect(notes.length).toBeGreaterThan(0);
        for (const n of notes) {
          if (n.noise) { expect(n.f).toBeGreaterThan(0); expect(n.q).toBeGreaterThan(0); }
          else expect(['sine', 'square', 'triangle', 'sawtooth']).toContain(n.wave);
          expect(n.d).toBeGreaterThan(0);
          expect(n.t).toBeGreaterThan(-0.0001);
          expect(n.g).toBeGreaterThan(0);
          expect(n.g).toBeLessThan(1.0001);
        }
      }
    }
  });
  it('a tab opens rising and closes falling in every style', () => {
    for (const style of Object.keys(U.STYLES)) {
      const tonal = (kind) => U.notesFor(kind, 1, style, 1).filter(n => !n.noise);
      const o = tonal('tabOpen'), c = tonal('tabClose');
      expect(o[o.length - 1].f).toBeGreaterThan(o[0].f);
      expect(c[c.length - 1].f).toBeLessThan(c[0].f);
    }
  });
  it('the pitch multiplies every note, and an unknown style plays as the soft one', () => {
    const base = U.notesFor('tick', 1, 'soft', 1), high = U.notesFor('tick', 1, 'soft', 1.5);
    high.forEach((n, i) => { expect(n.f).toBe(base[i].f * 1.5); expect(n.f2).toBe(base[i].f2 * 1.5); });
    expect(U.notesFor('tick', 1, 'nonsense', 1)).toEqual(base);
  });
  it('the Settings group offers the style, the pitch, a sample for each sound and the reset, all with a Turkish text', () => {
    const src = fs.readFileSync(path.join(JS, 'ui-sounds.js'), 'utf8');
    const tr = fs.readFileSync(path.join(JS, 'i18n-ui.js'), 'utf8');
    for (const text of ['Sound style', 'Pitch', 'Hear typing', 'Hear hover', 'Hear a tab open', 'Hear a tab close', 'Hear a button press', 'Reset the sound options', 'Button presses']) {
      expect(src).toContain("'" + text + "'");
      expect(tr).toContain("'" + text + "':");
    }
    for (const text of ['Mechanical', 'Bubble', 'Arcade']) expect(tr).toContain("'" + text + "':");
  });
});

describe('why a click went missing (found 2026-10-26)', () => {
  it('a typed key proves the window has focus, even while a page holds the document\'s own focus', () => {
    const had = document.hasFocus;
    document.hasFocus = () => false;
    try {
      expect(U.why('key')).toBe('window is not focused');
      expect(U.why('key', { fresh: true })).toBe('');
    } finally { document.hasFocus = had; }
  });
  it('a mouse button counts as held for three seconds at most: its release over a page is never seen here', () => {
    U._down = true; U._downAt = 1000;
    expect(U._held(1000 + 2900)).toBe(true);
    expect(U._held(1000 + 3100)).toBe(false);
    U._down = false;
    expect(U._held(1100)).toBe(false);
  });
  it('a press is the button going down, never a drag', () => {
    U.setFlag('press', true);
    U._down = true; U._downAt = Date.now();
    expect(U.why('press', { fresh: true })).toBe('');
    expect(U.why('tick', { fresh: true })).toBe('a mouse button is held');
  });
  it('a sound waits for the audio engine to run before it is placed on its clock', () => {
    const src = fs.readFileSync(path.join(JS, 'ui-sounds.js'), 'utf8');
    expect(src).toContain("if (ctx.state === 'running') go();");
    expect(src).toContain('ctx.resume().then(go');
    expect(src).toContain('const t0 = ctx.currentTime + 0.005;');
    expect(src).toContain('warm()');
  });
});

describe('where typing clicks', () => {
  it('a search box with a class counts, a plain input does not', () => {
    expect(U._isTypingTarget({ id: 'url-input' })).toBe(true);
    expect(U._isTypingTarget({ id: '', classList: { contains: (c) => c === 'set-search' } })).toBe(true);
    expect(U._isTypingTarget({ id: 'x', classList: { contains: () => false } })).toBe(false);
    expect(U._isTypingTarget(null)).toBe(false);
  });
  it('the New Tab page reports plain keys in its inputs, never which key, and the window clicks for the tab in front only', () => {
    const pre = fs.readFileSync(path.join(JS, '../../preload-webview.js'), 'utf8');
    const at = pre.indexOf("ipcRenderer.sendToHost('vex-ui-key')");
    expect(at).toBeGreaterThan(-1);
    const block = pre.slice(pre.lastIndexOf("window.addEventListener('keydown'", at), at + 80);
    expect(block).toContain('e.isTrusted');
    expect(block).toContain("t.tagName === 'INPUT'");
    expect(block).not.toContain("sendToHost('vex-ui-key', ");   // what was typed is not sent
    // inside the start page's own block: only Vex's own start page gets it
    const guard = pre.lastIndexOf('if (!_isVexStartPage(href)) return;', at);
    expect(guard).toBeGreaterThan(-1);
    expect(pre.slice(guard, at)).not.toContain('\n})();');
    const wv = fs.readFileSync(path.join(JS, 'webview.js'), 'utf8');
    expect(wv).toContain("e.channel === 'vex-ui-key'");
    expect(wv).toContain('tab.id === TabManager.activeTabId && typeof VexUiSounds');
  });
  it('onPageKey plays a key sound that does not need the document to be focused', () => {
    const calls = [];
    const orig = U.play; U.play = (k, o) => { calls.push([k, o]); return true; };
    try { U.onPageKey(); } finally { U.play = orig; }
    expect(calls).toEqual([['key', { fresh: true }]]);
  });
  it('pressing one of the browser\'s buttons plays a press, a page element does not', () => {
    document.body.innerHTML = '<div id="top-bar"><button id="b">x</button></div><button id="p">p</button>';
    const played = [];
    const orig = U.play; U.play = (k) => { played.push(k); return true; };
    try {
      U._onPress({ target: document.getElementById('b'), button: 0 });
      U._onPress({ target: document.getElementById('b'), button: 2 });
      U._onPress({ target: document.getElementById('p'), button: 0 });
    } finally { U.play = orig; }
    expect(played).toEqual(['press']);
  });
});

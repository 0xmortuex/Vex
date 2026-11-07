// @vitest-environment jsdom
// Reader view "about N min left" (js/reader-time.js): the pure sums, the opt-in setting, the script written into the reader page
// (run here on a jsdom document with a scripted layout), and how reading-mode.js asks for it.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
const fs = require('fs'), path = require('path');
require('../../src/renderer/js/vex-icons.js');
const { VexReaderTime: T } = require('../../src/renderer/js/reader-time.js');
const { ReadingMode } = require('../../src/renderer/js/reading-mode.js');
const read = (p) => fs.readFileSync(path.join(__dirname, '../..', p), 'utf8');

beforeEach(() => { localStorage.clear(); });
afterEach(() => { delete globalThis.VexI18nUI; delete globalThis.VexReaderTime; document.body.innerHTML = ''; });

describe('timeLeft', () => {
  it('divides the words still to read by the speed', () => {
    expect(T.timeLeft(2000, 0, 200)).toEqual({ minutes: 10, done: false });
    expect(T.timeLeft(2000, 0.5, 200)).toEqual({ minutes: 5, done: false });
    expect(T.timeLeft(2000, 0.5, 100)).toEqual({ minutes: 10, done: false });
  });
  it('rounds to the nearest minute but never shows 0 minutes while 45 seconds or more are left', () => {
    expect(T.timeLeft(300, 0, 200)).toEqual({ minutes: 2, done: false });     // 1.5 rounds up
    expect(T.timeLeft(250, 0, 200)).toEqual({ minutes: 1, done: false });     // 75 seconds
    expect(T.timeLeft(150, 0, 200)).toEqual({ minutes: 1, done: false });     // 45 seconds exactly
  });
  it('says "under a minute" (0) below 45 seconds and done at the end', () => {
    expect(T.timeLeft(120, 0, 200)).toEqual({ minutes: 0, done: false });     // 36 seconds
    expect(T.timeLeft(2000, 0.99, 200)).toEqual({ minutes: 0, done: false });
    expect(T.timeLeft(2000, 1, 200)).toEqual({ minutes: 0, done: true });
    expect(T.timeLeft(0, 0, 200)).toEqual({ minutes: 0, done: true });
  });
  it('clamps a fraction outside 0..1 and refuses a non-number', () => {
    expect(T.timeLeft(1000, -3, 200)).toEqual({ minutes: 5, done: false });
    expect(T.timeLeft(1000, 7, 200).done).toBe(true);
    expect(() => T.timeLeft(NaN, 0, 200)).toThrow(/word count/);
    expect(() => T.timeLeft(100, 0, 0)).toThrow(/reading speed/);
  });
  it('has a slower default for Turkish', () => {
    expect(T.DEFAULT_WPM).toBe(200);
    expect(T.TURKISH_WPM).toBe(180);
  });
});

describe('fractionOf', () => {
  it('is how much of the article the bottom of the window has passed', () => {
    expect(T.fractionOf(800, 0, 4000)).toBeCloseTo(0.2, 6);
    expect(T.fractionOf(800, -1200, 4000)).toBeCloseTo(0.5, 6);
    expect(T.fractionOf(800, -3200, 4000)).toBe(1);
    expect(T.fractionOf(800, -9000, 4000)).toBe(1);
    expect(T.fractionOf(800, 900, 4000)).toBe(0);
    expect(T.fractionOf(800, 0, 0)).toBe(0);
  });
});

describe('the setting', () => {
  it('is off by default and remembers on and a typed speed', () => {
    expect(T.state()).toEqual({ on: false, wpm: 0 });
    expect(T.enabled()).toBe(false);
    T.setEnabled(true);
    expect(T.enabled()).toBe(true);
    expect(T.setWpm('250')).toBe(250);
    expect(T.state()).toEqual({ on: true, wpm: 250 });
    expect(JSON.parse(localStorage.getItem('vex.reader.timeLeft'))).toEqual({ on: true, wpm: 250 });
  });
  it('uses 200, or 180 in Turkish, until a speed is typed, and an empty answer goes back to that', () => {
    expect(T.effectiveWpm()).toBe(200);
    globalThis.VexI18nUI = { locale: () => 'tr', lookup: () => null };
    expect(T.effectiveWpm()).toBe(180);
    T.setWpm('300');
    expect(T.effectiveWpm()).toBe(300);
    expect(T.setWpm('')).toBe(180);
    expect(T.state().wpm).toBe(0);
  });
  it('refuses a speed outside 80 to 600 and keeps the old one', () => {
    T.setWpm('220');
    expect(() => T.setWpm('50')).toThrow(/80 to 600/);
    expect(() => T.setWpm('abc')).toThrow(/80 to 600/);
    expect(() => T.setWpm('601')).toThrow(/80 to 600/);
    expect(T.state().wpm).toBe(220);
  });
  it('reads a damaged record as the defaults and says so', () => {
    const notes = [];
    window.VexProblems = { note: (...a) => notes.push(a) };
    localStorage.setItem('vex.reader.timeLeft', '{not json');
    expect(T.state()).toEqual({ on: false, wpm: 0 });
    expect(notes.length).toBe(1);
    delete window.VexProblems;
  });
});

describe('pageScript', () => {
  it('is empty while the setting is off, or when there are no words', () => {
    expect(T.pageScript(1000)).toBe('');
    T.setEnabled(true);
    expect(T.pageScript(0)).toBe('');
    expect(T.pageScript(NaN)).toBe('');
  });
  it('carries the word count, the speed and the three texts when on', () => {
    T.setEnabled(true);
    T.setWpm('240');
    const s = T.pageScript(1234);
    expect(s.startsWith('<script>')).toBe(true);
    expect(s.endsWith('</script>')).toBe(true);
    expect(s).toContain('"words":1234');
    expect(s).toContain('"wpm":240');
    expect(s).toContain('about {1} min left');
    expect(s.slice(8, -9)).not.toContain('</script');
  });
});

describe('the script inside the reader page', () => {
  function page(words, wpm) {
    document.body.innerHTML = '<main id="vr-main"><article><p>text</p></article></main>';
    const art = document.querySelector('article');
    const layout = { top: 0, height: 1000 };
    art.getBoundingClientRect = () => ({ top: layout.top, height: layout.height });
    window.innerHeight = 500;
    window.requestAnimationFrame = (fn) => { fn(); return 1; };
    new Function(T.pageSource({ words, wpm, labels: { left: 'about {1} min left', soon: 'less than a minute left', done: 'Finished' } }))();
    return { layout, text: () => document.getElementById('vr-timeleft').textContent };
  }
  it('shows the time left at the start, follows the scroll, and says Finished at the end', () => {
    const p = page(2000, 200);
    expect(p.text()).toBe('about 5 min left');        // half the article is above the bottom of the window
    p.layout.top = -250;                               // scrolled: (500 + 250) / 1000 = 0.75 of 2000 words read
    window.dispatchEvent(new Event('scroll'));
    expect(p.text()).toBe('about 3 min left');        // 500 words left / 200 = 2.5, rounds to 3
    p.layout.top = -500;
    window.dispatchEvent(new Event('scroll'));
    expect(p.text()).toBe('Finished');
  });
  it('does nothing on a page without the reader article', () => {
    document.body.innerHTML = '<p>no reader here</p>';
    new Function(T.pageSource({ words: 100, wpm: 200, labels: { left: 'a', soon: 'b', done: 'c' } }))();
    expect(document.getElementById('vr-timeleft')).toBeNull();
  });
});

describe('how the reader asks for it', () => {
  const block = [{ tag: 'P', runs: [{ t: Array.from({ length: 460 }, () => 'word').join(' ') }] }];
  it('adds the script to the reader document only when the setting is on', () => {
    globalThis.VexReaderTime = T;
    expect(ReadingMode.buildHtml({ title: 'T', blocks: block }, 'https://x.test/a', {})).not.toContain('vr-timeleft');
    T.setEnabled(true);
    const html = ReadingMode.buildHtml({ title: 'T', blocks: block }, 'https://x.test/a', {});
    expect(html).toContain('vr-timeleft');
    expect(html).toContain('"words":460');
  });
  it('leaves the reader as it was when the module has not loaded', () => {
    expect(ReadingMode.buildHtml({ title: 'T', blocks: block }, 'https://x.test/a', {})).not.toContain('vr-timeleft');
  });
  it('is a lazy module with two commands and no index.html tag', () => {
    expect(read('src/renderer/js/lazy-boot.js')).toContain("{ src: 'js/reader-time.js'");
    expect(read('src/renderer/index.html')).not.toContain('reader-time.js');
    expect(read('src/renderer/js/reading-mode.js')).toContain('VexReaderTime.pageScript(words)');
    const src = read('src/renderer/js/reader-time.js');
    expect(src).toContain("registerCommand({ id: 'reader-time-left'");
    expect(src).toContain("registerCommand({ id: 'reader-reading-speed'");
  });
});

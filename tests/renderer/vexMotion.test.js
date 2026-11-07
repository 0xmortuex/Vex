// @vitest-environment jsdom
//
// CSS stills transitions and animations when Windows' Animation effects are off or Vex's Reduce motion is on, but script does not
// follow: scrollTo / scrollIntoView with behavior: 'smooth' ignore both. Measured in real Chromium (a visible window, with
// prefers-reduced-motion: reduce emulated and `html, html * { scroll-behavior: auto !important }`): behavior 'smooth' ran 128 frames
// of animation, behavior 'auto' jumped in one. Script that moves things now asks VexMotion (js/vex-plural.js).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const root = path.join(__dirname, '../..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

let mql;
function mockMedia(reduce) {
  const listeners = new Set();
  mql = {
    matches: reduce,
    addEventListener: (type, fn) => { if (type === 'change') listeners.add(fn); },
    removeEventListener: (type, fn) => { listeners.delete(fn); },
    set(v) { this.matches = v; [...listeners].forEach(fn => fn({ matches: v })); },
    count: () => listeners.size,
  };
  window.matchMedia = vi.fn(() => mql);
  globalThis.matchMedia = window.matchMedia;
}

beforeEach(() => {
  document.documentElement.removeAttribute('data-reduce-motion');
  mockMedia(false);
});
afterEach(() => { delete window.matchMedia; delete globalThis.matchMedia; });

describe('VexMotion.reduced / scroll', () => {
  it('is false when nothing asks for less motion, and scrolls smoothly', () => {
    expect(VexMotion.reduced()).toBe(false);
    expect(VexMotion.scroll()).toBe('smooth');
  });
  it("follows Windows' setting", () => {
    mockMedia(true);
    expect(VexMotion.reduced()).toBe(true);
    expect(VexMotion.scroll()).toBe('auto');
  });
  it("follows Vex's Reduce motion (and Game mode's stillness) through the attribute, whatever Windows says", () => {
    document.documentElement.setAttribute('data-reduce-motion', '');
    expect(VexMotion.reduced()).toBe(true);
    expect(VexMotion.scroll()).toBe('auto');
  });
  it('is false, not an error, where there is no matchMedia and no attribute', () => {
    delete window.matchMedia; delete globalThis.matchMedia;
    expect(VexMotion.reduced()).toBe(false);
  });
});

describe('VexMotion.onChange', () => {
  it("tells when Windows' setting changes, once per change", () => {
    const seen = [];
    const off = VexMotion.onChange(v => seen.push(v));
    mql.set(true); mql.set(true); mql.set(false);
    expect(seen).toEqual([true, false]);
    off();
    expect(mql.count()).toBe(0);
  });
  it("tells when Vex's Reduce motion changes (the attribute), which no media query reports", async () => {
    const seen = [];
    const off = VexMotion.onChange(v => seen.push(v));
    document.documentElement.setAttribute('data-reduce-motion', '');
    await new Promise(r => setTimeout(r, 0));
    document.documentElement.removeAttribute('data-reduce-motion');
    await new Promise(r => setTimeout(r, 0));
    expect(seen).toEqual([true, false]);
    off();
    document.documentElement.setAttribute('data-reduce-motion', '');
    await new Promise(r => setTimeout(r, 0));
    expect(seen).toEqual([true, false]);
  });
  it('refuses something that is not a function', () => {
    expect(() => VexMotion.onChange(null)).toThrow();
  });
});

describe('the callers', () => {
  const { VexFun } = require('../../src/renderer/js/vex-fun.js');
  const { VexExpression } = require('../../src/renderer/js/vex-expression.js');

  it("the play and expression modules now follow Vex's Reduce motion too (they only read Windows' setting before)", () => {
    expect(VexFun.reducedMotion()).toBe(false);
    expect(VexExpression.reducedMotion()).toBe(false);
    document.documentElement.setAttribute('data-reduce-motion', '');
    expect(VexFun.reducedMotion()).toBe(true);
    expect(VexExpression.reducedMotion()).toBe(true);
  });

  it('the swipe-to-top and -bottom gestures send the page the right behaviour', () => {
    const { MouseGestures } = require('../../src/renderer/js/gestures.js');
    const sent = [];
    const wv = { executeJavaScript: (code) => { sent.push(code); return Promise.resolve(); } };
    MouseGestures.ACTIONS.top.run(wv);
    MouseGestures.ACTIONS.bottom.run(wv);
    expect(sent.every(c => c.includes('behavior:"smooth"'))).toBe(true);
    sent.length = 0;
    document.documentElement.setAttribute('data-reduce-motion', '');
    MouseGestures.ACTIONS.top.run(wv);
    MouseGestures.ACTIONS.bottom.run(wv);
    expect(sent.every(c => c.includes('behavior:"auto"'))).toBe(true);
  });

  it('page actions scroll with the behaviour that was asked for when the script was built', () => {
    const { PageActions } = require('../../src/renderer/js/page-actions.js');
    const steps = [{ op: 'scroll', by: 'top', value: '' }];
    expect(PageActions.guestCode(steps)).toContain('var scrollBehavior = "smooth";');
    document.documentElement.setAttribute('data-reduce-motion', '');
    const code = PageActions.guestCode(steps);
    expect(code).toContain('var scrollBehavior = "auto";');
    expect(code).toContain('behavior: scrollBehavior');
    expect(code).not.toMatch(/behavior: 'smooth'/);
  });

  it('the read-aloud highlight scrolls with the behaviour sent with each mark', () => {
    const src = read('src/renderer/js/page-extras.js');
    expect(src).toMatch(/mark\(i, behavior\)/);
    expect(src).toMatch(/__vexTTS\.mark\(' \+ Number\(i\) \+ ',' \+ JSON\.stringify\(VexMotion\.scroll\(\)\)/);
  });
});

describe('no script smooth-scrolls on its own again', () => {
  it("no 'smooth' scroll behaviour literal is left in the renderer, outside this helper's own comment", () => {
    const dir = path.join(root, 'src/renderer/js');
    const hits = [];
    for (const f of fs.readdirSync(dir).filter(n => n.endsWith('.js'))) {
      const lines = fs.readFileSync(path.join(dir, f), 'utf8').split('\n');
      lines.forEach((l, i) => { if (/behavior:\s*\\?['"]smooth\\?['"]/.test(l) && !l.trim().startsWith('//') && !/behavior === 'auto' \? 'auto' : 'smooth'/.test(l)) hits.push(f + ':' + (i + 1)); });
    }
    expect(hits).toEqual([]);
  });
});

// @vitest-environment jsdom
//
// The closed-shadow-root hook in the page preload (preload-webview.js, "Closed shadow roots, for Picture-in-Picture") replaces
// Element.prototype.attachShadow so Vex can find a video inside a closed root. A page can read a function's source, and Cloudflare's Turnstile
// checks that browser functions are still native: with a plain JavaScript wrapper its widget failed with error 600010 on the chess.com sign-up
// (2026-10-30). The wrapper is now a Proxy of the native function, which reads back as native, and still lists closed roots.
import { describe, it, expect, beforeEach } from 'vitest';

const fs = require('fs'), path = require('path');
const PRELOAD = fs.readFileSync(path.join(__dirname, '../../src/preload-webview.js'), 'latin1');
const start = PRELOAD.indexOf('// === Closed shadow roots, for Picture-in-Picture (main world) ===');
const block = PRELOAD.slice(start, PRELOAD.indexOf('// === Smart Searchbar suggest bridge'));
const SRC = block.slice(block.indexOf('const src = `') + 'const src = `'.length, block.indexOf('`;\n  // executeInMainWorld'));

const nativeAttach = Element.prototype.attachShadow;
beforeEach(() => {
  Element.prototype.attachShadow = nativeAttach;
  delete window.__vexClosedRoots;
});
const install = () => (0, eval)(SRC);

describe('attachShadow after the hook', () => {
  it('is found in the preload and reads back as a native function, with no mark of ours on it', () => {
    expect(SRC).toContain('new Proxy(orig');
    install();
    const f = Element.prototype.attachShadow;
    expect(f).not.toBe(nativeAttach);
    const text = Function.prototype.toString.call(f);
    expect(text).not.toContain('orig.apply');
    expect(text).not.toContain('__vex');
    expect(text).toMatch(/\[native code\]/);
    expect(Object.getOwnPropertyNames(f).filter(k => /vex/i.test(k))).toEqual([]);
    expect(Object.getOwnPropertyNames(nativeAttach).filter(k => /vex/i.test(k))).toEqual([]);
    expect(f.length).toBe(nativeAttach.length);
    expect(f.name).toBe(nativeAttach.name);
  });
  it('still attaches a root and returns it, open or closed, and lists only the closed ones', () => {
    install();
    const a = document.createElement('div'), b = document.createElement('div');
    const open = a.attachShadow({ mode: 'open' });
    const closed = b.attachShadow({ mode: 'closed' });
    expect(open.host).toBe(a);
    expect(a.shadowRoot).toBe(open);
    expect(b.shadowRoot).toBeNull();
    expect(closed).toBeTruthy();
    const roots = window.__vexClosedRoots.map(w => w.deref());
    expect(roots).toEqual([closed]);
  });
  it('an error from the real function reaches the page as it would have, and nothing is recorded', () => {
    install();
    const el = document.createElement('div');
    el.attachShadow({ mode: 'open' });
    expect(() => el.attachShadow({ mode: 'closed' })).toThrow();
    expect(window.__vexClosedRoots.length).toBe(0);
  });
  it('running it twice does not wrap it twice', () => {
    install();
    const once = Element.prototype.attachShadow;
    install();
    expect(Element.prototype.attachShadow).toBe(once);
  });
});
